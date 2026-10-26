/*
 * The name is optional (Greece.pm greece_default_name): the name field of the report, update and
 * contact forms comes filled in with «Ανώνυμος» in grey; a tap clears it to type a name, an empty
 * field gets it back, and if left alone the server takes it as «Ανώνυμος πολίτης». Not when the field
 * already holds a name (signed in, or typed before). Forms loaded later are looked at too.
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
    function scan() { Array.prototype.forEach.call(document.querySelectorAll('input#form_name'), fill); }

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
