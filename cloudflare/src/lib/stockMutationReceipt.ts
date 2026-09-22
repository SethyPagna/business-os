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
// index, and completes it with the response afterwards:
//
//   claim -> 'claimed'   : nobody has run this id; run the kernel
//         -> 'replay'    : completed before; return the original response
//         -> 'conflict'  : same id, different request body -> 409
//         -> 'in_flight' : claimed but never completed -> 409, do NOT guess
//         -> 'disabled'  : migration 0192 not applied here -> pre-0192 path
//
// A refusal or a thrown error RELEASES the claim, so the ordinary
// fix-the-reason-and-try-again loop keeps working with the same id. Only a
// hard crash between the claim and the completion leaves an 'in_flight' row,
// and the honest answer there is to refuse and point at the ledger rather than
// either double-applying or silently reporting success.
//
// Free/paid: no plan-sensitive capability. Two small D1 statements per
// identified line, on the same binding the kernel already holds; no KV, no
// Queues, no Durable Object, no cron, no custom CPU limit.

const STOCK_MUTATION_REQUEST_ID = /^[A-Za-z0-9_-]{8,120}$/

type StockMutationKind = 'adjust' | 'receive'

type StockMutationClaim =
  | { state: 'disabled' }
  | { state: 'claimed' }
  | { state: 'replay'; status: number; body: Record<string, unknown> }
  | { state: 'conflict' }
  | { state: 'in_flight' }

/** Accept only a stable, bounded id; anything else means "no id was sent". */
function normalizeStockMutationRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return STOCK_MUTATION_REQUEST_ID.test(trimmed) ? trimmed : null
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
  response_status: number | null
  response_json: string | null
  completed_at: string | null
}

async function readReceipt(db: D1Compat, actorId: number, requestId: string): Promise<ReceiptRow | undefined> {
  return db.prepare(
    'SELECT request_json, response_status, response_json, completed_at FROM stock_mutation_receipts WHERE actor_id=@actor AND request_id=@request',
  ).get<ReceiptRow>({ actor: actorId, request: requestId })
}

function decideFromStoredReceipt(row: ReceiptRow, canonical: string): StockMutationClaim {
  if (row.request_json !== canonical) return { state: 'conflict' }
  if (!row.completed_at || row.response_status == null) return { state: 'in_flight' }
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(row.response_json || '{}') as Record<string, unknown> } catch { body = {} }
  return { state: 'replay', status: row.response_status, body }
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
  if (existing) return decideFromStoredReceipt(existing, canonical)
  try {
    await db.prepare(
      'INSERT INTO stock_mutation_receipts(actor_id,request_id,kind,request_json) VALUES(@actor,@request,@kind,@canonical)',
    ).run({ actor: actorId, request: requestId, kind, canonical })
  } catch {
    // Lost the race to a concurrent double-submit of the same id: whoever won
    // owns the write, so read their row and answer from it.
    const raced = await readReceipt(db, actorId, requestId)
    if (!raced) throw new Error('Stock request receipt could not be recorded')
    return decideFromStoredReceipt(raced, canonical)
  }
  return { state: 'claimed' }
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

/** A refused or thrown attempt moved no stock; drop the claim so the same id can be retried. */
async function releaseStockMutation(db: D1Compat, actorId: number, requestId: string): Promise<void> {
  await db.prepare(
    'DELETE FROM stock_mutation_receipts WHERE actor_id=@actor AND request_id=@request AND completed_at IS NULL',
  ).run({ actor: actorId, request: requestId })
}

const STOCK_MUTATION_CONFLICT = {
  error: 'client_request_id was already used for different stock data.',
  code: 'idempotency_conflict',
}

const STOCK_MUTATION_IN_FLIGHT = {
  error: 'This stock line is already being recorded. Check the Stock Change ledger before sending it again.',
  code: 'stock_request_in_flight',
}

// The one wrapper both kernels use. `run` is the kernel body, unchanged.
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
  run: () => Promise<Response>,
): Promise<Response> {
  const requestId = normalizeStockMutationRequestId(body.client_request_id)
  if (!requestId || actorId == null) return run()
  const db = openDb()
  const canonical = canonicalStockMutationRequest(body)
  const claim = await claimStockMutation(db, actorId, requestId, kind, canonical)
  if (claim.state === 'disabled') return run()
  if (claim.state === 'conflict') return json(STOCK_MUTATION_CONFLICT, 409)
  if (claim.state === 'in_flight') return json(STOCK_MUTATION_IN_FLIGHT, 409)
  if (claim.state === 'replay') return json({ ...claim.body, replayed: true }, claim.status)
  let response: Response
  try {
    response = await run()
  } catch (error) {
    await releaseStockMutation(db, actorId, requestId)
    throw error
  }
  if (response.status < 200 || response.status >= 300) {
    await releaseStockMutation(db, actorId, requestId)
    return response
  }
  const stored = await response.clone().json().catch(() => ({})) as Record<string, unknown>
  await completeStockMutation(db, actorId, requestId, response.status, stored)
  return response
}
