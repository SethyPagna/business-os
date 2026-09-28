// SCAN1 F2/F5: a write modal races its POST against a short UI timer while
// the fetch lives on for up to 45 s (api/http.ts WRITE_REQUEST_TIMEOUT_MS), so
// the "failed" attempt can still commit. These helpers make the operator's
// retry a replay instead of a second write. Admin write modals only: this
// module stays out of loaders.ts / requestIds.ts, which ship to the storefront.

import { DEFAULT_LOADER_TIMEOUT_MS } from './loaders.ts'
import { presentWriteError, type WriteErrorTranslator } from './writeErrorPresentation.ts'
import { createClientRequestId } from '../api/requestIds.ts'

// ONE request identity per operator intent: the retry resends the SAME
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

// withLoaderTimeout only stops WAITING; nothing aborts the fetch. "Please try
// again" is therefore wrong for a write -- it may already have committed. A
// write's timeout says the outcome is unknown and to check before retrying,
// in the active language (the shared write_outcome_unknown_timeout pack
// sentence), and keeps code 'loader_timeout' plus outcome 'unknown' for
// presentWriteError / directMutationOutcomeIsUnknown.
export function createWriteTimeoutError(
  label: unknown,
  timeoutMs: number,
  t: WriteErrorTranslator = () => undefined,
): Error & { code: string; outcome: 'unknown'; timeoutMs: number; label: string } {
  const detail = presentWriteError({ outcome: 'unknown', timeoutMs }, t).detail
  const error = new Error(detail) as Error & { code: string; outcome: 'unknown'; timeoutMs: number; label: string }
  error.name = 'LoaderTimeoutError'
  error.code = 'loader_timeout'
  error.outcome = 'unknown'
  error.timeoutMs = timeoutMs
  error.label = String(label || 'Request')
  return error
}

// Only THIS timer's expiry is reworded: a refusal, or any error the loader
// itself throws, is a known outcome and passes through untouched.
export async function withWriteTimeout<T>(
  loader: () => T | Promise<T>,
  label = 'Request',
  timeoutMs = DEFAULT_LOADER_TIMEOUT_MS,
  t?: WriteErrorTranslator,
): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null
  try {
    return await Promise.race([
      Promise.resolve(loader()),
      new Promise<never>((_, reject) => {
        timer = globalThis.setTimeout(() => reject(createWriteTimeoutError(label, timeoutMs, t)), timeoutMs)
      }),
    ])
  } finally {
    if (timer != null) {
      globalThis.clearTimeout(timer)
    }
  }
}
