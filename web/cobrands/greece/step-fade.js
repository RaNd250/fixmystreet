/*
 * The report form's steps slide into each other. FixMyStreet switches steps at once
 * (fixmystreet.pageController.toPage) and that stays as it is; just before, a copy of the step being
 * left is made and, once the new step is shown, laid over it with the panel's background. Going on,
 * the copy slides out to the left and fades while the new step slides in from the right; going back
 * (the stepper, the browser's back button), the other way round (theme.css .gr-step-ghost,
 * .gr-step-in). The copy has no ids, names, frames or scripts, is inert and hidden from screen
 * readers, and is removed after the slide, so the form and its fields are untouched. On phones, the
 * first step slides in as the map makes way for it. Not for the map itself, nor with reduced motion.
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
            // Phones: the map covers the form, laid out behind it, until «Συνέχεια» (#mob_ok).
            var mobOk = document.getElementById('mob_ok');
            var fromMap = !!(mobOk && mobOk.offsetParent);
            var currShown = !fromMap && !!(curr && curr.offsetParent && !curr.classList.contains('js-reporting-page--map'));
            var ghost = null, parent, top, left, width;
            if (currShown) {
                parent = curr.parentNode;
                if (getComputedStyle(parent).position === 'static') { parent.style.position = 'relative'; }
                top = curr.offsetTop; left = curr.offsetLeft; width = curr.offsetWidth;
                ghost = copyOf(curr);
            }
            var result = toPage.apply(this, arguments);
            var next = document.querySelector('.js-reporting-page--active');
            if (!next || !next.offsetParent || next.classList.contains('js-reporting-page--map') || (next === curr && currShown)) {
                return result;
            }
            var pages = Array.prototype.slice.call(document.querySelectorAll('.js-reporting-page'));
            var back = currShown && pages.indexOf(next) < pages.indexOf(curr);
            if (ghost) {
                ghost.classList.add(back ? 'gr-step-ghost--back' : 'gr-step-ghost--on');
                ghost.style.top = top + 'px';
                ghost.style.left = left + 'px';
                ghost.style.width = width + 'px';
                ghost.style.backgroundColor = background(parent);
                parent.appendChild(ghost);
            } else {
                parent = next.parentNode;   // from the map (phones): nothing to slide away, the step comes in
            }
            parent.classList.add('gr-step-anim');
            next.classList.remove('gr-step-in', 'gr-step-in--back');
            void next.offsetWidth;   // so that the slide starts again on a quick second change
            next.classList.add('gr-step-in');
            if (back) { next.classList.add('gr-step-in--back'); }
            setTimeout(function() {
                if (ghost && ghost.parentNode) { ghost.parentNode.removeChild(ghost); }
                if (!parent.querySelector('.gr-step-ghost')) { parent.classList.remove('gr-step-anim'); }
                next.classList.remove('gr-step-in', 'gr-step-in--back');
            }, 520);
            return result;
        };
    }

    install();
    document.addEventListener('DOMContentLoaded', install);
})();
