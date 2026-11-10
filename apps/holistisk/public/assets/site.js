// Flokken: small progressive enhancements. Every page works without this file.
(function () {
  "use strict";

  // Filters: submit when a choice changes (the form also has a normal submit button).
  document.querySelectorAll("form[data-autosubmit]").forEach(function (form) {
    form.addEventListener("change", function (event) {
      var target = event.target;
      if (!target || target.type === "search" || target.type === "date") return;
      if (target.name === "periode" && target.value) {
        form.querySelectorAll('input[type="date"]').forEach(function (input) { input.value = ""; });
      }
      if (target.name === "omraade") {
        var city = form.querySelector('select[name="by"]');
        if (city) city.value = "";
      }
      if (typeof form.requestSubmit === "function") form.requestSubmit(); else form.submit();
    });
    // A date typed in replaces a quick period.
    form.querySelectorAll('input[type="date"]').forEach(function (input) {
      input.addEventListener("change", function () {
        var all = form.querySelector('input[name="periode"][value=""]');
        if (all) all.checked = true;
      });
    });
    // Empty fields are left out of the address.
    form.addEventListener("submit", function () {
      Array.prototype.forEach.call(form.elements, function (el) {
        if (el.name && !el.value && (el.tagName === "SELECT" || el.type === "search" || el.type === "date" || el.type === "radio")) el.disabled = true;
      });
    });
  });

  // On a phone the filter panel starts folded; the active filters show as chips above the results.
  if (window.matchMedia("(max-width: 860px)").matches) {
    document.querySelectorAll("details[data-collapse-mobile]").forEach(function (d) { d.removeAttribute("open"); });
  }

  // "Use my location": the nearest area, computed in the browser. The position is never sent anywhere.
  var near = document.querySelector("[data-near-me]");
  if (near && "geolocation" in navigator) {
    near.hidden = false;
    var status = document.querySelector("[data-near-status]");
    near.addEventListener("click", function () {
      var areas = JSON.parse(near.getAttribute("data-areas") || "[]");
      if (status) status.textContent = "Finder din placering …";
      navigator.geolocation.getCurrentPosition(function (pos) {
        var best = null, bestKm = Infinity;
        areas.forEach(function (a) {
          var rad = Math.PI / 180, dLat = (a.lat - pos.coords.latitude) * rad, dLon = (a.lon - pos.coords.longitude) * rad;
          var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(pos.coords.latitude * rad) * Math.cos(a.lat * rad) * Math.pow(Math.sin(dLon / 2), 2);
          var km = 12742 * Math.asin(Math.sqrt(h));
          if (km < bestKm) { bestKm = km; best = a; }
        });
        if (best && bestKm < 80) location.href = (document.documentElement.getAttribute("data-base") || "/") + best.slug;
        else if (status) status.textContent = "Vi dækker ikke dit område endnu – se alle områder ovenfor.";
      }, function () {
        if (status) status.textContent = "Vi kunne ikke finde din placering. Vælg et område ovenfor.";
      }, { maximumAge: 600000, timeout: 10000 });
    });
  }

  // Flokk's example carousel: arrow buttons that scroll it a card at a time (it also scrolls by swipe and keys).
  document.querySelectorAll("[data-carousel]").forEach(function (list) {
    var nav = list.parentNode.querySelector("[data-carousel-nav]");
    if (!nav) return;
    nav.hidden = false;
    nav.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
        var card = list.querySelector("li");
        var step = card ? card.getBoundingClientRect().width + 20 : list.clientWidth * 0.8;
        list.scrollBy({ left: step * Number(button.getAttribute("data-dir")), behavior: "smooth" });
      });
    });
  });
  // The flock's chat: send without reloading, and ask for new messages now and then while the page is open and visible
  // (every 15 seconds, slowing to once a minute when it is quiet). The forms work on their own without this.
  var chatList = document.querySelector("[data-chat]");
  var chatForm = document.querySelector("[data-chat-form]");
  if (chatList) {
    var endpoint = chatForm ? chatForm.getAttribute("action") : null;
    var empty = document.querySelector("[data-chat-empty]");
    var errorBox = chatForm ? chatForm.querySelector("[data-chat-error]") : null;
    var last = 0, delay = 15000, timer = null, stopped = !endpoint;
    var asJson = { accept: "application/json" };
    chatList.querySelectorAll("[data-at]").forEach(function (li) { last = Math.max(last, Number(li.getAttribute("data-at"))); });
    var toBottom = function () { chatList.scrollTop = chatList.scrollHeight; };
    var showError = function (text) { if (errorBox) { errorBox.textContent = text || ""; errorBox.hidden = !text; } };
    var confirmReport = function (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!window.confirm("Vil du melde beskeden? Den bliver skjult for dig, og vi kigger på den.")) return;
        fetch(form.getAttribute("action"), { method: "POST", headers: asJson, credentials: "same-origin" })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var li = form.closest("li");
            if (li) { li.textContent = ""; var p = document.createElement("p"); p.className = "chat-meta meta-muted"; p.textContent = data.text || "Meldt."; li.appendChild(p); }
          })
          .catch(function () { form.submit(); });
      });
    };
    chatList.querySelectorAll("[data-chat-report]").forEach(confirmReport);
    var add = function (m) {
      if (chatList.querySelector('[data-id="' + m.id + '"]')) return false;
      var li = document.createElement("li");
      li.className = "chat-msg" + (m.mine ? " is-mine" : "");
      li.setAttribute("data-id", m.id);
      li.setAttribute("data-at", String(m.at));
      var meta = document.createElement("p"); meta.className = "chat-meta";
      var name = document.createElement("strong"); name.textContent = m.name; meta.appendChild(name);
      if (m.mine) { var you = document.createElement("span"); you.className = "meta-muted"; you.textContent = " (dig)"; meta.appendChild(you); }
      var time = document.createElement("time"); time.textContent = m.time; time.setAttribute("datetime", new Date(m.at).toISOString());
      meta.appendChild(document.createTextNode(" ")); meta.appendChild(time);
      var body = document.createElement("p"); body.className = "chat-body"; body.textContent = m.body;
      li.appendChild(meta); li.appendChild(body);
      if (!m.mine && endpoint) {
        var form = document.createElement("form");
        form.method = "post"; form.className = "chat-report"; form.setAttribute("action", endpoint + "/" + m.id + "/meld");
        var button = document.createElement("button"); button.type = "submit"; button.className = "button-link"; button.textContent = "Meld besked";
        form.appendChild(button); li.appendChild(form); confirmReport(form);
      }
      chatList.appendChild(li);
      last = Math.max(last, m.at);
      if (empty) empty.hidden = true;
      return true;
    };
    var schedule = function () {
      clearTimeout(timer);
      if (!stopped && !document.hidden) timer = setTimeout(poll, delay);
    };
    var closeChat = function () {
      stopped = true; clearTimeout(timer);
      if (chatForm) {
        var note = document.createElement("p"); note.className = "notice"; note.textContent = "Chatten er lukket. Den lukker en uge efter eventet.";
        chatForm.replaceWith(note); chatForm = null;
      }
    };
    var poll = function () {
      if (stopped) return;
      fetch(endpoint + "?efter=" + last, { headers: asJson, credentials: "same-origin" })
        .then(function (r) { if (r.status === 401 || r.status === 403) { stopped = true; } return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) { delay = 60000; return; }
          var fresh = false;
          (data.messages || []).forEach(function (m) { if (add(m)) fresh = true; });
          if (fresh) { toBottom(); delay = 15000; } else delay = Math.min(Math.round(delay * 1.5), 60000);
          if (data.open === false) closeChat();
        })
        .catch(function () { delay = 60000; })
        .then(schedule);
    };
    if (chatForm) {
      var text = chatForm.querySelector("textarea");
      text.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); chatForm.requestSubmit ? chatForm.requestSubmit() : chatForm.dispatchEvent(new Event("submit", { cancelable: true })); }
      });
      chatForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!text.value.trim()) return;
        var button = chatForm.querySelector("button");
        button.disabled = true;
        fetch(endpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, credentials: "same-origin", body: new URLSearchParams({ tekst: text.value }) })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.message) { add(data.message); toBottom(); text.value = ""; showError(""); delay = 15000; schedule(); }
            else { showError(data.text); if (data.error === "chat_closed") closeChat(); }
          })
          .catch(function () { showError("Beskeden blev ikke sendt. Prøv igen."); })
          .then(function () { button.disabled = false; text.focus(); });
      });
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) clearTimeout(timer); else if (!stopped) { delay = 15000; poll(); }
    });
    toBottom();
    schedule();
  }
  // The profile photo: made small (at most 600 px, JPEG) in the browser before it is sent, so a phone photo of several
  // MB fits. Without this, or in a browser that cannot, the photo is sent as it is and the server says if it is too big.
  var photoInput = document.querySelector("[data-photo-input]");
  if (photoInput && window.DataTransfer && window.URL && document.createElement("canvas").toBlob) {
    photoInput.addEventListener("change", function () {
      var file = photoInput.files && photoInput.files[0];
      if (!file || !/^image\//.test(file.type) || photoInput.getAttribute("data-shrunk") === file.name) return;
      var img = new Image();
      var src = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(src);
        canvas.toBlob(function (blob) {
          if (!blob) return;
          var name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          var transfer = new DataTransfer();
          transfer.items.add(new File([blob], name, { type: "image/jpeg" }));
          photoInput.setAttribute("data-shrunk", name);
          photoInput.files = transfer.files;
        }, "image/jpeg", 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(src); };
      img.src = src;
    });
  }
  // "Lad os komme godt i gang": on the first visit to the event portal, a pop-up to flick through the coming events and
  // mark those you would like to go to with others. At the end the choices are sent to /kom-godt-i-gang, which puts you
  // in a flock for each (after becoming a member, if needed). It is shown once per browser and closes with the cross,
  // "Ikke nu", Escape or a click outside. The page /kom-godt-i-gang does the same without JavaScript.
  (function kickoff() {
    var root = document.documentElement;
    var base = root.getAttribute("data-base") || "/";
    var KEY = "kom-godt-i-gang-vist";
    if (root.getAttribute("data-edition") !== "portal" || document.body.classList.contains("is-bare")) return;
    if (typeof HTMLDialogElement !== "function" || !window.fetch) return;
    var here = location.pathname.slice(base.length - 1) || "/";
    var force = /[?&]velkommen\b/.test(location.search);
    if (!force && /^\/(log-ind|log-ud|bliv-medlem|profil|flokke|kom-godt-i-gang|tryghed|samarbejde)(\/|$)|\/opret-flok$/.test(here)) return;
    try { if (!force && localStorage.getItem(KEY)) return; } catch (e) { return; }

    var el = function (tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    fetch(base + "api/kom-godt-i-gang", { headers: { accept: "application/json" }, credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.events || !data.events.length || (data.inFlock && !force)) return;
        setTimeout(function () { open(data); }, force ? 0 : 900);
      })
      .catch(function () {});

    function open(data) {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      var events = data.events, index = 0, chosen = [];
      var dialog = el("dialog", "kickoff");
      dialog.setAttribute("aria-labelledby", "kickoff-h");
      var close = el("button", "kickoff-close");
      close.type = "button"; close.setAttribute("aria-label", "Luk"); close.textContent = "×";
      var head = el("div", "kickoff-head");
      var h = el("h2", null, "Lad os komme godt i gang"); h.id = "kickoff-h";
      var lead = el("p", "kickoff-lead", "Bladr gennem de næste events, og sig ja til dem, du gerne vil følges med andre til. Så finder vi en flok til dig – eller starter en, som andre kan hoppe med i.");
      head.appendChild(h); head.appendChild(lead);
      var stage = el("div", "kickoff-stage");
      stage.setAttribute("aria-live", "polite");
      dialog.appendChild(close); dialog.appendChild(head); dialog.appendChild(stage);
      document.body.appendChild(dialog);

      var shut = function () { dialog.close(); };
      close.addEventListener("click", shut);
      dialog.addEventListener("click", function (event) { if (event.target === dialog) shut(); });
      dialog.addEventListener("close", function () { dialog.remove(); });

      var card = function () {
        var e = events[index];
        stage.textContent = "";
        var count = el("p", "kickoff-count", (index + 1) + " af " + events.length + (chosen.length ? " · " + chosen.length + " valgt" : ""));
        var box = el("article", "kickoff-card");
        if (e.image) {
          var img = el("img", "kickoff-img"); img.src = e.image; img.alt = ""; img.loading = "lazy";
          img.addEventListener("error", function () { img.remove(); });
          box.appendChild(img);
        }
        var text = el("div", "kickoff-body");
        text.appendChild(el("p", "kickoff-when", e.when));
        text.appendChild(el("h3", "kickoff-title", e.title));
        var place = [e.place, e.price].filter(Boolean).join(" · ");
        if (place) text.appendChild(el("p", "kickoff-place", place));
        text.appendChild(el("p", "kickoff-flock" + (e.flock ? " has-flock" : ""), e.flockLine));
        var more = el("a", "kickoff-more", "Læs om eventet");
        more.href = base + e.url.replace(/^\//, ""); more.target = "_blank"; more.rel = "noopener";
        text.appendChild(more);
        box.appendChild(text);
        var actions = el("div", "kickoff-actions");
        var skip = el("button", "button-secondary", "Spring over"); skip.type = "button";
        var yes = el("button", null, "Interesseret"); yes.type = "button";
        skip.addEventListener("click", function () { next(false); });
        yes.addEventListener("click", function () { next(true); });
        actions.appendChild(skip); actions.appendChild(yes);
        stage.appendChild(count); stage.appendChild(box); stage.appendChild(actions);
        var foot = el("p", "kickoff-foot");
        var later = el("button", "button-link", chosen.length ? "Jeg er færdig" : "Ikke nu"); later.type = "button";
        later.addEventListener("click", function () { if (chosen.length) summary(); else shut(); });
        foot.appendChild(later);
        stage.appendChild(foot);
        yes.focus();
      };
      var next = function (interested) {
        var current = events[index];
        chosen = chosen.filter(function (c) { return c.slug !== current.slug; });
        if (interested) chosen.push(current);
        index++;
        if (index < events.length) card(); else summary();
      };
      var summary = function () {
        stage.textContent = "";
        if (!chosen.length) {
          stage.appendChild(el("p", "kickoff-done", "Du valgte ingen denne gang. Det er helt fint – du kan altid finde en flok på et events side."));
          var ok = el("button", null, "Luk"); ok.type = "button"; ok.addEventListener("click", shut);
          var again = el("button", "button-secondary", "Se dem igen"); again.type = "button";
          again.addEventListener("click", function () { index = 0; card(); });
          var row = el("div", "kickoff-actions"); row.appendChild(again); row.appendChild(ok);
          stage.appendChild(row); ok.focus();
          return;
        }
        stage.appendChild(el("p", "kickoff-done", chosen.length === 1 ? "Du vil gerne med til:" : "Du vil gerne med til de her " + chosen.length + ":"));
        var list = el("ul", "kickoff-chosen");
        chosen.forEach(function (e) {
          var li = el("li"); li.appendChild(el("strong", null, e.title)); li.appendChild(el("span", null, e.when));
          list.appendChild(li);
        });
        stage.appendChild(list);
        stage.appendChild(el("p", "kickoff-note", "Er der allerede en flok, kommer du med i den. Ellers starter vi en, der mødes ved indgangen et kvarter før – så kan andre hoppe med. Du kan altid forlade en flok igen."));
        if (!data.member || !data.ready) stage.appendChild(el("p", "kickoff-note", "Næste skridt: dit fornavn, din aldersgruppe og en linje om dig selv, så de andre ved, hvem de skal møde. Ingen e-mail eller telefonnummer."));
        var form = el("form", "kickoff-actions");
        form.method = "post"; form.action = base + "kom-godt-i-gang";
        chosen.forEach(function (e) { var input = el("input"); input.type = "hidden"; input.name = "event"; input.value = e.slug; form.appendChild(input); });
        var back = el("button", "button-secondary", "Tilbage"); back.type = "button";
        back.addEventListener("click", function () { index = Math.min(index, events.length - 1); card(); });
        var go = el("button", null, "Find mine flokke"); go.type = "submit";
        form.appendChild(back); form.appendChild(go);
        stage.appendChild(form);
        go.focus();
      };
      dialog.showModal();
      card();
    }
  })();
})();
