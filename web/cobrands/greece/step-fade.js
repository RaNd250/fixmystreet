/*
 * The report form's steps fade into each other. FixMyStreet switches steps at once
 * (fixmystreet.pageController.toPage) and that stays as it is; just before, a copy of the step being
 * left is made and, once the new step is shown, laid over it with the panel's background and faded
 * out (theme.css .gr-step-ghost) while the new one fades in. The copy has no ids, names, frames or
 * scripts, is inert and hidden from screen readers, and is removed after the fade, so the form and
 * its fields are untouched. Not for steps showing the map (phones), nor with reduced motion.
 */
(function() {
    'use strict';
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function background(el) {
        for (var e = el; e && e !== document.documentElement; e = e.parentElement) {
            var bg = getComputedStyle(e).backgroundColor;
            if (bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) { return bg; }
        }
        return getComputedStyle(document.body).backgroundColor || '#fff';
    }

    function copyOf(step) {
        var ghost = step.cloneNode(true);
        Array.prototype.forEach.call(ghost.querySelectorAll('iframe, script, video, canvas, .gr-turnstile'), function(e) {
            e.parentNode.removeChild(e);
        });
        [ghost].concat(Array.prototype.slice.call(ghost.querySelectorAll('*'))).forEach(function(e) {
            e.removeAttribute('id');
            e.removeAttribute('name');
            e.removeAttribute('for');
        });
        ghost.className = 'gr-step-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.inert = true;
        return ghost;
    }

    function install() {
        var pc = window.fixmystreet && window.fixmystreet.pageController;
        if (!pc || pc.grFade || reduced) { return; }
        pc.grFade = true;
        var toPage = pc.toPage;
        pc.toPage = function() {
            var curr = document.querySelector('.js-reporting-page--active');
            var ghost = null, parent, top, left, width;
            if (curr && curr.offsetParent && !curr.classList.contains('js-reporting-page--map')) {
                parent = curr.parentNode;
                if (getComputedStyle(parent).position === 'static') { parent.style.position = 'relative'; }
                top = curr.offsetTop; left = curr.offsetLeft; width = curr.offsetWidth;
                ghost = copyOf(curr);
            }
            var result = toPage.apply(this, arguments);
            var next = document.querySelector('.js-reporting-page--active');
            if (ghost && next && next !== curr && next.offsetParent && !next.classList.contains('js-reporting-page--map')) {
                ghost.style.top = top + 'px';
                ghost.style.left = left + 'px';
                ghost.style.width = width + 'px';
                ghost.style.backgroundColor = background(parent);
                parent.appendChild(ghost);
                var done = function() { if (ghost.parentNode) { ghost.parentNode.removeChild(ghost); } };
                ghost.addEventListener('animationend', done);
                setTimeout(done, 600);
            }
            return result;
        };
    }

    install();
    document.addEventListener('DOMContentLoaded', install);
})();
