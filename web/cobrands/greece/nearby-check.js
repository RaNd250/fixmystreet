/*
 * Report form: when an open report is already within 100 m of the pin (FixMyStreet's /around/nearby,
 * mode "suggestions", whose distance Greece.pm nearby_distances sets to 100 m; any category; only
 * public reports), a notice at the top of the form asks the reporter to check it is not the same
 * problem, with links to those reports. It follows the pin as it moves, and can be closed. It only
 * warns: the report can still be sent.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }
    var lastKey = '', lastPins = null, closedKey = '', busy = false;

    function metres(lat1, lon1, lat2, lon2) {
        var r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function remove() {
        var old = document.getElementById('gr-nearby');
        if (old) { old.parentNode.removeChild(old); }
    }

    function show(form, lat, lon, pins, key) {
        remove();
        if (!pins.length || key === closedKey) { return; }
        var items = pins.slice(0, 3).map(function(p) {
            var d = Math.max(5, Math.round(metres(lat, lon, p[0], p[1]) / 5) * 5);
            return '<li><a href="/report/' + encodeURIComponent(p[3]) + '" target="_blank" rel="noopener">' +
                esc(p[4] || t('Αναφορά', 'Report')) + '</a> <span>~' + d + ' ' + t('μ.', 'm') + '</span></li>';
        }).join('');
        var box = document.createElement('div');
        box.id = 'gr-nearby';
        box.className = 'gr-nearby';
        box.setAttribute('role', 'status');
        box.innerHTML =
            '<button type="button" class="gr-nearby__close" aria-label="' + t('Κλείσιμο', 'Close') + '">×</button>' +
            '<strong>' + (pins.length > 1
                ? t('Υπάρχουν ήδη ' + pins.length + ' ενεργές αναφορές κοντά', 'There are already ' + pins.length + ' open reports nearby')
                : t('Υπάρχει ήδη ενεργή αναφορά κοντά', 'There is already an open report nearby')) + '</strong>' +
            '<p>' + t('Σε απόσταση έως 100 μ. Δες μήπως είναι το ίδιο πρόβλημα· αν ναι, πρόσθεσε εκεί μια ενημέρωση αντί για νέα αναφορά.',
                'Within 100 m. Check whether it is the same problem; if so, add an update there instead of a new report.') + '</p>' +
            '<ul>' + items + '</ul>';
        box.querySelector('.gr-nearby__close').addEventListener('click', function() {
            closedKey = key;
            remove();
        });
        var first = form.querySelector('.js-reporting-page') || form;
        first.insertBefore(box, first.firstChild);
    }

    function check() {
        var form = document.getElementById('problem_form');
        var latEl = document.querySelector('input[name="latitude"]');
        var lonEl = document.querySelector('input[name="longitude"]');
        if (!form || !latEl || !lonEl || busy) { return; }
        var lat = parseFloat(latEl.value), lon = parseFloat(lonEl.value);
        if (!isFinite(lat) || !isFinite(lon)) { return; }
        var key = lat.toFixed(5) + ',' + lon.toFixed(5);
        if (key === lastKey) {
            // The same spot; the form may have been redrawn without the notice.
            if (lastPins && !document.getElementById('gr-nearby')) { show(form, lat, lon, lastPins, key); }
            return;
        }
        lastKey = key;
        lastPins = null;
        busy = true;
        var url = '/around/nearby?mode=suggestions&pin_size=normal&latitude=' + encodeURIComponent(lat) +
            '&longitude=' + encodeURIComponent(lon);
        fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
            .then(function(r) { return r.ok ? r.json() : { pins: [] }; })
            .then(function(data) {
                lastPins = Array.isArray(data.pins) ? data.pins : [];
                show(form, lat, lon, lastPins, key);
            })
            .catch(function() { /* the notice is only a help */ })
            .then(function() { busy = false; });
    }

    // The form arrives with the page or, on wider screens, after a click on the map; the pin can
    // move afterwards. Checking the coordinates every second covers all of these.
    check();
    setInterval(check, 1000);
})();
