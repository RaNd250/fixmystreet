/*
 * The contact form (templates/web/greece/contact/form.html): a tap on a topic fills the subject, each
 * field says whether it is fine once it is left, the message box grows with its text and counts its
 * characters, and «Αποστολή» shows that it is sending. FixMyStreet's own checks and the server still
 * decide; this only shows them earlier.
 */
(function() {
    'use strict';
    var form = document.querySelector('form.gr-cform');
    if (!form) { return; }
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }
    var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    // Topics
    var subject = form.querySelector('#form_subject');
    var chips = form.querySelectorAll('.gr-cform__chip');
    function markChip() {
        Array.prototype.forEach.call(chips, function(c) {
            c.setAttribute('aria-pressed', subject && subject.value === c.getAttribute('data-topic') ? 'true' : 'false');
        });
    }
    Array.prototype.forEach.call(chips, function(chip) {
        chip.addEventListener('click', function() {
            if (!subject) { return; }
            subject.value = chip.getAttribute('data-topic');
            check(subject, true);
            markChip();
            var msg = form.querySelector('#form_message');
            if (msg && !msg.value) { msg.focus(); }
        });
    });
    if (subject) { subject.addEventListener('input', markChip); }
    markChip();

    // Checks
    function problem(el) {
        var v = (el.value || '').trim();
        if (el.hasAttribute('data-gr-required') && !v) { return t('Συμπλήρωσέ το.', 'Please fill this in.'); }
        if (el.hasAttribute('data-gr-email') && v && !EMAIL.test(v)) { return t('Δεν μοιάζει με email.', 'That does not look like an email.'); }
        if (el.id === 'form_message' && v && v.length < 10) { return t('Γράψε λίγα λόγια ακόμα.', 'A few more words, please.'); }
        return '';
    }
    function check(el, shown) {
        var field = el.closest('.gr-cform__field');
        var hint = field && field.querySelector('.gr-cform__hint');
        var p = problem(el);
        if (!shown && !field.classList.contains('gr-cform__field--touched')) { return !p; }
        field.classList.add('gr-cform__field--touched');
        field.classList.toggle('gr-cform__field--bad', !!p);
        field.classList.toggle('gr-cform__field--ok', !p && !!(el.value || '').trim());
        el.setAttribute('aria-invalid', p ? 'true' : 'false');
        if (hint) { hint.textContent = p; }
        return !p;
    }
    var fields = form.querySelectorAll('[data-gr-required]');
    Array.prototype.forEach.call(fields, function(el) {
        el.addEventListener('blur', function() { check(el, true); });
        el.addEventListener('input', function() { check(el, false); });
    });

    // Message: grows and counts
    var msg = form.querySelector('#form_message');
    var count = form.querySelector('.gr-cform__count');
    function grow() {
        if (!msg) { return; }
        msg.style.height = 'auto';
        msg.style.height = Math.min(msg.scrollHeight + 2, 420) + 'px';
        if (count) {
            var n = msg.value.length, max = parseInt(msg.getAttribute('maxlength'), 10) || 5000;
            count.textContent = n + ' / ' + max;
            count.classList.toggle('gr-cform__count--near', n > max * 0.9);
        }
    }
    if (msg) { msg.addEventListener('input', grow); grow(); }

    // Sending
    var send = form.querySelector('.gr-cform__send');
    form.addEventListener('submit', function(e) {
        var ok = true, first = null;
        Array.prototype.forEach.call(fields, function(el) {
            if (!check(el, true)) { ok = false; first = first || el; }
        });
        if (!ok) {
            e.preventDefault();
            if (first) { first.focus(); }
            form.classList.remove('gr-cform--shake');
            void form.offsetWidth;
            form.classList.add('gr-cform--shake');
            return;
        }
        if (send) {
            send.classList.add('gr-cform__send--busy');
            send.setAttribute('aria-busy', 'true');
            var label = send.querySelector('.gr-cform__label');
            if (label) { label.textContent = t('Αποστολή…', 'Sending…'); }
            // A second press would send twice; the page leaves on its own.
            setTimeout(function() { send.disabled = true; }, 0);
        }
    });
})();
