package FixMyStreet::App::Controller::GreeceApprove;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

=head1 NAME

FixMyStreet::App::Controller::GreeceApprove - an admin approves the municipalities' reports (Greece cobrand)

=head1 DESCRIPTION

Reports to the municipalities leave in a batch (bin/greece/send-digest, at 01:00, 07:00, 13:00 and
19:00 Athens time), and only once a superuser has approved them here. A report that is not approved
stays public and waits; the digest emails the contact address at each batch time while any wait.
Complaints to the police do not come here: they go at once.

  GET  /admin/greece/approve                      the waiting reports
  POST /admin/greece/approve  id=...&id=...       approves those
  POST /admin/greece/approve  all=1               approves every waiting one

Approving stores extra greece_approved = { at, by } on the report (FixMyStreet::Cobrand::Greece
greece_needs_approval). Superusers only; the second sign-in step (greece_2fa_gate) applies as everywhere.

=cut

sub approve : Path('/admin/greece/approve') : Args(0) {
    my ( $self, $c ) = @_;
    $c->detach('/page_error_404_not_found', []) unless $c->cobrand->moniker eq 'greece';
    return $c->res->redirect('/auth?r=/admin/greece/approve') unless $c->user_exists;
    $c->detach('/page_error_403_access_denied', ['']) unless $c->user->is_superuser;

    my $cobrand = $c->cobrand;
    my @waiting = grep { $cobrand->greece_needs_approval($_) } $c->model('DB::Problem')->search({
        state => [ FixMyStreet::DB::Result::Problem->open_states ],
        send_state => 'unprocessed',
        whensent => undef,
        bodies_str => { '!=' => undef },
    }, { order_by => [ 'confirmed', 'id' ] })->all;

    if ($c->req->method eq 'POST') {
        $c->forward('/auth/check_csrf_token');
        my %want = map { $_ => 1 } grep { /^\d+$/ } $c->req->param('id');
        my $all = $c->get_param('all');
        my $n = 0;
        for my $r (@waiting) {
            next unless $all || $want{ $r->id };
            $r->set_extra_metadata(greece_approved => { at => time, by => $c->user->id });
            $r->update;
            $n++;
        }
        $c->log->info("greece approve: user " . $c->user->id . " approved $n report(s)");
        return $c->res->redirect($c->uri_for('/admin/greece/approve', { done => $n }));
    }

    $c->stash->{csrf_token} = $c->forward('/auth/get_csrf_token');
    $c->stash->{waiting} = \@waiting;
    $c->stash->{done} = $c->get_param('done');
    $c->stash->{template} = 'admin/greece_approve.html';
}

__PACKAGE__->meta->make_immutable;

1;
