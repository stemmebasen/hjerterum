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
  // "Lad os komme godt i gang": the interest list. On the first visit to the event portal, a pop-up with the coming
  // events, ten at a time, to tick the ones you would like to go to with others; the ticks are sent to /kom-godt-i-gang
  // (after becoming a member, if needed). Shown once per browser, not to people already in a flock or on the list, and
  // it closes with the cross, "Ikke nu", Escape or a click outside. ?velkommen shows it again. The page
  // /kom-godt-i-gang is the same list; with this file it too shows ten at a time.
  var STEP = 10;
  var pageInList = function (list, more) {
    var shown = STEP, only = null;
    var render = function () {
      var all = Array.prototype.slice.call(list.querySelectorAll("li"));
      var fits = all.filter(function (li) { return !only || (" " + (li.getAttribute("data-groups") || "") + " ").indexOf(" " + only + " ") >= 0; });
      all.forEach(function (li) {
        var i = fits.indexOf(li);
        li.hidden = i < 0 || (i >= shown && !li.querySelector("input:checked"));
      });
      var rest = fits.length - shown;
      more.hidden = rest <= 0;
      more.textContent = "Vis " + Math.min(STEP, Math.max(rest, 0)) + " mere";
    };
    more.addEventListener("click", function () { shown += STEP; render(); });
    render();
    return { only: function (group) { only = group; shown = STEP; render(); } };
  };
  var pageList = document.querySelector("[data-kickoff-list]");
  if (pageList) {
    var listEl = pageList.querySelector(".kickoff-list");
    var moreBtn = document.createElement("button");
    moreBtn.type = "button"; moreBtn.className = "button-secondary kickoff-showmore";
    listEl.parentNode.insertBefore(moreBtn, listEl.nextSibling);
    pageInList(listEl, moreBtn);
  }

  (function kickoff() {
    var root = document.documentElement;
    var base = root.getAttribute("data-base") || "/";
    var KEY = "kom-godt-i-gang-vist";
    if (root.getAttribute("data-edition") !== "portal" || document.body.classList.contains("is-bare")) return;
    if (typeof HTMLDialogElement !== "function" || !window.fetch) return;
    var here = location.pathname.slice(base.length - 1) || "/";
    var force = /[?&]velkommen\b/.test(location.search);
    if (!force && /^\/(log-ind|log-ud|bliv-medlem|profil|flokke|kom-godt-i-gang|interesser|tryghed|samarbejde)(\/|$)|\/opret-flok$/.test(here)) return;
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
        if (!data || !data.events || !data.events.length) return;
        if (!force && (data.inFlock || data.onList)) return;
        setTimeout(function () { open(data); }, force ? 0 : 900);
      })
      .catch(function () {});

    // A picture, a few lines and a link to the event's own page (opens in a new tab, so the list stays).
    function fill(box, e) {
      if (e.image) {
        var img = el("img", "kickoff-img"); img.src = e.image; img.alt = ""; img.loading = "lazy";
        img.addEventListener("error", function () { img.remove(); });
        box.appendChild(img);
      }
      if (e.blurb) box.appendChild(el("p", "kickoff-blurb", e.blurb));
      var link = el("a", "kickoff-more", "Åbn eventet");
      link.href = base + e.url.replace(/^\//, ""); link.target = "_blank"; link.rel = "noopener";
      box.appendChild(link);
    }

    function open(data) {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      var dialog = el("dialog", "kickoff");
      dialog.setAttribute("aria-labelledby", "kickoff-h");
      var close = el("button", "kickoff-close");
      close.type = "button"; close.setAttribute("aria-label", "Luk"); close.textContent = "×";
      var head = el("div", "kickoff-head");
      var h = el("h2", null, "Lad os komme godt i gang"); h.id = "kickoff-h";
      head.appendChild(h);
      var lead = el("p", "kickoff-lead");
      lead.appendChild(document.createTextNode("Sæt kryds ved de oplevelser, du kunne tænke dig. "));
      lead.appendChild(el("strong", null, "Det er helt uforpligtende"));
      lead.appendChild(document.createTextNode(" – du viser bare interesse. Når vi er en håndfuld (3–6), der vil det samme, samler vi en flok og spørger dig, om du vil med. Dine første 3 udflugter er gratis."));
      head.appendChild(lead);
      var form = el("form", "kickoff-form");
      form.method = "post"; form.action = base + "kom-godt-i-gang";
      var list = el("ul", "kickoff-list");
      data.events.forEach(function (e) {
        var li = el("li", "kickoff-item");
        li.setAttribute("data-groups", (e.groups || []).join(" "));
        var label = el("label");
        var box = el("input"); box.type = "checkbox"; box.name = "event"; box.value = e.slug; box.checked = !!e.mine;
        var text = el("span", "kickoff-text");
        text.appendChild(el("span", "kickoff-when", e.when));
        text.appendChild(el("strong", "kickoff-title", e.title));
        if (e.place) text.appendChild(el("span", "kickoff-place", e.place));
        text.appendChild(el("span", "kickoff-count" + (e.interested ? " has-people" : ""), e.line));
        label.appendChild(box); label.appendChild(text); li.appendChild(label);
        var shown = el("input"); shown.type = "hidden"; shown.name = "vist"; shown.value = e.slug; li.appendChild(shown);
        // "Se mere": the event unfolds in the row (on a wide screen with a mouse, the panel beside the list shows it).
        var toggle = el("button", "button-link kickoff-toggle", "Se mere om eventet"); toggle.type = "button";
        toggle.setAttribute("aria-expanded", "false");
        var unfold = el("div", "kickoff-unfold"); unfold.hidden = true;
        toggle.addEventListener("click", function () {
          if (!unfold.firstChild) fill(unfold, e);
          unfold.hidden = !unfold.hidden;
          toggle.setAttribute("aria-expanded", unfold.hidden ? "false" : "true");
          toggle.textContent = unfold.hidden ? "Se mere om eventet" : "Skjul";
        });
        li.appendChild(toggle); li.appendChild(unfold);
        li.addEventListener("mouseenter", function () { show(e); });
        li.addEventListener("focusin", function () { show(e); });
        list.appendChild(li);
      });
      var more = el("button", "button-secondary kickoff-showmore"); more.type = "button";
      // The panel beside the list on a wide screen: the event the pointer is over.
      var preview = el("aside", "kickoff-preview");
      preview.setAttribute("aria-label", "Om eventet");
      var shownSlug = null;
      function show(e) {
        if (shownSlug === e.slug) return;
        shownSlug = e.slug; preview.textContent = "";
        preview.appendChild(el("p", "kickoff-when", e.when));
        preview.appendChild(el("h3", "kickoff-title", e.title));
        if (e.place) preview.appendChild(el("p", "kickoff-place", e.place));
        fill(preview, e);
      }
      var bar = el("div", "kickoff-bar");
      var later = el("button", "button-link", "Ikke nu"); later.type = "button";
      var save = el("button", null, "Vis interesse"); save.type = "submit";
      bar.appendChild(later); bar.appendChild(save);
      var note = el("p", "kickoff-note", data.member && data.ready ? "Du kan altid rette din liste under Mine flokke."
        : "Bagefter fortæller du kort om dig selv og giver os din e-mail, så vi kan give besked. Ingen andre ser den.");
      // The four main kinds, to see only one of them.
      var GROUPS = [["", "Alle"], ["underholdning", "Underholdning"], ["krea", "Krea"], ["oplysning", "Oplysning"], ["fordybelse", "Fordybelse"]];
      var seg = el("div", "kickoff-groups");
      seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Vis kun");
      var segButtons = GROUPS.filter(function (g) { return !g[0] || data.events.some(function (e) { return (e.groups || []).indexOf(g[0]) >= 0; }); }).map(function (g) {
        var b = el("button", "kickoff-group" + (g[0] ? " group-" + g[0] : ""), g[1]); b.type = "button";
        b.setAttribute("aria-pressed", g[0] ? "false" : "true");
        b.addEventListener("click", function () {
          segButtons.forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          pager.only(g[0] || null);
        });
        seg.appendChild(b);
        return b;
      });
      var cols = el("div", "kickoff-cols");
      var left = el("div", "kickoff-left");
      left.appendChild(list); left.appendChild(more);
      cols.appendChild(left); cols.appendChild(preview);
      var promise = el("p", "kickoff-promise", "Du binder dig ikke til noget. Du siger først ja, når flokken er samlet.");
      form.appendChild(seg); form.appendChild(cols); form.appendChild(promise); form.appendChild(note); form.appendChild(bar);
      if (data.events[0]) show(data.events[0]);
      dialog.appendChild(close); dialog.appendChild(head); dialog.appendChild(form);
      document.body.appendChild(dialog);

      var count = function () {
        var n = list.querySelectorAll("input:checked").length;
        save.textContent = n ? "Vis interesse (" + n + ")" : "Vis interesse";
        save.disabled = n === 0 && !data.events.some(function (e) { return e.mine; });
      };
      list.addEventListener("change", count);
      form.addEventListener("submit", function () { save.disabled = true; });
      var shut = function () { dialog.close(); };
      close.addEventListener("click", shut);
      later.addEventListener("click", shut);
      dialog.addEventListener("click", function (event) { if (event.target === dialog) shut(); });
      dialog.addEventListener("close", function () { dialog.remove(); });
      dialog.showModal();
      var pager = pageInList(list, more);
      count();
      dialog.scrollTop = 0;
    }
  })();
})();
