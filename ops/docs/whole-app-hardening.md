# Whole-App Hardening And Reliability Program

Last updated: 2026-04-30

## Baseline

- `cmd /c run\verify-local.bat` passed on 2026-04-30 before Session 1 edits.
- Frontend build, frontend utility tests, i18n verification, UI verification, and backend utility/security/core tests were green.
- Known local-only artifacts remain untracked and intentionally excluded from commits: `output/` and root `package.json`.
- Browser-wrapper or extension errors that reference injected `vendor.js`, `content.js`, `VM####`, or Grammarly scripts are tracked separately from first-party app errors.

## Session Checklist

- [x] Session 1: Add a tracked master report/checklist and capture baseline risks.
- [x] Session 1: Patch immediate route-level authorization and action-history ownership gaps found during baseline inspection.
- [ ] Session 2: Finish loader/action stability sweeps across all remaining pages and high-risk buttons.
- [ ] Session 3: Deepen auth, authorization, session, OTP, reset, and local-storage security coverage.
- [ ] Session 4: Standardize route validation, upload/CSP/network hardening, and secrets handling.
- [ ] Session 5: Review transactions, optimistic locking, idempotency, indexes, websocket ordering, and sync races.
- [ ] Session 6: Add performance budgets and optimize runtime responsiveness.
- [ ] Session 7: Complete portal dark mode, translation, tag polish, and public/editor wiring checks.
- [ ] Session 8: Complete server-backed undo/redo and action-history integrity for reversible flows.
- [ ] Session 9: Clean duplicate/dead code, dependency hygiene, run/release scripts, and generated references.
- [ ] Session 10: Final threat model, attack surface map, severity-ranked findings, verification, commit, and push.

## Initial Findings

- Action history was scope-filtered but not owner-filtered, so authenticated users could see or update history rows from other users if they guessed scope or id.
- Several system routes had side effects or sensitive path/status output but only required authentication:
  - Drive sync status
  - Drive sync manual sync
  - Folder backup export
  - Data-path read and reset
- The app intentionally allows Google Translate's required script behavior only on public portal routes. This is a compatibility exception, not a pattern for admin/internal pages.
- Current storage/auth design still supports local/session token storage; later sessions must continue minimizing persistent sensitive storage and clearing caches on logout/session invalidation.

## Immediate Fixes Applied

- Action history reads now default to rows created by the signed-in user; privileged users with `settings` or `backup` may request all rows explicitly for audit views.
- Action history status updates now require ownership.
- Action history labels/scopes/entities are length-limited, and payloads are capped to prevent oversized JSON abuse.
- Drive sync status and manual sync now require `backup` or `settings`.
- Folder backup export now requires `backup`.
- Data-path read/reset now require `backup` or `settings`.
- Start/setup scripts no longer attempt global PM2 installation automatically; they use the tracked app runtime and fall back to Node/background mode unless PM2 is already installed.
- Shared API writes now dedupe identical in-flight JSON mutations, ignoring generated request/idempotency keys for the dedupe comparison so double-clicked creates/updates still collapse to one request across product, POS, inventory, backup, settings, profile, upload, and reset surfaces while individual page guards continue to be hardened.

## Session 2 Notes

- Added frontend regression coverage for in-flight write dedupe, including stable JSON body ordering and post-settle cleanup.
- Refreshed Tailscale Funnel mapping to `https://leangcosmetics.crane-qilin.ts.net/ -> http://127.0.0.1:4000`; local health at `http://127.0.0.1:4000/health` passed. This Windows client still closes the HTTPS handshake when requesting the Funnel domain locally, so external-device verification remains open.
- This is a cross-cutting guardrail, not the final Session 2 sweep. Remaining work is to keep tightening individual high-risk actions with explicit busy states, idempotency keys, and loader timeout/retry UX.

## Remaining Reports To Fill

- Threat model and attack surface map.
- Severity-ranked vulnerability list.
- Error matrix by layer.
- Race-condition and edge-condition resilience report.
- Performance bottleneck report and budgets.
- Bad-practice cleanup list and long-term roadmap.
