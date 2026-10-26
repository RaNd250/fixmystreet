package FixMyStreet::App::Controller::GreeceReportRef;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

=head1 NAME

FixMyStreet::App::Controller::GreeceReportRef - a report's page at its number (Greece cobrand)

=head1 DESCRIPTION

A report's address is its number, /report/20261026-03 (FixMyStreet::Cobrand::Greece greece_ref).
FixMyStreet's /report/<id> takes digits only (and sends «20261026-03» to /report/20261026), so
nginx rewrites /report/<YYYYMMDD-NN> to /greece/report-ref/<YYYYMMDD-NN>; this finds the id and
runs FixMyStreet's report page for it, at the same address. The older DDMMYYYY-N numbers redirect
to the new address.

=cut

sub report_ref : Path('/greece/report-ref') : Args(1) {
    my ( $self, $c, $ref ) = @_;
    $c->detach('/page_error_404_not_found', []) unless $c->cobrand->moniker eq 'greece';
    my $id = FixMyStreet::DB::Result::Problem::greece_id_for_ref($ref // '');
    $c->detach('/page_error_404_not_found', []) unless $id;
    unless ($ref =~ /^20\d{6}-\d+$/) {
        my $problem = $c->cobrand->problems->find({ id => $id });
        $c->detach('/page_error_404_not_found', []) unless $problem;
        $c->res->redirect($c->uri_for($problem->url), 301);
        $c->detach;
    }
    $c->go('/report/display', [ $id ], []);
}

__PACKAGE__->meta->make_immutable;

1;
