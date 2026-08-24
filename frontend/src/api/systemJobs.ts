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

export async function queueBackupFolderRestore(sourceDir: string): Promise<Record<string, unknown>> {
  return apiFetch('POST', '/api/backups', {
    type: 'import-folder',
    sourceDir,
  }, SYNC.REQUEST_TIMEOUT_MS) as Promise<Record<string, unknown>>
}

export async function importBackupFolder(sourceDir: string): Promise<Record<string, unknown>> {
  return queueBackupFolderRestore(sourceDir)
}
