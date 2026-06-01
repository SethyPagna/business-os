import { apiFetch, route } from './http.ts'

type SystemPayload = Record<string, unknown>

const LONG_SYSTEM_ACTION_TIMEOUT_MS = 10 * 60 * 1000

export async function resetData(mode = 'sales'): Promise<unknown> {
  return route(
    'data:reset',
    () => apiFetch('POST', '/api/system/reset-data', { mode }),
    null,
    true,
  )
}

export async function factoryReset(): Promise<unknown> {
  return route(
    'data:factoryReset',
    () => apiFetch('POST', '/api/system/factory-reset'),
    null,
    true,
  )
}

export async function openPath(targetPath: string): Promise<unknown> {
  try {
    return await apiFetch('POST', '/api/system/open-path', { path: targetPath })
  } catch (error) {
    return { success: false, error: (error as { message?: string })?.message || 'Failed to open path' }
  }
}

export async function testSyncServer(url: string): Promise<unknown> {
  try {
    const clean = String(url || '').trim().replace(/\/$/, '')
    const timeoutSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(6000)
      : undefined
    const res = await fetch(`${clean}/health`, {
      signal: timeoutSignal,
      headers: { 'bypass-tunnel-reminder': 'true' },
    })
    if (!res.ok) return { ok: false, message: `Server returned ${res.status}` }
    const json = await res.json().catch(() => ({}))
    return { ok: true, clients: (json as { clients?: unknown })?.clients ?? null }
  } catch (error) {
    return { ok: false, message: (error as { message?: string })?.message || 'Connection failed' }
  }
}

export async function openFolderDialog(initialPath = ''): Promise<unknown> {
  const result = await route(
    'system:pickFolder',
    () => apiFetch('POST', '/api/system/pick-folder', { initialPath }, LONG_SYSTEM_ACTION_TIMEOUT_MS),
    () => ({ selectedPath: null, cancelled: true }),
  )
  if ((result as { success?: boolean; error?: string } | null)?.success === false) {
    throw new Error((result as { error?: string })?.error || 'Failed to open folder picker')
  }
  return (result as { selectedPath?: string | null } | null)?.selectedPath || null
}

export function getDataPath(): Promise<unknown> {
  return route('system:dataPath', () => apiFetch('GET', '/api/system/data-path'), () => ({}))
}

export function getScaleMigrationStatus(): Promise<unknown> {
  return route('system:scaleMigrationStatus', () => apiFetch('GET', '/api/system/scale-migration/status'), () => ({ item: null }))
}

export function prepareScaleMigration(): Promise<unknown> {
  return route(
    'system:scaleMigrationPrepare',
    () => apiFetch('POST', '/api/system/scale-migration/prepare', {}, LONG_SYSTEM_ACTION_TIMEOUT_MS),
    null,
    true,
  )
}

export function runScaleMigration(payload: SystemPayload = {}): Promise<unknown> {
  return route(
    'system:scaleMigrationRun',
    () => apiFetch('POST', '/api/system/scale-migration/run', payload, LONG_SYSTEM_ACTION_TIMEOUT_MS),
    null,
    true,
  )
}

export async function setDataPath(dir: string): Promise<unknown> {
  return route(
    'system:setDataPath',
    () => apiFetch('POST', '/api/system/data-path', { dataDir: dir }, LONG_SYSTEM_ACTION_TIMEOUT_MS),
    null,
    true,
  )
}

export async function resetDataPath(): Promise<unknown> {
  return route(
    'system:resetDataPath',
    () => apiFetch('DELETE', '/api/system/data-path', undefined, LONG_SYSTEM_ACTION_TIMEOUT_MS),
    null,
    true,
  )
}

export function browseDir(dir: string): Promise<unknown> {
  return route('system:browseDir', () => apiFetch('POST', '/api/system/browse-dir', { dir }), () => ({ dirs: [] }))
}
