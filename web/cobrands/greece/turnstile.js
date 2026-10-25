/*
 * Cloudflare Turnstile on the report, update and contact forms (templates/web/greece/_turnstile.html,
 * checked on the server by Greece.pm). Cloudflare's script is loaded only when a check is on the page,
 * and each check is rendered once, also in forms loaded later (the report form in the side panel).
 * The token it adds to the form (cf-turnstile-response) works once and for five minutes; Cloudflare
 * renews it if the form stays open longer.
 */
(function() {
    'use strict';
    var loading = false, ready = false;

    function render() {
        if (!ready || !window.turnstile) { return; }
        Array.prototype.forEach.call(document.querySelectorAll('.gr-turnstile:not([data-gr-rendered])'), function(el) {
            el.setAttribute('data-gr-rendered', '1');
            window.turnstile.render(el, {
                sitekey: el.getAttribute('data-sitekey'),
                language: 'el',
                // Takes no room unless Cloudflare needs a click.
                appearance: 'interaction-only',
                size: 'flexible',
                'refresh-expired': 'auto'
            });
        });
    }

    window.grTurnstileReady = function() { ready = true; render(); };

    function check() {
        if (!document.querySelector('.gr-turnstile:not([data-gr-rendered])')) { return; }
        if (ready) { render(); return; }
        if (loading) { return; }
        loading = true;
        var s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=grTurnstileReady';
        s.async = true;
        document.head.appendChild(s);
    }

    var queued = false;
    if (window.MutationObserver) {
        new MutationObserver(function() {
            if (queued) { return; }
            queued = true;
            window.requestAnimationFrame(function() { queued = false; check(); });
        }).observe(document.documentElement, { childList: true, subtree: true });
    }
    document.addEventListener('DOMContentLoaded', check);
    check();
})();
