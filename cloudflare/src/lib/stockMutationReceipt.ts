import type { D1Compat } from './db'

// Per-line idempotency for the two single-line stock write kernels --
// routes/inventory.ts's runAdjustAction and routes/batches.ts's
// runReceiveBatchAction. Everything that moves stock one line at a time goes
// through exactly one of those two:
//
//   - the fast stock-in batched commit (routes/stockInCommit.ts) calls both,
//   - its 404 fallback posts the same two routes one line at a time,
//   - ReceiveBatchModal posts POST /api/batches,
//   - StockAdjustModal (add / remove / set) posts POST /api/inventory/adjust.
//
// None of them had a dedup identity. A line whose "saved" outcome never
// reached the client -- a crashed render, a killed tab, a dropped response --
// is re-sent by the retry, and the kernel happily applies the delta a second
// time: branch_stock is an accumulating upsert, a lot top-up is
// `received_qty + N`, and inventory_movements has no uniqueness at all. The
// transfer route has been protected since migration 0151
// (transfer_operation_receipts); this is the same contract for the per-line
// kernels.
//
// WHY A CLAIM AND NOT ONE ATOMIC BATCH. The transfer route can fold its
// receipt insert into the single db.batch() that moves the stock, so a replay
// aborts the whole transaction on the UNIQUE index. Neither kernel here is one
// transaction: runAdjustAction alone runs a correction batch, a receive batch,
// a removal, a standalone movement insert and a tagged-hold batch in sequence.
// Folding a receipt into "the" write is therefore not available without
// restructuring both kernels (which is exactly what the Milestone A
// stock-session kernel in lib/stockSession.ts did for the session wire).
// So this claims the request id FIRST, on the UNIQUE (actor_id, request_id)
// index, and completes it with the response afterwards.
//
// THE WRITTEN FLAG is what makes that honest. A kernel can write stock and
// then still fail afterwards -- "Received stock batch was not found after
// commit" answers 400 with the lot already topped up; recomputeCatalogCost
// runs after the receipt and outside its try; a tagged restock can be refused
// after its receipt landed. Releasing the claim there would let the retry
// apply the delta a second time, which is the whole defect this file exists
// to stop. So the wrapper hands the kernel a markWritten() that it calls
// immediately before its first stock-mutating statement:
//
//   written = 0 + refusal/throw -> claim DELETED; the same id retries cleanly
//                                  (the ordinary fix-the-reason loop)
//   written = 1 + refusal/throw -> the failure is stored as a COMPLETED
//                                  receipt; the retry answers 409
//                                  stock_request_partially_applied and points
//                                  at the ledger, because some stock moved and
//                                  only a human can say how much
//
//   claim -> 'claimed'   : nobody holds this id (or a stale claim was taken
//                          over); run the kernel
//         -> 'replay'    : completed before; return the original response
//         -> 'conflict'  : same id, different request body -> 409
//         -> 'in_flight' : claimed under 120s ago and still running -> 409
//         -> 'partial'   : wrote stock and did not finish -> 409
//         -> 'invalid'   : an id was sent but is not a usable one -> 400
//         -> 'disabled'  : migration 0192 not applied here -> pre-0192 path
//
// STALE CLAIMS. A crash between the claim and the completion used to strand
// the id in 'in_flight' FOREVER, and the operator had no way back: the line
// could never be re-sent under that id and nothing pruned it. A claimed row
// with written = 0 moved no stock by construction, so after 120 seconds -- far
// longer than any Worker invocation -- it is a crashed request, and the retry
// takes it over with a conditional UPDATE (whoever's UPDATE reports one
// changed row owns it, so two racing retries still produce one write).
// written = 1 is never taken over.
//
// Free/paid: no plan-sensitive capability. Two to three small D1 statements
// per identified line, on the same binding the kernel already holds; no KV, no
// Queues, no Durable Object, no cron, no custom CPU limit.

/** Long enough that a truncated or hand-typed value cannot collide by accident. */
const STOCK_MUTATION_REQUEST_ID = /^[A-Za-z0-9_-]{8,120}$/

/** A claim younger than this is treated as a request that is still running. */
const STOCK_MUTATION_STALE_SECONDS = 120

type StockMutationKind = 'adjust' | 'receive'

type StockMutationClaim =
  | { state: 'disabled' }
  | { state: 'claimed' }
  | { state: 'replay'; status: number; body: Record<string, unknown> }
  | { state: 'conflict' }
  | { state: 'in_flight' }
  | { state: 'partial' }

/** Accept only a stable, bounded id. */
function normalizeStockMutationRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return STOCK_MUTATION_REQUEST_ID.test(trimmed) ? trimmed : null
}

/**
 * Did the caller mean to send an id at all? Absent / null / '' means "no id,
 * pre-0192 path". Anything else was an ATTEMPT, and an attempt that does not
 * normalize must be refused rather than silently run unprotected -- a client
 * that truncates its ids would otherwise look protected and not be.
 */
function requestIdWasSupplied(value: unknown): boolean {
  if (value == null) return false
  if (typeof value !== 'string') return true
  return value.trim() !== ''
}

// The request fingerprint stored beside the receipt. Only the fields that
// decide the stock delta and where it lands are canonicalised: device name,
// timezone and client clock ride along on every body and must not make an
// honest retry look like a different request.
const IGNORED_REQUEST_FIELDS = new Set([
  'client_request_id', 'clientRequestId',
  'device_name', 'deviceName', 'device_tz', 'deviceTz', 'client_time', 'clientTime',
])

function canonicalStockMutationRequest(body: Record<string, unknown>): string {
  const entries = Object.keys(body)
    .filter((key) => !IGNORED_REQUEST_FIELDS.has(key) && body[key] !== undefined)
    .sort()
    .map((key) => [key, body[key]] as const)
  return JSON.stringify(entries)
}

// Migration 0192 may not be applied where this Worker is running (the repo
// ships migrations ahead of the applied chain on purpose). Fall back to the
// exact pre-0192 behaviour -- never refuse a stock write because the receipt
// table is missing.
//
// ONLY THE POSITIVE RESULT IS MEMOISED. Latching "absent" for the life of the
// isolate meant that an isolate which happened to probe during the migration
// (or during one transient D1 error) ran UNPROTECTED until it was recycled,
// with no signal anywhere that it was doing so. A miss costs one cheap
// sqlite_master count on the next request and buys a guard that starts working
// the moment the table exists.
let schemaReady = false

/** Test-only: forget the memoised probe so one process can exercise both paths. */
export function resetStockMutationReceiptSchemaProbe(): void {
  schemaReady = false
}

async function receiptsAvailable(db: D1Compat): Promise<boolean> {
  if (schemaReady) return true
  try {
    const row = await db.prepare(
      "SELECT COUNT(*) AS ready FROM sqlite_master WHERE type='table' AND name='stock_mutation_receipts'",
    ).get<{ ready: number }>()
    if (Number(row?.ready ?? 0) > 0) {
      schemaReady = true
      return true
    }
  } catch {
    // A transient read failure is not evidence the table is missing; re-probe.
  }
  return false
}

type ReceiptRow = {
  request_json: string
  written: number | null
  response_status: number | null
  response_json: string | null
  completed_at: string | null
}

async function readReceipt(db: D1Compat, actorId: number, requestId: string): Promise<ReceiptRow | undefined> {
  return db.prepare(
    `SELECT request_json, written, response_status, response_json, completed_at
       FROM stock_mutation_receipts WHERE actor_id=@actor AND request_id=@request`,
  ).get<ReceiptRow>({ actor: actorId, request: requestId })
}

/**
 * Take over a claim that crashed before it wrote anything. Conditional on the
 * exact state that makes takeover safe, so two racing retries cannot both win:
 * whoever's UPDATE reports a changed row owns the write.
 */
async function reclaimStaleStockMutation(db: D1Compat, actorId: number, requestId: string): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE stock_mutation_receipts SET created_at=CURRENT_TIMESTAMP
       WHERE actor_id=@actor AND request_id=@request AND completed_at IS NULL AND written=0
         AND created_at < datetime('now', @window)`,
  ).run({ actor: actorId, request: requestId, window: `-${STOCK_MUTATION_STALE_SECONDS} seconds` })
  return Number(result?.changes ?? 0) === 1
}

async function decideFromStoredReceipt(
  db: D1Compat,
  actorId: number,
  requestId: string,
  row: ReceiptRow,
  canonical: string,
): Promise<StockMutationClaim> {
  if (row.request_json !== canonical) return { state: 'conflict' }
  const wrote = Number(row.written ?? 0) === 1
  if (row.completed_at && row.response_status != null) {
    // A stored FAILURE can only exist for a request that had already written
    // stock (see completeStockMutation's caller); it is never replayed as a
    // success, because the operator has to reconcile it by hand.
    if (row.response_status >= 400) return { state: 'partial' }
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(row.response_json || '{}') as Record<string, unknown> } catch { body = {} }
    return { state: 'replay', status: row.response_status, body }
  }
  if (wrote) return { state: 'partial' }
  if (await reclaimStaleStockMutation(db, actorId, requestId)) return { state: 'claimed' }
  return { state: 'in_flight' }
}

async function claimStockMutation(
  db: D1Compat,
  actorId: number,
  requestId: string,
  kind: StockMutationKind,
  canonical: string,
): Promise<StockMutationClaim> {
  if (!await receiptsAvailable(db)) return { state: 'disabled' }
  const existing = await readReceipt(db, actorId, requestId)
  if (existing) return decideFromStoredReceipt(db, actorId, requestId, existing, canonical)
  try {
    await db.prepare(
      'INSERT INTO stock_mutation_receipts(actor_id,request_id,kind,request_json) VALUES(@actor,@request,@kind,@canonical)',
    ).run({ actor: actorId, request: requestId, kind, canonical })
  } catch {
    // Lost the race to a concurrent double-submit of the same id: whoever won
    // owns the write, so read their row and answer from it.
    const raced = await readReceipt(db, actorId, requestId)
    // The winner finished and released its claim between our INSERT and this
    // read -- so it refused, and nothing was written. Answering 409 is the
    // honest, non-guessing reply; a 500 here used to turn a benign race into
    // an alarming server error.
    if (!raced) return { state: 'in_flight' }
    return decideFromStoredReceipt(db, actorId, requestId, raced, canonical)
  }
  return { state: 'claimed' }
}

/** Set immediately before the kernel's first stock-mutating statement. */
async function markStockMutationWritten(db: D1Compat, actorId: number, requestId: string): Promise<void> {
  await db.prepare(
    'UPDATE stock_mutation_receipts SET written=1 WHERE actor_id=@actor AND request_id=@request AND completed_at IS NULL',
  ).run({ actor: actorId, request: requestId })
}

async function completeStockMutation(
  db: D1Compat,
  actorId: number,
  requestId: string,
  status: number,
  body: unknown,
): Promise<void> {
  await db.prepare(
    `UPDATE stock_mutation_receipts SET response_status=@status, response_json=@body, completed_at=CURRENT_TIMESTAMP
       WHERE actor_id=@actor AND request_id=@request AND completed_at IS NULL`,
  ).run({ actor: actorId, request: requestId, status, body: JSON.stringify(body ?? {}) })
}

/** A refused or thrown attempt that moved NO stock; drop the claim so the same id can be retried. */
async function releaseStockMutation(db: D1Compat, actorId: number, requestId: string): Promise<void> {
  await db.prepare(
    'DELETE FROM stock_mutation_receipts WHERE actor_id=@actor AND request_id=@request AND completed_at IS NULL AND written=0',
  ).run({ actor: actorId, request: requestId })
}

const STOCK_MUTATION_INVALID_ID = {
  error: 'client_request_id must be 8-120 characters of letters, digits, "-" or "_".',
  code: 'invalid_client_request_id',
}

const STOCK_MUTATION_CONFLICT = {
  error: 'client_request_id was already used for different stock data.',
  code: 'idempotency_conflict',
}

const STOCK_MUTATION_IN_FLIGHT = {
  error: 'This stock line is already being recorded. Check the Stock Change ledger before sending it again.',
  code: 'stock_request_in_flight',
}

const STOCK_MUTATION_PARTIAL = {
  error: 'Stock was recorded but the request did not finish. Check the Stock Change ledger, then remove this line.',
  code: 'stock_request_partially_applied',
}

// The one wrapper both kernels use. `run` is the kernel body, unchanged apart
// from the markWritten() call it now makes before its first stock write.
//
// `openDb` is a THUNK, not a database. A request that carries no
// client_request_id must not touch D1 at all before the kernel does its own
// permission checks -- scripts/test-acquisition-cost-access.cjs asserts
// exactly that with a getDb() tripwire, and it is right to: a refusal that
// opens a connection is a refusal that costs a round trip.
export async function withStockMutationReceipt(
  openDb: () => D1Compat,
  actorId: number | null | undefined,
  kind: StockMutationKind,
  body: Record<string, unknown>,
  json: (value: unknown, status?: number) => Response,
  run: (markWritten: () => Promise<void>) => Promise<Response>,
): Promise<Response> {
  const supplied = body.client_request_id ?? body.clientRequestId
  const requestId = normalizeStockMutationRequestId(supplied)
  if (!requestId) {
    // An id that was SENT but cannot be used is refused. Running it
    // unprotected would be the worst of the three answers: the client believes
    // the line is deduped, and it is not.
    if (requestIdWasSupplied(supplied)) return json(STOCK_MUTATION_INVALID_ID, 400)
    return run(async () => {})
  }
  if (actorId == null) return run(async () => {})
  const db = openDb()
  const canonical = canonicalStockMutationRequest(body)
  const claim = await claimStockMutation(db, actorId, requestId, kind, canonical)
  if (claim.state === 'disabled') return run(async () => {})
  if (claim.state === 'conflict') return json(STOCK_MUTATION_CONFLICT, 409)
  if (claim.state === 'in_flight') return json(STOCK_MUTATION_IN_FLIGHT, 409)
  if (claim.state === 'partial') return json(STOCK_MUTATION_PARTIAL, 409)
  if (claim.state === 'replay') return json({ ...claim.body, replayed: true }, claim.status)

  let wrote = false
  const markWritten = async () => {
    if (wrote) return
    wrote = true
    await markStockMutationWritten(db, actorId, requestId)
  }
  let response: Response
  try {
    response = await run(markWritten)
  } catch (error) {
    if (wrote) await completeStockMutation(db, actorId, requestId, 500, STOCK_MUTATION_PARTIAL)
    else await releaseStockMutation(db, actorId, requestId)
    throw error
  }
  if (response.status < 200 || response.status >= 300) {
    if (!wrote) {
      await releaseStockMutation(db, actorId, requestId)
      return response
    }
    // Stock moved and the kernel still refused. Store the refusal so the retry
    // is told exactly that, rather than being invited to apply the delta again.
    const failed = await response.clone().json().catch(() => ({})) as Record<string, unknown>
    await completeStockMutation(db, actorId, requestId, response.status, failed)
    return response
  }
  const stored = await response.clone().json().catch(() => ({})) as Record<string, unknown>
  await completeStockMutation(db, actorId, requestId, response.status, stored)
  return response
}
