// Product jobs remove only zero-stock products, committing one tier-sized
// chunk with its progress and audits per queue delivery. Cache invalidation
// follows each commit and can be repeated without replaying business writes.
// Other entities retain their legacy loop through the same queue/polling flow.

import type { Env } from '../index'
import { getDb, getImportFencedDb, isImportMaintenanceFenceError, type D1Compat } from './db'
import { getPlanLimits } from './planTier'
import { dispatchImportWork } from './queueDispatch'
import { chunkForBinding } from './sqlBinding'
import { runD1BatchInChunks } from './importEngine'
import { stockedProductIds, productStockGuardStatement, PRODUCT_HAS_STOCK_CODE } from './productStockGuard'
import { bumpVersion } from './cache'
import { broadcast, type BroadcastChannel } from '../durable-objects/broadcastHub'
import { actorSnapshot } from './actorSnapshot'
import { customerIsAnonymousSql } from './anonymousCustomer'

export type BulkDeleteEntityType = 'products' | 'customers' | 'suppliers' | 'delivery_contacts'

type D1Statement = { sql: string; params: Record<string, unknown> }

interface EntityConfig {
  table: string
  idColumn: string
  auditEntity: string
  cacheKey: BroadcastChannel
  // 'soft' (default-shaped like products: UPDATE is_active=0, row stays
  // for history/reporting) vs 'hard' (real DELETE -- customers/suppliers/
  // delivery_contacts have no is_active column at all, same as their
  // existing single-row DELETE routes in routes/contacts.ts). Matches
  // each entity's existing single-delete route exactly, deliberately --
  // this module doesn't invent stricter semantics (e.g. blocking a
  // customer delete that still has sales referencing it) than the route
  // it's batching already has; contacts.ts's own DELETE /:id has never
  // checked for that either, so a dangling customer_id after a hard
  // delete is pre-existing behavior, not a new gap this introduces.
  deleteMode: 'soft' | 'hard'
  // Entity-specific statements beyond the core delete, scoped to this chunk.
  buildExtraStatements: (db: D1Compat, ids: number[], reason: string, user: { id: number | null; name: string | null }, jobId: string) => Promise<D1Statement[]>
}

// Exported (alongside ENTITY_CONFIGS below) purely so
// test-bulk-delete-engine-pure.cjs can exercise the real logic without a
// live D1 -- both are pure/data, no Env or D1Compat needed to call them.
// Returns one statement per D1-sized slice of `chunk`, not one statement
// for the whole chunk: the bulk-delete chunk size is a CPU-budget number
// (paid 500, free 125 -- lib/planTier.ts's bulkDeleteChunkSize),
// while D1 refuses any single statement carrying more than 100 bound
// parameters, so a 500-id `IN (...)` threw `too many SQL variables` and
// runBulkDeleteJob's catch recorded all 500 ids as *failed deletes* --
// a silent, total failure that looked like a partial one. The slices go
// into the same db.batch(), so the chunk is still one atomic unit.
export function buildCoreDeleteStatements(config: EntityConfig, chunk: number[]): D1Statement[] {
  return chunkForBinding(chunk).map((slice) => {
    const placeholders = slice.map(() => '?').join(',')
    if (config.deleteMode === 'hard') {
      const profileOnly = config.table === 'customers' ? ` AND NOT (${customerIsAnonymousSql()})` : ''
      return { sql: `DELETE FROM ${config.table} WHERE ${config.idColumn} IN (${placeholders})${profileOnly}`, params: slice as unknown as Record<string, unknown> }
    }
    return { sql: `UPDATE ${config.table} SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE ${config.idColumn} IN (${placeholders})${config.table === 'products' ? ' AND is_active=1' : ''}`, params: slice as unknown as Record<string, unknown> }
  })
}

export function buildAnonymousCustomerBulkDeleteGuard(ids: number[]): D1Statement {
  return {
    sql: `SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM customers
      WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(@customerIds))
        AND ${customerIsAnonymousSql()}
    ) THEN 1 ELSE json_extract('anonymous_customer_immutable', '$') END AS anonymous_customer_guard`,
    params: { customerIds: JSON.stringify(ids) },
  }
}

async function loadAnonymousCustomerIds(db: D1Compat, ids: number[]): Promise<Set<number>> {
  const found = new Set<number>()
  for (const slice of chunkForBinding(ids)) {
    const placeholders = slice.map(() => '?').join(',')
    const rows = await db.prepare(`SELECT id FROM customers WHERE id IN (${placeholders}) AND ${customerIsAnonymousSql()}`)
      .all<{ id: number }>(slice)
    for (const row of rows) found.add(Number(row.id))
  }
  return found
}

const NO_EXTRA_STATEMENTS = async () => []

export const ENTITY_CONFIGS: Record<BulkDeleteEntityType, EntityConfig> = {
  products: {
    table: 'products',
    idColumn: 'id',
    auditEntity: 'product',
    cacheKey: 'products',
    deleteMode: 'soft',
    buildExtraStatements: NO_EXTRA_STATEMENTS,
  },
  // Customers/suppliers/delivery_contacts (this session): hard-delete,
  // same as contacts.ts's existing single-row DELETE /:id for each table
  // -- no branch-stock or other related rows to log, so no extra
  // statements beyond the core delete + audit row every entity gets.
  customers: {
    table: 'customers', idColumn: 'id', auditEntity: 'customer', cacheKey: 'customers',
    deleteMode: 'hard', buildExtraStatements: NO_EXTRA_STATEMENTS,
  },
  suppliers: {
    table: 'suppliers', idColumn: 'id', auditEntity: 'supplier', cacheKey: 'suppliers',
    deleteMode: 'hard', buildExtraStatements: NO_EXTRA_STATEMENTS,
  },
  delivery_contacts: {
    table: 'delivery_contacts', idColumn: 'id', auditEntity: 'delivery_contact', cacheKey: 'deliveryContacts',
    deleteMode: 'hard', buildExtraStatements: NO_EXTRA_STATEMENTS,
  },
}

interface JobRow {
  id: string
  entity_type: BulkDeleteEntityType
  status: string
  reason: string
  ids_json: string
  total_count: number
  processed_count: number
  failed_count: number
  failed_ids_json: string
  cancel_requested: number
  last_error: string | null
  created_by_id: number | null
  created_by_name: string | null
}

export async function createBulkDeleteJob(
  env: Env,
  entityType: BulkDeleteEntityType,
  ids: number[],
  reason: string,
  user: { id: number | null; name: string | null },
): Promise<{ jobId: string; totalCount: number }> {
  const uniqueIds = Array.from(new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)))
  if (!uniqueIds.length) throw new Error('No valid ids to delete')
  if (entityType === 'products' && !env.IMPORT_QUEUE && uniqueIds.length > getPlanLimits(env).bulkDeleteChunkSize) {
    throw Object.assign(new Error('The import queue is unavailable. No products were deleted. Restore the queue or select fewer products for one bulk delete.'), { code: 'bulk_delete_queue_unavailable' })
  }
  const jobId = crypto.randomUUID()
  const db = await getImportFencedDb(env)
  await db.prepare(`
    INSERT INTO bulk_delete_jobs (id, entity_type, status, reason, ids_json, total_count, created_by_id, created_by_name)
    VALUES (@id, @entityType, 'pending', @reason, @idsJson, @totalCount, @userId, @userName)
  `).run({
    id: jobId, entityType, reason, idsJson: JSON.stringify(uniqueIds), totalCount: uniqueIds.length,
    userId: user.id, userName: actorSnapshot(user),
  })
  await dispatchImportWork(env, { jobId, kind: 'bulk-delete' })
  return { jobId, totalCount: uniqueIds.length }
}

export async function getBulkDeleteJob(env: Env, jobId: string): Promise<JobRow | null> {
  const db = getDb(env)
  const row = await db.prepare(`SELECT * FROM bulk_delete_jobs WHERE id = @id`).get<JobRow>({ id: jobId })
  return row ?? null
}

async function markFailed(db: D1Compat, jobId: string, message: string): Promise<void> {
  const error = String(message || '').slice(0, 2000)
  await db.prepare(`
    UPDATE bulk_delete_jobs SET status = 'failed', last_error = @error, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = @id
  `).run({ id: jobId, error }).catch((writeError) => {
    if (isImportMaintenanceFenceError(writeError)) throw writeError
    console.error('[bulk-delete] could not record job failure', jobId, writeError)
  })
}

async function runProductDeleteChunk(env: Env, db: D1Compat, job: JobRow, allIds: number[]): Promise<void> {
  if (job.cancel_requested) {
    await db.prepare(`UPDATE bulk_delete_jobs SET status='cancelled',finished_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP WHERE id=@id AND status='processing'`).run({ id: job.id })
    return
  }
  const cursor = job.processed_count
  const chunk = allIds.slice(cursor, cursor + getPlanLimits(env).bulkDeleteChunkSize)
  const present = (await db.prepare(`SELECT id FROM products WHERE is_active=1
    AND id IN (SELECT value FROM json_each(@ids))`).all<{ id: number }>({ ids: JSON.stringify(chunk) })).map(row => Number(row.id))
  const blocked = await stockedProductIds(db, present)
  const blockedSet = new Set(blocked)
  const pending = present.filter(id => !blockedSet.has(id))
  const failed = [...new Set([...JSON.parse(job.failed_ids_json || '[]') as number[], ...blocked])]
  const next = cursor + chunk.length
  const completed = next >= allIds.length
  const statements = [{
    sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM bulk_delete_jobs WHERE id=@id
      AND processed_count=@cursor AND status='processing' AND cancel_requested=0)
      THEN 1 ELSE json_extract('[]','$[bulk_delete_progress_changed]') END`,
    params: { id: job.id, cursor },
  }, productStockGuardStatement(pending), {
    sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
      SELECT @userId,@userName,'delete','product',p.id,json_set(@details,'$.productName',p.name),'product',p.id,NULL
      FROM products p WHERE p.is_active=1 AND p.id IN (SELECT value FROM json_each(@ids))`,
    params: { userId: job.created_by_id, userName: job.created_by_name, ids: JSON.stringify(pending),
      details: JSON.stringify({ reason: job.reason, bulkJobId: job.id, source: 'bulk_delete', membership: 'removed', priorMembership: 'present' }) },
  }, ...buildCoreDeleteStatements(ENTITY_CONFIGS.products, pending), {
    sql: `UPDATE bulk_delete_jobs SET processed_count=@next,failed_count=@failedCount,failed_ids_json=@failedIds,
      status=@status,finished_at=CASE WHEN @status='completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
      last_error=@error,updated_at=CURRENT_TIMESTAMP WHERE id=@id AND processed_count=@cursor AND status='processing'`,
    params: { id: job.id, cursor, next, failedCount: failed.length, failedIds: JSON.stringify(failed),
      status: completed ? 'completed' : 'processing', error: blocked.length ? `${PRODUCT_HAS_STOCK_CODE}: ${JSON.stringify(blocked)}` : job.last_error },
  }]
  try {
    // One attempt: acknowledgement loss is recovered from the atomic cursor,
    // never by repeating a stale audit/delete plan in this invocation.
    await db.batchOnce(statements)
  } catch (error) {
    if (String(error).includes('bulk_delete_progress_changed')) {
      const current = await getBulkDeleteJob(env, job.id)
      if (current?.cancel_requested && current.status === 'processing') {
        await db.prepare(`UPDATE bulk_delete_jobs SET status='cancelled',finished_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP WHERE id=@id AND status='processing' AND cancel_requested=1`).run({ id: job.id })
      }
      if (current && (current.cancel_requested || ['completed', 'cancelled', 'failed'].includes(current.status))
        && current.processed_count > current.failed_count) {
        await bumpVersion(env, 'products')
        await broadcast(env, 'products', { action: 'bulk-delete', jobId: job.id })
      }
      return
    }
    throw error
  }
  await bumpVersion(env, 'products')
  await broadcast(env, 'products', { action: 'bulk-delete', ids: pending, jobId: job.id })
  if (!completed) {
    if (!env.IMPORT_QUEUE) {
      const message = 'Bulk delete saved its completed rows, but the import queue is unavailable. Select the remaining products and retry after the queue is restored.'
      await markFailed(db, job.id, 'bulk_delete_queue_resume_required')
      throw Object.assign(new Error(message), { code: 'bulk_delete_queue_resume_required' })
    }
    await dispatchImportWork(env, { jobId: job.id, kind: 'bulk-delete' })
  }
}

export async function runBulkDeleteJob(env: Env, jobId: string): Promise<void> {
  const db = await getImportFencedDb(env)
  const bulkDeleteChunkSize = getPlanLimits(env).bulkDeleteChunkSize
  const job = await getBulkDeleteJob(env, jobId)
  if (!job) return // job row vanished (shouldn't happen outside manual DB edits) -- nothing to do
  const terminal = job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed'
  if (job.entity_type === 'products' && (terminal || job.cancel_requested) && job.processed_count > job.failed_count) {
    // A committed cursor may outlive its acknowledgement/cache tail. Repeating
    // invalidation is safe, including cancellation after a partial commit.
    await bumpVersion(env, 'products')
    await broadcast(env, 'products', { action: 'bulk-delete', jobId })
  }
  if (terminal) return
  const config = ENTITY_CONFIGS[job.entity_type]
  if (!config) { await markFailed(db, jobId, `Unknown entity_type: ${job.entity_type}`); return }

  if (job.status === 'pending') {
    await db.prepare(`UPDATE bulk_delete_jobs SET status = 'processing', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND status='pending'`).run({ id: jobId })
  }

  let allIds: number[]
  try {
    allIds = JSON.parse(job.ids_json)
  } catch {
    await markFailed(db, jobId, 'Corrupt ids_json on job row')
    return
  }

  if (job.entity_type === 'products') {
    await runProductDeleteChunk(env, db, job, allIds)
    return
  }

  const user = { id: job.created_by_id, name: job.created_by_name }
  let cursor = job.processed_count
  const failedIds: number[] = JSON.parse(job.failed_ids_json || '[]')

  while (cursor < allIds.length) {
    // Checked once per outer chunk (not per statement) -- cheap, and
    // frequent enough that Cancel in the UI takes effect within one
    // chunk's worth of rows, not the whole remaining job.
    const fresh = await db.prepare(`SELECT cancel_requested FROM bulk_delete_jobs WHERE id = @id`).get<{ cancel_requested: number }>({ id: jobId })
    if (fresh?.cancel_requested) {
      await db.prepare(`UPDATE bulk_delete_jobs SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: jobId })
      return
    }

    const chunk = allIds.slice(cursor, cursor + bulkDeleteChunkSize)
    let deleteChunk = chunk
    if (job.entity_type === 'customers') {
      const protectedIds = await loadAnonymousCustomerIds(db, chunk)
      if (protectedIds.size) {
        for (const id of protectedIds) if (!failedIds.includes(id)) failedIds.push(id)
        deleteChunk = chunk.filter((id) => !protectedIds.has(id))
      }
    }
    try {
      // One statement deletes the whole chunk, instead of one DELETE/UPDATE
      // per id -- this is the core of why this is fast at 10k+ scale.
      // Soft (products) vs hard (customers/suppliers/delivery_contacts)
      // decided by config.deleteMode -- see buildCoreDeleteStatement.
      const deleteStatements = buildCoreDeleteStatements(config, deleteChunk)
      const extraStatements = await config.buildExtraStatements(db, deleteChunk, job.reason, user, jobId)
      if (job.entity_type === 'customers' && deleteChunk.length) {
        // The advisory read above lets unrelated profile ids continue when a
        // queued job contains a marker. This in-transaction assertion closes
        // the race where a profile is marked after that read but before the
        // hard delete. Guard and deletes are six statements at most.
        await db.batch([buildAnonymousCustomerBulkDeleteGuard(deleteChunk), ...deleteStatements, ...extraStatements])
      } else {
        await runD1BatchInChunks(db, [...deleteStatements, ...extraStatements])
      }

      // One audit_logs row per deleted id, batched together with everything
      // above rather than going through audit()'s per-call session lookup --
      // device_name/device_tz are omitted here (audit() normally attaches
      // them) since that per-row session lookup is exactly the N+1 cost
      // this module exists to avoid; a bulk-delete audit entry is
      // identifiable as a batch via the shared `reason` text and tight
      // created_at clustering even without a device column.
      const auditStatements: D1Statement[] = deleteChunk.map((id) => ({
        sql: `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, new_value)
              VALUES (@userId, @userName, 'delete', @entity, @entityId, @details, @entity, @entityId, NULL)`,
        params: { userId: user.id, userName: actorSnapshot(user), entity: config.auditEntity, entityId: id, details: JSON.stringify({ reason: job.reason, bulkJobId: jobId }) },
      }))
      await runD1BatchInChunks(db, auditStatements)

      cursor += chunk.length
      await db.prepare(`UPDATE bulk_delete_jobs
        SET processed_count = @cursor, failed_count = @failedCount, failed_ids_json = @failedIds, updated_at = CURRENT_TIMESTAMP
        WHERE id = @id`).run({ id: jobId, cursor, failedCount: failedIds.length, failedIds: JSON.stringify(failedIds) })
    } catch (error) {
      if (isImportMaintenanceFenceError(error)) throw error
      // A whole chunk failing (after runD1BatchInChunks' own per-statement
      // adaptive retry already gave up) is treated as those specific ids
      // failing, not the whole job -- record them and move on to the next
      // chunk rather than abandoning everything already-processed.
      console.error('[bulk-delete] chunk failed', jobId, { cursor, chunkSize: chunk.length }, error)
      for (const id of deleteChunk) if (!failedIds.includes(id)) failedIds.push(id)
      cursor += chunk.length
      await db.prepare(`
        UPDATE bulk_delete_jobs SET processed_count = @cursor, failed_count = @failedCount, failed_ids_json = @failedIds, last_error = @error, updated_at = CURRENT_TIMESTAMP WHERE id = @id
      `).run({ id: jobId, cursor, failedCount: failedIds.length, failedIds: JSON.stringify(failedIds), error: error instanceof Error ? error.message.slice(0, 2000) : String(error) })
    }
  }

  await db.prepare(`UPDATE bulk_delete_jobs SET status = 'completed', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: jobId })

  // One cache-bump and one broadcast for the whole job, not one per row --
  // the broadcast payload carries the full id list so connected clients
  // can drop exactly the deleted rows locally instead of a full refetch.
  const succeededIds = allIds.filter((id) => !failedIds.includes(id))
  await bumpVersion(env, config.cacheKey)
  await broadcast(env, config.cacheKey, { action: 'bulk-delete', ids: succeededIds, jobId })
}

const STALLED_BULK_DELETE_REAP_MINUTES = 20

// Same self-healing shape as importJobs.ts's reapStalledImportJobs --
// called from the job-status route rather than the cron scheduler, so it
// only does work when someone is actually looking (polling a job).
export async function reapStalledBulkDeleteJobs(env: Env): Promise<void> {
  const db = await getImportFencedDb(env)
  await db.prepare(`
    UPDATE bulk_delete_jobs
    SET status = 'failed', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
        last_error = 'Stalled: no progress for over ${STALLED_BULK_DELETE_REAP_MINUTES} minutes (the background worker likely crashed or was reset mid-job). Safe to retry the remaining ids.'
    WHERE status IN ('pending', 'processing')
      AND updated_at < datetime('now', '-${STALLED_BULK_DELETE_REAP_MINUTES} minutes')
  `).run().catch(() => { /* best-effort housekeeping, same as import's reaper */ })
}
