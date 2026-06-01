import { STORAGE_KEYS } from '../constants'
import {
  apiFetch,
  getSyncServerUrl,
  isInvalidSessionError,
  isNetErr,
  isTransientGatewayError,
} from './http.ts'
import { localGetSettings } from './localDb.ts'
import { purgeSensitiveLiveServerMirrors } from './localMirrors.ts'
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

  await purgeSensitiveLiveServerMirrors().catch(() => {})

  if (!hasServer) {
    return buildLocalBootstrap()
  }

  try {
    return await apiFetch('GET', '/api/auth/bootstrap')
  } catch (error) {
    if (isInvalidSessionError(error)) {
      const message = readErrorField(error, 'message')
      const localBootstrap = await buildLocalBootstrap()
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
