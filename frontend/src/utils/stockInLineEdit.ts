// N6 (owner, 23 Sep 2026): "Stock-in sessions editable (today only add or
// delete)." The client half of POST /api/inventory/stock-in-lines/:id/edit
// (cloudflare/src/lib/stockInLineEdit.ts). The Worker is the enforcement: it
// re-validates every field, checks Full inventory adjust (and cost-entry for
// a cost), refuses a decrease below what was already sold, and dedups the
// request id. This module only builds the smallest honest body -- a field the
// operator did not change is not sent -- and turns the Worker's refusal codes
// into sentences in the reader's language.

export type StockInLineEditRow = {
  id: number | null
  quantity: number
  batch_id?: number | null
  batch_received_at?: string | null
  batch_supplier_id?: number | null
  batch_supplier_name?: string | null
  batch_unit_cost_usd?: number | null
  unit_cost_usd?: number | null
  total_cost_usd?: number | null
}

export type StockInLineEditDraft = {
  quantity: string
  unitCostUsd: string
  receivedDate: string
  supplierId: number | null
  supplierName: string
  reason: string
}

export type StockInLineEditBody = {
  client_request_id: string
  quantity: number
  expected_quantity: number
  expected_batch_id: number | null
  unit_cost_usd?: number
  received_date?: string
  supplier_id?: number | null
  supplier_name?: string | null
  reason?: string
}

export const STOCK_IN_LINE_REASON_MAX = 512

/** A line can be edited when it received stock into a lot (a created-at-0 line has neither). */
export function isStockInLineEditable(row: Pick<StockInLineEditRow, 'id' | 'batch_id'>): boolean {
  return row.id != null && Number(row.batch_id) > 0
}

/** The unit cost a line is shown at: its own total over its quantity, else the lot's cost. */
export function stockInLineUnitCost(row: StockInLineEditRow): number | null {
  const quantity = Math.abs(Number(row.quantity) || 0)
  if (row.total_cost_usd != null && Number.isFinite(Number(row.total_cost_usd)) && quantity > 0) {
    return Math.round((Number(row.total_cost_usd) / quantity) * 10000) / 10000
  }
  const lotCost = row.batch_unit_cost_usd ?? row.unit_cost_usd
  return lotCost == null || !Number.isFinite(Number(lotCost)) ? null : Number(lotCost)
}

export function stockInLineDraft(row: StockInLineEditRow): StockInLineEditDraft {
  const cost = stockInLineUnitCost(row)
  return {
    quantity: String(Math.abs(Number(row.quantity) || 0)),
    unitCostUsd: cost == null ? '' : String(cost),
    receivedDate: String(row.batch_received_at || '').slice(0, 10),
    supplierId: row.batch_supplier_id == null ? null : Number(row.batch_supplier_id),
    supplierName: String(row.batch_supplier_name || ''),
    reason: '',
  }
}

function parseNumber(value: string): number | null {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export type StockInLineEditBuild =
  | { ok: true; changed: boolean; body: StockInLineEditBody }
  | { ok: false; errorKey: string; fallback: string }

/**
 * Validate the draft and build the wire body. Mirrors the Worker's parser
 * (parseStockInLineEditRequest): quantity >= 0, unit cost >= 0, reason at most
 * 512 characters. `canEditCost` false never sends a cost, because the Worker
 * refuses one without cost-entry permission.
 */
export function buildStockInLineEditBody(
  row: StockInLineEditRow,
  draft: StockInLineEditDraft,
  requestId: string,
  canEditCost: boolean,
): StockInLineEditBuild {
  const quantity = parseNumber(draft.quantity)
  if (quantity == null || quantity < 0) return { ok: false, errorKey: 'stock_in_line_error_quantity', fallback: 'Enter a quantity of 0 or more.' }
  const before = stockInLineDraft(row)
  const expectedQuantity = Math.abs(Number(row.quantity) || 0)
  const body: StockInLineEditBody = {
    client_request_id: requestId,
    quantity,
    expected_quantity: expectedQuantity,
    expected_batch_id: row.batch_id == null ? null : Number(row.batch_id),
  }
  let changed = quantity !== expectedQuantity
  if (canEditCost && draft.unitCostUsd.trim() !== before.unitCostUsd.trim()) {
    const cost = parseNumber(draft.unitCostUsd)
    if (cost == null || cost < 0) return { ok: false, errorKey: 'stock_in_line_error_cost', fallback: 'Enter a unit cost of 0 or more.' }
    body.unit_cost_usd = cost
    changed = true
  }
  const date = String(draft.receivedDate || '').slice(0, 10)
  if (date && date !== before.receivedDate) {
    body.received_date = date
    changed = true
  }
  const supplierName = draft.supplierName.trim()
  if (supplierName !== before.supplierName.trim() || (draft.supplierId ?? null) !== before.supplierId) {
    body.supplier_id = draft.supplierId ?? null
    body.supplier_name = supplierName || null
    changed = true
  }
  const reason = draft.reason.trim()
  if (reason.length > STOCK_IN_LINE_REASON_MAX) return { ok: false, errorKey: 'stock_in_line_error_reason', fallback: 'The reason is too long (max 512 characters).' }
  if (reason) body.reason = reason
  return { ok: true, changed, body }
}

// Worker refusal code -> [pack key, English fallback]. {min} is filled from
// the Worker's message when it names the lowest allowed quantity.
export const STOCK_IN_LINE_EDIT_ERRORS: Record<string, [string, string]> = {
  below_consumed: ['stock_in_line_error_below_consumed', 'Some of these units were already sold or moved out. The lowest quantity allowed is {min}.'],
  move_consumed: ['stock_in_line_error_move_consumed', 'Some of these units were already sold or moved out, so the line cannot move to another received date. Change the quantity or cost only.'],
  shared_lot: ['stock_in_line_error_shared_lot', 'This received date also holds another receipt, so its cost or supplier cannot be changed from one line. Change the received date too.'],
  target_other_supplier: ['stock_in_line_error_other_supplier', 'That received date already holds a delivery from another supplier at this cost. Choose another date or supplier.'],
  stale_line: ['stock_in_line_error_stale', 'This line changed on another device. Reopen the session and try again.'],
  stale_state: ['stock_in_line_error_stale', 'This line changed on another device. Reopen the session and try again.'],
  line_not_editable: ['stock_in_line_error_not_editable', 'This line cannot be edited here.'],
  session_undone: ['stock_in_line_error_session_undone', 'This stock-in session was undone. Redo it first, then edit the line.'],
  product_cost_edit_required: ['stock_in_line_error_cost_permission', 'Cost-entry permission is required to change receipt costs.'],
  permission_denied: ['stock_in_line_error_permission', 'You do not have permission to edit stock-in lines.'],
  migration_required: ['stock_in_line_error_migration', 'Editing stock-in lines is not available on this server yet. Nothing was changed.'],
  // The receipt gate the Worker re-runs on a changed supplier / cost.
  supplier_required: ['supplier_required', 'Supplier is required'],
  free_goods_required: ['stock_in_line_error_free_goods', 'A $0.00 cost is only accepted for goods received free. Record free goods from Stock-in.'],
}

export function stockInLineEditErrorText(error: unknown, tr: (key: string, fallback: string) => string): string {
  const source = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const message = String(source.message ?? source.error ?? '')
  const entry = STOCK_IN_LINE_EDIT_ERRORS[String(source.code || '')]
  if (!entry) return message || tr('update_failed', 'Update failed')
  const minimum = /lowest quantity allowed is (\d+(?:\.\d+)?)/.exec(message)?.[1] ?? '0'
  return tr(entry[0], entry[1]).replace('{min}', minimum)
}

/** A request id stable across retries of ONE edit attempt; a new attempt takes a new one. */
export function newStockInLineEditRequestId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  return `sil-${random}`.slice(0, 120)
}
