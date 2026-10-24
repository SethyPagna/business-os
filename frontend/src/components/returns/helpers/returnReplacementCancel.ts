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
  /** The frozen request a failed attempt left behind, if any (the same read the New Return screen resumes from). */
  loadPendingReturnCreateV1?(actorId: unknown): { bodyJson: string } | null
}

/** The request id of a take-back: the mark ('rtb-<exchange return id>_') by which the Worker finds an exchange's take-backs itself, whatever the dialog remembers. */
export function takeBackRequestId(exchangeReturnId: number): string {
  const unique = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  return `rtb-${exchangeReturnId}_${unique}`
}

const money2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

/** A signature of exactly which lines (and units) a take-back covers, so a retry of the same choice is recognised and a changed choice is not. */
export function takeBackSignature(lines: readonly ReplacementLine[]): string {
  return JSON.stringify(lines.map((line) => [line.id, line.sale_item_id, line.quantity]))
}

function takeBackItems(lines: readonly ReplacementLine[]): Array<{ sale_item_id: number; quantity: number }> {
  if (!lines.length || lines.some((line) => line.sale_item_id == null)) throw Object.assign(new Error('return_v1_review_required'), { code: 'return_v1_review_required' })
  return lines.map((line) => ({ sale_item_id: Number(line.sale_item_id), quantity: line.quantity }))
}

/**
 * Asks the server whether this take-back would be accepted, writing nothing (the money-v1 quote runs the return's own admission: plan size, quantities,
 * the refund). A validation pass ONLY: the answer is never reused, because the quote is bound to the replacement sale's revision and every step before it
 * moves that revision -- each step reads its own quote right before its create. Null for a legacy replacement sale, which has no quote. Throws with the refusal.
 */
export async function validateTakeBack(deps: TakeBackDeps, outstanding: ReplacementOutstanding, lines: readonly ReplacementLine[]): Promise<unknown> {
  const items = takeBackItems(lines)
  return outstanding.money_precision_version === 1 ? deps.getReturnQuoteV1(outstanding.sale_id, items) : null
}

// A frozen request left by an attempt whose outcome was not seen: the SAME take-back resumes from it (its request id makes the create idempotent);
// any other pending request is not ours to resume, and preparing a new one reports it.
function resumablePending(deps: TakeBackDeps, outstanding: ReplacementOutstanding, items: Array<{ sale_item_id: number; quantity: number }>): { bodyJson: string } | null {
  let saved: { bodyJson: string } | null = null
  try { saved = deps.loadPendingReturnCreateV1?.(deps.userId) ?? null } catch { return null }
  if (!saved) return null
  try {
    const body = JSON.parse(saved.bodyJson) as { sale_id?: unknown; items?: Array<{ sale_item_id?: unknown; quantity?: unknown }>; replacement_items?: unknown }
    const same = Number(body.sale_id) === outstanding.sale_id && !body.replacement_items && Array.isArray(body.items) && body.items.length === items.length
      && items.every((item) => body.items!.some((candidate) => Number(candidate.sale_item_id) === item.sale_item_id && Number(candidate.quantity) === item.quantity))
    return same ? saved : null
  } catch { return null }
}

// The server's authoritative refusal of a stale quote: the create did NOT land, so the frozen request can be dropped and the step quoted again.
const quoteRefused = (error: unknown): boolean => {
  const failure = error as { code?: unknown; returnV1QuoteRejected?: unknown } | null
  return failure?.code === 'customer_return_quote_stale' || failure?.returnV1QuoteRejected === true
}

/**
 * Takes the given replacement lines back as ONE ordinary return of the replacement sale and answers its id. A money-v1 replacement sale goes
 * through the same quote -> frozen request -> create the New Return screen uses, the quote read FRESH right before this create (the quote carries the
 * replacement sale's revision, which an earlier step has moved); a legacy one posts the legacy body with the recorded line prices. All units still with
 * the customer on each line are taken back (the question is which lines, not how many units).
 * A frozen request left by an attempt whose outcome was not seen is resubmitted as it was (its request id makes the create idempotent), unless the server
 * answers that its quote is stale: that refusal means nothing landed, so the request is dropped and the step is quoted and made again.
 */
export async function takeBackReplacement(deps: TakeBackDeps, outstanding: ReplacementOutstanding, lines: readonly ReplacementLine[]): Promise<number> {
  const items = takeBackItems(lines)
  let created: CreatedReturn | null = null
  if (outstanding.money_precision_version === 1) {
    const resumed = resumablePending(deps, outstanding, items)
    if (resumed) {
      try {
        created = await deps.submitReturnCreateV1(deps.userId, resumed as never) as CreatedReturn | null
        await deps.clearPendingReturnCreateV1(deps.userId, resumed as never)
      } catch (error) {
        if (!quoteRefused(error)) throw error
        await deps.clearPendingReturnCreateV1(deps.userId, resumed as never)
        created = null
      }
    }
    if (!created) {
      const quote = await deps.getReturnQuoteV1(outstanding.sale_id, items)
      const pending = await deps.prepareReturnCreateV1(deps.userId, {
        client_request_id: takeBackRequestId(outstanding.return_id),
        reason: deps.reason, return_type: 'restock', notes: null, branch_id: lines[0].branch_id,
        items: lines.map((line) => ({ sale_item_id: Number(line.sale_item_id), quantity: line.quantity, stock_action: 'restock', ...(line.branch_id != null ? { branch_id: line.branch_id } : {}) })),
      }, quote as never) as { bodyJson: string }
      created = await deps.submitReturnCreateV1(deps.userId, pending as never) as CreatedReturn | null
      await deps.clearPendingReturnCreateV1(deps.userId, pending as never)
    }
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

/**
 * The take-backs made for one exchange return, step by step. Each part is one COMPLETE return of the replacement sale (the replacement lines it covers, its
 * id): a state the business can stand in on its own, so a cancel that stops after any step leaves nothing half-written. A retry continues from the parts
 * that exist -- only the lines no part covers are made, and a part that exists is never made twice.
 */
export interface TakenPart { lines: number[]; id: number }
export interface TakenBack { signature: string; parts: TakenPart[] }

const takenIds = (made: TakenBack | undefined): number[] => made ? made.parts.map((part) => part.id) : []
const coveredLines = (made: TakenBack | undefined): Set<number> => new Set(made ? made.parts.flatMap((part) => part.lines) : [])

/** The lines of a take-back still to be made, grouped into the returns that will make them: all in one, or one return per line when the plan is small. */
function stepsFor(lines: readonly ReplacementLine[], made: TakenBack | undefined, perLine: boolean): ReplacementLine[][] {
  const covered = coveredLines(made)
  const remaining = lines.filter((line) => !covered.has(line.id))
  if (!remaining.length) return []
  return perLine ? remaining.map((line) => [line]) : [remaining]
}

/** Whether the server said the take-backs must be made one line at a time (its dry run answers `takeBackPerLine`: a plan too small for a longer return). */
export function takeBackPerLine(checked: unknown): boolean {
  return !!checked && typeof checked === 'object' && (checked as { takeBackPerLine?: unknown }).takeBackPerLine === true
}

/**
 * The cancel as a dry run: each return that is about to have units taken back says which (the take-back does not exist yet); the take-backs already made on an
 * earlier attempt are named as they will be linked. null when no take-back is still to be made -- the cancel alone is atomic, so there is nothing to check first.
 * One request covers EVERY selected exchange, so one refusal speaks for the whole selection before anything is written.
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
    const covered = made && made.signature === takeBackSignature(lines) ? coveredLines(made) : new Set<number>()
    const ids = made && covered.size ? takenIds(made) : []
    const remaining = lines.filter((line) => !covered.has(line.id))
    if (!remaining.length) return { ...item, replacement: { return_ids: ids } }
    pending = true
    return { ...item, replacement: { return_ids: ids, planned: remaining.map((line) => ({ sale_item_id: Number(line.sale_item_id), quantity: line.quantity })) } }
  })
  return pending ? { ...input.payload, client_request_id: input.clientRequestId, items, dry_run: true } : null
}

/**
 * The cancel request the dialog sends: the frozen bulk payload plus, for every exchange return that has replacement items left, the answer. Without a
 * take-back (the caller may not add returns) every answer is "keep". Everything that can be refused is asked BEFORE the first write, for every selected
 * exchange together:
 *   1. the answers themselves (a ticked box needs a ticked line; a changed choice after units are back);
 *   2. the cancel, as one dry run (the plan's budget, the price floor of what stays, the change refusal, the permissions) -- it also says whether the plan needs the
 *      take-backs one line at a time;
 *   3. each take-back's own admission (`validateTakeBack`, a quote that writes nothing).
 * Only then are the take-backs made, one complete return per step; whatever was made stays in `taken`, so a failure part-way is continued, never repeated.
 */
export async function composeCancelPayload(input: {
  payload: ReturnBulkPayload
  outstanding: ReadonlyMap<number, ReplacementOutstanding>
  answers: ReadonlyMap<number, ReplacementAnswer>
  taken: Map<number, TakenBack>
  takeBack?: (outstanding: ReplacementOutstanding, lines: ReplacementLine[]) => Promise<number>
  /** Sends the dry run; throws with the Worker's refusal. Absent in callers that do not need it. */
  check?: (payload: ReturnBulkPayload) => Promise<unknown>
  /** Asks whether one take-back would be accepted, writing nothing; throws with the refusal. A validation pass: its answer is not reused. */
  validateTakeBack?: (outstanding: ReplacementOutstanding, lines: ReplacementLine[]) => Promise<unknown>
  makeRequestId?: () => string
}): Promise<ReturnBulkPayload> {
  if (!input.outstanding.size) return input.payload
  if (!input.takeBack) return withReplacementChoices(input.payload, new Map([...input.outstanding.keys()].map((id) => [id, [] as number[]])))
  planAnswers(input.outstanding, input.answers, input.taken)
  let perLine = false
  if (input.check) {
    const dry = dryRunCancelPayload({ payload: input.payload, outstanding: input.outstanding, answers: input.answers, taken: input.taken, clientRequestId: (input.makeRequestId ?? makeReturnBulkRequestId)() })
    if (dry) perLine = takeBackPerLine(await input.check(dry))
  }
  if (input.validateTakeBack) {
    for (const [returnId, outstanding] of input.outstanding) {
      const lines = pickedLines(outstanding, input.answers.get(returnId) ?? defaultAnswer(outstanding))
      for (const step of stepsFor(lines, input.taken.get(returnId), perLine)) await input.validateTakeBack(outstanding, step)
    }
  }
  return withReplacementChoices(input.payload, await resolveReplacementChoices({ outstanding: input.outstanding, answers: input.answers, taken: input.taken, takeBack: input.takeBack, perLine }))
}

/** The local half of the checks, for every exchange before any of them writes: every answer is ready, and none was changed after units were taken back. */
function planAnswers(
  outstanding: ReadonlyMap<number, ReplacementOutstanding>, answers: ReadonlyMap<number, ReplacementAnswer>, taken: ReadonlyMap<number, TakenBack>,
): void {
  for (const [returnId, info] of outstanding) {
    const answer = answers.get(returnId) ?? defaultAnswer(info)
    if (!answerReady(info, answer)) throw Object.assign(new Error('return_cancel_replacement_pick_one'), { code: 'return_cancel_replacement_pick_one' })
    const lines = pickedLines(info, answer)
    const made = taken.get(returnId)
    if (lines.length && made && made.signature !== takeBackSignature(lines)) throw Object.assign(new Error('return_cancel_replacement_changed'), { code: 'return_cancel_replacement_changed' })
  }
}

/**
 * Turns the operator's answers into the `replacement` choices of the bulk request, making the take-back returns it needs. `taken` remembers the take-backs
 * already made for a return, part by part: a second Apply after a refused or interrupted cancel links the SAME returns and makes only what is missing.
 * Every answer is checked before the first take-back is made; a take-back that fails stops the rest, and whatever was made before it stays in `taken`.
 */
export async function resolveReplacementChoices(input: {
  outstanding: ReadonlyMap<number, ReplacementOutstanding>
  answers: ReadonlyMap<number, ReplacementAnswer>
  taken: Map<number, TakenBack>
  takeBack(outstanding: ReplacementOutstanding, lines: ReplacementLine[]): Promise<number>
  /** One return per line (the plan is small) instead of one return for all the picked lines. */
  perLine?: boolean
}): Promise<Map<number, number[]>> {
  planAnswers(input.outstanding, input.answers, input.taken)
  const choices = new Map<number, number[]>()
  for (const [returnId, outstanding] of input.outstanding) {
    const lines = pickedLines(outstanding, input.answers.get(returnId) ?? defaultAnswer(outstanding))
    if (!lines.length) { choices.set(returnId, []); continue }
    let made = input.taken.get(returnId)
    for (const step of stepsFor(lines, made, input.perLine === true)) {
      const id = await input.takeBack(outstanding, step)
      if (!made) { made = { signature: takeBackSignature(lines), parts: [] }; input.taken.set(returnId, made) }
      made.parts.push({ lines: step.map((line) => line.id), id })
    }
    choices.set(returnId, takenIds(made))
  }
  return choices
}
