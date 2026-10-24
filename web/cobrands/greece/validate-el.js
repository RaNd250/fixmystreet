/*
 * Greek messages for jQuery Validate's checks that FixMyStreet gives no message of its own (e.g. a
 * required category question), which otherwise show in English ("This field is required.").
 */
(function() {
    'use strict';
    function greek() {
        if (!window.jQuery || !jQuery.validator || /^en/i.test(document.documentElement.lang || '')) { return; }
        jQuery.extend(jQuery.validator.messages, {
            required: 'Αυτό το πεδίο είναι υποχρεωτικό.',
            email: 'Γράψε μια σωστή διεύθυνση email.',
            url: 'Γράψε μια σωστή διεύθυνση ιστοσελίδας.',
            number: 'Γράψε έναν αριθμό.',
            digits: 'Γράψε μόνο ψηφία.',
            maxlength: jQuery.validator.format('Γράψε το πολύ {0} χαρακτήρες.'),
            minlength: jQuery.validator.format('Γράψε τουλάχιστον {0} χαρακτήρες.')
        });
    }
    greek();
    document.addEventListener('DOMContentLoaded', greek);
})();
