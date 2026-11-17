import type { InventoryCheckApproval, InventoryCheckLineDecision, InventoryCheckSessionItem } from '../../api/inventoryChecksTransport.ts'
import { lineDecisionVerdict, type LineShape } from './inventoryCheckLineInput.ts'

// What an approval's lines are, where each stands and what approving it leaves. Pure: the panel draws it, the hook's review dialogs quote it.
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const EPSILON = 1e-9
type LotLine = NonNullable<InventoryCheckSessionItem['lot_lines']>[number]

/**
 * The lines an approval is about. The approval stores the set (line_ids) when it is created and the server treats exactly those as lines, so the panel lists them and derives nothing from the figures.
 * An approval with no stored set (made before migration 0316) falls back to the items whose counts differ from the stock the counter's baseline recorded, which is how the server then reads them too.
 */
export function approvalLines(items: readonly InventoryCheckSessionItem[], approval?: Pick<InventoryCheckApproval, 'line_ids'>): InventoryCheckSessionItem[] {
  if (Array.isArray(approval?.line_ids)) {
    const byId = new Map(items.map(item => [Number(item.product_id), item]))
    return approval.line_ids.flatMap(id => { const item = byId.get(id); return item ? [item] : [] })
  }
  // A product counted per received date differs when ANY of its dates does (two wrong dates whose sums agree still need a decision), and is applied date by date.
  return items.filter(item => item.lot_lines?.length ? item.lot_lines.some(line => finite(line.seen) && Math.abs(line.seen - line.counted) > EPSILON)
    : finite(item.baseline_quantity) && finite(item.counted_quantity) && Math.abs(item.baseline_quantity - item.counted_quantity) > EPSILON)
}

export const decisionOf = (approval: InventoryCheckApproval, productId: number | string): InventoryCheckLineDecision | undefined => {
  const entry = approval.line_decisions?.[String(productId)]
  return entry && (entry.decision === 'reject' || entry.decision === 'modify') ? entry : undefined
}

/** The figure the count asks for: the approver's modified total when there is one, else what the counter typed. */
export const effectiveCounted = (item: InventoryCheckSessionItem, approval: InventoryCheckApproval): number | null | undefined => {
  const decision = decisionOf(approval, item.product_id)
  return decision?.decision === 'modify' && finite(decision.counted) ? decision.counted : item.counted_quantity
}

/** One received date of a dated line as the approval will apply it: the approver's figure when the line was modified and listed it, else the counter's. */
export const effectiveLotCounted = (item: InventoryCheckSessionItem, approval: InventoryCheckApproval, line: LotLine): number => {
  const decision = decisionOf(approval, item.product_id)
  const own = decision?.decision === 'modify' ? decision.lots?.find(entry => entry.batchId === line.batch_id) : undefined
  return own ? own.counted : line.counted
}

/** The figure the count is measured against: the stock recorded at submit, as the approval holds it (the line's own baseline when the approval has none). */
export function baselineOf(item: InventoryCheckSessionItem, approval: InventoryCheckApproval): number | null | undefined {
  const recorded = approval.baselines?.[String(item.product_id)]
  return finite(recorded) ? recorded : item.baseline_quantity
}

const ordinaryNow = (item: InventoryCheckSessionItem): number | null => {
  const damaged = finite(item.current_stock?.recorded_damaged_quantity) ? item.current_stock.recorded_damaged_quantity : 0
  return finite(item.current_stock?.recorded_ordinary_quantity) ? item.current_stock.recorded_ordinary_quantity : finite(item.current_quantity) ? item.current_quantity - damaged : null
}

/** The figure the count asks for before the floor at zero; below zero means the stock cannot take the whole shortage the count found. */
export const approvalWanted = (now: number, counted: number, seen: number): number => now + counted - seen

/**
 * The ordinary stock approving leaves for one line: the stock of now moved by what the count found against what the counter saw (the approver's figure for a modified line), never below zero.
 * The server applies the same rule; null when a figure it needs is missing (nothing is invented).
 */
export function approvalResult(item: InventoryCheckSessionItem, approval: InventoryCheckApproval, counted: number | null | undefined = effectiveCounted(item, approval)): number | null {
  const seen = baselineOf(item, approval), now = ordinaryNow(item)
  return finite(counted) && finite(seen) && now !== null ? Math.max(0, approvalWanted(now, counted, seen)) : null
}

/** How far a line falls short because the stock ran out: recorded on a decided line, worked out for a pending one; null when the stock takes the whole count. */
export function approvalShortfall(item: InventoryCheckSessionItem, approval: InventoryCheckApproval): number | null {
  const done = approval.applied_lines?.[String(item.product_id)]
  if (done) return done.clamped && finite(done.wanted) ? -done.wanted : null
  const now = ordinaryNow(item), seen = baselineOf(item, approval), counted = effectiveCounted(item, approval)
  if (!finite(counted) || !finite(seen) || now === null) return null
  const wanted = approvalWanted(now, counted, seen)
  return wanted < -EPSILON ? -wanted : null
}

/** What the server can tell about the line's shape: counted by received date (and which dates), or as one figure. */
export function lineShapeOf(item: InventoryCheckSessionItem): LineShape {
  const dates = (item.lot_lines ?? []).filter(line => line.scope === 'lot')
  return { dated: dates.length > 0, batchIds: dates.map(line => line.batch_id) }
}

export type LineState = 'open' | 'rejected' | 'modified' | 'applied' | 'superseded' | 'applying' | 'waiting' | 'decided'
/**
 * Where a line stands. Applied and replaced lines are final. While the approval is pending a decided line is rejected or modified (and can be reopened); a pending approval that is being applied is
 * 'applying' for the approver who holds the claim and 'waiting' for anyone else: no per-line action is offered for either. A line of an approval that ended is 'decided'.
 */
export function lineStateOf(item: InventoryCheckSessionItem, approval: InventoryCheckApproval): LineState {
  const id = String(item.product_id)
  if (approval.applied_lines?.[id]) return 'applied'
  if (approval.superseded?.[id]) return 'superseded'
  if (approval.status !== 'pending') return 'decided'
  const decision = decisionOf(approval, id)
  if (approval.applying === true) return decision ? (decision.decision === 'reject' ? 'rejected' : 'modified') : approval.applying_request_id ? 'applying' : 'waiting'
  return decision ? (decision.decision === 'reject' ? 'rejected' : 'modified') : 'open'
}

export type ModifyFigures = { counted: number } | { lots: Array<{ batchId: number; counted: number }> }
/**
 * Why the typed figures cannot be saved, as a refusal code, or null when they can. The same verdict the server gives for the body (the shared validator), plus the one rule it reads from the stored
 * count: a modified line must differ from what the counter saw on some date (otherwise reject the line).
 */
export function modifyProblem(item: InventoryCheckSessionItem, approval: InventoryCheckApproval, figures: ModifyFigures): string | null {
  const verdict = lineDecisionVerdict({ requestId: 'preview-request', productId: Number(item.product_id), action: 'modify', ...figures }, lineShapeOf(item))
  if (!verdict.ok) return verdict.code
  if ('counted' in figures) {
    const seen = baselineOf(item, approval)
    return finite(seen) && Math.abs(figures.counted - seen) <= EPSILON ? 'inventory_check_modify_matches_seen' : null
  }
  const typed = item.lot_lines ?? []
  if (typed.some(line => !finite(line.seen))) return null
  const changed = typed.some(line => {
    const own = figures.lots.find(entry => entry.batchId === line.batch_id)
    return Math.abs((own ? own.counted : line.counted) - (line.seen as number)) > EPSILON
  })
  return changed ? null : 'inventory_check_modify_matches_seen'
}

/** What a figure box holds as a number for the validator to judge: null while empty, NaN for text that is not a plain number (the validator refuses it as an invalid quantity). */
export function figureOf(text: string): number | null {
  const clean = text.trim()
  if (clean === '') return null
  return /^-?\d+(\.\d+)?$/.test(clean) ? Number(clean) : Number.NaN
}
