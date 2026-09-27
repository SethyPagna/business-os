/**
 * Resilient async loader helpers for page bootstrap.
 */

import { presentWriteError, type WriteErrorTranslator } from './writeErrorPresentation.ts'

type LoaderMap = Record<string, (() => unknown | Promise<unknown>) | unknown>

type LoaderResult = {
  values: Record<string, unknown>
  errors: Record<string, unknown>
  hasAnySuccess: boolean
  hasErrors: boolean
}

type MutableRef<T> = {
  current: T
} | null | undefined

export const DEFAULT_LOADER_TIMEOUT_MS = 20_000

export async function settleLoaderMap(loaders: LoaderMap = {}): Promise<LoaderResult> {
  const entries = Object.entries(loaders).filter(([, loader]) => typeof loader === 'function') as Array<[
    string,
    () => unknown | Promise<unknown>,
  ]>
  const settled = await Promise.allSettled(entries.map(([key, loader]) => withLoaderTimeout(loader, key)))

  const values: Record<string, unknown> = {}
  const errors: Record<string, unknown> = {}

  settled.forEach((result, index) => {
    const [key] = entries[index]
    if (result.status === 'fulfilled') {
      values[key] = result.value
    } else {
      errors[key] = result.reason
    }
  })

  return {
    values,
    errors,
    hasAnySuccess: Object.keys(values).length > 0,
    hasErrors: Object.keys(errors).length > 0,
  }
}

export function beginTrackedRequest(ref: MutableRef<number>): number {
  const nextId = (Number(ref?.current) || 0) + 1
  if (ref) ref.current = nextId
  return nextId
}

export function isTrackedRequestCurrent(ref: MutableRef<number>, requestId: unknown): boolean {
  return Number(ref?.current) === Number(requestId)
}

export function invalidateTrackedRequest(ref: MutableRef<number>): number {
  if (!ref) return 0
  ref.current = (Number(ref.current) || 0) + 1
  return ref.current
}

export function createLoaderTimeoutError(label: unknown, timeoutMs = DEFAULT_LOADER_TIMEOUT_MS): Error & { code: string } {
  const error = new Error(`${label || 'Request'} took longer than ${Math.round(timeoutMs / 1000)}s. Please try again.`) as Error & { code: string }
  error.name = 'LoaderTimeoutError'
  error.code = 'loader_timeout'
  return error
}

export async function withLoaderTimeout<T>(
  loaderOrPromise: (() => T | Promise<T>) | T | Promise<T>,
  label = 'Request',
  timeoutMs = DEFAULT_LOADER_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null
  try {
    const promise = typeof loaderOrPromise === 'function'
      ? (loaderOrPromise as () => T | Promise<T>)()
      : loaderOrPromise
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timer = globalThis.setTimeout(() => reject(createLoaderTimeoutError(label, timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timer != null) {
      globalThis.clearTimeout(timer)
    }
  }
}

// SCAN1 F2/F5: the timer above only stops WAITING; nothing aborts the fetch,
// and a write keeps going for up to 45 s (api/http.ts WRITE_REQUEST_TIMEOUT_MS)
// after a 12-15 s UI timer gave up. "Please try again" was therefore wrong for
// a write -- it may already have committed. A write's timeout says the outcome
// is unknown and to check before retrying, in the active language (the shared
// write_outcome_unknown_timeout pack sentence), and keeps code 'loader_timeout'
// plus outcome 'unknown' for presentWriteError / directMutationOutcomeIsUnknown.
// Pair it with one request id per intent (api/requestIds.ts identityForIntent)
// so the operator's retry replays instead of applying twice.
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

export function getLoaderErrorMessage(error: unknown, fallback = 'Failed to load data'): string {
  return String((error as { message?: unknown })?.message || error || fallback)
}

export function getFirstLoaderError(errors: Record<string, unknown> = {}, fallback = 'Failed to load data'): string {
  const firstError = Object.values(errors || {}).find(Boolean)
  return getLoaderErrorMessage(firstError, fallback)
}
