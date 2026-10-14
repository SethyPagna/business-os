import { SYNC } from '../constants.ts'
import { apiFetch } from './http.ts'

export const LONG_SYSTEM_ACTION_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_SYSTEM_JOB_POLL_MS = 1200

export type SystemJob = Record<string, unknown> & {
  status?: string
  error?: string
  message?: string
  result?: Record<string, unknown>
}

export type SystemJobResponse = {
  item?: SystemJob
} | SystemJob

export type PollSystemJobOptions = {
  timeoutMs?: number
  pollMs?: number
  reason?: string
  onUpdate?: ((job: SystemJob) => void) | null
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function requireJobId(id: string | number | null | undefined): string {
  const value = String(id || '').trim()
  if (!value) throw new Error('Missing job id')
  return value
}

function unwrapSystemJob(result: SystemJobResponse): SystemJob {
  return ('item' in result && result.item ? result.item : result) as SystemJob
}

export async function getSystemJob(id: string | number): Promise<SystemJobResponse> {
  return apiFetch('GET', `/api/system/jobs/${encodeURIComponent(requireJobId(id))}`) as Promise<SystemJobResponse>
}

export async function cancelSystemJob(
  id: string | number,
  reason = 'Cancelled by user',
): Promise<SystemJobResponse> {
  return apiFetch(
    'POST',
    `/api/system/jobs/${encodeURIComponent(requireJobId(id))}/cancel`,
    { reason },
    SYNC.REQUEST_TIMEOUT_MS,
  ) as Promise<SystemJobResponse>
}

export async function pollSystemJob(
  jobId: string | number,
  {
    timeoutMs = LONG_SYSTEM_ACTION_TIMEOUT_MS,
    pollMs = DEFAULT_SYSTEM_JOB_POLL_MS,
    reason = 'system-job',
    onUpdate = null,
  }: PollSystemJobOptions = {},
): Promise<Record<string, unknown>> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const item = unwrapSystemJob(await getSystemJob(jobId))
    onUpdate?.(item)
    if (item.status === 'completed') {
      return {
        success: true,
        job: item,
        ...(item.result || {}),
      }
    }
    if (item.status === 'failed' || item.status === 'cancelled') {
      throw new Error(item.error || item.message || `${reason} failed`)
    }
    await wait(pollMs)
  }
  throw new Error(`${reason} is still running. Check the Backup page or server logs for progress.`)
}

export async function queueBackupFolderExport(destinationDir = ''): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    type: 'export-folder',
  }
  const safeDestination = String(destinationDir || '').trim()
  if (safeDestination) payload.destinationDir = safeDestination
  return apiFetch('POST', '/api/backups', payload, SYNC.REQUEST_TIMEOUT_MS) as Promise<Record<string, unknown>>
}

export async function exportBackupFolder(destinationDir = ''): Promise<Record<string, unknown>> {
  return queueBackupFolderExport(destinationDir)
}

export async function queueBackupFolderRestore(sourceDir: string, confirmation: { currentPassword: string }): Promise<Record<string, unknown>> {
  if (!confirmation?.currentPassword) throw new Error('Restoring a backup requires the current password.')
  return apiFetch('POST', '/api/backups', {
    type: 'import-folder',
    sourceDir,
    currentPassword: confirmation.currentPassword,
  }, SYNC.REQUEST_TIMEOUT_MS) as Promise<Record<string, unknown>>
}

export async function importBackupFolder(sourceDir: string, confirmation: { currentPassword: string }): Promise<Record<string, unknown>> {
  return queueBackupFolderRestore(sourceDir, confirmation)
}

// Restore maintenance (Part-77 slice C): while a restore runs -- or after
// one crashed -- the server refuses ordinary writes and this state says
// where it stands. Clear is force-only by design (server-enforced too).
export type RestoreMaintenanceState = {
  mode?: string
  phase?: string
  table?: string
  rowsDone?: number
  error?: string
  backupKey?: string
  startedAt?: string
  startedBy?: string
  updatedAt?: string
} | null

// 503 from a restore that wrote every row but could not record its audit row. The Worker leaves maintenance ON (phase
// failed) until an administrator clears it and runs the same restore again. The data IS restored, so this is not an
// ordinary failed import.
export const RESTORE_AUDIT_NOT_RECORDED_CODE = 'restore_audit_not_recorded'

// The maintenance state the Worker leaves behind carries no code, only its sentence, and that is all a reload (or a
// lost response) can read. The banner recognises the state by the sentence's own first words, pinned to the Worker's
// text by tests/backupRestoreAuditNotRecorded.test.ts; if the wording ever changes the state falls back to the
// crashed-restore banner, which has the same way out.
const RESTORE_AUDIT_NOT_RECORDED_STATE_TEXT = 'Backup data was restored, but the restore could not be recorded in the audit log.'

export function isRestoreAuditNotRecordedError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === RESTORE_AUDIT_NOT_RECORDED_CODE
}

export function isRestoreAuditNotRecordedState(state: RestoreMaintenanceState): boolean {
  return state?.phase === 'failed' && typeof state.error === 'string' && state.error.startsWith(RESTORE_AUDIT_NOT_RECORDED_STATE_TEXT)
}

export async function getBackupMaintenance(): Promise<{ maintenance: RestoreMaintenanceState }> {
  return apiFetch('GET', '/api/backups/maintenance') as Promise<{ maintenance: RestoreMaintenanceState }>
}

export async function clearBackupMaintenance(currentPassword: string): Promise<Record<string, unknown>> {
  return apiFetch('POST', '/api/backups/maintenance/clear', { force: true, currentPassword }, SYNC.REQUEST_TIMEOUT_MS) as Promise<Record<string, unknown>>
}
