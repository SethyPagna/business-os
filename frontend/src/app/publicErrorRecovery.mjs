const PUBLIC_DOM_RECOVERY_KEY = 'business-os:public-dom-recovery-at'

export function isPublicDomMutationError(error) {
  const message = String(error?.message || error || '')
  return /removeChild|insertBefore|not a child of this node/i.test(message)
}

export function shouldAttemptPublicDomRecovery(pageId, error, storage = null, now = Date.now()) {
  if (pageId !== 'catalog-public') return false
  if (!isPublicDomMutationError(error)) return false
  const safeStorage = storage || (typeof window !== 'undefined' ? window.sessionStorage : null)
  if (!safeStorage) return true
  const lastAttempt = Number(safeStorage.getItem(PUBLIC_DOM_RECOVERY_KEY) || 0)
  if (lastAttempt > 0 && now - lastAttempt < 10000) return false
  safeStorage.setItem(PUBLIC_DOM_RECOVERY_KEY, String(now))
  return true
}

export function clearPublicDomRecoveryMarker(storage = null) {
  const safeStorage = storage || (typeof window !== 'undefined' ? window.sessionStorage : null)
  safeStorage?.removeItem(PUBLIC_DOM_RECOVERY_KEY)
}
