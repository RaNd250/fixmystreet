/*
 * A progress bar of the report form's steps (after EasyUI's Stepper, MIT; no React): above the
 * steps, each step that applies is a numbered dot with its name, the current one highlighted and the
 * ones done ticked, with a bar that fills as the form goes on. A step already done can be clicked to
 * go back to it. It follows FixMyStreet's own switching (the steps' js-reporting-page--active class)
 * and the steps it skips for the category chosen (js-reporting-page--skip).
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    var NAMES = {
        category: ['Κατηγορία', 'Category'],
        subcategory: ['Υποκατηγορία', 'Subcategory'],
        extra: ['Ερωτήσεις', 'Questions'],
        duplicates: ['Παρόμοιες', 'Similar'],
        details: ['Περιγραφή', 'Description'],
        user: ['Στοιχεία', 'Your details']
    };
    var CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>';

    function steps(form) {
        return Array.prototype.filter.call(form.querySelectorAll('.js-reporting-page'), function(p) {
            var name = p.getAttribute('data-page-name');
            return NAMES[name] && !p.classList.contains('js-reporting-page--skip');
        });
    }

    function render(form, bar) {
        var list = steps(form);
        var active = form.querySelector('.js-reporting-page--active');
        var current = list.indexOf(active);
        if (list.length < 2 || current < 0) { bar.hidden = true; return; }
        bar.hidden = false;
        var key = list.map(function(p) { return p.getAttribute('data-page-name'); }).join(',');
        if (bar.getAttribute('data-steps') !== key) {
            bar.setAttribute('data-steps', key);
            bar.querySelector('ol').innerHTML = list.map(function(p, i) {
                var n = NAMES[p.getAttribute('data-page-name')];
                return '<li class="gr-stepper__step" data-page="' + p.getAttribute('data-page-name') + '">' +
                    '<button type="button" class="gr-stepper__dot" tabindex="-1">' +
                    '<span class="gr-stepper__num">' + (i + 1) + '</span><span class="gr-stepper__check">' + CHECK + '</span></button>' +
                    '<span class="gr-stepper__name">' + (EN ? n[1] : n[0]) + '</span></li>';
            }).join('');
        }
        Array.prototype.forEach.call(bar.querySelectorAll('.gr-stepper__step'), function(li, i) {
            li.classList.toggle('gr-stepper__step--done', i < current);
            li.classList.toggle('gr-stepper__step--current', i === current);
            var dot = li.querySelector('.gr-stepper__dot');
            dot.disabled = i >= current;
            dot.tabIndex = i < current ? 0 : -1;
            dot.setAttribute('aria-label', (EN ? 'Back to: ' : 'Πίσω στο: ') + li.querySelector('.gr-stepper__name').textContent);
            if (i === current) { li.setAttribute('aria-current', 'step'); } else { li.removeAttribute('aria-current'); }
        });
        // The track runs from the first dot's centre to the last one's; fill it up to the current dot's.
        var dots = bar.querySelectorAll('.gr-stepper__dot');
        var centre = function(el) { var r = el.getBoundingClientRect(); return r.left + r.width / 2; };
        var start = centre(dots[0]), end = centre(dots[dots.length - 1]);
        var track = bar.querySelector('.gr-stepper__track');
        track.style.left = (start - bar.getBoundingClientRect().left) + 'px';
        track.style.width = (end - start) + 'px';
        track.style.right = 'auto';
        var part = end > start ? (centre(dots[current]) - start) / (end - start) : 0;
        bar.querySelector('.gr-stepper__fill').style.transform = 'scaleX(' + Math.max(0, Math.min(1, part)) + ')';
    }

    function setUp(form) {
        if (form.getAttribute('data-gr-stepper')) { return; }
        var first = form.querySelector('.js-reporting-page');
        if (!first) { return; }
        form.setAttribute('data-gr-stepper', '1');
        var bar = document.createElement('nav');
        bar.className = 'gr-stepper';
        bar.setAttribute('aria-label', EN ? 'Report steps' : 'Βήματα αναφοράς');
        bar.innerHTML = '<div class="gr-stepper__track"><div class="gr-stepper__fill"></div></div><ol></ol>';
        first.parentNode.insertBefore(bar, first);
        bar.addEventListener('click', function(e) {
            var dot = e.target.closest && e.target.closest('.gr-stepper__dot');
            if (!dot || dot.disabled || !window.fixmystreet || !fixmystreet.pageController) { return; }
            fixmystreet.pageController.toPage(dot.parentNode.getAttribute('data-page'));
        });
        var queued = false;
        var update = function() {
            if (queued) { return; }
            queued = true;
            window.requestAnimationFrame(function() { queued = false; render(form, bar); });
        };
        new MutationObserver(update).observe(form, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
        window.addEventListener('resize', update);
        render(form, bar);
    }

    function scan() {
        var form = document.getElementById('mapForm');
        if (form) { setUp(form); }
    }
    if (window.MutationObserver) {
        new MutationObserver(function() { scan(); }).observe(document.documentElement, { childList: true, subtree: true });
    }
    document.addEventListener('DOMContentLoaded', scan);
    scan();
})();
