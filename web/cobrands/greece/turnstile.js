/*
 * Cloudflare Turnstile on the report, update, follow and contact forms (templates/web/greece/_turnstile.html,
 * checked on the server by Greece.pm). A check starts only when its form is used (a tap or a field
 * focused in it), so a page does not show a check nobody asked for (owner, 2026-10-27: «να μην
 * κουράζουν»); Cloudflare's script is loaded then. If the form is sent before the check is done,
 * sending waits for it and then goes on by itself. Once passed, the session remembers it for 12 hours
 * and the page has no check at all (Greece.pm greece_turnstile_remembered).
 * The token it adds to the form (cf-turnstile-response) works once and for five minutes; Cloudflare
 * renews it if the form stays open longer.
 */
(function() {
    'use strict';
    var loading = false, ready = false, wanted = [];

    function token(el) {
        var input = el.querySelector('[name="cf-turnstile-response"]');
        return input && input.value;
    }

    function render(el) {
        if (el.getAttribute('data-gr-rendered')) { return; }
        if (!ready || !window.turnstile) { if (wanted.indexOf(el) === -1) { wanted.push(el); } load(); return; }
        el.setAttribute('data-gr-rendered', '1');
        window.turnstile.render(el, {
            sitekey: el.getAttribute('data-sitekey'),
            language: 'el',
            // Takes no room unless Cloudflare needs a click.
            appearance: 'interaction-only',
            size: 'flexible',
            'refresh-expired': 'auto',
            callback: function() {
                var form = el.closest('form');
                if (form && form.dataset.grSendWhenChecked) {
                    delete form.dataset.grSendWhenChecked;
                    if (form.requestSubmit) { form.requestSubmit(form.grSubmitter || undefined); } else { form.submit(); }
                }
            }
        });
    }

    function load() {
        if (loading) { return; }
        loading = true;
        var s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=grTurnstileReady';
        s.async = true;
        document.head.appendChild(s);
    }

    window.grTurnstileReady = function() {
        ready = true;
        wanted.splice(0).forEach(render);
    };

    // The checks of the form an event happened in (one form can hold more than one, e.g. the report form).
    function checksOf(target) {
        var form = target && target.closest && target.closest('form');
        return form ? Array.prototype.slice.call(form.querySelectorAll('.gr-turnstile')) : [];
    }

    function wake(e) { checksOf(e.target).forEach(render); }
    document.addEventListener('focusin', wake, true);
    document.addEventListener('pointerdown', wake, true);

    document.addEventListener('submit', function(e) {
        var checks = checksOf(e.target).filter(function(el) { return el.offsetParent !== null; });
        if (!checks.length || checks.some(token)) { return; }
        e.preventDefault();
        e.stopImmediatePropagation();
        e.target.dataset.grSendWhenChecked = '1';
        e.target.grSubmitter = e.submitter || null;
        checks.forEach(render);
    }, true);
})();
