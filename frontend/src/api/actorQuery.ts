import { STORAGE_KEYS } from '../constants.ts'

export interface CurrentUserContext {
  userId: number | null
  userName: string
}

export type ActorQueryParams = Record<string, unknown>

export function getCurrentUserContext(): CurrentUserContext {
  if (typeof window === 'undefined') return { userId: null, userName: '' }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.USER) || window.localStorage.getItem(STORAGE_KEYS.USER)
    if (!raw) return { userId: null, userName: '' }
    const parsed = JSON.parse(raw)
    return {
      userId: Number(parsed?.id || 0) || null,
      userName: String(parsed?.name || parsed?.username || '').trim(),
    }
  } catch (_) {
    return { userId: null, userName: '' }
  }
}

export function appendActorQuery(path: string, extra: ActorQueryParams = {}): string {
  const query = new URLSearchParams()
  const { userId, userName } = getCurrentUserContext()
  if (userId) query.set('userId', String(userId))
  if (userName) query.set('userName', userName)
  for (const key of Object.keys(extra || {})) {
    const value = extra[key]
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const queryString = query.toString()
  if (!queryString) return path
  return `${path}${path.includes('?') ? '&' : '?'}${queryString}`
}
