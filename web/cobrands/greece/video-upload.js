/*
 * Report form: «🎬 Βίντεο», next to the photo buttons (camera.js), adds one video of up to 45 seconds.
 * The file goes up in 8 MB slices (the Cloudflare tunnel refuses bodies over ~95 MB) to
 * App::Controller::GreeceVideo, which has it checked and re-encoded to 720p without metadata; the box
 * shows the progress, then «✓ Βίντεο 0:32» with ✕ to take it off. The report carries its id in
 * greece_video; it is never published, only the service that receives the report sees it.
 * Sending the report waits for the video to be ready.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }
    var MAX_BYTES = 300 * 1024 * 1024, MAX_SECONDS = 45.5;
    var state = 'none';   // none | uploading | working | ready | error

    function req(method, url, body, headers) {
        var h = { 'X-Requested-With': 'XMLHttpRequest' };
        Object.keys(headers || {}).forEach(function(k) { h[k] = headers[k]; });
        return fetch(url, { method: method, body: body, headers: h, credentials: 'same-origin' })
            .then(function(r) { return r.json().catch(function() { return {}; }).then(function(j) { j._status = r.status; return j; }); });
    }

    function secondsOf(file) {
        return new Promise(function(resolve) {
            var v = document.createElement('video'), url = URL.createObjectURL(file), done = false;
            function end(x) { if (done) { return; } done = true; URL.revokeObjectURL(url); resolve(x); }
            v.preload = 'metadata';
            v.onloadedmetadata = function() { end(isFinite(v.duration) ? v.duration : NaN); };
            v.onerror = function() { end(NaN); };
            setTimeout(function() { end(NaN); }, 4000);   // some phones cannot read HEVC here: the server decides
            v.src = url;
        });
    }

    function mmss(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

    function ui(form) {
        var actions = form.querySelector('.gr-photo-actions');
        if (!actions || actions.querySelector('.gr-video-btn')) { return; }
        var input = document.createElement('input');
        input.type = 'file'; input.accept = 'video/*'; input.hidden = true;
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'btn gr-camera-btn gr-video-btn';
        btn.innerHTML = '<span aria-hidden="true">🎬</span><span>' + t('Βίντεο', 'Video') + '</span>';
        var box = document.createElement('div');
        box.className = 'gr-video-box'; box.hidden = true; box.setAttribute('role', 'status');
        var hidden = document.createElement('input');
        hidden.type = 'hidden'; hidden.name = 'greece_video';
        actions.appendChild(btn); actions.appendChild(input);
        actions.parentNode.insertBefore(box, actions.nextSibling);
        form.appendChild(hidden);

        function show(html, cls) { box.hidden = false; box.className = 'gr-video-box ' + (cls || ''); box.innerHTML = html; }
        function reset() { state = 'none'; hidden.value = ''; box.hidden = true; btn.disabled = false; input.value = ''; }
        function fail(msg) {
            state = 'error'; hidden.value = ''; btn.disabled = false; input.value = '';
            show('<span>' + msg + '</span> <button type="button" class="gr-video-x" aria-label="' + t('Κλείσιμο', 'Close') + '">✕</button>', 'gr-video-box--bad');
            box.querySelector('.gr-video-x').onclick = reset;
        }
        var REASON = {
            too_long: t('Το βίντεο είναι μεγαλύτερο από 45 δευτερόλεπτα.', 'The video is longer than 45 seconds.'),
            not_video: t('Το αρχείο δεν είναι βίντεο που μπορούμε να διαβάσουμε.', 'That file is not a video we can read.'),
            too_big: t('Το αρχείο είναι πολύ μεγάλο (έως 300 MB).', 'The file is too big (up to 300 MB).')
        };
        var GENERIC = t('Το βίντεο δεν ανέβηκε. Δοκίμασε ξανά.', 'The video did not upload. Try again.');

        btn.addEventListener('click', function() { input.click(); });
        input.addEventListener('change', function() {
            var file = input.files && input.files[0];
            if (!file) { return; }
            if (file.size > MAX_BYTES) { return fail(REASON.too_big); }
            btn.disabled = true;
            secondsOf(file).then(function(secs) {
                if (secs > MAX_SECONDS) { return fail(REASON.too_long); }
                state = 'uploading';
                show('<span>' + t('Ανέβασμα βίντεο…', 'Uploading video…') + '</span> <progress max="100" value="0"></progress>');
                var bar = box.querySelector('progress');
                return req('POST', '/greece/video/start', new URLSearchParams({ size: file.size })).then(function(st) {
                    if (!st.id) { throw st.error === 'too_big' ? REASON.too_big : GENERIC; }
                    var id = st.id, size = st.chunk || 8 * 1024 * 1024, offset = 0, tries = 0;
                    function next() {
                        if (state !== 'uploading') { return Promise.reject('stopped'); }
                        if (offset >= file.size) { return Promise.resolve(); }
                        var part = file.slice(offset, Math.min(offset + size, file.size));
                        return req('POST', '/greece/video/chunk/' + id + '?offset=' + offset, part, { 'Content-Type': 'application/octet-stream' })
                            .then(function(r) {
                                if (typeof r.received === 'number') { offset = r.received; tries = 0; }
                                else if (++tries > 3) { throw GENERIC; }
                                bar.value = Math.round(100 * offset / file.size);
                                return next();
                            }, function() { if (++tries > 3) { throw GENERIC; } return next(); });
                    }
                    return next().then(function() { return req('POST', '/greece/video/finish/' + id); }).then(function(r) {
                        if (r.state !== 'working') { throw GENERIC; }
                        state = 'working';
                        show('<span>' + t('Επεξεργασία βίντεο…', 'Processing video…') + '</span> <span class="gr-video-spin" aria-hidden="true"></span>');
                        return new Promise(function(resolve, reject) {
                            (function poll() {
                                req('GET', '/greece/video/status/' + id).then(function(s) {
                                    if (state !== 'working') { return reject('stopped'); }
                                    if (s.state === 'ready') { return resolve(s); }
                                    if (s.state === 'error') { return reject(REASON[s.reason] || GENERIC); }
                                    setTimeout(poll, 2000);
                                }, function() { setTimeout(poll, 4000); });
                            })();
                        });
                    }).then(function(s) {
                        state = 'ready'; hidden.value = id; btn.disabled = true;
                        show('<span>✓ ' + t('Βίντεο', 'Video') + ' ' + mmss(s.duration) + ' · ' +
                            t('το βλέπει μόνο η υπηρεσία', 'seen only by the service') + '</span> <button type="button" class="gr-video-x" aria-label="' +
                            t('Αφαίρεση βίντεο', 'Remove video') + '">✕</button>', 'gr-video-box--ok');
                        box.querySelector('.gr-video-x').onclick = reset;
                    });
                });
            }).catch(function(msg) { if (msg !== 'stopped') { fail(typeof msg === 'string' ? msg : GENERIC); } });
        });

        // The report is sent once the video is ready (or taken off).
        form.addEventListener('submit', function(e) {
            if (state === 'uploading' || state === 'working') {
                e.preventDefault(); e.stopImmediatePropagation();
                show(box.innerHTML.replace(/<p class="gr-video-wait">.*<\/p>/, '') + '<p class="gr-video-wait">' +
                    t('Περίμενε να ολοκληρωθεί το βίντεο ή αφαίρεσέ το.', 'Wait for the video to finish, or remove it.') + '</p>');
            }
        }, true);
    }

    function scan() {
        var detail = document.getElementById('form_detail');
        if (detail && detail.form) { ui(detail.form); }
    }
    var queued = false;
    function start() {
        scan();
        if (window.MutationObserver) {
            new MutationObserver(function() {
                if (queued) { return; }
                queued = true;
                window.requestAnimationFrame(function() { queued = false; scan(); });
            }).observe(document.body, { childList: true, subtree: true });
        }
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start); } else { start(); }
})();
