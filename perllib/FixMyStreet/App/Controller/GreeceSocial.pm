package FixMyStreet::App::Controller::GreeceSocial;
use Moose;
use namespace::autoclean;
BEGIN { extends 'Catalyst::Controller'; }

use Crypt::JWT qw(decode_jwt encode_jwt);
use Crypt::PK::ECC;
use Digest::SHA qw(sha256_hex hmac_sha256_hex);
use HTTP::Tiny;
use JSON::MaybeXS qw(decode_json encode_json);
use MIME::Base64 qw(encode_base64url decode_base64url);
use URI;
use mySociety::AuthToken;

=head1 NAME

FixMyStreet::App::Controller::GreeceSocial - sign in with Google, Apple or Microsoft

=head1 DESCRIPTION

GET /greece/auth/<provider> starts the OpenID Connect authorization code flow, and
/greece/auth/<provider>/callback finishes it (a GET for Google and Microsoft, a form_post POST for
Apple). The user is then signed in through FixMyStreet's own Auth::Social oauth_success, so accounts
are found or created, and the provider's ID stored (oidc_ids), as for any other OIDC login.

The CSRF binding is a short-lived cookie (SameSite=None, because Apple's callback is a cross-site
POST that would not carry a Lax session cookie) whose hash is inside the HMAC-signed state. The
state also carries the provider, the nonce and the page to return to.

An email address is passed to FixMyStreet only when the provider vouches for it, because FixMyStreet
signs in to the existing account with that email. A Microsoft work or school account is never
trusted for its email (anyone can set it in a tenant of their own): there FixMyStreet asks for the
address and confirms it by email, then links the account. Staff and superuser accounts cannot be
reached through social sign-in at all.

Settings (conf/general.yml): GOOGLE_CLIENT_ID/SECRET, MICROSOFT_CLIENT_ID/SECRET, APPLE_TEAM_ID,
APPLE_SERVICES_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8). A provider with no settings is off.

=cut

my $MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';   # Microsoft personal accounts
my $COOKIE = 'gr_oauth';

my %PROVIDER = (
    google => {
        authorize => 'https://accounts.google.com/o/oauth2/v2/auth',
        token     => 'https://oauth2.googleapis.com/token',
        jwks      => 'https://www.googleapis.com/oauth2/v3/certs',
        scope     => 'openid email profile',
        mode      => 'query',
        id_key    => 'GOOGLE_CLIENT_ID',
    },
    microsoft => {
        authorize => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        token     => 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        jwks      => 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
        scope     => 'openid email profile',
        mode      => 'query',
        id_key    => 'MICROSOFT_CLIENT_ID',
    },
    apple => {
        authorize => 'https://appleid.apple.com/auth/authorize',
        token     => 'https://appleid.apple.com/auth/token',
        jwks      => 'https://appleid.apple.com/auth/keys',
        scope     => 'name email',
        mode      => 'form_post',
        id_key    => 'APPLE_SERVICES_ID',
    },
);

my %JWKS;   # provider => { at => time, keys => {...} }

sub _client_id { my $p = shift; FixMyStreet->config($PROVIDER{$p}{id_key}) }

sub _redirect_uri {
    my $p = shift;
    return FixMyStreet->config('BASE_URL') . "/greece/auth/$p/callback";
}

sub _secret { FixMyStreet::DB->resultset('Secret')->get }

sub _sign { my $d = shift; return hmac_sha256_hex($d, _secret()) }

sub _safe_return {
    my $r = shift // '';
    return $r =~ m{^/(?!/|\\)} ? $r : '';
}

sub _no_store {
    my $c = shift;
    $c->res->header('Cache-Control' => 'no-store');
    $c->res->header('Pragma' => 'no-cache');
}

sub _clear_cookie {
    my $c = shift;
    $c->res->headers->push_header('Set-Cookie' =>
        "$COOKIE=; Path=/greece/auth; Max-Age=0; HttpOnly; Secure; SameSite=None");
}

sub _fail {
    my ($c, $why) = @_;
    $c->log->warn("GreeceSocial: $why") if $why;
    _clear_cookie($c);
    $c->detach('/auth/social/oauth_failure');
}

=head2 start

=cut

sub start : Path('/greece/auth') : Args(1) {
    my ( $self, $c, $p ) = @_;
    my $cfg = $PROVIDER{ $p // '' } or $c->detach('/page_error_404_not_found', []);
    my $client_id = _client_id($p) or $c->detach('/page_error_404_not_found', []);
    _no_store($c);

    my $bind  = mySociety::AuthToken::random_token();
    my $nonce = mySociety::AuthToken::random_token();
    my $body = encode_base64url(encode_json({
        p => $p,
        n => $nonce,
        r => _safe_return($c->get_param('r')),
        e => time + 600,
        c => sha256_hex($bind),
    }));
    my $state = $body . '.' . _sign($body);

    $c->res->headers->push_header('Set-Cookie' =>
        "$COOKIE=$bind; Path=/greece/auth; Max-Age=600; HttpOnly; Secure; SameSite=None");

    my $uri = URI->new($cfg->{authorize});
    $uri->query_form(
        client_id     => $client_id,
        redirect_uri  => _redirect_uri($p),
        response_type => 'code',
        scope         => $cfg->{scope},
        state         => $state,
        nonce         => $nonce,
        response_mode => $cfg->{mode},
        ( $p eq 'google' ? ( prompt => 'select_account' ) : () ),
        ( $p eq 'microsoft' ? ( prompt => 'select_account' ) : () ),
    );
    $c->res->redirect($uri->as_string);
}

=head2 callback

=cut

sub callback : Path('/greece/auth') : Args(2) {
    my ( $self, $c, $p, $leaf ) = @_;
    my $cfg = $PROVIDER{ $p // '' };
    $c->detach('/page_error_404_not_found', []) unless $cfg && ( $leaf // '' ) eq 'callback' && _client_id($p);
    _no_store($c);

    # Apple sends the callback as a POST; the others as a GET.
    $c->detach('/page_error_400_bad_request', []) if $p eq 'apple' ? $c->req->method ne 'POST' : $c->req->method ne 'GET';

    _fail($c, "$p: provider error " . ( $c->get_param('error') // '' )) if $c->get_param('error');

    # state: signed, not expired, for this provider, and bound to this browser by the cookie
    my ( $body, $sig ) = split /\./, ( $c->get_param('state') // '' ), 2;
    _fail($c, "$p: no state") unless $body && $sig;
    _fail($c, "$p: bad state signature") unless _eq( _sign($body), $sig );
    my $st = eval { decode_json( decode_base64url($body) ) };
    _fail($c, "$p: unreadable state") unless ref $st eq 'HASH';
    _fail($c, "$p: state expired") unless ( $st->{e} // 0 ) >= time;
    _fail($c, "$p: state for another provider") unless ( $st->{p} // '' ) eq $p;
    my $bind = $c->req->cookie($COOKIE) ? $c->req->cookie($COOKIE)->value : '';
    _fail($c, "$p: no binding cookie") unless length $bind && _eq( sha256_hex($bind), $st->{c} // '' );
    my $code = $c->get_param('code') or _fail($c, "$p: no code");

    my $tok = _token($p, $code) or _fail($c, "$p: token request failed");
    my $claims = _verify_id_token($p, $tok->{id_token}, $st->{n}) or _fail($c, "$p: id_token rejected");

    my ( $name, $email ) = _identity($p, $claims, $c);

    my $uid = join ':', 'greece', _client_id($p), $claims->{sub};

    # Staff and superusers sign in with a password only.
    my $rs = $c->model('DB::User');
    my $linked = $rs->find({ oidc_ids => \[ '&& ?', [ oidc_ids => [ $uid ] ] ] });
    my $by_email = $email ? $rs->find({ email => $email }) : undef;
    for my $u ( grep { $_ } $linked, $by_email ) {
        if ( $u->is_superuser || $u->from_body ) {
            $c->log->warn("GreeceSocial: refused staff account via $p");
            _clear_cookie($c);
            $c->flash->{flash_message} = $c->cobrand->greece_t(
                'Αυτός ο λογαριασμός συνδέεται μόνο με κωδικό.',
                'This account signs in with a password only.');
            $c->res->redirect('/auth');
            $c->detach;
        }
    }

    _clear_cookie($c);
    $c->session->{oauth} = { return_url => $st->{r} || undef };
    $c->forward('/auth/social/oauth_success', [ 'oidc', $uid, $name, $email ]);
}

# constant-time string compare
sub _eq {
    my ( $x, $y ) = @_;
    return 0 unless defined $x && defined $y && length $x == length $y;
    my $r = 0;
    $r |= ord( substr $x, $_, 1 ) ^ ord( substr $y, $_, 1 ) for 0 .. length($x) - 1;
    return $r == 0;
}

sub _http { HTTP::Tiny->new( timeout => 10, agent => 'FixMyStreets/1.0' ) }

sub _apple_secret {
    my $pem = FixMyStreet->config('APPLE_PRIVATE_KEY') or return;
    my $key = eval { Crypt::PK::ECC->new( \$pem ) } or return;
    return encode_jwt(
        alg           => 'ES256',
        key           => $key,
        extra_headers => { kid => FixMyStreet->config('APPLE_KEY_ID') },
        payload       => {
            iss => FixMyStreet->config('APPLE_TEAM_ID'),
            sub => FixMyStreet->config('APPLE_SERVICES_ID'),
            aud => 'https://appleid.apple.com',
            iat => time,
            exp => time + 300,
        },
    );
}

sub _token {
    my ( $p, $code ) = @_;
    my $secret = $p eq 'apple'
        ? _apple_secret()
        : FixMyStreet->config( $p eq 'google' ? 'GOOGLE_CLIENT_SECRET' : 'MICROSOFT_CLIENT_SECRET' );
    return unless $secret;
    my $res = _http()->post_form( $PROVIDER{$p}{token}, {
        grant_type    => 'authorization_code',
        code          => $code,
        redirect_uri  => _redirect_uri($p),
        client_id     => _client_id($p),
        client_secret => $secret,
    } );
    my $tok = eval { decode_json( $res->{content} ) };
    return unless $res->{success} && ref $tok eq 'HASH' && $tok->{id_token};
    return $tok;
}

sub _jwks {
    my ( $p, $refresh ) = @_;
    my $j = $JWKS{$p};
    return $j->{keys} if $j && !$refresh && time - $j->{at} < 3600;
    my $res = _http()->get( $PROVIDER{$p}{jwks} );
    my $keys = $res->{success} && eval { decode_json( $res->{content} ) };
    return $j ? $j->{keys} : undef unless ref $keys eq 'HASH' && ref $keys->{keys} eq 'ARRAY';
    $JWKS{$p} = { at => time, keys => $keys };
    return $keys;
}

sub _verify_id_token {
    my ( $p, $jwt, $nonce ) = @_;
    return unless $jwt;
    my $claims;
    for my $refresh ( 0, 1 ) {
        my $keys = _jwks( $p, $refresh ) or next;
        $claims = eval {
            decode_jwt(
                token        => $jwt,
                kid_keys     => $keys,
                accepted_alg => 'RS256',
                verify_exp   => 1,
                leeway       => 60,
            );
        };
        last if $claims;
    }
    return unless ref $claims eq 'HASH';

    my $aud = $claims->{aud};
    return unless defined $aud && ( ref $aud ? grep { $_ eq _client_id($p) } @$aud : $aud eq _client_id($p) );
    return unless $claims->{sub};
    return unless defined $claims->{nonce} && defined $nonce && _eq( $claims->{nonce}, $nonce );

    my $iss = $claims->{iss} // '';
    if ( $p eq 'google' )    { return unless $iss eq 'https://accounts.google.com' || $iss eq 'accounts.google.com' }
    elsif ( $p eq 'apple' )  { return unless $iss eq 'https://appleid.apple.com' }
    else {
        # /common issues per-tenant issuers: the issuer must be the token's own tenant
        my $tid = $claims->{tid} // '';
        return unless $tid =~ /^[0-9a-f-]{36}$/ && $iss eq "https://login.microsoftonline.com/$tid/v2.0";
    }
    return $claims;
}

sub _truthy { my $v = shift; return defined $v && ( $v eq '1' || lc $v eq 'true' ) }

# The name, and the email only when the provider vouches for it.
sub _identity {
    my ( $p, $claims, $c ) = @_;
    my ( $name, $email );
    if ( $p eq 'google' ) {
        $name  = $claims->{name};
        $email = $claims->{email} if _truthy( $claims->{email_verified} );
    } elsif ( $p eq 'apple' ) {
        $email = $claims->{email} if _truthy( $claims->{email_verified} );
        # Apple gives the name once, on the first authorisation, as a JSON parameter of the POST
        if ( my $u = eval { decode_json( $c->get_param('user') // '' ) } ) {
            $name = join ' ', grep { $_ } @{ $u->{name} || {} }{qw/firstName lastName/} if ref $u->{name};
        }
    } else {
        $name = $claims->{name};
        $email = $claims->{email} if ( $claims->{tid} // '' ) eq $MSA_TENANT && $claims->{email};
    }
    $email = lc $email if $email;
    $name = '' if $name && $name !~ /\w/;
    return ( $name, $email );
}

__PACKAGE__->meta->make_immutable;

1;
