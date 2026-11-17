# Inventory count requests, date chips and cost on the list: Worker contract

Slice B of the 17 Nov 2026 Inventory redesign. The Worker side is built against this file; the frontend lanes (requests panel, list and detail) read it. Everything here is already enforced by the Worker, so a
screen rule is only a convenience.

Migration `0316_inventory_check_line_decisions.sql` adds `inventory_check_approvals.line_decisions_json`. It must be applied before the Worker that reads it is deployed.

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
    but another approver's claim is held (that claimer finishes or closes it). One Telegram alert is sent when an approval ends; none per line.

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

### History

Every decision is one audit event on the product in the session History (`GET /sessions/:id/history`, action `observe`): `after.approval` is `line_rejected`, `line_modified` or `pending` (a reopen),
`before.approval` the line's state before; for a modify `after.counted_quantity` is the modified total and `after.reason` the note. An approval that ends because of a reject adds the usual approval event
(`after.approval` `approved` or `rejected`). The Telegram alert, once, when the approval ends with rejected lines, has a row `Lines: 3 approved, 1 rejected`; without rejected lines the alert is unchanged.

## 4. Date chips

`GET /api/inventory-checks/list` and `GET /api/inventory-checks/overlay` return `summary.days: [{ "day": "2026-11-12", "count": 3 }]`, newest first, under the same rule as the status counts
(`summary=0` leaves it out; one branch only; absent when the branch has more checked products than `inventoryCheckFilterMaxIds`, exactly as the status counts are). Each product sits under the Cambodia
business day (UTC+7) of its LATEST count at the branch. No new D1 statement is made for it.

`GET /list?branchId=1&checkedOn=2026-11-12` keeps only products whose latest count was on that day; it combines with `checkState`, search, brand, category and the other filters. `checkedOn` must be a real
calendar date `YYYY-MM-DD` and needs a single branch (`branchId`), otherwise `400 inventory_check_invalid_query` with `parameter: "checkedOn"` (or `"branchId"`). It cannot be combined with `ids`.
With more checked products than the cap the filter is refused `503 inventory_check_filter_too_large`, as the status filters are.

## 5. Cost on the list

`/list` rows keep `cost_price_usd`, `cost_price_khr`, `cost_needs_review`, `purchase_price_usd`, `purchase_price_khr` and `cost_review_key` for a viewer for whom `canViewAcquisitionCosts(user)` is
true (the Worker's `getInventoryCheckAccess(user).fields.cost` is now exactly that, for a viewer who may view Inventory Check). They are removed for everyone else, in the list, its exports and the overlay.
The overlay itself carries no cost.

## 6. Language keys the UI is expected to need (not added to the packs by this lane)

Buttons (icon-only, translated tooltip): `inventory_check_line_accept`, `inventory_check_line_modify`, `inventory_check_line_reject`, `inventory_check_line_reopen`.
Chips and labels: `inventory_check_line_decided_reject`, `inventory_check_line_decided_modify`, `inventory_check_line_decided_by`, `inventory_check_line_modified_to`, `inventory_check_line_open`.
Confirm dialog: `inventory_check_line_reject_confirm`, `inventory_check_approve_all_confirm`. Date chips: `inventory_check_days_all`.
Refusals (the `inventory_check_error_<suffix>` pattern of `inventoryCheckRefusals.ts`): `inventory_check_error_line_applied`, `..._line_in_progress`, `..._line_rejected`, `..._line_already_rejected`,
`..._line_not_decided`, `..._line_not_found`, `..._lots_required`, `..._lots_not_allowed`, `..._line_date_not_counted`, `..._quantity_required`, `..._invalid_quantity`, `..._modify_matches_seen`,
`..._request_reused`, `..._conflict`.
