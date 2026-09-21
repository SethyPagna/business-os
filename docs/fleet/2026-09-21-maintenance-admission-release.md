# Maintenance and restore admission release

## Production provenance

- Source: `85a3e7525ef2b1f12e12d98a7c1619accdc1be9c` (clean tracked tree).
- Paid Worker version: `0bdfffc5-b4a9-48a6-9db3-3c0958979f1b`.
- Worker hash: `fe29238f46ffdbe2`; built `2026-09-21T00:23:40.166Z`.
- Deployment handle 95421, terminal exit 0. Startup reported 14 ms.
- Frontend unchanged: `a1ed5ca3bad6`, hash `23cc431e6e86d05e`, built
  `2026-09-20T18:59:38.390Z`. Wrangler reported no updated assets to upload.
- No remote migration, secret synchronization or business-data mutation performed.

## Scope and evidence

Includes maintenance CAS ownership/release (`efcfa855`) and fail-closed restore
import admission (`2c6a1e38`). No UI or accounting rule change.

- Root dab734 exit 0: eleven actual Hono route cases, eleven maintenance checks,
  Worker typecheck. Independent admission review `4d6ecef8` PASS.
- Root 6d8e83 exit 0: native concurrent acquisition/stale progress/release races,
  twelve corrupt states, plus all 52 plan-tier/config/queue/surface checks.
- Dry-run handle 60156 exit 0: Paid and Free bundles at source 85a3e752.
  Packaging success is not production-scale Free-capacity certification.
- Prior independent maintenance review `1a391746` verified exact integrated files.

## Live smoke

Separate Chrome tab 460569656 opened authenticated Returns and rendered Today
21/09/2026 with the expected navigation, date presets, search and empty daily list.
A normal reload briefly showed Opening workspace, then rendered Returns again.
No storage clearing, user POS reload, record creation, restore or maintenance clear
was performed. User POS tab 460569495 was left untouched.

This proves this observed page load and warm reload, not every account/device or
service-worker update cycle. Runtime metadata readback was not tested this release;
the earlier client-blocked metadata path was not bypassed. Deployment provenance
comes from the completed stamped Wrangler deployment.

## Open work

Journal 0190 remains isolated under implementation/review. Transfer foundation is
source-only reviewed; 0188 cannot be applied until lifecycle and permanent evidence
preservation are complete. Full restore/reset transaction fencing, phased recovery,
actual transfer/export integration, and the wider requirement ledger remain open.
