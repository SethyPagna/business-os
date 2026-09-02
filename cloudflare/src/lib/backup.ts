import type { Env } from '../index'
import { copyObject, listObjects } from './r2'
import { streamBackupEvents } from './backupRestoreStream'
import { getPlanLimits } from './planTier'

export const CLOUDFLARE_BACKUP_PREFIX = 'backups/cloudflare/'
export const CLOUDFLARE_BACKUP_KEEP = 2
// Drive restores are first staged and structurally validated under this flat
// prefix. They are intentionally excluded from normal R2 backup listing and
// retention so a temporary recovery candidate can never evict either of the
// two locally-created finalized backups.
export const DRIVE_STAGED_BACKUP_PREFIX = `${CLOUDFLARE_BACKUP_PREFIX}drive-staged-`

// Real R2 object-copy is a get()+put() (see r2.ts's copyObject) -- one
// subrequest pair per asset. Workers' free-plan subrequest-per-invocation
// ceiling means a catalog with thousands of images can't all be copied in
// one backup call; this caps how many asset *bytes* get copied per backup
// run so the call stays inside that budget rather than failing partway
// with no visibility. Assets beyond the cap are still LISTED in the
// manifest (as before) but their bytes are not copied this run --
// `summary.assetsBackedUp` vs `summary.assetsSkipped` makes that visible
// instead of silently claiming a complete asset backup that isn't one.
// Each copy is one R2 get plus one R2 put -- two internal-service
// subrequests. A4 (session 05) re-based this onto the Feb-2026 platform:
// Workers Paid now allows 10,000 subrequests per invocation (pinned
// explicitly in wrangler.toml), so 100 copies = ~200 subrequests, 2% of
// the budget, with the lifecycle state read/write, manifest work and
// queue send costing single digits on top. The copies run SEQUENTIALLY
// (each awaited), so the real per-run bound is wall time: ~100-200ms per
// asset copy keeps a full slice inside ~10-20s, which both the manual
// request path and the queue continuation tolerate. Full coverage of the
// ~20k-object catalog drops from ~1,000 runs to ~200. History: this was
// 20 under the Free plan's older model (and 40 before that, which could
// fail before the continuation was recorded). Exported so the regression
// tests seed their fixtures relative to the real cap instead of pinning
// a copy of the number that silently drifts.
//
// This is the PAID value -- planTier.ts's maxAssetsPerBackup mirrors it,
// with Free restored to that documented "20 under the Free plan's older
// model" figure above. writeBackupDocument and
// continueCloudflareBackupAssetCopy each shadow this identifier with a
// per-request `getPlanLimits(env).maxAssetsPerBackup` local so a Free
// deployment actually copies the smaller slice -- kept as a plain exported
// number here so every other reader (tests included) is unaffected.
export const MAX_ASSET_BYTES_PER_BACKUP = 100
const MAX_ASSET_COPY_ATTEMPTS = 3
const BACKUP_LIFECYCLE_FORMAT = 'business-os-cloudflare-backup-state'
const BACKUP_LIFECYCLE_VERSION = 1
const MANAGED_BACKUP_MARKER = 'sidecar-v1'
const STALE_BACKUP_MS = 24 * 60 * 60 * 1000

// A single backup run can only ever byte-copy MAX_ASSET_BYTES_PER_BACKUP
// assets, so full coverage of a catalog bigger than that has to come from
// several runs. Left alone, "several runs" wasn't actually guaranteed to
// converge: each run just took R2's list-order "first N", so if the
// catalog's key order didn't shift between runs (the common case), every
// run copied the *same* first 40 assets forever and the rest were never
// backed up. This cursor (persisted in KV, the same binding
// storeSystemJob/getSystemJob already use for cross-invocation state)
// makes each run resume where the previous one left off and wrap back to
// the start once it reaches the end -- so ceil(assetCount / cap) runs are
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

// Ordered by FK dependency: restore INSERTs in this order (parents first)
// and DELETEs in reverse (children first), so every child table must appear
// AFTER every table it references.
//
// Part-77 CRITICAL (x3 audits) + b9's follow-up sweep of every CREATE TABLE
// in migrations/: this list had drifted far behind the schema -- the whole
// lot ledger (product_batches / branch_batch_stock / *_batch_allocations),
// damaged_stock_lots, fees (real money records), loyalty_point_adjustments
// (member balances are COMPUTED from these), return_replacement_items,
// promotion_rules, user notes, duplicate dismissals, the import
// commit/guard ledgers (idempotency truth -- losing them lets a re-queued
// chunk re-apply stock), share submissions, dated-count actions, rfid_tags
// and ai_provider_configs were ALL absent, so every full backup silently
// dropped them and every restore came back without them.
//
// Deliberately still excluded (with reasons, so the next sweep doesn't have
// to re-derive them): user_sessions/trusted_devices/verification_codes/
// login_lockouts/rate_limit_events (auth ephemera -- a restore must not
// resurrect sessions or half-done resets), cache_versions/quota_usage
// (runtime state), image_audit/image_audit_state (regenerated by the 6h
// sweep), bulk_delete_jobs (transient job state), rfid_events/
// rfid_scan_sessions/rfid_session_items (scan telemetry),
// ai_response_logs (logs), organizations/organization_groups (owned and
// reseeded by coreDataInvariants -- restoring an old org identity row would
// fight its PREVIOUS_IDENTITIES adoption), business_os_migration_status
// (live migration bookkeeping), import_job_rows/import_job_source_rows/
// import_job_row_signatures/import_job_image_matches/import_job_image_renames
// (bulky regenerable staging the K4 retention sweep prunes -- import_job_rows,
// the per-row analyze/apply RESULT log, was originally IN this list and on
// production reached 244k rows / ~246MB, which alone made the streamed backup
// manifest large enough to push a full scheduled backup toward the CPU /
// wall-time ceiling; it is the 24h detail tier, not business data, and its
// re-apply safety lives in the separately-kept import_*_commits/guards
// idempotency ledgers, so dropping it costs a restore neither correctness nor
// idempotency),
// system_flags (0089 -- the restore MAINTENANCE flag lives there precisely
// so the restore that sets it cannot delete it; backing it up would restore
// a stale "maintenance on" state), and the per-custom-table data tables
// (dynamic DDL -- flagged in progress.md, not silently coverable by a
// static list).
export const BACKUP_TABLES = [
  'settings',
  'roles',
  'users',
  'user_notes',
  'pending_actions',
  'branches',
  'categories',
  'units',
  'suppliers',
  'customers',
  'customer_share_submissions',
  'delivery_contacts',
  'contact_duplicate_dismissals',
  'products',
  'product_duplicate_dismissals',
  'product_batches',
  'branch_stock',
  'branch_batch_stock',
  'damaged_stock_lots',
  'dated_stock_count_batch_actions',
  'rfid_tags',
  'product_images',
  'file_assets',
  'promotions',
  'promotion_rules',
  'ai_provider_configs',
  'sales',
  'sale_items',
  'sale_item_batch_allocations',
  'returns',
  'return_items',
  'return_item_batch_allocations',
  'return_replacement_items',
  'fees',
  'loyalty_point_adjustments',
  'inventory_movements',
  'stock_transfers',
  'stock_row_moves',
  'import_jobs',
  'import_job_files',
  'import_job_batches',
  'import_job_errors',
  'import_auto_merges',
  'import_sales_commits',
  'import_stock_action_commits',
  'import_stock_action_groups',
  'import_stock_action_guards',
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
  summary: {
    tableCount: number
    rowCount: number
    assetCount: number
    assetsBackedUp: number
    assetsSkipped: number
    // Latest applied migration name at backup time (e.g. "0085_..."), so a
    // restore can refuse a backup taken on a NEWER schema than the live
    // database -- the column-intersection insert below would otherwise
    // silently drop the newer columns' data. Absent on older backups.
    schemaMigration?: string | null
  }
}

// Latest applied migration name, from wrangler's own bookkeeping table.
// Best-effort: a fresh test database (or a very old deployment) may not
// have d1_migrations at all -- then this is null and the restore-time
// schema comparison simply doesn't run.
async function latestAppliedMigration(env: Env): Promise<string | null> {
  try {
    if (!(await tableExists(env, 'd1_migrations'))) return null
    const row = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1').first<{ name: string }>()
    return row?.name || null
  } catch (_) {
    return null
  }
}

// Migrations are named NNNN_description.sql; the leading number is the
// schema ordering. Null when the name doesn't carry one.
export function migrationNumber(name: string | null | undefined): number | null {
  const match = /^(\d+)/.exec(String(name || '').trim())
  return match ? Number(match[1]) : null
}

// Message shape sent to (and read back from) BACKUP_QUEUE. Kept minimal --
// everything else needed to resume (which assets, which prefix, what's
// been copied so far) lives on the manifest itself, read fresh by
// continueCloudflareBackupAssetCopy on each invocation, not carried in the
// message.
export type BackupQueueMessage = { kind: 'backup-continue'; backupName: string; nextIndex?: number }

export type BackupLifecycleState = {
  format: typeof BACKUP_LIFECYCLE_FORMAT
  version: typeof BACKUP_LIFECYCLE_VERSION
  backupName: string
  manifestKey: string
  createdAt: string
  updatedAt: string
  finalizedAt?: string
  source: 'manual' | 'scheduled'
  status: 'copying' | 'finalized' | 'partial' | 'failed'
  assetsPrefix: string
  assets: BackupPayload['r2']['assets']
  copiedKeys: string[]
  pendingKeys: string[]
  failedKeys: string[]
  attempts: Record<string, number>
  systemJobId?: string
}

function backupStateKey(backupName: string): string {
  return `${CLOUDFLARE_BACKUP_PREFIX}${backupName}/state.json`
}

async function putBackupState(env: Env, state: BackupLifecycleState): Promise<void> {
  state.updatedAt = new Date().toISOString()
  await env.ASSETS.put(backupStateKey(state.backupName), JSON.stringify(state), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { format: BACKUP_LIFECYCLE_FORMAT, status: state.status, updatedAt: state.updatedAt },
  })
}

export async function getCloudflareBackupState(env: Env, backupName: string): Promise<BackupLifecycleState | null> {
  const object = await env.ASSETS.get(backupStateKey(backupName))
  if (!object) return null
  const state = await object.json<BackupLifecycleState>()
  if (state?.format !== BACKUP_LIFECYCLE_FORMAT || state.version !== BACKUP_LIFECYCLE_VERSION) return null
  return state
}

async function syncLinkedBackupJob(env: Env, state: BackupLifecycleState): Promise<void> {
  if (!state.systemJobId) return
  const current = await getSystemJob(env, state.systemJobId)
  if (!current) return
  const total = state.assets.length
  const progress = state.status === 'finalized' || state.status === 'failed'
    ? 100
    : total
      ? Math.max(5, Math.min(99, Math.round((state.copiedKeys.length / total) * 100)))
      : 5
  const status = state.status === 'finalized'
    ? 'completed'
    : state.status === 'failed' || state.status === 'partial'
      ? 'failed'
      : 'running'
  const message = state.status === 'finalized'
    ? 'Cloudflare backup finalized'
    : state.status === 'failed' || state.status === 'partial'
      ? `Cloudflare backup incomplete (${state.failedKeys.length || state.pendingKeys.length} asset(s) unavailable)`
      : `Cloudflare backup copying assets (${state.copiedKeys.length}/${total})`
  await storeSystemJob(env, {
    ...current,
    status,
    progress,
    message,
    error: status === 'failed' ? message : null,
    finished_at: status === 'running' ? null : new Date().toISOString(),
  })
}

export async function linkCloudflareBackupJob(env: Env, backupName: string, systemJobId: string): Promise<void> {
  const state = await getCloudflareBackupState(env, backupName)
  if (!state) return
  state.systemJobId = systemJobId
  await putBackupState(env, state)
  await syncLinkedBackupJob(env, state)
}

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
  const items: Array<{
    key: string
    name: string
    size: number
    uploaded: string | null
    status: 'copying' | 'finalized' | 'partial' | 'failed'
    finalized: boolean
  }> = []
  let cursor: string | undefined
  do {
    const page = await env.ASSETS.list({
      prefix: CLOUDFLARE_BACKUP_PREFIX,
      cursor,
      limit: 1000,
      include: ['customMetadata'],
    })
    for (const object of page.objects || []) {
      if (!object.key.endsWith('.json')) continue
      if (object.key.startsWith(DRIVE_STAGED_BACKUP_PREFIX)) continue
      // state.json lives under a backup folder and is not a backup manifest.
      if (object.key.endsWith('/state.json')) continue
      const name = object.key.slice(CLOUDFLARE_BACKUP_PREFIX.length)
      const backupName = name.replace(/\.json$/, '')
      const managed = object.customMetadata?.lifecycle === MANAGED_BACKUP_MARKER
      const state = managed ? await getCloudflareBackupState(env, backupName) : null
      // Existing backups predate lifecycle sidecars. Treat them as finalized
      // for backward compatibility; a new managed manifest without its
      // sidecar is copying/unfinished and can never evict a known-good backup.
      const status = managed ? (state?.status || 'copying') : 'finalized'
      items.push({
        key: object.key,
        name,
        size: object.size,
        uploaded: object.uploaded?.toISOString?.() || null,
        status,
        finalized: status === 'finalized',
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
  return writeBackupDocument(env, { tables: BACKUP_TABLES, includeAssets: true, source })
}

/**
 * The one backup writer. Streams the manifest straight to R2 a page at a
 * time, so no table is ever fully resident in the Worker's memory and the
 * document is never assembled as a single string.
 *
 * `tables` is what makes a scoped backup possible: pass every BACKUP_TABLE
 * for a full backup, or just the tables a reset is about to delete for a
 * scoped one. `includeAssets` covers the other half of the cost -- listing
 * and byte-copying R2 objects -- which only a full backup needs.
 *
 * Both scopes go through this function on purpose. The scoped backup used
 * to be a separate, simpler implementation that read whole tables with a
 * bare `SELECT *` and JSON.stringify'd them in memory; that was fine for
 * the 1-2 tiny tables it was written for, and would have reintroduced the
 * original out-of-memory failure the moment it was pointed at `products`.
 */
async function writeBackupDocument(
  env: Env,
  options: { tables: readonly string[]; includeAssets: boolean; source: 'manual' | 'scheduled' },
) {
  const { tables, includeAssets, source } = options
  const createdAt = new Date().toISOString()
  let rowCount = 0
  let tableCount = 0
  // Tier-aware shadow -- see MAX_ASSET_BYTES_PER_BACKUP's module-level comment.
  const MAX_ASSET_BYTES_PER_BACKUP = getPlanLimits(env).maxAssetsPerBackup

  const assets = includeAssets ? await listAssets(env) : []
  const backupName = `business-os-cloudflare-${stamp(new Date(createdAt))}`
  const assetsPrefix = `${CLOUDFLARE_BACKUP_PREFIX}${backupName}/assets/`

  let copiedKeys: string[] = []
  const pendingKeys: string[] = []
  const failedKeys: string[] = []
  const attempts: Record<string, number> = {}
  let assetCopyProgress: BackupPayload['r2']['assetCopyProgress']

  if (!includeAssets) {
    // A scoped backup lists and copies nothing from R2. Skipping the
    // bucket listAssets() call and the per-asset get()+put() pairs is
    // itself a meaningful part of the CPU and subrequest cost a scoped
    // backup exists to avoid, and none of the tables a scoped backup
    // covers owns an R2 object that the manifest would need.
    assetCopyProgress = { nextIndex: 0, complete: true }
  } else if (env.BACKUP_QUEUE) {
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
      attempts[asset.key] = 1
      try {
        const destKey = `${assetsPrefix}${asset.key.replace(/^uploads\//, '')}`
        const copied = await copyObject(env.ASSETS, asset.key, destKey)
        if (copied) copiedKeys.push(asset.key)
        else pendingKeys.push(asset.key)
      } catch (_) {
        pendingKeys.push(asset.key)
      }
    }
    pendingKeys.push(...assets.slice(firstSlice.length).map((asset) => asset.key))
    const nextIndex = firstSlice.length
    const complete = pendingKeys.length === 0
    assetCopyProgress = { nextIndex, complete }
  } else {
    // No-queue fallback -- byte-for-byte the original Part 48 behavior.
    // Which N assets get copied resumes from the persisted cross-run
    // cursor (see its comment above) so repeated manually-triggered runs
    // still make real progress across the whole catalog instead of
    // repeatedly copying the same first 40.
    const priorCursor = await getAssetCopyCursor(env)
    // Explicit cap (not the default param) -- selectAssetsToCopy's own
    // default resolves against the module-level (Paid) MAX_ASSET_BYTES_
    // PER_BACKUP, not this function's tier-aware shadow above.
    const toCopy = selectAssetsToCopy(assets, priorCursor, MAX_ASSET_BYTES_PER_BACKUP)
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
    customMetadata: { source, createdAt, format, lifecycle: MANAGED_BACKUP_MARKER },
  })
  const writer = new R2StreamWriter(upload)

  try {
    // Same document as before, emitted in order rather than assembled.
    await writer.write(`{"format":${JSON.stringify(format)},"formatVersion":1,`)
    await writer.write(`"createdAt":${JSON.stringify(createdAt)},`)
    await writer.write(`"source":${JSON.stringify(source)},`)
    await writer.write('"runtime":"cloudflare-workers","tables":{')

    for (const table of tables) {
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
      schemaMigration: await latestAppliedMigration(env),
    }))
    await writer.write('}')
    await writer.finish()
  } catch (error) {
    await writer.abort()
    throw error
  }

  // Lifecycle lives in a small sidecar. Continuation workers update only
  // this document, never parse/rewrite the potentially huge database
  // manifest. This is also the source of truth for finalized retention.
  const status: BackupLifecycleState['status'] = !includeAssets || copiedKeys.length === assets.length
    ? 'finalized'
    : env.BACKUP_QUEUE
      ? 'copying'
      : 'partial'
  const lifecycle: BackupLifecycleState = {
    format: BACKUP_LIFECYCLE_FORMAT,
    version: BACKUP_LIFECYCLE_VERSION,
    backupName,
    manifestKey: key,
    createdAt,
    updatedAt: createdAt,
    finalizedAt: status === 'finalized' ? new Date().toISOString() : undefined,
    source,
    status,
    assetsPrefix,
    assets,
    copiedKeys,
    pendingKeys,
    failedKeys,
    attempts,
  }
  await putBackupState(env, lifecycle)

  // Enqueue only AFTER both the manifest and lifecycle state are durable.
  // Previously the queue send happened first, so a fast consumer could see
  // no manifest, acknowledge the message as a no-op and strand the backup.
  if (status === 'copying' && env.BACKUP_QUEUE) {
    await env.BACKUP_QUEUE.send({ kind: 'backup-continue', backupName, nextIndex: copiedKeys.length } satisfies BackupQueueMessage)
  }

  const summary = {
    tableCount,
    rowCount,
    assetCount: assets.length,
    assetsBackedUp: copiedKeys.length,
    assetsSkipped: Math.max(0, assets.length - copiedKeys.length),
  }
  return { key, name: key.slice(CLOUDFLARE_BACKUP_PREFIX.length), createdAt, status, summary }
}

// Scoped backup: dumps ONLY the tables a given reset is about to delete,
// with no R2 asset listing or copying at all.
//
// It exists because the full createCloudflareBackup above -- a pass over
// all ~34 BACKUP_TABLES (sales, sale_items, inventory_movements,
// audit_logs, ...) plus a full bucket listAssets() -- was being run
// synchronously in front of resets that only touch a few tables, and on a
// store with real history that genuinely exceeded the Worker's CPU-time
// limit: the backup meant to make the reset SAFE was what crashed it.
// Reported first for /reset-section, then again for /reset-data's
// products mode ("Exceeded CPU Limit", whole request failing, no data
// changed).
//
// `restoreCloudflareBackup` above already deletes+restores only whichever
// tables are present in `payload.tables` and treats `r2.copiedKeys`/
// `assetsPrefix` as optional, so a manifest with a subset of tables and an
// empty asset list restores correctly through the exact same code path --
// no restore-side changes needed. Same manifest format/prefix as a full
// backup, so it still lists in `listCloudflareBackups` and is restorable
// from the same UI.
//
// The caller is responsible for passing EVERY table its reset will delete:
// a scoped backup that misses one is a backup that cannot undo the reset
// it was taken for. routes/system.ts derives both lists from the same
// place for exactly that reason.
export async function createSectionBackup(env: Env, tables: readonly string[], source: 'manual' | 'scheduled' = 'manual') {
  return writeBackupDocument(env, { tables, includeAssets: false, source })
}

// Queue consumer entry point (called from queue.ts's handleBackupQueue for
// each 'backup-continue' message). Copies the next free-plan-safe slice from
// the lifecycle sidecar's fixed asset snapshot, updates only that small
// sidecar, and re-enqueues itself until finished. The large DB manifest stays
// immutable.
export async function continueCloudflareBackupAssetCopy(env: Env, backupName: string, _nextIndex?: number) {
  // Tier-aware shadow -- see MAX_ASSET_BYTES_PER_BACKUP's module-level comment.
  const MAX_ASSET_BYTES_PER_BACKUP = getPlanLimits(env).maxAssetsPerBackup
  const key = `${CLOUDFLARE_BACKUP_PREFIX}${backupName}.json`
  const manifest = await env.ASSETS.head(key)
  if (!manifest) {
    return { key, skipped: true, reason: 'manifest-not-found' as const }
  }
  const state = await getCloudflareBackupState(env, backupName)
  // Never fall back to object.json() on the full manifest: that was the
  // memory bug this sidecar exists to remove. A pre-sidecar continuation
  // remains an honest partial legacy backup and cannot evict finalized ones.
  if (!state) return { key, skipped: true, reason: 'state-not-found' as const }
  if (state.status === 'finalized') {
    return { key, skipped: true, reason: 'already-complete' as const, status: state.status }
  }
  if (state.status === 'failed' || state.status === 'partial') {
    return { key, skipped: true, reason: 'not-resumable' as const, status: state.status }
  }

  const slice = state.pendingKeys.slice(0, MAX_ASSET_BYTES_PER_BACKUP)
  if (!slice.length) {
    state.status = state.failedKeys.length ? 'failed' : 'finalized'
    if (state.status === 'finalized') state.finalizedAt = new Date().toISOString()
    await putBackupState(env, state)
    await syncLinkedBackupJob(env, state)
    if (state.status === 'finalized') await pruneCloudflareBackups(env, CLOUDFLARE_BACKUP_KEEP)
    return { key, skipped: false as const, complete: true, status: state.status }
  }

  const copied = new Set(state.copiedKeys)
  const remaining = state.pendingKeys.slice(slice.length)
  for (const assetKey of slice) {
    state.attempts[assetKey] = (state.attempts[assetKey] || 0) + 1
    try {
      const destKey = `${state.assetsPrefix}${assetKey.replace(/^uploads\//, '')}`
      const ok = await copyObject(env.ASSETS, assetKey, destKey)
      if (ok) {
        copied.add(assetKey)
      } else if (state.attempts[assetKey] < MAX_ASSET_COPY_ATTEMPTS) {
        remaining.push(assetKey)
      } else {
        state.failedKeys.push(assetKey)
      }
    } catch (_) {
      if (state.attempts[assetKey] < MAX_ASSET_COPY_ATTEMPTS) remaining.push(assetKey)
      else state.failedKeys.push(assetKey)
    }
  }

  state.copiedKeys = [...copied]
  state.pendingKeys = remaining
  const complete = remaining.length === 0
  if (complete) {
    state.status = state.failedKeys.length ? 'failed' : 'finalized'
    if (state.status === 'finalized') state.finalizedAt = new Date().toISOString()
  }
  await putBackupState(env, state)
  await syncLinkedBackupJob(env, state)

  if (!complete && env.BACKUP_QUEUE) {
    await env.BACKUP_QUEUE.send({ kind: 'backup-continue', backupName, nextIndex: state.copiedKeys.length } satisfies BackupQueueMessage)
  } else if (state.status === 'finalized') {
    // Retention happens at finalization, not at manifest creation. Until
    // this point the new backup is not allowed to displace either of the
    // two known-good finalized backups.
    await pruneCloudflareBackups(env, CLOUDFLARE_BACKUP_KEEP)
  }

  return {
    key,
    skipped: false as const,
    nextIndex: state.copiedKeys.length,
    complete,
    status: state.status,
    assetsBackedUp: state.copiedKeys.length,
    assetsFailed: state.failedKeys.length,
  }
}

export async function pruneCloudflareBackups(env: Env, keep = CLOUDFLARE_BACKUP_KEEP) {
  const backups = await listCloudflareBackups(env)
  const finalized = backups.filter((item) => item.finalized)
  const incomplete = backups.filter((item) => !item.finalized)
  const removed: string[] = []
  const staleRemoved: string[] = []

  const deleteBackupSet = async (item: typeof backups[number]) => {
    const backupName = item.name.replace(/\.json$/, '')
    const backupPrefix = `${CLOUDFLARE_BACKUP_PREFIX}${backupName}/`
    // Delete the FOLDER (assets/ + state.json) BEFORE the manifest. The old
    // order deleted the manifest first and, if listObjects then failed, left
    // the whole <name>/assets/ folder behind with no manifest -- and because
    // listCloudflareBackups only enumerates top-level .json manifests, that
    // folder became permanently invisible to every future prune. On production
    // this stranded 21 backup folders (~220 MB). Folder-first means: if the
    // folder listing/delete fails, the manifest survives so the set stays fully
    // listable and is retried next prune; a manifest left without its folder is
    // harmless and self-heals (next prune lists an empty folder and drops it).
    // pruneOrphanedBackupFolders() below is the backstop for any that slipped
    // through under the old code.
    try {
      const objects = await listObjects(env.ASSETS, backupPrefix)
      const folderKeys = objects.map((object) => object.key)
      for (let offset = 0; offset < folderKeys.length; offset += 500) {
        await env.ASSETS.delete(folderKeys.slice(offset, offset + 500))
      }
    } catch (_) {
      // Listing the folder failed -- leave the manifest in place so the set
      // stays reachable and is retried next prune. Do NOT orphan the folder.
      return
    }
    await env.ASSETS.delete(item.key)
  }

  // Only finalized backups count toward the retention promise. A new
  // copying/partial/failed set cannot evict either known-good backup.
  for (const item of finalized.slice(Math.max(0, keep))) {
    await deleteBackupSet(item)
    removed.push(item.key)
  }

  // Incomplete artifacts are a separate lifecycle, not retained backups.
  // Give active queue work a full day, then remove stale/failed/partial sets
  // so they cannot become the unexplained R2 growth reported by the user.
  for (const item of incomplete) {
    const uploadedMs = item.uploaded ? Date.parse(item.uploaded) : 0
    if (!uploadedMs || Date.now() - uploadedMs < STALE_BACKUP_MS) continue
    await deleteBackupSet(item)
    staleRemoved.push(item.key)
  }

  // Backstop: sweep backup FOLDERS whose manifest is gone. listCloudflareBackups
  // (and therefore everything above) only enumerates top-level <name>.json
  // manifests, so a <name>/assets/ folder left without its manifest -- by the
  // old delete order, a listObjects hiccup, or any partial delete -- is
  // invisible to normal retention and accumulates one set every backup forever.
  // This catches them by prefix instead of trusting the manifest list.
  let orphanRemoved: string[] = []
  try {
    orphanRemoved = await pruneOrphanedBackupFolders(env)
  } catch (error) {
    console.error('[backup] orphan-folder sweep failed', error)
  }

  return {
    kept: finalized.slice(0, Math.max(0, keep)),
    removed,
    incomplete: incomplete.filter((item) => !staleRemoved.includes(item.key)),
    staleRemoved,
    orphanRemoved,
  }
}

// Deletes backup FOLDERS (backups/cloudflare/<name>/…) that have no
// corresponding top-level <name>.json manifest. Such a folder cannot be
// restored (restore needs the manifest) and is unreachable by
// listCloudflareBackups/pruneCloudflareBackups, so nothing else ever removes
// it. A real in-progress backup always writes its manifest BEFORE any folder
// object (see writeBackupDocument), so a manifest-less folder is already an
// orphan; a short grace window on the folder's newest object guards only
// against list-ordering races, never against a legitimate live backup.
async function pruneOrphanedBackupFolders(env: Env): Promise<string[]> {
  const ORPHAN_FOLDER_GRACE_MS = 60 * 60 * 1000 // 1h
  const manifests = new Set<string>()
  const folders = new Map<string, { keys: string[]; newestMs: number }>()
  let cursor: string | undefined
  do {
    const page = await env.ASSETS.list({ prefix: CLOUDFLARE_BACKUP_PREFIX, cursor, limit: 1000 })
    for (const object of page.objects || []) {
      const rest = object.key.slice(CLOUDFLARE_BACKUP_PREFIX.length)
      const slash = rest.indexOf('/')
      if (slash === -1) {
        if (rest.endsWith('.json')) manifests.add(rest.replace(/\.json$/, ''))
        continue
      }
      const name = rest.slice(0, slash)
      const entry = folders.get(name) || { keys: [], newestMs: 0 }
      entry.keys.push(object.key)
      const ms = object.uploaded?.getTime?.() || 0
      if (ms > entry.newestMs) entry.newestMs = ms
      folders.set(name, entry)
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  const removed: string[] = []
  for (const [name, entry] of folders) {
    if (manifests.has(name)) continue // has a manifest -> a known backup; normal retention owns it
    if (entry.newestMs && Date.now() - entry.newestMs < ORPHAN_FOLDER_GRACE_MS) continue // too fresh; guard the race
    for (let offset = 0; offset < entry.keys.length; offset += 500) {
      await env.ASSETS.delete(entry.keys.slice(offset, offset + 500))
    }
    removed.push(name)
  }
  return removed
}

export async function maybeRunScheduledBackup(env: Env) {
  const backups = await listCloudflareBackups(env)
  const newestFinalized = backups.find((item) => item.finalized)
  const newest = newestFinalized?.uploaded ? Date.parse(newestFinalized.uploaded) : 0
  const activeCopy = backups.find((item) => item.status === 'copying')
  const activeCopyMs = activeCopy?.uploaded ? Date.parse(activeCopy.uploaded) : 0

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

  if (activeCopyMs && Date.now() - activeCopyMs < STALE_BACKUP_MS) {
    return { skipped: true, reason: 'backup-in-progress', latest: activeCopy, retention }
  }
  if (newest && Date.now() - newest < 5.5 * 60 * 60 * 1000) {
    return { skipped: true, reason: 'recent-backup-exists', latest: newestFinalized, retention }
  }
  const backup = await createCloudflareBackup(env, 'scheduled')
  // Second pass: the backup just written is now the newest, so this is what
  // drops what has become the (N+1)th.
  const finalRetention = await pruneCloudflareBackups(env, CLOUDFLARE_BACKUP_KEEP)
  return { skipped: false, backup, retention: finalRetention }
}

function resolveBackupKey(source: string): string {
  const raw = String(source || '').trim()
  return raw.startsWith(CLOUDFLARE_BACKUP_PREFIX)
    ? raw
    : `${CLOUDFLARE_BACKUP_PREFIX}${raw.replace(/^\/+/, '')}`
}

/** Opens a fresh read stream over a backup object, or throws if it is gone. */
async function openBackupStream(env: Env, key: string): Promise<ReadableStream<Uint8Array>> {
  const object = await env.ASSETS.get(key)
  if (!object) throw new Error(`Backup not found: ${key}`)
  // The writer stamps the format in customMetadata, so we can reject an
  // unsupported document without parsing it (the whole point of streaming).
  const format = object.customMetadata?.format
  if (format && format !== 'business-os-cloudflare-backup') {
    throw new Error('Unsupported backup format')
  }
  if (!object.body) throw new Error('Backup object has no body to stream')
  return object.body
}

// onProgress (optional): called at phase changes, table boundaries and every
// few row batches -- routes/backups.ts persists it into the maintenance
// flag's state so a crashed restore shows exactly where it died. Errors from
// the callback are deliberately not caught: if progress cannot be recorded,
// the restore's crash-visibility contract is already broken.
export type RestoreProgress = { phase: 'deleting' | 'inserting' | 'assets'; table?: string; rowsDone?: number }

export async function restoreCloudflareBackup(env: Env, source: string, onProgress?: (progress: RestoreProgress) => Promise<void>) {
  const key = resolveBackupKey(source)

  // Streaming restore (10.1). The old path called object.json() -- the ENTIRE
  // backup parsed into one object -- then built an INSERT for every row before
  // applying any, so a database large enough to have OOMed its own backup
  // OOMed restoring it. Now the document is read as a byte stream and applied
  // one bounded batch at a time; peak memory is a single row plus a small carry
  // buffer, never the whole backup.
  //
  // Two passes, because foreign keys demand all DELETEs (children first) before
  // any INSERT (parents first), and streaming discovers tables one at a time:
  //   Pass 1 -- read table headers only, to learn which backup tables exist
  //             live and in what order, then DELETE them in reverse.
  //   Pass 2 -- stream rows and INSERT them in batches; capture the small
  //             r2/summary metadata (which follows the tables) for asset restore.

  // Pass 1: which BACKUP_TABLES are present in this document AND exist live.
  // Also captures the trailing summary meta -- the schema guard below must
  // run on it BEFORE pass 2 deletes anything.
  const presentTables: string[] = []
  const documentTables = new Set<string>()
  let pass1Summary: BackupPayload['summary'] | null = null
  {
    for await (const ev of streamBackupEvents(await openBackupStream(env, key))) {
      if (ev.type === 'table' && !documentTables.has(ev.table)) {
        documentTables.add(ev.table)
        if ((BACKUP_TABLES as readonly string[]).includes(ev.table) && await tableExists(env, ev.table)) {
          presentTables.push(ev.table)
        }
      } else if (ev.type === 'meta' && ev.key === 'summary') {
        pass1Summary = ev.value as BackupPayload['summary']
      }
      // rows ignored in pass 1 -- nothing is held.
    }
  }

  // Schema guard (Part-77): the insert below writes only the intersection of
  // the backup's columns and the live table's columns, so restoring a backup
  // taken on a NEWER schema would silently DROP whatever the newer columns
  // held. Refuse that direction outright -- and refuse BEFORE any delete, so
  // a refused restore changes nothing. The other direction (live newer than
  // the backup) is legitimate -- new columns fill with their defaults -- and
  // is reported, not blocked. Backups from before this stamp carry no
  // schemaMigration and skip the comparison.
  const backupMigration = pass1Summary?.schemaMigration ?? null
  const liveMigration = await latestAppliedMigration(env)
  const backupMigrationNumber = migrationNumber(backupMigration)
  const liveMigrationNumber = migrationNumber(liveMigration)
  if (backupMigrationNumber != null && liveMigrationNumber != null && backupMigrationNumber > liveMigrationNumber) {
    throw new Error(
      `This backup was taken on a newer database schema (${backupMigration}) than this deployment has applied (${liveMigration}). `
      + 'Apply the pending migrations first, then restore -- restoring now would silently drop the newer columns??data.',
    )
  }
  const schemaMismatch = backupMigration && liveMigration && backupMigration !== liveMigration
    ? { backup: backupMigration, live: liveMigration }
    : null

  // Honesty over silence (Part-77): a table this deployment backs up that
  // the DOCUMENT doesn't carry (an older backup, from before that table
  // joined BACKUP_TABLES) is neither cleared nor restored -- its live rows
  // survive against otherwise-rolled-back data. That can leave e.g. the lot
  // ledger describing stock the restored branch_stock no longer has. Report
  // exactly which tables that applies to instead of letting the restore
  // read as complete.
  const tablesNotInBackup = (BACKUP_TABLES as readonly string[]).filter((t) => !documentTables.has(t))

  // Order by BACKUP_TABLES (the writer's dependency order) so the reverse
  // delete respects foreign keys regardless of the document's own order.
  const orderedTables: string[] = BACKUP_TABLES.filter((t) => presentTables.includes(t))

  let statementCount = 0
  await onProgress?.({ phase: 'deleting' })
  for (const table of [...orderedTables].reverse()) {
    await env.DB.prepare(`DELETE FROM ${qid(table)}`).run()
    statementCount += 1
  }

  // Pass 2: stream rows and insert in bounded batches, per table.
  const CHUNK = 80
  const liveColumnsCache = new Map<string, Set<string>>()
  let insertSql = ''
  let insertColumns: string[] = []
  let batch: D1PreparedStatement[] = []
  let restoreTable = ''
  let r2Meta: BackupPayload['r2'] | null = null
  let summaryMeta: BackupPayload['summary'] | null = null

  // Progress throttle: report every 10th flush (~800 rows) rather than each
  // one -- the maintenance-state write behind onProgress is one extra D1
  // statement, and per-flush reporting would add ~1.25% statement overhead
  // for no extra crash-visibility.
  let tableRowsDone = 0
  let flushesSinceProgress = 0

  const flush = async () => {
    if (!batch.length) return
    await env.DB.batch(batch)
    statementCount += batch.length
    tableRowsDone += batch.length
    batch = []
    flushesSinceProgress += 1
    if (flushesSinceProgress >= 10) {
      flushesSinceProgress = 0
      await onProgress?.({ phase: 'inserting', table: restoreTable || undefined, rowsDone: tableRowsDone })
    }
  }

  for await (const ev of streamBackupEvents(await openBackupStream(env, key))) {
    if (ev.type === 'table') {
      await flush()
      if (orderedTables.includes(ev.table)) {
        tableRowsDone = 0
        flushesSinceProgress = 0
        await onProgress?.({ phase: 'inserting', table: ev.table, rowsDone: 0 })
      }
      restoreTable = ''
      if (!orderedTables.includes(ev.table)) { insertSql = ''; insertColumns = []; continue }
      let liveColumns = liveColumnsCache.get(ev.table)
      if (!liveColumns) { liveColumns = new Set(await tableColumns(env, ev.table)); liveColumnsCache.set(ev.table, liveColumns) }
      insertColumns = ev.columns.filter((c) => liveColumns!.has(c))
      if (!insertColumns.length) { insertSql = ''; continue }
      // sql-bound-params: bounded by construction -- one parameter per COLUMN,
      // one statement per row, and a table has far fewer than 100 columns, so
      // this never nears D1's 100-parameter cap.
      const placeholders = insertColumns.map(() => '?').join(', ')
      insertSql = `INSERT INTO ${qid(ev.table)} (${insertColumns.map(qid).join(', ')}) VALUES (${placeholders})`
      restoreTable = ev.table
    } else if (ev.type === 'row') {
      if (!restoreTable || !insertSql) continue
      const values = insertColumns.map((c) => ev.row[c] ?? null)
      batch.push(env.DB.prepare(insertSql).bind(...values))
      if (batch.length >= CHUNK) await flush()
    } else if (ev.type === 'meta') {
      if (ev.key === 'r2') r2Meta = ev.value as BackupPayload['r2']
      else if (ev.key === 'summary') summaryMeta = ev.value as BackupPayload['summary']
    }
  }
  await flush()
  await onProgress?.({ phase: 'assets' })

  // Restore whichever asset bytes this backup actually copied (best-effort;
  // see createCloudflareBackup's MAX_ASSET_BYTES_PER_BACKUP cap). A backup
  // taken before the asset-copy work, or one whose catalog exceeded the cap,
  // may have copiedKeys missing/incomplete; restoredAssets/missingAssets makes
  // that visible instead of silently claiming every image came back.
  const backupName = key.slice(CLOUDFLARE_BACKUP_PREFIX.length).replace(/\.json$/, '')
  const lifecycle = await getCloudflareBackupState(env, backupName)
  const copiedKeys = lifecycle?.copiedKeys || r2Meta?.copiedKeys || []
  const assetsPrefix = lifecycle?.assetsPrefix || r2Meta?.assetsPrefix
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
    summary: summaryMeta,
    tables: orderedTables.length,
    statements: statementCount,
    restoredAssets,
    assetsNotRestored: (lifecycle?.assets?.length || r2Meta?.assets?.length || 0) - restoredAssets,
    missingAssets: missingAssets.length ? missingAssets : undefined,
    schemaMigration: backupMigration,
    schemaMismatch: schemaMismatch || undefined,
    tablesNotInBackup: tablesNotInBackup.length ? tablesNotInBackup : undefined,
  }
}

export async function validateCloudflareBackup(env: Env, source: string) {
  const key = resolveBackupKey(source)
  const streamed = await inspectCloudflareBackupStream(await openBackupStream(env, key))
  const backupName = key.slice(CLOUDFLARE_BACKUP_PREFIX.length).replace(/\.json$/, '')
  const lifecycle = await getCloudflareBackupState(env, backupName)
  const copiedCount = lifecycle?.copiedKeys.length ?? streamed.r2?.copiedKeys?.length ?? streamed.summary?.assetsBackedUp ?? 0
  const assetCount = lifecycle?.assets.length ?? streamed.r2?.assets?.length ?? streamed.summary?.assetCount ?? 0
  return {
    key,
    createdAt: streamed.createdAt,
    source: streamed.source,
    summary: streamed.summary,
    tables: streamed.tableCount,
    // Surfaces the asset-completeness gap described on summary.assetsSkipped
    // at validate/dry-run time too, not just after a real restore.
    assetsBackedUp: copiedCount,
    assetCount,
    status: lifecycle?.status || 'finalized',
    failedAssets: lifecycle?.failedKeys.length || 0,
    restorable: !lifecycle || lifecycle.status === 'finalized',
  }
}

export type StreamedBackupInspection = {
  createdAt: string
  source: string
  runtime: string
  summary: BackupPayload['summary']
  r2: BackupPayload['r2'] | null
  tableCount: number
  rowCount: number
}

/**
 * Validates a complete backup document without materializing its tables.
 * Exported for the Google Drive staging path, which tees the remote response:
 * one branch streams into R2 while this branch proves the format, version,
 * JSON structure and summary counts. Any corruption rejects the stage.
 */
export async function inspectCloudflareBackupStream(
  body: ReadableStream<Uint8Array>,
): Promise<StreamedBackupInspection> {
  let format = ''
  let formatVersion = 0
  let createdAt = ''
  let source = ''
  let runtime = ''
  let summary: BackupPayload['summary'] | null = null
  let r2: BackupPayload['r2'] | null = null
  let tableCount = 0
  let rowCount = 0
  for await (const event of streamBackupEvents(body)) {
    if (event.type === 'table') tableCount += 1
    else if (event.type === 'row') rowCount += 1
    else if (event.key === 'format') format = String(event.value || '')
    else if (event.key === 'formatVersion') formatVersion = Number(event.value || 0)
    else if (event.key === 'createdAt') createdAt = String(event.value || '')
    else if (event.key === 'source') source = String(event.value || '')
    else if (event.key === 'runtime') runtime = String(event.value || '')
    else if (event.key === 'summary') summary = event.value as BackupPayload['summary']
    else if (event.key === 'r2') r2 = event.value as BackupPayload['r2']
  }
  if (format !== 'business-os-cloudflare-backup' || formatVersion !== 1 || !summary || !r2) {
    throw new Error('Unsupported backup format')
  }
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) throw new Error('Backup has an invalid creation timestamp')
  if (source !== 'manual' && source !== 'scheduled') throw new Error('Backup has an invalid source')
  if (runtime !== 'cloudflare-workers') throw new Error('Backup has an invalid runtime')
  if (Number(summary.tableCount) !== tableCount || Number(summary.rowCount) !== rowCount) {
    throw new Error('Backup summary counts do not match its streamed table data')
  }
  return { createdAt, source, runtime, summary, r2, tableCount, rowCount }
}

export async function storeSystemJob(env: Env, job: Record<string, unknown>) {
  const id = String(job.id || crypto.randomUUID())
  // Generated identity/freshness fields must win over a caller spreading a
  // previously stored job. Otherwise lifecycle progress updates retain their
  // original timestamp and appear stuck in the UI/system-job sort order.
  const item = { ...job, id, updated_at: new Date().toISOString() }
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
