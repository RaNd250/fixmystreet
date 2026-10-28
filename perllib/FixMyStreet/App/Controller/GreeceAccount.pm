package FixMyStreet::App::Controller::GreeceAccount;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

=head1 NAME

FixMyStreet::App::Controller::GreeceAccount - a signed-in user changes the name and phone on their account (Greece cobrand)

=head1 DESCRIPTION

  POST /greece/account   name, phone (and the CSRF token of the /my page)

FixMyStreet's /my page shows the name and offers no way to change it, and there was no way to add one
(the name on the report form is only copied into the user for a report). The form is in
templates/web/greece/my/_title.html, at the top of /my. The name is the one the report form offers and
the one a letter to a municipality carries (Cobrand::Greece greece_name_error: no abusive words, at least
4 characters, or empty). The phone is optional. The email is the sign-in and is not changed here: a new
address would need to be confirmed first.

The answer is a redirect back to /my with ?acc=saved, or ?acc=<what is wrong>.

=cut

sub details : Path('/greece/account') : Args(0) {
    my ($self, $c) = @_;
    $c->detach('/page_error_404_not_found', []) unless $c->cobrand->moniker eq 'greece';
    $c->detach('/auth/redirect') unless $c->user_exists;
    $c->res->redirect('/my') && return unless $c->req->method eq 'POST';
    $c->forward('/auth/check_csrf_token');

    my $name = $c->get_param('name') // '';
    $name =~ s/^\s+|\s+$//g;
    $name =~ s/\s+/ /g;
    $name = substr($name, 0, 100);
    my $phone = $c->get_param('phone') // '';
    $phone =~ s/^\s+|\s+$//g;

    my $back = sub { $c->res->redirect('/my?acc=' . $_[0]); return };
    if (my $err = $c->cobrand->greece_name_error($name)) {
        return $back->($name =~ /\S/ && length($name) < 4 ? 'name_short' : 'name_bad');
    }
    if ($phone ne '') {
        (my $digits = $phone) =~ s/[\s().-]//g;
        return $back->('phone') unless $digits =~ /^\+?[0-9]{7,15}$/;
        $phone = $digits;
    }

    my $user = $c->user->obj;
    my $phone_changed = ($user->phone // '') ne $phone;
    $user->name($name);
    $user->phone($phone);
    $user->phone_verified(0) if $phone_changed;
    $user->update;
    $c->log->info('greece account: details changed for user ' . $user->id);
    return $back->('saved');
}

__PACKAGE__->meta->make_immutable;

1;
