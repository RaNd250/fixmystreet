/*
 * 👍/👎 on the report page (report/_support.html): a click votes, a second click on the same one
 * takes the vote back, and the other one changes it. The report page can also be loaded into the
 * side panel later, so clicks are caught on the document.
 *
 * A count that changes rolls to its new value (after EasyUI's Animated Number Morph, MIT), and a
 * short message at the bottom of the screen says what happened, with «Αναίρεση» to put the previous
 * vote back (after EasyUI's Undo Toast).
 */
(function() {
    'use strict';
    // The page's language (the menu's switch): English texts when it is English.
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // The count rolls up when it grows and down when it shrinks.
    function setCount(el, value) {
        value = String(value);
        var old = el.getAttribute('data-value') || el.textContent.trim();
        el.setAttribute('data-value', value);
        if (old === value) { return; }
        if (reduced || !el.animate) { el.textContent = value; return; }
        var up = Number(value) > Number(old);
        el.innerHTML = '<span class="gr-morph"><span class="gr-morph__old">' + old + '</span><span class="gr-morph__new">' + value + '</span></span>';
        var oldEl = el.querySelector('.gr-morph__old'), newEl = el.querySelector('.gr-morph__new');
        var opts = { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'both' };
        oldEl.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(' + (up ? '-100%' : '100%') + ')', opacity: 0 }], opts);
        newEl.animate([{ transform: 'translateY(' + (up ? '100%' : '-100%') + ')', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], opts)
            .finished.then(function() { if (el.getAttribute('data-value') === value) { el.textContent = value; } });
    }

    function update(box, v) {
        Array.prototype.forEach.call(box.querySelectorAll('.gr-vote'), function(b) {
            var up = b.getAttribute('data-dir') === 'up';
            setCount(b.querySelector('.gr-vote__count'), up ? v.up : v.down);
            b.setAttribute('aria-pressed', v.mine === (up ? 1 : -1) ? 'true' : 'false');
        });
    }

    var toast, toastTimer;
    function showToast(text, undo) {
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'gr-toast';
            toast.setAttribute('role', 'status');
            toast.innerHTML = '<span class="gr-toast__text"></span><button type="button" class="gr-toast__undo"></button>';
            document.body.appendChild(toast);
        }
        toast.querySelector('.gr-toast__text').textContent = text;
        var btn = toast.querySelector('.gr-toast__undo');
        btn.textContent = t('Αναίρεση', 'Undo');
        btn.hidden = !undo;
        btn.onclick = function() { hideToast(); if (undo) { undo(); } };
        toast.classList.remove('gr-toast--out');
        toast.classList.add('gr-toast--in');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, 5000);
    }
    function hideToast() {
        if (!toast) { return; }
        clearTimeout(toastTimer);
        toast.classList.remove('gr-toast--in');
        toast.classList.add('gr-toast--out');
    }

    function message(before, after) {
        if (after === 0) { return t('Η ψήφος σου αφαιρέθηκε.', 'Your vote was removed.'); }
        if (before === 0) { return after === 1 ? t('Ψήφισες 👍 «συμφωνώ».', 'You voted 👍 “agree”.') : t('Ψήφισες 👎 «διαφωνώ».', 'You voted 👎 “disagree”.'); }
        return after === 1 ? t('Η ψήφος σου άλλαξε σε 👍.', 'Your vote changed to 👍.') : t('Η ψήφος σου άλλαξε σε 👎.', 'Your vote changed to 👎.');
    }

    function mine(box) {
        var pressed = box.querySelector('.gr-vote[aria-pressed="true"]');
        return pressed ? (pressed.getAttribute('data-dir') === 'up' ? 1 : -1) : 0;
    }

    function vote(box, dir, isUndo) {
        var buttons = box.querySelectorAll('.gr-vote');
        var status = box.querySelector('.gr-votes__status');
        var before = mine(box);
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
            if (isUndo) {
                showToast(t('Η προηγούμενη ψήφος επανήλθε.', 'Your previous vote is back.'));
            } else {
                showToast(message(before, v.mine), function() {
                    vote(box, before === 1 ? 'up' : before === -1 ? 'down' : 'none', true);
                });
            }
        }).catch(function(code) {
            status.textContent = code === 429 ? t('Πολλές ψήφοι σε λίγο χρόνο· δοκίμασε σε λίγο.', 'Too many votes in a short time; try again shortly.') : t('Η ψήφος δεν καταγράφηκε· δοκίμασε ξανά.', 'The vote was not recorded; please try again.');
        }).then(function() {
            Array.prototype.forEach.call(buttons, function(b) { b.disabled = false; });
        });
    }

    document.addEventListener('click', function(e) {
        var btn = e.target.closest ? e.target.closest('.gr-vote') : null;
        var box = btn && btn.closest('.gr-votes');
        if (!box || btn.disabled) { return; }
        vote(box, btn.getAttribute('aria-pressed') === 'true' ? 'none' : btn.getAttribute('data-dir'), false);
    });
})();
