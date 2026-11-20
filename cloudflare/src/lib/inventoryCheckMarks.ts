import { waitingLineSql } from './inventoryCheckSessions'
import { PRODUCT_ID_BUCKETS_SQL } from './productIdBuckets'

// The count marks (read switch ic_marks, contract docs/contracts/inventory-check-marks-20261121.md): what a device holds so it can show status chips, filters and
// "Last checked" sections without asking the server for them. A mark is the LATEST count of a product at a branch: its time `t` (epoch milliseconds) and `s` (1 OK, 2 Differs).
// The server computes every mark by ONE rule (markOf); the device never folds events, it replaces the entries a changes answer names.
export const MARKS_FORMAT = 1

// The tag of an event names its identity, so a database restored to an older copy (the same ids, other events) is told apart from the one a device read.
export function fnv1a32(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
export type EventIdentity = { id: number; actor_id: number; request_id: string; created_at: string }
export const eventTag = (e: EventIdentity): string => fnv1a32(`${e.id}|${e.actor_id}|${e.request_id}|${e.created_at}`)

// The latest count of a product at @branchId, in the order of the overlay's COUNT_ENTRIES_SQL exactly (newest updated_at, then session id), inside the viewer's organisation
// (an item whose branch differs from its session's is never read). Answers the item's rowid.
const markOf = (pid: string): string => `(SELECT x.rowid FROM inventory_check_items x INDEXED BY inventory_check_items_product_latest
    CROSS JOIN inventory_check_sessions sx ON sx.id = x.session_id
    WHERE x.product_id = ${pid} AND x.branch_id = @branchId AND x.state IN ('done','issue')
      AND sx.organization_id IS @organization AND sx.branch_id = x.branch_id
    ORDER BY x.updated_at DESC, x.session_id DESC LIMIT 1)`
const T = (col: string): string => `CAST(round((julianday(${col}) - 2440587.5) * 86400000) AS INTEGER)`

// Every product id of the page range, active or not (a product counted while inactive and reactivated has its mark: C5).
export const SNAPSHOT_PAGE_SQL = `SELECT p.id AS id, ${T('i.updated_at')} AS t, CASE i.state WHEN 'issue' THEN 2 ELSE 1 END AS s
  FROM products p JOIN inventory_check_items i ON i.rowid = ${markOf('p.id')}
  WHERE p.id >= @lo AND p.id < @hi ORDER BY p.id`
// The same pick for touched ids; a product with no count answers s = 0 (remove the entry).
export const MARKS_BY_IDS_SQL = `SELECT CAST(w.value AS INTEGER) AS id, ${T('i.updated_at')} AS t, CASE WHEN i.rowid IS NULL THEN 0 WHEN i.state = 'issue' THEN 2 ELSE 1 END AS s
  FROM json_each(@ids) w LEFT JOIN inventory_check_items i ON i.rowid = ${markOf('w.value')}`
export const TOP_SQL = 'SELECT id, actor_id, request_id, created_at FROM inventory_check_events ORDER BY id DESC LIMIT 1'
export const AT_SQL = 'SELECT id, actor_id, request_id, created_at FROM inventory_check_events WHERE id = @since'
export const EVENTS_SQL = 'SELECT id, session_id, product_id, actor_id, request_id, created_at FROM inventory_check_events WHERE id > @since ORDER BY id LIMIT @pageEvents'
export const SCOPE_SQL = `SELECT s.id AS id, EXISTS (SELECT 1 FROM inventory_check_approvals a WHERE a.session_id = s.id) AS approval
  FROM inventory_check_sessions s WHERE s.id IN (SELECT value FROM json_each(@sessions)) AND s.organization_id IS @organization AND s.branch_id = @branchId`
export const SESSION_PRODUCTS_SQL = 'SELECT DISTINCT session_id, product_id FROM inventory_check_items WHERE session_id IN (SELECT value FROM json_each(@sessions))'
// Which touched products wait (the overlay's rule, copied: scripts/test-inventory-check-marks-pure.cjs pins that the two texts are equal).
export const PENDING_LINES_SQL = `SELECT DISTINCT i.product_id AS product_id, a.session_id AS session_id FROM inventory_check_approvals a JOIN inventory_check_items i ON i.session_id = a.session_id
  WHERE a.organization_id IS @organization AND i.branch_id = @branchId AND i.product_id IN (SELECT value FROM json_each(@ids)) AND ${waitingLineSql('a', 'i')}`
// The waiting set, built once per device: the lines of the next pending approvals of the branch (newest first, keyset), with the approval's position so the caller can name the next page.
export const PENDING_PAGE_SQL = `WITH pg AS (SELECT a.session_id AS session_id, a.submitted_at AS submitted_at FROM inventory_check_approvals a INDEXED BY inventory_check_approvals_pending
    WHERE a.organization_id IS @organization AND a.status = 'pending' AND a.branch_id = @branchId
      AND (@afterAt IS NULL OR a.submitted_at < @afterAt OR (a.submitted_at = @afterAt AND a.session_id < @afterId))
    ORDER BY a.submitted_at DESC, a.session_id DESC LIMIT @pageApprovals)
  SELECT pg.session_id AS session_id, pg.submitted_at AS submitted_at, i.product_id AS product_id FROM pg
    JOIN inventory_check_approvals a ON a.session_id = pg.session_id
    LEFT JOIN inventory_check_items i ON i.session_id = a.session_id AND i.branch_id = a.branch_id AND ${waitingLineSql('a', 'i')}
  ORDER BY pg.submitted_at DESC, pg.session_id DESC`

export type Mark = [id: number, t: number, s: number]
type Row = Record<string, unknown>
type Db = { batch(statements: Array<{ sql: string; params?: Record<string, unknown> }>): Promise<Array<{ results?: unknown[] }>> }
export type MarksScope = { organization: number | null; branchId: number }

const rowsOf = (result: { results?: unknown[] } | undefined): Row[] => (result?.results ?? []) as Row[]
const markRows = (rows: Row[]): Mark[] => rows.map((row) => [Number(row.id), Number(row.t), Number(row.s)])
const eventOf = (rows: Row[]): EventIdentity | null => rows.length ? { id: Number(rows[0].id), actor_id: Number(rows[0].actor_id), request_id: String(rows[0].request_id), created_at: String(rows[0].created_at) } : null

export type PageBuild = { cursor: number; tag: string; rows: Mark[]; buckets: number[] }
/** ONE batch: the cursor and the page's rows are read in the same transaction, so the page is exactly the state at its cursor (I5). */
export async function readSnapshotPage(db: Db, scope: MarksScope, page: number, pageIds: number): Promise<PageBuild> {
  const lo = page * pageIds
  const [top, buckets, rows] = await db.batch([
    { sql: TOP_SQL },
    { sql: PRODUCT_ID_BUCKETS_SQL, params: { size: pageIds } },
    { sql: SNAPSHOT_PAGE_SQL, params: { ...scope, lo, hi: lo + pageIds } },
  ])
  const event = eventOf(rowsOf(top))
  return { cursor: event?.id ?? 0, tag: event ? eventTag(event) : '', rows: markRows(rowsOf(rows)), buckets: rowsOf(buckets).map((row) => Number(row.n)) }
}
/** The validation read of a cached page: the newest event and the event at the page's cursor, in one call. */
export async function readTopAndAt(db: Db, since: number): Promise<{ top: number; atTag: string | null }> {
  const [top, at] = await db.batch([{ sql: TOP_SQL }, { sql: AT_SQL, params: { since } }])
  const t = eventOf(rowsOf(top)), a = eventOf(rowsOf(at))
  return { top: t?.id ?? 0, atTag: a ? eventTag(a) : null }
}

export type Limits = { pageEvents: number; touchedMax: number }
export type ChangesAnswer = { rebuild: true; top: number } | { cursor: number; tag: string; top: number; more: boolean; marks: Mark[]; pending?: Array<[number, 0 | 1]> }
/** The change feed (spec section 1): the marks of the products the events after `since` touched, as states. `permitted`: the viewer may see Waiting. */
export async function readChanges(db: Db, scope: MarksScope, since: number, tag: string, limits: Limits, permitted: boolean): Promise<ChangesAnswer> {
  const [top, at, events] = await db.batch([{ sql: TOP_SQL }, { sql: AT_SQL, params: { since } }, { sql: EVENTS_SQL, params: { since, pageEvents: limits.pageEvents } }])
  const topId = eventOf(rowsOf(top))?.id ?? 0
  const atEvent = eventOf(rowsOf(at))
  if (since > topId || (since > 0 && (!atEvent || eventTag(atEvent) !== tag))) return { rebuild: true, top: topId }
  const list = rowsOf(events)
  if (!list.length) return { cursor: since, tag, top: topId, more: false, marks: [], ...(permitted ? { pending: [] } : {}) }
  const sessions = [...new Set(list.map((row) => String(row.session_id)))]
  const nullSessions = [...new Set(list.filter((row) => row.product_id == null).map((row) => String(row.session_id)))]
  const second = await db.batch([{ sql: SCOPE_SQL, params: { ...scope, sessions: JSON.stringify(sessions) } },
    ...(nullSessions.length ? [{ sql: SESSION_PRODUCTS_SQL, params: { sessions: JSON.stringify(nullSessions) } }] : [])])
  const inScope = new Map(rowsOf(second[0]).map((row): [string, boolean] => [String(row.id), Number(row.approval) === 1]))
  const sessionProducts = new Map<string, number[]>()
  for (const row of rowsOf(second[1])) { const k = String(row.session_id); sessionProducts.set(k, [...sessionProducts.get(k) ?? [], Number(row.product_id)]) }
  const touched = new Set<number>()
  let last: Row | null = null, stopped = false
  for (const row of list) {
    const sid = String(row.session_id), approval = inScope.get(sid)
    const add: number[] = approval === undefined ? [] : row.product_id != null ? [Number(row.product_id)] : approval ? sessionProducts.get(sid) ?? [] : []
    const fresh = add.filter((id) => !touched.has(id))
    if (touched.size + fresh.length > limits.touchedMax && last !== null) { stopped = true; break }
    for (const id of fresh) touched.add(id)
    last = row
  }
  const cursorRow = last as Row
  const ids = [...touched]
  const third = ids.length ? await db.batch([{ sql: MARKS_BY_IDS_SQL, params: { ...scope, ids: JSON.stringify(ids) } }, ...(permitted ? [{ sql: PENDING_LINES_SQL, params: { ...scope, ids: JSON.stringify(ids) } }] : [])]) : []
  const waiting = new Set(rowsOf(third[1]).map((row) => Number(row.product_id)))
  return { cursor: Number(cursorRow.id), tag: eventTag({ id: Number(cursorRow.id), actor_id: Number(cursorRow.actor_id), request_id: String(cursorRow.request_id), created_at: String(cursorRow.created_at) }),
    top: topId, more: stopped || list.length >= limits.pageEvents, marks: markRows(rowsOf(third[0])), ...(permitted ? { pending: ids.map((id): [number, 0 | 1] => [id, waiting.has(id) ? 1 : 0]) } : {}) }
}

export type PendingAnswer = { cursor: number; tag: string; ids: number[]; next: { afterAt: string; afterId: string } | null }
export async function readPendingPage(db: Db, scope: MarksScope, after: { afterAt: string; afterId: string } | null, pageApprovals: number): Promise<PendingAnswer> {
  const [top, rows] = await db.batch([{ sql: TOP_SQL }, { sql: PENDING_PAGE_SQL, params: { ...scope, afterAt: after?.afterAt ?? null, afterId: after?.afterId ?? null, pageApprovals: pageApprovals + 1 } }])
  const event = eventOf(rowsOf(top))
  const order: Array<{ id: string; at: string }> = []
  const bySession = new Map<string, number[]>()
  for (const row of rowsOf(rows)) {
    const sid = String(row.session_id)
    if (!bySession.has(sid)) { bySession.set(sid, []); order.push({ id: sid, at: String(row.submitted_at) }) }
    if (row.product_id != null) bySession.get(sid)!.push(Number(row.product_id))
  }
  const page = order.slice(0, pageApprovals)
  const ids = [...new Set(page.flatMap((o) => bySession.get(o.id)!))]
  return { cursor: event?.id ?? 0, tag: event ? eventTag(event) : '', ids, next: order.length > pageApprovals ? { afterAt: page[page.length - 1].at, afterId: page[page.length - 1].id } : null }
}
