const PUBLIC_DOM_RECOVERY_KEY = 'business-os:public-dom-recovery-at'
const PUBLIC_DOM_RECOVERY_COOLDOWN_MS = 10_000

type OptionalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null

function getRecoveryStorage(storage: OptionalStorage = null): OptionalStorage {
  if (storage) return storage
  return typeof window !== 'undefined' ? window.sessionStorage : null
}

export function isPublicDomMutationError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message || error || '')
  return /removeChild|insertBefore|not a child of this node/i.test(message)
}

export function shouldAttemptPublicDomRecovery(
  pageId: unknown,
  error: unknown,
  storage: OptionalStorage = null,
  now = Date.now(),
): boolean {
  if (pageId !== 'catalog-public') return false
  if (!isPublicDomMutationError(error)) return false
  const safeStorage = getRecoveryStorage(storage)
  if (!safeStorage) return true
  const lastAttempt = Number(safeStorage.getItem(PUBLIC_DOM_RECOVERY_KEY) || 0)
  if (lastAttempt > 0 && now - lastAttempt < PUBLIC_DOM_RECOVERY_COOLDOWN_MS) return false
  safeStorage.setItem(PUBLIC_DOM_RECOVERY_KEY, String(now))
  return true
}

export function clearPublicDomRecoveryMarker(storage: OptionalStorage = null): void {
  getRecoveryStorage(storage)?.removeItem(PUBLIC_DOM_RECOVERY_KEY)
}
