/*
 * Phones: a report started from the home page's pin (minimap.js adds gr_home=1 to «Αναφορά εδώ») is
 * made where the pin was, without the second map that FixMyStreet shows on phones («Μετακίνησέ την αν
 * χρειάζεται και πάτα Συνέχεια»): the form opens at its first step. Back from there goes to the home
 * page; back from a later step comes to the first step, not to that map.
 */
(function() {
    'use strict';
    if (!/[?&]gr_home=1(&|$)/.test(window.location.search) || !window.jQuery) { return; }
    var $ = window.jQuery;

    function hideMap() {
        $('#map_box').addClass('hidden-js');
        $('html').removeClass('only-map map-page map-with-crosshairs2 map-with-crosshairs3');
    }

    function ready() {
        var fms = window.fixmystreet;
        if (!$('html').hasClass('mobile') || !fms || !fms.pageController) { return; }
        // Going back to the first step (FixMyStreet's history shows its map again then).
        $(fms).on('report_new:page_change', function(e, $curr, $page) {
            if ($('html').hasClass('only-map') && $page.is($('.js-reporting-page').first()) && !$page.is($curr)) {
                hideMap();
            }
        });
        // FixMyStreet sets up the phone map and its «Συνέχεια» once the page has loaded: wait for it,
        // then go straight on, without adding a step to the browser's history.
        var tries = 0;
        (function wait() {
            if ($('#mob_ok').length && $('html').hasClass('only-map')) {
                fms.pageController.toPage('first', { forceMapHide: true, popstate: true });
                hideMap();
            } else if (++tries < 60) {
                setTimeout(wait, 100);
            }
        })();
    }
    $(function() { setTimeout(ready, 0); });
})();
