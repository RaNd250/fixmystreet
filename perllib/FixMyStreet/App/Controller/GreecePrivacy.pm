package FixMyStreet::App::Controller::GreecePrivacy;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

=head1 NAME

FixMyStreet::App::Controller::GreecePrivacy - hide a report at once when someone flags a privacy problem (Greece cobrand)

=head1 DESCRIPTION

  GET  /greece/privacy/<id>   the form (what is wrong; an email, if they want an answer)
  POST /greece/privacy/<id>   hides the report from the public at once, and tells the contact address

«Hides» is non_public: the report leaves the map, the lists and the search engines, and only its author and
the staff see it. It is not deleted, and what was already emailed to a municipality or the police is not
recalled. The flag is stored as extra greece_privacy_flag { at, reason, contact }; an admin looks at it
(admin/report_edit/<id>) and makes the report public again, or deletes it, or anonymises it. Anyone can
flag, so the form has the Turnstile check like the other public forms; a wrong flag costs a report a few
hours of visibility, which the privacy side of the balance accepts.

=cut

sub flag : Path('/greece/privacy') : Args(1) {
    my ( $self, $c, $id ) = @_;
    $c->detach('/page_error_404_not_found', []) unless $c->cobrand->moniker eq 'greece' && ($id // '') =~ /^\d+$/;
    my $problem = $c->model('DB::Problem')->find({ id => $id });
    $c->detach('/page_error_404_not_found', []) unless $problem && $problem->state ne 'hidden' && $problem->state ne 'unconfirmed';
    $c->stash->{problem} = $problem;
    $c->stash->{template} = 'report/privacy_flag.html';
    return unless $c->req->method eq 'POST';

    unless ($c->cobrand->greece_turnstile_ok($c)) {
        $c->stash->{error} = $c->cobrand->greece_turnstile_error;
        return;
    }
    my $reason = $c->get_param('reason') // '';
    $reason =~ s/^\s+|\s+$//g;
    $reason = substr($reason, 0, 1000);
    my $contact = $c->get_param('contact') // '';
    $contact =~ s/^\s+|\s+$//g;
    $contact = '' unless $contact =~ /^[^\s\@]+\@[^\s\@]+\.[^\s\@]+$/;

    unless ($problem->non_public) {
        $problem->set_extra_metadata(greece_privacy_flag => { at => time, reason => $reason, contact => $contact });
        $problem->non_public(1);
        $problem->update;
    }
    $c->log->info("greece privacy flag: report $id hidden from the public");

    $c->stash->{reason} = $reason;
    $c->stash->{contact} = $contact;
    # Behind the Cloudflare tunnel the connection comes from the docker gateway (172.18.0.1); the visitor's
    # address is in this header.
    $c->stash->{ip} = $c->req->header('CF-Connecting-IP') // $c->req->address;
    $c->stash->{admin_url} = $c->cobrand->base_url . '/admin/report_edit/' . $id;
    $c->send_email('greece-privacy-flag.txt', {
        to => [ [ $c->cobrand->contact_email, $c->cobrand->contact_name ] ],
        from => [ FixMyStreet->config('DO_NOT_REPLY_EMAIL'), $c->cobrand->contact_name ],
    });
    $c->stash->{done} = 1;
}

__PACKAGE__->meta->make_immutable;

1;
