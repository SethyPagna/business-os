// Sentry error reporting -- the ONLY place in this codebase that talks to
// Sentry.
//
// Why a direct envelope POST rather than @sentry/cloudflare:
//
//   - This Worker runs on the free plan's 10ms CPU budget per invocation.
//     The SDK's value is mostly request-path instrumentation (tracing,
//     breadcrumbs, auto-context) which costs CPU on EVERY request. We need
//     error capture at two known points, not instrumentation everywhere.
//   - Reporting is fire-and-forget through waitUntil, so it must never sit
//     in the response path. That is easier to guarantee with one function
//     than with a framework integration.
//   - PII scrubbing here is a hard requirement, not a filter bolted on
//     afterwards (see scrubValue). Owning the payload shape is what makes
//     that checkable.
//
// The frontend does NOT talk to Sentry directly. It posts to
// /api/system/client-error and this module forwards it. Two reasons:
// the DSN never enters the browser bundle, and scrubbing lives in exactly
// one place instead of being implemented twice and drifting.

export type ErrorReportContext = {
  /** 'worker' or 'browser' -- which side of the stack raised it. */
  source: 'worker' | 'browser'
  /** Route or page id. Never a full URL: those carry query strings. */
  location?: string | null
  /** HTTP method, for worker reports. */
  method?: string | null
  /** Release identifier, so a stack trace maps to a known deploy. */
  release?: string | null
  /** Coarse role only -- never a username, id or email. */
  role?: string | null
}

// Keys whose VALUES are dropped outright wherever they appear. An allowlist
// would be safer still, but error payloads are arbitrary by nature, so this
// is paired with the aggressive value-level scrubbing below rather than
// relied on alone.
const SENSITIVE_KEY = /pass|secret|token|key|auth|cookie|session|phone|email|address|membership|customer|contact|name|dob|birth/i

// Value-level scrubbing. Applied to every string that survives the key
// check, because a customer's phone number can just as easily arrive inside
// a free-text error message ("no customer found for 012345678") as under a
// key called `phone`.
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g
// 6+ consecutive digits, optionally separated -- covers Cambodian phone
// numbers, membership numbers and card-like runs without being so greedy
// that it eats every product id.
const LONG_NUMBER_RE = /\b[\d][\d\s-]{5,}\d\b/g

// KNOWN LIMITATION, stated rather than papered over: a person's NAME in free
// text cannot be detected. "failed for Belie Bee" and "failed for Blue
// Widget" are the same shape, and a regex aggressive enough to catch the
// first would destroy every useful message. Emails and long digit runs are
// caught; names are not.
//
// The real guard is therefore a convention -- error messages must not
// interpolate a customer/contact name in the first place -- which
// scripts/test-error-reporting-pure.cjs enforces by grepping the routes for
// that pattern, instead of pretending the scrubber handles it.
function scrubString(value: string): string {
  return value
    .replace(EMAIL_RE, '[email]')
    .replace(LONG_NUMBER_RE, '[number]')
    .slice(0, 500)
}

/**
 * Recursively strips anything that could identify a person.
 *
 * Depth- and breadth-capped: an error payload can contain a cyclic or
 * enormous object, and a reporter that hangs or blows the CPU budget while
 * handling an error turns one failure into two.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]'
  if (value == null) return null
  if (typeof value === 'string') return scrubString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => scrubValue(entry, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    let count = 0
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (count++ >= 30) break
      if (SENSITIVE_KEY.test(key)) {
        out[key] = '[redacted]'
        continue
      }
      out[key] = scrubValue(entry, depth + 1)
    }
    return out
  }
  return '[unserializable]'
}

type ParsedDsn = { envelopeUrl: string }

/**
 * Splits a Sentry DSN into the envelope endpoint.
 * Returns null for an absent or malformed DSN -- reporting is optional and
 * must never be the reason a request fails.
 */
export function parseSentryDsn(dsn: string | undefined | null): ParsedDsn | null {
  const raw = String(dsn || '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    const publicKey = url.username
    const projectId = url.pathname.replace(/^\//, '')
    if (!publicKey || !projectId) return null
    return {
      envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7`,
    }
  } catch {
    return null
  }
}

function buildEnvelope(message: string, stack: string | null, context: ErrorReportContext): string {
  const eventId = crypto.randomUUID().replace(/-/g, '')
  const timestamp = new Date().toISOString()
  const header = JSON.stringify({ event_id: eventId, sent_at: timestamp })
  const itemHeader = JSON.stringify({ type: 'event' })
  const event = {
    event_id: eventId,
    timestamp: timestamp,
    platform: 'javascript',
    level: 'error',
    logger: context.source,
    release: context.release || undefined,
    environment: 'production',
    message: { formatted: scrubString(message) },
    // A stack trace can embed interpolated values, so it gets the same
    // treatment as any other string rather than being trusted as "just code".
    extra: scrubValue({
      stack: stack ? stack.slice(0, 4000) : null,
      location: context.location || null,
      method: context.method || null,
    }),
    // Deliberately NOT `user`: no id, username, email or IP. A coarse role
    // is enough to tell "only cashiers hit this" without identifying anyone.
    tags: {
      source: context.source,
      role: context.role || 'unknown',
    },
  }
  return `${header}\n${itemHeader}\n${JSON.stringify(event)}\n`
}

/**
 * Sends one error to Sentry. Never throws and never rejects: a reporter that
 * fails while handling an error would turn one failure into two, and it is
 * called from inside catch blocks and error handlers where nothing is left
 * to catch it.
 *
 * Returns false when reporting was skipped (no DSN configured) so callers
 * can tell "disabled" from "sent" in tests without inspecting the network.
 */
export async function reportError(
  dsn: string | undefined | null,
  error: unknown,
  context: ErrorReportContext,
): Promise<boolean> {
  const parsed = parseSentryDsn(dsn)
  if (!parsed) return false
  try {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error')
    const stack = error instanceof Error ? error.stack || null : null
    const response = await fetch(parsed.envelopeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: buildEnvelope(message, stack, context),
    })
    // Drain the body so the connection can be reused rather than held open.
    await response.body?.cancel()
    return true
  } catch {
    // Swallowed on purpose. See the docstring above.
    return false
  }
}
