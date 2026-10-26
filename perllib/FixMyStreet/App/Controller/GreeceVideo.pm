package FixMyStreet::App::Controller::GreeceVideo;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

use utf8;
use JSON::MaybeXS;
use File::Path qw(make_path remove_tree);
use Fcntl qw(O_CREAT O_EXCL O_WRONLY);
use HTTP::Tiny;

=head1 NAME

FixMyStreet::App::Controller::GreeceVideo - a short video with a report (Greece cobrand)

=head1 DESCRIPTION

A reporter can add one video, up to 45 seconds, to a report (owner, 2026-10-26). It is never
published: only the accounts of the bodies the report went to (and superusers) see it, on the
report's page. Uploads pass the Cloudflare tunnel, which refuses bodies over ~95 MB, so the page
(web/cobrands/greece/video-upload.js) sends the file in slices:

    POST /greece/video/start           size=<bytes>        -> { id }
    POST /greece/video/chunk/<id>?offset=<n>  (raw bytes, at most 9 MB)  -> { received }
    POST /greece/video/finish/<id>                         -> { state: "working" }
    GET  /greece/video/status/<id>                         -> { state, duration?, reason? }
    GET  /greece/video/view/<id>.mp4   the video, to those allowed (nginx serves the file)

The id is 128 random bits. «finish» asks the video service (docker/greece/video) to check the clip
(a video, at most 45 s) and re-encode it to 720p without metadata; the page polls «status». The
report claims the id when it is saved (Greece.pm greece_claim_video), once. Files live on the
fixmystreet-videos volume: incoming/<id>/ while uploading, ready/<id>.mp4 after. Each «start» sweeps
uploads left for a day and videos no report claimed, and videos older than GREECE_VIDEO_KEEP_DAYS.

=cut

my $ROOT = '/var/lib/fms-videos';
my $MAX_UPLOAD = 300 * 1024 * 1024;     # raw phone video (4K HEVC 45 s is ~250 MB)
my $MAX_CHUNK = 9 * 1024 * 1024;
my $KEEP_DAYS = 180;
my $SERVICE = 'http://video.svc:8080/transcode';

sub _id_ok { defined $_[0] && $_[0] =~ /^[0-9a-f]{32}$/ }

sub _answer {
    my ($c, $status, $data) = @_;
    $c->res->status($status);
    $c->res->content_type('application/json; charset=utf-8');
    $c->res->header('Cache-Control' => 'no-store');
    $c->res->body(encode_json(ref $data ? $data : { error => $data }));
    return;
}

# The page's own requests only: a form on another site cannot send this header without a preflight.
sub _ours {
    my ($c) = @_;
    return $c->cobrand->moniker eq 'greece'
        && ($c->req->header('X-Requested-With') // '') eq 'XMLHttpRequest';
}

sub _meta {
    my ($id) = @_;
    open my $fh, '<', "$ROOT/incoming/$id/meta.json" or return;
    local $/; my $m = eval { decode_json(<$fh>) };
    return $m;
}

sub _sweep {
    my $now = time;
    for my $dir (glob "$ROOT/incoming/*") {
        remove_tree($dir) if -d $dir && $now - (stat $dir)[9] > 86400;
    }
    for my $file (glob "$ROOT/ready/*.mp4") {
        my ($id) = $file =~ m{/([0-9a-f]{32})\.mp4$} or next;
        my $age = $now - (stat $file)[9];
        my $claimed = -e "$ROOT/claimed/$id";
        if ((!$claimed && $age > 86400) || $age > $KEEP_DAYS * 86400) {
            unlink $file, "$ROOT/claimed/$id";
        }
    }
}

sub start : Path('/greece/video/start') : Args(0) {
    my ($self, $c) = @_;
    return _answer($c, 403, 'forbidden') unless _ours($c) && $c->req->method eq 'POST';
    my $size = $c->get_param('size') // '';
    return _answer($c, 400, 'size') unless $size =~ /^\d+$/ && $size > 0;
    return _answer($c, 413, 'too_big') if $size > $MAX_UPLOAD;
    for my $d ("$ROOT/incoming", "$ROOT/ready", "$ROOT/claimed") { make_path($d); chmod 0777, $d; }
    _sweep();
    open my $ur, '<:raw', '/dev/urandom' or return _answer($c, 500, 'random');
    read($ur, my $bytes, 16) == 16 or return _answer($c, 500, 'random');
    my $id = unpack 'H*', $bytes;
    my $dir = "$ROOT/incoming/$id";
    make_path($dir, { mode => 0777 });
    chmod 0777, $dir;    # the video service (another user) writes status.json here
    open my $m, '>', "$dir/meta.json" or return _answer($c, 500, 'storage');
    print $m encode_json({ size => $size + 0, created => time,
        ip => $c->req->header('CF-Connecting-IP') // $c->req->address });
    close $m;
    open my $u, '>', "$dir/upload" or return _answer($c, 500, 'storage');
    close $u;
    chmod 0666, "$dir/upload";
    return _answer($c, 200, { id => $id, chunk => $MAX_CHUNK });
}

sub chunk : Path('/greece/video/chunk') : Args(1) {
    my ($self, $c, $id) = @_;
    return _answer($c, 403, 'forbidden') unless _ours($c) && $c->req->method eq 'POST';
    return _answer($c, 404, 'not found') unless _id_ok($id) && (my $meta = _meta($id));
    my $file = "$ROOT/incoming/$id/upload";
    return _answer($c, 409, 'finished') if -e "$ROOT/incoming/$id/status.json";
    my $have = -s $file // 0;
    my $offset = $c->get_param('offset') // '';
    return _answer($c, 409, { error => 'offset', received => $have + 0 }) unless $offset =~ /^\d+$/ && $offset == $have;
    my $body = $c->req->body;
    my $data = '';
    if (ref $body) { local $/; binmode $body; seek $body, 0, 0; $data = <$body> // ''; }
    my $len = length $data;
    return _answer($c, 400, 'empty') unless $len;
    return _answer($c, 413, 'chunk') if $len > $MAX_CHUNK || $have + $len > $meta->{size};
    open my $out, '>>:raw', $file or return _answer($c, 500, 'storage');
    print $out $data;
    close $out;
    return _answer($c, 200, { received => $have + $len });
}

sub finish : Path('/greece/video/finish') : Args(1) {
    my ($self, $c, $id) = @_;
    return _answer($c, 403, 'forbidden') unless _ours($c) && $c->req->method eq 'POST';
    return _answer($c, 404, 'not found') unless _id_ok($id) && (my $meta = _meta($id));
    my $have = -s "$ROOT/incoming/$id/upload" // 0;
    return _answer($c, 409, { error => 'incomplete', received => $have + 0 }) unless $have == $meta->{size};
    my $res = HTTP::Tiny->new(timeout => 10)->post($SERVICE, {
        headers => { 'Content-Type' => 'application/json' }, content => encode_json({ id => $id }) });
    return _answer($c, 502, 'service') unless $res->{success};
    return _answer($c, 200, { state => 'working' });
}

sub status : Path('/greece/video/status') : Args(1) {
    my ($self, $c, $id) = @_;
    return _answer($c, 403, 'forbidden') unless _ours($c);
    return _answer($c, 404, 'not found') unless _id_ok($id);
    open my $fh, '<', "$ROOT/incoming/$id/status.json" or return _answer($c, 200, { state => 'uploading' });
    local $/; my $st = eval { decode_json(<$fh>) } || { state => 'working' };
    return _answer($c, 200, { map { $_ => $st->{$_} } grep { exists $st->{$_} } qw(state duration reason) });
}

# The video, only to a superuser or to staff of a body the report was sent to; nginx serves the file
# (with the Range requests that phones and Safari need) from an internal location.
sub view : Path('/greece/video/view') : Args(1) {
    my ($self, $c, $file) = @_;
    my ($id) = ($file // '') =~ /^([0-9a-f]{32})\.mp4$/ or $c->detach('/page_error_404_not_found', []);
    $c->detach('/page_error_404_not_found', []) unless -e "$ROOT/ready/$id.mp4";
    my $problem = $c->cobrand->problems->search(\[ "extra->>'greece_video' = ?", $id ])->first
        or $c->detach('/page_error_404_not_found', []);
    $c->detach('/page_error_403_access_denied', []) unless $c->cobrand->greece_may_see_video($c->user, $problem);
    $c->res->header('X-Accel-Redirect' => "/internal-videos/$id.mp4");
    $c->res->header('Cache-Control' => 'private, no-store');
    $c->res->content_type('video/mp4');
    $c->res->body('');
}

__PACKAGE__->meta->make_immutable;

1;
