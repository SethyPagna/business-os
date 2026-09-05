# Report reference designs — Sep 5 2026, session `reference images` (190187)

The owner handed this session 13 screenshots of the **old POS's Report section** with the
instruction: *"reference images … only for reference and UI designs, not color, etc … good
compactness."* This document is the layout reading of those screenshots mapped onto the
Reports hub that is **live today**, so that R2 in
[`2026-09-05-program-ledger.md`](2026-09-05-program-ledger.md) ("Report/summary redesign:
large segmented layout, dividers, compact date range, simplify + reorder") has a concrete
target. Everything here is **reference to re-verify**, not a spec that has been accepted.

## What is live, and where the code is

- The 13-view Reports hub (`ReportsHub.tsx` + `sales/reports/*`) is on the deployed
  integration line — `origin/codex/business-os-reconcile`, worktree
  `../business-os-v1-integration` — **not on `main`**. `main`'s `ReportsHub.tsx` is the
  older three-section hub (Sales / Returns / Expenses). Any implementation of this document
  bases on the integration line; a diff against `main` shows shipped work as new.
- Codex's own report-layout work on that line (latest first): `c999e909` round to cent,
  `61237948` tablet gutter, `67d08f8c` desktop control parity + reversed-time reject,
  `f4ee0b97` responsive range + statement layout, `90cfe2a9` continuous entry-time ranges.
  Its notes: *"desktop controls now share a compact row, five presets, no decorative calendar
  icon"* (`2026-09-05-production-usability.md`, "New screenshot request — conversion and
  report layout" and the Sep 5 checkpoints).
- Views today: Overview (all) · By period · Each receipt · Products · Customers · Cashiers ·
  Payment methods · Hours of day · Days of week · Branches · Couriers · Returns · Expenses.
  Two render styles: Excel (`ReportTable` / `DenseTable`) and Receipt (`ReceiptSheet`).
  Views are picked from one `AppSelect` dropdown; filters, style, basis, profit mode,
  compare and currency all live in one `ReportOptionsFold` menu.

## The screenshots, one line each

| # | Old-POS surface | What it shows |
|---|---|---|
| 1 | Home tiles, Report expanded | 2-col tile grid; tapping **Report** unfolds a 2-col sub-grid: Summary, Income, Daily, Profit, Invoice Detail, Item Cost |
| 2 | Home tiles, Sale expanded | Same accordion for Sale: Issue Invoice, Invoice, Edited History, Plan, Currency, Payment method, Other Expense/Income, Customer Screen Slides, Delivery Service, Credit Delivery |
| 3 | Profit report, result chips | Collapse handle (^) on a hairline; sticky chip row SUMMARY · PROFIT ON ITEM · PROFIT ON INVOICE; the profit ledger (empty) |
| 4 | Profit report, filter panel | Branch (multi) · date-time range pill with calendar button · preset chips TODAY/YESTERDAY/LAST 7 DAYS/LAST 30 DAYS… · Search Customer · Category · User name · Delivery Service · full-width SHOW · collapse handle |
| 5 | Filter panel, Yesterday | Preset chip selected = dark fill; range pill updated to 03/09 00:00 → 03/09 23:59 |
| 6 | Summary → BRANCH | One card per branch: Gross Sale, Total Discount, Net Sale (badged), Account Receivable, Cash On-hand, then muted count rows (Total Invoice, Deleted Inv, Items Sold, Delivery Service, Total Customers) |
| 7 | Summary → SALE, scrolled | Collapsible sections with chevron + total on the header row: Net Sale (Exclude AR and Discount) → Customer → shop → credit; Account Receivable → per-customer amounts; Total Discount → Item / Inv / Manual |
| 8 | Summary → SALE, top | Chip row BRANCH · SALE · PRODUCT · USER · CUST…; counts block (Invoice Official 17 / Paid 0 / AR 17); Gross Sale, Discount **(61.00)** red, Net Sale, AR **(1,470.00)** red, Cash On-hand badge |
| 9 | Summary → PRODUCT | Category band (name large, Sold badge, Revenue + Profit badges right); product rows: name, barcode muted, 2-col grid Sold/Remaining ‖ Revenue/Cost/Profit |
| 10 | Summary → USER | Card per cashier ("Aza"): Gross Sale (Credit sub-line), Total Discount (Item/Inv), Invoice Official/Paid/AR/Voided, Total Customers (New/Return/Unregistered), **Shift His.** row `2026-09-03 08:33 – 20:34  1,470.00` |
| 11 | Summary → CUSTOMER | 2×3 header grid (Total 15 / New 7 / Return 8 ‖ Male 1 / Female 13 / Unknown 1); "New Customer" section, numbered rows: name + phone left; Invoice / Income / Credit (red) right |
| 12 | Summary → DELIVERY SERVICE | Counts block; Total Revenue badge with per-driver rows (count, amount); Paid (green) → Cash / ABA rows; Account Receivable (red) → per-driver rows |
| 13 | Summary → PROFIT | Same ledger as #3 filled: Gross Sale, Total Discount (Item / Inv indented, inner column), Credit Note, Net Sale, COGS, Gross Profit, Other Expense (per-courier sub-lines), **Operating Profit** badge |

## The layout rules the screenshots share (this is the "good compactness")

1. **Label left, value right, one line per fact, ~30 px rows.** No stat tiles, no
   sentences. This is already the app's receipt-style convention.
2. **Sub-lines indent and use an INNER amount column; totals use the OUTER column.** The
   profit ledger (#13) is a 3-column grid: label · detail amount · subtotal amount. The eye
   reads the outer column as the statement and the inner column as "how it was made up".
   The live Overview instead prints a group header row and a `+ / − / =` operator column
   with one amount column.
3. **Badges only on the 3–4 headline money figures** (Gross, Discount, Net, final Profit).
   Counts are muted text, never badged.
4. **Negative and deducted figures read as `(61.00)` in red**, receivables likewise; paid /
   cash-on-hand read green. Colour carries meaning (deduction / owed / collected), which is
   the one colour rule worth keeping even though the palette itself is not the reference.
5. **Collapsible sections carry their total on the header row** (#7), so a collapsed
   section still shows its number. Nesting is by left padding only, three levels deep.
6. **One entity = one card** for Branch / Cashier / Customer, with the same row order every
   time (money block, then count block, then detail block).
7. **The filter panel is a stacked full-width card that folds away** behind a handle after
   SHOW, leaving a **sticky chip row** of result sections. Results get the full screen.
8. **Preset chips include Yesterday**, in a horizontally scrolling row under the range pill.
9. **Category grouping with subtotal bands** for products, and **Remaining** (on-hand) next
   to Sold on every product row.

## Mapped onto the live hub — adopt / already have / needs data / conflicts

| Reference element | Live hub today | Reading |
|---|---|---|
| Filter panel folds away behind a handle after Show (#3, #4) | Mobile: `reports-mobile-controls` is a sticky card that stays open; desktop: `ControlRow` sticky | **Adopt.** After Show on compact, collapse the card to one line (range + "Filters · n") with a handle; the results start at the top. |
| Preset chips Today / Yesterday / 7d / 30d (#4, #5) | All time / Today / Last 7 / Last 30 / This month (`statsStripPresets`) | **Adopt Yesterday**; keep All time and This month. Same chip component. |
| Sticky section chip row BRANCH · SALE · PRODUCT … (#8) | One `AppSelect` dropdown for 13 views | **Conflict — owner decides.** The Aug 31 rule was "the options view by can be into one button", and the standing preference is chips → one dropdown. The reference uses a scrolling chip row. Recommendation: keep the dropdown as the picker and do NOT add a second row of view chips unless the owner says the chip row wins. |
| Profit ledger with inner/outer amount columns (#13) | `OverviewReport` statement: group header rows + operator column + one amount column (`DenseTable`); receipt style has blocks per group | **Adopt** in the Excel style: drop the group-header rows, indent sub-lines, give sub-lines the inner column and totals the outer column, badge the final total. Keep the operator only as a muted glyph inside the label cell. Receipt style already matches #13's shape. |
| Discounts split Item / Inv (#7, #13) | `total_discount_usd` on the live line is invoice-level only; `getItemDiscountUsd` exists but only Telegram calls it (progress.md, "THE BIGGEST OPEN ITEM") | **Needs data** — this is the stranded `1d67e895` port. The Item / Inv sub-lines cannot be drawn truthfully until it lands. Do not fake them from one figure. |
| Per-branch cards (#6) | Branches grouped view: one table row per branch, statement in a Fold | **Adopt** in receipt style: one `ReceiptBlock` per branch with money block → count block (Total sales, Items sold, Customers). Counts exist on `ReportTotals` (`tx_count`, qty); customers-per-branch needs a count in `/grouped?by=branch`. |
| Collapsible sections with total on the header (#7) | Breakdown chips open a floating `Fold` (payments / couriers / reasons / types) | **Partly have.** The Fold floats (the app's float-over-inline rule) — keep that. What to adopt is the **header-carries-total** shape: the chip row should show each breakdown's total, not only its count. |
| Products grouped by category, with Remaining (#9) | Products view: flat rows product · sales · qty · revenue · cost · profit · margin; no category, no on-hand | **Needs data**: `/grouped?by=product` must return `category_name` and current on-hand (branch-scoped, `branch_stock` sum). UI: category band with Sold / Revenue / Profit subtotals, product rows under it; in Excel style the category is a group row, in receipt style a block title. |
| Cashier card with count block + shift history (#10) | Cashiers view: totals row + Fold statement; shift history lives in `ShiftHistoryPanel` above the controls | **Adopt** the card shape; the **Shift His.** row per cashier is R3 scope (shift list endpoint does not exist yet — ledger INV-5). New / Return / Unregistered customer counts per cashier need a query. |
| Customer header grid + New / Return sections (#11) | Customers view: one table, no new-vs-returning split | **Adopt** the split (first sale inside the range = New). Gender split is drawable: `customers.gender` exists (migration `0017_customers_gender.sql`), so the 2×3 header needs only a count in `/grouped?by=customer`. Per-row Invoice / Income / Credit is `tx_count` / basis / `pending_revenue_usd`, already on the row. |
| Delivery service: paid vs receivable, per-driver rows (#12) | Couriers view: charged / store-paid / actual cost / margin per courier | **Needs data** for the paid-vs-AR split of delivery fees by payment method; the per-driver revenue rows exist (`charged_fee_usd`). |
| Home accordion tiles (#1, #2) | Sidebar / hub nav (R1, INV-8) | **Not this lane.** Note for the R1 owner: the reference accordion pushes tiles down; the standing rule is float-over-inline, so the sub-grid should float or the row should expand in place without moving siblings. |

## Ordering inside the Reports hub (simplify + reorder)

Today the hub renders, top to bottom: `CurrentShiftSummary` → a "Shift history" card →
controls → the view. The reference puts **filters first, results second, and nothing above
the filters**. Recommendation: move the two shift blocks below the view (or into the
Cashiers view per #10) so the range and Show button are the first thing on the screen.
This is a reorder inside `ReportsHub.tsx` only, no data change, and it is the cheapest win
on the list.

## What this lane has NOT done

- No file under `frontend/` or `cloudflare/` has been edited by this session. This is a
  reading of the screenshots, coordinated with the live session
  `Comprehensive system review and UI fixes` (the INV-9 owner) and the Codex surface before
  any implementation is claimed.
- The figures in the screenshots (Gross 1,531 / Discount 61 / Net 1,470 / COGS 1,236.54 /
  Operating profit 209.75 for Sep 3) are the old system's; they match the live Sep 3 report
  Codex verified (`gross1,531, itemdiscount61, net1,470, COGS1,236.54`) and are not evidence
  of anything beyond that.
