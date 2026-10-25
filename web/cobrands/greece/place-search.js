/*
 * Suggestions while typing in the address box ("Γράψε μία κοντινή οδό ή περιοχή").
 *
 * /places (nginx) asks Photon, which is made for search-as-you-type; the form's own search
 * uses Nominatim, whose usage policy does not allow it. Picking a suggestion submits the form
 * with its coordinates, so /around opens there; Enter without a pick still does the normal search.
 * The list looks and moves like the municipality search on the reports page (dimos-search.js,
 * theme.css .gr-places): the typed words are highlighted, ignoring accents, and an empty search says so.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }

    var input = document.getElementById('pc');
    var form = input && input.form;
    if (!input || !form || !window.fetch) { return; }

    var MIN = 3, DELAY = 250;
    var list = document.createElement('ul');
    list.id = 'pc-suggestions';
    list.className = 'gr-places';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    input.parentNode.classList.add('gr-places-wrap');
    input.parentNode.appendChild(list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');
    var status = document.createElement('p');
    status.className = 'gr-places__status';
    status.setAttribute('role', 'status');
    input.parentNode.appendChild(status);

    var items = [], active = -1, timer, controller, last = '';

    // Lower case without accents or diaeresis, final sigma as sigma, for comparing; each letter stays
    // one character, so a position in plain() is the same position in the text.
    function plain(s) {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ς/g, 'σ');
    }
    function escape(s) { return s.replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    // The text with every typed word (two letters or more) in it marked.
    function marked(text, q) {
        var p = plain(text), on = [];
        plain(q).split(/[\s,]+/).filter(function(w) { return w.length > 1; }).forEach(function(w) {
            for (var at = p.indexOf(w); at >= 0; at = p.indexOf(w, at + w.length)) {
                for (var k = at; k < at + w.length; k++) { on[k] = true; }
            }
        });
        var out = '', open = false;
        for (var i = 0; i < text.length; i++) {
            if (!!on[i] !== open) { out += open ? '</mark>' : '<mark>'; open = !open; }
            out += escape(text.charAt(i));
        }
        return out + (open ? '</mark>' : '');
    }

    function close() {
        list.hidden = true;
        status.textContent = '';
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
    }

    // "Φαβιέρου" + "Δήμος Χαϊδαρίου, 124 61", from Photon's GeoJSON properties.
    function describe(p) {
        var main = p.name || [p.street, p.housenumber].filter(Boolean).join(' ');
        if (p.name && p.street && p.name !== p.street) {
            main += ', ' + [p.street, p.housenumber].filter(Boolean).join(' ');
        }
        var place = p.district || p.city || p.locality || p.county || '';
        if (place === main) { place = p.city && p.city !== main ? p.city : ''; }
        return { main: main, context: [place, p.postcode].filter(Boolean).join(', ') };
    }

    // Bus stops are named after their street ("ΦΑΒΙΕΡΟΥ") and crowd out the street itself.
    function isStop(f) {
        var p = f.properties || {};
        return p.osm_key === 'public_transport' ||
            (p.osm_key === 'highway' && /^(bus_stop|platform|stop|stop_position)$/.test(p.osm_value || ''));
    }

    function show(features) {
        var seen = {};
        items = [];
        var places = features.filter(function(f) { return !isStop(f); });
        (places.length ? places : features).forEach(function(f) {
            var c = f.geometry && f.geometry.coordinates;
            if (!c) { return; }
            var d = describe(f.properties || {});
            var key = d.main + '|' + d.context;
            if (!d.main || seen[key]) { return; }
            seen[key] = true;
            items.push({ main: d.main, context: d.context, lon: c[0], lat: c[1] });
        });
        list.innerHTML = '';
        var q = input.value.trim();
        if (!items.length) {
            var empty = document.createElement('li');
            empty.className = 'gr-places__empty';
            empty.textContent = t('Δεν βρέθηκε διεύθυνση με αυτό το κείμενο. Πάτα «Εμπρός» για πλήρη αναζήτηση.',
                'No address matches that. Press “Go” for a full search.');
            list.appendChild(empty);
            status.textContent = empty.textContent;
            list.hidden = false;
            input.setAttribute('aria-expanded', 'false');
            active = -1;
            return;
        }
        status.textContent = Math.min(items.length, 6) + ' ' + t('προτάσεις', 'suggestions');
        items.slice(0, 6).forEach(function(item, i) {
            var li = document.createElement('li');
            li.id = 'pc-suggestion-' + i;
            li.setAttribute('role', 'option');
            li.className = 'gr-places__item';
            li.style.setProperty('--i', i);
            var main = document.createElement('span');
            main.className = 'gr-places__main';
            main.innerHTML = marked(item.main, q);
            li.appendChild(main);
            if (item.context) {
                var ctx = document.createElement('span');
                ctx.className = 'gr-places__context';
                ctx.textContent = item.context;
                li.appendChild(ctx);
            }
            // mousedown, so the pick happens before the input loses focus
            li.addEventListener('mousedown', function(e) { e.preventDefault(); pick(i); });
            list.appendChild(li);
        });
        var credit = document.createElement('li');
        credit.className = 'gr-places__credit';
        credit.setAttribute('aria-hidden', 'true');
        credit.textContent = '© OpenStreetMap';
        list.appendChild(credit);
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        active = -1;
    }

    function highlight(i) {
        var options = list.querySelectorAll('[role=option]');
        if (!options.length) { return; }
        active = (i + options.length) % options.length;
        Array.prototype.forEach.call(options, function(o, n) {
            o.setAttribute('aria-selected', n === active ? 'true' : 'false');
        });
        input.setAttribute('aria-activedescendant', options[active].id);
        options[active].scrollIntoView({ block: 'nearest' });
    }

    function hidden(name, value) {
        var el = form.querySelector('input[type=hidden][name=' + name + ']');
        if (!el) {
            el = document.createElement('input');
            el.type = 'hidden';
            el.name = name;
            form.appendChild(el);
        }
        el.value = value;
    }

    function pick(i) {
        var item = items[i];
        if (!item) { return; }
        input.value = item.context ? item.main + ', ' + item.context : item.main;
        close();
        hidden('latitude', item.lat.toFixed(6));
        hidden('longitude', item.lon.toFixed(6));
        form.submit();
    }

    function search() {
        var q = input.value.trim();
        // A report reference ("24102026-3", "ref:12") is for the normal search.
        if (q.length < MIN || /^(ref:|\d{8}-\d+$)/i.test(q)) { close(); return; }
        if (q === last) { return; }
        last = q;
        if (controller) { controller.abort(); }
        controller = window.AbortController ? new AbortController() : null;
        fetch('/places?q=' + encodeURIComponent(q), controller ? { signal: controller.signal } : {})
            .then(function(r) { return r.ok ? r.json() : { features: [] }; })
            .then(function(data) {
                if (input.value.trim() === q) { show((data && data.features) || []); }
            })
            .catch(function() {});
    }

    input.addEventListener('input', function() {
        // Coordinates of an earlier pick no longer match what is typed (/around prefers them).
        Array.prototype.forEach.call(form.querySelectorAll('input[type=hidden][name=latitude], input[type=hidden][name=longitude]'),
            function(el) { el.parentNode.removeChild(el); });
        clearTimeout(timer);
        timer = setTimeout(search, DELAY);
    });
    input.addEventListener('keydown', function(e) {
        if (list.hidden) { return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
        else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
        else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', function() { setTimeout(close, 150); });
    input.addEventListener('focus', function() { last = ''; });
})();
