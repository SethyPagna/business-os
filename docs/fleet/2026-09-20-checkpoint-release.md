# September 20 checkpoint release

## Production provenance

- Worker source: `fdcee3fe685d` (clean tracked tree).
- Cloudflare version: `07362be0-f996-4c89-a5e3-1e551c25b8c6`.
- Deployment completed using existing local project credentials; no secret copied or printed.
- GitHub main and `codex/supplier-settlement-20260918` pushed to fdcee3fe.
- No migrations or production data backfill executed.
- Live signed-in admin dashboard and public storefront rendered in browser after deployment.
- Shell runtime-version request received403; browser API navigation blocked by client. Exact version is deployment-tool provenance, not a successful runtime endpoint read.

## Included

Independent default-off cost view/edit grants for nonadmins; admin defaults retained;
POS cost suppression/USD products/compact controls; immediate permission checks including
Add Products saved drafts; matching Conflicts page-menu icons; date-only range trigger
with internal times retained; external presets for five additional range hosts;
responsive help popovers and concise bilingual contact/import help.

## Verification and qualification

- Frontend full suite490/490, then final Add Products changes verified by all4 session suites plus help browser test.
- Both package typechecks; i18n; built frontend startup and chunk graph267/zero cycles passed.
- Paid and Free dry-run bundles passed. This is not proof that production workloads fit Free quotas.
- Worker final sweep468/469 passed; customer-return cancellation native process exited silently once.
  Two consecutive isolated root reruns subsequently passed after concurrent workload ended.
  The intermittent native process termination remains an infrastructure investigation, not a clean full-sweep claim.
- Independent reviewer caught and verified repair of saved-draft cost visibility in Add Products.
- Build caught a help-helper chunk cycle; helper relocation repaired it without weakening the gate.

## New cost clarification — NOT included in this release

Owner confirmed product Edit cost is an override with history; stock receipts contribute
to the mean, never implicitly override. Distinct positive costs3,5,7 produce5, not5.5;
duplicates and zeros do not contribute additional distinct values.

Prospective candidate in `bos-cost-receipt-20260920` is separate from deployed source.
It changes price-specific receipt identity and catalog mean, keeps historical snapshots,
and has native tests. Independent review caught a batch-date edit identity collision;
follow-up99e45f55 repairs it. Manual product override atomicity and import writer parity
remain under implementation/review. Frontend prospective changes45c7326a/fb8bd685 and
catalog breakdowndf82b1b1 likewise are NOT deployed. Do not integrate/deploy partial groups.

The complete remaining scope is in `2026-09-20-active-request-ledger.md`; this is a
checkpoint, not completion of public P9 work, time-filter API work, cleanup or all audits.
