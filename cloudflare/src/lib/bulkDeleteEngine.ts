import { executeStockTransaction } from './stockTransaction'
// Product jobs remove only zero-stock products, committing one tier-sized
// chunk with its progress and audits per queue delivery. Cache invalidation
// follows each commit and can be repeated without replaying business writes.
// Customers, suppliers and delivery contacts do the same: one tier-sized chunk
// per delivery (delete, audit rows and cursor in one guarded batch), then the
// next chunk is re-enqueued, so a delivery's D1 calls never grow with the job.

import type { Env } from '../index'
import { getDb, getImportFencedDb, isImportMaintenanceFenceError, isRetryableD1Error, type D1Compat } from './db'
import { getPlanLimits } from './planTier'
import { dispatchImportWork } from './queueDispatch'
import { chunkForBinding } from './sqlBinding'
import { stockedProductIds, productStockGuardStatement, PRODUCT_HAS_STOCK_CODE } from './productStockGuard'
import { bumpVersion } from './cache'
import { broadcast, type BroadcastChannel } from '../durable-objects/broadcastHub'
import { actorSnapshot } from './actorSnapshot'
import { customerIsAnonymousSql } from './anonymousCustomer'
import { buildDeliveryContactUsageGuard, CONTACT_HAS_SALES_CODE, isDeliveryContactInUseError, loadDeliveryContactUsage } from './contactDeleteGuard'

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
  // Exception: delivery_contacts keep any person named by a sale or fee
  // (lib/contactDeleteGuard.ts), as DELETE /delivery-contacts/:id does.
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
  const rows = await db.prepare(`SELECT id FROM customers WHERE id IN (SELECT value FROM json_each(@ids)) AND ${customerIsAnonymousSql()}`)
    .all<{ id: number }>({ ids: JSON.stringify(ids) })
  return new Set(rows.map((row) => Number(row.id)))
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
    await executeStockTransaction(db, statements, 'once')
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

// The cache bump and the broadcast that follow a finished contacts job: one pair for the whole job, carrying the
// ids that were actually deleted so connected clients drop exactly those rows. Safe to repeat.
async function publishContactsDelete(env: Env, config: EntityConfig, jobId: string, allIds: number[], failedIds: number[]): Promise<void> {
  const failed = new Set(failedIds)
  await bumpVersion(env, config.cacheKey)
  await broadcast(env, config.cacheKey, { action: 'bulk-delete', ids: allIds.filter((id) => !failed.has(id)), jobId })
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
  const config = ENTITY_CONFIGS[job.entity_type]
  if (terminal) {
    // The last chunk of a contacts job can commit (cursor = end, status completed) and its acknowledgement
    // be lost: that delivery threw before the cache bump below, and the queue redelivers the message. The
    // cursor is the truth; the invalidation is repeatable, as the products path above already repeats it.
    // Nothing is deleted or audited again.
    if (job.status === 'completed' && job.entity_type !== 'products' && config && job.processed_count > job.failed_count) {
      let ids: number[] | null = null
      let failed: number[] = []
      try { ids = JSON.parse(job.ids_json); failed = JSON.parse(job.failed_ids_json || '[]') } catch { ids = null }
      if (ids) await publishContactsDelete(env, config, jobId, ids, failed)
    }
    return
  }
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
  const cursor = job.processed_count
  const failedIds: number[] = JSON.parse(job.failed_ids_json || '[]')

  // ONE chunk per queue delivery, then the next chunk is re-enqueued, as the
  // products path does. Looping every chunk in one invocation cost ~6 calls a
  // chunk and failed past the Free plan's 50 calls at ~1,000 ids; now a
  // delivery is a fixed ~5 calls whatever the job's size.
  if (cursor < allIds.length) {
    // The job row was read at the top of this delivery, so Cancel in the UI
    // still takes effect within one chunk; the batch guard below closes the
    // gap between that read and the write.
    if (job.cancel_requested) {
      await db.prepare(`UPDATE bulk_delete_jobs SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: jobId })
      return
    }

    const chunk = allIds.slice(cursor, cursor + bulkDeleteChunkSize)
    const next = cursor + chunk.length
    let deleteChunk = chunk
    if (job.entity_type === 'customers') {
      const protectedIds = await loadAnonymousCustomerIds(db, chunk)
      if (protectedIds.size) {
        for (const id of protectedIds) if (!failedIds.includes(id)) failedIds.push(id)
        deleteChunk = chunk.filter((id) => !protectedIds.has(id))
      }
    }
    // A delivery person named by a sale or delivery fee is kept (never leave sales pointing at a missing id): its id
    // joins the failed list and the job says why, the rest of the chunk still deletes.
    // last_error keeps the whole kept list of the job (it is rewritten per chunk), so earlier chunks' kept ids are carried forward.
    let keptNote: string | null = null
    let keptIds: number[] = []
    const keepNamed = (named: Map<number, unknown>) => {
      for (const id of named.keys()) {
        if (!failedIds.includes(id)) failedIds.push(id)
        if (!keptIds.includes(id)) keptIds.push(id)
      }
      deleteChunk = deleteChunk.filter((id) => !named.has(id))
      keptNote = `${CONTACT_HAS_SALES_CODE}: ${JSON.stringify(keptIds)}`
    }
    if (job.entity_type === 'delivery_contacts') {
      const earlier = /^contact_has_sales: (\[[0-9,]*\])$/.exec(job.last_error || '')
      if (earlier) keptIds = (JSON.parse(earlier[1]) as number[]).map(Number)
      const named = await loadDeliveryContactUsage(db, chunk)
      if (named.size) keepNamed(named)
    }
    const progress = (failed: number[], error: string | null): D1Statement => ({
      sql: `UPDATE bulk_delete_jobs SET processed_count = @next, failed_count = @failedCount, failed_ids_json = @failedIds,
          status = @status, finished_at = CASE WHEN @status = 'completed' THEN CURRENT_TIMESTAMP ELSE finished_at END,
          last_error = COALESCE(@error, last_error), updated_at = CURRENT_TIMESTAMP
        WHERE id = @id AND processed_count = @cursor AND status = 'processing'`,
      params: { id: jobId, cursor, next, failedCount: failed.length, failedIds: JSON.stringify(failed), status: next >= allIds.length ? 'completed' : 'processing', error },
    })
    // A delivery person named by a sale or fee in the window between the read above and the batch trips the in-batch guard
    // and rolls the chunk back: the chunk is retried ONCE without the newly named ids (the rest still delete); a second
    // trip records the chunk as kept under the same code.
    let racedOnce = false
    for (;;) {
    try {
      // One statement deletes the whole chunk, instead of one DELETE/UPDATE
      // per id -- this is the core of why this is fast at 10k+ scale.
      // Soft (products) vs hard (customers/suppliers/delivery_contacts)
      // decided by config.deleteMode -- see buildCoreDeleteStatement.
      const deleteStatements = buildCoreDeleteStatements(config, deleteChunk)
      const extraStatements = await config.buildExtraStatements(db, deleteChunk, job.reason, user, jobId)
      // One audit_logs row per deleted id, written by one INSERT in the same
      // atomic batch as the delete and the cursor -- device_name/device_tz
      // are omitted here (audit() normally attaches them) since that per-row
      // session lookup is exactly the N+1 cost this module exists to avoid;
      // a bulk-delete audit entry is identifiable as a batch via the shared
      // `reason` text and tight created_at clustering even without a device
      // column.
      const auditStatement: D1Statement = {
        sql: `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, new_value)
              SELECT @userId, @userName, 'delete', @entity, j.value, @details, @entity, j.value, NULL FROM json_each(@ids) j ORDER BY j.key`,
        params: { userId: user.id, userName: actorSnapshot(user), entity: config.auditEntity, ids: JSON.stringify(deleteChunk), details: JSON.stringify({ reason: job.reason, bulkJobId: jobId }) },
      }
      // ONE attempt, never db.batch(): its transparent retry turns a lost acknowledgement (the chunk committed, the
      // reply did not arrive) into a second attempt that trips the cursor guard below, which is then
      // indistinguishable from "another delivery already did this chunk" -- the delivery returned with nothing
      // queued and the job stalled half way. Here a transient failure is thrown instead, the queue redelivers,
      // and the redelivery reads the committed cursor and carries on from it.
      await db.batchOnce([
        // A redelivered or concurrent message for an already-advanced cursor,
        // or a Cancel since the job read, aborts the whole chunk: no second
        // delete, no duplicate audit rows.
        {
          sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM bulk_delete_jobs WHERE id=@id
            AND processed_count=@cursor AND status='processing' AND cancel_requested=0)
            THEN 1 ELSE json_extract('[]','$[bulk_delete_progress_changed]') END`,
          params: { id: jobId, cursor },
        },
        // The advisory read above lets unrelated profile ids continue when a
        // queued job contains a marker. This in-transaction assertion closes
        // the race where a profile is marked after that read but before the
        // hard delete.
        ...(job.entity_type === 'customers' && deleteChunk.length ? [buildAnonymousCustomerBulkDeleteGuard(deleteChunk)] : []),
        ...(job.entity_type === 'delivery_contacts' && deleteChunk.length ? [buildDeliveryContactUsageGuard(deleteChunk)] : []),
        ...deleteStatements, ...extraStatements, auditStatement, progress(failedIds, keptNote),
      ])
      break
    } catch (error) {
      if (isImportMaintenanceFenceError(error)) throw error
      if (job.entity_type === 'delivery_contacts' && isDeliveryContactInUseError(error) && !racedOnce) {
        racedOnce = true
        const named = await loadDeliveryContactUsage(db, deleteChunk)
        if (named.size) { keepNamed(named); continue }
      }
      if (String(error).includes('bulk_delete_progress_changed')) {
        const current = await getBulkDeleteJob(env, jobId)
        if (current?.cancel_requested && current.status === 'processing') {
          await db.prepare(`UPDATE bulk_delete_jobs SET status='cancelled',finished_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP WHERE id=@id AND status='processing' AND cancel_requested=1`).run({ id: jobId })
        }
        // Otherwise another delivery already committed this chunk (it queues the continuation).
        return
      }
      // A transient infrastructure error does not say whether the chunk committed. Never infer a rollback and
      // never record the ids as failed on that evidence: throw, so the queue redelivers this message and the
      // delivery after it takes the cursor as the truth. If the chunk had committed, the cursor is past it and
      // the redelivery works on the next chunk (or, after the last one, repeats the cache bump); if it had not,
      // the redelivery retries the same chunk. Either way each id is deleted and audited exactly once.
      if (isRetryableD1Error(error)) throw error
      // A whole chunk failing is treated as those specific ids failing, not
      // the whole job -- record them and move on to the next chunk rather
      // than abandoning everything already-processed.
      console.error('[bulk-delete] chunk failed', jobId, { cursor, chunkSize: chunk.length }, error)
      for (const id of deleteChunk) if (!failedIds.includes(id)) failedIds.push(id)
      const failure = progress(failedIds, job.entity_type === 'delivery_contacts' && isDeliveryContactInUseError(error)
        ? `${CONTACT_HAS_SALES_CODE}: ${JSON.stringify([...new Set([...keptIds, ...deleteChunk])])}`
        : error instanceof Error ? error.message.slice(0, 2000) : String(error))
      await db.prepare(failure.sql).run(failure.params)
      break
    }
    }
    if (next < allIds.length) {
      await dispatchImportWork(env, { jobId, kind: 'bulk-delete' })
      return
    }
  } else {
    // A job whose last chunk committed under the old whole-job loop.
    await db.prepare(`UPDATE bulk_delete_jobs SET status = 'completed', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: jobId })
  }

  // One cache-bump and one broadcast for the whole job, not one per row --
  // the broadcast payload carries the full id list so connected clients
  // can drop exactly the deleted rows locally instead of a full refetch.
  await publishContactsDelete(env, config, jobId, allIds, failedIds)
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
