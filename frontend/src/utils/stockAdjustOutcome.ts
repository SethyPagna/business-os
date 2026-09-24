// Row-outcome kernel for every stock-adjust surface (user, Sep 3: "if the
// adjustment (add, remove, set) fails for any reason it should not forget
// this... should not close the action, keep in same page, so user can edit
// the failed to correct... also show the failed in the stock change as well").
//
// Deliberately pure and React-free so the rule can be unit-tested without a
// DOM: the modals own the rendering, this owns WHAT a submit attempt did to
// each row and what survives a failure.
//
// The three invariants the UI leans on:
//   1. A row that reached 'done' is NEVER resubmitted. POST /api/inventory/adjust
//      is a single-row write: one product, one movement per call. Since
//      migration 0192 it is ALSO server-side idempotent, but only for a
//      request that carries a client_request_id -- so this side's exclusion of
//      done rows is still the first line of defence and the only one an older
//      Worker has. `rowId` is the client-generated key that makes the
//      exclusion stable across retries, and it is the same value sent as
//      client_request_id, so the two halves agree on what "the same row" is.
//   2. A failure never clears a row's typed values -- only its `status` and
//      `failure` change; `request` is carried through untouched.
//   3. The server's own reason text is kept verbatim (the operator has to be
//      able to act on it: "only 2 available"), classified only for tone and
//      for the available-quantity hint.

export type StockAdjustFailureKind =
  | 'insufficient_stock'
  | 'validation'
  | 'permission'
  | 'conflict'
  | 'offline'
  | 'server'
  | 'unknown'

export type StockAdjustFailure = {
  kind: StockAdjustFailureKind
  /**
   * The server's machine-readable code, '' when it gave none. Carried so a
   * surface can translate the sentence instead of showing the English one --
   * see stockRequestFailureEntry below.
   */
  code: string
  /** The server's own message, verbatim where it gave one. */
  message: string
  /** Parsed out of the insufficient-stock messages so the row can show it. */
  available: number | null
  requested: number | null
  status: number | null
  /** False only for failures a plain retry cannot fix (permission). */
  retryable: boolean
  /** True when the write never reached the server -- the rows must be kept. */
  offline: boolean
}

export type StockAdjustRowStatus = 'pending' | 'saving' | 'done' | 'failed'

export type StockAdjustRow<TRequest = unknown> = {
  /** Client-generated, stable across retries -- the row's identity. */
  rowId: string
  status: StockAdjustRowStatus
  request: TRequest
  failure: StockAdjustFailure | null
}

let rowSeq = 0

/**
 * Client-generated row id / idempotency key. Stable for the life of the row,
 * so a retry addresses the same row rather than minting a new one.
 */
export function createRowId(prefix = 'sa'): string {
  rowSeq += 1
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${rowSeq.toString(36)}-${random}`
}

export function createRow<TRequest>(request: TRequest, rowId?: string): StockAdjustRow<TRequest> {
  return { rowId: rowId || createRowId(), status: 'pending', request, failure: null }
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Turn whatever adjustStock() rejected with (or a `{success:false,error}`
 * body) into the row-level reason the operator sees next to the row.
 *
 * Error shapes this has to cover (all real, all from this codebase):
 *   - routes/inventory.ts:1493 `Cannot remove 5 - only 2 available in shop` (400)
 *   - lib/productBatches.ts:359 `Only 2 available in this batch at this branch` (400)
 *   - routes/inventory.ts:1347 `A reason is required for stock adjustments` (400)
 *   - routes/inventory.ts:1293 Full-Access gate (403)
 *   - api/http.ts:433 createWriteBlockedError -- code 'write_requires_live_server',
 *     reason 'server_offline' | 'server_unreachable' | 'server_not_configured'
 *   - a bare TypeError from fetch when the tunnel drops mid-request
 */
export function classifyStockAdjustFailure(error: unknown): StockAdjustFailure {
  const source = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const rawMessage = typeof error === 'string'
    ? error
    : String((source.message ?? source.error ?? '') || '')
  const message = rawMessage.trim() || 'Adjustment failed'
  const status = numberOrNull(source.status)
  const code = String(source.code || '')
  const reason = String(source.reason || '')

  const offline = code === 'write_requires_live_server'
    || reason === 'server_offline'
    || reason === 'server_unreachable'
    || reason === 'server_not_configured'
    || /failed to fetch|networkerror|load failed|server is offline|server is not connected/i.test(message)
  if (offline) {
    return { kind: 'offline', code, message, available: null, requested: null, status, retryable: true, offline: true }
  }

  // "Cannot remove 5 - only 2 available in shop" / "Only 2 available in this
  // batch at this branch" -- both carry the number the operator needs.
  const availableMatch = /only\s+(-?\d+(?:\.\d+)?)\s+available/i.exec(message)
  const requestedMatch = /cannot remove\s+(-?\d+(?:\.\d+)?)/i.exec(message)
  if (availableMatch || /no stock|insufficient/i.test(message)) {
    return {
      kind: 'insufficient_stock',
      code,
      message,
      available: availableMatch ? Number(availableMatch[1]) : null,
      requested: requestedMatch ? Number(requestedMatch[1]) : null,
      status: status ?? 400,
      retryable: true,
      offline: false,
    }
  }

  if (status === 403 || status === 401 || /full access|not allowed|permission/i.test(message)) {
    return { kind: 'permission', code, message, available: null, requested: null, status, retryable: false, offline: false }
  }
  if (status === 409 || code === 'write_conflict' || /changed on another device/i.test(message)) {
    return { kind: 'conflict', code, message, available: null, requested: null, status, retryable: true, offline: false }
  }
  if (status != null && status >= 500) {
    return { kind: 'server', code, message, available: null, requested: null, status, retryable: true, offline: false }
  }
  if (status === 400 || status === 404 || status === 422) {
    return { kind: 'validation', code, message, available: null, requested: null, status, retryable: true, offline: false }
  }
  return { kind: 'unknown', code, message, available: null, requested: null, status, retryable: true, offline: false }
}

// ---------------------------------------------------------------------------
// The per-line stock request guard (migration 0192, Worker
// lib/stockMutationReceipt.ts). Its four refusals are the only stock errors
// whose English sentence is written by the guard rather than by the business
// rule the operator broke, so they are the four that must be translated here
// instead of passed through verbatim.
//
// Three of them are terminal for the line: it can never succeed under its own
// id again, so the sentence has to send the operator to the Remove control
// rather than to the Retry button. stock_request_in_flight is the exception --
// the first attempt is still running, so waiting and retrying is exactly
// right. Keep that instruction in each text: it is the only signpost the row
// has.
// ---------------------------------------------------------------------------

type StockRequestFailureEntry = { key: string; fallback: string }

const STOCK_REQUEST_FAILURE_ENTRIES: Record<string, StockRequestFailureEntry> = {
  stock_request_in_flight: {
    key: 'stock_request_in_flight',
    fallback: 'This line is still being recorded on the server. Wait a moment and try again.',
  },
  stock_request_partially_applied: {
    key: 'stock_request_partially_applied',
    fallback: 'Stock was recorded but the request did not finish. Check the Stock Change ledger, then remove this line.',
  },
  idempotency_conflict: {
    key: 'stock_request_id_conflict',
    fallback: 'This line was already recorded with different details. Remove this line and add it again if needed.',
  },
  invalid_client_request_id: {
    key: 'stock_request_id_invalid',
    fallback: 'This line lost its request id. Remove it and add it again.',
  },
}

/** The pack key + English fallback for a guard code, or null for anything else. */
function stockRequestFailureEntry(code: unknown): StockRequestFailureEntry | null {
  return STOCK_REQUEST_FAILURE_ENTRIES[String(code || '')] || null
}

/**
 * The sentence a stock surface shows for a failed line: the guard's translated
 * text when the server named one of its codes, the server's own message
 * otherwise (which the operator has to be able to act on -- "only 2 available").
 */
export function stockFailureText(
  error: unknown,
  tr: (key: string, fallback: string) => string,
  fallbackMessage: string,
): string {
  const source = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const entry = stockRequestFailureEntry(source.code)
  if (entry) return tr(entry.key, entry.fallback)
  const message = typeof error === 'string' ? error : String((source.message ?? source.error ?? '') || '')
  return message.trim() || fallbackMessage
}

/**
 * True when the line can never succeed under its current id -- the operator's
 * way out is Remove, not Retry. Every stock surface that offers a retry must
 * ask this first, or it invites the exact double-send the guard just stopped.
 */
export function stockLineNeedsRemoval(error: unknown): boolean {
  const source = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const code = String(source.code || '')
  return code === 'stock_request_partially_applied' || code === 'idempotency_conflict' || code === 'invalid_client_request_id'
}

export type StockAdjustOutcome =
  | { status: 'saving' }
  | { status: 'done' }
  | { status: 'pending' }
  | { status: 'failed'; failure: StockAdjustFailure }

/**
 * The reducer. Returns a NEW array with only the named row changed, and never
 * touches `request` -- invariant 2 above.
 */
export function applyRowOutcome<TRequest>(
  rows: ReadonlyArray<StockAdjustRow<TRequest>>,
  rowId: string,
  outcome: StockAdjustOutcome,
): StockAdjustRow<TRequest>[] {
  return rows.map((row) => {
    if (row.rowId !== rowId) return row
    if (outcome.status === 'failed') return { ...row, status: 'failed', failure: outcome.failure }
    return { ...row, status: outcome.status, failure: null }
  })
}

/**
 * The retry set: everything that has NOT been committed. A 'done' row is
 * excluded unconditionally -- that is the no-double-apply guarantee.
 */
export function rowsToSubmit<TRequest>(
  rows: ReadonlyArray<StockAdjustRow<TRequest>>,
): StockAdjustRow<TRequest>[] {
  return rows.filter((row) => row.status === 'pending' || row.status === 'failed')
}

export function countRows<TRequest>(rows: ReadonlyArray<StockAdjustRow<TRequest>>): {
  total: number
  done: number
  failed: number
  pending: number
} {
  let done = 0
  let failed = 0
  let pending = 0
  for (const row of rows) {
    if (row.status === 'done') done += 1
    else if (row.status === 'failed') failed += 1
    else pending += 1
  }
  return { total: rows.length, done, failed, pending }
}

export function hasUnsavedFailures<TRequest>(rows: ReadonlyArray<StockAdjustRow<TRequest>>): boolean {
  return rows.some((row) => row.status === 'failed')
}

/**
 * What the submit button says. `mode: 'retry'` once anything has failed, with
 * the count, so the button reads "Retry failed (2)" instead of "Save".
 */
export function submitButtonState<TRequest>(rows: ReadonlyArray<StockAdjustRow<TRequest>>): {
  mode: 'submit' | 'retry'
  failedCount: number
  doneCount: number
} {
  const counts = countRows(rows)
  return {
    mode: counts.failed > 0 ? 'retry' : 'submit',
    failedCount: counts.failed,
    doneCount: counts.done,
  }
}

// ---------------------------------------------------------------------------
// The unsaved failed attempt, persisted per user until it is resolved.
//
// There is NO server-side status column to hang this on: the stock ledger is
// inventory_movements (migrations 0001/0084), which only ever holds movements
// that actually committed, and no stock_actions / stock_action_sessions table
// carries a 'failed' status (0056/0057/0063 are the IMPORT commit tables, and
// import_jobs.status belongs to an import job, not to an interactive adjust).
// A failed adjust therefore never reaches the server at all -- so it is kept
// client-side, per user, and shown in the Stock Change section with an
// explicit "unsaved" marker until the operator fixes or discards it.
// ---------------------------------------------------------------------------

export type FailedAttemptRow = {
  rowId: string
  productId: number | string | null
  productName: string
  type: string
  quantity: number
  branchId: number | null
  branchName: string
  batchId: number | string | null
  receivedDate: string
  reason: string
  note: string
  failure: StockAdjustFailure
}

export type FailedStockAttempt = {
  id: string
  createdAt: string
  /** Which surface produced it -- 'adjust' | 'bulk' | 'fast-stock-in'. */
  source: string
  rows: FailedAttemptRow[]
}

export const FAILED_ATTEMPTS_EVENT = 'stock-adjust:failed-attempts'
export const MAX_FAILED_ATTEMPTS = 20

export type SimpleStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export function failedAttemptsKey(userKey: string | number | null | undefined): string {
  const key = String(userKey ?? '').trim() || 'anon'
  return `bos.stockAdjust.failedAttempts.${key}`
}

export function readFailedStockAttempts(
  storage: SimpleStorage | null | undefined,
  userKey: string | number | null | undefined,
): FailedStockAttempt[] {
  if (!storage) return []
  let raw: string | null = null
  try {
    raw = storage.getItem(failedAttemptsKey(userKey))
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is FailedStockAttempt => (
      !!entry && typeof entry === 'object' && typeof entry.id === 'string' && Array.isArray(entry.rows)
    ))
  } catch {
    return []
  }
}

export function writeFailedStockAttempts(
  storage: SimpleStorage | null | undefined,
  userKey: string | number | null | undefined,
  attempts: ReadonlyArray<FailedStockAttempt>,
): FailedStockAttempt[] {
  const capped = attempts.slice(0, MAX_FAILED_ATTEMPTS)
  if (storage) {
    try {
      storage.setItem(failedAttemptsKey(userKey), JSON.stringify(capped))
    } catch {
      // A full or blocked store must never take the modal down -- the rows
      // are still on screen, which is the part the user asked never to lose.
    }
  }
  return capped
}

/**
 * Records (or replaces, by id) one failed attempt, newest first.
 */
export function recordFailedStockAttempt(
  storage: SimpleStorage | null | undefined,
  userKey: string | number | null | undefined,
  attempt: FailedStockAttempt,
): FailedStockAttempt[] {
  const existing = readFailedStockAttempts(storage, userKey).filter((entry) => entry.id !== attempt.id)
  return writeFailedStockAttempts(storage, userKey, [attempt, ...existing])
}

export function dropFailedStockAttempt(
  storage: SimpleStorage | null | undefined,
  userKey: string | number | null | undefined,
  attemptId: string,
): FailedStockAttempt[] {
  const remaining = readFailedStockAttempts(storage, userKey).filter((entry) => entry.id !== attemptId)
  return writeFailedStockAttempts(storage, userKey, remaining)
}

/** Browser localStorage where it exists, null in tests/SSR. */
export function browserStockStorage(): SimpleStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

/** Tells every mounted Stock Change section that the list changed. */
export function emitFailedAttemptsChanged(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(FAILED_ATTEMPTS_EVENT))
  } catch {
    /* non-DOM host -- nothing to notify */
  }
}
