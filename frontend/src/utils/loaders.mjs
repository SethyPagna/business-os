/**
 * Resilient async loader helpers for page bootstrap.
 *
 * Goal:
 * - let pages consume partial results when one request is slow or fails
 * - keep notification/reporting consistent
 * - reduce repeated Promise.allSettled boilerplate in feature pages
 */

export async function settleLoaderMap(loaders = {}) {
  const entries = Object.entries(loaders).filter(([, loader]) => typeof loader === 'function')
  const settled = await Promise.allSettled(entries.map(([key, loader]) => withLoaderTimeout(loader, key)))

  const values = {}
  const errors = {}

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

export function beginTrackedRequest(ref) {
  const nextId = (Number(ref?.current) || 0) + 1
  if (ref) ref.current = nextId
  return nextId
}

export function isTrackedRequestCurrent(ref, requestId) {
  return Number(ref?.current) === Number(requestId)
}

export function invalidateTrackedRequest(ref) {
  if (!ref) return 0
  ref.current = (Number(ref.current) || 0) + 1
  return ref.current
}

const DEFAULT_LOADER_TIMEOUT_MS = 12_000

export function createLoaderTimeoutError(label, timeoutMs = DEFAULT_LOADER_TIMEOUT_MS) {
  const error = new Error(`${label || 'Request'} took longer than ${Math.round(timeoutMs / 1000)}s. Please try again.`)
  error.name = 'LoaderTimeoutError'
  error.code = 'loader_timeout'
  return error
}

export async function withLoaderTimeout(loaderOrPromise, label = 'Request', timeoutMs = DEFAULT_LOADER_TIMEOUT_MS) {
  let timer = null
  try {
    const promise = typeof loaderOrPromise === 'function' ? loaderOrPromise() : loaderOrPromise
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(createLoaderTimeoutError(label, timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timer != null) {
      window.clearTimeout(timer)
    }
  }
}

export function getLoaderErrorMessage(error, fallback = 'Failed to load data') {
  return error?.message || String(error || fallback)
}

export function getFirstLoaderError(errors = {}, fallback = 'Failed to load data') {
  const firstError = Object.values(errors || {}).find(Boolean)
  return getLoaderErrorMessage(firstError, fallback)
}
