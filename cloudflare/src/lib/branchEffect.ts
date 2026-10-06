// Where a STOCK EFFECT lands when the branch a record points at has been
// retired (CUTOVER-LC; design G12-HISTORY-UNDO-DESIGN section 3).
//
// A return of a sale made at Shop, recorded after Shop became "Old Shop"
// (inactive, successor LC Store), must put the units into LC Store -- never into
// the retired branch, where nothing could sell them and no screen would show
// them (the 0109 residue pattern). The sale itself is never relabelled: it keeps
// branch_id and the label "Shop"; only the NEW rows this operation writes carry
// the branch the stock really went to, plus the label the operation was
// addressed to.
//
// While every branch is active this is the identity function and callers add no
// statement, parameter or column (the golden statement lists stay byte-equal).
import type { D1Compat } from './db'
import { branchRole, resolveActiveSuccessor } from './branchRoles'
import { selectInChunks } from './sqlBinding'

export const BRANCH_RETIRED_NO_SUCCESSOR_CODE = 'branch_retired_no_successor'
export const BRANCH_RETIRED_NO_SUCCESSOR_ERROR = 'This record belongs to a retired branch with no active successor. Nothing was changed.'

export class BranchRetiredNoSuccessorError extends Error {
  readonly code = BRANCH_RETIRED_NO_SUCCESSOR_CODE
  readonly statusCode = 409
  constructor() {
    super(BRANCH_RETIRED_NO_SUCCESSOR_ERROR)
    this.name = 'BranchRetiredNoSuccessorError'
  }
}

export type BranchEffectRow = {
  id: number
  name: string | null
  role?: unknown
  is_active?: unknown
  successor_branch_id?: number | null
}

export const BRANCH_EFFECT_COLUMNS_SQL = 'id, name, role, is_active, successor_branch_id'

export type BranchEffect = {
  // The branch the record pointed at ("Shop") and the one the stock lands on.
  addressedBranchId: number
  addressedName: string | null
  effectBranchId: number
  effectName: string | null
  // False for an active branch, and for an id the directory does not know
  // (callers keep whatever they did before for those).
  redirected: boolean
}

const unchanged = (id: number, name: string | null): BranchEffect => ({
  addressedBranchId: id, addressedName: name, effectBranchId: id, effectName: name, redirected: false,
})

/**
 * The branch a stock effect recorded against `recordedBranchId` must land on.
 * An active branch answers itself. A retired branch answers its active
 * successor; one that has none (a missing row, a cycle, an inactive or
 * ambiguous successor) throws BranchRetiredNoSuccessorError so the caller
 * refuses before writing anything. `sells` also requires the landing branch to
 * be able to carry a sale line (a replacement hand-out is a sale): a retired
 * branch whose successor cannot sell refuses.
 */
export function resolveBranchEffect(rows: readonly BranchEffectRow[], recordedBranchId: unknown, options: { sells?: boolean } = {}): BranchEffect {
  const id = Number(recordedBranchId)
  const recorded = Number.isSafeInteger(id) && id > 0 ? rows.find((row) => Number(row.id) === id) : undefined
  if (!recorded) return unchanged(id, null)
  const name = recorded.name ?? null
  // An active branch is its own effect branch. Whether it may carry a sale line is the caller's existing
  // refusal (WAREHOUSE_NOT_SELLABLE); only a RETIRED branch is redirected here.
  if (Number(recorded.is_active ?? 1) === 1) return unchanged(id, name)
  const resolved = resolveActiveSuccessor(rows, id)
  const landing = resolved ? rows.find((row) => Number(row.id) === resolved.effectBranchId) : undefined
  if (!resolved || !landing || (options.sells && branchRole(landing) !== 'shop')) throw new BranchRetiredNoSuccessorError()
  return { addressedBranchId: id, addressedName: name, effectBranchId: resolved.effectBranchId, effectName: landing.name ?? null, redirected: resolved.viaSuccessor }
}

export type BranchEffectGuard = { addressed: number; effect: number; sells: 0 | 1 }

export function branchEffectGuards(effects: readonly BranchEffect[], sells: boolean): BranchEffectGuard[] {
  const seen = new Map<string, BranchEffectGuard>()
  for (const effect of effects) {
    if (!effect.redirected) continue
    const key = `${effect.addressedBranchId}>${effect.effectBranchId}`
    const previous = seen.get(key)
    seen.set(key, { addressed: effect.addressedBranchId, effect: effect.effectBranchId, sells: previous?.sells === 1 || sells ? 1 : 0 })
  }
  return [...seen.values()]
}

/**
 * The in-batch twin of resolveBranchEffect for every redirected pair: the
 * landing branch is still active with no successor of its own (and still sells
 * when the pair says so), and the addressed branch is still retired and still
 * points at it. The chain cannot change between planning and the commit.
 * `json` is the SQL expression holding the JSON array of BranchEffectGuard.
 */
export function branchEffectGuardPredicate(json: string): string {
  return `NOT EXISTS(SELECT 1 FROM json_each(${json}) j WHERE NOT (
    EXISTS(SELECT 1 FROM branches e WHERE e.id=json_extract(j.value,'$.effect')
      AND COALESCE(e.is_active,1)=1 AND e.successor_branch_id IS NULL
      AND (json_extract(j.value,'$.sells')=0 OR lower(trim(COALESCE(e.role,e.name)))='shop'))
    AND EXISTS(SELECT 1 FROM branches a WHERE a.id=json_extract(j.value,'$.addressed')
      AND a.is_active=0 AND a.successor_branch_id=json_extract(j.value,'$.effect'))))`
}

/**
 * Lots the branch consolidation folded into another lot at `branchId`:
 * { folded lot id -> surviving lot id }. The consolidation merges lots received
 * on the same business day into one, so a sale allocated from a folded lot must
 * give its units back to the SURVIVOR (same product, same received date) --
 * restocking the folded id would re-create the second same-date lot the merge
 * removed. Read from the consolidation's own audit rows; empty when none ran.
 *
 * A lot the consolidation never touched is also answered: one that was fully sold at the retired branch before the
 * cutover (nothing to move, so it was not folded) and has no stock at `branchId` is given back to the lot of the SAME
 * product, business day (UTC+7), expiry and supplier that holds stock there now -- restocking its own id would re-create
 * the same-date split the merge removed. A lot that holds stock at `branchId` is never remapped.
 */
export async function foldedLotSurvivors(db: D1Compat, branchId: number, batchIds: readonly number[]): Promise<Map<number, number>> {
  const survivors = new Map<number, number>()
  const ids = [...new Set(batchIds.map(Number))].filter((id) => Number.isSafeInteger(id) && id > 0)
  // One bound parameter is the branch id; the lot ids are chunked under the D1 100-parameter limit.
  const rows = await selectInChunks(ids, 1, (chunk) => db.prepare(`SELECT CAST(f.value AS INTEGER) AS folded, CAST(json_extract(a.details,'$.survivorBatchId') AS INTEGER) AS survivor
      FROM audit_logs a, json_each(a.details,'$.foldedBatchIds') f
      WHERE a.action='branch_cutover_lot_fold' AND json_valid(a.details)
        AND CAST(json_extract(a.details,'$.branchId') AS INTEGER)=?
        AND CAST(f.value AS INTEGER) IN (${chunk.map(() => '?').join(',')})`)
    .all<{ folded: number; survivor: number }>([branchId, ...chunk]))
  for (const row of rows) {
    const folded = Number(row.folded)
    const survivor = Number(row.survivor)
    if (Number.isSafeInteger(folded) && Number.isSafeInteger(survivor) && survivor > 0) survivors.set(folded, survivor)
  }
  const unmapped = ids.filter((id) => !survivors.has(id))
  if (unmapped.length) {
    const supplierKey = (alias: string) => `CASE WHEN typeof(${alias}.supplier_id) IN ('integer','real') AND ${alias}.supplier_id=CAST(${alias}.supplier_id AS INTEGER) THEN 'id:'||CAST(${alias}.supplier_id AS INTEGER) WHEN trim(coalesce(${alias}.supplier_name,''))<>'' THEN 'name:'||lower(trim(${alias}.supplier_name)) ELSE '' END`
    // Two reserved parameters (the branch id, twice); the lot ids are chunked under the D1 100-parameter limit.
    const sameDay = await selectInChunks(unmapped, 2, (chunk) => db.prepare(`SELECT x.id AS lot, MIN(c.id) AS survivor
      FROM product_batches x
      JOIN product_batches c ON c.variant_product_id=x.variant_product_id AND c.id<>x.id
      JOIN branch_batch_stock s ON s.batch_id=c.id AND s.branch_id=? AND s.quantity>0
      WHERE x.id IN (${chunk.map(() => '?').join(',')})
        AND NOT EXISTS(SELECT 1 FROM branch_batch_stock h WHERE h.batch_id=x.id AND h.branch_id=? AND h.quantity>0)
        AND date(x.received_at,'+7 hours') IS NOT NULL AND date(c.received_at,'+7 hours')=date(x.received_at,'+7 hours')
        AND COALESCE(x.expiry_date,'')=COALESCE(c.expiry_date,'')
        AND ${supplierKey('x')}=${supplierKey('c')}
      GROUP BY x.id`).all<{ lot: number; survivor: number }>([branchId, ...chunk, branchId]))
    for (const row of sameDay) {
      const lot = Number(row.lot)
      const survivor = Number(row.survivor)
      if (Number.isSafeInteger(lot) && Number.isSafeInteger(survivor) && survivor > 0) survivors.set(lot, survivor)
    }
  }
  return survivors
}

/** Every branch row (active and retired), with the columns the effect rule reads. A handful of rows. */
export async function readBranchDirectory(db: D1Compat): Promise<BranchEffectRow[]> {
  return db.prepare(`SELECT ${BRANCH_EFFECT_COLUMNS_SQL} FROM branches`).all<BranchEffectRow>()
}

/**
 * Resolves the effect branch of every branch id one request touches, remembering each redirect so the commit
 * batch can re-prove them all. While every branch is active nothing is ever redirected: `effect()` answers the
 * recorded id and `guards()` is empty, so callers add no statement, parameter or column.
 */
export class BranchEffectResolver {
  private readonly seen = new Map<string, BranchEffect>()
  constructor(readonly directory: readonly BranchEffectRow[]) {}

  /** The effect of a recorded branch id (null in, null out). Throws BranchRetiredNoSuccessorError when none. */
  effect(recordedBranchId: unknown, options: { sells?: boolean } = {}): BranchEffect | null {
    const id = Number(recordedBranchId)
    if (!Number.isSafeInteger(id) || id <= 0) return null
    const key = `${id}:${options.sells ? 1 : 0}`
    let found = this.seen.get(key)
    if (!found) { found = resolveBranchEffect(this.directory, id, options); this.seen.set(key, found) }
    return found
  }

  /** The branch id a stock effect recorded against `recordedBranchId` lands on (the id itself when not retired). */
  effectId(recordedBranchId: unknown, options: { sells?: boolean } = {}): number | null {
    const found = this.effect(recordedBranchId, options)
    return found ? found.effectBranchId : null
  }

  /** True when any id resolved so far was redirected to a successor. */
  get redirected(): boolean { return [...this.seen.values()].some((effect) => effect.redirected) }

  /** The in-batch guards for every redirect resolved so far (`sells` when any lookup needed a selling landing). */
  guards(): BranchEffectGuard[] {
    const guards = new Map<string, BranchEffectGuard>()
    for (const [key, effect] of this.seen) {
      if (!effect.redirected) continue
      const sells = key.endsWith(':1')
      const pair = `${effect.addressedBranchId}>${effect.effectBranchId}`
      const previous = guards.get(pair)
      guards.set(pair, { addressed: effect.addressedBranchId, effect: effect.effectBranchId, sells: previous?.sells === 1 || sells ? 1 : 0 })
    }
    return [...guards.values()]
  }
}

/**
 * The in-batch twin of the resolver for routes that guard with `INSERT INTO sale_bulk_guards(guard_value)`:
 * null when nothing was redirected (no statement is added, so the batch stays byte-equal to the old one).
 */
export function effectGuardStatement(guards: readonly BranchEffectGuard[]): { sql: string; params: Record<string, unknown> } | null {
  if (!guards.length) return null
  return {
    sql: `INSERT INTO sale_bulk_guards(guard_value) SELECT CASE WHEN (${branchEffectGuardPredicate('@effectsJson')}) THEN 1 ELSE 0 END`,
    params: { effectsJson: JSON.stringify(guards) },
  }
}

export const BRANCH_RETIRED_DAMAGED_CODE = 'branch_retired_damaged_stock'
export const BRANCH_RETIRED_DAMAGED_ERROR = 'This record has damaged-stock units at a retired branch. They cannot be moved or recreated there. Nothing was changed.'

/** A damaged (held) lot belongs to the branch it was created at and is never moved by a consolidation. */
export class BranchRetiredDamagedError extends Error {
  readonly code = BRANCH_RETIRED_DAMAGED_CODE
  readonly statusCode = 409
  constructor() {
    super(BRANCH_RETIRED_DAMAGED_ERROR)
    this.name = 'BranchRetiredDamagedError'
  }
}

type RedirectableAllocation = { batch_id: number; branch_id?: number | null }
export type RedirectableStockItem = {
  branch_id: number | null
  batch_id?: number | null
  damaged_lot_id?: number | null
  allocations?: RedirectableAllocation[]
  effect?: { branchName: string | null; addressedName: string | null }
}

/**
 * Points the stock-moving lines of a sale at the branch their effect lands on, in memory, before a planner
 * reads them: a line recorded at a retired branch (Old Shop) gets the active successor as its branch, its lots
 * become the lots that exist there now (a lot the consolidation folded is its survivor), and `effect` carries
 * the label the movement rows must name. Lines whose branch is active are not touched, so while every branch is
 * active this changes nothing at all. The sale itself and its stored lines keep their own branch.
 *
 * `moves` says which lines really move stock for the transition at hand: a line that moves nothing never
 * blocks on a retired branch. A damaged-lot line at a retired branch refuses (BranchRetiredDamagedError): held
 * units are never moved by a consolidation and must not be recreated at a retired branch.
 * `saleLabel` is the label the sale was made under, preferred for the lines of that sale's own branch.
 */
export async function redirectStockItems<T extends RedirectableStockItem>(
  db: D1Compat, resolver: BranchEffectResolver, items: readonly T[],
  options: { moves: (item: T) => boolean; saleBranchId?: number | null; saleLabel?: string | null; sells?: boolean },
): Promise<void> {
  const redirected: Array<{ item: T; effect: BranchEffect }> = []
  for (const item of items) {
    if (!item.branch_id || !options.moves(item)) continue
    const effect = resolver.effect(item.branch_id, { sells: options.sells !== false })
    if (!effect?.redirected) continue
    if (item.damaged_lot_id) throw new BranchRetiredDamagedError()
    redirected.push({ item, effect })
  }
  if (!redirected.length) return
  const byEffect = new Map<number, number[]>()
  for (const { item, effect } of redirected) {
    const ids = byEffect.get(effect.effectBranchId) || []
    if (item.batch_id) ids.push(Number(item.batch_id))
    for (const alloc of item.allocations || []) ids.push(Number(alloc.batch_id))
    byEffect.set(effect.effectBranchId, ids)
  }
  const survivors = new Map<number, Map<number, number>>()
  for (const [effectId, ids] of byEffect) survivors.set(effectId, await foldedLotSurvivors(db, effectId, ids))
  for (const { item, effect } of redirected) {
    const folded = survivors.get(effect.effectBranchId)!
    const label = options.saleBranchId != null && Number(options.saleBranchId) === effect.addressedBranchId && options.saleLabel
      ? options.saleLabel : effect.addressedName
    if (item.batch_id) item.batch_id = folded.get(Number(item.batch_id)) ?? item.batch_id
    for (const alloc of item.allocations || []) {
      alloc.batch_id = folded.get(Number(alloc.batch_id)) ?? alloc.batch_id
      if (alloc.branch_id != null) alloc.branch_id = effect.effectBranchId
    }
    item.branch_id = effect.effectBranchId
    item.effect = { branchName: effect.effectName, addressedName: label ?? null }
  }
}

export const BRANCH_RETIRED_ADDITION_CODE = 'branch_retired_sale_addition'
export const BRANCH_RETIRED_ADDITION_ERROR = 'This sale was made at a branch that has since been retired, so items cannot be added to it. Record a new sale instead. Nothing was changed.'

/**
 * One line of a sale at a retired branch, plus its allocation rows: the same redirect as `redirectStockItems`
 * for the single-line amendment routes. Returns whether the line was redirected (false when its branch is active).
 */
export async function redirectSaleLine(
  db: D1Compat, resolver: BranchEffectResolver,
  line: { branch_id: number | null; effect?: { branchName: string | null; addressedName: string | null } },
  allocations: RedirectableAllocation[],
  options: { saleBranchId?: number | null; saleLabel?: string | null },
): Promise<boolean> {
  const probe: RedirectableStockItem = { branch_id: line.branch_id, allocations }
  await redirectStockItems(db, resolver, [probe], { moves: () => true, ...options })
  if (!probe.effect) return false
  line.branch_id = probe.branch_id
  line.effect = probe.effect
  return true
}
