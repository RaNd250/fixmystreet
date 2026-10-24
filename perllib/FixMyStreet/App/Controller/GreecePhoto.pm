package FixMyStreet::App::Controller::GreecePhoto;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

use JSON::MaybeXS;
use List::Util qw(uniq);

=head1 NAME

FixMyStreet::App::Controller::GreecePhoto - photo upload that also answers the plates read

=head1 DESCRIPTION

POST /greece/photo/upload does what FixMyStreet's /photo/upload does (the photo boxes post here,
see web/cobrands/greece/camera.js) and adds C<plates> to its answer: the number plates the
anonymiser read in the photo (FixMyStreet::PhotoStorage::Greece), so that the form can fill in the
plate. Only the person uploading gets them; they are not kept for anyone to ask for later.

=cut

sub upload : Path('/greece/photo/upload') : Args(0) {
    my ( $self, $c ) = @_;
    no warnings 'once';
    local %FixMyStreet::PhotoStorage::Greece::PLATES = ();
    $c->forward('/photo/upload');

    return unless $c->res->status == 200 && ($c->res->content_type // '') =~ m{application/json};
    my $out = eval { decode_json($c->res->body) } or return;
    my @ids = split /,/, $out->{id} // '';
    $out->{plates} = [ uniq map { @{ $FixMyStreet::PhotoStorage::Greece::PLATES{$_} || [] } } @ids ];
    $c->res->body(encode_json($out));
}

__PACKAGE__->meta->make_immutable;

1;
