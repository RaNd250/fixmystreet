package FixMyStreet::PhotoStorage::Greece;

=head1 NAME

FixMyStreet::PhotoStorage::Greece - photos are anonymised before they are stored

=head1 DESCRIPTION

Every JPEG goes to the anonymiser service (docker/greece/anonymiser) before it is stored. What is
stored, shown and sent to municipalities is the copy with number plates and faces blurred. When
something was found, the copy with only the faces blurred (plates readable) is kept apart, under the
same file name, in ORIGINALS_DIR, for the police letter only (Problem::greece_photos('police'));
nothing serves that directory, and bin/greece/purge-originals deletes each copy once its report has
been sent. The plates read are kept for the rest of the request (%PLATES), so that the upload
answer can fill in the form (App::Controller::GreecePhoto). If the anonymiser does not answer, the
upload fails: no photo is stored unblurred.

Configuration (conf/general.yml), besides UPLOAD_DIR:

    PHOTO_STORAGE_BACKEND: 'Greece'
    PHOTO_STORAGE_OPTIONS:
      UPLOAD_DIR: '../upload/'
      ORIGINALS_DIR: '/var/lib/fms-originals'
      ANONYMISER_URL: 'http://anonymiser.svc:8080/anonymise'

=cut

use Moose;
extends 'FixMyStreet::PhotoStorage::FileSystem';

use HTTP::Tiny;
use JSON::MaybeXS;
use MIME::Base64 qw(decode_base64);
use Path::Tiny 'path';

# File name of a stored photo => the plates read in it, for this request only.
our %PLATES;

sub _option {
    my ($name, $default) = @_;
    my $cfg = FixMyStreet->config('PHOTO_STORAGE_OPTIONS') || {};
    return $cfg->{$name} || $default;
}

sub originals_dir {
    return path(_option(ORIGINALS_DIR => '/var/lib/fms-originals'));
}

sub store_photo {
    my ($self, $blob) = @_;

    # Only JPEGs come from report and update forms; other images (e.g. admin logos) are stored as is.
    return $self->SUPER::store_photo($blob) unless $self->detect_type($blob) eq 'jpeg';

    my $res = HTTP::Tiny->new(timeout => 60)->post(_option(ANONYMISER_URL => 'http://anonymiser.svc:8080/anonymise'), {
        content => $blob,
        headers => { 'Content-Type' => 'image/jpeg' },
    });
    die "anonymiser: $res->{status} $res->{reason}\n" unless $res->{success};
    my $result = decode_json($res->{content});

    # "public" is undef when nothing was found: then the photo is stored as it came.
    my $public = defined $result->{public} ? decode_base64($result->{public}) : $blob;
    my $name = $self->SUPER::store_photo($public);

    if (defined $result->{police}) {
        my $dir = originals_dir();
        $dir->mkpath;
        my $file = $dir->child($name);
        $file->spew_raw(decode_base64($result->{police}));
        chmod 0640, "$file";
    }
    $PLATES{$name} = [ map { $_->{text} } grep { $_->{text} } @{ $result->{plates} || [] } ];

    return $name;
}

# The police copy of a stored photo (plates readable), if there is one.
sub police_photo {
    my ($class, $name) = @_;
    return unless $name =~ /^[0-9a-f]{40}\.jpeg\z/;
    my $file = originals_dir()->child($name);
    return $file->exists ? $file->slurp_raw : undef;
}

__PACKAGE__->meta->make_immutable;

1;
