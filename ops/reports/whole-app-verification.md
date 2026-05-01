# Whole-App Verification And Optimization Report

Last updated: 2026-05-01

## Current Status

This report tracks the risk-first verification pass for Business OS. It is intentionally tied to repeatable commands and smoke checks so future releases can prove that the app stays responsive under normal and heavy business use.

| Area | Status | Evidence |
| --- | --- | --- |
| Runtime dependency manifests | Pass | `cmd /c run\verify-local.bat` reached the runtime manifest check and passed it. |
| Docker scale services | Pass | `cmd /c run\verify-local.bat` started and verified Docker Redis, Postgres, and MinIO health. |
| Frontend build | Pass | `npm.cmd run build` completed successfully. Largest JS chunk: `vendor-zxing` about 447 KB, with scanner code split from startup. |
| Frontend utility tests | Pass | `npm.cmd run test:utils` passed. |
| Frontend i18n/UI/performance | Pass | `verify:i18n`, `verify:ui`, and `verify:performance` passed. |
| Backend security/core/import/stock tests | Pass | `npm.cmd run test:utils` passed, including the streaming import smoke. |
| Backend data integrity | Pass | `npm.cmd run verify:integrity` passed against the current SQLite data root. |
| Worker queue smoke | Pass | Import and media workers started against Redis/BullMQ and reported active queues. |
| Release build/start smoke | Pass | `cmd /c run\build-release.bat` passed, produced portable release and NSIS installer. |
| Tailscale Funnel route check | Pass with ingress warnings | `node ops/scripts/runtime/check-public-url.mjs https://leangcosmetics.crane-qilin.ts.net /public` returned 200 for `/`, `/health`, `/public`, and `/api/portal/bootstrap`. Direct public ingress IP probes still timed out and are reported separately from app health. |

## High-Risk Findings Addressed In This Pass

- Backend import jobs still had an all-at-once CSV read/parse path. This was replaced with streaming CSV row batches so large jobs do not allocate every row before analyze/apply work begins.
- The web/API process was still able to create an in-process BullMQ worker. This was split into producer-only web code plus dedicated import/media worker entrypoints.
- Import image optimization could incorrectly count the import complete before media work finished. Import image files now move through `queued_media`, the media worker updates image progress, and product imports wait through `processing_media` before final completion.
- Large import progress must remain phase-based and must not show completion while backend row/media/finalization work is still active.
- Tailscale route health is tracked separately from app route health so relay/DNS problems do not get misdiagnosed as React/API failures.

## Required Verification Matrix

| Scenario | Required Result |
| --- | --- |
| `cmd /c run\verify-local.bat` | Build, frontend tests, i18n, UI, performance, Docker health, backend tests, and data integrity pass. |
| `cmd /c run\build-release.bat` | Release package builds without exposing local secrets. |
| Public `/public` route | Standards-mode HTML shell, no blank screen, fast English/Khmer first-party language switch, Google only as fallback. |
| Internal app browser smoke | Dashboard, POS, Products, Inventory, Contacts, Sales, Returns, Branches, Users, Settings, Backup, Files, Server, and Portal Editor render without endless loading. |
| Large import smoke | 10k and 50k CSV rows analyze/apply in background phases, awaiting approval before writes, with the app still usable. |
| Image-heavy import smoke | Image references/ZIP/folder batches avoid base64 JSON and process with bounded worker concurrency. |
| Media uploads | Product, take-photo, avatar, business logo, site logo, portal/about, file library, and import images route through multipart upload and compression metadata. |
| Tailscale Funnel | Local and public customer URLs respond, with failures reported as network/runtime status rather than app freezes. |

## Implemented Verification Improvements

- Backend CSV import parsing exposes `parseCsvRowBatchesFromFile`, which streams rows from disk in bounded batches and preserves UTF-8/Khmer text.
- Import jobs analyze and apply CSV rows from streaming batches instead of `readFile` plus all-row parsing.
- Import queues are split into `business-os-import-analyze` and `business-os-import-apply`; the web process only enqueues work, while `backend/src/workers/importWorker.js` owns processing.
- Media optimization has a dedicated `business-os-media-optimize` queue and `backend/src/workers/mediaWorker.js`. Product import images are copied quickly, queued for optimization, and counted as complete only after the worker updates file/job status.
- `run\start-server.bat` starts host Node import/media workers in SQLite mode. Release startup launches packaged worker roles from the same executable. Docker app/worker services are configured under the Postgres runtime profile.
- Docker Compose includes resource limits, health checks, restart policies, Redis memory limits/persistence, Postgres bulk-write tuning, and Docker log rotation.
- `/api/runtime/queues/status` reports import and media queue status separately for support diagnostics.
- The global import tracker compares primitive job signatures, uses React transitions for polling updates, polls less aggressively, and applies `content-visibility` to reduce repaint pressure.
- Backend tests include a 10,000-row Khmer CSV smoke test by default and a 50,000-row smoke when `BUSINESS_OS_FULL_SCALE_SMOKE=1`.
- Frontend performance verification now fails if backend import jobs reintroduce whole-file CSV parsing, missing streaming batch consumption, in-process import workers, missing worker scripts, missing background import tracker, base64 image import payloads, or missing UTF-8 BOM CSV exports.
- `run\verify-local.bat` also runs backend data integrity verification after backend tests.
- Public URL checking treats direct ingress IP timeouts as warnings when normal HTTPS routes pass, avoiding false "public URL failed" results while still surfacing network instability.

## Latest Verification Evidence

- `cmd /c run\verify-local.bat`: passed, including Docker Redis/Postgres/MinIO health, frontend build/tests/i18n/UI/performance, backend tests, and backend data integrity.
- `cmd /c run\build-release.bat`: passed, including shared verification, packaged server build, portable release assembly, and NSIS installer build.
- `npm.cmd run test:utils` in `backend`: passed.
- `npm.cmd run build`, `test:utils`, `verify:i18n`, `verify:ui`, `verify:performance` in `frontend`: passed.
- `npm.cmd run verify:integrity` in `backend`: passed.
- `docker compose -f ops/docker/compose.scale.yml config --quiet`: passed.
- Import worker Redis smoke: passed, queues `business-os-import-analyze` and `business-os-import-apply` active.
- Media worker Redis smoke: passed, queue `business-os-media-optimize` active.
- Local/public route smoke: passed for local `/health`, local `/public` standards doctype, and Tailscale `/`, `/health`, `/public`, `/api/portal/bootstrap`.

## Notes

- Browser-extension or wrapper errors such as injected `VM vendor.js`, `content.js`, Grammarly, and `tabs:outgoing.message.ready` are treated as non-first-party only when the stack/source classifier proves they are injected. First-party `assets/vendor-*.js` errors remain visible.
- SQLite/local files remain the active business data source until an explicit migration completes.
- Docker Redis/Postgres/MinIO are required runtime support services for scale mode, but the app must fail clearly when they are unavailable.
