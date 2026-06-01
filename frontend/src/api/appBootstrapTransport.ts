import { STORAGE_KEYS } from '../constants'
import {
  apiFetch,
  getSyncServerUrl,
  isInvalidSessionError,
  isNetErr,
  isTransientGatewayError,
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

type LocalDbModule = typeof import('./localDb.ts')
type LocalMirrorsModule = typeof import('./localMirrors.ts')

const DEFERRED_MIRROR_PURGE_DELAY_MS = 45_000
const DEFERRED_MIRROR_PURGE_IDLE_TIMEOUT_MS = 60_000
let localDbModulePromise: Promise<LocalDbModule> | null = null
let localMirrorsModulePromise: Promise<LocalMirrorsModule> | null = null

function loadLocalDbModule(): Promise<LocalDbModule> {
  if (!localDbModulePromise) localDbModulePromise = import('./localDb.ts')
  return localDbModulePromise
}

function loadLocalMirrorsModule(): Promise<LocalMirrorsModule> {
  if (!localMirrorsModulePromise) localMirrorsModulePromise = import('./localMirrors.ts')
  return localMirrorsModulePromise
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

function scheduleDeferredSensitiveMirrorPurge(): void {
  if (typeof window === 'undefined') {
    loadLocalMirrorsModule().then((module) => module.purgeSensitiveLiveServerMirrors()).catch(() => {})
    return
  }

  const run = () => {
    window.setTimeout(() => {
      const purge = () => {
        if (document.visibilityState === 'hidden') return
        loadLocalMirrorsModule().then((module) => module.purgeSensitiveLiveServerMirrors()).catch(() => {})
      }
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(purge, { timeout: DEFERRED_MIRROR_PURGE_IDLE_TIMEOUT_MS })
        return
      }
      purge()
    }, DEFERRED_MIRROR_PURGE_DELAY_MS)
  }

  if (document.readyState === 'complete') {
    run()
    return
  }
  window.addEventListener('load', run, { once: true })
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

async function buildLocalBootstrap(): Promise<AppBootstrapPayload> {
  const { localGetSettings } = await loadLocalDbModule()
  return {
    user: readStoredUser(),
    settings: await localGetSettings(),
    organizationCreationEnabled: false,
    organization: null,
    group: null,
    storage: null,
    system: null,
  }
}

export async function getAppBootstrap(): Promise<unknown> {
  const hasServer = Boolean(getSyncServerUrl())
  const hasStoredSession = hasStoredUserSession()

  if (!hasServer) {
    const { purgeSensitiveLiveServerMirrors } = await loadLocalMirrorsModule()
    await purgeSensitiveLiveServerMirrors().catch(() => {})
    return buildLocalBootstrap()
  }

  scheduleDeferredSensitiveMirrorPurge()

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
      const localBootstrap = await buildLocalBootstrap()
      return {
        ...localBootstrap,
        offline: true,
      }
    }
    throw error
  }
}
