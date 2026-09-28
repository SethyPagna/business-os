/**
 * Resilient async loader helpers for page bootstrap.
 */

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

export function getLoaderErrorMessage(error: unknown, fallback = 'Failed to load data'): string {
  return String((error as { message?: unknown })?.message || error || fallback)
}

export function getFirstLoaderError(errors: Record<string, unknown> = {}, fallback = 'Failed to load data'): string {
  const firstError = Object.values(errors || {}).find(Boolean)
  return getLoaderErrorMessage(firstError, fallback)
}
