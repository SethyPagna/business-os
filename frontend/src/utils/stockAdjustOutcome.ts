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
//      is a single-row, non-idempotent write (routes/inventory.ts:1284 --
//      one product, one movement per call, no client request id honoured on
//      that route), so double-apply is prevented on THIS side by excluding
//      done rows from the retry set. `rowId` is the client-generated key that
//      makes that exclusion stable across retries.
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
    return { kind: 'offline', message, available: null, requested: null, status, retryable: true, offline: true }
  }

  // "Cannot remove 5 - only 2 available in shop" / "Only 2 available in this
  // batch at this branch" -- both carry the number the operator needs.
  const availableMatch = /only\s+(-?\d+(?:\.\d+)?)\s+available/i.exec(message)
  const requestedMatch = /cannot remove\s+(-?\d+(?:\.\d+)?)/i.exec(message)
  if (availableMatch || /no stock|insufficient/i.test(message)) {
    return {
      kind: 'insufficient_stock',
      message,
      available: availableMatch ? Number(availableMatch[1]) : null,
      requested: requestedMatch ? Number(requestedMatch[1]) : null,
      status: status ?? 400,
      retryable: true,
      offline: false,
    }
  }

  if (status === 403 || status === 401 || /full access|not allowed|permission/i.test(message)) {
    return { kind: 'permission', message, available: null, requested: null, status, retryable: false, offline: false }
  }
  if (status === 409 || code === 'write_conflict' || /changed on another device/i.test(message)) {
    return { kind: 'conflict', message, available: null, requested: null, status, retryable: true, offline: false }
  }
  if (status != null && status >= 500) {
    return { kind: 'server', message, available: null, requested: null, status, retryable: true, offline: false }
  }
  if (status === 400 || status === 404 || status === 422) {
    return { kind: 'validation', message, available: null, requested: null, status, retryable: true, offline: false }
  }
  return { kind: 'unknown', message, available: null, requested: null, status, retryable: true, offline: false }
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
