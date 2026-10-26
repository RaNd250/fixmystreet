/*
 * Report form: an emoji before each category («🌳 Πράσινο και δέντρα») and before each answer to
 * «Τι συμβαίνει;» (paravasi), so the tiles can be told apart at a glance. Keyed by the stored (Greek)
 * category name and by the answer's key, which the radios' values keep in English too. The label's own ::before/::after draw the tile, so the emoji is a span. The form can
 * be redrawn (category list loaded later), so labels are looked at whenever the page changes.
 */
(function() {
    'use strict';
    var EMOJI = {
        'Λακκούβα ή φθορά οδοστρώματος': '🕳️',
        'Πρόβλημα με πεζοδρόμιο': '🚶',
        'Στάθμευση σε ράμπα ή θέση ΑμεΑ, πεζοδρόμιο ή διάβαση': '♿',
        'Στάθμευση σε φορτιστή EV ή εμπόδιο στη διέλευση': '🔌',
        'Θέματα καθαριότητας': '🗑️',
        'Πράσινο και δέντρα': '🌳',
        'Οδοφωτισμός': '💡',
        'Άλλο': '📝'
    };
    // «Τι συμβαίνει;» (the paravasi question; keys as in Greece.pm %SMS_VEHICLE / %SMS_OTHER).
    var ANSWER = {
        fortistis: '🔌', eisodos: '🏠', diplo: '🚗', stasi: '🚌', empodia: '🚧', p72: '🪧',
        xoris_karta: '♿', rampa: '♿', pezodromio: '🚶', diavasi: '🚸'
    };
    function decorate() {
        var inputs = document.querySelectorAll('input[name="category"], input[type="radio"][name$="paravasi"]');
        Array.prototype.forEach.call(inputs, function(input) {
            var e = input.name === 'category' ? EMOJI[input.value] : ANSWER[input.value];
            var label = e && input.id && document.querySelector('label[for="' + input.id + '"]');
            if (!label || label.querySelector('.gr-cat-emoji')) { return; }
            var span = document.createElement('span');
            span.className = 'gr-cat-emoji';
            span.setAttribute('aria-hidden', 'true');
            span.textContent = e;
            label.insertBefore(span, label.firstChild);
        });
    }
    var queued = false;
    function schedule() {
        if (queued) { return; }
        queued = true;
        window.requestAnimationFrame(function() { queued = false; decorate(); });
    }
    function start() {
        decorate();
        if (window.MutationObserver) { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); }
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start); } else { start(); }
})();
