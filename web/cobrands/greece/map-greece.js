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
    function graphic(emoji, colour) {
        var key = emoji + colour;
        if (cache[key]) { return cache[key]; }
        var c = document.createElement('canvas'), s = 72;
        c.width = c.height = s;
        var g = c.getContext('2d');
        g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 4, 0, 2 * Math.PI);
        g.fillStyle = '#fff'; g.fill();
        g.lineWidth = 6; g.strokeStyle = RING[colour] || '#6b7280'; g.stroke();
        g.font = '38px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(emoji, s / 2, s / 2 + 2);
        return (cache[key] = c.toDataURL('image/png'));
    }
    var original = maps.markers_list;
    maps.markers_list = function(pins, transform) {
        var markers = original.apply(this, arguments);
        markers.forEach(function(m) {
            var a = m.attributes;
            if (!a || !a.id) { return; }
            var emoji = EMOJI[a.title] || '📝';
            var big = a.size === 'big' || a.id === window.selected_problem_id;
            var w = big ? 48 : 38;
            m.style = {
                externalGraphic: graphic(emoji, a.colour), graphicWidth: w, graphicHeight: w,
                graphicXOffset: -w / 2, graphicYOffset: -w / 2, graphicTitle: a.title,
                cursor: 'pointer', graphicZIndex: big ? 2 : 1
            };
        });
        return markers;
    };
})();
