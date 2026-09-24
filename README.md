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
  `docs/history/` (the per-session narrative log and closed-work archives),
  `docs/fleet/` (dated audits and the owner task register).
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

## Tests

- `cd frontend && npm run test:utils && npm run verify:i18n && npm run build`,
  the frontend gate (typecheck, source checks, every `tests/*.test.ts`).
- `cd cloudflare && npx tsc --noEmit`, then the pure Worker tests in
  `cloudflare/scripts/test-*.cjs`.
- `cd frontend && npm run test:e2e`, the Playwright browser suite against the
  built app. See `frontend/e2e/README.md`.

## Multiple sessions on this checkout

Several Claude Code, Codex and Copilot sessions work on this repository in
parallel. `AGENTS.md` holds the shared rules and `CLAUDE.md` the Claude Code
mechanics; the agent team is defined in `agent-team/` (see
`docs/CODEX-TEAM-SETUP.md`). Record cross-tool claims with
`node agent-team/scripts/team-state.mjs`, and invoke the `/fleet-coordination`
skill for session roles, the shared git index and the staged
commit, push and deploy cycle. `progress.md` holds the current status and open
work.
