// Browser storage can reject property access itself, before getItem is called.
// Auth persistence is best-effort: the server cookie remains authoritative and
// an unavailable browser store must not prevent login or clear pending work.
export function getAuthStorage(kind: 'local' | 'session'): Storage | undefined {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return undefined
  }
}
