# Business OS Automation

This folder keeps the small-step automation policy for the existing Business OS domains:

- Admin: `https://admin.leangcosmetics.dpdns.org`
- Public: `https://leangcosmetics.dpdns.org`
- Zone: `leangcosmetics.dpdns.org`

Run everything from the repository root with:

```powershell
run\full-automation.bat
```

For a dry preflight that does not commit or push:

```powershell
run\full-automation.bat -Action Cloudflare -NoGit
```

## Needed Local Inputs

The current Cloudflare token is active and can see the zone and DNS records. To automate Cloudflare Access and WAF/rate-limit rules, replace or update the token stored at:

```text
ops/runtime/secrets/cloudflare-api-token.txt
```

Create a Cloudflare custom token scoped only to the `leangcosmetics.dpdns.org` zone and the owning account. Required permission groups:

- `Zone Read`
- `Zone DNS Edit`
- `Zone Rulesets Edit`
- `Zone Cache Rules Edit`
- `Zone WAF Edit`
- `Account Access: Apps and Policies Edit`
- `Account Cloudflare Tunnel Edit`
- `Account Settings Read`
- `Workers R2 Storage Edit`

Cloudflare may show some permission names as `Write` instead of `Edit`; choose the write/edit level when the dashboard offers that wording.

After the token has `Zone Cache Rules Edit`, apply only the public portal cache rule with:

```powershell
npm --prefix ops run cloudflare:apply-cache
```

This command fails before mutating anything else if the token still cannot read or write Cache Rules. It is the required Cloudflare-side step for turning `/public` from `cf-cache-status: DYNAMIC` into an edge-cacheable customer portal document.

Add allowed administrator emails, one per line, to:

```text
ops/runtime/automation/access-emails.txt
```

The automation does not commit secret files or personal email allowlists. It reads them locally during setup.

## Backup And Retention

The policy keeps Google Drive backup versions for 7 days, keeps the latest 3 local backup packages, and keeps only the latest Cloudflare R2 backup package mirror. Runtime Playwright/report artifacts are capped at the latest 20 folders.

Run the cleanup directly with:

```powershell
npm --prefix ops run prune-storage
```

Use `-- --dry-run` to preview. Add `-- --delete-demo` only when you also want to remove ignored demo/video build artifacts under `ops/demo`.

## Cloudflare Access Convenience

The admin domain uses `cloudflare.adminAccessMode`. Set it to `app-auth-only` when the app's own login, permissions, OTP, rate limits, and Cloudflare WAF should protect the admin UI without an extra Cloudflare email gate. Set it to `cloudflare-access` to restore the email allowlist policy. The Access app still uses the 720 hour session duration from `cloudflare.accessSessionDuration` when Cloudflare Access mode is enabled.

## What The Full Run Does

The full launcher runs Cloudflare preflight, frontend utility tests, backend utility tests, i18n verification, UI verification, performance verification, frontend production build, Docker release checks, Docker release/start, `/health`, `/sw.js`, then commits and pushes to `main` if the run is clean.
