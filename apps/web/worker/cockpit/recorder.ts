/** Requested: "Er det muligt at bygge en optag lyd-funktion ind, som kan optage møderne?"
 *
 * The rest was already there: a recording that is uploaded (cockpit/handler.ts, POST /upload) is kept in R2, Saga transcribes it with the speakers told
 * apart, writes the minutes from it and the agenda, puts them up for the board to approve and pings the board. What was missing was the recording itself:
 * this is the button on the meeting's page that records with the device's microphone, in the browser, and sends the file to that same route.
 *
 * - Consent first: the button is off until the member has ticked that everyone at the table knows the meeting is recorded.
 * - 32 kbit/s voice (Opus, or AAC in Safari): about 14 MB an hour, so the 60 MB limit is about four hours; the recorder stops and sends at 55 MB.
 * - Nothing is lost with the page: every 10 seconds the recording is also written to the browser's IndexedDB; a page that was closed, a crash or a failed
 *   upload leaves it there, and the page offers to send it, download it or delete it.
 * - The screen is kept awake while recording (Wake Lock). A phone that locks its screen takes the microphone away; the recorder then keeps what it has and
 *   does not send it by itself (the meeting is probably still going on) - it offers the same three choices.
 * - Only the device's microphone is recorded: a meeting on Meet or Zoom is not heard unless the sound comes out of a speaker the microphone can hear.
 * - Asked: "Er der risiko for dårlig stabilitet under optagelse?" - a browser can lose the microphone without saying so (a call, a locked screen, a page put in
 *   the background), and a recording that is silent for the last hour is worse than one that stopped. So the recorder shows the level of the sound it hears,
 *   says so at once when the microphone goes quiet, is taken away by the phone or stops delivering, notes the holes there were, and a "Tjek mikrofonen"
 *   button tries the microphone for a few seconds before the meeting. */

import { infoTip } from "./info.js";

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const RECORDER_LIMIT_BYTES = 55 * 1024 * 1024;

/** Danish text inside the script and its English translation (cockpit/i18n.ts replaces these in the finished page). */
export const RECORDER_SCRIPT_EN: Array<[string, string]> = [
  ["Denne browser kan ikke optage her. Brug en nyere Chrome, Safari eller Firefox - eller optag med telefonens egen optager, og upload filen nedenfor.",
    "This browser cannot record here. Use a recent Chrome, Safari or Firefox - or record with the phone's own recorder and upload the file below."],
  ["Browseren fik ikke lov til at bruge mikrofonen. Tillad mikrofonen for siden, og prøv igen.", "The browser was not allowed to use the microphone. Allow the microphone for this page and try again."],
  ["Mikrofonen kunne ikke startes: ", "The microphone could not be started: "],
  ["Optager", "Recording"], ["På pause", "Paused"], ["Pause", "Pause"], ["Fortsæt", "Resume"],
  ["Optagelsen kører. Vil du forlade siden?", "The recording is running. Do you want to leave the page?"],
  ["Mikrofonen blev afbrudt (fx fordi skærmen blev låst). Det, der er optaget indtil da, er gemt her på enheden.", "The microphone was cut off (for example because the screen locked). What was recorded until then is saved on this device."],
  ["Optagelsen nåede loftet på 60 MB og er sendt. Start en ny optagelse til resten af mødet.", "The recording reached the 60 MB limit and has been sent. Start a new recording for the rest of the meeting."],
  ["Optagelsen er for stor til Saga (over 60 MB). Den er gemt her på enheden - hent filen, og gem den i lavere kvalitet.", "The recording is too large for Saga (over 60 MB). It is saved on this device - download the file and save it in lower quality."],
  ["Optagelsen kunne ikke sendes. Er du logget ud? Den er gemt her på enheden - prøv igen.", "The recording could not be sent. Are you logged out? It is saved on this device - try again."],
  ["Ingen forbindelse. Optagelsen er gemt her på enheden - prøv igen, når nettet er tilbage.", "No connection. The recording is saved on this device - try again when the network is back."],
  ["Jeg hører ingen lyd lige nu. Er mikrofonen dækket til eller slået fra?", "I cannot hear any sound right now. Is the microphone covered or switched off?"],
  ["Telefonen har taget mikrofonen (fx et opkald eller en låst skærm). Optagelsen er stille, til den kommer tilbage.", "The phone has taken the microphone (for example a call or a locked screen). The recording is silent until it comes back."],
  ["Optagelsen får ikke lyd fra browseren. Siden er måske sat i baggrunden - hold den åben og skærmen tændt.", "The recording is not getting sound from the browser. The page may have been put in the background - keep it open and the screen on."],
  ["Der manglede cirka ", "About "], [" min. af lyden kl. ", " min. of sound is missing at "],
  ["Mikrofonen virker - jeg kan høre lyd.", "The microphone works - I can hear sound."],
  ["Jeg hører ingenting. Tjek, at mikrofonen er tilladt for siden og ikke dækket til.", "I hear nothing. Check that the microphone is allowed for this page and not covered."],
  ["Der ligger en optagelse fra ", "There is a recording from "], [" kl. ", " at "], [", som ikke blev sendt.", " that was not sent."]
];

export const RECORDER_STYLE = `
.recorder{display:grid;gap:12px;margin:0 0 16px;padding-bottom:16px;border-bottom:1px solid var(--line)}.recorder[hidden],.recorder [hidden]{display:none}
.recorder .check{display:flex;gap:8px;align-items:flex-start;font-weight:500}.recorder .check input{width:auto;margin-top:3px}
.recorder .recbar{display:flex;gap:10px;align-items:center;margin:0;font-size:18px}.recorder .dot{width:12px;height:12px;border-radius:50%;background:#c0392b;animation:recpulse 1.4s ease-in-out infinite}
.recorder .paused .dot{animation:none;background:var(--faint)}@media(prefers-reduced-motion:reduce){.recorder .dot{animation:none}}
@keyframes recpulse{50%{opacity:.35}}.recorder progress{width:100%}.recorder .actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.recorder .actions>*{white-space:nowrap;flex:0 0 auto}
.recorder .meter{height:8px;border-radius:999px;background:var(--soft);overflow:hidden;width:100%}.recorder .meter i{display:block;height:100%;width:0;border-radius:999px;background:var(--accent);transition:width .12s linear}
.recorder .warns p{margin:0 0 6px}.recorder .check-result{margin:0}`;

const SCRIPT = `<script>(function(){
var root=document.querySelector("[data-recorder]");if(!root)return;
function q(s){return root.querySelector(s)}
var action=root.getAttribute("data-action"),date=root.getAttribute("data-date"),meeting=root.getAttribute("data-meeting")||"";
var LIMIT=Number(root.getAttribute("data-limit"));
var panels={idle:q('[data-rec="idle"]'),live:q('[data-rec="live"]'),sending:q('[data-rec="sending"]'),saved:q('[data-rec="saved"]')};
var note=q("[data-rec-msg]"),timeEl=q("[data-rec-time]"),stateEl=q("[data-rec-state]"),bar=q(".recbar"),pauseBtn=q("[data-rec-pause]"),progress=q("[data-rec-progress]"),savedText=q("[data-rec-saved-text]"),download=q("[data-rec-download]");
function show(name){for(var k in panels)panels[k].hidden=(k!==name)}
function say(t){note.textContent=t||""}
if(!(window.MediaRecorder&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)){panels.idle.innerHTML='<p class="notice warn">Denne browser kan ikke optage her. Brug en nyere Chrome, Safari eller Firefox - eller optag med telefonens egen optager, og upload filen nedenfor.</p>';return}

/* The recording is also kept in the browser while it runs, so a closed page or a failed upload loses nothing. */
function openDb(){return new Promise(function(ok,no){var r=indexedDB.open("hjerterum-recorder",1);r.onupgradeneeded=function(){r.result.createObjectStore("parts");r.result.createObjectStore("meta")};r.onsuccess=function(){ok(r.result)};r.onerror=function(){no(r.error)}})}
function store(name,mode,fn){return openDb().then(function(db){return new Promise(function(ok,no){var t=db.transaction(name,mode),out=fn(t.objectStore(name));t.oncomplete=function(){ok(out&&out.result);db.close()};t.onerror=t.onabort=function(){no(t.error);db.close()}})})}
function key(id,n){return id+":"+("00000"+n).slice(-6)}
function keepPart(id,n,blob){return store("parts","readwrite",function(s){return s.put(blob,key(id,n))}).catch(function(){})}
function keepMeta(id,meta){return store("meta","readwrite",function(s){return s.put(meta,id)}).catch(function(){})}
function drop(id){return store("parts","readwrite",function(s){return s.delete(IDBKeyRange.bound(id+":",id+":~"))}).then(function(){return store("meta","readwrite",function(s){return s.delete(id)})}).catch(function(){})}
function readSessions(){return store("meta","readonly",function(s){return s.getAll()}).then(function(metas){return store("meta","readonly",function(s){return s.getAllKeys()}).then(function(keys){return(metas||[]).map(function(m,i){m.id=keys[i];return m})})}).catch(function(){return[]})}
function readParts(id){return store("parts","readonly",function(s){return s.getAll(IDBKeyRange.bound(id+":",id+":~"))}).catch(function(){return[]})}

var rec=null,stream=null,chunks=[],bytes=0,part=0,cur=null,tick=null,lock=null,ran=0,since=0,why="",lastData=0,gaps=[],warns={};
var warnBox=q("[data-rec-warns]"),levelBar=q("[data-rec-level]"),checkBar=q("[data-rec-check-level]"),checkOut=q("[data-rec-check-result]");
/* What the microphone hears: a level bar, and the time of the last sound. A browser can lose the microphone without saying so. */
var AC=window.AudioContext||window.webkitAudioContext;
function meter(ctx,s,bar,onLevel){
  if(!ctx)return function(){};
  try{
    var src=ctx.createMediaStreamSource(s),an=ctx.createAnalyser();an.fftSize=1024;src.connect(an);
    var buf=new Uint8Array(an.fftSize),timer=setInterval(function(){
      if(ctx.state!=="running")return;
      an.getByteTimeDomainData(buf);var peak=0;for(var i=0;i<buf.length;i++){var v=Math.abs(buf[i]-128)/128;if(v>peak)peak=v}
      bar.style.width=Math.min(100,Math.round(peak*220))+"%";onLevel(peak,ctx.state==="running");
    },120);
    return function(){clearInterval(timer);try{src.disconnect()}catch(e){}bar.style.width="0"};
  }catch(e){return function(){}}
}
function warn(k,text){if(text)warns[k]=text;else delete warns[k];warnBox.textContent="";for(var key in warns){var p=document.createElement("p");p.className="notice warn";p.textContent=warns[key];warnBox.appendChild(p)}}
var SOUND=0.02,lastSound=0,stopMeter=function(){},ctxLive=null;
function ext(mime){return /mp4|aac/.test(mime)?"m4a":/ogg/.test(mime)?"ogg":"webm"}
function base(mime){return String(mime||"audio/webm").split(";")[0]}
function pad(n){return("0"+n).slice(-2)}
function clock(ms){var s=Math.floor(ms/1000);return(s>=3600?Math.floor(s/3600)+":":"")+pad(Math.floor(s/60)%60)+":"+pad(s%60)}
function elapsed(){return ran+(rec&&rec.state==="recording"?Date.now()-since:0)}
function pickMime(){var c=["audio/webm;codecs=opus","audio/mp4","audio/webm","audio/ogg;codecs=opus"];for(var i=0;i<c.length;i++){try{if(MediaRecorder.isTypeSupported(c[i]))return c[i]}catch(e){}}return""}
function wake(){if(navigator.wakeLock)navigator.wakeLock.request("screen").then(function(l){lock=l}).catch(function(){})}
function unwake(){if(lock){lock.release().catch(function(){});lock=null}}
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible"&&rec&&rec.state==="recording")wake()});

/* "Tjek mikrofonen": the microphone and the level for six seconds, nothing recorded - before the meeting, not in the middle of it. */
q("[data-rec-check]").addEventListener("click",function(e){
  var btn=e.currentTarget,ctx=null,heard=false;btn.disabled=true;checkOut.textContent="";
  try{ctx=AC?new AC():null;if(ctx&&ctx.resume)ctx.resume()}catch(x){ctx=null}
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){
    var off=meter(ctx,s,checkBar,function(peak){if(peak>SOUND)heard=true});
    setTimeout(function(){
      off();s.getTracks().forEach(function(t){t.stop()});try{if(ctx)ctx.close()}catch(x){}
      checkOut.textContent=heard||!ctx?"Mikrofonen virker - jeg kan høre lyd.":"Jeg hører ingenting. Tjek, at mikrofonen er tilladt for siden og ikke dækket til.";
      checkOut.className="check-result "+(heard||!ctx?"":"warn");btn.disabled=false;
    },6000);
  }).catch(function(err){btn.disabled=false;checkOut.className="check-result warn";checkOut.textContent=err&&err.name==="NotAllowedError"?"Browseren fik ikke lov til at bruge mikrofonen. Tillad mikrofonen for siden, og prøv igen.":"Mikrofonen kunne ikke startes: "+(err&&err.message||err)})
});
q("[data-rec-consent]").addEventListener("change",function(e){q("[data-rec-start]").disabled=!e.target.checked});
q("[data-rec-start]").addEventListener("click",function(){
  say("");warns={};warn();gaps=[];
  try{ctxLive=AC?new AC():null;if(ctxLive&&ctxLive.resume)ctxLive.resume()}catch(e){ctxLive=null}
  navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}).then(function(s){
    stream=s;var mime=pickMime();
    try{rec=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:32000}:{audioBitsPerSecond:32000})}catch(e){rec=new MediaRecorder(stream)}
    mime=rec.mimeType||mime;chunks=[];bytes=0;part=0;ran=0;why="";
    cur={id:String(Date.now()),date:date,meeting:meeting,mime:mime,startedAt:Date.now()};
    rec.ondataavailable=function(e){
      if(!e.data||!e.data.size)return;
      var at=Date.now(),idle=at-lastData;lastData=at;
      if(idle>40000&&rec.state!=="paused"){var missed=Math.round(idle/60000),clockAt=new Date(at-idle);gaps.push(missed);warn("gap"+gaps.length,"Der manglede cirka "+Math.max(1,missed)+" min. af lyden kl. "+pad(clockAt.getHours())+":"+pad(clockAt.getMinutes())+".")}
      warn("stall");
      chunks.push(e.data);bytes+=e.data.size;keepPart(cur.id,part++,e.data);
      if(bytes>=LIMIT&&rec.state!=="inactive"){why="limit";rec.stop()}
    };
    rec.onstop=finished;
    var track=stream.getAudioTracks()[0];
    track.onended=function(){if(rec&&rec.state!=="inactive"){why="cut";rec.stop()}};
    track.onmute=function(){warn("mute","Telefonen har taget mikrofonen (fx et opkald eller en låst skærm). Optagelsen er stille, til den kommer tilbage.")};
    track.onunmute=function(){warn("mute")};
    lastSound=Date.now();lastData=Date.now();
    stopMeter=meter(ctxLive,stream,levelBar,function(peak){
      var now=Date.now();if(peak>SOUND)lastSound=now;
      if(rec&&rec.state==="recording")warn("quiet",now-lastSound>25000?"Jeg hører ingen lyd lige nu. Er mikrofonen dækket til eller slået fra?":"");
    });
    keepMeta(cur.id,{date:date,meeting:meeting,mime:mime,startedAt:cur.startedAt});
    since=Date.now();rec.start(10000);wake();
    window.onbeforeunload=function(e){e.preventDefault();e.returnValue="Optagelsen kører. Vil du forlade siden?";return e.returnValue};
    tick=setInterval(function(){
      timeEl.textContent=clock(elapsed());
      if(rec&&rec.state==="recording"&&Date.now()-lastData>35000){warn("stall","Optagelsen får ikke lyd fra browseren. Siden er måske sat i baggrunden - hold den åben og skærmen tændt.");try{rec.requestData()}catch(e){}}
    },500);timeEl.textContent="00:00";
    stateEl.textContent="Optager";pauseBtn.textContent="Pause";bar.classList.remove("paused");show("live");
  }).catch(function(err){say(err&&err.name==="NotAllowedError"?"Browseren fik ikke lov til at bruge mikrofonen. Tillad mikrofonen for siden, og prøv igen.":"Mikrofonen kunne ikke startes: "+(err&&err.message||err))});
});
pauseBtn.addEventListener("click",function(){
  if(!rec)return;
  if(rec.state==="recording"){ran=elapsed();rec.pause();warn("quiet");warn("stall");stateEl.textContent="På pause";pauseBtn.textContent="Fortsæt";bar.classList.add("paused")}
  else if(rec.state==="paused"){since=Date.now();lastData=Date.now();lastSound=Date.now();rec.resume();stateEl.textContent="Optager";pauseBtn.textContent="Pause";bar.classList.remove("paused")}
});
q("[data-rec-stop]").addEventListener("click",function(){if(rec&&rec.state!=="inactive"){why="user";rec.stop()}});

function finished(){
  clearInterval(tick);unwake();window.onbeforeunload=null;stopMeter();stopMeter=function(){};
  try{if(ctxLive)ctxLive.close()}catch(e){}
  stream.getTracks().forEach(function(t){t.stop()});
  var blob=new Blob(chunks,{type:base(cur.mime)});
  if(why==="cut"){offer(blob,cur,"Mikrofonen blev afbrudt (fx fordi skærmen blev låst). Det, der er optaget indtil da, er gemt her på enheden.");return}
  send(blob,cur,why==="limit"?"Optagelsen nåede loftet på 60 MB og er sendt. Start en ny optagelse til resten af mødet.":"");
}
/* Saved on the device: send it now, download it or delete it. */
function offer(blob,meta,text){
  show("saved");savedText.textContent=text;
  if(download.getAttribute("href"))URL.revokeObjectURL(download.getAttribute("href"));
  download.href=URL.createObjectURL(blob);download.setAttribute("download","moede-"+meta.date+"."+ext(meta.mime));
  q("[data-rec-send]").onclick=function(){send(blob,meta,"")};
  q("[data-rec-discard]").onclick=function(){if(confirm("Slet optagelsen fra enheden?")){drop(meta.id).then(function(){say("");show("idle")})}};
}
function send(blob,meta,after){
  show("sending");progress.value=0;say("");
  var fd=new FormData();
  fd.append("recording",new File([blob],"moede-"+meta.date+"."+ext(meta.mime),{type:base(meta.mime)}));
  if(meta.meeting){fd.append("meeting_id",meta.meeting);fd.append("meeting_choice",meta.date)}else fd.append("meeting_date",meta.date);
  var x=new XMLHttpRequest();x.open("POST",action);
  x.upload.onprogress=function(e){if(e.lengthComputable)progress.value=Math.round(e.loaded/e.total*100)};
  x.onload=function(){
    if(x.status>=200&&x.status<400&&/[?&]upload=1/.test(x.responseURL||"")){drop(meta.id).then(function(){location.href=x.responseURL});return}
    offer(blob,meta,x.status===413?"Optagelsen er for stor til Saga (over 60 MB). Den er gemt her på enheden - hent filen, og gem den i lavere kvalitet.":"Optagelsen kunne ikke sendes. Er du logget ud? Den er gemt her på enheden - prøv igen.");
  };
  x.onerror=function(){offer(blob,meta,"Ingen forbindelse. Optagelsen er gemt her på enheden - prøv igen, når nettet er tilbage.")};
  x.send(fd);
  if(after)say(after);
}

/* A recording left over from before - a closed page, a crash, a failed upload. */
readSessions().then(function(list){
  if(!list.length)return;
  list.sort(function(a,b){return b.startedAt-a.startedAt});var m=list[0];
  readParts(m.id).then(function(parts){
    if(!parts||!parts.length){drop(m.id);return}
    var blob=new Blob(parts,{type:base(m.mime)}),at=new Date(m.startedAt);
    offer(blob,m,"Der ligger en optagelse fra "+at.toLocaleDateString(document.documentElement.lang==="en"?"en-GB":"da-DK",{day:"numeric",month:"short"})+" kl. "+pad(at.getHours())+":"+pad(at.getMinutes())+", som ikke blev sendt.");
  });
});
})()</script>`;

/** The recorder for one meeting: `meetingId` when the meeting is planned in the cockpit (the page then returns to it), else just the day. */
export function recorderCard(base: string, o: { date: string; meetingId?: number | null }): string {
  return `<style>${RECORDER_STYLE}</style><div class="recorder" data-recorder data-action="${esc(base)}/upload" data-date="${esc(o.date)}" data-meeting="${o.meetingId ? String(o.meetingId) : ""}" data-limit="${RECORDER_LIMIT_BYTES}">
<div data-rec="idle"><h3 style="margin:0 0 8px">Optag mødet her</h3>
<label class="check"><input type="checkbox" data-rec-consent> <span>Alle, der deltager, ved, at mødet bliver optaget.</span></label>
<div class="actions" style="margin:10px 0 0"><button type="button" data-rec-start disabled>● Start optagelse</button><button type="button" class="ghost" data-rec-check>Tjek mikrofonen</button></div>
<div class="meter" style="margin-top:10px"><i data-rec-check-level></i></div><p class="small check-result" data-rec-check-result role="status" aria-live="polite"></p>
${infoTip("Optagelsen bruger enhedens mikrofon: læg telefonen eller computeren midt på bordet, og hold siden åben og skærmen tændt, mens I optager. Når I trykker stop, skriver Saga referatet ud fra optagelsen og dagsordenen.", "Lydfilen slettes 14 dage efter, at referatet er lagt op. Referatet og transskriptionen beholdes.")}</div>
<div data-rec="live" hidden><p class="recbar"><span class="dot"></span><strong data-rec-time>00:00</strong><span data-rec-state>Optager</span></p>
<div class="meter"><i data-rec-level></i></div><div class="warns" data-rec-warns role="alert"></div>
<div class="actions"><button type="button" class="ghost" data-rec-pause>Pause</button><button type="button" data-rec-stop>Stop og lav referat</button></div>
<p class="small muted">Hold siden åben og skærmen tændt - lukker du siden eller låser telefonen, stopper optagelsen.</p></div>
<div data-rec="sending" hidden><p style="margin:0 0 6px">Sender optagelsen …</p><progress data-rec-progress max="100" value="0"></progress></div>
<div data-rec="saved" hidden><p class="notice warn" data-rec-saved-text></p>
<div class="actions"><button type="button" data-rec-send>Send nu</button><a class="button ghost" data-rec-download download>Hent filen</a><button type="button" class="ghost" data-rec-discard>Slet</button></div></div>
<p class="small" data-rec-msg role="status" aria-live="polite"></p></div>${SCRIPT}`;
}
