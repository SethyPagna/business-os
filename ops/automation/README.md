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
- `Zone WAF Edit`
- `Account Access: Apps and Policies Edit`
- `Account Cloudflare Tunnel Edit`
- `Account Settings Read`
- `Workers R2 Storage Edit`

Cloudflare may show some permission names as `Write` instead of `Edit`; choose the write/edit level when the dashboard offers that wording.

Add allowed administrator emails, one per line, to:

```text
ops/runtime/automation/access-emails.txt
```

The automation does not commit secret files or personal email allowlists. It reads them locally during setup.

## Backup And Retention

The policy keeps backup versions for 7 days. Google Drive datasync versions older than 7 days are selected for deletion by timestamp. Cloudflare R2 is the object-storage target for optimized media and backup storage.

## What The Full Run Does

The full launcher runs Cloudflare preflight, frontend utility tests, backend utility tests, i18n verification, UI verification, performance verification, frontend production build, Docker release checks, Docker release/start, `/health`, `/sw.js`, then commits and pushes to `main` if the run is clean.
