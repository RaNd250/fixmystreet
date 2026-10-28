/*
 * Each photo picked or taken for a report or an update can be cropped before it is uploaded: a
 * dialog shows it with a frame that can be moved and resized (finger or mouse). It can also hide a spot (owner,
 * 2026-10-29): «Θόλωμα» pixelates the part you draw a rectangle over, «Μαύρισμα» paints it black, and «Αναίρεση» takes the
 * last one back. This is done here, on the phone, so the original never leaves it. «Εφαρμογή» sends the part inside the
 * frame with the hidden spots; «Ολόκληρη» sends the whole photo (with the hidden spots, if there are any).
 * It hooks into Dropzone's transformFile, which runs just before the upload, and then hands over to Dropzone's own
 * resizing. One dialog at a time when several photos are picked together. GIFs are sent as they are (a crop would lose
 * the animation). The anonymiser blurs plates and faces in the photo that arrives, so nothing is published outside the frame.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }
    if (!window.HTMLCanvasElement || !document.createElement('canvas').toBlob) { return; }

    var MIN = 48;   // smallest frame side, in screen pixels
    var MIN_MARK = 10;
    var queue = Promise.resolve();

    function build() {
        var d = document.createElement('dialog');
        d.className = 'gr-camera gr-crop';
        d.setAttribute('aria-label', t('Επεξεργασία φωτογραφίας', 'Edit photo'));
        d.innerHTML =
            '<div class="gr-crop__tools" role="group" aria-label="' + t('Εργαλεία', 'Tools') + '">' +
            '<button type="button" class="btn gr-crop__tool" data-mode="crop" aria-pressed="true">' + t('Περικοπή', 'Crop') + '</button>' +
            '<button type="button" class="btn gr-crop__tool" data-mode="blur" aria-pressed="false">' + t('Θόλωμα', 'Blur') + '</button>' +
            '<button type="button" class="btn gr-crop__tool" data-mode="black" aria-pressed="false">' + t('Μαύρισμα', 'Black out') + '</button>' +
            '<button type="button" class="btn gr-crop__undo" disabled>' + t('Αναίρεση', 'Undo') + '</button></div>' +
            '<div class="gr-crop__stage"><img class="gr-crop__img" alt=""><div class="gr-crop__marks"></div><div class="gr-crop__box" tabindex="0" aria-label="' +
            t('Πλαίσιο περικοπής', 'Crop frame') + '">' +
            '<span class="gr-crop__h" data-h="nw"></span><span class="gr-crop__h" data-h="ne"></span>' +
            '<span class="gr-crop__h" data-h="sw"></span><span class="gr-crop__h" data-h="se"></span></div></div>' +
            '<p class="gr-camera__status"></p>' +
            '<div class="gr-camera__actions">' +
            '<button type="button" class="btn gr-crop__whole">' + t('Ολόκληρη', 'Whole photo') + '</button>' +
            '<button type="button" class="btn btn--primary gr-crop__ok">' + t('Εφαρμογή', 'Apply') + '</button></div>';
        document.body.appendChild(d);
        return d;
    }

    var STATUS = {
        crop: t('Σύρε το πλαίσιο ή τις γωνίες του για να κρατήσεις μόνο ό,τι χρειάζεται.', 'Drag the frame or its corners to keep only what is needed.'),
        blur: t('Σύρε πάνω στη φωτογραφία για να θολώσεις ένα σημείο (πρόσωπο, πινακίδα, σπίτι, έγγραφο).', 'Drag over the photo to blur a spot (a face, a plate, a house, a document).'),
        black: t('Σύρε πάνω στη φωτογραφία για να μαυρίσεις ένα σημείο. Στις καταγγελίες προς την αστυνομία μην καλύπτεις την πινακίδα.',
            'Drag over the photo to black out a spot. In complaints to the police do not cover the number plate.')
    };

    // Draws the part of the image inside the crop (sx, sy, sw, sh in image pixels) with the marks on it.
    function render(img, crop, marks) {
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(crop.w)); c.height = Math.max(1, Math.round(crop.h));
        var g = c.getContext('2d');
        g.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
        marks.forEach(function(m) {
            var x = Math.round(m.x - crop.x), y = Math.round(m.y - crop.y), w = Math.round(m.w), h = Math.round(m.h);
            var x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(c.width, x + w), y1 = Math.min(c.height, y + h);
            if (x1 - x0 < 2 || y1 - y0 < 2) { return; }
            if (m.kind === 'black') {
                g.fillStyle = '#000'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
            } else {
                // Pixelated into about seven blocks along the longer side: nothing readable is left.
                var rw = x1 - x0, rh = y1 - y0, cells = 7, bw = Math.max(1, Math.round(Math.max(rw, rh) / cells));
                var sw = Math.max(1, Math.round(rw / bw)), sh = Math.max(1, Math.round(rh / bw));
                var small = document.createElement('canvas');
                small.width = sw; small.height = sh;
                var sg = small.getContext('2d');
                sg.drawImage(c, x0, y0, rw, rh, 0, 0, sw, sh);
                g.save();
                g.imageSmoothingEnabled = false;
                g.drawImage(small, 0, 0, sw, sh, x0, y0, rw, rh);
                g.restore();
            }
        });
        return c;
    }

    // Shows the dialog for one image file; resolves with a Blob of the edited photo, or null for the photo as it is.
    function ask(file) {
        return new Promise(function(resolve) {
            var d = build();
            var img = d.querySelector('.gr-crop__img'), box = d.querySelector('.gr-crop__box'), layer = d.querySelector('.gr-crop__marks');
            var status = d.querySelector('.gr-camera__status'), undo = d.querySelector('.gr-crop__undo');
            var url = URL.createObjectURL(file);
            var r = { x: 0, y: 0, w: 0, h: 0 }, W = 0, H = 0, finished = false, mode = 'crop';
            var marks = [];   // in screen pixels over the image: { x, y, w, h, kind, el }
            status.textContent = STATUS.crop;

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
                layer.style.width = W + 'px'; layer.style.height = H + 'px';
                layer.style.left = img.offsetLeft + 'px'; layer.style.top = img.offsetTop + 'px';
                draw();
            };
            img.onerror = function() { finish(null); };
            img.src = url;

            // The tools
            function setMode(m) {
                mode = m;
                Array.prototype.forEach.call(d.querySelectorAll('.gr-crop__tool'), function(b) {
                    b.setAttribute('aria-pressed', b.getAttribute('data-mode') === m ? 'true' : 'false');
                });
                d.classList.toggle('is-redact', m !== 'crop');
                status.textContent = STATUS[m];
            }
            Array.prototype.forEach.call(d.querySelectorAll('.gr-crop__tool'), function(b) {
                b.addEventListener('click', function() { setMode(b.getAttribute('data-mode')); });
            });
            function refreshUndo() { undo.disabled = !marks.length; }
            undo.addEventListener('click', function() {
                var m = marks.pop();
                if (m && m.el.parentNode) { m.el.parentNode.removeChild(m.el); }
                refreshUndo();
            });

            // Drawing a mark (in the blur and black modes)
            var mk = null;
            layer.addEventListener('pointerdown', function(e) {
                if (mode === 'crop') { return; }
                var b = layer.getBoundingClientRect();
                var x = Math.min(Math.max(0, e.clientX - b.left), W), y = Math.min(Math.max(0, e.clientY - b.top), H);
                var el = document.createElement('div');
                el.className = 'gr-crop__mark gr-crop__mark--' + mode;
                layer.appendChild(el);
                mk = { x0: x, y0: y, x: x, y: y, w: 0, h: 0, kind: mode, el: el };
                layer.setPointerCapture && layer.setPointerCapture(e.pointerId);
                e.preventDefault();
            });
            layer.addEventListener('pointermove', function(e) {
                if (!mk) { return; }
                var b = layer.getBoundingClientRect();
                var x = Math.min(Math.max(0, e.clientX - b.left), W), y = Math.min(Math.max(0, e.clientY - b.top), H);
                mk.x = Math.min(mk.x0, x); mk.y = Math.min(mk.y0, y); mk.w = Math.abs(x - mk.x0); mk.h = Math.abs(y - mk.y0);
                mk.el.style.left = mk.x + 'px'; mk.el.style.top = mk.y + 'px';
                mk.el.style.width = mk.w + 'px'; mk.el.style.height = mk.h + 'px';
            });
            function endMark() {
                if (!mk) { return; }
                if (mk.w < MIN_MARK || mk.h < MIN_MARK) { mk.el.parentNode && mk.el.parentNode.removeChild(mk.el); }
                else { marks.push(mk); }
                mk = null;
                refreshUndo();
            }
            layer.addEventListener('pointerup', endMark);
            layer.addEventListener('pointercancel', endMark);

            // Moving and resizing the crop frame
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

            // The photo with the marks, cropped to the frame (or whole), as a Blob; null when nothing is changed.
            function result(whole) {
                if (!W || !H) { return null; }
                var sx = img.naturalWidth / W, sy = img.naturalHeight / H;
                var nearWhole = r.w > W * 0.97 && r.h > H * 0.97;
                if ((whole || nearWhole) && !marks.length) { return null; }
                var crop = (whole || nearWhole) ? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
                                                : { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy };
                var scaled = marks.map(function(m) { return { x: m.x * sx, y: m.y * sy, w: m.w * sx, h: m.h * sy, kind: m.kind }; });
                return render(img, crop, scaled);
            }
            function send(whole) {
                var c = result(whole);
                if (!c) { finish(null); return; }
                c.toBlob(function(blob) { finish(blob); }, 'image/jpeg', 0.92);
            }
            d.querySelector('.gr-crop__whole').addEventListener('click', function() { send(true); });
            d.addEventListener('cancel', function(e) { e.preventDefault(); finish(null); });
            d.querySelector('.gr-crop__ok').addEventListener('click', function() { send(false); });
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
