package FixMyStreet::App::Controller::GreecePassword;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

use utf8;
use mySociety::EmailUtil qw(is_valid_email);

=head1 NAME

FixMyStreet::App::Controller::GreecePassword - a forgotten password, reset by an emailed link (Greece cobrand)

=head1 DESCRIPTION

FixMyStreet's /auth/forgot asks for the email and the new password together, and the emailed link
sets that password. Here, as people expect (owner, 2026-10-26): the page asks only for the email,
the email has a link, and the link opens a page where the new password is typed twice.

    POST /greece/password/forgot          email (+ Turnstile)   -> «check your email», whatever the address
    GET  /greece/password/reset/<token>   the form: new password, again
    POST /greece/password/reset/<token>   sets it; then sign in with it

The answer to the first is the same whether or not an account has that email, so the page does not
tell who has one. A link lasts an hour and works once; an address gets at most 3 an hour. Signing in
stays a separate step, so staff accounts still go through their second factor.

=cut

my $TTL = 60 * 60;

sub forgot : Path('/greece/password/forgot') : Args(0) {
    my ($self, $c) = @_;
    $c->detach('/page_error_404_not_found', []) unless $c->cobrand->moniker eq 'greece';
    $c->stash->{template} = 'auth/greece_password.html';
    return $c->res->redirect('/auth/forgot') unless $c->req->method eq 'POST';
    my $email = lc($c->get_param('username') // '');
    $email =~ s/\s+//g;
    $c->stash->{username} = $email;
    my $cobrand = $c->cobrand;
    unless ($cobrand->greece_turnstile_ok($c)) {
        $c->stash->{field_errors}{turnstile} = $cobrand->greece_turnstile_error;
        $c->stash->{forgotten} = 1;
        $c->stash->{template} = 'auth/create.html';
        return;
    }
    unless (is_valid_email($email)) {
        $c->stash->{username_error} = $email eq '' ? 'missing_email' : 'other_email';
        $c->stash->{forgotten} = 1;
        $c->stash->{template} = 'auth/create.html';
        return;
    }
    $c->stash->{state} = 'sent';
    my $user = $c->model('DB::User')->find({ email => $email });
    return unless $user && $user->email_verified;
    return if $cobrand->can('anonymous_account') && lc(($cobrand->anonymous_account || {})->{email} // '') eq $email;
    my $recent = grep { (($_->data || {})->{id} // 0) == $user->id }
        $c->model('DB::Token')->search({ scope => 'greece_reset', created => { '>', \"now() - interval '1 hour'" } })->all;
    return if $recent >= 3;
    my $token = $c->model('DB::Token')->create({ scope => 'greece_reset', data => { id => $user->id, at => time } });
    $c->send_email('password-reset.txt', {
        to => [ [ $user->email, $user->name ] ],
        token_url => $cobrand->base_url . '/greece/password/reset/' . $token->token,
        minutes => $TTL / 60,
    });
}

sub reset : Path('/greece/password/reset') : Args(1) {
    my ($self, $c, $id) = @_;
    $c->detach('/page_error_404_not_found', []) unless $c->cobrand->moniker eq 'greece';
    $c->stash->{template} = 'auth/greece_password.html';
    my $cobrand = $c->cobrand;
    my $token = ($id // '') =~ /^\w+$/ && $c->model('DB::Token')->find({ scope => 'greece_reset', token => $id });
    my $data = $token ? $token->data || {} : {};
    my $user = $data->{id} && $c->model('DB::User')->find($data->{id});
    if (!$user || time - ($data->{at} || 0) > $TTL) {
        $token->delete if $token;
        $c->stash->{state} = 'expired';
        return;
    }
    $c->stash->{state} = 'form';
    $c->stash->{reset_token} = $id;
    $c->forward('/auth/get_csrf_token');
    return unless $c->req->method eq 'POST';
    $c->forward('/auth/check_csrf_token');

    my $new = $c->get_param('new_password') // '';
    my $again = $c->get_param('confirm') // '';
    my $error = $new eq '' ? $cobrand->greece_t('Γράψε τον νέο κωδικό.', 'Enter the new password.')
        : $new ne $again ? $cobrand->greece_t('Οι δύο κωδικοί δεν είναι ίδιοι.', 'The two passwords are not the same.')
        : !$c->forward('/auth/test_password', [ $new ]) ? delete $c->stash->{field_errors}{password_register}
        : '';
    if ($error) {
        $c->stash->{password_error} = $error;
        return;
    }
    $user->password($new);
    $user->update;
    # This link and any other the account was sent stop working.
    $_->delete for grep { (($_->data || {})->{id} // 0) == $user->id }
        $c->model('DB::Token')->search({ scope => 'greece_reset' })->all;
    $c->stash->{state} = 'done';
    $c->stash->{username} = $user->email;
}

__PACKAGE__->meta->make_immutable;

1;
