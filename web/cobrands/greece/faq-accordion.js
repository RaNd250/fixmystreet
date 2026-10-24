/*
 * The help page's questions open and close smoothly (after EasyUI's Smooth Accordion, MIT): each
 * question (dt) becomes a button for its answer (dd), which opens and closes with a height
 * animation. All answers start closed; one named in the address (#…) is opened. Without JavaScript
 * every answer is shown, as before.
 */
(function() {
    'use strict';
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var CHEVRON = '<svg class="gr-acc__chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="m12 15.4-6-6L7.4 8l4.6 4.6L16.6 8 18 9.4z"/></svg>';

    function animate(dd, open) {
        if (reduced || !dd.animate) { dd.hidden = !open; return; }
        if (open) { dd.hidden = false; }
        var h = dd.offsetHeight;   // the answer's own height, padding and border included (border-box)
        var a = dd.animate(open ? [{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }]
                                : [{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
                           { duration: open ? 260 : 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
        dd.style.overflow = 'hidden';
        a.onfinish = function() { dd.style.overflow = ''; if (!open) { dd.hidden = true; } };
    }

    function toggle(dt, open) {
        var dd = dt.nextElementSibling;
        if (!dd || dd.tagName !== 'DD') { return; }
        if (open === undefined) { open = dt.getAttribute('aria-expanded') !== 'true'; }
        dt.setAttribute('aria-expanded', open ? 'true' : 'false');
        animate(dd, open);
    }

    function setUp() {
        if (!document.body.classList.contains('gr-faq')) { return; }
        var n = 0;
        Array.prototype.forEach.call(document.querySelectorAll('.gr-faq dl dt'), function(dt) {
            var dd = dt.nextElementSibling;
            if (!dd || dd.tagName !== 'DD') { return; }
            n += 1;
            dd.id = dd.id || 'gr-faq-a' + n;
            dt.classList.add('gr-acc__q');
            dt.setAttribute('role', 'button');
            dt.setAttribute('tabindex', '0');
            dt.setAttribute('aria-controls', dd.id);
            dt.setAttribute('aria-expanded', 'false');
            dt.insertAdjacentHTML('beforeend', CHEVRON);
            dd.classList.add('gr-acc__a');
            dd.hidden = true;
            dt.addEventListener('click', function() { toggle(dt); });
            dt.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(dt); }
            });
        });
        var target = location.hash && document.getElementById(location.hash.slice(1));
        if (target && target.tagName === 'DD') { toggle(target.previousElementSibling, true); }
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', setUp); } else { setUp(); }
})();
