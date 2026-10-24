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
        orLine.hidden = false;
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
        fetch(dataBase + 'index.json').then(function (r) { return r.json(); }).then(function (d) {
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
                reportLink.href = reportBase + '?latitude=' + c.lat.toFixed(6) + '&longitude=' + c.lng.toFixed(6);
            }
            if (!index || z < DIMOS_ZOOM) {
                show(null);
                return;
            }
            var seq = ++lookupSeq;
            findDimos(c.lng, c.lat).then(function (hit) {
                if (seq === lookupSeq) { show(hit); }
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
            card.hidden = false;
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
                status.textContent = t('Μετακίνησε τον χάρτη ώστε η κόκκινη καρφίτσα να δείχνει ακριβώς το πρόβλημα.', 'Move the map so that the red pin points exactly at the problem.');
            }, function (err) {
                locateBtn.disabled = false;
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
