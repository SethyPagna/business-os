# Inventory Check marks (read switch `ic_marks`, default OFF)

Spec: `Records/Design/2026-11-20/SPEC-ic-as-products-view.md` section 1 and slice S0a. Code: `cloudflare/src/lib/inventoryCheckMarks.ts`, `cloudflare/src/routes/inventoryChecks.ts`.

A **mark** is the latest count of a product at a branch: `[productId, t, s]`, `t` = the count's `updated_at` in epoch milliseconds, `s` = 1 OK, 2 Differs. The latest count is the one rule of the overlay's `COUNT_ENTRIES_SQL`: newest `updated_at`, then `session_id`, inside the viewer's organisation, with the item's branch equal to its session's. No quantity, stock, cost, price or person is in a mark. An event's **tag** is `fnv1a32` of `id|actor_id|request_id|created_at` (8 hex).

With `ic_marks` OFF the three routes answer 404 `not_found` and `capabilities.marks` is absent from `/list` and `/overlay`. All routes need `canView` (else 403 `inventory_check_view_required`), a positive `branchId` (else 400 `inventory_check_invalid_query`), and single-valued parameters.

| Route | Answer |
|---|---|
| `GET /marks?branchId&page[&have]` | `{format, page, buckets, cursor, tag, top, hash, rows: [[id,t,s]]}`; with `have` equal to `hash`: the same without `rows` plus `unchanged: true`. Every product id of the page range is seeked, active or not. The cursor and the rows are read in one `db.batch`. Cached (Cache API, key has org, branch, page, format, epoch) for `inventoryMarksSnapshotCacheSeconds`; every request validates the cached page with one call and serves it only while `cursor <= top`, its cursor event still has its tag, and `top - cursor <= inventoryMarksCatchUpMaxEvents / 2`. |
| `GET /marks/changes?branchId&since&tag` | `{rebuild: true, top}` when `since > top` or the event at `since` has another tag; else `{cursor, tag, top, more, marks: [[id,t,s]] (s = 0: no count, remove), pending?: [[id, 0\|1]]}`. At most `inventoryMarksChangesPageEvents` events and `inventoryMarksTouchedMax` products; `cursor` is the last event walked. A NULL-product event of a session that holds an approval touches every product of the session. `pending` only for a viewer with the stock field and Fix stock. |
| `GET /marks/pending?branchId[&afterAt&afterId]` | `{cursor, tag, ids, next: {afterAt, afterId} \| null}`: the waiting lines of the next `inventoryMarksPendingPageApprovals` approvals, newest first. 403 `inventory_check_fix_stock_required` for any other viewer. Never cached. |

Every non-GET Inventory Check answer below 400 (or 500+) also broadcasts channel `inventory_checks` with `{branchId}` (best effort, whatever the switch says; a broadcast is not a read).

Limits (`getPlanLimits`): `inventoryMarksPageIds`, `inventoryMarksSnapshotCacheSeconds`, `inventoryMarksChangesPageEvents`, `inventoryMarksTouchedMax`, `inventoryMarksCatchUpMaxEvents`, `inventoryMarksPendingPageApprovals`, `inventoryMarksPollSeconds`.
