/*
 * Report form: «🎬 Βίντεο», next to the photo buttons (camera.js), adds one video of up to 45 seconds.
 *
 * It offers «Εγγραφή τώρα», recorded inside the page (getUserMedia + MediaRecorder, stops by itself
 * at 45 s), and «Από τη συλλογή» (a file). Recording in the page matters on phones: opening the
 * phone's camera app from a file input often gets the browser tab discarded, and back from the
 * camera the page reloads and the video is lost (owner, 2026-10-26). Where the browser cannot record,
 * the button goes straight to the file.
 *
 * The file goes up in 9 MB slices (the Cloudflare tunnel refuses bodies over ~95 MB) to
 * App::Controller::GreeceVideo, with a progress bar (per cent and MB), then is checked and re-encoded
 * to 720p without metadata while the box says so; then «✓ Βίντεο 0:32» with ✕ to take it off. The
 * report carries its id in greece_video; it is never published, only the service sees it. Sending
 * the report waits for the video.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }
    var MAX_BYTES = 300 * 1024 * 1024, MAX_SECONDS = 45.5, LIMIT = 45;
    var canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder &&
        window.isSecureContext && window.HTMLDialogElement);

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

    function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
    function mb(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB'; }

    // ---- Recording in the page -------------------------------------------------------------------

    var rec = {};
    function recorderDialog(onDone, onFiles) {
        if (!rec.dialog) {
            var d = document.createElement('dialog');
            d.className = 'gr-camera gr-rec';
            d.setAttribute('aria-label', t('Εγγραφή βίντεο', 'Record a video'));
            d.innerHTML =
                '<div class="gr-camera__frame"><video class="gr-camera__video" playsinline muted autoplay></video>' +
                '<span class="gr-rec__time" hidden></span></div>' +
                '<p class="gr-camera__status" role="status" hidden></p>' +
                '<div class="gr-camera__actions">' +
                  '<button type="button" class="btn gr-rec__cancel">' + t('Άκυρο', 'Cancel') + '</button>' +
                  '<button type="button" class="btn gr-rec__files" hidden>' + t('Από τη συλλογή', 'From the gallery') + '</button>' +
                  '<button type="button" class="btn btn--primary gr-rec__go" disabled><span class="gr-rec__dot" aria-hidden="true"></span><span>' + t('Έναρξη', 'Start') + '</span></button>' +
                '</div>';
            document.body.appendChild(d);
            rec.dialog = d;
            rec.video = d.querySelector('video');
            rec.time = d.querySelector('.gr-rec__time');
            rec.status = d.querySelector('.gr-camera__status');
            rec.go = d.querySelector('.gr-rec__go');
            rec.files = d.querySelector('.gr-rec__files');
            d.querySelector('.gr-rec__cancel').addEventListener('click', function() { rec.cancelled = true; close(); });
            d.addEventListener('close', function() { rec.cancelled = rec.cancelled || !rec.finished; stop(); });
            rec.go.addEventListener('click', function() { rec.recorder && rec.recorder.state === 'recording' ? finish() : start(); });
            rec.files.addEventListener('click', function() { close(); rec.onFiles && rec.onFiles(); });
        }
        rec.onDone = onDone; rec.onFiles = onFiles; rec.cancelled = false; rec.finished = false; rec.chunks = [];
        rec.time.hidden = true; rec.files.hidden = true;
        setGo(t('Έναρξη', 'Start'), false);
        rec.go.disabled = true;
        say(t('Άνοιγμα κάμερας…', 'Opening the camera…'));
        rec.dialog.showModal();
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true
        }).catch(function() {
            // No microphone (or no permission for it): a video without sound is still useful.
            return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        }).then(function(s) {
            rec.stream = s;
            rec.video.srcObject = s;
            return rec.video.play();
        }).then(function() {
            say('');
            rec.go.disabled = false;
        }).catch(function() {
            say(t('Η κάμερα δεν άνοιξε (ίσως δεν δόθηκε άδεια). Μπορείς να επιλέξεις βίντεο από τη συλλογή.',
                'The camera did not open (maybe no permission). You can pick a video from the gallery.'));
            rec.files.hidden = false;
        });

        function say(text) { rec.status.textContent = text; rec.status.hidden = !text; }
        function setGo(label, recording) {
            rec.go.querySelector('span:last-child').textContent = label;
            rec.go.classList.toggle('gr-rec__go--on', recording);
        }
        function start() {
            var types = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
            var type = types.filter(function(x) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(x); })[0];
            try {
                rec.recorder = new MediaRecorder(rec.stream, type ? { mimeType: type, videoBitsPerSecond: 2500000 } : {});
            } catch (e) {
                say(t('Η εγγραφή δεν είναι δυνατή σε αυτόν τον browser.', 'Recording is not possible in this browser.'));
                rec.files.hidden = false;
                return;
            }
            rec.chunks = [];
            rec.recorder.ondataavailable = function(e) { if (e.data && e.data.size) { rec.chunks.push(e.data); } };
            rec.recorder.onstop = function() {
                if (rec.cancelled || !rec.chunks.length) { return; }
                var mime = (rec.recorder.mimeType || 'video/webm').split(';')[0];
                var blob = new Blob(rec.chunks, { type: mime });
                var name = 'video-' + new Date().toISOString().replace(/[:.]/g, '-') + (/mp4/.test(mime) ? '.mp4' : '.webm');
                var file;
                try { file = new File([blob], name, { type: mime }); } catch (e) { file = blob; file.name = name; }
                rec.onDone(file, (Date.now() - rec.started) / 1000);
            };
            rec.recorder.start(1000);
            rec.started = Date.now();
            setGo(t('Τέλος', 'Stop'), true);
            rec.time.hidden = false;
            tick();
            rec.timer = setInterval(tick, 250);
        }
        function tick() {
            var s = (Date.now() - rec.started) / 1000;
            rec.time.textContent = '● ' + mmss(s) + ' / ' + mmss(LIMIT);
            if (s >= LIMIT) { finish(); }
        }
        function finish() { rec.finished = true; close(); }
        function stop() {
            clearInterval(rec.timer);
            if (rec.recorder && rec.recorder.state === 'recording') { rec.recorder.stop(); }
            if (rec.stream) { rec.stream.getTracks().forEach(function(tr) { tr.stop(); }); rec.stream = null; }
            rec.video.srcObject = null;
        }
        function close() { if (rec.dialog.open) { rec.dialog.close(); } else { stop(); } }
    }

    // ---- The box on the form, and the upload --------------------------------------------------

    function ui(form) {
        var actions = form.querySelector('.gr-photo-actions');
        if (!actions || actions.querySelector('.gr-video-btn')) { return; }
        var state = 'none';   // none | choosing | uploading | working | ready | error
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
            show('<span>' + msg + '</span><button type="button" class="gr-video-x" aria-label="' + t('Κλείσιμο', 'Close') + '">✕</button>', 'gr-video-box--bad');
            box.querySelector('.gr-video-x').onclick = reset;
        }
        var REASON = {
            too_long: t('Το βίντεο είναι μεγαλύτερο από 45 δευτερόλεπτα.', 'The video is longer than 45 seconds.'),
            not_video: t('Το αρχείο δεν είναι βίντεο που μπορούμε να διαβάσουμε.', 'That file is not a video we can read.'),
            too_big: t('Το αρχείο είναι πολύ μεγάλο (έως 300 MB).', 'The file is too big (up to 300 MB).')
        };
        var GENERIC = t('Το βίντεο δεν ανέβηκε. Δοκίμασε ξανά.', 'The video did not upload. Try again.');

        function choose() {
            if (!canRecord) { return input.click(); }
            state = 'choosing';
            show('<span class="gr-video-choice">' +
                '<button type="button" class="btn btn--primary gr-video-rec">● ' + t('Εγγραφή τώρα', 'Record now') + '</button>' +
                '<button type="button" class="btn gr-video-file">' + t('Από τη συλλογή', 'From the gallery') + '</button></span>' +
                '<button type="button" class="gr-video-x" aria-label="' + t('Κλείσιμο', 'Close') + '">✕</button>');
            box.querySelector('.gr-video-x').onclick = reset;
            box.querySelector('.gr-video-file').onclick = function() { input.click(); };
            box.querySelector('.gr-video-rec').onclick = function() {
                recorderDialog(function(file, secs) { upload(file, secs); }, function() { input.click(); });
            };
        }

        function upload(file, knownSecs) {
            if (file.size > MAX_BYTES) { return fail(REASON.too_big); }
            btn.disabled = true;
            (knownSecs ? Promise.resolve(knownSecs) : secondsOf(file)).then(function(secs) {
                if (secs > MAX_SECONDS) { throw REASON.too_long; }
                state = 'uploading';
                show('<span class="gr-video-up"><span class="gr-video-up__label">' + t('Ανέβασμα βίντεο', 'Uploading video') +
                    ' <b class="gr-video-up__pc">0%</b> <small class="gr-video-up__mb">0 / ' + mb(file.size) + '</small></span>' +
                    '<span class="gr-video-up__bar"><span class="gr-video-up__fill" style="width:0%"></span></span></span>' +
                    '<button type="button" class="gr-video-x" aria-label="' + t('Ακύρωση', 'Cancel') + '">✕</button>');
                box.querySelector('.gr-video-x').onclick = reset;
                var fill = box.querySelector('.gr-video-up__fill'), pc = box.querySelector('.gr-video-up__pc'), mbs = box.querySelector('.gr-video-up__mb');
                function progress(n) {
                    var p = Math.min(100, Math.round(100 * n / file.size));
                    fill.style.width = p + '%'; pc.textContent = p + '%'; mbs.textContent = mb(n) + ' / ' + mb(file.size);
                }
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
                                progress(offset);
                                return next();
                            }, function() { if (++tries > 3) { throw GENERIC; } return next(); });
                    }
                    return next().then(function() { return req('POST', '/greece/video/finish/' + id); }).then(function(r) {
                        if (r.state !== 'working') { throw GENERIC; }
                        state = 'working';
                        show('<span>' + t('Επεξεργασία βίντεο…', 'Processing video…') + '</span><span class="gr-video-spin" aria-hidden="true"></span>');
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
                            t('το βλέπει μόνο η υπηρεσία', 'seen only by the service') + '</span><button type="button" class="gr-video-x" aria-label="' +
                            t('Αφαίρεση βίντεο', 'Remove video') + '">✕</button>', 'gr-video-box--ok');
                        box.querySelector('.gr-video-x').onclick = reset;
                    });
                });
            }).catch(function(msg) { if (msg !== 'stopped') { fail(typeof msg === 'string' ? msg : GENERIC); } });
        }

        btn.addEventListener('click', choose);
        input.addEventListener('change', function() {
            var file = input.files && input.files[0];
            if (file) { upload(file); }
        });

        // The report is sent once the video is ready (or taken off).
        form.addEventListener('submit', function(e) {
            if (state === 'uploading' || state === 'working') {
                e.preventDefault(); e.stopImmediatePropagation();
                if (!box.querySelector('.gr-video-wait')) {
                    var p = document.createElement('p');
                    p.className = 'gr-video-wait';
                    p.textContent = t('Περίμενε να ολοκληρωθεί το βίντεο ή αφαίρεσέ το.', 'Wait for the video to finish, or remove it.');
                    box.appendChild(p);
                }
                box.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
