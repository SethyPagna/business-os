# Financial precision audit — September 5, 2026

## Status and scope

This is a read-only architecture audit of integration commit `44fb2106`
(`fix(telegram): reconcile sale line equations`) plus the latest fleet scope available
during the audit. It records current behavior, risks, and a phased implementation
recommendation. The owner has now authorized the pure precision helpers, shared
fixtures, and focused tests described in Phase 1. No live financial writer or reader
migration is authorized by this document.

The requested outcome is four-decimal internal financial calculation across the
system while keeping stored settlement money and displayed money explicit.

**Owner decision recorded September 5, 2026:** round to the nearest four decimal
places; when the first discarded digit is 5 or above, round the magnitude up, and
when it is 4 or below, round the magnitude down. Negative ties are symmetric away
from zero so reversing a value reverses its rounded result exactly.

The existing always-up four-decimal product-cost merge rule remains a narrowly
scoped rule. It is not the general financial calculation policy and is not changed
by this decision.

Excluded from this audit and migration plan:

- barcode and product-identity behavior, owned by the stock architecture lane;
- shift calculations and shift lifecycle behavior;
- production, remote database, deployment, secret, or live-data changes.

## Executive result

A broad replacement of `round2` with `round4` would be unsafe. The codebase has
multiple helpers named or behaving like `round2`, but they serve different purposes:
calculation, imported-price normalization, invoice settlement, cash handling,
analytics response shaping, display formatting, audit snapshots, and even some
non-money quantities. Some paths round to nearest, some always round upward, some
round KHR to a whole riel, and some carry unrounded JavaScript numbers.

The highest-risk defects are order-of-operations defects rather than formatting
defects:

1. Sale lines are rounded to cents before subtotal aggregation. Later proportional
   allocations divide by those rounded line and subtotal values.
2. Frontend price normalization always rounds upward to cents and is reused before
   currency conversion as well as for display.
3. Customer and supplier return lines are rounded to cents before aggregation,
   discarding four-decimal refund and COGS information.
4. Stock movement totals are sometimes calculated at four decimals, but import and
   stock-action entry paths can truncate unit costs to cents first.
5. Analytics and reports round at SQL, backend-response, and frontend-model layers,
   making bucket totals capable of disagreeing with separately computed headlines.
6. Old offline payloads are hashed exactly but replayed through the current server
   formula. A formula-only deployment can therefore change the result of a valid
   queued sale.
7. Amendments, undo snapshots, fingerprints, and backups preserve historical
   numbers. Reinterpreting or re-rounding them under a new rule would break replay
   fidelity and audit evidence.

The rounding-direction gate is now resolved: general financial calculations use
nearest four-decimal, half-up-by-magnitude rounding. This does not authorize live
writer migration; the first authorized implementation is limited to pure helpers,
shared fixtures, and focused tests.

## Precision model

### Observed facts

The current SQLite schema primarily stores financial values as `REAL`. This allows
values that appear to have four decimal places, but it is not a fixed-decimal
guarantee. JavaScript and SQLite floating-point operations also make equality and
boundary rounding dependent on operation order.

The current code does not have one system-wide financial precision contract. The
closest canonical contracts are:

| Responsibility | Current contract |
|---|---|
| Sale header totals, delivery, tender, and change | `cloudflare/src/lib/saleTotals.ts` |
| Sale creation and persisted sale lines | `cloudflare/src/routes/sales.ts` |
| Sale amendments and added lines | `cloudflare/src/lib/saleAmendments.ts`, `cloudflare/src/lib/saleLineAddition.ts` |
| Revenue, refund, COGS, and profit analytics | `cloudflare/src/lib/salesAnalytics.ts` |
| Receipt totals and footing | `frontend/src/utils/receiptTotals.ts`, `frontend/src/utils/receiptLineMath.ts` |
| Product-price normalization and frontend formatting | `frontend/src/utils/pricing.ts`, `frontend/src/AppContext.tsx` |
| Product merge cost rule | frontend/backend `productDetailRule.ts` twins |
| Import number parsing | `cloudflare/src/lib/importNumbers.ts`, `cloudflare/src/lib/importEngine.ts`, frontend `csvImport.ts` |
| Offline operation integrity | `frontend/src/web-api.ts`, generated service worker, `cloudflare/src/routes/sync.ts` |
| Backup and replay coverage | `cloudflare/src/lib/backup.ts` |

### Recommended architecture — not an owner decision

The recommended design separates four concepts:

| Layer | Recommended rule |
|---|---|
| Computation precision | Carry unit prices, costs, discounts, tax bases, allocations, currency-conversion intermediates, COGS, revenue, profit, and margin inputs to four decimals. Do not round before multiplication, division, or aggregation. |
| Persisted computational values | Where exact replay or comparison matters, use integer e-4 units or an equivalent deterministic decimal representation. Add this alongside legacy fields; do not rewrite history. |
| Booked/settled money | Round actual USD invoice settlement, tender, change, refund, AP, AR, and payment amounts once to cents. Round actual KHR settlement and physical cash once to whole riel. |
| Display | Format USD to two decimals and KHR to whole riel unless a separately approved view requires otherwise. Display formatting must never feed calculations or writes. |

The recommended rounding stage remains distinct from the now-confirmed direction.
Nearest half-up-by-magnitude quantization should occur at an explicit named boundary,
not opportunistically on every line or intermediate.

## Existing helper inventory

### Nearest two-decimal helpers

- `cloudflare/src/lib/saleTotals.ts:30` uses
  `Math.round((n + Number.EPSILON) * 100) / 100`. Its comment describes USD
  two-decimal half-up semantics.
- `cloudflare/src/lib/salesAnalytics.ts:332`,
  `cloudflare/src/lib/telegram.ts:41`, several functions in
  `cloudflare/src/routes/contacts.ts`, and local route helpers use independent
  `Math.round(value * 100) / 100` variants.
- `cloudflare/src/lib/importEngine.ts:2459` deliberately defines a nearest-cent
  helper distinct from import normalization.
- `frontend/src/utils/receiptTotals.ts` and multiple tests define additional
  nearest-cent helpers.

These helpers are similar but not byte-identical. Some include `Number.EPSILON`,
some do not, and their callers apply them at different stages.

### Always-up two-decimal helpers

- `frontend/src/utils/pricing.ts:20-33` defines `roundUpToDecimals` and
  `normalizePriceValue`; positive values are rounded upward to two decimals.
- `cloudflare/src/lib/importNumbers.ts:86-95` mirrors always-up two-decimal import
  normalization.
- `frontend/src/utils/csvImport.ts:403` normalizes imported values through the
  pricing helper.
- Promotion and stock-import paths contain equivalent normalization behavior.

This means a value can be rounded up by the client/import layer and then rounded to
nearest by the sale or report layer.

### Four-decimal helpers and SQL

- Frontend/backend `productDetailRule.ts` define `roundCostUp4`. It rounds each
  distinct positive cost upward to four decimals and then rounds the distinct-cost
  mean upward to four decimals. This rule belongs to product cost merging.
- `cloudflare/src/routes/batches.ts` calculates movement totals with nearest
  four-decimal arithmetic.
- `cloudflare/src/routes/inventory.ts:1541`,
  `cloudflare/src/lib/stockActionCommit.ts:285`, and
  `cloudflare/src/lib/importEngine.ts:5537` use SQL `ROUND(quantity * unit_cost, 4)`.
- Migration `0080_batch_received_cost.sql` stores received-cost totals rounded to
  four decimals.
- `frontend/src/constants.ts` rounds KHR-to-USD conversion results to four decimals,
  but this is an isolated conversion helper rather than a general contract.

### Non-money uses

`cloudflare/src/lib/saleAmendments.ts` also applies `round2` to quantity deltas and
units moved. A search-and-replace migration could silently alter quantity semantics,
which are outside the financial-precision decision.

## Surface-by-surface audit

### POS and sale creation

`frontend/src/components/pos/POS.tsx` sums raw applied price times quantity for cart
subtotals. Percentage discounts pass through `normalizePriceValue`, so USD discounts
are always rounded upward to cents. KHR percentage discounts also pass through that
two-decimal helper, while some fixed KHR values are rounded to whole riel. Tax and
some totals are carried as raw JavaScript numbers.

The client compares payment against the total with a cent-specific `0.005`
tolerance. It sends line, subtotal, discount, tax, payment, and total values in the
sale payload, although the server recomputes authoritative totals.

`cloudflare/src/routes/sales.ts:577` rounds every USD line total to cents before
summing the subtotal. Membership discount, order discount, tax, delivery fee,
actual delivery cost, and payment-detail USD values are also rounded to cents.
`cloudflare/src/lib/saleTotals.ts` then rounds the final USD sale total to cents and
KHR to a whole riel.

The immediate receipt queue is populated from the client-side sale data plus the
server identifier, rather than a complete server-returned money snapshot. During a
precision migration, the immediate receipt can therefore disagree with the stored
sale unless the response becomes authoritative for settlement fields.

The sale-total helper already contains an important correct order-of-operations
invariant. Change in KHR is derived from exact USD overpayment before the displayed
USD change is rounded. At exchange rate 4000, `2.2051 * 4000` is 8,820 KHR; rounding
the USD to 2.21 first would incorrectly produce 8,840 KHR.

### Sale amendments, grouped additions, and undo

`cloudflare/src/lib/saleLineAddition.ts` rounds added line totals and resulting sale
money to cents. `cloudflare/src/lib/saleAmendments.ts` rounds line deltas, tax
recomputation, amount deltas, before/after totals, and some quantity values to two
decimals. `cloudflare/src/routes/sales.ts` also rounds running amendment totals.

Undo and redo store before/after snapshots and restore those values rather than
recomputing the original event. That behavior is desirable for historical evidence.
A new formula must not reinterpret an old snapshot. New events need an explicit
calculation version, while legacy events remain replayable under their recorded
numeric values.

### Customer returns and exchanges

`cloudflare/src/routes/returns.ts` repeatedly uses
`Number((unit * quantity).toFixed(2))`, then rounds reduced totals to cents. New
customer returns derive refund units from original sale lines, but still discard
sub-cent information at each return line.

Replacement/exchange totals follow the same pattern. A four-decimal sale line can
therefore fail to reverse symmetrically unless the refund allocation and any final
residual rule are explicit.

### Supplier returns and stock cost reversal

Supplier return cost lines are rounded to cents before insertion. Supplier loss is
also rounded to cents after compensation is subtracted. This loses four-decimal
unit-cost and COGS information before analytics consumes the return.

Recommended separation:

- carry the returned inventory cost and COGS reversal at four decimals;
- carry supplier compensation calculation at four decimals if it is derived;
- book the supplier payment/credit settlement at USD cents or whole KHR;
- assign any settlement residual deterministically and audit it.

The returns route was already dirty in the shared integration checkout during the
audit. Its implementation phase must wait for that owner to release the file or use
an explicitly reconciled ownership handoff.

### Stock receipt, batches, and movement costs

The stock ledger is already partly four-decimal-aware. Movement totals use
`ROUND(quantity * unit_cost, 4)` in several current paths. Batch received cost is
also represented at four decimals in schema/migration logic.

The inconsistency occurs earlier:

- stock-action commit parsing can round imported prices/costs to two decimals;
- stock-action import matching converts cost to cents for identity comparisons;
- CSV/import number normalization always rounds positive monetary values upward to
  two decimals;
- contact stock-receipt readers expose received cost rounded to cents.

Thus a movement can be stored with four decimal places while being calculated from
an already truncated unit cost. The global financial migration should preserve
four-decimal costs at entry, but must not alter barcode/product identity or matching
rules as a side effect.

### Supplier AP, customer AR, and payments

`cloudflare/src/routes/contacts.ts` has several independent `round2` functions.
Supplier invoice fields such as taxable amount, VAT, total, amount paid, and
outstanding balance are returned at cents. Customer receivable summaries are also
rounded at the response boundary.

These are predominantly booked ledger and settlement fields and should remain USD
cent values. Four-decimal calculations may feed an invoice before it is booked, but
the booked invoice, payment, and outstanding balance must reconcile in currency
minor units. Existing imported legacy invoice and receivable rows must not be
back-calculated or rewritten under the new policy.

Sale payment details, amount paid, change, refund paid, and delivery/fee payments
have the same settlement requirement. KHR payment fields representing actual cash
remain whole riel.

### Reports and analytics

`cloudflare/src/lib/salesAnalytics.ts` generally performs SQL aggregation without
intermediate rounding for core revenue/refund expressions, which is a useful base.
Its `deriveTotals` response then rounds nearly every financial output to cents,
including gross sales, discounts, tax, delivery, cost, refund, revenue, profit, and
average order.

Other report queries round SQL sums to two decimals before JavaScript receives
them. `cloudflare/src/routes/reports.ts` rounds backend values again, and
`frontend/src/components/sales/reports/reportModel.ts` applies another local
`round2` to derived statement values.

Consequences:

- a sum of rounded buckets may differ from the separately rounded headline;
- margin and average-order division may use rounded numerators;
- four-decimal COGS can be discarded before profit calculation;
- a presentation-shaped API response may be reused as a computational source.

Recommended APIs should return precise calculation values and explicitly named
settlement/display values. Frontends should aggregate precise values and format only
at render/export boundaries.

### Telegram

`cloudflare/src/lib/telegram.ts` defines its own nearest-cent helper. Sale item base,
net unit, line total, discount, subtotal, and delivery values are rounded for message
construction. Telegram is a presentation surface and should continue to display
currency-appropriate values, but it should not independently recompute authoritative
money from already formatted operands.

The formatter should consume persisted settlement totals for receipt-like fields and
precise analytics fields for analytical messages. Formatting remains two-decimal USD
and whole-riel KHR unless separately changed.

### Receipt calculation and printing

`frontend/src/utils/receiptTotals.ts` reads stored sale values, converts KHR tender
to USD, and rounds paid/outstanding values to cents. Its footing-error helper also
rounds the error to cents, making sub-cent discrepancies invisible.

The receipt should display the booked settlement, not recalculate a different invoice.
Verification should nevertheless compare precise equation inputs before display
rounding and fail if the precise result does not settle to the stored total. Printing
layout calls to `toFixed(2)` for dimensions are unrelated and must not be changed.

### Imports

Frontend CSV import and backend import parsing normalize prices upward to two
decimals. The sales import engine then switches to nearest-cent sale formulas. Stock
imports may subsequently multiply those cent-normalized costs and round the total to
four decimals.

Import behavior must be versioned just like online sale behavior. Historical import
jobs and their stored source payloads remain untouched. New import previews should
show the source value, normalized four-decimal computational value, and eventual
settlement value where relevant.

### Offline queue, request deduplication, guards, and fingerprints

The frontend stable-serializes operation payloads and computes SHA-256 over the exact
JSON representation. The server independently stable-serializes the received payload
and verifies that digest before dispatching the operation.

This protects payload integrity, but not formula identity. An operation queued under
old client behavior can pass its digest and then be recomputed by a newer server.
Changing client-side number normalization also changes JSON and therefore changes
the digest and deduplication identity for otherwise similar operations.

Required compatibility rule:

- existing `schema_version: 1` operations retain their payload bytes, digest, and
  legacy calculation behavior;
- new operations include an explicit `financial_calculation_version` or equivalent;
- the server accepts and dispatches both versions during the queue-drain window;
- no migration mutates queued payloads or recomputes their digests;
- stable `client_request_id` continues to return the already committed result on
  retry, regardless of a later formula deployment.

Import commit guards, stock-action fingerprints, bulk-action guards, and amendment
stale checks may include rounded numeric values. Any fingerprint that changes from
cents to four decimals needs a versioned canonicalization rule. Old fingerprints
remain comparable under their original version.

### Backup and restore

`cloudflare/src/lib/backup.ts` covers sales, sale items, returns, return items,
supplier invoices, customer receivables, product batches, inventory movements,
import commit/guard data, action history, undo snapshots, sale amendments, and audit
records. The sale replay restore bundle also guards completeness across related
tables.

Backup format version 1 streams raw SQLite values. Four-decimal values can pass
through that JSON representation, but any new e-4 or calculation-version columns
must be included in append-only schema and backup coverage tests. Export and restore
must never normalize money. Old backups restore old values and versions exactly.

## Where precision is lost before division

The following sites deserve dedicated regression cases because adding decimal places
afterward cannot recover the lost information:

1. `AppContext` normalizes USD to cents before multiplying by the exchange rate and
   normalizes KHR to two decimals before dividing by the exchange rate.
2. Sale creation rounds each line total to cents before subtotal aggregation.
3. Refund and discount allocation formulas divide using stored sale-line and
   subtotal values that are already cent-rounded.
4. Return routes round each refund or cost line before totaling the return.
5. Imported unit costs are normalized to cents before quantity multiplication and
   distinct-cost handling.
6. Analytics and report rows can be rounded before frontend bucket summation,
   average-order division, or margin calculation.
7. Receipt paid/outstanding calculations round after mixed-currency conversion;
   this is appropriate only when the result is explicitly the settlement/display
   value rather than a further computational input.

## Field classification

### Four-decimal computation candidates

- unit selling price and wholesale price;
- unit inventory and batch costs;
- raw line extensions before invoice settlement;
- percentage-derived discount and tax amounts;
- delivery margin and derived delivery allocation;
- refund and return allocation inputs;
- COGS and returned-cost calculations;
- revenue, profit, average order, and margin inputs;
- currency-conversion intermediates;
- proportional allocation weights and residual calculations.

### Currency-minor-unit settlement fields

- `sales.total_usd`, actual `amount_paid_usd`, and `change_usd`;
- actual sale/refund/payment detail amounts;
- booked customer refund total;
- supplier invoice taxable, VAT, total, paid, and outstanding values;
- customer receivable billed, paid, and outstanding values;
- booked fees and delivery charges/cost payments;
- USD cash fields at cents;
- corresponding actual KHR totals, tender, change, refunds, and fees at whole riel.

Existing header components such as discount and tax are currently used both as
calculation inputs and booked invoice components. A migration should avoid changing
their historical meaning. If precise pre-settlement values must be persisted, add
companion e-4 fields and retain the existing fields as booked values until all
readers have migrated.

### Display-only values

- `fmtUSD`, `fmtKHR`, `formatPrice`, and report money strings;
- Telegram-rendered amounts;
- receipt text and printed totals;
- chart labels, table cells, and export-formatted strings.

These values must not be submitted as authoritative numeric inputs or summed by
downstream code.

## Phased migration plan

### Phase 0 — owner decision and contract lock

**Complete for rounding direction.** General four-decimal computation uses nearest
rounding, with a discarded 5 rounding magnitude up and 4 or below rounding magnitude
down. Negative ties round away from zero to preserve reversal symmetry. The pure
contract rejects invalid and unsafe-overflow input rather than silently coercing it.
Residual allocation remains a separate owner decision before writer migration.

### Phase 1 — pure precision contract, no behavior change

Authorized first bounded write set:

- new `cloudflare/src/lib/financialPrecision.ts`;
- new `frontend/src/utils/financialPrecision.ts`;
- new `ops/fixtures/financial-precision-cases.json`;
- new `cloudflare/scripts/test-financial-precision-pure.cjs`;
- new `frontend/tests/financialPrecision.test.ts`;
- one static import from the already chained
  `frontend/tests/posMoneyRounding.test.ts`.

This avoids extending the already very long Windows `test:utils` command in
`frontend/package.json`. `testChainCoverage.test.ts` follows static test imports
transitively, so the focused test remains reachable from the existing chain. The
frontend/backend helper twins follow the repository's existing parity pattern and
consume the same fixtures. No live calculation caller migrates in this phase.

### Phase 2 — versioned online and offline sale vertical slice

Recommended bounded production write set, assigned to one owner and released as one
compatible vertical slice:

- `cloudflare/src/lib/saleTotals.ts`;
- sale-create portions of `cloudflare/src/routes/sales.ts`;
- `cloudflare/src/lib/saleLineAddition.ts`;
- financial portions of `cloudflare/src/lib/saleAmendments.ts`;
- `cloudflare/src/routes/sync.ts`;
- `frontend/src/components/pos/POS.tsx`;
- `frontend/src/web-api.ts` and the source for the generated service worker;
- sale-total, POS-money, amendment, request-id, and offline-replay tests;
- one append-only migration, with its number allocated only after concurrent
  migrations have settled.

This slice must preserve v1 replay, add the new calculation version, aggregate
four-decimal lines before settlement, return authoritative server settlement fields,
and make the immediate receipt use that response.

### Phase 3 — returns and COGS

After the active returns owner releases its path, migrate customer refund allocation,
exchange/replacement totals, supplier-return cost, supplier compensation, and COGS
reversal. Use deterministic final-line residual assignment so allocated components
sum exactly to the booked settlement.

### Phase 4 — stock and import entry

Preserve four-decimal unit costs through product input, batch receipt, movement,
stock-action import, CSV import, and import-engine commit. Version import guard and
fingerprint canonicalization where precision participates. Do not change barcode or
product-identity rules in this phase.

### Phase 5 — analytics, reports, AP/AR readers, Telegram, and receipts

Remove computational dependence on response/display-rounded values. Return precise
analytics values and separately format them at each presentation boundary. Retain
minor-unit settlement in AP/AR, receipts, and payment surfaces.

### Phase 6 — persisted exact values and backup compatibility

Where replay or audit requires exact four-decimal values, add companion scaled-integer
columns and dual-write them for new calculation versions. Dual-read legacy rows using
their recorded version. Extend backup, restore, schema guard, and replay coverage.
No historical bulk rewrite is part of this phase without separate authorization and
reconciliation evidence.

## Behavioral acceptance matrix

The owner-confirmed nearest, half-up-by-magnitude mode supplies the expected boundary
values for every case below.

| Case | Required behavior |
|---|---|
| Aggregate before settlement | Three lines at USD 0.3333 calculate to 0.9999, then book/display USD 1.00. They must not become 0.99 from per-line cent rounding. |
| Four-decimal cost | Quantity 3 at cost 0.3333 produces computational COGS 0.9999 and survives stock receipt, sale, return, report, backup, and restore. |
| Change conversion order | USD overpayment 2.2051 at rate 4000 produces 8,820 KHR, not 8,840 KHR. |
| Proportional allocation | Discounts and refunds divide precise values, assign any residual deterministically, and sum exactly to the booked settlement. |
| Mixed tender | USD/KHR tender comparison uses explicit settlement units, not a generic floating-point `0.005` tolerance. |
| Return symmetry | A full return reverses the original calculation-version COGS and refund allocation without creating or losing value. |
| Report reconciliation | Precise bucket sums reconcile with the precise headline before either is display-rounded. |
| Immediate receipt | The first receipt shown after checkout equals the server-persisted settlement snapshot. |
| Legacy offline replay | Existing v1 payload bytes and SHA-256 remain unchanged and replay with legacy calculation semantics. |
| New offline replay | New-version payload retry is idempotent and yields the same values online and after queue replay. |
| Amendment replay | Undo/redo restores exact legacy snapshots without applying the new formula. |
| Backup round trip | Four-decimal computational values and calculation versions round-trip without normalization; old backups restore unchanged. |
| Policy edges | Positive, negative, tie, zero, negative-zero, non-finite, overflow, and residual cases follow the explicit owner-selected policy. |
| Display isolation | USD/KHR formatting never mutates, normalizes, hashes, or resubmits the source numeric value. |

## Verification and release gates

Each behavior-changing phase should run its focused pure/route tests first, then both
package type checks and the full relevant test chains. A clean isolated committed
tree is required for release certification. Production or remote verification remains
separately authorized work.

Before deployment, explicitly prove:

- no active v1 queue is made unreadable;
- no historical sale, return, invoice, receivable, amendment, undo, or backup value
  was rewritten;
- online and offline creation agree under each supported calculation version;
- sale, return, stock, report, Telegram, and receipt equations agree before display
  formatting;
- all added columns are present in backup/restore and schema guards;
- no barcode, product-identity, quantity, or shift behavior changed incidentally.

## Decision log

### Established by repository evidence

- Current precision behavior is fragmented and order-dependent.
- Existing product cost merge uses always-up four-decimal rounding.
- Existing general sale settlement uses nearest-cent USD and whole-riel KHR.
- Existing stock movement totals already use four decimals in some paths.
- Offline hashes protect payload bytes but do not pin calculation semantics.
- Historical snapshots and backups must remain exact.

### Decided by the owner on September 5, 2026

- General financial computation rounds to nearest at four decimals.
- A discarded 5 or above rounds magnitude up; 4 or below rounds magnitude down.
- Negative ties round away from zero, preserving reversal symmetry.
- This decision does not replace the separate always-up merged-product-cost rule.
- The first implementation is pure helpers, one shared fixture, and focused tests
  only; live writer migration is deferred to versioned slices sequenced by main.

### Recommendations in this audit

- Carry four-decimal computational values until one explicit settlement boundary.
- Preserve currency-minor-unit booked money.
- Separate formatting from calculations.
- Introduce calculation-version compatibility before changing sale formulas.
- Prefer deterministic scaled storage for persisted exact computational values.
- Migrate one vertical slice at a time with parity fixtures and no historical rewrite.

### Still awaiting owner decision

- Whether any displayed unit prices should expose four decimals, independently of
  internal precision.
- Whether precise pre-settlement invoice components require persisted companion
  fields or can remain reproducible derived values.
- Residual-allocation convention when four-decimal components settle to currency
  minor units.
