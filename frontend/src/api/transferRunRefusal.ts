// U-transfer3: the pure half of saved-transfer-run recovery -- what counts as a
// definitive refusal, which lines Edit restores, and the refusal in the
// operator's language. No transport imports, so Inventory can use it without
// loading the transfer transport eagerly. The executor that records a refusal
// on the saved run is api/transferRunRecovery.ts.

import type { PendingTransferRun } from './branchTransport.ts'
import { localizeBranchRuleError } from './branchRuleErrors.ts'

export type TransferRunRefusal = { status: number; code: string | null; message: string }
export type RecoverableTransferRun = PendingTransferRun & { refusal?: TransferRunRefusal }

// A 4xx that does NOT prove the transfer was refused for good. 401/403 from
// the edge, an auth hand-off, timeouts and rate limits say nothing about the
// transfer itself. idempotency_conflict means SOMETHING is recorded under
// this key already, so it is treated as an unknown result, never as a refusal.
const NOT_A_REFUSAL_CODES = new Set([
  'edge_interference', 'cloudflare_access_required', 'invalid_session', 'actor_session_quarantined',
  'signout_actor_changed', 'stale_read_scope', 'api_version_mismatch', 'write_requires_live_server',
  'write_outcome_unknown', 'request_timeout', 'maintenance_active', 'release_upgrade_in_progress',
  'idempotency_conflict', 'write_conflict',
])
const NOT_A_REFUSAL_STATUSES = new Set([401, 408, 425, 429])

/**
 * The refusal a failed transfer request proves, or null when the result is
 * unknown (network, timeout, 5xx, maintenance, edge/auth interference) and
 * the saved run must stay retry-only.
 */
export function transferRefusalFromError(error: unknown): TransferRunRefusal | null {
  if (!error || typeof error !== 'object') return null
  const source = error as { status?: unknown; code?: unknown; outcome?: unknown; message?: unknown }
  if (source.outcome === 'unknown' || source.outcome === 'not_dispatched') return null
  const status = Number(source.status)
  if (!Number.isInteger(status) || status < 400 || status > 499 || NOT_A_REFUSAL_STATUSES.has(status)) return null
  const code = typeof source.code === 'string' && source.code ? source.code : null
  if (code && NOT_A_REFUSAL_CODES.has(code)) return null
  return { status, code, message: typeof source.message === 'string' ? source.message : '' }
}

export function isRefusedTransferRun(run: unknown): run is RecoverableTransferRun & { refusal: TransferRunRefusal } {
  const refusal = (run as RecoverableTransferRun | null)?.refusal
  return !!refusal && Number.isInteger(refusal.status) && refusal.status >= 400 && refusal.status <= 499
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
