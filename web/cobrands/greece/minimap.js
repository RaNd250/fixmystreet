(function () {
    'use strict';
    // The page's language (the menu's switch): English texts when it is English.
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }


    var box = document.getElementById('gr-minimap-box');
    if (!box || !window.maplibregl || !window.fetch || !window.Promise ||
            !('geolocation' in navigator) || window.location.protocol !== 'https:' || !hasWebGL()) {
        return;
    }

    var REPORT_ZOOM = 15;   // pin precise enough to start a report
    var DIMOS_ZOOM = 11;    // municipality lookup only once the map is zoomed past regional level
    var STYLE_URL = '/tiles/styles/positron/style.json';   // our own tiles, as on the report maps
    var dataBase = box.getAttribute('data-dimoi');

    var orLine = document.getElementById('gr-minimap-or');
    var status = document.getElementById('gr-minimap-status');
    var locateBtn = document.getElementById('gr-minimap-locate');
    var reportLink = document.getElementById('gr-minimap-report');
    var reportBase = reportLink.getAttribute('href');
    var card = document.getElementById('gr-dimos');
    var cardName = document.getElementById('gr-dimos-name');
    var cardList = document.getElementById('gr-dimos-contacts');
    var fixLink = document.getElementById('gr-dimos-fix');
    // The classes go on <body>: the how-to steps come after #front-main, outside it (base index.html).
    var front = document.getElementById('front-main') ? document.body : null;
    var searchForm = document.getElementById('postcodeForm');
    var searchLine = document.getElementById('gr-minimap-search');
    var leaving = null;
    // Phones: the address search waits behind «Αναζήτηση διεύθυνσης» from the start, not only once the
    // location is found, and the map's message can be closed (theme.css).
    var PHONE = !!(window.matchMedia && window.matchMedia('(max-width: 47.99em)').matches);

    // Once the location is found, the address search and the how-to steps fade out and give way to the
    // map; «Αναζήτηση διεύθυνσης» brings the search back. If finding the location fails, all of it shows
    // again, since the messages point to the address search.
    function located(yes) {
        if (!front || !searchLine) { return; }
        clearTimeout(leaving);
        orLine.hidden = yes || PHONE;
        searchLine.hidden = !yes && !PHONE;
        if (!yes) {
            front.classList.remove('gr-leaving', 'gr-located');
            // On phones the messages point to the address search: it opens.
            if (searchForm) { searchForm.classList.toggle('gr-search-open', PHONE); }
            if (PHONE) { searchLine.hidden = true; }
        } else if (!front.classList.contains('gr-located')) {
            front.classList.add('gr-leaving');
            leaving = setTimeout(function () {
                front.classList.remove('gr-leaving');
                front.classList.add('gr-located');
            }, 250);
        }
    }
    if (searchLine) {
        searchLine.querySelector('button').addEventListener('click', function (e) {
            e.stopPropagation();
            searchLine.hidden = true;
            orLine.hidden = PHONE;
            if (searchForm) { searchForm.classList.add('gr-search-open'); }
            var pc = document.getElementById('pc');
            if (pc) { pc.focus(); }
        });
    }
    // Phones: «Αναζήτηση διεύθυνσης» right under the buttons, and the search as a pop-up over the page
    // (theme.css), which a tap outside it or Escape closes.
    if (PHONE && searchLine && searchForm && front) {
        box.insertBefore(searchLine, card);
        var closeSearch = function () {
            if (!searchForm.classList.contains('gr-search-open')) { return; }
            searchForm.classList.remove('gr-search-open');
            searchLine.hidden = false;
        };
        document.addEventListener('click', function (e) {
            if (!searchForm.contains(e.target)) { closeSearch(); }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeSearch(); }
        });
    }

    // The map's message on phones sits on the map; ✕ hides it for the visit. A new message after a failed
    // location search shows it again, as it says what to do next.
    var statusClose = document.createElement('button');
    statusClose.type = 'button';
    statusClose.className = 'gr-minimap__status-close';
    statusClose.setAttribute('aria-label', t('Κλείσιμο του μηνύματος', 'Close the message'));
    statusClose.textContent = '\u2715';
    status.parentNode.insertBefore(statusClose, status.nextSibling);
    function hideStatus(yes) {
        status.classList.toggle('gr-minimap__status--closed', yes);
        statusClose.hidden = yes;
    }
    statusClose.addEventListener('click', function () {
        hideStatus(true);
        try { sessionStorage.setItem('gr-minimap-status', 'closed'); } catch (e) {}
    });
    try { if (sessionStorage.getItem('gr-minimap-status') === 'closed') { hideStatus(true); } } catch (e) {}

    function hasWebGL() {
        try {
            var c = document.createElement('canvas');
            return !!(c.getContext('webgl2') || c.getContext('webgl'));
        } catch (e) {
            return false;
        }
    }

    // A flat, minimal basemap: the style has no buildings already; this keeps it so if that changes.
    fetch(STYLE_URL).then(function (r) { return r.json(); }).then(function (style) {
        style.layers = style.layers.filter(function (l) {
            return l['source-layer'] !== 'building' && l.type !== 'fill-extrusion';
        });
        box.hidden = false;
        orLine.hidden = PHONE;
        if (PHONE && searchLine && front) {
            searchLine.hidden = false;
            front.classList.add('gr-minimap-on');
        }
        init(style);
    }, function () { /* keep the plain address search only */ });

    function init(style) {
        var map = new maplibregl.Map({
            container: 'gr-minimap',
            style: style,
            center: [23.7, 38.3],
            zoom: 5.3,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            maxPitch: 0,
            attributionControl: { compact: true }
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        var gpsEl = document.createElement('div');
        gpsEl.className = 'gr-minimap__gps';
        gpsEl.setAttribute('aria-label', t('Η τοποθεσία μου', 'My location'));
        var gpsMarker = new maplibregl.Marker({ element: gpsEl });

        var index = null, cache = {}, current = null, lookupSeq = 0;
        // The versioned address when the page gives one, so a changed file is not served from a cache.
        fetch(box.getAttribute('data-index') || dataBase + 'index.json').then(function (r) { return r.json(); }).then(function (d) {
            index = d;
            update();
        }, function () {});

        map.on('load', function () {
            map.addSource('dimos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({ id: 'dimos-fill', type: 'fill', source: 'dimos',
                paint: { 'fill-color': '#6733c0', 'fill-opacity': 0.07 } });
            map.addLayer({ id: 'dimos-line', type: 'line', source: 'dimos',
                paint: { 'line-color': '#6733c0', 'line-width': 2.5 } });
            if (current) { drawBoundary(current); }
        });
        map.on('moveend', update);

        function update() {
            var c = map.getCenter(), z = map.getZoom();
            var ready = z >= REPORT_ZOOM;
            reportLink.hidden = !ready;
            // One blue button at a time: «Χρήση της τοποθεσίας μου» until «Αναφορά εδώ» can be pressed.
            locateBtn.classList.toggle('btn--primary', !ready);
            if (ready) {
                // The report's map opens at the same scale: MapLibre's zoom z is OpenLayers' z + 1 (512 px
                // against 256 px tiles), and FixMyStreet's zoom counts from its lowest level, 13 (Map::Base).
                var olZoom = Math.min(6, Math.max(0, Math.round(z + 1) - 13));
                // gr_home: on phones the report opens at its first step, at this spot (report-skip-map.js).
                reportLink.href = reportBase + '?latitude=' + c.lat.toFixed(6) + '&longitude=' + c.lng.toFixed(6) + '&zoom=' + olZoom + '&gr_home=1';
            }
            if (!index || z < DIMOS_ZOOM) {
                show(null);
                return;
            }
            var seq = ++lookupSeq;
            findDimos(c.lng, c.lat).then(function (hit) {
                if (seq !== lookupSeq) { return; }
                show(hit);
                // Within a municipality with several stations, the nearest one follows the map.
                if (hit && hit.d.s) { showPolice(hit.d); }
            }, function () {});
        }

        function findDimos(lng, lat) {
            var pt = [lng, lat];
            if (current && inside(pt, current.geom)) { return Promise.resolve(current); }
            var candidates = index.filter(function (d) {
                return lng >= d.b[0] && lng <= d.b[2] && lat >= d.b[1] && lat <= d.b[3];
            });
            return Promise.all(candidates.map(function (d) {
                return geometry(d.r).then(function (g) { return { d: d, geom: g }; });
            })).then(function (list) {
                for (var i = 0; i < list.length; i++) {
                    if (inside(pt, list[i].geom)) { return list[i]; }
                }
                return null;
            });
        }

        function geometry(rel) {
            if (cache[rel]) { return Promise.resolve(cache[rel]); }
            return fetch(dataBase + rel + '.json').then(function (r) { return r.json(); }).then(function (g) {
                cache[rel] = g;
                return g;
            });
        }

        function drawBoundary(hit) {
            var src = map.getSource('dimos');
            if (!src) { return; }
            src.setData(hit ? { type: 'Feature', properties: {}, geometry: hit.geom }
                            : { type: 'FeatureCollection', features: [] });
        }

        function show(hit) {
            if (hit && current && hit.d.r === current.d.r) { return; }
            current = hit;
            drawBoundary(hit);
            if (!hit) {
                card.hidden = true;
                return;
            }
            cardName.textContent = hit.d.n;
            while (cardList.firstChild) { cardList.removeChild(cardList.firstChild); }
            (hit.d.c || []).forEach(function (c) {
                var li = item(c.l + ': ');
                if (c.e) { li.appendChild(link('mailto:' + c.e, c.e)); }
                if (c.e && c.t) { li.appendChild(document.createTextNode(' · ')); }
                if (c.t) { li.appendChild(link('tel:' + c.t.replace(/\s+/g, ''), c.t)); }
            });
            if (!hit.d.c) {
                item(t('Δεν έχουμε ακόμα email ή τηλέφωνο για αυτόν τον δήμο.', 'We do not have an email or phone number for this municipality yet.'));
            }
            if (hit.d.w) {
                var a = link(hit.d.w, hit.d.w.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
                a.target = '_blank';
                a.rel = 'noopener';
                item(t('Ιστότοπος: ', 'Website: ')).appendChild(a);
            }
            // The municipality's police station, as the police complaints go there.
            policeItem = item('');
            policeItem.className = 'gr-dimos__police';
            policeShown = null;
            showPolice(hit.d);
            if (fixLink) {
                fixLink.href = '/contact?subject=' + encodeURIComponent(t('Διόρθωση στοιχείων: ', 'Correction: ') + hit.d.n);
            }
            card.hidden = false;
        }

        // The station: the municipality's own; where it has several (d.s), the one nearest the map centre;
        // where it has none, the nearest one elsewhere (a.x); failing those, the police directorate.
        var policeItem = null, policeShown = null;
        function showPolice(d) {
            if (!policeItem) { return; }
            var st = d.a, near = !!(d.a && d.a.x);
            if (d.s && d.s.length) {
                var c = map.getCenter(), k = Math.cos(c.lat * Math.PI / 180), best = Infinity;
                d.s.forEach(function (s) {
                    var dx = (s.p[0] - c.lng) * k, dy = s.p[1] - c.lat, dist = dx * dx + dy * dy;
                    if (dist < best) { best = dist; st = s; }
                });
                near = true;
            }
            if (st === policeShown) { return; }
            policeShown = st;
            while (policeItem.firstChild) { policeItem.removeChild(policeItem.firstChild); }
            policeItem.hidden = !st;
            if (!st) { return; }
            policeItem.appendChild(document.createTextNode(st.n + (near ? t(' (το πλησιέστερο)', ' (nearest)') : '') + ': '));
            if (st.e) { policeItem.appendChild(link('mailto:' + st.e, st.e)); }
            if (st.e && st.t) { policeItem.appendChild(document.createTextNode(' · ')); }
            if (st.t) { policeItem.appendChild(link('tel:' + st.t.replace(/\s+/g, ''), st.t)); }
        }

        function item(text) {
            var li = document.createElement('li');
            li.appendChild(document.createTextNode(text));
            cardList.appendChild(li);
            return li;
        }

        function link(href, text) {
            var a = document.createElement('a');
            a.href = href;
            a.textContent = text;
            return a;
        }

        var errors = {
            1: t('Δεν δόθηκε άδεια για την τοποθεσία. Μεγέθυνε τον χάρτη στο σημείο ή γράψε μια διεύθυνση παρακάτω.', 'No permission for your location. Zoom the map in on the place, or enter an address below.'),
            2: t('Η θέση σου δεν βρέθηκε. Μεγέθυνε τον χάρτη στο σημείο ή γράψε μια διεύθυνση παρακάτω.', 'Your location was not found. Zoom the map in on the place, or enter an address below.'),
            3: t('Η εύρεση της θέσης άργησε πολύ. Δοκίμασε ξανά ή γράψε μια διεύθυνση παρακάτω.', 'Finding your location took too long. Try again, or enter an address below.')
        };

        function locate() {
            locateBtn.disabled = true;
            status.textContent = t('Αναζήτηση της θέσης σου…', 'Finding your location…');
            navigator.geolocation.getCurrentPosition(function (pos) {
                var here = [pos.coords.longitude, pos.coords.latitude];
                gpsMarker.setLngLat(here).addTo(map);
                map.jumpTo({ center: here, zoom: 17 });
                locateBtn.disabled = false;
                locateBtn.textContent = t('Ξανά στη θέση μου', 'Back to my location');
                status.textContent = t('Μετακίνησε τον χάρτη ώστε η καρφίτσα να δείχνει ακριβώς το πρόβλημα.', 'Move the map so that the pin points exactly at the problem.');
                located(true);
            }, function (err) {
                locateBtn.disabled = false;
                located(false);
                hideStatus(false);
                status.textContent = errors[err.code] || t('Κάτι πήγε στραβά με την εύρεση της θέσης. Γράψε μια διεύθυνση παρακάτω.', 'Something went wrong finding your location. Enter an address below.');
            }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
        }
        locateBtn.addEventListener('click', locate);

        // Locate straight away only when permission was already given, so no prompt appears unasked.
        if (navigator.permissions && navigator.permissions.query) {
            navigator.permissions.query({ name: 'geolocation' }).then(function (p) {
                if (p.state === 'granted') { locate(); }
            }, function () {});
        }
    }

    // Ray casting on GeoJSON Polygon/MultiPolygon rings; holes are excluded.
    function inside(pt, geom) {
        var polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (var i = 0; i < polys.length; i++) {
            if (!inRing(pt, polys[i][0])) { continue; }
            var inHole = false;
            for (var h = 1; h < polys[i].length; h++) {
                if (inRing(pt, polys[i][h])) { inHole = true; break; }
            }
            if (!inHole) { return true; }
        }
        return false;
    }

    function inRing(pt, ring) {
        var x = pt[0], y = pt[1], hit = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) { hit = !hit; }
        }
        return hit;
    }
})();
