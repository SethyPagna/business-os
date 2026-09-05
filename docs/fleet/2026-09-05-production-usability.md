# Production usability continuation — September 5, 2026

## Objective and boundaries

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

Release checkpoints are proposed, not deployed: A draft/navigation/date/report
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
