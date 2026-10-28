package FixMyStreet::App::Controller::GreeceEdit;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

use FixMyStreet::Cobrand::Greece;

=head1 NAME

FixMyStreet::App::Controller::GreeceEdit - the author edits the description of their own report (Greece cobrand)

=head1 DESCRIPTION

  GET  /greece/edit/<id>   the form, with the description as it is now
  POST /greece/edit/<id>   saves it

Who: the signed-in author of a report that is visible (Cobrand::Greece greece_may_edit). A report made
without signing in is filed under the shared anonymous account and cannot be edited: nobody can show it is
theirs. What: the description only. The category, the place and the photos stay; a different one is a new
report. The new text goes through what a new report goes through: bad words become *** (three or more hold
the report for a moderator, as on creation), and in a police complaint the plates are replaced by *** in the
public text.

Every edit is recorded in the report's extra data, greece_edits: [ { at, by, was } ]. The report page says
«Επεξεργάστηκε από τον συντάκτη, <date and time>»; the earlier text (was) is for the moderators and the
police, who got the first version if the report had been sent. bin/greece/retention removes each earlier
text 90 days after the edit (the note of the edit stays); what is left goes with the personal parts of the
report when it is anonymised (bin/greece/anonymise-old). Nothing is sent to the municipality again.

=cut

my $MAX = 2000;

sub edit : Path('/greece/edit') : Args(1) {
    my ($self, $c, $id) = @_;
    my $cobrand = $c->cobrand;
    $c->detach('/page_error_404_not_found', []) unless $cobrand->moniker eq 'greece' && ($id // '') =~ /^\d+$/;
    $c->detach('/auth/redirect') unless $c->user_exists;
    my $problem = $c->model('DB::Problem')->find({ id => $id });
    $c->detach('/page_error_404_not_found', []) unless $problem && $cobrand->greece_may_edit($c->user->obj, $problem);

    $c->stash->{problem} = $problem;
    $c->stash->{template} = 'report/edit.html';
    $c->stash->{csrf_token} = $c->forward('/auth/get_csrf_token');
    $c->stash->{current} = $problem->get_extra_metadata('greece_detail_full') // $problem->detail;
    $c->stash->{max} = $MAX;
    return unless $c->req->method eq 'POST';
    $c->forward('/auth/check_csrf_token');

    my $new = $c->get_param('detail') // '';
    $new =~ s/\r\n?/\n/g;
    $new =~ s/^\s+|\s+$//g;
    $c->stash->{current} = $new;
    if ($new eq '') {
        $c->stash->{error} = $cobrand->greece_t('Γράψε μια περιγραφή.', 'Write a description.');
        return;
    }
    if (length $new > $MAX) {
        $c->stash->{error} = $cobrand->greece_t("Η περιγραφή είναι πολύ μεγάλη (έως $MAX χαρακτήρες).", "The description is too long (up to $MAX characters).");
        return;
    }
    my $before = $problem->get_extra_metadata('greece_detail_full') // $problem->detail;
    if ($new eq $before) {
        $c->res->redirect($problem->url);
        return;
    }

    $problem->detail($new);
    $problem->unset_extra_metadata('greece_detail_full');
    $cobrand->greece_public_complaint($problem);
    $cobrand->greece_bad_words($problem);
    # A title taken from the description («Άλλο») follows it.
    my $category = $problem->category // '';
    if ($category eq 'Άλλο' || $category eq '') {
        my $title = FixMyStreet::Cobrand::Greece::greece_excerpt($problem->detail, 60);
        my ($masked) = FixMyStreet::Cobrand::Greece::greece_mask_bad_words($title);
        $problem->title($masked || $category || 'Αναφορά');
    }
    my $edits = $problem->get_extra_metadata('greece_edits') || [];
    push @$edits, { at => time, by => 'author', was => $before };
    $problem->set_extra_metadata(greece_edits => $edits);
    $problem->update;
    $problem->update({ lastupdate => \'current_timestamp' });
    $c->log->info("greece edit: report $id edited by its author");

    if ($problem->state eq 'hidden') {
        $c->stash->{held} = 1;
        return;
    }
    $c->res->redirect($problem->url);
}

__PACKAGE__->meta->make_immutable;

1;
