# Report Center: AI Council record and owner decisions (24 Sep 2026)

Process: `docs/AI_COUNCIL_REVIEW.md`. All five views ran on one model as separate read-only
agents, so they are **simulated perspectives, not independent reviewers**. First pass,
anonymized cross-critique, then the Chairman's verdict. The planner's inventory (39 report/export/print
surfaces) and the anonymized first pass are summarized below. The full working notes stayed in the
coordinator session.

## The owner's ask

> "I also plan to make a separate center report page, for viewing all the reports/export preview
> from all the pages and sections, also print/export excel files/pdf. with correct format and design."

## Owner decisions (24 Sep, answers to the council's questions)

| # | Question | Decision |
|---|---|---|
| D1 | Separate page or grow Sales > Reports | A separate Report Center page. **Sales > Reports is wired to the same components**: one implementation shown in two places, no second computation and no differing copy. |
| D3/currency | Riel expenses in "revenue minus expenses" | Internally everything is converted to USD, as the reports already do. The riel note stays visible (expenses and similar). The conversion note (rate used) appears only when the user opens details. |
| D5 | What "PDF" means | Print / Save as PDF through the existing print surface. Sending a report to Telegram is a separate feature: an option in Settings to send it as an image. |
| D6 | Excel dates | Real date cells shown as dd/mm/yyyy (proven here; see "Experiment"). |
| Day one | Which reports first | All of them: Dashboard; Products with their details, in the same shape as the product import, **plus received-date lot columns**: one column per received date (dd/mm/yyyy) appended at the end, each row showing that date's quantity, and a total; Sales (receipts, by period, products, payments); Stock (ledger, movements, branch stock); Customers & suppliers (debts, purchases); the Business summary workbook. |
| Preview | Column density | The on-screen preview shows fewer columns by default, with the vertical ⋮ column chooser (as in Returns) to show more. Excel/print carry the full column set. |
| Loss rule (stock-lot, same session) | A downward lot Set | Counts as a loss, unless it is done with a tag (restock-if-damaged or a related tag), which follows the existing tagged path. |

## Chairman's verdict

**Decision.** Build the separate Report Center on one shared foundation:
- A report document that stores raw values: numbers, ISO business dates, label keys. No display strings.
- It reuses `ReportTable`'s `ReportColumn.kind` instead of a parallel column type.
- Money is carried as the (USD, KHR) pair plus the currency mode and the rate used.
- Totals are copied from the server kernel and never re-summed on the client.
- An explicit `complete` flag and exact row count.
- The query is plain data: `{reportId, range, branchId, filters}`.
- Builders are pure functions, testable in Node.

One document feeds the preview, a multi-sheet XLSX and the print document, so they cannot disagree.
The same components serve the Report Center and Sales > Reports.

**Biggest risk.** A permission bypass and wrong money:
- The seeded Employee role has `sales:export` and `returns:export` off (`cloudflare/src/lib/coreDataInvariants.ts:57-67`), but `/business-summary/{kind}` checks view only (`cloudflare/src/routes/reports.ts:515`). A "full walk" export must be refused on the Worker too.
- Totals re-added from 2-decimal rows drift.

**Number-one next step.** Slice 0: the foundation plus the Worker export check. Neither touches any lane file.

## Findings the build must fix (existing defects)

- **F1:** Sales hub list exports contain only the pages already loaded (`SalesListReport.tsx:171`).
- **F2:** Branches export writes 0 cost for users without cost permission (`components/branches/Branches.tsx:1066-1075`). The Worker omits the key, and the export turns that into 0.
- **F3:** Inventory stats turn failed reads into 0s (`Inventory.tsx:2367-2396`).
- **F4:** UTC/ISO date stamps in export names and headers.
- **F5:** untranslated export headers.
- **F6:** native `alert()` in `ExportModal.tsx`.
- **F7:** missing export action gates; `dashboard_export` is enforced only in the frontend.
- **F8:** `/grouped` is capped silently (frontend limit 500, `reports.ts:493` max 1000, no `has_more`), and the overview lists use `LIMIT 50`. Exports must say "top N" or walk the rest.
- The full sales walk is O(N²) because each page rebuilds the range (`reports.ts:526`). The "pinned snapshot" pins inserts, not edits. There is a 100k cap (413). A walk needs a page ceiling, or a server change.
- `downloadXLSX` returns silently on zero rows. It must refuse visibly.
- Period comparison stays off: it was pinned off deliberately (`reportModel.ts:251-257`).

## Experiment: SheetJS CE 0.18.5 (run here, 24 Sep)

Writes and reads back:
- money `{t:'n', z:'#,##0.00'}` → "1,234.50";
- riel `#,##0`;
- dates as serials from the business-day string with `z:'dd/mm/yyyy'` → date cells "31/12/2026" and "01/01/2027";
- ids as text with `z:'@'`, keeping leading zeros;
- a short Khmer sheet name (ការលក់).

Refused:
- sheet names over 31 UTF-16 units (a 40-unit Khmer name threw);
- names containing `: \ / ? * [ ]`.

Sheet names must be sanitized and truncated. CE writes number formats but no bold, fill or border styling.

## Slices (one writer per file set)

- **Slice 0a, frontend foundation (pure):**
  - the report document model (extends `ReportColumn`);
  - `downloadWorkbook` in `utils/xlsxExport.ts`: multi-sheet, typed cells, sanitized names, visible refusal on empty;
  - a new report print document in `utils/exportOptions.ts`: lang attribute, business header, dd/mm/yyyy range, UTC+7 24h generated-at, right-aligned numbers, totals, repeated header, A4 portrait/landscape;
  - a full-walk helper with a page ceiling;
  - tests: preview = XLSX = print for one fixture, a date round-trip at the 23:30/00:30 UTC+7 edges, a visible empty refusal.
- **Slice 0b, Worker:** export intent on `/business-summary/{kind}` requires `sales:export` / `returns:export` (and `fees` export for expenses), with a pure test covering the Employee role.
- **Slice 1, after the rc/*-20260924 lanes merge (App.tsx / AppContext / ExportOptionsDialog overlap):**
  - the page, the catalogue and routing;
  - Sales > Reports wired to the same components;
  - Sales, Products-with-lot-columns and Dashboard first.
- **Slice 2:** Stock, Customers & suppliers, the Business summary workbook (currency rule above), F1-F8 parity.
- **Later:** Telegram "send as image" option in Settings.

Deploying anything, or changing `wrangler.toml` `run_worker_first` for a new URL, needs the owner's go.
