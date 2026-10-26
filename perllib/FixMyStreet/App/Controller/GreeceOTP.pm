package FixMyStreet::App::Controller::GreeceOTP;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

use utf8;
use JSON::MaybeXS;
use Digest::SHA qw(sha256_hex);
use mySociety::EmailUtil qw(is_valid_email);

=head1 NAME

FixMyStreet::App::Controller::GreeceOTP - confirm an email with a 6-digit code (Greece cobrand)

=head1 DESCRIPTION

On the report form a reporter can confirm the email they typed (owner, 2026-10-26): the site emails a
6-digit code, they type it, and the email counts as confirmed for that report (Greece.pm
greece_mark_email_confirmed), which puts it in Cc on the letter to the service. Optional: a report
is sent without it, only without the Cc.

    POST /greece/otp/send   email=<address>   -> { sent: 1 }
    POST /greece/otp/check  code=<6 digits>   -> { ok: 1, email } or { error }

The page's own requests only (X-Requested-With). A code lasts 15 minutes and allows 5 tries; an
address gets at most 3 codes an hour, a session 6 (and nginx limits the requests per visitor).
Only a hash of the code is stored (token table, scope greece_otp).

=cut

my $TTL = 15 * 60;
my $TRIES = 5;

sub _answer {
    my ($c, $status, $data) = @_;
    $c->res->status($status);
    $c->res->content_type('application/json; charset=utf-8');
    $c->res->header('Cache-Control' => 'no-store');
    $c->res->body(encode_json(ref $data ? $data : { error => $data }));
    return;
}

sub _ours {
    my ($c) = @_;
    return $c->cobrand->moniker eq 'greece' && $c->req->method eq 'POST'
        && ($c->req->header('X-Requested-With') // '') eq 'XMLHttpRequest';
}

sub send_code : Path('/greece/otp/send') : Args(0) {
    my ($self, $c) = @_;
    return _answer($c, 403, 'forbidden') unless _ours($c);
    my $email = lc($c->get_param('email') // '');
    $email =~ s/\s+//g;
    return _answer($c, 400, 'email') unless is_valid_email($email);
    my $sent = $c->session->{greece_otp_sent} || 0;
    return _answer($c, 429, 'too_many') if $sent >= 6;
    my $for_email = grep { lc(($_->data || {})->{email} // '') eq $email }
        $c->model('DB::Token')->search({ scope => 'greece_otp', created => { '>', \"now() - interval '1 hour'" } })->all;
    return _answer($c, 429, 'too_many') if $for_email >= 3;

    open my $ur, '<:raw', '/dev/urandom' or return _answer($c, 500, 'random');
    read($ur, my $bytes, 4) == 4 or return _answer($c, 500, 'random');
    my $code = sprintf '%06d', unpack('N', $bytes) % 1_000_000;
    my $token = $c->model('DB::Token')->create({ scope => 'greece_otp',
        data => { email => $email, hash => sha256_hex($code . $email), tries => 0, at => time } });
    $c->session->{greece_otp_token} = $token->token;
    $c->session->{greece_otp_sent} = $sent + 1;
    $c->send_email('otp.txt', { to => [ $email ], code => $code, minutes => $TTL / 60 });
    return _answer($c, 200, { sent => 1 });
}

sub check_code : Path('/greece/otp/check') : Args(0) {
    my ($self, $c) = @_;
    return _answer($c, 403, 'forbidden') unless _ours($c);
    my $code = $c->get_param('code') // '';
    $code =~ s/\D//g;
    my $id = $c->session->{greece_otp_token} or return _answer($c, 400, 'no_code');
    my $token = $c->model('DB::Token')->find({ scope => 'greece_otp', token => $id })
        or return _answer($c, 400, 'no_code');
    my $data = $token->data || {};
    return _answer($c, 400, 'expired') if time - ($data->{at} || 0) > $TTL || ($data->{tries} || 0) >= $TRIES;
    $data->{tries}++;
    $token->update({ data => $data });
    return _answer($c, 400, 'wrong') unless length $code == 6 && sha256_hex($code . $data->{email}) eq $data->{hash};
    $c->session->{greece_otp_email} = $data->{email};
    $token->delete;
    delete $c->session->{greece_otp_token};
    return _answer($c, 200, { ok => 1, email => $data->{email} });
}

__PACKAGE__->meta->make_immutable;

1;
