import type { Env } from '../index'
import { copyObject, listObjects } from './r2'

export const CLOUDFLARE_BACKUP_PREFIX = 'backups/cloudflare/'
export const CLOUDFLARE_BACKUP_KEEP = 2

// Real R2 object-copy is a get()+put() (see r2.ts's copyObject) -- one
// subrequest pair per asset. Workers' free-plan subrequest-per-invocation
// ceiling means a catalog with thousands of images can't all be copied in
// one backup call; this caps how many asset *bytes* get copied per backup
// run so the call stays inside that budget rather than failing partway
// with no visibility. Assets beyond the cap are still LISTED in the
// manifest (as before) but their bytes are not copied this run --
// `summary.assetsBackedUp` vs `summary.assetsSkipped` makes that visible
// instead of silently claiming a complete asset backup that isn't one.
const MAX_ASSET_BYTES_PER_BACKUP = 40

// A single backup run can only ever byte-copy MAX_ASSET_BYTES_PER_BACKUP
// assets, so full coverage of a catalog bigger than that has to come from
// several runs. Left alone, "several runs" wasn't actually guaranteed to
// converge: each run just took R2's list-order "first N", so if the
// catalog's key order didn't shift between runs (the common case), every
// run copied the *same* first 40 assets forever and the rest were never
// backed up. This cursor (persisted in KV, the same binding
// storeSystemJob/getSystemJob already use for cross-invocation state)
// makes each run resume where the previous one left off and wrap back to
// the start once it reaches the end -- so ceil(assetCount / 40) runs are
// enough to genuinely cover every asset at least once, instead of
// however many runs happen to get lucky with list-order churn.
const BACKUP_ASSET_CURSOR_KEY = 'system-cursor:backup-asset-copy'

async function getAssetCopyCursor(env: Env): Promise<string | null> {
  return (await env.CACHE.get(BACKUP_ASSET_CURSOR_KEY)) || null
}

async function setAssetCopyCursor(env: Env, key: string | null): Promise<void> {
  if (key) await env.CACHE.put(BACKUP_ASSET_CURSOR_KEY, key)
  else await env.CACHE.delete(BACKUP_ASSET_CURSOR_KEY)
}

// Picks the next slice of assets to byte-copy this run, starting right
// after wherever the last run's cursor left off, wrapping around to the
// front of the list if the tail doesn't have a full cap's worth left.
// Exported (in addition to being used internally) purely so the resume
// behavior itself -- not just its effect on a full createCloudflareBackup
// run -- has a direct, isolated regression test.
export function selectAssetsToCopy(
  assets: Array<{ key: string }>,
  cursorKey: string | null,
  cap = MAX_ASSET_BYTES_PER_BACKUP,
): Array<{ key: string }> {
  if (!assets.length) return []
  const cursorIndex = cursorKey ? assets.findIndex((asset) => asset.key === cursorKey) : -1
  const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0
  let toCopy = assets.slice(startIndex, startIndex + cap)
  if (toCopy.length < cap && startIndex > 0) {
    const remaining = cap - toCopy.length
    toCopy = toCopy.concat(assets.slice(0, Math.min(remaining, startIndex)))
  }
  return toCopy
}

const BACKUP_TABLES = [
  'settings',
  'roles',
  'users',
  'branches',
  'categories',
  'units',
  'suppliers',
  'customers',
  'delivery_contacts',
  'products',
  'branch_stock',
  'product_images',
  'file_assets',
  'promotions',
  'promotion_product_links',
  'portal_business_profile',
  'portal_faqs',
  'sales',
  'sale_items',
  'returns',
  'return_items',
  'inventory_movements',
  'stock_transfers',
  'stock_row_moves',
  'import_jobs',
  'import_job_files',
  'import_job_batches',
  'import_job_rows',
  'import_job_errors',
  'google_drive_sync_entries',
  'action_history',
  'audit_logs',
  'custom_tables',
  'custom_fields',
] as const

type BackupTable = {
  columns: string[]
  rows: Array<Record<string, unknown>>
}

type BackupPayload = {
  format: 'business-os-cloudflare-backup'
  formatVersion: 1
  createdAt: string
  source: 'manual' | 'scheduled'
  runtime: 'cloudflare-workers'
  tables: Record<string, BackupTable>
  r2: {
    bucket: string
    // Every uploads/ key that existed at backup time (manifest only).
    assets: Array<{ key: string; size?: number; uploaded?: string | null }>
    // Subset of the above whose actual bytes were copied into this
    // backup's own assets/ prefix -- these are the ones restore can bring
    // back for real. assetsPrefix is where they live, e.g.
    // "backups/cloudflare/business-os-cloudflare-<stamp>/assets/".
    assetsPrefix: string
    copiedKeys: string[]
    // Only present on a QUEUE-DRIVEN backup (env.BACKUP_QUEUE bound -- see
    // createCloudflareBackup/continueCloudflareBackupAssetCopy below).
    // nextIndex is an offset into THIS manifest's own r2.assets array (a
    // snapshot fixed at creation time, unlike the no-queue fallback's
    // cross-run rotating cursor) -- continueCloudflareBackupAssetCopy
    // resumes from here and advances it, chunk by chunk, until complete.
    assetCopyProgress?: { nextIndex: number; complete: boolean }
  }
  summary: { tableCount: number; rowCount: number; assetCount: number; assetsBackedUp: number; assetsSkipped: number }
}

// Message shape sent to (and read back from) BACKUP_QUEUE. Kept minimal --
// everything else needed to resume (which assets, which prefix, what's
// been copied so far) lives on the manifest itself, read fresh by
// continueCloudflareBackupAssetCopy on each invocation, not carried in the
// message.
export type BackupQueueMessage = { kind: 'backup-continue'; backupName: string; nextIndex: number }

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function stamp(date = new Date()): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

function qid(id: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) throw new Error(`Unsafe SQL identifier: ${id}`)
  return `"${id}"`
}

async function tableExists(env: Env, table: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').bind('table', table).first()
  return !!row
}

async function tableColumns(env: Env, table: string): Promise<string[]> {
  const result = await env.DB.prepare(`PRAGMA table_info(${qid(table)})`).all<{ name: string }>()
  return (result.results || []).map((row) => row.name).filter(Boolean)
}

async function listAssets(env: Env) {
  const assets: BackupPayload['r2']['assets'] = []
  let cursor: string | undefined
  do {
    const page = await env.ASSETS.list({ prefix: 'uploads/', cursor, limit: 1000 })
    for (const object of page.objects || []) {
      assets.push({ key: object.key, size: object.size, uploaded: object.uploaded?.toISOString?.() || null })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return assets
}

export async function listCloudflareBackups(env: Env) {
  const items: Array<{ key: string; name: string; size: number; uploaded: string | null }> = []
  let cursor: string | undefined
  do {
    const page = await env.ASSETS.list({ prefix: CLOUDFLARE_BACKUP_PREFIX, cursor, limit: 1000 })
    for (const object of page.objects || []) {
      if (!object.key.endsWith('.json')) continue
      items.push({
        key: object.key,
        name: object.key.slice(CLOUDFLARE_BACKUP_PREFIX.length),
        size: object.size,
        uploaded: object.uploaded?.toISOString?.() || null,
      })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return items.sort((a, b) => String(b.uploaded || '').localeCompare(String(a.uploaded || '')))
}

// --- streaming backup writer ------------------------------------------
//
// The backup used to build ONE object holding every row of every table and
// then JSON.stringify it:
//
//   for (const table of BACKUP_TABLES) {
//     const result = await env.DB.prepare(`SELECT * FROM ...`).all()
//     tables[table] = { columns, rows }
//   }
//   await env.ASSETS.put(key, JSON.stringify(payload))
//
// On a real catalogue that is tens of thousands of rows -- products alone
// carry long multi-line descriptions -- held as JS objects AND again as one
// serialized string. A Worker has a hard 128MB ceiling, and this crossed it:
//
//   POST /api/system/reset-data - Exceeded Memory Limit
//   X [ERROR] Error: Worker exceeded memory limit.
//
// That is why EVERY reset failed, not just one mode: a fresh backup is a
// hard prerequisite in front of the delete, so the reset never got as far as
// deleting anything. Manual backups of a database this size were failing for
// the same reason.
//
// The output format is byte-for-byte the same JSON document, so restore and
// every existing backup file keep working -- only how it is produced
// changed. Two bounds:
//   - rows are read a page at a time (TABLE_PAGE_SIZE), never a whole table
//   - JSON is written into an R2 multipart upload and flushed once a part
//     is big enough, so at most one part is ever in memory
const TABLE_PAGE_SIZE = 500

// R2 requires every part except the last to be at least 5MB. 6MB gives
// headroom over that floor while keeping peak memory small.
const MIN_R2_PART_BYTES = 6 * 1024 * 1024

class R2StreamWriter {
  private parts: R2UploadedPart[] = []
  private buffer: string[] = []
  private bufferBytes = 0
  private readonly encoder = new TextEncoder()

  constructor(private readonly upload: R2MultipartUpload) {}

  async write(text: string): Promise<void> {
    if (!text) return
    this.buffer.push(text)
    // Measured in BYTES, not characters -- R2's part floor is bytes, and
    // this payload is full of non-ASCII (Khmer product names, currency
    // symbols) where the two differ by up to 3x.
    this.bufferBytes += this.encoder.encode(text).byteLength
    if (this.bufferBytes >= MIN_R2_PART_BYTES) await this.flush()
  }

  private async flush(): Promise<void> {
    if (!this.buffer.length) return
    const body = this.buffer.join('')
    this.buffer = []
    this.bufferBytes = 0
    const part = await this.upload.uploadPart(this.parts.length + 1, body)
    this.parts.push(part)
  }

  async finish(): Promise<void> {
    await this.flush()
    await this.upload.complete(this.parts)
  }

  async abort(): Promise<void> {
    // Without this an interrupted run leaves an incomplete multipart upload
    // holding storage in the bucket indefinitely.
    try {
      await this.upload.abort()
    } catch (_) {
      // Nothing useful to do if the abort itself fails.
    }
  }
}

export async function createCloudflareBackup(env: Env, source: 'manual' | 'scheduled' = 'manual') {
  const createdAt = new Date().toISOString()
  let rowCount = 0
  let tableCount = 0

  const assets = await listAssets(env)
  const backupName = `business-os-cloudflare-${stamp(new Date(createdAt))}`
  const assetsPrefix = `${CLOUDFLARE_BACKUP_PREFIX}${backupName}/assets/`

  let copiedKeys: string[] = []
  let assetCopyProgress: BackupPayload['r2']['assetCopyProgress']

  if (env.BACKUP_QUEUE) {
    // Queue-driven path (Part 122): copy the first cap's worth against a
    // snapshot of `assets` fixed at the top of THIS run (not the no-queue
    // fallback's cross-run rotating cursor below -- that cursor is only
    // meaningful when there's no queue to keep resuming the SAME run).
    // If more remain, enqueue a continuation message so a later Worker
    // invocation (handleBackupQueue -> continueCloudflareBackupAssetCopy)
    // picks up right where this run left off, and so on until the whole
    // snapshot is covered -- no repeated manual "Backup now" clicks
    // needed to reach full asset coverage.
    const firstSlice = assets.slice(0, MAX_ASSET_BYTES_PER_BACKUP)
    for (const asset of firstSlice) {
      try {
        const destKey = `${assetsPrefix}${asset.key.replace(/^uploads\//, '')}`
        const copied = await copyObject(env.ASSETS, asset.key, destKey)
        if (copied) copiedKeys.push(asset.key)
      } catch (_) {
        // Best-effort per-asset -- one bad/missing object shouldn't abort
        // the whole backup. nextIndex below still advances past it (see
        // continueCloudflareBackupAssetCopy's matching comment) so it
        // isn't retried forever.
      }
    }
    const nextIndex = firstSlice.length
    const complete = nextIndex >= assets.length
    assetCopyProgress = { nextIndex, complete }
    if (!complete) {
      await env.BACKUP_QUEUE.send({ kind: 'backup-continue', backupName, nextIndex } satisfies BackupQueueMessage)
    }
  } else {
    // No-queue fallback -- byte-for-byte the original Part 48 behavior.
    // Which N assets get copied resumes from the persisted cross-run
    // cursor (see its comment above) so repeated manually-triggered runs
    // still make real progress across the whole catalog instead of
    // repeatedly copying the same first 40.
    const priorCursor = await getAssetCopyCursor(env)
    const toCopy = selectAssetsToCopy(assets, priorCursor)
    for (const asset of toCopy) {
      try {
        const destKey = `${assetsPrefix}${asset.key.replace(/^uploads\//, '')}`
        const copied = await copyObject(env.ASSETS, asset.key, destKey)
        if (copied) copiedKeys.push(asset.key)
      } catch (_) {
        // Best-effort per-asset -- one bad/missing object shouldn't abort
        // the whole backup.
      }
    }
    // Advance the cursor to the end of this run's slice regardless of any
    // individual copy failures above -- a permanently-broken object
    // shouldn't wedge every future run into retrying it forever instead of
    // making progress through the rest of the catalog.
    if (toCopy.length) await setAssetCopyCursor(env, toCopy[toCopy.length - 1].key)
  }

  const key = `${CLOUDFLARE_BACKUP_PREFIX}${backupName}.json`
  const format = 'business-os-cloudflare-backup'

  const upload = await env.ASSETS.createMultipartUpload(key, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { source, createdAt, format },
  })
  const writer = new R2StreamWriter(upload)

  try {
    // Same document as before, emitted in order rather than assembled.
    await writer.write(`{"format":${JSON.stringify(format)},"formatVersion":1,`)
    await writer.write(`"createdAt":${JSON.stringify(createdAt)},`)
    await writer.write(`"source":${JSON.stringify(source)},`)
    await writer.write('"runtime":"cloudflare-workers","tables":{')

    for (const table of BACKUP_TABLES) {
      if (!(await tableExists(env, table))) continue
      const columns = await tableColumns(env, table)
      await writer.write(`${tableCount ? ',' : ''}${JSON.stringify(table)}:{"columns":${JSON.stringify(columns)},"rows":[`)
      tableCount += 1

      // Paged so a single large table is never fully resident. Ordered by
      // rowid so paging is stable -- without an ORDER BY, SQLite may return
      // rows in a different order between pages and a row could be emitted
      // twice or skipped.
      let offset = 0
      let rowsInTable = 0
      for (;;) {
        const page = await env.DB
          .prepare(`SELECT * FROM ${qid(table)} ORDER BY rowid LIMIT ? OFFSET ?`)
          .bind(TABLE_PAGE_SIZE, offset)
          .all<Record<string, unknown>>()
        const rows = page.results || []
        if (!rows.length) break
        for (const row of rows) {
          await writer.write(`${rowsInTable ? ',' : ''}${JSON.stringify(row)}`)
          rowsInTable += 1
        }
        if (rows.length < TABLE_PAGE_SIZE) break
        offset += TABLE_PAGE_SIZE
      }
      rowCount += rowsInTable
      await writer.write(']}')
    }

    await writer.write('},"r2":')
    await writer.write(JSON.stringify({ bucket: 'business-os-assets', assets, assetsPrefix, copiedKeys, assetCopyProgress }))
    await writer.write(',"summary":')
    await writer.write(JSON.stringify({
      tableCount,
      rowCount,
      assetCount: assets.length,
      assetsBackedUp: copiedKeys.length,
      assetsSkipped: Math.max(0, assets.length - copiedKeys.length),
    }))
    await writer.write('}')
    await writer.finish()
  } catch (error) {
    await writer.abort()
    throw error
  }

  const summary = {
    tableCount,
    rowCount,
    assetCount: assets.length,
    assetsBackedUp: copiedKeys.length,
    assetsSkipped: Math.max(0, assets.length - copiedKeys.length),
  }
  return { key, name: key.slice(CLOUDFLARE_BACKUP_PREFIX.length), createdAt, summary }
}

// Lightweight backup for /reset-section (system.ts): dumps ONLY the small
// number of tables that section actually deletes, with no R2 asset listing
// or copying at all. Added because the full createCloudflareBackup above
// -- a `SELECT *` + JSON-serialize pass over all ~34 BACKUP_TABLES (sales,
// sale_items, inventory_movements, audit_logs, etc.) plus a full bucket
// listAssets() -- was being run synchronously in front of every single
// customers/suppliers/delivery_contacts/audit_log reset, even though that
// reset only ever touches 1-2 small tables. On a store with real sales
// history this genuinely exceeded the Worker's CPU-time limit (user-
// reported: `POST /api/system/reset-section - Exceeded CPU Limit`, whole
// request failing with no data changed) -- the backup step meant to make
// the reset SAFE was actually what was crashing it. `restoreCloudflareBackup`
// above already only deletes+restores whichever tables are present in
// `payload.tables` and treats `r2.copiedKeys`/`assetsPrefix` as optional,
// so a manifest with just these tables and an empty asset list restores
// correctly with the exact same code path -- no restore-side changes
// needed. Same manifest format/prefix as a full backup, so it still shows
// up in `listCloudflareBackups` and is restorable from the same UI.
export async function createSectionBackup(env: Env, tables: readonly string[], source: 'manual' | 'scheduled' = 'manual') {
  const createdAt = new Date().toISOString()
  const backupTables: BackupPayload['tables'] = {}
  let rowCount = 0

  for (const table of tables) {
    if (!(await tableExists(env, table))) continue
    const columns = await tableColumns(env, table)
    const result = await env.DB.prepare(`SELECT * FROM ${qid(table)}`).all<Record<string, unknown>>()
    const rows = result.results || []
    backupTables[table] = { columns, rows }
    rowCount += rows.length
  }

  const backupName = `business-os-cloudflare-${stamp(new Date(createdAt))}`
  const assetsPrefix = `${CLOUDFLARE_BACKUP_PREFIX}${backupName}/assets/`

  const payload: BackupPayload = {
    format: 'business-os-cloudflare-backup',
    formatVersion: 1,
    createdAt,
    source,
    runtime: 'cloudflare-workers',
    tables: backupTables,
    // No asset listing/copying for a section backup -- the sections this
    // covers (customers/suppliers/delivery_contacts/audit_log) don't carry
    // their own R2 assets the way products do, and skipping the bucket
    // listAssets() call is itself a meaningful chunk of the CPU/subrequest
    // cost this function exists to avoid.
    r2: { bucket: 'business-os-assets', assets: [], assetsPrefix, copiedKeys: [], assetCopyProgress: { nextIndex: 0, complete: true } },
    summary: { tableCount: Object.keys(backupTables).length, rowCount, assetCount: 0, assetsBackedUp: 0, assetsSkipped: 0 },
  }
  const key = `${CLOUDFLARE_BACKUP_PREFIX}${backupName}.json`
  await env.ASSETS.put(key, JSON.stringify(payload), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { source, createdAt, format: payload.format },
  })
  return { key, name: key.slice(CLOUDFLARE_BACKUP_PREFIX.length), createdAt, summary: payload.summary }
}

// Queue consumer entry point (called from queue.ts's handleBackupQueue for
// each 'backup-continue' message). Copies the NEXT MAX_ASSET_BYTES_PER_BACKUP
// assets of the manifest's own fixed snapshot (payload.r2.assets), starting
// at nextIndex, updates the SAME manifest object in place, and re-enqueues
// itself if assets remain -- until the whole snapshot is covered.
export async function continueCloudflareBackupAssetCopy(env: Env, backupName: string, nextIndex: number) {
  const key = `${CLOUDFLARE_BACKUP_PREFIX}${backupName}.json`
  const object = await env.ASSETS.get(key)
  if (!object) {
    // Manifest is gone (pruned, or a stale/duplicate queue redelivery for
    // a backup that no longer exists) -- nothing to resume, safe no-op.
    return { key, skipped: true, reason: 'manifest-not-found' as const }
  }
  const payload = await object.json<BackupPayload>()

  // Redundant continuation (a duplicate queue delivery, or a message that
  // raced a later one) on an already-complete backup -- safe no-op, don't
  // re-copy or re-enqueue.
  if (payload.r2.assetCopyProgress?.complete) {
    return { key, skipped: true, reason: 'already-complete' as const, summary: payload.summary }
  }

  const assets = payload.r2.assets
  const slice = assets.slice(nextIndex, nextIndex + MAX_ASSET_BYTES_PER_BACKUP)
  const copiedKeys = payload.r2.copiedKeys.slice()
  for (const asset of slice) {
    try {
      const destKey = `${payload.r2.assetsPrefix}${asset.key.replace(/^uploads\//, '')}`
      const copied = await copyObject(env.ASSETS, asset.key, destKey)
      if (copied) copiedKeys.push(asset.key)
    } catch (_) {
      // Best-effort per-asset, same as createCloudflareBackup's first
      // slice -- one bad/missing object shouldn't stall the rest of the
      // catalog.
    }
  }
  // Advance past every asset ATTEMPTED this slice, not just the ones that
  // actually succeeded -- tracked explicitly here rather than inferred
  // from copiedKeys.length, which would diverge (and get stuck retrying
  // the same failed object forever) the moment any single copy fails.
  const newNextIndex = nextIndex + slice.length
  const complete = newNextIndex >= assets.length

  payload.r2.copiedKeys = copiedKeys
  payload.r2.assetCopyProgress = { nextIndex: newNextIndex, complete }
  payload.summary.assetsBackedUp = copiedKeys.length
  payload.summary.assetsSkipped = Math.max(0, assets.length - copiedKeys.length)

  await env.ASSETS.put(key, JSON.stringify(payload), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { source: payload.source, createdAt: payload.createdAt, format: payload.format },
  })

  if (!complete && env.BACKUP_QUEUE) {
    await env.BACKUP_QUEUE.send({ kind: 'backup-continue', backupName, nextIndex: newNextIndex } satisfies BackupQueueMessage)
  }

  return { key, skipped: false as const, nextIndex: newNextIndex, complete, summary: payload.summary }
}

export async function pruneCloudflareBackups(env: Env, keep = CLOUDFLARE_BACKUP_KEEP) {
  const backups = await listCloudflareBackups(env)
  const removed: string[] = []
  for (const item of backups.slice(Math.max(0, keep))) {
    await env.ASSETS.delete(item.key)
    // The backup's own copied-asset-bytes subfolder (assets/) is a
    // separate set of R2 objects, not deleted by removing the manifest
    // .json above -- without this, every pruned backup left its copied
    // images behind forever, silently growing R2 usage with objects no
    // backup listing referenced anymore. item.name is the manifest's own
    // filename (matches backupName in createCloudflareBackup, since the
    // manifest key is `${CLOUDFLARE_BACKUP_PREFIX}${backupName}.json`).
    const backupName = item.name.replace(/\.json$/, '')
    const assetsPrefix = `${CLOUDFLARE_BACKUP_PREFIX}${backupName}/assets/`
    try {
      const assetObjects = await listObjects(env.ASSETS, assetsPrefix)
      await Promise.all(assetObjects.map((o) => env.ASSETS.delete(o.key)))
    } catch (_) {
      // Non-fatal -- an orphaned copied-asset folder from a pruned backup
      // doesn't affect app correctness, only R2 usage.
    }
    removed.push(item.key)
  }
  return { kept: backups.slice(0, keep), removed }
}

export async function maybeRunScheduledBackup(env: Env) {
  const backups = await listCloudflareBackups(env)
  const newest = backups[0]?.uploaded ? Date.parse(backups[0].uploaded) : 0

  // Retention runs FIRST, and unconditionally.
  //
  // It used to run only after a new backup was successfully created, which
  // meant it did not run at all in the two cases that matter most:
  //
  //   1. The skip path below returned early, so a 6-hourly cron that found a
  //      5-hour-old backup pruned nothing.
  //   2. createCloudflareBackup threw -- and it threw for a long time with
  //      "Exceeded Memory Limit" on a large database. Every one of those
  //      failures also silently skipped retention.
  //
  // The observable result was old backups piling up in R2 forever despite
  // CLOUDFLARE_BACKUP_KEEP being 2, quietly consuming the 10 GB free tier
  // and taking the copied-asset folders with them.
  //
  // Keeping the newest N is a decision about what is already stored; it does
  // not depend on whether today's backup succeeded, so it must not be gated
  // on that. Failing to prune must also never prevent a backup, hence the
  // catch: running low on retention is recoverable, having no backup is not.
  let retention: { kept: unknown[]; removed: string[] } | null = null
  try {
    retention = await pruneCloudflareBackups(env, CLOUDFLARE_BACKUP_KEEP)
  } catch (error) {
    console.error('[backup] retention pass failed', error)
  }

  if (newest && Date.now() - newest < 5.5 * 60 * 60 * 1000) {
    return { skipped: true, reason: 'recent-backup-exists', latest: backups[0], retention }
  }
  const backup = await createCloudflareBackup(env, 'scheduled')
  // Second pass: the backup just written is now the newest, so this is what
  // drops what has become the (N+1)th.
  const finalRetention = await pruneCloudflareBackups(env, CLOUDFLARE_BACKUP_KEEP)
  return { skipped: false, backup, retention: finalRetention }
}

async function loadBackup(env: Env, source: string): Promise<{ key: string; payload: BackupPayload }> {
  const raw = String(source || '').trim()
  const key = raw.startsWith(CLOUDFLARE_BACKUP_PREFIX)
    ? raw
    : `${CLOUDFLARE_BACKUP_PREFIX}${raw.replace(/^\/+/, '')}`
  const object = await env.ASSETS.get(key)
  if (!object) throw new Error(`Backup not found: ${raw}`)
  const payload = await object.json<BackupPayload>()
  if (payload?.format !== 'business-os-cloudflare-backup' || payload.formatVersion !== 1 || !payload.tables) {
    throw new Error('Unsupported backup format')
  }
  return { key, payload }
}

export async function restoreCloudflareBackup(env: Env, source: string) {
  const { key, payload } = await loadBackup(env, source)
  const tableNames = BACKUP_TABLES.filter((table) => payload.tables[table])
  const statements: Array<{ sql: string; values: unknown[] }> = []

  for (const table of [...tableNames].reverse()) {
    if (await tableExists(env, table)) statements.push({ sql: `DELETE FROM ${qid(table)}`, values: [] })
  }

  for (const table of tableNames) {
    if (!(await tableExists(env, table))) continue
    const tableBackup = payload.tables[table]
    const liveColumns = new Set(await tableColumns(env, table))
    const columns = tableBackup.columns.filter((column) => liveColumns.has(column))
    if (!columns.length) continue
    const placeholders = columns.map(() => '?').join(', ')
    const sql = `INSERT INTO ${qid(table)} (${columns.map(qid).join(', ')}) VALUES (${placeholders})`
    for (const row of tableBackup.rows || []) {
      statements.push({ sql, values: columns.map((column) => row[column] ?? null) })
    }
  }

  const chunkSize = 80
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize).map((statement) => env.DB.prepare(statement.sql).bind(...statement.values))
    await env.DB.batch(chunk)
  }

  // Restore whichever asset bytes this backup actually copied (see
  // createCloudflareBackup's MAX_ASSET_BYTES_PER_BACKUP cap -- a backup
  // taken before this fix, or one whose catalog exceeded the cap, may
  // have copiedKeys missing or incomplete; restoredAssets/missingAssets
  // below makes that visible instead of a restore silently claiming every
  // product's image came back when some didn't).
  const copiedKeys = payload.r2?.copiedKeys || []
  const assetsPrefix = payload.r2?.assetsPrefix
  let restoredAssets = 0
  const missingAssets: string[] = []
  if (assetsPrefix) {
    for (const originalKey of copiedKeys) {
      try {
        const backedUpKey = `${assetsPrefix}${originalKey.replace(/^uploads\//, '')}`
        const ok = await copyObject(env.ASSETS, backedUpKey, originalKey)
        if (ok) restoredAssets += 1
        else missingAssets.push(originalKey)
      } catch (_) {
        missingAssets.push(originalKey)
      }
    }
  }

  return {
    key,
    restoredAt: new Date().toISOString(),
    summary: payload.summary,
    tables: tableNames.length,
    statements: statements.length,
    restoredAssets,
    assetsNotRestored: (payload.r2?.assets?.length || 0) - restoredAssets,
    missingAssets: missingAssets.length ? missingAssets : undefined,
  }
}

export async function validateCloudflareBackup(env: Env, source: string) {
  const { key, payload } = await loadBackup(env, source)
  return {
    key,
    createdAt: payload.createdAt,
    source: payload.source,
    summary: payload.summary,
    tables: Object.keys(payload.tables || {}).length,
    // Surfaces the asset-completeness gap described on summary.assetsSkipped
    // at validate/dry-run time too, not just after a real restore.
    assetsBackedUp: payload.r2?.copiedKeys?.length ?? payload.summary?.assetsBackedUp ?? 0,
    assetCount: payload.r2?.assets?.length ?? payload.summary?.assetCount ?? 0,
    restorable: payload.format === 'business-os-cloudflare-backup' && payload.formatVersion === 1,
  }
}

export async function storeSystemJob(env: Env, job: Record<string, unknown>) {
  const id = String(job.id || crypto.randomUUID())
  const item = { id, updated_at: new Date().toISOString(), ...job }
  await env.CACHE.put(`system-job:${id}`, JSON.stringify(item), { expirationTtl: 7 * 24 * 60 * 60 })
  return item
}

export async function getSystemJob(env: Env, id: string) {
  const raw = await env.CACHE.get(`system-job:${id}`)
  return raw ? JSON.parse(raw) as Record<string, unknown> : null
}

// Legacy backend/src/routes/system/index.ts exposes GET /system/jobs backed
// by a `system_jobs` SQL table (ORDER BY created_at DESC LIMIT). Cloudflare
// stores jobs in KV instead (see storeSystemJob above), which has no ORDER
// BY, so we page through the prefix and sort client-side.
export async function listSystemJobs(env: Env, limit = 25) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25))
  const items: Record<string, unknown>[] = []
  let cursor: string | undefined
  do {
    const page = await env.CACHE.list({ prefix: 'system-job:', cursor, limit: 1000 })
    for (const key of page.keys) {
      const raw = await env.CACHE.get(key.name)
      if (!raw) continue
      try {
        items.push(JSON.parse(raw))
      } catch {
        // skip malformed entries rather than fail the whole list
      }
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  items.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
  return items.slice(0, safeLimit)
}
