# Inventory count tasks: Worker contract

Slice T1 of the 18 Nov 2026 owner request ("issue" means issuing count tasks, not problems). The Worker, the permissions and both language packs are built against this file; the frontend lane (T2) builds from it.
Everything here is enforced by the Worker, so a screen rule is only a convenience. It sits on top of `docs/contracts/inventory-check-requests-20261117.md` (sessions, submissions, approval), which is unchanged.

Migration `0318_inventory_check_task_index.sql` adds one expression index on `inventory_check_sessions` (organization, `scope_json` kind, `scope_json` task). Migration `0319_inventory_check_open_task_index.sql` adds two PARTIAL indexes: `inventory_check_sessions_open_task` on the open sessions only (organization, kind, branch; `WHERE status = 'open'`), which the auto-close, the cap guard and the board's open list read, so none of them reads a closed task or an old session; and `inventory_check_sessions_task_board` on the tasks only (organization, branch, status, closed_at, id; `WHERE` the kind is `task`), which the board's closed list reads, so it never reads the tasks closed before. All three indexes must be applied before the Worker that reads them is deployed
(migrations, then the Worker): the Worker names them in `INDEXED BY`, so without them those statements fail with "no such index" (they do not fall back to a scan). Append-only: `0319` is a new file, not yet applied to any database; `0318` is untouched.

**Deploy note: blast radius of a Worker that runs before its migrations** (`run_migrations=false`, or a migrations step that did not finish). The migrations step runs before the publish step in `deploy.yml`, and a failed apply stops the job before the Worker is published, so a normal deploy has no such window. With `run_migrations=false` the release logs "NOT applying" and publishes anyway. Until the migrations are applied:
* **Clean refusal `503 inventory_check_schema_unavailable`** (the count-check schema probe, `schemaReady`, names all three indexes beside the tables and triggers, in the same one scan of `sqlite_master`). Every route that calls it: `GET` and `POST /sessions`, `GET /sessions/:id`, `GET /sessions/:id/history`, `PATCH /sessions/:id`, `PATCH /sessions/:id/items/:productId` (the observation), `POST /sessions/:id/approval` and `/approval/lines` (the decisions), `POST /submissions` (both writers), `POST /tasks`, `POST /tasks/:id/pickup`, `POST /tasks/:id/release`, and in `routes/inventoryCheckProducts.ts` `GET /products?sessionId=` and the simple list's session view. Nothing is written by a refused request.
* **Still fail raw (an unmapped D1 error, "no such index")**, because these two never call the probe: `GET /tasks` (the board reads the task indexes by name), and every lot Set while `ic_lot_counts` is on (`routes/inventory.ts`, `routes/batches.ts`: the Set's batch carries the auto-close), which answers a misleading `409` "Stock changed while saving" and writes nothing.
The previous Worker never names the indexes, so rolling the Worker back is safe at any time.

## 1. What a task is (no new table, no new column)

| Object | Is | scope_json | Items |
|---|---|---|---|
| Task | an OPEN count session made by an admin | `{ "membership": "task", "products": N, "selection": { "kind": "ids" } \| { "kind": "filters", "filters": { ... } } }` | one per product: state `unstarted`, no baseline, baseline `{}` |
| Pickup | the picker's own OPEN session | `{ "membership": "pickup", "task": "<task id>" }` | none |
| Count for a task | an ordinary submission, closed | `{ "membership": "submission", "task": "<task id>" }` | as any submission |

* A task is never a count: its items are `unstarted` with no `updated_at`. The ic_wired list, its overlay and its summary read only `done` and `issue` items, and the older (`ic_simple`) list reads the open sessions' `unstarted` items with task rows left out, so issuing a task changes none of their rows, chips, dates or Not checked figures (a test snapshots both lists before and after).
* **The done rule.** A product of a task is DONE once any FINAL count of it at the task's branch (state `done` or `issue`, i.e. matches or differs) exists whose time is at or after the moment the task was issued (`started_at` of the task), wherever it was made:
  in a submission that names the task, in any other submission, in a count session that has been closed, or by a Set that closed a difference. A count made before the issue, or at another branch or organization, never ticks it.
  **FINAL** (owner, 19 Nov: counts reach the server on Submit): the counting session is closed. A count in an OPEN session can still be set back to `unstarted`, so it ticks nothing until that session closes; a submission and a Set are born closed.
  Only products that can still be counted take part: one deactivated, merged away or turned into a family header leaves `total` and `done` (the board's `removed` counts them) and no longer blocks the close.
  ONE countable rule for a task (`TASK_COUNTABLE_SQL`, lead ruling 19 Nov: exactly what the wired list shows, that is `catalogProductSql` from `lib/productStockGuard.ts` (an ACTIVE product, imported and not copied) and never a family header, with or without children). It is used by the issue by ids, the issue by filter and every read of `total`, `done` and `removed`, including the `total` of `/list?taskId=`, so the board and the task list always agree. The wired list reads active products only, so an inactive product is never countable, whatever stock it holds: the owner's rule is that no stock sits on an inactive product, and migration 0242's triggers refuse it (no row can predate them: 0242's own check forbids one). So an inactive product named by ids is refused `400 inventory_check_product_not_eligible`, one a filter resolves to is left out, and one deactivated after the issue leaves the total (`removed`) and no longer blocks the close. A childless header given by ids is refused `400 inventory_check_product_not_eligible`; by filter it is left out; a product that becomes a header later leaves the total (`removed`) and no longer blocks the close. The older list (`/api/inventory-checks/products`) still shows a childless header as a countable row: it is left as it is, and a task never reads it.
  An Undo of a Set TAKES BACK the Set's own count: the one item of its `stock_set` session turns `unstarted` (its figure stays in `baseline_quantity`, its time in `updated_at`), so the done rule no longer sees it. A Redo turns it back into the Done count it was, at its ORIGINAL time, and runs the auto-close. The sessions an Undo or a Redo writes (kind `stock_set_undo`, and scope `restore: 1`) are still never counts.
* **Closing.** The task closes itself when its last product is counted by a FINAL count (owner: "any count of a task's product at the branch after the task was issued ticks it, including someone's own count; the task closes itself when its last product is counted").
  Every write that makes counts final closes, in its own batch, every open task of the organization at that branch that holds a product the write made final and whose countable products are now all done (section 3.7); its pickup closes with it and each closed row gets a close event.
  **Reopening** (owner, 19 Nov: a task's state always follows the counts in effect). When a write takes back a count (a closed count session is resumed, or a Set is undone), every task of the organization at that branch that the auto-close closed and that is no longer all done reopens in that write's own batch, with a `resume` event (`after.reopened = 1`, `after.cause`, `after.by` = the session whose count was taken back). A task closed by hand never reopens. A reopen is never refused, not even over `maxOpenTasks`; the task's pickup stays closed (anyone may pick it up again). A Redo, or closing the session again, closes it again through the normal auto-close.
  A task shows `done = total` ("All counted") only for the instant between the last final count and the close. An admin closes a task by hand with the existing close (section 4). Undo of an issue is that close record: a compensating event, never a delete.
* The task's own session row is never shown under Count sessions. A pickup is: it is the picker's session (Mine), with the title of its task and the task's progress (section 5).
* A product may be in several tasks; one count ticks every open task that holds it.

## 2. Permissions

| Key | Kind | Default | Needed for |
|---|---|---|---|
| `inventory_check_issue` | an extra of `inventory_checks` (editor: "Issue count tasks") | off; administrators always pass; never implied by counting or Inventory Full | `POST /tasks`; closing any task; handing back any pickup |
| `inventory_checks:tasks` | an action of `inventory_checks` (editor: "Pick up and count tasks") | on for everyone who can count; an explicit `false` switches it off | `GET /tasks`, `GET /list?taskId=`, `POST /tasks/:id/pickup`, `taskId` on `POST /submissions` |

Both also need what every Inventory Check request needs (`inventory_checks` view; counting for every write). **Issuing, closing a task and handing back someone else's pickup need the extra AND the count grant** (`canIssueInventoryCountTasks` includes it; the board's `capabilities.issue`, `can_close` and `can_release` are true exactly when the Worker would accept).
A picker hands back their own pickup with what a pickup needed: the view and being the picker. A role with the view and the extra but no count grant is offered no board (`403 inventory_check_tasks_required`) and every write answers 403.
Working a task needs the count grant (`inventory_checks:check`) and the action. A viewer who may do neither gets `403 inventory_check_tasks_required` on the reads.

## 3. Routes

The routes under `/tasks` and `GET /list?taskId=` answer `404 not_found` while the read switch `ic_wired` is OFF (the page then shows no Tasks). `taskId` on `POST /submissions` and the close of a task (`PATCH /sessions/:id`) do not depend on that switch. Every writer moves the `inventory_checks` cache version before it answers (awaited), as the other Inventory Check writers do.

### 3.1 `GET /api/inventory-checks/tasks?branchId=1`

The tasks of one branch: EVERY open task (newest issued first; an issue is refused while the branch has `maxOpenTasks`, 30, or more open, see 3.2, but a reopen can take it over, so the list shows them all) and then the most recently CLOSED ones (at most `tasksClosedShown`, 5).

```
{ "branchId": 1, "version": "k2:12",
  "items": [{ "id": "<uuid>", "branch_id": 1, "title": "Shelf A", "status": "open" | "closed", "revision": 0, "issued_at": ISO, "issued_by"?: "username", "closed_at": ISO | null,
              "total": 150, "done": 34, "removed": 0, "selection": { "kind": "ids" } | { "kind": "filters", "filters": { "brand": "A" } } | null,
              "picked_up_by": "username" | null, "picked_up_at": ISO | null, "mine": false, "pickup_session_id"?: "<uuid>" (only when mine),
              "can_pickup": true, "can_release": false, "can_close": false }],
  "capabilities": { "issue": true, "work": true, "maxProducts": 300, "maxOpenTasks": 30 } }
```
* `total` and `done` follow the done rule over the products that can still be counted, live as of the versions; `removed` is how many of the task's products can no longer be counted (T2 shows it). "All counted" is `done >= total` on an open task. Names are usernames; no account id is sent. `issued_by` follows `canSeeStaffIdentity`, in the Count sessions list's form: the key is LEFT OUT unless the viewer is an administrator, holds `audit_log`, or is the issuer. `picked_up_by` (and the 409's `pickedUpBy`) is the one exception: it is shown to every board viewer, because the owner said "Others see 'Picked up by ...'". `selection.filters` carries only the filters the viewer may use (brand, category and stock follow the viewer's field grants, as in a session's detail).
* `revision` is the task session's own revision, the `expectedRevision` that `PATCH /sessions/:id` with `action: "close"` needs to close the task by hand (a stale value is refused `409 inventory_check_conflict`). It is read from the row the board already reads (no extra call or row) and is the same for every viewer.
* `can_pickup`: open, nobody has it, and the viewer may work tasks. `can_release`: open, someone has it, and the viewer is that person or may issue. `can_close`: open and the viewer may issue.
* `400 inventory_check_invalid_query` (`parameter: "branchId"`) without a branch; `403 inventory_check_tasks_required` for a viewer who may neither work nor issue tasks.
* **Cache.** One entry per organization and branch, keyed `ict:<inventory_checks version>:<products version>` (the entry's URL is `https://ic.invalid/__bos/ic-tasks?branchId=<n>&order=2`; the shared key builder adds the deployment, organization and data epoch), kept up to
  `productListCacheSeconds`. The version is moved by every writer that can change a task or a count (issue, pickup, release, close, every submission, every observation, the close of a count session, a Set that closes a difference, an Undo of one; the products version moves with a merge or a deactivation), so an unchanged open reads nothing and a changed one is fresh. The entry holds account ids; the answer never does.

### 3.2 `POST /api/inventory-checks/tasks` (issue)

```
{ "branchId": 1, "requestId": "<8-120 of A-Za-z0-9_->", "title"?: "text (<= 120)",
  "productIds": [100, 101] }                      // the ids the admin chose
  or "filters": { "query"?, "brand"?, "category"?, "stockState"?, "checkState"?, "checkedOn"? }   // the list's own filters, resolved by the Worker
```
Exactly one of `productIds` and `filters`. Filters are resolved with the list's own reader (`GET /list`, the same planner, grants, check-state restriction and cache; page after page of the list's size, `LIST_MAX_PAGE_SIZE` = 100 families, which is the products reader's own clamp, one exported constant `PRODUCT_LIST_MAX_PAGE_SIZE` in `lib/familyPagination.ts`), never a copy of its search. The read is leaf-only: the reader is given the check lists' own restriction with no ids (`excludeIdsJson: '[]'`) and its `leafOnly` option, and the cache entry is kept apart (`ic_set=leaf`). A family qualifies exactly as the plain list decides it, and under a typed search also through a family header that has an active child that is not a header (`HEADER_QUALIFIES_TERM` in `routes/products.ts`): the plain list shows that family, so a text filter that matches a header only (header "Summer set", children "Red top" and "Blue skirt", `query=summer`) issues the two children, and a mixed filter keeps every child. Only header rows are left out of the rows; a header with no active child qualifies nothing. A filter that also carries a check state or a day keeps that restriction as the list does (the header rule applies and a header never qualifies a family there, as in the list). A page therefore holds only families with a product in them, so the page bound counts products: a filter that matches 300 (`maxProducts`) or fewer countable products always issues, whatever childless headers it also matches, and one that matches more always answers `too_many`. The loop stops when the reader has no more pages or the products passed the cap, and keeps a last bound of `ceil(maxProducts / 100) + 1` pages (4 at 300 products) that a leaf-only read never reaches (a filter of 300 products or fewer ends within 3 pages); it only keeps a request under Free's 50 D1 calls (each page costs 7) if the reader ever returned pages with no products again. Measured by the native test (in-memory SQLite harness), scenario issueFilterBound, one cold request each: 5 products among 205, 605 or 1,005 headers 18 calls; 300 products among 101 headers (401 families) 32 calls and issues; 300 products among 99 headers that sort last 32 calls and issues; 301 products 32 calls and answers `too_many` with `total` 301. Before this change the 401-family world answered `too_many` with total 299, and 605 headers with 5 products answered `too_many` with total 0.
A product the list shows but a person cannot count (a family header) is dropped from a resolved list; an explicit list naming one is refused. The scope records what the admin chose (the ids as `{kind:'ids'}`, or the filters). Nothing about stock is read or written.
* 201 `{ item: <session>, receipt, created: true }`; a repeat of the same request answers 200 with `created: false`. `item.progress` is `{ total, unstarted: total, done: 0, issue: 0 }`, `item.scope` as in section 1, `item.can_edit` true.
* Cap: `getInventoryCheckTaskLimits(env).maxProducts` (`lib/inventoryCheckTaskLimits.ts`) = **300**, the same on Free and Paid (a task is a unit of work for a person, not a plan resource; it also sits under the 500 items a session detail can read). Over it:
  `400 inventory_check_task_too_many` with `{ total, limit }`: `total` is the number of COUNTABLE ROWS the filter or list holds (a family header is not one; the list pages by families, so its own total counts families and is never used), so the admin can narrow it. When the count stopped early over the cap, `total` is what was counted so far and `atLeast: true` is sent (the frontend refusal map does not read `atLeast` yet). The writer writes one session row, N item rows and one create event in ONE batch.

| status | code | when |
|---|---|---|
| 403 | `inventory_check_issue_required` | no `inventory_check_issue`, or no count grant (checked before anything is read, and again against the database) |
| 403 | `inventory_check_permission_required` | the writer's own check: no count grant (answered when the actor is re-read) |
| 400 | `inventory_check_invalid_request` | body not an object; both or neither of `productIds` and `filters`; a filter key that is not listed or not text |
| 400 | `inventory_check_invalid_query` / `inventory_check_field_hidden` | a filter the viewer may not use (as on `/list`) |
| 400 | `inventory_check_product_ids_required`, `inventory_check_invalid_id`, `inventory_check_invalid_title`, `inventory_check_request_id_required` | as for `POST /sessions` |
| 400 | `inventory_check_product_not_eligible` | a named product is not countable (missing, inactive, a family header with or without children), or a filter resolved to nothing (`resolveTaskFilters` throws it after its page loop when no product was found; the task screens show "the filter matched nothing" for it) |
| 400 | `inventory_check_task_too_many` | an explicit id list of more than 300 ids ASKED (it is capped on the ids asked, before eligibility is read, so 301 ids refuse even when some are not countable; `total` is the number of distinct ids), or a filter that holds more than 300 countable products, and only then (a filter of 300 or fewer always issues); carries `total`, `limit`, and `atLeast: true` when the count is a lower bound |
| 409 | `inventory_check_task_limit` | the branch already has `maxOpenTasks` (30) or more open tasks (`open` may exceed `limit` after reopens); carries `open` (the open count) and `limit`. The count is read inside the issuing batch, so two issues at once cannot both take the last place. A repeat of an issue that went through still answers 200 |
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

Hands the task back: closes its open pickup with the existing close writer (the task stays open and can be picked up again). By the picker, or by whoever has `inventory_check_issue` and the count grant.
200 `{ item: <the closed pickup session>, receipt, released: true }` (a repeat of the same request answers the same with `receipt.replayed`).

| status | code | when |
|---|---|---|
| 403 | `inventory_check_release_forbidden` | neither the picker nor an issuer with the count grant |
| 403 | `inventory_check_permission_required` | the existing write refusal |
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
The same batch then runs the auto-close (section 1 and 3.7), which closes the named task too when this submission completes it. The answer adds `task: { id, closed: boolean }`; `closed` is true only when this submission closed the named task. A submission need not be the picker's, and its lines need not belong to the task.
| status | code | when |
|---|---|---|
| 403 | `inventory_check_tasks_required` | no `inventory_checks:tasks` |
| 400 | `inventory_check_invalid_request` | `taskId` is not text |
| 404 | `inventory_check_task_not_found` | not a task of this organization at this branch (nothing is recorded) |

A task that is already closed is accepted: the counts are real, and an admin closing a task while someone counts it must not lose them (`closed` is false).

### 3.7 Every count writer closes the tasks it completes

A write that creates a count (a Done or Differs item with the time of the count) appends the auto-close to its own batch: no D1 call of its own. It closes every OPEN task of the organization at the write's branch that holds at least one product the write counted and whose products are ALL done under the done rule,
with the close event of the task (`after.auto = 1`) and, for each, the close event and close of its open pickup. The answer of each writer names the ids it closed, so the page can refresh the Tasks board:

| Writer | Creates a count when | Answer field |
|---|---|---|
| `POST /submissions` (the wired, per-received-date writer) | always | `closedTasks: [id, ...]`, present only when it closed any |
| `POST /submissions` (the older writer, `ic_wired` off) | always | `closedTasks` |
| `PATCH /sessions/:id` `{ action: "close" }` of an ordinary count session | always: closing makes its counts final (an observation itself is NOT a final count and closes no task) | `closedTasks` beside `item`, `receipt` |
| `POST /inventory/adjust` and `PATCH /batches/:id/branches/:branchId` (a Set that closes a difference) | the Set closed a difference (`issue_closed: true`): it records a Done count of the product. An Undo takes the Set's count back (it may reopen tasks); a Redo restores it at its original time and closes the tasks it completes (it names no `closed_tasks`: the stored answer of the Set is not changed) | `closed_tasks: [id, ...]` (present only when it closed any; it is in the stored answer, so a replay answers the same). A Set that moves nothing stores no operation, so a retry of it answers `issue_closed: false` and no `closed_tasks` |

A replay of a submission or a close of a count session closes nothing and names nothing (a replay of a Set answers from its stored answer, with the exception above). The close event of a task records which session closed it (`after.closedBy` = the session whose counts closed it), so a later ruling on a count that is taken back can find the tasks that rested on it. The events the auto-close reads back are selected by actor, this request's key range, the request hash and the time, so another request's event is never read. An observation (`PATCH /sessions/:id/items/:productId`) closes no task and its count ticks none until its session closes. Every writer that takes a count back reopens the tasks it un-completes (section 1, Reopening): the table below. The approval of a count (`inventoryCheckApprovals.ts`) flips an item from `issue` to `done` and does NOT touch its time, so it can never complete a task (the item was already a count at that time). Writers that never create a count: issue, pickup, release, close of a task, the approval decisions.

**Every writer that takes a count back reopens the tasks it un-completes**

| Writer | Takes back | Answer field |
|---|---|---|
| `PATCH /sessions/:id` `{ action: "resume" }` of a count session | its Done and Differs items | `reopenedTasks: [id, ...]` beside `item`, `receipt` (only when any; a replay names none) |
| Undo of a Set that closed a difference (`/api/action-history`, applier `stock.quantity_set`) | the Set's own count | none (the board refreshes on the `inventory_checks` version the Undo moves) |

The board adds `reopened: { at, reason: "count_reopened" \| "set_undone", by? }` to an OPEN task whose newest event is its reopen (`by` is the account that took the count back, only for a viewer who may see staff identity, as `issued_by`). The reopen statements are found from the PRODUCTS whose count was taken back (the never-counted task items of each such product at the branch), so their cost depends on the history of those products only, with no migration and no D1 call of their own.
The task writers are the only writers of a task's own rows: every other writer aimed at a task or a pickup id is refused (observe `409 inventory_check_task_not_countable`, close without the extra `403 inventory_check_owner_required`, resume `409 inventory_check_session_final`, approvals `404 inventory_check_approval_not_found`, a submission naming one `404 inventory_check_task_not_found`, creating a session that claims the kind `400 inventory_check_invalid_scope`).

## 4. Closing by hand: `PATCH /api/inventory-checks/sessions/:id` `{ expectedRevision, requestId, action: "close" }`

On a task the existing close needs `inventory_check_issue` and the count grant (whoever made it; `403 inventory_check_owner_required` otherwise) and also closes the task's open pickup in the same batch, each with its own close event. Closing an ordinary count session is a count writer (section 3.7).
`resume` of a task or a pickup is `409 inventory_check_session_final`; `resume` of a count session takes its counts back (section 3.7). Observing an item of a task or a pickup (`PATCH /sessions/:id/items/:productId`) is `409 inventory_check_task_not_countable`. A pickup is closed by its picker (or an issuer) with the same close; `/release` does exactly that.

## 5. `GET /api/inventory-checks/sessions`

Task rows are left out (and out of `total`). A pickup row carries `task: { id, title, status, total, done }` (read from the cached board of its branch, so the list adds no read of its own when the board is warm; absent when the task is no longer on the board).
The Mine filter, the status filter and the date filter apply to pickups as to any session.

## 6. Refusal codes added

`inventory_check_issue_required`, `inventory_check_tasks_required`, `inventory_check_task_not_found`, `inventory_check_task_closed`, `inventory_check_task_picked_up`, `inventory_check_task_not_picked_up`, `inventory_check_task_too_many`,
`inventory_check_task_not_countable`, `inventory_check_release_forbidden`, `inventory_check_task_limit` (and the existing `inventory_check_session_final`). Each has a sentence in both packs under `inventory_check_error_<suffix>`.

## 7. Cache keys

| Key (before the shared deployment / organization / epoch parts) | Holds | Moved by |
|---|---|---|
| `ict:<inventory_checks version>:<products version>` + `ic-tasks?branchId=<n>&order=2` | the branch's task rows with done counts and pickups | the `inventory_checks` version and the products version (a merge or a deactivation moves the countable set) |
| `ict:<inventory_checks version>:<products version>` + `ic-task?id=` | one task's branch, status, issue time and the ids of its countable products | the `inventory_checks` version and the products version (a merge, a deactivation or a header moves the countable set) |
| the list's own key + `ic_set=task:<id>` and the version in its `setVersion` | a task's restricted page | the `inventory_checks` version and the products version, as every restricted list |

## 8. Reads, writes and calls on the Free plan

MEASURED on a 300-product world by `cloudflare/scripts/measure-inventory-check-tasks.cjs` (the real routes and migrations over an in-memory database; a **call** is one round trip to D1: a prepared statement run on its own, or one batch however many statements it holds;
**rows written** are the table rows changed, index entries not counted). The ceilings are pinned by the scenario `budget` of `scripts/test-inventory-check-tasks-native.cjs`. Free allows 50 calls per request: none of these is near it.
**Rows read** are measured with `meta.rows_read` on the local D1 engine by `test-d1-task-index-plan-native.cjs`, and stated per route below; the plans are pinned in `test-migration-0318-inventory-check-task-index-pure.cjs`, `test-migration-0319-inventory-check-open-task-index-pure.cjs` and, on the local D1 engine, `test-d1-task-index-plan-native.cjs`.

| Route | D1 calls cold | warm | Rows written | What it reads |
|---|---|---|---|---|
| `GET /tasks` | **1** | **0** (cached on the `inventory_checks` and products versions) | 0 | the branch's OPEN tasks through the open index (0319: no closed task is read to list them) and the last 5 closed ones through the task index (0319: a short walk in closed_at order, so the rows read do not grow with the closed tasks of the branch or of any other: measured cold at 10, 100 and 1,000 closed tasks at the branch: the closed list reads 5 rows at each, the whole board 99 at each with one item per shown task; the old read of the closed list through the 0318 index read 224, 404 and 2,204, the whole board 318, 498 and 2,298); for each shown task its item count (primary-key prefix), one seek of the 0285 index per product for the done count, one pickup seek |
| `POST /tasks` (300 ids) | 9 | n/a | 302 (session + 300 items + create event) | the actor, the receipt, the products' rows with their visibility (about 2 reads per product: the eligibility read and the in-batch guard), no stock snapshot |
| `POST /tasks` (a filter resolved to 300) | **31** by `measure-inventory-check-tasks.cjs` (brand filter on its 300-product world); **32** by the native test `issueFilterBound` (300 products among 101 childless headers, 401 families); 18 for a filter of 5 products over 205, 605 or 1,005 headers (one page) | n/a | 302 | as above, plus the list's own reader once per page of 100 families, read leaf-only (3 pages for 300 products, about 7 calls each cold). The first figure is the measure script's, the others the native test's: both run on the in-memory SQLite harness, and calls include middleware |
| `GET /list?taskId=` | 15 (the plain list: 14) | 8 (the plain list: 8) | 0 | +1 call cold for the task's countable ids (one statement, cached on the `inventory_checks` and products versions); nothing warm |
| `POST /tasks/:id/pickup` | 6 | n/a | 2 (session + create event) | the actor, the receipt, the task with its pickup (one statement, index 0318), then the one batch and the projection |
| `POST /tasks/:id/release` | 9 | n/a | 2 (session update + close event) | the existing close writer |
| `POST /submissions` naming a task, not completing it | 9 (the same without a task) | n/a | the same as without a task | nothing more: its guard and auto-close statements ride the submission's batch; the auto-close stops at the first product that is not done |
| `POST /submissions` that completes the task | 9 (the same) | n/a | **+4**: the task and its pickup closed, each with a close event | at worst one 0285 seek per product of the task (300 at the cap) inside the batch |
| `POST /submissions`, wired writer, no task open / completing a task | 9 / 9 | n/a | 4 / 8 | measured by the scenario `budget` (the writer's own request): the auto-close adds no call and, until a task closes, no row |
| `POST /submissions`, older writer (`ic_wired` off), no task / completing a task | 12 / 12 | n/a | 6 / 10 | as above |
| `PATCH /sessions/:id` close of a count session, no task / completing a task | 6 / 6 | n/a | 2 / 6 | the close makes the counts final: the same four statements |
| `POST /inventory/adjust` (a Set that closes a difference) | unchanged | n/a | +4 only when a task closes | the four statements ride the Set's own transaction; with no difference closed they find no task and write nothing, at a fixed cost on this engine (the AUTOINCREMENT step of their INSERTs, below); an Undo or a Redo adds nothing |
| close by hand (`PATCH /sessions/:id`, a task with a pickup) | 6 | n/a | 4 | the existing close writer |
| `GET /sessions` with a pickup on the page | 5 | n/a | 0 | the list's own reads plus the cached board (0 more reads when the board is warm) |

Opening Tasks when nothing changed makes **0** D1 calls (the key holds the `inventory_checks` and products versions, both in KV). **What the auto-close reads** (measured with `meta.rows_read` on the local D1 engine, `test-d1-task-index-plan-native.cjs`): the candidates are the OPEN tasks of the organization at the branch (partial index 0319), each tested by one primary-key seek of its item per product the write made final; a candidate then reads one seek of the 0285 index per product until the first product that is not done. Nothing reads a closed task, an old count session or a never-counted item, so **the rows read do not grow with history**: with no open task a write reads a fixed 43 rows at 0, 10 and 100 old sessions and with 100 closed tasks added (before this index: 85, 544, 4,324). The fixed rows are not history and not open tasks: they are the AUTOINCREMENT step of each INSERT into `inventory_check_events`, which reads `sqlite_sequence` from the top until it reaches the events row (an INSERT into that table that inserts nothing reads 16 rows on this engine, one into `inventory_check_items` none), and are paid by every write that carries the four statements; with one open task of 41 products 170 rows at every history size. Worst case, the cap (30) of open tasks of 300 products each, a write of 40 products and every task complete but its last product: **27,138 rows read** (cap x products x about 3, plus one item seek per written product per task; the early stop ends a task at its first product that is not done, 228 rows when it is the first). A write that holds none of the tasks' products reads 78 rows (2 per open task and the fixed overhead). The cap guard and the refusal's count read the open index (31 rows at the cap of 30 open tasks with 400 closed ones, the same as through the task index, so they stay on the open index; no closed task is read to count the open ones). The follow-up statements find their rows by this request's key range in the events (a few rows).


Every cap is read through the plan tier: `getInventoryCheckTaskLimits(env)` (`lib/inventoryCheckTaskLimits.ts`): `maxProducts` (300), `maxOpenTasks` (30: the cap on open tasks per branch AND the number the board shows), `tasksClosedShown` (5), the same on both tiers; the existing Free caps from `getPlanLimits(env)` (40 products per submission, 150 overlay ids) still apply to counting a task.
They are not in `planTier.ts` because that file is inside the sales-daily kernel fingerprint, which refuses any change to it without a kernel version bump (which re-computes every stored day); they move into `PlanLimits` the next time that version is bumped, and only the import of the callers changes.

## 9. Language keys

Renamed in place (old history text stays as written; new Worker history says "difference"): `inventory_check_issue` (Differs), `inventory_check_edit_issue`, `inventory_check_report_issue`, `inventory_check_save_issue`, `inventory_check_reason_required`, `inventory_check_error_count_requires_issue`.
New: `inventory_check_status_differs`, `inventory_check_tasks`, `inventory_check_tasks_empty`, `inventory_check_task_issue`, `inventory_check_task_pickup`, `inventory_check_task_release`, `inventory_check_task_progress` (`{done}`, `{total}`), `inventory_check_task_picked_up_by` (`{name}`),
`inventory_check_task_all_counted`, `inventory_check_task_close`, `inventory_check_draft_saved`, the permission labels (`perm_inventory_check_issue`, `perm_short_issue_count_tasks`, `perm_hint_issue_count_tasks`, `perm_act_inventory_checks_tasks`, `perm_short_tasks`) and a sentence for each code in section 6.
`inventory_check_issues_empty` stays until the page stops using it (T2 removes the use and then the key). The shared `issues` key stays: Products uses it.
