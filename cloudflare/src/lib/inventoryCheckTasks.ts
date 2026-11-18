import type { D1Compat } from './db'

// Count tasks (owner, 18 Nov 2026): an admin issues products to count, an employee picks the task up, and the counts they submit tick the products off.
// Nothing here is a new table: a task is an open row of inventory_check_sessions whose scope_json says {"membership":"task"}, a pickup is the picker's own open session
// {"membership":"pickup","task":"<task id>"} with no items, and a count made for a task is an ordinary submission whose scope also names the task. This module holds the SQL
// text and the reads; the writers (issue, pickup, release, close, the auto-close inside a submission) are in lib/inventoryCheckSessions.ts, which owns the session rows.
// It imports nothing from that file, so the two can reference each other's text without a cycle.
//
// THE DONE RULE (owner, 18 Nov): a product of a task is done once any count of it at the task's branch (Done or Differs) exists at or after the moment the task was issued, wherever it was made.
// The count is an item with state done|issue and an updated_at (the time of the count) at or after the task's started_at. A task's own items are `unstarted` with no updated_at, so a task is never a count itself.

export const TASK_MEMBERSHIP = 'task'
export const PICKUP_MEMBERSHIP = 'pickup'
const S = 'inventory_check_sessions'
const I = 'inventory_check_items'
const E = 'inventory_check_events'

/** The kind of a session row, as the expression the index of migration 0318 holds. */
export const kindOf = (alias: string): string => `json_extract(${alias}.scope_json, '$.membership')`
/** The task a session names (a pickup, or a submission that counted a task), as the index holds it. */
export const taskOf = (alias: string): string => `json_extract(${alias}.scope_json, '$.task')`

/**
 * Is this product of the task counted? `item` is the task's item row alias; `branch`, `since` and `org` are SQL expressions or parameters. One seek of the 0285 index per product:
 * the counts of the product at the branch from `since` on, of which any one that is Done or Differs makes the product done. Items of other organizations are never read.
 */
export const taskItemDoneSql = (item: string, branch: string, since: string, org: string): string => `EXISTS(SELECT 1 FROM ${I} x INDEXED BY inventory_check_items_product_latest
    CROSS JOIN ${S} xs ON xs.id=x.session_id
    WHERE x.product_id=${item}.product_id AND x.branch_id=${branch} AND x.updated_at>=${since} AND x.state IN ('done','issue') AND xs.organization_id IS ${org} AND xs.branch_id=x.branch_id)`

/** Does this task have an open pickup? (the one-picker rule). Uses migration 0318: organization, kind, task. */
export const OPEN_PICKUP_SQL = (task: string, org: string): string => `EXISTS(SELECT 1 FROM ${S} pk WHERE pk.organization_id IS ${org} AND ${kindOf('pk')}='${PICKUP_MEMBERSHIP}' AND ${taskOf('pk')}=${task} AND pk.status='open')`

/**
 * The statements that close the open pickups of a task and record it: the events first (they select the rows that are still open), then the update. `when` is an extra condition (SQL over the
 * task row, or nothing) so the same pair serves a close by hand and the auto-close. Parameters: @task @org @actorId @actorName @key @hash @now.
 */
export function closePickupsStatements(when = ''): Array<{ sql: string }> {
  const open = `pk.organization_id IS @org AND ${kindOf('pk')}='${PICKUP_MEMBERSHIP}' AND ${taskOf('pk')}=@task AND pk.status='open'${when ? ` AND ${when}` : ''}`
  return [
    { sql: `INSERT INTO ${E}(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT pk.id,NULL,@actorId,@actorName,'close',@key||'-pickup-'||pk.id,@hash,json_object('status','open','revision',pk.revision),
        json_object('status','closed','revision',pk.revision+1,'task',@task),json_object('sessionRevision',pk.revision+1),@now FROM ${S} pk WHERE ${open}` },
    { sql: `UPDATE ${S} SET status='closed',revision=revision+1,updated_at=@now,closed_at=@now WHERE id IN (SELECT pk.id FROM ${S} pk WHERE ${open})` },
  ]
}

/**
 * The statements a submission that names a task adds to its own batch: the task closes itself when every one of its products is done (this submission's own items already count: they are
 * inserted before these run, in the same transaction), the close is recorded, and the pickups close with it. Nothing changes when a product is still open. Cost: one UPDATE whose NOT EXISTS stops at the
 * first product that is not done (at worst one index seek per product of the task), plus three statements that match nothing. Parameters: @task @org @branchId @actorId @actorName @key @hash @now.
 */
export function autoCloseTaskStatements(): Array<{ sql: string; returning?: true }> {
  const closedNow = `EXISTS(SELECT 1 FROM ${S} t WHERE t.id=@task AND t.status='closed' AND t.closed_at=@now AND t.updated_at=@now)`
  return [
    { sql: `UPDATE ${S} SET status='closed',revision=revision+1,updated_at=@now,closed_at=@now
      WHERE id=@task AND organization_id IS @org AND branch_id=@branchId AND ${kindOf(S)}='${TASK_MEMBERSHIP}' AND status='open'
        AND NOT EXISTS(SELECT 1 FROM ${I} t WHERE t.session_id=@task AND NOT ${taskItemDoneSql('t', '@branchId', `(SELECT started_at FROM ${S} WHERE id=@task)`, '@org')})
      RETURNING id`, returning: true },
    { sql: `INSERT INTO ${E}(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT s.id,NULL,@actorId,@actorName,'close',@key||'-task-closed',@hash,json_object('status','open','revision',s.revision-1),
        json_object('status','closed','revision',s.revision,'auto',1),json_object('sessionRevision',s.revision),@now FROM ${S} s WHERE s.id=@task AND s.status='closed' AND s.closed_at=@now AND s.updated_at=@now` },
    ...closePickupsStatements(closedNow),
  ]
}

export type TaskRow = {
  id: string; branch_id: number; title: string; status: 'open' | 'closed'; started_at: string; closed_at: string | null; created_by: number; issuer: string | null
  selection: unknown; total: number; done: number; pickup_id: string | null; picked_by: number | null; picker: string | null; picked_at: string | null
}

/**
 * The tasks of one branch, open ones first (newest issued first, at most `shown`) and then the most recently closed (at most `closedShown`), with who issued each, its product count, its done count
 * (the done rule), and who has it open. ONE statement: the page of sessions is cut first (organization, kind: migration 0318), then the counts and the pickup are read for those rows only. Reads: the
 * tasks of the organization's branch once for the sort, 1 + one seek per product for each shown task, one pickup seek per task.
 */
export async function readTaskRows(db: D1Compat, args: { organization: number | null; branchId: number; shown: number; closedShown: number }): Promise<TaskRow[]> {
  const rows = await db.prepare(`WITH open_t AS (SELECT s.* FROM ${S} s WHERE s.organization_id IS @org AND ${kindOf('s')}='${TASK_MEMBERSHIP}' AND s.branch_id=@branchId AND s.status='open'
      ORDER BY s.started_at DESC, s.id DESC LIMIT @shown),
    closed_t AS (SELECT s.* FROM ${S} s WHERE s.organization_id IS @org AND ${kindOf('s')}='${TASK_MEMBERSHIP}' AND s.branch_id=@branchId AND s.status='closed'
      ORDER BY s.closed_at DESC, s.id DESC LIMIT @closedShown),
    page AS (SELECT * FROM open_t UNION ALL SELECT * FROM closed_t)
    SELECT page.id AS id, page.branch_id AS branch_id, page.title AS title, page.status AS status, page.started_at AS started_at, page.closed_at AS closed_at, page.created_by AS created_by,
      iu.username AS issuer, json_extract(page.scope_json,'$.selection') AS selection,
      (SELECT COUNT(*) FROM ${I} t WHERE t.session_id=page.id) AS total,
      (SELECT COUNT(*) FROM ${I} t WHERE t.session_id=page.id AND ${taskItemDoneSql('t', 'page.branch_id', 'page.started_at', '@org')}) AS done,
      pk.id AS pickup_id, pk.created_by AS picked_by, pu.username AS picker, pk.started_at AS picked_at
    FROM page LEFT JOIN users iu ON iu.id=page.created_by
      LEFT JOIN ${S} pk ON pk.organization_id IS @org AND ${kindOf('pk')}='${PICKUP_MEMBERSHIP}' AND ${taskOf('pk')}=page.id AND pk.status='open'
      LEFT JOIN users pu ON pu.id=pk.created_by
    ORDER BY (page.status='open') DESC, CASE WHEN page.status='open' THEN page.started_at ELSE page.closed_at END DESC, page.id DESC`)
    .all<Omit<TaskRow, 'selection'> & { selection: string | null }>({ org: args.organization, branchId: args.branchId, shown: args.shown, closedShown: args.closedShown })
  return rows.map((row) => ({ ...row, total: Number(row.total), done: Number(row.done), selection: parseSelection(row.selection) }))
}

function parseSelection(value: string | null | undefined): unknown {
  if (value == null) return null
  try { return JSON.parse(value) } catch { return null }
}

/** One task's identity and product ids (one statement). Null when the id is not a task of the organization. */
export async function readTaskProducts(db: D1Compat, args: { organization: number | null; taskId: string }): Promise<{ branchId: number; status: 'open' | 'closed'; startedAt: string; productIds: number[] } | null> {
  const rows = await db.prepare(`SELECT s.branch_id AS branch_id, s.status AS status, s.started_at AS started_at, i.product_id AS product_id FROM ${S} s JOIN ${I} i ON i.session_id=s.id
    WHERE s.id=@id AND s.organization_id IS @org AND ${kindOf('s')}='${TASK_MEMBERSHIP}' ORDER BY i.product_id`).all<{ branch_id: number; status: 'open' | 'closed'; started_at: string; product_id: number }>({ id: args.taskId, org: args.organization })
  if (!rows.length) return null
  return { branchId: Number(rows[0].branch_id), status: rows[0].status, startedAt: rows[0].started_at, productIds: rows.map((row) => Number(row.product_id)) }
}
