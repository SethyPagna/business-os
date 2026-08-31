import { Hono } from 'hono'
import type { Env } from '../index'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission } from '../lib/permissions'
import {
  CLOUDFLARE_BACKUP_KEEP,
  createCloudflareBackup,
  getSystemJob,
  linkCloudflareBackupJob,
  listCloudflareBackups,
  pruneCloudflareBackups,
  restoreCloudflareBackup,
  storeSystemJob,
  validateCloudflareBackup,
} from '../lib/backup'
import { beginMaintenance, endMaintenance, getMaintenance, updateMaintenance } from '../lib/maintenance'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

app.use('*', requireAuth)
// Legacy gates every backup endpoint behind the `backup` permission -- this
// Worker only checked requireAuth (any logged-in user), which is a real gap:
// any staff account could trigger/list backups or (via the restore path
// further below) roll the whole database back. Router-wide gate here
// covers list/export/dry-run-validate; the actual destructive restore
// branch below additionally requires `backup_restore` specifically -- see
// lib/permissions.ts's comment on why that key deliberately does NOT fall
// back from plain `backup` the way it used to. Without that extra check,
// granting someone "Backup export" (sensitivity: high, meant for e.g. an
// ops person who just needs to download backups) silently also granted
// full database restore/wipe power (sensitivity: critical in the Roles
// UI) -- confirmed and fixed this session, not a hypothetical.
app.use('*', async (c, next) => {
  const user = c.get('user')
  if (!hasPermission(user, 'backup')) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
})

function completedJob(message: string, result: Record<string, unknown>) {
  const id = crypto.randomUUID()
  return {
    id,
    status: 'completed',
    progress: 100,
    message,
    result,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

app.get('/', async (c) => {
  const items = await listCloudflareBackups(c.env)
  return c.json({
    items,
    total: items.length,
    schedule: {
      runtime: 'cloudflare-workers',
      intervalHours: 6,
      keep: CLOUDFLARE_BACKUP_KEEP,
      destination: 'R2 business-os-assets/backups/cloudflare/',
    },
  })
})

// Maintenance state (slice C). GET is under the router-wide `backup` gate --
// seeing that a restore is running isn't destructive. Clearing is: it lets
// writes back into a possibly half-restored database, so it demands the
// same `backup_restore` permission as the restore itself, and an explicit
// force flag so no client clears it as a reflex.
app.get('/maintenance', async (c) => {
  const maintenance = await getMaintenance(c.env)
  return c.json({ maintenance })
})

app.post('/maintenance/clear', async (c) => {
  const user = c.get('user')
  if (!hasPermission(user, 'backup_restore')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = (await c.req.json<{ force?: boolean }>().catch(() => ({}))) as { force?: boolean }
  const maintenance = await getMaintenance(c.env)
  if (!maintenance) return c.json({ cleared: true, wasSet: false })
  if (body.force !== true) {
    return c.json({
      error: 'Clearing maintenance re-opens writes on a database whose restore did not finish. '
        + 'Pass force: true only if you accept the half-restored state (or restart the restore instead).',
      maintenance,
    }, 400)
  }
  await endMaintenance(c.env, null, { force: true })
  await audit(c.env, user.id, user.username || null, 'update', 'backup', 'maintenance-clear', {
    cleared_state: maintenance,
  })
  return c.json({ cleared: true, wasSet: true })
})

app.post('/', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const type = String(body.type || '').trim()
  try {
    if (type === 'export-folder' || type === 'export-cloudflare' || !type) {
      const backup = await createCloudflareBackup(c.env, 'manual')
      const retention = await pruneCloudflareBackups(c.env, CLOUDFLARE_BACKUP_KEEP)
      const jobId = crypto.randomUUID()
      const totalAssets = backup.summary.assetCount
      const copiedAssets = backup.summary.assetsBackedUp
      const running = backup.status === 'copying'
      const failed = backup.status === 'partial'
      const job = await storeSystemJob(c.env, {
        id: jobId,
        status: running ? 'running' : failed ? 'failed' : 'completed',
        progress: running && totalAssets ? Math.max(5, Math.min(99, Math.round((copiedAssets / totalAssets) * 100))) : 100,
        message: running
          ? `Cloudflare backup copying assets (${copiedAssets}/${totalAssets})`
          : failed
            ? 'Cloudflare backup manifest was created, but full asset coverage requires the backup queue.'
            : 'Cloudflare backup finalized',
        error: failed ? 'Full asset backup is unavailable because BACKUP_QUEUE is not configured.' : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: {
          success: !failed,
          packageId: backup.name,
          backupKey: backup.key,
          backup,
          retention,
        },
      })
      await linkCloudflareBackupJob(c.env, backup.name.replace(/\.json$/, ''), jobId)
      await audit(c.env, user.id, user.username || null, 'create', 'backup', backup.name, {
        status: backup.status,
        assets_backed_up: copiedAssets,
        asset_count: totalAssets,
      })
      const currentJob = await getSystemJob(c.env, jobId) || job
      return c.json(
        { job_id: currentJob.id, item: currentJob },
        running ? 202 : failed ? 503 : 200,
      )
    }

    if (type === 'import-folder') {
      if (!hasPermission(user, 'backup_restore')) {
        return c.json({ error: 'You do not have permission to perform this action' }, 403)
      }
      const sourceDir = String(body.sourceDir || '').trim()
      if (!sourceDir) return c.json({ error: 'Missing backup key or backup file name' }, 400)
      if (body.dryRun === true) {
        // Dry-run validation doesn't touch live data -- kept under the
        // router-wide `backup` gate above rather than requiring
        // `backup_restore` too, same reasoning as list/export: someone
        // deciding whether a backup file is valid isn't yet doing anything
        // destructive.
        const validation = await validateCloudflareBackup(c.env, sourceDir)
        const job = await storeSystemJob(c.env, completedJob('Cloudflare backup validated', {
          success: true,
          packageId: validation.key.replace(/^backups\/cloudflare\//, ''),
          validation,
        }))
        return c.json({ job_id: job.id, item: job })
      }
      // Slice C (Part-77): the restore runs under a write-blocking
      // maintenance flag (lib/maintenance.ts + the index.ts gate) with its
      // progress persisted into the flag -- a crash mid-restore leaves
      // maintenance ON, pointing at exactly where it died, instead of a
      // silently half-restored database serving writes. Refused while any
      // import job is active: import queue consumers write outside the HTTP
      // gate, so an in-flight apply would interleave with the restore.
      const activeImports = await c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM import_jobs WHERE status IN ('pending','queued','running','analyzing','approved','applying','cancelling')",
      ).first<{ n: number }>().catch(() => null)
      if (Number(activeImports?.n || 0) > 0) {
        return c.json({
          error: `${activeImports!.n} import job(s) are still active. Wait for them to finish (or cancel them) before restoring -- their queued writes would interleave with the restore.`,
        }, 409)
      }
      const maintenance = await beginMaintenance(c.env, {
        backupKey: sourceDir,
        startedBy: user.username || String(user.id || 'unknown'),
      })
      let restore: Awaited<ReturnType<typeof restoreCloudflareBackup>>
      try {
        restore = await restoreCloudflareBackup(c.env, sourceDir, async (progress) => {
          await updateMaintenance(c.env, maintenance.token, progress)
        })
      } catch (error) {
        // Leave maintenance SET -- the database is half-restored and must
        // not quietly serve writes. Record where it died; the admin either
        // restarts the restore (safe: full delete+reinsert) or force-clears.
        const message = error instanceof Error ? error.message : 'Restore failed'
        await updateMaintenance(c.env, maintenance.token, { phase: 'failed', error: message })
        throw error
      }
      await endMaintenance(c.env, maintenance.token)
      // The whole database just rolled back to this backup -- the single most
      // consequential action in the app, and until now the one with no trail.
      await audit(c.env, user.id, user.username || null, 'restore', 'backup', sourceDir, {
        restored_key: restore.key,
      })
      const job = await storeSystemJob(c.env, completedJob('Cloudflare backup restored', {
        success: true,
        packageId: restore.key.replace(/^backups\/cloudflare\//, ''),
        restore,
      }))
      return c.json({ job_id: job.id, item: job })
    }

    return c.json({ error: `Unsupported backup action: ${type}` }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backup action failed'
    const job = await storeSystemJob(c.env, {
      id: crypto.randomUUID(),
      status: 'failed',
      progress: 100,
      message,
      error: message,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    return c.json({ job_id: job.id, item: job, error: message }, 500)
  }
})

export default app
