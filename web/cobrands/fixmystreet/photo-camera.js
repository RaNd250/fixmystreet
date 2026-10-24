/*
 * Photo-camera and gallery buttons under each Dropzone.
 *
 * "Take a photo" takes a picture immediately:
 * - Phones and tablets: a file input with capture="environment" opens the device camera app.
 * - Computers: a dialog with the live camera (getUserMedia) and a shutter button.
 *   Without a camera or permission, it offers the file picker instead.
 *
 * "Choose from gallery" (or "Choose a file" on computers) opens the device gallery
 * or file picker: accept="image/*" without capture, several photos at once.
 *
 * Buttons are added to existing dropzones on load and to any new ones created later
 * via the report-side-panel AJAX flow. The data-fms-photo-camera attribute prevents
 * double-enhancement.
 */
(function() {
    'use strict';

    var ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
        '<path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9Zm3 ' +
        '5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>';

    var GALLERY_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
        '<path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v9.6l4.3-4.3a1 1 0 0 1 ' +
        '1.4 0L13 14.6l2.3-2.3a1 1 0 0 1 1.4 0L20 15.6V6H4Zm11 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"/></svg>';

    var touchDevice = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    var canStream = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);

    /*
     * Create a File from a JPEG Blob.  Falls back to renaming a Blob for
     * older browsers whose File constructor is missing.
     */
    function photoFile(blob) {
        var stamp = new Date().toISOString().replace(/[:.]/g, '-');
        try {
            return new File([blob], 'kamera-' + stamp + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
        } catch (e) {
            blob.name = 'kamera-' + stamp + '.jpg';
            blob.lastModifiedDate = new Date();
            return blob;
        }
    }

    /*
     * Create a hidden <input type="file"> that adds files to the given
     * Dropzone instance.
     *
     * capture="environment" --> device rear camera (phones/tablets).
     * multiple + no capture  --> gallery / file picker (several photos).
     */
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
        showStatus(translation_strings.camera_opening || 'Opening camera…', false);
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
                showStatus(translation_strings.camera_permission_denied || 'Permission denied. You can allow it from the browser address bar or choose a file.', true);
            } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
                showStatus(translation_strings.camera_not_found || 'No camera found on this device. You can choose a file.', true);
            } else {
                showStatus(translation_strings.camera_not_opening || 'The camera did not open (it may be in use by another app). You can choose a file.', true);
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
        dialog.className = 'fms-photo-camera';
        dialog.setAttribute('aria-label', translation_strings.camera_dialog_label || 'Take a photo');
        var cam = translation_strings;
        dialog.innerHTML =
            '<div class="fms-photo-camera__frame"><video class="fms-photo-camera__video" playsinline muted autoplay></video></div>' +
            '<p class="fms-photo-camera__status" role="status" hidden></p>' +
            '<div class="fms-photo-camera__actions">' +
              '<button type="button" class="btn fms-photo-camera__cancel">' + (cam.camera_cancel || 'Cancel') + '</button>' +
              '<button type="button" class="btn fms-photo-camera__flip" hidden>' + (cam.camera_switch || 'Switch camera') + '</button>' +
              '<button type="button" class="btn fms-photo-camera__files" hidden>' + (cam.camera_choose_file_dialog || 'Choose a file') + '</button>' +
              '<button type="button" class="btn btn--primary fms-photo-camera__shutter" disabled>' + ICON + '<span>' + (cam.camera_take || 'Take') + '</span></button>' +
            '</div>';
        document.body.appendChild(dialog);
        video = dialog.querySelector('video');
        shutter = dialog.querySelector('.fms-photo-camera__shutter');
        flip = dialog.querySelector('.fms-photo-camera__flip');
        status = dialog.querySelector('.fms-photo-camera__status');
        fallbackBtn = dialog.querySelector('.fms-photo-camera__files');
        shutter.addEventListener('click', takePhoto);
        dialog.querySelector('.fms-photo-camera__cancel').addEventListener('click', closeDialog);
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

    /*
     * Add the photo-camera and gallery buttons to one dropzone element.
     * Skips if already enhanced (data-fms-photo-camera attribute).
     */
    function enhance(dzEl) {
        var dz = dzEl.dropzone;
        if (!dz || dzEl.getAttribute('data-fms-photo-camera')) { return; }
        dzEl.setAttribute('data-fms-photo-camera', '1');
        var cameraInput = nativeInput(dz, true);
        var galleryInput = nativeInput(dz, false);
        var actions = document.createElement('div');
        actions.className = 'fms-photo-actions';

        var camera = document.createElement('button');
        camera.type = 'button';   // never submits the form
        camera.className = 'btn fms-photo-camera-btn';
        camera.innerHTML = ICON + '<span>Fms camera_button</span>';
        camera.addEventListener('click', function() { openCamera(dz, cameraInput); });

        var gallery = document.createElement('button');
        gallery.type = 'button';
        gallery.className = 'btn fms-photo-gallery-btn';
        gallery.innerHTML = GALLERY_ICON + '<span>' + (touchDevice
            ? (translation_strings.camera_gallery || 'Choose from gallery')
            : (translation_strings.camera_choose_file || 'Choose a file')) + '</span>';
        gallery.addEventListener('click', function() { galleryInput.click(); });

        actions.appendChild(camera);
        actions.appendChild(gallery);
        actions.appendChild(cameraInput);
        actions.appendChild(galleryInput);
        dzEl.parentNode.insertBefore(actions, dzEl.nextSibling);
    }

    /*
     * Enhance all existing dropzones.  Called once on page load and
     * again whenever a new dropzone is created.
     */
    var queued = false;
    function schedule() {
        if (queued) { return; }
        queued = true;
        window.requestAnimationFrame(function() { queued = false;
            document.querySelectorAll('.dropzone').forEach(enhance);
        });
    }

    /*
     * Start watching for new dropzones (AJAX-loaded side panels, etc.)
     */
    function start() {
        schedule();
        if (window.MutationObserver) {
            new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(start, 0); });
    } else {
        setTimeout(start, 0);
    }

    /*
     * Exposed for direct calls from fixmystreet.js dropzone init.
     * Allows the dropzone setup to enhance immediately after creating
     * a Dropzone instance, before the MutationObserver fires.
     */
    fixmystreet = fixmystreet || {};
    fixmystreet.photo_camera = { enhance: enhance };

})();
