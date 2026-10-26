/*
 * Each step of the report form is a History entry (fixmystreet.js pageController pushes #details
 * and so on), and a Back that reaches the page takes the form to its first step. Choosing a photo
 * or a video from the gallery can send one: on Android (Firefox above all) the Back gesture that
 * closes the picker, or the picker itself, comes to the page as a popstate. The form then shows the
 * category step and the reporter takes it that the photo or video was lost (owner, 2026-10-26),
 * though it is still there. So from the moment a file picker opens until a few seconds after the
 * page has the focus again, a Back is undone: FixMyStreet does not see it, and the step stays.
 * Registered before FixMyStreet's own popstate listener (which it adds after the page loads).
 */
(function() {
    'use strict';
    if (!window.addEventListener || !('pushState' in history)) { return; }
    var AFTER = 3000;
    var picking = false, until = 0;

    function opened() { picking = true; }
    function back() { if (picking) { picking = false; until = Date.now() + AFTER; } }

    // Pickers opened from script (camera.js, video-upload.js, Dropzone), attached or not...
    var click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function() {
        if (this.type === 'file') { opened(); }
        return click.apply(this, arguments);
    };
    // ...and by a tap on a file input itself.
    document.addEventListener('click', function(e) {
        if (e.target && e.target.type === 'file') { opened(); }
    }, true);
    document.addEventListener('change', function(e) {
        if (e.target && e.target.type === 'file') { picking = true; back(); }
    }, true);
    document.addEventListener('cancel', function(e) {
        if (e.target && e.target.type === 'file') { picking = true; back(); }
    }, true);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', function() { if (!document.hidden) { back(); } });

    window.addEventListener('popstate', function(e) {
        if (!picking && Date.now() > until) { return; }
        var active = document.querySelector('.js-reporting-page--active');
        var page = active && active.getAttribute('data-page-name');
        if (!page) { return; }
        e.stopImmediatePropagation();
        history.pushState({ reportingPage: page }, null, '#' + page);
    });
})();
