package FixMyStreet::Cobrand::Greece;
use base 'FixMyStreet::Cobrand::Default';

use strict;
use warnings;
use utf8;

# Reuse the Default cobrand's compiled CSS; this cobrand only adds templates and a little JS/CSS.
sub asset_moniker { 'default' }

# Search box: "ref: 123" (database id) or a public reference "DDMMYYYY-N".
# A bare number stays a place search, because Greek postcodes are five digits.
sub lookup_by_ref_regex { qr/^\s*(?|ref:\s*(\d+)|(\d{8}-\d+))\s*$/ }

sub lookup_by_ref {
    my ($self, $ref) = @_;
    return unless $ref =~ /^(\d\d)(\d\d)(\d{4})-(\d+)$/;
    my $id = FixMyStreet::DB::Result::Problem::greece_ref_to_id("$3-$2-$1", $4);
    return [ id => $id || 0 ];
}

# Values the report email templates use besides the stock ones.
sub munge_sendreport_params {
    my ($self, $row, $h, $params) = @_;

    # The address the email went to, so the recipient can send us a better one.
    $h->{sent_to} = join ', ', map { ref $_ ? $_->[0] : $_ } @{ $params->{To} || [] };

    # A category can have its own email (contact extra metadata email_template, e.g. "amea"
    # for the police complaint about disabled or EV-charging bays); submit.txt hands over to it.
    my $contact = $row->contact;
    my $template = ($contact && $contact->get_extra_metadata('email_template')) || '';
    $h->{email_template} = $template if $template =~ /^[a-z]+$/;

    # The municipality of the location, for emails to a body that is not the municipality.
    my $dimos = $row->greece_dimos;
    $h->{dimos_name} = $dimos->name if $dimos;
}

# Police complaints (disabled and EV-charging bays) can also be sent by the reporter as an SMS
# from their own phone; see Problem::greece_sms.
sub greece_sms_number { '100' }

package FixMyStreet::DB::Result::Problem;

use strict;
use warnings;
use utf8;

# The municipality body covering the report's location.
sub greece_dimos {
    my $self = shift;
    my @areas = grep { $_ } split /,/, ($self->areas || '');
    return unless @areas;
    return FixMyStreet::DB->resultset('Body')->search(
        { 'body_areas.area_id' => \@areas, 'me.name' => { -like => 'Δήμος %' }, 'me.deleted' => 0 },
        { join => 'body_areas', order_by => 'me.id' })->first;
}

# The SMS sentence for each answer to "Τι συμβαίνει;": what a vehicle does ("Όχημα ..."), or
# what is there.
my %SMS_VEHICLE = (
    xoris_karta => 'καταλαμβάνει θέση στάθμευσης ΑμεΑ χωρίς Μπλε Κάρτα',
    rampa => 'καταλαμβάνει ράμπα ΑμεΑ',
    fortistis => 'καταλαμβάνει θέση φόρτισης ηλεκτρικών οχημάτων χωρίς να φορτίζει',
);
my %SMS_OTHER = (
    empodia => 'Παράνομα εμπόδια ή κώνοι από κατάστημα',
    p72 => 'Αυθαίρετη διαγράμμιση και πινακίδα P-72',
);

# OSM names a region "Περιφέρεια <genitive>"; addresses use the nominative.
my %REGION = (
    'Αττικής' => 'Αττική', 'Κεντρικής Μακεδονίας' => 'Κεντρική Μακεδονία',
    'Ανατολικής Μακεδονίας και Θράκης' => 'Ανατολική Μακεδονία και Θράκη',
    'Δυτικής Μακεδονίας' => 'Δυτική Μακεδονία', 'Ηπείρου' => 'Ήπειρος', 'Θεσσαλίας' => 'Θεσσαλία',
    'Ιονίων Νήσων' => 'Ιόνια Νησιά', 'Δυτικής Ελλάδας' => 'Δυτική Ελλάδα', 'Δυτικής Ελλάδος' => 'Δυτική Ελλάδα',
    'Στερεάς Ελλάδας' => 'Στερεά Ελλάδα', 'Στερεάς Ελλάδος' => 'Στερεά Ελλάδα', 'Πελοποννήσου' => 'Πελοπόννησος',
    'Βορείου Αιγαίου' => 'Βόρειο Αιγαίο', 'Νοτίου Αιγαίου' => 'Νότιο Αιγαίο', 'Κρήτης' => 'Κρήτη',
);

# The address of the report as written in Greece, e.g. "Φαβιέρου 15, 124 61 Χαϊδάρι, Αττική".
sub greece_address {
    my ($self, $cobrand) = @_;
    my $address = $cobrand ? $cobrand->find_closest($self) : $self->geocode && FixMyStreet::Geocode::Address->new($self->geocode);
    my $parts = $address ? $address->parts : {};
    my $osm = ($address && $address->{address}) || {};
    my $place = $osm->{suburb} || $osm->{neighbourhood} || $osm->{city} || $osm->{town} || $osm->{village};
    unless ($place) {
        my $dimos = $self->greece_dimos;
        ($place = $dimos->name) =~ s/^Δήμος // if $dimos;
    }
    (my $postcode = $osm->{postcode} || $parts->{postcode} || '') =~ s/^(\d{3})\s*(\d{2})$/$1 $2/;
    (my $region = $osm->{state} || '') =~ s/^Περιφέρεια\s+//;
    $region = $REGION{$region} || $region;
    my $street = join ' ', grep { $_ } $parts->{street}, $parts->{number};
    return join ', ', grep { $_ } $street, join(' ', grep { $_ } $postcode, $place), $region;
}

# Greek plates use only the letters that look Latin (ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ), so a plate typed or read
# in Latin letters is written in Greek, as "ΙΚΧ-1234". Anything else is kept, in capitals.
sub greece_plate_normalise {
    my $text = uc(shift // '');
    $text =~ s/^\s+|\s+$//g;
    (my $greek = $text) =~ tr/ABEZHIKMNOPTYX/ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ/;
    $greek =~ s/[\s.\-]+//g;
    return "$1-$2" if $greek =~ /^([ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ]{2,3})(\d{3,4})$/;
    return $text;
}

# The plate of a police complaint (question "pinakida"), normalised.
sub greece_plate {
    my $self = shift;
    my $plate = greece_plate_normalise($self->get_extra_field_value('pinakida'));
    return length $plate ? $plate : undef;
}

# The addresses the report's category goes to, in the order of its bodies.
sub greece_recipients {
    my $self = shift;
    my @ids = grep { $_ } split /,/, ($self->bodies_str || '');
    return () unless @ids;
    my %order = map { $ids[$_] => $_ } 0 .. $#ids;
    my @contacts = sort { $order{$a->body_id} <=> $order{$b->body_id} } FixMyStreet::DB->resultset('Contact')->search(
        { body_id => \@ids, category => $self->category, state => 'confirmed' })->all;
    return map { split /\s*,\s*/, $_->email } @contacts;
}

# For a police complaint, the SMS the reporter can send from their phone: { number, body }, e.g.
#   Όχημα με πινακίδα ΙΚΧ-1234 καταλαμβάνει ράμπα ΑμεΑ στη διεύθυνση Φαβιέρου 15, 124 61 Χαϊδάρι, Αττική.
#   Αρ. αναφοράς 24102026-1, στάλθηκε στα x@astynomia.gr και y@astynomia.gr.
# Nothing for other categories.
sub greece_sms {
    my ($self, $cobrand) = @_;
    my $contact = $self->contact;
    return unless $contact && ($contact->get_extra_metadata('email_template') || '') eq 'amea';

    my $paravasi = $self->get_extra_field_value('paravasi') // '';
    my $address = $self->greece_address($cobrand);
    my $where = $address ? "στη διεύθυνση $address"
        : sprintf('στο σημείο %.5f, %.5f', $self->latitude, $self->longitude);
    my $what;
    if (my $does = $SMS_VEHICLE{$paravasi}) {
        my $plate = $self->greece_plate;
        $what = 'Όχημα' . ($plate ? " με πινακίδα $plate" : '') . " $does $where.";
    } else {
        $what = ($SMS_OTHER{$paravasi} || 'Παράνομη στάθμευση σε θέση ΑμεΑ ή φόρτισης ηλεκτρικών οχημάτων') . " $where.";
    }

    my @to = $self->greece_recipients;
    my $sent = 'Αρ. αναφοράς ' . $self->greece_ref;
    $sent .= ', στάλθηκε ' . (@to > 1 ? 'στα ' . join(' και ', @to) : "στο $to[0]") if @to;
    return { number => FixMyStreet::Cobrand::Greece->greece_sms_number, body => "$what\n$sent." };
}

# Public reference DDMMYYYY-N: the local (TIME_ZONE) date the report was created and its
# position among all reports created that day. `created` holds wall-clock time in the
# server's zone, because FixMyStreet sets the DB session time zone to it.

sub _greece_zones {
    return (FixMyStreet->local_time_zone->name, (FixMyStreet->time_zone || FixMyStreet->local_time_zone)->name);
}

sub greece_ref {
    my $self = shift;
    return $self->{__greece_ref} //= do {
        my ($server_tz, $site_tz) = _greece_zones();
        my $dbh = $self->result_source->schema->storage->dbh;
        # Placeholders bind in text order: CTE (site, server, id), then each day bound (server, site).
        my ($day, $n) = $dbh->selectrow_array(<<'SQL', undef, $site_tz, $server_tz, $self->id, $server_tz, $site_tz, $server_tz, $site_tz);
WITH p AS (
    SELECT id, timezone(?, timezone(?, created)) AS local_created FROM problem WHERE id = ?
)
SELECT to_char(p.local_created, 'DDMMYYYY'),
       (SELECT count(*) FROM problem q
         WHERE q.id <= p.id
           AND q.created >= timezone(?, timezone(?, date_trunc('day', p.local_created)))
           AND q.created <  timezone(?, timezone(?, date_trunc('day', p.local_created) + interval '1 day')))
FROM p
SQL
        defined $day ? "$day-$n" : $self->id;
    };
}

# Every photo of the report at full size, for attaching to an email.
sub greece_photos {
    my $self = shift;
    my $set = $self->get_photoset;
    return [ grep { $_ } map { $set->get_image_data(num => $_, size => 'full') } 0 .. $set->num_images - 1 ];
}

# When the report was made, in local time, e.g. "24/10/2026 18:05".
sub greece_local_time {
    my $self = shift;
    my $dt = ($self->confirmed || $self->created)->clone;
    $dt->set_time_zone(FixMyStreet->local_time_zone) if $dt->time_zone->is_floating;
    $dt->set_time_zone(FixMyStreet->time_zone || FixMyStreet->local_time_zone);
    return $dt->strftime('%d/%m/%Y %H:%M');
}

# Inverse of greece_ref: the id of the $n-th report created on local date $date (YYYY-MM-DD).
sub greece_ref_to_id {
    my ($date, $n) = @_;
    return unless $n >= 1;
    my ($server_tz, $site_tz) = _greece_zones();
    my $dbh = FixMyStreet::DB->schema->storage->dbh;
    my $id = eval {
        $dbh->selectrow_array(<<'SQL', undef, $server_tz, $site_tz, $date, $server_tz, $site_tz, $date, $n - 1);
SELECT id FROM problem
 WHERE created >= timezone(?, timezone(?, ?::date::timestamp))
   AND created <  timezone(?, timezone(?, ?::date::timestamp + interval '1 day'))
 ORDER BY id OFFSET ? LIMIT 1
SQL
    };
    return $id;
}

1;
