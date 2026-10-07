import type { D1Compat } from './db'
import { CUTOVER_HISTORY_RULES, checkCutoverHistoryRow, emptyHistoryTally, historyOpenPageSql, tallyCutoverHistory, type HistoryTally } from './branchCutoverHistory'

export type CutoverStatement = { sql: string; params?: Record<string, unknown> }
export type CutoverIdentity = { sourceBranchId: number; targetBranchId: number }
/** Registry v3 cursor. Hashes are additive multiset hashes (see ledgerHashAdd); quantities are exact decimal text. */
export type CaptureCursor = {
  index: number; key: number; rows: number
  sourceQuantityText: string; sourceLotQuantityText: string; movingProducts: number
  targetQuantityText: string; targetLotQuantityText: string; stockHash: string; lotHash: string
  history: HistoryTally; families: string
  /** The row limit that last worked for the stream table in progress (0 = none yet): a page that was too big once is too big
   *  on every later invocation, so the halving is remembered instead of repeated (and re-charged) each time. Reset per table. */
  pageLimit: number
}
export class BranchCutoverCapabilityError extends Error {
  readonly code = 'branch_cutover_parent_capability'
  constructor(readonly capability: string, message?: string) { super(message ?? capability) }
}
export const BRANCH_SCALAR_REFERENCES = [
  ['branch_batch_stock', 'branch_id'], ['branch_cutovers', 'source_branch_id'], ['branch_cutovers', 'target_branch_id'],
  ['branch_stock', 'branch_id'], ['branches', 'successor_branch_id'], ['damaged_stock_lots', 'branch_id'], ['fees', 'branch_id'],
  ['inventory_movements', 'branch_id'], ['legacy_inventory_effects', 'branch_id'], ['legacy_sale_item_corrections', 'branch_id'],
  ['product_batches', 'received_branch_id'], ['return_item_batch_allocations', 'branch_id'], ['return_items', 'branch_id'],
  ['return_replacement_items', 'branch_id'], ['returns', 'branch_id'], ['rfid_events', 'branch_id'], ['rfid_scan_sessions', 'branch_id'],
  ['rfid_session_items', 'expected_branch_id'], ['rfid_session_items', 'seen_branch_id'], ['rfid_tags', 'branch_id'],
  ['sale_item_batch_allocations', 'branch_id'], ['sale_items', 'branch_id'], ['sale_not_paid_repair_0173', 'branch_id'], ['sales', 'branch_id'],
  ['shift_sessions', 'branch_id'], ['stock_row_moves', 'branch_id'], ['stock_session_members', 'branch_id'],
  ['stock_transfers', 'from_branch_id'], ['stock_transfers', 'to_branch_id'], ['supplier_invoices', 'branch_id'],
  ['transfer_operation_members', 'destination_branch_id'], ['transfer_operation_members', 'source_branch_id'],
] as const
/** JSON payload families (design §1.2 c). action_history is streamed and classified; the other three are fenced by count:max. */
export const CUTOVER_JSON_FAMILIES = ['action_history', 'undo_snapshots', 'pending_actions', 'stock_session_operations'] as const
/** Tables the history classification reads; part of the schema digest so a mid-run DDL change refuses. */
const HISTORY_LINK_TABLES = ['audit_logs', 'product_remove_operations', 'return_bulk_members', 'return_bulk_operations', 'sale_bulk_members',
  'sale_bulk_operations', 'stock_lot_adjustment_operations', 'transfer_operation_receipts'] as const
// Event-time labels the snapshot pass fills (never overwrites) before any rename.
const snapshots: Record<string, Array<[string, string]>> = {
  sales: [['branch_name', 'branch_id']], returns: [['branch_name', 'branch_id']], inventory_movements: [['branch_name', 'branch_id']],
  stock_row_moves: [['branch_name', 'branch_id']], stock_session_members: [['branch_name', 'branch_id']],
  stock_transfers: [['from_branch_name', 'from_branch_id'], ['to_branch_name', 'to_branch_id']],
  fees: [['branch_name', 'branch_id']], product_batches: [['received_branch_name', 'received_branch_id']], shift_sessions: [['branch_name', 'branch_id']],
}
const referenceTables = [...new Set([...BRANCH_SCALAR_REFERENCES.map(([table]) => table), 'products'])].sort()
const tables = [...new Set([...referenceTables, ...CUTOVER_JSON_FAMILIES, ...HISTORY_LINK_TABLES])].sort()
const streamTables = referenceTables.filter(table => table !== 'branch_cutovers')
export const HISTORY_STREAM = 'history_open'
/** Ordered capture streams: the 28 scalar-reference tables, then the virtual open-history stream. */
export const CAPTURE_STREAMS: readonly string[] = Object.freeze([...streamTables, HISTORY_STREAM])
export const CAPTURE_PAGE_CAP = 256
const HISTORY_PAGE_CAP = 64
const PAGE_BYTES = 262144
const ROW_BYTES = 65536
const quote = (name: string): string => '"' + name.replaceAll('"', '""') + '"'
const encoder = new TextEncoder()
const blankCharacters = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
export const cutoverBytes = (text: string): number => encoder.encode(text).length
export async function cutoverDigest(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('')
}
export const cutoverAssert = (condition: string, params: Record<string, unknown> = {}): CutoverStatement => ({
  sql: `SELECT CASE WHEN (${condition}) THEN 1 ELSE json_extract('[1]','$[branch_cutover_parent_conflict]') END`, params,
})
// D1 refuses pragma_table_info on its internal _cf_* tables (SQLITE_AUTH, found on local workerd D1): they are skipped
// before the join, and so are SQLite's own sqlite_* tables. Neither can hold a branch reference.
const schemaSql = `SELECT json_group_array(json_array(name,cid,column_name,type,pk,definition)) AS value FROM (
  SELECT m.name,p.cid,p.name AS column_name,p.type,p.pk,CASE WHEN p.cid=0 THEN m.sql END AS definition FROM sqlite_master m JOIN pragma_table_info(m.name) p
  WHERE m.type='table' AND m.name NOT LIKE '!_cf!_%' ESCAPE '!' AND m.name NOT LIKE 'sqlite!_%' ESCAPE '!'
    AND (m.name IN (SELECT value FROM json_each(@tables)) OR p.name='branch_id' OR p.name GLOB '*_branch_id') ORDER BY m.name,p.cid)`
export type CaptureSchema = { value: string; digest: string; columns: Record<string, string[]>; capabilities: Array<{ code: string; detail: string }> }
export async function readCutoverCaptureSchema(db: D1Compat): Promise<CaptureSchema> {
  const result = await db.prepare(schemaSql).get<{ value: string }>({ tables: JSON.stringify(tables) })
  if (!result || cutoverBytes(result.value) > PAGE_BYTES) throw new BranchCutoverCapabilityError('capture_schema_too_large')
  const entries = JSON.parse(result.value) as Array<[string, number, string, string, number, string]>
  const columns: Record<string, string[]> = {}; const capabilities: CaptureSchema['capabilities'] = []
  for (const [table, , column, , , definition] of entries) {
    if (/WITHOUT\s+ROWID/i.test(definition || '')) throw new BranchCutoverCapabilityError('capture_requires_stable_rowid:' + table)
    if (/^(rowid|_rowid_|oid)$/i.test(column)) capabilities.push({ code: 'capture_shadowed_rowid', detail: table })
    if ((column === 'branch_id' || column.endsWith('_branch_id')) && !BRANCH_SCALAR_REFERENCES.some(([name, field]) => name === table && field === column)) {
      capabilities.push({ code: 'unclassified_scalar_reference', detail: `${table}.${column}` })
    }
    ;(columns[table] ||= []).push(column)
  }
  for (const table of tables) if (!columns[table]) capabilities.push({ code: 'capture_table_required', detail: table })
  for (const [table, column] of BRANCH_SCALAR_REFERENCES) if (!columns[table]?.includes(column)) capabilities.push({ code: 'capture_reference_required', detail: `${table}.${column}` })
  for (const [table, fields] of Object.entries(snapshots)) for (const [column] of fields) {
    if (!columns[table]?.includes(column)) capabilities.push({ code: 'historical_label_schema_required', detail: `${table}.${column}` })
  }
  return { value: result.value, digest: await cutoverDigest(result.value), columns, capabilities }
}
export function captureSchemaGuard(schema: CaptureSchema): CutoverStatement {
  return cutoverAssert(`(${schemaSql.replace(' AS value', '')})=@schema`, { tables: JSON.stringify(tables), schema: schema.value })
}
// The registry is a constant of this build: digest it once per isolate.
let registryDigest: Promise<string> | null = null
export const captureRegistryDigest = (): Promise<string> => registryDigest ||= computeRegistryDigest()
const computeRegistryDigest = (): Promise<string> => cutoverDigest(JSON.stringify({ version: 3, references: BRANCH_SCALAR_REFERENCES,
  streams: CAPTURE_STREAMS, schemaTables: tables, snapshots, blankCharacters, families: CUTOVER_JSON_FAMILIES, historyRules: CUTOVER_HISTORY_RULES,
  historySql: historyOpenPageSql(), control: 'branch_cutovers:owned_identity', ordering: 'stable-rowid', metadata: 'products-and-original-batches',
  scalarEncoding: 'sqlite-type-and-roundtrip-real-v1', pageCap: CAPTURE_PAGE_CAP, ledgerHash: 'sha256-120bit-weight-mod-2^127-1-v1' }))
// The unary plus keeps SQLite on the rowid scan (no branch-index seek followed by
// a temp B-tree sort), so every page reads its rows once (design §5.2 index trap).
function predicate(table: string): string {
  const lotsOf = (product: string) => `EXISTS(SELECT 1 FROM product_batches cb CROSS JOIN branch_batch_stock cs ON cs.batch_id=cb.id AND cs.branch_id IN (@source,@target) WHERE cb.variant_product_id=${product})`
  if (table === 'products') return `EXISTS(SELECT 1 FROM branch_stock cx WHERE cx.product_id="products".id AND cx.branch_id IN (@source,@target)) OR ${lotsOf('"products".id')}`
  if (table === 'branches') return 'id IN (@source,@target) OR successor_branch_id IN (@source,@target)'
  const references = BRANCH_SCALAR_REFERENCES.filter(([name]) => name === table).map(([, column]) => `+${quote(column)} IN (@source,@target)`)
  if (table === 'branch_stock') references.push(`EXISTS(SELECT 1 FROM branch_stock cx WHERE cx.product_id="branch_stock".product_id AND cx.branch_id IN (@source,@target))`, lotsOf('"branch_stock".product_id'))
  if (table === 'product_batches') references.push('EXISTS(SELECT 1 FROM branch_batch_stock cx WHERE cx.batch_id="product_batches".id AND cx.branch_id IN (@source,@target))')
  return '(' + references.join(' OR ') + ')'
}
/** Exposed for the query-plan pin: the page SQL of one stream table (rowid order, bounded). */
export function capturePageFromSql(table: string): string {
  return `FROM ${quote(table)} WHERE (${predicate(table)}) AND rowid>@after ORDER BY rowid LIMIT @limit`
}
export function initialCaptureCursor(): CaptureCursor {
  return { index: 0, key: 0, rows: 0, sourceQuantityText: '0', sourceLotQuantityText: '0', movingProducts: 0,
    targetQuantityText: '0', targetLotQuantityText: '0', stockHash: '0', lotHash: '0', history: emptyHistoryTally(), families: '', pageLimit: 0 }
}
const cursorKeys = Object.keys(initialCaptureCursor()).sort().join(',')
export function parseCaptureCursor(text: string): CaptureCursor {
  if (text === '{}') return initialCaptureCursor()
  const cursor = JSON.parse(text) as CaptureCursor
  if (Object.keys(cursor).sort().join(',') !== cursorKeys
    || ![cursor.index, cursor.key, cursor.rows, cursor.movingProducts].every(n => Number.isSafeInteger(n) && n >= 0)
    || !Number.isSafeInteger(cursor.pageLimit) || cursor.pageLimit < 0 || cursor.pageLimit > CAPTURE_PAGE_CAP
    || cursor.index > CAPTURE_STREAMS.length || typeof cursor.families !== 'string' || cursor.families.length > 512
    || !/^[0-9a-f]{1,32}$/.test(cursor.stockHash) || !/^[0-9a-f]{1,32}$/.test(cursor.lotHash)) throw new BranchCutoverCapabilityError('capture_cursor_invalid')
  const history = cursor.history
  if (!history || typeof history !== 'object' || Object.keys(history).sort().join(',') !== 'byApplier,close,digest,leave,maxId,open'
    || ![history.open, history.leave, history.close, history.maxId].every(n => Number.isSafeInteger(n) && n >= 0)
    || history.open !== history.leave + history.close || !/^([0-9a-f]{64})?$/.test(history.digest)
    || !history.byApplier || typeof history.byApplier !== 'object' || Array.isArray(history.byApplier)) throw new BranchCutoverCapabilityError('capture_cursor_invalid')
  let leave = 0, close = 0
  for (const [applier, counts] of Object.entries(history.byApplier)) {
    if (!Object.hasOwn(CUTOVER_HISTORY_RULES, applier) || !Array.isArray(counts) || counts.length !== 2
      || !counts.every(n => Number.isSafeInteger(n) && n >= 0)) throw new BranchCutoverCapabilityError('capture_cursor_invalid')
    leave += counts[0]; close += counts[1]
  }
  if (leave !== history.leave || close !== history.close) throw new BranchCutoverCapabilityError('capture_cursor_invalid')
  for (const text of [cursor.sourceQuantityText, cursor.sourceLotQuantityText, cursor.targetQuantityText, cursor.targetLotQuantityText]) decimal(text)
  return cursor
}
const SCALE = 1000000000000n
export function decimal(value: unknown): bigint {
  let text = String(value)
  if (typeof value === 'number' && /e-\d+$/i.test(text) && value > 0) text = value.toFixed(12)
  if (!/^(0|[1-9][0-9]{0,30})(\.[0-9]{1,12})?$/.test(text) || (typeof value === 'number' && (!Number.isFinite(value) || Number(text) !== value))) {
    throw new BranchCutoverCapabilityError('quantity_requires_exact_nonnegative_decimal')
  }
  const [whole, fraction = ''] = text.split('.'); return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0'))
}
export function decimalText(value: bigint): string {
  if (value < 0n) throw new BranchCutoverCapabilityError('quantity_requires_exact_nonnegative_decimal')
  const fraction = String(value % SCALE).padStart(12, '0').replace(/0+$/, '')
  return String(value / SCALE) + (fraction ? '.' + fraction : '')
}
export function addQuantity(left: string, right: unknown): string { return decimalText(decimal(left) + decimal(right)) }
// Additive multiset hash over (kind, id) -> quantity. A per-id conservation
// failure changes the sum unless two independent 120-bit weights collide.
const MODULUS = (1n << 127n) - 1n
const weights = new Map<string, bigint>()
async function ledgerWeight(kind: string, id: unknown): Promise<bigint> {
  const key = kind + ':' + String(id)
  let weight = weights.get(key)
  if (weight === undefined) {
    if (weights.size > 50000) weights.clear()
    weight = BigInt('0x' + (await cutoverDigest('branch-cutover-ledger-v1:' + key)).slice(0, 30)); weights.set(key, weight)
  }
  return weight
}
export async function ledgerHashAdd(hash: string, kind: 'product' | 'batch', id: unknown, quantity: unknown, sign: 1 | -1 = 1): Promise<string> {
  if (!/^[0-9a-f]{1,32}$/.test(hash) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new BranchCutoverCapabilityError('ledger_hash_input_invalid')
  const term = (await ledgerWeight(kind, Number(id)) * decimal(quantity)) % MODULUS
  return ((BigInt('0x' + hash) + (sign === 1 ? term : MODULUS - term)) % MODULUS).toString(16)
}
/** Same-instant family state: count and max rowid of the three opaque families, open review rows, and the history high-water mark. */
export const FAMILY_STATE_SQL = `SELECT (SELECT count(*)||':'||coalesce(max(rowid),0) FROM undo_snapshots) AS undo_snapshots,
  (SELECT count(*)||':'||coalesce(max(rowid),0) FROM stock_session_operations) AS stock_session_operations,
  (SELECT count(*)||':'||coalesce(max(rowid),0) FROM pending_actions) AS pending_actions,
  (SELECT count(*) FROM pending_actions WHERE status='open') AS pending_open,
  (SELECT coalesce(max(rowid),0) FROM action_history) AS action_history_max`
export type FamilyState = { undo_snapshots: string; stock_session_operations: string; pending_actions: string; pending_open: number; action_history_max: number }
export async function readCutoverFamilies(db: D1Compat): Promise<FamilyState> {
  const state = await db.prepare(FAMILY_STATE_SQL).get<FamilyState>()
  if (!state || ![state.undo_snapshots, state.stock_session_operations, state.pending_actions].every(v => typeof v === 'string' && /^\d+:\d+$/.test(v))
    || !Number.isSafeInteger(state.pending_open) || !Number.isSafeInteger(state.action_history_max)) throw new BranchCutoverCapabilityError('family_state_invalid')
  return { undo_snapshots: state.undo_snapshots, stock_session_operations: state.stock_session_operations, pending_actions: state.pending_actions,
    pending_open: state.pending_open, action_history_max: state.action_history_max }
}
export const familyStateText = (state: FamilyState): string => JSON.stringify([state.undo_snapshots, state.stock_session_operations, state.pending_actions, state.action_history_max])
/** Page guard: the high-water marks only (O(1) reads); boundaries add the counts. Any insert or approval aborts the page. */
export function familyGuards(state: FamilyState, withCounts: boolean): CutoverStatement[] {
  const max = (value: string) => value.split(':')[1]
  const guards = [cutoverAssert(`(SELECT coalesce(max(rowid),0) FROM undo_snapshots)=@undo AND (SELECT coalesce(max(rowid),0) FROM stock_session_operations)=@session
      AND (SELECT coalesce(max(rowid),0) FROM pending_actions)=@pending AND (SELECT coalesce(max(rowid),0) FROM action_history)=@history
      AND NOT EXISTS(SELECT 1 FROM pending_actions WHERE status='open')`,
  { undo: Number(max(state.undo_snapshots)), session: Number(max(state.stock_session_operations)), pending: Number(max(state.pending_actions)), history: state.action_history_max })]
  if (withCounts) guards.push(cutoverAssert(`(SELECT count(*)||':'||coalesce(max(rowid),0) FROM undo_snapshots)=@undo
      AND (SELECT count(*)||':'||coalesce(max(rowid),0) FROM stock_session_operations)=@session
      AND (SELECT count(*)||':'||coalesce(max(rowid),0) FROM pending_actions)=@pending`,
  { undo: state.undo_snapshots, session: state.stock_session_operations, pending: state.pending_actions }))
  return guards
}
function capturedScalar(value: unknown, rawReal: unknown): string | number | null {
  if (Array.isArray(value) && value.length === 2) {
    const [type, text] = value
    if (type !== 'real' && rawReal !== null) throw new BranchCutoverCapabilityError('capture_scalar_sidecar_invalid')
    if (type === 'null' && text === null) return null
    if (typeof text === 'string') {
      if (type === 'text') return text
      if (type === 'integer' && /^-?(0|[1-9][0-9]*)$/.test(text)) return text
      if (type === 'real' && text.trim() && typeof rawReal === 'number' && Number.isFinite(rawReal) && Object.is(Number(text), rawReal)) return rawReal
    }
  }
  throw new BranchCutoverCapabilityError('capture_scalar_unsupported')
}
type PageResult = { cursor: CaptureCursor; digest: string; records: number; statements: CutoverStatement[]; done: boolean }
/** SQLITE_TOOBIG as D1 and a local SQLite word it ("string or blob too big", "string too long"). */
export const isStringTooBig = (error: unknown): boolean => /too big|SQLITE_TOOBIG|string too long|string or blob/i.test(String((error as { message?: unknown } | null)?.message ?? error))
/** Reads one bounded page. A page over the byte cap halves its row limit and re-reads (never splits silently). */
export async function readCutoverCapturePage(db: D1Compat, schema: CaptureSchema, identity: CutoverIdentity, cursor: CaptureCursor,
  digest: string, pageSize: number, names: Record<number, string>, materialize: boolean): Promise<PageResult> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > CAPTURE_PAGE_CAP) throw new BranchCutoverCapabilityError('capture_page_size_invalid')
  if (cursor.index === CAPTURE_STREAMS.length) return { cursor, digest, records: 0, statements: [], done: true }
  if (CAPTURE_STREAMS[cursor.index] === HISTORY_STREAM) return readHistoryPage(db, identity, cursor, digest, Math.min(pageSize, HISTORY_PAGE_CAP))
  const table = CAPTURE_STREAMS[cursor.index]; const columns = schema.columns[table]
  if (!columns) throw new BranchCutoverCapabilityError('capture_table_required:' + table)
  const fields = columns.map(column => {
    const field = quote(column)
    return `'${column.replaceAll("'", "''")}',json_array(typeof(${field}),CASE typeof(${field}) WHEN 'integer' THEN CAST(${field} AS TEXT) WHEN 'real' THEN printf('%!.17g',${field}) WHEN 'text' THEN ${field} END)`
  })
  let json = 'json_object()'
  for (let index = 0; index < fields.length; index += 32) {
    const chunk = `json_object(${fields.slice(index, index + 32).join(',')})`
    json = index === 0 ? chunk : `json_patch(${json},${chunk})`
  }
  const pageFrom = capturePageFromSql(table)
  const rowsSql = `SELECT rowid AS k,${json} AS j ${pageFrom}`
  const fingerprintSql = `SELECT json_group_array(json_array(k,j)) FROM (${rowsSql})`
  const realColumns = columns.map((column, index) => `CASE WHEN typeof(${quote(column)})='real' THEN ${quote(column)} END AS r${index}`)
  const sidecarSql = `WITH capture_rows AS MATERIALIZED (SELECT rowid AS k,${json} AS j,${realColumns.join(',')} ${pageFrom}),
    capture_fingerprint AS (SELECT json_group_array(json_array(k,j)) AS value FROM (SELECT k,j FROM capture_rows ORDER BY k))
    SELECT 0 AS row_kind,NULL AS k,CASE WHEN length(CAST(value AS BLOB))<=${PAGE_BYTES} THEN value END AS value,${columns.map((_, index) => `NULL AS r${index}`).join(',')} FROM capture_fingerprint
    UNION ALL SELECT 1 AS row_kind,k,NULL AS value,${columns.map((_, index) => `r${index}`).join(',')} FROM capture_rows ORDER BY row_kind,k`
  const base = { source: identity.sourceBranchId, target: identity.targetBranchId, after: cursor.key }
  if (cursor.key === 0) {
    const invalid = await db.prepare(`SELECT count(*) AS n FROM ${quote(table)} WHERE (${predicate(table)}) AND rowid<=0`).get<{ n: number }>(base)
    if (invalid?.n) throw new BranchCutoverCapabilityError('capture_nonpositive_rowid:' + table)
  }
  const startLimit = cursor.pageLimit > 0 ? Math.min(pageSize, cursor.pageLimit) : pageSize
  let limit = startLimit; let page: Array<Record<string, unknown>>
  for (;;) {
    try { page = await db.prepare(sidecarSql).all<Record<string, unknown>>({ ...base, limit }) } catch (error) {
      // SQLite refuses to BUILD a string over its limit (D1: 2 MB): json_group_array over wide rows throws before any result
      // exists, so it is a page-size signal like an oversized result, not a failure.
      if (isStringTooBig(error)) {
        if (limit === 1) throw new BranchCutoverCapabilityError('capture_row_too_big')
        limit = Math.ceil(limit / 2); continue
      }
      throw error
    }
    const header = page[0]
    if (header && typeof header.value === 'string' && cutoverBytes(JSON.stringify(page)) <= PAGE_BYTES) break
    if (limit === 1) throw new BranchCutoverCapabilityError('capture_page_bytes_exceeded')
    limit = Math.ceil(limit / 2)
  }
  const params = { ...base, limit }
  const header = page[0] as Record<string, unknown> & { value: string }
  const rows = JSON.parse(header.value) as Array<[number, string]>
  if (header.row_kind !== 0 || header.k !== null || columns.some((_, index) => header[`r${index}`] !== null)
    || page.length !== rows.length + 1 || rows.length > limit) throw new BranchCutoverCapabilityError('capture_scalar_sidecar_invalid')
  const next: CaptureCursor = { ...cursor, pageLimit: limit < pageSize ? limit : 0 }; const statements = [cutoverAssert(`(${fingerprintSql})=@fingerprint`, { ...params, fingerprint: header.value }),
    cutoverAssert(`NOT EXISTS(SELECT 1 FROM ${quote(table)} WHERE (${predicate(table)}) AND rowid<=0)`, params)]
  const { sourceBranchId: source, targetBranchId: target } = identity
  for (const [rowIndex, [key, raw]] of rows.entries()) {
    if (!Number.isSafeInteger(key) || key <= next.key || cutoverBytes(raw) > ROW_BYTES) throw new BranchCutoverCapabilityError('capture_row_invalid_or_oversize')
    const sidecar = page[rowIndex + 1]
    if (sidecar.row_kind !== 1 || sidecar.k !== key || sidecar.value !== null || Object.keys(sidecar).length !== columns.length + 3) throw new BranchCutoverCapabilityError('capture_scalar_sidecar_invalid')
    const encoded = JSON.parse(raw) as Record<string, unknown>
    if (Object.keys(encoded).length !== columns.length) throw new BranchCutoverCapabilityError('capture_scalar_sidecar_invalid')
    const record = Object.fromEntries(columns.map((field, index) => [field, capturedScalar(encoded[field], sidecar[`r${index}`])]))
    for (const [field, branchField] of snapshots[table] || []) {
      const name = names[Number(record[branchField])]
      if (name !== undefined && (record[field] === null || record[field] === undefined || typeof record[field] === 'string' && !(record[field] as string).trim())) encoded[field] = ['text', name]
    }
    digest = await cutoverDigest(JSON.stringify([digest, table, key, encoded]))
    next.key = key; next.rows++
    const branch = Number(record.branch_id)
    if (table === 'branch_stock' && (branch === source || branch === target)) {
      if (branch === source) {
        next.sourceQuantityText = addQuantity(next.sourceQuantityText, record.quantity)
        if (Number(record.quantity) > 0) next.movingProducts++
      } else next.targetQuantityText = addQuantity(next.targetQuantityText, record.quantity)
      next.stockHash = await ledgerHashAdd(next.stockHash, 'product', record.product_id, record.quantity)
    }
    if (table === 'branch_batch_stock' && (branch === source || branch === target)) {
      if (branch === source) next.sourceLotQuantityText = addQuantity(next.sourceLotQuantityText, record.quantity)
      else next.targetLotQuantityText = addQuantity(next.targetLotQuantityText, record.quantity)
      next.lotHash = await ledgerHashAdd(next.lotHash, 'batch', record.batch_id, record.quantity)
    }
  }
  if (materialize && rows.length) for (const [field, branchField] of snapshots[table] || []) statements.push({
    sql: `UPDATE ${quote(table)} SET ${quote(field)}=CASE ${quote(branchField)} WHEN @source THEN @sourceName WHEN @target THEN @targetName END
      WHERE rowid IN (SELECT value FROM json_each(@keys)) AND +${quote(branchField)} IN (@source,@target) AND trim(coalesce(${quote(field)},''),@blankCharacters)=''`,
    params: { ...params, blankCharacters, sourceName: names[source], targetName: names[target], keys: JSON.stringify(rows.map(([key]) => key)) },
  })
  let records = rows.length
  if (rows.length < limit) { digest = await cutoverDigest(JSON.stringify([digest, table, 'end'])); next.index++; next.key = 0; next.pageLimit = 0; records++ }
  return { cursor: next, digest, records, statements, done: next.index === CAPTURE_STREAMS.length }
}
async function readHistoryPage(db: D1Compat, identity: CutoverIdentity, cursor: CaptureCursor, digest: string, pageSize: number): Promise<PageResult> {
  const sql = historyOpenPageSql()
  const fingerprintSql = `SELECT json_group_array(json_array(k,j)) FROM (${sql})`
  const base = { source: identity.sourceBranchId, target: identity.targetBranchId, after: cursor.key }
  let limit = pageSize; let value: string | null = null
  for (;;) {
    const read = await db.prepare(`SELECT CASE WHEN length(CAST(v AS BLOB))<=${PAGE_BYTES} THEN v END AS value FROM (SELECT (${fingerprintSql}) AS v)`)
      .get<{ value: string | null }>({ ...base, limit })
    value = read?.value ?? null
    if (typeof value === 'string') break
    if (limit === 1) throw new BranchCutoverCapabilityError('capture_page_bytes_exceeded')
    limit = Math.ceil(limit / 2)
  }
  const params = { ...base, limit }
  const rows = JSON.parse(value) as Array<[number, string]>
  if (!Array.isArray(rows) || rows.length > limit) throw new BranchCutoverCapabilityError('capture_history_page_invalid')
  const next: CaptureCursor = { ...cursor }
  for (const [key, raw] of rows) {
    if (!Number.isSafeInteger(key) || key <= next.key || typeof raw !== 'string' || cutoverBytes(raw) > ROW_BYTES) throw new BranchCutoverCapabilityError('capture_row_invalid_or_oversize')
    const { row, decision } = checkCutoverHistoryRow(raw, { source: identity.sourceBranchId, target: identity.targetBranchId })
    if (row.id !== key) throw new BranchCutoverCapabilityError('capture_history_page_invalid')
    next.history = tallyCutoverHistory(next.history, row, decision)
    next.history.digest = await cutoverDigest(JSON.stringify([next.history.digest, row.id, row.applier, decision]))
    digest = await cutoverDigest(JSON.stringify([digest, HISTORY_STREAM, key, JSON.parse(raw)]))
    next.key = key; next.rows++
  }
  const statements = [cutoverAssert(`(${fingerprintSql})=@fingerprint`, { ...params, fingerprint: value })]
  let records = rows.length
  if (rows.length < limit) { digest = await cutoverDigest(JSON.stringify([digest, HISTORY_STREAM, 'end'])); next.index++; next.key = 0; records++ }
  return { cursor: next, digest, records, statements, done: next.index === CAPTURE_STREAMS.length }
}
export function missingSnapshotGuards(identity: CutoverIdentity): CutoverStatement[] {
  return Object.entries(snapshots).flatMap(([table, fields]) => fields.map(([field, branch]) => cutoverAssert(
    `NOT EXISTS(SELECT 1 FROM ${quote(table)} WHERE ${quote(branch)} IN (@source,@target) AND trim(coalesce(${quote(field)},''),@blankCharacters)='')`,
    { source: identity.sourceBranchId, target: identity.targetBranchId, blankCharacters },
  )))
}
