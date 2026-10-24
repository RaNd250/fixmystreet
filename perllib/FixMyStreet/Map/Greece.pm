# FixMyStreet::Map::Greece
# The site's own raster tiles (tiles compose service): the positron style without buildings and
# with Greek labels, so the report maps look like the homepage minimap.

package FixMyStreet::Map::Greece;

use Moo;
extends 'FixMyStreet::Map::OSM';

has '+map_type' => ( default => 'OpenLayers.Layer.Greece' );

sub map_javascript { [
    '/vendor/OpenLayers/OpenLayers.wfs.js',
    '/js/map-OpenLayers.js',
    '/cobrands/greece/map-greece.js',
] }

# Used for server-side maps, such as the no-JavaScript map and the map image in report emails.
has '+base_tile_url' => ( default => sub {
    (my $host = FixMyStreet->config('BASE_URL')) =~ s{^https?://}{};
    return "$host/tiles/styles/positron";
} );

# The 2x2 tiles around the centre; unlike OSM, there are no a./b./c. tile hosts.
sub map_tiles {
    my ($self, %params) = @_;
    my ($x, $y, $z) = ($params{x_tile}, $params{y_tile}, $params{zoom_act});
    my $base = 'https://' . $self->base_tile_url . "/$z";
    return [ map { "$base/$_->[0]/$_->[1].png" } [$x - 1, $y - 1], [$x, $y - 1], [$x - 1, $y], [$x, $y] ];
}

has '+copyright' => ( default =>
    '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
);

1;
