/*
 * The reports page's charts in the site's colours (theme.css "Reports page"): FixMyStreet draws them in
 * orange, blue and green, set in the page (data-color, the figures' style) and in dashboard.js (the
 * all-time chart). Reported is the site's blue, updates purple, fixed green.
 */
(function() {
    'use strict';
    if (!document.querySelector('.dashboard-header')) { return; }
    var COLOURS = { '#D97B0C': '#1f5fd6', '#269AE9': '#6733c0', '#56A54A': '#16a34a' };
    function swap(value) {
        return (value || '').replace(/#[0-9a-f]{6}/gi, function(c) { return COLOURS[c.toUpperCase()] || c; });
    }

    // Before dashboard.js reads them on DOM ready (this script runs first, at the end of the page).
    Array.prototype.forEach.call(document.querySelectorAll('canvas[data-color]'), function(c) {
        c.setAttribute('data-color', swap(c.getAttribute('data-color')));
    });
    Array.prototype.forEach.call(document.querySelectorAll('.labelled-line-chart .label strong, .labelled-sparkline .label strong'), function(s) {
        s.setAttribute('style', swap(s.getAttribute('style')));
    });

    // The all-time chart's colours are fixed in dashboard.js: change them once it is drawn, which jQuery
    // may do even after the page's load event, so look for it for a few seconds.
    // (The reports page shows a map instead of it: nothing to wait for.)
    if (!document.getElementById('chart-all-reports')) { return; }
    var tries = 0;
    (function recolour() {
        var chart = window.chartAllReports;
        if (!chart || !chart.data) {
            if (++tries < 50) { setTimeout(recolour, 100); }
            return;
        }
        chart.data.datasets.forEach(function(d) {
            d.borderColor = swap(d.borderColor);
            d.pointBackgroundColor = swap(d.pointBackgroundColor);
        });
        chart.update(0);
    })();
})();
