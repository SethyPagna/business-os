# Business OS Build Guide

This guide covers the current release pipeline, the preserved data rules, and how the internal admin URL differs from the customer portal URL.

For code architecture, schema relationships, and route/file ownership maps, see `docs/README.md`.
For auto-generated per-file function/script/translation references, run:

```bash
node scripts/generate-doc-reference.js
node scripts/generate-full-project-docs.js
node scripts/performance-scan.js
```

## Build Requirements

- Node.js installed on the build machine
- NSIS installed if you want the Windows installer output

## Main Build Command

Run:

```bat
build-release.bat
```

What it does:

1. installs or syncs backend and frontend dependencies
2. builds the frontend
3. stages the built frontend into the backend package
4. packages `business-os-server.exe`
5. assembles the portable release in `release\business-os`
6. builds the installer in `release\BusinessOS-Setup-vX.X.X.exe` when NSIS is available

## Runtime And Verification Commands

Source-mode helpers:

- `setup.bat` / `setup.sh` - install dependencies, write env defaults, build the frontend
- `start-server.bat` / `start-server.sh` - start the source backend and local admin UI
- `stop-server.bat` / `stop-server.sh` - stop the source backend and Tailscale funnel

Release-mode helpers:

- `start-server-release.bat`
- `stop-server-release.bat`

Useful validation commands:

```bash
cd backend && npm run test:utils
cd backend && npm run verify:integrity
cd frontend && npm run build
cd frontend && npm run test:utils
cd frontend && npm run verify:i18n
```

## Env Files (Source vs Release)

- Source / visible-code mode uses `backend\.env` (written by `setup.bat`).
- Release / packaged mode uses `release\business-os\.env` (created or preserved by `build-release.bat`).

This keeps local development config separate from distributed release config.

## Release Output

After a successful build, the main output is:

```text
release\
  business-os\
    business-os-server.exe
    start-server.bat
    stop-server.bat
    .env
    business-os-data\   (preserved on rebuild if it already exists)
  BusinessOS-Setup-vX.X.X.exe
```

The release no longer depends on a separately distributed frontend folder. The frontend is embedded into the packaged server build.

## Data Preservation Rules

`build-release.bat` is designed to rebuild the app files without overwriting existing release data.

Preserved if already present:

- `release\business-os\business-os-data`
- `release\business-os\.env`
- `release\business-os\data-location.json`

Rebuilt or replaced:

- `business-os-server.exe`
- `start-server.bat`
- `stop-server.bat`
- packaged app assets and installer output

This keeps customer data, uploads, and environment settings intact across rebuilds.

## Portable Release Flow

To test the portable output:

1. run `build-release.bat`
2. open `release\business-os`
3. run `start-server.bat`
4. confirm the printed local admin URL works
5. run `stop-server.bat`

## Documentation And Reference Output

The repo includes generated reference docs for files, folders, symbols, and
performance hotspots in `ops/docs/reference/`.

Regenerate them with:

```bash
node ops/scripts/generate-doc-reference.js
node ops/scripts/generate-full-project-docs.js
node ops/scripts/performance-scan.js
```

## Internal Admin URL vs Public Customer URL

There are two separate concepts:

- Internal admin URL: the full Business OS app for staff
- Public customer URL: the customer-facing catalog and membership portal

Implementation:

- The customer portal is served by the same server, on a dedicated public path such as `/customer-portal` or another configured path.
- You can expose that path through a separate public hostname, Funnel URL, reverse proxy, or path-based route.
- The app can store and display the configured public customer URL, but it does not provision that domain or Funnel itself.
- Point rules are managed separately in the internal `Loyalty Points` page, while the public customer portal only displays the resulting customer-facing point information.

Recommended secure setup:

- Admin URL on a private/internal host or staff-only Funnel
- Customer portal on a different public hostname

Example:

- Admin: `https://internal.example.com`
- Customer: `https://shop.example.com`

Or path-based if needed:

- Admin: `https://internal.example.com`
- Customer: `https://internal.example.com/customer-portal`

## Launcher Behavior

`start-server-release.bat` and the copied release `start-server.bat` are expected to:

- run from the release folder
- launch the packaged EXE in the background
- keep running after the launcher window closes
- print the local admin URL
- print the customer portal path or saved public customer URL
- stop cleanly through `stop-server.bat`

They also refresh `TAILSCALE_URL` in `.env` from the current device Funnel/domain when Tailscale is available, so changing the device tailnet hostname does not require manual edits.

Tailscale notes:

- The launcher resolves the active Funnel URL for the configured port (default `4000`) and prefers that exact mapping.
- If no exact Funnel mapping is readable, it falls back to the current device DNS name from `tailscale status --json`.
- To clean stale historical Funnel entries, run (as Administrator):
  - `tailscale funnel reset`
  - `tailscale funnel --bg 4000`

## Data Path Portability

When you set a custom data folder inside the app root, Business OS now stores that path as a relative value in `data-location.json`.

Result:

- If you move/migrate the whole app folder, relative data paths still resolve correctly.
- External data folders outside the app root are still stored as absolute paths.

## Verification Delivery (Email)

Password-reset and contact-verification codes in this app are delivered by your email provider integration (not by Firebase automatically).

Provider options (choose one):

- Resend: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- SendGrid: `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`
- Custom mail service webhook: `EMAIL_WEBHOOK_URL`

Why you saw `403 validation_error` from Resend:

- Resend sandbox only allows sending to your own account email until a domain is verified.
- You must verify a domain in Resend and use a `from` address on that verified domain.

Resend production setup checklist:

1. In Resend, add your domain under **Domains**.
2. Add DNS records (SPF/DKIM/verification) at your DNS host and wait for domain status = verified.
3. Set `RESEND_FROM_EMAIL` to a sender on that domain (for example `noreply@yourdomain.com`).
4. Keep `RESEND_API_KEY` set.
5. Restart the server after updating `.env`.
6. If you still see `403 validation_error`, your sender domain is not verified yet, or `RESEND_FROM_EMAIL` does not match the verified domain.

Supabase auth setup checklist (auth-only, SQLite data stays local):

1. In Supabase, create/open the project you want to use for authentication.
2. Copy the project URL and keys into `backend\.env`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Turn on the features you want in `backend\.env`:
   - `SUPABASE_AUTH_ENABLED=true`
   - `SUPABASE_EMAIL_AUTH_ENABLED=true`
   - `SUPABASE_MAGIC_LINK_ENABLED=true`
   - `SUPABASE_INVITE_ENABLED=true`
   - `SUPABASE_GOOGLE_OAUTH_ENABLED=true` when Google is configured
   - `SUPABASE_FACEBOOK_OAUTH_ENABLED=true` when Facebook is configured
4. Run the SQL from [README-supabase-auth.md](C:/Users/mrkl6/Downloads/business-os/ops/readme/README-supabase-auth.md).
5. Configure Google/Facebook providers in the Supabase dashboard.
6. Restart Business OS after env updates.

How to confirm the provider is configured:

- Open `http://localhost:4000/api/auth/verification-capabilities`
- Expected result includes email provider enabled (for example `resend` or another configured provider)
- If provider is not configured, UI will show `Provider not configured` and no real delivery occurs

OTP secret encryption at rest:

- `APP_ENCRYPTION_KEY` (32-byte key as hex/base64)

Optional external auth provider (Auth only, local data remains in SQLite):

- `SUPABASE_AUTH_ENABLED=true`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- Optional feature flags:
  - `SUPABASE_EMAIL_AUTH_ENABLED`
  - `SUPABASE_MAGIC_LINK_ENABLED`
  - `SUPABASE_INVITE_ENABLED`
  - `SUPABASE_GOOGLE_OAUTH_ENABLED`
  - `SUPABASE_FACEBOOK_OAUTH_ENABLED`
  - `SUPABASE_MFA_TOTP_ENABLED`

Current implementation preference is Supabase for auth-only integration in this build pipeline.

If no provider is configured, verification endpoints return a clear configuration error and do not issue usable codes.

## Recommended Update Method

When distributing an update:

1. stop the existing release with `stop-server.bat`
2. replace the new app files in `release\business-os`
3. keep `business-os-data`, `.env`, and `data-location.json`
4. start again with `start-server.bat`

That updates the software while preserving business data.
