/*
 * The report form keeps what the reporter has entered if they leave it by mistake (the back button,
 * a link, a reload) and come back: the description, name, email, phone, the category and its
 * questions, and the photos already uploaded. It is kept in sessionStorage, so only in this tab and
 * until the tab is closed, and it is removed once the report is made (the confirmation page).
 *
 * The category list and the category's questions are loaded into the form by fixmystreet.js after
 * the page (and on /around, the whole form when the map is clicked), so whatever is not on the page
 * yet is filled in when it appears, and only into fields that are still empty.
 */
(function() {
    'use strict';
    // The page's language (the menu's switch): English texts when it is English.
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }


    var KEY = 'gr-report-draft';
    var MAX_AGE = 24 * 3600 * 1000;
    // Hidden and technical fields that are never kept; upload_fileid (the photos) is kept apart.
    var SKIP = /^(token|submit_|latitude|longitude|lat|lon|zoom|pc|single_body_only|do_not_send|service|partial|photo_id|upload_fileid|password|oauth_|form_photo|photo\d|category)/;

    function storage() {
        try { return window.sessionStorage; } catch (e) { return null; }
    }
    function load() {
        var s = storage(), d = null;
        if (!s) { return null; }
        try { d = JSON.parse(s.getItem(KEY) || 'null'); } catch (e) { d = null; }
        if (d && (!d.saved || Date.now() - d.saved > MAX_AGE)) { d = null; }
        return d;
    }
    function forget() {
        var s = storage();
        if (s) { try { s.removeItem(KEY); } catch (e) {} }
    }

    function reportForm() {
        var detail = document.getElementById('form_detail');
        return detail && detail.form && detail.form.id === 'mapForm' ? detail.form : null;
    }

    function fields(form) {
        return Array.prototype.filter.call(form.elements, function(el) {
            return el.name && !SKIP.test(el.name) && el.type !== 'hidden' && el.type !== 'file' &&
                el.type !== 'submit' && el.type !== 'button';
        });
    }

    function save() {
        var form = reportForm(), s = storage();
        if (!form || !s || restoring) { return; }
        var values = {}, any = false;
        fields(form).forEach(function(el) {
            if (el.type === 'checkbox' || el.type === 'radio') {
                if (el.checked) { values[el.name] = el.value; } else if (el.type === 'checkbox' && !(el.name in values)) { values[el.name] = null; }
            } else if (el.value !== '' && !(el.dataset && el.dataset.grDefault === el.value)) {   // not detail-default.js's ready text
                values[el.name] = el.value;
                any = any || /^(detail|pinakida)$/.test(el.name);
            }
        });
        var category = form.querySelector('input[name=category]:checked');
        var photos = form.querySelector('input[name=upload_fileid]');
        var draft = { saved: Date.now(), values: values, category: category ? category.value : '',
                      photos: photos ? photos.value : '' };
        if (!any && !draft.photos && !draft.category) { return; }
        try { s.setItem(KEY, JSON.stringify(draft)); } catch (e) {}
    }

    var timer;
    function saveSoon() {
        clearTimeout(timer);
        timer = setTimeout(save, 300);
    }

    // Restoring: what is still to be filled in, tried again whenever the form changes.
    var pending = null, restoring = false, notice = null;

    // Fills in one field, unless it has a value already; true if it changed.
    function setValue(el, value) {
        if (el.type === 'checkbox') {
            if (el.checked === (value === el.value)) { return false; }
            el.checked = value === el.value;
        } else if (el.type === 'radio') {
            if (el.value !== value || el.checked) { return false; }
            el.checked = true;
        } else if (el.value === '') {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            return false;
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function restorePhotos(form) {
        var input = form.querySelector('input[name=upload_fileid]');
        var zone = form.querySelector('.dropzone');
        var dz = zone && zone.dropzone;
        if (!input || !dz || !window.Dropzone) { return false; }
        if (input.value || dz.files.length) { return true; }   // the reporter has added photos already
        input.value = pending.photos;
        pending.photos.split(',').forEach(function(id) {
            if (!id) { return; }
            // As fixmystreet.js does for photos the server sends back with the form.
            var mock = { name: id, server_id: id, dataURL: '/photo/temp.' + id, status: Dropzone.SUCCESS, accepted: true };
            dz.emit('addedfile', mock);
            dz.createThumbnailFromUrl(mock, dz.options.thumbnailWidth, dz.options.thumbnailHeight,
                dz.options.thumbnailMethod, true, function(thumb) { dz.emit('thumbnail', mock, thumb); });
            dz.emit('complete', mock);
            dz.files.push(mock);
        });
        if (dz._updateMaxFilesReachedClass) { dz._updateMaxFilesReachedClass(); }
        // fixmystreet.js disables the submit buttons on "addedfile" until an upload queue completes.
        Array.prototype.forEach.call(form.querySelectorAll('input[type=submit]'), function(b) { b.disabled = false; });
        return true;
    }

    function showNotice(form) {
        if (notice && document.body.contains(notice)) { return; }
        var detail = document.getElementById('form_detail');
        if (!detail) { return; }
        notice = document.createElement('p');
        notice.className = 'gr-draft-notice';
        notice.setAttribute('role', 'status');
        notice.innerHTML = t('Συμπληρώσαμε ό,τι είχες γράψει πριν.', 'We filled in what you had written before.') +
            ' <button type="button" class="gr-draft-notice__clear">' + t('Καθαρισμός', 'Clear') + '</button>';
        // "Καθαρισμός" empties the description and the photos and forgets the draft.
        notice.querySelector('button').addEventListener('click', function() {
            forget();
            pending = null;
            var detail = document.getElementById('form_detail');
            if (detail) { detail.value = ''; }
            var zone = form.querySelector('.dropzone');
            if (zone && zone.dropzone) { zone.dropzone.removeAllFiles(true); }
            notice.remove();
            if (detail) { detail.focus(); }
        });
        detail.parentNode.insertBefore(notice, detail);
    }

    function tryRestore() {
        var form = reportForm();
        if (!pending || !form) { return; }
        restoring = true;
        try {
            if (pending.category) {
                var radio = form.querySelector('input[name=category][value="' + pending.category.replace(/["\\]/g, '\\$&') + '"]');
                if (radio) {
                    if (!form.querySelector('input[name=category]:checked')) {
                        radio.checked = true;
                        radio.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    pending.category = '';
                }
            }
            var restored = false;
            fields(form).forEach(function(el) {
                if (!(el.name in pending.values)) { return; }
                var value = pending.values[el.name];
                if (value !== null && setValue(el, value) && el.type !== 'checkbox') { restored = true; }
                if (el.type !== 'radio') { delete pending.values[el.name]; }
                else if (el.value === value) { delete pending.values[el.name]; }
            });
            if (pending.photos && restorePhotos(form)) { pending.photos = ''; restored = true; }
            if (restored) { showNotice(form); }
            if (!pending.category && !pending.photos && !Object.keys(pending.values).length) { pending = null; }
        } finally {
            restoring = false;
        }
    }

    var queued = false;
    function schedule() {
        if (queued || !pending) { return; }
        queued = true;
        window.requestAnimationFrame(function() { queued = false; tryRestore(); });
    }

    function start() {
        if (document.querySelector('.confirmation-header') || /^\/report\/confirmation\//.test(location.pathname)) {
            forget();   // the report has been made
            return;
        }
        pending = load();
        tryRestore();
        if (window.MutationObserver) {
            new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
        }
        document.addEventListener('input', function(e) { if (e.target.form && e.target.form.id === 'mapForm') { saveSoon(); } }, true);
        document.addEventListener('change', function(e) { if (e.target.form && e.target.form.id === 'mapForm') { saveSoon(); } }, true);
        window.addEventListener('pagehide', save);
        document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') { save(); } });
        // Photos are added without an input event: save after each upload too.
        setInterval(function() {
            var form = reportForm(), input = form && form.querySelector('input[name=upload_fileid]');
            if (input && input.value !== (start.lastPhotos || '')) { start.lastPhotos = input.value; save(); }
        }, 1500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(start, 0); });
    } else {
        setTimeout(start, 0);
    }
})();
