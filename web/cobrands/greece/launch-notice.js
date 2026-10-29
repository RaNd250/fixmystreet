/*
 * The notice over the home page (#gr-launch, in index-steps.html): the site is in its last test stage and the
 * first reports are sent from 1 November 2026. It is hidden in the page and shown here, so a search engine
 * does not meet a full-screen cover; once closed it stays closed for the tab (sessionStorage), and it
 * stops by itself at 00:00 on 1 November 2026, Athens time (22:00 UTC on 31 October).
 */
(function() {
    'use strict';
    var KEY = 'gr_launch_seen';
    var END = Date.UTC(2026, 9, 31, 22, 0, 0);

    function setUp() {
        var box = document.getElementById('gr-launch');
        if (!box || Date.now() >= END) { return; }
        try { if (window.sessionStorage.getItem(KEY) === '1') { return; } } catch (e) { /* private mode: show it */ }
        var button = box.querySelector('[data-gr-launch-close]');
        var before = document.activeElement;
        function close() {
            box.hidden = true;
            document.body.classList.remove('gr-launch-open');
            try { window.sessionStorage.setItem(KEY, '1'); } catch (e) { /* not stored */ }
            if (before && before.focus) { before.focus(); }
            document.removeEventListener('keydown', onKey);
        }
        function onKey(e) {
            if (e.key === 'Escape') { close(); }
            if (e.key === 'Tab') { e.preventDefault(); button.focus(); }   // the button is the only thing to reach
        }
        box.hidden = false;
        document.body.classList.add('gr-launch-open');
        button.addEventListener('click', close);
        document.addEventListener('keydown', onKey);
        button.focus();
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', setUp); } else { setUp(); }
})();
