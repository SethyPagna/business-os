# Inventory count requests, date chips and cost on the list: Worker contract

Slice B of the 17 Nov 2026 Inventory redesign. The Worker side is built against this file; the frontend lanes (requests panel, list and detail) read it. Everything here is already enforced by the Worker, so a
screen rule is only a convenience.

Migration `0316_inventory_check_line_decisions.sql` adds `inventory_check_approvals.line_decisions_json` (the approver's decisions) and `inventory_check_approvals.line_set_json` (the lines the approval was created with, see section 3).
It must be applied before the Worker that reads them is deployed (deploy order: migrations, then the Worker; a Worker that runs ahead of it fails the count pages and the Fix stock and Set holds).

## 1. One decision on one line

```
POST /api/inventory-checks/sessions/:id/approval/lines
{ "productId": 12, "action": "reject" | "modify" | "reopen", "counted"?: 4, "lots"?: [{ "batchId": 10, "counted": 4 }], "note"?: "text", "requestId": "<8-120 of A-Za-z0-9_->" }
```

* `reject`: the line will not be applied. `reopen`: removes an earlier reject or modify (while the approval is pending). `modify`: the figure the line is applied from.
* `modify` takes exactly one of `counted` (a line counted as one figure) or `lots` (a line counted by received date; only dates the count already holds, each at most once; dates not listed keep what the
  counter typed). Figures are whole numbers from 0 to 1,000,000,000. `note` is at most 500 characters (trimmed; blank is none). `reject` and `reopen` take neither `counted` nor `lots`.
* No stock moves. The counter's own figures in the count are never changed. A modified line is applied later, by Approve, as the variance (modified - seen) on the stock of that moment, never below 0.
* Replay: the same `requestId` with the same input answers again with `"replayed": true` and writes nothing; the same `requestId` with other input is `409 inventory_check_request_reused`.
* 200 body: `{ approval, applied: 0, remaining, done, line: { productId, action }, replayed? }`.
  * `approval` is the approval detail (below). `remaining` is how many lines are still open. `done` is true when the approval ended with this decision.
  * A reject that leaves no line open ends the approval in the same batch: `approved` if anything was applied, otherwise `rejected` (by the approver, never "replaced"). It stays pending when nothing was applied
    but another approver's claim is held AND has planned or applied something (that claimer finishes or closes it). A claim that planned and applied nothing does not hold it: the last reject ends it as
    `rejected` by the approver (`closed: { lines: {} }`). One Telegram alert is sent when an approval ends; none per line.
  * When a newer count replaces the last open line after the approver rejected another line, the approval ends as that approver's rejection (`decided_by_name` is the approver, no `replaced` flag, no "Replaced by a
    newer count" note) and the one alert names them with the rejected lines; with no rejected line it is still the system's `replaced` end.

Refusals (always `{ error, code }`, plus `productIds` where a line is named):

| status | code | when |
|---|---|---|
| 400 | `inventory_check_invalid_request` | body is not an object, unknown key, both `counted` and `lots`, `counted`/`lots` on reject or reopen, bad `lots` |
| 400 | `inventory_check_request_id_required` | `requestId` missing or malformed |
| 400 | `inventory_check_invalid_id` | `productId` or a `batchId` is not a positive integer |
| 400 | `inventory_check_invalid_action` | action is not reject, modify or reopen |
| 400 | `inventory_check_invalid_note` | note is not text or longer than 500 characters |
| 400 | `inventory_check_quantity_required` | modify with neither `counted` nor `lots` |
| 400 | `inventory_check_invalid_quantity` | a figure is not a number from 0 to 1,000,000,000 |
| 400 | `inventory_check_target_not_whole` | a figure is not a whole number |
| 400 | `inventory_check_lots_required` | modify of a line counted by date with `counted` |
| 400 | `inventory_check_lots_not_allowed` | modify of a line counted as a total with `lots` |
| 400 | `inventory_check_line_date_not_counted` | a `batchId` the count does not hold |
| 403 | `inventory_check_approve_required` | not allowed to approve counts (reject, modify and reopen all need it) |
| 403 | `inventory_check_adjust_required` | modify without Inventory adjust at Full |
| 403 | `inventory_check_self_approval` | modify of one's own count while another approver exists |
| 403 | `inventory_check_authority_changed` | the account or session changed (as everywhere else) |
| 404 | `inventory_check_session_not_found`, `inventory_check_approval_not_found`, `inventory_check_line_not_found` | |
| 409 | `inventory_check_approval_decided` | the approval already ended |
| 409 | `inventory_check_approval_lines_changed` | the count no longer matches its approval |
| 409 | `inventory_check_line_applied` | the line was already applied |
| 409 | `inventory_check_line_in_progress` | the line is planned or part-applied |
| 409 | `inventory_check_count_superseded` | a newer count replaced the line |
| 409 | `inventory_check_line_already_rejected` | reject of a rejected line |
| 409 | `inventory_check_line_not_decided` | reopen of a line with no decision |
| 409 | `inventory_check_baseline_missing` | modify of a line with no recorded starting stock |
| 409 | `inventory_check_modify_matches_seen` | the modified figures equal what the counter saw on every date (reject the line instead) |
| 409 | `inventory_check_conflict` | the approval changed between the read and the write: repeat |
| 409 | `inventory_check_request_reused` | the request id was used with other input |
| 503 | `inventory_check_outcome_unknown` | unknown outcome: repeat the SAME request |

The input-to-verdict table the Worker validates against is exported for the frontend validator as `cloudflare/scripts/fixtures/inventory-check-line-decision-verdicts.json`
(`{ cases: [{ name, body, shape: { dated, batchIds }, verdict: { ok: true, input } | { ok: false, status, code } }] }`). `shape.dated` is true when the line is counted by received date and `batchIds` are its
dates. The frontend must give the same verdict (status and code, and the normalised `input` for an accepted row) for every case.

## 2. Accept lines: `productIds` on Approve

```
POST /api/inventory-checks/sessions/:id/approval
{ "decision": "approve", "productIds"?: [12, 15], "requestId": "...", "note"?: "..." }
```

* `productIds` (approve only, 1 to 500 distinct positive integers) accepts those lines and leaves the rest open. Absent: every open line, exactly as before.
* Open lines exclude lines already applied, replaced by a newer count, and rejected. An id that is not a line of the count is `404 inventory_check_line_not_found`; a rejected line is
  `409 inventory_check_line_rejected`; an id already applied or replaced is simply skipped (a repeat of the request is fine).
* `done` is true when what the request asked for is applied; `approval.status` says whether the whole approval ended (it ends when no line is left open: `approved` if anything was applied, otherwise
  `rejected`). The client repeats the same request while `done` is false (Free: one stock line per request), as before.
* A modified line is applied from the modified figure. Another approver cannot accept lines while a claim is held by someone else (`409 inventory_check_approval_in_progress`), as before.
* `close` keeps its meaning (no stock moves; lines applied stay applied; the rest are recorded as not applied). Rejected lines are not listed as not applied.
* `productIds` with any other decision is `400 inventory_check_invalid_request`; an empty or malformed list is `400 inventory_check_product_ids_required` / `inventory_check_invalid_id`.

## 3. The approval detail (`session.approval`, and `approval` in decision answers)

New field `line_decisions`: `{ "<productId>": { "decision": "reject" | "modify", "counted"?: n, "lots"?: [{ "batchId": n, "counted": n }], "note"?: text, "at": ISO time, "by_name"?: username } }`
(`by_name` only for a viewer who may see staff names; the account id is never sent). An absent key means the line is open. `lines`, `applied_lines`, `superseded`, `closed` are as before.

A rejected line no longer counts as "waiting" anywhere (the Waiting filter, the row's pending tag, Fix stock's hold).

**The lines of an approval are a stored set.** `line_ids` (the approval detail, ascending product ids) is the set of products the count found different from stock, fixed when the approval is created and never changed. It is
exactly the products the server treats as lines, including a product whose received dates differ although their totals agree (A counted 6 of 5, B 3 of 4): that product IS a line and is listed, whatever its total says.
The panel must list `line_ids` and not re-derive lines from the figures. `lines` is their count (`line_ids.length`). `line_ids` is absent only for an approval created before migration 0316 (or by a Worker that did not know
the column: in the window between `migrations apply` and the publish, or after a rollback): the server then reads its lines by the engine's own rule (the item total, or any received date) everywhere, and the panel
falls back to the items whose figures differ. The ops query `inventory-check-approvals-postflight` counts these rows (expect 0 after the publish); the separate `inventory-check-approvals-pre-rollback` query (run only before `deploy-rollback.yml`) counts pending approvals that carry per-line decisions. A newer count of a product in the set replaces that line (`superseded`); the approval ends as replaced only when no line of the set
is left open (not superseded, not rejected), so a newer count of another product never ends it.

**A claim stays after a partial accept, and `planned_lines` says which lines it holds.** An accept of some lines (`productIds`) applies them and leaves the approval claimed (`applying: true`, plus `applying_request_id` for the approver who
holds it): the claim ends only when the approval is decided. Decisions on the OTHER lines stay valid under it (a reject, a modify or a reopen, by the claimer or by anyone who may approve); only a line the claim has planned or
part-written is refused (`409 inventory_check_line_in_progress`). The approval detail therefore carries, while it is pending and claimed, `planned_lines`: the ascending product ids of exactly those lines, taken from the keys of
the plan (`"<product>"` or `"<product>:<batch>"`) and of the received dates already written (`applied_json.units`), with no database read of its own. It is `[]` right after a line landed and nothing else is planned. A panel offers
no decision on a line in `planned_lines` (it is being applied, or waiting for the approver who is applying it) and offers every other line its decisions. A Worker that sends no `planned_lines` for a claimed approval cannot say
which lines are held; a panel then treats every undecided line as held. An approval nobody has claimed carries no `planned_lines`. The answer to an accept carries `applied`, `remaining` and `done` for the request (an accept of
one line that landed answers `done: true` while the approval stays pending).

### History

Every decision is one audit event on the product in the session History (`GET /sessions/:id/history`, action `observe`): `after.approval` is `line_rejected`, `line_modified` or `pending` (a reopen),
`before.approval` the line's state before; for a modify `after.counted_quantity` is the modified total and `after.reason` the note. When a modified line is applied, its Stock Changes movement reads
`Inventory check approved: modified to N (counted M)` (per received date for a dated line) and the applied event keeps the counter's figure in `counted_quantity` with `modified: true` and the approver's total in
`modified_counted_quantity`; each applied date entry carries `counted` (the approver's) and `was` (the counter's). An approval that ends because of a reject adds the usual approval event
(`after.approval` `approved` or `rejected`). The Telegram alert, once, when the approval ends with rejected lines, has a row `Lines: 3 approved, 1 rejected`; without rejected lines the alert is unchanged.

## 4. Date chips

`GET /api/inventory-checks/list` and `GET /api/inventory-checks/overlay` return `summary.days: [{ "day": "2026-11-12", "count": 3 }]`, newest first, under the same rule as the status counts
(`summary=0` leaves it out; one branch only; `{ "tooLarge": true }` when the branch has more checked products than `inventoryCheckFilterMaxIds`, see below). Each product sits under the Cambodia
business day (UTC+7) of its LATEST count at the branch. No new D1 statement is made for it.

**Too many checked products.** When the branch has more checked products than `inventoryCheckFilterMaxIds`, the summary is `{ "tooLarge": true }` (no `ok`, `issue`, `pending`, `not_checked`, `total` or `days`)
instead of being left out, so a page that holds chips or counts from an earlier answer clears them. The check-state and day filters are refused (`503 inventory_check_filter_too_large`) while it holds.

**The day is the day the product was counted, never the day it was approved, and "latest" is the most recent COUNT by count time.** Approving a line flips its state to Done and changes nothing else about the count: the item keeps
the time and the person of the count that made it (a submission's commit, an observation's save, the Set that closed an Issue; migration 0316 restores them for an approval an earlier Worker had already flipped). So the
chip day, the choice of a product's latest count (the list's state and chips, the overlay, the Set that closes an Issue), the overlay's `check.at` and its `check.by` (the counter, never the approver) all read the same two
columns and always agree. Approving an OLDER count never makes it the newer one: a submission of 12 Nov approved on 17 Nov leaves an open-session Issue of 13 Nov as the product's latest, under 13 Nov. Who approved and
when is the approval's own `decided_by_name` / `decided_at`. A count made on 12 Nov and approved on 17 Nov is under 12 Nov. A reopened Set (Undo) is a new count made on the day of the Undo.

`GET /list?branchId=1&checkedOn=2026-11-12` keeps only products whose latest count was on that day; it combines with `checkState`, search, brand, category and the other filters. `checkedOn` must be a real
calendar date `YYYY-MM-DD` and needs a single branch (`branchId`), otherwise `400 inventory_check_invalid_query` with `parameter: "checkedOn"` (or `"branchId"`). It cannot be combined with `ids`.
With more checked products than the cap the filter is refused `503 inventory_check_filter_too_large`, as the status filters are.
`checkedOn` belongs to this list only: the older products list and the scope of a new session refuse it (`400 inventory_check_invalid_query`, `parameter: "checkedOn"`), as they did before the chips existed.

## 4b. The request a product is waiting on (the overlay)

`GET /api/inventory-checks/overlay` marks a product whose count line still waits for approval with `pending: true` and, with it, `pending_session_id`: the session whose approval holds that waiting line (one waiting line per
product: a newer submission replaces an older one). It is NOT necessarily the session of the product's latest count (`check.session_id`): a product submitted on 12 Nov and waiting, then observed in an open session on 13 Nov, has
`check.session_id` of the 13 Nov session and `pending_session_id` of the 12 Nov one. The Open request link opens `pending_session_id`. Both fields are sent only to a viewer who may see stock, as `pending` always was.

## 5. Cost on the list

`/list` rows keep `cost_price_usd`, `cost_price_khr`, `cost_needs_review`, `purchase_price_usd`, `purchase_price_khr` and `cost_review_key` for a viewer for whom `canViewAcquisitionCosts(user)` is
true (the Worker's `getInventoryCheckAccess(user).fields.cost` is now exactly that, for a viewer who may view Inventory Check). They are removed for everyone else, in the list, its exports and the overlay.
The overlay itself carries no cost.

## 5b. A recount while a line is being applied

`POST /api/inventory-checks/submissions` is refused with `409 inventory_check_count_in_progress` (and `productIds` naming them) when any submitted product has a line that is being applied: one of its stock writes is
planned (under any key form: a product with several differing received dates is planned once per date) or one of its dates has already landed and the product is not yet complete. Nothing is recorded, nothing is replaced,
and the refusal tells nobody what the stock holds. The approver finishes the approval (repeat Approve) or closes it (Close keeps what landed, recorded as partial); the recount can then be made. A line whose writes never
landed is not held: the claim is released and the recount replaces it as usual. An approval is never ended "Replaced by a newer count" while one of its dates has landed.

## 6. Language keys the UI is expected to need (not added to the packs by this lane)

Buttons (icon-only, translated tooltip): `inventory_check_line_accept`, `inventory_check_line_modify`, `inventory_check_line_reject`, `inventory_check_line_reopen`.
Chips and labels: `inventory_check_line_decided_reject`, `inventory_check_line_decided_modify`, `inventory_check_line_decided_by`, `inventory_check_line_modified_to`, `inventory_check_line_open`.
Confirm dialog: `inventory_check_line_reject_confirm`, `inventory_check_approve_all_confirm`. Date chips: `inventory_check_days_all`.
Refusals (the `inventory_check_error_<suffix>` pattern of `inventoryCheckRefusals.ts`): `inventory_check_error_line_applied`, `..._line_in_progress`, `..._line_rejected`, `..._line_already_rejected`,
`..._line_not_decided`, `..._line_not_found`, `..._lots_required`, `..._lots_not_allowed`, `..._line_date_not_counted`, `..._quantity_required`, `..._invalid_quantity`, `..._modify_matches_seen`,
`..._request_reused`, `..._conflict`.
