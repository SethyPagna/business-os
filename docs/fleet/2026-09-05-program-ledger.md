# Program ledger — Sep 5 2026, session `business-os-v1-3a`

Tracking document for the owner's Sep-5 request batch. **Nothing in this program is
considered done until it appears in the STATUS table below with evidence.**

## The controlling fact

Production is deployed from commit `c7ef7264` on **`origin/rc/ee-integrate-2026-09-04`**
(tip `2bd6675e`). That is the **only** branch containing the deployed commit —
verified: `for b in $(git branch -r ...); do git merge-base --is-ancestor c7ef7264 $b; done`
returned exactly one branch.

**`origin/main` DOES NOT contain the deployed code.** Every comparison, every new lane,
and every merge in this program bases on `rc/ee-integrate-2026-09-04`, never on main.
A diff against main shows already-shipped work as if it were new — this is the single
most likely way to waste effort here.

Corollary established by INV-1: the "90 unmerged branches" are unmerged **relative to
main**. Relative to production most are already contained. Main is the outlier, not the
branches.

## Lane register

All Phase-1 lanes are READ-ONLY: they cannot check out, stage, commit, or merge.
No lane can lose a commit because no lane can make one. Merging is done by the
coordinating session only.

| Lane | Subject | Agent type | Status |
|---|---|---|---|
| INV-1 | Harvest `s4/*` (30 branches) | bos-sweep | ✅ COMPLETE |
| INV-2 | Harvest `rc/*` (23 branches) | bos-sweep | ⏳ running |
| INV-3 | Harvest `fx/ hf/ lane/ claude/ docs/ ship/ reconcile/` (36) | bos-sweep | ⏳ running |
| INV-4 | Money: awaiting-payment sign, negative revenue root cause | bos-verify | ⏳ running |
| INV-5 | Shift system as-is vs owner spec | bos-sweep | ⏳ running |
| INV-6 | Data scoping + false zero-stock + branch products section | bos-stock | ⏳ running |
| INV-7 | Uncommitted working-tree triage (53 files) | bos-verify | ⏳ running |
| INV-8 | Navigation / IA audit + page inventory | bos-sweep | ⏳ running |
| INV-9 | Report & summary surface inventory | bos-sweep | ⏳ running |
| INV-10 | Sale-detail vs POS parity | bos-sweep | ⏳ running |
| INV-11 | Telegram message inventory + format proposal | bos-telegram | ⏳ running |
| INV-12 | progress.md open-item register (12,927 lines) | general-purpose | ⏳ running |
| INV-13 | Settings + role-gating "add a toggle" recipe | bos-worker-api | ⏳ running |

## INV-1 result — all 30 `s4/*` branches ALREADY-LIVE

Verified three independent ways per branch (`merge-base --is-ancestor`,
bidirectional `rev-list --count`, and `git diff --stat` returning zero files).
No unshipped hunks exist in this group.

**Owner asks that INV-1 shows are ALREADY SHIPPED — do not rebuild these:**

- **Sale-detail POS-style add items** — `POST /api/sales/:id/items` at
  `cloudflare/src/routes/sales.ts:1705`, with a product picker in sale detail and a
  ConfirmDialog review step (was `s4/sale-add-items`). Sale amendments audit trail
  (`amendSale` / `getSaleAmendments`) also live (was `s4/sale-amendments`).
- **Reports hub redesign** — 13-view hub, excel + receipt render styles,
  `frontend/src/components/sales/ReportsHub.tsx` and `reports/*`; plus the
  revenue→profit bridge, delivery memo lines and highlighted unpaid-credit block
  across all three statement surfaces (was `s4/reports`, `s4/report-waterfall`).
- **Telegram bilingual EN/KM** — `cloudflare/src/lib/telegramLang.ts`, `/report <date>`,
  `/shift`, `/shifts` commands, chat allow-list, actor naming on status updates,
  `sendTelegramShiftReport` already wired into the shift-close route.
- **Shift registration** — migration `0116_shift_sessions.sql`,
  `cloudflare/src/routes/shifts.ts`. Records cashier (`user_id`, `user_name`),
  datetime (`business_date`, `opened_at`, `closed_at`), money (`opening_float_usd/khr`,
  `closing_counted_usd/khr`), branch, device, notes. `UNIQUE(user_id,
  COALESCE(branch_id,-1), business_date)` enforces once-a-day; close is
  `WHERE closed_at IS NULL`.
- **awaiting_payment holds stock**, and the admin-only "don't touch stock" toggle
  (migration `0114_sales_stock_skipped.sql`).

**Genuine gap INV-1 found in the shift area (new scope, not latent on any branch):**
shift registration has **no edit route, no manager override, and no list/history
endpoint** — only `GET /current` scoped to the calling user. `audit()` fires on
`shift.open`/`shift.close` but there is no amendment trail comparable to sale
amendments. The owner's "add and edit, each leaves a record" requirement is
genuinely unbuilt.

## Owner request register (Sep 5)

| # | Request | Disposition |
|---|---|---|
| R1 | Two-layer compact mobile nav, expandable group buttons, new header, settings toggle | pending INV-2/INV-8 |
| R2 | Report/summary redesign: large segmented layout, dividers, compact date range, simplify + reorder | partly shipped (INV-1); pending INV-9 |
| R3 | Shift overhaul: settings toggles (per-account vs all-accounts, admin exempt), add/edit with audit record, profile summary, show in sales/expenses/income, Telegram on end | registration shipped; **edit/audit/list genuinely missing**; pending INV-5 |
| R4 | Sale-detail POS-style add/edit | **already shipped** — verify against owner's expectation rather than rebuild |
| R5 | Money: include awaiting payments in revenue/profit; negative revenue; one unpaid row | pending INV-4 — likely a policy change, not a bug |
| R6 | Three Khmer label renames | keys located, see below |
| R7 | Full data scoping, no false zero-stock, branch products section | pending INV-6 |
| R8 | Harvest the ~90 unmerged branches | INV-1 done (0 of 30 valuable); INV-2/INV-3 running |

## R6 — the three Khmer renames, keys located

Read from `origin/rc/ee-integrate-2026-09-04:frontend/src/lang/{en,km}.json`:

1. `rpt_net_sales` — EN `"Net sales"` → **"Total sales"**; KM `"ការលក់សុទ្ធ"` → **"ការលក់សរុប"**
2. `rpt_gross_profit` — EN `"Gross profit"` → **"Total Profit"**; KM `"ប្រាក់ចំណេញដុល"` → **"ប្រាក់ចំណេញចុងក្រោយ"**
3. Unpaid credit — owner wrote `ឥណទានមិនទាន់បង់` → `ទឹកប្រាក់មិនទាន់បង់`, EN "Not Paid".
   **That exact Khmer string is NOT in the pack.** Closest is
   `credit_awaiting_payment` = `"ឥណទាន — រង់ចាំការទូទាត់"`. Needs a render-site sweep
   before renaming — the owner may be reading a composed string.

**⚠️ COLLISION TO RESOLVE WITH THE OWNER:** `rpt_total_profit` already exists and reads
EN `"Total profit (net result)"` / KM `"ប្រាក់ចំណេញសរុប (លទ្ធផលសុទ្ធ)"`. Renaming
`rpt_gross_profit` to "Total Profit" makes two different figures both read "Total
profit". Must be settled before the rename lands.

## Coordinator verification of INV-1 (session `3a`, independent re-run)

INV-1's findings were re-derived from scratch rather than accepted:

- **30/30 `s4/*` branches contained** in `rc/ee-integrate-2026-09-04`. CONFIRMED.
- **Positive control passed** — the same loop returned NOT contained for
  `origin/rc/deploy-2026-09-04` and for `origin/main`. This matters: a containment
  sweep that answers "yes" for every input is indistinguishable from a broken
  instrument. The control proves the instrument discriminates.
- **`app.post('/:id/items', ...)` confirmed at `cloudflare/src/routes/sales.ts:1705`**,
  documented from `:1674`. R4 (POS-style add to sale) is shipped code.
- **`cloudflare/migrations/0116_shift_sessions.sql` confirmed present.**
- **Shift route endpoint census, first-hand:** `shifts.ts` exposes exactly three —
  `GET /current` (`:104`), `POST /open` (`:122`), `POST /close` (`:186`).
  **No edit route, no list route, no history route.** INV-1's gap claim CONFIRMED.

Consequence for R3: the shift *overhaul* is a genuine build, but the shift *record*
(cashier, datetime, money, branch, device, notes) already exists and must be extended,
not recreated.

## INV-5 result — shift system (COMPLETE, coordinator-verified)

Seven shift branches audited (`s4/shift-register`, `s4/shift-credit-line-ee`,
`s4/receipt-shift-breakdown`, `s4/telegram-actor-ee`, `s4/telegram-bilingual`, plus
local-only `s4/shifts-ee` and `s4/shift-times-summary`). **All seven are ancestors of
the deployed commit** — no unshipped shift work is parked on any branch.

### Already done (do not rebuild)
- Shift record with cashier / datetimes / money — `cloudflare/migrations/0116_shift_sessions.sql`
- Non-dismissible once-per-day prompt — `frontend/src/components/pos/ShiftGate.tsx:154-296`
- Telegram send on close — `cloudflare/src/routes/shifts.ts:252` -> `sendTelegramShiftReport`
- Bilingual EN/KM report body — `cloudflare/src/lib/telegram.ts:373-459`

### Genuinely NOT STARTED (the real R3 build)
1. Settings toggle for shift mode — no shift key exists in `settings` or `system_flags`
2. Per-account vs one-shift-for-all — the index is `UNIQUE(user_id, COALESCE(branch_id,-1), business_date)`,
   fundamentally per-user; `readCurrent()` (`shifts.ts:89-113`) is hardwired to `user_id`
3. Admin exemption and its toggle — zero role checks in `shifts.ts`; `isAdminControlUser`
   (`permissions.ts:65`) exists but is never imported there
4. Add/edit leaving a record — routes are deliberately write-once; no edit endpoint,
   no `shift_session_edits` table
5. Non-sensitive shift summary in Profile — `UserProfileModal.tsx` sections are
   `personal | login_methods | security | organization`, no shift section
6. Shifts shown in Sales / Expenses / Income — zero shift UI in those trees
7. Divider lines INSIDE a single shift's Telegram message — dividers (`'-'.repeat(18)`
   style) exist only BETWEEN shifts in the `/shift [date]` reply

### UNREQUESTED DEFECT FOUND — shift history is not backed up
`shift_sessions` appears 0 times in `cloudflare/src/lib/backup.ts`; it is absent from
`BACKUP_TABLES`. Positive control: `system_flags` appears once, so the search
discriminates. Shift history is therefore never captured by manual or scheduled backup
and never touched by restore — silently orphaned data. Any append-only shift edit ledger
built for R3 inherits the same hole unless added to `BACKUP_TABLES`.
Coordinator-verified first-hand.

### Client-cache hazard for the implementer
`ShiftGate.tsx` holds a module-level singleton (`sharedShift`, `shiftSubscribers`,
`shiftInFlight`, ~lines 61-100) keyed only on `branchId`, currently always `null`.
A scope toggle must be threaded through that cache key or the prompt shows/hides for
the wrong scope after a branch switch without a reload.

### Tests that will go red (update deliberately, do not paper over)
- `frontend/tests/shiftGate.test.ts` — pins `routeCalls.length === 3` and `writes.length === 2`
- `cloudflare/scripts/test-shift-sessions-pure.cjs` — lifts route SQL by regex; changing the
  SQL shape makes it SILENTLY STOP CHECKING rather than fail loudly
- `test-shift-close-report-pure.cjs` — pins "sends exactly once per state-changing close"
- `test-shift-report-pure.cjs` — pins exact line order; any divider reformat rewrites it
- `test-shift-window-filter-pure.cjs` — pins `cashier_id = @cashierId`; a shop-wide mode
  changes what "this shift's window" means
