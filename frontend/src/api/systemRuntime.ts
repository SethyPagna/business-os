import { apiFetch, route } from './http.ts'
import { SYNC } from '../constants'

const LONG_SYSTEM_ACTION_TIMEOUT_MS = 10 * 60 * 1000

export function getSystemConfig(): Promise<unknown> {
  return route('system:config', () => apiFetch('GET', '/api/system/config'), () => null)
}

export function getSystemBootstrap(): Promise<unknown> {
  return route('system:bootstrap', () => apiFetch('GET', '/api/system/bootstrap'), () => ({ config: null, debugLog: { entries: [] } }))
}

export function getSystemDebugLog(): Promise<unknown> {
  return route('system:debugLog', () => apiFetch('GET', '/api/system/debug/log'), () => ({ entries: [] }))
}

export function getIntegrationDoctor(options: { deep?: boolean; write?: boolean } = {}): Promise<unknown> {
  const params = new URLSearchParams()
  if (options.deep || options.write) params.set('deep', '1')
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return route(
    'system:integrationDoctor',
    () => apiFetch('GET', `/api/system/integration-doctor${suffix}`, undefined, SYNC.REQUEST_TIMEOUT_MS),
    undefined,
  )
}

// Both of these were previously called with NO timeout override, silently
// inheriting apiFetch's generic default (SYNC.REQUEST_TIMEOUT_MS, 12s --
// fine for an ordinary read/write, nowhere near enough for a request that
// takes a fresh backup, batch-deletes across many D1 tables, and (for
// mode='all'/factory-reset) synchronously await Promise.all()s a
// DELETE-object call per stored R2 file before it can respond at all. That
// 12s client-side abort firing well before the backend was actually done
// is exactly what produced "shows offline/failed, then a few minutes later
// it's actually finished" -- the fetch got aborted and the UI reported an
// error, but the Worker kept running server-side to completion regardless,
// so the delete really happened, the app just never found out and never
// called refreshAppData(). Given the LONG_SYSTEM_ACTION_TIMEOUT_MS this
// file already uses for its other slow one-shot system actions, these two
// get the same treatment now.
export async function resetData(mode = 'sales', options: { includeMovements?: boolean; includeSales?: boolean; includeImages?: boolean } = {}): Promise<unknown> {
  return route(
    'data:reset',
    () => apiFetch('POST', '/api/system/reset-data', { mode, ...options }, LONG_SYSTEM_ACTION_TIMEOUT_MS),
    null,
    true,
  )
}

// Single-section reset (Customers/Suppliers/Delivery contacts/Audit log --
// see cloudflare/src/routes/system.ts's POST /reset-section). Same long
// timeout as resetData/factoryReset above for the same reason: a fresh
// backup + D1 batch delete can legitimately run past apiFetch's generic
// default before the Worker responds.
export async function resetSection(section: string): Promise<unknown> {
  return route(
    'data:resetSection',
    () => apiFetch('POST', '/api/system/reset-section', { section }, LONG_SYSTEM_ACTION_TIMEOUT_MS),
    null,
    true,
  )
}

// The Worker enforces the typed phrase and the caller's current password
// itself (routes/system.ts POST /factory-reset); the browser's own checks in
// ResetData.tsx are only the first line.
export async function factoryReset(confirmation: { confirm: string; currentPassword: string }): Promise<unknown> {
  return route(
    'data:factoryReset',
    () => apiFetch('POST', '/api/system/factory-reset', confirmation, LONG_SYSTEM_ACTION_TIMEOUT_MS),
    null,
    true,
  )
}

// The two old-system-migration finalize steps (IMPORT-MANIFEST.md Step 4d
// "zero live stock" and Step 4e "park historical lots"), which used to be
// hand-typed wrangler SQL -- see cloudflare/src/routes/system.ts's POST
// /finalize-migration. Same long timeout as the resets above: each takes a
// fresh scoped backup before the UPDATE, which can run past apiFetch's
// generic default before the Worker responds.
export async function finalizeMigration(step: 'zero_stock' | 'park_lots'): Promise<unknown> {
  return route(
    'data:finalizeMigration',
    () => apiFetch('POST', '/api/system/finalize-migration', { step }, LONG_SYSTEM_ACTION_TIMEOUT_MS),
    null,
    true,
  )
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
