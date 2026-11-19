import type { D1Compat } from './db'
import { catalogProductSql, stockVisibleProductSql } from './productStockGuard'

// Count tasks (owner, 18 Nov 2026): an admin issues products to count, an employee picks the task up, and the counts they submit tick the products off.
// Nothing here is a new table: a task is an open row of inventory_check_sessions whose scope_json says {"membership":"task"}, a pickup is the picker's own open session
// {"membership":"pickup","task":"<task id>"} with no items, and a count made for a task is an ordinary submission whose scope also names the task. This module holds the SQL
// text and the reads; the writers (issue, pickup, release, close, the auto-close inside a count writer) are in lib/inventoryCheckSessions.ts, which owns the session rows.
// It imports nothing from that file, so the two can reference each other's text without a cycle.
//
// THE DONE RULE (owner, 18 Nov): a product of a task is done once any count of it at the task's branch (Done or Differs) exists at or after the moment the task was issued, wherever it was made.
// The count is an item with state done|issue and an updated_at (the time of the count) at or after the task's started_at. A task's own items are `unstarted` with no updated_at, so a task is never a count itself.
// A count ticks a task only when it is FINAL (owner, 19 Nov: counts reach the server on Submit): its session is closed. A count in an open session can still be set back, so it ticks nothing until that session closes.
// An Undo or a Redo of a Set is NOT a count (owner ruling, 19 Nov): it restores a record made earlier, so its session (kind stock_set_undo, or scope restore) never ticks or closes a task.
// Only products that can still be counted take part (taskItemCountableSql): one deactivated, merged away or made a header leaves the task's total and no longer blocks its close.

export const TASK_MEMBERSHIP = 'task'
export const PICKUP_MEMBERSHIP = 'pickup'
const S = 'inventory_check_sessions'
const I = 'inventory_check_items'

/** The kind of a session row, as the expression the index of migration 0318 holds. */
export const kindOf = (alias: string): string => `json_extract(${alias}.scope_json, '$.membership')`
/** The task a session names (a pickup, or a submission that counted a task), as the index holds it. */
export const taskOf = (alias: string): string => `json_extract(${alias}.scope_json, '$.task')`

/** A product row (alias p) a person may count: not a family header that still has children. The one text every count writer and the task reads use. */
export const CHECKABLE_SQL = `(NOT(COALESCE(p.is_group,0)=1 AND EXISTS(SELECT 1 FROM products child WHERE child.id<>p.id
  AND (child.parent_id=p.id OR child.name_key=p.name_key) AND ${stockVisibleProductSql('child')})))`
/**
 * THE rule of what a task may hold and count (alias p): exactly what the wired list shows (lead ruling, 19 Nov). That list reads active products only (catalogOnly in routes/products.ts, which uses catalogProductSql),
 * and never shows a family header, with or without children, so the rule is that function's own text plus the header rule. A product with stock but not active is not counted: the owner's rule is that no stock sits on an
 * inactive product, and migration 0242's triggers refuse it. The products are read by primary key, so `+p.is_active` (not indexed) keeps the planner from choosing another index.
 * The older list (inventoryCheckProducts.ts) still shows a childless header as countable: it is left as it is.
 * ONE text for the issue by ids, the issue by filter (which follows the list) and every read of the task's total, done and removed.
 */
export const TASK_COUNTABLE_SQL = `(${catalogProductSql('p', false)} AND ${CHECKABLE_SQL} AND COALESCE(p.is_group,0)=0)`
/** Can the product of this task item still be counted? */
export const taskItemCountableSql = (item: string): string => `EXISTS(SELECT 1 FROM products p WHERE p.id=${item}.product_id AND ${TASK_COUNTABLE_SQL})`

/**
 * Is this product of the task counted? `item` is the task's item row alias; `branch`, `since` and `org` are SQL expressions or parameters. One seek of the 0285 index per product:
 * the counts of the product at the branch from `since` on, of which any one that is Done or Differs and FINAL (its session is closed) makes the product done. Items of other organizations are never read.
 */
export const taskItemDoneSql = (item: string, branch: string, since: string, org: string): string => `EXISTS(SELECT 1 FROM ${I} x INDEXED BY inventory_check_items_product_latest
    CROSS JOIN ${S} xs ON xs.id=x.session_id
    WHERE x.product_id=${item}.product_id AND x.branch_id=${branch} AND x.updated_at>=${since} AND x.state IN ('done','issue') AND xs.status='closed' AND xs.organization_id IS ${org} AND xs.branch_id=x.branch_id
      AND ${kindOf('xs')} IS NOT 'stock_set_undo' AND json_extract(xs.scope_json,'$.restore') IS NOT 1)`

/** How many tasks are open at one branch of an organization (the cap guard of the issue and its refusal's count): the partial index of migration 0319 holds only open sessions, so no closed task is read. Parameters: @organization @branchId. */
export const OPEN_TASK_COUNT_SQL = `SELECT COUNT(*) FROM ${S} s INDEXED BY inventory_check_sessions_open_task WHERE s.organization_id IS @organization AND ${kindOf('s')}='${TASK_MEMBERSHIP}' AND s.branch_id=@branchId AND s.status='open'`

/** Does this task have an open pickup? (the one-picker rule). Uses migration 0318: organization, kind, task. */
export const OPEN_PICKUP_SQL = (task: string, org: string): string => `EXISTS(SELECT 1 FROM ${S} pk INDEXED BY inventory_check_sessions_kind_task WHERE pk.organization_id IS ${org} AND ${kindOf('pk')}='${PICKUP_MEMBERSHIP}' AND ${taskOf('pk')}=${task} AND pk.status='open')`

/**
 * The statements that close the open pickups of a task and record it: the events first (they select the rows that are still open), then the update. Used by the close by hand.
 * Parameters: @task @org @actorId @actorName @key @hash @now.
 */
export function closePickupsStatements(): Array<{ sql: string }> {
  const open = `pk.organization_id IS @org AND ${kindOf('pk')}='${PICKUP_MEMBERSHIP}' AND ${taskOf('pk')}=@task AND pk.status='open'`
  return [
    { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT pk.id,NULL,@actorId,@actorName,'close',@key||'-pickup-'||pk.id,@hash,json_object('status','open','revision',pk.revision),
        json_object('status','closed','revision',pk.revision+1,'task',@task),json_object('sessionRevision',pk.revision+1),@now FROM ${S} pk INDEXED BY inventory_check_sessions_kind_task WHERE ${open}` },
    { sql: `UPDATE inventory_check_sessions SET status='closed',revision=revision+1,updated_at=@now,closed_at=@now WHERE id IN (SELECT pk.id FROM ${S} pk INDEXED BY inventory_check_sessions_kind_task WHERE ${open})` },
  ]
}

export type AutoCloseArgs = { src: string; task?: string | null; organization: number | null; branchId: number; actorId: number; actorName: string | null; key: string; hash: string; now: string }
/** The parameters every auto-close statement reads. `src` is the session the write's counts are in; `task` the task a submission named (or null). */
export function autoCloseParams(a: AutoCloseArgs): Record<string, unknown> {
  const range = (suffix: string): { from: string; to: string } => ({ from: `${a.key}${suffix}`, to: `${a.key}${suffix.slice(0, -1)}.` }) // '.' sorts right after '-': the keys that start with the prefix
  const closed = range('-task-closed-'), pickup = range('-pickup-')
  return { src: a.src, task: a.task ?? null, org: a.organization, branchId: a.branchId, actorId: a.actorId, actorName: a.actorName, key: a.key, hash: a.hash, now: a.now,
    tcFrom: closed.from, tcTo: closed.to, pkFrom: pickup.from, pkTo: pickup.to }
}

/**
 * THE AUTO-CLOSE (owner, 18 Nov): a task closes itself when its last product is counted. These are the statements every writer that makes counts FINAL appends to its own batch (a submission, a lot submission,
 * the close of a count session, a Set that closes a difference): no D1 call of its own. A task closes when it is open, at this organization and branch, holds a product this write made final (or is the task
 * the submission named) and every one of its still-countable products is done under the done rule.
 *   1. The close events of the tasks that will close (they read the rows while still open), request id `<key>-task-closed-<task id>`: one per task, so a write that closes two tasks does not abort on the unique key.
 *   2. The events of the pickups those tasks have open (found by the events of 1, then by the 0318 index: organization, kind, task).
 *   3. The tasks close (found by the events of 1: a seek of the events' unique key, by this request's prefix), answering their ids.
 *   4. The pickups close (found by the events of 2).
 * The candidates are the OPEN tasks of the organization at the branch (migration 0319), each tested by one primary-key seek of its item per product the write made final; a candidate then reads one seek of the 0285
 * index per product until the first product that is not done. Nothing reads a closed task or an old session, so the cost does not grow with history: at most the open tasks (the cap) x their products.
 * The close event records which session closed the task (after_json.closedBy = the write's session), so a later ruling on a count that is taken back can find the tasks that rested on it.
 * Statements 2 to 4 find nothing in the events when no task closes. Parameters: autoCloseParams.
 */
export function autoCloseTaskStatements(): { statements: Array<{ sql: string }>; closedAt: number } {
  // The candidates start from the OPEN tasks of this organization at the branch (the partial index of migration 0319, which holds only open sessions): never from the history of counts or closed tasks, so
  // the rows read do not grow with it. A task is a candidate when it is the one a submission named, or it holds one of the products this write made final (a seek of its item by primary key).
  const candidate = `t.organization_id IS @org AND ${kindOf('t')}='${TASK_MEMBERSHIP}' AND t.branch_id=@branchId AND t.status='open'
        AND (t.id=@task OR EXISTS(SELECT 1 FROM ${I} w CROSS JOIN ${I} m ON m.session_id=t.id AND m.product_id=w.product_id AND m.branch_id=@branchId WHERE w.session_id=@src AND w.state IN ('done','issue')))
        AND NOT EXISTS(SELECT 1 FROM ${I} n WHERE n.session_id=t.id AND NOT ${taskItemDoneSql('n', '@branchId', 't.started_at', '@org')} AND ${taskItemCountableSql('n')})`
  const ofClosed = `e.actor_id=@actorId AND e.request_id>=@tcFrom AND e.request_id<@tcTo AND e.request_hash=@hash AND e.action='close' AND e.created_at=@now`
  // The two updates find their rows by the events of this request only, and check the row's kind, organization and branch THERE (a join by key), so the planner never starts from the 0318 index and walks every task.
  const closedTasks = `SELECT e.session_id FROM inventory_check_events e CROSS JOIN ${S} k ON k.id=e.session_id WHERE ${ofClosed} AND k.organization_id IS @org AND k.branch_id=@branchId AND ${kindOf('k')}='${TASK_MEMBERSHIP}'`
  const ofPickups = `SELECT e.session_id FROM inventory_check_events e CROSS JOIN ${S} k ON k.id=e.session_id WHERE e.actor_id=@actorId AND e.request_id>=@pkFrom AND e.request_id<@pkTo AND e.request_hash=@hash AND e.action='close' AND e.created_at=@now AND k.organization_id IS @org AND ${kindOf('k')}='${PICKUP_MEMBERSHIP}'`
  // In the pickup events, +e.session_id drops the column's TEXT affinity, which would otherwise keep the expression index of 0318 from serving the join (plan pinned in test-d1-task-index-plan-native.cjs).
  const statements = [
    { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT t.id,NULL,@actorId,@actorName,'close',@key||'-task-closed-'||t.id,@hash,json_object('status','open','revision',t.revision),
        json_object('status','closed','revision',t.revision+1,'auto',1,'closedBy',@src),json_object('sessionRevision',t.revision+1),@now
      FROM ${S} t INDEXED BY inventory_check_sessions_open_task WHERE ${candidate}` },
    { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT pk.id,NULL,@actorId,@actorName,'close',@key||'-pickup-'||pk.id,@hash,json_object('status','open','revision',pk.revision),
        json_object('status','closed','revision',pk.revision+1,'task',e.session_id),json_object('sessionRevision',pk.revision+1),@now
      FROM inventory_check_events e CROSS JOIN ${S} pk INDEXED BY inventory_check_sessions_kind_task ON pk.organization_id IS @org AND ${kindOf('pk')}='${PICKUP_MEMBERSHIP}' AND ${taskOf('pk')}=+e.session_id AND pk.status='open'
      WHERE ${ofClosed}` },
    { sql: `UPDATE inventory_check_sessions SET status='closed',revision=revision+1,updated_at=@now,closed_at=@now
      WHERE id IN (${closedTasks}) AND status='open' RETURNING id` },
    { sql: `UPDATE inventory_check_sessions SET status='closed',revision=revision+1,updated_at=@now,closed_at=@now WHERE id IN (${ofPickups}) AND status='open'` },
  ]
  return { statements, closedAt: 2 }
}
/** The ids of the tasks a write closed, from the answer of the statement at `closedAt` (the rows its RETURNING gave). */
export function closedTaskIds(result: { results?: unknown[] } | undefined): string[] {
  return (result?.results ?? []).map((row) => String((row as { id: unknown }).id))
}

export type TaskRow = {
  id: string; branch_id: number; title: string; status: 'open' | 'closed'; revision: number; started_at: string; closed_at: string | null; created_by: number; issuer: string | null
  selection: unknown; total: number; done: number; removed: number; pickup_id: string | null; picked_by: number | null; picker: string | null; picked_at: string | null
}

/**
 * The tasks of one branch, open ones first (newest issued first, at most `shown`) and then the most recently closed (at most `closedShown`), with who issued each, its product count, its done count
 * (the done rule), and who has it open. ONE statement: the page of sessions is cut first (the open ones by the open index and the closed ones by the task index, both migration 0319), then the counts and the pickup are read for those rows only. `total` and `done` are over the
 * products that can still be counted; `removed` is how many of the task's products can not (deactivated, merged away, a header). Reads: the open tasks of the branch and the last few closed ones (a short walk of the task index, however many tasks were closed before), 1 + one seek per
 * product for each shown task, one pickup seek per task.
 */
export async function readTaskRows(db: D1Compat, args: { organization: number | null; branchId: number; shown: number; closedShown: number }): Promise<TaskRow[]> {
  const rows = await db.prepare(`WITH open_t AS (SELECT s.* FROM ${S} s INDEXED BY inventory_check_sessions_open_task WHERE s.organization_id IS @org AND ${kindOf('s')}='${TASK_MEMBERSHIP}' AND s.branch_id=@branchId AND s.status='open'
      ORDER BY s.started_at DESC, s.id DESC LIMIT @shown),
    closed_t AS (SELECT s.* FROM ${S} s INDEXED BY inventory_check_sessions_task_board WHERE s.organization_id IS @org AND ${kindOf('s')}='${TASK_MEMBERSHIP}' AND s.branch_id=@branchId AND s.status='closed'
      ORDER BY s.closed_at DESC, s.id DESC LIMIT @closedShown),
    page AS (SELECT * FROM open_t UNION ALL SELECT * FROM closed_t)
    SELECT page.id AS id, page.branch_id AS branch_id, page.title AS title, page.status AS status, page.revision AS revision, page.started_at AS started_at, page.closed_at AS closed_at, page.created_by AS created_by,
      iu.username AS issuer, json_extract(page.scope_json,'$.selection') AS selection,
      (SELECT COUNT(*) FROM ${I} t WHERE t.session_id=page.id AND ${taskItemCountableSql('t')}) AS total,
      (SELECT COUNT(*) FROM ${I} t WHERE t.session_id=page.id AND ${taskItemDoneSql('t', 'page.branch_id', 'page.started_at', '@org')} AND ${taskItemCountableSql('t')}) AS done,
      (SELECT COUNT(*) FROM ${I} t WHERE t.session_id=page.id AND NOT ${taskItemCountableSql('t')}) AS removed,
      pk.id AS pickup_id, pk.created_by AS picked_by, pu.username AS picker, pk.started_at AS picked_at
    FROM page LEFT JOIN users iu ON iu.id=page.created_by
      LEFT JOIN ${S} pk INDEXED BY inventory_check_sessions_kind_task ON pk.organization_id IS @org AND ${kindOf('pk')}='${PICKUP_MEMBERSHIP}' AND ${taskOf('pk')}=+page.id AND pk.status='open'
      LEFT JOIN users pu ON pu.id=pk.created_by
    ORDER BY (page.status='open') DESC, CASE WHEN page.status='open' THEN page.started_at ELSE page.closed_at END DESC, page.id DESC`)
    .all<Omit<TaskRow, 'selection'> & { selection: string | null }>({ org: args.organization, branchId: args.branchId, shown: args.shown, closedShown: args.closedShown })
  return rows.map((row) => ({ ...row, revision: Number(row.revision), total: Number(row.total), done: Number(row.done), removed: Number(row.removed), selection: parseSelection(row.selection) }))
}

function parseSelection(value: string | null | undefined): unknown {
  if (value == null) return null
  try { return JSON.parse(value) } catch { return null }
}

/** One task's identity and the ids of its products that can still be counted (one statement; the same rule as the board's total). Null when the id is not a task of the organization. */
export async function readTaskProducts(db: D1Compat, args: { organization: number | null; taskId: string }): Promise<{ branchId: number; status: 'open' | 'closed'; startedAt: string; productIds: number[] } | null> {
  const rows = await db.prepare(`SELECT s.branch_id AS branch_id, s.status AS status, s.started_at AS started_at, i.product_id AS product_id, ${taskItemCountableSql('i')} AS countable FROM ${S} s JOIN ${I} i ON i.session_id=s.id
    WHERE s.id=@id AND s.organization_id IS @org AND ${kindOf('s')}='${TASK_MEMBERSHIP}' ORDER BY i.product_id`).all<{ branch_id: number; status: 'open' | 'closed'; started_at: string; product_id: number; countable: number }>({ id: args.taskId, org: args.organization })
  if (!rows.length) return null
  return { branchId: Number(rows[0].branch_id), status: rows[0].status, startedAt: rows[0].started_at, productIds: rows.filter((row) => Number(row.countable) === 1).map((row) => Number(row.product_id)) }
}
