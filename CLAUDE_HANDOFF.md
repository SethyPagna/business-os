# Business OS — Claude takeover checkpoint

> **Status update, September 17 (program 10 checkpoint B deployed, 0173–0176 applied).** Code commit fc2c180c is live as Worker a18e26f5-454b-4494-8514-cf9e3aba4e9a (paid configuration); `main` matches the release branch. Applied to production D1: 0173 (21 Not Paid lines / 26 units deducted, allocation 264 synced), 0174 (four leading-zero barcode twins folded), 0175 (catalog cost of 5,915 products recomputed from lots, 1,089 changed), 0176 (two replacement lines given their lot row). Held and not applied by owner ruling: the Sep 2–3 legacy-import deduction. Also live: barcode fold on create/edit/fast stock-in, amendment allocation sync, cost calculation float.

> **Status update, September 16 (program 10 checkpoint A deployed).** Code commit a8a21c75 is live as Worker b846aa95-e7ff-4b42-89a5-7da5ed6f511a (paid configuration), no migrations. Receipts now auto-fit the printer's registered 72 mm forms (new default mode, editable form list, 1 mm side margins), product lines are numbered with an "Items (n)" header, the catalog cost is recomputed as the mean of distinct non-zero costs on every stock-add writer, and the pickers share one option cache. In progress: leading-zero barcode fold on create/edit/stock-in (P10-5); done but not deployed: the cost-price calculation float (P10-6). Public items paused. Details: progress.md top section, the owner task register (September 16 Program 10 section) and session-log Part 619.

> **Status update, September 16 (programs 8 and 9 deployed, 0171/0172 applied).** Code commit f2488996 is live as Worker 23615bfd-aba1-4862-a1a1-01e7b2240cce (paid configuration); `main` now matches the release tip. Applied: 0171 (merge-lineage evidence for the 4 sale items 0165/0168 reparented without it) and 0172 (Employee/Manager roles gain `receipt_settings`). Live: tests for past error classes with three real fixes, a 23-commit debloat, the chunked duplicate-cluster DELETE, page menu no longer covering the avatar button, receipt settings in the page menu for every role, POS names as a true two-line clamp, tagged-stock errors naming their cause, the responsive date row, Products report rows with inline COGS/profit, faster reports (page size 2000, xlsx chunk split), and GET /api/sales degrading instead of 500ing. Not yet by owner decision: the four public-website items. Details: progress.md top section, the owner task register (September 16 Program 8/9 section) and session-log Part 618.

> **Status update, September 16 (program 7 deployed).** Code commit 20be849b is live as Worker fe65bbef-52b3-4bf9-beb5-9a1c24a0cf2a (paid configuration), no migrations. Receipt printing now has four selectable page-size modes in Print Settings → Page length handling (measured roll, fixed length incl. 80×50 and longer, printer default, longest page) with a test-print button, as fallbacks while the owner's physical print is still pending. The unreachable exact-pairs merge review and its transport were removed (−906 lines). Details: progress.md top section, the owner task register (September 16 Program 7 section) and session-log Part 617.

> **Status update, September 15 (program 6 deployed, 0168/0169 applied).** Code commit c596674e is live as Worker 482774b9-2e1c-4109-b87c-b3c7f72289bb (paid configuration). Applied: 0168 (transfer-aware merge of the dior pair 1616 → 7161, products 8477) and 0169 (merged-product name snapshots repaired). The 10 uncosted removal rows are genuinely uncostable (import lots with cost 0) and were not backfilled. Live: searchable pickers everywhere, receipt as one continuous measured strip (awaits a physical print), storefront rail/icons/pager/contact-button fixes plus the add-to-home-screen offer on storefront and admin, dashboard rows aligned with View-more floats, sales last row scrolling, efficiency wave 3. P6-9 shipped in the follow-up checkpoint 7d8e22d7 (Worker fad5bfda-69b8-4a87-97a0-02509b6562ad): the merge write gate was the surface the identity rule had not reached. Details: progress.md top section, the owner task register (September 15 Program 6 section) and session-log Part 616.

> **Status update, September 15 (program 5 deployed, merges applied).** Same-name products (real-barcode / wildcard rule) and same-name+phone customers are merged in production data: migrations 0165, 0166 and 0167 APPLIED (products 10357 → 8478, customers 5039 → 5029, uncosted removal rows 17 → 10). Code commit 6bd39bd9 is live as Worker e8f0a886-3b48-4d31-9ef0-d907e439b89b (paid configuration); branch tip f1202597 carries the 0165 CPU-budget rewrite after the first apply failed with D1 error 7429. Identity rule, removal-loss consistency, one-row date range, regression packs and the D1/R2/KV debloat are live. Open: the dior 1616/7161 transfer-evidenced pair; the 10 uncosted removal rows need owner-entered costs. Details: progress.md top section, the owner task register (September 15 Program 5 section) and session-log Part 615.

> **Status update, September 15 (program 4 deployed).** Same-name suppliers merge directly on every writer, damaged returns follow the remove-stock tag rule, and performance wave 1 (single-round-trip audit, Smart Placement, cache-first PWA shell, memoized POS) are live: commit 38a3eb5e as Worker dfef9f7b-76e8-4868-bff1-d1916cd8c48e (paid configuration). Migrations 0162, 0163 and 0164 are APPLIED to production D1 (owner delegated migrations and merges to the coordinator). Open items: progress.md top section (Program 4 wave 2), the owner task register (September 15 Program 4 section) and session-log Part 614.

> **Status update, September 15 (program 3 deployed).** Supplier mirror, stock-action reasons, tagged damaged rows, removal losses in every report, supplier/invoice floats, no automatic storefront notice, and employee-editable shifts are live: commit 2e016e08 as Worker 410bc7d2-2807-4974-b52e-300e91b0dca6 (paid configuration). Migrations 0162 and 0163 are prepared and not applied. Open items and owner rulings: progress.md top section, the owner task register (September 15 section) and session-log Part 613.

> **Status update, September 14 (program 2 deployed).** iOS PWA hardening, one-tap scanner, the Playwright suite and the free/paid plan split are live: commit 4b20bd68 as Worker d972a943-659e-4210-a1c9-58afc7436c0f (paid configuration). Free variant exists (`wrangler.free.toml`, `npm run deploy:free`) and is not deployed. Open items and owner rulings: progress.md top section and the owner task register.

> **Status update, September 14 (Claude takeover complete).** The checkpoint below was taken over, integrated, certified and **deployed**: commit 139fcbf8 is live as Worker f5b89429-6109-4627-87ff-a868292e4225 and migrations 01580161 are applied to production D1. Current provenance and the per-item ledger live in progress.md (top entry) and docs/history/session-log.md Part 611; the register is docs/fleet/2026-09-07-owner-task-register.md. Everything under this line is the pre-takeover picture and is kept for provenance only.

Prepared September 14, 2026. The user reported only 8% Codex allowance remaining and is considering Claude takeover. New work and expensive checks have stopped. **Do not interpret this checkpoint as a verified release. Nothing from this precision effort has been deployed or migrated remotely.**

## Start here

- Worktree: `C:/Users/mrkl6/Downloads/bos-precision-final-candidate-20260914`
- Branch: `codex/precision-final-candidate-20260914`
- Clean implementation checkpoint before this handoff document: `0972fc2e11f3ca2b558ddf3b20584e8f04e9233d`.
- It contains integrated candidate `fb862f1ffcbb90a354b03d376334f1ff2a7a4ae9` plus backend test-maintenance source `98ab9b325584c00bc9b7379cecc1c87b8f6d5366` (cherry-pick becomes `0972fc2e`).
- No running processes remain in this final-candidate worktree. Its integration claim was released.
- Frontend and Worker dependencies were installed here. Installation reported five Worker dependency audit findings (one moderate, four high); these have not been triaged or fixed. Do not blindly upgrade during reconciliation.
- Read `AGENTS.md`, `progress.md`, `agent-team/TEAMWORK.md`, and the repository orchestration skill. `progress.md` contains older deployment paragraphs; do not treat its top entry as current production provenance.
- **Preserve the dirty shared repository** at `C:/Users/mrkl6/Downloads/business-os-v1`. Never reset, clean, stage all, or copy its working files over this candidate.

## Immediate next work: integrate the remaining completed slices

The following are NOT yet in this final candidate. They must be reconciled before the next full gate. Use exact commits/path ownership, inspect conflicts, and preserve root test-loader repairs. Do not merge entire author branches: several contain temporary or duplicate dependency commits.

1. Frontend gate maintenance: `24d68e9ee318dd075dfc2a0a3ec6526757ac5648`.
   - Twelve test files plus six Khmer glossary corrections; no financial runtime changes.
   - Its fresh full frontend gate passed 412/412 at its own pin.
2. Historical-sale backend, in order:
   - `d3391594`, `3c19e5fd`, `c03a38cd`, `43ea8f26`, `a0b09cbb`, `81f8515c`, `95c55042`, `b441d77d`, `46bbce57093ce63fd73e8d439e9611ed03722e90`.
   - Source: `C:/Users/mrkl6/Downloads/bos-historical-sale-edit-20260913`.
   - This includes append-only migration 0161, guarded editing of historical sales, exact header arithmetic, saved-rate settlement for edited historical sales, and native D1 expression-depth repairs.
   - Independent repaired-subset certification at `46bbce57`: original subtotal and fractional undo/redo audit repros pass; native D1 guards and unchanged legacy payment/retry pass. This is not whole-release certification.
3. Edited-historical-sale report reader: **only** `cc8b1e8d`.
   - Source: `C:/Users/mrkl6/Downloads/bos-report-edited-v0-precision-20260913`.
   - Exclude its temporary validator dependency `50f89ebc`; real prerequisite `c03a38cd` is above.
   - Focused reader/visibility tests passed. Fresh composed typecheck and independent integration review remain required.
4. Historical-sale frontend, in order:
   - `be38a3de`, `751a9c21`, `9c506187`, `730c64f2`, `a4654f55`.
   - Source: `C:/Users/mrkl6/Downloads/bos-historical-sale-ui-20260913`.
   - Exclude local backend dependency copies and generated `frontend/public/*.js` changes.
   - Final author gate passed **415/415**, i18n **5792**, build **261 chunks / zero cycles**. Independent review found sub-cent negative-zero display; the last two commits address that with direction labels and exact detail audit text. The final presentation follow-up still needs independent composed verification.
5. Root-owned locale commits: `f735d119`, `5a6288b8`.
   - Source: `C:/Users/mrkl6/Downloads/bos-precision-mobile-20260913`.
   - If Khmer-tail context conflicts, retain the approved glossary correction `បាកូដ` from `24d68e9e`, and add only the new keys. Do not restore the older `បារកូដ` text.

Run focused historical, header, report, return and frontend tests before the broad gates. Remaining previously failing payment-FX/delivery-add tests must keep successful historical operations working; never turn their expected success into a refusal just to get green. Some obsolete source-lock assertions need owner-equivalent test maintenance after the runtime lane is integrated.

## Already present in fb862 / this candidate

- Exact rational money kernels: internal nearest four decimals; selling-price ceiling to cents including exact KHR conversion before ceiling.
- Sale item pricing snapshots and captured promotion pools; immutable pricing JSON; exact line totals and allocations.
- Exact reviewed header quotes, frozen request recovery, permission and cache isolation fixes.
- Customer return creation with net entitlement snapshots, cumulative refund remainder accounting, guarded bulk cancel/restore/undo/redo, and frontend creation/retry flow.
- Product-merge lineage bound to exact sale-item IDs through retained server-owned undo snapshots. Original pricing JSON is not rewritten; lineage is guarded inside financial transactions.
- Exact report readers, report permissions, and v1 refund merchandise/tax reversal.
- Merge UX changes: explicit cost/selling labels; leading-zero action routes through existing durable group review; automatic bounded continuation; edit collisions preserve drafts and offer identity review.
- Shared UI/mobile changes from earlier scoped work. Do not assume every older UI request is complete merely because these exist.

Detailed original integration manifest:
`outputs/precision-integration-20260913/reconciliation.md`.
The first integration accidentally omitted return frontend. That was corrected in `fb862`; see `outputs/precision-integration-20260913/return-frontend-followup.md`. Preserve it.

## User decisions / invariants

- Internal arithmetic: normal nearest **four decimal places**, midpoint away from zero.
- Selling prices: round upward to cents by default; exact division before ceiling for converted KHR prices.
- Ordinary receipt/sales amounts: two decimals. Exact calculated amount and adjustment may appear in detail/Records audit at four decimals.
- A nonzero sub-cent receipt adjustment must not misleadingly print `-0.00`: use “Rounding down/up” and `< $0.01`; retain exact evidence internally and in detail audit.
- Settlement adjustment is explicit: payable cents minus calculated four-decimal total. Do not leave hidden balances or add adjustment twice to profit/collected cash.
- New/current captured sales use saved sale FX. Actual tender denominations and actual recorded change remain separate facts.
- Original promotion rules and pricing sources are captured; quantity changes reevaluate the original pool, not today's catalogue rules. A wholesale display tag alone must not change price/source.
- Historical sales with unknown original promotion snapshots must remain editable using recorded operands, without fabricating promotion history. Saved header subtotal plus the complete changed-line expression preserves historical residuals. Round the complete expression once, not an intermediate delta.
- Untouched historical amounts, NULL costs, pricing JSON, audit records and revisions must not be rewritten.
- Explicit unknown target-line total fallback requires review; untouched NULL siblings must not be synthesized as zero or repriced by a fee edit.
- Product merges: numeric leading-zero-only equivalence; mean of **distinct positive costs**, excluding zero, nearest four decimals; maximum selling/wholesale values. Do not replace a known nonzero cost with zero.
- Empty/text barcodes require evidence-backed matching to the correct product, not name-only guesses. Different genuine products/barcodes must not be silently merged.
- Existing bounded batch sizes are safety budgets, not a twelve-group overall cap. Continue safely through the existing audited review workflow.
- Set Quantity: offer selected received-date lot or branch total; selected lot is the default.

## Migration authority — approved, but not executed

User explicitly approved, **after verification**, no historical backfill:

- 0158: sales/returns calculated amount, rounding adjustment and precision version.
- 0159: nullable per-sale-item pricing/discount snapshot.
- 0160: nullable per-return-item consumed entitlement snapshot.
- 0161: allow calculated-total/rounding metadata on an older sale **only when it is edited**, while original missing promotion snapshots remain unknown. User's exact answer: “Yes—after verification, only when a sale is edited”.

Use append-only migrations. Never alter previously committed/applied migrations. Validate strict equations and default untouched historical NULL/zero semantics. Verify recovery/backup and pre/post assertions before any remote application.

## Verification history: do not erase failed evidence

- Original integrated backend `b0688bda`: **385 runs, 331 passed, 54 failed**. This is NOT a passing gate.
- Failures: forty dependency-loader gaps, one lazy empty-stub issue, ten stale fixture/contract/source cases, three native process crashes.
- Test-maintenance `98ab9b32` preserves production source and repairs fifty test files. Its non-blocked focused cases passed; historical runtime and native guard-depth blockers require the pending runtime chain above.
- Native D1 exposed a real depth-100 SQL bug in long source/header/undo comparisons. Repairs use balanced boolean trees with all original comparisons preserved; do not omit fields or increase limits.
- Native Windows Node process intermittently exits `0xC0000409` during ordinary seed writes, before teardown. Same cases also pass unchanged; image-reference control reproduced it. No proven root cause or justified retry workaround. Preserve these failures, do not silently retry into green.
- Three minimal native D1 runs passed; upgrading Node was not proven to fix the crash. Debugger/dump attribution or another host may be needed if it recurs.
- Full backend evidence and diagnostic logs:
  `C:/Users/mrkl6/Downloads/business-os-v1/.git/agent-team/results/backend-sweep-b0688bda-hCtl4V/`.
- Historical repaired independent evidence:
  `C:/Users/mrkl6/Downloads/business-os-v1/.git/agent-team/results/historical-b441-CZ46hG/result.json`.
- Independent real merge/fold tests preserved tested revenue, captured cost, quantity, stock and allocation counts, moved ranking to keeper, rejected forged lineage and rolled back proof races. These tests are local Hono/SQLite, not comprehensive live-data certification.

Broad gates after final integration:

```powershell
Push-Location frontend
npm run typecheck
npm run verify:i18n
npm run test:utils
npm run build
Pop-Location
Push-Location cloudflare
npm run typecheck
# Run all scripts/test-*.cjs sequentially with complete logged outcomes,
# credential-stripped local fixtures, plus the two explicit F57_NATIVE_D1 variants.
Pop-Location
```

Do not use `run/full-automation.bat` as verification. Distinguish actual mounted browser workflows from extracted callbacks/SSR. Final composed mobile/browser and daily-use workflow coverage remains incomplete.

## Known unfinished scope — do not claim “all done”

- No final fully integrated gate, remote migration, deployment, live merge execution or postflight reconciliation.
- V1 return PATCH/edit remains explicitly disabled. This must be addressed or transparently presented as unfinished; creation and bulk lifecycle are not edit certification.
- A source-inferred return sequence gap after cancellation of an earlier partial return was reported; reproduce and resolve rather than forgetting it.
- Whole-catalog bulk cost changes, supplier-return cost provenance, and bulk deletion still have previously audited precision/atomicity gaps. The older issue ledger lists them; do not declare application-wide four-decimal correctness from sale-only checks.
- Physical XP-K200L 80mm long-receipt scaling remains unverified. Do not claim control over a browser/printer driver's fixed 98×148mm media fitting.
- The larger UI/backlog and requested customer/product data repairs need requirement-by-requirement evidence, not blanket closure.
- Original gender restoration: 4,162 matched records restored in earlier work; unresolved records were not guessed. Product merge execution in this effort has not occurred.

Issue ledger (has chronological, superseded entries):
`C:/Users/mrkl6/Downloads/bos-precision-mobile-20260913/docs/fleet/2026-09-13-precision-mobile.md`.
Earlier ledger:
`C:/Users/mrkl6/Downloads/bos-account-cache-sale-flash-20260912/docs/fleet/2026-09-12-account-cache-flash.md`.
Latest pasted duplicate evidence:
`C:/Users/mrkl6/.codex/attachments/f86ac427-2e9a-419d-ab6b-63cd8f45d722/pasted-text.txt` (very large; parse, do not dump).

## Production preflight facts — read-only, must refresh

- Last checked deployed Worker: `962c5431-5c8e-43e4-b1dc-68874ce022e9`, September 12, 2026 19:33:47 UTC, 100%.
- Last earlier verified runtime revision: `4f903685244b`, hash `9c0bbbd6459b74ca`.
- Read-only remote migration list before 0161 existed showed 0158/0159/0160 pending; 0157 was already applied. No migration was applied during this effort.
- Read-only counts: 10,357 products, 8,082 active products, 36,579 sale items, 5 return items. These are a point-in-time census, not a merge allowlist or proof of no orphans.
- Use an authenticated current review/manifest and recovery record before authorized merges. Reconcile every affected reference, stock total, history/undo link, report total and ranking afterwards. Preserve ambiguity guards and stock-session blockers.
- Wrangler OAuth in isolated trees hit a bot challenge. Existing configured auth wrapper in shared repo worked with an explicit candidate config path; never print/read secret values into logs.
- Configuration: `cloudflare/wrangler.toml`; Worker `business-os`, operational D1 `business-os`.
- Deployment entrypoint is `cloudflare/scripts/deploy.cjs`, which stamps exact provenance. Read it and current Cloudflare guidance before use. Do not run `deploy:full`: it also applies migrations and syncs secrets.
- User authorized deployment and reviewed data merges, but **only after verification**. This is not authority to bypass safeguards, fabricate matches, mutate all historical amounts, or erase pending unknown requests.

## Suggested first message / working sequence

Tell the user you have read this handoff and are verifying its checkpoints, not starting over. Finish exact pending integration, independently test the final candidate, then repair remaining real blockers. Maintain a concise requirement/status ledger. Only deploy a verifiably correct checkpoint with explicit provenance and safe migration recovery; never describe pending source work as live.

The Codex goal is still active because it is genuinely unfinished. The user should pause that goal in Codex if Claude takes over, to avoid competing automatic continuations and duplicated usage. Do not set it complete merely to stop activity.
