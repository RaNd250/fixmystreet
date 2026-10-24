/*
 * Each photo upload box (Dropzone) says only «Εισαγωγή φωτογραφίας» (a click opens the device's
 * gallery or file picker, as before), and gets a «Λήψη» button under it that takes a photo there
 * and then; the photo is added to the box as if the user had picked a file there:
 * - Phones and tablets: a file input with capture="environment" opens the device's camera app.
 * - Computers: a dialog with the live camera picture (getUserMedia) and a shutter button.
 *   Without a camera or permission, it offers the file picker instead.
 *
 * The boxes upload to /greece/photo/upload, which answers like /photo/upload plus the number plates
 * the anonymiser read in the photo (App::Controller::GreecePhoto). The first plate fills in the
 * category's plate question («pinakida») if it is empty, now or when the question appears, with a
 * note to check it; it is never written over what the reporter typed, and is taken back if its
 * photo is removed while the field still holds it.
 *
 * The photo upload boxes are created by fixmystreet.js (also when the report form is loaded into
 * the side panel later), so new boxes are looked for whenever the page changes.
 */
(function() {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
        '<path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9Zm3 ' +
        '5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>';

    var touchDevice = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    var canStream = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);

    function photoFile(blob) {
        var stamp = new Date().toISOString().replace(/[:.]/g, '-');
        try {
            return new File([blob], 'kamera-' + stamp + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
        } catch (e) { // File constructor missing in old browsers; Dropzone accepts a named Blob
            blob.name = 'kamera-' + stamp + '.jpg';
            blob.lastModifiedDate = new Date();
            return blob;
        }
    }

    var DROP_TEXT = 'Εισαγωγή φωτογραφίας';
    var PLATE_NOTE = 'Συμπληρώθηκε από τη φωτογραφία· έλεγξέ το.';
    var pendingPlate = null;   // a plate read before the plate question was on the page

    function plateField(el) {
        var form = el.closest ? el.closest('form') : null;
        return (form || document).querySelector('input[name="pinakida"]');
    }

    function fillPlate(input, plate) {
        if (!input || !plate || input.value.trim()) { return false; }
        input.value = plate;
        input.setAttribute('data-gr-plate', plate);
        var note = input.parentNode.querySelector('.gr-plate-note');
        if (!note) {
            note = document.createElement('p');
            note.className = 'gr-plate-note';
            note.textContent = PLATE_NOTE;
            input.parentNode.insertBefore(note, input.nextSibling);
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    function unfillPlate(input, plate) {
        if (!input || input.getAttribute('data-gr-plate') !== plate || input.value !== plate) { return; }
        input.value = '';
        input.removeAttribute('data-gr-plate');
        var note = input.parentNode.querySelector('.gr-plate-note');
        if (note) { note.parentNode.removeChild(note); }
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // The device's own camera app.
    function cameraApp(dz) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.setAttribute('capture', 'environment');
        input.hidden = true;
        input.addEventListener('change', function() {
            Array.prototype.forEach.call(input.files || [], function(f) { dz.addFile(f); });
            input.value = '';
        });
        return input;
    }

    var dialog, video, shutter, flip, status, fallbackBtn, stream, currentDz, currentInput, facing = 'environment';

    function stopStream() {
        if (stream) {
            stream.getTracks().forEach(function(t) { t.stop(); });
            stream = null;
        }
        video.srcObject = null;
    }

    function closeDialog() {
        stopStream();
        if (dialog.open) { dialog.close(); }
    }

    function showStatus(text, offerFiles) {
        status.textContent = text;
        status.hidden = !text;
        fallbackBtn.hidden = !offerFiles;
    }

    function startStream() {
        stopStream();
        shutter.disabled = true;
        showStatus('Άνοιγμα κάμερας…', false);
        navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        }).then(function(s) {
            stream = s;
            video.srcObject = s;
            return video.play();
        }).then(function() {
            shutter.disabled = false;
            showStatus('', false);
            return navigator.mediaDevices.enumerateDevices();
        }).then(function(devices) {
            var cameras = (devices || []).filter(function(d) { return d.kind === 'videoinput'; });
            flip.hidden = cameras.length < 2;
        }).catch(function(err) {
            var name = err && err.name;
            if (name === 'NotAllowedError' || name === 'SecurityError') {
                showStatus('Δεν δόθηκε άδεια για την κάμερα. Μπορείς να την επιτρέψεις από τη γραμμή διευθύνσεων του browser ή να επιλέξεις αρχείο.', true);
            } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
                showStatus('Δεν βρέθηκε κάμερα σε αυτή τη συσκευή. Μπορείς να επιλέξεις αρχείο.', true);
            } else {
                showStatus('Η κάμερα δεν άνοιξε (είναι ίσως ανοιχτή σε άλλη εφαρμογή). Μπορείς να επιλέξεις αρχείο.', true);
            }
        });
    }

    function takePhoto() {
        if (!stream || !video.videoWidth) { return; }
        var canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        shutter.disabled = true;
        canvas.toBlob(function(blob) {
            if (blob && currentDz) { currentDz.addFile(photoFile(blob)); }
            closeDialog();
        }, 'image/jpeg', 0.92);
    }

    function buildDialog() {
        dialog = document.createElement('dialog');
        dialog.className = 'gr-camera';
        dialog.setAttribute('aria-label', 'Λήψη φωτογραφίας');
        dialog.innerHTML =
            '<div class="gr-camera__frame"><video class="gr-camera__video" playsinline muted autoplay></video></div>' +
            '<p class="gr-camera__status" role="status" hidden></p>' +
            '<div class="gr-camera__actions">' +
              '<button type="button" class="btn gr-camera__cancel">Άκυρο</button>' +
              '<button type="button" class="btn gr-camera__flip" hidden>Αλλαγή κάμερας</button>' +
              '<button type="button" class="btn gr-camera__files" hidden>Επιλογή αρχείου</button>' +
              '<button type="button" class="btn btn--primary gr-camera__shutter" disabled>' + ICON + '<span>Λήψη</span></button>' +
            '</div>';
        document.body.appendChild(dialog);
        video = dialog.querySelector('video');
        shutter = dialog.querySelector('.gr-camera__shutter');
        flip = dialog.querySelector('.gr-camera__flip');
        status = dialog.querySelector('.gr-camera__status');
        fallbackBtn = dialog.querySelector('.gr-camera__files');
        shutter.addEventListener('click', takePhoto);
        dialog.querySelector('.gr-camera__cancel').addEventListener('click', closeDialog);
        flip.addEventListener('click', function() {
            facing = facing === 'environment' ? 'user' : 'environment';
            startStream();
        });
        fallbackBtn.addEventListener('click', function() {
            var input = currentInput;
            closeDialog();
            if (input) { input.click(); }
        });
        dialog.addEventListener('close', stopStream);   // Esc closes the dialog too
    }

    function openCamera(dz, input) {
        if (touchDevice || !canStream || !window.HTMLDialogElement) {
            input.click();
            return;
        }
        if (!dialog) { buildDialog(); }
        currentDz = dz;
        currentInput = input;
        dialog.showModal();
        startStream();
    }

    function enhance() {
        var zones = document.querySelectorAll('.dropzone');
        Array.prototype.forEach.call(zones, function(el) {
            var dz = el.dropzone;
            if (!dz || el.getAttribute('data-gr-camera')) { return; }
            el.setAttribute('data-gr-camera', '1');
            dz.options.url = '/greece/photo/upload';
            dz.on('success', function(file, answer) {
                var plate = answer && answer.plates && answer.plates[0];
                if (!plate) { return; }
                file.grPlate = plate;
                if (!fillPlate(plateField(el), plate) && !plateField(el)) { pendingPlate = { el: el, plate: plate }; }
            });
            dz.on('removedfile', function(file) {
                if (!file.grPlate) { return; }
                if (pendingPlate && pendingPlate.plate === file.grPlate) { pendingPlate = null; }
                unfillPlate(plateField(el), file.grPlate);
            });
            // One short text instead of FixMyStreet's "drag photos here or browse photos".
            dz.options.dictDefaultMessage = DROP_TEXT;
            var message = el.querySelector('.dz-message .dz-button, .dz-message span') || el.querySelector('.dz-message');
            if (message) { message.textContent = DROP_TEXT; }
            var cameraInput = cameraApp(dz);
            var actions = document.createElement('div');
            actions.className = 'gr-photo-actions';

            var camera = document.createElement('button');
            camera.type = 'button';   // never submits the report form
            camera.className = 'btn gr-camera-btn';
            camera.innerHTML = ICON + '<span>Λήψη</span>';
            camera.addEventListener('click', function() { openCamera(dz, cameraInput); });

            actions.appendChild(camera);
            actions.appendChild(cameraInput);
            el.parentNode.insertBefore(actions, el.nextSibling);
        });
    }

    var queued = false;
    function schedule() {
        if (queued) { return; }
        queued = true;
        window.requestAnimationFrame(function() {
            queued = false;
            enhance();
            // The plate question appears when a category with it is chosen.
            if (pendingPlate && plateField(pendingPlate.el)) {
                fillPlate(plateField(pendingPlate.el), pendingPlate.plate);
                pendingPlate = null;
            }
        });
    }

    function start() {
        enhance();
        if (window.MutationObserver) {
            new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(start, 0); });
    } else {
        setTimeout(start, 0);
    }
})();
