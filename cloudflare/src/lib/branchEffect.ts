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
//
// The redirect is never silent (owner ruling 6 Oct 2026, CUTOVER-LR): a write
// that reaches a retired branch is refused with `branch_redirect_required`
// (409, carrying the successor and the active branches it may go to) until the
// request names the branch the operator confirmed, in the X-Branch-Redirect
// header. Only then does the effect land there, with the retired branch kept as
// the "addressed to" label.
import type { D1Compat } from './db'
import { branchRole } from './branchRoles'
import { selectInChunks } from './sqlBinding'

export const BRANCH_RETIRED_NO_SUCCESSOR_CODE = 'branch_retired_no_successor'
// The English of the packs' branch_retired_no_successor key (the key is named after the code; pinned by
// scripts/test-cutover-li-pack-parity-pure.cjs). Role-neutral: no branch name.
export const BRANCH_RETIRED_NO_SUCCESSOR_ERROR = 'This record belongs to an inactive branch, and no active branch has taken its place. Nothing was changed.'
export const BRANCH_REDIRECT_REQUIRED_CODE = 'branch_redirect_required'
export const BRANCH_REDIRECT_REQUIRED_ERROR = 'This change is addressed to a disabled branch. Choose the active branch it should go to. Nothing was changed.'
export const BRANCH_REDIRECT_TARGET_INVALID_CODE = 'branch_redirect_target_invalid'
export const BRANCH_REDIRECT_TARGET_INVALID_ERROR = 'The branch chosen for the redirect is not active or cannot take this change. Choose another branch. Nothing was changed.'
// The request header carrying the branch the operator confirmed. A header, not a body field, so one client retry
// covers every writer (JSON, multipart, replay) without touching its payload, idempotency key or dedupe key.
export const BRANCH_REDIRECT_HEADER = 'x-branch-redirect'

export type BranchRedirectOption = { id: number; name: string | null }
// What the client needs to ask the operator: the disabled branch, its successor (the default choice) and every
// active branch the change may go to instead.
export type BranchRedirectDetail = {
  addressed_branch_id: number
  addressed_branch_name: string | null
  successor_branch_id: number | null
  successor_branch_name: string | null
  targets: BranchRedirectOption[]
  requested_target_id: number | null
}

export class BranchRetiredNoSuccessorError extends Error {
  readonly code: string = BRANCH_RETIRED_NO_SUCCESSOR_CODE
  readonly statusCode = 409
  readonly redirect: BranchRedirectDetail | null
  constructor(message = BRANCH_RETIRED_NO_SUCCESSOR_ERROR, redirect: BranchRedirectDetail | null = null) {
    super(message)
    this.name = 'BranchRetiredNoSuccessorError'
    this.redirect = redirect
  }
  /** The 409 body: the message, the code and (for a redirect) what the client shows in its picker. */
  get body(): { error: string; code: string; redirect?: BranchRedirectDetail } {
    return this.redirect ? { error: this.message, code: this.code, redirect: this.redirect } : { error: this.message, code: this.code }
  }
}

/** A write reached a retired branch and the request did not name where to redirect it. Nothing is written. */
export class BranchRedirectRequiredError extends BranchRetiredNoSuccessorError {
  readonly code: string = BRANCH_REDIRECT_REQUIRED_CODE
  constructor(redirect: BranchRedirectDetail) {
    super(BRANCH_REDIRECT_REQUIRED_ERROR, redirect)
    this.name = 'BranchRedirectRequiredError'
  }
}

/** The named redirect branch is not an active branch that can take this change. Nothing is written. */
export class BranchRedirectTargetInvalidError extends BranchRetiredNoSuccessorError {
  readonly code: string = BRANCH_REDIRECT_TARGET_INVALID_CODE
  constructor(redirect: BranchRedirectDetail) {
    super(BRANCH_REDIRECT_TARGET_INVALID_ERROR, redirect)
    this.name = 'BranchRedirectTargetInvalidError'
  }
}

/** The redirect branch a request names (X-Branch-Redirect), or null. Anything but a positive integer is null. */
export function branchRedirectTarget(c: { req: { header(name: string): string | undefined } }): number | null {
  const raw = String(c.req.header(BRANCH_REDIRECT_HEADER) ?? '').trim()
  if (!/^\d{1,15}$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** True only for "a retired branch and no active branch could take the change" (not for a redirect still to confirm). */
export function branchHasNoActiveTarget(error: unknown): boolean {
  return error instanceof BranchRetiredNoSuccessorError && error.code === BRANCH_RETIRED_NO_SUCCESSOR_CODE
}

/** The 409 body for any branch-effect refusal (redirect required, invalid target, no successor, damaged stock). */
export function branchEffectRefusal(error: unknown): { error: string; code: string; redirect?: BranchRedirectDetail } | null {
  if (error instanceof BranchRetiredNoSuccessorError) return error.body
  if (error instanceof BranchRetiredDamagedError) return { error: error.message, code: error.code }
  return null
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

// A branch a redirect may land on: active, never itself retired into another (an active row carries no successor),
// and able to carry a sale line when the change is one.
function redirectTargetOk(row: BranchEffectRow | undefined, sells: boolean): row is BranchEffectRow {
  return !!row && Number(row.is_active ?? 1) === 1 && row.successor_branch_id == null && (!sells || branchRole(row) === 'shop')
}

/**
 * What the client shows when a write reaches a retired branch: the branch, its successor when that is a valid
 * target (the default choice), and every valid target, the successor first. Null when no active branch can take it.
 */
export function branchRedirectDetail(rows: readonly BranchEffectRow[], addressedBranchId: number, options: { sells?: boolean; requestedTargetId?: number | null } = {}): BranchRedirectDetail | null {
  const sells = !!options.sells
  const addressed = rows.find((row) => Number(row.id) === addressedBranchId)
  const targets = rows.filter((row) => redirectTargetOk(row, sells))
  if (!targets.length) return null
  const successorId = addressed?.successor_branch_id == null ? null : Number(addressed.successor_branch_id)
  const successor = successorId == null ? undefined : targets.find((row) => Number(row.id) === successorId)
  const ordered = [...targets].sort((a, b) => (Number(b.id) === successorId ? 1 : 0) - (Number(a.id) === successorId ? 1 : 0)
    || String(a.name ?? '').localeCompare(String(b.name ?? '')) || Number(a.id) - Number(b.id))
  return {
    addressed_branch_id: addressedBranchId,
    addressed_branch_name: addressed?.name ?? null,
    successor_branch_id: successor ? Number(successor.id) : null,
    successor_branch_name: successor ? successor.name ?? null : null,
    targets: ordered.map((row) => ({ id: Number(row.id), name: row.name ?? null })),
    requested_target_id: options.requestedTargetId ?? null,
  }
}

/**
 * The branch a stock effect recorded against `recordedBranchId` must land on.
 * An active branch answers itself, and `target` is never read for it (so while
 * every branch is active nothing changes). A retired branch lands on `target`,
 * the branch the operator confirmed: with no target it throws
 * BranchRedirectRequiredError (carrying the successor and the valid targets),
 * with a target that is not an active branch able to take the change it throws
 * BranchRedirectTargetInvalidError, and when no active branch could take it at
 * all it throws BranchRetiredNoSuccessorError. `sells` requires the landing
 * branch to carry a sale line (a replacement hand-out is a sale).
 */
export function resolveBranchEffect(rows: readonly BranchEffectRow[], recordedBranchId: unknown, options: { sells?: boolean; target?: number | null } = {}): BranchEffect {
  const id = Number(recordedBranchId)
  const recorded = Number.isSafeInteger(id) && id > 0 ? rows.find((row) => Number(row.id) === id) : undefined
  if (!recorded) return unchanged(id, null)
  const name = recorded.name ?? null
  // An active branch is its own effect branch. Whether it may carry a sale line is the caller's existing
  // refusal (WAREHOUSE_NOT_SELLABLE); only a RETIRED branch is redirected here.
  if (Number(recorded.is_active ?? 1) === 1) return unchanged(id, name)
  const target = options.target ?? null
  const detail = branchRedirectDetail(rows, id, { sells: options.sells, requestedTargetId: target })
  if (!detail) throw new BranchRetiredNoSuccessorError()
  if (target == null) throw new BranchRedirectRequiredError(detail)
  const landing = rows.find((row) => Number(row.id) === target)
  if (!redirectTargetOk(landing, !!options.sells)) throw new BranchRedirectTargetInvalidError(detail)
  return { addressedBranchId: id, addressedName: name, effectBranchId: Number(landing.id), effectName: landing.name ?? null, redirected: true }
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
 * confirmed landing branch is still active with no successor of its own (and
 * still sells when the pair says so), and the addressed branch is still
 * retired. Neither can change between planning and the commit.
 * `json` is the SQL expression holding the JSON array of BranchEffectGuard.
 */
export function branchEffectGuardPredicate(json: string): string {
  return `NOT EXISTS(SELECT 1 FROM json_each(${json}) j WHERE NOT (
    EXISTS(SELECT 1 FROM branches e WHERE e.id=json_extract(j.value,'$.effect')
      AND COALESCE(e.is_active,1)=1 AND e.successor_branch_id IS NULL
      AND (json_extract(j.value,'$.sells')=0 OR lower(trim(COALESCE(e.role,e.name)))='shop'))
    AND EXISTS(SELECT 1 FROM branches a WHERE a.id=json_extract(j.value,'$.addressed') AND a.is_active=0)))`
}

// The business day (UTC+7) a lot was received: a plain date as stored, a timestamp without a zone read as UTC, a slash date
// month-first (the order 0077 rewrote). Null for anything else, so an unreadable date never merges.
function lotBusinessDay(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  const valid = (year: number, month: number, day: number) => { const d = new Date(Date.UTC(year, month - 1, day)); return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (slash) {
    const [month, day, year] = [Number(slash[1]), Number(slash[2]), Number(slash[3])]
    return valid(year, month, day) ? `${slash[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null
  }
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (plain) return valid(Number(plain[1]), Number(plain[2]), Number(plain[3])) ? text : null
  const stamp = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?$/.exec(text)
  if (!stamp) return null
  const ms = Date.parse(`${stamp[1]}T${stamp[2]}${stamp[3] ?? 'Z'}`)
  return Number.isFinite(ms) ? new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10) : null
}

// Supplier identity of a lot: the supplier id, else the trimmed lower-case name, else none (the cutover's own key).
function lotSupplierKey(lot: { supplier_id: number | null; supplier_name: string | null }): string {
  if (typeof lot.supplier_id === 'number' && Number.isSafeInteger(lot.supplier_id)) return `id:${lot.supplier_id}`
  const name = typeof lot.supplier_name === 'string' ? lot.supplier_name.trim().toLowerCase() : ''
  return name ? `name:${name}` : ''
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
    type LotFacts = { id: number; product: number; received_at: string | null; expiry_date: string | null; supplier_id: number | null; supplier_name: string | null }
    const columns = 'b.id, b.variant_product_id AS product, b.received_at, b.expiry_date, b.supplier_id, b.supplier_name'
    // The lots asked about that hold no stock at the landing branch. The lot ids are chunked under D1's 100-parameter limit
    // (one parameter is the branch id).
    const asked = await selectInChunks(unmapped, 1, (chunk) => db.prepare(`SELECT ${columns} FROM product_batches b
      WHERE b.id IN (${chunk.map(() => '?').join(',')})
        AND NOT EXISTS(SELECT 1 FROM branch_batch_stock h WHERE h.batch_id=b.id AND h.branch_id=? AND h.quantity>0)`)
      .all<LotFacts>([...chunk, branchId]))
    const products = [...new Set(asked.map((row) => Number(row.product)))].filter((id) => Number.isSafeInteger(id) && id > 0)
    // The lots that hold stock at the landing branch now, for those products. The day is compared in code (UTC+7), not
    // in SQL, so no date function wraps an indexed column.
    const holders = await selectInChunks(products, 1, (chunk) => db.prepare(`SELECT ${columns} FROM product_batches b
      JOIN branch_batch_stock s ON s.batch_id=b.id AND s.branch_id=? AND s.quantity>0
      WHERE b.variant_product_id IN (${chunk.map(() => '?').join(',')}) ORDER BY b.id`)
      .all<LotFacts>([branchId, ...chunk]))
    const sameKind = (a: LotFacts, b: LotFacts): boolean => {
      const day = lotBusinessDay(a.received_at)
      return day !== null && day === lotBusinessDay(b.received_at)
        && (a.expiry_date ?? '') === (b.expiry_date ?? '') && lotSupplierKey(a) === lotSupplierKey(b)
    }
    for (const lot of asked) {
      const match = holders.find((holder) => Number(holder.product) === Number(lot.product) && Number(holder.id) !== Number(lot.id) && sameKind(lot, holder))
      if (match && Number(match.id) > 0) survivors.set(Number(lot.id), Number(match.id))
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
  // `target` is the redirect branch the request named (branchRedirectTarget); only a retired branch ever reads it.
  constructor(readonly directory: readonly BranchEffectRow[], readonly target: number | null = null) {}

  /** The effect of a recorded branch id (null in, null out). Throws a BranchRetiredNoSuccessorError (or subclass). */
  effect(recordedBranchId: unknown, options: { sells?: boolean } = {}): BranchEffect | null {
    const id = Number(recordedBranchId)
    if (!Number.isSafeInteger(id) || id <= 0) return null
    const key = `${id}:${options.sells ? 1 : 0}`
    let found = this.seen.get(key)
    if (!found) { found = resolveBranchEffect(this.directory, id, { ...options, target: this.target }); this.seen.set(key, found) }
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
 * reads them: a line recorded at a retired branch (Old Shop) gets the active branch the operator confirmed, its lots
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
