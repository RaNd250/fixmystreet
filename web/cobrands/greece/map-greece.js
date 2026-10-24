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
