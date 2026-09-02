# Business OS

Business OS is a React + TypeScript PWA — an admin/POS back office plus a
public customer storefront — running entirely on Cloudflare (Workers, D1, R2,
Queues, KV). There is no separate backend server and no Docker image; the
Worker serves both the API and the built frontend.

Live: `admin.leangbeauty.com` (admin/POS) and `leangbeauty.com` (public
storefront).

## Repo layout

- `frontend/` — the Vite/React app (admin, POS, and public storefront). See
  `frontend/README.md` and `frontend/src/README.md` for the source layout.
- `cloudflare/` — the Worker: API routes, D1 migrations, R2/KV/Queues
  bindings. See `cloudflare/README.md`.
- `run/` — the release-pipeline batch scripts (`full-automation.bat`,
  `verify-local.bat`, `open-app.bat`). See `run/README.md`.
- `ops/` — operational scripts (migration tooling, generated doc reference,
  audit scripts) that are not part of the deployed app.
- `docs/` — audits, the release-candidate coordination plan, and
  `docs/history/` (the per-session narrative log and closed-work archives).
  See `docs/README.md` for an index.
- `progress.md` — the project's control document. Read it top-to-bottom at
  the start of every session; its own "How to use this file" section
  explains the structure.

## Running and verifying a change

There is no local server to start for day-to-day use — the app is always
live on Cloudflare. To verify a change before it ships:

```sh
run\verify-local.bat
```

This installs dependencies, typechecks both `frontend/` and `cloudflare/`,
runs the pure-logic test suites, and builds the frontend — without touching
D1, secrets, or deploy. See `run/README.md` for what each script does and
`DEPLOY.md` for the full deploy pipeline (`run\full-automation.bat`).

To run the Worker locally against a local D1 copy:

```sh
cd cloudflare
npm install
npm run build:frontend
npm run migrate:local
npm run dev
```

## Deploying

See [`DEPLOY.md`](DEPLOY.md) — it is the authoritative deploy reference
(prerequisites, secrets, the `deploy:full` pipeline, and troubleshooting).
This README does not duplicate it.

## Multiple sessions on this checkout

This project is regularly worked on by several parallel Claude Code sessions
against the same checkout. Invoke the **`/fleet-coordination`** skill
(`.claude/skills/fleet-coordination/SKILL.md`) for session roles,
conflict-prevention on the shared git index, and the staged
commit→push→deploy cycle — see `progress.md` for the current status and open
work, and `docs/plans/` for any active isolated release-candidate effort.
