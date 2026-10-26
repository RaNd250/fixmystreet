/*
 * Report form: the «Σύντομη περιγραφή» comes filled in with a short text (5-10 words) for the
 * category, or for the answer to «Τι συμβαίνει;» where there is one, so a report can be sent in a few
 * taps, e.g. from a car's screen (owner, 2026-10-26). Shown in grey; a tap in the box clears it to
 * write something else; left empty, it comes back. Sent as it is if left alone. «Άλλο» has none.
 * The ready text is kept in data-gr-default, so form-draft.js does not take it for a draft.
 */
(function() {
    'use strict';
    var EN = /^en/i.test(document.documentElement.lang || '');
    var TEXT = {
        'Λακκούβα ή φθορά οδοστρώματος': ['Λακκούβα στο οδόστρωμα, επικίνδυνη για οχήματα και δίκυκλα.', 'Pothole in the road, dangerous for vehicles and bikes.'],
        'Πρόβλημα με πεζοδρόμιο': ['Σπασμένο πεζοδρόμιο, δύσκολη και επικίνδυνη η διέλευση πεζών.', 'Broken pavement, hard and unsafe for pedestrians.'],
        'Θέματα καθαριότητας': ['Σκουπίδια ή μπάζα στο σημείο, χρειάζεται αποκομιδή.', 'Rubbish or rubble here, needs collecting.'],
        'Πράσινο και δέντρα': ['Δέντρο ή πράσινο που χρειάζεται κλάδεμα ή φροντίδα.', 'A tree or green space that needs pruning or care.'],
        'Οδοφωτισμός': ['Σβηστός ή χαλασμένος φανοστάτης, ο δρόμος είναι σκοτεινός.', 'Street light out or broken, the street is dark.'],
        'Στάθμευση σε φορτιστή EV ή εμπόδιο στη διέλευση': ['Παράνομα σταθμευμένο όχημα που εμποδίζει.', 'Illegally parked vehicle in the way.']
    };
    var ANSWER = {
        fortistis: ['Όχημα σταθμευμένο σε θέση φόρτισης χωρίς να φορτίζει.', 'Vehicle parked in a charging bay without charging.'],
        eisodos: ['Όχημα σταθμευμένο μπροστά σε είσοδο γκαράζ, κλείνει την έξοδο.', 'Vehicle parked across a garage entrance, blocking it.'],
        diplo: ['Διπλοπαρκαρισμένο όχημα που κλείνει τον δρόμο.', 'Double-parked vehicle blocking the road.'],
        stasi: ['Όχημα σταθμευμένο σε στάση λεωφορείου.', 'Vehicle parked at a bus stop.'],
        empodia: ['Κώνοι ή εμπόδια καταστήματος καταλαμβάνουν τον κοινόχρηστο χώρο.', 'A shop’s cones or obstacles take up public space.'],
        p72: ['Αυθαίρετη διαγράμμιση και πινακίδα P-72 χωρίς άδεια.', 'Unauthorised road markings and a P-72 sign.']
    };

    function current() {
        var answer = document.querySelector('input[type="radio"][name$="paravasi"]:checked');
        var cat = document.querySelector('input[name="category"]:checked');
        var pair = (answer && ANSWER[answer.value]) || (cat && TEXT[cat.value]);
        return pair ? pair[EN ? 1 : 0] : '';
    }

    function apply() {
        var box = document.getElementById('form_detail');
        if (!box) { return; }
        var want = current(), had = box.dataset.grDefault || '';
        // Only an empty box or one still holding the previous ready text is (re)filled.
        if (box.value !== '' && box.value !== had) { return; }
        box.value = want;
        if (want) { box.dataset.grDefault = want; } else { delete box.dataset.grDefault; }
        box.classList.toggle('gr-detail-default', !!want);
    }

    document.addEventListener('focusin', function(e) {
        var box = e.target;
        if (box.id !== 'form_detail' || !box.dataset.grDefault || box.value !== box.dataset.grDefault) { return; }
        box.value = '';
        box.classList.remove('gr-detail-default');
    });
    document.addEventListener('focusout', function(e) {
        var box = e.target;
        if (box.id !== 'form_detail' || box.value.trim() !== '' || !box.dataset.grDefault) { return; }
        box.value = box.dataset.grDefault;
        box.classList.add('gr-detail-default');
    });
    document.addEventListener('change', function(e) {
        if (e.target && (e.target.name === 'category' || /paravasi$/.test(e.target.name || ''))) { setTimeout(apply, 0); }
    }, true);
    document.addEventListener('click', function(e) {
        if (e.target && e.target.closest && e.target.closest('.js-reporting-page--next')) { setTimeout(apply, 0); }
    }, true);
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', apply); } else { apply(); }
})();
