/*
 * The name is optional (Greece.pm greece_default_name): the name field of the report, update and
 * contact forms comes filled in with «Ανώνυμος» in grey; a tap clears it to type a name, an empty
 * field gets it back, and if left alone the server takes it as «Ανώνυμος πολίτης». Not when the field
 * already holds a name (signed in, or typed before). Forms loaded later are looked at too.
 * On the report form a name is needed when there is no photo (owner, 2026-10-26; the server checks
 * it too, Greece.pm report_check_for_errors): the label says so, and sending is stopped with a note.
 */
(function() {
    'use strict';
    var DEFAULT = /^en/i.test(document.documentElement.lang || '') ? 'Anonymous' : 'Ανώνυμος';

    function fill(box) {
        if (!box || box.dataset.grDefault !== undefined) { return; }
        box.dataset.grDefault = DEFAULT;
        if (box.value === '' || box.value === DEFAULT) {
            box.value = DEFAULT;
            box.classList.add('gr-name-default');
        }
    }
    var EN = /^en/i.test(document.documentElement.lang || '');
    var NEED = EN ? 'Without a photo, enter your name (at least 4 characters). Anonymous reports need a photo.'
        : 'Χωρίς φωτογραφία, γράψε το όνομά σου (τουλάχιστον 4 χαρακτήρες). Ανώνυμα γίνεται μόνο με φωτογραφία.';
    function hasPhoto(form) {
        var f = form.querySelector('input[name="upload_fileid"]');
        return !!(f && f.value.trim());
    }
    function reportForm(box) {
        var form = box.form;
        if (!form || form.id !== 'mapForm' || form.dataset.grNameRule) { return; }
        form.dataset.grNameRule = '1';
        var hint = form.querySelector('label[for="form_name"] span');
        if (hint) { hint.textContent = EN ? ' (optional with a photo)' : ' (προαιρετικό αν βάλεις φωτογραφία)'; }
        form.addEventListener('submit', function(e) {
            var v = box.value.trim();
            if (hasPhoto(form) || (v !== '' && v !== box.dataset.grDefault)) { return; }
            e.preventDefault();
            e.stopImmediatePropagation();
            var p = form.querySelector('.gr-name-need');
            if (!p) {
                p = document.createElement('p');
                p.className = 'form-error gr-name-need';
                p.setAttribute('role', 'alert');
                box.parentNode.insertBefore(p, box);
            }
            p.textContent = NEED;
            box.scrollIntoView({ block: 'center' });
            box.focus();
        }, true);
        box.addEventListener('input', function() {
            var p = form.querySelector('.gr-name-need');
            if (p && box.value.trim()) { p.parentNode.removeChild(p); }
        });
    }
    function scan() {
        Array.prototype.forEach.call(document.querySelectorAll('input#form_name'), function(box) { fill(box); reportForm(box); });
    }

    document.addEventListener('focusin', function(e) {
        var box = e.target;
        if (box.id !== 'form_name' || box.value !== box.dataset.grDefault) { return; }
        box.value = '';
        box.classList.remove('gr-name-default');
    });
    document.addEventListener('focusout', function(e) {
        var box = e.target;
        if (box.id !== 'form_name' || !box.dataset.grDefault || box.value.trim() !== '') { return; }
        box.value = box.dataset.grDefault;
        box.classList.add('gr-name-default');
    });
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
