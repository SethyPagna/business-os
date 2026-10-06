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
// The English of the packs' branch_retired_no_successor key (the key is named after the code; pinned by
// scripts/test-cutover-li-pack-parity-pure.cjs). Role-neutral: no branch name.
export const BRANCH_RETIRED_NO_SUCCESSOR_ERROR = 'This record belongs to an inactive branch, and no active branch has taken its place. Nothing was changed.'

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
  return survivors
}
