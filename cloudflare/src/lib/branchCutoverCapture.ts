import type { D1Compat } from './db'

export type CutoverStatement = { sql: string; params?: Record<string, unknown> }
export type CutoverIdentity = { sourceBranchId: number; targetBranchId: number }
export type CaptureCursor = { index: number; key: number; rows: number; sourceQuantityText: string; sourceLotQuantityText: string; movingProducts: number }
export class BranchCutoverCapabilityError extends Error {
  readonly code = 'branch_cutover_parent_capability'
  constructor(readonly capability: string) { super(capability) }
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
export const UNCLASSIFIED_JSON_FAMILIES = ['action_history', 'undo_snapshots', 'pending_actions', 'stock_session_operations'] as const
const snapshots: Record<string, Array<[string, string]>> = {
  sales: [['branch_name', 'branch_id']], returns: [['branch_name', 'branch_id']], inventory_movements: [['branch_name', 'branch_id']],
  stock_row_moves: [['branch_name', 'branch_id']], stock_session_members: [['branch_name', 'branch_id']],
  stock_transfers: [['from_branch_name', 'from_branch_id'], ['to_branch_name', 'to_branch_id']],
}
const tables = [...new Set([...BRANCH_SCALAR_REFERENCES.map(([table]) => table), 'products', ...UNCLASSIFIED_JSON_FAMILIES])].sort()
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
const schemaSql = `SELECT json_group_array(json_array(name,cid,column_name,type,pk,definition)) AS value FROM (
  SELECT m.name,p.cid,p.name AS column_name,p.type,p.pk,CASE WHEN p.cid=0 THEN m.sql END AS definition FROM sqlite_master m JOIN pragma_table_info(m.name) p
  WHERE m.type='table' AND (m.name IN (SELECT value FROM json_each(@tables)) OR p.name='branch_id' OR p.name GLOB '*_branch_id') ORDER BY m.name,p.cid)`
export type CaptureSchema = { value: string; digest: string; columns: Record<string, string[]>; capabilities: Array<{ code: string; detail: string }> }
export async function readCutoverCaptureSchema(db: D1Compat): Promise<CaptureSchema> {
  const result = await db.prepare(schemaSql).get<{ value: string }>({ tables: JSON.stringify(tables) })
  if (!result || cutoverBytes(result.value) > 262144) throw new BranchCutoverCapabilityError('capture_schema_too_large')
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
const affectedProducts = `SELECT product_id FROM branch_stock WHERE branch_id IN (@source,@target)
  UNION SELECT b.variant_product_id FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id WHERE s.branch_id IN (@source,@target)`
const streamTables = tables.filter(table => table !== 'branch_cutovers' && !UNCLASSIFIED_JSON_FAMILIES.some(family => family === table))
export const captureRegistryDigest = (): Promise<string> => cutoverDigest(JSON.stringify({ version: 2, references: BRANCH_SCALAR_REFERENCES,
  streamTables, snapshots, blankCharacters, opaqueFamilies: UNCLASSIFIED_JSON_FAMILIES, control: 'branch_cutovers:owned_identity', ordering: 'stable-rowid', metadata: 'products-and-original-batches', scalarEncoding: 'sqlite-type-and-roundtrip-real-v1' }))
function predicate(table: string): string {
  if (table === 'products') return `id IN (${affectedProducts})`
  if (table === 'branches') return 'id IN (@source,@target) OR successor_branch_id IN (@source,@target)'
  const references = BRANCH_SCALAR_REFERENCES.filter(([name]) => name === table).map(([, column]) => `${quote(column)} IN (@source,@target)`)
  if (table === 'branch_stock') references.push(`product_id IN (${affectedProducts})`)
  if (table === 'product_batches') references.push('id IN (SELECT batch_id FROM branch_batch_stock WHERE branch_id IN (@source,@target))')
  return '(' + references.join(' OR ') + ')'
}
export function initialCaptureCursor(): CaptureCursor { return { index: 0, key: 0, rows: 0, sourceQuantityText: '0', sourceLotQuantityText: '0', movingProducts: 0 } }
export function parseCaptureCursor(text: string): CaptureCursor {
  if (text === '{}') return initialCaptureCursor()
  const cursor = JSON.parse(text) as CaptureCursor
  if (Object.keys(cursor).sort().join(',') !== Object.keys(initialCaptureCursor()).sort().join(',')
    || ![cursor.index, cursor.key, cursor.rows, cursor.movingProducts].every(n => Number.isSafeInteger(n) && n >= 0)
    || cursor.index > streamTables.length) throw new BranchCutoverCapabilityError('capture_cursor_invalid')
  decimal(cursor.sourceQuantityText); decimal(cursor.sourceLotQuantityText)
  return cursor
}
function decimal(value: unknown): bigint {
  let text = String(value)
  if (typeof value === 'number' && /e-\d+$/i.test(text) && value > 0) text = value.toFixed(12)
  if (!/^(0|[1-9][0-9]{0,30})(\.[0-9]{1,12})?$/.test(text) || (typeof value === 'number' && (!Number.isFinite(value) || Number(text) !== value))) {
    throw new BranchCutoverCapabilityError('quantity_requires_exact_nonnegative_decimal')
  }
  const [whole, fraction = ''] = text.split('.'); return BigInt(whole) * 1000000000000n + BigInt(fraction.padEnd(12, '0'))
}
function addQuantity(left: string, right: unknown): string {
  const value = decimal(left) + decimal(right); const fraction = String(value % 1000000000000n).padStart(12, '0').replace(/0+$/, '')
  return String(value / 1000000000000n) + (fraction ? '.' + fraction : '')
}
export async function readUnclassifiedCutoverFamilies(db: D1Compat): Promise<Array<{ family: string; rows: number; support: 'unclassified' }>> {
  const result = []
  for (const family of UNCLASSIFIED_JSON_FAMILIES) {
    const count = await db.prepare(`SELECT count(*) AS n FROM ${quote(family)}`).get<{ n: number }>()
    if (count?.n) result.push({ family, rows: count.n, support: 'unclassified' as const })
  }
  return result
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
export async function readCutoverCapturePage(db: D1Compat, schema: CaptureSchema, identity: CutoverIdentity, cursor: CaptureCursor,
  digest: string, pageSize: number, names: Record<number, string>, materialize: boolean): Promise<{ cursor: CaptureCursor; digest: string; records: number; statements: CutoverStatement[]; done: boolean }> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 32) throw new BranchCutoverCapabilityError('capture_page_size_invalid')
  if (cursor.index === streamTables.length) return { cursor, digest, records: 0, statements: [], done: true }
  const table = streamTables[cursor.index]; const columns = schema.columns[table]
  if (!columns) throw new BranchCutoverCapabilityError('capture_table_required:' + table)
  const json = `json_object(${columns.map(column => {
    const field = quote(column)
    return `'${column.replaceAll("'", "''")}',json_array(typeof(${field}),CASE typeof(${field}) WHEN 'integer' THEN CAST(${field} AS TEXT) WHEN 'real' THEN printf('%!.17g',${field}) WHEN 'text' THEN ${field} END)`
  }).join(',')})`
  const pageFrom = `FROM ${quote(table)} WHERE (${predicate(table)}) AND rowid>@after ORDER BY rowid LIMIT @limit`
  const rowsSql = `SELECT rowid AS k,${json} AS j ${pageFrom}`
  const fingerprintSql = `SELECT json_group_array(json_array(k,j)) FROM (${rowsSql})`
  const realColumns = columns.map((column, index) => `CASE WHEN typeof(${quote(column)})='real' THEN ${quote(column)} END AS r${index}`)
  const sidecarSql = `WITH capture_rows AS MATERIALIZED (SELECT rowid AS k,${json} AS j,${realColumns.join(',')} ${pageFrom}),
    capture_fingerprint AS (SELECT json_group_array(json_array(k,j)) AS value FROM (SELECT k,j FROM capture_rows ORDER BY k))
    SELECT 0 AS row_kind,NULL AS k,CASE WHEN length(CAST(value AS BLOB))<=262144 THEN value END AS value,${columns.map((_, index) => `NULL AS r${index}`).join(',')} FROM capture_fingerprint
    UNION ALL SELECT 1 AS row_kind,k,NULL AS value,${columns.map((_, index) => `r${index}`).join(',')} FROM capture_rows ORDER BY row_kind,k`
  const params = { source: identity.sourceBranchId, target: identity.targetBranchId, after: cursor.key, limit: pageSize }
  if (cursor.key === 0) {
    const invalid = await db.prepare(`SELECT count(*) AS n FROM ${quote(table)} WHERE (${predicate(table)}) AND rowid<=0`).get<{ n: number }>(params)
    if (invalid?.n) throw new BranchCutoverCapabilityError('capture_nonpositive_rowid:' + table)
  }
  const page = await db.prepare(sidecarSql).all<Record<string, unknown>>(params)
  const header = page[0]
  if (!header || typeof header.value !== 'string' || cutoverBytes(JSON.stringify(page)) > 262144) throw new BranchCutoverCapabilityError('capture_page_bytes_exceeded')
  const rows = JSON.parse(header.value) as Array<[number, string]>
  if (header.row_kind !== 0 || header.k !== null || columns.some((_, index) => header[`r${index}`] !== null)
    || page.length !== rows.length + 1 || rows.length > pageSize) throw new BranchCutoverCapabilityError('capture_scalar_sidecar_invalid')
  const next = { ...cursor }; const statements = [cutoverAssert(`(${fingerprintSql})=@fingerprint`, { ...params, fingerprint: header.value }),
    cutoverAssert(`NOT EXISTS(SELECT 1 FROM ${quote(table)} WHERE (${predicate(table)}) AND rowid<=0)`, params)]
  for (const [rowIndex, [key, raw]] of rows.entries()) {
    if (!Number.isSafeInteger(key) || key <= next.key || cutoverBytes(raw) > 65536) throw new BranchCutoverCapabilityError('capture_row_invalid_or_oversize')
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
    if (Number(record.branch_id) === identity.sourceBranchId && table === 'branch_stock') {
      next.sourceQuantityText = addQuantity(next.sourceQuantityText, record.quantity)
      if (Number(record.quantity) > 0) next.movingProducts++
    }
    if (Number(record.branch_id) === identity.sourceBranchId && table === 'branch_batch_stock') next.sourceLotQuantityText = addQuantity(next.sourceLotQuantityText, record.quantity)
  }
  if (materialize && rows.length) for (const [field, branchField] of snapshots[table] || []) statements.push({
    sql: `UPDATE ${quote(table)} SET ${quote(field)}=CASE ${quote(branchField)} WHEN @source THEN @sourceName WHEN @target THEN @targetName END
      WHERE rowid IN (SELECT value FROM json_each(@keys)) AND ${quote(branchField)} IN (@source,@target) AND trim(coalesce(${quote(field)},''),@blankCharacters)=''`,
    params: { ...params, blankCharacters, sourceName: names[identity.sourceBranchId], targetName: names[identity.targetBranchId], keys: JSON.stringify(rows.map(([key]) => key)) },
  })
  let records = rows.length
  if (rows.length < pageSize) { digest = await cutoverDigest(JSON.stringify([digest, table, 'end'])); next.index++; next.key = 0; records++ }
  return { cursor: next, digest, records, statements, done: next.index === streamTables.length }
}
export function missingSnapshotGuards(identity: CutoverIdentity): CutoverStatement[] {
  return Object.entries(snapshots).flatMap(([table, fields]) => fields.map(([field, branch]) => cutoverAssert(
    `NOT EXISTS(SELECT 1 FROM ${quote(table)} WHERE ${quote(branch)} IN (@source,@target) AND trim(coalesce(${quote(field)},''),@blankCharacters)='')`,
    { source: identity.sourceBranchId, target: identity.targetBranchId, blankCharacters },
  )))
}
export function unclassifiedFamilyGuards(): CutoverStatement[] {
  return UNCLASSIFIED_JSON_FAMILIES.map(family => cutoverAssert(`NOT EXISTS(SELECT 1 FROM ${quote(family)})`))
}
