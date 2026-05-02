# Cloudflare Ready Setup

Business OS is designed to run locally on the business laptop while Cloudflare Tunnel publishes the app safely to the internet. Do not open router ports to the laptop.

## Hostnames

Use two hostnames:

- `admin.leangcosmetics.dpdns.org` -> staff/admin app.
- `leangcosmetics.dpdns.org/public` -> public customer portal.

Both hostnames can point to the same Cloudflare Tunnel and local service. The
origin must not be plain `localhost`.

When `cloudflared` runs on Windows/host, use:

```text
http://127.0.0.1:4000
```

When `cloudflared` runs inside Docker Compose, use:

```text
http://app:4000
```

Do not use `http://localhost:4000` in the Cloudflare Tunnel dashboard. On
Windows it can resolve to `::1` before IPv4, and inside a container it points
at the `cloudflared` container itself. Both cases cause slow retries, blank
pages, or intermittent connection closed errors.

Protect only the admin hostname with Cloudflare Access. Do not protect the public portal hostname, or customers will be blocked before they can view the portal.

## Required Cloudflare DNS

Create proxied CNAME records:

```text
leangcosmetics.dpdns.org        CNAME  b6d18448-a7eb-45ae-8a45-e19a3647130d.cfargotunnel.com
admin.leangcosmetics.dpdns.org  CNAME  b6d18448-a7eb-45ae-8a45-e19a3647130d.cfargotunnel.com
```

If Cloudflare Tunnel's dashboard already created equivalent public hostnames, keep those instead of duplicating records.

## Cloudflare Tunnel

The app expects the tunnel token in ignored local secret storage:

```text
ops\runtime\secrets\cloudflare-business-os-leangcosmetics.token
```

The token file should contain only the Cloudflare tunnel token. Never commit it. `Start Business OS.bat` starts the Docker `cloudflared` connector automatically when this file exists.

If you have a scoped Cloudflare API token with Tunnel configuration permission,
the origin can be corrected from the repo:

```text
run\cloudflare-origin.bat host
```

Use `run\cloudflare-origin.bat docker` only when the Cloudflare Tunnel connector
itself is running inside Docker Compose.

## SSL/TLS

Recommended settings:

- SSL/TLS mode: Full, because Tunnel terminates to `cloudflared` instead of exposing a raw origin.
- Always Use HTTPS: On.
- TLS 1.3: On.
- Minimum TLS Version: TLS 1.2.
- Automatic HTTPS Rewrites: On.
- Certificate Transparency Monitoring: On.

Do not paste or commit Cloudflare Origin Certificate private keys. If a private key was shared in chat, revoke that Origin Certificate and create a new one only if you later expose a non-Tunnel HTTPS origin. With Cloudflare Tunnel, this origin certificate is normally not required.

Enable HSTS only after the domain has been stable for several days, because HSTS makes HTTPS mistakes sticky for browsers.

## DNSSEC

Only enable DNSSEC if you can add Cloudflare's DS record at the parent/registrar that delegates `leangcosmetics.dpdns.org`.

If the parent provider does not let you add the DS record for this delegated hostname, leave DNSSEC disabled in Cloudflare. Enabling DNSSEC without the matching parent DS setup can break resolution.

## Email Anti-Spoofing

If this domain does not send email, add restrictive email records:

```text
MX    leangcosmetics.dpdns.org  0 .
TXT   leangcosmetics.dpdns.org  "v=spf1 -all"
TXT   _dmarc                   "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s"
```

Do not add the null MX if you later plan to receive mail on this domain.

## Security Rules

Disable broad skip rules that skip WAF, rate limiting, or bot protection for the entire hostname. Broad skip rules remove the protection Cloudflare is giving you.

Recommended shape:

- Keep DDoS protection enabled.
- Keep managed security detections enabled where your plan allows them.
- Add one rate limiting rule for sensitive endpoints if your plan allows one rule:
  - `/api/auth/login`
  - `/api/auth/otp`
  - `/api/auth/password-reset`
  - `/api/import-jobs`
  - `/api/files`
  - `/api/portal/submissions`
- Use Cloudflare Access for `admin.leangcosmetics.dpdns.org`.
- Do not put Access on `leangcosmetics.dpdns.org/public`.

## Caching

Keep Cloudflare's caching level at Standard and use Cache Rules:

Bypass cache:

```text
hostname eq "admin.leangcosmetics.dpdns.org"
or starts_with(http.request.uri.path, "/api/")
or http.request.uri.path eq "/"
or http.request.uri.path eq "/public"
or ends_with(http.request.uri.path, ".html")
```

Cache static assets:

```text
starts_with(http.request.uri.path, "/assets/")
or starts_with(http.request.uri.path, "/uploads/")
or http.request.uri.path matches "(?i)\\.(js|css|woff2|png|jpg|jpeg|webp|svg|ico|wasm)$"
```

Use a long edge/browser TTL only for hashed assets. The app already sends strict `Cache-Control` headers for built assets and no-store headers for HTML.

## Performance

Recommended:

- Brotli: On.
- HTTP/2 and HTTP/3: On.
- Tiered Cache: On.
- Web Analytics: On.
- Logpush: Off until you have a log storage destination.

## API Tokens

Do not use the Global API Key. Use scoped Cloudflare API tokens only.

For normal app runtime, no Cloudflare API token is required. The app only needs the tunnel token file.

For future automation, create separate scoped tokens:

- DNS/config token: Zone DNS Edit, Zone Settings Edit, Zone Rulesets Edit for this zone only.
- Access token: Access Apps and Policies Edit for this account/zone only.
- Read-only support token: Zone Read, Analytics Read, Access Read.

Store tokens in ignored local files or environment variables, never in Git.

## Google Drive Sync

Google Drive sync is independent of Cloudflare. Use this redirect URI in the Google OAuth client:

```text
https://leangcosmetics.dpdns.org/api/system/drive-sync/oauth/callback
```

Keep `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET` in the local `.env` file only.
