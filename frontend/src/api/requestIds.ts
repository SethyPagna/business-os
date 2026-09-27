export type RequestPayload = Record<string, unknown>

export function createClientRequestId(prefix = 'req'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function ensureClientRequestId<TPayload extends RequestPayload | null | undefined>(
  payload: TPayload,
  prefix = 'req',
): RequestPayload {
  const source: RequestPayload = payload || {}
  const current = String(source.client_request_id || '').trim()
  if (current) return { ...source, client_request_id: current.slice(0, 120) }
  return { ...source, client_request_id: createClientRequestId(prefix) }
}

// SCAN1 F2/F5: ONE request identity per operator intent. A write modal races
// its POST against a short UI timer while the fetch lives on for 45 s, so the
// "failed" attempt can still commit; the retry must therefore resend the SAME
// identity (the Worker replays its receipt) -- but only while the intent is
// unchanged: new values under an old id are a fingerprint conflict, or, where
// the Worker keys on the id alone (supplier returns), a silent replay of the
// OLD write. Clear the ref (`ref.current = null`) once the write committed.
export type IntentIdentityRef<T> = { current: { intent: string; identity: T } | null }

export function identityForIntent<T>(ref: IntentIdentityRef<T>, intent: unknown, mint: () => T): T {
  const key = JSON.stringify(intent ?? null)
  if (ref.current && ref.current.intent === key) return ref.current.identity
  const identity = mint()
  ref.current = { intent: key, identity }
  return identity
}

// An undo/redo closure's request id: stable across retries of that closure
// (actionHistory keeps a failed entry on its stack and calls the same closure
// again), rotated by settle() once it fully succeeded so the NEXT undo is a
// new request rather than a replay of the previous one.
export function retryableRequestId(prefix: string): { current(): string; settle(): void } {
  let id: string | null = null
  return {
    current: () => {
      if (!id) id = createClientRequestId(prefix)
      return id
    },
    settle: () => { id = null },
  }
}
