import { apiFetch, route } from './http.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { executeTransferRun, loadTransferRun, prepareTransferRun, saveTransferRun, type PendingTransferRun } from './branchTransport.ts'
import { receiveBatchWireBody, type ReceiveBatchPayload } from './batchesTransport.ts'

type InventoryPayload = Record<string, unknown>

export type PendingInventoryTransfer = PendingTransferRun & {
  context: { kind: 'submit' | 'undo' | 'redo'; original: InventoryPayload; productName: string; entryId: string; serverId?: string | number | null }
}

// Separate actor-scoped storage prevents a Branch modal replaying an Inventory
// request against a different endpoint. Keep the entire frozen intent on reload.
function inventoryTransferStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.sessionStorage) {
  return {
    getItem: (key: string) => storage.getItem(`inventory:${key}`),
    setItem: (key: string, value: string) => storage.setItem(`inventory:${key}`, value),
    removeItem: (key: string) => storage.removeItem(`inventory:${key}`),
  }
}
export function loadInventoryTransfer(actorId: unknown, storage?: Storage): PendingInventoryTransfer | null {
  const run = loadTransferRun(actorId, inventoryTransferStore(storage)) as PendingInventoryTransfer | null
  if (run && (!run.context || !['submit', 'undo', 'redo'].includes(run.context.kind) || !run.context.entryId || !run.context.original || run.requests.length !== 1 || run.requests[0].bulk)) {
    throw new Error('The saved transfer cannot be read. Check transfer history before clearing browser storage.')
  }
  return run
}
export function saveInventoryTransfer(actorId: unknown, run: PendingInventoryTransfer | null, storage?: Storage): void {
  saveTransferRun(actorId, run, inventoryTransferStore(storage))
}
export function prepareInventoryTransfer(actorId: unknown, body: InventoryPayload, context: Omit<PendingInventoryTransfer['context'], 'entryId'> & { entryId?: string }): PendingInventoryTransfer {
  const run = prepareTransferRun(actorId, [{ bulk: false, body }])
  return { ...run, context: JSON.parse(JSON.stringify({ ...context, entryId: context.entryId || run.requests[0].body.client_request_id })) }
}
export function executeInventoryTransfer(run: PendingInventoryTransfer, checkpoint: (next: PendingInventoryTransfer) => void): Promise<PendingInventoryTransfer> {
  // Old browser drafts contain reverse FIFO bodies with no lot provenance.
  // Keep the saved evidence, but never submit that legacy reversal again.
  if (run.context.kind !== 'submit') return Promise.reject(new Error('This legacy transfer reversal cannot be replayed. Check transfer history.'))
  return executeTransferRun(run, (next) => checkpoint(next as PendingInventoryTransfer), (request) => transferInventoryStock(request.body)) as Promise<PendingInventoryTransfer>
}

export type InventoryStockSessionProduct = Record<string, unknown>

export type InventoryStockSessionLine = {
  line_id: string
  kind: 'receive' | 'create_receive'
  product_id?: number
  product?: InventoryStockSessionProduct
  batch_id?: number | null
  branch_id: number
  quantity: number
  supplier_id?: number | null
  supplier_name?: string | null
  received_date: string
  expiry_date?: string | null
  notes?: string | null
  // P3-L2: the reason written onto this line's movement, as typed; omitted
  // keeps the Worker's generated "Stock-in session <id>" label.
  reason?: string | null
  unit_cost_usd?: number | null
  // A $0.00 receipt is only accepted as a DECLARED gift. The flag is what
  // distinguishes it from a cost nobody entered (lib/stockReceiptGate.ts).
  free_goods?: boolean
  payment_status?: 'paid' | 'credit' | null
  credit_due_date?: string | null
}

export type InventoryStockSessionRequest = {
  client_request_id: string
  mode: 'stock_in'
  items: InventoryStockSessionLine[]
}

export type InventoryStockSessionReceipt = {
  success: true
  replayed: boolean
  operationId: string
  clientRequestId: string
  actionHistoryId: number
  snapshotId: number
  memberCount: number
  createdCount: number
  receivedCount: number
  totalQuantity: number
  totalCostUsd: number
  items: Array<{
    lineId: string
    kind: 'receive' | 'create_receive'
    productId: number
    productName: string
    createdProduct: boolean
    branchId: number
    batchId: number | null
    batchNumber: number | null
    lotCode: string | null
    movementId: number | null
    quantity: number
    unitCostUsd: number | null
  }>
}

// Atomic stock-session commits can include many validated product and lot
// writes in one idempotent Worker transaction. Give only this replay-safe
// endpoint enough time to return its immutable receipt; legacy per-line
// stock mutations retain the shared short timeout because they do not carry
// this session-level replay contract.
export const INVENTORY_SESSION_TIMEOUT_MS = 60_000

function getDevicePayload(): InventoryPayload {
  return { ...getClientDeviceInfo() }
}

export function adjustStock(payload: InventoryPayload = {}): Promise<unknown> {
  return route(
    'products:adjustStock',
    () => apiFetch('POST', '/api/inventory/adjust', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

// P4-B: one input line for the batched fast stock-in commit. `wire` picks
// which single-line kernel the Worker runs the line through (see
// cloudflare/src/routes/stockInCommit.ts) -- 'adjust' carries the same
// camelCase body adjustStock() above sends to POST /api/inventory/adjust;
// 'receive' carries the same camelCase ReceiveBatchPayload
// batchesTransport.ts's receiveBatchStock() takes (converted to the wire's
// snake_case shape below, via the one shared conversion both callers use).
export type FastStockInCommitLine =
  | { key: string; wire: 'adjust'; body: InventoryPayload }
  | { key: string; wire: 'receive'; body: ReceiveBatchPayload }

export type FastStockInCommitLineResult = {
  ok: boolean
  key?: string
  error?: string
  [field: string]: unknown
}

// POST /api/inventory/fast-stock-in/commit -- the whole fast stock-in
// session in one request instead of one per line (FastStockInModal.tsx used
// to `for (const line of pending) await adjustStock(...)/receiveBatchStock(...)`,
// N sequential Worker round trips for an N-line shipment).
//
// Returns null ONLY on a 404 -- the deployed Worker predates this route (a
// rolling-deploy window with an old build still live) -- so the caller can
// fall back to the original per-line loop. Any other failure (network, 5xx)
// of the FIRST request propagates as a thrown error; the caller decides how
// to report a whole-commit failure, since there is no per-line detail to
// show in that case.
//
// One invocation may attempt only the plan's stockInLinesPerRequest lines
// (Worker lib/planTier.ts: D1 allows 50 queries per invocation on Free and
// 1000 on Paid); the rest come back 'deferred', untouched. This sends those
// again, and only those, until none remain -- see commitStockInLinesInRounds.
// `onSettled` hears each round's final answers before the next round is
// sent, so the caller can persist "saved" lines first.
export async function commitFastStockIn(
  lines: FastStockInCommitLine[],
  onSettled?: (settled: FastStockInCommitSettled) => void,
): Promise<FastStockInCommitLineResult[] | null> {
  const wireLines = lines.map((line) => (
    line.wire === 'receive' ? { key: line.key, wire: line.wire, body: receiveBatchWireBody(line.body) } : line
  ))
  const send = async (batch: typeof wireLines): Promise<FastStockInCommitLineResult[]> => {
    const result = await route(
      'inventory:fastStockIn:commit',
      () => apiFetch('POST', '/api/inventory/fast-stock-in/commit', { ...getDevicePayload(), lines: batch }),
      null,
      true,
    ) as { results?: FastStockInCommitLineResult[] } | null
    return result?.results ?? []
  }
  try {
    return await commitStockInLinesInRounds(wireLines, send, onSettled)
  } catch (error) {
    if (error && typeof error === 'object' && (error as { status?: number }).status === 404) return null
    throw error
  }
}

/** A line the Worker did not attempt (per-request line cap): nothing was read or written for it. */
export function isDeferredStockInResult(result: unknown): boolean {
  const source = (result && typeof result === 'object' ? result : {}) as { ok?: unknown; code?: unknown }
  return source.ok === false && source.code === 'deferred'
}

/** One round's final answers, by index into the caller's original line list. */
export type FastStockInCommitSettled = Array<{ index: number; result: FastStockInCommitLineResult | undefined }>

/**
 * The continuation loop behind commitFastStockIn, with the request injected
 * so it can be exercised without a network.
 *
 * Each round sends only the lines the previous round deferred -- a line the
 * Worker answered in any other way is never sent again, because it may have
 * moved stock. The loop stops when nothing is deferred, when a round has a
 * real (non-deferred) failure -- the operator fixes it and completes again,
 * and the still-deferred lines come back deferred so the caller keeps them
 * queued -- or when a round makes no progress at all.
 *
 * Only the first request may throw: nothing was committed, so the caller's
 * whole-request handling applies. A later request that throws fails only the
 * lines it carried; the earlier rounds' results stand.
 */
export async function commitStockInLinesInRounds<L>(
  lines: L[],
  send: (batch: L[]) => Promise<Array<FastStockInCommitLineResult | undefined>>,
  onSettled?: (settled: FastStockInCommitSettled) => void,
): Promise<FastStockInCommitLineResult[]> {
  const results: FastStockInCommitLineResult[] = []
  let remaining = lines.map((_, index) => index)
  for (let round = 0; remaining.length > 0; round += 1) {
    let answered: Array<FastStockInCommitLineResult | undefined>
    try {
      answered = await send(remaining.map((index) => lines[index]))
    } catch (error) {
      if (round === 0) throw error
      const source = (error && typeof error === 'object' ? error : {}) as { message?: unknown; code?: unknown }
      const failure = { ok: false, error: String(source.message || 'Failed'), code: source.code ?? null }
      const settled = remaining.map((index) => ({ index, result: { ...failure, key: (lines[index] as { key?: string }).key } }))
      settled.forEach(({ index, result }) => { results[index] = result })
      onSettled?.(settled)
      return results
    }
    const thisRound = remaining.map((index, i) => ({ index, result: answered[i] }))
    const deferred = thisRound.filter(({ result }) => isDeferredStockInResult(result))
    const stop = deferred.length === thisRound.length || thisRound.some(({ result }) => !result?.ok && !isDeferredStockInResult(result))
    const settled = stop ? thisRound : thisRound.filter(({ result }) => !isDeferredStockInResult(result))
    settled.forEach(({ index, result }) => { if (result) results[index] = result })
    onSettled?.(settled)
    if (stop) break
    remaining = deferred.map(({ index }) => index)
  }
  return results
}

// Milestone A stock-session wire. The caller owns stable request/line ids:
// retries must send the byte-equivalent logical request so the Worker can
// return its immutable receipt instead of applying stock twice. Deliberately
// network-only -- there is no offline/outbox replay contract for this write.
export function createInventorySession(payload: InventoryStockSessionRequest): Promise<InventoryStockSessionReceipt> {
  return route(
    'inventory:session:create',
    () => apiFetch('POST', '/api/inventory/sessions', payload, INVENTORY_SESSION_TIMEOUT_MS),
    null,
    true,
  ) as Promise<InventoryStockSessionReceipt>
}

// Part 553: the Stock Change ledger's per-row write actions (Products page
// ledger row context menu). Both hit the inventory movement endpoints gated on
// Full Access to Inventory. Revert posts a compensating counter-movement;
// editReason updates just the movement's reason text.
export function revertStockMovement(id: number): Promise<unknown> {
  return route(
    'inventory:movement:revert',
    () => apiFetch('POST', `/api/inventory/movements/${id}/revert`, { ...getDevicePayload() }),
    null,
    true,
  )
}

// N6: edit a saved stock-in line (lib/stockInLineEdit.ts). The body carries
// its own client_request_id, so a retried POST is answered from the stored
// operation instead of moving stock twice.
export function editStockInLine(movementId: number, body: Record<string, unknown>): Promise<unknown> {
  return route(
    'inventory:stock-in-line:edit',
    () => apiFetch('POST', `/api/inventory/stock-in-lines/${movementId}/edit`, { ...getDevicePayload(), ...body }),
    null,
    true,
  )
}

export function editStockMovementReason(id: number, reason: string): Promise<unknown> {
  return route(
    'inventory:movement:reason',
    () => apiFetch('PATCH', `/api/inventory/movements/${id}/reason`, { ...getDevicePayload(), reason }),
    null,
    true,
  )
}

export function transferInventoryStock(payload: InventoryPayload = {}): Promise<unknown> {
  const body = payload.client_request_id ? JSON.parse(JSON.stringify(payload)) : ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'transfer')
  body.transfer_provenance_version = 1
  return route(
    'inventory:transfer',
    () => apiFetch(
      'POST',
      '/api/inventory/transfer',
      body,
    ),
    null,
    true,
  )
}

export function moveStockRow(payload: InventoryPayload = {}): Promise<unknown> {
  return route(
    'inventory:moveRow',
    () => apiFetch('POST', '/api/inventory/move-row', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export function saveInventoryReasons(items: unknown[] = []): Promise<unknown> {
  return route(
    'inventory:reasons:save',
    () => apiFetch('PUT', '/api/inventory/reasons', { ...getDevicePayload(), items }),
    null,
    true,
  )
}

export function replaceInventoryReason(payload: { type: string; from: string; to: string; scope: 'saved_only' | 'linked' }): Promise<unknown> {
  return route('inventory:reasons:replace', () => apiFetch('POST', '/api/inventory/reasons/replace', payload), null, true)
}

// Dated stock-reconciliation import -- the 4-call review flow (Part
// 288-292's backend, first wired to a real UI this session): /resolve
// analyzes raw uploaded rows (never writes a product), the review screen
// collects a decision for each row /resolve couldn't place automatically,
// /resolve/apply-decisions executes those decisions (creates/links
// products, applies price choices) and returns a complete resolved list,
// then that combined list goes through the SAME /preview + /apply pair
// the (already-built, already-tested) non-dated-count stock-count flow
// uses to turn resolved productId/branchId/date/count rows into real
// inventory movements. All four are writes (`isWrite: true`) -- /resolve
// can auto-create an unrecognized branch, and /preview reads live
// product/branch names for its plan even though it makes no DB writes
// itself, so it's kept consistent with /apply rather than raced against
// a local read fallback that doesn't exist for it.
export function resolveDatedStockCountRows(rows: unknown[] = []): Promise<unknown> {
  return route(
    'inventory:datedStockCount:resolve',
    () => apiFetch('POST', '/api/inventory/dated-stock-count/resolve', { ...getDevicePayload(), rows }),
    null,
    true,
  )
}

export function applyDatedStockCountDecisions(payload: InventoryPayload = {}): Promise<unknown> {
  return route(
    'inventory:datedStockCount:applyDecisions',
    () => apiFetch('POST', '/api/inventory/dated-stock-count/resolve/apply-decisions', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export function previewDatedStockCount(entries: unknown[] = []): Promise<unknown> {
  return route(
    'inventory:datedStockCount:preview',
    () => apiFetch('POST', '/api/inventory/dated-stock-count/preview', { ...getDevicePayload(), entries }),
    null,
    true,
  )
}

export function applyDatedStockCount(entries: unknown[] = []): Promise<unknown> {
  return route(
    'inventory:datedStockCount:apply',
    () => apiFetch('POST', '/api/inventory/dated-stock-count/apply', { ...getDevicePayload(), entries }),
    null,
    true,
  )
}
