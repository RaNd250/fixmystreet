/*
 * The report form's email is optional unless the name is to be shown publicly («Δημόσια προβολή του
 * ονόματός μου», hidden in private categories such as police complaints, where it never applies):
 * then it is marked required for jQuery Validate (class "required") and loses «(προαιρετικό)».
 * Greece.pm checks the same on the server. The form can be loaded later (the side panel on /around).
 * Complaints about parking and obstacles are published but never with a name (Greece.pm
 * greece_public_complaint), so the box is hidden and unticked for that category.
 */
(function() {
    'use strict';

    function sync() {
        var email = document.getElementById('form_username_register');
        if (!email || email.form && email.form.id !== 'mapForm') { return; }
        var show = document.getElementById('form_may_show_name');
        var cat = document.querySelector('input[name="category"]:checked');
        var complaint = !!(cat && cat.value === 'Στάθμευση σε φορτιστή EV ή εμπόδιο στη διέλευση');
        var box = show && (show.closest('.gr-showname') || show.closest('.checkbox-group') || show.parentNode);
        if (box) { box.hidden = complaint; }
        if (complaint && show) { show.checked = false; }
        var required = !!(show && show.checked && show.offsetParent !== null);
        email.classList.toggle('required', required);
        email.setAttribute('aria-required', required ? 'true' : 'false');
        var optional = document.getElementById('js-optional-email');
        if (optional) { optional.hidden = required; }
        if (!required && window.jQuery) {
            jQuery(email).removeClass('form-error').attr('aria-invalid', null);
            jQuery('#form_username_register-error').remove();
        }
    }

    document.addEventListener('change', function(e) {
        if (e.target && (e.target.id === 'form_may_show_name' || e.target.name === 'category')) { setTimeout(sync, 0); }
    }, true);
    document.addEventListener('click', function(e) {
        if (e.target && e.target.closest && e.target.closest('.js-reporting-page--next')) { setTimeout(sync, 0); }
    }, true);
    var queued = false;
    if (window.MutationObserver) {
        new MutationObserver(function() {
            if (queued) { return; }
            queued = true;
            window.requestAnimationFrame(function() { queued = false; sync(); });
        }).observe(document.documentElement, { childList: true, subtree: true });
    }
    document.addEventListener('DOMContentLoaded', sync);
    sync();
})();
