# Design spec — rename link-over + Conflicts, scoped grants, stock reasons in Settings, incomes on Expenses

Written Sep 3 2026 by session business-os-v1-6d (docs only, no code). Facts below were read from
committed HEAD `c6068072` (+ lane commit `1b0dfe1c`) and are **reference to re-verify** before a lane
starts. Every item follows the standing rules: root cause over symptom, sibling-surface parity in
the same commit, both language packs, per-action permission keys, verified for real in both packages
and in the browser. Nothing here is implemented unless the "Status" column says so.

## 1. Rename link-over ("full link-over" vs "show past record → Conflicts")

**User rule.** Renaming any branch / supplier / cashier (user) / customer / delivery contact / fee
label automatically asks: *link everything over* (every past record now shows the new name) or
*keep the past records as they were* (old name stays on history; the pair is saved in Conflicts so
it can be linked over later). Never a silent rename.

### 1.1 Status matrix (HEAD + 1b0dfe1c)

| Entity | Impact preview (`GET …/rename-impact`) | Write gate (`409 rename_choice_required`, `__rename_cascade`) | UI prompt (`RenameCascadeModal`) | Kept-past pair visible in Conflicts |
|---|---|---|---|---|
| Customer | yes (`routes/contacts.ts:609`) | yes (`:1012`) | yes (CustomersTab) | **no** |
| Supplier | yes | yes | yes (SuppliersTab) | **no** |
| Delivery contact | yes | yes after `1b0dfe1c` | yes after `1b0dfe1c` (DeliveryTab) | **no** |
| Category / brand / unit / product name | yes (`routes/products.ts:1719`, `lib/renameCascade.ts`) | yes (`routes/lookups.ts:188`) | yes | **no** |
| User (cashier) | **no GET** | yes (`routes/users.ts:474`, `:557`) | partial — the gate exists, the prompt must be checked on Users.tsx / UserProfileModal | **no** |
| Branch | **none** (`routes/branches.ts` has no rename code) | **none** | **none** | **no** |
| Fee label | separate mechanism: `GET /labels/impact`, `POST /labels/replace`, `POST /labels/classify` (`routes/fees.ts:297-346`) | not the shared gate | not the shared modal | **no** |

Denormalized name snapshots that a rename touches (`migrations/0001_init.sql`): `branch_name`
(:309, :484, :546), `user_name` (:84, :319), `cashier_name` (:481, :544), `actor_user_name` (:69);
plus `sales.delivery_contact_name`, customer/supplier snapshots handled by `contacts.ts` today.
The lane must grep every `*_name TEXT` column in `cloudflare/migrations` before choosing the carry
set — the user's rule is that a link-over moves **every** linked record, never a subset.

### 1.2 One shared contract for all kinds

- Extend the frontend `RenameKind` (`api/renameCascadeTransport.ts:6`) and the backend
  `lib/renameCascade.ts:21` union together: add `'delivery_contact'` (frontend has it after
  `1b0dfe1c`), `'branch'`, `'fee_label'`, `'user'`. One type, two copies today — the lane should
  make the frontend import the backend union or add a source-shape test that locks the two lists
  equal.
- Every kind exposes `GET …/:id/rename-impact?to=` returning the shared `RenameImpact`
  (`live_snapshots` per table, `historical_snapshots_preserved`, `target_exists`).
- Every write path (PUT, bulk edit, import-update, undo/redo replay) refuses a name change without
  `__rename_cascade: 'carry' | 'record_only'` (409 `rename_choice_required`). Undo/redo replays the
  choice the user already made (see DeliveryTab's history builder in `1b0dfe1c`).
- The prompt is the shared `RenameCascadeModal` with `choices: ['carry', 'only']`; label text for
  the new kinds goes in both packs.
- `target_exists` → stop and point the user to Conflicts (existing behaviour for contacts).

### 1.3 "Show past record" lands in Conflicts

There is no generic conflict table today: products use `product_duplicate_dismissals` (0083),
contacts use `contact_duplicate_dismissals` (0034), clusters are computed in memory. The kept-past
pair needs a home, so add one small generic table (migration `0107_rename_links.sql`; 0106 is
taken by the ChatGPT batch):

```
rename_links(id, entity_kind TEXT, entity_id INTEGER, old_name TEXT, new_name TEXT,
             decision TEXT CHECK(decision IN ('carry','record_only')),
             decided_by_user_id INTEGER, decided_at TEXT, linked_over_at TEXT NULL,
             linked_over_by_user_id INTEGER NULL)
```

- Every rename writes one row (both decisions — the carry rows are the audit trail; the
  `record_only` rows with `linked_over_at IS NULL` are the open Conflicts items).
- Conflicts gets a **Renames** list per entity kind next to Possible Duplicates: old name → new
  name, decided by / when, counts of records still carrying the old name (computed live from the
  snapshot columns), one action **Link over now** (runs the same carry cascade, sets
  `linked_over_at`) and one **Keep** (dismiss, stays queryable). Read-only tier sees the list, full
  tier acts — model it as `review:renames_view` / `review:renames_link` action keys.
- Old-name records stay searchable: the search helpers (`utils/searchMatch.ts`, contact/product FTS)
  must match the old name through `rename_links` so "show past record" never hides history.

### 1.4 Per-entity notes

- **Branch.** Two canonical branches only (`shop`, `warehouse`); a rename is rare but must follow the
  contract. Carry set = every `branch_name` column above plus `inventory_movements`, transfers,
  `stock_row_moves`. Stock identity (batch + branch) is by id and is untouched.
- **User / cashier.** The id is the source of truth; a username rename must cascade to every
  `user_name` / `cashier_name` / `actor_user_name` snapshot when carry is chosen (standing rule from
  the cashier reconciliation). Add the missing GET impact; confirm the prompt is mounted in both
  admin edit and self-profile edit; the legacy cashier map (Aza→Za etc.) must be re-expressed as
  `rename_links` rows so Conflicts shows it.
- **Fee label.** Keep the existing label cascade as the engine but front it with the shared prompt:
  carry = `/labels/replace` over all rows; record_only = the new label applies to future rows only
  and a `rename_links(entity_kind='fee_label', entity_id=NULL)` row is written. Labels remain short
  saved tags (≤6 words / 60 chars) that drive `fee_type` auto-selection.

## 2. Scoped grants: cost price, exports/imports, hidden columns

**Today.** No cost-specific key exists. Cost price is shown ungated wherever the `products`
permission is granted: Products list, `ProductDetailModal`, POS `ProductDetailSheet`
(`cost_price_usd/khr` :46-47), CSV export (`helpers/productExport.ts:132-133`). Only the
mutually-exclusive `products_image_only` grant (`permissionDefinitions.ts:254-294`) never carries
cost, enforced server-side by `lib/productWrites.ts` `IMAGE_ONLY_OPTIONAL_FIELDS` (:336).

**Design.**

- Add per-action keys under the existing `perm_act_<section>_<action>` pattern
  (`permissionDefinitions.ts`, `lib/permissions.ts` `getActionTier`):
  `products:view_cost`, `products:export`, `products:import`, `sales:export`, `contacts:export`,
  `contacts:import`, `inventory:export`, `fees:export`, `reports:view_profit` (profit needs cost).
  Full Access keeps everything; new roles default to **no** cost / no export.
- **Server strips, client hides.** Without `products:view_cost` the Worker removes
  `cost_price_usd/khr`, batch unit cost, paid-credit state and every derived margin/profit field
  from product, batch, stock-in-session, report and export payloads (same mechanism as
  `IMAGE_ONLY_OPTIONAL_FIELDS`, applied by role tier instead of by grant kind). The client then
  hides the columns in the column chooser (excel-style tables keep the chooser; the option is
  absent, not disabled) and the detail/POS sheets, and the receipt-style mobile views never render
  the field. A client-only hide is not acceptable.
- Export/import buttons follow the action key on every sibling surface (list toolbar, bulk bar,
  Settings → Data, Backup) and the routes return 403 under the same key — one rule, two layers,
  locked by a source-shape test that walks every `export`/`import` handler.
- Permission editor: each new key is a toggle inside its section with an InfoHint, both packs, and
  the mechanical i18n + permission-actions locks extended.

## 3. Stock-removal / adjust reasons — unify in Settings

**Today.** Reasons are already a saved catalog, not hard-coded: `settings.inventory_saved_reasons`
(JSON), `GET/PUT /api/inventory/reasons`, `/reasons/impact`, `/reasons/replace`
(`routes/inventory.ts:950-1066`, gated by `inventory:edit_reasons`); types
`adjust | transfer | move | delete` (`StockAdjustModal.tsx:63`, `InventoryReasonManagerModal.tsx`,
`BranchStockAdjuster.tsx`); stored in `reason TEXT` on `inventory_movements`, `returns`,
`stock_row_moves` (0001_init :316, :485, :602).

**Gap.** The manager is reachable only from the adjust modals; removal paths outside them
(ManageBatches deactivate, returns write-off/damaged, the coming duplicate-merge WRITE-OFF choice,
import zeroing) write free text or nothing.

**Design.**

- Settings gains an **Inventory reasons** mini-section that mounts the existing
  `InventoryReasonManagerModal` inline (same component, no fork), grouped by type, with the
  impact/replace flow it already has.
- Every stock-removing surface consumes the same catalog through one hook
  (`useInventoryReasons(type)`): StockAdjustModal, BranchStockAdjuster, ManageBatches deactivate,
  NewReturnModal write-off, duplicate-merge write-off, FastStockIn corrections. A custom reason is
  allowed but is offered "save to Settings" on the spot.
- Every removal posts a ledgered movement with `reason` set — a bare quantity edit is never the
  path. Lock: a source-shape test that every writer of `inventory_movements.quantity < 0` carries a
  reason.
- Telegram stock-change alerts already carry the resulting on-hand and total stock; add the reason
  label to the same line.

## 4. Expenses page holds expenses AND incomes

**Today.** `FEE_TYPES = ['tax','delivery','change','expense','other']` (`routes/fees.ts:43`),
labels are free text on `fees.label` (catalog derived by `GET /labels`), and the word "income"
appears nowhere in either package.

**Design (revenue definition untouched).**

- Migration `0107` (or next free): `ALTER TABLE fees ADD COLUMN direction TEXT NOT NULL DEFAULT
  'expense' CHECK(direction IN ('expense','income'))`; existing rows stay `expense`.
- `fee_type` gains `'income'`; labels stay shared tags, each tag remembering its last direction
  so picking "Rent received" auto-selects income.
- UI: the Expenses page keeps one list with a direction chip filter inside the shared FilterMenu,
  the stats header shows Expenses / Incomes / Net for the selected range, the add form has a
  direction toggle on the first row. Mobile keeps the receipt-style rows.
- Money rules: incomes are **not** sales revenue. The dashboard/reports show them as a separate
  "Other income" secondary figure; `netSaleExpr`, `revenue_usd`, Pending and Total collected are
  unchanged (`lib/salesAnalytics.ts`). Delivery expenses linked to contacts (0105) keep working.
- Telegram: fee alerts (`routes/fees.ts:421`) state the direction.

## 5. Telegram coverage (for the audit, already live)

`sendTelegramEvent` is called from sales (`routes/sales.ts:897,1355`), fees (`:421`), inventory
(`routes/inventory.ts:1607,1865`), branch transfers + stock out (`routes/branches.ts:501,807`);
returns use `sendReturnTelegramEvent` (`routes/returns.ts:1427,1696`); all stock alerts carry the
resulting on-hand per branch and the total. Remaining to verify, not build: stock-in sessions
(`FastStockInModal` → which inventory route) and the receipt-summary formatting on a phone.

## 6. Reports (pointer)

The Reports redesign is owned by the RC lane sec-10 (session 8c). Requirements from the user that
the lane must satisfy: per-sale profit list (needs `products:view_cost` / `reports:view_profit`),
multiple views (excel-style table with column chooser on large screens, receipt-style cards on
mobile), and selectable calculation options (revenue definition fixed; toggles for tax, delivery,
refunds, credit pending, cost basis batch vs latest).

## 7. Decisions needed from the user

1. Conflicts "Renames" list: one shared list filtered by kind (proposed) or one per tab?
2. `record_only` for a **user** rename: keep old cashier name on past receipts (proposed) or always
   carry, given the id-is-truth rule?
3. Which roles get `products:view_cost` by default besides Full Access (proposed: none).
4. Incomes on the same Expenses page (proposed) or a sibling section chip "Incomes"?
