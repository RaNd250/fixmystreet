/*
 * Each photo picked or taken for a report or an update can be cropped before it is uploaded: a
 * dialog shows it with a frame that can be moved and resized (finger or mouse); «Περικοπή» sends
 * the part inside the frame, «Ολόκληρη» the photo as it is. It hooks into Dropzone's transformFile,
 * which runs just before the upload, and then hands over to Dropzone's own resizing. One dialog at
 * a time when several photos are picked together. GIFs are sent as they are (a crop would lose the
 * animation). The anonymiser blurs the cropped photo, so nothing is published outside the frame.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }
    if (!window.HTMLCanvasElement || !document.createElement('canvas').toBlob) { return; }

    var MIN = 48;   // smallest frame side, in screen pixels
    var queue = Promise.resolve();

    function build() {
        var d = document.createElement('dialog');
        d.className = 'gr-camera gr-crop';
        d.setAttribute('aria-label', t('Περικοπή φωτογραφίας', 'Crop photo'));
        d.innerHTML =
            '<div class="gr-crop__stage"><img class="gr-crop__img" alt=""><div class="gr-crop__box" tabindex="0" aria-label="' +
            t('Πλαίσιο περικοπής', 'Crop frame') + '">' +
            '<span class="gr-crop__h" data-h="nw"></span><span class="gr-crop__h" data-h="ne"></span>' +
            '<span class="gr-crop__h" data-h="sw"></span><span class="gr-crop__h" data-h="se"></span></div></div>' +
            '<p class="gr-camera__status">' + t('Σύρε το πλαίσιο ή τις γωνίες του για να κρατήσεις μόνο ό,τι χρειάζεται.',
                'Drag the frame or its corners to keep only what is needed.') + '</p>' +
            '<div class="gr-camera__actions">' +
            '<button type="button" class="btn gr-crop__whole">' + t('Ολόκληρη', 'Whole photo') + '</button>' +
            '<button type="button" class="btn btn--primary gr-crop__ok">' + t('Περικοπή', 'Crop') + '</button></div>';
        document.body.appendChild(d);
        return d;
    }

    // Shows the dialog for one image file; resolves with a Blob of the crop, or null for the whole photo.
    function ask(file) {
        return new Promise(function(resolve) {
            var d = build();
            var img = d.querySelector('.gr-crop__img'), box = d.querySelector('.gr-crop__box');
            var url = URL.createObjectURL(file);
            var r = { x: 0, y: 0, w: 0, h: 0 }, W = 0, H = 0, finished = false;

            function draw() {
                box.style.left = r.x + 'px'; box.style.top = r.y + 'px';
                box.style.width = r.w + 'px'; box.style.height = r.h + 'px';
            }
            function finish(blob) {
                if (finished) { return; }
                finished = true;
                URL.revokeObjectURL(url);
                if (d.open) { d.close(); }
                d.parentNode && d.parentNode.removeChild(d);
                resolve(blob);
            }
            img.onload = function() {
                W = img.clientWidth; H = img.clientHeight;
                r = { x: W * 0.05, y: H * 0.05, w: W * 0.9, h: H * 0.9 };
                draw();
            };
            img.onerror = function() { finish(null); };
            img.src = url;

            // Moving and resizing
            var drag = null;
            function down(e) {
                var h = e.target.getAttribute('data-h') || 'move';
                drag = { h: h, x0: e.clientX, y0: e.clientY, r0: { x: r.x, y: r.y, w: r.w, h: r.h } };
                box.setPointerCapture && box.setPointerCapture(e.pointerId);
                e.preventDefault();
            }
            function move(e) {
                if (!drag) { return; }
                var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0, o = drag.r0, n = { x: o.x, y: o.y, w: o.w, h: o.h };
                if (drag.h === 'move') {
                    n.x = Math.min(Math.max(0, o.x + dx), W - o.w);
                    n.y = Math.min(Math.max(0, o.y + dy), H - o.h);
                } else {
                    if (drag.h.indexOf('w') >= 0) { n.x = Math.min(Math.max(0, o.x + dx), o.x + o.w - MIN); n.w = o.x + o.w - n.x; }
                    if (drag.h.indexOf('e') >= 0) { n.w = Math.min(Math.max(MIN, o.w + dx), W - o.x); }
                    if (drag.h.indexOf('n') >= 0) { n.y = Math.min(Math.max(0, o.y + dy), o.y + o.h - MIN); n.h = o.y + o.h - n.y; }
                    if (drag.h.indexOf('s') >= 0) { n.h = Math.min(Math.max(MIN, o.h + dy), H - o.y); }
                }
                r = n; draw();
            }
            function up() { drag = null; }
            box.addEventListener('pointerdown', down);
            box.addEventListener('pointermove', move);
            box.addEventListener('pointerup', up);
            box.addEventListener('pointercancel', up);
            // Keyboard: arrows move the frame, with Shift they resize it.
            box.addEventListener('keydown', function(e) {
                var k = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key];
                if (!k) { return; }
                e.preventDefault();
                if (e.shiftKey) {
                    r.w = Math.min(Math.max(MIN, r.w + k[0]), W - r.x); r.h = Math.min(Math.max(MIN, r.h + k[1]), H - r.y);
                } else {
                    r.x = Math.min(Math.max(0, r.x + k[0]), W - r.w); r.y = Math.min(Math.max(0, r.y + k[1]), H - r.h);
                }
                draw();
            });

            d.querySelector('.gr-crop__whole').addEventListener('click', function() { finish(null); });
            d.addEventListener('cancel', function(e) { e.preventDefault(); finish(null); });
            d.querySelector('.gr-crop__ok').addEventListener('click', function() {
                if (!W || !H) { finish(null); return; }
                // The whole photo, near enough: send it as it is.
                if (r.w > W * 0.97 && r.h > H * 0.97) { finish(null); return; }
                var sx = img.naturalWidth / W, sy = img.naturalHeight / H;
                var c = document.createElement('canvas');
                c.width = Math.round(r.w * sx); c.height = Math.round(r.h * sy);
                c.getContext('2d').drawImage(img, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, c.width, c.height);
                c.toBlob(function(blob) { finish(blob); }, 'image/jpeg', 0.92);
            });
            d.showModal ? d.showModal() : d.setAttribute('open', '');
        });
    }

    function named(blob, file) {
        var name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
        try { return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }); }
        catch (e) { blob.name = name; blob.lastModifiedDate = new Date(); return blob; }
    }

    function hook(el) {
        var dz = el.dropzone;
        if (!dz || el.getAttribute('data-gr-crop')) { return; }
        el.setAttribute('data-gr-crop', '1');
        var original = dz.options.transformFile;
        dz.options.transformFile = function(file, done) {
            var self = this;
            function pass(f) { return original ? original.call(self, f, done) : done(f); }
            if (!/^image\/(jpeg|pjpeg|png|webp|heic|heif|tiff)$/i.test(file.type || '')) { return pass(file); }
            queue = queue.then(function() {
                return ask(file).then(function(blob) {
                    if (!blob) { return pass(file); }
                    var cropped = named(blob, file);
                    var img = file.previewElement && file.previewElement.querySelector('img[data-dz-thumbnail]');
                    if (img) {
                        var u = URL.createObjectURL(blob);
                        img.onload = function() { URL.revokeObjectURL(u); };
                        img.src = u;
                        img.style.objectFit = 'cover';
                    }
                    return pass(cropped);
                });
            }).catch(function() { pass(file); });
        };
    }

    function scan() { Array.prototype.forEach.call(document.querySelectorAll('.dropzone'), hook); }
    var queued = false;
    function schedule() {
        if (queued) { return; }
        queued = true;
        window.requestAnimationFrame(function() { queued = false; scan(); });
    }
    function start() {
        scan();
        if (window.MutationObserver) { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(start, 0); });
    } else {
        setTimeout(start, 0);
    }
})();
