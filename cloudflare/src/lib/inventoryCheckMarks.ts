import { waitingKeySql, waitingLineSql } from './inventoryCheckSessions'
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
// `decides` marks the events that can change a pending session's waiting set: every writer of an approval's line set, status, applied lines, superseded lines or line decisions records an event whose after_json carries `approval`
// (the registry test of test-inventory-check-marks-pure.cjs keeps that true). A malformed after_json counts as deciding, so the read over-walks and never under-walks. Both columns come from the row the page already reads.
export const EVENTS_SQL = `SELECT id, session_id, product_id, actor_id, request_id, created_at, action,
  CASE WHEN json_valid(after_json) THEN json_extract(after_json,'$.approval') IS NOT NULL ELSE 1 END AS decides
  FROM inventory_check_events WHERE id > @since ORDER BY id LIMIT @pageEvents`
// The sessions the events name: which are in the viewer's scope, whether each holds an approval, and the lines of that approval that wait. A waiting line is decided by its approval row alone (the keys of the stored line set, the rule of waitingKeySql), so the
// rows read follow the sessions the events name, never the waiting backlog. The line set is walked only for the first @walk sessions of the list (those with an event that can change it, see setChanging); the others are named for scope and nothing else. `legacy` is a pending approval with no stored line set (a Worker older than the column wrote it): its list comes from LEGACY_WAITING_SQL, and `items` (its member count, from its create event) is what the walk charges for it.
export const SCOPE_WAITING_SQL = `SELECT s.id AS id, a.session_id IS NOT NULL AS approval, a.status AS status, a.lines AS lines,
       a.line_set_json IS NULL AND a.session_id IS NOT NULL AND a.status = 'pending' AS legacy,
       CASE WHEN a.line_set_json IS NULL AND a.session_id IS NOT NULL AND a.status = 'pending' THEN
         (SELECT CAST(json_extract(e.after_json,'$.members') AS INTEGER) FROM inventory_check_events e WHERE e.session_id = s.id ORDER BY e.id LIMIT 1)
       END AS items,
       CASE WHEN a.status = 'pending' AND a.line_set_json IS NOT NULL AND w.key < @walk THEN
         (SELECT json_group_array(CAST(j.key AS INTEGER)) FROM json_each(a.line_set_json) j WHERE ${waitingKeySql('a', 'j.key')})
       ELSE '[]' END AS waiting
FROM json_each(@sessions) w CROSS JOIN inventory_check_sessions s ON s.id = w.value
LEFT JOIN inventory_check_approvals a ON a.session_id = s.id
WHERE s.organization_id IS @organization AND s.branch_id = @branchId`
// The waiting lines of pending approvals that hold no stored line set, by the engine's own rule over the session's items.
export const LEGACY_WAITING_SQL = `SELECT a.session_id AS session_id, i.product_id AS product_id
FROM json_each(@legacy) w CROSS JOIN inventory_check_approvals a ON a.session_id = w.value
JOIN inventory_check_items i ON i.session_id = a.session_id AND i.branch_id = a.branch_id
WHERE ${waitingLineSql('a', 'i')}`
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

// The snapshot page as the route stores it (Cache API) and as the device receives it. The Worker's own JavaScript for a page (the hash, the body) lives here so the CPU probe (scripts/ic-marks-js-cpu-pure.cjs) times the code the route runs.
export type MarksPage = { page: number; buckets: number[]; cursor: number; tag: string; hash: string; rows: Mark[] }
export type PageBody = { format: number; page: number; buckets: number[]; cursor: number; tag: string; top: number; hash: string; unchanged?: true; rows?: Mark[] }
/** The body sent for a page: the head, and the rows unless the device already holds this hash. `top` is the newest event the request saw. */
export function pageBody(served: MarksPage, top: number, have: string): PageBody {
  const head = { format: MARKS_FORMAT, page: served.page, buckets: served.buckets, cursor: served.cursor, tag: served.tag, top, hash: served.hash }
  return have !== '' && have === served.hash ? { ...head, unchanged: true } : { ...head, rows: served.rows }
}
/** A page just read: the entry to store (it carries its hash) and the body to send. A page's rows are the database at its cursor, so the hash covers them. */
export function buildPageAnswer(page: number, built: PageBuild, have: string): { stored: MarksPage; body: PageBody } {
  const stored: MarksPage = { page, buckets: built.buckets, cursor: built.cursor, tag: built.tag, hash: fnv1a32(`${MARKS_FORMAT}:${page}:${built.cursor}:${built.tag}:${JSON.stringify(built.rows)}`), rows: built.rows }
  return { stored, body: pageBody(stored, built.cursor, have) }
}

export type Limits = { pageEvents: number; touchedMax: number }
// An event can change a pending session's waiting set only when it is the submission (`create`) or records an approval write (`decides`). A plain observe (a submission line, a count) cannot; close and resume change the session row, never its approval
// (a submission is created closed and refused both, tasks and issues hold no approval), so they are not listed.
const setChanging = (row: Row): boolean => row.action === 'create' || Number(row.decides) === 1
export type WaitingEntry = [sessionId: string, productIds: number[]]
export type ChangesAnswer = { rebuild: true; top: number } | { cursor: number; tag: string; top: number; more: boolean; exact: boolean; marks: Mark[]; waiting: WaitingEntry[] }
/**
 * The change feed: the marks of the products the events after `since` touched, and for every session those events name the full list of its waiting products, as states. Waiting is computed for every viewer; the route strips it for a viewer who may not see it.
 * The walk charges a product once (its first event) and a legacy session its items once; waiting ids cost nothing. The last batch ends with TOP_SQL: the answer is exact only when no event was written since call 1, else `more` is true and the device does not publish.
 */
export async function readChanges(db: Db, scope: MarksScope, since: number, tag: string, limits: Limits): Promise<ChangesAnswer> {
  const [top, at, events] = await db.batch([{ sql: TOP_SQL }, { sql: AT_SQL, params: { since } }, { sql: EVENTS_SQL, params: { since, pageEvents: limits.pageEvents } }])
  const topId = eventOf(rowsOf(top))?.id ?? 0
  const atEvent = eventOf(rowsOf(at))
  if (since > topId || (since > 0 && (!atEvent || eventTag(atEvent) !== tag))) return { rebuild: true, top: topId }
  const list = rowsOf(events)
  if (!list.length) return { cursor: since, tag, top: topId, more: false, exact: true, marks: [], waiting: [] }
  const named = list.some((row) => row.product_id != null)
  const changing = new Set(list.filter(setChanging).map((row) => String(row.session_id)))
  const sessionIds = [...new Set(list.map((row) => String(row.session_id)))]
  const second = await db.batch([{ sql: SCOPE_WAITING_SQL, params: { ...scope, sessions: JSON.stringify([...sessionIds.filter((sid) => changing.has(sid)), ...sessionIds.filter((sid) => !changing.has(sid))]), walk: changing.size } }, ...(named ? [] : [{ sql: TOP_SQL }])])
  const scoped = new Map(rowsOf(second[0]).map((row): [string, Row] => [String(row.id), row]))
  const touched = new Set<number>(), charged = new Set<string>(), walked = new Set<string>()
  let last: Row | null = null, stopped = false, legacyCost = 0
  for (const row of list) {
    const sid = String(row.session_id), known = scoped.get(sid)
    const productId = known && row.product_id != null ? Number(row.product_id) : null
    const freshSession = known !== undefined && Number(known.legacy) === 1 && changing.has(sid) && !charged.has(sid)
    const items = freshSession ? known.items == null ? limits.touchedMax : Number(known.items) : 0
    const freshProduct = productId !== null && !touched.has(productId) ? 1 : 0
    if (touched.size + legacyCost + freshProduct + items > limits.touchedMax && last !== null) { stopped = true; break }
    if (productId !== null) touched.add(productId)
    if (freshSession) { charged.add(sid); legacyCost += items }
    if (setChanging(row)) walked.add(sid)
    last = row
  }
  const cursorRow = last as Row
  const ids = [...touched]
  const legacyIds = [...charged]
  let closing = second
  if (named || legacyIds.length) {
    closing = await db.batch([
      ...(ids.length ? [{ sql: MARKS_BY_IDS_SQL, params: { ...scope, ids: JSON.stringify(ids) } }] : []),
      ...(legacyIds.length ? [{ sql: LEGACY_WAITING_SQL, params: { legacy: JSON.stringify(legacyIds) } }] : []),
      { sql: TOP_SQL }])
  }
  const lastTop = eventOf(rowsOf(closing[closing.length - 1]))?.id ?? 0
  const exact = lastTop === topId
  const marksAt = ids.length ? 0 : -1
  const legacyAt = legacyIds.length ? (marksAt === 0 ? 1 : 0) : -1
  const legacyLists = new Map<string, number[]>()
  for (const row of legacyAt >= 0 ? rowsOf(closing[legacyAt]) : []) { const k = String(row.session_id); legacyLists.set(k, [...legacyLists.get(k) ?? [], Number(row.product_id)]) }
  const waiting: WaitingEntry[] = []
  for (const sid of walked) {
    const known = scoped.get(sid)
    if (!known || Number(known.approval) !== 1) continue
    waiting.push([sid, Number(known.legacy) === 1 ? legacyLists.get(sid) ?? [] : (JSON.parse(String(known.waiting)) as unknown[]).map(Number)])
  }
  return { cursor: Number(cursorRow.id), tag: eventTag({ id: Number(cursorRow.id), actor_id: Number(cursorRow.actor_id), request_id: String(cursorRow.request_id), created_at: String(cursorRow.created_at) }),
    top: topId, more: stopped || list.length >= limits.pageEvents || !exact, exact, marks: marksAt >= 0 ? markRows(rowsOf(closing[marksAt])) : [], waiting }
}

export type PendingAnswer = { cursor: number; tag: string; sessions: WaitingEntry[]; next: { afterAt: string; afterId: string } | null }
/** The cold build of the waiting lists: the next pending approvals of the branch, newest first, each with its waiting products (a claimed approval whose open lines all landed answers an empty list). */
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
  return { cursor: event?.id ?? 0, tag: event ? eventTag(event) : '', sessions: page.map((o): WaitingEntry => [o.id, bySession.get(o.id)!]), next: order.length > pageApprovals ? { afterAt: page[page.length - 1].at, afterId: page[page.length - 1].id } : null }
}
