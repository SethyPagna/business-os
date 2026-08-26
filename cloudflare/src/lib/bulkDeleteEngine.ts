// Bulk-delete engine -- the delete-side counterpart to importEngine.ts.
//
// Why this exists: products.ts's single DELETE /:id route does a soft
// delete (UPDATE is_active=0) plus, per row: a name lookup, a branch_stock
// lookup, one inventory_movements INSERT per branch with stock, one
// audit_logs INSERT (which itself does a SEPARATE user_sessions lookup --
// see audit.ts's lookupAuditDeviceInfo), a cache bump, and a broadcast.
// Products.tsx's bulk-delete flow calls that route once per selected id
// (see runBulkDeleteConfirmed, runConcurrentTasks). That's fine at the
// scale it was built for -- a few dozen selected rows -- but at 10k+ rows
// it's 10k+ round trips, 10k+ separate cache-bump/broadcast messages, and
// 10k+ redundant session lookups for the exact same user. This module
// does the same soft-delete + movement-log + audit-log work, but batched:
// one multi-row UPDATE, movement/audit INSERTs batched together via
// runD1BatchInChunks (imported from importEngine.ts -- same CPU-limit
// adaptive-split-and-retry logic, no need to duplicate it), one session
// lookup total, and one cache-bump/broadcast at the very end instead of
// per row.
//
// Runs as a queue consumer (see queue.ts / bulk_delete_jobs migration's
// header for why it shares the import queue), not an HTTP handler, so it
// isn't bound by a request timeout -- only by each individual db.batch()
// call's CPU-time budget, which runD1BatchInChunks already handles.
//
// ENTITY_CONFIGS is deliberately a map, not a hardcoded "products" path,
// so Inventory/Sales/Contacts bulk-delete can register into this same
// table + queue + frontend polling flow later without a new migration or
// a new queue message kind -- just a new entry here and a new route that
// calls createBulkDeleteJob with a different entityType.

import type { Env } from '../index'
import { getDb, type D1Compat } from './db'
import { chunkForBinding, selectInChunks } from './sqlBinding'
import { runD1BatchInChunks } from './importEngine'
import { bumpVersion } from './cache'
import { broadcast, type BroadcastChannel } from '../durable-objects/broadcastHub'

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
  // Extra statements for this chunk of ids beyond the core delete --
  // e.g. products' per-branch inventory_movements rows. Reads (SELECT)
  // needed to build those extra statements happen here too, scoped to
  // just this chunk's ids, not the whole job's id list.
  buildExtraStatements: (db: D1Compat, ids: number[], reason: string, user: { id: number | null; name: string | null }) => Promise<D1Statement[]>
}

// Exported (alongside ENTITY_CONFIGS below) purely so
// test-bulk-delete-engine-pure.cjs can exercise the real logic without a
// live D1 -- both are pure/data, no Env or D1Compat needed to call them.
// Returns one statement per D1-sized slice of `chunk`, not one statement
// for the whole chunk: BULK_DELETE_CHUNK_SIZE is a CPU-budget number (500),
// while D1 refuses any single statement carrying more than 100 bound
// parameters, so a 500-id `IN (...)` threw `too many SQL variables` and
// runBulkDeleteJob's catch recorded all 500 ids as *failed deletes* --
// a silent, total failure that looked like a partial one. The slices go
// into the same db.batch(), so the chunk is still one atomic unit.
export function buildCoreDeleteStatements(config: EntityConfig, chunk: number[]): D1Statement[] {
  return chunkForBinding(chunk).map((slice) => {
    const placeholders = slice.map(() => '?').join(',')
    if (config.deleteMode === 'hard') {
      return { sql: `DELETE FROM ${config.table} WHERE ${config.idColumn} IN (${placeholders})`, params: slice as unknown as Record<string, unknown> }
    }
    return { sql: `UPDATE ${config.table} SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE ${config.idColumn} IN (${placeholders})`, params: slice as unknown as Record<string, unknown> }
  })
}

const NO_EXTRA_STATEMENTS = async () => []

export const ENTITY_CONFIGS: Record<BulkDeleteEntityType, EntityConfig> = {
  products: {
    table: 'products',
    idColumn: 'id',
    auditEntity: 'product',
    cacheKey: 'products',
    deleteMode: 'soft',
    buildExtraStatements: async (db, ids, reason, user) => {
      // Same movement-logging rule as the single-delete route: one
      // inventory_movements row per branch that still had stock, so the
      // movement history isn't silently missing what a bulk delete removed.
      // Chunked for the same reason buildCoreDeleteStatements is.
      const stockRows = await selectInChunks(ids, 0, (slice) => {
        const placeholders = slice.map(() => '?').join(',')
        return db.prepare(`
          SELECT bs.product_id AS productId, bs.branch_id AS branchId, bs.quantity AS quantity,
                 p.name AS productName, b.name AS branchName
          FROM branch_stock bs
          LEFT JOIN products p ON p.id = bs.product_id
          LEFT JOIN branches b ON b.id = bs.branch_id
          WHERE bs.product_id IN (${placeholders}) AND bs.quantity > 0
        `).all<{ productId: number; branchId: number; quantity: number; productName: string | null; branchName: string | null }>(slice)
      })
      return stockRows.map((row) => ({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
              VALUES (@productId, @productName, @branchId, @branchName, 'delete', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
        params: {
          productId: row.productId, productName: row.productName, branchId: row.branchId, branchName: row.branchName,
          quantity: row.quantity, reason, userId: user.id, userName: user.name,
        },
      }))
    },
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

// Same chunk size import already validated for what fits D1's per-batch
// CPU budget -- see importEngine.ts's D1_IMPORT_BATCH_CHUNK_SIZE comment.
// Bulk-delete's per-id statement count is smaller (no branch-stock rows
// for most products), so this errs a little larger than import's; the
// adaptive halve-and-retry inside runD1BatchInChunks covers it either way
// if a particular chunk (e.g. unusually stock-heavy) blows the budget.
const BULK_DELETE_CHUNK_SIZE = 500

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
  const jobId = crypto.randomUUID()
  const db = getDb(env)
  await db.prepare(`
    INSERT INTO bulk_delete_jobs (id, entity_type, status, reason, ids_json, total_count, created_by_id, created_by_name)
    VALUES (@id, @entityType, 'pending', @reason, @idsJson, @totalCount, @userId, @userName)
  `).run({
    id: jobId, entityType, reason, idsJson: JSON.stringify(uniqueIds), totalCount: uniqueIds.length,
    userId: user.id, userName: user.name,
  })
  await env.IMPORT_QUEUE.send({ jobId, kind: 'bulk-delete' })
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
    console.error('[bulk-delete] could not record job failure', jobId, writeError)
  })
}

export async function runBulkDeleteJob(env: Env, jobId: string): Promise<void> {
  const db = getDb(env)
  const job = await getBulkDeleteJob(env, jobId)
  if (!job) return // job row vanished (shouldn't happen outside manual DB edits) -- nothing to do
  if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') return // already terminal, e.g. a redelivered queue message
  const config = ENTITY_CONFIGS[job.entity_type]
  if (!config) { await markFailed(db, jobId, `Unknown entity_type: ${job.entity_type}`); return }

  if (job.status === 'pending') {
    await db.prepare(`UPDATE bulk_delete_jobs SET status = 'processing', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: jobId })
  }

  let allIds: number[]
  try {
    allIds = JSON.parse(job.ids_json)
  } catch {
    await markFailed(db, jobId, 'Corrupt ids_json on job row')
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

    const chunk = allIds.slice(cursor, cursor + BULK_DELETE_CHUNK_SIZE)
    try {
      // One statement deletes the whole chunk, instead of one DELETE/UPDATE
      // per id -- this is the core of why this is fast at 10k+ scale.
      // Soft (products) vs hard (customers/suppliers/delivery_contacts)
      // decided by config.deleteMode -- see buildCoreDeleteStatement.
      const deleteStatements = buildCoreDeleteStatements(config, chunk)
      const extraStatements = await config.buildExtraStatements(db, chunk, job.reason, user)
      await runD1BatchInChunks(db, [...deleteStatements, ...extraStatements])

      // One audit_logs row per deleted id, batched together with everything
      // above rather than going through audit()'s per-call session lookup --
      // device_name/device_tz are omitted here (audit() normally attaches
      // them) since that per-row session lookup is exactly the N+1 cost
      // this module exists to avoid; a bulk-delete audit entry is
      // identifiable as a batch via the shared `reason` text and tight
      // created_at clustering even without a device column.
      const auditStatements: D1Statement[] = chunk.map((id) => ({
        sql: `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, new_value)
              VALUES (@userId, @userName, 'delete', @entity, @entityId, @details, @entity, @entityId, NULL)`,
        params: { userId: user.id, userName: user.name, entity: config.auditEntity, entityId: id, details: JSON.stringify({ reason: job.reason, bulkJobId: jobId }) },
      }))
      await runD1BatchInChunks(db, auditStatements)

      cursor += chunk.length
      await db.prepare(`UPDATE bulk_delete_jobs SET processed_count = @cursor, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: jobId, cursor })
    } catch (error) {
      // A whole chunk failing (after runD1BatchInChunks' own per-statement
      // adaptive retry already gave up) is treated as those specific ids
      // failing, not the whole job -- record them and move on to the next
      // chunk rather than abandoning everything already-processed.
      console.error('[bulk-delete] chunk failed', jobId, { cursor, chunkSize: chunk.length }, error)
      failedIds.push(...chunk)
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
  const db = getDb(env)
  await db.prepare(`
    UPDATE bulk_delete_jobs
    SET status = 'failed', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
        last_error = 'Stalled: no progress for over ${STALLED_BULK_DELETE_REAP_MINUTES} minutes (the background worker likely crashed or was reset mid-job). Safe to retry the remaining ids.'
    WHERE status IN ('pending', 'processing')
      AND updated_at < datetime('now', '-${STALLED_BULK_DELETE_REAP_MINUTES} minutes')
  `).run().catch(() => { /* best-effort housekeeping, same as import's reaper */ })
}
