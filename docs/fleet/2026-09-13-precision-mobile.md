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
| M1 | Exact decimal kernel: nearest4, selling ceil cents, sum/product/division/percent, finite bounds/nulls | Integrated; independent rational-oracle and native parity checks passed, including exact quantity remainder handling |
| M2 | Preserve4 through product cost forms/import/stock/merge; compare sub-cent changes | Form/import/stock/merge candidates integrated and scoped-reviewed; manual save/review writer versioning still underway; not deployed |
| M3 | Create/add/edit/discount/refund and settlement parity; explicit adjustment and immutable replay | Versioned schema/contract planning, not implemented or authorized remotely |
| M4 | Profit/cost/report aggregation at4, round only presentation; partition/all-range parity | Audited failures; implementation pending |
| U1 | Mobile page-selection menus: icon above subpage title, like main-page menu; no added content icons | Integrated; actual Sidebar EN/KM320/390 verified; existing Back and permissions preserved |
| U2 | Stock Changes mobile three compact information rows, user first/bold, reference beside barcode, reason horizontal hidden scrollbar, Revert text, no Revert info button | Integrated; composed EN/KM320/390 test covers full text, overflow and exactly-once two-step Revert against local mock |
| U3 | Product names everywhere: up to2 lines, excess reachable horizontally, hidden scrollbar | Shared rail plus23 name nodes in14 catalogue components and StockChange integrated; sale/CartItem owner surfaces remain pending |
| U4 | All date start/end controls fit narrow screens; full values accessible | Shared picker integrated; actual narrow StatsRangeRow native checks pass; full-app every-caller certification not claimed |
| U5 | Remove internal presets where external presets exist; expanded Report date/time/day popup scrolls | Integrated; composed Reports native EN/KM320/390 passes; cold-start fixture readiness improved without changing behavior assertions |
| U6 | Calendar previous/next year double arrows alongside month arrows | Integrated; native leap-year and month/year boundary checks passed |
| U7 | Reports option uses spare width; option/filter/Show/vertical-menu only in toolbar | Integrated; composed native Reports fixture passed twice, exact remaining width and four-control row |

## Confirmed initial defects

Actual backend/frontend probes at2319675f show cost1.2345 rounded to1.23 or1.24 before quantity multiplication, four-decimal editable cost lost on no-op save, .0045 balance hidden as zero, .0003*.5 binary rounding wrong, daily rounded costs disagreeing with whole-period aggregate, and cent-only comparisons missing real changes. SQLite REAL does not itself force cents; exact decimal calculation must occur before persistence. Existing default selling-price ceil is an intentional exception, not a cost rule.

Shared date trigger is intrinsically non-shrinkable; absolute21rem popup can exceed320px Report content and lacks scrollable viewport bounds. Reports and StatsRangeRow duplicate external/internal quick presets. Mobile stock-history card currently uses4+ rows. Existing scroll-x-clean is intentionally single-line across many non-name fields; new name behavior must use a scoped component rather than globally changing those rails.

## Verification plan and release constraints

Read-only specialists first, isolated one-owner implementation, exact-decimal golden vectors and real route/SQLite invariants, frontend/backend parity, native browser320/360/390px EN/KM plus desktop, keyboard/scroll/month/year boundaries, focused tests followed by package gates and independent review. No mock-only claim for production or hardware. No deployment until integrated tests and schema compatibility are established. Exact deployment provenance and pre/post data assertions required for any later release.

Previous product leading-zero cleanup remains pending user confirmation:1508 preview groups,20 quarantined,1488 eligible pairs; last verified no new merge receipts/history and8081 active ordinary products. Do not assume the owner clicked or rerun an uncertain write. Gender restoration4162 remains separately verified;858 unsupported non-General customers and4General unchanged. Earlier receipt/hardware and other backlog items remain in the prior ledger, not automatically closed by this followup.

## Integration checkpoint — September13, not deployed

Candidate05aadd6f combines exact kernel, scoped backend cost writers, frontend editable costs and nearest4 merge parity, mobile menu/stock/name/date/report changes and composed native tests. No production mutation, schema migration or deployment has occurred for this candidate.

Independent review caught and repairs resolved: raw negative sub-tick batch costs losing their sign; stock-import selling inputs quantized before ceiling; missing real dependencies in undo/transfer test loaders; unit costs derived from already-rounded totals; quantity coverage tolerance dropping tiny positive stock; and frontend merged-cost ceil4 disagreeing with backend nearest4. Historical v1 merge plans and generic legacy sales-import rounding remain unchanged.

At dcabdc7c the first complete frontend chain was394/398: three obsolete layout/kernel assertions and one real merged-cost runtime parity failure. Repairs are integrated; second complete chain at05aadd6f is running. Production build/startup graph checks passed at the earlier candidate (1154 modules,260 chunks,zero cycles). Final candidate gates must be rerun after remaining runtime edits.

Backend scoped independent checks passed at dcabdc7c: kernel, movement costs, actual batch routes, cost writers, stock import,15 native transfer-cost cases and Worker typecheck. This does not certify settlement, refunds or report precision. Manual cost save/review versioning is the next identified end-to-end gap; server-owned plans must preserve old approvals and reject stale or downgraded changes.

M3/M4 remain unimplemented. Proposed explicit calculated-total/rounding-adjustment/version columns are a reviewed local architecture only, not an applied migration. Existing sales payable semantics and saved KHR tender/rates must remain stable. Do not describe application-wide four-decimal calculations or settlement adjustments as finished.

## Owner migration authorization and next gate

Owner answered **Yes, after verification** to adding calculated-total, rounding-adjustment and precision-version fields to sales and returns. This authorizes the described additive production migration only after local verification; historical amounts must stay unchanged. No remote migration has run. The root goal now tracks precision/settlement/report parity, requested mobile fixes, independent verification and release provenance.

The complete frontend chain at05aadd6f passed400/400 files with zero skips. Later SaleDetail/CartItem name changes and manual product-write policy require a fresh final gate. Candidatecd325d27 includes their initial versions, but independent product-write review found three blockers: fresh nonmoney review payloads could gain unvalidated money on resubmit; group rename side effects preceded a failed money CAS; and a stale expectedUpdatedAt could adopt a newer snapshot. Author repairs are underway with immutable policy markers on every new request and atomic source/destination group snapshots; do not deploy the initial version.

## Later local checkpoint — no production changes

Manual product-write repair2afaf51b is integrated as8e68ba3f and independently passed all three original repros,31 adversarial cases and exact500KB boundary tests. Generic review apply/mark idempotency is still outside certification.

Inert Wave1 migration0158 and pure sale/refund contracts are integrated as7532eede. Independent SQLite oracle passed756 sale cases/756 invalid equations/150 cumulative refunds; native D1 oracle passed752 sale cases/150 refunds/42 invalid refusals. Old columns/revisions remain unchanged. This is a local migration file only: operational backup/recovery and remote migration remain undone.

Root05f3768d includes frontend helper/promotion/Records checkpoints and EN/KM labels. Records tests and i18n5775 keys passed together. Independent helper review found weak canonical receipt validation, an incomplete retry-body acceptance, stale promotion base fields, and exact promotion line totals lost through rounded per-unit reconstruction. Repairs are in the frontend author's isolated worktree; do not activate this checkpoint.

Active Wave2 worktrees: backend bos-sale-money-writers-20260913 (customer_relationship_review, claim18514c6b) and frontend bos-frontend-sale-money-v1-20260913 (urgent_status_frontend, claim38e2db69). Their normal-sale caller changes are unfinished/uncommitted and must not be treated as integrated or deployable. Both preserve v0 replay, use saved sale exchange rate for v1 basket/payment conversion, retain actual tender denominations and separate change-rate policy, and require server-canonical receipt results. Old checkout IDs lacking a full frozen body require read-only receipt recovery, never reconstruction.

Pending owner answers: partial refunds using net paid item entitlement including receipt-level discount/tax; and extending the additive migration to per-item pricing snapshots. No authority has been inferred for the latter. Exact quantity-save promotions require authoritative line amounts and original rule provenance; quantity edits should re-evaluate the captured original rule at the new quantity rather than current catalogue rules or proportionally preserve an ineligible threshold deal. Missing provenance must refuse/review, not invent totals.

M4 minimum design does not require extra scaled-integer item columns: read existing canonical v1 line totals and captured cost/quantity scalars, compute with exact decimal arithmetic and bounded BigInt accumulation, never binary SQL multiplication or summing presented cents. A v1 parent must guarantee all children are canonical4; legacy lost digits cannot be reconstructed. Named net rounding is reconciliation disclosure; refund payout is subtracted once, never twice. Implementation and realistic performance verification remain pending.

## Continuing adversarial checkpoint — not finished or deployed

Root3aeafa1d now includes helper repairs3597ca23/1d38bc8a and inert exact report accumulator943ce0db. The accumulator passed65,000-row partition tests and independent quantity/null-cost/overflow checks; final totals() validation is mandatory. This is not report-reader activation or measured production D1 performance. SaleDetail/CartItem names are integrated; native CartItem coverage passes, while SaleDetail coverage is an extracted row fixture rather than full modal certification.

Backend sale writer checkpoint24b9904c is explicitly UNREADY and excluded from root. Frontend checkout caller work is likewise excluded. Exact promotion line provenance and the two pending owner decisions above remain open. The header migration authorization does not authorize additional item columns by implication.

Purchase-cost WaveA3c479418 is integrated as3aeafa1d: strict eight-field v2 plans cover purchase aliases and preserve exact six-field v1 replay. Root native policy test passes, but independent composed frontend-to-route tests found two blockers: unchanged historical absolute2.345678 was pre-rounded to2.3457; raw negative-0.00004 was pre-rounded to accepted zero. Author repairs and new composed regressions are pending. Backend purchase-only race guarding passed independently. This checkpoint must not deploy.

Delivery alias and saved-FX pair repairs passed independent checks, including60 recorded-change provenance cases. A new computed-change boundary failed: USD1 plusKHR20 against payableUSD1 atFX4020 should compute USD0/KHR20; intermediate4 rounding producedUSD0.01. Shared exact denomination kernel correctiona4e5e563 is awaiting independent review and caller integration. Actual historical change remains independent of an amended basket.

The broader sibling audit also keeps these gaps open: whole-catalog bulk-cost SQL rounds to cents/whole riel and lacks frozen operation recovery; supplier returns use rounded/mutable cost instead of captured lot facts; received-batch/session totals retain binary arithmetic; bulk deletion extends raw costs without the intended rounding boundary; physical expense forms reuse selling-price ceiling. Stock-count plans without a captured cost remain unknown, not fabricated. Durable audit files are in the shared .git/agent-team/results directory. No new production data action or deployment occurred.

Follow-up root2daf433a: product repair7c06631b integrated as26a1b18e and independently certified against both original composed regressions, raw-zero skip and explicit clear. Kernel correctiona4e5e563 integrated as599ff78f and independently scoped-certified; root native denomination tests pass. Frontend helper7d51ef2c integrated as2daf433a, focused receipt tests pass. Backend matching repairae3a63b7 remains in the UNREADY isolated writer checkpoint, not root. Both v1 computed-change paths there passed actual create/settlement tests at4020 while recorded actual change and legacy behavior stayed stable. Root frontend typecheck passed after initial purchase WaveA; final broad gates must still run after all runtime edits. These repairs do not remove the pending provenance, refund-policy, caller-integration and broader cost/report gaps.
