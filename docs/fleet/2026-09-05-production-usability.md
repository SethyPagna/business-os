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

| ID | Required outcome | Evidence needed | Status |
|---|---|---|---|
| P1 | Barcode/name and all product fields survive typing, scanning, rerenders, navigation and save | Reproduced failing case; state lifecycle regression; browser persistence | Investigating |
| P2 | Add products offers Have Already/មានហើយ and New/ថ្មី; shared brand/branch/supplier/received date defaults; explicit child overrides; compact session list | Both modes create/add correctly; scoped stock/AP/audit assertions; no duplicate retry | Design investigation |
| P3 | Barcode first, name second; existing matches highlighted without fuzzy auto-merges | Barcode/name search stale-response tests; server duplicate parity | Design investigation |
| P4 | Multiple transfers/adjustments in one session/action with grouped history and whole-action undo | Atomic bounded batch, conflicts/retry/undo tests; before/after quantities | Open |
| S1 | Authorized users view others' shifts; only owner edits, admin exception; all amendments audited | Backend role/owner/branch matrix, frontend parity, stale revision tests | Investigating |
| S2 | Shift detail shows opening/closing cash/change; POS entry; floating popup on every shift surface | POS/Sales/Expenses/Reports/Profile browser matrix, EN/KM mobile | Investigating |
| S3 | Exact September 4 shift closed with owner's cash data | Identify shift/user/time from session/live evidence; pre/post and no duplicate expenses/report | Main investigating; no write |
| U1 | Current compact navigation has two layers, one topbar row and no bottom bar; legacy remains available | Both modes at 320/375/desktop, no overflow or lost actions | Investigating |
| U2 | Back/discard concise; minus minimizes without losing draft | Dirty navigation, minimize/resume/discard and nested modal tests | Investigating |
| U3 | Sale add-product options above detail popup; editable price/barcode/received date accessible | Nested modal browser interaction and save assertions | Investigating |
| T1 | Telegram gross69 minus4 equals65; no double discount; dual change currencies joined by plus | Real formatter behavioral regression for gross/net legacy callers | Investigating |
| S4 | Manual close; next-day opening prompt; reasoned same-day reopen with retained close history; opening Telegram notice | Lifecycle/revision/audit/concurrent-close/reopen tests; user cash entry preserved | Added after clarification, investigating |
| S5 | Compact shift list: date, open/close, cashier, native cash before/after; secondary ID in existing line; duration/difference/breakdowns in popup/report | EN/KM list/detail at 320/375/desktop; money and duration math | Added, assigned to shift lane |
| D1 | Date presets above endpoints: All time, Today, Last 7 days, Last 30 days, This Month | Ordered presets and date math; browser small-screen placement | Sol low implementing |
| D2 | Sales custom rows-per-page override defaults, date-range results grouped day by day | List/count/date scope and pagination tests across sections | Open |
| V1 | Integrated release preserves membership, grouped sale undo, reports and stock safeguards | Focused regressions then both package gates, isolated committed build, live read-only verification | Pending |

## Agent contracts — initial read-only discovery

All lanes own no source paths yet, may inspect/test locally, and may not deploy,
query production, modify secrets or edit repository files. Main integrates findings,
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
