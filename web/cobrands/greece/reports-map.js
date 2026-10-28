/*
 * The reports page's map of reports per municipality (templates/web/greece/reports/index.html): one
 * circle per municipality with its number of public reports, larger for more, at a point inside the
 * municipality (dimoi/index.json "p"). A circle is a button; it opens a card with the open and fixed
 * counts and a link to the municipality's reports. The page's own map tiles, as on the home page.
 * Shown only when WebGL and the data are there; the list under it works without.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }

    var box = document.getElementById('gr-rmap');
    if (!box || !window.maplibregl || !window.fetch || !window.Promise || !hasWebGL()) { return; }
    var counts;
    try { counts = JSON.parse(box.getAttribute('data-counts') || '[]'); } catch (e) { return; }

    function hasWebGL() {
        try {
            var c = document.createElement('canvas');
            return !!(c.getContext('webgl2') || c.getContext('webgl'));
        } catch (e) {
            return false;
        }
    }
    function json(r) { if (!r.ok) { throw new Error(r.status); } return r.json(); }
    function number(n) { return n.toLocaleString(EN ? 'en-GB' : 'el-GR'); }
    function reports(n) { return number(n) + ' ' + (n === 1 ? t('αναφορά', 'report') : t('αναφορές', 'reports')); }

    Promise.all([fetch(box.getAttribute('data-style')).then(json), fetch(box.getAttribute('data-index')).then(json)])
        .then(function(r) { show(r[0], r[1]); }, function() { /* the list stays */ });

    function show(style, index) {
        // A flat basemap: no buildings, as on the home page's minimap.
        style.layers = style.layers.filter(function(l) {
            return l['source-layer'] !== 'building' && l.type !== 'fill-extrusion';
        });
        box.hidden = false;
        var map = new maplibregl.Map({
            container: 'gr-rmap-map',
            style: style,
            bounds: [[19.3, 34.7], [29.8, 41.8]],
            fitBoundsOptions: { padding: 12 },
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            maxPitch: 0,
            // The page scrolls past the map; zooming needs Ctrl/⌘ or two fingers.
            cooperativeGestures: true,
            attributionControl: { compact: true },
            locale: EN ? {} : {
                'CooperativeGesturesHandler.WindowsHelpText': 'Πάτα Ctrl και κύλισε για μεγέθυνση του χάρτη',
                'CooperativeGesturesHandler.MacHelpText': 'Πάτα ⌘ και κύλισε για μεγέθυνση του χάρτη',
                'CooperativeGesturesHandler.MobileHelpText': 'Μετακίνησε τον χάρτη με δύο δάχτυλα',
                'NavigationControl.ZoomIn': 'Μεγέθυνση',
                'NavigationControl.ZoomOut': 'Σμίκρυνση'
            }
        });
        map.touchZoomRotate.disableRotation();
        // The credit (OpenMapTiles, OpenStreetMap) is behind the (i) button, not spread over the map.
        map.once('load', function () {
            var a = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
            if (a) { a.classList.remove('maplibregl-compact-show'); a.removeAttribute('open'); }
        });
        map.keyboard.disableRotation();
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        var at = {};
        index.forEach(function(d) {
            at[d.n] = d.p || [(d.b[0] + d.b[2]) / 2, (d.b[1] + d.b[3]) / 2];
        });
        var max = Math.max.apply(null, counts.map(function(c) { return c.t; }).concat([1]));
        // Fewest first, so the larger circles are drawn on top.
        counts.slice().reverse().forEach(function(c) {
            if (!at[c.n]) { return; }
            var size = Math.round(28 + 26 * Math.sqrt(c.t / max));
            // The marker element is positioned by MapLibre (a transform); the button inside it is free to grow.
            var holder = document.createElement('div');
            holder.className = 'gr-rmap__marker';
            var dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'gr-rmap__dot';
            dot.style.width = dot.style.height = size + 'px';
            dot.textContent = number(c.t);
            dot.setAttribute('aria-label', c.n + ': ' + reports(c.t));
            holder.appendChild(dot);
            var popup = new maplibregl.Popup({ offset: size / 2 + 4, maxWidth: '280px', className: 'gr-rmap__popup' })
                .setLngLat(at[c.n]).setDOMContent(card(c));
            // The button opens its card itself (mouse, Enter or Space alike); MapLibre's own marker popup
            // also reacts to the key and to the click reaching the map, and so closed it again at once.
            dot.addEventListener('click', function(e) {
                e.stopPropagation();
                var again = opened === popup && popup.isOpen();
                if (opened) { opened.remove(); }
                opened = again ? null : popup.addTo(map);
            });
            new maplibregl.Marker({ element: holder }).setLngLat(at[c.n]).addTo(map);
        });
    }
    var opened = null;

    function card(c) {
        var div = document.createElement('div');
        var name = document.createElement('strong');
        name.className = 'gr-rmap__name';
        name.textContent = c.n;
        div.appendChild(name);
        var p = document.createElement('p');
        p.className = 'gr-rmap__counts';
        p.textContent = reports(c.t) + ' · ' + t('ανοιχτές ', 'open ') + number(c.o) + ' · ' + t('διορθωμένες ', 'fixed ') + number(c.f);
        div.appendChild(p);
        var a = document.createElement('a');
        a.className = 'gr-rmap__link';
        a.href = c.u;
        a.textContent = t('Δες τις αναφορές του δήμου →', 'See the municipality’s reports →');
        div.appendChild(a);
        return div;
    }
})();
