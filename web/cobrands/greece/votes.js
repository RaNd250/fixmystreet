/*
 * 👍/👎 on the report page (report/_support.html): a click votes, a second click on the same one
 * takes the vote back, and the other one changes it. The report page can also be loaded into the
 * side panel later, so clicks are caught on the document.
 */
(function() {
    'use strict';
    // The page's language (the menu's switch): English texts when it is English.
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }


    function update(box, v) {
        Array.prototype.forEach.call(box.querySelectorAll('.gr-vote'), function(b) {
            var up = b.getAttribute('data-dir') === 'up';
            b.querySelector('.gr-vote__count').textContent = up ? v.up : v.down;
            b.setAttribute('aria-pressed', v.mine === (up ? 1 : -1) ? 'true' : 'false');
        });
    }

    document.addEventListener('click', function(e) {
        var btn = e.target.closest ? e.target.closest('.gr-vote') : null;
        var box = btn && btn.closest('.gr-votes');
        if (!box || btn.disabled) { return; }
        var dir = btn.getAttribute('aria-pressed') === 'true' ? 'none' : btn.getAttribute('data-dir');
        var buttons = box.querySelectorAll('.gr-vote');
        var status = box.querySelector('.gr-votes__status');
        Array.prototype.forEach.call(buttons, function(b) { b.disabled = true; });
        status.textContent = '';
        fetch('/greece/vote/' + encodeURIComponent(box.getAttribute('data-report')), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'dir=' + encodeURIComponent(dir)
        }).then(function(r) {
            return r.ok ? r.json() : Promise.reject(r.status);
        }).then(function(v) {
            update(box, v);
        }).catch(function(code) {
            status.textContent = code === 429 ? t('Πολλές ψήφοι σε λίγο χρόνο· δοκίμασε σε λίγο.', 'Too many votes in a short time; try again shortly.') : t('Η ψήφος δεν καταγράφηκε· δοκίμασε ξανά.', 'The vote was not recorded; please try again.');
        }).then(function() {
            Array.prototype.forEach.call(buttons, function(b) { b.disabled = false; });
        });
    });
})();
