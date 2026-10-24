/*
 * Two buttons under each photo upload box (Dropzone); what they give is added to the box as if
 * the user had picked a file there.
 *
 * "Τράβηξε φωτογραφία" takes a photo there and then:
 * - Phones and tablets: a file input with capture="environment" opens the device's camera app.
 * - Computers: a dialog with the live camera picture (getUserMedia) and a shutter button.
 *   Without a camera or permission, it offers the file picker instead.
 *
 * "Από τη συλλογή" ("Επιλογή αρχείου" on computers) opens the device's photo gallery or file
 * picker: accept="image/*" without capture, several photos at once.
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

    var GALLERY_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
        '<path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v9.6l4.3-4.3a1 1 0 0 1 ' +
        '1.4 0L13 14.6l2.3-2.3a1 1 0 0 1 1.4 0L20 15.6V6H4Zm11 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"/></svg>';

    // The device's own camera app (capture), or its gallery / file picker (no capture, several
    // photos at once).
    function nativeInput(dz, capture) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        if (capture) {
            input.setAttribute('capture', 'environment');
        } else {
            input.multiple = true;
        }
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
            var cameraInput = nativeInput(dz, true);
            var galleryInput = nativeInput(dz, false);
            var actions = document.createElement('div');
            actions.className = 'gr-photo-actions';

            var camera = document.createElement('button');
            camera.type = 'button';   // never submits the report form
            camera.className = 'btn gr-camera-btn';
            camera.innerHTML = ICON + '<span>Τράβηξε φωτογραφία</span>';
            camera.addEventListener('click', function() { openCamera(dz, cameraInput); });

            var gallery = document.createElement('button');
            gallery.type = 'button';
            gallery.className = 'btn gr-gallery-btn';
            gallery.innerHTML = GALLERY_ICON + '<span>' + (touchDevice ? 'Από τη συλλογή' : 'Επιλογή αρχείου') + '</span>';
            gallery.addEventListener('click', function() { galleryInput.click(); });

            actions.appendChild(camera);
            actions.appendChild(gallery);
            actions.appendChild(cameraInput);
            actions.appendChild(galleryInput);
            el.parentNode.insertBefore(actions, el.nextSibling);
        });
    }

    var queued = false;
    function schedule() {
        if (queued) { return; }
        queued = true;
        window.requestAnimationFrame(function() { queued = false; enhance(); });
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
