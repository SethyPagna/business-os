## September 16 Program 10 checkpoint A LIVE

| Item | State | Evidence |
| --- | --- | --- |
| P10-1 Receipt auto-fits the printer's registered forms (72 × 210/297/400/800 mm), no manual pick | **Deployed** (Worker b846aa95-e7ff-4b42-89a5-7da5ed6f511a, commit a8a21c75); physical print still owner-side | 436a7526, 69d32bcd, 53330045, ab9fb82a; new default mode driver-forms. |
| P10-2 Numbered products + "Items (n)" header on receipt and Telegram summary | **Deployed** | 3ca66bae, c8a6512f; receiptItemNumbering.test.ts. |
| P10-3 No left/right margins on the strip | **Deployed** | 436a7526 (≤1 mm side margins in driver-forms mode). |
| P10-4 Cost = mean of distinct non-zero costs on every add/receive/session writer | **Deployed** | a5a2169f, 8a2499f2; test-catalog-cost-recompute-native.cjs. Remove/set/transfer/returns record no cost (N/A). |
| P10-5 Leading-zero barcode fold on create / edit / stock-in create (no prompt) | **In progress** | sweep verdict: products.ts create/edit 409, stockSession create_receive 409; lane p10/barcode-fold running. |
| P10-6 Cost price click opens the calculation float | **Done**, not deployed | 790c68f9, 6237aafd; ships with P10-5. |
| P9-12 Slow loading wave 2 | **Deployed** (partial) | 54d2f33a + cd2eff8c picker cache; list routes measured clean; Reports render pass open. |

---

## September 16 Program 8/9 checkpoint LIVE

| Item | State | Evidence |
| --- | --- | --- |
| P8-0 Push to GitHub incl. main; archive local branches | **Done** | `main` merged up to the release tip at this checkpoint (7d1b2b28); 552 refs archived on Sep 16. |
| P8-1 Tests for past fixes, errors and guards | **Deployed** (Worker 23615bfd-aba1-4862-a1a1-01e7b2240cce, commit f2488996) | 77b30a5f..20136e81; real fixes 5be431be (R2 edge-cache purge), 61105bcb (portal rail degrade), a835f548 (import barcode fold). |
| P8-2 Debloat across the full codebase | **Deployed** | 36a1183f..2e7a978b, −1338/+138; reverts 65ee5141, 81c5d508; report items in progress.md. |
| P8-3 Optimization / efficiency | **Deployed** (wave 1) | 257247bd (chunked DELETE); wave 2 open with P9-12. |
| P9-1 Small-screen avatar button covered by the page menu | **Deployed** | 5b218d69; `navChrome.test.ts`. |
| P9-2 Receipt settings in the page menu and for employees | **Deployed**; 0172 **applied** | 873d2eea, 7634d4cd, 3189ac3b; roles manager/employee now `receipt_settings: true`. |
| P9-7 POS product name with large spaces per word | **Deployed** | 6aab43b5 (two-line clamp). |
| P9-8 One-line names leave a blank row; title on click | **Deployed** | 6aab43b5; `isClipped()` vertical detection. |
| P9-9 "err can't show tagged stock" | **In progress** | Not reproducible on production data; 4d6528b3 surfaces the real status; native check 0/1/150 ids. |
| P9-10 Date start/end not responsive in the button row | **Deployed** | 4e7ebcde, 020a0cb4; `dateRangeTriggerResponsive.test.ts`, real-browser 320/360/390. |
| P9-11 Products report rows show COGS and profit, compact two-column card | **Deployed** | 5ac138b3; `reportsProductsRowsInline.test.ts`. |
| P9-12 Reports and pages load slowly | **Deployed** (wave 1) | a8d1669c (page size 2000), bd737177 (xlsx chunk). Wave 2: contacts/sales list routes, picker caching — not yet. |
| P9-13 GET /api/sales 500 (Sentry BUSINESS-OS-1F) | **Deployed**; 0171 **applied** | 6c80bb1e, 49b70806, f8d5e964; 4 items → 0 without evidence. |
| P9-3 Policies "how long we keep it" wording | **Not yet** (owner: pushed back) | standing rule saved. |
| P9-4 Public assistant chat box first | **Not yet** (owner: pushed back) | 1 commit on stopped lane, unmerged. |
| P9-5 Front page featured / trending / best sellers | **Not yet** (owner: pushed back) | stopped lane, unmerged. |
| P9-6 Customer forgot-password / OTP (Telegram, email, Gmail) | **Not yet** (owner: pushed back) | stopped lane, unmerged (its draft 0170 file is not the applied 0171/0172). |

---

## September 16 Program 7 checkpoint LIVE

| Item | State | Evidence |
| --- | --- | --- |
| P7-1 Receipt page-size fallback modes (measured roll / fixed length incl. 80×50 and longer / printer default / longest page) selectable in Print Settings with a test print | **Deployed** (Worker fe65bbef-52b3-4bf9-beb5-9a1c24a0cf2a, commit 20be849b); physical print still owner-side | c7ebbf41, 464bff0a, b1b2f7e5 (lane tip after trailer rewrite b35a3c73); `receiptPrintPagination.test.ts` per-mode `@page` pins; `test-receipt-page-size-mode-settings.cjs` parity. |
| P7-2 Debloat: unreachable exact-pairs merge review + dead transport/helpers removed | **Deployed** | ff75e5cd, 068920c4, 3c972cdb, 7d3fef34 (−906 lines net); remaining candidates listed in progress.md. |

---

## September 15 Program 6 checkpoint LIVE

| Item | State | Evidence |
| --- | --- | --- |
| P6-1 Transfer-aware merge (dior 1616/7161) in data and on the live merge route | **Deployed** (Worker 482774b9-2e1c-4109-b87c-b3c7f72289bb, commit c596674e) and **applied** (migration 0168) | a49cc4c3, 6ee54feb; products 8478 → 8477, `product_merge_map_0168` 1, transfer member 7/0 = 7161/7161. |
| P6-1b The 10 uncosted removal rows ("you can do so") | **Done** — verdict: genuinely uncostable, no backfill written | Synthetic import lots 2026-08-29, unit cost 0, product cost 0, no costed twin; brand averages deliberately not applied. Supersedes the "owner enters costs" wording in the Program 5 section. |
| P6-2 Everything linked after merges (batches, suppliers, category, brand, sales, invoices, reports) | **Deployed** and **applied** (migration 0169) | Sweep: 0 loser refs in 27 + 5 id columns; stale name snapshots repaired (sale_items 135 → 0, movements 56 → 0); 72d4ea09/920e27b2, 3c6a4c1e. |
| P6-3 Searchable pickers everywhere (province/district/subdistrict; supplier, brand, category, product name, unit, barcode) | **Deployed** | 44b56265, fdd83485, 2f0b7209, 6680de19, 83ce8eb6, 86bd7f0a; `searchablePickersP6.test.ts`. |
| P6-4 Efficiency 3 (inventory list, stock-in sessions, dashboard internals, queue consumers, index-vs-query cross-reference, reports linkage) | **Deployed** | 5e97329d, b93505f7, 3c6a4c1e, e8730f77, b425b7fa, d0939aa5; 16/16 hot queries indexed, no 0170. |
| P6-5 Receipt print: no top band, one continuous 80 mm strip, 20+ items on one page | **Deployed** (not physically printed) | 6c3c8869 + 0e3a31c3; `receiptPrintPagination.test.ts`. |
| P6-6 Storefront: rail, social icons one row, contact button minimize, pager order + count row, hint removed, install prompt (storefront + admin) | **Deployed** | 87dbb1cc, a9567778, b692d02b, feee8ad2, 07b7f964, 4eea45aa, 553b8b67; `publicStorefrontPhoneFixesSep15.test.ts`. |
| P6-7 Dashboard card rows end on one line; View-more float | **Deployed** | 7e88d576, a26d9ecf; `dashboardCardRowsP6.test.ts`. |
| P6-8 Sales last row scrolls horizontally | **Deployed** | 979c5609. |
| P6-9 Conflict actions auto-resolution with before/after (contacts + products) | **Deployed** (Worker fad5bfda-69b8-4a87-97a0-02509b6562ad, commit 7d8e22d7) | 2ab355a5 (merge write gate wildcard-aware; real-vs-real still blocks), 67c26239 (duplicate review button removed); contacts path had no gate. |
| Migrations 0168, 0169 on production D1 | **Applied** by the coordinator | PRE/POST in the session ledger; bookmark 00001666-00000000-000050e7-e79a8764b52b722d6a1c17bfe4ae5075. |

---

## September 15 Program 5 checkpoint LIVE

| Item | State | Evidence |
| --- | --- | --- |
| P5-1 Same-name product merge done in production data by the coordinator (real-barcode / wildcard rule, cost = mean of distinct non-zero costs, damage tag and different real barcodes stay separate) | **Deployed** (code, Worker e8f0a886-3b48-4d31-9ef0-d907e439b89b, commit 6bd39bd9) and **applied** (migration 0165 on production D1) | 1879 losers → 1855 keepers, products 10357 → 8478, map + 1879 audit rows, no references to losers, stock qty unchanged 24302. First apply failed with D1 error 7429; rewrite f1202597 (93 s → 3.6 s on the replica) applied at the second attempt. Known exception: "dior addict lip glow new 075" ids 1616/7161 (transfer-evidenced). |
| P5-1 Same-name + same-phone customer merge | **Applied** (migration 0166) | 10 losers → 9 keepers, customers 5039 → 5029, `customer_merge_map_0166`, 10 audit rows. |
| P5-1 Supplier duplicates | **Done earlier** (Program 4: migration 0164 + auto-resolve on every writer) | See the Program 4 section. |
| P5-2 Start/End date range on ONE compact row (date + time never wrap) | **Deployed** | cbcd73d1; `frontend/tests/dateRangeTriggerOneRow.test.ts`. |
| P5-3 Removal-loss consistency (removed = loss; restocked as damaged/tagged = not; returns consistent) and the "removed row with no cost" report | **Deployed**; backfill 0167 **applied** | fddadf7e, 6c04b546, 1699898e, d29e792c; uncosted rows 17 → 10. The 10 left (Girlactik ×9, Morphe ×1, imported 2026-08-29 with cost 0) are truly uncosted; resolved under P6-1b (Program 6 section): no reachable cost anywhere, no backfill written. |
| P5-3 Regression tests so the same classes never need re-asking | **Deployed** | e5469fe4, 11fc1c39, 324e4abd, 15b8d2ea, 6f61c5fe (`npm run test:regression` in both packages). |
| P5-4 Debloat D1 round trips, R2, KV, Cloudflare requests | **Deployed** | 2945c5e5, 6bd84b02, 6a711f09, 0b460821, 521312ab, 3e0cc4a3, 0aaf15a9, b8d9a63d; plus P4-4b (24d824de … 4620d90c) and the one-request fast stock-in commit (f4711391, d7d6b545). |
| P4-4 wave 2 leftovers (`contacts.ts:557` three-namespace bump, catalog/portal list paths) | **Deployed** (Program 6 checkpoint c596674e) | b425b7fa (contacts.ts batch bump at both merge writers; portal catalog/search fan-out). |

## September 15 Program 4 checkpoint LIVE

| Item | State | Evidence |
| --- | --- | --- |
| P4-1 "Failed to load tagged stock" on iOS PWA | **Deployed** — migrations 0162 + 0163 applied to production D1 | Live tagged-lot SELECT succeeds; pre/post assertions in the session ledger. |
| P4-2 Same-name supplier resolves to the existing record on every writer; existing clusters merged | **Deployed** (Worker dfef9f7b-76e8-4868-bff1-d1916cd8c48e, commit 38a3eb5e); **migration 0164 applied** | aa3ab4b5, 2f94d4c4, 8c2d903c, 87a6ba18, 7db5f8fc; ids 38–46→20, 33–37→23, 14 audit rows, neighbours 24–32 untouched; `verify-0164-supplier-clusters.cjs` 10/10. |
| P4-3 Damaged returns share the remove-stock keep-tag / remove-entirely rule (prospective only) | **Deployed** | 7e0f8c38, 3c38eddf, 9f420b7b, ec4dd2ca; `test-returns-batch-restock-pure` pins the prospective boundary. |
| P4-4 System slowness ("is it free vs paid?") — wave 1 | **Deployed** | Paid plan live; cause = sequential cross-region D1 round trips. Worker e18f46ed…66cffaed, frontend a1850912…a2f61dca. |
| P4-4 wave 2 (remaining N+1 and sequential paths, listed in progress.md) | **Deployed** (P4-4b, Program 5 checkpoint 6bd39bd9); leftovers listed in the Program 5 section | 24d824de, 9cbe1697, db7e371a, 19935961, f4a1800d, b8dc8b7b, 36d94375, bbaa1cd6, be6d3aea, 4620d90c, f4711391, d7d6b545. |
| Migrations 0162, 0163, 0164 on production D1 | **Applied** by the coordinator (owner delegated: "for migrations and merge, i want you to do it for me") | `wrangler d1 migrations apply business-os --remote`, pre/post assertions recorded. Supersedes the "owner action" rows in the Program 3 section. |

## September 15 Program 3 checkpoint LIVE

| Item | State | Evidence |
| --- | --- | --- |
| P3-1 Stock-in edits and reverts mirror into the supplier record | **Deployed** — Worker 410bc7d2-2807-4974-b52e-300e91b0dca6, commit 2e016e08 | d3f8f06c, e3bf6fbf, ac11bf99, 344d5d97, c0a16cce; `test-supplier-mirror-writers-pure` 13/13. Backfill of the four pre-fix reverts = migration 0163, **applied** September 15 (Program 4 section). |
| P3-2 / P3-12 Supplier and invoice navigation as floats; invoice row click opens the detail float | **Deployed** | fd8554d5, 1613d109, 763ada95. |
| P3-3 Broken/damaged tagged child rows: keep-in-group vs remove entirely, Restock with tag, loss at cost, English tag in Khmer, one-row controls | **Deployed**; migration 0162 (condition-tag columns) **applied** September 15 | 4a5b71bc…9d4eb1bd; `test-stock-condition-tag-pure` 18; `stockConditionTag.test.ts`. Until 0162 is applied the tagged-row actions refuse with the schema error rather than writing. |
| P3-4 Promotion links open the product, no shareable URL; promotion name on receipt/detail/Telegram capped at 40 | **Deployed** | 5235e571, 880f88c1, c0e7f469, bb80d391, 04c42aa0, b4d05aae, 072fb70c, 7615d068. |
| P3-5 Reasons on add/remove/set, per-product reveal on click | **Deployed** | bd058a39…e255028e; one 512-character cap on all four wires (`test-reason-length-cap-pure`). Stock-in receipt reason optional with the server label (default taken). |
| P3-6 "Not Yet Paid" wording on the supplier side | **Deployed** | 0bb4ae9b, 3db96d42, 18b5dec7. |
| P3-7 No automatic storefront notice | **Deployed** | 9673152d, e428de82, 9632605c, d76058ac, bfb94704; policy 05ab5efc. Legal name, registration and email still to be filled in the portal editor by the owner. |
| P3-8 Supplier surfaces over all past stock changes | **Deployed** for receipts, reverts and undo/redo; multi-lot FIFO drain (E3) **not yet** | P3-1 writers; invoice report and purchases float share the zeroed-lot rule. |
| P3-9 Duplicate same-name suppliers from the stock-change picker | **Deployed** fix; clusters **merged** by migration 0164 (Program 4 section) | 2deb30ec, c1e79b87, eef366c6. "j secrat" ids 20, 38–46 and "lang" ids 23–37 via Contacts → Conflicts bulk merge. |
| P3-10 Invoice Start–End range visible on small screens | **Deployed** | 7cffe0d6, 1c476076, d13f80ab. |
| P3-11 Removal losses: revenue/profit excluding and including losses, one row below Not Paid in every report | **Deployed** | 5e430b70…b2f2a52a; abab12a4, 60949d4b, 6e6ea6f7 (disposal and product-delete write-offs count; `test-removal-losses-pure` 20). Defaults: dated stock-count removals excluded; compat cost/profit keys admin-only; including-losses figures unclamped but toned. |
| P3-13 Shift "additional" = extra change money used during the shift, labels match en/km everywhere, field before the closing count | **Deployed** | 27eae5dd, 794dcd19, 3937a36c, 8c0e53c2, 90cca732; `shiftAdditionalCash.test.ts` 10/10. |
| P3-14 Shifts editable by employees with before/after record, one row per shift | **Deployed** | a9b0a98b…3e31a93b; `shiftAmendForm.test.ts`; `test-shift-security-pure`. Default taken: amend gated on the shift capability, not branch visibility (**owner ruling** if it should be branch-scoped). |
| P3-15 Every change updates dependent reports/calculations/links/docs | **Done** for this checkpoint | Each lane's dependents enumerated in its verifier matrix; progress.md, this register, Part 613, CLAUDE_HANDOFF, portal policy updated in the docs commit. |
| Migrations 0162 and 0163 on production D1 | **Applied** September 15 (superseded: the owner delegated migrations to the coordinator) | `cloudflare/migrations/0162_*.sql`, `0163_*.sql`; apply after the code is live, 0163 last; pre/post assertions in the files. |
| Supplier E3 (multi-lot FIFO drain unmirrored), E4 predicate divergence, E5 numeric reference collision; reason editor without `code`; nav guard on reason-only typing; portal `buildPortalConfig` editor fields; catalog preview promotionRules; same-day two-supplier lot; telegram/promotion astral-char divergence; CDP calls without timeout; unreachable `bulkImport*` wrappers | **Not yet** | Listed in progress.md top entry. |

## September 14 iOS PWA program LIVE

| Item | State | Evidence |
| --- | --- | --- |
| Scanner button opens the camera in one tap | **Deployed** — Worker d972a943-659e-4210-a1c9-58afc7436c0f, commit 4b20bd68 | 8e6371cb, c2185071; `e2e/scanner.spec.ts` "one tap on the scan button starts the camera" green on both Chromium projects (WebKit has no camera in Playwright). |
| iOS PWA storage boundaries, root error boundary, one crash reporter | **Deployed** | 494549a3, ba00dcee, 16f7897c; `startupResilience`, `iosInstallAndPersistence`. |
| iOS keyboard/viewport layout, 16px focus-zoom floor, modal caps via `--app-vh` | **Deployed** | f77da6f8, 142356e2, f7d193e7, 108391bb; `iosLayoutGuards`; `e2e/ios-layout.spec.ts`. |
| Service-worker update probe, scoped failed-install cleanup, print surfaces | **Deployed** | 6bc719df, cbbdd22b; `e2e/pwa-update.spec.ts`. |
| iOS install hint + persistence surviving logout on a shared till | **Deployed** | a2031b77, 64ff7ef6. |
| Admin-document rewrite degrades to the untouched asset | **Deployed** | 166fd63f; `test-admin-host-document-rewrite-pure`. |
| Playwright integration/system suite as runnable files | **Done**, in the release | `frontend/e2e/` + README; `npm run test:e2e*`; system tier through a real local Worker + D1 (`e2e/system/pos-sale.spec.ts`). |
| Free vs paid plan split (deploy-time choice, runtime fallback) | **Done**; paid **Deployed**, free variant **not deployed** (owner's choice per deploy) | 810a2cab..f159e9ff, a8589ca0, 4df59bc6, 97dae6cb, 4b20bd68; `npm run deploy:free`, `dry-run:free|paid`; drift test locks the two configs to four differences. |
| Cross-cutting risk pass (conflicts, duplicates, cache/memory/security, same device other accounts, old vs new data, deploy-time update) | **Done** | bos-verify reviews of 142356e2 and f159e9ff; fixes 166fd63f, 64ff7ef6, cbbdd22b, ba00dcee; deferred items listed in progress.md. |
| Harness-reproduced product defects (admin boot on blocked storage, bootstrap prefetch rejection, pagination inputs <16px, account-handover storage/401/fence) | **Not yet** — `test.fixme` in `frontend/e2e`, README "Expected red" | Each fixme names the deciding lines. |
| `utils/safeStorage.ts` consolidation; advisory-stack anchor; `Vary: Accept`; `last_error_code` migration; free import path executed by a test | **Not yet** (next checkpoint) | Recorded in progress.md. |
| Free-account measurement deploy; live D1 size read; bulk re-import on free | **Owner ruling needed** | See progress.md. |
| Physical iOS/PWA, camera, printer smoke | **Not certified** | Cannot be exercised from this workstation; the WebKit project stands in for the iPhone contract only where Playwright can. |

## Evidence reconciliation and remaining-work status — September 10

The production merge ledger is reconciled: the verified postflight records **166** applied product merges (history IDs 369–534, 166 audits, zero pending fingerprints) in addition to the **8** earlier proven merges, for **174 proven merges total**. Older register paragraphs that say “eight completed cases” describe the pre-cleanup checkpoint and are stale. The old cleanup preview reported 1,774 eligible and 19 quarantined groups, but that preview is not current evidence; a fresh authenticated preview is required before any further merge. No merge is running now.

Contact cleanup remains read-only. Shared General **24969** is excluded and its legacy membership is cleared; protected customer **22305** is unchanged. The open customer cluster **[23907, 25000, 25001]** is blocked by distinct memberships. Supplier name-only groups **[20, 38–46]** and **[23, 33–37]** require profile/source confirmation; no supplier or customer candidate was merged. No delivery-contact duplicate cluster was found.

Historical branch metadata repair is complete for proven targets. The four pre-hotfix zero-item incident receipts were repaired and verified; two separate older header-only sales (**16917**, **16827**) remain outside the recovery allowlist because their item/creation evidence is missing. Ambiguous historical drivers and legacy sale links remain unresolved rather than invented.

Physical iOS/PWA, camera, printer, and uncertain-network transfer testing still cannot be certified from this workstation. Desktop signed-in Admin and public storefront smoke loaded after the latest releases; broad mobile/public/customer-portal visual polish remains queued, and offline work remains paused by owner request.

## Not Paid terminology follow-up LIVE — September 10

Fix-scoped commit **f0321c78** was pushed to `codex/sale-create-trigger-release-20260909` and deployed successfully at 100% as Worker version **a6c36168-baa9-4352-a4ec-ede19f378f31**. Build revision **f0321c78f49c**, build hash **df9ef64974d248fa**, built **2026-09-09T22:27:27.313Z**. No database migration or production data mutation was included.

Sale-facing recovery and shift copy now consistently uses **Not Paid / ប្រាក់ជំពាក់**; the generic received-date empty state now uses **Received date / ថ្ងៃចូល**. Supplier-balance wording remains separate by design. The terminology test now covers the recovery/Records keys as well as the normal sales and report labels.

Verification passed: focused glossary, Not Paid, Records rendering, semantic variable parity, i18n, the complete frontend chain (**347/347**), frontend typecheck, production build, Worker typecheck, and clean release-tree diff.

Remaining open or paused work is unchanged: evidence-led historical duplicate/contact cleanup, unresolved driver/sale-link evidence, physical iOS/PWA/camera/printer smoke, broad compact UI/public/customer-portal polish, and offline work (paused by owner).

## Concise delivery vocabulary fix LIVE — September 10

Fix-scoped commit **a6c29922** was pushed to `codex/sale-create-trigger-release-20260909` and deployed successfully at 100% as Worker version **8619640f-0b70-49f1-8609-3dbba0191e8c**. Build revision **a6c299229a62**, build hash **f16b2c2c00d989e8**, built **2026-09-09T22:16:48.513Z**. No database migration or production data mutation was included.

All direct delivery-fee wording in the Khmer pack now uses the owner-approved concise term **ថ្លៃដឹក**. Actual delivery cost remains **ថ្លៃដឹកដើម** and new actual delivery cost remains **ថ្លៃដឹកដើមថ្មី**. Cost price is **ថ្លៃដើម**, selling price is **តម្លៃលក់**, wholesale price is **តម្លៃបោះដុំ**, and received date is **ថ្ងៃចូល**. Transport/contact phrases that mean delivery service remain distinct. A focused glossary guard now prevents direct fee labels from drifting back to ថ្លៃដឹកជញ្ជូន. Internal fields (`batch_id`, `lot_code`, `credit`) were not renamed.

Verification passed from five angles: focused Khmer glossary, Not Paid terminology, rendered sale Records, semantic variable parity, and the complete frontend chain (**347/347**), plus frontend typecheck, i18n verification, Worker typecheck, production build, and clean release-tree diff.

Still open or paused: evidence-led historical duplicate/contact cleanup (review-only candidates remain; no blind merge), unresolved historical driver/sale-link evidence, physical iOS/PWA/camera/printer smoke, broader compact UI/public/customer-portal polish, and offline work (paused by owner).

## Vocabulary consistency release LIVE — September 10

Fix-scoped commit 06b9346a was pushed to codex/sale-create-trigger-release-20260909 and deployed successfully as Worker version 48d27bdf-8e41-484a-bea3-645a8fb2ab57. Build revision 06b9346a77b6, build hash 61f468e703d7973f, built 2026-09-09T22:01:31Z. No database migration or production data mutation was included.

Visible terminology is now aligned: Received date / ថ្ងៃចូល for the stock-date concept, Receive session / វគ្គទទួលស្តុក for the multi-line workflow, Cost price / ថ្លៃដើម, Selling price / តម្លៃលក់, Wholesale price / តម្លៃបោះដុំ, Delivery fee / ថ្លៃដឹក, and Actual delivery cost / ថ្លៃដឹកដើម. The AppContext and sale-record fallbacks use the same labels, while internal fields batch_id, lot_code, and credit remain unchanged for compatibility.

The owner-edited workbook substantive Khmer changes were already present in the release and are covered by the live pack. Four whitespace-only workbook edits remain intentionally held because the current JSX composition supplies those separators; applying them literally would join words in import/export messages.

Verification passed from multiple angles: focused Khmer glossary, Not Paid terminology, received-date display, sale-record rendering, semantic variable parity, frontend typecheck, i18n verification, Worker typecheck, production build, and the complete frontend utility chain 347/347. The signed-in Admin UI and public storefront loaded after deployment. CLI runtime/version verification was blocked by a Cloudflare bot challenge, so no claim is made from that path.

Still open or paused: evidence-led historical duplicate/contact cleanup (review-only candidates remain; no blind merge), unresolved historical driver/sale-link evidence, physical iOS/PWA/camera/printer smoke, broader compact UI/public/customer-portal polish, and offline work (paused by owner).
# Owner task register — September 7, 2026

This is the current request register. `progress.md` links here. Append new owner
requests and corrections; do not replace earlier requests or silently drop them.
Root owns prioritization, integration, evidence, and deployment claims.

Latest verified production checkpoint: source **16ffa680aa52** (full commit
**16ffa680aa52e1b0e12e7f3edb2e5c14f60b8c74f**) on
`codex/sale-create-trigger-release-20260909`, Worker
**a5cdcb48-723a-4ec6-a029-1d924e60dc5b**, 100% at
2026-09-09T21:04:59.891Z. This fix adds a backup-first, exact-value-guarded,
audited/replayable cleanup for the owner-confirmed shared General membership.
The authenticated app applied it: customer **24969** now has an empty
membership while its five sales, one return and anonymous marker remain; the
protected customer **22305** is unchanged. No migration or secret changed.
The older release facts below remain historical evidence for individual rows;
they are not a claim that an older Worker is still serving.

Last reconciled: 2026-09-10T05:15:00+08:00.

Fresh evidence follow-up (2026-09-10): two additional zero-line historical sales
16917 and 16827 have nonzero headers/fees but no persisted items or creation
snapshots; they remain outside the fixed 16951–16954 recovery allowlist and
were not mutated. The shared General membership cleanup was separately
previewed, applied, then replayed; the replay reported the exact receipt and
made no second customer/history/audit change. See
`output/historical-evidence-followup-20260910.json` for the read-only incident
evidence. Functional fixes still precede UI polish.
Current production: **16ffa680aa52**, Worker **a5cdcb48-723a-4ec6-a029-1d924e60dc5b**,
100% at **2026-09-09T21:04:59.891Z**. The latest fix includes the canonical
vocabulary checkpoint and the shared-General membership cleanup; earlier
functional releases remain included. Production product merge remains eight
completed cases, with broader duplicate/contact cleanup still evidence-blocked.

First functional release **821efc94ce7a** is serving 100% traffic as Worker
**498efadb-f833-471d-a8b7-b4326950bd26**, deployed 2026-09-07 09:54:13 UTC.
Public Git branch: codex/release-fixes-20260907. Migrations 0128–0132 and required
security configuration applied. Full 306 frontend files and 274 backend suites,
both typechecks, i18n, build, and frozen browser smoke passed before deployment.
Live assets match the release; Sales bootstrap timed out during network failures
and is still under investigation (F36). Do not call every live workflow certified.
Delivery addition F32 is now deployed as **c475e637d197**, Worker
**d5aeeb82-cb0d-4047-8abf-8e96ba17f602**, 100% at 11:10:18 UTC; migration 0133
preserved all nine prior amendment rows and revisions. Live Sales and Records
loaded after connection recovery. F36 has further retry-visibility fixes pending.
Historical metadata correction was attempted but failed on the remote batch transport.
All 4,333 target rows were independently verified unchanged and audit count zero.
The guarded payload is being compacted; no correction or duplicate merge has committed.

State definitions: **Local pass** means implemented with relevant local evidence,
not production completion. **Integrated** means source is composed but final
release checks remain. **Active** means assigned work remains. **Pending live**
means a prepared operation has not run. **Deferred UI** follows the owner's
explicit priority correction. **Needs facts** means evidence cannot be invented.
Every shipped row must eventually record its actual deployment version.

## Functional requests

| ID | Request and latest accepted detail | State / owner | Evidence or next action |
|---|---|---|---|
| F01 | Completed sale changed back to awaiting payment must allow authorized payment method, amount, item and delete/correction actions. | Deployed 02eecbe3; live follow-through active | Sales correction and scope tests; final release smoke. |
| F02 | Audit all historical sales with missing branch, Warehouse/multiple branches, or N/A driver. | Proven branch repair complete; ambiguous provenance remains / root | Census covered 15,096 sales and 36,340 lines. Proven null metadata repair prepared; ambiguous fulfillment/driver facts remain unresolved. |
| F03 | Enforce Shop-only sales; Warehouse stock must transfer first, including added lines, imports, replacements and generated sales. | Deployed 821efc94; recorded limitations retained | Backend enforcement and sibling parity tests integrated. |
| F04 | Stock-in session times out after 12 seconds. | Deployed 821efc94; recorded limitations retained | Session-specific 60-second transport, stable request identity, durable retry; no global timeout inflation. |
| F05 | Multiple products with multiple images each fail in one stock session, including encoded spaces/Khmer/percent filenames. | Deployed 821efc94; recorded limitations retained | Older build reproduced 409; identical retained 3-product/6-image request succeeded once on eb06b80b. Six asset GETs and product/gallery ownership passed. |
| F06 | Add/edit/create product images: upload, attach from Library, files, camera entry, and PWA draft lifecycle. | Deployed 821efc94; recorded limitations retained | Upload/Library associations and close/minimize/retry passed. Actual phone camera hardware was unavailable; do not claim a hardware test. |
| F07 | Library totals: physical storage, file quantities by type, correct usage and deletion protection. | Deployed 821efc94; recorded limitations retained | Physical counts unchanged by retry; covers and gallery usage correct. |
| F08 | Same barcode/leading zeros: scanner, search, same-session recognition and merge must use compatible identity. | Deployed 821efc94; recorded limitations retained | Guarded UPC/internal-code parity; do not strip meaningful arbitrary code zeros. |
| F09 | Merge cost uses distinct nonzero available costs; highest retail/wholesale prices; preserve stock/relations/audit/undo. | Implementation deployed 821efc94; production merge pending / identity, root | 1,600 synthetic folds in 64 requests; retry mean remains fixed, changed source refuses retry. |
| F10 | Run the production duplicate merge; one confirmation, bounded progress, faster saves. | Partial: 8 committed; browser follow-through pending / root | Bounded implementation deployed da5c8b02; exact eight prior action IDs318–325 retained. Refresh preview through authenticated app before continuing; browser connector timed out. |
| F11 | Detect duplicate barcode OR name added earlier in the same session, including queued/saved lines; otherwise green only after resolved lookup. | Deployed 821efc94; recorded limitations retained | Session identity and duplicate parity tests integrated; explicit quantity edit preserved. |
| F12 | Gross sales, discounts, refunds and revenue must agree across Dashboard chart, headline, Sales, Inventory and reports. | Deployed 821efc94; recorded limitations retained | Tested gross 200, total discount 15, net 185; raw item-discount basis corrected. |
| F13 | Credit is recognized in revenue and profit (N39); latest visible wording overridden by F44 Not Paid / ប្រាក់ជំពាក់. | Deployed 821efc94; recorded limitations retained | Credit/revenue parity and report tests integrated. |
| F14 | Shift registration is report-only and close always works (N37). | Deployed 821efc94; recorded limitations retained | Real route tests; blank and explicit zero are different; invalid values rejected without blocking legitimate close. |
| F15 | Shift report compares registered opening/end USD and KHR; unknown stays unknown (N38). | Deployed 821efc94; recorded limitations retained | Migration 0132 conservatively treats ambiguous legacy zero as unknown; report/Telegram tests passed. |
| F16 | Shift Report is its own selectable report view with export, not an extra block in overview. | Deployed 821efc94; recorded limitations retained | Final browser smoke includes selection/export. |
| F17 | Concise Telegram reports (N42). | Deployed 821efc94; recorded limitations retained | Bilingual composed payloads, day-first dates and concise report tests passed; no live messages sent. |
| F18 | Delivery accounting clearly explains customer charge, actual courier cost, store-paid portion and contribution without double deduction. | Deployed 821efc94; recorded limitations retained | Financial parity verified; negative contribution can represent store subsidy. |
| F19 | Expenses generated by sales show a sale link; branch is Shop; manual expenses need no sale ID. | Implementation deployed 821efc94; proven branch correction complete / root | Existing unlinked legacy fees lack proof of a sale relationship. Never invent links; proven branch metadata correction prepared. |
| F20 | Records line belongs INSIDE expanded sale details, not the collapsed row (latest correction to N41). | Deployed 821efc94; recorded limitations retained | Browser placement, single dialog and return-to-detail flow passed. |
| F21 | Records includes actor/time, status, products/quantity, payments, delivery fee and actual cost with readable before/after detail. | Records deployed 821efc94; future snapshots F33 deployed 02eecbe3 / sales | Structured detail/integrity tests pass. Unknown/pruned provenance is explicit; retained replay history survives both clear paths. Sales list D1 failure is F34. |
| F22 | Customer delivery fee and actual delivery cost are separately editable and recorded. | Deployed 821efc94; conversion F32 deployed c475e637 / sales | Fee changes customer total; actual cost does not. No-delivery conversion is F32. |
| F23 | Dashboard low/out lists load more at the bottom and reset on leaving. | Deployed 821efc94; recorded limitations retained | Desktop and 375px scroll 10→20 and leave/reenter reset passed. |
| F24 | Total stock alerts use Shop+Warehouse; branch pages/POS branch options use individual branch stock. | Deployed 821efc94; recorded limitations retained | Pure aggregate/branch tests; alert setting events refresh Dashboard, POS and Branches. |
| F25 | Permissions/roles fully scoped across add/edit/session/images, review, imports, bulk, offline and undo. | Deployed 821efc94; recorded limitations retained | Synchronous matrix through 96abe402 and Queue authority through 1aae81d3 independently certified, including races, cancellation and current-role checks. Combined first-release sweep passed. |
| F26 | Dismiss offline/update notifications with X without hiding failed saves or lying about connectivity. | Deployed 821efc94; recorded limitations retained | Dismissal helper and App integration complete; reconnect/error behavior retained. |
| F27 | Remove redundant eye next to Print in sales rows. | Deployed 821efc94; recorded limitations retained | Browser row access remains; Actions shows Print only. |
| F28 | Take over Claude lanes, commits, dirty/unverified work and progress sessions. | Deployed 821efc94; recorded limitations retained | Twenty-lane lineage and shared patch inventory preserved; original dirty worktrees untouched. |
| F29 | Remove duplicate delivery_actual_cost_usd field and rejected stopgap kind comment in Sales merge fallout. | Deployed 821efc94; recorded limitations retained | Source/type/parity gates cover composed Sales. |
| F30 | Finish earlier N18/N21/N23 and N28–N36/audit lanes without losing their fixes. | Deployed 821efc94; recorded limitations retained | Canonical ea9f0d1b base includes checkpoint 2 and earlier integrations; individual follow-up fixes retained. |
| F31 | GitHub commits describe individual fixes, not checkpoint/batch commits. | Fix-scoped public commits pushed through dfb8932e / root | Each runtime fix retained separately on release branches; private reports excluded. |
| F32 | Sale originally without delivery allows later driver, customer fee and actual cost. | Deployed c475e637 / sales | Full backend 276 suites; all frontend 306 files covered; independent money/migration review and browser actual retry/driver/totals/Records passed. |
| F33 | Preserve original basket, payments, driver and actor for future sales. | Deployed 02eecbe3; live follow-through active | Four writers, migration 0134, backup and immutable Records independently pass; original basket/payment remain unchanged after later edits in browser. Backend 278/278 pass. |
| F34 | Sales list/detail Records SQL failed in real D1. | Deployed 821efc94 / sales | Frozen actual Worker list/detail now 200; count and compound ordering repaired. |
| F35 | Fast Stock minimize restored wrong host and consumed the chip. | Deployed 821efc94 / media | Exact user5 frozen browser restore passed; preserves draft and consumes only after modal mounts. |
| F36 | Sales read retry/deadline/cache cancellation and visible manual Retry after failure. | Deployed 02eecbe3; live follow-through active | Frozen 5ec39289 browser: one request aborted at 20s, visible Retry, one manual retry succeeds; late responses never overwrite data or navigation. |
| F37 | Duplicate preview times out on large catalogs because it queries stock/batches/cost per group. | Deployed 02eecbe3; live follow-through active | Independent real route 2,000 groups uses 43 reads instead of roughly 6,000; merge rules, prices and blockers preserved. |
| F38 | Immediately recording payment after changing Completed to Credit reports a false other-device conflict. | Deployed 02eecbe3; live follow-through active | 9d707f1d carries exact committed status version into payment review; real concurrent-write protection and typed tender values retained. |
| F39 | Live bulk merging remains about eight seconds per case and fails on database overload. | Bounded corrections deployed da5c8b02; production merge follow-through pending / root | Eight commits preceded an 87.3s request failure. Inspect serial D1 round trips and invocation limits; preserve atomic cases, undo and whole-cluster cost mean. |
| F40 | Bulk merge error falsely says data not saved after partial commits. | Deployed da5c8b02; production follow-through pending / root | Return/reconcile committed cases and undo IDs on failure; explicit resumable partial state, no blind retry. |

| F41 | Idle import polling writes to D1 and immediate retries amplify database overload. | Deployed 560bfbcb; independent PASS, backend 280/280 / sales | Skip no-op reaper writes when no stale jobs exist; preserve guarded stale recovery. Fail overload once instead of immediately retrying it. |

| F42 | Contacts duplicates: supplier creation in stock sessions, raw versus spaced customer phone numbers, obsolete membership IDs; inspect existing fixes before correction. | Canonical guards/atomic merge/formatting and hidden-supplier fix deployed; broad cleanup pending | Explicit manual/POS choices integrated at c09c707a. The owner-confirmed shared-General membership was cleared separately with backup/history/audit/replay; other customer and supplier candidates still require identity evidence. |
| F43 | Contact phone entry automatically spaces digits as typed; formatted display and canonical matching must agree. | Deployed da5c8b02; independent PASS including mobile deletion and IME | Progressive spacing, prefixes, paste and caret covered in seven create/edit/quick-add fields. |
| F44 | Latest owner correction: visible Credit / ឥណទាន becomes Not Paid / ប្រាក់ជំពាក់ everywhere. | Deployed 560bfbcb; live EN/KM verified | Supersedes N39/F13 unpaid-state wording. Internal values/accounting unchanged; distinct Store Credit, supplier credit and overpayment concepts preserved. |
| F45 | Investigate failed admin WebSocket and reported content.js/VM listener/startTime errors. | Deployed 560bfbcb; independent PASS | Cooldown lacked wake-up and actual logout did not disconnect. Both corrected. content.js listener is extension noise; VM startTime ownership unproven. |
| F46 | Bulk conflict multi-select processes slowly one by one; present combined before/after review and efficient bounded execution. | Runtime active, isolated next slice / conflict_batch_impl, sales, media | Combined before/after workflow is separate from bounded duplicate merge; backend execution/receipts, combined frontend review and backup/reset integration now assigned. |

| F47 | Prevent and clearly prompt about existing customers, suppliers and delivery contacts across add/create/edit/quick-add/import/session surfaces; distinguish reuse from intentional creation. | Deployed c2eb9d57 across A/B/C/D; legacy cleanup remains | Explicit reuse/separate choices, phone/name/membership guards, reviewed snapshots, import targets, atomic new-customer signup and no hidden supplier creation. Exact browser passed; unrelated failed saves remain visible. |
| F48 | Shift difference must show when supported across Telegram, reports and history; Closing cash / សាច់ប្រាក់បិទវេន; Not Paid / ប្រាក់ជំពាក់; use owner's supplied concise report arrangement. | Deployed 4afe9825; independent review passed / sales | Each known currency difference is shown even under review; missing inputs remain unknown. Requested section order and Closing cash labels are pinned. |
| F49 | Attribute Protected Audience, Shared Storage and StorageType.persistent deprecation warnings and fix actual app use. | Unresolved source attribution | No matching app API use found in source or clean-browser warnings. Exact reported third-party/extension source remains unproven; no suppression. |
| F50 | Correct unassociated form labels (browser reports four resources). | Deployed 4afe9825; exact four reproduced and fixed / responsive | Sales custom-export flow now has zero unassociated labels in the clean-browser check. Other forms remain separate follow-up candidates. |

| F51 | Enforce owner-confirmed canonical Shop/Warehouse and product/branch/lot identity across every writer; retain daily prompt/report-only cash and Not Paid revenue. | Canonical branch/lot followups deployed c2eb9d57 | CRUD/review/undo/reset and Warehouse→Shop transfer guards, disabled sale-side Warehouse, stale-lot checks, authoritative general/dated/sales imports, and canonical export buckets passed independent and combined checks. Historical unknown identities are not silently repaired. |
| F52 | Investigate negative revenue/profit and keep canonical calculations accurate. | Audit complete; accounting clarification retained | Canonical revenue is nonnegative and includes Not Paid. No formula defect found in focused audit. Real below-cost/expense losses may produce negative profit; never falsify by clamping. Inconsistent test wording remains a small follow-up. |
| F57 | Clear the legacy membership accidentally retained on the shared anonymous General/walk-in customer, without changing real customer links. | Deployed and applied in **16ffa680** / Worker **a5cdcb48-723a-4ec6-a029-1d924e60dc5b** | Preview matched target 24969 and protected 22305; backup-first atomic update cleared only `membership_number`; five sales, one return and anonymous marker stayed intact. Exact replay confirmed one receipt/audit and zero second mutation. |

## Public portal and legal requests

| ID | Request | State / owner | Evidence or next action |
|---|---|---|---|
| P01 | Privacy, Terms and Cookie policies; footer policy button reachable at page bottom. | Deployed 821efc94; recorded limitations retained | Reader routes, footer, focus/history/title/scroll behavior verified. |
| P02 | Determine cookie consent needs; form consent and durable policy version/time/locale. | Deployed 821efc94; recorded limitations retained | Optional map/AI/share consent controls and server enforcement; migrations 0130/0131 required. No claim of universal legal compliance. |
| P03 | Minimize collected data; inspect analytics/third-party embeds. | Deployed 821efc94; recorded limitations retained | Initial public load has no third-party requests/embeds; map revocation unloads; raw session identifiers removed; HMAC secret needed at release. |
| P04 | Accessible public site: alt text, contrast, keyboard forms, clear buttons and small-screen heading. | Deployed 821efc94; recorded limitations retained | 375px heading one line/no overflow; modal focus/inert/scroll checks and UI fixes passed. |
| P05 | Remove fake reviews/unsupported claims and review image copyright. | Reviewed; rights facts unresolved / portal | No invented reviews/claims added. Existing image ownership/license cannot be proven from a file alone; keep this risk visible. |
| P06 | Add truthful business details; check applicable local law and flag risks. | Needs facts / root, owner | Trade name/address/phone verified. Registered legal identity, registration, email and target markets remain unconfirmed; Cambodia sources and conditional foreign-market risks documented privately. |
| P07 | Configuration security findings discovered during takeover. | Configuration repaired; bot token rotation pending / root | Dedicated portal HMAC absent; one malformed Telegram binding exposes credential text in its name. Dedicated HMAC configured and stray binding removed; bot token rotation remains necessary. No credential values belong in this register. |

## UI follow-up queue

| ID | Request | State |
|---|---|---|
| U01 | Improve small-screen main/subpage back navigation and remove the large empty bottom gap. | Deferred UI |
| U02 | Add icons to subpage navigation. | Deferred UI |
| U03 | Reports centered with safe edge gutters, larger readable text, consistent larger filter button. | Core gutters, centered report document, readable type and mobile filter sizing deployed c2eb9d57/source-verified; final visual polish remains |
| U04 | Compact Shift button with stats/actions; move export beside section title or near small-screen page title without crowding notifications. | Core compact Shift/Export and dedicated shift-report actions deployed c2eb9d57/source-verified; remaining mobile arrangement review |
| U05 | Merge Not paid heading/value into one highlighted row; green total/final profit. | Not Paid row deployed; selected profit headline green correction integrated b2299a2b, next release pending |
| U06 | Receipt Item/Qty/Price/Total headings English by default, including mixed English/Khmer setting. | Deployed/source and render-test verified: literal Item/Qty/Price/Total in en/km/both |
| U07 | Add minus next to Close for edit/add/set/stock/session actions; Back/discard/minimize must cooperate with scoped drafts. | Partial deployed: Product, Fast Stock-In, Receive Batch, Create Products Session, Branch edit and Fee drafts minimize/restore; stock adjust/set/remove and broader rollout remain |
| U08 | Compact Start/End dates; default entire days 00:00–23:59 without extra selector; align with stats/actions across Dashboard/Sales/Expenses/Returns/Branches. | Deferred UI |
| U09 | Compact rectangular payment-method control while changing awaiting-payment status. | Deferred UI; F01 functional editing remains priority |
| U10 | Date/time before IDs on receipts, sessions and analogous rows. | Partial deployed: Shift/movement time-first; receipt and remaining list ordering still open |
| U11 | Compact report presets and This month on same row. | Deferred UI |
| U12 | Consistent button/stat heights following the Shift control. | Deferred UI |

| U13 | Expanded mobile Sales: Return/Print/Close one row, three status options one row, Cancel/Back alongside Update; Records at bottom; merge membership/attach controls. | Active isolated responsive implementation; separate fix commits and mobile/desktop checks pending |
| U14 | Expanded sale header compact ID/status/actions with date/time below; evaluate double-click/long-press copy with accessible explicit alternative. | Active isolated responsive implementation; accessible explicit copy retained |
| U15 | Collapsed mobile Sales: cashier and branch share receipt/time row, pipe separators, bold cashier. | Active isolated responsive implementation; compact cashier/branch metadata and bold cashier |

## Release and follow-through

1. Verified application release 02eecbe3 is deployed at 100%; migration 0134 preservation checks pass.
2. Check live Sales and duplicate preview, then perform requested supported duplicate merge with audit/undo.
3. Historical correction completed against the reviewed 65-column schema. Preserve immutable private manifest, audit proof and recovery limits; ambiguous fulfillment, driver and sale-link facts remain unresolved.
4. Continue deferred UI and resolve business/rights facts and Telegram rotation.

Detailed evidence: [takeover ledger](2026-09-07-codex-takeover.md), individual Git
commits, and private local `outputs/takeover-20260907/` reports. Local checks do not
stand in for deployment, and missing historical evidence is never fabricated.

## Stability release candidate and repair transport

- Public fix branch codex/release-stability-20260907 at 560bfbcbbc6730e9bba305bec6b70af752579ad9 contains only F41, F44 and F45, separate from F39/F40. GitHub pushed. Backend 280/280 passed; frontend 307/309 initially passed, two stale assertions corrected and focused rerun passed 3/3; both types, i18n, build and deploy dry-run passed. Initial attempt failed after asset upload; retry succeeded, independently confirmed as Worker03aa25a5 at100% at15:36:03UTC.
- F39/F40 independent review found post-commit finalizer errors, unknown first-request timeout handling, normal-budget confirmation regression, and whole-cluster workload-bound gaps. Corrections are integrated progressively; not yet certified or deployed. Complex multi-product clusters must be refused before any fold unless a reviewed whole-cluster plan fits the bound. Their eventual correction remains open.
- Three grouped historical execution attempts through the remote development proxy failed. Each full REST postcheck reports 44 pending, 0 applied, 0 audits, 0 violations across all 4,333 target rows. Private atomic file-import transport is being prepared with the same reviewed manifest and audit/full-row guards; no historical repair is claimed complete.

Historical import follow-through: fees-001 committed 99 Shop branch corrections. CLI exit 0 output framing caused a safe pause; independent postcheck-after-file-import.json confirms exact state and audits. No later group ran. Parsing correction and explicit resume remain; the completed group must be skipped.


## September 8 follow-through (17:15 UTC September 7)

- F39/F40: bounded merge and redo economics passed independent review. Browser proved 20 pairs complete under one confirmation and normal continuation, undo works, and close aborts preview. It also exposed an unknown-outcome reload cache bug; fix integrated as 3b48412c, independent review and browser rerun pending. Persisted whole-cluster preview economics remains active. No new production product merges beyond the original eight.
- F42: read-only production census found three shared canonical customer-phone groups, one same-name/phone candidate, two stale lookup keys, two duplicate supplier-name groups, and no normalized membership collision. These are candidates, not proof that people or businesses are identical. Existing contacts remain unchanged.
- F42 merge review found missing delivery expense references, non-atomic writes, incomplete membership lineage and frontend permission mismatch. Backend and permission fixes assigned separately. Existing membership IDs must be preserved; no destructive candidate cleanup until supported by evidence and safe execution.
- F43: seven phone input surfaces now have independently reviewed digit-preserving spacing, caret/paste, mobile beforeinput and IME handling. Membership display accurately marks assigned IDs read-only while preserving the legacy blank-ID path. Release gates remain.
- F46: Products Conflicts performs up to two requests and one dialog per selected pair. Decision: combined review for exact two-row pairs with per-pair stock decisions, bounded execution and truthful partial progress; runtime follows the current release freeze.
- Historical repair resume 2: eight fee groups applied (792 rows), 36 pending, nine exact audit records and zero full-row violations. Network failure stopped group nine; independent postcheck proved it pending before explicit resume 3.

## Historical correction completed — 2026-09-07 17:39 UTC

Guarded file-import resume 4 completed all remaining groups and the completion audit. Independent full REST postcheck-after-file-import-resume-4.json reports completed: 44 applied, 0 pending, 0 inconsistent; fees4255/sales22/sale_items56; 46 exact audit records; zero violations. Only proven branch metadata changed, with expected revision/audit effects. No stock quantities, financial amounts, driver assignments or legacy sale links were invented. Completed plans are terminal and the private operator refuses logical recovery after completion. Source manifest lineage02eecbe3; current application remains560bfbcb.

## Current remaining work — September 8 owner update

- **Ready for rollout:** Contacts canonical matching/import guards, seven phone-entry fields, membership preservation, atomic merge and permissions; bounded product merge execution/preview, accurate partial outcomes and redo economics. Independent reviews passed; migration0135 and deployment/live validation remain.
- **Production operations pending:** resume requested product duplicate merge after release; only eight cases have committed. Existing Contacts duplicates are reviewed candidates, not yet merged; distinct membership and weak supplier identity evidence remain blockers to destructive cleanup.
- **Active next slices:** F47 contact duplicate prompts; F48 shift difference/closing-cash report parity; F49 browser warning attribution; F50 form-label associations.
- **Planned, runtime not started:** F46 combined selected-conflict review and batching; larger/complex product cluster continuation; remaining modal minimize rollout and mobile UI U01–U15. Existing partial UI fixes remain recorded above.
- **Needs external facts/hardware:** actual phone camera test; ambiguous historical driver/sale-link provenance; supplier/customer identity evidence; registered business details/markets; image ownership; Telegram bot token rotation.
- **Completed data correction:** all proven historical Shop branch metadata targets, independently checked. No amounts or unknown relationships were invented.
- **Release policy:** continue verified incremental deployments as functional slices clear checks; keep each fix in its own descriptive commit. No periodic automation was created; this is the ongoing release workflow.

## Latest release and remaining work — September 8

- Deployedda5c8b02 at100%, Workera49ba8c2-1192-4700-b626-564a72e54938, deploymentce856f22-34dc-469c-b4f9-3aed1d6513ea. GitHub fix branch pushed. Fullbackend283/283; frontend313/314 then sole stale moved-code contract fixed and rerun passed; finalPOST bounds/migration/whitespace follow-ups independently passed focused checks. Types/i18n/build/dryrun passed. Frozenrealbrowser20cases in2requests underoneconfirmation, exactcosts/20audits/20history, Undo restoredonepair.
- Remote0135 addedtwoindexes only; before/afterhashes for59snapshot/233actionrows and421prior schemaobjects match,423after. Historicalrepairall44groups/46audits remainscomplete.
- Productionduplicate merge remains8completedcases. Browserconnector timedoutduringpostdeployverification; no additionalproductionmergeattempt.
- Nextrelease candidates: F48Telegramdifference/order/Closingcash (0180fa3e,3892711b) independentlyPASS; F50exactfourSaleslabelerrors (747d7f44) independentlyPASS; F47Cremovehidden suppliercreation (74c4a0ce), F47Dportalatomic signup (c87eb4ad), F51salesimportguards (8ceb2b9b) awaitingintegration/independentchecks. F47Amanual/POSexplicitcandidateprompts, F47Bcontactimportambiguity, F51sale lotownership/atomicallocations/POSbranchlotguards active.
- Stillplanned: F46combinedconflict review/batching, complex productclusters, remainingmobile UI/minimize rollout, branchCRUD/review/undo canonicalidentity enforcement, canonical Salesexportbreakdowns. Stillneedsfacts: historicaldriver/salelinks, contactidentity cleanup, phonecamera hardware, legalbusiness/markets/image rights, bottokenrotation.
- Session limit permits eight simultaneous subagents, not ten; bounded tasks run in waves.

## Incremental deployment — September 8

Release 4afe9825 is live at 100%, independently confirmed by Cloudflare. Exactly four reviewed fixes were published separately; no migration. Types, i18n, production build, dry-run and focused shift/label/supplier checks passed. Newest broader integration gates exposed three stale tests and a native-select mismatch in the unfinished contact-import UI; these are being corrected before that later release.

Remaining functional owners: Identity handles explicit contact/POS duplicate choices and disabled Warehouse/stale-lot picker behavior; Media handles contact-import decisions, authoritative sale-import lot guards, and canonical import branch resolution; Accounting’s checkout lot guards passed independent race/rollback review; Portal handles canonical branch administration/review/undo/reset/transfer enforcement; Sales and Minimize independently verify follow-ups; Responsive repairs focused gate contracts. F47D portal signup atomicity is independently approved but not deployed. F46 combined conflict batching and the remaining mobile/minimize queue have not started runtime implementation. External facts and production merge access remain explicitly open.

## Current remaining work after dfb8932e

- Final verification: explicit duplicate decisions for customer/supplier/delivery/POS, old-client retry protection, disabled Warehouse and stale-lot picker behavior (F47A/F51).
- Active repairs: canonical branch CRUD/review/undo/reset/transfer enforcement and edit-only UI; general/dated stock imports including forged IDs, ambiguous defaults and atomic write guards; canonical export breakdown quantities/buckets/status counts. Independent reviewers reproduced blockers; none of those incomplete candidates are deployed.
- Not started runtime: F46 combined selected-conflict review/execution; larger complex duplicate merges beyond supported bounded cases; remaining mobile/layout/minimize U01–U15 items (partial earlier implementations remain listed individually).
- Pending live/evidence: remaining production product merge after eight cases; actual phone-camera testing; legacy customer/supplier membership identity cleanup; two ambiguous mixed/Warehouse sales, 21 unknown drivers, 4,282 unlinked legacy fees and six zero-item sales. Proven branch repair is already complete; no invented links.
- Unresolved attribution: reported deprecated browser APIs and anonymous VM startTime errors. Four reproduced form-label issues were fixed and deployed.
- Owner/external facts: registered legal identity, registration, contact email and target markets; image licenses/ownership; Telegram bot-token rotation. Existing portal policies/consent/accessibility fixes remain deployed with those limitations.
- Financial audit: canonical revenue includes Not Paid and is nonnegative. Genuine losses must remain visible as negative profit; no clamp or invented money. Clarify misleading nonnegative-profit test wording separately.

Release dfb8932e was independently confirmed at100%; no migration. Full285 backend suites and316 frontend test files passed before deployment. Source integration c09c707a remains a later candidate, not the deployed release.

## Functional follow-through — September 8, next checkpoint active

Production remains dfb8932e (Worker6abf6ffa,100%). Approved canonical branch administration/reset/transfers, guarded general/dated imports and export breakdown corrections are integrated through2766eb52. The provisional public candidate is dbdb24b7, pending final follow-ups; it is NOT deployed.

Exact-c09 Contacts/POS browser passed explicit duplicate decisions, blocked shared-phone/membership creation and disabled Warehouse. It found a stale resolved-error banner; fix1f9dd5a4 is in independent review and exact-browser validation. Full combined frontend317/318 passed; sole stale export-source assertion fixed and focused rerun passed. Frozen combined backend285/291 effective pass; six known stale test/fixture/loader failures, receipt already fixed and remaining five under correction. Do not label the combined gate green until these checks pass.

F46 runtime implementation is now ACTIVE (supersedes earlier not-started notes): dedicated backend owner conflict_batch_impl, frontend owner sales_impl, backup/reset owner media_stock_impl, isolated from this checkpoint. Migration0136 is reserved locally for durable selected-conflict run/case receipts; it has NOT been applied to production. Combined preview/one confirmation, scoped per-pair stock choices, atomic audit/undo and truthful continuation remain acceptance requirements.

Production product merge remains eight cases and browser access pending. Functional fixes still precede deferred UI. Original dirty workspace and historical evidence remain preserved.

| F53 | Permission update debounce loses own-user refresh after unrelated event; payloadless role refresh misses bootstrap. | Integrated b2299a2b; independent PASS, next release pending | Accumulated intent and session-generation guard pass ordinary and logout/relogin races; backend authority unchanged. |

## Branch/contact checkpoint deployed

Exact public c2eb9d57 is live100%, source9654562d, Worker3931ea55-3f66-459e-823d-3339979bd441 at2026-09-08T03:37:12.286363Z.31 individual commits pushed. Full291 backend suites and319 frontend files, types,5384 bilingual keys,1102-module build, dry-run and independent browser/source reviews passed. No remote migration. New migration0136 belongs exclusively to unfinishedF46 and is not deployed.

Remaining: F46 combined conflict review/execution and truthful saved run/undo status (backup/reset schema slice independently approved, runtime/UI still active); F53 permission-refresh coalescing; eight-case production merge continuation; legacy contact/membership evidence cleanup; ambiguous historical driver/sale links; real phone-camera verification; unresolved browser-warning attribution; U01–U15 remaining layouts/minimize/visual confirmation; business registration/market/contact and image-rights facts; Telegram token rotation.

| F54 | Invalidated in-flight reads and late local fallback must not restore stale shared HTTP cache. | Integrated b2299a2b; independent bounded PASS, next release pending | 69 focused tests and512 timing schedules; callback-side persistent mirrors and already-started callers remain outside scope. |

| F55 | English, Khmer, and wire variables must describe the same stock and delivery concepts; received-date records must not render as lot/batch, and sale-record fields must not fall back to raw variables. | Deployed 1d8c5813; independent PASS | 5,682 bilingual keys, placeholder parity, Worker/browser sale-kind and field parity, Khmer glossary, Telegram, receipt, merge, and record rendering checks pass. Legacy CSV column names and the internal multi-line Batch session remain compatibility exceptions. |
| F56 | Transfers must preserve the source received date when cloning or FIFO-allocating a product batch; Telegram transfer/return lines must show the same date. | Deployed 0a0f2865 / 1d8c5813; independent PASS | `received_at` is copied or kept unknown, never replaced with transfer time; branch-transfer regression 6/6 and Telegram message suites pass. |

## September 11 coordinated UI and workflow candidate

| Workstream | State | Evidence / release boundary |
| --- | --- | --- |
| Sales, Returns, Expenses, Reports responsive consistency | Integrated locally through c776cbbe; verified | Compact grouped rows/details, shared 40px actions, one-row stats/date/actions, horizontal presets, labelled Back/Next pagination at both positions, single Reports picker, restored Branch Stats. 375×812 mocked-read browser pass plus frontend 361/361. |
| Default date range | Integrated locally; verified | Every visible operational range owner starts at Cambodia business Today. Explicit All time/custom remain available. Date-default and Dashboard/Worker boundary suites pass. |
| General anonymous customer | Integrated locally; verified | Marker-based General normalization across UI/human reports and analytics; real customers with the same name stay distinct; membership/profile identity remains suppressed; sale phone snapshot stays visible on list/detail/receipt/reports and hold-to-copy on interactive list/detail. Import-compatible CSV keeps the anonymous fields blank by design. |
| Sale status/payment/amendment reliability | Integrated locally; verified | Exact receipt-state reconciliation, frozen unknown outcomes, original-request retry/discard, role/user parity, and configurable unlimited/120-minute amendment policy pass focused route/UI tests. |
| Shop↔Warehouse transfer operations | Integrated locally; verified, migration unapplied | Exact lot provenance, atomic destination lots, actor-scoped receipts, server replay, backup/reset, minimize/reload drafts, single/multi/all routes. Migration 0151 remains local and unapplied. |
| Permissions/current pages | Integrated locally; verified | Strict effective view/action enforcement on frontend and Worker; 586 core-surface + 539 route requests and 124,848 independent parity combinations pass. |
| Release | **Not deployed** | Local branch `codex/ui-consistency-20260911`; no remote migration, production data write, secret sync, or release upload. |

## Freshness follow-up candidate — September 8

Production remains c2eb9d57/Worker3931ea55,100%. Next isolated release includes F53 permission-refresh coalescing and session-generation isolation (independent review PASS); F54 HTTP invalidation/in-flight ownership and authoritative server-cache precedence (69 focused checks plus512 independent timing schedules); U05 selected positive profit headline stays green in both themes. Source b2299a2b is integrated, not deployed. Existing callbacks that write persistent queryCache/IndexedDB and already-started caller results are outside F54's proven shared-HTTP-cache boundary. No backend source or migration changes in this follow-up.

F46 is NOT in this candidate. Schema/backup/reset are independently approved locally; backend/UI parity still active. Required corrections: actionable-only manifest with blocked cases shown separately, exact same-request manual resume, changed-value markers after re-preview, complete image counts/primary indication. No incomplete F46 runtime or migration0136 is deployed. U13–U15 mobile Sales layouts are active separately.

## September 14 precision release LIVE

| Item | State | Evidence |
| --- | --- | --- |
| Money precision v1 (sales, add items, amendments, returns entitlement) | **Deployed**  Worker f5b89429, commit 139fcbf8 | Migrations 01580161 applied to production D1 (ids 153156), schema-only, pre/post fingerprints identical; rollback after v1 rows is application-only. |
| Return-cancel gap (sale returnable after a cancelled partial return) | **Deployed** | 0ea7bcb4 + native sequence test. |
| Legacy return body on a v1 sale overpaid (adversarial finding) | **Deployed** fix | 139fcbf8: the sale decides the money version; 409 money_precision_review_needed on create and edit; red/green proof; attack probe re-run clean. Could not have fired in production before this release. |
| Storefront pager selector [20/50/100] [Back] [page / total] [Next] | **Deployed** (owner reversal of the Sep 7 removal) | a1d55f12; live pageSize 20/50/100 honoured, 500 capped to 100. |
| Storefront blank page on blocked site data; over-fill glitch | **Deployed** fixes | 1defc523, 7e082a62. |
| N55N57 wave | **Deployed** | N56/N57 locks e663de8b; N55 coverage pre-existing. |
| Regression gates (blank page, runtime errors, pager glitches, performance budgets, zombie imports, money fuzz, orphans) | **Done**, in the release | 2bc6d86d, a34799f8, a332a8cf, 4b4b078d. |
| Old cached clients after this release | **Owner ruling needed** | 409 money_precision_review_needed on new sales/returns; queued sale kept, must be re-keyed after restart; no en/km entry for the code. |
| Admin catalog preview sharing the shopper page-size key; zero-result pager hidden; PageSizeSelect arrow keys | **Owner ruling needed** | Flagged by the frontend adversarial lane; pre-existing except the shared key. |
| Sale-id/return-id collision false 409 on return create; sub-cent middle-return cancellation refused; misleading lineage code on null-snapshot lines | **Not yet** (documented) | Orphan gate and Fable lane findings; all fail closed. |
| Physical iOS/PWA, camera, printer smoke | **Not certified** | Cannot be exercised from this workstation. |

## September 17 program 10 checkpoint B LIVE

Release code fc2c180c is live as Worker a18e26f5-454b-4494-8514-cf9e3aba4e9a (paid); migrations 0173–0176 applied to production D1.

| Item | State | Evidence |
| --- | --- | --- |
| P10-9 Not Paid sales completed without a stock deduction (21 lines / 26 units, 10 sales) | **Deployed and applied** | 0173: movements 21 (sum −26), allocations re-held, action_history 10, ledgers agree; product 4276 kept (no shop lot); allocation 264 = 2. |
| P10-9 replacement lines without a lot row (sales 16972, 16927) | **Deployed and applied** | 0176: 2 rows, 2 audit; native test pins the write path. |
| Quantity-increase amendment allocation sync | **Deployed** | a9d825e6; 409 sale_amendment_allocation_shortfall when the lot cannot cover it. |
| Sep 1–3 legacy-import sales deduction (38 lines / 107 units) | **Held, not applied** (owner: legacy is fine) | ops/scripts/migration/held/legacy_sep2_3_import_stock_deduction.sql + pure test. |
| P10-8 leading-zero barcode twins (4 pairs) | **Deployed and applied** | 0174: losers gone, keepers carry the real barcode, stock and batches moved, 4 undo snapshots. 75 same-barcode/different-name groups untouched per owner. |
| P10-7 catalog cost backfill from lots | **Deployed and applied** | 0175: 5,915 rows, 1,089 changes, 0 products differ, purchase price mirrored. |
| P10-5 barcode fold on create / edit / fast stock-in create | **Deployed** | 85e82674, faf68c01, aa2f0555, 95e58c9e, 4cac543f; toast + refresh instead of 409. |
| P10-6 cost price click opens the calculation | **Deployed** | 790c68f9, 6237aafd. |
| P9-9 tagged-stock error, Reports render pass, debloat report items, POS ProductDetailSheet cost display | **Not yet** | Carried. |
| P9-3/4/5/6 public items | **Not yet** | Paused until the owner's go. |
| Physical print with the driver-forms default | **Owner-side** | Cannot be exercised from this workstation. |

## September 17 program 10 checkpoint C LIVE

Release code 2317a9ca is live as Worker 0ec11718-b47e-4cbd-b30d-744c9c6af3cb (paid); migration 0177 applied to production D1.

| Item | State | Evidence |
| --- | --- | --- |
| P10-10 manual cost edit recorded as an override baseline (cost becomes n, later lots average from n) | **Deployed and applied** | 0177 product_cost_entries; 42a11071, cbdce163, 7b23e9e2; pure breakdown test 13 checks, native manual-entry test 6 checks. |
| P10-11 cost record rows show the lot, one compact row per entry, override rows dated with user | **Deployed** | 95f498e6, d9c8a665, f9061e36, 530c2ce0; costCalculationFloat test. |
| POS ProductDetailSheet cost line opening the calculation | **Deployed** | 530c2ce0; gated on products or inventory access. |
| Reports render pass | **Deployed** | 2306527b; reportsRenderPass.test.ts. |
| Debloat dead locals / report items | **Done, not deployed** | p10/debloat-locals 9ef0a578; merge and re-gate at the next checkpoint. |
| P9-9 tagged-stock error, P9-3/4/5/6 public items | **Not yet** | Carried; public items paused until the owner's go. |
| Physical print with the driver-forms default | **Owner-side** | Cannot be exercised from this workstation. |

## September 17 program 10 checkpoint D LIVE

Release code c5af514a is live as Worker cb711dfa-d756-405f-8316-2b54279d106e (paid); no migration (chain tail 0177). Codex may take over from here; every item below is stated as deployed or open.

| Item | State | Evidence |
| --- | --- | --- |
| Debloat dead locals (145 → 48 diagnostics) with budget guards in both packages | **Deployed** | p10/debloat-locals 9ef0a578 merged 268d7df1; zombie scroll state removed c5af514a; gates 457/457. |
| Debloat remainder (48 diagnostics, 983 unreferenced-key candidates) | **Open, not done** | Listed in progress.md checkpoint D. |
| Storefront console 404 (non-app resource) | **Open, not done** | Seen on leangbeauty.com after deploy; not an asset, API or upload. |
| P9-9 tagged-stock error | **Open, not done** | Carried. |
| P9-3/4/5/6 public items | **Open, not done** | Paused until the owner's go. |
| Physical print with the driver-forms default | **Open, owner-side** | Cannot be exercised from this workstation. |

## September 17 owner message K — new items registered (all OPEN, need a go), continuation queue

Owner message K (Sep 17, after checkpoint D): keep going on debloat and responsive, then the storefront console 404, then P9-9 tagged stock; add the issues below to the task list; usage weekly all models 96 %, Fable 98 %. The cost override rule was restated (before (n+n1+n2)/3, after override just n, later stock-adds average from n forward, override lives in edit on the product page) — that rule is DEPLOYED since checkpoint C (P10-10, Worker 0ec11718, migration 0177) and pinned by test-product-cost-breakdown-pure.cjs and test-product-manual-cost-entry-native.cjs; re-verify on the live product page when the next session logs in.

| Item | State | Owner wording |
| --- | --- | --- |
| P10-12 customers still carry old membership ids | **Open, needs go** | "customer still have old membership ids" |
| P10-13 some customers' membership points not zeroed | **Open, needs go** | "some still have membership points not zeroed" |
| P10-14 some customers show "unspecified" | **Open, needs go** | "some still shows unspecified" |
| P10-15 supplier display not consistent (Excel-style table on large screens) | **Open, needs go** | "the supplier display is not consistent like excel style in large screens" |
| P10-16 Purchases page double scroll — compact and responsive, scroll only the product rows | **Open, needs go** | "Purchases have double scroll make it more compact and responsive so only need to scroll for products" |
| P10-17 Purchases remaining column shows only 0 | **Open, needs go** | "remaining column are only showing 0" |
| P10-18 payment to supplier is null | **Open, needs go** | "payment to supplier is null...should be fixed" |
| P10-19 date field in Not Yet Paid (add stock and siblings) not working | **Open, needs go** | "the date in the not yet paid in add stock etc... are not working" |
| P10-20 product count / back / next row: remove the rows-per-page options | **Open, needs go** | "no need to show rows per page options" |
| P10-21 customer purchases: no default start/end date, show all | **Open, needs go** | "customers purchases are doing default date start and date end, remove that to show all" |
| P10-22 customer purchases stats in one compact row, then the sale rows (records) listed | **Open, needs go** | "the stats can be one row, make it compact. then actually show rows of sales as well. records." |
| Debloat remainder, responsive/compact pass | **Open, in queue (go given)** | "keep going on debloat and responsive" |
| Storefront console 404 | **Open, in queue (go given)** | "then storefront console" |
| P9-9 tagged-stock error | **Open, in queue (go given)** | "p9-9 tagged" |
| Storefront console 404 (follow-up) | **Checked, not reproducible** | Fresh load after deploy: 325 requests all 200, single host, sw precache and icons 200; the first-load message came from the previous service worker fetching a stale chunk. Retest at the next checkpoint. |
