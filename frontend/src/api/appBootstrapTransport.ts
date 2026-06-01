import { STORAGE_KEYS } from '../constants'
import {
  apiFetch,
  getSyncServerUrl,
  isInvalidSessionError,
  isNetErr,
  isTransientGatewayError,
  setSyncServerUrl,
} from './http.ts'
import { hasStoredUserSession } from './syncRuntime.ts'

type AppBootstrapPayload = {
  user: unknown
  settings: unknown
  organizationCreationEnabled: boolean
  organization: unknown
  group: unknown
  storage: unknown
  system: unknown
  unauthorized?: boolean
  authError?: string
  offline?: boolean
}

function emptyBootstrap(user: unknown = null): AppBootstrapPayload {
  return {
    user,
    settings: {},
    organizationCreationEnabled: false,
    organization: null,
    group: null,
    storage: null,
    system: null,
  }
}

function readStoredUser(): unknown {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.USER) || window.localStorage.getItem(STORAGE_KEYS.USER)
    return raw ? JSON.parse(raw) : null
  } catch (_) {
    return null
  }
}

function readErrorField(error: unknown, field: 'message' | 'status'): unknown {
  if (!error || typeof error !== 'object') return undefined
  return (error as Record<string, unknown>)[field]
}

function ensureBootstrapServerUrl(): string {
  const configured = getSyncServerUrl()
  if (configured || typeof window === 'undefined') return configured
  const location = window.location
  const isViteDev = location.hostname === 'localhost' && (location.port === '5173' || location.port === '5174')
  if (isViteDev) return ''
  const origin = String(location.origin || '').replace(/\/$/, '')
  if (origin) setSyncServerUrl(origin)
  return origin
}

function buildLocalBootstrap(): AppBootstrapPayload {
  return {
    user: readStoredUser(),
    settings: {},
    organizationCreationEnabled: false,
    organization: null,
    group: null,
    storage: null,
    system: null,
  }
}

export async function getAppBootstrap(): Promise<unknown> {
  const hasServer = Boolean(ensureBootstrapServerUrl())
  const hasStoredSession = hasStoredUserSession()

  if (!hasServer) {
    return { ...buildLocalBootstrap(), offline: true }
  }

  try {
    return await apiFetch('GET', '/api/auth/bootstrap')
  } catch (error) {
    if (isInvalidSessionError(error)) {
      const message = readErrorField(error, 'message')
      const localBootstrap = emptyBootstrap()
      const fallback = {
        ...localBootstrap,
        user: null,
      }
      if (!hasStoredSession) return fallback
      return {
        ...fallback,
        unauthorized: true,
        authError: typeof message === 'string' && message ? message : 'Please sign in again to continue.',
      }
    }
    const status = readErrorField(error, 'status')
    if (isNetErr(error) || isTransientGatewayError(status)) {
      const localBootstrap = buildLocalBootstrap()
      return {
        ...localBootstrap,
        offline: true,
      }
    }
    throw error
  }
}
