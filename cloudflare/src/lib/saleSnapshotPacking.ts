/**
 * Bounded copies of a sale's line pricing snapshots.
 *
 * Every line of a money-v1 sale stores `pricing_snapshot_json`, and each snapshot embeds the WHOLE basket's pool, so a sale's
 * snapshots are O(n^2) bytes (62 lines: 2.6 MB, 200 lines: about 24 MB) while D1 refuses any single string, BLOB or row value
 * above 2,000,000 bytes. The lines themselves stay as they are (one row each, always far below the cap). What must not grow
 * without bound is every COPY made of all lines at once: the mutation receipt's before/after images, the undo payload of an
 * added-items action, the stored response, and the JSON parameters of the guards that prove a basket is unchanged.
 *
 * Two tools, both lossless:
 *   - pack/unpack: a canonical snapshot is stored as {line_key, amounts, receipt_allocation} plus an index into a shared table of
 *     pools and allocation contexts, kept ONCE per copy. A snapshot is packed only when rebuilding it reproduces the original
 *     string byte for byte; anything else (an older shape, another key order) stays the raw string, so nothing is ever altered.
 *     Unpacking is tolerant: a string, a null or a missing field passes through, so a copy made before this module existed reads
 *     exactly as it always did.
 *   - chunking: a statement that compares all lines takes them in groups whose JSON stays under STORED_COPY_CHUNK_BYTES.
 */

export const STORED_COPY_CHUNK_BYTES = 900_000

export type PricingPacks = { version: 1; pools: Array<{ pool: unknown; quantities: unknown }>; contexts: unknown[] }
export type PackedPricingSnapshot = { packed_snapshot: 1; line_key: string; pool: number; context: number; amounts: unknown; receipt_allocation: unknown }

export class PackedSnapshotError extends Error {
  readonly code = 'packed_snapshot_unavailable'
  constructor() { super('A saved pricing snapshot could not be rebuilt.'); this.name = 'PackedSnapshotError' }
}

const SNAPSHOT_KEYS = 'version,line_key,pool,quantities,amounts,allocation_context,receipt_allocation'

/** The exact text serializeSaleItemPricing writes, from its parts. */
export function snapshotText(part: { line_key: string; pool: unknown; quantities: unknown; amounts: unknown; allocation_context: unknown; receipt_allocation: unknown }): string {
  return JSON.stringify({ version: 1, line_key: part.line_key, pool: part.pool, quantities: part.quantities, amounts: part.amounts,
    allocation_context: part.allocation_context, receipt_allocation: part.receipt_allocation })
}

export function isPackedSnapshot(value: unknown): value is PackedPricingSnapshot {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).packed_snapshot === 1
}

export class PackTable {
  readonly packs: PricingPacks = { version: 1, pools: [], contexts: [] }
  private readonly poolIndex = new Map<string, number>()
  private readonly contextIndex = new Map<string, number>()
  poolSlot(pool: unknown, quantities: unknown): number {
    const text = JSON.stringify([pool, quantities])
    let slot = this.poolIndex.get(text)
    if (slot === undefined) { slot = this.packs.pools.length; this.packs.pools.push({ pool, quantities }); this.poolIndex.set(text, slot) }
    return slot
  }
  contextSlot(context: unknown): number {
    const text = JSON.stringify(context)
    let slot = this.contextIndex.get(text)
    if (slot === undefined) { slot = this.packs.contexts.length; this.packs.contexts.push(context); this.contextIndex.set(text, slot) }
    return slot
  }
}

function packOne(json: string, table: PackTable): PackedPricingSnapshot | string {
  let value: Record<string, unknown>
  try { value = JSON.parse(json) } catch { return json }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== SNAPSHOT_KEYS || value.version !== 1
    || typeof value.line_key !== 'string') return json
  const part = value as { line_key: string; pool: unknown; quantities: unknown; amounts: unknown; allocation_context: unknown; receipt_allocation: unknown }
  if (snapshotText(part) !== json) return json
  return { packed_snapshot: 1, line_key: part.line_key, pool: table.poolSlot(part.pool, part.quantities), context: table.contextSlot(part.allocation_context),
    amounts: part.amounts, receipt_allocation: part.receipt_allocation }
}

/** Packs `field` of every row that holds a canonical snapshot string. `table` lets several lists of one copy share their pools. */
export function packSnapshotField<T extends Record<string, unknown>>(rows: readonly T[], field: string, table: PackTable = new PackTable()): { rows: T[]; table: PackTable } {
  return { table, rows: rows.map((row) => {
    const raw = row[field]
    if (typeof raw !== 'string') return row
    const packed = packOne(raw, table)
    return typeof packed === 'string' ? row : { ...row, [field]: packed }
  }) }
}

/** The packs of a copy, or undefined when nothing in it was packed (the copy then has the exact shape it always had). */
export function packsOf(table: PackTable): PricingPacks | undefined {
  return table.packs.pools.length ? table.packs : undefined
}

export function newPackTable(): PackTable { return new PackTable() }

function rebuild(value: PackedPricingSnapshot, packs: PricingPacks | undefined): string {
  const pool = packs?.pools?.[value.pool], context = packs?.contexts?.[value.context]
  if (!pool || context === undefined || typeof value.line_key !== 'string') throw new PackedSnapshotError()
  return snapshotText({ line_key: value.line_key, pool: pool.pool, quantities: pool.quantities, amounts: value.amounts, allocation_context: context, receipt_allocation: value.receipt_allocation })
}

/** Inverse of packSnapshotField. A row whose field is a string, null or absent is returned as it is. */
export function unpackSnapshotField<T extends Record<string, unknown>>(rows: readonly T[] | undefined, field: string, packs: PricingPacks | undefined): T[] | undefined {
  if (!rows) return rows
  return rows.map((row) => {
    const value = row[field]
    return isPackedSnapshot(value) ? { ...row, [field]: rebuild(value, packs) } : row
  })
}

/** A SQL-built stored response (canonicalMutationResponseSql) carries the pools once and a packed core per line. Rebuilds the wire form. */
export function expandStoredSaleResponse(response: Record<string, unknown>): Record<string, unknown> {
  const sale = response?.sale as Record<string, unknown> | undefined
  const packs = sale?.pricing_packs as { allocation_context?: unknown; pools?: Record<string, { pool: unknown; quantities: unknown }> } | undefined
  if (!sale || !packs) return response
  const items = Array.isArray(sale.items) ? sale.items as Array<Record<string, unknown>> : []
  const expanded = items.map((item) => {
    const core = item.pricing_snapshot_packed as { line_key?: string; pool_key?: string; amounts?: unknown; receipt_allocation?: unknown } | undefined
    if (!core) return item
    const pool = core.pool_key === undefined ? undefined : packs.pools?.[core.pool_key]
    if (!pool || typeof core.line_key !== 'string' || packs.allocation_context === undefined) throw new PackedSnapshotError()
    const { pricing_snapshot_packed: _core, ...rest } = item
    return { ...rest, pricing_snapshot_json: snapshotText({ line_key: core.line_key, pool: pool.pool, quantities: pool.quantities, amounts: core.amounts,
      allocation_context: packs.allocation_context, receipt_allocation: core.receipt_allocation }) }
  })
  const { pricing_packs: _packs, ...saleRest } = sale
  return { ...response, sale: { ...saleRest, items: expanded } }
}

/** Groups rows so the JSON of each group stays within `maxBytes` (a single row larger than that still forms its own group). */
export function chunkRowsByJsonBytes<T>(rows: readonly T[], maxBytes: number = STORED_COPY_CHUNK_BYTES): T[][] {
  const encoder = new TextEncoder()
  const chunks: T[][] = []
  let current: T[] = [], bytes = 2
  for (const row of rows) {
    const size = encoder.encode(JSON.stringify(row)).length + 1
    if (current.length && bytes + size > maxBytes) { chunks.push(current); current = []; bytes = 2 }
    current.push(row); bytes += size
  }
  if (current.length) chunks.push(current)
  return chunks
}

/** The undo payload of an added-items action, read back: packed snapshots are rebuilt as the strings they were. A payload written before
 * packing existed has no `pricing_packs` and passes through untouched, so undoing an old action behaves exactly as it always did. */
export function unpackAddItemsReversal<T extends Record<string, unknown>>(payload: T): T {
  const packs = payload?.pricing_packs as PricingPacks | undefined
  if (!packs) return payload
  const { pricing_packs: _packs, ...rest } = payload
  const out: Record<string, unknown> = { ...rest }
  for (const [list, field] of [['lines', 'pricingSnapshotJson'], ['lineMoneyBefore', 'pricing_snapshot_json'], ['lineMoneyAfter', 'pricing_snapshot_json']] as const) {
    if (Array.isArray(rest[list])) out[list] = unpackSnapshotField(rest[list] as Record<string, unknown>[], field, packs)
  }
  return out as T
}
