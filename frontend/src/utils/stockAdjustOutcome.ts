// What a stock surface shows for a failed line, and the unsaved failed attempt
// kept per user until it is resolved. Pure and React-free.
//
// The per-row retry kernel (row statuses, failure classification, retry set)
// belonged to StockAdjustModal / BulkAddStockModal, which the Stock Session
// float replaced (tests/stockSessionEntryPoints.test.ts: "the retired stock
// forms are gone"); it was removed with them.

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

// SCAN1 STK-C / STK-D: the Worker's in-batch guard refused a removal because
// the stock it read was sold or moved before the write. The whole batch
// rolled back -- nothing was written -- so this one IS a plain retry
// (stockLineNeedsRemoval stays false for it). One entry for both codes.
const STOCK_CHANGED_RETRY: StockRequestFailureEntry = {
  key: 'stock_changed_retry',
  fallback: 'The stock changed while this was being saved. Nothing was changed. Refresh and try again.',
}

const STOCK_REQUEST_FAILURE_ENTRIES: Record<string, StockRequestFailureEntry> = {
  product_create_outcome_unknown: {
    key: 'product_create_outcome_unknown',
    fallback: 'Product creation may have completed. Refresh Products and check pending review before creating again. This saved request will not be resent.',
  },
  product_pending_review: {
    key: 'product_creation_pending_review',
    fallback: 'Product creation is pending review and cannot be added to this stock-in session yet.',
  },
  receiving_submission_not_saved: {
    key: 'receiving_submission_not_saved',
    fallback: 'The request could not be saved on this device. No new request was sent. Check available storage and try again.',
  },
  receiving_branch_inactive: {
    key: 'receiving_branch_inactive',
    fallback: 'This branch is inactive. Choose an active branch for new stock. Previously submitted lines keep their original branch.',
  },
  receiving_submission_locked: {
    key: 'receiving_submission_locked',
    fallback: 'Previously submitted lines keep their original details. Retry them unchanged, or check Stock Changes before removing them.',
  },
  receiving_submission_unavailable: {
    key: 'receiving_submission_unavailable',
    fallback: 'This saved line has an unknown outcome. Check Stock Changes before removing it; its original request cannot be reconstructed.',
  },
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
  stock_removal_conflict: STOCK_CHANGED_RETRY,
  tagged_lot_conflict: STOCK_CHANGED_RETRY,
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
