# Inventory count tasks: Worker contract

Slice T1 of the 18 Nov 2026 owner request ("issue" means issuing count tasks, not problems). The Worker, the permissions and both language packs are built against this file; the frontend lane (T2) builds from it.
Everything here is enforced by the Worker, so a screen rule is only a convenience. It sits on top of `docs/contracts/inventory-check-requests-20261117.md` (sessions, submissions, approval), which is unchanged.

Migration `0318_inventory_check_task_index.sql` adds one expression index on `inventory_check_sessions` (organization, `scope_json` kind, `scope_json` task). It must be applied before the Worker that reads it is deployed
(migrations, then the Worker). Without it the task routes still answer correctly, but read every session ever made.

## 1. What a task is (no new table, no new column)

| Object | Is | scope_json | Items |
|---|---|---|---|
| Task | an OPEN count session made by an admin | `{ "membership": "task", "products": N, "selection": { "kind": "ids" } \| { "kind": "filters", "filters": { ... } } }` | one per product: state `unstarted`, no baseline, baseline `{}` |
| Pickup | the picker's own OPEN session | `{ "membership": "pickup", "task": "<task id>" }` | none |
| Count for a task | an ordinary submission, closed | `{ "membership": "submission", "task": "<task id>" }` | as any submission |

* A task is never a count: its items are `unstarted` with no `updated_at`, and every list, chip, date, Not checked figure and overlay reads only `done` and `issue` items. Issuing a task changes none of them.
* **The done rule.** A product of a task is DONE once any count of it at the task's branch (state `done` or `issue`, i.e. matches or differs) exists whose time is at or after the moment the task was issued (`started_at` of the task), wherever it was made:
  in a submission that names the task, in any other submission, in an open session, or by a Set that closed a difference. A count made before the issue, or at another branch, never ticks it.
* **Closing.** A task closes itself in the submission that names it and completes its last product (the same atomic batch; its pickup closes with it). A count that is made outside the task and completes it
  leaves the task OPEN (it shows `done = total`, "All counted") until a submission that names it arrives, or an admin closes it. An admin closes it by hand with the existing close (section 4). Undo of an issue is that close record: a compensating event, never a delete.
* The task's own session row is never shown under Count sessions. A pickup is: it is the picker's session (Mine), with the title of its task and the task's progress (section 5).
* A product may be in several tasks; one count ticks every open task that holds it.

## 2. Permissions

| Key | Kind | Default | Needed for |
|---|---|---|---|
| `inventory_check_issue` | an extra of `inventory_checks` (editor: "Issue count tasks") | off; administrators always pass; never implied by counting or Inventory Full | `POST /tasks`; closing any task; handing back any pickup |
| `inventory_checks:tasks` | an action of `inventory_checks` (editor: "Pick up and count tasks") | on for everyone who can count; an explicit `false` switches it off | `GET /tasks`, `GET /list?taskId=`, `POST /tasks/:id/pickup`, `taskId` on `POST /submissions` |

Both also need what every Inventory Check request needs (`inventory_checks` view; counting for every write). Issuing needs the sessions view, the count grant (every write does, so a role that issues must also be able to count) and the extra; handing back needs only the view and being the picker (or the extra).
Working a task needs the count grant (`inventory_checks:check`) and the action. A viewer who may do neither gets `403 inventory_check_tasks_required` on the reads.

## 3. Routes

All answer `404 not_found` while the read switch `ic_wired` is OFF (the page then shows no Tasks). Every writer moves the `inventory_checks` cache version before it answers (awaited), as the other Inventory Check writers do.

### 3.1 `GET /api/inventory-checks/tasks?branchId=1`

The tasks of one branch: every OPEN task (newest issued first, at most `tasksShown`, 30) and then the most recently CLOSED ones (at most `tasksClosedShown`, 5).

```
{ "branchId": 1, "version": "k2:12",
  "items": [{ "id": "<uuid>", "branch_id": 1, "title": "Shelf A", "status": "open" | "closed", "issued_at": ISO, "issued_by": "username", "closed_at": ISO | null,
              "total": 150, "done": 34, "selection": { "kind": "ids" } | { "kind": "filters", "filters": { "brand": "A" } } | null,
              "picked_up_by": "username" | null, "picked_up_at": ISO | null, "mine": false, "pickup_session_id"?: "<uuid>" (only when mine),
              "can_pickup": true, "can_release": false, "can_close": false }],
  "capabilities": { "issue": true, "work": true, "maxProducts": 300 } }
```
* `done` follows the done rule, live as of the version. "All counted" is `done >= total` on an open task. Names are usernames; no account id is sent. `issued_by` and `picked_up_by` are shown to everyone who sees the board (the owner's "Picked up by {name}").
* `can_pickup`: open, nobody has it, and the viewer may work tasks. `can_release`: open, someone has it, and the viewer is that person or may issue. `can_close`: open and the viewer may issue.
* `400 inventory_check_invalid_query` (`parameter: "branchId"`) without a branch; `403 inventory_check_tasks_required` for a viewer who may neither work nor issue tasks.
* **Cache.** One entry per organization and branch, keyed `ict:<inventory_checks version>` (the entry's URL is `https://ic.invalid/__bos/ic-tasks?branchId=<n>&order=1`; the shared key builder adds the deployment, organization and data epoch), kept up to
  `productListCacheSeconds`. The version is moved by every writer that can change a task or a count (issue, pickup, release, close, every submission, every observation, a Set that closes a difference, an Undo of one), so an unchanged open reads nothing and a changed one is fresh. The entry holds account ids; the answer never does.

### 3.2 `POST /api/inventory-checks/tasks` (issue)

```
{ "branchId": 1, "requestId": "<8-120 of A-Za-z0-9_->", "title"?: "text (<= 120)",
  "productIds": [100, 101] }                      // the ids the admin chose
  or "filters": { "query"?, "brand"?, "category"?, "stockState"?, "checkState"?, "checkedOn"? }   // the list's own filters, resolved by the Worker
```
Exactly one of `productIds` and `filters`. Filters are resolved with the list's own reader (`GET /list`, the same planner, grants, check-state restriction and cache; page after page of the list's size), never a copy of its search.
A product the list shows but a person cannot count (a family header) is dropped from a resolved list; an explicit list naming one is refused. The scope records what the admin chose (the ids as `{kind:'ids'}`, or the filters). Nothing about stock is read or written.
* 201 `{ item: <session>, receipt, created: true }`; a repeat of the same request answers 200 with `created: false`. `item.progress` is `{ total, unstarted: total, done: 0, issue: 0 }`, `item.scope` as in section 1, `item.can_edit` true.
* Cap: `getInventoryCheckTaskLimits(env).maxProducts` (`lib/inventoryCheckTaskLimits.ts`) = **300**, the same on Free and Paid (a task is a unit of work for a person, not a plan resource; it also sits under the 500 items a session detail can read). Over it:
  `400 inventory_check_task_too_many` with `{ total, limit }` (the number the filter or list holds), so the admin can narrow it. The writer writes one session row, N item rows and one create event in ONE batch.

| status | code | when |
|---|---|---|
| 403 | `inventory_check_issue_required` | no `inventory_check_issue` (checked before anything is read, and again against the database) |
| 400 | `inventory_check_invalid_request` | body not an object; both or neither of `productIds` and `filters`; a filter key that is not listed or not text |
| 400 | `inventory_check_invalid_query` / `inventory_check_field_hidden` | a filter the viewer may not use (as on `/list`) |
| 400 | `inventory_check_product_ids_required`, `inventory_check_invalid_id`, `inventory_check_invalid_title`, `inventory_check_request_id_required` | as for `POST /sessions` |
| 400 | `inventory_check_product_not_eligible` | a named product is not countable (missing, inactive without stock, a family header), or a filter resolved to nothing |
| 400 | `inventory_check_task_too_many` | over 300 products; carries `total`, `limit` |
| 409 | `inventory_check_baseline_changed` | the branch is not active, or a product changed while issuing |
| 409 | `inventory_check_request_reused` | the request id was used with other input |

### 3.3 `POST /api/inventory-checks/tasks/:id/pickup`  `{ "requestId": "..." }`

Creates the caller's own OPEN session `{membership:'pickup', task:<id>}` with no items: one session row and one create event, in one batch whose guards refuse while the task is closed or already has an open pickup. Safe for two people at once: the guard is inside the batch.
201 `{ item: <the pickup session>, receipt, created: true }`; a repeat answers 200 `created: false`. The pickup's `title` is the task's title.

| status | code | when |
|---|---|---|
| 403 | `inventory_check_tasks_required` | no `inventory_checks:tasks`, or no count grant |
| 403 | `inventory_check_permission_required` | no count grant (the existing write refusal) |
| 404 | `inventory_check_task_not_found` | not a task of the organization |
| 409 | `inventory_check_task_closed` | the task is closed |
| 409 | `inventory_check_task_picked_up` | someone has it: `{ pickedUpBy: "username", mine: boolean }` |

### 3.4 `POST /api/inventory-checks/tasks/:id/release`  `{ "requestId": "..." }`

Hands the task back: closes its open pickup with the existing close writer (the task stays open and can be picked up again). By the picker, or by whoever has `inventory_check_issue`.
200 `{ item: <the closed pickup session>, receipt, released: true }` (a repeat of the same request answers the same with `receipt.replayed`).

| status | code | when |
|---|---|---|
| 403 | `inventory_check_release_forbidden` | neither the picker nor an issuer |
| 404 | `inventory_check_task_not_found` | |
| 409 | `inventory_check_task_not_picked_up` | no open pickup |
| 409 | `inventory_check_conflict` | the pickup changed meanwhile |

### 3.5 `GET /api/inventory-checks/list?branchId=1&taskId=<id>` (count a task)

The wired Inventory list restricted to the task's products, built like the check-state restriction: the task's ids (cached `ict:<version>`, URL `https://ic.invalid/__bos/ic-task?id=<id>&order=1`) intersected with `checkState` / `checkedOn` when those are sent
(a task's Differs, a task's Not checked), and keyed in the list cache as `ic_set=task:<id>` on the `inventory_checks` version. Everything else (search, grouping by the latest count date, summary, capabilities, the Free caps of 40 products per submission and 150 overlay ids) is the list's.
The answer carries `task: { id, status, total }`. `branchId` is required and must be the task's own branch (`400 inventory_check_invalid_query`, `parameter: "branchId"`); `ids` beside `taskId` is refused (`parameter: "ids"`); an unknown task is `404 inventory_check_task_not_found`;
a viewer who may neither work nor issue tasks gets `403 inventory_check_tasks_required`. Counting, received dates and Submit work as on the normal list.

### 3.6 `POST /api/inventory-checks/submissions` with `taskId`

`taskId` (optional, text) is stored in the new closed session's scope and is part of the request's identity (the same request id with another or no task is `409 inventory_check_request_reused`). Approval, replacing older waiting lines and the approval panel are unchanged.
The same batch then runs the auto-close (section 1). The answer adds `task: { id, closed: boolean }`; `closed` is true only when this submission closed the task. A submission need not be the picker's, and its lines need not belong to the task.
| status | code | when |
|---|---|---|
| 403 | `inventory_check_tasks_required` | no `inventory_checks:tasks` |
| 400 | `inventory_check_invalid_request` | `taskId` is not text |
| 404 | `inventory_check_task_not_found` | not a task of this organization at this branch (nothing is recorded) |

A task that is already closed is accepted: the counts are real, and an admin closing a task while someone counts it must not lose them (`closed` is false).

## 4. Closing by hand: `PATCH /api/inventory-checks/sessions/:id` `{ expectedRevision, requestId, action: "close" }`

On a task the existing close needs `inventory_check_issue` (whoever made it; `403 inventory_check_owner_required` otherwise) and also closes the task's open pickup in the same batch, each with its own close event.
`resume` of a task or a pickup is `409 inventory_check_session_final`. Observing an item of a task or a pickup (`PATCH /sessions/:id/items/:productId`) is `409 inventory_check_task_not_countable`. A pickup is closed by its picker (or an issuer) with the same close; `/release` does exactly that.

## 5. `GET /api/inventory-checks/sessions`

Task rows are left out (and out of `total`). A pickup row carries `task: { id, title, status, total, done }` (read from the cached board of its branch, so the list adds no read of its own when the board is warm; absent when the task is no longer on the board).
The Mine filter, the status filter and the date filter apply to pickups as to any session.

## 6. Refusal codes added

`inventory_check_issue_required`, `inventory_check_tasks_required`, `inventory_check_task_not_found`, `inventory_check_task_closed`, `inventory_check_task_picked_up`, `inventory_check_task_not_picked_up`, `inventory_check_task_too_many`,
`inventory_check_task_not_countable`, `inventory_check_release_forbidden` (and the existing `inventory_check_session_final`). Each has a sentence in both packs under `inventory_check_error_<suffix>`.

## 7. Cache keys

| Key (before the shared deployment / organization / epoch parts) | Holds | Moved by |
|---|---|---|
| `ict:<inventory_checks version>` + `ic-tasks?branchId=` | the branch's task rows with done counts and pickups | the `inventory_checks` version |
| `ict:<inventory_checks version>` + `ic-task?id=` | one task's branch, status, issue time and product ids | the `inventory_checks` version |
| the list's own key + `ic_set=task:<id>` and the version in its `setVersion` | a task's restricted page | the `inventory_checks` version and the products version, as every restricted list |

## 8. Reads, writes and calls on the Free plan

MEASURED on a 300-product world by `cloudflare/scripts/measure-inventory-check-tasks.cjs` (the real routes and migrations over an in-memory database; a **call** is one round trip to D1: a prepared statement run on its own, or one batch however many statements it holds;
**rows written** are the table rows changed, index entries not counted). The ceilings are pinned by the scenario `budget` of `scripts/test-inventory-check-tasks-native.cjs`. Free allows 50 calls per request: none of these is near it.
**Rows read are not measured** (that engine does not report them); what bounds them is stated per route, and the plans are pinned in `test-migration-0318-inventory-check-task-index-pure.cjs` and, on the local D1 engine, `test-d1-task-index-plan-native.cjs`.

| Route | D1 calls cold | warm | Rows written | What it reads |
|---|---|---|---|---|
| `GET /tasks` | **1** | **0** (cached on the `inventory_checks` version) | 0 | the branch's task sessions once (index 0318) for the sort; for each shown task its item count (primary-key prefix), one seek of the 0285 index per product for the done count, one pickup seek |
| `POST /tasks` (300 ids) | 9 | n/a | 302 (session + 300 items + create event) | the actor, the receipt, the products' rows with their visibility (about 2 reads per product: the eligibility read and the in-batch guard), no stock snapshot |
| `POST /tasks` (a filter resolved to 300) | 31 | n/a | 302 | as above, plus the list's own reader once per page of 100 (3 pages, about 7 calls each cold) |
| `GET /list?taskId=` | 15 (the plain list: 14) | 8 (the plain list: 8) | 0 | +1 call cold for the task's ids (one statement, cached on the version); nothing warm |
| `POST /tasks/:id/pickup` | 6 | n/a | 2 (session + create event) | the actor, the receipt, the task with its pickup (one statement, index 0318), then the one batch and the projection |
| `POST /tasks/:id/release` | 9 | n/a | 2 (session update + close event) | the existing close writer |
| `POST /submissions` naming a task, not completing it | 9 (the same without a task) | n/a | the same as without a task | nothing more: its guard and auto-close statements ride the submission's batch; the auto-close stops at the first product that is not done |
| `POST /submissions` that completes the task | 9 (the same) | n/a | **+4**: the task and its pickup closed, each with a close event | at worst one 0285 seek per product of the task (300 at the cap) inside the batch |
| close by hand (`PATCH /sessions/:id`, a task with a pickup) | 6 | n/a | 4 | the existing close writer |
| `GET /sessions` with a pickup on the page | 5 | n/a | 0 | the list's own reads plus the cached board (0 more reads when the board is warm) |

Opening Tasks when nothing changed makes **0** D1 calls. What the addition to the hot submission batch costs: three guard/update statements and one more event insert that match nothing unless the task completes, no extra D1 call, no extra row until a task closes.


Every cap is read through the plan tier: `getInventoryCheckTaskLimits(env)` (`lib/inventoryCheckTaskLimits.ts`): `maxProducts` (300), `tasksShown` (30), `tasksClosedShown` (5), the same on both tiers; the existing Free caps from `getPlanLimits(env)` (40 products per submission, 150 overlay ids) still apply to counting a task.
They are not in `planTier.ts` because that file is inside the sales-daily kernel fingerprint, which refuses any change to it without a kernel version bump (which re-computes every stored day); they move into `PlanLimits` the next time that version is bumped, and only the import of the callers changes.

## 9. Language keys

Renamed in place (old history text stays as written; new Worker history says "difference"): `inventory_check_issue` (Differs), `inventory_check_edit_issue`, `inventory_check_report_issue`, `inventory_check_save_issue`, `inventory_check_reason_required`, `inventory_check_error_count_requires_issue`.
New: `inventory_check_status_differs`, `inventory_check_tasks`, `inventory_check_tasks_empty`, `inventory_check_task_issue`, `inventory_check_task_pickup`, `inventory_check_task_release`, `inventory_check_task_progress` (`{done}`, `{total}`), `inventory_check_task_picked_up_by` (`{name}`),
`inventory_check_task_all_counted`, `inventory_check_task_close`, `inventory_check_draft_saved`, the permission labels (`perm_inventory_check_issue`, `perm_short_issue_count_tasks`, `perm_hint_issue_count_tasks`, `perm_act_inventory_checks_tasks`, `perm_short_tasks`) and a sentence for each code in section 6.
`inventory_check_issues_empty` stays until the page stops using it (T2 removes the use and then the key). The shared `issues` key stays: Products uses it.
