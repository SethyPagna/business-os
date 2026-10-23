import { makeReturnBulkRequestId, type ReturnBulkPayload } from './returnBulkAction.ts'

// 6.0.958 (owner, 22 Oct 2026): "if cancel, ask if replacement also cancel, if so, choose some or all."
//
// A return that opened a replacement sale (a one-step exchange) can be cancelled while the customer still holds the replacement items. The
// Worker refuses such a cancel until the request SAYS what happens to those items (cloudflare/src/lib/returnBulkAction.ts): items[i].replacement is
// { return_ids: [...] } -- the returns that take replacement units back -- or { return_ids: [] } to keep them all. Taking a unit back is an ordinary
// return of the replacement sale's line (stock back to the lot it came from, the refund in the same ledgers), made first and then linked to the
// cancel so that undo and redo move them together. These are the pure parts of that flow; the screen only renders them.

export interface ReplacementLine {
  id: number
  sale_item_id: number | null
  product_id: number | null
  product_name: string | null
  branch_id: number | null
  batch_id: number | null
  /** Units still with the customer. */
  quantity: number
  applied_price_usd: number
  applied_price_khr: number
}

export interface ReplacementOutstanding {
  return_id: number
  sale_id: number
  receipt_number: string | null
  money_precision_version: number
  exchange_rate: number
  lines: ReplacementLine[]
}

export interface ReplacementAnswer {
  /** The operator's choice: take the ticked lines back (true) or keep the replacement as it is (false, the default). */
  cancel: boolean
  /** Line ids ticked while `cancel` is on. */
  picked: ReadonlySet<number>
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const optionalId = (value: unknown): number | null => value == null ? null : (Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : NaN)

function parseLine(value: unknown): ReplacementLine | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const saleItemId = optionalId(row.sale_item_id)
  const productId = optionalId(row.product_id)
  const branchId = optionalId(row.branch_id)
  const batchId = optionalId(row.batch_id)
  if (!Number.isSafeInteger(row.id) || Number(row.id) <= 0 || !positive(row.quantity) || [saleItemId, productId, branchId, batchId].some(Number.isNaN)) return null
  const usd = Number(row.applied_price_usd)
  const khr = Number(row.applied_price_khr)
  if (!Number.isFinite(usd) || usd < 0 || !Number.isFinite(khr) || khr < 0) return null
  return {
    id: Number(row.id), sale_item_id: saleItemId, product_id: productId, product_name: typeof row.product_name === 'string' ? row.product_name : null,
    branch_id: branchId, batch_id: batchId, quantity: Number(row.quantity), applied_price_usd: usd, applied_price_khr: khr,
  }
}

/** One return's outstanding replacement as the Worker states it; null for anything that is not a well-formed, non-empty answer. */
export function parseOutstanding(value: unknown): ReplacementOutstanding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!Number.isSafeInteger(row.return_id) || Number(row.return_id) <= 0 || !Number.isSafeInteger(row.sale_id) || Number(row.sale_id) <= 0) return null
  if (!Array.isArray(row.lines) || !row.lines.length) return null
  const lines = row.lines.map(parseLine)
  if (lines.some((line) => line === null)) return null
  const rate = Number(row.exchange_rate)
  return {
    return_id: Number(row.return_id), sale_id: Number(row.sale_id), receipt_number: typeof row.receipt_number === 'string' ? row.receipt_number : null,
    money_precision_version: Number(row.money_precision_version) === 1 ? 1 : 0, exchange_rate: Number.isFinite(rate) && rate > 0 ? rate : 0, lines: lines as ReplacementLine[],
  }
}

/** The outstanding replacements a refused cancel names (409 return_cancel_replacement_choice_required), or null when the error is anything else. */
export function outstandingFromRefusal(error: unknown): ReplacementOutstanding[] | null {
  if (!error || typeof error !== 'object') return null
  const { code, replacements } = error as { code?: unknown; replacements?: unknown }
  if (code !== 'return_cancel_replacement_choice_required' || !Array.isArray(replacements)) return null
  const parsed = replacements.map(parseOutstanding)
  return parsed.length && parsed.every((item) => item !== null) ? parsed as ReplacementOutstanding[] : null
}

/** What a return's question starts as: the replacement stays (the conservative answer), every line ticked in case the operator turns the box on. */
export function defaultAnswer(outstanding: ReplacementOutstanding): ReplacementAnswer {
  return { cancel: false, picked: new Set(outstanding.lines.map((line) => line.id)) }
}

/** The lines to take back: only when the box is on, only the ticked ones, in the order the Worker listed them. */
export function pickedLines(outstanding: ReplacementOutstanding, answer: ReplacementAnswer): ReplacementLine[] {
  return answer.cancel ? outstanding.lines.filter((line) => answer.picked.has(line.id)) : []
}

/** An answer that can be sent: keeping needs nothing more; cancelling needs at least one ticked line. */
export function answerReady(outstanding: ReplacementOutstanding, answer: ReplacementAnswer): boolean {
  return !answer.cancel || pickedLines(outstanding, answer).length > 0
}

export function toggleCancel(answer: ReplacementAnswer, cancel: boolean): ReplacementAnswer {
  return { cancel, picked: answer.picked }
}

export function toggleLine(answer: ReplacementAnswer, lineId: number): ReplacementAnswer {
  const picked = new Set(answer.picked)
  if (picked.has(lineId)) picked.delete(lineId); else picked.add(lineId)
  return { cancel: answer.cancel, picked }
}

/** The bulk request with each cancelled exchange return's answer attached; every other item is untouched. */
export function withReplacementChoices(payload: ReturnBulkPayload, choices: ReadonlyMap<number, readonly number[]>): ReturnBulkPayload {
  return {
    ...payload,
    items: payload.items.map((item) => {
      const returnIds = choices.get(item.id)
      return returnIds ? { ...item, replacement: { return_ids: [...returnIds].sort((a, b) => a - b) } } : item
    }),
  }
}

/** The rows of a selection whose cancel has to ask: completed customer returns that opened a replacement sale. */
export function rowsNeedingReplacementAnswer(
  rows: ReadonlyArray<{ id: number | string; status?: string | null; return_scope?: string | null; replacement_sale_id?: number | string | null }>,
  field: string, source: string, target: string,
): number[] {
  if (field !== 'status' || source !== 'completed' || target !== 'cancelled') return []
  return rows.filter((row) => String(row.status || 'completed').toLowerCase() === 'completed'
    && String(row.return_scope || 'customer').toLowerCase() !== 'supplier' && Number(row.replacement_sale_id) > 0).map((row) => Number(row.id))
}

// ---- taking units back ---------------------------------------------------------------------------------------------------------------------------------

type CreatedReturn = { id?: unknown }

/** The transport calls a take-back needs, passed in so the flow runs the same in the screen and in a test. */
export interface TakeBackDeps {
  userId: unknown
  reason: string
  getReturnQuoteV1(saleId: number, items: Array<{ sale_item_id: number; quantity: number }>): Promise<unknown>
  prepareReturnCreateV1(actorId: unknown, payload: Record<string, unknown>, quote: never): Promise<unknown>
  submitReturnCreateV1(actorId: unknown, pending: never): Promise<unknown>
  clearPendingReturnCreateV1(actorId: unknown, pending: never): Promise<void>
  createReturn(payload: Record<string, unknown>): Promise<unknown>
  /** A request identity kept by the caller for the life of the cancel dialog, so a retried take-back is the same request, never a second return. */
  legacyIdentity(returnId: number, signature: string): { client_request_id: string; return_number: string }
}

const money2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

/** A signature of exactly which lines (and units) a take-back covers, so a retry of the same choice is recognised and a changed choice is not. */
export function takeBackSignature(lines: readonly ReplacementLine[]): string {
  return JSON.stringify(lines.map((line) => [line.id, line.sale_item_id, line.quantity]))
}

/**
 * Takes the picked replacement lines back as ONE ordinary return of the replacement sale and answers its id. A money-v1 replacement sale goes
 * through the same quote -> frozen request -> create the New Return screen uses; a legacy one posts the legacy body with the recorded line prices.
 * All units still with the customer on each picked line are taken back (the question is which lines, not how many units).
 */
export async function takeBackReplacement(deps: TakeBackDeps, outstanding: ReplacementOutstanding, lines: readonly ReplacementLine[]): Promise<number> {
  if (!lines.length || lines.some((line) => line.sale_item_id == null)) throw Object.assign(new Error('return_v1_review_required'), { code: 'return_v1_review_required' })
  const items = lines.map((line) => ({ sale_item_id: Number(line.sale_item_id), quantity: line.quantity }))
  let created: CreatedReturn | null
  if (outstanding.money_precision_version === 1) {
    const quote = await deps.getReturnQuoteV1(outstanding.sale_id, items)
    const pending = await deps.prepareReturnCreateV1(deps.userId, {
      reason: deps.reason, return_type: 'restock', notes: null, branch_id: lines[0].branch_id,
      items: lines.map((line) => ({ sale_item_id: Number(line.sale_item_id), quantity: line.quantity, stock_action: 'restock', ...(line.branch_id != null ? { branch_id: line.branch_id } : {}) })),
    }, quote as never)
    created = await deps.submitReturnCreateV1(deps.userId, pending as never) as CreatedReturn | null
    await deps.clearPendingReturnCreateV1(deps.userId, pending as never)
  } else {
    created = await deps.createReturn({
      ...deps.legacyIdentity(outstanding.return_id, takeBackSignature(lines)),
      sale_id: outstanding.sale_id, receipt_number: outstanding.receipt_number, branch_id: lines[0].branch_id,
      reason: deps.reason, return_type: 'restock', notes: null, exchange_rate: outstanding.exchange_rate || 4100,
      total_refund_usd: money2(lines.reduce((sum, line) => sum + line.quantity * line.applied_price_usd, 0)),
      total_refund_khr: Math.round(lines.reduce((sum, line) => sum + line.quantity * line.applied_price_khr, 0)),
      items: lines.map((line) => ({
        sale_item_id: Number(line.sale_item_id), product_id: line.product_id, product_name: line.product_name, quantity: line.quantity,
        applied_price_usd: line.applied_price_usd, applied_price_khr: line.applied_price_khr, return_to_stock: true, stock_action: 'restock', branch_id: line.branch_id,
      })),
    }) as CreatedReturn | null
  }
  const id = Number(created?.id)
  if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('return_v1_pending'), { code: 'return_v1_pending', outcome: 'unknown' })
  return id
}

export interface TakenBack { signature: string; id: number }

/**
 * The cancel as a dry run: each return that is about to have units taken back says which (the take-back does not exist yet); a take-back already made on an
 * earlier attempt is linked as it will be. null when no take-back is still to be made -- the cancel alone is atomic, so there is nothing to check first.
 */
export function dryRunCancelPayload(input: {
  payload: ReturnBulkPayload
  outstanding: ReadonlyMap<number, ReplacementOutstanding>
  answers: ReadonlyMap<number, ReplacementAnswer>
  taken: ReadonlyMap<number, TakenBack>
  clientRequestId: string
}): ReturnBulkPayload | null {
  let pending = false
  const items = input.payload.items.map((item) => {
    const outstanding = input.outstanding.get(item.id)
    if (!outstanding) return item
    const lines = pickedLines(outstanding, input.answers.get(item.id) ?? defaultAnswer(outstanding))
    if (!lines.length) return { ...item, replacement: { return_ids: [] } }
    const made = input.taken.get(item.id)
    if (made && made.signature === takeBackSignature(lines)) return { ...item, replacement: { return_ids: [made.id] } }
    pending = true
    return { ...item, replacement: { return_ids: [], planned: lines.map((line) => ({ sale_item_id: Number(line.sale_item_id), quantity: line.quantity })) } }
  })
  return pending ? { ...input.payload, client_request_id: input.clientRequestId, items, dry_run: true } : null
}

/**
 * The cancel request the dialog sends: the frozen bulk payload plus, for every exchange return that has replacement items left, the answer. Without a
 * take-back (the caller may not add returns) every answer is "keep". The returns taken back are made here, before anything is sent -- and only after
 * `check` (a dry run of the cancel) has said the cancel will be accepted, so a refused cancel never leaves a take-back behind.
 */
export async function composeCancelPayload(input: {
  payload: ReturnBulkPayload
  outstanding: ReadonlyMap<number, ReplacementOutstanding>
  answers: ReadonlyMap<number, ReplacementAnswer>
  taken: Map<number, TakenBack>
  takeBack?: (outstanding: ReplacementOutstanding, lines: ReplacementLine[]) => Promise<number>
  /** Sends the dry run; throws with the Worker's refusal. Absent in callers that do not need it. */
  check?: (payload: ReturnBulkPayload) => Promise<unknown>
  makeRequestId?: () => string
}): Promise<ReturnBulkPayload> {
  if (!input.outstanding.size) return input.payload
  if (!input.takeBack) return withReplacementChoices(input.payload, new Map([...input.outstanding.keys()].map((id) => [id, [] as number[]])))
  if (input.check) {
    const dry = dryRunCancelPayload({ payload: input.payload, outstanding: input.outstanding, answers: input.answers, taken: input.taken, clientRequestId: (input.makeRequestId ?? makeReturnBulkRequestId)() })
    if (dry) await input.check(dry)
  }
  return withReplacementChoices(input.payload, await resolveReplacementChoices({ outstanding: input.outstanding, answers: input.answers, taken: input.taken, takeBack: input.takeBack }))
}

/**
 * Turns the operator's answers into the `replacement` choices of the bulk request, making the take-back returns it needs. `taken` remembers a
 * take-back already made for a return: a second Apply after a refused cancel links the SAME return instead of taking the units back twice.
 * Throws on the first failure; whatever was made before it stays in `taken`, and the cancel is not sent.
 */
export async function resolveReplacementChoices(input: {
  outstanding: ReadonlyMap<number, ReplacementOutstanding>
  answers: ReadonlyMap<number, ReplacementAnswer>
  taken: Map<number, TakenBack>
  takeBack(outstanding: ReplacementOutstanding, lines: ReplacementLine[]): Promise<number>
}): Promise<Map<number, number[]>> {
  const choices = new Map<number, number[]>()
  for (const [returnId, outstanding] of input.outstanding) {
    const answer = input.answers.get(returnId) ?? defaultAnswer(outstanding)
    const lines = pickedLines(outstanding, answer)
    if (!answerReady(outstanding, answer)) throw Object.assign(new Error('return_cancel_replacement_pick_one'), { code: 'return_cancel_replacement_pick_one' })
    if (!lines.length) { choices.set(returnId, []); continue }
    const signature = takeBackSignature(lines)
    const made = input.taken.get(returnId)
    if (made && made.signature === signature) { choices.set(returnId, [made.id]); continue }
    if (made) throw Object.assign(new Error('return_cancel_replacement_changed'), { code: 'return_cancel_replacement_changed' })
    const id = await input.takeBack(outstanding, lines)
    input.taken.set(returnId, { signature, id })
    choices.set(returnId, [id])
  }
  return choices
}
