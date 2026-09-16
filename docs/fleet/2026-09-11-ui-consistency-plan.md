# Sales and operational UI consistency plan — 2026-09-11

## Goal and baseline

Deliver one integrated, locally verified candidate that makes the requested Sales, Returns, Expenses, Reports, Dashboard, Branch, Products, status/payment, transfer, Shift, pagination, copy, and permission behavior consistent without losing the newer release protections.

- Implementation base: `b73331a3cfe60a4178ee025ec3e2690d69f2cbd4` from `codex/sale-create-trigger-release-20260909`.
- Integration branch: `codex/ui-consistency-20260911`.
- Integration worktree: `C:/Users/mrkl6/Downloads/bos-ui-consistency-20260911`.
- The dirty `main` checkout is not an implementation base. Its unrelated edits remain preserved.
- No deployment, remote migration, secret sync, remote D1 command, or production customer/data mutation is authorized by this plan.

## Evidence that changes the implementation strategy

1. The release line contains anonymous-customer markers, unlimited-by-default sale amendments, status/payment reconciliation, Records/audit support, and transfer operation receipts that are absent from the dirty `main` HEAD.
2. The current shared date component intentionally removed presets under an older owner instruction. The present request supersedes that choice: presets return as one non-wrapping horizontal rail below Stats/start/end/actions.
3. Screenshot `codex-clipboard-235cdbb3-ea94-44dd-a714-6526f7997a97.png` proves a Not Paid → Completed payment attempt can reach the unknown-outcome UI.
4. Screenshot `codex-clipboard-0f868f78-f3a0-421f-a4f2-740056690a43.png` proves the pending retry card is unreadable on a narrow viewport and the warning is duplicated across modal, banner, and page.
5. Release-source review found a transfer retry gap: the modal does not preserve the generated request ID/payload after an uncertain response, so a manual retry can use a new ID.
6. Release-source review found bulk permission drift: some Worker bulk handlers require `sales:bulk` while the UI also requires the relevant underlying amend/status action.

## Universal acceptance contract

1. Compact toolbar actions follow the actual Manage/primary control height contract: 40px visual height, with readable Khmer and stable icon-only hit targets.
2. Dashboard, Sales, Returns, Expenses, and Branch Overview place Stats, start/end range, and relevant Export/action controls on one non-wrapping row. Presets sit immediately below in one horizontally scrollable row.
3. Sales, Returns, and Expenses group records by business day and show 24-hour time, not a repeated date, in each record.
4. Linked record metadata follows one order: reference/time, Cashier, Branch, Customer, Driver, then the page-specific reason/status facts.
5. Sales, Returns, and Expenses render the same centered pager immediately below search/filter controls and after results. Order is Back icon + `Back`, items-per-page, page/total, `Next` + Next icon. Reports have no list pager.
6. Copyable values look like ordinary text. Long press and a keyboard-accessible equivalent copy the value and show a short localized non-blocking success message; movement/scroll cancels the hold; clipboard failure never claims success.
7. Page Export uses borderless icon-only chrome; preference glyphs grow without growing their 40px controls; KM/EN is anchored on the globe.
8. Minimize, restore, close, discard, Back, Next, cancel, retry, and stale/permission-denied transitions preserve entered state when appropriate, never duplicate writes, and remain usable at 320px in English and Khmer.

## Page acceptance

### Sales

- Remove the redundant range explanation.
- Mobile list rows use at most two metadata lines: receipt/time/Cashier/Branch, then Customer/phone/Driver. No blue or underlined metadata and no decorative status icons.
- Keep the release’s `sales:amend` capability and default `0` (unlimited) amendment window. A positive optional setting may limit non-admin employees; frontend and Worker decisions must match.
- Not Paid ↔ Completed and payment correction must retain one prepared request identity across timeouts, reconcile server truth after unknown outcomes, and update list/detail/Records/report/stat state without double stock effects.
- Sale detail uses receipt-like inline Qty/Price/delivery edits, compact two-row item information, USD-only presentation where requested, and no bottom action flash/layout jump.
- Bulk status/amend/customer/payment/driver actions require both bulk authority and the relevant underlying action authority when the specific toggle is denied.

### Returns

- Mobile rows show reference/time followed by compact Cashier/Branch/Customer/Reason metadata.
- Date arrangement moves into Filters and Search expands.
- Detail header keeps reference, minimize, and close in one row. Original reference is compact and copyable without separate Copy chrome.
- Add Return wording, Stats/date/presets, action height, and dual pagers use the shared contract.

### Reports

- One active report title doubles as the report-option trigger for every report type.
- Report option, Filters, and Show share one 40px row; filter content floats without pushing the report.

### Expenses

- Business-day grouping with 24-hour time; at most two mobile information rows.
- Sale-derived expenses show their sale reference and Shop branch. Manual expenses may omit sale-derived metadata.
- Icon-only add action retains an accessible name; Stats/date/presets/actions and dual pagers use shared contracts.

### Dashboard and Branches

- Dashboard uses the shared Stats/date/export/preset composition.
- Branch Overview restores Stats in that composition.
- Branch transfer layout changes must not weaken canonical branch/lot/FIFO/idempotency rules.

### Products and stock adjustment

- Fixed compact thumbnails cannot determine row/card height.
- Product detail keeps Branch/value, Cost/Wholesale, and Selling/Margin pairs on their respective rows with peer typography.
- Adjust Stock moves received-date choices into Options, removes quantity presets and duplicate date-derived code display, shows real dates as `dd/mm/yyyy`, and exposes the full product name through horizontal scrolling.

### Shared General customer

- Continue using the explicit anonymous marker. Do not infer from names.
- Marked General/walk-in identities have no usable membership behavior and are excluded from picker/merge/account paths while historical transactions remain visible.
- Do not run the guarded customer `24969` production repair during this work; keep customer `22305` protected.

## Correctness scenarios

Every mutation slice must add executable scenarios for success, validation failure, permission denial, stale revision, server rejection, lost response/unknown outcome, safe retry, and reversal where applicable.

Data must converge across:

- list row and open detail;
- Records/audit/undo history;
- daily stats and Reports;
- linked Returns and sale-derived Expenses;
- product, branch, lot, movement, and transfer-history quantities;
- Shift open/close figures and Telegram/report summaries.

The two screenshot scenarios are release blockers until an executable test proves correct request reuse, reconciliation, and readable narrow layout.

## Implementation waves and ownership

### Wave 1 — shared primitives

One Astra writer owns only:

- `frontend/src/components/shared/toolbarButtonStyles.ts`
- `frontend/src/components/shared/StatsRangeRow.tsx`
- `frontend/src/components/shared/statsStripPresets.ts`
- `frontend/src/components/shared/StatsStrip.tsx`
- `frontend/src/components/shared/PaginationControls.tsx`
- shared copy/text-affordance files
- `frontend/src/components/shared/QuickPreferenceToggles.tsx`
- shared primitive tests

This wave establishes APIs; it does not migrate feature pages.

### Wave 2 — independent UI adopters

Run in isolated worktrees from the Wave-1 commit:

- Sol/Returns: Returns list/filter/detail/minimize and Returns-only tests.
- Sol/Expenses/Reports: Fees/Expenses and Reports files with their focused tests.
- Sol/Products: Products list/detail/stock-adjust files and focused tests.
- Sol/Dashboard: Dashboard-only shared-control adoption and focused tests.

Feature writers do not edit language packs or shared primitives. They report required translation keys.

### Wave 3 — difficult cross-layer behavior

- Astra/Sales owns Sales components, sale transports, sale permission definitions/actions, sales Worker route/libraries, Records/audit/undo, and sale-focused tests.
- Astra/Transfers and Shift owns Branches/BranchesHub/TransferModal, branch transport, transfer routes/libraries, Shift UI/routes/reports/Telegram paths, and focused tests.

These writers use isolated worktrees, preserve release invariants, and add mounted or route-executed scenarios rather than source-regex-only proof.

### Wave 4 — reconcile, localize, and ledger

One reconciler integrates the exact reviewed commits, resolves no behavior by silent conflict choice, applies EN/KM strings, and runs focused tests. After integration, update `progress.md` and the owner task register with exact local results and explicit not-deployed status.

### Wave 5 — independent verification

Fresh read-only verifiers cover:

- Sales/status/payment/permissions/audit/data convergence;
- transfers/Shift/stock/lot convergence;
- responsive UI/accessibility/English/Khmer at 1280×800, 390×844, and 320×568;
- full affected package gates.

Verifier findings return to the owning writer. Verifiers do not repair their own findings.

## Required gates

1. Focused frontend tests for stats/date presets, pagers, copy, Sales, Returns, Expenses, Reports, Dashboard, Branches, Products, permissions, unknown writes, minimized work, and shift UI.
2. Focused Worker route/library tests for sale amendments, bulk status/update, payment settlement, stock-holding parity, Records/audit/undo, anonymous customer guards, fees linkage, transfer single/bulk/inventory/replay, Shift close/reports, and Telegram.
3. `frontend npm run typecheck`
4. `frontend npm run verify:i18n`
5. `frontend npm run build`
6. `cloudflare npm run typecheck`
7. `frontend npm run test:utils`
8. Local browser smoke at the target widths and both languages. If no maintained browser harness is available, record supervised browser evidence and the exact untested device cases; do not claim physical iOS certification.

## Stop conditions

- Any writer detects path overlap or a release invariant missing from its worktree.
- A proposed fix needs production data, remote D1, migration application, deployment, or new user authority.
- A retry fix cannot prove stable request identity and one committed effect.
- Data differs among the canonical record, list/detail, audit/Records, report/stat, stock/lot, or Shift views.
