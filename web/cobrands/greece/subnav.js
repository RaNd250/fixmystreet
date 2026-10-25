/*
 * The arrow beside «Όλες οι αναφορές» opens and closes its submenu (main_nav_items.html, theme.css
 * .gr-subnav), for touch screens and keyboards on computers; hovering opens it too. A click elsewhere
 * or Escape closes it.
 */
(function() {
    'use strict';
    function close(li, focus) {
        li.classList.remove('gr-subnav--open');
        var button = li.querySelector('.gr-subnav__toggle');
        button.setAttribute('aria-expanded', 'false');
        if (focus) { button.focus(); }
    }
    document.addEventListener('click', function(e) {
        var open = document.querySelector('.gr-subnav--open');
        var button = e.target.closest && e.target.closest('.gr-subnav__toggle');
        if (button) {
            var li = button.parentNode;
            var on = !li.classList.contains('gr-subnav--open');
            if (open && open !== li) { close(open); }
            li.classList.toggle('gr-subnav--open', on);
            button.setAttribute('aria-expanded', on ? 'true' : 'false');
            return;
        }
        if (open && !open.contains(e.target)) { close(open); }
    });
    document.addEventListener('keydown', function(e) {
        var open = document.querySelector('.gr-subnav--open');
        if (open && e.key === 'Escape') { close(open, true); }
    });
})();
