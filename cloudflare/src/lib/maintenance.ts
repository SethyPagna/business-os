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

export class MaintenanceAdmissionConflictError extends Error {
  constructor() {
    super('A restore is already in progress, or an import or bulk delete is active. Inspect jobs and maintenance before retrying.')
    this.name = 'MaintenanceAdmissionConflictError'
  }
}

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
  // Read-time observation only; not persisted in the lease or used as owner.
  revision?: string
}

async function stateRevision(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function parseState(raw: unknown): MaintenanceState | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.mode !== 'restore') return null
    for (const field of ['token', 'backupKey', 'startedAt', 'startedBy', 'updatedAt']) {
      if (typeof value[field] !== 'string' || !value[field].trim()) return null
    }
    if (!Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.updatedAt))) return null
    if (!['deleting', 'inserting', 'assets', 'failed'].includes(value.phase)) return null
    if (value.table !== undefined && typeof value.table !== 'string') return null
    if (value.error !== undefined && typeof value.error !== 'string') return null
    if (value.rowsDone !== undefined && (typeof value.rowsDone !== 'number' || !Number.isFinite(value.rowsDone) || value.rowsDone < 0)) return null
    // Construct only validated fields; do not reflect unknown stored properties
    // (including a forged read-time revision) into the API or audit records.
    return { mode: 'restore', token: value.token, backupKey: value.backupKey,
      startedAt: value.startedAt, startedBy: value.startedBy, updatedAt: value.updatedAt,
      phase: value.phase, ...(value.table !== undefined ? { table: value.table } : {}),
      ...(value.error !== undefined ? { error: value.error } : {}),
      ...(value.rowsDone !== undefined ? { rowsDone: value.rowsDone } : {}) }
  } catch {
    return null
  }
}

export async function getMaintenance(env: Env): Promise<MaintenanceState | null> {
  try {
    const row = await env.DB.prepare('SELECT value FROM system_flags WHERE key = ?')
      .bind(MAINTENANCE_FLAG_KEY).first<{ value: string }>()
    if (!row) return null
    const state: MaintenanceState = parseState(row.value) || {
      mode: 'restore', token: '', backupKey: '', startedAt: '', startedBy: '',
      phase: 'failed', updatedAt: '', error: 'Maintenance state is corrupt. An administrator must inspect and explicitly clear it.',
    }
    return { ...state, revision: await stateRevision(row.value) }
  } catch (error) {
    // Only the legacy missing-table case is compatible absence. An unavailable
    // database must not silently admit writes during a potentially held lease.
    if (/\bno such table:\s*(?:main\.)?system_flags(?:\s*:\s*SQLITE_ERROR)?\s*$/i.test(error instanceof Error ? error.message : String(error))) return null
    throw error
  }
}

// Begins maintenance; refuses if another restore already holds it (the
// caller decides whether to surface "force clear first"). Returns the state
// with the holder token the caller uses for updates/end.
export async function beginMaintenance(env: Env, input: { backupKey: string; startedBy: string }): Promise<MaintenanceState> {
  const state: MaintenanceState = {
    mode: 'restore',
    token: crypto.randomUUID(),
    backupKey: input.backupKey,
    startedAt: new Date().toISOString(),
    startedBy: input.startedBy,
    phase: 'deleting',
    updatedAt: new Date().toISOString(),
  }
  // Admission is decided by this one main-D1 write transaction, not by the
  // route's earlier advisory COUNT. A queued import/bulk job or an unexpired
  // import lease must win over restore even when its status is stale/failed.
  // Conversely, once this INSERT wins, every fenced business batch refuses.
  const result = await env.DB.prepare(`INSERT INTO system_flags (key, value, updated_at)
    SELECT ?, ?, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1 FROM import_jobs
      WHERE status IN ('pending','queued','running','analyzing','approved','applying','cancelling')
         OR julianday(lease_expires_at) > julianday('now')
    )
    AND NOT EXISTS (
      SELECT 1 FROM bulk_delete_jobs WHERE status IN ('pending','processing')
    )
    ON CONFLICT(key) DO NOTHING`)
    .bind(MAINTENANCE_FLAG_KEY, JSON.stringify(state)).run()
  if (result.meta.changes !== 1) throw new MaintenanceAdmissionConflictError()
  return state
}

export async function updateMaintenance(env: Env, token: string, patch: Partial<Pick<MaintenanceState, 'phase' | 'table' | 'rowsDone' | 'error'>>): Promise<void> {
  if (!token.trim()) return
  const row = await env.DB.prepare('SELECT value FROM system_flags WHERE key = ?')
    .bind(MAINTENANCE_FLAG_KEY).first<{ value: string }>()
  if (!row || parseState(row.value)?.token !== token) return
  // The exact validated snapshot is the CAS fence: malformed state is never
  // repaired by an old progress callback, and UPDATE cannot resurrect a clear.
  await env.DB.prepare(`UPDATE system_flags SET value = json_patch(value, ?), updated_at = CURRENT_TIMESTAMP
    WHERE key = ? AND value = ?`)
    .bind(JSON.stringify({ phase: patch.phase, table: patch.table, rowsDone: patch.rowsDone,
      error: patch.error, updatedAt: new Date().toISOString() }), MAINTENANCE_FLAG_KEY, row.value).run()
}

// Ends maintenance. Token-guarded so only the restore that began it (or a
// force clear, which passes force: true) removes it -- a concurrent begin
// attempt can never clear someone else's hold.
export async function endMaintenance(env: Env, token: string | null, options: { force?: boolean; expectedRevision?: string } = {}): Promise<boolean> {
  try {
    const row = await env.DB.prepare('SELECT value FROM system_flags WHERE key = ?')
      .bind(MAINTENANCE_FLAG_KEY).first<{ value: string }>()
    if (!row) return true
    if (options.expectedRevision !== undefined && await stateRevision(row.value) !== options.expectedRevision) return false
    if (!options.force && (!token || parseState(row.value)?.token !== token)) return false
    // Even force clear is scoped to the exact observed row. A newer holder or
    // concurrent progress change requires a fresh operator decision/retry.
    const result = await env.DB.prepare('DELETE FROM system_flags WHERE key = ? AND value = ?')
      .bind(MAINTENANCE_FLAG_KEY, row.value).run()
    return result.meta.changes === 1
  } catch {
    return false
  }
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
