fixmystreet.maps.config = function() {
    fixmystreet.maps.controls.unshift( new OpenLayers.Control.AttributionFMS() );
};

/**
 * Class: OpenLayers.Layer.Greece
 * The site's own raster tiles (tiles compose service, see FixMyStreet::Map::Greece), double
 * resolution on high-density screens.
 */
OpenLayers.Layer.Greece = OpenLayers.Class(OpenLayers.Layer.OSM, {
    attribution: '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',

    initialize: function(name, options) {
        var scale = window.devicePixelRatio > 1 ? '@2x' : '';
        var url = '/tiles/styles/positron/${z}/${x}/${y}' + scale + '.png';
        this.attribution = '<div class="os-api-branding copyright">' + this.attribution + '</div>';

        options = OpenLayers.Util.extend({
            maxResolution: 156543.03390625/Math.pow(2, options.zoomOffset || 0),
            numZoomLevels: 20,
            buffer: 0
        }, options);
        OpenLayers.Layer.OSM.prototype.initialize.apply(this, [name, url, options]);
    },

    CLASS_NAME: "OpenLayers.Layer.Greece"
});

/*
 * Report maps (/around, /reports/<Δήμος>, a report's page): each report is drawn as its category's
 * emoji (the same as on the report form, category-emoji.js) in a disc whose ring has the colour
 * FixMyStreet gives the pin for its state (yellow open, green fixed, grey closed). The pin's title is
 * the report's title, which is its category except for «Άλλο». The pin of a report being made (no id)
 * stays FixMyStreet's.
 */
(function() {
    'use strict';
    var maps = window.fixmystreet && fixmystreet.maps;
    if (!maps || !maps.markers_list || !document.createElement('canvas').getContext) { return; }
    var EMOJI = {
        'Λακκούβα ή φθορά οδοστρώματος': '🕳️', 'Pothole or damaged road': '🕳️',
        'Πρόβλημα με πεζοδρόμιο': '🚶', 'Pavement problem': '🚶',
        'Στάθμευση σε ράμπα ή θέση ΑμεΑ, πεζοδρόμιο ή διάβαση': '♿', 'Parking on a disabled ramp or bay, pavement or crossing': '♿',
        'Στάθμευση σε φορτιστή EV ή εμπόδιο στη διέλευση': '🔌', 'Parking at an EV charger or blocking the way': '🔌',
        'Κατάληψη κοινόχρηστου χώρου': '🚧',
        'Φρεάτια και καθαριότητα': '🗑️', 'Drains and cleaning': '🗑️',
        'Πράσινο και δέντρα': '🌳', 'Trees and green spaces': '🌳',
        'Οδοφωτισμός': '💡', 'Street lighting': '💡'
    };
    var RING = { yellow: '#f59e0b', green: '#15803d', grey: '#6b7280', gray: '#6b7280', red: '#dc2626', blue: '#0055a4' };
    var cache = {};
    function graphic(emoji, colour, hl) {
        var key = emoji + colour + (hl ? '!' : '');
        if (cache[key]) { return cache[key]; }
        var c = document.createElement('canvas'), s = 72;
        c.width = c.height = s;
        var g = c.getContext('2d');
        g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 4, 0, 2 * Math.PI);
        g.fillStyle = '#fff'; g.fill();
        g.lineWidth = 6; g.strokeStyle = RING[colour] || '#6b7280'; g.stroke();
        if (hl) { g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 1.5, 0, 2 * Math.PI); g.lineWidth = 3; g.strokeStyle = '#0055a4'; g.stroke(); }
        g.font = '38px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(emoji, s / 2, s / 2 + 2);
        return (cache[key] = c.toDataURL('image/png'));
    }
    // A pin's look: its own graphic, bigger and ringed when it is the one pointed at, faded when another is.
    function paint(m, hit, faded) {
        var g = m._gr, w = hit ? Math.round(g.w * 1.45) : g.w;
        m.style = {
            externalGraphic: graphic(g.emoji, g.colour, hit), graphicWidth: w, graphicHeight: w,
            graphicXOffset: -w / 2, graphicYOffset: -w / 2, graphicTitle: g.title,
            graphicOpacity: faded ? 0.35 : 1, cursor: 'pointer', graphicZIndex: hit ? 10 : (g.big ? 2 : 1)
        };
    }
    var original = maps.markers_list;
    maps.markers_list = function(pins, transform) {
        var markers = original.apply(this, arguments);
        markers.forEach(function(m) {
            var a = m.attributes;
            if (!a || !a.id) { return; }
            var big = a.size === 'big' || a.id === window.selected_problem_id;
            m._gr = { emoji: EMOJI[a.title] || '📝', colour: a.colour, w: big ? 48 : 38, big: big, title: a.title };
            paint(m, false, false);
        });
        return markers;
    };
    // Pointing at a report in the list (or at its pin) shows which pin it is: that one larger and ringed, the
    // others faded. The list's own hook sends a NaN here (it reads a number from the link, and ours end in a
    // date-number like 20261029-01), which is ignored; the list item's data-report-id is used below.
    maps.markers_highlight = function(id) {
        var layer = window.fixmystreet && fixmystreet.markers;
        if (!layer || (typeof id === 'number' && isNaN(id))) { return; }
        var none = typeof id === 'undefined';
        layer.features.forEach(function(f) {
            if (!f._gr) { return; }
            var hit = !none && f.attributes.id == id;
            f.attributes.faded = (none || hit) ? 0 : 1;
            paint(f, hit, f.attributes.faded);
        });
        layer.redraw();
    };
    var $ = window.jQuery;
    if ($) {
        $(document).on('mouseenter focusin', '#js-reports-list .item-list--reports__item', function() {
            var id = parseInt(this.getAttribute('data-report-id'), 10);
            if (id) { maps.markers_highlight(id); }
        });
        // A click on a pin opens the report: FixMyStreet looks for a list link ending in /<id>, but ours end in
        // the report's number (/report/20261029-01), so it finds none and nothing happens.
        $(window.fixmystreet).on('maps:marker_click', function(e, feature) {
            var id = feature && feature.attributes && feature.attributes.id;
            if (!id) { return; }
            var a = document.querySelector('[data-report-id="' + id + '"] a[href]');
            window.location.href = a ? a.href : '/report/' + id;
        });
    }
})();

/*
 * The map credit (OpenMapTiles, OpenStreetMap: both licences require it) folds into a small (i) button, as on
 * the home page's map: a tap opens it, another closes it. The links inside still open normally.
 */
(function() {
    var EN = /^en/i.test(document.documentElement.lang || '');
    function toggle(el) { el.classList.toggle('gr-attrib--closed'); el.setAttribute('aria-expanded', el.classList.contains('gr-attrib--closed') ? 'false' : 'true'); }
    function setup(el) {
        if (el.classList.contains('gr-attrib')) { return; }
        el.classList.add('gr-attrib', 'gr-attrib--closed');
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-expanded', 'false');
        el.setAttribute('aria-label', EN ? 'Map credits' : 'Πηγές χάρτη');
        el.addEventListener('click', function(e) { if (!(e.target.closest && e.target.closest('a'))) { toggle(el); } });
        el.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(el); } });
    }
    function scan() {
        var els = document.querySelectorAll('.olControlAttribution');
        for (var i = 0; i < els.length; i++) { setup(els[i]); }
    }
    if (window.MutationObserver) { new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true }); }
    document.addEventListener('DOMContentLoaded', scan);
    scan();
})();
