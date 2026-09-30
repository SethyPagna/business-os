// Whether re-sending the same write could ever behave differently. A definite
// refusal (an HTTP 4xx the server answered with a reason) answers the same way
// every time, so offering Continue would only repeat it. What may succeed on a
// second try: no answer at all (dropped connection, timeout, a write whose
// outcome is unknown), a server fault (5xx, including gateway errors), a
// request timeout (408), or a rate limit (429).
//
// An error with neither a status nor a network signature is not retryable: it
// is a local refusal (permission, validation) that nothing on the wire can fix.
const RETRYABLE_CODES = new Set(['request_timeout', 'write_outcome_unknown'])
const NETWORK_MESSAGES = ['failed to fetch', 'load failed', 'networkerror', 'econnrefused', 'network', 'timed out']

export function isRetryableFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const failure = error as { status?: unknown; code?: unknown; outcome?: unknown; message?: unknown }
  const status = Number(failure.status)
  if (Number.isFinite(status) && status > 0) return status >= 500 || status === 408 || status === 429
  if (typeof failure.code === 'string' && RETRYABLE_CODES.has(failure.code)) return true
  if (failure.outcome === 'unknown') return true
  const message = typeof failure.message === 'string' ? failure.message.toLowerCase() : ''
  return NETWORK_MESSAGES.some((marker) => message.includes(marker))
}
