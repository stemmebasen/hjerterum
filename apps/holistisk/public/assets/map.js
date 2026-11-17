// Flokken: the map (/kort). Draws the page's events (the JSON in #kort-data) as pins with Leaflet, and runs the panel:
// the area in view, a bar per day, all / with a flock / free, the activities, and the events at a place. Each pin has a
// small label (time and title) where there is room for one.
// The visitor's position (the arrow button) stays in the browser.
(function () {
  "use strict";
  var el = document.querySelector("[data-map]");
  var source = document.getElementById("kort-data");
  if (!el || !source || !window.L) return;
  var L = window.L;
  var data = JSON.parse(source.textContent);
  var base = (document.documentElement.getAttribute("data-base") || "/").replace(/\/$/, "");
  var $ = function (sel) { return document.querySelector(sel); };

  var params = new URLSearchParams(location.search);
  var state = {
    kind: ["alle", "flokke", "gratis"].indexOf(params.get("vis")) >= 0 ? params.get("vis") : "alle",
    day: params.get("dag"),
    cat: params.get("aktivitet"),
    place: null
  };
  var dayKnown = data.days.some(function (d) { return d.d === state.day; });
  if (!dayKnown && params.get("dag") !== "alle") {
    // Today, or the first day with something on.
    var first = data.days.filter(function (d) { return data.events.some(function (e) { return e.d === d.d; }); })[0];
    state.day = first ? first.d : data.days[0].d;
  }
  if (params.get("dag") === "alle") state.day = null;

  // The map fills the screen below the header.
  var page = $("[data-map-page]");
  var sheet = $("[data-sheet]");
  function fit() { page.style.setProperty("--map-top", Math.max(0, page.getBoundingClientRect().top + window.scrollY) + "px"); }
  fit();

  var map = L.map(el, { zoomControl: false, attributionControl: false, minZoom: 8 }).setView([data.centre.lat, data.centre.lon], 14);
  L.control.zoom({ position: "topright", zoomInTitle: "Zoom ind", zoomOutTitle: "Zoom ud" }).addTo(map);
  // At the top, so the panel at the bottom never covers it.
  L.control.attribution({ position: "topleft", prefix: false }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, referrerPolicy: "strict-origin-when-cross-origin",
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragydere'
  }).addTo(map);
  window.addEventListener("resize", function () { fit(); map.invalidateSize(); });

  function matches(e, ignoreDay) {
    if (state.kind === "flokke" && !e.n) return false;
    if (state.kind === "gratis" && !e.g) return false;
    if (state.cat && e.c !== state.cat) return false;
    return ignoreDay || !state.day || e.d === state.day;
  }
  function inView(e) { return map.getBounds().contains([e.y, e.x]); }

  // Pins: events at the same place are one pin; pins closer than a thumb on screen are drawn as one, with a number.
  var layer = L.layerGroup().addTo(map);
  var ICONS = {
    event: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8.5" cy="14.5" r="1.3" fill="currentColor"/><circle cx="12" cy="14.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="14.5" r="1.3" fill="currentColor"/></svg>',
    flock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.5" cy="8" r="3.2" fill="currentColor"/><circle cx="16" cy="8.6" r="2.7" fill="currentColor"/><path d="M2.5 19.5c0-3.8 2.7-6 6-6s6 2.2 6 6z" fill="currentColor"/><path d="M13.6 14.2c.7-.4 1.5-.6 2.4-.6 2.9 0 5.5 2 5.5 5.9h-5.4" fill="currentColor"/></svg>'
  };
  function places(list) {
    var byKey = {};
    var out = [];
    list.forEach(function (e) {
      var key = e.y.toFixed(5) + "," + e.x.toFixed(5);
      if (!byKey[key]) { byKey[key] = { y: e.y, x: e.x, name: e.v, events: [] }; out.push(byKey[key]); }
      byKey[key].events.push(e);
    });
    return out;
  }
  // Labels: beside each pin a small card with what is on there, so the map reads at a glance. A label goes to the right
  // of its pin, else left, above or below, and only where it covers no pin, no other label, no button and not the panel.
  var MAX_LABELS = 12;
  function shortDay(d) {
    var day = data.days.filter(function (x) { return x.d === d; })[0];
    if (!day) return d;
    return /^I /.test(day.label) ? day.label : day.label.slice(0, 3) + " " + day.num + ".";
  }
  function when(e) {
    var parts = [];
    if (!state.day) parts.push(shortDay(e.d));
    if (e.h) parts.push(e.h);
    return parts.join(" ");
  }
  function span(cls, text) { var s = document.createElement("span"); s.className = cls; s.textContent = text; return s; }
  function makeLabel(c, events) {
    var one = events.length === 1;
    var label = document.createElement(one ? "a" : "span");
    label.className = "pin-label" + (one ? " pin-label-one" : "");
    if (one) {
      var e = events[0];
      label.href = base + e.p;
      if (e.i) {
        var media = document.createElement("span");
        media.className = "pin-label-img";
        var blur = document.createElement("img"); blur.className = "pin-label-blur"; blur.src = e.i; blur.alt = ""; blur.decoding = "async";
        var img = document.createElement("img"); img.src = e.i; img.alt = ""; img.decoding = "async";
        media.appendChild(blur); media.appendChild(img);
        label.appendChild(media);
      }
      var text = span("pin-label-text", "");
      var top = span("pin-label-when", when(e));
      if (e.v) { top.appendChild(span("pin-label-place", (top.textContent ? " · " : "") + e.v)); }
      text.appendChild(top);
      text.appendChild(span("pin-label-title", e.t));
      label.appendChild(text);
      // Straight to the event: the pin itself still opens the place in the panel.
      L.DomEvent.on(label, "click", L.DomEvent.stopPropagation);
    } else {
      var head = c.places.length > 1 ? c.places.length + " steder" : (c.places[0].name || "");
      if (head) label.appendChild(span("pin-label-head", head));
      events.slice(0, 2).forEach(function (e) {
        var row = span("pin-label-row", "");
        var w = when(e);
        if (w) row.appendChild(span("pin-label-when", w));
        row.appendChild(span("pin-label-title", e.t));
        label.appendChild(row);
      });
      if (events.length > 2) label.appendChild(span("pin-label-more", "+ " + (events.length - 2) + " mere"));
    }
    return label;
  }
  // Rectangles in the map's own pixels that a label must keep clear of: the panel and the map's buttons.
  function blockers() {
    var box = el.getBoundingClientRect();
    var out = [];
    [sheet, document.querySelector(".leaflet-control-zoom"), document.querySelector("[data-locate]"), document.querySelector(".leaflet-control-attribution")].forEach(function (n) {
      if (!n || n.hidden || !n.offsetWidth) return;
      var r = n.getBoundingClientRect();
      out.push({ l: r.left - box.left - 6, t: r.top - box.top - 6, r: r.right - box.left + 6, b: r.bottom - box.top + 6 });
    });
    return out;
  }
  function hits(a, b) { return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b; }
  var measure = document.createElement("div");
  measure.className = "pin-measure";
  el.appendChild(measure);

  function draw() {
    layer.clearLayers();
    var shown = places(data.events.filter(function (e) { return matches(e, false); }));
    shown.sort(function (a, b) { return b.events.length - a.events.length; });
    var clusters = [];
    shown.forEach(function (p) {
      var pt = map.latLngToLayerPoint([p.y, p.x]);
      var near = null;
      for (var i = 0; i < clusters.length; i++) if (clusters[i].pt.distanceTo(pt) < 46) { near = clusters[i]; break; }
      if (near) near.places.push(p); else clusters.push({ pt: pt, places: [p] });
    });
    var size = map.getSize();
    var taken = blockers();
    var built = clusters.map(function (c) {
      var events = [].concat.apply([], c.places.map(function (p) { return p.events; }))
        .sort(function (a, b) { return (a.d + a.h).localeCompare(b.d + b.h); });
      var flocks = events.reduce(function (n, e) { return n + e.n; }, 0);
      var lead = c.places[0];
      var label = c.places.length > 1 ? c.places.length + " steder, " + events.length + " arrangementer" : (lead.name || "Sted") + ", " + events.length + (events.length === 1 ? " arrangement" : " arrangementer");
      var wrap = document.createElement("span");
      var pin = document.createElement("span");
      pin.className = "pin " + (flocks ? "pin-flock" : "pin-event");
      pin.innerHTML = (flocks ? ICONS.flock : ICONS.event) + (events.length > 1 ? "<b>" + events.length + "</b>" : "");
      wrap.appendChild(pin);
      var at = map.latLngToContainerPoint([lead.y, lead.x]);
      var b = { c: c, events: events, flocks: flocks, lead: lead, title: label, wrap: wrap, pin: pin, at: at, inside: at.x >= 0 && at.y >= 0 && at.x <= size.x && at.y <= size.y };
      // The pin's own rectangle (it stands on its point: 42 px tall, plus the 8 px tail).
      measure.appendChild(pin);
      var pw = pin.offsetWidth || 42;
      wrap.appendChild(pin);
      b.pw = pw;
      b.box = { l: at.x - pw / 2 - 2, t: at.y - 54, r: at.x + pw / 2 + 2, b: at.y + 2 };
      return b;
    });
    built.forEach(function (b) { if (b.inside) taken.push(b.box); });
    // The earliest first, so the soonest things get their label when space is short.
    var order = built.filter(function (b) { return b.inside; })
      .sort(function (a, b) { return (a.events[0].d + a.events[0].h).localeCompare(b.events[0].d + b.events[0].h); });
    var placed = 0;
    order.forEach(function (b) {
      if (placed >= MAX_LABELS) return;
      var tag = makeLabel(b.c, b.events);
      measure.appendChild(tag);
      var w = Math.ceil(tag.getBoundingClientRect().width), h = tag.offsetHeight;
      var x = b.at.x, y = b.at.y, head = y - 29, gap = 6;
      var spots = [
        { l: x + b.pw / 2 + gap, t: head - h / 2, side: "right" },
        { l: x - b.pw / 2 - gap - w, t: head - h / 2, side: "left" },
        { l: x - w / 2, t: y - 54 - gap - h, side: "above" },
        { l: x - w / 2, t: y + gap, side: "below" },
        { l: x + b.pw / 2 + gap, t: head - h + 12, side: "right" },
        { l: x + b.pw / 2 + gap, t: head - 12, side: "right" },
        { l: x - b.pw / 2 - gap - w, t: head - h + 12, side: "left" },
        { l: x - b.pw / 2 - gap - w, t: head - 12, side: "left" }
      ];
      var spot = null;
      for (var i = 0; i < spots.length && !spot; i++) {
        var s = spots[i];
        var r = { l: s.l, t: s.t, r: s.l + w, b: s.t + h };
        if (r.l < 8 || r.t < 8 || r.r > size.x - 8 || r.b > size.y - 8) continue;
        if (taken.some(function (o) { return o !== b.box && hits(r, o); })) continue;
        spot = s; taken.push(r);
      }
      if (!spot) { measure.removeChild(tag); return; }
      tag.classList.add("pin-label-" + spot.side);
      // Its measured size, fixed: placed left of its pin it would otherwise wrap differently.
      tag.style.width = w + "px";
      tag.style.left = Math.round(spot.l - x) + "px";
      tag.style.top = Math.round(spot.t - y) + "px";
      b.wrap.appendChild(tag);
      b.labelled = true;
      placed++;
    });
    measure.textContent = "";
    built.forEach(function (b) {
      var c = b.c;
      var icon = L.divIcon({ className: "pin-wrap" + (b.labelled ? " has-label" : ""), html: b.wrap, iconSize: null, iconAnchor: [0, 0] });
      var marker = L.marker([b.lead.y, b.lead.x], { icon: icon, title: b.title, alt: b.title, keyboard: true, riseOnHover: true, zIndexOffset: b.labelled ? 0 : -100 });
      marker.on("click", function () {
        if (c.places.length > 1 && map.getZoom() < 17) {
          map.fitBounds(L.latLngBounds(c.places.map(function (p) { return [p.y, p.x]; })).pad(0.35), { maxZoom: 17 });
        } else {
          openPlace(c.places);
        }
      });
      layer.addLayer(marker);
    });
  }

  // The panel: area, bars per day, count, activities.
  function nearestArea() {
    var c = map.getCenter();
    var best = null, bestKm = Infinity;
    data.areas.forEach(function (a) {
      var km = map.distance(c, [a.lat, a.lon]) / 1000;
      if (km < bestKm) { bestKm = km; best = a; }
    });
    return best && bestKm < 25 && map.getZoom() >= 10 ? best.name : data.region;
  }
  var bars = $("[data-days]");
  function renderDays() {
    var counts = {};
    data.events.forEach(function (e) { if (matches(e, true) && inView(e)) counts[e.d] = (counts[e.d] || 0) + 1; });
    var max = Math.max.apply(null, data.days.map(function (d) { return counts[d.d] || 0; }).concat([1]));
    bars.textContent = "";
    data.days.forEach(function (d, i) {
      var n = counts[d.d] || 0;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "day-bar" + (state.day === d.d ? " is-selected" : "") + (i === 0 ? " is-today" : "");
      b.setAttribute("aria-pressed", state.day === d.d ? "true" : "false");
      b.setAttribute("aria-label", d.label + ": " + n + (n === 1 ? " event" : " events"));
      var col = document.createElement("span"); col.className = "bar-col";
      var fill = document.createElement("span"); fill.className = "bar-fill"; fill.style.height = Math.max(n ? 8 : 3, Math.round(n / max * 100)) + "%";
      col.appendChild(fill);
      var letter = document.createElement("span"); letter.className = "bar-letter"; letter.textContent = d.letter;
      var num = document.createElement("span"); num.className = "bar-num"; num.textContent = d.num;
      b.appendChild(col); b.appendChild(letter); b.appendChild(num);
      b.addEventListener("click", function () { state.day = state.day === d.d ? null : d.d; update(); });
      bars.appendChild(b);
    });
    var day = data.days.filter(function (d) { return d.d === state.day; })[0];
    var total = data.events.filter(function (e) { return matches(e, false) && inView(e); }).length;
    $("[data-day-label]").textContent = day ? day.label : "De næste " + data.days.length + " dage";
    $("[data-count]").textContent = total + (total === 1 ? " arrangement" : " arrangementer") + (state.kind === "flokke" ? " med en flok" : state.kind === "gratis" ? " gratis" : "") + " her";
    $("[data-all-days]").hidden = !state.day;
  }
  var chips = $("[data-chips]");
  function renderChips() {
    chips.textContent = "";
    data.categories.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip-button";
      b.textContent = c.name;
      b.setAttribute("aria-pressed", state.cat === c.slug ? "true" : "false");
      b.addEventListener("click", function () { state.cat = state.cat === c.slug ? null : c.slug; update(); });
      chips.appendChild(b);
    });
  }
  document.querySelectorAll("[data-kind]").forEach(function (b) {
    b.addEventListener("click", function () { state.kind = b.getAttribute("data-kind"); update(); });
  });
  $("[data-all-days]").addEventListener("click", function () { state.day = null; update(); });

  // A place: its events, in time order.
  var overview = $("[data-overview]"), placeView = $("[data-place-view]"), list = $("[data-list]");
  function openPlace(group) {
    state.place = group;
    var events = [].concat.apply([], group.map(function (p) { return p.events; }))
      .sort(function (a, b) { return (a.d + a.h).localeCompare(b.d + b.h); });
    $("[data-place-name]").textContent = group.length > 1 ? group.length + " steder her" : (group[0].name || "Her");
    list.textContent = "";
    events.forEach(function (e) {
      var day = data.days.filter(function (d) { return d.d === e.d; })[0];
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.className = "sheet-item";
      a.href = base + e.p;
      var when = document.createElement("span"); when.className = "item-when";
      when.textContent = (day ? day.label : e.d) + (e.h ? " · " + e.h : "");
      var title = document.createElement("span"); title.className = "item-title"; title.textContent = e.t;
      var meta = document.createElement("span"); meta.className = "item-meta";
      meta.textContent = [group.length > 1 ? e.v : "", e.k].filter(Boolean).join(" · ");
      var flock = document.createElement("span"); flock.className = "item-flock has-flock";
      flock.textContent = e.n + (e.n === 1 ? " flok" : " flokke");
      a.appendChild(when); a.appendChild(title); if (meta.textContent) a.appendChild(meta); if (e.n) a.appendChild(flock);
      li.appendChild(a);
      list.appendChild(li);
    });
    overview.hidden = true;
    placeView.hidden = false;
    $("[data-back]").focus();
  }
  $("[data-back]").addEventListener("click", function () { closePlace(); });
  function closePlace() { state.place = null; placeView.hidden = true; overview.hidden = false; }

  function remember() {
    var q = new URLSearchParams();
    if (state.kind !== "alle") q.set("vis", state.kind);
    q.set("dag", state.day || "alle");
    if (state.cat) q.set("aktivitet", state.cat);
    history.replaceState(null, "", location.pathname + "?" + q.toString());
  }
  function update() {
    document.querySelectorAll("[data-kind]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-kind") === state.kind ? "true" : "false"); });
    $("[data-place]").textContent = nearestArea();
    renderDays();
    renderChips();
    draw();
    remember();
  }
  map.on("moveend", function () { $("[data-place]").textContent = nearestArea(); renderDays(); draw(); });

  // "Vis på kortet" from an event: centred on its place, with the place's events open.
  var wanted = params.get("event");
  var target = wanted ? data.events.filter(function (e) { return e.p === "/events/" + wanted; })[0] : null;
  // The panel covers the bottom (on a phone) or the bottom left (wider): keep the pins in the part that shows.
  function padding() {
    var wide = window.innerWidth > 640;
    return { paddingTopLeft: [wide ? sheet.offsetWidth + 40 : 24, 40], paddingBottomRight: [60, wide ? 40 : sheet.offsetHeight + 30], maxZoom: 16 };
  }
  if (target) {
    state.day = null;
    map.setView([target.y, target.x], 17);
    map.panBy(window.innerWidth > 640 ? [-(sheet.offsetWidth / 2), 0] : [0, sheet.offsetHeight / 2], { animate: false });
  } else {
    // The city's pins: those within 6 km of its centre, so one event in another town does not zoom the map out.
    var centre = L.latLng(data.centre.lat, data.centre.lon);
    var near = data.events.filter(function (e) { return centre.distanceTo([e.y, e.x]) < 6000; });
    if (near.length) map.fitBounds(L.latLngBounds(near.map(function (e) { return [e.y, e.x]; })), padding());
  }
  update();
  if (target) openPlace(places(data.events.filter(function (e) { return e.y === target.y && e.x === target.x; })));

  // Where am I: the browser's position, shown as a dot; it is not sent anywhere.
  var locate = $("[data-locate]");
  if (locate && "geolocation" in navigator) {
    locate.hidden = false;
    var me = null;
    locate.addEventListener("click", function () {
      navigator.geolocation.getCurrentPosition(function (pos) {
        var at = [pos.coords.latitude, pos.coords.longitude];
        if (me) me.setLatLng(at); else me = L.circleMarker(at, { radius: 8, color: "#fffdf8", weight: 3, fillColor: "#2f6fde", fillOpacity: 1 }).addTo(map);
        map.setView(at, 15);
      }, function () {}, { maximumAge: 600000, timeout: 10000 });
    });
  }
})();
