package FixMyStreet::App::Controller::GreeceNearby;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

use JSON::MaybeXS;
use Math::Trig qw(deg2rad);

=head1 NAME

FixMyStreet::App::Controller::GreeceNearby - private reports near a spot, as a count (Greece cobrand)

=head1 DESCRIPTION

GET /greece/nearby-private?latitude=..&longitude=.. answers C<{ count, minutes }>: how many open,
non-public reports (police complaints) were made in the last 24 hours within 100 m, and how many
minutes ago the latest was. Nothing else about them: no id, title, category, place or person. The
report form shows it as a notice without links (web/cobrands/greece/nearby-check.js), so a second
complaint about the same car is not sent. 24 hours because these are about what is there now.

=cut

my $RADIUS = 100;     # metres
my $HOURS  = 24;

sub nearby_private : Path('/greece/nearby-private') : Args(0) {
    my ( $self, $c ) = @_;
    return $self->answer($c, 404, 'not found') unless $c->cobrand->moniker eq 'greece';
    my ($lat, $lon) = map { $c->get_param($_) // '' } qw(latitude longitude);
    return $self->answer($c, 400, 'latitude, longitude')
        unless $lat =~ /^-?\d{1,2}(?:\.\d+)?$/ && $lon =~ /^-?\d{1,3}(?:\.\d+)?$/;

    # A box a little larger than the circle, then the exact distance.
    my $dlat = $RADIUS / 111_000 * 1.2;
    my $dlon = $dlat / (cos(deg2rad($lat)) || 1);
    my @rows = $c->cobrand->problems->search({
        non_public => 1,
        state      => [ FixMyStreet::DB::Result::Problem->open_states ],
        confirmed  => { '>=', \"now() - interval '$HOURS hours'" },
        latitude   => { -between => [ $lat - $dlat, $lat + $dlat ] },
        longitude  => { -between => [ $lon - $dlon, $lon + $dlon ] },
    }, { columns => [qw(latitude longitude confirmed)] })->all;

    my ($count, $latest) = (0, undef);
    for my $p (@rows) {
        next if _metres($lat, $lon, $p->latitude, $p->longitude) > $RADIUS;
        $count++;
        # Stored as the server's wall-clock time (floating), as in greece_when.
        my $dt = $p->confirmed->clone;
        $dt->set_time_zone(FixMyStreet->local_time_zone) if $dt->time_zone->is_floating;
        my $t = $dt->epoch;
        $latest = $t if !defined $latest || $t > $latest;
    }
    return $self->answer($c, 200, {
        count   => $count,
        minutes => defined $latest ? int((time - $latest) / 60) : undef,
    });
}

# POST /greece/name-check (name=..) answers { name, error }: the name as it will be taken (greeklish written in Greek
# letters, Greece.pm greece_name_normalise) and why it is refused, if it is (greece_name_error). The forms call it
# when the name field is left, so the person sees it at once. Nothing is stored or logged (a POST body).
sub name_check : Path('/greece/name-check') : Args(0) {
    my ( $self, $c ) = @_;
    return $self->answer($c, 404, 'not found') unless $c->cobrand->moniker eq 'greece';
    return $self->answer($c, 405, 'POST') unless $c->req->method eq 'POST';
    my $name = substr($c->get_param('name') // '', 0, 100);
    $name = $c->cobrand->greece_name_normalise($name);
    return $self->answer($c, 200, { name => $name, error => ($c->cobrand->greece_name_error($name) // '') });
}
sub _metres {
    my ($la1, $lo1, $la2, $lo2) = map { deg2rad($_) } @_;
    my $a = sin(($la2 - $la1) / 2) ** 2 + cos($la1) * cos($la2) * sin(($lo2 - $lo1) / 2) ** 2;
    return 6_371_000 * 2 * atan2(sqrt($a), sqrt(1 - $a));
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
