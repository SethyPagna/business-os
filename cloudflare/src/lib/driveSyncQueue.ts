import type { Env } from '../index'
import { getSystemJob, storeSystemJob } from './backup'
import { pushBackupToDrive, stageLatestDriveBackupToR2 } from './googleDrive'

export type DriveSyncQueueMessage = {
  kind: 'drive-sync'
  jobId: string
} | {
  kind: 'drive-restore-stage'
  jobId: string
}

const ACTIVE_DRIVE_SYNC_JOB_KEY = 'system-active:google-drive-sync'
const ACTIVE_DRIVE_RESTORE_STAGE_JOB_KEY = 'system-active:google-drive-restore-stage'

async function clearActiveJob(env: Env, jobId: string): Promise<void> {
  const activeId = await env.CACHE.get(ACTIVE_DRIVE_SYNC_JOB_KEY)
  if (activeId === jobId) await env.CACHE.delete(ACTIVE_DRIVE_SYNC_JOB_KEY)
}

async function clearActiveRestoreStageJob(env: Env, jobId: string): Promise<void> {
  const activeId = await env.CACHE.get(ACTIVE_DRIVE_RESTORE_STAGE_JOB_KEY)
  if (activeId === jobId) await env.CACHE.delete(ACTIVE_DRIVE_RESTORE_STAGE_JOB_KEY)
}

export async function enqueueDriveSyncJob(
  env: Env,
  source: 'manual' | 'scheduled',
): Promise<Record<string, unknown>> {
  if (!env.BACKUP_QUEUE) {
    throw new Error('Google Drive background queue is not configured.')
  }
  const activeId = await env.CACHE.get(ACTIVE_DRIVE_SYNC_JOB_KEY)
  if (activeId) {
    const active = await getSystemJob(env, activeId)
    if (active && (active.status === 'queued' || active.status === 'running')) return active
  }
  const now = new Date().toISOString()
  const job = await storeSystemJob(env, {
    id: crypto.randomUUID(),
    type: 'google-drive-sync',
    source,
    status: 'queued',
    progress: 0,
    message: 'Google Drive sync queued',
    created_at: now,
  })
  await env.CACHE.put(ACTIVE_DRIVE_SYNC_JOB_KEY, String(job.id), { expirationTtl: 60 * 60 })
  try {
    await env.BACKUP_QUEUE.send({ kind: 'drive-sync', jobId: String(job.id) } satisfies DriveSyncQueueMessage)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not enqueue Google Drive sync.'
    await storeSystemJob(env, { ...job, status: 'failed', progress: 100, message, error: message })
    await clearActiveJob(env, String(job.id))
    throw error
  }
  return job
}

export async function runQueuedDriveSync(env: Env, jobId: string): Promise<void> {
  const existing = await getSystemJob(env, jobId)
  if (!existing) throw new Error(`Google Drive sync job ${jobId} was not found.`)
  if (existing.status === 'cancelled' || existing.status === 'completed') {
    await clearActiveJob(env, jobId)
    return
  }

  await storeSystemJob(env, {
    ...existing,
    status: 'running',
    progress: 10,
    message: 'Uploading the newest finalized backup to Google Drive',
    error: null,
    started_at: existing.started_at || new Date().toISOString(),
  })

  const result = await pushBackupToDrive(env)
  if (!result.success) {
    const message = result.error || 'Google Drive sync failed.'
    await storeSystemJob(env, {
      ...existing,
      status: 'failed',
      progress: 100,
      message,
      error: message,
      finished_at: new Date().toISOString(),
    })
    // Throw so Cloudflare Queues applies its configured bounded retry budget.
    // The persisted failed state remains truthful if every retry is exhausted.
    throw new Error(message)
  }

  await storeSystemJob(env, {
    ...existing,
    status: 'completed',
    progress: 100,
    message: `Uploaded ${result.fileName || 'backup'} to Google Drive.`,
    error: null,
    finished_at: new Date().toISOString(),
    result: {
      success: true,
      uploaded: 1,
      updated: 0,
      skipped: 0,
      fileId: result.fileId || null,
      fileName: result.fileName || null,
    },
  })
  await clearActiveJob(env, jobId)
}

export async function enqueueDriveRestoreStageJob(env: Env): Promise<Record<string, unknown>> {
  if (!env.BACKUP_QUEUE) throw new Error('Google Drive restore staging queue is not configured.')
  const activeId = await env.CACHE.get(ACTIVE_DRIVE_RESTORE_STAGE_JOB_KEY)
  if (activeId) {
    const active = await getSystemJob(env, activeId)
    if (active && (active.status === 'queued' || active.status === 'running')) return active
  }
  const now = new Date().toISOString()
  const job = await storeSystemJob(env, {
    id: crypto.randomUUID(),
    type: 'google-drive-restore-stage',
    source: 'manual',
    status: 'queued',
    progress: 0,
    message: 'Google Drive restore staging queued',
    created_at: now,
  })
  await env.CACHE.put(ACTIVE_DRIVE_RESTORE_STAGE_JOB_KEY, String(job.id), { expirationTtl: 60 * 60 })
  try {
    await env.BACKUP_QUEUE.send({ kind: 'drive-restore-stage', jobId: String(job.id) } satisfies DriveSyncQueueMessage)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not enqueue Google Drive restore staging.'
    await storeSystemJob(env, { ...job, status: 'failed', progress: 100, message, error: message })
    await clearActiveRestoreStageJob(env, String(job.id))
    throw error
  }
  return job
}

export async function runQueuedDriveRestoreStage(env: Env, jobId: string): Promise<void> {
  const existing = await getSystemJob(env, jobId)
  if (!existing) throw new Error(`Google Drive restore staging job ${jobId} was not found.`)
  if (existing.status === 'cancelled' || existing.status === 'completed') {
    await clearActiveRestoreStageJob(env, jobId)
    return
  }
  await storeSystemJob(env, {
    ...existing,
    status: 'running',
    progress: 20,
    message: 'Finding the newest finalized app-owned Drive backup',
    error: null,
    started_at: existing.started_at || new Date().toISOString(),
  })
  try {
    const result = await stageLatestDriveBackupToR2(env)
    const latest = await getSystemJob(env, jobId)
    if (latest?.status === 'cancelled') {
      await env.ASSETS.delete(result.backupKey)
      await clearActiveRestoreStageJob(env, jobId)
      return
    }
    await storeSystemJob(env, {
      ...existing,
      status: 'completed',
      progress: 100,
      message: 'Drive backup staged and validated in R2. No live data was restored.',
      error: null,
      finished_at: new Date().toISOString(),
      result,
    })
    await clearActiveRestoreStageJob(env, jobId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Drive restore staging failed.'
    await storeSystemJob(env, {
      ...existing,
      status: 'failed',
      progress: 100,
      message,
      error: message,
      finished_at: new Date().toISOString(),
    })
    throw error
  }
}
