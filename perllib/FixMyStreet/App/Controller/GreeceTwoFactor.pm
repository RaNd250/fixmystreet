package FixMyStreet::App::Controller::GreeceTwoFactor;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

use utf8;
use Digest::SHA qw(sha256_hex);

=head1 NAME

FixMyStreet::App::Controller::GreeceTwoFactor - the second sign-in step by an emailed code (Greece cobrand)

=head1 DESCRIPTION

Superusers and the staff of a body (a municipality, the police) confirm each sign-in with a 6-digit
code sent to their account's email (owner, 2026-10-26: «OTP μέσω mail μόνο»), in place of
FixMyStreet's authenticator app (Greece.pm must_have_2fa says «skip» to that). It works as a gate
on the session, whatever the way in (password, emailed link): until the code is entered, every page
but this one and signing out sends them here (Greece.pm check_login_disallowed, greece_2fa_gate).

    GET  /greece/2fa            sends a code (unless one sent in the last minute is still good), shows the form
    POST /greece/2fa  code=..   checks it; then on to where they were going (r)
    POST /greece/2fa  resend=1  a new code

A code lasts 10 minutes and allows 5 tries; at most 5 codes in 15 minutes. Only a hash is kept (token
scope greece_2fa). The session remembers the account it was entered for.

=cut

my $TTL = 10 * 60;
my $TRIES = 5;

sub needs {
    my ($class, $user) = @_;
    return $user && ($user->is_superuser || $user->from_body) ? 1 : 0;
}

sub index : Path('/greece/2fa') : Args(0) {
    my ($self, $c) = @_;
    $c->detach('/page_error_404_not_found', []) unless $c->cobrand->moniker eq 'greece';
    return $c->res->redirect('/auth') unless $c->user_exists;
    my $user = $c->user->obj;
    my $r = $c->get_param('r') // '';
    $r = '' unless $r =~ m{^/(?!/)} && $r !~ m{^/(auth|M|greece/2fa)(/|\?|$)};
    $c->stash->{r} = $r;
    return $c->res->redirect($r || '/my') if !$self->needs($user) || ($c->session->{greece_2fa} // 0) == $user->id;

    $c->stash->{template} = 'auth/greece_2fa.html';
    $c->stash->{email} = $user->email;
    my $cobrand = $c->cobrand;
    my $token = $self->_current($c, $user);

    if ($c->req->method eq 'POST' && !$c->get_param('resend')) {
        my $code = $c->get_param('code') // '';
        $code =~ s/\D//g;
        if (!$token) {
            $c->stash->{error} = $cobrand->greece_t('Ο κωδικός έληξε. Σου στείλαμε νέο.', 'The code expired. We have sent a new one.');
        } else {
            my $data = $token->data;
            $data->{tries}++;
            $token->update({ data => $data });
            if (length $code == 6 && sha256_hex($code . $user->id) eq $data->{hash}) {
                $token->delete;
                $c->session->{greece_2fa} = $user->id;
                return $c->res->redirect($r || '/my');
            }
            $c->stash->{error} = $data->{tries} >= $TRIES
                ? $cobrand->greece_t('Πολλές λάθος προσπάθειες. Σου στείλαμε νέο κωδικό.', 'Too many wrong tries. We have sent a new code.')
                : $cobrand->greece_t('Λάθος κωδικός. Δοκίμασε ξανά.', 'Wrong code. Try again.');
            return if $data->{tries} < $TRIES;
            $token->delete;
            $token = undef;
        }
    }
    my $fresh = $token && time - $token->data->{at} < 60;
    if ($token && $fresh && $c->get_param('resend')) {
        $c->stash->{error} = $cobrand->greece_t('Μόλις σου στείλαμε κωδικό. Περίμενε ένα λεπτό πριν ζητήσεις νέο.',
            'We have just sent you a code. Wait a minute before asking for a new one.');
        return;
    }
    return if $token && ($fresh || $c->req->method ne 'POST');
    $self->_send($c, $user) or $c->stash->{error} = $cobrand->greece_t(
        'Στάλθηκαν πολλοί κωδικοί. Περίμενε λίγα λεπτά και ζήτησε νέο.', 'Too many codes sent. Wait a few minutes and ask for a new one.');
}

# The account's code still good (not expired, tries left), if any.
sub _current {
    my ($self, $c, $user) = @_;
    my ($token) = grep { my $d = $_->data || {}; ($d->{id} // 0) == $user->id && time - ($d->{at} || 0) <= $TTL && ($d->{tries} || 0) < $TRIES }
        $c->model('DB::Token')->search({ scope => 'greece_2fa' }, { order_by => { -desc => 'created' } })->all;
    return $token;
}

sub _send {
    my ($self, $c, $user) = @_;
    my $recent = grep { (($_->data || {})->{id} // 0) == $user->id }
        $c->model('DB::Token')->search({ scope => 'greece_2fa', created => { '>', \"now() - interval '15 minutes'" } })->all;
    return 0 if $recent >= 5;
    $c->model('DB::Token')->search({ scope => 'greece_2fa', created => { '<', \"now() - interval '1 day'" } })->delete;
    open my $ur, '<:raw', '/dev/urandom' or return 0;
    read($ur, my $bytes, 4) == 4 or return 0;
    my $code = sprintf '%06d', unpack('N', $bytes) % 1_000_000;
    $c->model('DB::Token')->create({ scope => 'greece_2fa',
        data => { id => $user->id, hash => sha256_hex($code . $user->id), tries => 0, at => time } });
    $c->send_email('2fa-code.txt', { to => [ [ $user->email, $user->name ] ], code => $code, minutes => $TTL / 60 });
    $c->stash->{sent} = 1;
    return 1;
}

__PACKAGE__->meta->make_immutable;

1;
