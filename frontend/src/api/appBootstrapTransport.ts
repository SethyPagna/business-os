import { STORAGE_KEYS } from '../constants'
import { assertNoUnresolvedSignout } from './unresolvedSignout.ts'
import { captureActorReadScope, assertActorReadScope, type ActorReadScope } from './actorReadScope.ts'
import {
  apiFetch,
  currentReadEpoch,
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

function readErrorField(error: unknown, field: 'message' | 'status' | 'code'): unknown {
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

// Sign-in, the startup probe and the permission re-check each ask for the bootstrap within the same second, and the
// page's early/embedded copy can be taken only once, so the others used to go to the network. Callers that overlap
// share one read; one that starts after a data-change invalidation (a users/roles/settings push) or under another
// account reads fresh, because the read in flight may predate that change.
let bootstrapFlight: { scope: ActorReadScope; epoch: number; promise: Promise<unknown> } | null = null

export async function getAppBootstrap(): Promise<unknown> {
  assertNoUnresolvedSignout()
  const scope = captureActorReadScope()
  const epoch = currentReadEpoch()
  const flight = bootstrapFlight
  if (flight && flight.epoch === epoch && flight.scope.authority === scope.authority && flight.scope.revision === scope.revision) {
    const shared = await flight.promise
    assertActorReadScope(scope, false)
    assertNoUnresolvedSignout()
    return typeof structuredClone === 'function' ? structuredClone(shared) : shared
  }
  const promise = readAppBootstrapOnce()
  bootstrapFlight = { scope, epoch, promise }
  void promise.finally(() => { if (bootstrapFlight?.promise === promise) bootstrapFlight = null }).catch(() => {})
  return promise
}

async function readAppBootstrapOnce(): Promise<unknown> {
  assertNoUnresolvedSignout()
  const hasServer = Boolean(ensureBootstrapServerUrl())
  const actorScope = captureActorReadScope()
  const hasStoredSession = hasStoredUserSession()

  if (!hasServer) {
    return { ...buildLocalBootstrap(), offline: true }
  }

  try {
    const embeddedBootstrapPayload = takeEmbeddedAuthBootstrapPayload()
    if (embeddedBootstrapPayload) return embeddedBootstrapPayload
    const earlyBootstrapPromise = takeEarlyAuthBootstrapPromise()
    if (earlyBootstrapPromise) {
      const payload = await earlyBootstrapPromise
      assertActorReadScope(actorScope, false)
      assertNoUnresolvedSignout()
      return payload
    }
    const payload = await apiFetch('GET', '/api/auth/bootstrap')
    assertActorReadScope(actorScope, false)
    assertNoUnresolvedSignout()
    return payload
  } catch (error) {
    assertActorReadScope(actorScope, false)
    assertNoUnresolvedSignout()
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
    // The daily database limit is not a lost connection: the shell stays up under its own banner (api/http.ts).
    if (readErrorField(error, 'code') === 'd1_daily_limit') throw error
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
