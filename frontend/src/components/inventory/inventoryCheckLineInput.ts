// The input of one per-line decision (POST /sessions/:id/approval/lines), judged before anything is sent. It mirrors the Worker's validator
// (cloudflare/src/lib/inventoryCheckLineInput.ts) rule for rule, in the same order, so a refusal here is the refusal the server would give.
// tests/inventoryCheckLineInputParity.test.ts holds both to one table of inputs and verdicts (cloudflare/scripts/fixtures/inventory-check-line-decision-verdicts.json).

export type LineAction = 'reject' | 'modify' | 'reopen'
export type LineInput = { productId: number; action: LineAction; counted?: number; lots?: Array<{ batchId: number; counted: number }>; note: string | null; requestId: string }
/** What the count itself says about the line: whether it was typed per received date, and which dates it holds. */
export type LineShape = { dated: boolean; batchIds: readonly number[] }
export type LineVerdict = { ok: true; input: LineInput } | { ok: false; status: 400 | 409; code: string }

export const LINE_NOTE_MAX = 500
export const LINE_QUANTITY_MAX = 1_000_000_000
const ACTIONS: readonly string[] = ['reject', 'modify', 'reopen']
const KEYS = new Set(['productId', 'action', 'counted', 'lots', 'note', 'requestId'])
const EPSILON = 0.000000001

class Refusal extends Error {
  status: 400 | 409
  code: string
  constructor(status: 400 | 409, code: string) { super(code); this.status = status; this.code = code }
}
const fail = (code: string): never => { throw new Refusal(400, code) }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('inventory_check_invalid_request')
const positive = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fail('inventory_check_invalid_id')

function wholeQuantity(value: unknown): number {
  const quantity = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= LINE_QUANTITY_MAX ? value : fail('inventory_check_invalid_quantity')
  return Math.abs(quantity - Math.round(quantity)) <= EPSILON ? quantity : fail('inventory_check_target_not_whole')
}

function parse(input: unknown): LineInput {
  const body = object(input)
  if (Object.keys(body).some(key => !KEYS.has(key))) fail('inventory_check_invalid_request')
  const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(body.requestId) ? body.requestId : fail('inventory_check_request_id_required')
  const productId = positive(body.productId)
  const action = typeof body.action === 'string' && ACTIONS.includes(body.action) ? body.action as LineAction : fail('inventory_check_invalid_action')
  const note = body.note == null ? null : typeof body.note === 'string' ? body.note.trim() || null : fail('inventory_check_invalid_note')
  if (note !== null && note.length > LINE_NOTE_MAX) fail('inventory_check_invalid_note')
  const hasCounted = body.counted !== undefined, hasLots = body.lots !== undefined
  if (action !== 'modify') {
    if (hasCounted || hasLots) fail('inventory_check_invalid_request')
    return { productId, action, note, requestId }
  }
  if (hasCounted && hasLots) fail('inventory_check_invalid_request')
  if (!hasCounted && !hasLots) fail('inventory_check_quantity_required')
  if (hasCounted) return { productId, action, counted: wholeQuantity(body.counted), note, requestId }
  if (!Array.isArray(body.lots) || body.lots.length < 1 || body.lots.length > 500) return fail('inventory_check_invalid_request')
  const seen = new Set<number>()
  const lots = body.lots.map(value => {
    const lot = object(value)
    if (Object.keys(lot).some(name => name !== 'batchId' && name !== 'counted')) fail('inventory_check_invalid_request')
    const batchId = positive(lot.batchId)
    if (seen.has(batchId)) fail('inventory_check_invalid_request')
    seen.add(batchId)
    return { batchId, counted: wholeQuantity(lot.counted) }
  })
  return { productId, action, lots, note, requestId }
}

function checkShape(input: LineInput, shape: LineShape): void {
  if (input.action !== 'modify') return
  if (shape.dated) {
    if (input.lots === undefined) fail('inventory_check_lots_required')
    if ((input.lots ?? []).some(lot => !shape.batchIds.includes(lot.batchId))) fail('inventory_check_line_date_not_counted')
  } else if (input.lots !== undefined) fail('inventory_check_lots_not_allowed')
}

/** The whole input-to-verdict function, pure: the Worker's answer for the same input and line shape. */
export function lineDecisionVerdict(input: unknown, shape: LineShape): LineVerdict {
  try {
    const parsed = parse(input)
    checkShape(parsed, shape)
    return { ok: true, input: parsed }
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, status: error.status, code: error.code }
    throw error
  }
}

/** The body that goes on the wire: a null note is left out. */
export function lineRequestBody(input: LineInput): Record<string, unknown> {
  const { note, ...rest } = input
  return note === null ? rest : { ...rest, note }
}
