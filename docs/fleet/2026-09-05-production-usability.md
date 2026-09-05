# Production usability continuation — September 5, 2026

## Objective and boundaries

### Current deployed checkpoint — ROUND1, September5 15:35:48UTC

Source `c999e909f4fe91533df84365f1f8eda4015bef76`, Worker
`cfdba0a4-c857-45b1-83ed-af7d1ddade2c`,100% traffic, deployment created
`2026-09-05T15:35:48.077Z`. Stamped deployment exited0; read-only Wrangler
deployment listing independently confirms the version/traffic/time. Cloudflare
MCP transport was unavailable on the final check, so CLI control-plane evidence
was used. Worker stamp hash`3d7c089de946795f`,builtAt`2026-09-05T15:34:10.074Z`;
frontend stamp hash`351e948d3e413299`,builtAt`2026-09-05T15:25:35.741Z`.
Clean detached release used retained real npm-ci dependencies; tracked tree
remained clean. Temporary release auth copy removed; original untouched.

Two separately committed/pushed slices: `61237948` adds report-only768–1023px
side gutters; `c999e909` integrates Archimedes'`6a2e6536` report rounding.
USD summary now folds nativeUSD+convertedKHR once, then uses canonical decimal
half-up cent quantization before the existing display formatter. Table model
uses the same helper for positive/negative ties. KHR/BOTH and the global upward
price formatter remain unchanged. No backend runtime diff from previousa127e37a;
no production data write, migration, secret sync, payment or stock change.

Root cause proven against live read-only data: fees4274–4278 are nativeUSD0,
KHR7000+40000+6000+6000+10000=69000; currentrate4065 yields16.974169741697418USD.
Before: overview summary16.98 vs row16.97. After authenticated live reload:
17sales,revenue1026,refund39,summaryexpenses16.97,row16.97,totalprofit208.15,
finalprofit191.18 unchanged. At840px report gutter16.8px; body scrollwidth840.
No financial data was altered to achieve display parity.

Verification: Noether clean224/224 backend suites including native subtotal
runtime and actual frontend npm test:utils212/212 files PASS at exactc999e909.
Main typechecks,i18n4976keys/519sources,Vite1049modules,stamped dry-run PASS.
Halley independently verified production fixture, mixed-pair single rounding,
positive/negative1.005 ties, unchanged global/KHR/BOTH behavior and tabletCSS.
Main actual release-artifact browser screenshots at320/839/1440 in EN and KM:
no body overflow, gutters0/16.78/43.2px. Local synthetic report summary/row16.97,
finalprofit1444.53 unchanged. Screenshots in output/playwright/rounding-after-*
(local QA artifacts, not production records). Three console failures belonged
to the deliberate local-server restart; no further entries during after-build QA.
Existing circular/large-chunk build warnings remain; no blanket perf certificate.

VIS1 status: PARTIAL / NOT INTEGRATED / NOT DEPLOYED. Ramanujan's isolated
`389244dc4253e5e14a0e821d4e25dc303032f7f3` on
`codex/cashier-foundation-20260905b` is pushed; four unused policy/helper test
files only, focused backend/frontend tests and both typechecks pass. Sagan's
independent adversarial review found P2: SQLite json_extract uses first duplicate
key while canonical JavaScript JSON parsing uses last; {"all":false,"all":true}
can wrongly admit an admin into staff mode. Foundation is not activation-ready.
Required next slice: fix classifier with parity test, then viewer-partitioned
cache, server-authoritative cashier identity, validated server settings, scoped
list/detail/export/aggregate/report queries before pagination, deleted-owner
policy and offline identity/policy cache invalidation. No access policy changed
in this release. Review message0dd70ddd-f5f3-4b0d-b460-3c77f7b6467c retained.

Still partial/not started as previously tracked: broader transfer/adjustment
sessions, universal minimize, full pagination/4dp/security/optimization and
14-reference role/language visual matrices, leading-zero barcode consolidation.
Roune Rath historical close and exact22 subtotal repair are already done; do not
repeat. Telegram destination ACK remains unobserved. Goal remains incomplete.
Recovery for this display-only release is a verified prior application version,
not a DB restore. Historical financial recovery retains its separate safeguards.

### Previous deployed checkpoint — subtotal repair applied, 15:03UTC

Source `a127e37aded0ec7c88a3d0fa06d92bc3b5bda822` deployed14:50:29UTC at100%:
Worker `ac5c708d-2ac6-4e76-b801-4497b38ab4d8`, deployment
`6ed0346f-32a4-4f45-b4e7-a0ce87a09533`. Worker stamp hash
`397201a9685ca15e`,builtAt`2026-09-05T14:48:25.364Z`; frontend stamp hash
`cc35fd9b2d043ede`,builtAt`2026-09-05T14:43:32.631Z`. Control-plane verified.
Clean release preserved both real npm-ci installs; no migration or secret sync.
Temporary release auth copy removed; original credential file untouched.

Verification: final224/224 backend suites (Noether), actual frontend212-file
Windows wrapper (Archimedes), main both typechecks, i18n4976keys/519sources,
build1048modules and stamped dry-run PASS. Sagan independent security/accounting
review closed all P0–P2 findings; source/native/browser evidence reconciled by main.
Local full app preview/cancel/apply proved22 changes and byte-identical protected
data; native Workerd/D1 proves apply22/replay0/stale rollback. EN/mobile320 and
KM/dark/mobile320 body/root width320; desktop1440 and production839px inspected.
Bounded table scroll is intentional; no body overflow. Existing circular chunks
and large-bundle warnings remain, not new errors or a full performance certificate.

Code slices:92fb38a2 exact22 server preview;16eeea7d sales-only cache/broadcast
refresh and bounded finalize body/preview text;a6ccb792 safe operator UI;
b302f159 actual native D1 regression;27a4f3e4 trigger-inclusive change accounting;
99ef9408 shared confirmation/date/navigation guards;a127e37a canonical Khmer label.
Native metadata counts both row and revision-trigger writes; counting changed
primary-key statement slots fixes a false post-commit failure (44 vs22). Atomic
final-state/revision/audit assertions remain authoritative. No production repair
was run before discovering/fixing/retesting that bug.

DONE live14:54:47UTC: Admin1 applied only22 subtotals via normal authenticated UI.
Plan `sep23-subtotal-46e9e6ed-fade-45e8-9ba8-8396c761e17c`, manifest SHA256
`d3a2f99631df1f347820430f2417629a67e2f4a619170a1c6a02e7006caaceb4`.
One grouped non-undoable history245 and audit3799; every revision is1. No duplicate
client history. Backup `backups/cloudflare/business-os-cloudflare-20260905-145420Z.json`
created14:54:20.560Z, finalized object written14:54:46.862Z,52,002,774bytes.
R2 metadata confirms stored object before commit; sidecar raw-GET adapter returns
an envelope error atHTTP200, so no separate sidecar-state claim is made.

| Cohort | Sales | Before subtotal | After / paid USD | Existing item discounts |
|---|---:|---:|---:|---:|
| September2 |5|0|1,992|5|
| September3 |17|0|1,470|61|

Both groups were already paid/completed and remain so; discount data was present,
not discarded. This corrects zero net subtotals, not COGS or gross-price history.
Pre14:50:31/post14:55:09 all protected hashes match:10,273 product stock/cost rows,
20,438 branch-stock rows,47,129 branch-batch rows,35,969 product batches,
23,191 inventory movements,105 allocations,56 cohort items,22 sales excluding
onlysubtotal_usd,13,304receivables,and six shift expense rows. See
`2026-09-05-subtotal-repair-evidence.json` for exact scopes/hashes/provenance.
Live Sep2 report20sales,revenue3,877,COGS3,326.98,totalprofit559.02,expenses19.23,
finalprofit539.79: revenue is no longer incorrectly depressed by zero subtotals.
Live Sep3 report17sales,gross1,531,itemdiscount61,net1,470,COGS1,236.54,
totalprofit233.46 matches reference14 for those figures. Full-day timed filter
shows operatingexpenses0 (legacy expenses use system-entry time per owner), not
the old screenshot's23.70. No expense date/amount was rewritten to force a match.
Browser error log empty; production report screenshot inspected. This does not
certify all responsive variants; remaining edge-spacing/typography work stays open.
Sep4 shift1 remains closed23:44Cambodia/133700KHR/revision1; Sep5 shifts3/4 unchanged.

Recovery: retain backup+immutable manifest/audit; no blanket DB restore over live
business and no generic undo. Any reverse repair requires fresh exact-row/revision
guards and separate authorization. Do not repeat historical settlement/shift close.
UI retry was disabled after success; immutable native replay certified0 updates.

Remaining work is NOT complete: VIS1 full cashier modes/routes/settings (Halley
plan ready); P4 broader transfer/adjustment whole sessions; U2 universal minimize;
D2 full pagination; F1 whole-system4dp audit; barcode consolidation; security/
optimization and full14-reference role/language visual matrix. A separate Today
overview inconsistency (summary expenses16.98 vs row16.97) is assigned Halley
read-only before next slice. Existing P3 backup same-second naming collision and
strict client apply-response validation remain defense-in-depth follow-ups.
Halley follow-up15:08UTC: source path differs—summary passes raw USD+convertedKHR
to the display formatter while table uses nearest-cent rounding. Final profit
subtracts the table value. Main confirmed reportMoney.ts USD branch lacks a
nearest-cent boundary; exact live amount/rate still needs a focused fixture.
Next bounded implementation is reportMoney.ts and reportMoney/reportsHub tests,
preserving KHR/BOTH and global price policy; no code change made this checkpoint.
Telegram close invocation verified previously, destination delivery ACK still
unobserved. Direct health/version probes remain client/edge-blocked; authenticated
app/report/repair work, but no blanket endpoint or whole-goal certification.

### Deployed checkpoint and historical close — 14:03UTC

Source `3f675e84026663b6048ebf6c8cb654410414ec5a` deployed at11:59:26UTC:
Worker `eab56650-5660-4e09-8d26-2a873f24ad05`, deployment
`f2f3ac90-d7ab-4ed3-afbb-586a6862816d`,100% traffic. Stamped CLI source hash
`0b9b63f87d080403`, builtAt`2026-09-05T11:58:02.566Z`; control-plane rechecked
14:02UTC. All runtime rows marked locally ready in the matrix below are now
included in this deployed checkpoint; partial/deferred rows remain partial.

Final gates:223/223 backend;211/211 frontend individual files plus actual full
Windows `npm run test:utils` exit0 at3f675e84 (all211 reachable, mounted Files
regression executed); main both typechecks, i18n4943/517, build1046 and dry-run PASS.
Build still reports existing circular-chunk/large-bundle warnings, not errors.
Live authenticated POS has Shift and configured payment rows; historical popup
opens and saves. Browser error/warning log empty; saved-close screenshot inspected.
Direct health/version navigation is client-blocked and shell probes were edge
challenged, so no blanket public-health/unauthenticated endpoint certification.

MainDB migrations0123–0127 applied, no pending migrations. Standard remote
migrations command and then explicit query batch both rejected0123 with
`incomplete input`; read-only schema/ledger checks proved complete rollback
after each. Independent local Miniflare batch/forced-final-failure controls
passed but did NOT prove remote parser behavior. Native file ingestion solved
the remote parser limitation:23 statements for0123, then59 for0124–0127.
Each artifact compared statement-for-statement with unchanged committed SQL,
strict migration-name INSERTs included; no ignored conflicts or partial tail.
Record this as an open runner/remote-parser guard follow-up, not a SQL logic fix.

| Migration pre/post control | Before = after |
|---|---|
| Sales count / total USD |15077 /1894868.3010|
| Sale-item count / quantity |36307 /58792|
| Product count |10273|
| Branch-stock rows / quantity |20438 /23009|
| Branch-batch-stock rows / quantity |47129 /23038|

All existing sales retained change_is_actual0/change_exchange_rateNULL; nine
new shift triggers present. No active maintenance flag/restore. Recovery bookmark
before migrations:`000012e1-000000e4-000050dd-bb4dfbd47cc6beed87fe1a94fde7dad2`;
after migrations:`000012e1-0000010e-000050dd-5d4e908748260c7c908df73363b6245d`.
Do not restore the entire DB over subsequent business; retain additive schema on
code rollback and replay metadata. No secret sync or importDB migration performed.

S3 DONE: user signed into admin browser. Main closed only shift1/user4 through
the actual guarded UI as Admin1. Fresh rowrev0 and existing fees checked first.
Closing form DOM value2026-09-04T23:44 maps explicitly to Cambodia+07:00.
Stored close `2026-09-04T16:44:00.000Z`,USD0/KHR133700,revision1. Amendment1,
actor1,reason`Historic manual close`,recorded`2026-09-05T14:00:58.900Z`.
UI shows Closed,23:44,8hr32min,opening283700KHR,closing133700KHR,difference
-150000KHR and matching audit. Sep5 shifts3/4 remain openrev0. Six original
fees4268–4273 remain0USD/150000KHR. No duplicate expenses or stock/payment write.
Pre-close recovery bookmark:`000012e1-00000112-000050dd-8cd3e164802ad995bd24faf36f77195d`.
The close route invokes Telegram asynchronously; delivery acknowledgment is not
stored by this implementation and was not observed in the destination chat.

STILL PENDING: fixed22 subtotal repair. Read-only14:03 confirms22 targets,
subtotal0,total3462USD. Runtime is deployed; no financial source repair applied.
The available authenticated browser supports normal UI actions but no injected
mutation requests, and the one-off manifest route has no operator UI yet. Next
bounded slice is a permission-gated preview/apply operator surface for the existing
manifest/digest/revision/backup path (or a supported authenticated API session),
then fresh guards and pre/post certification. Never replace it with unguarded SQL.

### Predeployment checkpoint — 11:48UTC (historical)

Candidate `3f675e84`, deployment pending. Main final clean typechecks, i18n
4943 keys/517 sources, Vite1046 modules and clean stamped dry-run PASS. Backend
223/223 suites PASS at`d6be072c`; backend tree identical at candidate. Frontend
211/211 individual files PASS at`33828c06`; only test registration changed, and
Ohm is running actual Windows `npm run test:utils` at candidate. No waived failures.

Files picker`60cd4f98`: main desktop/320px open-search-close and independent
three-layer queued-product flow PASS. Stock-session native D1 fix`d6be072c`:
main held Retry creates exactly one product/member/operation/history, quantity0
and no batch/movement. Independent native zero/positive/mixed/25-line commit,
undo/redo, retry, stale generation, metadata ABA, permissions and size bounds PASS;
rejections/retries preserve all rows across106 tables. Full live-money/offline
system audit is not implied by this bounded verification.

| State | Requirement IDs and outcome |
|---|---|
| Locally ready for this release | P1/P2/P3: persistent product fields, canonical New/Have Already Add products, shared defaults and overrides, barcode/name duplicate indication, atomic grouped stock-in history/replay. |
| Locally ready for this release | S1/S2/S4/S5/S6: owner/admin edits, view permission, audited amendments/cancellation, manual close and reasoned reopen segments, shift entry/popups/history/report cash breakdowns. |
| Locally ready for this release | U1/U3/U4/U5/D1: compact navigation/header, sale grouped options/layers/stock errors, compact 24h report controls and presets. Main responsive report/branch/product observations recorded below. |
| Locally ready for this release | T1/T2/F2 bounded: Telegram line-discount operands, slash-equivalents vs plus-native tender/change, single report conversion and revenue inclusion. Configured split payment methods/casing/latest-rate and immutable replay included. |
| Locally ready for this release | B1: real branch-scoped rows/statistics, retained grouped columns, financial metrics/detail/permission-gated adjustment. Main1440px/320px Khmer PASS, no overflow or console errors. |
| Partial / deferred | P4 broader transfer/adjustment whole-session parity; U2 minimize capability is consumer-specific, not universal; D2 full section pagination matrix; F1 whole-system4dp migration/audit; full VIS1 cashier visibility routes/settings (helperc82abf64 not integrated); security/optimization and remaining sibling/legacy visual matrix. |
| Non-blocking polish deferred | B1 desktop action cells remain tall (about157px); remaining compactness and full14-reference/role/EN-KM visual matrix are not certified complete. |
| Runtime ready, live operation pending | S3 Roune Rath user4/shift1 close Sep4 at23:44 Cambodia (16:44Z), USD0/KHR133700. Preserve Sep5 shift3 and six existing fees4268–4273 totaling150000KHR. |
| Runtime ready, live operation pending | Fixed22 sales16842–16863 net-subtotal repair3462USD. Preserve stock/payments; exact manifest/revision guards and backup before audited application. |
| Investigated, no consolidation applied | M1 leading-zero barcode merge. Do not auto-merge or average live costs without guarded candidate rehearsal. |

Prior production remains `0ffc4bfcc4fd` / `be276770-359d-4002-9d26-560fa5656d33`.
Prior membership/default/IDs and historical89-sale/100-receivable settlement are
already deployed/applied; never repeat historical settlement. No new schema or
historical mutation at this snapshot. Main alone holds production coordination.
Migration review:0123–0127 additive, old runtime compatible; require no restore
in migration/deploy gap and maintenance flag absent or valid JSON/not restoring.
Rollback retains additive schema and replay provenance; do not restore whole
database over concurrent business. Live browser version endpoint works; shell
403 is an edge challenge, not evidence of application failure or logged-in access.

### ASAP checkpoint status — 11:05UTC

Update11:22UTC: candidate`4e18e98b`. Four backend fixture failures resolved and
retested; original clean run219/223 at`ebf5e027`. Independent central review bounded
PASS; direct-database snapshot-content/member-set hardening remains a tracked
follow-up, not a demonstrated normal-route blocker. Do not label the whole system
security/precision audit complete.

Actual browser blockers, currently assigned:

- ProductForm Open Files crashes because FilePickerModal omits required
  unsavedChanges and hides it with a cast. Galileo fixes, Socrates/main verify.
- Main native Worker POST stock session rejects compound SELECT limits at
  stockSession.ts662. Herschel fixes, Aquinas/main verify on workerd, not just
  better-sqlite3. Zero queued product stays absent until Finish; failed Finish
  leaves products/members/operations unchanged, retained Retry available.

Main real Branch Products desktop+320px Khmer list/detail load, scoped totals2,
stock0 and matching row values; console0, body/root320. Screenshots inspected:
`branch-products-desktop-e4cf.png`, `branch-products-km-mobile-e4cf.png`,
`branch-detail-mobile-e4cf.png` under local output/playwright. Desktop action-cell
row height is a deferred compactness polish, not a blank/loading regression.

Readonly production preflight11:11UTC confirms0122, shift1/3 remain open atrev0,
fixed22 subtotal0/total3462. Recovery bookmark read11:21UTC:
`000012e1-000000da-000050dd-f0299454b793fae1d29370aa8e15ace8` (refresh before apply).
Live HTTP health/version checks return Cloudflare challenge403; no WAF bypass or
security weakening authorized. No migrations, historical edits or deployment yet.

Integrated candidate: `ebf5e027`; last pushed checkpoint: `cc43019b`.
Production remains `0ffc4bfcc4fd`, Worker `be276770-359d-4002-9d26-560fa5656d33`.
This snapshot supersedes older in-progress implementation claims below.

| State | Work |
|---|---|
| Integrated, locally verified | Draft persistence, compact header/navigation/date/report fixes; Telegram arithmetic; shift lifecycle/popups; sale picker; bulk Sales/Returns; payment methods/split settlement/latest-rate/native change; atomic stock sessions and replay; Branch Products rich scoped metrics. |
| Final certification in progress | Clean combined frontend/backend full gates; final canonical Add products toolbar; main product/branch browser checks; independent central replay and nested-layer review. |
| Ready runtime, production operation pending | Fixed22-sale subtotal repair; Roune Rath Sep4 close23:44 Cambodia, USD0/KHR133700. Fresh live guards/backup/pre-post checks required; preserve Sep5 shift and existing150000KHR expenses. |
| Partial/deferred, not released as complete | VIS1 visibility modes across all cashier surfaces; broader precision/security/optimization audit; remaining compactness and sibling-surface polish. |
| Not applied | Leading-zero barcode data consolidation. No broad merge or stock rewrite is bundled into this release. |

Galileo owns final product entry/test assertions, Bernoulli B1 test contract,
Hilbert Inventory fixture loaders, Aquinas central read-only review, Socrates
product read-only review, Ohm independent clean release gates. Main alone integrates,
pushes and deploys. No new feature scope enters this checkpoint unless it fixes a
demonstrated release blocker.

Main verified real nested confirmation screenshot at1440px: child above form,
both parent dialogs inert/hidden, child Cancel restores form. The old build was
then replaced locally for final zero-stock-session checks. Screenshot evidence:
`output/playwright/product-nested-confirm-23e53016.png` (local artifact).
Clean backend sweep at`ebf5e027` exposed two Inventory fixture dependency loaders;
fixes are assigned, not waived. Latest clean frontend sweep at`3ee9b84f` was208/210,
with actionStability and productDiscountUx assertions pending reconciliation.

Make the live Business OS workflows reliable and compact before broader optimization.
Continue from integration `d3e95fb3` / deployed runtime `0ffc4bfc`, not dirty main.
The native Codex goal remains paused; available goal tools cannot edit/resume it.
This document refines acceptance and coordination, not a completion claim.

Preserve concurrent business activity and unrelated working-tree changes. Historical
settlement is already applied (89 sales, 100 receivables): never reapply it. No
stock changes are authorized as part of historical payment or shift correction.
Production changes require exact targets, fresh guards, pre/post assertions and
recovery evidence. Never infer a closing timestamp or user from a calendar date.

## Acceptance matrix

September5 owner checkpoint additions (all earlier rows remain in scope):

- F3: KHR output converts source amounts exactly once. Preserve native tender
  currencies and stored financial data; equivalents are not additional payments.
- PAY1: awaiting-payment settlement selects configured payment methods and supports
  multiple method/amount rows like POS. Validate methods, sums, remaining balance,
  retries and permission on the server. Payment alone must not move stock.
- PAY2: payment-method identity and casing are canonical: Fcb renamed FCB displays
  FCB in current selectors/readers, with no duplicate case variant. Retain original
  audit evidence. Separate Sales/bulk coordinator owns settlement; management
  file ownership must be allocated before a second writer starts.
- P4/U4 expansion: transfer, remove, set quantity and Add products (existing/new)
  use grouped family search followed by floating POS-style options. Newest surface
  stays above its parent, which is inactive; closing returns to the previous layer.
  Galileo/Herschel own session UI/API; Volta supplies sale-picker reuse contract.
- All14 reference PNG paths checked present. References1–2 guide navigation;
  3–5/14 lined reports and filters;6–13 grouped breakdowns. Visual certification
  must compare against them, not merely pass source tests.

Historical initial plan (current statuses are in the table above):
Release checkpoints were proposed: A draft/navigation/date/report
display fixes; B shift lifecycle/pickers/payment workflows; C atomic stock sessions
and broader precision. Each fix remains a separate commit, with explicit dependent
commits, focused tests, integrated gates and deployment provenance. Historical
data corrections are separate guarded operations, never hidden in UI releases.

| ID | Required outcome | Evidence needed | Status |
|---|---|---|---|
| P1 | Barcode/name and all product fields survive typing, scanning, rerenders, navigation and save | Reproduced failing case; state lifecycle regression; browser persistence | First fix integrated d2f25971; legacy draft/unmount follow-up and browser certification pending |
| P2 | Add products offers Have Already/មានហើយ and New/ថ្មី; shared brand/branch/supplier/received date defaults; explicit child overrides; compact session list | Both modes create/add correctly; scoped stock/AP/audit assertions; no duplicate retry | Design investigation |
| P3 | Barcode first, name second; existing matches highlighted without fuzzy auto-merges | Barcode/name search stale-response tests; server duplicate parity | Design investigation |
| P4 | Multiple transfers/adjustments in one session/action with grouped history and whole-action undo | Atomic bounded batch, conflicts/retry/undo tests; before/after quantities | Open |
| S1 | Authorized users view others' shifts; only owner edits, admin exception; all amendments audited | Backend role/owner/branch matrix, frontend parity, stale revision tests | Investigating |
| S2 | Shift detail shows opening/closing cash/change; POS entry; floating popup on every shift surface | POS/Sales/Expenses/Reports/Profile browser matrix, EN/KM mobile | Investigating |
| S3 | Exact September 4 shift closed with owner's cash data | Identify shift/user/time from session/live evidence; pre/post and no duplicate expenses/report | Main investigating; no write |
| U1 | Current compact navigation has two layers, one topbar row and no bottom bar; legacy remains available | Both modes at 320/375/desktop, no overflow or lost actions | Integrated 621bf4d9 + 8be01e6c; focused tests pass, browser certification pending |
| U2 | Back/discard concise; minus minimizes without losing draft | Dirty navigation, minimize/resume/discard and nested modal tests | Investigating |
| U3 | Sale add-product options above detail popup; editable price/barcode/received date accessible | Nested modal browser interaction and save assertions | Investigating |
| T1 | Telegram gross69 minus4 equals65; no double discount; dual change currencies joined by plus | Real formatter behavioral regression for gross/net legacy callers | Investigating |
| S4 | Manual close; next-day opening prompt; reasoned same-day reopen with retained close history; opening Telegram notice | Lifecycle/revision/audit/concurrent-close/reopen tests; user cash entry preserved | Added after clarification, investigating |
| S5 | Compact shift list: date, open/close, cashier, native cash before/after; secondary ID in existing line; duration/difference/breakdowns in popup/report | EN/KM list/detail at 320/375/desktop; money and duration math | Added, assigned to shift lane |
| D1 | Date presets above endpoints: All time, Today, Last 7 days, Last 30 days, This Month | Ordered presets and date math; browser small-screen placement | Integrated; focused tests pass; browser certification pending |
| D2 | Sales custom rows-per-page override defaults, date-range results grouped day by day | List/count/date scope and pagination tests across sections | Open |
| U4 | Sales add-item search groups variants; click opens POS-style options; immediate No Stock/Not Enough Stock errors | Zero/over/staged-quantity/batch checks, server race rejection, sibling standalone picker | Assigned Volta |
| S6 | Shift history in Users/each user/Reports, removed from Settings; admin audited soft cancellation retains details | Placement/browser matrix; nonadmin denial; cancellation/revision/report lifecycle | Assigned Socrates + Hubble |
| B1 | Branch Products section and stats render real scoped data and retained grouped columns | Reproduce blank response/UI, source/history comparison, branch isolation tests | Hilbert queued after D2 |
| M1 | Merge groups differing only in leading-zero barcode; average distinct costs per owner | Exact candidate manifest, aliases/stock/sales references, guarded rehearsal/pre/post/recovery | Astra architect audit; no live mutation |
| F1 | Four-decimal internal calculations system-wide; display/cash semantics explicit | Canonical math and reader/writer matrix, division/rounding/ledger/replay parity | Owner confirmed nearest, fifth digit 5+ up / 0–4 down; Pauli implementing bounded helpers/fixtures before writer migration |
| T2 | Currency equivalents use slash (Net Total); actual mixed tender/change uses plus | Derived-vs-native field trace, real formatter fixtures across sales/returns | Queued Volta after picker |
| V1 | Integrated release preserves membership, grouped sale undo, reports and stock safeguards | Focused regressions then both package gates, isolated committed build, live read-only verification | Pending |
| F2 | Trace and correct each report row, USD/KHR conversion, delivery/expense/COGS, totals and exports | Actual model+formatter and backend fixtures, no double conversion/counting, row arithmetic closes; distinguish source-data issues | Pauli Sol high assigned; screenshot expense double-conversion suspect |
| U5 | Compact Overview selector and range row; no decorative calendar icon; consistent 24h time controls and desktop typography/gutters with nearby values | Narrow and desktop EN/KM browser checks; every time filter maps to real backend scope | Bernoulli assigned layout scope review; preserve date presets and shift integration |

## Agent contracts — initial read-only discovery

Initial discovery lanes were read-only. The subsequent isolated write allocations
below supersede that initial restriction only for their named paths. No agent may
deploy, query production or modify secrets. Main integrates findings,
assigns disjoint isolated writers and independently verifies. Stop on overlap or
unsafe data assumptions. Durable handoffs use original checkout's team-state tool.

| Task | Agent | Model / effort | Bounded output |
|---|---|---|---|
| Product state/session | Galileo `01a07019-100d-7c93-bc87-bd252d4c6911` | Sol high | Root cause, flow/stock contract, write set, regressions |
| Shift ownership/UI | Socrates `01a07019-11ff-7f02-99ad-4bdab02aa8aa` | Sol high | Permission and popup surface matrix, write set, regressions |
| Navigation/layering | Bernoulli `01a07019-1387-7e01-a6ee-7c1142d8b0b3` | Sol high | Topbar/nav/dialog causes and bounded patch plan |
| Telegram equations | Volta `01a07019-156c-7402-b6e7-1c077dd06ad3` | Sol medium | Actual input semantics, minimal formatter correction/tests |
| Date presets | Hilbert `01a07021-dd9a-7fe1-af1e-8f88d495f082` | Sol low | Exact DateTimeRangePicker.tsx + dateEntrySurfaces.test.ts in isolated date-presets worktree |

Telegram discovery complete: existing line operand uses net applied price while
also printing item discount. Isolated writer owns telegram.ts and its message
test only; preserve authoritative net totals/header math. Do not double subtract.

Navigation discovery confirmed unconditional compact bottom bar and forced 7rem
two-row current-mode header. Bernoulli now owns isolated shell-only implementation
(App, Sidebar, BackgroundImportTracker, NotesWidget and navigation tests); sale
picker and shared prompt are queued separately to prevent overlapping writes.
Existing inline group expansion is retained rather than rebuilt.

Tracking rule reiterated by owner: append new notes to matching IDs, preserve
earlier acceptance, record supersession explicitly, and never equate discovery
or a worker's green tests with integrated/released/visually verified completion.

Main owns this document, progress checkpoint, live shift investigation and final
  integration/release. Existing production Cloudflare challenges prevented previous
authenticated verification; do not treat prior builds as live behavior proof.

## Live shift preflight (read-only, September 5 ~05:47 UTC)

- Shift 1 `S-20260904-1511`, user 4, business date September 4, opened
  `2026-09-04T08:11:09.183Z`, 283700 KHR / 0 USD, branch null, revision 0,
  still open with no amendments. Exact closing time requested from owner.
- Shift 3 for the same user September 5 opens with 133700 KHR; preserve it.
- Shift 2 is an admin September 5 record with an existing note calling its data
  wrong. Do not infer deletion permission from the stored note; leave untouched.
- Existing fee IDs 4268–4273 on September 4 sum 150000 KHR: 6000,30000,20000,
  14000,50000,30000. No duplicates should be inserted. All are currently typed
  delivery, despite two being described as expenses by owner; do not silently
  recategorize or rename the different courier label.
- First four fees precede the recorded shift opening. Window-scoped report will
  not include those 70000 KHR. Owner cash arithmetic is correct but operational
  timestamp attribution is unresolved; no fabricated earlier opening timestamp.
- Both D1 queries report zero writes. No closure, expense edit, Telegram send or
  stock change performed in this continuation.

## Follow-up evidence / integration

- Current awaiting-payment query found one new September 5 sale 16889, $27.50;
  outside historical cohort and preserved under normal payment process.
- Actual YSL example is sale 16891: base $73, applied $69, manual discount $4,
  line total $69. Correct display is $73 minus $4 = $69; no authorization inferred
  to reduce this live sale to $65. Owner informed. Generic base69/net65 fixture
  verifies the requested arithmetic format without double discounting.
- Integrated date commits `8594504c`, `812303f4` (worker originals 4ee8245d,
  4d01d9fb), Telegram `44fb2106` (1121dfca). Main reran date-entry surfaces,
  stats-strip, Telegram message/bilingual and shift-report tests: all pass.
  These are integrated, not yet deployed or fully visually certified.
- Main local real-browser baseline: create session -> Add item -> type name and
  barcode -> Pricing -> type prices -> Basic Info wipes all input except unit.
  Screenshot `output/playwright/product-draft-baseline-cleared.png`; synthetic
  local data only. Product worker notified; this interaction must pass post-fix.
- Shift backend Socrates now owns shifts.ts / lifecycle tests / append-only0123
  linked reopen-segment migration. Hubble `01a0702b-e73c-7f80-9dde-13165a0a2b02`
  (Sol high) owns isolated shift frontend/transport/POS/Profile and shift language
  keys. Exact API contract coordinated before frontend write. Main owns live data.

## Verification checkpoint after integration 8be01e6c

- Main independently reran hubSectionNav and sectionNavigation tests: both pass.
  Current-mode direct theme/language/header actions were retained in follow-up;
  source tests are not a substitute for the pending 320px EN/KM browser check.
- Product first patch d2f25971 is integrated. Main found a CRLF-sensitive source
  test plus legacy draft migration and last-800ms unmount preservation gaps;
  Galileo owns the follow-up. Do not certify draft reliability yet.
- Pauli's F1 read-only audit finds cent rounding before line aggregation, mixed
  always-up/nearest semantics, imports truncating costs, and offline replay using
  current formulas despite byte-stable fingerprints. A blanket round2-to-round4
  replacement is rejected. Owner subsequently confirmed fifth digit 5+ rounds up,
  0–4 rounds down (four-place nearest; not always ceiling). Negative reversals
  use the same magnitude rule to preserve sign symmetry. Pauli owns the initial
  helper/fixture/test slice only; production formulas are not changed yet;
  versioned calculation, settlement/display separation and historical undo
  fidelity are explicit release prerequisites for that separate financial slice.
- Shift backend draft includes linked reopen segments and soft cancellation.
  Main flagged cancelled-parent amendment parity for Socrates. Migration 0123
  remains local/unapplied; no live shift has been closed or cancelled.
- Remaining work is intentionally open: unified Add products/stock atomicity,
  picker group/stock behavior, branch products/stats, pagination, shift UI/API
  integration, currency-equivalence labels, barcode candidate surgery, precision,
  full certification and deployment. No scope item is removed by a newer note.

## Browser and ownership follow-up

- At 375px, product name/barcode and cost10/sell15 survive Basic/Pricing switching
  after 8f656861 (baseline erased them). Successful local synthetic create keeps
  name/barcode/cost10/sell15 in the authoritative cost_price_usd/selling_price_usd
  columns and product card. Initial main query checked legacy purchase_price_usd
  (0), a false-positive cost-loss finding; corrected after inspecting the full
  cost/price fields. No cost fix is required for this verified scenario.
- Main visually inspected 320px EN/KM header screenshots: back/title/notification/
  theme/language/account share one row, 44px controls, document width320 matches
  viewport. Product-section tabs remain horizontally scrollable inside their
  own strip; full navigation/legacy-mode matrix remains pending.
- Shared preservation-capability prompt integrated106376df; main guard and modal
  placement tests pass. Consumer hookups remain explicit, not implied by a draft.
- Herschel (Sol high, 01a07055-2ec4-7753-a367-cb6e0cdba643) owns isolated stock
  session backend milestone A, migration0124 reserved/unapplied. Receipt/create
  atomicity and retry deduplication first; undo/backup milestone later gated.
- Aquinas (Sol high, 01a07050-d68d-7100-a6c3-e9475f87a338) independently reviews
  shift backend99902cea/frontend737ab4e7 read-only before integration.
- Separate user task01a0704d-6ac3-7530-890b-40443a5b17f9 owns new conditional
  Sales bulk status/payment/driver/customer, Returns bulk dialogs/actions and
  export placements. Exact route/UI claims coordinated; its undoAppliers.ts and
  actionHistory.ts ownership precedes stock milestone B. No duplicate writer.
  Main continues current shift/product/picker/precision/branch scope.

## Independent shift review — release held

Aquinas reproduced four blockers at backend99902cea/frontend737ab4e7 despite
existing focused/typecheck/backup suites passing: concurrent amend/close could
report closed while stored open; missing caller expected_revision permits stale
sequential count overwrite; blank amendment counts silently become zero; Telegram
omits cancellation and calls a cancelled record still open. Socrates owns route
and regression corrections, Hubble caller revision/count/audit refresh, Volta
Telegram cancellation projection/formatter alongside equivalent-currency labels.
No migration/deployment/production shift mutation is cleared by earlier tests.

Precision foundation integrateddd8d719e: main reran46backend and47frontend shared
fixture checks plus existingPOSrounding test, allpass. This establishes the owner
rounding rule; runtime sales/returns/import/report formulas are NOT migrated yet.
Next financial writer slice waits for separately owned Sales/Returns bulk work;
exact decimal arithmetic operations and replay versions remain explicit work.
Cross-task Returns migration0125 is reserved; backup/coreDataInvariants and
frontend actionHistory/ActionHistoryBar ownership also precedes stock milestoneB.

## New screenshot request — conversion and report layout

Reference codex-clipboard-b0b57de4-3e67-4d90-9706-b6caf0e86c36.png, range Aug30
00:00–Sep5 23:59. Displayed totalprofit -1219.38 minus expenses5623.87 should
equal -6843.25, but screenshot final is -6751.31. Main traced expense line carrying
already converted USD plus rawKHR into a pair-converting formatter; Pauli owns
behavioral reproduction and full sibling math audit. This is not authorization
to rewrite historical fee/cost values. Courier row visibly29.36, COGS10185.02;
large source values need separate provenance/unit checks, not guessed repairs.
User requests consistent time-enabled 24h filters; backend overview currently
date-scopes returns/expenses, so no false promise from adding time UI alone.

Read-only production verification September5 ~07:15UTC: configuredmainrate4065;
Aug30–Sep5 fees27 rows = USD5440 + KHR373700 (delivery13 USD0/KHR260200;
expense14 USD5440/KHR113500). Single conversion yields5531.93, and
-1219.38 -5531.93 = -6751.31 exactly matches screenshotFinalProfit. LargeUSDfees
are explicitly storedUSD (Aug31 items including utilities/food/Boost/payroll/
other/bags), not inferredriel. COGS263lines/467units/122noncancelledsales totals
10185.0195; sale net8924. ThusCOGS10185.02 is sourced, not display unit inflation.
No source financial records changed. One exploratoryquery used nonexistent
sales.status and failed; correctedsale_status query succeeded. All queries
reportedzero writes. Sourcecost validity remains distinct from sum correctness.

## Owner decision and source-data follow-up

- Checkpoint10:26UTC: main integrated payment chain091b6da4 through882bec3d,
  preserving original central hooks (not older-baseline backport variants) and
  existing stock receipts. Locale tail conflict retained all existing/new keys.
  Main reran payment-settlement5groups, payment-FX10groups, payment-method-route,
  sale-add-items13groups, native-change13, stock-atomic16, stock-undo21, central17;
  all pass. Both package typechecks and i18n4941keys/517sources pass. A mistakenly
  attempted test-sale-settlement-action-pure.cjs does not exist; actual settlement
  replay coverage is test-payment-fx-pure.cjs plus central tests, not that filename.
  Independent Aquinas combined zero-only HTTP/history matrix passes true
  inventory:false/products:add-full across mounted/unmounted routes, denies
  positive/mixed/other routes and review/disabled permissions, with pre-fix negative
  controls. Main stock replay rerun passes on actual integrated source.
  Release blockers remain explicit: new sale.add_items snapshots need atomic
  revision/status/allocation/receipt/history replay (Herschel); product nested
  layers/queued editing/zero atomic UI (Galileo); Branch Products rich columns,
  grouped rows and scoped stats (Bernoulli) plus bounded per-page financial metric
  enrichment (Hilbert, newly allocated inventory.ts only plus new test).
  Main flagged derived-KHR integer rounding versus internal4dp and epsilon-based
  new tender validation; payment owner is correcting with focused tests. Plato
  independently checks subtotal runtime61e5a48f. No new production deployment or
  financial/stock/shift data correction. Source repair and historical close need
  fresh guarded live preflight after the verified release.

- Main browser17f46b69: desktop controls now share a compact row, five presets,
  no decorative calendar icon;320px document=viewport320. Endpoints09:15/23:44
  survive1440→320→1440. End08:00 rejected with aria-invalid and visible alert;
  committed23:44 remains and correcting it clears rejection. Screenshots
  output/playwright/report-desktop-17f46b69.png and report-mobile-17f46b69.png
  visually inspected. Local fixture4240 historical fees createdSep5 explain
  selected-time expenses149799.01:129696.60USD+82419900KHR/4100 exactly once.
  No live data inference or modification. Main localWorker now45104/8798.
  Plato shift fixture proves23:44 close/nativecash and permission parity, but
  cancellation lacks Telegram schedule; assigned own shifts.ts/test fix.
  POS actualchange was lost and Telegram drawer treated anychange as ambiguous;
  payment coordinator owns explicitintent+validatedmarker/rate migration0127
  and bounded telegram.ts aggregation, preserving historicalunknown records.
  Product reviewer identified hidden child confirmations, image permission and
  existinglot supplier mismatch. Galileo fixes UI/sharedoptionalchildlayers;
  Hilbert products.ts image action gate. Turing01a070f2-26da-7281-afb5-61c50452ea1c
  (Sol high) owns released stockSession.ts/atomic+undo tests for qty0catalogonly
  sessions. Herschel remains sole centralpaymentundo/history/backup writer.
  Pauli owns typed allowlisted fixed22-row repair implementation, no rawSQL,
  no production invocation. Every new path is isolated/claimed; finalgatepending.

- Capacity checkpoint09:24UTC: new Plato (Sol high,01a070db-c205-7571-bc16-366e0cbec68a)
  read-only shift integration; Ohm (Sol medium,01a070db-c592-7f31-9c18-7c3f5bde7e8f)
  read-only release provenance/migrations. Socrates independently checks product
  UI/API; Aquinas cleared stock correction1a512cec using real AP SQL and failing
  parent negative control (durablecdeae05f). Bernoulli/Hubble completed handoffs
  retained and agents closed to reuse slots. Every writer remains isolated and
  bounded, main alone integrates/deploys. No zero-bug claim from passing tests.
  Clean aaea5027 suite206/207 frontend and212/216 backend: main91693b2e/fd768a7c
  correct keyed-content source assertion and missing fixture dependencies/receipt
  seeds with focused tests passing; sale-add-items loader assigned FX owner.
  Galileo604e/ddfa fixes1-3 ready, zero-stock session atomicity/detail editing/
  received override still open. Historical22-sale repair has no existing native
  batch executor; typed allowlisted extension requires separately reviewed code,
  not raw REST SQL assumed atomic. No live correction or deployment performed.

- Checkpoint September5 09:00UTC: integrated stock undo/backup e6c34712/a87af5a9
  and test alignment b490c47c. Main local atomic12/undo15/backup4 passed, but
  independent review95f222b7 found a P1: receive A/credit, undo, then receive
  B/paid on the same date may reuse zero lot with A/credit metadata and false AP.
  Herschel owns correction and receive-after-undo regression; not certified.
  Clean release baseline4df2ecfa passed214 backend suites, frontend205/206;
  sole stale stats entry-time expectation fixed c676d4fe and retested. Final
  clean gates must repeat after all ready commits. Report desktop67d08f8c removes
  icon, groups controls/presets, narrows value distance and rejects reversed
  same-day times; main responsive/report/stats suites pass. Bernoulli owns the
  separate HubSectionNav remount issue which resets times on viewport resize.
  Product unified session and payment/FX not yet ready. No new production write.

- Independent re-certification75bdd89a at8799589b clears all four original shift
  blockers with actual route probes and faulty in-memory negative controls;
  close-report25, frontend78/60, lifecycle/security/report/window/Telegram pass.
  Stock atomic12 also clears prior batch identity and snapshot race failures.
  Stock undo/backup and full release certification remain separate gates.
- Main integrated report time90cfe2a9, responsive layoutf4ee0b97, B1 branch
  products4c5d2a13, stock corefa881cda/eed9aaea and bulk final38db993a. Full frontend
  chain passed before final report additions; integrated report tests pass after
  updating their old daily-window expectations and adding continuous-time tests.
  Backend sweep213 had only shift audit-census failure; stronger atomic audit
  contract8799589b now passes59checks. No failure is waived as merely cosmetic.
  Latest B1 i18n missing key corrected423d175e;4929keys/515sources pass. Latest
  frontend build/typecheck and backendtypecheck passed; final immutable gates
  still need rerun after pending stock/payment/UI commits.
- Main real browser320EN: POS Cart Shift button opens centered floating history,
  documentwidth320 equals viewport320; screenshot visually inspected. Reports
  loads real synthetic API data, exact five presets and24h endpoints visible,
  no document overflow; responsive screenshot inspected. These fixtures contain
  no production records and do not certify actual Telegram delivery.

- S3 clarification received: close Roune Rath Sep4 at23:44 Cambodia, exactly
  2026-09-04T16:44:00.000Z, closing133700KHR/0USD. Supersedes earlier unresolved
  time blocker. Fresh live row/revision/overlap checks and audited close remain
  pending; Sep5 shift and existing expenses must stay untouched.

- Release priority: current UI/report/shift/picker/branch/stock/bulk scope before
  unrelated backlog. Main integrated picker f6314203/10046f64/e8b8628f; bulk through
  caa7ad21; shifts/Telegram through189f17a1; product followups d1e8658f/e8e1c97c.
  Main focused product, picker, shift lifecycle/security/report, Telegram and
  sale/return bulk tests pass. Mistyped Telegram shift test path did not exist;
  corrected to test-shift-report-pure.cjs and passed. Full gates still pending.
- New VIS1: one non-conflicting visibility mode self / all-except-admin /
  all-including-admin across sales/returns/expenses and cashier selectors. Keep
  branch and other access checks; unauthorized users cannot elevate themselves.
- New FX1: on sale update use latest server rate for updated calculations/change;
  preserve previous native payments/audit records. Define retry/undo behavior
  explicitly; do not retroactively revalue every historical transaction.
- Independent stock review reproduced wrong explicit-batch return attribution
  and incoherent snapshot/revision race despite seven tests passing. Also reject
  boolean quantity instead of coercing to1. Herschel owns corrections. Missing
  stock.session undo registration and backup preservation remain release gates.

- Stock milestoneA candidate ee2711a8 contains atomic receive/create sessions.
  Main reran test-stock-session-atomic.cjs:7 PASS (rollback, lost acknowledgement,
  payload conflict, accumulation, ABA revision, create atomicity,25-line bound).
  Not integrated/deployed. Aquinas assigned independent read-only certification;
  Herschel completed and temporarily closed for capacity, backend claim reserved.
  Transfer/remove/set and undo/backup remain pending separate commits.

- Owner explicitly selects system entry time for older expenses in time-filtered
  reports. Preserve expense_date; never invent historical transaction times.
  Pauli owns the report contract and boundary/timezone regression coverage;
  Bernoulli consumes that contract for time-enabled controls.
- Read-only audit found 22 zero-subtotal, positive-total paid sales, ids16842–16863,
  totaling3462 (Sep3:1470; Sep2:1992). The Sep2–3 import record and original planner
  identify the same cohort: its first INSERT omitted subtotal_usd. Integration's
  planner already contains a forward correction, which does not repair live rows.
  A separate Aug10 sale16827 total2 is outside this cohort and must not be folded
  into a blanket repair. Prepare exact before-state and guarded recovery/audit
  evidence before any production correction; preserve totals, received payments,
  statuses, item rows and stock. No live repair applied in this continuation.
