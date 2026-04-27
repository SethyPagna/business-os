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
  const settled = await Promise.allSettled(entries.map(([, loader]) => loader()))

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

export function getLoaderErrorMessage(error, fallback = 'Failed to load data') {
  return error?.message || String(error || fallback)
}

export function getFirstLoaderError(errors = {}, fallback = 'Failed to load data') {
  const firstError = Object.values(errors || {}).find(Boolean)
  return getLoaderErrorMessage(firstError, fallback)
}
