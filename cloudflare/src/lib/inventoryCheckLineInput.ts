import { InventoryCheckSessionError, object, requestId as requestIdOf, submissionQuantity } from './inventoryCheckSessions'

/*
 * The input of one per-line decision on a submitted count (POST /api/inventory-checks/sessions/:id/approval/lines), validated with no database: the same table of inputs and verdicts is
 * exported as a JSON fixture (scripts/fixtures/inventory-check-line-decision-verdicts.json) for the frontend validator, so the two can never drift (a parity test feeds both).
 *
 *   reject  { productId, action: 'reject', note?, requestId }
 *   reopen  { productId, action: 'reopen', note?, requestId }                    removes an earlier reject or modify while the approval is pending
 *   modify  { productId, action: 'modify', counted, note?, requestId }           a line counted as one figure
 *           { productId, action: 'modify', lots: [{ batchId, counted }], note?, requestId }   a line counted per received date: only dates the count already has
 *
 * Figures are whole numbers from 0 to 1,000,000,000 (the submission's own rule, plus the whole-number rule the approval enforces on a target). A note is at most 500 characters.
 */

export type LineAction = 'reject' | 'modify' | 'reopen'
export type LineInput = { productId: number; action: LineAction; counted?: number; lots?: Array<{ batchId: number; counted: number }>; note: string | null; requestId: string }
/** What the count itself says about the line: whether it was typed per received date, and which dates it holds. */
export type LineShape = { dated: boolean; batchIds: number[] }
export type LineVerdict = { ok: true; input: LineInput } | { ok: false; status: 400 | 409; code: string }

export const LINE_NOTE_MAX = 500
const ACTIONS: readonly string[] = ['reject', 'modify', 'reopen']
const KEYS = new Set(['productId', 'action', 'counted', 'lots', 'note', 'requestId'])
const fail = (status: InventoryCheckSessionError['status'], code: string): never => { throw new InventoryCheckSessionError(status, code) }
const EPSILON = 0.000000001

/** A whole figure from 0 to 1,000,000,000: the submission's own quantity rule, then the whole-number rule of the approval's target. */
function wholeQuantity(value: unknown): number {
  const quantity = submissionQuantity(value)
  return Math.abs(quantity - Math.round(quantity)) <= EPSILON ? quantity : fail(400, 'inventory_check_target_not_whole')
}

/** The shape of the body, with no knowledge of the line. Throws a coded refusal (always a 4xx). */
export function parseLineDecisionInput(input: unknown): LineInput {
  const body = object(input)
  if (Object.keys(body).some(key => !KEYS.has(key))) fail(400, 'inventory_check_invalid_request')
  const key = requestIdOf(body.requestId)
  const productId = typeof body.productId === 'number' && Number.isSafeInteger(body.productId) && body.productId > 0 ? body.productId : fail(400, 'inventory_check_invalid_id')
  const action = typeof body.action === 'string' && ACTIONS.includes(body.action) ? body.action as LineAction : fail(400, 'inventory_check_invalid_action')
  const note = body.note == null ? null : typeof body.note === 'string' ? body.note.trim() || null : fail(400, 'inventory_check_invalid_note')
  if (note !== null && note.length > LINE_NOTE_MAX) fail(400, 'inventory_check_invalid_note')
  const hasCounted = body.counted !== undefined, hasLots = body.lots !== undefined
  if (action !== 'modify') {
    if (hasCounted || hasLots) fail(400, 'inventory_check_invalid_request')
    return { productId, action, note, requestId: key }
  }
  if (hasCounted && hasLots) fail(400, 'inventory_check_invalid_request')
  if (!hasCounted && !hasLots) fail(400, 'inventory_check_quantity_required')
  if (hasCounted) return { productId, action, counted: wholeQuantity(body.counted), note, requestId: key }
  if (!Array.isArray(body.lots) || body.lots.length < 1 || body.lots.length > 500) return fail(400, 'inventory_check_invalid_request')
  const seen = new Set<number>()
  const lots = body.lots.map(value => {
    const lot = object(value)
    if (Object.keys(lot).some(name => name !== 'batchId' && name !== 'counted')) fail(400, 'inventory_check_invalid_request')
    const batchId = typeof lot.batchId === 'number' && Number.isSafeInteger(lot.batchId) && lot.batchId > 0 ? lot.batchId : fail(400, 'inventory_check_invalid_id')
    if (seen.has(batchId)) fail(400, 'inventory_check_invalid_request')
    seen.add(batchId)
    return { batchId, counted: wholeQuantity(lot.counted) }
  })
  return { productId, action, lots, note, requestId: key }
}

/** What the line allows: a dated line is edited by its dates (and only the dates it holds), any other line by one figure. */
export function checkLineShape(input: LineInput, shape: LineShape): void {
  if (input.action !== 'modify') return
  if (shape.dated) {
    if (input.lots === undefined) fail(400, 'inventory_check_lots_required')
    if ((input.lots ?? []).some(lot => !shape.batchIds.includes(lot.batchId))) fail(400, 'inventory_check_line_date_not_counted')
  } else if (input.lots !== undefined) fail(400, 'inventory_check_lots_not_allowed')
}

/** The whole input-to-verdict function, pure: the table the frontend validator is held to. */
export function lineDecisionVerdict(input: unknown, shape: LineShape): LineVerdict {
  try {
    const parsed = parseLineDecisionInput(input)
    checkLineShape(parsed, shape)
    return { ok: true, input: parsed }
  } catch (error) {
    if (error instanceof InventoryCheckSessionError && (error.status === 400 || error.status === 409)) return { ok: false, status: error.status, code: error.code }
    throw error
  }
}
