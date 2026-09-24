# Bloat and legacy review: AI Council verdict (24 Sep 2026)

Process: `docs/AI_COUNCIL_REVIEW.md`. One read-only evidence sweep, recorded in
[2026-09-24-bloat-evidence.md](2026-09-24-bloat-evidence.md) as found on HEAD a29fb3823, then five
simulated perspectives running as separate read-only agents on one model: Skeptic,
First-Principles, Expansionist, Outsider and Executor. They converged, so the
cross-critique was folded into the Chairman's verdict. **These are simulated perspectives,
not independent reviewers.**

## Proof standard
An item counts as dead only if an exact-identifier grep over src, tests, scripts, docs,
the language packs and the migrations finds nothing but its own declaration, AND no
dynamic path reaches it (lazy `import()`, the `@ts-nocheck` `window.api` proxy in
`web-api.ts`/`api/methods.ts`, `new Worker`, service worker, string-built i18n keys).
Raw ts-prune output is a flag, not proof:
- 389 of its 1485 frontend hits are `api/*Transport.ts` exports reached through the proxy.
- 40 Worker hits are consumed by `scripts/test-*.cjs`.

## Done (48fbd6d49)
- **Removed:** DualMoney.tsx; KitGallery.tsx with StatStrip/TileGrid/HubTile (used only by it) and its
  18 `kit_gallery_*` key pairs; `utils/index.ts`; `__lightbox_test_entry.tsx`; `constants.ts`
  STOCK / WRITE_CHANNELS / isNetworkError; `reportsTransport.getBusinessSummary()`, which called a route
  that doesn't exist.
- **Fixed:** the stale fuzzy-fallback comments in portal.ts and searchMatch.ts.
- **Kept:** `components/utils-settings/index.ts`, which is pinned by `utilsSettingsBarrel.test.ts`.

## Open, in order
1. **Correction (history checked): do NOT wire** `SaleIncidentRecovery.tsx` / `utils/saleIncidentRecovery.ts`.
   The council proposed wiring them, but `e64c9d44e` (9 Sep) deliberately replaced them in `ResetData.tsx`
   with `SaleNotPaidStockRecovery`. They are one-off tooling for the 9 Sep sale incident, with dated
   routes `/sale-incident-recovery-20260909[-v2]` in `cloudflare/src/routes/system.ts`. They are legacy
   candidates, removable only with the owner's OK. Keep the `sale_incident_recovery_*` tables and receipts
   as audit evidence (migrations are append-only).
2. **Remove together with their pinned tests:**
   - `CurrentShiftSummary.tsx`, read by `shiftManagement.test.ts:49`;
   - `PageSizeSelect.tsx`, whose source `paginationRangeControl.test.ts` reads;
   - `productReplaceImportPlan.ts` and its test.
3. **Orphan-file guard:** a `test:utils` check that walks the imports from the three entry points
   (with a lazy-import/Worker allowlist) and fails if the set of unreached files grows past a
   pinned baseline. It ratchets down the same way `unusedLocalsBudget` does.
4. **i18n:**
   - Teach verify:i18n the suffix-family pattern (e.g. `perm_section_*_desc`, a false positive today).
   - Then remove confirmed orphan keys in clusters, in both packs.
   - About 890 of the 990 "unreferenced" keys are unclassified search misses, not proof.
5. **Not dead:**
   - `returnsStatementTransport.ts` / `returnsExportWindow.ts` (the annual statement, in progress; feeds the Report Center);
   - the Scanbot WASM (27 MB, used; audit whether it loads only at scan time);
   - `outputs/` (protected by the checkout-cleanup policy).
6. **Later, aspirational:**
   - one export engine through the Report Center;
   - a shared frontend/Worker types package, to end the duck-typed transport contracts.
7. **Docs clarity (Outsider):** progress.md (1.4 MB), CLAUDE_HANDOFF.md, AGENTS.md and the session log
   overlap. A short "start here" order is in the root README; keep state at the top of progress.md.
