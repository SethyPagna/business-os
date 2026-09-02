import { Hono } from 'hono'
import { enqueueImageNormalization } from '../lib/imageAudit'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission, hasAnyPermission, isActionBlocked } from '../lib/permissions'
import { audit } from '../lib/audit'
import { sanitizeOriginalFileName, buildUniqueStoredName, getMediaType } from '../lib/fileAssets'
import { validateUploadedBuffer } from '../lib/uploadSecurity'
import { runImportAnalyze, runImportApply, buildErrorsCsv, loadAndClassify, resetMaterializeState, summarizeImportWarnings, countRowsWithWarningKinds, SERIOUS_IMPORT_WARNING_KINDS, IMPORT_WARNING_LABELS, type ImportRowResult, type RowAction } from '../lib/importEngine'
import { getPlanLimits } from '../lib/planTier'
import { readCentralDirectory, extractZipEntry, isRealFileEntry, ZipFormatError } from '../lib/zipReader'
import { MAX_IMAGES_PER_PRODUCT, buildImageDisplayName } from '../lib/importImageMatch'
import { bumpVersion } from '../lib/cache'
import { broadcast } from '../durable-objects/broadcastHub'
import { canEditImportDecisions, canReplaceImportCsv, retryModeForImportStatus } from '../lib/importLifecycleGate'
import { importJobFullDeleteStatements, importJobStagingDeleteStatements } from '../lib/importRetention'
import { buildImportReviewOrder, buildImportReviewWhere, buildUnresolvedContactReviewWhere, buildUnresolvedProductReviewWhere } from '../lib/importReviewQuery'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

const ALLOWED_TYPES = new Set(['products', 'customers', 'suppliers', 'delivery_contacts', 'inventory', 'sales', 'stock_actions'])
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const MAX_CSV_BYTES = 80 * 1024 * 1024
const MAX_ZIP_BYTES = 2048 * 1024 * 1024
const MAX_IMAGES_PER_REQUEST = 200

function extname(name: string): string {
  const match = /\.[^./\\]+$/.exec(name)
  return match ? match[0].toLowerCase() : ''
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

function permissionForType(type: string): string {
  const normalized = String(type || 'products').trim().toLowerCase()
  if (['customers', 'suppliers', 'delivery_contacts'].includes(normalized)) return 'contacts'
  if (normalized === 'inventory') return 'inventory'
  if (normalized === 'sales') return 'sales'
  return 'products'
}

function permissionsForType(type: string): string[] {
  const normalized = String(type || 'products').trim().toLowerCase()
  return normalized === 'stock_actions'
    ? ['products', 'inventory', 'sales']
    : [permissionForType(normalized)]
}

function permittedTypes(user: SessionUser): string[] {
  return [...ALLOWED_TYPES].filter((type) => permissionsForType(type).every((permission) => hasPermission(user, permission)))
}

async function getJob(env: Env, id: string) {
  return getDb(env).prepare(`SELECT * FROM import_jobs WHERE id = @id`).get<Record<string, unknown>>({ id })
}

// Per-action override (Part 546): which `section:import` switch governs an
// import type. This includes Sales now that its view-tier action table is
// exposed by the permission editor.
function importActionSection(type: string): string | null {
  const normalized = String(type || 'products').trim().toLowerCase()
  if (['customers', 'suppliers', 'delivery_contacts'].includes(normalized)) return 'contacts'
  if (normalized === 'inventory' || normalized === 'stock_actions') return 'inventory'
  if (normalized === 'sales') return 'sales'
  return 'products'
}

async function requireImportPermission(c: any, job: Record<string, unknown> | undefined, bodyType?: string) {
  const user = c.get('user')
  const type = (job?.type as string) || bodyType || 'products'
  const missingPermission = permissionsForType(type).find((permission) => !hasPermission(user, permission))
  if (missingPermission) {
    return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: missingPermission }, 403)
  }
  // A role with the full grant can still have this import type's
  // `section:import` action switched off in the permission editor.
  const overrideSection = importActionSection(type)
  if (overrideSection && isActionBlocked(user, overrideSection, 'import')) {
    return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: `${overrideSection}:import` }, 403)
  }
  return null
}

function serializeJob(job: Record<string, unknown>) {
  return {
    ...job,
    policy: safeJsonParse(job.policy_json as string, {}),
    summary: safeJsonParse(job.summary_json as string, {}),
  }
}

function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text)
  } catch (_) {
    return fallback
  }
}

async function auditImportEvent(c: any, action: string, jobId: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  const user = c.get('user')
  await audit(c.env, user?.id ?? null, user?.name ?? null, action, 'import_job', jobId, {
    jobId,
    jobType: (after?.type || before?.type) ?? null,
    oldStatus: before?.status ?? null,
    newStatus: after?.status ?? null,
    oldPhase: before?.phase ?? null,
    newPhase: after?.phase ?? null,
    ...extra,
  })
}

// GET /api/import-jobs/queue/status -- must be registered before /:id
app.get('/queue/status', async (c) => {
  const user = c.get('user')
  if (!hasAnyPermission(user, ['products', 'contacts', 'inventory', 'sales'])) {
    return c.json({ success: false, error: 'No permission', code: 'forbidden' }, 403)
  }
  const db = getDb(c.env)
  const counts = await db.prepare(`SELECT status, COUNT(*) AS count FROM import_jobs GROUP BY status`).all<{ status: string; count: number }>()
  return c.json({
    success: true,
    queue: {
      driver: 'cloudflare-queues',
      producers: ['business-os-import'],
      byStatus: Object.fromEntries(counts.map((row) => [row.status, row.count])),
    },
  })
})

// A job that dies mid-phase (worker crashed, D1 CPU-limit reset -- see
// queue.ts's comment on why `status` can be left on 'analyzing'/'applying'
// forever once nothing re-enqueues the next chunk) never reaches a terminal
// status on its own, so it sat in the tracker's active-job count
// indefinitely -- this is why "4 imports" could show after only ever
// starting one real import, with the other 3 being old dead ones from
// earlier sessions. The frontend tracker now flags a job like this as
// visually "stalled" once it's gone quiet for a few minutes (see
// BackgroundImportTracker.tsx's isStalledActiveJob), but that's read-only --
// it still needs the person to notice and manually cancel/remove each one.
// This closes the loop server-side: any job that's been sitting in an
// active status with no `updated_at` movement for a long time (well beyond
// the ~150-row chunk cadence, so this never fires on a job that's still
// genuinely being worked) is auto-marked failed with a clear last_error,
// which moves it out of ACTIVE_STATUSES on the very next poll without
// anyone having to act on it. Runs as a narrow, self-limiting UPDATE (WHERE
// status IN (...) AND updated_at older than the cutoff) ahead of every
// list call -- once a row is reaped it no longer matches that WHERE clause,
// so this is a no-op write on every poll after the first for a given job.
const STALLED_IMPORT_JOB_REAP_MINUTES = 20

export async function reapStalledImportJobs(env: Env): Promise<void> {
  const db = getDb(env)
  await db.prepare(`
    UPDATE import_jobs
    SET status = 'failed', phase = 'failed', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
        last_error = 'Stalled: no progress update received for over ${STALLED_IMPORT_JOB_REAP_MINUTES} minutes (the background worker likely crashed or was reset mid-import). Safe to retry.'
    WHERE status IN ('pending', 'queued', 'analyzing', 'running', 'applying', 'approved')
      AND updated_at < datetime('now', '-${STALLED_IMPORT_JOB_REAP_MINUTES} minutes')
  `).run().catch(() => { /* best-effort housekeeping -- a failed reap shouldn't break the list endpoint */ })
  await db.prepare(`
    UPDATE import_jobs
    SET status = 'cancelled', phase = 'cancelled', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
        last_error = COALESCE(NULLIF(last_error, ''), 'Cancel never confirmed by the worker -- treated as cancelled after a long timeout.')
    WHERE status = 'cancelling'
      AND updated_at < datetime('now', '-${STALLED_IMPORT_JOB_REAP_MINUTES} minutes')
  `).run().catch(() => {})
}

app.get('/', async (c) => {
  const user = c.get('user')
  if (!hasAnyPermission(user, ['products', 'contacts', 'inventory', 'sales'])) {
    return c.json({ success: false, error: 'No permission', code: 'forbidden' }, 403)
  }
  const types = permittedTypes(user)
  if (!types.length) return c.json({ success: true, jobs: [] })
  await reapStalledImportJobs(c.env)
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query('limit') || '50', 10) || 50))
  // sql-bound-params: bounded by construction -- permittedTypes() returns
  // a subset of the fixed import-type enum, never a per-row list.
  const placeholders = types.map(() => '?').join(', ')
  // fileName: the job's own source file (the CSV that was uploaded), not
  // an image asset -- used by the Dashboard's "Recent imports" card so it
  // can show the actual file someone uploaded ("march-restock.csv") instead
  // of only a generic "products import" label. A subquery rather than a
  // JOIN so a job with multiple attached files (e.g. product images tied
  // to the same import) can't fan out into duplicate job rows.
  const rows = await c.env.DB.prepare(`
    SELECT j.*, (
      SELECT original_name FROM import_job_files
      WHERE job_id = j.id AND kind = 'csv'
      ORDER BY id ASC LIMIT 1
    ) AS file_name
    FROM import_jobs j
    WHERE j.type IN (${placeholders})
    ORDER BY j.created_at DESC LIMIT ?
  `).bind(...types, limit).all<Record<string, unknown>>()
  return c.json({ success: true, jobs: (rows.results || []).map(serializeJob) })
})

app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const type = String(body?.type || 'products').trim().toLowerCase()
  if (!ALLOWED_TYPES.has(type)) return c.json({ success: false, error: 'Unsupported import job type' }, 400)
  const denied = await requireImportPermission(c as any, undefined, type)
  if (denied) return denied
  // Replace-all (products) soft-deactivates every active product this run
  // doesn't touch, and column-level replace overwrites whichever fields
  // the operator picked on every matched row -- both are more destructive
  // than an ordinary merge import, but import_mode/replace_columns live
  // inside the client-supplied policy blob with nothing else gating them.
  // The frontend's mode picker + window.confirm are a UI nicety, not a
  // security boundary: a raw POST here with the same ordinary 'products'
  // permission could otherwise trigger either. Reuse the existing
  // 'destructive_delete' permission (defined in permissions.ts, exposed in
  // the admin permission editor) as the extra gate, same as any other
  // destructive-beyond-the-base-entity action should be.
  const requestedImportMode = (body?.policy as { import_mode?: unknown } | undefined)?.import_mode
  if (type === 'products' && (requestedImportMode === 'replace_all' || requestedImportMode === 'replace_columns')) {
    if (!hasPermission(user, 'destructive_delete')) {
      return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: 'destructive_delete' }, 403)
    }
    // Per-action override (Part 546): 'products:import_replace_all' can be
    // switched off for a role even when destructive_delete is granted.
    if (isActionBlocked(user, 'products', 'import_replace_all')) {
      return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: 'products:import_replace_all' }, 403)
    }
  }

  const id = crypto.randomUUID()
  const db = getDb(c.env)
  await db.prepare(`
    INSERT INTO import_jobs (id, type, status, phase, queue_driver, policy_json, created_by_id, created_by_name)
    VALUES (@id, @type, 'pending', 'created', 'cloudflare-queues', @policy_json, @created_by_id, @created_by_name)
  `).run({
    id, type,
    policy_json: JSON.stringify(body?.policy || {}),
    created_by_id: user?.id ?? null,
    created_by_name: user?.name ?? null,
  })
  const job = await getJob(c.env, id)
  await auditImportEvent(c, 'import_job_create', id, null, job || null, { source: body?.source || 'api' })
  return c.json({ success: true, job: serializeJob(job || { id, type }) })
})

app.get('/:id', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  const db = getDb(c.env)
  const files = await db.prepare(`SELECT id, kind, original_name, relative_path, byte_size, status, error_message, file_asset_id FROM import_job_files WHERE job_id = @id ORDER BY id ASC`).all({ id })
  const errors = await db.prepare(`SELECT id, row_number, file_name, code, message FROM import_job_errors WHERE job_id = @id ORDER BY id ASC LIMIT 200`).all({ id })
  return c.json({ success: true, job: serializeJob(job), files, errors })
})

app.get('/:id/review', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied

  const page = Math.max(1, Number.parseInt(c.req.query('page') || '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(c.req.query('pageSize') || '50', 10) || 50))
  const filter = (c.req.query('type') || c.req.query('filter') || 'all').toLowerCase()
  const query = (c.req.query('query') || c.req.query('q') || '').toLowerCase().trim()
  const orderBy = buildImportReviewOrder(c.req.query('sort'))
  // Filters down to only rows carrying a specific warning kind (e.g.
  // 'name_match', the contacts-import "same name as an existing record"
  // case) -- what ContactImportConflictsModal.tsx uses to build its
  // review list, instead of the caller having to page through every
  // create/update/skip row hunting for the handful that actually need a
  // decision. Independent of `filter`/`type` above (action-based); both
  // can combine, though callers so far only ever use one or the other.
  // Accepts a comma-separated list ('name_match,membership_phone_conflict')
  // so a single request can pull every conflict kind a caller cares about
  // (ContactImportConflictsModal.tsx groups the result by kind client-side)
  // instead of one request per kind against a paginated endpoint, which
  // would make each kind's own page/total wrong relative to the combined
  // list the reviewer actually needs to work through.
  const warningKinds = (c.req.query('warningKind') || '')
    .split(',')
    .map((k) => k.trim())
    .filter((kind): kind is keyof typeof IMPORT_WARNING_LABELS => kind in IMPORT_WARNING_LABELS)
    .slice(0, 8)

  // Reads the ANALYZE phase's persisted per-row results (import_job_rows,
  // written incrementally by the chunked runImportAnalyze -- see
  // importEngine.ts / migration 0011) instead of re-fetching the CSV and
  // reclassifying the entire file on every single paginated request the
  // way this endpoint used to. That old approach reclassified the whole
  // file (page 1 of 50 rows costs the same as page 1 of 50,000 rows) on
  // every page turn/filter/search keystroke -- expensive even on a Paid
  // plan, and exactly the kind of repeated full-file CPU work the Free
  // plan's 10ms-per-invocation limit can't tolerate for a sizeable import.
  const db = getDb(c.env)
  const actionFilter: RowAction | null = (['create', 'update', 'skip', 'error'] as const).includes(filter as RowAction) ? filter as RowAction : null
  const where = buildImportReviewWhere({ jobId: id, action: actionFilter, query, warningKinds })
  const totalRow = await db.staging.prepare(`SELECT COUNT(*) AS n FROM import_job_rows WHERE ${where.sql}`)
    .get<{ n: number }>(where.params)
  const total = Number(totalRow?.n || 0)
  const offset = (page - 1) * pageSize
  const rows = await db.staging.prepare(`
    SELECT row_number, action, identifier, result_json
    FROM import_job_rows
    WHERE ${where.sql}
    ORDER BY ${orderBy}
    LIMIT @limit OFFSET @offset
  `).all<{ row_number: number; action: string; identifier: string | null; result_json: string }>({
    ...where.params, limit: pageSize, offset,
  })
  const pageResults = rows.map((r) => JSON.parse(r.result_json) as ImportRowResult)

  // PATCH /:id/decisions persists reviewer choices onto policy_json's
  // decisionsByRowNumber, but this endpoint never read them back -- so a
  // saved "different person"/skip decision was applied correctly at
  // apply-time (getDecisionMap in importEngine.ts) yet vanished from the
  // review UI the moment it re-fetched (a remount, a page turn, reopening
  // the modal), making it look like the save silently failed. Attach each
  // row's own decision (if any) so the frontend can restore its resolved/
  // choice state from the server instead of only from its own local
  // per-mount state.
  const policyForDecisions = safeJsonParse<Record<string, any>>(job.policy_json as string, {})
  const decisionsByRowNumber = policyForDecisions.decisionsByRowNumber && typeof policyForDecisions.decisionsByRowNumber === 'object'
    ? policyForDecisions.decisionsByRowNumber
    : {}
  const pageResultsWithDecisions = pageResults.map((row) => ({
    ...row,
    decision: decisionsByRowNumber[String(row.rowNumber)] || null,
  }))

  const contactJob = ['customers', 'suppliers', 'delivery_contacts'].includes(String(job.type || ''))
  let unresolvedContactConflicts = 0
  if (contactJob) {
    const unresolvedWhere = buildUnresolvedContactReviewWhere(id, JSON.stringify(decisionsByRowNumber))
    const unresolvedRow = await db.staging.prepare(`SELECT COUNT(*) AS n FROM import_job_rows WHERE ${unresolvedWhere.sql}`)
      .get<{ n: number }>(unresolvedWhere.params)
    unresolvedContactConflicts = Number(unresolvedRow?.n || 0)
  }
  let unresolvedProductConflicts = 0
  if (String(job.type || '') === 'products') {
    const unresolvedWhere = buildUnresolvedProductReviewWhere(id, JSON.stringify(decisionsByRowNumber))
    const unresolvedRow = await db.staging.prepare(`SELECT COUNT(*) AS n FROM import_job_rows WHERE ${unresolvedWhere.sql}`)
      .get<{ n: number }>(unresolvedWhere.params)
    unresolvedProductConflicts = Number(unresolvedRow?.n || 0)
  }

  const countRows = await db.staging.prepare(`SELECT action, COUNT(*) AS n FROM import_job_rows WHERE job_id = @id AND phase = 'analyze' GROUP BY action`)
    .all<{ action: 'create' | 'update' | 'skip' | 'error'; n: number }>({ id })
  const counts = { create: 0, update: 0, skip: 0, error: 0 }
  for (const row of countRows) counts[row.action] = row.n

  const warnedRow = await db.staging.prepare(
    `SELECT COUNT(*) AS n FROM import_job_rows WHERE job_id = @id AND phase = 'analyze' AND action != 'error' AND json_extract(result_json, '$.message') IS NOT NULL`,
  ).get<{ n: number }>({ id })

  // Grouped "row-number notation" summary (e.g. "Same barcode, different
  // name: rows 5, 12, 89") for the current page's filter/search -- same
  // shape GET /:id/report returns for the whole job, but scoped to
  // whatever's currently on screen so the review page's own warning list
  // doesn't have to re-derive this client-side from raw per-row messages.
  const warningSummary = summarizeImportWarnings(pageResults)

  return c.json({ success: true, rows: pageResultsWithDecisions, page, pageSize, total, counts, warned: warnedRow?.n || 0, warningSummary, unresolvedContactConflicts, unresolvedProductConflicts })
})

// GET /:id/report -- the full import report for a finished (or in-progress)
// job: grouped warning notation across every row (not just the current
// page/filter, unlike /:id/review above), plus the headline counts a
// dashboard/audit-log "click a file, see its report" view needs. Read-only,
// safe to call repeatedly (e.g. every time the file list drilldown opens).
app.get('/:id/report', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied

  const db = getDb(c.env)
  // Report is built from the ANALYZE phase's persisted results (same
  // source /:id/review reads) even after apply has run -- analyze is the
  // authoritative "what did this file actually contain" pass; apply only
  // re-classifies against live DB state, which can legitimately drift from
  // what was originally imported (see runImportApply's own comment on
  // that) and isn't what a "what happened in this import" report is asking.
  const rows = await db.staging.prepare(
    `SELECT row_number, action, identifier, result_json FROM import_job_rows WHERE job_id = @id AND phase = 'analyze' ORDER BY row_number ASC`,
  ).all<{ row_number: number; action: string; identifier: string | null; result_json: string }>({ id })
  const parsed = rows.map((r) => JSON.parse(r.result_json) as ImportRowResult)

  const countRows = await db.staging.prepare(`SELECT action, COUNT(*) AS n FROM import_job_rows WHERE job_id = @id AND phase = 'analyze' GROUP BY action`)
    .all<{ action: 'create' | 'update' | 'skip' | 'error'; n: number }>({ id })
  const counts = { create: 0, update: 0, skip: 0, error: 0 }
  for (const row of countRows) counts[row.action] = row.n

  const errors = await db.prepare(`SELECT id, row_number, file_name, code, message FROM import_job_errors WHERE job_id = @id ORDER BY id ASC LIMIT 500`).all({ id })
  const files = await db.prepare(`SELECT id, kind, original_name, byte_size, status FROM import_job_files WHERE job_id = @id ORDER BY id ASC`).all({ id })

  const warningSummary = summarizeImportWarnings(parsed)
  // Distinct rows with >=1 serious warning, not a sum across kinds -- a row
  // with two serious warning kinds (e.g. negative_stock AND a barcode
  // collision) must only count once here, or this number can exceed
  // `warned` (rows affected) even though "needs attention" is a subset of
  // "affected". See countRowsWithWarningKinds' own comment for the report
  // that surfaced this (reported as "705 warnings" vs a much larger
  // "1000+ other warnings" on the same job).
  const seriousWarningCount = countRowsWithWarningKinds(parsed, SERIOUS_IMPORT_WARNING_KINDS)

  return c.json({
    success: true,
    job: serializeJob(job),
    files,
    counts,
    totalRows: parsed.length,
    // Keep the report headline in lockstep with import_jobs.warning_count:
    // both count affected (non-error) rows, including older result rows
    // that only have the legacy message field rather than warnings[].
    warned: parsed.filter((r) => r.action !== 'error' && ((r.warnings && r.warnings.length) || r.message)).length,
    seriousWarningCount,
    warningSummary,
    errorCount: errors.length,
    errors,
  })
})

app.patch('/:id/decisions', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  const status = String(job.status || '').toLowerCase()
  if (job.type === 'stock_actions') {
    return c.json({ success: false, error: 'Stock-action rows are sealed by analysis and cannot be overridden. Go back and upload a corrected sheet.' }, 409)
  }
  if (!canEditImportDecisions(job.type, status)) {
    return c.json({ success: false, error: 'Import decisions can only be changed while awaiting review.' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const incoming = body?.decisions || body?.rows || {}
  const db = getDb(c.env)
  const policy = safeJsonParse<Record<string, any>>(job.policy_json as string, {})
  const current = policy.decisionsByRowNumber && typeof policy.decisionsByRowNumber === 'object' ? policy.decisionsByRowNumber : {}
  policy.decisionsByRowNumber = { ...current, ...incoming }
  await db.prepare(`UPDATE import_jobs SET policy_json = @policy_json, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id, policy_json: JSON.stringify(policy) })
  const updated = await getJob(c.env, id)
  await auditImportEvent(c, 'import_job_decisions', id, job, updated || null, { source: body?.source || 'api', mode: 'review' })
  return c.json({ success: true, job: serializeJob(updated || job) })
})

// Manual "this image belongs to this row" match -- for an image that
// resolveRowImagePath/computeImportImageMatch (importEngine.ts) couldn't
// place automatically (no exact filename match, and nothing scored above
// the fuzzy threshold). Body: { file_id, row_number }. Setting row_number
// to null clears a previous manual assignment for that image, dropping it
// back into "unmatched" (or wherever auto-matching would otherwise place
// it) on the next analyze.
app.patch('/:id/images/assign', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied

  const body = await c.req.json().catch(() => ({}))
  const fileId = Number(body?.file_id)
  if (!fileId) return c.json({ success: false, error: 'file_id is required' }, 400)
  const db = getDb(c.env)
  const fileRow = await db.prepare(`SELECT id FROM import_job_files WHERE id = @fileId AND job_id = @id AND kind = 'image'`).get<{ id: number }>({ fileId, id })
  if (!fileRow) return c.json({ success: false, error: 'Image not found on this import job' }, 404)

  const policy = safeJsonParse<Record<string, any>>(job.policy_json as string, {})
  const overrides = policy.imageOverrides && typeof policy.imageOverrides === 'object' ? policy.imageOverrides : {}
  if (body?.row_number == null) {
    delete overrides[String(fileId)]
  } else {
    overrides[String(fileId)] = Number(body.row_number)
  }
  policy.imageOverrides = overrides
  await db.prepare(`UPDATE import_jobs SET policy_json = @policy_json, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id, policy_json: JSON.stringify(policy) })
  const updated = await getJob(c.env, id)
  await auditImportEvent(c, 'import_job_image_assign', id, job, updated || null, { source: 'api', fileId, rowNumber: body?.row_number ?? null })
  return c.json({ success: true, job: serializeJob(updated || job) })
})

// Manually attaches an unmatched image straight to an EXISTING catalog
// product -- for a plain image-only import (or a lazy CSV) where a
// photo doesn't correspond to any row in *this* job at all, just a
// product that already exists and needs a picture. Unlike /images/assign
// (which records a policy_json override that only takes effect once the
// job is approved/applied), this writes into the live product_images
// table immediately: there's no "row" for this image to ride in on, so
// there's nothing for a later `apply` step to commit. Body:
// { file_id, product_id }.
app.patch('/:id/images/assign-existing', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied

  const body = await c.req.json().catch(() => ({}))
  const fileId = Number(body?.file_id)
  const productId = Number(body?.product_id)
  if (!fileId) return c.json({ success: false, error: 'file_id is required' }, 400)
  if (!productId) return c.json({ success: false, error: 'product_id is required' }, 400)

  const db = getDb(c.env)
  const fileRow = await db.prepare(`
    SELECT id, original_name, stored_path, file_asset_id FROM import_job_files
    WHERE id = @fileId AND job_id = @id AND kind = 'image' AND status != 'rejected' AND status != 'linked_existing'
  `).get<{ id: number; original_name: string | null; stored_path: string; file_asset_id: number | null }>({ fileId, id })
  if (!fileRow) return c.json({ success: false, error: 'Image not found on this import job, or already linked' }, 404)

  const product = await db.prepare(`SELECT id, name, image_path FROM products WHERE id = @productId`).get<{ id: number; name: string; image_path: string | null }>({ productId })
  if (!product) return c.json({ success: false, error: 'Product not found' }, 404)

  const existingCount = (await db.prepare(`SELECT COUNT(*) AS count FROM product_images WHERE product_id = @productId`).get<{ count: number }>({ productId }))?.count || 0
  if (existingCount >= MAX_IMAGES_PER_PRODUCT) {
    return c.json({ success: false, error: `"${product.name}" already has the maximum of ${MAX_IMAGES_PER_PRODUCT} images` }, 400)
  }

  const publicPath = `/${String(fileRow.stored_path || '').replace(/^\/+/, '')}`
  const newName = buildImageDisplayName(product.name, fileRow.original_name || 'image.jpg', existingCount + 1, existingCount + 1)

  const statements: Array<{ sql: string; params: Record<string, unknown> }> = [
    { sql: `INSERT INTO product_images (product_id, image_path, sort_order) VALUES (@productId, @path, @order)`, params: { productId, path: publicPath, order: existingCount } },
    { sql: `UPDATE import_job_files SET status = 'linked_existing', original_name = @name WHERE id = @id`, params: { id: fileId, name: newName } },
  ]
  if (!product.image_path) {
    statements.push({ sql: `UPDATE products SET image_path = @path WHERE id = @productId`, params: { productId, path: publicPath } })
  }
  if (fileRow.file_asset_id) {
    statements.push({ sql: `UPDATE file_assets SET original_name = @name WHERE id = @id`, params: { id: fileRow.file_asset_id, name: newName } })
  }
  await db.batch(statements)

  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update', id: productId }))
  await auditImportEvent(c, 'import_job_image_assign_existing', id, job, job, { source: 'api', fileId, productId, productName: product.name })
  return c.json({ success: true, productId, imagePath: publicPath, originalName: newName })
})

// Records which images win when more than MAX_IMAGES_PER_PRODUCT (5)
// auto-matched the same row/product name -- overrides the engine's
// score-based auto-pick. Body: { row_number, keep_file_ids: number[] }.
app.patch('/:id/images/resolve-limit', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied

  const body = await c.req.json().catch(() => ({}))
  const rowNumber = body?.row_number
  const keepFileIds = Array.isArray(body?.keep_file_ids) ? body.keep_file_ids.map(Number).filter(Number.isFinite) : []
  if (rowNumber == null) return c.json({ success: false, error: 'row_number is required' }, 400)
  if (keepFileIds.length > MAX_IMAGES_PER_REQUEST) return c.json({ success: false, error: 'Too many images selected' }, 400)

  const db = getDb(c.env)
  const policy = safeJsonParse<Record<string, any>>(job.policy_json as string, {})
  const decisions = policy.imageLimitDecisions && typeof policy.imageLimitDecisions === 'object' ? policy.imageLimitDecisions : {}
  if (keepFileIds.length) decisions[String(rowNumber)] = keepFileIds
  else delete decisions[String(rowNumber)]
  policy.imageLimitDecisions = decisions
  await db.prepare(`UPDATE import_jobs SET policy_json = @policy_json, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id, policy_json: JSON.stringify(policy) })
  const updated = await getJob(c.env, id)
  await auditImportEvent(c, 'import_job_image_limit_resolve', id, job, updated || null, { source: 'api', rowNumber, keepCount: keepFileIds.length })
  return c.json({ success: true, job: serializeJob(updated || job) })
})


app.post('/:id/preflight', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  try {
    // Tier-aware: Free's smaller sample keeps this synchronous request
    // inside the 10ms CPU budget -- see planTier.ts's preflightMaxRows.
    const preflightMaxRows = getPlanLimits(c.env).preflightMaxRows
    const loaded = await loadAndClassify(c.env, id, preflightMaxRows)
    if (!loaded) return c.json({ success: false, error: 'Upload a CSV before previewing this import' }, 400)
    const counts = { create: 0, update: 0, skip: 0, error: 0 }
    for (const r of loaded.results) counts[r.action] += 1
    await auditImportEvent(c, 'import_job_preflight', id, job, job, { source: 'api', mode: 'preflight' })
    // IMPORTANT: the frontend (BulkImportModal.tsx's ensureServerPreflightReady,
    // and the equivalent contact/inventory/sales import modals) reads
    // `checkedRows`, `failures`, and `warnings` off this response -- not
    // `counts`/`total`. Those two field names never lined up after the
    // Cloudflare port: the route kept returning `{ counts, total }` while the
    // UI kept reading `preflight.checkedRows` (always undefined -> 0) and
    // `preflight.failures` (always undefined -> treated as "no failures", so
    // the import silently proceeded to /start anyway). That mismatch is
    // exactly the "Server preflight completed — 0 rows checked" message that
    // shows up regardless of how many rows are actually in the CSV. `counts`
    // and `total` are left in the response too (harmless extra fields) in
    // case any other caller still reads them.
    //
    // This only ever checks the first PREFLIGHT_MAX_ROWS rows (see that
    // constant's comment in importEngine.ts) -- a synchronous HTTP request
    // can't chunk itself across a person's browser the way the queued
    // analyze/apply phases now do. `partial`/`totalRowsInFile` let the
    // frontend say so rather than silently implying every row was checked.
    const failures = loaded.results
      .filter((r) => r.action === 'error')
      .map((r) => ({ rowNumber: r.rowNumber, code: 'validation_error', name: r.identifier || null, message: r.message || 'Row failed validation' }))
    // Non-blocking notices (barcode reused by a different product, negative
    // stock reset to 0, name/membership matches on contact imports -- see
    // classifyProducts/classifyContacts in importEngine.ts) live on
    // otherwise-normal create/update rows' `warnings` array (structured,
    // one entry per distinct issue with a real `kind` tag) and/or the
    // legacy joined `message` string for rows written before `warnings`
    // existed. This used to flatten every row down to a single generic
    // `code: 'warning'` entry with the raw joined message text -- losing
    // the specific kind (same barcode vs same SKU vs negative stock vs a
    // contact name/membership match) exactly where the person sees it
    // first, before they've even clicked through to the full review step.
    // Fixed to preserve `kind`/`label` per warning, and to emit one entry
    // per distinct warning on a row instead of one glommed string when a
    // row has more than one issue (e.g. negative stock AND a barcode
    // collision on the same line).
    const warnings = loaded.results
      .filter((r) => r.action !== 'error' && (r.message || (r.warnings && r.warnings.length)))
      .flatMap((r) => {
        if (r.warnings && r.warnings.length) {
          return r.warnings.map((w) => ({
            rowNumber: r.rowNumber,
            code: w.kind,
            label: IMPORT_WARNING_LABELS[w.kind] || IMPORT_WARNING_LABELS.other,
            name: r.identifier || null,
            message: w.message,
          }))
        }
        // Older/synthetic rows with only the joined `message` string and no
        // structured `warnings` array -- still surfaced, just under the
        // generic 'other' kind rather than silently dropped.
        return [{ rowNumber: r.rowNumber, code: 'other', label: IMPORT_WARNING_LABELS.other, name: r.identifier || null, message: r.message as string }]
      })
    // Grouped "row-number notation" summary (same shape /:id/review and
    // /:id/report already return) so a caller that wants the compact
    // kind-grouped view (e.g. reusing ImportReportModal's rendering) can
    // use it directly instead of re-grouping the flat `warnings` list
    // above itself. Scoped to only the rows this quick preflight actually
    // checked (see `partial` below), same caveat as everything else here.
    const warningSummary = summarizeImportWarnings(loaded.results)
    return c.json({
      success: true,
      ok: true,
      job,
      checkedRows: loaded.results.length,
      failures,
      warnings,
      warningSummary,
      counts,
      total: loaded.results.length,
      // Hit the cap exactly => there may be more rows in the file this
      // quick check never looked at (the real, complete check is the
      // queued analyze phase after POST /:id/start). Under the cap =>
      // this preflight covered the entire file.
      partial: loaded.results.length >= preflightMaxRows,
    })
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message || 'Failed to preflight import job' }, 400)
  }
})

// --- File uploads -----------------------------------------------------------

// Stores an import upload (CSV, image ZIP, or per-row image).
//
// ZIP/image uploads (kind !== 'csv') still land at the SAME canonical
// uploads/{storedName} path routes/files.ts uses for regular Library
// uploads, WITH a file_assets row alongside the import_job_files row
// (linked via file_asset_id) -- these are real product images the user
// explicitly wants reachable/wireable from Library afterward (per this
// session's own request: "in library i should be able to wire and
// search and apply the image to products"), same reasoning a prior
// session gave for making them show up there in the first place.
//
// The CSV/spreadsheet itself (kind === 'csv') deliberately does NOT get
// a file_assets row / does NOT appear in Library -- real, reported
// complaint this session: "the imports still put copy/download of the
// excels into the app/library". A spreadsheet that only exists to seed
// an import job isn't the kind of reusable asset Library is for (unlike
// a product image), and it was cluttering the Library list with one row
// per import run. Still stored in R2 (job-scoped path, not the shared
// uploads/ namespace, so it can never collide with or be mistaken for a
// real Library upload) and still tracked in import_job_files for the
// job's own history/audit -- just with file_asset_id left null and no
// files-channel broadcast. A user who explicitly wants a copy of their
// import spreadsheet kept can still upload it to Library separately,
// same as any other file -- the import flow itself just no longer does
// it FOR them automatically.
async function storeUpload(c: any, jobId: string, kind: 'csv' | 'zip' | 'image', file: File, relativePath?: string) {
  const user = c.get('user')
  const originalName = sanitizeOriginalFileName(file.name || 'upload.bin')
  const storedName = buildUniqueStoredName(originalName)
  const mimeType = file.type || 'application/octet-stream'
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (kind === 'image') {
    try {
      validateUploadedBuffer(bytes, mimeType, originalName)
    } catch (error) {
      throw new Error((error as Error).message)
    }
  }

  const addToLibrary = kind !== 'csv'
  const key = addToLibrary ? `uploads/${storedName}` : `imports/${jobId}/incoming/${storedName}`
  await c.env.ASSETS.put(key, bytes, { httpMetadata: { contentType: mimeType } })
  // K3: only library-bound files normalize (imports/... staging keys are
  // transient and outside the uploads/ audit scope); the helper's own
  // image-extension gate filters CSVs and other non-images.
  if (addToLibrary) await enqueueImageNormalization(c.env, key)

  const db = getDb(c.env)
  let fileAssetId: number | null = null
  if (addToLibrary) {
    const mediaType = getMediaType(mimeType, originalName)
    // source: 'import' (rather than files.ts's 'upload') so Library can tell
    // the two intake paths apart later if it ever wants to -- everything
    // else about the row is identical to a direct Library upload.
    const assetInsert = await db.prepare(`
      INSERT INTO file_assets (
        original_name, stored_name, public_path, mime_type, media_type, byte_size,
        source, created_by_id, created_by_name, optimization_status
      ) VALUES (@original_name, @stored_name, @public_path, @mime_type, @media_type, @byte_size,
        'import', @created_by_id, @created_by_name, @optimization_status)
    `).run({
      original_name: originalName,
      stored_name: storedName,
      public_path: `/uploads/${storedName}`,
      mime_type: mimeType,
      media_type: mediaType,
      byte_size: bytes.byteLength,
      created_by_id: user?.id ?? null,
      created_by_name: user?.name ?? null,
      optimization_status: mediaType === 'image' ? 'not_applicable_no_sharp' : 'not_applicable',
    })
    fileAssetId = Number(assetInsert.lastInsertRowid)
  }

  const result = await db.prepare(`
    INSERT INTO import_job_files (job_id, kind, original_name, stored_path, relative_path, mime_type, byte_size, status, file_asset_id)
    VALUES (@job_id, @kind, @original_name, @stored_path, @relative_path, @mime_type, @byte_size, 'stored', @file_asset_id)
  `).run({
    job_id: jobId,
    kind,
    original_name: originalName,
    stored_path: key,
    relative_path: relativePath || originalName,
    mime_type: mimeType,
    byte_size: bytes.byteLength,
    file_asset_id: fileAssetId,
  })

  // Same broadcast files.ts's own upload handler sends, so a Library tab
  // open in another window/device picks up the new file without a manual
  // refresh -- import uploads should feel identical to direct ones. Only
  // fires when this upload actually landed in Library (addToLibrary).
  if (addToLibrary) {
    c.executionCtx.waitUntil(broadcast(c.env, 'files', { action: 'upload', id: fileAssetId }))
  }

  return {
    id: result.lastInsertRowid,
    kind,
    original_name: originalName,
    relative_path: relativePath || originalName,
    byte_size: bytes.byteLength,
    status: 'stored',
    file_asset_id: fileAssetId,
    // Needed by the frontend's post-ZIP-extract recompression round-trip
    // (uploadImportJobZip callers fetch each stored image back from this
    // path, recompress it client-side, then POST the smaller bytes to
    // /:id/images/:fileId/recompress below) -- only meaningful for
    // addToLibrary uploads (zip/image), where the file genuinely lives at
    // the shared /uploads/ path; a csv upload has no public_path since it
    // was never added to Library.
    public_path: addToLibrary ? `/uploads/${storedName}` : null,
  }
}

app.post('/:id/csv', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  // The reviewed source must be immutable. Without this gate a caller could
  // upload a different CSV after analyze finished, retain the old Screen 2
  // summary, then approve and apply the unreviewed replacement. `failed` is
  // allowed so a parse/validation failure can be corrected in the same job;
  // every other post-start state must use Back/Cancel + a fresh job.
  const status = String(job.status || '').toLowerCase()
  if (!canReplaceImportCsv(status)) {
    return c.json({ success: false, error: 'The import source is locked after analysis starts. Create a new import to use a different file.' }, 409)
  }
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ success: false, error: 'CSV file required' }, 400)
  const ext = extname(file.name || '')
  if (ext !== '.csv' && ext !== '.tsv') return c.json({ success: false, error: 'Upload a CSV or TSV file' }, 400)
  if (file.size > MAX_CSV_BYTES) return c.json({ success: false, error: `CSV is too large (max ${Math.floor(MAX_CSV_BYTES / (1024 * 1024))}MB)` }, 400)
  try {
    const stored = await storeUpload(c, id, 'csv', file)
    // A new CSV invalidates any previously materialized import_job_source_rows
    // for this job -- fetchCsvText always reads the LATEST uploaded file, so
    // without this a re-upload would silently keep classifying/applying the
    // FIRST file's already-parsed rows. Cheap no-op if nothing was
    // materialized yet (a job's first-ever CSV upload). See migration
    // 0012_import_job_source_rows.sql.
    await resetMaterializeState(getDb(c.env), id)
    const after = await getJob(c.env, id)
    await auditImportEvent(c, 'import_job_upload', id, job, after || null, { source: 'api', fileKind: 'csv', fileName: file.name })
    return c.json({ success: true, file: stored, job: serializeJob(after || job) })
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message || 'Failed to upload CSV' }, 400)
  }
})

app.post('/:id/zip', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  if (job.type !== 'products') return c.json({ success: false, error: 'Image ZIP imports are only supported for products' }, 400)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ success: false, error: 'ZIP file required' }, 400)
  if (extname(file.name || '') !== '.zip') return c.json({ success: false, error: 'Upload a ZIP file for images' }, 400)
  if (file.size > MAX_ZIP_BYTES) return c.json({ success: false, error: `ZIP is too large (max ${Math.floor(MAX_ZIP_BYTES / (1024 * 1024))}MB)` }, 400)
  try {
    // Store the ZIP itself first, same as before -- it lands in Library
    // and import_job_files regardless of what's inside it or whether
    // unpacking below succeeds for every entry.
    const stored = await storeUpload(c, id, 'zip', file)

    // Unpack: read the central directory once, then extract + store each
    // real image entry through the exact same storeUpload('image', ...)
    // path /:id/images uses -- so loadImportJobImageMap (importEngine.ts)
    // matches these into products identically to a per-file upload, no
    // separate matching logic needed here.
    const zipBytes = new Uint8Array(await file.arrayBuffer())
    let entries: ReturnType<typeof readCentralDirectory> = []
    let zipError: string | null = null
    try {
      entries = readCentralDirectory(zipBytes)
    } catch (error) {
      // A ZIP that stores fine but fails to parse (corrupt/unsupported)
      // still keeps its stored-file row above -- report the parse failure
      // as a note rather than a hard 400, since the operator's upload did
      // succeed and they may want to re-export/re-zip rather than retry.
      zipError = error instanceof ZipFormatError ? error.message : 'Failed to read ZIP contents'
    }

    const imageEntries = entries.filter((entry) => isRealFileEntry(entry) && IMAGE_EXTENSIONS.has(extname(entry.fileName))).slice(0, MAX_IMAGES_PER_REQUEST)
    const extractedImages: unknown[] = []
    const failedImages: { file_name: string; error_message: string }[] = []

    for (const entry of imageEntries) {
      try {
        const bytes = await extractZipEntry(zipBytes, entry)
        const baseName = entry.fileName.split('/').pop() || entry.fileName
        const mimeType = IMAGE_MIME_BY_EXT[extname(baseName)] || 'application/octet-stream'
        const imageFile = new File([bytes], baseName, { type: mimeType })
        extractedImages.push(await storeUpload(c, id, 'image', imageFile, entry.fileName))
      } catch (error) {
        failedImages.push({ file_name: entry.fileName, error_message: (error as Error).message || 'Failed to extract' })
      }
    }

    const after = await getJob(c.env, id)
    await auditImportEvent(c, 'import_job_upload', id, job, after || null, {
      source: 'api',
      fileKind: 'zip',
      fileName: file.name,
      imagesExtracted: extractedImages.length,
      imagesFailed: failedImages.length,
    })

    const note = zipError
      ? `ZIP stored, but could not be read: ${zipError}`
      : `${extractedImages.length} image${extractedImages.length === 1 ? '' : 's'} extracted from ZIP and matched by filename, same as per-file image upload.${failedImages.length ? ` ${failedImages.length} entr${failedImages.length === 1 ? 'y' : 'ies'} could not be extracted.` : ''}`

    return c.json({
      success: true,
      file: stored,
      job: serializeJob(after || job),
      images: extractedImages,
      failed_images: failedImages,
      note,
    })
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message || 'Failed to upload ZIP' }, 400)
  }
})

app.post('/:id/images', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  if (job.type !== 'products') return c.json({ success: false, error: 'Image imports are only supported for products' }, 400)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  const form = await c.req.formData()
  const files = form.getAll('files').filter((f): f is File => f instanceof File).slice(0, MAX_IMAGES_PER_REQUEST)
  let relativePaths: string[] = []
  try {
    relativePaths = JSON.parse(String(form.get('relative_paths') || form.get('relativePaths') || '[]'))
    if (!Array.isArray(relativePaths)) relativePaths = []
  } catch (_) {
    relativePaths = []
  }
  const saved = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    if (!IMAGE_EXTENSIONS.has(extname(file.name || ''))) continue
    try {
      saved.push(await storeUpload(c, id, 'image', file, relativePaths[index] || file.name))
    } catch (error) {
      saved.push({ original_name: file.name, status: 'rejected', error_message: (error as Error).message })
    }
  }
  const after = await getJob(c.env, id)
  if (saved.length) {
    await auditImportEvent(c, 'import_job_upload', id, job, after || null, { source: 'api', fileKind: 'image', fileName: saved.length === 1 ? saved[0].original_name : `${saved.length} images` })
  }
  return c.json({ success: true, files: saved, job: serializeJob(after || job) })
})

// POST /:id/images/:fileId/recompress -- replaces an already-stored
// import image's bytes in place with a client-recompressed version,
// closing the compression gap on the ZIP path specifically. Manual
// Product-form/Library uploads and the direct per-file import path
// (POST /:id/images above) both compress client-side BEFORE the bytes
// ever leave the browser (see frontend's compressImageFile), because the
// browser has the original File object to hand at that point. A ZIP's
// contents don't have that luxury -- the browser only ever sees the ZIP
// as one opaque blob; the individual images are extracted server-side
// (POST /:id/zip above), where there's no `sharp`/native image library
// to compress with (the whole reason this project's uploads compress
// client-side in the first place). This route is the "browser
// round-trip" the other half of that gap needs: after a ZIP finishes
// extracting, the frontend fetches each already-stored (uncompressed)
// image back from its public path, runs it through the SAME
// `compressImageFile` Canvas re-encode every other upload path uses, and
// -- only if that actually shrank it -- posts the smaller bytes here to
// replace what's already stored, at the SAME key (no relink needed:
// import_job_files.stored_path / file_assets.public_path are untouched,
// so import matching and the Library listing both keep working exactly
// as before, just against smaller bytes).
// POST /:id/images/wire -- opt this job in to attaching matched images.
//
// Image matching used to run automatically on the first chunk of any products
// import that had images. That is the wrong default for the case it is
// actually used in -- a delete-and-reimport -- where the operator wants to
// see which images matched which rows, and how many matched nothing, BEFORE
// anything is attached. Once it has run automatically there is no "not yet";
// the only way back is another delete.
//
// So it is an explicit action now. Until this is called, analyze and apply
// behave exactly as they would for a CSV with no images at all, which is a
// genuinely safe state rather than a half-applied one.
//
// Idempotent: pressing it twice is a no-op rather than a second wiring pass,
// because the flag is a boolean and the match itself is recomputed only when
// the job has none cached.
app.post('/:id/images/wire', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied

  // Refuse while a phase is mid-flight. Flipping this under a running job
  // would have some chunks wire images and earlier ones not, leaving a
  // half-matched import that looks complete.
  const status = String(job.status || '')
  if (status === 'analyzing' || status === 'applying') {
    return c.json({ success: false, error: 'Wait for the current pass to finish before wiring images.' }, 409)
  }

  const db = getDb(c.env)
  const policy = safeJsonParse<Record<string, unknown>>(job.policy_json as string, {})
  policy.wire_images = true
  await db.prepare(`UPDATE import_jobs SET policy_json = @policy, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
    .run({ id, policy: JSON.stringify(policy) })

  const imageCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM import_job_files WHERE job_id = @id AND kind = 'image'`)
    .get<{ n: number }>({ id })
  return c.json({ success: true, wired: true, imageCount: Number(imageCount?.n || 0) })
})

app.post('/:id/images/:fileId/recompress', async (c) => {
  const id = c.req.param('id')
  const fileId = c.req.param('fileId')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied

  const db = getDb(c.env)
  const row = await db.prepare(`
    SELECT id, kind, stored_path, byte_size, file_asset_id
    FROM import_job_files WHERE id = @fileId AND job_id = @jobId AND kind = 'image'
  `).get<{ id: number; kind: string; stored_path: string; byte_size: number; file_asset_id: number | null }>({ fileId, jobId: id })
  if (!row) return c.json({ success: false, error: 'Import image not found' }, 404)

  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ success: false, error: 'Recompressed file required' }, 400)
  if (!IMAGE_EXTENSIONS.has(extname(file.name || ''))) return c.json({ success: false, error: 'Not a supported image type' }, 400)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const mimeType = file.type || IMAGE_MIME_BY_EXT[extname(file.name || '')] || 'application/octet-stream'
  try {
    validateUploadedBuffer(bytes, mimeType, file.name || 'image')
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 400)
  }

  // Defense in depth: this endpoint only ever exists to make a stored
  // image SMALLER. A client-side bug (or a stale/aborted compression
  // pass re-submitting the original) sending bytes that aren't actually
  // an improvement should be a silent no-op, not a way to overwrite good
  // bytes with equal-or-worse ones.
  if (bytes.byteLength >= row.byte_size) {
    return c.json({ success: true, applied: false, reason: 'not_smaller', byte_size: row.byte_size })
  }

  await c.env.ASSETS.put(row.stored_path, bytes, { httpMetadata: { contentType: mimeType } })
  // K3: a client-recompressed swap may still sit over the server ceiling.
  await enqueueImageNormalization(c.env, String(row.stored_path))
  await db.prepare(`UPDATE import_job_files SET byte_size = @byteSize, mime_type = @mimeType WHERE id = @id`)
    .run({ byteSize: bytes.byteLength, mimeType, id: row.id })
  if (row.file_asset_id) {
    await db.prepare(`UPDATE file_assets SET byte_size = @byteSize, mime_type = @mimeType, optimization_status = 'client_recompressed' WHERE id = @id`)
      .run({ byteSize: bytes.byteLength, mimeType, id: row.file_asset_id })
  }

  return c.json({ success: true, applied: true, byte_size: bytes.byteLength, previous_byte_size: row.byte_size })
})

// --- Lifecycle ---------------------------------------------------------------

app.post('/:id/start', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  const status = String(job.status || '').toLowerCase()
  if (job.cancel_requested || status === 'cancelled' || status === 'cancelling') {
    await auditImportEvent(c, 'import_job_start_blocked', id, job, job, { source: 'api', mode: 'analyze' })
    return c.json({ success: false, error: 'Import was cancelled. Use Retry before starting it again.' }, 409)
  }
  const db = getDb(c.env)
  const csvCount = await db.prepare(`SELECT COUNT(*) AS n FROM import_job_files WHERE job_id = @id AND kind = 'csv'`).get<{ n: number }>({ id })
  if (!csvCount?.n) return c.json({ success: false, error: 'Upload a CSV before starting the import' }, 400)

  await db.prepare(`UPDATE import_jobs SET status = 'queued', phase = 'queued', cancel_requested = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id })
  await c.env.IMPORT_QUEUE.send({ jobId: id, kind: 'analyze' })
  const queued = await getJob(c.env, id)
  await auditImportEvent(c, 'import_job_start', id, job, queued || null, { source: 'api', mode: 'analyze' })
  return c.json({ success: true, job: serializeJob(queued || job) })
})

app.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  const status = String(job.status || '').toLowerCase()
  if (job.cancel_requested || status === 'cancelled' || status === 'cancelling') {
    return c.json({ success: false, error: 'A cancelled import cannot be approved. Use Retry to analyze it again.' }, 409)
  }
  if (status !== 'awaiting_review') {
    return c.json({ success: false, error: `Import cannot be approved while its status is ${status || 'unknown'}.` }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const summary = safeJsonParse<Record<string, unknown>>(job.summary_json as string, {})
  const policy = safeJsonParse<Record<string, any>>(job.policy_json as string, {})
  if (['customers', 'suppliers', 'delivery_contacts'].includes(String(job.type || ''))) {
    const decisions = policy.decisionsByRowNumber && typeof policy.decisionsByRowNumber === 'object'
      ? policy.decisionsByRowNumber
      : {}
    const unresolvedWhere = buildUnresolvedContactReviewWhere(id, JSON.stringify(decisions))
    const unresolved = await getDb(c.env).staging.prepare(`SELECT COUNT(*) AS n FROM import_job_rows WHERE ${unresolvedWhere.sql}`)
      .get<{ n: number }>(unresolvedWhere.params)
    if (Number(unresolved?.n || 0) > 0) {
      await auditImportEvent(c, 'import_job_approve_blocked', id, job, job, {
        source: body?.source || 'api', mode: 'apply', reason: 'contact_conflicts_unresolved',
      })
      return c.json({
        success: false,
        error: `Review every contact conflict before applying this import. ${Number(unresolved?.n || 0)} remain unresolved.`,
        code: 'contact_conflicts_unresolved',
        unresolvedRows: Number(unresolved?.n || 0),
      }, 409)
    }
  }
  if (String(job.type || '') === 'products') {
    const decisions = policy.decisionsByRowNumber && typeof policy.decisionsByRowNumber === 'object'
      ? policy.decisionsByRowNumber
      : {}
    const unresolvedWhere = buildUnresolvedProductReviewWhere(id, JSON.stringify(decisions))
    const unresolved = await getDb(c.env).staging.prepare(`SELECT COUNT(*) AS n FROM import_job_rows WHERE ${unresolvedWhere.sql}`)
      .get<{ n: number }>(unresolvedWhere.params)
    if (Number(unresolved?.n || 0) > 0) {
      await auditImportEvent(c, 'import_job_approve_blocked', id, job, job, {
        source: body?.source || 'api', mode: 'apply', reason: 'product_conflicts_unresolved',
      })
      return c.json({
        success: false,
        error: `Review every product identity or stock conflict before applying this import. ${Number(unresolved?.n || 0)} remain unresolved.`,
        code: 'product_conflicts_unresolved',
        unresolvedRows: Number(unresolved?.n || 0),
      }, 409)
    }
  }
  const requiresStockConfirmation = job.type === 'stock_actions' && summary.requires_stock_action_confirmation === true
  if (requiresStockConfirmation && body?.confirm_stock_actions !== true) {
    await auditImportEvent(c, 'import_job_approve_blocked', id, job, job, {
      source: body?.source || 'api', mode: 'apply', reason: 'stock_action_confirmation_required',
    })
    return c.json({
      success: false,
      error: 'Review the flagged stock actions and use Confirm Action before applying this import.',
      code: 'stock_action_confirmation_required',
      confirmationRows: Number(summary.stock_action_confirmation_rows || 0),
    }, 409)
  }

  const db = getDb(c.env)
  if (job.type === 'stock_actions') {
    policy.stock_action_conflicts_confirmed = requiresStockConfirmation
    policy.stock_action_confirmed_by = c.get('user')?.id ?? null
    policy.stock_action_confirmed_at = new Date().toISOString()
  }
  const approval = await db.prepare(`
    UPDATE import_jobs SET status = 'approved', phase = 'approved', policy_json = @policy, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND status = 'awaiting_review'
  `).run({ id, policy: JSON.stringify(policy) })
  if (approval.changes !== 1) {
    return c.json({ success: false, error: 'Import status changed before approval. Refresh and review it again.' }, 409)
  }
  await c.env.IMPORT_QUEUE.send({ jobId: id, kind: 'apply' })
  const queued = await getJob(c.env, id)
  await auditImportEvent(c, 'import_job_approve', id, job, queued || null, { source: 'api', mode: 'apply' })
  return c.json({ success: true, job: serializeJob(queued || job) })
})

// "Close" on the tracker banner -- distinct from /approve. This only
// records that the user has seen/acknowledged the job; it never touches
// status/phase or the queue, so it can't accidentally apply or reject an
// import. dismissed_status pins the status this was dismissed *at*, so a
// later status change (approved elsewhere, retried, failed) makes the job
// reappear rather than staying silently hidden forever.
app.post('/:id/dismiss', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  const db = getDb(c.env)
  await db.prepare(`
    UPDATE import_jobs SET dismissed_at = CURRENT_TIMESTAMP, dismissed_status = @status, updated_at = CURRENT_TIMESTAMP WHERE id = @id
  `).run({ id, status: String(job.status || '') })
  const dismissed = await getJob(c.env, id)
  await auditImportEvent(c, 'import_job_dismiss', id, job, dismissed || null, { source: 'api' })
  return c.json({ success: true, job: serializeJob(dismissed || job) })
})

app.post('/:id/cancel', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  const db = getDb(c.env)
  const status = String(job.status || '').toLowerCase()
  // Best-effort cancel: a queue message already in flight for this job will
  // still run to completion (Cloudflare Queues has no message-recall API),
  // but analyze/apply both check cancel_requested before writing further
  // batches, so an in-flight run stops at the next checkpoint rather than
  // finishing the whole file. Matches the original's own "cancelling ->
  // cancelled" two-phase status, which had the same limitation under BullMQ.
  const nextStatus = ['analyzing', 'applying', 'queued'].includes(status) ? 'cancelling' : 'cancelled'
  await db.prepare(`UPDATE import_jobs SET status = @status, cancel_requested = 1, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id, status: nextStatus })
  const cancelled = await getJob(c.env, id)
  await auditImportEvent(c, 'import_job_cancel', id, job, cancelled || null, { source: 'api', cancelSource: 'api' })
  return c.json({ success: true, job: serializeJob(cancelled || job) })
})

async function deleteJobData(c: any, id: string) {
  const db = getDb(c.env)
  const files = await db.prepare(`SELECT stored_path, file_asset_id FROM import_job_files WHERE job_id = @id`).all<{ stored_path: string; file_asset_id: number | null }>({ id })
  for (const file of files) {
    // A file with a file_asset_id is the person's Library copy (see
    // storeUpload above) -- deleting the import job must not silently take
    // that file out from under them too. Only remove R2 objects that were
    // never linked, e.g. rows written before this change shipped.
    if (file.file_asset_id) continue
    await c.env.ASSETS.delete(file.stored_path).catch(() => undefined)
  }
  // One shared delete definition with the K4 retention sweep
  // (lib/importRetention.ts) so the two cannot drift. This also fixed a
  // real leak: the inline list this replaced deleted only six tables,
  // leaving signature/commit/guard/group/image-plan rows orphaned forever
  // -- the "orphan staging rows" the K4 Phase-0 audit measured.
  // Staging children (separate import-staging DB) FIRST, then the parent
  // import_jobs row. A db.batch is atomic only within one D1, so deleting the
  // parent first and then failing the staging call (thrown, or isolate killed
  // between them) would strand the staging rows with no parent -- an orphan no
  // automatic sweep reaches. Staging-first means a mid-failure leaves the job
  // reachable, and retention re-cleans it (a staging re-delete is a no-op).
  await db.staging.batch(importJobStagingDeleteStatements(id))
  await db.batch(importJobFullDeleteStatements(id))
}

async function handleDelete(c: any) {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  const status = String(job.status || '').toLowerCase()
  const queryForce = c.req.query('force')
  const bodyForce = c.req.method === 'POST' ? (await c.req.json().catch(() => ({})))?.force : undefined
  const force = ['true', '1'].includes(String(queryForce ?? bodyForce ?? '').toLowerCase())
  if (!force && ['analyzing', 'applying', 'cancelling'].includes(status)) {
    return c.json({ success: false, error: 'Import is still stopping. Wait for it to settle or pass force=true.', code: 'import_still_stopping' }, 409)
  }
  await deleteJobData(c, id)
  await auditImportEvent(c, 'import_job_delete', id, job, null, { source: 'api' })
  return c.json({ success: true, deleted: true, id })
}

app.delete('/:id', handleDelete)
app.post('/:id/delete', handleDelete)

app.post('/:id/retry', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  const db = getDb(c.env)
  const status = String(job.status || '').toLowerCase()
  // K4 retention: once the scheduled sweep has pruned a terminal job's
  // staged detail (source rows + unlinked raw file, kept 24h by policy),
  // a retry has nothing to re-run from -- analyze needs the file, apply
  // needs the materialized rows. Refuse up front with the real reason
  // instead of failing downstream with a missing-file error.
  if (job.details_pruned_at) {
    return c.json({ success: false, error: 'This import\'s staged data was cleaned up by retention (details are kept 24 hours after a job finishes). Upload the file again to re-import.', code: 'import_details_pruned' }, 409)
  }
  // Awaiting review is not a failed phase and must never be an alternate
  // route into apply. In particular, stock_actions /approve enforces the
  // explicit conflict confirmation and records the confirming actor/time;
  // retry used to bypass that entire gate by queueing `apply` directly.
  const retryMode = retryModeForImportStatus(status)
  if (retryMode === 'review_required') {
    return c.json({ success: false, error: 'This import is waiting for review. Use Confirm to apply it, or cancel it to start over.' }, 409)
  }
  const mode = retryMode
  await db.prepare(`
    UPDATE import_jobs SET status = 'queued', phase = 'queued', cancel_requested = 0,
      processed_rows = 0, failed_rows = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id })
  await c.env.IMPORT_QUEUE.send({ jobId: id, kind: mode })
  const queued = await getJob(c.env, id)
  await auditImportEvent(c, 'import_job_retry', id, job, queued || null, { source: 'api', mode })
  return c.json({ success: true, job: serializeJob(queued || job) })
})

app.get('/:id/errors.csv', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env, id)
  if (!job) return c.json({ success: false, error: 'Import job not found' }, 404)
  const denied = await requireImportPermission(c as any, job)
  if (denied) return denied
  const csv = await buildErrorsCsv(c.env, id)
  // BOM: errors.csv is opened in Excel, whose codepage guess without one
  // turns the Khmer product names inside error messages into '?' (the same
  // reason every frontend CSV download carries it -- M7).
  return new Response(String.fromCharCode(0xFEFF) + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${id}-errors.csv"`,
    },
  })
})

// Exposed so queue.ts's consumer can run the exact same analyze/apply logic
// the synchronous /preflight and /approve paths use, rather than duplicating it.
export { runImportAnalyze, runImportApply }

export default app
