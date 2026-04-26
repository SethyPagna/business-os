# Business OS

Business OS is an offline-first retail operating system with POS, inventory, sales, returns, reporting, user roles, backup, and a read-only customer portal.

## Technical Documentation

Detailed technical docs are in [`docs/`](docs/README.md):

- architecture and module boundaries
- schema relationships and derived-data logic
- backend route ownership map
- backend/frontend file responsibility map
- auto-generated per-file function/script/translation references

Regenerate code reference docs anytime with:

```bash
node scripts/generate-doc-reference.js
node scripts/generate-full-project-docs.js
node scripts/performance-scan.js
```

## Quick Start

### From source

1. Run `setup.bat`
2. Run `start-server.bat`
3. Open `http://localhost:4000`

### From a built release

1. Go to `release\business-os`
2. Run `start-server.bat`
3. Open the local admin URL printed by the script

Use `stop-server.bat` from the same folder to stop the packaged server.

Environment file locations:

- Source mode: `backend/.env`
- Packaged release mode: `release/business-os/.env`

## Login

- Username: `admin`
- Password: `admin`

Change the password immediately after first login.

Password reset is available on the login page using email verification codes.

Login now supports:

- username/email + password
- optional OTP app 2FA (TOTP)
- passwordless one-time sign-in code via verified email
- admin-created preset users, then self-service verification/password updates by each user

- Email providers supported: Resend, SendGrid, or `EMAIL_WEBHOOK_URL`
- Provider credentials stay server-side only (in `.env`) and are never exposed to the customer portal.
- If Resend returns sandbox `403 validation_error`, verify a sender domain in Resend first, then set `RESEND_FROM_EMAIL` to that verified domain sender.

For OTP secret encryption at rest, set:

- `APP_ENCRYPTION_KEY` as a 32-byte key (64-char hex or base64)

Optional external auth provider (Auth only, local SQLite data unchanged):

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

User lifecycle rules:

- Only users with Users permission can create, disable, delete, or reset other users.
- Non-admin users can only verify/change their own profile and password.
- Inactive or deleted users cannot login or reset passwords.
- Login duration selection (`session`, `7d`, `30d`) is persisted and applied for password login, OTP login, and code login.

## Admin URL vs Customer URL

Business OS now supports two separate entry points:

- Internal admin URL: used by staff for POS, inventory, sales, settings, and management.
- Public customer URL: used by customers for the read-only catalog, membership lookup, and customer submissions when enabled.

How it works:

- The admin app runs on the main server URL, usually `http://localhost:4000` locally.
- The customer portal lives on a separate public path such as `/customer-portal` or another configured path.
- In deployment, you can point a separate domain, Tailscale Funnel, reverse proxy rule, or path-based route to that customer portal path.
- The app stores the public customer URL in Customer Portal settings, but domain or Funnel provisioning still happens outside the app.

Practical examples:

- Admin: `https://internal.example.com`
- Customer: `https://shop.example.com`

Or with path-based routing:

- Admin: `https://internal.example.com`
- Customer: `https://internal.example.com/customer-portal`

If you do not want the admin URL to be guessable, use a separate customer-facing domain or Funnel hostname.

## Customer Portal

Customer Portal is managed inside Business OS and supports:

- business profile and social/contact information
- product catalog preview and public display
- membership lookup
- points and redemption rules display
- customer engagement submission settings
- internal preview inside the admin app

The portal is read-only for customers. Staff apply membership discounts and point usage from POS.

## Loyalty Points

Loyalty Points is a separate internal management page for:

- point earning basis and earn rate
- minimum redemption points
- USD / KHR redemption values
- customer-facing membership note text
- reward points for approved customer submissions

This keeps Customer Portal focused on customer-facing layout and visibility, while point policy stays in a dedicated business-management page.

## Data Storage

Runtime data lives in `business-os-data`.

Typical contents:

- `business-os-data\db\business.db`
- `business-os-data\uploads\`
- `business-os-data\backups\`
- `business-os-data\portal\` or other uploaded assets as used by the app

For packaged releases, `build-release.bat` preserves existing release data:

- `release\business-os\business-os-data`
- `release\business-os\.env`
- `release\business-os\data-location.json` if present

That means rebuilding updates the app files without overwriting the user database or uploads.

## Release Layout

Current release output:

- `release\business-os\business-os-server.exe`
- `release\business-os\start-server.bat`
- `release\business-os\stop-server.bat`
- `release\BusinessOS-Setup-vX.X.X.exe`

The frontend is bundled into the packaged server for release builds. End users do not need the source tree.

## Tailscale / Public Access

`start-server.bat` can detect and print the local URL and, when configured, the customer portal URL. On machines with Tailscale installed, you can expose the app through Funnel or another Tailscale-hosted endpoint and save the resulting customer URL in the app.

## Troubleshooting

- If the app does not start, run `stop-server.bat` first, then start again.
- If the local port is busy, update `PORT` in the relevant `.env`.
- If the customer portal returns `404`, that machine is likely still running an older build.
- If you move a built release to another PC, keep the existing `business-os-data` folder so data stays intact.
