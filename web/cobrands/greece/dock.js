/*
 * The phones' bottom bar (footer_extra.html) slides away while the page scrolls down and comes back
 * when it scrolls up or reaches the end, as in apps (after EasyUI's Small Floating Dock, MIT).
 */
(function() {
    'use strict';
    var dock = document.querySelector('.gr-dock');
    if (!dock) { return; }
    document.body.classList.add('gr-has-dock');
    var last = window.scrollY, queued = false;
    window.addEventListener('scroll', function() {
        if (queued) { return; }
        queued = true;
        window.requestAnimationFrame(function() {
            queued = false;
            var y = window.scrollY;
            var atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 4;
            if (Math.abs(y - last) > 6) {
                dock.classList.toggle('gr-dock--away', y > last && y > 80 && !atEnd);
                last = y;
            }
        });
    }, { passive: true });
})();
