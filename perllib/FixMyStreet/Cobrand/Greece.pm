package FixMyStreet::Cobrand::Greece;
use base 'FixMyStreet::Cobrand::Default';

use strict;
use warnings;
use utf8;
use DateTime ();
use Fcntl ();
use JSON::MaybeXS ();

# Reuse the Default cobrand's compiled CSS; this cobrand only adds templates and a little JS/CSS.
sub asset_moniker { 'default' }

# Search box, by report: its number «YYYYMMDD-NN» (also with a space, / or - before NN), the older
# «DDMMYYYY-N», or the database id as «#53», «ID 53», «ref: 53», «αρ. 53» or a bare number that is
# not five digits (a Greek postcode).
my $GREECE_REF_PREFIX = qr/(?:ref|id|\#|αρ\.?|αριθμός(?:\s+αναφοράς)?)\s*[:.]?\s*/i;
sub lookup_by_ref_regex {
    qr/^\s*(?|$GREECE_REF_PREFIX?(\d\d[.\/-]?\d\d[.\/-]?\d{4}\s*[-\/ ]\s*\d+)|$GREECE_REF_PREFIX(\d{1,9})|(\d{1,4}|\d{6,9}))\s*$/i
}

sub lookup_by_ref {
    my ($self, $ref) = @_;
    # Shown by around/postcode_form.html if no report matches (a match redirects to it instead).
    $self->{c}->stash->{greece_ref_missing} = $ref if $self->{c};
    return unless $ref =~ /\d{8}|\d\d[.\/-]\d\d[.\/-]\d{4}/;
    my $id = FixMyStreet::DB::Result::Problem::greece_id_for_ref($ref);
    return [ id => $id || 0 ];
}

# Open reports within 100 m of a new report's pin, of any category, for the notice that asks the
# reporter to check for a duplicate (web/cobrands/greece/nearby-check.js; FixMyStreet's default is 250 m).
sub nearby_distances { { inspector => 1000, suggestions => 100 } }

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

    # Sender and replies (owner, 2026-10-26). From is always the site's address, named «<name> - μέσω
    # FixMyStreets» («Ανώνυμος - …» without a name). The reporter's email goes on the letter, in Cc and
    # as Reply-To only if it was confirmed when the report was made (signed in, or the emailed code:
    # greece_email_confirmed); FixMyStreet marks every typed email as verified, which proves nothing.
    # Otherwise replies go to the site's contact address and the letter says an email was given.
    my $name = $row->name // '';
    $name = '' if $name eq ($self->anonymous_account->{name} // '') || $name =~ /^\s*$/;
    # Never an abusive or masked name in «Από» (greece_name_error refuses them on the forms).
    $name = '' if $name =~ /\*\*\*/ || (greece_mask_bad_words($name))[1];
    my $sender = $self->do_not_reply_email;
    $params->{From} = [ $sender, ($name ne '' ? $name : 'Ανώνυμος') . ' - μέσω FixMyStreets' ];
    my $confirmed = !$self->greece_anonymous_report($row) && $row->get_extra_metadata('greece_email_confirmed');
    if ($confirmed) {
        $h->{reporter_email} = $row->user->email // '';
        $params->{'Reply-To'} = [ [ $row->user->email, $name || 'Πολίτης' ] ];
        $params->{Cc} = [ [ $row->user->email, $name || 'Πολίτης' ] ];
    } else {
        $h->{reporter_email} = '';
        $h->{reporter_email_unconfirmed} = !$self->greece_anonymous_report($row) && ($row->user->email // '') ne '';
        $params->{'Reply-To'} = [ [ $self->contact_email, 'FixMyStreets' ] ];
        delete $params->{Cc};
    }
    $h->{reporter_phone} = $self->greece_anonymous_report($row)
        ? ($row->get_extra_metadata('greece_phone') // '') : ($row->user->phone // '');

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

# Updates need no email either: one sent without an email is filed under the same anonymous account
# and shown at once, without a name. FixMyStreet offers that only behind a «report anonymously» button
# ('button' here), so an empty email field is taken as that button (disable_login_for_email, which
# FixMyStreet calls just before it looks at it). With an email, FixMyStreet's confirmation link applies.
sub allow_anonymous_updates { 'button' }

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

use constant GREECE_TURNSTILE_KEEP => 12 * 3600;   # see greece_turnstile_remembered
sub greece_turnstile_ok {
    my ($self, $c) = @_;
    my $secret = FixMyStreet->config('TURNSTILE_SECRET') or return 1;
    return 1 if $c->user_exists;
    return $c->stash->{greece_turnstile} if defined $c->stash->{greece_turnstile};   # a token works once
    return 1 if $self->greece_turnstile_remembered;
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
    $c->session->{greece_turnstile_until} = time + GREECE_TURNSTILE_KEEP if $ok;
    $ok = 1 unless FixMyStreet->config('TURNSTILE_ENFORCE');
    return $c->stash->{greece_turnstile} = $ok;
}

# Once a visitor has passed the check, the session remembers it for 12 hours, so the next forms do
# not ask again (owner, 2026-10-27); _turnstile.html then shows no check at all. Only a session the
# visitor already has is looked at: none is started for this.
sub greece_turnstile_remembered {
    my $self = shift;
    my $c = $self->{c} or return 0;
    return 0 unless $c->sessionid;
    return ($c->session->{greece_turnstile_until} // 0) > time ? 1 : 0;
}

sub greece_turnstile_error {
    $_[0]->greece_t('Ο έλεγχος ασφαλείας δεν ολοκληρώθηκε. Περίμενε λίγο να ολοκληρωθεί και στείλε ξανά.',
        'The security check did not finish. Wait a moment for it to finish and send again.');
}

# The name is optional everywhere (owner, 2026-10-26): the forms show «Ανώνυμος» in grey
# (name-default.js), and a report, update or contact message sent with no name, or with that one, is
# sent as «Ανώνυμος πολίτης» — also when an email is given, which FixMyStreet would otherwise refuse
# without a name. Not when signed in. Runs early on every request (check_login_disallowed below), only on those POSTs.
my %GREECE_NO_NAME = map { $_ => 1 } ('', 'ανώνυμος', 'ανωνυμος', 'anonymous');
sub greece_default_name {
    my ($self, $c) = @_;
    return unless $c->req->method eq 'POST' && $c->req->path =~ m{^(report/new|report/update|contact/submit)/?$};
    return if $c->user_exists;   # an account's own name is never replaced
    my $name = $c->req->params->{name} // '';
    $name =~ s/^\s+|\s+$//g;
    return unless $GREECE_NO_NAME{lc $name};
    # A report without a photo needs a name (owner, 2026-10-26): report_check_for_errors says so.
    if ($c->req->path =~ m{^report/new/?$} && !greece_has_photo($c)) {
        $c->stash->{greece_name_needed} = 1;
        $c->req->params->{name} = '';
        return;
    }
    $c->req->params->{name} = 'Ανώνυμος πολίτης';
}

# Whether the report form came with a photo: uploaded already (upload_fileid) or as a file.
sub greece_has_photo {
    my ($c) = @_;
    return 1 if ($c->req->params->{upload_fileid} // '') =~ /\S/;
    return scalar grep { /^photo/ } keys %{ $c->req->uploads || {} };
}

# Alert sign-ups (follow a report, local alerts) email a confirmation link to the address typed, so
# they pass the Turnstile check too (owner, 2026-10-26: «παντού»). FixMyStreet has no hook in
# /alert/subscribe; this one runs early on every request (Root auto), and only acts on that POST.
# Without the check passed, back to where the form was, with a note.
sub check_login_disallowed {
    my $self = shift;
    my $c = $self->{c} or return 0;
    $self->greece_2fa_gate($c);
    $self->greece_report_number_redirect($c);
    $self->greece_default_name($c);
    return 0 unless $c->req->method eq 'POST' && $c->req->path =~ m{^alert/subscribe/?$};
    return 0 if $c->user_exists || $c->get_param('rss') || ($c->get_param('rznvy') // '') eq '';
    return 0 if $self->greece_turnstile_ok($c);
    my $id = $c->get_param('id') // '';
    $c->res->redirect($id =~ /^\d+$/
        ? $c->uri_for('/report', $id, { gr_follow => 'check' })
        : $c->uri_for('/alert', { gr_follow => 'check' }));
    $c->detach;
}

sub extra_contact_validation {
    my ($self, $c) = @_;
    my %errors;
    $errors{turnstile} = $self->greece_turnstile_error unless $self->greece_turnstile_ok($c);
    my $name_error = $self->greece_name_error($c->get_param('name'));
    $errors{name} = $name_error if $name_error;
    return %errors;
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
    if (!$c->user_exists && $report && !$report->non_public && !$self->greece_is_complaint($report) && $c->get_param('may_show_name')
        && ($c->get_param('username_register') // '') !~ /\S/) {
        $more{username_register} = $self->greece_t('Για να φαίνεται δημόσια το όνομά σου, γράψε και το email σου.', 'To show your name publicly, enter your email too.');
    }
    # A video needs a confirmed email (owner, 2026-10-26): signed in, or the emailed code (GreeceOTP).
    if (($c->get_param('greece_video') // '') =~ /\S/) {
        my $email = lc($c->user_exists ? $c->user->email // '' : $c->get_param('username_register') // '');
        $email =~ s/\s+//g;
        my $ok = $email ne '' && ($c->user_exists || lc($c->session->{greece_otp_email} // '') eq $email);
        $more{username_register} = $self->greece_t('Για να σταλεί το βίντεο, γράψε το email σου και επιβεβαίωσέ το με τον κωδικό που θα σου έρθει.',
            'To send the video, enter your email and confirm it with the code we send you.') unless $ok;
    }
    $more{turnstile} = $self->greece_turnstile_error unless $self->greece_turnstile_ok($c);
    # Its own key: FixMyStreet drops errors under «name» for anonymous reports (Report/New.pm).
    my $name_error = $self->greece_name_error($c->get_param('name'));
    $name_error = $self->greece_t('Χωρίς φωτογραφία, γράψε το όνομά σου (τουλάχιστον 4 χαρακτήρες). Ανώνυμα γίνεται μόνο με φωτογραφία.',
        'Without a photo, enter your name (at least 4 characters). Anonymous reports need a photo.')
        if $c->stash->{greece_name_needed} && !$c->user_exists && ($c->get_param('name') // '') !~ /\S/;
    $more{greece_name} = $name_error if $name_error;
    if ($report && ($report->title // '') !~ /\S/) {
        my $category = $report->category // '';
        my $title = $category eq 'Άλλο' || $category eq '' ? greece_excerpt($report->detail, 60) : $category;
        $report->title($title || $category || 'Αναφορά');
    }
    return ($self->SUPER::report_check_for_errors($c), %more);
}

# The description's label on the report form (owner, 2026-10-26): «Σύντομη περιγραφή», without
# FixMyStreet's example sentence under it.
sub new_report_detail_field_label { $_[0]->greece_t('Σύντομη περιγραφή', 'Short description') }
sub new_report_detail_field_hint { '' }

# A name given on a report, update or contact message needs at least 4 characters (not counting
# spaces at either end) and no abusive words, so «Γ.», «aa» or an insult do not reach a municipality
# or the police as the reporter's name. Empty is fine: the report then goes anonymously.
sub greece_name_error {
    my ($self, $name) = @_;
    $name = $name // '';
    $name =~ s/^\s+|\s+$//g;
    return if $name eq '';
    # The name goes in the letters' «Από» (munge_sendreport_params): no abusive words in it.
    my (undef, $bad) = greece_mask_bad_words($name);
    return $self->greece_t('Το όνομα δεν επιτρέπεται. Γράψε το πραγματικό σου όνομα ή άφησέ το «Ανώνυμος».',
        'That name is not allowed. Write your real name, or leave it as «Anonymous».') if $bad;
    return if length $name >= 4;
    return $self->greece_t('Το όνομα θέλει τουλάχιστον 4 χαρακτήρες.', 'The name needs at least 4 characters.');
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
# Signing up, or asking for a sign-in link, by email (the sign-in page, /auth/create, /auth/forgot)
# passes the Turnstile check first; the page is shown again with the error.
sub disable_login_for_email {
    my ($self, $email) = @_;
    my $c = $self->{c} or return;
    return if $c->user_exists;
    # An update sent without an email, not signing in: as if «anonymously» were pressed (above).
    if ($c->stack->[-1]->reverse eq 'report/update/process_user' && ($email // '') eq ''
            && !$c->get_param('submit_sign_in') && !$c->get_param('password_sign_in')) {
        $c->req->params->{report_anonymously} = 1;
        return;
    }
    if ($c->stack->[-1]->reverse eq 'auth/email_sign_in' && !$self->greece_turnstile_ok($c)) {
        $c->stash->{field_errors}{turnstile} = $self->greece_turnstile_error;
        $c->detach;
    }
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
    $self->greece_nsfw($report, $report->photo);
    $self->greece_route_to_dimos($report);
    $self->greece_public_complaint($report);
    $self->greece_mark_email_confirmed($report);
    $self->greece_claim_video($report);
    return unless $c;
    my $before = $c->stash->{greece_account_before} or return;
    my $user = $report->user;
    return unless $user && $user->in_storage && $user->id == $before->{id};
    $user->$_($before->{$_}) for qw(name phone title);
    $user->update if $user->is_changed;
}

# Two answers of the police category's «Τι συμβαίνει;», a shop's obstacles or cones and unauthorised
# road markings with a P-72 sign, take public space: that is the municipality's (its municipal police),
# as on gov.gr's MyStreet. Such a report goes to the municipality instead, in its own category, which
# no list offers (state inactive, data/greece/contacts/dimoi-katalipsi.sql) and which has the same
# address as its «Άλλο»; it is published like the police complaint, without personal details
# (greece_public_complaint).
# A video added on the form (App::Controller::GreeceVideo): the report takes it if it is ready and
# no other report has taken it (the claimed/<id> marker is created exclusively), and keeps its id and
# length, and only when the reporter's email is confirmed (greece_mark_email_confirmed; the form says so,
# report_check_for_errors). It is never published; greece_may_see_video says who sees it.
sub greece_claim_video {
    my ($self, $report) = @_;
    my $c = $self->{c} or return;
    return unless $report->get_extra_metadata('greece_email_confirmed');
    my $id = $c->get_param('greece_video') // '';
    return unless $id =~ /^[0-9a-f]{32}$/;
    my $root = '/var/lib/fms-videos';
    return unless -e "$root/ready/$id.mp4";
    my $duration;
    if (open my $st, '<', "$root/incoming/$id/status.json") {
        local $/; my $j = eval { JSON::MaybeXS::decode_json(<$st>) } || {};
        $duration = $j->{duration};
    }
    mkdir "$root/claimed";
    sysopen(my $fh, "$root/claimed/$id", Fcntl::O_CREAT() | Fcntl::O_EXCL() | Fcntl::O_WRONLY()) or return;
    close $fh;
    $report->set_extra_metadata(greece_video => $id);
    $report->set_extra_metadata(greece_video_seconds => $duration) if defined $duration;
}

# The reporter's email counts as confirmed (for Cc on the letter, munge_sendreport_params) when the
# report is made signed in with that email, or after the emailed code for it was entered in this
# session (App::Controller::GreeceOTP).
sub greece_mark_email_confirmed {
    my ($self, $report) = @_;
    my $c = $self->{c} or return;
    my $email = lc($report->user && $report->user->email // '');
    return if $email eq '' || $self->greece_anonymous_report($report);
    my $ok = ($c->user_exists && lc($c->user->email // '') eq $email)
        || lc($c->session->{greece_otp_email} // '') eq $email;
    $report->set_extra_metadata(greece_email_confirmed => 1) if $ok;
}

# A municipality's reports go in its digest, at 07:00, 13:00 and 19:00 (bin/greece/send-digest; its
# bodies have send_method Noop, data/greece/contacts/digest.sql). For a report still waiting for it,
# when the next one goes, e.g. «13:00» or «αύριο 07:00»; nothing for a report sent at once.
sub greece_digest_next {
    my ($self, $report) = @_;
    return if !$report || $report->whensent || !$report->bodies_str;
    my @ids = grep { /^\d+$/ } split /,/, $report->bodies_str;
    my @bodies = FixMyStreet::DB->resultset('Body')->search({ id => \@ids })->all;
    return unless @bodies && !grep { ($_->send_method // '') ne 'Noop' || ($_->extra || {})->{greece_police} } @bodies;
    my $now = DateTime->now(time_zone => 'Europe/Athens');
    my ($next) = grep { $_ > $now->hour } 7, 13, 19;
    return sprintf('%02d:00', $next) if $next;
    return $self->greece_t('αύριο', 'tomorrow') . ' 07:00';
}

# Whether the municipalities' digest is on (any municipality with send_method Noop), for the FAQ.
sub greece_digest_active {
    my $self = shift;
    return $self->{greece_digest_active} //= FixMyStreet::DB->resultset('Body')->search({
        deleted => 0, send_method => 'Noop', name => { -like => 'Δήμος %' } })->count ? 1 : 0;
}

# Who sees a report's video: superusers, and staff of a body the report was sent to.
sub greece_may_see_video {
    my ($self, $user, $problem) = @_;
    return 0 unless $user && $problem && $problem->get_extra_metadata('greece_video');
    return 1 if $user->is_superuser;
    my $body = $user->from_body or return 0;
    return scalar grep { $_ == $body->id } split /,/, ($problem->bodies_str // '');
}

# Complaints about parking and obstacles (the police category, and the same complaint routed to a
# municipality above) are published on the map without personal details (owner, 2026-10-26): never
# under the reporter's name, and with number plates in the description replaced by ***. The letter
# to the police or the municipality gets the description as written (greece_detail_full, read by
# templates/email/greece/submit-ev.*); the plate question's answer is never shown publicly anyway.
# Complaints made before this stay private, as they were promised.
use constant GREECE_COMPLAINT => 'Στάθμευση σε φορτιστή EV ή εμπόδιο στη διέλευση';
my $GREECE_PLATE = qr/(?<![\p{L}\d])[A-ZΑ-Ω]{2,3}[\s.\-]?\d{3,4}(?![\p{L}\d])/;   # upper case: «και 200 μέτρα» is no plate
sub greece_is_complaint {
    my ($self, $report) = @_;
    my $chosen = $report->get_extra_metadata('greece_category_chosen') // $report->category // '';
    return $chosen eq GREECE_COMPLAINT;
}

sub greece_public_complaint {
    my ($self, $report) = @_;
    return unless $self->greece_is_complaint($report);
    $report->anonymous(1);
    my $detail = $report->detail // '';
    (my $masked = $detail) =~ s/$GREECE_PLATE/***/g;
    if ($masked ne $detail) {
        $report->set_extra_metadata(greece_detail_full => $detail);
        $report->detail($masked);
    }
}

use constant GREECE_KATALIPSI => 'Κατάληψη κοινόχρηστου χώρου';
sub greece_route_to_dimos {
    my ($self, $report) = @_;
    my $answer = $report->get_extra_field_value('paravasi') // '';
    return unless $answer eq 'empodia' || $answer eq 'p72';
    my $dimos = $report->greece_dimos or return;
    my $contact = FixMyStreet::DB->resultset('Contact')->search(
        { body_id => $dimos->id, category => GREECE_KATALIPSI, state => { '!=' => 'deleted' } })->first or return;
    $report->set_extra_metadata(greece_category_chosen => $report->category);
    $report->category(GREECE_KATALIPSI);
    $report->bodies_str($dimos->id);
    $report->non_public(0);
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
    # The title is the category, or (for «Άλλο») the start of the description: masked, not counted.
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

# A photo with nudity (the anonymiser's NudeNet, FixMyStreet::PhotoStorage::Greece) holds the report
# or update for a moderator, as GREECE_MODERATE bad words do (owner, 2026-10-26): the classes found are
# kept in greece_nsfw, and a report is hidden and flagged here; an update in update_email_shortlisted_user.
# Its photos are not served while it is hidden (App::Controller::Photo shows visible states only).
sub greece_nsfw {
    my ($self, $obj, $photos) = @_;
    my @ids = grep { /^[0-9a-f]{40}\.jpeg\z/ } split /,/, ($photos // '');
    return unless @ids && eval { require FixMyStreet::PhotoStorage::Greece; 1 };
    my %classes;
    for my $found (map { FixMyStreet::PhotoStorage::Greece->nsfw($_) } @ids) {
        $classes{$_->{class}} = 1 for @$found;
    }
    return unless %classes;
    $obj->set_extra_metadata(greece_nsfw => [ sort keys %classes ]);
    return 1 unless $obj->isa('FixMyStreet::DB::Result::Problem');
    $obj->state('hidden');
    $obj->flagged(1);
    return 1;
}

# Updates get the same filter. FixMyStreet has no hook before an update is saved, but calls
# process_open311_extras for an update once its text and requested state are set: mask the words there,
# and with GREECE_MODERATE or more keep the update from changing the report's state. Once it is saved
# and confirmed, update_email_shortlisted_user hides it and tells the contact address (below).
# Closing a report (marked fixed, or a fixed or closed state) needs a moderator's approval unless a
# body's staff or a superuser does it: the update is published, a «fixed» puts the report in «fix
# pending» (data/greece/states.sql; only with an email), and the request goes to the contact address
# to approve in the admin (update_email_shortlisted_user).
sub process_open311_extras {
    my ($self, $c, $body, $extra) = @_;
    return unless $c && $c->action && $c->action->namespace eq 'report/update' && $c->req->method eq 'POST';
    my $update = $c->stash->{update} or return;
    $c->stash->{field_errors}{turnstile} = $self->greece_turnstile_error unless $self->greece_turnstile_ok($c);
    my $name_error = $self->greece_name_error($c->get_param('name'));
    $c->stash->{field_errors}{greece_name} = $name_error if $name_error;
    my $staff = $c->user_exists && ($c->user->is_superuser || $c->user->from_body);
    my $problem = $c->stash->{problem};
    if (!$staff && $problem) {
        my $state = $update->problem_state // '';
        my $closes = FixMyStreet::DB::Result::Problem->fixed_states->{$state}
            || FixMyStreet::DB::Result::Problem->closed_states->{$state};
        my $fixed = $update->mark_fixed || FixMyStreet::DB::Result::Problem->fixed_states->{$state};
        if ($fixed && !$c->user_exists && ($c->get_param('username_register') // '') !~ /\S/) {
            # «Fixed» needs an email (owner, 2026-10-27): it counts once its confirmation link is opened.
            $c->stash->{field_errors}{username_register} = $self->greece_t(
                'Για να δηλώσεις ότι το πρόβλημα διορθώθηκε, γράψε το email σου· θα σου στείλουμε σύνδεσμο επιβεβαίωσης.',
                'To say the problem is fixed, enter your email; we will send you a confirmation link.');
        } elsif ($fixed || ($closes && $state ne $problem->state)) {
            # From a citizen, «fixed» puts the report in «fix pending» (still open) until a moderator or
            # the body's staff sets «Διορθώθηκε»; another closing state leaves it as it is. Either way the
            # contact address is asked to look (greece_close_request_email).
            $update->set_extra_metadata(greece_close_requested => $state || 'fixed - user');
            $update->mark_fixed(0);
            $update->problem_state($fixed && FixMyStreet::DB->resultset('State')->search({ label => 'fix pending' })->count
                ? 'fix pending' : $problem->state);
        }
    }
    if ($self->greece_nsfw($update, $c->stash->{upload_fileid})) {
        $update->mark_fixed(0);
        $update->mark_open(0);
        $update->problem_state($problem->state) if $problem;
    }
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
    $self->greece_close_request_email($update);
    $self->greece_update_to_body($update);
    my $count = $update->get_extra_metadata('greece_bad_words') || 0;
    return unless ($count >= GREECE_MODERATE || $update->get_extra_metadata('greece_nsfw')) && $update->state ne 'hidden';
    $update->update({ state => 'hidden' });
    my $c = $self->{c} or return;
    $c->send_email('moderation-update.txt', {
        to => [ $self->contact_email ],
        update => $update,
        report => $update->problem,
        admin_url => $c->cobrand->base_url . '/admin/update_edit/' . $update->id,
    });
}

# A published update also goes to the service the report was sent to, as a follow-up on the same
# matter (owner, 2026-10-26), by email to the category's address there; not to the police (police
# bodies are tagged greece_police), not before the report itself was sent, not an update by that
# body's own staff, and once. On a staging site that does not send reports (STAGING_FLAGS
# send_reports 0) it goes to the site's contact address instead, saying where it would have gone.
sub greece_update_to_body {
    my ($self, $update) = @_;
    return if $update->state ne 'confirmed' || $update->get_extra_metadata('greece_body_sent');
    my $problem = $update->problem or return;
    return unless $problem->whensent;
    my $c = $self->{c} or return;
    my @body_ids = grep { /^\d+$/ } split /,/, ($problem->bodies_str // '');
    my @bodies = FixMyStreet::DB->resultset('Body')->search({ id => \@body_ids, deleted => 0 })->all;
    @bodies = grep { !(($_->extra || {})->{greece_police}) } @bodies;
    return unless @bodies;
    my $user = $update->user;
    return if $user && $user->from_body && grep { $_->id == $user->from_body->id } @bodies;
    my @emails = map { split /\s*,\s*/, ($_->email // '') } FixMyStreet::DB->resultset('Contact')->search({
        body_id => [ map { $_->id } @bodies ], category => $problem->category, state => { '!=' => 'deleted' },
    })->all;
    my %seen; @emails = grep { /\@/ && !$seen{lc $_}++ } @emails;
    return unless @emails;
    my $staging = FixMyStreet->staging_flag('send_reports', 0);
    $c->send_email('update-to-body.txt', {
        to => $staging ? [ $self->contact_email ] : \@emails,
        update => $update,
        report => $problem,
        bodies_name => join(', ', map { $_->name } @bodies),
        would_go_to => $staging ? join(', ', @emails) : '',
        report_url => $self->base_url_for_report($problem) . $problem->url,
    });
    $update->set_extra_metadata(greece_body_sent => 1);
    $update->update;
}

# A request to close a report, from an update (process_open311_extras): to the contact address once,
# with the admin page where the report's state is changed if it is right. Not for a hidden update.
sub greece_close_request_email {
    my ($self, $update) = @_;
    my $state = $update->get_extra_metadata('greece_close_requested') or return;
    return if $update->get_extra_metadata('greece_close_request_sent') || $update->state ne 'confirmed';
    my $c = $self->{c} or return;
    $c->send_email('close-request.txt', {
        to => [ $self->contact_email ],
        update => $update,
        report => $update->problem,
        requested_state => $state,
        admin_url => $c->cobrand->base_url . '/admin/report_edit/' . $update->problem->id,
        report_url => $c->cobrand->base_url . '/report/' . $update->problem->id,
    });
    $update->set_extra_metadata(greece_close_request_sent => 1);
    $update->update;
}

# A report held for a moderator: tell the site's contact address, with the admin link.
sub greece_moderation_email {
    my ($self, $report) = @_;
    my $c = $self->{c} or return;
    return unless $report->state eq 'hidden' && $report->flagged
        && ($report->get_extra_metadata('greece_bad_words') || $report->get_extra_metadata('greece_nsfw'));
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

# The second sign-in step is an emailed code (App::Controller::GreeceTwoFactor; owner, 2026-10-26:
# «OTP μέσω mail μόνο»), for superusers and the staff of a body; FixMyStreet's own, with an
# authenticator app, is off for everyone. Staff cannot use Google, Apple or Microsoft at all
# (GreeceSocial.pm).
sub must_have_2fa { 'skip' }

# A report's address is its number (/report/20261026-03, greece_ref). FixMyStreet's own links, in
# the admin, alert emails and elsewhere, still say /report/<id>: those go on to the number, so the
# database id is not what people see and pass on (owner, 2026-10-26). The number's page itself is
# shown through /greece/report-ref (GreeceReportRef.pm), so this does not loop.
sub greece_report_number_redirect {
    my ($self, $c) = @_;
    return unless $c->req->method eq 'GET' && $c->req->path =~ m{^report/(\d+)/?$};
    my $problem = FixMyStreet::DB->resultset('Problem')->find($1) or return;
    my $url = $problem->url;
    return if $url =~ m{^/report/\d+$};
    my $q = $c->req->uri->query;
    $c->res->redirect($url . (defined $q && $q ne '' ? "?$q" : ''), 301);
    $c->detach;
}

# Until the emailed code is entered, a signed-in superuser or staff member sees only that page (and
# can sign out). Runs early on every request (check_login_disallowed).
sub greece_2fa_gate {
    my ($self, $c) = @_;
    return unless $c->user_exists;
    my $user = $c->user->obj;
    require FixMyStreet::App::Controller::GreeceTwoFactor;
    return unless FixMyStreet::App::Controller::GreeceTwoFactor->needs($user);
    return if ($c->session->{greece_2fa} // 0) == $user->id;
    return if $c->req->path =~ m{^(greece/2fa|auth/sign_out)/?$};
    my $r = '/' . $c->req->path;
    my $q = $c->req->uri->query;
    $r .= "?$q" if defined $q && $q ne '' && $c->req->method eq 'GET';
    # From a sign-in page, on to where that page was taking them, never back to signing in.
    if ($c->req->path =~ m{^(auth|M)(/|$)}) {
        my $next = $c->get_param('r') // '';
        $r = $next =~ m{^/?([^/].*)?$} && $next !~ m{^/?(auth|M)(/|$)} && $next ne '' ? '/' . ($next =~ s{^/}{}r) : '/my';
    }
    $c->res->redirect($c->uri_for('/greece/2fa', { r => $r }));
    $c->detach;
}

# Public reports per municipality, for the map on the reports page (templates/web/greece/reports/index.html,
# reports-map.js): [{ n => name, u => '/reports/<name>', t => all, o => open, f => fixed }], most first,
# only the municipalities that have any. Reports for the police (not public) are not counted.
sub greece_reports_by_dimos {
    my $self = shift;
    my $open = FixMyStreet::DB::Result::Problem->open_states;
    my $fixed = FixMyStreet::DB::Result::Problem->fixed_states;
    my @rows = FixMyStreet::DB->resultset('Problem')->search(
        { non_public => 0, state => [ FixMyStreet::DB::Result::Problem->visible_states ] },
        { columns => [ 'bodies_str', 'state', { n => { count => 'id' } } ], group_by => [ 'bodies_str', 'state' ],
          result_class => 'DBIx::Class::ResultClass::HashRefInflator' },
    )->all;
    my %count;
    for my $row (@rows) {
        for my $id (split /,/, $row->{bodies_str} // '') {
            my $c = $count{$id} ||= { t => 0, o => 0, f => 0 };
            $c->{t} += $row->{n};
            $c->{o} += $row->{n} if $open->{ $row->{state} };
            $c->{f} += $row->{n} if $fixed->{ $row->{state} };
        }
    }
    return [] unless %count;
    my @bodies = FixMyStreet::DB->resultset('Body')->search(
        { id => [ keys %count ], deleted => 0, name => { -like => 'Δήμος %' } })->all;
    my @list = map { { n => $_->name, u => '/reports/' . $self->short_name($_), %{ $count{ $_->id } } } } @bodies;
    return [ sort { $b->{t} <=> $a->{t} || $a->{n} cmp $b->{n} } @list ];
}

# Data for a page's script, as JSON text (the template escapes it into an attribute).
sub greece_json {
    my ($self, $data) = @_;
    require JSON::MaybeXS;
    return JSON::MaybeXS->new(canonical => 1)->encode($data);
}

# A text of the site's own templates in the page's language: greece_t('ελληνικά', 'English').
sub greece_t {
    my ($self, $el, $en) = @_;
    my $c = $self->{c};
    return $c && ($c->stash->{lang_code} // '') eq 'en-gb' ? $en : $el;
}

# Language: Greek, unless the visitor chose English with the switch in the menu (?lang=en, or ?lang=el
# back), which is kept in the gr_lang cookie for a year. The browser's language is not used: the
# site's own texts are written in Greek. Without a request (emails, cron) the caller's language holds.
sub language_override {
    my $self = shift;
    my $c = $self->{c} or return;
    my $want = $c->req->query_params->{lang} // '';
    $want = 'en-gb' if $want eq 'en';
    if ($want eq 'el' || $want eq 'en-gb') {
        $c->res->cookies->{gr_lang} = { value => $want, expires => '+1y', path => '/', secure => 1, httponly => 1 };
        return $want;
    }
    my $cookie = $c->req->cookie('gr_lang');
    my $chosen = $cookie ? $cookie->value : '';
    return $chosen eq 'en-gb' ? 'en-gb' : 'el';
}

# The police categories' questions and notices (data/greece/contacts/police.sql) are stored in Greek;
# with the site in English the report form shows these instead, by field code and answer key. The
# answers sent are the same keys either way.
my %FIELD_EN = (
    xorisempodia => { description => '<p>Parking on a disabled ramp or bay, on the pavement or on a crossing is recorded by <strong>Χωρίς Εμπόδια</strong> (xorisempodia.gr): no account and no photo needed, and it gets a text message to 100 ready for you, which you send yourself from your phone.</p><p><a class="btn btn--primary" href="https://xorisempodia.gr/reports/new" target="_blank" rel="noopener">Record it on xorisempodia.gr</a></p>' },
    idiotiki => { description => 'The complaint is shown on the map without your name, contact details or the number plate. Those go only to the responsible Hellenic Police service.' },
    paravasi => { description => 'What is happening?', values => {
        fortistis => 'Parked in an electric vehicle charging bay without charging',
        eisodos => 'Parked in front of a vehicle entrance or exit (garage)',
        diplo => 'Double parking, or a vehicle blocking the road',
        stasi => 'Parked at a bus stop',
        empodia => 'Illegal obstacles or cones put out by a shop',
        p72 => 'Unauthorised road markings and P-72 sign',
    } },
    pinakida => { description => 'Registration number (number plate), if it is about a particular vehicle' },
);
sub munge_report_new_category_list {
    my ($self, $options, $contacts, $extras) = @_;
    return unless $self->greece_t(0, 1);
    for my $metas (values %$extras) {
        # Copies: the hashes are the contacts' own.
        @$metas = map {
            my $en = $FIELD_EN{$_->{code} // ''};
            !$en ? $_ : {
                %$_,
                description => $en->{description},
                $_->{values} ? (values => [ map { +{ %$_, name => $en->{values}{$_->{key}} // $_->{name} } } @{$_->{values}} ]) : (),
            };
        } @$metas;
    }
}

# The order of the categories, by their stored (Greek) names, in either language: on the report form
# and in the category filters of the map and the reports pages. Any other category follows in
# FixMyStreet's alphabetical order, and «Άλλο» stays last.
my @CATEGORY_ORDER = (
    'Λακκούβα ή φθορά οδοστρώματος',
    'Πρόβλημα με πεζοδρόμιο',
    'Στάθμευση σε ράμπα ή θέση ΑμεΑ, πεζοδρόμιο ή διάβαση',
    'Στάθμευση σε φορτιστή EV ή εμπόδιο στη διέλευση',
    'Φρεάτια και καθαριότητα',
    'Πράσινο και δέντρα',
);
sub _greece_sort_categories {
    my $list = shift or return;
    my %rank;
    @rank{@CATEGORY_ORDER} = 0 .. $#CATEGORY_ORDER;
    my $i = 0;
    @$list = map { $_->[2] } sort { $a->[0] <=> $b->[0] || $a->[1] <=> $b->[1] } map {
        my $name = ref $_ eq 'HASH' ? $_->{name} : ref $_ ? $_->category : $_;
        [ $rank{$name // ''} // (($name // '') eq 'Άλλο' ? 2000 : 1000), $i++, $_ ];
    } @$list;
}
sub munge_mixed_category_groups { my ($self, $list) = @_; _greece_sort_categories($list) }
sub munge_reports_category_list { my ($self, $categories) = @_; _greece_sort_categories($categories) }
sub munge_around_filter_category_list {
    my $self = shift;
    my $c = $self->{c} or return;
    _greece_sort_categories($c->stash->{filter_categories});
    _greece_sort_categories($_->{categories}) for @{ $c->stash->{category_groups} || [] };
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

# How a report was made, in Greek where it reads «… · από κινητό» in the report's meta line
# (FixMyStreet's service_display gives "mobile"; the .po puts it after «από»). Wrapped, not copied,
# so FixMyStreet's own handling of Open311 and PWA services stays.
{
    require FixMyStreet::DB::Result::Problem;
    my $orig = FixMyStreet::DB::Result::Problem->can('service_display');
    my %el = (mobile => 'κινητό', desktop => 'υπολογιστή', web => 'υπολογιστή');
    no warnings 'redefine';
    *service_display = sub {
        my $s = $orig->(@_);
        return $s if $s eq '';
        my $c = eval { $_[0]->result_source->schema->cobrand };
        return $s unless $c && $c->moniker eq 'greece' && !$c->greece_t(0, 1);
        return $el{lc $s} // $s;
    } if $orig;
}

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
    stasi => 'είναι σταθμευμένο σε στάση λεωφορείου',
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
    # Where the map gives the street without a house number (OpenStreetMap has none there), the spot's
    # coordinates as well, so that the police can find it.
    my $closest = $cobrand && $cobrand->find_closest($self);
    my $number = $closest && $closest->parts->{number};
    my $where = !$address ? sprintf('στο σημείο %.5f, %.5f', $self->latitude, $self->longitude)
        : $number ? "στη διεύθυνση $address"
        : sprintf('στη διεύθυνση %s (σημείο %.5f, %.5f)', $address, $self->latitude, $self->longitude);
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

# The report's number, as people see it and in its address (owner, 2026-10-26): YYYYMMDD-NN, the
# local (TIME_ZONE) date it was made and its place among all reports made that day, two digits or
# more (20261026-03; /report/20261026-03). `created` holds wall-clock time in the server's zone,
# because FixMyStreet sets the DB session time zone to it. The database id still opens a report
# (/report/48) but is shown nowhere; the earlier DDMMYYYY-N numbers still find theirs (lookup_by_ref).
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
SELECT to_char(p.local_created, 'YYYYMMDD'),
       (SELECT count(*) FROM problem q
         WHERE q.id <= p.id
           AND q.created >= timezone(?, timezone(?, date_trunc('day', p.local_created)))
           AND q.created <  timezone(?, timezone(?, date_trunc('day', p.local_created) + interval '1 day')))
FROM p
SQL
        defined $day ? sprintf('%s-%02d', $day, $n) : $self->id;
    };
}

# A report's address uses its number (/report/20261026-03); nginx hands such addresses to
# App::Controller::GreeceReportRef, which shows the report as /report/<id> would.
{
    require FixMyStreet::DB::Result::Problem;   # loaded first, so its own url does not win
    no warnings 'redefine';
    *url = sub { '/report/' . $_[0]->greece_ref };
}

# The id of the report with number YYYYMMDD-NN or the older DDMMYYYY-N, or undef.
sub greece_id_for_ref {
    my ($ref) = @_;
    my ($date, $n);
    if ($ref =~ /^(20\d\d)(0[1-9]|1[0-2])(\d\d)\s*[-\/ ]\s*(\d+)$/) {
        ($date, $n) = ("$1-$2-$3", $4);
    } elsif ($ref =~ /^(\d\d)[.\/-]?(\d\d)[.\/-]?(\d{4})\s*[-\/ ]\s*(\d+)$/) {
        ($date, $n) = ("$3-$2-$1", $4);
    } else {
        return;
    }
    return greece_ref_to_id($date, $n + 0);
}

# The server's and the site's time zones, for greece_ref_to_id and the old DDMMYYYY-N numbers.
sub _greece_zones {
    return (FixMyStreet->local_time_zone->name, (FixMyStreet->time_zone || FixMyStreet->local_time_zone)->name);
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

# The report page's details card (templates/web/greece/report/_main_sent_info.html): when it was
# made, with the day, e.g. "Κυριακή 25/10/2026, 16:17"; and how long after that it was sent, e.g.
# "2 λεπτά", or nothing when it has not been sent.
my @GREECE_DAYS_EL = qw(Δευτέρα Τρίτη Τετάρτη Πέμπτη Παρασκευή Σάββατο Κυριακή);
my @GREECE_DAYS_EN = qw(Monday Tuesday Wednesday Thursday Friday Saturday Sunday);
sub greece_when {
    my ($self, $en) = @_;
    my $dt = ($self->confirmed || $self->created)->clone;
    $dt->set_time_zone(FixMyStreet->local_time_zone) if $dt->time_zone->is_floating;
    $dt->set_time_zone(FixMyStreet->time_zone || FixMyStreet->local_time_zone);
    my $day = ($en ? \@GREECE_DAYS_EN : \@GREECE_DAYS_EL)->[$dt->day_of_week - 1];
    return $day . ' ' . $dt->strftime('%d/%m/%Y, %H:%M');
}

sub greece_sent_after {
    my $self = shift;
    return '' unless $self->whensent && $self->confirmed && $self->service ne 'Open311';
    return Utils::prettify_duration($self->whensent->epoch - $self->confirmed->epoch, 'minute');
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
