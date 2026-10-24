package FixMyStreet::App::Controller::GreeceVote;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

use JSON::MaybeXS;

=head1 NAME

FixMyStreet::App::Controller::GreeceVote - thumbs up/down on reports (Greece cobrand)

=head1 DESCRIPTION

POST /greece/vote/<report id> with C<dir> = up, down or none (takes the vote back). Answers
JSON C<{ up, down, mine }>: the counts and the voter's own vote (1, -1 or 0). One vote per report
and voter; see FixMyStreet::Cobrand::Greece::greece_voter. Only for reports anyone can see.

=cut

sub vote : Path('/greece/vote') : Args(1) {
    my ( $self, $c, $id ) = @_;
    my $cobrand = $c->cobrand;

    return $self->answer($c, 404, 'not found') unless $cobrand->moniker eq 'greece';
    return $self->answer($c, 405, 'POST only') unless $c->req->method eq 'POST';
    # A page on another site cannot send this header without a CORS preflight, which is not allowed.
    return $self->answer($c, 403, 'forbidden')
        unless ($c->req->header('X-Requested-With') // '') eq 'XMLHttpRequest';
    my $value = { up => 1, down => -1, none => 0 }->{ $c->get_param('dir') // '' };
    return $self->answer($c, 400, 'dir') unless defined $value;

    my $problem = $id =~ /^\d+$/ ? $cobrand->problems->find({ id => $id }) : undef;
    return $self->answer($c, 404, 'not found')
        unless $problem && !$problem->is_hidden && !$problem->non_public;

    my $voter = $cobrand->greece_voter($c, 1);
    FixMyStreet::DB->schema->storage->dbh_do(sub {
        my ( undef, $dbh ) = @_;
        if ($value) {
            $dbh->do(<<'SQL', undef, $problem->id, $voter, $value);
INSERT INTO greece_vote (problem_id, voter, value) VALUES (?, ?, ?)
ON CONFLICT (problem_id, voter) DO UPDATE SET value = EXCLUDED.value, created = now()
SQL
        } else {
            $dbh->do('DELETE FROM greece_vote WHERE problem_id = ? AND voter = ?', undef, $problem->id, $voter);
        }
    });
    return $self->answer($c, 200, $problem->greece_votes($c, $voter));
}

sub answer : Private {
    my ( $self, $c, $status, $data ) = @_;
    $c->res->status($status);
    $c->res->content_type('application/json; charset=utf-8');
    $c->res->header('Cache-Control' => 'no-store');
    $c->res->body(encode_json(ref $data ? $data : { error => $data }));
    return;
}

__PACKAGE__->meta->make_immutable;

1;
