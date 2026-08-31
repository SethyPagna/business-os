# Run Commands

Business OS runs entirely on Cloudflare now - there is no local server to
start or stop, and no Docker. This folder only holds:

- `run\full-automation.bat` - full release pipeline: typecheck, build the
  frontend, apply remote D1 migrations, sync secrets (`cloudflare\.dev.vars`
  -> Cloudflare, allowlisted keys only), `wrangler deploy`, then a live
  health check against the real Workers URL
  (`https://admin.leangbeauty.com/health`). See
  `ops\scripts\powershell\full-automation.ps1` and `..\DEPLOY.md`.
- `run\verify-local.bat` - local-only check, no Cloudflare/wrangler steps:
  remove known stray files, install frontend + Cloudflare Worker
  dependencies, typecheck both, run the pure-logic test suites, build the
  frontend. Never touches D1, secrets, or deploy. Use this to confirm a
  change is good before cutting a release with `full-automation.bat`. See
  `ops\scripts\powershell\verify-local.ps1`.
- `run\open-app.bat` - opens the live admin URL in a browser. That's the
  entire "start the app" step now; the Worker is always deployed and always on.

For install/deploy/redeploy instructions, see `..\DEPLOY.md`.

## Runtime secrets

Real credentials never go in this repo. Set them with `wrangler secret put`
or via the Cloudflare dashboard (Workers & Pages -> business-os -> Settings
-> Variables). If a secret was ever pasted into chat, a screenshot, or a
commit, rotate it immediately.
