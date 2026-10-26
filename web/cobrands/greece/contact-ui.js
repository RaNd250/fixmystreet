/*
 * The contact form (templates/web/greece/contact/form.html): the message box grows with its text and
 * counts its characters, and «Αποστολή» shows that it is sending. The checks and their messages are
 * FixMyStreet's own (jQuery Validate), one per field, as on every other form.
 */
(function() {
    'use strict';
    var form = document.querySelector('form.gr-cform');
    if (!form) { return; }
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }

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

    // Sending: only once FixMyStreet's checks pass; otherwise a shake and its messages.
    var send = form.querySelector('.gr-cform__send');
    form.addEventListener('submit', function() {
        var $ = window.jQuery;
        if ($ && $.fn.valid && !$(form).valid()) {
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
