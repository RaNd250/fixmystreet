/*
 * Report form: under the email, «Επιβεβαίωση email» sends a 6-digit code to it
 * (App::Controller::GreeceOTP); typed back, the email is confirmed for this report and the service
 * gets the reporter in Cc (Greece.pm munge_sendreport_params). Optional: without it the report is
 * sent all the same, only without the Cc. Changing the email afterwards undoes it.
 * With a video (video-upload.js) it is required (owner, 2026-10-26): the form is not sent until the
 * email is confirmed, and the server refuses it too (Greece.pm report_check_for_errors).
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }
    var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    function post(url, data) {
        return fetch(url, { method: 'POST', body: new URLSearchParams(data), credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function(r) { return r.json().catch(function() { return {}; }); });
    }

    function ui(input) {
        if (input.dataset.grOtp) { return; }
        input.dataset.grOtp = '1';
        var box = document.createElement('div');
        box.className = 'gr-otp';
        input.parentNode.appendChild(box);
        var confirmed = '';
        var form = input.form;
        function hasVideo() {
            var v = form && form.querySelector('input[name="greece_video"]');
            return !!(v && v.value);
        }

        function idle() {
            box.innerHTML = '<button type="button" class="gr-otp__ask">' + t('Επιβεβαίωση email', 'Confirm email') + '</button>' +
                '<span class="gr-otp__why">' + (hasVideo()
                    ? t('απαιτείται για το βίντεο', 'required for the video')
                    : t('προαιρετικό · χωρίς επιβεβαίωση το email δεν φτάνει στην υπηρεσία', 'optional · without it your email does not reach the service')) + '</span>';
            box.hidden = !EMAIL.test(input.value.trim());
            box.querySelector('.gr-otp__ask').onclick = send;
        }
        function say(msg, cls) {
            var p = box.querySelector('.gr-otp__msg') || box.appendChild(document.createElement('p'));
            p.className = 'gr-otp__msg ' + (cls || ''); p.textContent = msg;
        }
        function send() {
            var email = input.value.trim();
            box.querySelector('.gr-otp__ask').disabled = true;
            post('/greece/otp/send', { email: email }).then(function(r) {
                if (!r.sent) {
                    idle();
                    return say(r.error === 'too_many' ? t('Πολλά αιτήματα. Δοκίμασε σε λίγο.', 'Too many requests. Try again later.')
                        : t('Ο κωδικός δεν στάλθηκε. Έλεγξε το email.', 'The code was not sent. Check the email.'), 'gr-otp__msg--bad');
                }
                box.innerHTML = '<label class="gr-otp__label" for="gr_otp_code">' + t('Κωδικός από το email σου', 'Code from your email') + '</label>' +
                    '<span class="gr-otp__row"><input id="gr_otp_code" class="form-control gr-otp__code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">' +
                    '<button type="button" class="btn btn--primary gr-otp__go">' + t('Επιβεβαίωση', 'Confirm') + '</button></span>' +
                    '<button type="button" class="gr-otp__again">' + t('Νέος κωδικός', 'New code') + '</button>';
                var code = box.querySelector('.gr-otp__code');
                code.focus();
                box.querySelector('.gr-otp__again').onclick = send;
                function check() {
                    post('/greece/otp/check', { code: code.value }).then(function(r) {
                        if (r.ok) {
                            confirmed = (r.email || email).toLowerCase();
                            box.innerHTML = '<p class="gr-otp__msg gr-otp__msg--ok">✓ ' + t('Το email επιβεβαιώθηκε· η υπηρεσία θα το βλέπει και θα μπορεί να σου απαντήσει.', 'Email confirmed; the service will see it and can reply to you.') + '</p>';
                        } else {
                            say(r.error === 'expired' ? t('Ο κωδικός έληξε. Ζήτησε νέο.', 'The code expired. Ask for a new one.')
                                : t('Λάθος κωδικός.', 'Wrong code.'), 'gr-otp__msg--bad');
                        }
                    });
                }
                box.querySelector('.gr-otp__go').onclick = check;
                code.addEventListener('input', function() { if (/^\d{6}$/.test(code.value)) { check(); } });
                code.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); check(); } });
            });
        }
        if (form) {
            form.addEventListener('submit', function(e) {
                if (!hasVideo() || (confirmed && input.value.trim().toLowerCase() === confirmed)) { return; }
                e.preventDefault();
                e.stopImmediatePropagation();
                if (!box.querySelector('.gr-otp__code')) { idle(); box.hidden = false; }
                say(EMAIL.test(input.value.trim())
                    ? t('Για να σταλεί το βίντεο, επιβεβαίωσε πρώτα το email σου.', 'To send the video, confirm your email first.')
                    : t('Για να σταλεί το βίντεο, γράψε το email σου και επιβεβαίωσέ το.', 'To send the video, enter your email and confirm it.'),
                    'gr-otp__msg--bad');
                input.scrollIntoView({ block: 'center' });
                input.focus();
            }, true);
        }
        input.addEventListener('input', function() {
            if (confirmed && input.value.trim().toLowerCase() !== confirmed) { confirmed = ''; }
            if (!confirmed) { idle(); }
        });
        idle();
    }

    function scan() {
        var input = document.querySelector('.gr-reporter__contact #form_username_register');
        if (input) { ui(input); }
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
