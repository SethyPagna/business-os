// The scheduled Google Drive step of the 15-minute rotation, with its collaborators injected so a test can drive every
// branch (src/index.ts wires the real ones). Import-free on purpose: nothing here touches D1, R2 or Drive itself.

export type DriveSyncCronDeps = {
  /** driveSyncScheduleDue: is the sync interval up? */
  scheduleDue: () => Promise<{ due: boolean; reason?: string }>
  /** driveSyncHasNewBackup: does R2 hold a finalized backup Drive has not been given? */
  hasNewBackup: () => Promise<{ new: boolean; reason?: string; backupKey?: string }>
  /** checkDriveSyncAuthorizer: may the user who connected Drive still take a full backup home? */
  authorize: () => Promise<{ allowed: boolean; message?: string }>
  recordError: (message: string) => Promise<void>
  /** enqueueDriveSyncJob(env, 'scheduled') */
  enqueue: () => Promise<unknown>
}

export async function runScheduledDriveSyncStep(deps: DriveSyncCronDeps): Promise<unknown> {
  const schedule = await deps.scheduleDue()
  if (!schedule.due) return schedule
  // The backup is daily, the Drive interval is not: when Drive already holds the newest finalized backup there is
  // nothing to upload, so do not even queue a job (no Drive calls, no job rows).
  const fresh = await deps.hasNewBackup()
  if (!fresh.new) return { skipped: true, reason: fresh.reason }
  // P1-2: only a destination connected by a user who may still take a
  // full backup home receives scheduled uploads (re-checked again by
  // the queue worker at run time).
  const authority = await deps.authorize()
  if (!authority.allowed) {
    await deps.recordError(authority.message ?? '')
    return authority
  }
  return deps.enqueue()
}
