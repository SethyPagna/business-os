# Four-decimal money and mobile followup

Base2319675f, isolated branch codex/precision-mobile-20260913. Main worktree is dirty and untouched. Last verified live runtime4f903685244b / Worker962c5431-5c8e-43e4-b1dc-68874ce022e9. This document is a work ledger, not a completion claim.

## Owner-approved money contract

- Internal monetary calculation/storage: nearest4 decimal places, decimal midpoint away from zero. Quantities, rates and percentages remain separate domains and must not be rounded as money.
- Sales selling-price default: round upward to cents (1.2345 becomes1.24). Preserve recorded historical values and no-op edits; do not repeatedly ceil calculated discounts or extended costs.
- Receipt and sales presentation:2 decimals. Display strings never become calculation inputs or overwrite precise editable costs.
- Settlement: explicit recorded rounding adjustment for the difference between internal4 total and presented/payable2 total. Owner approved this; no hidden fractional-cent balance or fabricated payment.
- Do not silently recalculate historical transactions, approved import plans, pending review decisions, or undo snapshots. Any new schema is append-only and requires separately recorded production migration authorization before remote application.

## Acceptance and ownership

| ID | Requirement | Current status / owner |
|---|---|---|
| M1 | Exact decimal kernel: nearest4, selling ceil cents, sum/product/division/percent, finite bounds/nulls | Candidate kernel author customer_relationship_review; independent review pending |
| M2 | Preserve4 through product cost forms/import/stock/merge; compare sub-cent changes | Backend cost and frontend form candidates; not deployed |
| M3 | Create/add/edit/discount/refund and settlement parity; explicit adjustment and immutable replay | Versioned schema/contract planning, not implemented or authorized remotely |
| M4 | Profit/cost/report aggregation at4, round only presentation; partition/all-range parity | Audited failures; implementation pending |
| U1 | Mobile page-selection menus: icon above subpage title, like main-page menu; no added content icons | Root navigation interpretation; do not replace existing Back with an unrelated menu glyph |
| U2 | Stock Changes mobile three compact information rows, user first/bold, reference beside barcode, reason horizontal hidden scrollbar, Revert text, no Revert info button | StockChangeSection writer pending assignment |
| U3 | Product names everywhere: up to2 lines, excess reachable horizontally, hidden scrollbar | Shared name-layout design/browser proof pending; never simply clip tail |
| U4 | All date start/end controls fit narrow screens; full values accessible | Shared picker candidate ready; integration/review pending |
| U5 | Remove internal presets where external presets exist; expanded Report date/time/day popup scrolls | Shared picker plus Reports candidates ready; integrated review pending |
| U6 | Calendar previous/next year double arrows alongside month arrows | Shared picker candidate ready; leap/bounds tests pending independent review |
| U7 | Reports option uses spare width; option/filter/Show/vertical-menu only in toolbar | Reports candidate ready; integrated review pending |

## Confirmed initial defects

Actual backend/frontend probes at2319675f show cost1.2345 rounded to1.23 or1.24 before quantity multiplication, four-decimal editable cost lost on no-op save, .0045 balance hidden as zero, .0003*.5 binary rounding wrong, daily rounded costs disagreeing with whole-period aggregate, and cent-only comparisons missing real changes. SQLite REAL does not itself force cents; exact decimal calculation must occur before persistence. Existing default selling-price ceil is an intentional exception, not a cost rule.

Shared date trigger is intrinsically non-shrinkable; absolute21rem popup can exceed320px Report content and lacks scrollable viewport bounds. Reports and StatsRangeRow duplicate external/internal quick presets. Mobile stock-history card currently uses4+ rows. Existing scroll-x-clean is intentionally single-line across many non-name fields; new name behavior must use a scoped component rather than globally changing those rails.

## Verification plan and release constraints

Read-only specialists first, isolated one-owner implementation, exact-decimal golden vectors and real route/SQLite invariants, frontend/backend parity, native browser320/360/390px EN/KM plus desktop, keyboard/scroll/month/year boundaries, focused tests followed by package gates and independent review. No mock-only claim for production or hardware. No deployment until integrated tests and schema compatibility are established. Exact deployment provenance and pre/post data assertions required for any later release.

Previous product leading-zero cleanup remains pending user confirmation:1508 preview groups,20 quarantined,1488 eligible pairs; last verified no new merge receipts/history and8081 active ordinary products. Do not assume the owner clicked or rerun an uncertain write. Gender restoration4162 remains separately verified;858 unsupported non-General customers and4General unchanged. Earlier receipt/hardware and other backlog items remain in the prior ledger, not automatically closed by this followup.
