package FixMyStreet::App::Controller::GreeceAuth;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

=head1 NAME

FixMyStreet::App::Controller::GreeceAuth - sign in with email and password on one page

=head1 DESCRIPTION

POST /greece/auth, from templates/web/greece/auth/general.html, which asks for the email and the
password together. An account with a password and a password given: FixMyStreet's password sign-in.
Otherwise (no account, an account without a password, or no password given): FixMyStreet's email
sign-in, which emails a one-off link that signs in and creates the account if there is none; a
password typed for an account without one is kept in the link and set when it is clicked.

=cut

sub general : Path('/greece/auth') : Args(0) {
    my ( $self, $c ) = @_;
    return $c->res->redirect('/auth') unless $c->req->method eq 'POST';
    $c->stash->{template} = 'auth/general.html';

    my $email = lc( $c->get_param('username') // '' );
    $email =~ s/^\s+|\s+$//g;
    my $password = $c->get_param('password_sign_in') // '';
    my $user = $email ? $c->model('DB::User')->find({ email => $email }) : undef;

    if ( $user && $user->password && $password ne '' ) {
        $c->forward( '/auth/sign_in', [ $email ] )
            && $c->detach( '/auth/redirect_on_signin', [ $c->get_param('r') ] );
        return;
    }

    $c->req->params->{password_register} = $password if $password ne '' && !( $user && $user->password );
    delete $c->req->params->{password_sign_in};
    $c->detach( '/auth/code_sign_in', [ $email ] );
}

__PACKAGE__->meta->make_immutable;

1;
