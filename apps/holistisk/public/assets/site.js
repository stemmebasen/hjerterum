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
})();
