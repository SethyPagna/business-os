// What a signed-in caller may read of a server failure. A database, driver or runtime error names tables, columns and
// code, so it stays in the server log; only a sentence the application wrote for the operator travels.

const RUNTIME_ERRORS = [TypeError, RangeError, ReferenceError, SyntaxError, EvalError, URIError] as const

// Artefacts of D1/SQLite and of the JavaScript runtime. An operator sentence never contains these.
const TECHNICAL_TEXT = /D1_[A-Z_]+|SQLITE|SQL logic|constraint failed|no such (?:table|column)|syntax error|near "|FOREIGN KEY|malformed JSON|Cannot read|is not a function|is not defined|is not iterable|undefined|\[object |\bat \S+ \(|ECONN|ETIMEDOUT|fetch failed|Network connection lost|internal error|D1 DB|storage operation/i

const MACHINE_CODE = /^[a-z][a-z0-9_]{0,63}$/

// Answered with fixed text when an undo, redo or stock-revert preview fails for a reason that is not a refusal.
export const ACTION_REPLAY_FAILED_CODE = 'action_replay_failed'

/** The error's own message when the application wrote it for the operator, else null (log it, answer with fixed text). */
export function authoredFailureMessage(error: unknown): string | null {
  if (!(error instanceof Error) || RUNTIME_ERRORS.some((runtime) => error instanceof runtime)) return null
  const message = String(error.message || '').trim()
  if (!message || message.length > 400 || /[\r\n]/.test(message)) return null
  const marker = error as Error & { statusCode?: unknown; status?: unknown; code?: unknown }
  // A platform code (ERR_SQLITE_ERROR, ECONNRESET) marks a driver or runtime failure; a lowercase machine code is ours.
  if (typeof marker.code === 'string') return MACHINE_CODE.test(marker.code) ? message : null
  // A refusal that names its own status is authored (UndoConflictError, SaleBulkError, ...).
  const status = Number(marker.statusCode ?? marker.status)
  if (Number.isInteger(status) && status >= 400 && status < 600) return message
  // Otherwise only a plain Error (the application's `throw new Error('...sentence...')`), and only when it reads as a sentence.
  return error.constructor === Error && !TECHNICAL_TEXT.test(message) ? message : null
}

/** The body for a failure the caller cannot act on: fixed text and a stable code, detail kept server-side. */
export function unexpectedFailureBody(scope: string, error: unknown, message: string, code: string): { error: string; code: string } {
  console.error(`[${scope}] ${message}`, error)
  return { error: message, code }
}
