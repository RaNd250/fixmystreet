/*
 * The home page's address box as an "expandable search" (after EasyUI's ExpandableSearch, MIT): a
 * search icon, a clear button while there is text, and on computers a shortcut hint ("/" or Ctrl+K
 * puts the cursor in the box); the box widens with a spring when focused or filled (theme.css
 * .gr-xsearch). Suggestions while typing stay with place-search.js; clearing tells it, as typing does.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }
    var ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2-1.4 1.4-4.2-4.2A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"/></svg>';
    var X = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z"/></svg>';

    var userActed = false;
    ['pointerdown', 'keydown', 'touchstart'].forEach(function(ev) {
        document.addEventListener(ev, function() { userActed = true; }, { capture: true, once: true });
    });

    function setUp() {
        var input = document.querySelector('#postcodeForm input#pc');
        if (!input || input.getAttribute('data-gr-xsearch')) { return; }
        input.setAttribute('data-gr-xsearch', '1');
        var box = input.parentNode;
        box.classList.add('gr-xsearch');

        var icon = document.createElement('span');
        icon.className = 'gr-xsearch__icon';
        icon.innerHTML = ICON;
        box.insertBefore(icon, input);

        var clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'gr-xsearch__clear';
        clear.setAttribute('aria-label', t('Καθαρισμός', 'Clear'));
        clear.innerHTML = X;
        box.insertBefore(clear, input.nextSibling);

        var hint = document.createElement('kbd');
        hint.className = 'gr-xsearch__hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.textContent = '/';
        box.insertBefore(hint, clear.nextSibling);

        // FixMyStreet puts the cursor in the box on load (front.js); here it opens when the visitor
        // clicks it or presses the shortcut, so it starts closed.
        if (document.activeElement === input && input.value === '' && !userActed) { input.blur(); }

        function sync() { box.classList.toggle('gr-xsearch--filled', input.value !== ''); }
        input.addEventListener('input', sync);
        sync();
        clear.addEventListener('click', function() {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        });
        box.addEventListener('click', function(e) {
            if (e.target === box || e.target.closest('.gr-xsearch__icon')) { input.focus(); }
        });
        document.addEventListener('keydown', function(e) {
            var el = document.activeElement;
            var typing = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
            if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) {
                e.preventDefault();
                input.focus();
                input.select();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setUp);
    } else {
        setUp();
    }
    // front.js may focus the box after this script has run.
    window.addEventListener('load', function() {
        var input = document.querySelector('#postcodeForm input#pc');
        if (input && document.activeElement === input && input.value === '' && !userActed) { input.blur(); }
    });
})();
