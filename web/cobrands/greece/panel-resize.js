/*
 * The vertical dividers of the map pages can be moved (owner, 2026-10-29): the edge between the side panel and the
 * map, and, on the pages that have a notes column (the staff panel of a report, the admin edit page), the edge between
 * the form and the notes. A drag with a mouse or a finger, or the arrow keys on a focused divider. The widths are kept
 * in this browser (localStorage) and used again next time. Only on a wide window; a phone keeps its own layout.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }
    var KEY = 'gr-panel-widths';
    var MIN_PANEL = 300, MIN_MAP = 160, WIDE = 960;

    var body = document.body;
    var side = document.getElementById('map_sidebar');
    var map = document.getElementById('map_box');
    if (!side || !map || !body.classList.contains('mappage')) { return; }
    var notes = body.classList.contains('with-notes');

    function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
    function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* kept for this page only */ } }
    var stored = load()[notes ? 'notes' : 'plain'] || {};

    function wide() { return window.innerWidth >= WIDE; }
    var edge = document.createElement('div');
    var inner = notes ? document.createElement('div') : null;
    [edge, inner].forEach(function(h) {
        if (!h) { return; }
        h.className = 'gr-resizer';
        h.setAttribute('role', 'separator');
        h.setAttribute('aria-orientation', 'vertical');
        h.tabIndex = 0;
        body.appendChild(h);
    });
    edge.classList.add('gr-resizer--edge');
    edge.setAttribute('aria-label', t('Μετακίνηση της διαχωριστικής γραμμής προς τον χάρτη', 'Move the divider towards the map'));
    if (inner) {
        inner.classList.add('gr-resizer--inner');
        inner.setAttribute('aria-label', t('Μετακίνηση της διαχωριστικής γραμμής της φόρμας', 'Move the divider of the form'));
    }

    var total = stored.total || 0, form = stored.form || 0, applying = false;

    function clampTotal(v) { return Math.max(MIN_PANEL, Math.min(v, window.innerWidth - MIN_MAP)); }
    function apply() {
        if (!wide()) {
            body.classList.remove('gr-resized');
            edge.hidden = true;
            if (inner) { inner.hidden = true; }
            return;
        }
        if (total) {
            total = clampTotal(total);
            body.style.setProperty('--gr-side-total', total + 'px');
            if (notes) {
                form = Math.max(MIN_PANEL - 40, Math.min(form || Math.round(total * 0.66), total - 120));
                body.style.setProperty('--gr-side-form', form + 'px');
            }
            body.classList.add('gr-resized');
        }
        place();
        edge.hidden = false;
        if (inner) { inner.hidden = false; }
        // the map follows the new size
        applying = true; window.dispatchEvent(new Event('resize')); applying = false;
        try { if (window.fixmystreet && fixmystreet.map && fixmystreet.map.updateSize) { fixmystreet.map.updateSize(); } } catch (e) { /* the map is not there yet */ }
    }
    function place() {
        var r = side.getBoundingClientRect();
        var right = Math.round(r.right);
        edge.style.left = right + 'px';
        edge.setAttribute('aria-valuenow', String(right));
        if (inner) {
            var f = form || Math.round((total || right) * 0.66);
            inner.style.left = Math.min(f, right - 80) + 'px';
        }
    }

    function drag(handle, move) {
        handle.addEventListener('pointerdown', function(e) {
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            body.classList.add('gr-dragging');
            function onMove(ev) { move(ev.clientX); }
            function onUp() {
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
                handle.removeEventListener('pointercancel', onUp);
                body.classList.remove('gr-dragging');
                var all = load(); all[notes ? 'notes' : 'plain'] = { total: total, form: form }; save(all);
            }
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
            handle.addEventListener('pointercancel', onUp);
        });
        handle.addEventListener('keydown', function(e) {
            var step = e.shiftKey ? 80 : 24;
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') { return; }
            e.preventDefault();
            var rect = handle.getBoundingClientRect();
            move(rect.left + rect.width / 2 + (e.key === 'ArrowRight' ? step : -step));
            var all = load(); all[notes ? 'notes' : 'plain'] = { total: total, form: form }; save(all);
        });
    }
    drag(edge, function(x) {
        var oldTotal = total || Math.round(side.getBoundingClientRect().right);
        var oldForm = form || Math.round(oldTotal * 0.66);
        total = clampTotal(x);
        if (notes) { form = Math.round(oldForm * total / oldTotal); }   // the form and the notes keep their proportion
        apply();
    });
    if (inner) {
        drag(inner, function(x) {
            if (!total) { total = Math.round(side.getBoundingClientRect().right); }
            form = Math.max(MIN_PANEL - 40, Math.min(x, total - 120));
            apply();
        });
    }
    window.addEventListener('resize', function() { if (!applying && !body.classList.contains('gr-dragging')) { apply(); } });
    apply();
    // the panel is built after the load on some pages: place the handles once more
    setTimeout(place, 600);
})();
