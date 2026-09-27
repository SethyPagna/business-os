// U-transfer3: the pure half of saved-transfer-run recovery -- what counts as a
// definitive refusal, which lines Edit restores, and the refusal in the
// operator's language. No transport imports, so Inventory can use it without
// loading the transfer transport eagerly. The executor that records a refusal
// on the saved run is api/transferRunRecovery.ts.

import type { PendingTransferRun } from './branchTransport.ts'
import { localizeBranchRuleError } from './branchRuleErrors.ts'

export type TransferRunRefusal = { status: number; code: string | null; message: string }
export type RecoverableTransferRun = PendingTransferRun & {
  refusal?: TransferRunRefusal
  /** Set (and saved) before the run's first request goes out. */
  dispatched?: boolean
  /**
   * Sticky: some request of this run once ended with no known result (lost
   * reply, 5xx, timeout, a non-proving 4xx, or the tab closed mid-send). Such
   * a run is never offered for Edit again -- only Retry under the same keys,
   * or Discard with the "may already have been applied" warning.
   */
  outcomeUnknown?: boolean
}

/**
 * R-transfer3: the ONLY answers that prove a transfer request moved nothing.
 * Each is emitted by /branches/transfer, /branches/transfer-bulk or
 * /inventory/transfer strictly AFTER the route looked up the request's
 * idempotency receipt and found none (or, for the planner's refusals, after it
 * looked again inside the failed batch's catch) -- and the receipt is written
 * in the same atomic batch as the stock movement. So the key was never
 * applied, and sending the lines again under a new key moves them once.
 *
 * Everything else is an UNKNOWN result, including every uncoded 4xx: the
 * routes answer 403 (permission revoked), 400 (request_body_unreadable, field
 * validation), 409 client_upgrade_required and 503 BEFORE the receipt lookup,
 * so such an answer to a Retry says nothing about whether an earlier send of
 * the same key was applied. Pinned against the route sources by
 * cloudflare/scripts/test-transfer-refusal-after-receipt-pure.cjs.
 */
export const DEFINITIVE_TRANSFER_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'transfer_product_missing',
  'transfer_insufficient_stock',
  'transfer_lot_missing',
  'transfer_direction_invalid',
  'canonical_branch_configuration_invalid',
  'transfer_stock_changed',
  'transfer_selected_lot_short',
  'transfer_too_many_lots',
])
/** The statuses those codes are sent with; any other status is not a refusal. */
const DEFINITIVE_TRANSFER_REFUSAL_STATUSES: ReadonlySet<number> = new Set([400, 404, 409])

function isDefinitiveRefusal(status: number, code: string | null): boolean {
  return DEFINITIVE_TRANSFER_REFUSAL_STATUSES.has(status) && !!code && DEFINITIVE_TRANSFER_REFUSAL_CODES.has(code)
}

/**
 * The refusal a failed transfer request proves, or null when the result is
 * unknown and the saved run must stay retry-only.
 */
export function transferRefusalFromError(error: unknown): TransferRunRefusal | null {
  if (!error || typeof error !== 'object') return null
  const source = error as { status?: unknown; code?: unknown; outcome?: unknown; message?: unknown }
  if (source.outcome === 'unknown' || source.outcome === 'not_dispatched') return null
  const status = Number(source.status)
  const code = typeof source.code === 'string' && source.code ? source.code : null
  if (!Number.isInteger(status) || !isDefinitiveRefusal(status, code)) return null
  return { status, code, message: typeof source.message === 'string' ? source.message : '' }
}

/**
 * A saved run that may be edited: it carries a proving refusal and never had
 * an unknown outcome. The stored refusal is re-checked, so a run saved by an
 * earlier build that recorded e.g. a 403 as a refusal is locked again.
 */
export function isRefusedTransferRun(run: unknown): run is RecoverableTransferRun & { refusal: TransferRunRefusal } {
  const saved = run as RecoverableTransferRun | null
  const refusal = saved?.refusal
  return !!refusal && !saved?.outcomeUnknown && Number.isInteger(refusal.status) && isDefinitiveRefusal(refusal.status, refusal.code)
}

export type TransferRunEditState = {
  fromBranch: string
  toBranch: string
  reason: string
  selectedQuantities: Record<string, string>
  selectedLots: Record<string, number>
  /** How many products go back into the form. */
  lineCount: number
}

const roundQuantity = (value: number): number => Math.round(value * 1e9) / 1e9

/**
 * The Branch transfer form's state for every line the run has NOT yet
 * transferred. Requests before `next` were confirmed by the server and are
 * never restored (that would move them twice); the refused request and any
 * after it are. A product listed twice keeps its total quantity and falls
 * back to Automatic when the two lines named different received dates, since
 * the form holds one received date per product.
 */
export function transferRunEditState(run: PendingTransferRun): TransferRunEditState {
  const remaining = run.requests.slice(run.next)
  const head = (remaining[0] || run.requests[0]).body as Record<string, unknown>
  const quantities = new Map<string, number>()
  const lots = new Map<string, number | null>()
  for (const request of remaining) {
    const body = request.body as Record<string, unknown>
    const lines = request.bulk ? (Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : []) : [body]
    for (const line of lines) {
      const id = String(line?.productId ?? '').trim()
      const quantity = Number(line?.quantity)
      if (!id || !Number.isFinite(quantity) || quantity <= 0) continue
      const batchId = Number(line?.batchId)
      const lot = Number.isInteger(batchId) && batchId > 0 ? batchId : null
      if (quantities.has(id)) {
        quantities.set(id, roundQuantity(quantities.get(id)! + quantity))
        if (lots.get(id) !== lot) lots.set(id, null)
      } else {
        quantities.set(id, quantity)
        lots.set(id, lot)
      }
    }
  }
  const selectedQuantities: Record<string, string> = {}
  const selectedLots: Record<string, number> = {}
  for (const [id, quantity] of quantities) {
    selectedQuantities[id] = String(quantity)
    const lot = lots.get(id)
    if (lot) selectedLots[id] = lot
  }
  return {
    fromBranch: head.fromBranchId == null ? '' : String(head.fromBranchId),
    toBranch: head.toBranchId == null ? '' : String(head.toBranchId),
    reason: String(head.reason ?? head.note ?? ''),
    selectedQuantities,
    selectedLots,
    lineCount: quantities.size,
  }
}

type Translate = (key: string) => string | undefined

// The plain-English 400/404 answers of POST /branches/transfer,
// /branches/transfer-bulk and /inventory/transfer that carry no stable code.
const TRANSFER_REFUSAL_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Insufficient stock in source branch\.?$/, 'transfer_refused_insufficient'],
  [/^Insufficient stock for:? (.+)$/, 'transfer_refused_insufficient_items'],
  [/^(Product not found|One or more selected products no longer exist)\.?$/, 'transfer_refused_product_missing'],
  [/^(Received date not found\b.*|An existing received date must be selected\.)$/, 'transfer_refused_lot_missing'],
]

/** The refusal in the operator's language, falling back to the server's text. */
export function localizeTransferRefusal(refusal: TransferRunRefusal | null | undefined, t: Translate): string {
  if (!refusal) return ''
  const ruled = localizeBranchRuleError(refusal, t)
  if (ruled && ruled !== refusal.message) return ruled
  const text = refusal.message.trim()
  for (const [pattern, key] of TRANSFER_REFUSAL_PATTERNS) {
    const match = text.match(pattern)
    const translated = match ? t(key) : ''
    if (match && translated && translated !== key) return translated.replace('{detail}', match[1] || '')
  }
  return refusal.message
}

/**
 * Any failed transfer's message in the operator's language, whether or not it
 * proves a refusal -- wording only, never a decision about the saved run.
 */
export function localizeTransferError(error: unknown, t: Translate): string {
  const source = (error && typeof error === 'object' ? error : {}) as { status?: unknown; code?: unknown; message?: unknown }
  const message = typeof source.message === 'string' ? source.message : ''
  if (!message.trim()) return ''
  return localizeTransferRefusal({
    status: Number(source.status) || 0,
    code: typeof source.code === 'string' && source.code ? source.code : null,
    message,
  }, t)
}

export type InventoryTransferEditForm = {
  productId: string
  from_branch_id: string
  to_branch_id: string
  quantity: number
  reason: string
  /** '' = Automatic; the lot load drops a received date the source no longer offers. */
  batch_id: number | ''
  batch_quantity: ''
}

/** The Inventory transfer form for a refused one-request Inventory run. */
export function inventoryTransferEditForm(run: PendingTransferRun): InventoryTransferEditForm {
  const body = (run.requests[0]?.body || {}) as Record<string, unknown>
  const batchId = Number(body.batchId)
  return {
    productId: String(body.productId ?? ''),
    from_branch_id: body.fromBranchId == null ? '' : String(body.fromBranchId),
    to_branch_id: body.toBranchId == null ? '' : String(body.toBranchId),
    quantity: Number(body.quantity),
    reason: String(body.reason ?? body.note ?? ''),
    batch_id: Number.isInteger(batchId) && batchId > 0 ? batchId : '',
    batch_quantity: '',
  }
}
