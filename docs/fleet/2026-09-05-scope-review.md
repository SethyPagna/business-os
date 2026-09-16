# Scope and consistency reread — 2026-09-05

Request: reread completed work and verify scope, consistency, responsive bounds,
compactness and clarity. Reviewed objective text and 14 reference screenshots;
prior assistant narrative inside the objective was treated as context, not proof.
Baseline: integration `d9525d26b4235333d974ec0e4bdccf12c705e29c`.
Dirty original main remains preserved. No production operation was performed.

## Findings and disposition

| Finding | Disposition |
|---|---|
| Mobile menu still enters a separate hub then section, with `pushLayer3State` | Open: HubSectionNav and Sidebar need coordinated navigation/header implementation and back-history tests |
| Mobile header retains brand while section back/title sits separately | Open; original screenshot interaction is not yet satisfied |
| Report endpoint spans could paint outside their allocated width | Fixed: equal min-width-zero grid endpoints wrap date/time; sampled at 320 and 375px |
| History form hardcoded English and guarded only reason edits | Fixed: EN/KM labels and full-draft dirty comparison; cash edit before reason triggers discard guard |
| Async history or save could restore an older selected user/shift | Fixed request generations; loading/error disables all form fields; committed write is acknowledged separately from history-refresh failure |
| Explicit branch publish populated null-branch cache | Removed alias; scope change hides the old row before effects; same-key subscription retained |
| Restricted browser storage could crash current summary | Storage lookup guarded; server summary remains authoritative |
| Unfinished transaction attribution changed checkout semantics | Shelved whole draft, recoverable under evidence; no new migration or checkout gate retained |

Attribution draft hazards independently confirmed: post-close checkout rejection,
ISO-versus-SQLite offline timestamp comparison, product-filter/cart branch mismatch,
later fee assigned to an old sale's shift, absent lower time bound, and reports
still using a different window-based ownership model. The architect recommended
keeping lifecycle events separately; the lead deferred them too because the old
backup restore path can preserve restricting child rows, and event UI was not
finished. This disagreement/disposition is explicit; no useful draft was discarded.

## Verification and limits

- `node tests/shiftManagement.test.ts`: 39 source-contract checks passed.
- `node tests/shiftGate.test.ts`: 47 checks passed.
- Frontend and Worker `npm run typecheck`: passed.
- `npm run verify:i18n`: 4,863 matching/resolved pack keys passed.
- Frontend `npm run build`: passed; existing circular-chunk and size warnings remain.
- Worker shift-security regression passed; shift-close-report 20 checks passed.
- Playwright local fixture imports the real date picker, history panel, shared
  modal and CSS. Sample data only; no authenticated or production data claim.
  EN/KM samples at 320/375px, native amendment fields and a cash-only unsaved-edit
  dismissal checked. At 320px page width was 320 and every sampled input's
  client/scroll widths were 244/244; at 375px page width was 375.
- Artifacts and reproducible local fixture: `frontend/output/playwright/`.
  The fixture is not a production entry point. Browser-native datetime display
  follows browser locale; summary dates use shared application formatting.
- Independent product_designer review and business_os_architect review informed
  the changes. Contracts are not runtime race tests; authenticated end-to-end
  permission, branch, offline, financial and broad responsive matrix remain open.

## Remaining acceptance scope

1. Main mobile groups expand inline, then enter content directly; no intermediate
   hub navigation layer. Back/title replaces brand while utility actions remain;
   old navigation is a settings option. Verify history, reload and nested modals.
2. Authenticated app matrix: 320/375/tablet/desktop, EN/KM, light/dark, long names,
   empty/loading/error states, permission tiers and branch switching. This local
   fixture is deliberately not a replacement for that matrix.
3. End-to-end financial reconciliation across dashboard, reports, exports and
   Telegram for identical branch/date/status filters, beyond earlier test results.
4. Historical production settlement: authorized fresh preflight and owner ruling
   on the two partial payments before any stock-safe repair. No remote commands,
   secret sync, migration, deploy or data mutation were performed in this pass.

The original overhaul is not fully certified. Earlier completion labels are
corrected rather than used as evidence that these remaining requirements passed.
