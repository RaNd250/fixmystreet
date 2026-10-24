package FixMyStreet::Cobrand::Greece;
use base 'FixMyStreet::Cobrand::Default';

use strict;
use warnings;
use utf8;

# Reuse the Default cobrand's compiled CSS; this cobrand only adds templates and a little JS/CSS.
sub asset_moniker { 'default' }

# Search box: "ref: 123" (database id) or a public reference "DDMMYYYY-N".
# A bare number stays a place search, because Greek postcodes are five digits.
sub lookup_by_ref_regex { qr/^\s*(?|ref:\s*(\d+)|(\d{8}-\d+))\s*$/ }

sub lookup_by_ref {
    my ($self, $ref) = @_;
    return unless $ref =~ /^(\d\d)(\d\d)(\d{4})-(\d+)$/;
    my $id = FixMyStreet::DB::Result::Problem::greece_ref_to_id("$3-$2-$1", $4);
    return [ id => $id || 0 ];
}

# Values the report email templates use besides the stock ones.
sub munge_sendreport_params {
    my ($self, $row, $h, $params) = @_;

    # The address the email went to, so the recipient can send us a better one.
    $h->{sent_to} = join ', ', map { ref $_ ? $_->[0] : $_ } @{ $params->{To} || [] };

    # A category can have its own email (contact extra metadata email_template: "ev" for the police
    # complaint about EV-charging bays and blocked passage, "amea" for disabled bays, ramps,
    # pavements and crossings); submit.txt hands over to submit-<template>.txt.
    my $contact = $row->contact;
    my $template = ($contact && $contact->get_extra_metadata('email_template')) || '';
    $h->{email_template} = $template if $template =~ /^[a-z]+$/;

    # The reporter's contact details for the letters; a report made without an email has none, and
    # replies to it go to the site's contact address rather than the shared anonymous account.
    if ($self->greece_anonymous_report($row)) {
        $h->{reporter_email} = '';
        $h->{reporter_phone} = $row->get_extra_metadata('greece_phone') // '';
        $params->{'Reply-To'} = [ [ $self->contact_email, 'FixMyStreets' ] ] if $params->{'Reply-To'};
    } else {
        $h->{reporter_email} = $row->user->email // '';
        $h->{reporter_phone} = $row->user->phone // '';
    }

    # The location as a Google Maps link, which the police letters give instead of coordinates.
    $h->{gmaps_url} = sprintf 'https://www.google.com/maps/search/?api=1&query=%.6f,%.6f', $row->latitude, $row->longitude;

    # The municipality of the location, for emails to a body that is not the municipality.
    my $dimos = $row->greece_dimos;
    $h->{dimos_name} = $dimos->name if $dimos;
}

# Police complaints (EV-charging bays, blocked passage) can also be sent by the reporter as an SMS
# from their own phone; see Problem::greece_sms.
sub greece_sms_number { '100' }

# Reporting needs no account and no email confirmation: a report is confirmed and sent straight
# away. Afterwards the reporter's address gets a one-off link to create an account (below).
sub never_confirm_reports { 1 }

# A report needs no email when the reporter's name is not shown publicly (always, in private
# categories such as police complaints). FixMyStreet then files it under one shared account
# (anonymous_account), sends no alerts or questionnaires; the name and phone typed, if any, stay on
# the report (report_new_munge_before_insert) for the body or police, and replies to the email go
# to the site's contact address (munge_sendreport_params). The email is needed to show the name.
sub allow_anonymous_reports { 1 }

sub anonymous_account {
    my $domain = FixMyStreet->config('EMAIL_DOMAIN') or return;
    return { email => "anonymous\@$domain", name => 'Ανώνυμος πολίτης' };
}

# Cloudflare Turnstile: a visitor who is not signed in passes Cloudflare's check before a report,
# an update or a contact message is accepted (templates/web/greece/_turnstile.html, turnstile.js).
# The keys are TURNSTILE_SITEKEY and TURNSTILE_SECRET in general.yml; without them there is no check.
# If Cloudflare cannot be asked, the form is let through (the per-visitor limit in nginx still holds).
# Until TURNSTILE_ENFORCE is set, a refused check is only logged, so that it can be seen to pass for
# real visitors (automated browsers never get a token) before it can turn anyone away.
sub greece_turnstile_sitekey { FixMyStreet->config('TURNSTILE_SITEKEY') }

sub greece_turnstile_ok {
    my ($self, $c) = @_;
    my $secret = FixMyStreet->config('TURNSTILE_SECRET') or return 1;
    return 1 if $c->user_exists;
    return $c->stash->{greece_turnstile} if defined $c->stash->{greece_turnstile};   # a token works once
    my $token = $c->get_param('cf-turnstile-response') // '';
    my $ok = 0;
    if ($token ne '') {
        require HTTP::Tiny;
        require JSON::MaybeXS;
        my $ip = $c->req->header('CF-Connecting-IP');
        my $res = HTTP::Tiny->new(timeout => 10)->post_form('https://challenges.cloudflare.com/turnstile/v0/siteverify',
            { secret => $secret, response => $token, ($ip ? (remoteip => $ip) : ()) });
        if ($res->{status} == 599 || $res->{status} >= 500) {
            $c->log->warn("Turnstile not reachable ($res->{status}); form let through");
            $ok = 1;
        } else {
            my $out = eval { JSON::MaybeXS::decode_json($res->{content}) } || {};
            $ok = $out->{success} ? 1 : 0;
            $c->log->warn('Turnstile ' . ($ok ? 'passed' : 'refused: ' . join(',', @{ $out->{'error-codes'} || [] })));
        }
    } else {
        $c->log->warn('Turnstile refused: no token');
    }
    $ok = 1 unless FixMyStreet->config('TURNSTILE_ENFORCE');
    return $c->stash->{greece_turnstile} = $ok;
}

use constant GREECE_TURNSTILE_ERROR => 'Ο έλεγχος ασφαλείας δεν ολοκληρώθηκε. Περίμενε λίγο να ολοκληρωθεί και στείλε ξανά.';

sub extra_contact_validation {
    my ($self, $c) = @_;
    return $self->greece_turnstile_ok($c) ? () : (turnstile => GREECE_TURNSTILE_ERROR);
}

# Whether the report was made without an email (filed under anonymous_account).
sub greece_anonymous_report {
    my ($self, $report) = @_;
    my $anon = $self->anonymous_account or return 0;
    return lc($report->user && $report->user->email // '') eq lc $anon->{email} ? 1 : 0;
}

# The report form has no title field, only the description (templates/web/greece/report/new/
# form_report.html). The title is the category, which is what lists, the report page and the
# emails to the body show above the description; for «Άλλα» it is the start of the description.
sub report_check_for_errors {
    my ($self, $c) = @_;
    my $report = $c->stash->{report};
    my %more;
    if (!$c->user_exists && $report && !$report->non_public && $c->get_param('may_show_name')
        && ($c->get_param('username_register') // '') !~ /\S/) {
        $more{username_register} = 'Για να φαίνεται δημόσια το όνομά σου, γράψε και το email σου.';
    }
    $more{turnstile} = GREECE_TURNSTILE_ERROR unless $self->greece_turnstile_ok($c);
    if ($report && ($report->title // '') !~ /\S/) {
        my $category = $report->category // '';
        my $title = $category eq 'Άλλα' || $category eq '' ? greece_excerpt($report->detail, 60) : $category;
        $report->title($title || $category || 'Αναφορά');
    }
    return ($self->SUPER::report_check_for_errors($c), %more);
}

# The text on one line, cut at a word to at most $max characters, with "…" if cut.
sub greece_excerpt {
    my ($text, $max) = @_;
    $text = $text // '';
    $text =~ s/\s+/ /g;
    $text =~ s/^ | $//g;
    return $text if length $text <= $max;
    my $cut = substr($text, 0, $max);
    $cut =~ s/[\s,.;:·]+\S*$// if $cut =~ /\s/;
    return "$cut…";
}

# Not signed in, the report form must not change an existing account: FixMyStreet writes the
# form's name and phone onto the user with that email, and with no confirmation anyone could do
# that. This hook runs before, with the address given; keep what the account has, and put it back
# before the report is saved (report_new_munge_before_insert). The report keeps the name given.
sub disable_login_for_email {
    my ($self, $email) = @_;
    my $c = $self->{c} or return;
    return if $c->user_exists;
    my $user = $email && FixMyStreet::DB->resultset('User')->find({ email => lc $email });
    $c->stash->{greece_account_before} = $user
        ? { id => $user->id, map { $_ => $user->$_ } qw(name phone title) } : undef;
    return;
}

sub report_new_munge_before_insert {
    my ($self, $report) = @_;
    my $c = $self->{c};
    if ($c && !$c->user_exists && $c->stash->{contributing_as_anonymous_user}) {
        # FixMyStreet put the shared account's name on the report; keep what was typed instead.
        my $name = $c->get_param('name') // '';
        $name =~ s/^\s+|\s+$//g;
        $report->name($name ne '' ? $name : $self->anonymous_account->{name});
        $report->anonymous(1);
        $report->send_questionnaire(0);
        my $phone = $c->get_param('phone') // '';
        $phone =~ s/^\s+|\s+$//g;
        $report->set_extra_metadata(greece_phone => $phone) if $phone ne '';
    }
    $self->greece_bad_words($report);
    return unless $c;
    my $before = $c->stash->{greece_account_before} or return;
    my $user = $report->user;
    return unless $user && $user->in_storage && $user->id == $before->{id};
    $user->$_($before->{$_}) for qw(name phone title);
    $user->update if $user->is_changed;
}

# After a report made without signing in, email the address given a link that signs in once and
# asks for a password: the account is created (or, if one exists, opened) only if they want it.
sub report_new_munge_after_insert {
    my ($self, $report) = @_;
    my $c = $self->{c} or return;
    $self->greece_moderation_email($report);
    return if $c->user_exists || $c->stash->{greece_account_link_sent} || $self->greece_anonymous_report($report);
    my $user = $report->user;
    return unless $user && $user->email;
    my $exists = $user->password ? 1 : 0;
    my $token = $c->model('DB::Token')->create({ scope => 'email_sign_in', data => {
        email => $user->email,
        r => $exists ? 'my' : 'auth/change_password',
        # Never rename an existing account from a form anyone can fill in.
        ($user->name ? () : (name => $report->name)),
    } });
    $c->send_email('account-link.txt', {
        to => [ [ $user->email, $report->name ] ],
        report => $report,
        account_exists => $exists,
        token_url => $c->uri_for_action('/auth/token', [ $token->token ]),
        report_url => $report->non_public || $report->state eq 'hidden' ? '' : $self->base_url_for_report($report) . $report->url,
    });
    $c->stash->{greece_account_link_sent} = 1;
}

# Bad words in the report form: each one becomes "***", and a report with GREECE_MODERATE or more
# is held for a moderator: hidden and flagged, so it is neither shown nor sent until a moderator
# opens it in the admin (/admin/flagged). Whole words, any case; "παλιο-", "βρωμο-", "ψωρο-" in
# front count too. Accents are written where the word without them is a harmless one (μαλάκα, the
# insult; μαλακά, softly), so those match only as written with the accent.
use constant GREECE_MODERATE => 3;
my @BAD_WORDS = (
    # Greek
    'μαλ[άα]κας', 'μαλάκα', 'μαλ[άα]κες', 'μαλάκων', 'μαλακ[ίι](?:α|ας|ες)', 'μαλακι[ώω]ν', 'μαλακισμ[έε]ν\p{L}*',
    'γαμ[ώω]', 'γαμ[ώω]το', 'γαμ[ηή]σ(?:ου|τε|ε|ω)', 'γάμησ(?:[εέ]|αν|ες)', 'γαμ[ηή]σι\p{L}*', 'γαμι[έε]σ(?:αι|αστε|τε)', 'γαμι[έε]ται',
    'γαμι[όο]υνται', 'γαμημ[έε]ν\p{L}*', 'γαμι[όο]λ\p{L}*',
    'π[οό][υύ]στ\p{L}*', 'καρ(?:γ)?ι[όο]λ\p{L}*', 'πουτ[άα]ν\p{L}*', 'τσο[υύ]λ(?:α|ας|ες)',
    'αρχ[ιί]δ[ιί](?:α|ά|ων|ών)?', 'αρχιδ[άα]τ\p{L}*', 'μουν[ίι]', 'μουνι[άα]', 'μουνι[ώω]ν', 'μουν[άα]ρ\p{L}*', 'μουν[όο]π[αά]ν\p{L}*',
    'ψωλ(?:ή|η|ές|ες|ής|ης)', 'κα[υύ]λ(?:α|ας|ί|ι|ιά|ια|ωμ[έε]ν\p{L}*)', 'βυζ[ιί](?:α|ά)?',
    'σκατ(?:[άα]|[όο]|[ώω]ν|[έε]ν\p{L}*|ο\p{L}{3,})', 'χ[έε]σ(?:ε|τε|ου)', 'χ[έε]στηκ\p{L}*', 'χεσμ[έε]ν\p{L}*',
    'κ[ώω]λ(?:ος|ο|ου|οι|ους)', 'κωλ[οό]\p{L}{3,}', 'κερατ[άα](?:ς|δες|δων)',
    'βλ[άα]κ(?:ας|α|ες)', 'ηλ[ίι]θι\p{L}*',
    'γ[ύυ]φτ(?:ος|οι|ου|ους|ισσα|ισσες|ιά|ια|ιές|ιες|ικ\p{L}*|αρι\p{L}*)',
    # Greeklish
    'malak(?:as|a|es|ia|ies|ismen\p{L}*)', 'gam(?:w|o|wto|oto|isou|hsou|iesai|imen\p{L}*|hmen\p{L}*|iol\p{L}*)',
    'poust\p{L}*', 'kar(?:g)?iol\p{L}*', 'poutan\p{L}*', 'arxid\p{L}*', 'mouni(?:a)?', 'skata', 'xese', 'tsoula',
    'psol(?:i|h)',
    # English
    'fuck\p{L}*', 'motherfuck\p{L}*', 'shit(?:s|ty|ting|head\p{L}*)?', 'bitch\p{L}*', 'asshole\p{L}*', 'cunt\p{L}*',
    'dickhead\p{L}*', 'bastard\p{L}*', 'wank\p{L}*',
);
my $BAD_WORDS = do {
    my $words = join '|', @BAD_WORDS;
    qr/(?<![\p{L}\p{N}])(?:παλι[οό]|βρ[ωώ]μ[οό]|ψωρ[οό])?(?:$words)(?![\p{L}\p{N}])/i;
};

# The text with every bad word as "***", and how many there were.
sub greece_mask_bad_words {
    my ($text) = @_;
    return ($text, 0) unless defined $text && $text =~ /\S/;
    my $count = $text =~ s/$BAD_WORDS/***/g;
    return ($text, $count || 0);
}

sub greece_bad_words {
    my ($self, $report) = @_;
    my $count = 0;
    for my $field (qw(detail name)) {
        my ($masked, $n) = greece_mask_bad_words($report->$field);
        next unless $n;
        $report->$field($masked);
        $count += $n;
    }
    # The title is the category, or (for «Άλλα») the start of the description: masked, not counted.
    my ($title) = greece_mask_bad_words($report->title);
    $report->title($title) if defined $title;
    my $user = $report->user;
    if ($user && !$user->in_storage) {
        my ($name) = greece_mask_bad_words($user->name);
        $user->name($name) if defined $name;
    }
    return unless $count;
    $report->set_extra_metadata(greece_bad_words => $count);
    if ($count >= GREECE_MODERATE) {
        $report->state('hidden');
        $report->flagged(1);
    }
}

# Updates get the same filter. FixMyStreet has no hook before an update is saved, but calls
# process_open311_extras for an update once its text is set: mask the words there, and with
# GREECE_MODERATE or more keep the update from changing the report's state. Once it is saved and
# confirmed, update_email_shortlisted_user hides it and tells the contact address (below).
sub process_open311_extras {
    my ($self, $c, $body, $extra) = @_;
    return unless $c && $c->action && $c->action->namespace eq 'report/update' && $c->req->method eq 'POST';
    my $update = $c->stash->{update} or return;
    $c->stash->{field_errors}{turnstile} = GREECE_TURNSTILE_ERROR unless $self->greece_turnstile_ok($c);
    my $count = 0;
    for my $field (qw(text name)) {
        my ($masked, $n) = greece_mask_bad_words($update->$field);
        next unless $n;
        $update->$field($masked);
        $count += $n;
    }
    return unless $count;
    $update->set_extra_metadata(greece_bad_words => $count);
    if ($count >= GREECE_MODERATE) {
        $update->mark_fixed(0);
        $update->mark_open(0);
        $update->problem_state($c->stash->{problem}->state) if $c->stash->{problem};
    }
}

sub update_email_shortlisted_user {
    my ($self, $update) = @_;
    my $count = $update->get_extra_metadata('greece_bad_words') or return;
    return unless $count >= GREECE_MODERATE && $update->state ne 'hidden';
    $update->update({ state => 'hidden' });
    my $c = $self->{c} or return;
    $c->send_email('moderation-update.txt', {
        to => [ $self->contact_email ],
        update => $update,
        report => $update->problem,
        admin_url => $c->cobrand->base_url . '/admin/update_edit/' . $update->id,
    });
}

# A report held for a moderator: tell the site's contact address, with the admin link.
sub greece_moderation_email {
    my ($self, $report) = @_;
    my $c = $self->{c} or return;
    return unless $report->state eq 'hidden' && $report->flagged && $report->get_extra_metadata('greece_bad_words');
    $c->send_email('moderation.txt', {
        to => [ $self->contact_email ],
        report => $report,
        admin_url => $c->cobrand->base_url . '/admin/report_edit/' . $report->id,
    });
}

# The reports page («Εμφάνιση αναφορών ανά περιοχή») offers only the municipalities: a police unit
# covers several of them, and choosing one would show most of the map.
sub reports_hook_restrict_bodies_list {
    my ($self, $bodies) = @_;
    # Reports.pm passes all_sorted's hashes, not Body rows.
    return [ grep { (ref $_ eq 'HASH' ? $_->{name} : $_->name) =~ /^Δήμος / } @$bodies ];
}

# Who is voting 👍/👎 on a report (App::Controller::GreeceVote, Problem::greece_votes): a signed-in
# voter is their account; anyone else is a random id in a long-lived cookie, kept here only as its
# hash. Undef when there is none yet and $create is false.
sub greece_voter {
    my ($self, $c, $create) = @_;
    return 'u:' . $c->user->id if $c->user_exists;
    my $cookie = $c->req->cookie('gr_voter');
    my $id = $cookie ? $cookie->value : '';
    if ($id !~ /^[0-9a-f]{32}$/) {
        return unless $create;
        open my $fh, '<:raw', '/dev/urandom' or die "no /dev/urandom: $!";
        read $fh, my $bytes, 16;
        close $fh;
        $id = unpack 'H*', $bytes;
        $c->res->cookies->{gr_voter} = { value => $id, expires => '+2y', path => '/', httponly => 1, secure => 1 };
    }
    require Digest::SHA;
    return 'c:' . Digest::SHA::sha256_hex($id);
}

# Installable web app (PWA). Name and colours are the cobrand's manifest theme (admin, or
# data/greece/manifest-theme.sql); the icons in web/theme/greece/ are drawn to be maskable.
sub manifest {
    my @icons = map { { src => "/theme/greece/$_.png", sizes => "${_}x$_", type => 'image/png' } } 192, 512;
    return {
        id => '/?pwa',
        display => 'standalone',
        description => 'Ανάφερε προβλήματα και εμπόδια στην περιοχή σου: λακκούβες, σκουπίδια, φώτα, πεζοδρόμια, παράνομη στάθμευση.',
        categories => [ 'government', 'utilities' ],
        icons => [ (map { { %$_, purpose => 'any' } } @icons), (map { { %$_, purpose => 'maskable' } } @icons) ],
    };
}

package FixMyStreet::DB::Result::Problem;

use strict;
use warnings;
use utf8;

# The municipality body covering the report's location.
sub greece_dimos {
    my $self = shift;
    my @areas = grep { $_ } split /,/, ($self->areas || '');
    return unless @areas;
    return FixMyStreet::DB->resultset('Body')->search(
        { 'body_areas.area_id' => \@areas, 'me.name' => { -like => 'Δήμος %' }, 'me.deleted' => 0 },
        { join => 'body_areas', order_by => 'me.id' })->first;
}

# The SMS sentence for each answer to "Τι συμβαίνει;": what a vehicle does ("Όχημα ..."), or
# what is there.
my %SMS_VEHICLE = (
    xoris_karta => 'καταλαμβάνει θέση στάθμευσης ΑμεΑ χωρίς Μπλε Κάρτα',
    rampa => 'καταλαμβάνει ράμπα ΑμεΑ',
    pezodromio => 'είναι σταθμευμένο στο πεζοδρόμιο και εμποδίζει τους πεζούς',
    diavasi => 'είναι σταθμευμένο σε διάβαση πεζών',
    fortistis => 'καταλαμβάνει θέση φόρτισης ηλεκτρικών οχημάτων χωρίς να φορτίζει',
    eisodos => 'κλείνει είσοδο οχημάτων (γκαράζ)',
    diplo => 'είναι σταθμευμένο διπλά και κλείνει τον δρόμο',
);
my %SMS_OTHER = (
    empodia => 'Παράνομα εμπόδια ή κώνοι από κατάστημα',
    p72 => 'Αυθαίρετη διαγράμμιση και πινακίδα P-72',
);

# OSM names a region "Περιφέρεια <genitive>"; addresses use the nominative.
my %REGION = (
    'Αττικής' => 'Αττική', 'Κεντρικής Μακεδονίας' => 'Κεντρική Μακεδονία',
    'Ανατολικής Μακεδονίας και Θράκης' => 'Ανατολική Μακεδονία και Θράκη',
    'Δυτικής Μακεδονίας' => 'Δυτική Μακεδονία', 'Ηπείρου' => 'Ήπειρος', 'Θεσσαλίας' => 'Θεσσαλία',
    'Ιονίων Νήσων' => 'Ιόνια Νησιά', 'Δυτικής Ελλάδας' => 'Δυτική Ελλάδα', 'Δυτικής Ελλάδος' => 'Δυτική Ελλάδα',
    'Στερεάς Ελλάδας' => 'Στερεά Ελλάδα', 'Στερεάς Ελλάδος' => 'Στερεά Ελλάδα', 'Πελοποννήσου' => 'Πελοπόννησος',
    'Βορείου Αιγαίου' => 'Βόρειο Αιγαίο', 'Νοτίου Αιγαίου' => 'Νότιο Αιγαίο', 'Κρήτης' => 'Κρήτη',
);

# The address of the report as written in Greece, e.g. "Φαβιέρου 15, 124 61 Χαϊδάρι, Αττική".
sub greece_address {
    my ($self, $cobrand) = @_;
    my $address = $cobrand ? $cobrand->find_closest($self) : $self->geocode && FixMyStreet::Geocode::Address->new($self->geocode);
    my $parts = $address ? $address->parts : {};
    my $osm = ($address && $address->{address}) || {};
    my $place = $osm->{suburb} || $osm->{neighbourhood} || $osm->{city} || $osm->{town} || $osm->{village};
    unless ($place) {
        my $dimos = $self->greece_dimos;
        ($place = $dimos->name) =~ s/^Δήμος // if $dimos;
    }
    (my $postcode = $osm->{postcode} || $parts->{postcode} || '') =~ s/^(\d{3})\s*(\d{2})$/$1 $2/;
    (my $region = $osm->{state} || '') =~ s/^Περιφέρεια\s+//;
    $region = $REGION{$region} || $region;
    my $street = join ' ', grep { $_ } $parts->{street}, $parts->{number};
    return join ', ', grep { $_ } $street, join(' ', grep { $_ } $postcode, $place), $region;
}

# Greek plates use only the letters that look Latin (ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ), so a plate typed or read
# in Latin letters is written in Greek, as "ΙΚΧ-1234". Anything else is kept, in capitals.
sub greece_plate_normalise {
    my $text = uc(shift // '');
    $text =~ s/^\s+|\s+$//g;
    (my $greek = $text) =~ tr/ABEZHIKMNOPTYX/ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ/;
    $greek =~ s/[\s.\-]+//g;
    return "$1-$2" if $greek =~ /^([ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ]{2,3})(\d{3,4})$/;
    return $text;
}

# The plate of a police complaint (question "pinakida"), normalised.
sub greece_plate {
    my $self = shift;
    my $plate = greece_plate_normalise($self->get_extra_field_value('pinakida'));
    return length $plate ? $plate : undef;
}

# The addresses the report's category goes to, in the order of its bodies.
sub greece_recipients {
    my $self = shift;
    my @ids = grep { $_ } split /,/, ($self->bodies_str || '');
    return () unless @ids;
    my %order = map { $ids[$_] => $_ } 0 .. $#ids;
    my @contacts = sort { $order{$a->body_id} <=> $order{$b->body_id} } FixMyStreet::DB->resultset('Contact')->search(
        { body_id => \@ids, category => $self->category, state => 'confirmed' })->all;
    return map { split /\s*,\s*/, $_->email } @contacts;
}

# For a police complaint, the SMS the reporter can send from their phone: { number, body }, e.g.
#   Όχημα με πινακίδα ΙΚΧ-1234 κλείνει είσοδο οχημάτων (γκαράζ) στη διεύθυνση Φαβιέρου 15, 124 61 Χαϊδάρι, Αττική.
#   Αρ. αναφοράς 24102026-1, στάλθηκε στα x@astynomia.gr και y@astynomia.gr.
# Nothing for other categories.
sub greece_sms {
    my ($self, $cobrand) = @_;
    my $contact = $self->contact;
    return unless $contact && ($contact->get_extra_metadata('email_template') || '') =~ /^(?:ev|amea)$/;

    my $paravasi = $self->get_extra_field_value('paravasi') // '';
    my $address = $self->greece_address($cobrand);
    my $where = $address ? "στη διεύθυνση $address"
        : sprintf('στο σημείο %.5f, %.5f', $self->latitude, $self->longitude);
    my $what;
    if (my $does = $SMS_VEHICLE{$paravasi}) {
        my $plate = $self->greece_plate;
        $what = 'Όχημα' . ($plate ? " με πινακίδα $plate" : '') . " $does $where.";
    } else {
        $what = ($SMS_OTHER{$paravasi} || 'Παράνομη στάθμευση') . " $where.";
    }

    my @to = $self->greece_recipients;
    my $sent = 'Αρ. αναφοράς ' . $self->greece_ref;
    $sent .= ', στάλθηκε ' . (@to > 1 ? 'στα ' . join(' και ', @to) : "στο $to[0]") if @to;
    return { number => FixMyStreet::Cobrand::Greece->greece_sms_number, body => "$what\n$sent." };
}

# Public reference DDMMYYYY-N: the local (TIME_ZONE) date the report was created and its
# position among all reports created that day. `created` holds wall-clock time in the
# server's zone, because FixMyStreet sets the DB session time zone to it.

sub _greece_zones {
    return (FixMyStreet->local_time_zone->name, (FixMyStreet->time_zone || FixMyStreet->local_time_zone)->name);
}

sub greece_ref {
    my $self = shift;
    return $self->{__greece_ref} //= do {
        my ($server_tz, $site_tz) = _greece_zones();
        my $dbh = $self->result_source->schema->storage->dbh;
        # Placeholders bind in text order: CTE (site, server, id), then each day bound (server, site).
        my ($day, $n) = $dbh->selectrow_array(<<'SQL', undef, $site_tz, $server_tz, $self->id, $server_tz, $site_tz, $server_tz, $site_tz);
WITH p AS (
    SELECT id, timezone(?, timezone(?, created)) AS local_created FROM problem WHERE id = ?
)
SELECT to_char(p.local_created, 'DDMMYYYY'),
       (SELECT count(*) FROM problem q
         WHERE q.id <= p.id
           AND q.created >= timezone(?, timezone(?, date_trunc('day', p.local_created)))
           AND q.created <  timezone(?, timezone(?, date_trunc('day', p.local_created) + interval '1 day')))
FROM p
SQL
        defined $day ? "$day-$n" : $self->id;
    };
}

# Every photo of the report at full size, for attaching to an email.
# With 'police', the copy with the plates readable where there is one (FixMyStreet::PhotoStorage::Greece),
# for the police letter; the photos everyone else gets have plates and faces blurred.
sub greece_photos {
    my ($self, $mode) = @_;
    my $set = $self->get_photoset;
    my $police = ($mode // '') eq 'police' && eval { require FixMyStreet::PhotoStorage::Greece; 1 };
    my @photos;
    for my $num (0 .. $set->num_images - 1) {
        my $copy = $police && FixMyStreet::PhotoStorage::Greece->police_photo($set->get_id($num));
        push @photos, $copy ? { data => $copy, content_type => 'image/jpeg' } : $set->get_image_data(num => $num, size => 'full');
    }
    return [ grep { $_ } @photos ];
}

# When the report was made, in local time, e.g. "24/10/2026 18:05".
sub greece_local_time {
    my $self = shift;
    my $dt = ($self->confirmed || $self->created)->clone;
    $dt->set_time_zone(FixMyStreet->local_time_zone) if $dt->time_zone->is_floating;
    $dt->set_time_zone(FixMyStreet->time_zone || FixMyStreet->local_time_zone);
    return $dt->strftime('%d/%m/%Y %H:%M');
}

# Inverse of greece_ref: the id of the $n-th report created on local date $date (YYYY-MM-DD).
# 👍/👎 counts and the voter's own vote (1, -1 or 0); the voter from the request unless given.
sub greece_votes {
    my ($self, $c, $voter) = @_;
    $voter //= $c ? $c->cobrand->greece_voter($c) : undef;
    my ($up, $down, $mine) = eval {
        FixMyStreet::DB->schema->storage->dbh->selectrow_array(<<'SQL', undef, $voter // '', $self->id);
SELECT count(*) FILTER (WHERE value = 1), count(*) FILTER (WHERE value = -1),
       coalesce(max(value) FILTER (WHERE voter = ?), 0)
  FROM greece_vote WHERE problem_id = ?
SQL
    };
    return { up => $up || 0, down => $down || 0, mine => $mine || 0 };
}

sub greece_ref_to_id {
    my ($date, $n) = @_;
    return unless $n >= 1;
    my ($server_tz, $site_tz) = _greece_zones();
    my $dbh = FixMyStreet::DB->schema->storage->dbh;
    my $id = eval {
        $dbh->selectrow_array(<<'SQL', undef, $server_tz, $site_tz, $date, $server_tz, $site_tz, $date, $n - 1);
SELECT id FROM problem
 WHERE created >= timezone(?, timezone(?, ?::date::timestamp))
   AND created <  timezone(?, timezone(?, ?::date::timestamp + interval '1 day'))
 ORDER BY id OFFSET ? LIMIT 1
SQL
    };
    return $id;
}

1;
