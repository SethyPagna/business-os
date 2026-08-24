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

type EarlyAuthBootstrapWindow = Window & {
  __businessOsAuthBootstrapPromise?: Promise<unknown> | null
}

const EMBEDDED_AUTH_BOOTSTRAP_SCRIPT_ID = 'business-os-auth-bootstrap'

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

function takeEarlyAuthBootstrapPromise(): Promise<unknown> | null {
  if (typeof window === 'undefined') return null
  const earlyWindow = window as EarlyAuthBootstrapWindow
  const promise = earlyWindow.__businessOsAuthBootstrapPromise
  if (!promise || typeof promise.then !== 'function') return null
  earlyWindow.__businessOsAuthBootstrapPromise = null
  return promise
}

function takeEmbeddedAuthBootstrapPayload(): unknown | null {
  if (typeof document === 'undefined') return null
  const node = document.getElementById(EMBEDDED_AUTH_BOOTSTRAP_SCRIPT_ID)
  if (!node) return null
  const raw = String(node.textContent || '').trim()
  node.remove()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

export async function getAppBootstrap(): Promise<unknown> {
  const hasServer = Boolean(ensureBootstrapServerUrl())
  const hasStoredSession = hasStoredUserSession()

  if (!hasServer) {
    return { ...buildLocalBootstrap(), offline: true }
  }

  try {
    const embeddedBootstrapPayload = takeEmbeddedAuthBootstrapPayload()
    if (embeddedBootstrapPayload) return embeddedBootstrapPayload
    const earlyBootstrapPromise = takeEarlyAuthBootstrapPromise()
    if (earlyBootstrapPromise) return await earlyBootstrapPromise
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
