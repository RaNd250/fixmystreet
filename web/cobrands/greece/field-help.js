/*
 * Help for the staff: a small yellow «?» next to the fields of the report page's inspector panel and of the admin
 * edit page. A tap opens a short note on what the field is for and what to write in it; another tap, a tap
 * elsewhere or Escape closes it. The panel is loaded after the page, so the page is looked at again when it changes.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    function t(el, en) { return EN ? en : el; }

    // selector of the field -> [Greek, English]
    var HELP = [
        ['#category', 'Η κατηγορία της αναφοράς. Αν είναι σε λάθος κατηγορία, άλλαξέ την. Πριν σταλεί, η αλλαγή μπορεί να αλλάξει και τον παραλήπτη.',
            'The category of the report. If it is in the wrong one, change it. Before it is sent, this can change the recipient too.'],
        ['#state', 'Η κατάσταση που βλέπουν οι πολίτες. «Ανοιχτό»: δεν έχει λυθεί. «Διορθώθηκε»: έγινε η εργασία. Γράψε και μια δημόσια ενημέρωση για να το μάθουν.',
            'The status citizens see. “Open”: not solved. “Fixed”: the work is done. Add a public update so they know.'],
        ['#assignment', 'Σε ποιον έχει ανατεθεί να την χειριστεί. Φαίνεται μόνο στο προσωπικό.',
            'Who is to deal with it. Only staff see it.'],
        ['#problem_priority', 'Η προτεραιότητα της αναφοράς: «Υψηλή - κίνδυνος ατυχήματος» για ό,τι μπορεί να τραυματίσει κάποιον, αλλιώς «Κανονική». Φαίνεται μόνο στο προσωπικό.',
            'The priority of the report: “High - risk of accident” for what could hurt someone, otherwise “Normal”. Only staff see it.'],
        ['#detailed_information', 'Σημειώσεις για εσάς και τους συναδέλφους σου, π.χ. τι βρέθηκε επί τόπου. Δεν δημοσιεύονται.',
            'Notes for you and your colleagues, for example what was found on site. Not published.'],
        ['#non_public', 'Ιδιωτικό: η αναφορά κρύβεται από το κοινό και από τον χάρτη. Για προσωπικά στοιχεία ή ευαίσθητο περιεχόμενο.',
            'Private: the report is hidden from the public and the map. For personal or sensitive content.'],
        ['input[name=include_update]', 'Αν είναι τικαρισμένο, αυτά που γράφεις στη δημόσια ενημέρωση δημοσιεύονται κάτω από την αναφορά και ο πολίτης παίρνει email.',
            'If ticked, what you write in the public update is published under the report and the citizen gets an email.'],
        ['#public_update', 'Ένα σύντομο μήνυμα προς τον πολίτη, που φαίνεται σε όλους στη σελίδα της αναφοράς. Γράψε τι έγινε ή τι θα γίνει, π.χ. «Στάλθηκε συνεργείο» ή «Επιδιορθώθηκε». Μη γράφεις ονόματα, τηλέφωνα ή άλλα προσωπικά στοιχεία.',
            'A short message to the citizen, visible to everyone on the report page. Say what was done or will be done, for example “A crew was sent” or “Repaired”. Do not write names, phone numbers or other personal data.'],
        ['#photo-upload-label', 'Φωτογραφία της εργασίας ή του αποτελέσματος. Θα φαίνεται δημόσια μαζί με την ενημέρωση.',
            'A photo of the work or the result. It is shown publicly with the update.'],
        ['input[name=title]', 'Ο τίτλος που βλέπουν όλοι. Σύντομος και περιγραφικός.',
            'The title everyone sees. Short and descriptive.'],
        ['textarea[name=detail]', 'Το κείμενο της αναφοράς, όπως φαίνεται δημόσια. Διόρθωσε μόνο ορθογραφία ή αφαίρεσε προσωπικά στοιχεία· αλλιώς άφησέ το όπως το έγραψε ο πολίτης.',
            'The text of the report as it is shown publicly. Only fix spelling or remove personal data; otherwise leave it as the citizen wrote it.']
    ];

    // Only on the staff pages: the inspector panel of a report and the admin pages. A citizen's report form has none.
    function staffPage() { return !!document.getElementById('report_inspect_form') || /^\/admin\//.test(location.pathname); }

    var open = null;
    function close() {
        if (!open) { return; }
        open.btn.setAttribute('aria-expanded', 'false');
        open.bubble.hidden = true;
        open = null;
    }

    // The note sits under its button, kept inside the window (above the button when there is no room below).
    function place(btn, bubble) {
        var r = btn.getBoundingClientRect();
        bubble.style.visibility = 'hidden';
        bubble.hidden = false;
        var w = bubble.offsetWidth, h = bubble.offsetHeight;
        var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
        var top = r.bottom + 8;
        if (top + h > window.innerHeight - 8) { top = Math.max(8, r.top - h - 8); }
        bubble.style.left = left + 'px';
        bubble.style.top = top + 'px';
        bubble.style.visibility = '';
    }

    function labelFor(el) {
        if (el.matches && el.matches('label')) { return el; }
        if (el.id) {
            var l = document.querySelector('label[for="' + el.id + '"]');
            if (l) { return l; }
        }
        return el.closest ? el.closest('label') : null;
    }

    function attach(el, text) {
        var label = labelFor(el);
        if (!label || label.getAttribute('data-gr-help')) { return; }
        label.setAttribute('data-gr-help', '1');
        var wrap = document.createElement('span');
        wrap.className = 'gr-help';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gr-help__btn';
        btn.setAttribute('aria-label', t('Τι γράφω εδώ;', 'What do I write here?'));
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = '?';
        var bubble = document.createElement('span');
        bubble.className = 'gr-help__bubble';
        bubble.setAttribute('role', 'note');
        bubble.hidden = true;
        bubble.textContent = text;
        document.body.appendChild(bubble);
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var wasOpen = open && open.btn === btn;
            close();
            if (!wasOpen) {
                btn.setAttribute('aria-expanded', 'true');
                place(btn, bubble);
                open = { btn: btn, bubble: bubble };
            }
        });
        wrap.appendChild(btn);
        if (label.id === 'photo-upload-label' && label.parentNode) {
            var row = document.createElement('span');
            row.className = 'gr-help-row';
            label.parentNode.insertBefore(row, label);
            row.appendChild(label);
            row.appendChild(wrap);
        } else {
            label.appendChild(wrap);
        }
    }

    function scan() {
        if (!staffPage()) { return; }
        HELP.forEach(function(h) {
            var el = document.querySelector(h[0]);
            if (el) { attach(el, t(h[1], h[2])); }
        });
    }

    document.addEventListener('click', function(e) { if (open && !(e.target.closest && (e.target.closest('.gr-help') || e.target.closest('.gr-help__bubble')))) { close(); } });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { close(); } });
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    var queued = false;
    function schedule() {
        if (queued) { return; }
        queued = true;
        window.requestAnimationFrame(function() { queued = false; scan(); });
    }
    function start() {
        scan();
        if (window.MutationObserver) { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); }
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start); } else { start(); }
})();
