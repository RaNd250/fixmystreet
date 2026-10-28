package FixMyStreet::Gaze;

# Greece overlay (bind-mounted over the upstream module, see docker-compose.yml).
#
# Upstream asks mySociety's Gaze service for the radius that holds a given population around a
# point, and for the country of a visitor's IP address. Both send a visitor's location or address to
# a third party, which the privacy page does not list, so neither call is made: the radius is the
# 10 km that upstream uses when Gaze does not answer, and the country is Greece.
#
# (Pointing GAZE_URL at a dead address instead is not enough: the failing call dies inside
# mySociety::Locale::in_gb_locale, which then leaves the request in the English locale.)

use strict;
use warnings;

sub get_radius_containing_population ($$;$) {
    return 10.0;
}

sub get_country_from_ip {
    return 'GR';
}

1;
