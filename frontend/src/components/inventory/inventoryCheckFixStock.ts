import type { InventoryCheckObservation, InventoryCheckProduct } from '../../types/inventoryChecks.ts'

const finiteQuantity = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)

/** The stock reason column holds 512 characters; a note can hold 500, and the prefix comes first. */
const REASON_MAX = 512

/** What the Set session opens with for one Issue: the product, the branch whose stock it fixes, the target and the reason it will carry. */
export type FixStockOpening = {
  product: InventoryCheckProduct
  branchId: number
  /** The stock request id the Set line is sent with: it names the count, so the server holds it while that count waits for approval. */
  requestId: string | null
  /** Counted units minus the branch's damaged units: Set excludes damaged units, a count includes them. */
  quantity: number
  reason: string
}

/** icfix_<session id>_<product id>_<random>: the form the server's hold (lib/inventoryCheckFixStock.ts) reads. Null when the count's id is not one it can carry. */
export function fixStockRequestId(sessionId: unknown, productId: number): string | null {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(sessionId) || !Number.isSafeInteger(productId) || productId <= 0) return null
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return `icfix_${sessionId}_${productId}_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

/** The Set target for a count: damaged units are not part of what Set writes, and a target is never below zero. */
export function fixStockTarget(counted: number, damaged: unknown): number {
  const damagedUnits = typeof damaged === 'number' && Number.isFinite(damaged) && damaged > 0 ? damaged : 0
  return Math.max(0, Math.floor(counted - damagedUnits))
}

/** "Inventory check: <note>", never empty, never longer than the stock reason column. */
export function fixStockReason(label: string, note: string | null | undefined): string {
  const text = String(note ?? '').trim()
  return Array.from(text ? `${label}: ${text}` : label).slice(0, REASON_MAX).join('')
}

type Where = {
  /** The session being viewed, if any: its branch is the branch of the count. */
  session?: { id?: string; branchId: number } | null
  /** The count still waits for approval: approving or rejecting it comes first, so there is nothing to fix yet. */
  pending?: boolean
  observation?: Pick<InventoryCheckObservation, 'state' | 'counted_quantity' | 'reason'> | null
  /** The branch the list is filtered to ('' = all branches). */
  listBranchId: string
  /** The viewer may read stock (damaged units are part of that field). */
  canViewStock: boolean
  label: string
}

/**
 * The Set session for an Issue that carries a count, or null when Fix stock must not be offered:
 * - inside a session: the product's issue in that session, in the session's branch;
 * - in the list: the product's latest check is an Issue with a count, and the list is filtered to the branch that check was made in
 *   (the product's damaged units are read for the listed branch, so an all-branches list cannot say how many are damaged where).
 * A count that waits for approval offers nothing: the server holds the Set it would send for as long as the count waits.
 */
export function fixStockOpening(product: InventoryCheckProduct, where: Where): FixStockOpening | null {
  if (!where.canViewStock || where.pending || product.is_group || product.checkable === false) return null
  const id = Number(product.id)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  let counted: number | null = null, note: string | null = null, branchId: number | null = null, sessionId: unknown = null
  if (where.session) {
    const observation = where.observation
    if (observation?.state !== 'issue' || !finiteQuantity(observation.counted_quantity)) return null
    counted = observation.counted_quantity; note = observation.reason; branchId = where.session.branchId; sessionId = where.session.id
  } else {
    if (product.check_status !== 'issue' || !finiteQuantity(product.check_counted_quantity)) return null
    counted = product.check_counted_quantity; note = product.check_note ?? null; branchId = product.check_branch_id ?? null; sessionId = product.check_session_id
    if (branchId === null || String(branchId) !== where.listBranchId) return null
  }
  if (!Number.isSafeInteger(branchId) || branchId <= 0 || counted === null || counted < 0) return null
  return { product, branchId, requestId: fixStockRequestId(sessionId, id), quantity: fixStockTarget(counted, product.damaged_quantity), reason: fixStockReason(where.label, note) }
}
