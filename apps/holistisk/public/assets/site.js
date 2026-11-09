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
})();
