// Maintenance mode for the backup restore (Part-77 slice C).
//
// restoreCloudflareBackup is a streamed DELETE-then-reinsert over every
// backed-up table -- minutes long on real data, and NOT atomic (D1 batch
// limits make whole-restore atomicity impossible at this size; see the
// Part-77 finding). Without a gate, ordinary writes interleave with the
// half-restored database (a sale INSERTed after `DELETE FROM sales` but
// before products came back references rows that don't exist yet), and a
// crashed restore leaves half a database with NO marker that anything is
// wrong. The chosen design from the finding: a write-blocking maintenance
// flag + persisted restore state, import-lease spirit -- not fake atomicity.
//
// The flag lives in `system_flags` (migration 0089), NOT `settings`:
// settings is itself in BACKUP_TABLES, so the restore would delete the very
// flag guarding it. system_flags is deliberately excluded from backups.
//
// Fail-open on a missing table: peers' local databases that haven't applied
// 0089 yet (and any environment mid-rollout) must not have every write 500.
// A missing table means "maintenance cannot be on", which is true there.

import type { Env } from '../index'

export const MAINTENANCE_FLAG_KEY = 'maintenance'

export interface MaintenanceState {
  mode: 'restore'
  token: string
  backupKey: string
  startedAt: string
  startedBy: string
  // Progress -- updated as the restore streams; after a crash this shows
  // exactly where it died.
  phase: 'deleting' | 'inserting' | 'assets' | 'failed'
  table?: string
  rowsDone?: number
  error?: string
  updatedAt: string
}

function parseState(raw: unknown): MaintenanceState | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const value = JSON.parse(raw) as MaintenanceState
    return value && value.mode === 'restore' && value.token ? value : null
  } catch {
    return null
  }
}

export async function getMaintenance(env: Env): Promise<MaintenanceState | null> {
  try {
    const row = await env.DB.prepare('SELECT value FROM system_flags WHERE key = ?')
      .bind(MAINTENANCE_FLAG_KEY).first<{ value: string }>()
    return parseState(row?.value)
  } catch {
    // Fail-open: no system_flags table (pre-0089 local DB) = no maintenance.
    return null
  }
}

// Begins maintenance; refuses if another restore already holds it (the
// caller decides whether to surface "force clear first"). Returns the state
// with the holder token the caller uses for updates/end.
export async function beginMaintenance(env: Env, input: { backupKey: string; startedBy: string }): Promise<MaintenanceState> {
  const existing = await getMaintenance(env)
  if (existing) {
    throw new Error(
      `A restore is already in progress (or a crashed one was never cleared): started ${existing.startedAt} by ${existing.startedBy}, `
      + 'last phase ' + existing.phase + (existing.table ? ` on ${existing.table}` : '')
      + '. Clear maintenance first if that restore is dead.',
    )
  }
  const state: MaintenanceState = {
    mode: 'restore',
    token: crypto.randomUUID(),
    backupKey: input.backupKey,
    startedAt: new Date().toISOString(),
    startedBy: input.startedBy,
    phase: 'deleting',
    updatedAt: new Date().toISOString(),
  }
  await writeState(env, state)
  return state
}

export async function updateMaintenance(env: Env, token: string, patch: Partial<Pick<MaintenanceState, 'phase' | 'table' | 'rowsDone' | 'error'>>): Promise<void> {
  const current = await getMaintenance(env)
  if (!current || current.token !== token) return
  await writeState(env, { ...current, ...patch, updatedAt: new Date().toISOString() })
}

// Ends maintenance. Token-guarded so only the restore that began it (or a
// force clear, which passes force: true) removes it -- a concurrent begin
// attempt can never clear someone else's hold.
export async function endMaintenance(env: Env, token: string | null, options: { force?: boolean } = {}): Promise<boolean> {
  const current = await getMaintenance(env)
  if (!current) return true
  if (!options.force && current.token !== token) return false
  try {
    await env.DB.prepare('DELETE FROM system_flags WHERE key = ?').bind(MAINTENANCE_FLAG_KEY).run()
  } catch {
    return false
  }
  return true
}

async function writeState(env: Env, state: MaintenanceState): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO system_flags (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(MAINTENANCE_FLAG_KEY, JSON.stringify(state)).run()
}

// The write gate's allowlist. While a restore runs, every state-changing
// /api request is refused EXCEPT:
// - /api/auth/*     -- the admin running the restore must stay signed in,
//                      and a locked-out admin could otherwise never clear a
//                      crashed restore's flag.
// - /api/backups/*  -- the restore flow itself (begin, progress polls, the
//                      force-clear endpoint) and its system-job reads; every
//                      endpoint there is already permission-gated.
const WRITE_GATE_ALLOWLIST = ['/api/auth/', '/api/backups'] as const
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isMaintenanceGatedRequest(method: string, path: string): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) return false
  if (!path.startsWith('/api/')) return false
  return !WRITE_GATE_ALLOWLIST.some((prefix) => path.startsWith(prefix))
}
