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

/**
 * The cache namespace of one branch's TASK BOARD (P2.3/P2.4): the board (GET /tasks) keys on it and on 'products' (countability), NOT on 'inventory_checks'. It is moved, in the writer's own awaited bump call (a KV write, no D1
 * statement), by exactly the writers that can change a figure of the board at that branch: a final count appearing or disappearing there, or a task row changing. The complete table is pinned in
 * test-inventory-check-tasks-board-version-pure.cjs; an observation, an approval decision and a new open session move 'inventory_checks' only.
 */
export const icTasksNamespace = (branchId: number | string): string => `ic_tasks:${Number(branchId)}`
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

/** A FINAL count (x the item, xs its session): the done rule's own predicate. taskItemDoneSql, the reopen's skip and its `l` all use this one text, so they can never disagree. */
export const finalCountSql = (x: string, xs: string, org: string): string => `${x}.state IN ('done','issue') AND ${xs}.status='closed' AND ${xs}.organization_id IS ${org} AND ${xs}.branch_id=${x}.branch_id
      AND ${kindOf(xs)} IS NOT 'stock_set_undo' AND json_extract(${xs}.scope_json,'$.restore') IS NOT 1`

/**
 * Is this product of the task counted? `item` is the task's item row alias; `branch`, `since` and `org` are SQL expressions or parameters. One seek of the 0285 index per product:
 * the counts of the product at the branch from `since` on, of which any one that is Done or Differs and FINAL (its session is closed) makes the product done. Items of other organizations are never read.
 */
export const taskItemDoneSql = (item: string, branch: string, since: string, org: string): string => `EXISTS(SELECT 1 FROM ${I} x INDEXED BY inventory_check_items_product_latest
    CROSS JOIN ${S} xs ON xs.id=x.session_id
    WHERE x.product_id=${item}.product_id AND x.branch_id=${branch} AND x.updated_at>=${since} AND ${finalCountSql('x', 'xs', org)})`

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
export function autoCloseTaskStatements(src = '@src'): { statements: Array<{ sql: string }>; closedAt: number } {
  // The candidates start from the OPEN tasks of this organization at the branch (the partial index of migration 0319, which holds only open sessions): never from the history of counts or closed tasks, so
  // the rows read do not grow with it. A task is a candidate when it is the one a submission named, or it holds one of the products this write made final (a seek of its item by primary key).
  const candidate = `t.organization_id IS @org AND ${kindOf('t')}='${TASK_MEMBERSHIP}' AND t.branch_id=@branchId AND t.status='open'
        AND (t.id=@task OR EXISTS(SELECT 1 FROM ${I} w CROSS JOIN ${I} m ON m.session_id=t.id AND m.product_id=w.product_id AND m.branch_id=@branchId WHERE w.session_id=${src} AND w.state IN ('done','issue')))
        AND NOT EXISTS(SELECT 1 FROM ${I} n WHERE n.session_id=t.id AND NOT ${taskItemDoneSql('n', '@branchId', 't.started_at', '@org')} AND ${taskItemCountableSql('n')})`
  const ofClosed = `e.actor_id=@actorId AND e.request_id>=@tcFrom AND e.request_id<@tcTo AND e.request_hash=@hash AND e.action='close' AND e.created_at=@now`
  // The two updates find their rows by the events of this request only, and check the row's kind, organization and branch THERE (a join by key), so the planner never starts from the 0318 index and walks every task.
  const closedTasks = `SELECT e.session_id FROM inventory_check_events e CROSS JOIN ${S} k ON k.id=e.session_id WHERE ${ofClosed} AND k.organization_id IS @org AND k.branch_id=@branchId AND ${kindOf('k')}='${TASK_MEMBERSHIP}'`
  const ofPickups = `SELECT e.session_id FROM inventory_check_events e CROSS JOIN ${S} k ON k.id=e.session_id WHERE e.actor_id=@actorId AND e.request_id>=@pkFrom AND e.request_id<@pkTo AND e.request_hash=@hash AND e.action='close' AND e.created_at=@now AND k.organization_id IS @org AND ${kindOf('k')}='${PICKUP_MEMBERSHIP}'`
  // In the pickup events, +e.session_id drops the column's TEXT affinity, which would otherwise keep the expression index of 0318 from serving the join (plan pinned in test-d1-task-index-plan-native.cjs).
  const statements = [
    // The close event records the figures the task closes with (P2.1: a closed task's board row reads them, never the items again). One walk of the closing task's items, ONCE, by the batch that closes it; done = total
    // by this statement's own condition (every countable product is done). The walk sits in a derived table so each candidate is walked once, not once per figure.
    { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT c.id,NULL,@actorId,@actorName,'close',@key||'-task-closed-'||c.id,@hash,json_object('status','open','revision',c.revision),
        json_object('status','closed','revision',c.revision+1,'auto',1,'closedBy',${src},'total',COALESCE(c.f,0)/${TASK_FIGURE_TOTAL},'done',COALESCE(c.f,0)/${TASK_FIGURE_TOTAL},'removed',COALESCE(c.f,0)%1000),json_object('sessionRevision',c.revision+1),@now
      FROM (SELECT t.id AS id, t.revision AS revision, (SELECT SUM(CASE WHEN ${taskItemCountableSql('n')} THEN ${TASK_FIGURE_TOTAL} ELSE ${TASK_FIGURE_REMOVED} END) FROM ${I} n WHERE n.session_id=t.id) AS f
        FROM ${S} t INDEXED BY inventory_check_sessions_open_task WHERE ${candidate}) c` },
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
const EV = 'INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)'
/** The counts a write took back: the items of `src` at the branch (@undo=1 for a Set Undo: the Set's one item, already turned unstarted in the same batch), of a session the done rule counts. */
const takenSql = (src: string): string => `SELECT w.product_id AS product_id, w.updated_at AS at FROM ${I} w CROSS JOIN ${S} ws ON ws.id=w.session_id
    WHERE w.session_id=${src} AND w.branch_id=@branchId AND w.updated_at IS NOT NULL AND (@undo=1 OR w.state IN ('done','issue'))
      AND ws.organization_id IS @org AND ws.branch_id=w.branch_id AND ${kindOf('ws')} IS NOT 'stock_set_undo' AND json_extract(ws.scope_json,'$.restore') IS NOT 1`
/** The taken-back products no remaining final count covers at or after `at` (the others are skipped whole: every task that count ticked is still ticked), each with l = the newest remaining final count before it. */
const gapSql = (src: string): string => `SELECT k.product_id AS product_id, k.at AS at,
      (SELECT x.updated_at FROM ${I} x INDEXED BY inventory_check_items_product_latest CROSS JOIN ${S} xs ON xs.id=x.session_id
        WHERE x.product_id=k.product_id AND x.branch_id=@branchId AND x.updated_at<k.at AND ${finalCountSql('x', 'xs', '@org')} ORDER BY x.updated_at DESC LIMIT 1) AS l
    FROM (${takenSql(src)}) k WHERE NOT ${taskItemDoneSql('k', '@branchId', 'k.at', '@org')}`
/** The closed tasks that rested on a taken-back count: the never-counted task items of each gap product at the branch (the 0285 prefix (P, B, NULL)), their task by key, in the exact window l < started_at <= at. */
const restedSql = (src: string): string => `SELECT DISTINCT r.id AS id FROM (SELECT n.session_id AS id, n.product_id AS product_id FROM (${gapSql(src)}) g
      CROSS JOIN ${I} n INDEXED BY inventory_check_items_product_latest ON n.product_id=g.product_id AND n.branch_id=@branchId AND n.updated_at IS NULL
      CROSS JOIN ${S} c ON c.id=n.session_id
    WHERE c.organization_id IS @org AND ${kindOf('c')}='${TASK_MEMBERSHIP}' AND c.branch_id=@branchId AND c.status='closed' AND c.started_at<=g.at AND (g.l IS NULL OR c.started_at>g.l) LIMIT -1) r
    WHERE ${taskItemCountableSql('r')}`
const autoClosedSql = (t: string): string => `(SELECT json_extract(e.after_json,'$.auto') FROM inventory_check_events e WHERE e.session_id=${t}.id AND e.action='close' ORDER BY e.id DESC LIMIT 1) IS 1`

export type ReopenArgs = { src: string | null; undo: boolean; cause: 'resumed' | 'set_undone'; organization: number | null; branchId: number; actorId: number; actorName: string | null; key: string; hash: string; now: string }
/** The parameters the reopen statements read (a Set Undo adds its own: product, setActor, setKey). */
export function reopenParams(a: ReopenArgs): Record<string, unknown> {
  return { src: a.src, undo: a.undo ? 1 : 0, cause: a.cause, org: a.organization, branchId: a.branchId, actorId: a.actorId, actorName: a.actorName, key: a.key, hash: a.hash, now: a.now,
    roFrom: `${a.key}-task-reopened-`, roTo: `${a.key}-task-reopened.` }
}
/**
 * THE REOPEN (owner, 19 Nov: a task's state always follows the counts in effect): appended to the batch of a write that takes counts back, AFTER the statement that takes them back. A closed task that the
 * auto-close closed reopens when a taken-back product stopped being done for it (the exact window of the design: no remaining final count at or after the taken-back one, and the newest earlier one older than the task).
 *   1. one resume event per task (request id `<key>-task-reopened-<task id>`, after_json.reopened=1, cause, by = the session whose count was taken back);
 *   2. the tasks reopen (found by those events), answering their ids.
 * No cap guard (a take-back is never refused) and no D1 call of its own. `src` is the SQL of the session whose counts were taken back ('@src', or the Set session's lookup).
 */
export function reopenTaskStatements(src = '@src'): { statements: Array<{ sql: string }>; reopenedAt: number } {
  return { reopenedAt: 1, statements: [
    { sql: `${EV}
      SELECT t.id,NULL,@actorId,@actorName,'resume',@key||'-task-reopened-'||t.id,@hash,json_object('status','closed','revision',t.revision),
        json_object('status','open','revision',t.revision+1,'reopened',1,'cause',@cause,'by',${src}),json_object('sessionRevision',t.revision+1),@now
      FROM (${restedSql(src)}) r CROSS JOIN ${S} t ON t.id=r.id WHERE ${autoClosedSql('t')}` },
    { sql: `UPDATE inventory_check_sessions SET status='open',revision=revision+1,updated_at=@now,closed_at=NULL
      WHERE id IN (SELECT e.session_id FROM inventory_check_events e CROSS JOIN ${S} k ON k.id=e.session_id WHERE e.actor_id=@actorId AND e.request_id>=@roFrom AND e.request_id<@roTo
        AND e.request_hash=@hash AND e.action='resume' AND e.created_at=@now AND k.organization_id IS @org AND k.branch_id=@branchId AND ${kindOf('k')}='${TASK_MEMBERSHIP}') AND status='closed' RETURNING id` },
  ] }
}
/** The ids of the tasks a write closed, from the answer of the statement at `closedAt` (the rows its RETURNING gave). */
export function closedTaskIds(result: { results?: unknown[] } | undefined): string[] {
  return (result?.results ?? []).map((row) => String((row as { id: unknown }).id))
}
/** The ids of the tasks a write reopened (the same shape: the rows the reopen's UPDATE returned). */
export const reopenedTaskIds = closedTaskIds

/**
 * THE FIGURES OF A TASK IN ONE NUMBER (P2.2). total, done and removed come from ONE walk of the task's items: each item adds ONE_TOTAL (counted in total), plus ONE_DONE more when it is done, or 1 when it can no longer be
 * counted (removed). The three figures are read back with decodeTaskFigures. Exact while a task holds fewer than 1000 items, which both plan tiers' maxProducts guarantee (test-inventory-check-tasks-figures-pure.cjs).
 */
export const TASK_FIGURE_TOTAL = 1000000, TASK_FIGURE_DONE = 1000, TASK_FIGURE_REMOVED = 1
export const decodeTaskFigures = (figures: number | null | undefined): { total: number; done: number; removed: number } => {
  const f = Number(figures ?? 0)
  return { total: Math.floor(f / TASK_FIGURE_TOTAL), done: Math.floor(f / TASK_FIGURE_DONE) % 1000, removed: f % 1000 }
}
/** The task's figures by ONE walk of its items (alias `page` is the task row). Live: total, done and removed as the done rule counts them now. */
const liveFiguresSql = (): string => `(SELECT SUM(CASE WHEN ${taskItemCountableSql('t')} THEN CASE WHEN ${taskItemDoneSql('t', 'page.branch_id', 'page.started_at', '@org')} THEN ${TASK_FIGURE_TOTAL + TASK_FIGURE_DONE} ELSE ${TASK_FIGURE_TOTAL} END ELSE ${TASK_FIGURE_REMOVED} END)
      FROM ${I} t WHERE t.session_id=page.id)`
/** The figures a CLOSED task was closed with: those of its newest close event (one seek of inventory_check_events_session), NULL when that event carries none (a task closed before the figures were recorded). */
const frozenFiguresSql = (): string => `(SELECT json_extract(e.after_json,'$.total')*${TASK_FIGURE_TOTAL}+json_extract(e.after_json,'$.done')*${TASK_FIGURE_DONE}+json_extract(e.after_json,'$.removed')*${TASK_FIGURE_REMOVED}
      FROM inventory_check_events e WHERE e.session_id=page.id AND e.action='close' ORDER BY e.id DESC LIMIT 1)`

/**
 * The close event of a task closed BY HAND: the usual event row (the statement that records the request) plus the figures the admin saw, read from the task row in the same batch (P2.1: the board shows a closed task's figures
 * from this event, so its items are never walked again). Parameters: @sessionId @actorId @actorName @key @hash @before @after @result @now @org.
 */
export const taskCloseEventSql = (): string => `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT g.id,NULL,@actorId,@actorName,'close',@key,@hash,@before,
        json_set(@after,'$.total',g.f/${TASK_FIGURE_TOTAL},'$.done',(g.f/${TASK_FIGURE_DONE})%1000,'$.removed',g.f%1000),@result,@now
      FROM (SELECT page.id AS id, COALESCE(${liveFiguresSql()},0) AS f FROM ${S} page WHERE page.id=@sessionId) g`

export type TaskRow = {
  id: string; branch_id: number; title: string; status: 'open' | 'closed'; revision: number; started_at: string; closed_at: string | null; created_by: number; issuer: string | null
  selection: unknown; total: number; done: number; removed: number; pickup_id: string | null; picked_by: number | null; picker: string | null; picked_at: string | null
  /** An OPEN task whose newest event is its reopen (a count it relied on was taken back): when, why, and the account that took it back (the route shows the name only to a viewer who may see staff identity). */
  reopened: { at: string; cause: 'resumed' | 'set_undone'; by: number | null; name: string | null } | null
}

/**
 * The tasks of one branch, open ones first (newest issued first, EVERY open one: a reopen can take a branch over maxOpenTasks) and then the most recently closed (at most `closedShown`), with who issued each, its product count, its done count
 * (the done rule), and who has it open. ONE statement: the page of sessions is cut first (the open ones by the open index and the closed ones by the task index, both migration 0319), then the counts and the pickup are read for those rows only. `total` and `done` are over the
 * products that can still be counted; `removed` is how many of the task's products can not (deactivated, merged away, a header). Reads: the open tasks of the branch and the last few closed ones (a short walk of the task index, however many tasks were closed before), 1 + one seek per
 * product for each shown task, one pickup seek per task.
 */
export async function readTaskRows(db: D1Compat, args: { organization: number | null; branchId: number; closedShown: number }): Promise<TaskRow[]> {
  const rows = await db.prepare(`WITH open_t AS (SELECT s.* FROM ${S} s INDEXED BY inventory_check_sessions_open_task WHERE s.organization_id IS @org AND ${kindOf('s')}='${TASK_MEMBERSHIP}' AND s.branch_id=@branchId AND s.status='open'
      ORDER BY s.started_at DESC, s.id DESC),
    closed_t AS (SELECT s.* FROM ${S} s INDEXED BY inventory_check_sessions_task_board WHERE s.organization_id IS @org AND ${kindOf('s')}='${TASK_MEMBERSHIP}' AND s.branch_id=@branchId AND s.status='closed'
      ORDER BY s.closed_at DESC, s.id DESC LIMIT @closedShown),
    page AS (SELECT * FROM open_t UNION ALL SELECT * FROM closed_t)
    SELECT page.id AS id, page.branch_id AS branch_id, page.title AS title, page.status AS status, page.revision AS revision, page.started_at AS started_at, page.closed_at AS closed_at, page.created_by AS created_by,
      iu.username AS issuer, json_extract(page.scope_json,'$.selection') AS selection,
      CASE WHEN page.status='closed' THEN COALESCE(${frozenFiguresSql()},${liveFiguresSql()}) ELSE ${liveFiguresSql()} END AS figures,
      pk.id AS pickup_id, pk.created_by AS picked_by, pu.username AS picker, pk.started_at AS picked_at,
      CASE WHEN page.status='open' THEN (SELECT CASE WHEN e.action='resume' AND json_extract(e.after_json,'$.reopened')=1 THEN json_object('at',e.created_at,'cause',json_extract(e.after_json,'$.cause'),'by',e.actor_id,'name',(SELECT ru.username FROM users ru WHERE ru.id=e.actor_id)) END
        FROM inventory_check_events e WHERE e.session_id=page.id ORDER BY e.id DESC LIMIT 1) END AS reopened
    FROM page LEFT JOIN users iu ON iu.id=page.created_by
      LEFT JOIN ${S} pk INDEXED BY inventory_check_sessions_kind_task ON pk.organization_id IS @org AND ${kindOf('pk')}='${PICKUP_MEMBERSHIP}' AND ${taskOf('pk')}=+page.id AND pk.status='open'
      LEFT JOIN users pu ON pu.id=pk.created_by
    ORDER BY (page.status='open') DESC, CASE WHEN page.status='open' THEN page.started_at ELSE page.closed_at END DESC, page.id DESC`)
    .all<Omit<TaskRow, 'selection' | 'reopened' | 'total' | 'done' | 'removed'> & { selection: string | null; reopened: string | null; figures: number | null }>({ org: args.organization, branchId: args.branchId, closedShown: args.closedShown })
  return rows.map(({ figures, ...row }) => ({ ...row, revision: Number(row.revision), ...decodeTaskFigures(figures), selection: parseSelection(row.selection), reopened: parseReopened(row.reopened) }))
}

function parseReopened(value: string | null | undefined): TaskRow['reopened'] {
  if (value == null) return null
  try {
    const parsed = JSON.parse(value) as { at?: unknown; cause?: unknown; by?: unknown; name?: unknown }
    if (typeof parsed.at !== 'string') return null
    return { at: parsed.at, cause: parsed.cause === 'set_undone' ? 'set_undone' : 'resumed', by: typeof parsed.by === 'number' ? parsed.by : null, name: typeof parsed.name === 'string' ? parsed.name : null }
  } catch { return null }
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
