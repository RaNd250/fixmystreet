/*
 * The municipality (and ward) chooser on the reports page as a search that filters while typing
 * (after EasyUI's Combobox, MIT; no React). It finds the text anywhere in the name, ignoring case,
 * accents and diaeresis, so «αρι» finds Χαϊδαρίου and «χαι» finds Χαϊδαρίου too; names where the
 * text starts a word come first, and the part that matches is highlighted. Arrow keys, Enter and
 * Escape work as in a list; choosing a name opens its reports, as FixMyStreet's form does.
 *
 * It takes the place of FixMyStreet's accessible-autocomplete on the same <select>, which stays in
 * the form, hidden, and is what is sent.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }
    var MAX = 500;   // all of them (Greece has 332 municipalities), so the list can be browsed too
    var SEARCH = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2-1.4 1.4-4.2-4.2A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"/></svg>';

    // Lower case without accents or diaeresis, final sigma as sigma, for comparing.
    function plain(s) {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ς/g, 'σ');
    }
    // Each letter is one character again once its marks are stripped, so a position in plain()
    // is the same position in the name.
    function escape(s) { return s.replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    function enhance(select) {
        if (select.getAttribute('data-gr-combo')) { return; }
        select.setAttribute('data-gr-combo', '1');
        select.classList.remove('js-autocomplete');   // FixMyStreet sets up its own only on that class
        var holder = select.parentNode;
        // Should FixMyStreet's autocomplete be there already, it sits in a div before the select; take it away.
        var old = holder.querySelector('.autocomplete__wrapper');
        if (old) { old.parentNode.parentNode.removeChild(old.parentNode); }
        var id = select.id.replace(/-select$/, '');
        select.id = id + '-select';
        select.style.display = 'none';
        select.removeAttribute('required');

        var options = Array.prototype.filter.call(select.options, function(o) { return o.value !== ''; }).map(function(o) {
            var name = o.textContent.replace(/\s+/g, ' ').trim();
            return { value: o.value, name: name, plain: plain(name) };
        });

        var box = document.createElement('div');
        box.className = 'gr-combo';
        box.innerHTML = '<span class="gr-combo__icon">' + SEARCH + '</span>' +
            '<input type="text" class="gr-combo__input" id="' + id + '" role="combobox" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + '-list">' +
            '<ul class="gr-combo__list" id="' + id + '-list" role="listbox" hidden></ul>' +
            '<p class="gr-combo__status" role="status"></p>';
        holder.insertBefore(box, select);
        var input = box.querySelector('input'), list = box.querySelector('ul'), status = box.querySelector('.gr-combo__status');
        var ward = select.name === 'ward';
        input.placeholder = ward ? t('Γράψε ένα κομμάτι του ονόματος', 'Type part of the name')
            : t('Γράψε ένα κομμάτι του ονόματος, π.χ. «αρι»', 'Type part of the name, e.g. “ari”');
        var shown = [], active = -1;

        function render() {
            var q = plain(input.value.trim());
            var hits = [];
            options.forEach(function(o) {
                var at = q ? o.plain.indexOf(q) : 0;
                if (at < 0) { return; }
                var wordStart = at === 0 || /[\s\-(]/.test(o.plain.charAt(at - 1));
                hits.push({ o: o, at: at, rank: q ? (wordStart ? 0 : 1) : 0 });
            });
            hits.sort(function(a, b) { return a.rank - b.rank || a.o.plain.localeCompare(b.o.plain, 'el'); });
            shown = hits.slice(0, MAX);
            active = shown.length ? 0 : -1;
            list.innerHTML = shown.map(function(h, i) {
                var n = h.o.name, label = escape(n);
                if (q) { label = escape(n.slice(0, h.at)) + '<mark>' + escape(n.slice(h.at, h.at + q.length)) + '</mark>' + escape(n.slice(h.at + q.length)); }
                return '<li role="option" id="' + id + '-o' + i + '" class="gr-combo__option" style="--i:' + Math.min(i, 12) + '"' +
                    (i === active ? ' aria-selected="true"' : '') + '>' + label + '</li>';
            }).join('') || '<li class="gr-combo__empty">' + (ward ? t('Δεν βρέθηκε περιοχή με αυτό το κείμενο.', 'No area matches that.')
                : t('Δεν βρέθηκε δήμος με αυτό το κείμενο.', 'No municipality matches that.')) + '</li>';
            status.textContent = q ? (hits.length + ' ' + t(hits.length === 1 ? 'αποτέλεσμα' : 'αποτελέσματα', hits.length === 1 ? 'result' : 'results')) : '';
            open(true);
            mark();
        }
        function open(yes) {
            list.hidden = !yes;
            input.setAttribute('aria-expanded', yes ? 'true' : 'false');
            box.classList.toggle('gr-combo--open', yes);
        }
        function mark() {
            Array.prototype.forEach.call(list.querySelectorAll('.gr-combo__option'), function(li, i) {
                if (i === active) { li.setAttribute('aria-selected', 'true'); li.scrollIntoView({ block: 'nearest' }); }
                else { li.removeAttribute('aria-selected'); }
            });
            if (active >= 0) { input.setAttribute('aria-activedescendant', id + '-o' + active); } else { input.removeAttribute('aria-activedescendant'); }
        }
        function choose(i) {
            var h = shown[i];
            if (!h) { return; }
            input.value = h.o.name;
            select.value = h.o.value;
            open(false);
            box.classList.add('gr-combo--chosen');
            if (select.form) { select.form.submit(); }
        }

        input.addEventListener('input', render);
        input.addEventListener('focus', render);
        input.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (list.hidden) { render(); return; }
                if (shown.length) { active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; mark(); }
            } else if (e.key === 'Enter') {
                if (!list.hidden && active >= 0) { e.preventDefault(); choose(active); }
                else if (!select.value) { e.preventDefault(); }
            } else if (e.key === 'Escape') {
                open(false);
            }
        });
        list.addEventListener('mousedown', function(e) { e.preventDefault(); });   // keep the focus in the box
        list.addEventListener('click', function(e) {
            var li = e.target.closest('.gr-combo__option');
            if (li) { choose(Array.prototype.indexOf.call(list.children, li)); }
        });
        input.addEventListener('blur', function() { setTimeout(function() { open(false); }, 120); });
        if (select.form) {
            select.form.addEventListener('submit', function(e) {
                if (!select.value && shown[active]) { e.preventDefault(); choose(active); }
                else if (!select.value) { e.preventDefault(); input.focus(); }
            });
        }
    }

    function start() {
        Array.prototype.forEach.call(document.querySelectorAll('.dashboard-search select[name="body"], .dashboard-search select[name="ward"]'), enhance);
    }
    // Straight away (this script comes after the form), before FixMyStreet sets up its own autocomplete
    // on DOM ready, and again then in case the page was put together differently.
    start();
    document.addEventListener('DOMContentLoaded', start);
})();
