import { Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { describeJobPolicy } from '../products/import/importTemplateRouter.ts'
import { parseServerTimestampMs } from '../../utils/formatters.ts'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import FileDown from 'lucide-react/dist/esm/icons/file-down.js'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning.js'
import GripVertical from 'lucide-react/dist/esm/icons/grip-vertical.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import PlayCircle from 'lucide-react/dist/esm/icons/play-circle.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import XCircle from 'lucide-react/dist/esm/icons/x-circle.js'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import { isTransientGatewayError } from '../../api/http.ts'
import { dispatchImportCompletionRefresh, onImportTrackerPoke, shouldDispatchImportCompletionRefresh } from '../../utils/importJobRefresh.ts'
import { beginNamedAction, finishNamedAction } from '../../utils/actionGuards.ts'
import { withLoaderTimeout } from '../../utils/loaders.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { shouldPromptConflictReviewBeforeApprove } from './importJobApproveGate.ts'

// This widget is the ONE place import jobs surface across every page
// (mounted globally in NotificationCenter.tsx -- Products/Inventory/Sales/
// Contacts imports all funnel through it), but until now it only showed a
// bare "N needs review" count next to a blind Approve button -- no way to
// see *which* rows had a same-name/same-barcode/negative-stock/etc. issue
// without leaving the page and hunting for it on the Dashboard, where
// ImportReportModal (the actual detailed, kind-grouped warning view) was
// the only place it was wired in. Reusing that same modal here instead of
// building a second one.
const ImportReportModal = lazyRetry(() => import('./ImportReportModal'), 'BackgroundImportTracker-ImportReportModal')
// Customers/suppliers/delivery-contacts imports auto-merge a name-only
// match into the existing record by default (classifyContacts in
// importEngine.ts) -- correct, but previously only visible/decidable by
// opening the plain Report modal and reading a warning message after the
// fact. This is the row-by-row "merge or keep separate" decision screen
// for that same warning set (kind: 'name_match'), reusing the existing
// GET /:id/review + PATCH /:id/decisions endpoints -- see
// ContactImportConflictsModal.tsx's own header comment.
const ContactImportConflictsModal = lazyRetry(() => import('../contacts/ContactImportConflictsModal'), 'BackgroundImportTracker-ContactImportConflictsModal')
const ProductImportConflictsModal = lazyRetry(() => import('../products/import/ProductImportConflictsModal'), 'BackgroundImportTracker-ProductImportConflictsModal')
const CONTACT_JOB_TYPES = new Set(['customers', 'suppliers', 'delivery_contacts'])
const CONTACT_JOB_TYPE_LABELS: Record<string, string> = {
  customers: 'Customers',
  suppliers: 'Suppliers',
  delivery_contacts: 'Delivery Contacts',
}

type NotifyTone = 'info' | 'success' | 'warning' | 'error'
type NotifyFn = (message: string, tone?: NotifyTone) => void
type TranslateFn = (key: string) => string

type AppContextValue = {
  notify: NotifyFn
  t: TranslateFn
}

type ImportJobSummary = {
  analyzed_rows?: unknown
  rows?: unknown
  total?: unknown
  // Real field names importEngine.ts's runImportAnalyze/runImportApply
  // write to summary_json (see CHANGES-VERIFIED.md) -- getJobResultParts
  // below already read these; the type just never declared them, which
  // was a real `keyof` compile error, not a cosmetic one.
  created?: unknown
  updated?: unknown
  skipped?: unknown
  errored?: unknown
  warned?: unknown
  imported?: unknown
  duplicates?: unknown
  images_matched?: unknown
  skipped_images?: unknown
  failed?: unknown
  // Phase-timing breakdown importEngine.ts's runImportAnalyze/runImportApply
  // write onto summary_json.timings (see their sw.lap()/console.log calls) --
  // already persisted and already reaches this component via job.summary,
  // just never rendered anywhere, so a slow import had no visible breakdown
  // of where the time actually went (materialize/classify/write/queue wait)
  // short of reading Worker logs directly. formatTimingSummary below surfaces
  // it once a phase finishes.
  timings?: {
    analyze?: { totalMs?: unknown; queueLatencyMs?: unknown }
    apply?: { totalMs?: unknown; queueLatencyMs?: unknown }
  }
}

type ImportJob = {
  id?: unknown
  // the job's persisted options (serializeJob parses policy_json) -- N1b
  policy?: unknown
  status?: unknown
  phase?: unknown
  type?: unknown
  summary?: ImportJobSummary
  total_rows?: unknown
  processed_rows?: unknown
  failed_rows?: unknown
  total_images?: unknown
  processed_images?: unknown
  failed_images?: unknown
  created_at?: unknown
  updated_at?: unknown
  finished_at?: unknown
  last_error?: unknown
  dismissed_at?: unknown
  dismissed_status?: unknown
  // Raw JSON blob importEngine.ts's MaterializeState serializes to on every
  // materialize chunk (see ensureSourceRowsMaterialized) -- carries a live
  // `rowsWritten` counter. Not previously modeled here because nothing read
  // it; readMaterializedRowsWrittenSoFar below is the one place that does.
  materialize_state_json?: unknown
}

type ImportJobListResult = {
  jobs?: ImportJob[]
  unavailable?: unknown
  transient?: unknown
}

type ImportPreflightResult = {
  ok?: boolean
  failures?: Array<{ message?: unknown }>
}

type ImportTrackerApi = {
  listImportJobs?: (options: { limit: number }) => Promise<ImportJobListResult | ImportJob[]>
  cancelImportJob: (jobId: string) => Promise<unknown>
  retryImportJob: (jobId: string) => Promise<unknown>
  preflightImportJob?: (jobId: string) => Promise<ImportPreflightResult>
  approveImportJob: (jobId: string, options?: { confirmStockActions?: boolean }) => Promise<unknown>
  downloadImportJobErrors: (jobId: string) => Promise<unknown>
  deleteImportJob: (jobId: string, options: { force: boolean }) => Promise<unknown>
  dismissImportJob: (jobId: string) => Promise<unknown>
}

type ProgressLabels = Partial<Record<
  'analyzed' | 'rows' | 'reviewReady' | 'analyzingFile' | 'readingFile' | 'cancelled' | 'queued' | 'cancelRequested' | 'finalCleanup' | 'waitingForWorker' | 'readyToAnalyze' | 'startingApply' | 'applyingChanges' | 'failed',
  string
>>

type ResultLabels = Partial<Record<'created' | 'updated' | 'duplicate' | 'imageMatched' | 'imageSkipped' | 'rowIssue' | 'needsReview', string>>

type TrackerAction = {
  jobId: string
  key: string
}

const useApp = useAppHook as () => AppContextValue

// 'analyzing' and 'applying' were missing here before -- since a job's
// visibility in the tracker is gated on ACTIVE_STATUSES/REVIEW_STATUSES/
// DONE_STATUSES membership, a job sitting in either of those two statuses
// (the two phases that actually do work: reading+classifying the CSV, and
// writing the batch to D1) matched none of the three sets and simply
// disappeared from the widget until it landed on awaiting_review/
// completed/failed -- looking like the import silently stalled or the
// tracker broke, right when there was the most to show.
const ACTIVE_STATUSES = new Set(['pending', 'queued', 'analyzing', 'running', 'applying', 'cancelling', 'approved'])
const REVIEW_STATUSES = new Set(['awaiting_review', 'completed_with_errors', 'failed', 'cancelled'])
const DONE_STATUSES = new Set(['completed'])
// 'analyzing'/'applying'/'approved' used to be missing from all three of
// these sets. That's not just "you can't cancel while it's working" (which
// would be a reasonable choice) -- when the worker dies mid-phase (e.g. a
// D1_ERROR CPU-time-limit reset while writing an apply batch), the job's
// `status` column is never updated away from 'applying', so it sits there
// forever: not cancellable, not removable, not dismissable. The tracker then
// shows a permanently "in progress" card for a job that has actually stopped,
// and every retried import piles another one of these zombies on top (see
// image1 in the bug report -- two identical stuck "applying" cards). Cancel/
// Remove need to work on these active phases too so there's always a manual
// way out, independent of whether the backend ever gets to flip the status.
const CANCELLABLE_STATUSES = new Set(['queued', 'running', 'approved', 'analyzing', 'applying'])
const DISMISSABLE_STATUSES = new Set(['awaiting_review', 'completed', 'completed_with_errors', 'failed', 'cancelled'])
const REMOVABLE_STATUSES = new Set(['pending', 'queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'cancelling', 'analyzing', 'applying', 'approved'])

// A job can carry a `last_error` (e.g. the D1 CPU-limit message above) while
// its `status` is still technically "active" -- the worker reported a
// problem but never got to (or won't) transition the row to 'failed'. Treat
// that combination as needing attention too, same as a real REVIEW_STATUSES
// job, so it's visually flagged (amber) instead of silently claiming
// "Applying changes" forever with no indication anything is wrong.
// How long an ACTIVE job is allowed to sit with no `updated_at` movement
// before treating it as stalled, independent of whether it ever got a
// `last_error`. A queue-driven chunk should check back in every few
// seconds to a couple minutes (see ROWS_PER_IMPORT_CHUNK/queue.ts) even
// accounting for Free-plan queue latency -- 6 minutes is generous
// headroom above that, not a tight trigger. Below this, a job that died
// mid-phase (worker crashed, D1 CPU-limit reset -- see queue.ts's comment
// on why `status` can be left stuck on 'analyzing'/'applying' forever)
// used to just sit there quietly claiming "in progress" with no visual
// difference from one that's genuinely still working, which is exactly
// what made 4 old dead imports look identical to 1 real one in the
// tracker -- there was nothing marking the old ones as different.
const STALLED_ACTIVE_MAX_AGE_MS = 6 * 60 * 1000

function isStalledActiveJob(job: ImportJob | null | undefined): boolean {
  if (!job) return false
  const status = normalizeJobStatus(job)
  if (!ACTIVE_STATUSES.has(status)) return false
  if (String(job?.last_error || '').trim().length > 0) return true
  return !isRecent(job, STALLED_ACTIVE_MAX_AGE_MS)
}

function jobNeedsAttention(job: ImportJob | null | undefined): boolean {
  if (!job) return false
  const status = normalizeJobStatus(job)
  if (REVIEW_STATUSES.has(status)) return true
  return isStalledActiveJob(job)
}

// Persisted dismissal memory. `handleDismiss` used to only set in-memory
// React state (a `useState<Set<string>>`), which is why "Close" appeared to
// not stick: any full page reload, browser restart, or re-login reset that
// state to empty, and since dismissing a job never told the backend either
// (the job is still legitimately sitting there, e.g. `awaiting_review`
// because the user hasn't approved/rejected it yet -- "closing" the toast
// isn't supposed to delete the job), the next poll re-fetched the same
// still-pending job and the tracker reappeared. This looked like a bug
// ("I click close but it still pops up") but was really "dismissed" never
// surviving anything but the current tab's in-memory session.
//
// Real fix: the server now stores `dismissed_at`/`dismissed_status` on the
// import_jobs row itself (POST /:id/dismiss, separate from /approve), so
// "Close" survives re-login and works across devices/browsers. A job stays
// hidden only while its *current* status still matches `dismissed_status`
// -- if it changed since (someone else approved/rejected it, a retry
// failed, etc.), that's new information worth surfacing again, so it
// un-hides automatically. `jobIsServerDismissed` below is that check.
//
// localStorage is kept as a local, best-effort overlay only: it makes the
// dismiss feel instant before the next poll picks up the server field back
// up, and it's the fallback if the dismiss request itself fails (offline,
// server error) so "Close" still does *something* rather than silently
// no-op'ing in that edge case.
const DISMISSED_JOBS_STORAGE_KEY = 'businessos_dismissed_import_jobs'
const DISMISSED_JOB_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days -- bounds storage growth for old/abandoned jobs

type DismissedJobRecord = { status: string; ts: number }
type DismissedJobsMap = Record<string, DismissedJobRecord>

function readDismissedJobs(): DismissedJobsMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(DISMISSED_JOBS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const now = Date.now()
    const cleaned: DismissedJobsMap = {}
    for (const [id, record] of Object.entries(parsed as Record<string, unknown>)) {
      const rec = record as { status?: unknown; ts?: unknown } | null
      const ts = Number(rec?.ts)
      if (!id || !Number.isFinite(ts) || now - ts > DISMISSED_JOB_TTL_MS) continue
      cleaned[id] = { status: String(rec?.status || ''), ts }
    }
    return cleaned
  } catch (_) {
    return {}
  }
}

function writeDismissedJobs(map: DismissedJobsMap): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISSED_JOBS_STORAGE_KEY, JSON.stringify(map))
  } catch (_) {
    // Storage unavailable/full (private browsing, quota) -- dismissal just
    // won't survive a reload in that case, same as the old behavior. Not fatal.
  }
}
// 3s (was 5s) while a job is active: this is what paces the unified import hub's
// auto-approve (the tracker detects awaiting_review here, then approves), and how
// fast an applying job's progress updates. Imports are infrequent and short, so
// the extra polls over a job's lifetime are negligible; the idle cadence and the
// failure backoff are unchanged.
const IMPORT_TRACKER_ACTIVE_POLL_MS = 3000
const IMPORT_TRACKER_IDLE_POLL_MS = 12000
const IMPORT_TRACKER_MAX_BACKOFF_MS = 60000
const IMPORT_TRACKER_LOAD_TIMEOUT_MS = 8000
// Raised from 15000/12000 to match importJobsTransport.ts's
// IMPORT_JOB_SYNC_ACTION_TIMEOUT_MS (45s) -- these two used to be SHORTER
// than the apiFetch call underneath, so once that call's own timeout was
// fixed to stop firing early, this outer race would have become the next
// thing to cut the same request short. Same "sync the outer UI timeout to
// the now-longer inner one" fix Part 254 applied to ResetData.tsx.
const IMPORT_TRACKER_PREFLIGHT_TIMEOUT_MS = 50000
const IMPORT_TRACKER_CANCEL_TIMEOUT_MS = 12000
const IMPORT_TRACKER_RETRY_TIMEOUT_MS = 12000
const IMPORT_TRACKER_APPROVE_TIMEOUT_MS = 50000
const IMPORT_TRACKER_ERRORS_DOWNLOAD_TIMEOUT_MS = 30000
const IMPORT_TRACKER_REMOVE_TIMEOUT_MS = 12000

function getImportTrackerApi(): ImportTrackerApi {
  if (!window.api) throw new Error('Import tracker API is not available.')
  return window.api as ImportTrackerApi
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '')
}

function nextImportTrackerBackoff(current = 0): number {
  return Math.min(
    IMPORT_TRACKER_MAX_BACKOFF_MS,
    Math.max(IMPORT_TRACKER_IDLE_POLL_MS, current ? current * 2 : IMPORT_TRACKER_IDLE_POLL_MS),
  )
}

function normalizeJobStatus(job: ImportJob | null | undefined): string {
  return String(job?.status || '').trim().toLowerCase()
}

// True when the server itself says this job was dismissed and nothing has
// changed status-wise since -- see the dismissal-memory comment above.
function jobIsServerDismissed(job: ImportJob | null | undefined): boolean {
  if (!job?.dismissed_at) return false
  return String(job?.dismissed_status || '').trim().toLowerCase() === normalizeJobStatus(job)
}

function dedupeJobsById(jobs: ImportJob[] = []): ImportJob[] {
  const seen = new Set<string>()
  const result: ImportJob[] = []
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const id = String(job?.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(job)
  }
  return result
}

function isRecent(job: ImportJob, maxAgeMs = 2 * 60 * 60 * 1000): boolean {
  // parseServerTimestampMs, NOT bare Date.parse: the server writes
  // timezone-less UTC ("2026-08-28 14:33:20"), which Date.parse reads as
  // LOCAL time -- for a UTC+7 viewer every ACTIVE job instantly looked 7
  // hours stale, so the "this import may have stopped -- safe to cancel"
  // warning showed on jobs that were mid-apply and progressing fine (Y8).
  const stamp = parseServerTimestampMs(String(job?.updated_at || job?.finished_at || job?.created_at || ''))
  if (!Number.isFinite(stamp)) return true
  return Date.now() - stamp <= maxAgeMs
}

function normalizeImportJobListResult(result: ImportJobListResult | ImportJob[] | undefined): {
  jobs: ImportJob[]
  unavailable: boolean
  transient: boolean
} {
  if (Array.isArray(result)) {
    return { jobs: result, unavailable: false, transient: false }
  }
  return {
    jobs: Array.isArray(result?.jobs) ? result.jobs : [],
    unavailable: !!result?.unavailable,
    transient: !!result?.transient,
  }
}

// import_jobs.materialize_state_json (see importEngine.ts's MaterializeState
// type) carries a live `rowsWritten` counter that climbs every materialize
// chunk (100 rows/hop), well before total_rows/processed_rows have anything
// to show -- the API's `SELECT j.*` already returns this column, it just
// wasn't modeled/read on the frontend. Surfacing it means the tracker has
// *something* visibly moving during that sub-phase instead of a flat
// "Analyzing file" for however long materializing an 11K-row file takes.
// Exported for direct testing rather than only via the two callers below.
export function readMaterializedRowsWrittenSoFar(job: ImportJob): number {
  const raw = job?.materialize_state_json
  if (typeof raw !== 'string' || !raw) return 0
  try {
    const parsed = JSON.parse(raw) as { rowsWritten?: unknown } | null
    const value = Number(parsed?.rowsWritten || 0)
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch (_) {
    return 0
  }
}

export function getJobProgressDetails(job: ImportJob, labels: ProgressLabels = {}) {
  const status = normalizeJobStatus(job)
  const phase = String(job?.phase || '').toLowerCase()
  const summary = job?.summary || {}
  // job.total_rows becomes the FULL row count (not a running count) the
  // moment materialization finishes and the first classify chunk runs --
  // importEngine.ts's runImportAnalyze writes it on every chunk from then
  // on, alongside a real, incrementing processed_rows. Before that, while
  // ensureSourceRowsMaterialized is still parsing the raw CSV, neither
  // field has moved yet (that sub-phase only touches
  // materialize_state_json -- see readMaterializedRowsWrittenSoFar below).
  // Prefer total_rows over the summary fields, which older/in-flight jobs
  // may not carry.
  const analyzedRows = Number(job?.total_rows || summary?.analyzed_rows || summary?.rows || 0)
  if (ACTIVE_STATUSES.has(status) && phase.includes('queued')) {
    return {
      value: 8,
      label: labels.waitingForWorker || 'Waiting for worker',
      indeterminate: true,
    }
  }
  if (ACTIVE_STATUSES.has(status) && phase.includes('ready')) {
    return {
      value: 6,
      label: labels.readyToAnalyze || 'Ready to analyze',
      indeterminate: false,
    }
  }
  if (status === 'awaiting_review') {
    // Just the phase word -- the counts line (getRowsDisplay) already says
    // "Analyzed N rows", and the header/row renders both side by side, so
    // repeating the numbers here doubled the text and made the label long
    // enough to wrap into the title on phone widths.
    return {
      value: 60,
      label: labels.reviewReady || 'Review ready',
      indeterminate: false,
    }
  }
  if (ACTIVE_STATUSES.has(status) && phase.includes('analyz')) {
    // Used to show one of two FIXED values (12 pre-materialize, 35 once
    // total_rows first appears) for this branch's entire duration, no
    // matter how many chunks actually ran after that -- for an 11K-row
    // file that's potentially 150-200 queue round-trips (materializing +
    // classifying) with a visibly frozen bar the whole time, even though
    // processed_rows (and materialize_state_json.rowsWritten before it)
    // really is climbing in the DB every chunk -- confirmed via
    // wrangler tail. Now reads the same live processed/total numbers the
    // apply-phase branch below already did, scaled into 15-58% so it
    // visibly climbs instead of jumping straight to a static "done"-
    // sounding number on the very first chunk.
    if (analyzedRows > 0) {
      // Phase word only: the live "N / M rows analyzed" cursor already
      // renders on the counts line right next to this label (getRowsDisplay's
      // identical-shape branch), so carrying the numbers here too printed
      // them twice and wrapped the header on phone widths.
      const rowsDone = Number(job?.processed_rows || 0)
      const pct = Math.max(0, Math.min(1, rowsDone / analyzedRows))
      return {
        value: Math.min(58, Math.round(15 + pct * 43)),
        label: labels.analyzingFile || 'Analyzing',
        indeterminate: false,
      }
    }
    // Y8: distinct "Reading file" label for this staging sub-phase -- the
    // classify sub-phase above keeps "Analyzing", so the pipeline now reads
    // "Reading file" -> "Analyzing" instead of "Analyzing file" twice (the
    // user reported it as two analyze passes). The "N rows read" counter
    // lives on the counts line (getRowsDisplay), not here.
    return {
      value: 12,
      label: labels.readingFile || 'Reading file',
      indeterminate: true,
    }
  }
  if (status === 'approved' && phase === 'approved') {
    return {
      value: 65,
      label: labels.startingApply || 'Starting apply',
      indeterminate: true,
    }
  }
  if (ACTIVE_STATUSES.has(status) && phase.includes('apply')) {
    // importEngine.ts's runImportApply now writes rows in chunks (several
    // smaller db.batch() calls instead of one giant one -- see
    // applyStatementsInChunks) and bumps processed_rows after each chunk
    // commits, so there's a real incremental number here for most of the
    // apply phase. Scaled into 65-98% (rather than 0-100%) so it visibly
    // continues from wherever "Starting apply" left off instead of
    // restarting the bar from empty; falls back to the old indeterminate
    // reading only for the brief window before the first chunk has landed.
    const rowsTotal = Number(job?.total_rows || 0)
    const rowsDone = Number(job?.processed_rows || 0)
    if (rowsTotal > 0 && rowsDone > 0) {
      // Phase word only -- the counts line shows the same "N / M rows"
      // cursor (getRowsDisplay's final fallback), so no numbers here.
      const pct = Math.max(0, Math.min(1, rowsDone / rowsTotal))
      return {
        value: Math.min(98, Math.round(65 + pct * 33)),
        label: labels.applyingChanges || 'Applying changes',
        indeterminate: false,
      }
    }
    return {
      value: 65,
      label: labels.applyingChanges || 'Applying changes',
      indeterminate: true,
    }
  }
  const rowsTotal = Number(job?.total_rows || 0)
  const rowsDone = Number(job?.processed_rows || 0)
  const imagesTotal = Number(job?.total_images || 0)
  const imagesDone = Number(job?.processed_images || 0)
  const total = rowsTotal + imagesTotal
  const done = rowsDone + imagesDone
  if (status === 'cancelling' || phase === 'cancel_requested') {
    const rowsComplete = rowsTotal <= 0 || rowsDone >= rowsTotal
    const imagesComplete = imagesTotal <= 0 || Number(job?.processed_images || 0) + Number(job?.failed_images || 0) >= imagesTotal
    return {
      value: rowsComplete && imagesComplete ? 98 : Math.max(12, Math.min(90, total ? Math.round((done / total) * 100) : 28)),
      label: rowsComplete && imagesComplete
        ? (labels.finalCleanup || 'Final cleanup')
        : (labels.cancelRequested || 'Cancel requested'),
      indeterminate: true,
    }
  }
  if (status === 'completed' || status === 'completed_with_errors') {
    return { value: 100, label: '100%', indeterminate: false }
  }
  if (status === 'cancelled') {
    return { value: 100, label: labels.cancelled || 'Cancelled', indeterminate: false }
  }
  // Now that the job row's label no longer carries the phase word (see
  // getJobLabel), the status chip is the one place "failed" can appear --
  // the old fall-through here rendered a mid-run percentage ("45%") for a
  // job that had died, which read as still-working.
  if (status === 'failed') {
    return { value: 100, label: labels.failed || 'Failed', indeterminate: false }
  }
  if (total <= 0) {
    return { value: 0, label: labels.queued || 'Queued', indeterminate: ACTIVE_STATUSES.has(status) }
  }
  const raw = Math.max(0, Math.min(100, Math.round((done / total) * 100)))
  const value = ACTIVE_STATUSES.has(status) ? Math.min(95, raw) : raw
  return { value, label: `${value}%`, indeterminate: false }
}

function getJobLabel(job: ImportJob): string {
  // Type only ("Products import"), no "- <phase>" suffix: the status chip
  // rendered right next to this label already names the phase, so the
  // suffix said the same thing twice and stretched the row label into the
  // chip on narrow screens.
  const type = String(job?.type || 'import').replaceAll('_', ' ')
  return `${type.charAt(0).toUpperCase()}${type.slice(1)} import`
}

// Returns the non-zero result tallies as discrete parts (created / updated /
// skipped / row issue / needs review / image matched-skipped). Y9 renders
// these as small chips inside the folded "Details" section rather than the
// old " - "-joined prose run that helped make the card a wall of words.
function getJobResultParts(job: ImportJob, labels: ResultLabels = {}): string[] {
  const summary = job?.summary || {}
  const parts: string[] = []
  const add = (key: keyof ImportJobSummary, label: string) => {
    const value = Number(summary?.[key] || 0)
    if (value > 0) parts.push(`${value.toLocaleString()} ${label}`)
  }
  // These are the field names importEngine.ts's runImportAnalyze/
  // runImportApply actually write to summary_json. The previous names here
  // (imported/duplicates/failed) never matched anything the backend sets,
  // so this line almost always rendered empty; `updated` was the one
  // name that happened to match by coincidence.
  add('created', labels.created || 'created')
  add('updated', labels.updated || 'updated')
  add('skipped', labels.duplicate || 'skipped')
  add('errored', labels.rowIssue || 'row issue')
  // Non-blocking notices (barcode reused by a different product, negative
  // stock reset to 0 -- see classifyProducts in importEngine.ts) that
  // don't stop a row from importing but are worth the operator's
  // attention -- see warning_count's real wiring in importEngine.ts.
  add('warned', labels.needsReview || 'needs review')
  // Image-to-product matching isn't implemented in this job pipeline yet
  // (classifyProducts/runImportApply never touch product image fields at
  // all -- see PORTING_STATUS.md) -- these two are left as a no-op today
  // rather than removed, so the line lights up automatically the day that
  // work lands and starts writing these fields.
  add('images_matched', labels.imageMatched || 'image matched')
  add('skipped_images', labels.imageSkipped || 'image skipped')
  return parts
}

// The terse "counts" line: processed/total rows, then images and issue
// counts only when non-zero. Numbers-forward with middot separators. Y9
// replaces the old always-visible run-on line (rows - images - issues -
// result summary - timing - error) with just these figures; the verbose
// tallies, timing and applied options move behind the Details fold, and an
// error/stall line renders on its own coloured row (never folded).
function getJobCountsSummary(
  job: ImportJob,
  labels: { rows: string; images: string; issues: string; analyzed?: string; queued?: string },
): string {
  const parts: string[] = [getRowsDisplay(job, labels.rows, labels.analyzed, labels.queued)]
  const totalImages = Number(job?.total_images || 0)
  if (totalImages) {
    parts.push(`${Number(job?.processed_images || 0).toLocaleString()} / ${totalImages.toLocaleString()} ${labels.images}`)
  }
  const failedRows = Number(job?.failed_rows || job?.summary?.failed || 0)
  const failedImages = Number(job?.failed_images || 0)
  if (failedRows || failedImages) {
    parts.push(`${(failedRows + failedImages).toLocaleString()} ${labels.issues}`)
  }
  return parts.join(' · ')
}

function formatTimingMs(ms: unknown): string | null {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return null
  if (n < 1000) return `${Math.round(n)}ms`
  const seconds = n / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${remainder}s`
}

// Surfaces the wall-clock duration of whichever phase most recently
// finished (apply takes priority once it exists, since that's the phase
// the person is actually waiting on after they click Approve -- analyze's
// number stays useful before that). Only meaningful once a phase is done
// (totalMs is a running "time since this phase's first chunk started"
// figure while still in progress -- see runImportApply's `Date.now() -
// state.startedAtMs`), so this is called only for terminal-status jobs.
function getJobTimingSummary(job: ImportJob): string | null {
  const timings = job?.summary?.timings
  const phase = timings?.apply ?? timings?.analyze
  const total = formatTimingMs(phase?.totalMs)
  if (!total) return null
  const queueWait = formatTimingMs(phase?.queueLatencyMs)
  return queueWait ? `${total} (${queueWait} queue wait on last chunk)` : total
}

export function getRowsDisplay(job: ImportJob, rowsLabel: string, analyzedLabel = 'Analyzed', queuedLabel = 'Queued'): string {
  const status = normalizeJobStatus(job)
  const phase = String(job?.phase || '').toLowerCase()
  const summary = job?.summary || {}
  const analyzedRows = Number(job?.total_rows || summary?.analyzed_rows || summary?.rows || 0)
  if (ACTIVE_STATUSES.has(status) && phase.includes('queued')) {
    // "Queued", not the old "Waiting for import worker" -- the progress
    // label beside this line already says "Waiting for worker".
    return analyzedRows
      ? `${analyzedLabel} ${analyzedRows.toLocaleString()} ${rowsLabel}`
      : queuedLabel
  }
  if (status === 'awaiting_review' && analyzedRows) {
    return `${analyzedLabel} ${analyzedRows.toLocaleString()} ${rowsLabel}`
  }
  if (ACTIVE_STATUSES.has(status) && phase.includes('analyz')) {
    // Same fix as getJobProgressDetails' identical-shape branch: this used
    // to share the awaiting_review case above, so it claimed
    // "Analyzed 11,890 rows" from the very first classify chunk onward --
    // long before the 80th (last) one had actually run. Now shows the real
    // live cursor, with a materialize-time fallback for the sub-phase
    // before total_rows exists at all.
    if (analyzedRows) return `${Number(job?.processed_rows || 0).toLocaleString()} / ${analyzedRows.toLocaleString()} ${rowsLabel} analyzed`
    const materializedSoFar = readMaterializedRowsWrittenSoFar(job)
    return materializedSoFar ? `${materializedSoFar.toLocaleString()} ${rowsLabel} read` : 'Reading file'
  }
  if (phase.includes('apply') && !Number(job?.processed_rows || 0) && analyzedRows) {
    // The apply batch commits all-or-nothing at the end (see
    // getJobProgressDetails' comment on the same phase), so
    // processed_rows stays 0 for the whole phase -- show what's actually
    // true ("N rows applying") instead of a "0 / N" that reads as if
    // nothing has started.
    return `${analyzedRows.toLocaleString()} ${rowsLabel} - applying now`
  }
  return `${Number(job?.processed_rows || 0).toLocaleString()} / ${Number(job?.total_rows || 0).toLocaleString()} ${rowsLabel}`
}

// Draggable position memory. The tracker used to be pinned to a fixed
// top-right (desktop) / top-banner (mobile) spot with no way to move it out
// of the way of whatever's underneath -- persisted the same way dismissal
// is (best-effort localStorage overlay), so a dragged position survives
// reloads but isn't load-bearing if storage is unavailable.
const DRAG_POS_STORAGE_KEY = 'businessos_import_tracker_pos'
const DRAG_EDGE_MARGIN = 8

type DragPos = { left: number; top: number }

function readDragPos(): DragPos | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DRAG_POS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown } | null
    const left = Number(parsed?.left)
    const top = Number(parsed?.top)
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null
    return { left, top }
  } catch (_) {
    return null
  }
}

function writeDragPos(pos: DragPos): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DRAG_POS_STORAGE_KEY, JSON.stringify(pos))
  } catch (_) {
    // Storage unavailable -- dragging still works for the session, it just
    // won't be remembered next reload. Not fatal, same tradeoff as dismissal.
  }
}

// Minimized-to-pill memory. `minimized` used to be plain in-memory state
// ("resets on reload same as `expanded`" -- see its own comment below,
// now out of date) which meant closing the tracker down to its small pill
// only lasted until the next full page reload, at which point the full
// card silently came back -- exactly the "I closed it and it's still
// there" report this fixes. Persisted the same best-effort way dragPos and
// dismissal are: makes the pill choice stick, isn't load-bearing if
// storage is unavailable.
//
// Deliberately NOT job-id-scoped like dismissal is (DismissedJobsMap) --
// minimizing isn't "I've seen this job," it's "get the tracker out of my
// way right now," so it should stay minimized across whatever jobs come
// and go, until either the user reopens it or a NEW problem needs their
// eyes (see the hasAttention-rising-edge effect below, which un-minimizes
// automatically rather than ever silently swallowing a fresh error).
const MINIMIZED_STORAGE_KEY = 'businessos_import_tracker_minimized'

function readMinimized(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(MINIMIZED_STORAGE_KEY) === '1'
  } catch (_) {
    return false
  }
}

function writeMinimized(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (value) window.localStorage.setItem(MINIMIZED_STORAGE_KEY, '1')
    else window.localStorage.removeItem(MINIMIZED_STORAGE_KEY)
  } catch (_) {
    // Storage unavailable -- minimizing still works for the session, it
    // just won't be remembered next reload. Not fatal, same tradeoff as
    // dragPos/dismissal above.
  }
}

// Keeps a dragged position on-screen after a resize/rotation (e.g. a
// position saved from a wide desktop window shouldn't leave the tracker
// hanging off the edge of a narrower one on the next visit).
function clampDragPos(pos: DragPos, width: number, height: number): DragPos {
  const maxLeft = Math.max(DRAG_EDGE_MARGIN, window.innerWidth - width - DRAG_EDGE_MARGIN)
  const maxTop = Math.max(DRAG_EDGE_MARGIN, window.innerHeight - height - DRAG_EDGE_MARGIN)
  return {
    left: Math.min(maxLeft, Math.max(DRAG_EDGE_MARGIN, pos.left)),
    top: Math.min(maxTop, Math.max(DRAG_EDGE_MARGIN, pos.top)),
  }
}

function buildJobsSignature(jobs: ImportJob[] = []): string {
  return jobs.map((job) => [
    job.id,
    job.status,
    job.phase,
    job.total_rows,
    job.processed_rows,
    job.failed_rows,
    job.total_images,
    job.processed_images,
    job.failed_images,
    job.updated_at,
  ].join(':')).join('|')
}

export default function BackgroundImportTracker() {
  const { notify, t } = useApp()
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [expanded, setExpanded] = useState(false)
  const [reportJobId, setReportJobId] = useState<string | null>(null)
  const [conflictsJob, setConflictsJob] = useState<{ id: string; entityLabel: string } | null>(null)
  const [productConflictsJobId, setProductConflictsJobId] = useState('')
  // Per-session "has this job's conflicts list been opened at least once"
  // set -- see importJobApproveGate.ts's header comment. Deliberately not
  // persisted (readDismissedJobs-style) -- this only needs to survive
  // within one open session/tab, not across reloads; a fresh page load
  // re-prompting once more for a still-open job is the safe direction to
  // err in, not the annoying one.
  const [reviewedConflictJobIds, setReviewedConflictJobIds] = useState<Set<string>>(() => new Set())
  const openConflictsModal = useCallback((jobId: string, entityLabel: string) => {
    setConflictsJob({ id: jobId, entityLabel })
    setReviewedConflictJobIds((current) => (current.has(jobId) ? current : new Set(current).add(jobId)))
  }, [])
  const [busyJobId, setBusyJobId] = useState('')
  // Y9: which expanded job rows have their "Details" fold open (per-result
  // tallies, phase timing, applied import options). In-memory only, like
  // `expanded` -- a transient display choice, not worth persisting.
  const [openDetailJobIds, setOpenDetailJobIds] = useState<Set<string>>(() => new Set())
  const toggleJobDetails = useCallback((jobId: string) => {
    setOpenDetailJobIds((current) => {
      const next = new Set(current)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }, [])
  const [dismissedJobs, setDismissedJobs] = useState<DismissedJobsMap>(() => readDismissedJobs())
  const [pollBackoffMs, setPollBackoffMs] = useState(0)
  const [dragPos, setDragPos] = useState<DragPos | null>(() => readDragPos())
  const [isDragging, setIsDragging] = useState(false)
  // Separate from dismissing a job (which is only allowed once it's reached
  // a terminal-ish status -- see DISMISSABLE_STATUSES) -- this just hides the
  // widget's full card down to a small reopenable pill. Before this, the "X"
  // in the corner only rendered at all when *every* visible job was
  // dismissable, so a single still-active (or zombie-stuck) job meant there
  // was no way to close the tracker at all, even to just get it out of the
  // way while working. Minimizing doesn't touch job state or polling -- it's
  // purely a display choice, persisted via readMinimized/writeMinimized (see
  // their comment) so it survives a reload instead of resetting like
  // `expanded` does.
  const [minimized, setMinimizedState] = useState(() => readMinimized())
  const setMinimized = useCallback((value: boolean) => {
    setMinimizedState(value)
    writeMinimized(value)
  }, [])
  const previousHasAttentionRef = useRef(false)
  const aliveRef = useRef(true)
  const timerRef = useRef<number | null>(null)
  const jobsSignatureRef = useRef('')
  const jobsRef = useRef<ImportJob[]>([])
  const actionInFlightRef = useRef('')
  // Direct-apply (unified import hub): remembers which auto_approve jobs we have
  // already fired the approve for, and bridges to handleApprove (defined below
  // the primaryJob early return) so the auto-approve effect above can call it.
  const autoApprovedJobIdsRef = useRef<Set<string>>(new Set())
  const autoApproveHandlerRef = useRef<((job: ImportJob) => void) | null>(null)
  const trackerRef = useRef<HTMLDivElement | null>(null)
  // Drag is now initiated from anywhere on the header row (icon, title,
  // subtitle) instead of only a small dedicated grip button. Previously the
  // grip button lived as its own flex item inside a `flex-col` container,
  // which made it stretch into a full-width strip sitting *above* the title
  // row instead of next to it -- visually a separate floating bar (see
  // image1) rather than a handle that's part of the card. `moved` tracks
  // whether a given pointer-down actually turned into a drag, so a plain
  // click on the header still toggles `expanded` instead of being eaten by
  // the drag handler.
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; origLeft: number; origTop: number; moved: boolean; pointerType: string } | null>(null)
  const justDraggedRef = useRef(false)

  // Re-clamp a remembered position on mount and on resize/rotation so it
  // can't be stuck off-screen after e.g. going from a wide window to a
  // narrow one.
  useEffect(() => {
    if (!dragPos) return
    const clampToViewport = () => {
      const el = trackerRef.current
      if (!el) return
      setDragPos((current) => (current ? clampDragPos(current, el.offsetWidth, el.offsetHeight) : current))
    }
    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A small movement threshold (px) before a pointer-down on the header
  // counts as a drag rather than a click-through to the expand toggle.
  //
  // This used to be a single flat 4px for every pointer type. Mouse input
  // is precise enough that 4px is fine, but a touch tap is never that
  // still -- real fingers wobble well past 4px between touchstart and
  // touchend even when the person's intent is a plain tap, not a drag.
  // That meant almost every tap on a touchscreen crossed the threshold,
  // flipped `moved` to true, and set `justDraggedRef` on release -- which
  // swallows the very next click (see endHeaderDrag below). Net effect on
  // a touch device: tapping the tracker to expand it (and therefore ever
  // reaching the Approve/Cancel buttons in the expanded section) silently
  // no-ops almost every time -- "can't click on it, can't approve" is
  // exactly what that looks like from the outside, not a backend problem.
  // Per-pointer-type thresholds (~standard touch-slop sizing: Android's
  // own slop constant is ~8dp, iOS Safari's is similar) fix this without
  // loosening mouse precision at all.
  const DRAG_MOVE_THRESHOLD_BY_POINTER_TYPE: Record<string, number> = { touch: 10, pen: 8, mouse: 4 }
  const getDragMoveThreshold = (pointerType: string): number => DRAG_MOVE_THRESHOLD_BY_POINTER_TYPE[pointerType] ?? 4

  const handleHeaderPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Same fix as NotesWidget.tsx's identical handler: the title button
    // nested in this header has no pointer handlers of its own, so its
    // pointerdown bubbles up here. Capturing the pointer unconditionally
    // can swallow that button's click (some browsers synthesize a touch's
    // click from the captured element instead of the original target once
    // setPointerCapture has run). Bail before capturing when the
    // pointerdown started on a button so its click fires normally.
    if (event.target instanceof HTMLElement && event.target.closest('button')) return
    const el = trackerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      moved: false,
      pointerType: event.pointerType || 'mouse',
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const handleHeaderPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    const el = trackerRef.current
    if (!state || !el || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < getDragMoveThreshold(state.pointerType)) return
    if (!state.moved) {
      state.moved = true
      setIsDragging(true)
    }
    const next = clampDragPos({ left: state.origLeft + dx, top: state.origTop + dy }, el.offsetWidth, el.offsetHeight)
    setDragPos(next)
  }, [])

  const endHeaderDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    dragStateRef.current = null
    if (state.moved) {
      setIsDragging(false)
      setDragPos((current) => {
        if (current) writeDragPos(current)
        return current
      })
      // Suppress the click that fires right after pointerup on whatever was
      // under the cursor (the title toggle button) so a drag doesn't also
      // flip `expanded` -- cleared on the very next click attempt.
      justDraggedRef.current = true
    }
  }, [])

  const visibleJobs = useMemo(() => (
    dedupeJobsById(jobs).filter((job) => {
      const jobId = String(job?.id || '')
      if (jobIsServerDismissed(job)) return false
      const dismissed = dismissedJobs[jobId]
      if (dismissed && dismissed.status === normalizeJobStatus(job)) return false
      const status = normalizeJobStatus(job)
      if (ACTIVE_STATUSES.has(status) || REVIEW_STATUSES.has(status)) return true
      return DONE_STATUSES.has(status) && isRecent(job, 10 * 60 * 1000)
    }).slice(0, 8)
  ), [dismissedJobs, jobs])

  const allDismissable = visibleJobs.length > 0 && visibleJobs.every((job) => DISMISSABLE_STATUSES.has(normalizeJobStatus(job)))

  const activeJobs = useMemo(() => visibleJobs.filter((job) => ACTIVE_STATUSES.has(normalizeJobStatus(job))), [visibleJobs])
  const reviewJobs = useMemo(() => visibleJobs.filter((job) => REVIEW_STATUSES.has(normalizeJobStatus(job))), [visibleJobs])
  const attentionJobs = useMemo(() => visibleJobs.filter(jobNeedsAttention), [visibleJobs])
  // A stalled active job (has an error, but the worker never flipped its
  // status) should surface as the headline job, same as a real review-status
  // one -- otherwise the card keeps announcing a healthy-looking
  // "Applying changes" for something that has actually stopped.
  const primaryJob = attentionJobs[0] || activeJobs[0] || reviewJobs[0] || visibleJobs[0] || null

  const loadJobs = useCallback(async () => {
    try {
      const api = getImportTrackerApi()
      const result = await withLoaderTimeout(
        () => api.listImportJobs?.({ limit: 8 }),
        'Import tracker',
        IMPORT_TRACKER_LOAD_TIMEOUT_MS,
      )
      if (!aliveRef.current) return
      const normalizedResult = normalizeImportJobListResult(result)
      if (normalizedResult.unavailable || normalizedResult.transient) {
        setPollBackoffMs((current) => nextImportTrackerBackoff(current))
      } else {
        setPollBackoffMs(0)
      }
      const nextJobs = dedupeJobsById(normalizedResult.jobs)
      const nextSignature = buildJobsSignature(nextJobs)
      if (nextSignature === jobsSignatureRef.current) return
      const previousJobsById = new Map(
        dedupeJobsById(jobsRef.current).map((job) => [String(job?.id || '').trim(), job]),
      )
      nextJobs.forEach((job) => {
        const jobId = String(job?.id || '').trim()
        if (!jobId) return
        const previousJob = previousJobsById.get(jobId) || null
        if (!shouldDispatchImportCompletionRefresh(previousJob, job)) return
        dispatchImportCompletionRefresh(job, {
          reason: 'import-completed',
          source: 'import-tracker',
        })
      })
      jobsRef.current = nextJobs
      jobsSignatureRef.current = nextSignature
      startTransition(() => setJobs(nextJobs))
    } catch (error) {
      if (!aliveRef.current) return
      const status = typeof error === 'object' && error && 'status' in error ? error.status : undefined
      if (isTransientGatewayError(status)) {
        setPollBackoffMs((current) => nextImportTrackerBackoff(current))
        return
      }
      setPollBackoffMs((current) => nextImportTrackerBackoff(current))
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    loadJobs()
    const baseIntervalMs = activeJobs.length ? IMPORT_TRACKER_ACTIVE_POLL_MS : IMPORT_TRACKER_IDLE_POLL_MS
    const intervalMs = Math.max(baseIntervalMs, pollBackoffMs || 0)
    timerRef.current = window.setInterval(() => {
      if (document.visibilityState === 'hidden' && !activeJobs.length) return
      loadJobs()
    }, intervalMs)
    return () => {
      aliveRef.current = false
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [activeJobs.length, loadJobs, pollBackoffMs])

  // Any import modal's createImportJob (api/methods.ts) fires this the
  // instant a job row exists server-side, so a brand-new import shows up
  // here right away instead of waiting for the next scheduled poll tick
  // (up to IMPORT_TRACKER_IDLE_POLL_MS if nothing else was active).
  useEffect(() => {
    return onImportTrackerPoke(() => { loadJobs() })
  }, [loadJobs])

  const hasAttention = attentionJobs.length > 0

  // Auto-reopen on a RISING edge into attention only (false -> true), not
  // just "while hasAttention is true" -- otherwise a job that already
  // needed attention when the user minimized the tracker would immediately
  // force it back open every render, making minimize a no-op for the exact
  // case (a stuck/erroring job) it exists to get out of the way of. A NEW
  // problem appearing while minimized is different: that's something the
  // user hasn't seen yet and shouldn't stay hidden from, so it still wins
  // over the persisted minimized preference.
  //
  // This effect (and every hook above it) must run on EVERY render
  // regardless of whether there's a primaryJob right now -- the
  // `if (!primaryJob) return null` used to sit ABOVE this useEffect, so the
  // instant the job list emptied (or refilled) the number of hooks actually
  // executed changed between renders. That's a Rules-of-Hooks violation and
  // is exactly what threw "Minified React error #310" (rendered fewer/more
  // hooks than the previous render) in the console/crash report. All hooks
  // now run unconditionally; the early return below is the only thing gated
  // on primaryJob.
  useEffect(() => {
    if (hasAttention && !previousHasAttentionRef.current) setMinimized(false)
    previousHasAttentionRef.current = hasAttention
  }, [hasAttention, setMinimized])

  // Direct-apply for the unified import hub: jobs it flagged `auto_approve` in
  // their policy were already reviewed on the hub, so approve them the moment
  // analysis reaches awaiting_review -- once each. It goes through handleApprove,
  // which still redirects genuine product/contact conflicts into their review /
  // merge screen instead of applying blindly (so this never bypasses that
  // safety). handleApprove is read through a ref because it is defined below the
  // primaryJob early return.
  useEffect(() => {
    const approve = autoApproveHandlerRef.current
    if (!approve) return
    for (const job of jobs) {
      const jobId = String(job?.id || '')
      if (!jobId || autoApprovedJobIdsRef.current.has(jobId)) continue
      const policy = job?.policy as { auto_approve?: boolean } | null | undefined
      if (!policy || policy.auto_approve !== true) continue
      if (normalizeJobStatus(job) !== 'awaiting_review') continue
      autoApprovedJobIdsRef.current.add(jobId)
      approve(job)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs])

  if (!primaryJob) return null

  const status = normalizeJobStatus(primaryJob)
  const isActive = ACTIVE_STATUSES.has(status) && !jobNeedsAttention(primaryJob)
  const isCompletedState = !hasAttention && !isActive
  const title = hasAttention
    ? (t('import_needs_review') || 'Import needs review')
    : isActive
      ? (t('import_running_background') || 'Import running')
      : (t('import_finished') || 'Import finished')
  const rowsLabel = t('import_rows_label') || t('rows') || 'rows'
  const imagesLabel = t('import_images_label') || t('images') || 'images'
  const issuesLabel = t('import_issues_label') || 'issue(s)'
  const cancelLabel = t('cancel') || 'Cancel'
  const errorsLabel = t('errors') || 'Errors'
  const retryLabel = t('retry') || 'Retry'
  const approveLabel = t('approve_import') || 'Approve import'
  const reportLabel = t('view_report') || 'View report'
  const removeLabel = t('remove_import') || t('remove') || 'Remove'
  const closeLabel = t('close') || 'Close'
  const progressLabels = {
    analyzed: t('analyzed') || 'Analyzed',
    rows: rowsLabel,
    reviewReady: t('review_ready') || 'Review ready',
    analyzingFile: t('analyzing_file') || 'Analyzing file',
    // Y8: the materialize/staging sub-phase (raw CSV still being read into
    // rows, before total_rows exists) gets its OWN label so it no longer
    // shares "Analyzing file" with the classify sub-phase -- that shared
    // label is what read as "two analyze passes" to the user.
    readingFile: t('import_reading_file') || 'Reading file',
    cancelled: t('cancelled') || 'Cancelled',
    queued: t('queued') || 'Queued',
    cancelRequested: t('import_cancel_requested') || 'Cancel requested',
    finalCleanup: t('import_final_cleanup') || 'Final cleanup',
    waitingForWorker: t('import_waiting_for_worker') || 'Waiting for worker',
    readyToAnalyze: t('import_ready_to_analyze') || 'Ready to analyze',
    startingApply: t('import_starting_apply') || 'Starting apply',
    applyingChanges: t('import_applying_changes') || 'Applying changes',
    failed: t('failed') || 'Failed',
  }
  const resultLabels = {
    created: t('created') || 'created',
    updated: t('updated') || 'updated',
    duplicate: t('skipped') || 'skipped',
    imageMatched: t('image_matched') || 'image matched',
    imageSkipped: t('image_skipped') || 'image skipped',
    rowIssue: t('row_issue') || 'row issue',
    needsReview: t('import_needs_review_count') || 'needs review',
  }
  const primaryProgress = getJobProgressDetails(primaryJob, progressLabels)
  const progress = primaryProgress.value
  const compactTracker = isCompletedState && !expanded

  const beginTrackerAction = (job: ImportJob, action: string): TrackerAction | null => {
    const jobId = String(job?.id || '').trim()
    if (!jobId) return null
    const key = `${action}:${jobId}`
    if (!beginNamedAction(actionInFlightRef, key, { blocked: !!busyJobId })) return null
    setBusyJobId(jobId)
    return { jobId, key }
  }

  const finishTrackerAction = (action: TrackerAction | null) => {
    finishNamedAction(actionInFlightRef, action?.key || '')
    setBusyJobId('')
  }

  const handleCancel = async (job: ImportJob) => {
    const action = beginTrackerAction(job, 'cancel')
    if (!action) return
    try {
      const api = getImportTrackerApi()
      await withLoaderTimeout(
        () => api.cancelImportJob(action.jobId),
        'Cancel import job',
        IMPORT_TRACKER_CANCEL_TIMEOUT_MS,
      )
      await loadJobs()
      notify(t('import_cancel_requested') || 'Import cancel requested', 'info')
    } catch (error) {
      notify(getErrorMessage(error) || (t('import_cancel_failed') || 'Could not cancel import'), 'error')
    } finally {
      finishTrackerAction(action)
    }
  }

  const handleRetry = async (job: ImportJob) => {
    const action = beginTrackerAction(job, 'retry')
    if (!action) return
    try {
      const api = getImportTrackerApi()
      await withLoaderTimeout(
        () => api.retryImportJob(action.jobId),
        'Retry import job',
        IMPORT_TRACKER_RETRY_TIMEOUT_MS,
      )
      await loadJobs()
      notify(t('import_retry_started') || 'Import retry started', 'success')
    } catch (error) {
      notify(getErrorMessage(error) || (t('import_retry_failed') || 'Could not retry import'), 'error')
    } finally {
      finishTrackerAction(action)
    }
  }

  const handleApprove = async (job: ImportJob) => {
    // See importJobApproveGate.ts -- a contacts job with unresolved
    // name-match conflicts the reviewer hasn't opened yet gets redirected
    // into that review first, instead of silently approving past it. Not
    // a real "approve" action (no busy-state/action-guard, no server
    // call), so it deliberately runs before `beginTrackerAction` below.
    const jobId = String(job.id || '')
    if (shouldPromptConflictReviewBeforeApprove(job, reviewedConflictJobIds, jobId)) {
      openConflictsModal(jobId, CONTACT_JOB_TYPE_LABELS[String(job.type || '')] || 'Contacts')
      notify(
        t('import_review_conflicts_first')
          || 'Possible duplicate names — review them, then approve.',
        'info',
      )
      return
    }
    const action = beginTrackerAction(job, 'approve')
    if (!action) return
    try {
      const api = getImportTrackerApi()
      const preflight = await withLoaderTimeout(
        () => api.preflightImportJob?.(action.jobId),
        'Import preflight',
        IMPORT_TRACKER_PREFLIGHT_TIMEOUT_MS,
      )
      if (preflight && preflight.ok === false) {
        const firstFailure = preflight.failures?.[0]
        notify(String(firstFailure?.message || '') || (t('import_review_needed') || 'Review import decisions before applying.'), 'error')
        await loadJobs()
        return
      }
      await withLoaderTimeout(
        // Stock-action jobs carry the explicit confirm flag: the rows were
        // reviewed client-side before upload, and without it the server
        // 409s any conflicted plan -- which made a hub-routed stock job
        // unapprovable from this tracker at all (auto-approve AND the
        // manual button both hit the same dead-end).
        () => api.approveImportJob(action.jobId, String(job.type || '') === 'stock_actions' ? { confirmStockActions: true } : undefined),
        'Approve import job',
        IMPORT_TRACKER_APPROVE_TIMEOUT_MS,
      )
      await loadJobs()
      notify(t('import_apply_started') || 'Applying in the background.', 'success')
    } catch (error) {
      // The server is the ONE authority on whether product conflicts are
      // genuinely unresolved (its 409 uses the same unresolved-rows query
      // the review screen does). The old client-side pre-gate fired on ANY
      // warned>0 summary, bouncing fully-resolved hub jobs into the
      // conflicts modal for nothing -- now approve is simply attempted and
      // only a real 409 routes to the resolver, which retries the approve
      // itself once everything is resolved.
      if ((error as { code?: string } | null)?.code === 'product_conflicts_unresolved') {
        setProductConflictsJobId(jobId)
        notify(t('import_resolve_product_conflicts') || 'Some rows need a decision — resolve them to continue.', 'info')
      } else {
        notify(getErrorMessage(error) || (t('import_apply_failed') || 'Could not approve import'), 'error')
      }
    } finally {
      finishTrackerAction(action)
    }
  }
  // Bridge for the auto-approve effect above (which sits before the primaryJob
  // early return and so cannot reference handleApprove directly).
  autoApproveHandlerRef.current = handleApprove

  const handleDownloadErrors = async (job: ImportJob) => {
    const action = beginTrackerAction(job, 'download-errors')
    if (!action) return
    try {
      const api = getImportTrackerApi()
      await withLoaderTimeout(
        () => api.downloadImportJobErrors(action.jobId),
        'Download import errors',
        IMPORT_TRACKER_ERRORS_DOWNLOAD_TIMEOUT_MS,
      )
    } catch (error) {
      notify(getErrorMessage(error) || (t('import_errors_download_failed') || 'Could not download import errors'), 'error')
    } finally {
      finishTrackerAction(action)
    }
  }

  const handleRemove = async (job: ImportJob) => {
    const action = beginTrackerAction(job, 'remove')
    if (!action) return
    const okToRemove = window.confirm?.(t('remove_import_confirm') || 'Remove this import from the tracker and delete its uploaded import files?') ?? true
    if (!okToRemove) {
      finishTrackerAction(action)
      return
    }
    const removedId = action.jobId
    try {
      const api = getImportTrackerApi()
      const status = normalizeJobStatus(job)
      const force = !['running', 'cancelling'].includes(status)
      await withLoaderTimeout(
        () => api.deleteImportJob(removedId, { force }),
        'Remove import job',
        IMPORT_TRACKER_REMOVE_TIMEOUT_MS,
      )
      const filteredJobs = dedupeJobsById(jobs).filter((item) => String(item?.id || '') !== removedId)
      jobsSignatureRef.current = buildJobsSignature(filteredJobs)
      jobsRef.current = filteredJobs
      setDismissedJobs((current) => {
        const next: DismissedJobsMap = { ...current, [removedId]: { status: normalizeJobStatus(job), ts: Date.now() } }
        writeDismissedJobs(next)
        return next
      })
      startTransition(() => setJobs(filteredJobs))
      await loadJobs()
      notify(t('import_removed') || 'Import removed', 'success')
    } catch (error) {
      const message = getErrorMessage(error)
      if (/remove route is unavailable|Cannot DELETE|Cannot POST|<!DOCTYPE html/i.test(message)) {
        setDismissedJobs((current) => {
          const next: DismissedJobsMap = { ...current, [removedId]: { status: normalizeJobStatus(job), ts: Date.now() } }
          writeDismissedJobs(next)
          return next
        })
        notify(t('import_hidden_restart_server') || 'Hidden locally — restart or update the server to finish deleting its files.', 'warning')
        return
      }
      notify(message || (t('import_remove_failed') || 'Could not remove import'), 'error')
    } finally {
      finishTrackerAction(action)
    }
  }

  const handleDismiss = async (job: ImportJob) => {
    const dismissedId = String(job?.id || '').trim()
    if (!dismissedId) return
    const dismissedStatus = normalizeJobStatus(job)
    // Remove from view immediately -- don't make the click wait on the
    // network round-trip -- and remember it locally too, so it stays
    // hidden through this tab's next poll even before the server field
    // comes back, and so it still works at all if the request below fails.
    const filteredJobs = dedupeJobsById(jobs).filter((item) => String(item?.id || '') !== dismissedId)
    jobsSignatureRef.current = buildJobsSignature(filteredJobs)
    jobsRef.current = filteredJobs
    setDismissedJobs((current) => {
      const next: DismissedJobsMap = { ...current, [dismissedId]: { status: dismissedStatus, ts: Date.now() } }
      writeDismissedJobs(next)
      return next
    })
    startTransition(() => setJobs(filteredJobs))
    try {
      const api = getImportTrackerApi()
      await api.dismissImportJob(dismissedId)
      notify(t('import_hidden') || 'Import hidden', 'success')
    } catch (error) {
      // Dismiss already happened locally above, so it's not silently
      // lost -- but unlike the local record, this won't follow the user
      // to another device/browser or survive a cache clear until they
      // dismiss it again there (or it's retried successfully).
      notify(
        getErrorMessage(error) || (t('import_hidden_local_only') || 'Hidden on this device only — it may reappear elsewhere.'),
        'warning',
      )
    }
  }

  const handleTitleClick = () => {
    // A drag that just ended fires a trailing click on whatever was under
    // the pointer -- swallow that one click so dragging the header doesn't
    // also toggle the expanded detail list.
    if (justDraggedRef.current) {
      justDraggedRef.current = false
      return
    }
    setExpanded((value) => !value)
  }

  const handleCloseClick = () => {
    if (allDismissable) {
      visibleJobs.forEach((job) => handleDismiss(job))
      return
    }
    // Some visible jobs aren't dismissable yet (still genuinely active, or a
    // zombie stuck job the user hasn't cancelled/removed) -- closing the
    // widget shouldn't be blocked on that. Minimize it down to a small
    // reopenable pill instead of doing nothing, which is what used to
    // happen: the "X" simply wasn't rendered at all in this case, so there
    // was no way to get the card out of the way.
    setMinimized(true)
  }

  if (minimized) {
    // Docked flush to the right edge. Desktop keeps the original vertical-
    // center dock (no bottom nav there, unreported). Mobile anchors above
    // the bottom nav instead of the viewport's vertical center -- same bug
    // and same fix as NotesWidget's collapsed launcher tab (progress.md):
    // `top-1/2` centers on the *viewport*, not the page, so on any page
    // tall enough to scroll, the docked tab parks on top of whatever
    // content happens to sit at that screen midpoint (confirmed via
    // screenshot on Branches' expanded stock list for NotesWidget; this
    // component uses the identical pattern and was flagged as presumably
    // susceptible but left unfixed while unreported -- fixing preemptively
    // now that the root cause is already known rather than waiting for a
    // second report of the same bug class).
    return (
      <div className="pointer-events-none fixed right-0 z-[1000] bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-auto md:top-1/2 md:-translate-y-1/2">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-label={visibleJobs.length > 1 ? `${visibleJobs.length} imports - ${title}` : title}
          title={title}
          className={`group pointer-events-auto flex items-center gap-1.5 rounded-l-full border py-2.5 pl-2.5 pr-1 shadow-lg backdrop-blur transition-[padding-right,transform] duration-150 hover:pr-3 focus-visible:pr-3 ${
            hasAttention
              ? 'border-amber-200 bg-amber-50/95 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/90 dark:text-amber-100'
              : 'border-blue-200 bg-blue-50/95 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/90 dark:text-blue-100'
          }`}
        >
          {hasAttention ? <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> : isActive ? <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />}
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-semibold opacity-0 transition-[max-width,opacity] duration-150 group-hover:max-w-[10rem] group-hover:opacity-100 group-focus-visible:max-w-[10rem] group-focus-visible:opacity-100">
            {visibleJobs.length > 1 ? `${visibleJobs.length} imports` : title}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div
      ref={trackerRef}
      style={dragPos ? { left: `${dragPos.left}px`, top: `${dragPos.top}px` } : undefined}
      className={dragPos
        ? `pointer-events-none fixed z-[1000] w-[min(380px,calc(100vw-2rem))] ${compactTracker ? 'sm:w-auto' : ''} ${isDragging ? 'transition-none' : ''}`
        : `pointer-events-none fixed top-[4.75rem] left-3 right-3 z-[1000] sm:left-auto sm:top-20 sm:right-4 ${
          compactTracker ? 'sm:w-auto' : 'sm:w-[min(420px,calc(100vw-2rem))]'
        }`}
    >
      <div className={`pointer-events-auto relative border text-sm shadow-lg backdrop-blur [content-visibility:auto] ${
        hasAttention
          ? 'border-amber-200 bg-amber-50/95 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/90 dark:text-amber-100'
          : 'border-blue-200 bg-blue-50/95 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/90 dark:text-blue-100'
      } ${compactTracker ? 'rounded-full px-3 py-2' : 'rounded-2xl px-3 py-2'}`}>
      <button
        type="button"
        aria-label={t('close') || 'Close'}
        title={allDismissable ? (t('close') || 'Close') : (t('minimize') || 'Minimize')}
        onClick={handleCloseClick}
        className="absolute right-1.5 top-1.5 z-10 rounded-full p-1 leading-none text-current/70 hover:bg-black/10 hover:text-current dark:hover:bg-white/10"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className={`flex flex-col ${compactTracker ? '' : 'gap-2'}`}>
        {/* The whole header row is now the drag handle (pointer handlers
            live here, not on a lone grip button), so dragging is "built
            in" to the title bar instead of needing to land a grab on a
            tiny separate icon -- the grip glyph below is just a visual
            affordance for where to grab, not the only place that works. */}
        <div
          className={`flex touch-none items-center gap-2 rounded ${compactTracker ? '' : 'cursor-grab active:cursor-grabbing'} ${allDismissable ? 'pr-5' : 'pr-6'}`}
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={endHeaderDrag}
          onPointerCancel={endHeaderDrag}
        >
          <GripVertical className="h-4 w-4 flex-shrink-0 text-current/40" aria-hidden="true" />
          <button
            type="button"
            className={`flex min-w-0 items-center gap-2 text-left ${compactTracker ? '' : 'flex-1'}`}
            onClick={handleTitleClick}
          >
            {hasAttention ? <AlertTriangle className="h-4 w-4 flex-shrink-0" /> : isActive ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" /> : <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
            <div className={`min-w-0 ${compactTracker ? '' : 'flex-1'}`}>
              {/* truncate + the nowrap/shrink-0 on the label span: without
                  either constraint the title and the progress label shared
                  this row unbounded and wrap-interleaved into each other on
                  phone widths. */}
              <div className="truncate font-semibold">{title}</div>
              {/* Y9: terse counts (rows / images / issues) instead of the
                  old prose "<type> import - <phase>" subtitle, whose phase
                  already shows in the status chip to the right. */}
              {!compactTracker ? <div className="truncate text-xs opacity-80">{getJobCountsSummary(primaryJob, { rows: rowsLabel, images: imagesLabel, issues: issuesLabel, analyzed: progressLabels.analyzed, queued: progressLabels.queued })}</div> : null}
            </div>
            {!compactTracker ? <span className="flex-shrink-0 whitespace-nowrap text-xs font-semibold">{primaryProgress.label}</span> : null}
          </button>
        </div>
        {!compactTracker ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div
            className={`h-full rounded-full ${hasAttention ? 'bg-amber-500' : 'bg-blue-500'} ${primaryProgress.indeterminate ? 'animate-pulse' : ''}`}
            style={{ width: `${Math.max(primaryProgress.indeterminate ? 28 : 0, progress)}%` }}
          />
        </div>
        ) : null}
      </div>

      {expanded ? (
        // Many concurrent/queued imports used to grow this list past the
        // bottom of the screen (the whole fixed widget ran off-viewport).
        // Cap it and scroll internally instead, so the header/progress stay
        // put and the job rows scroll within a bounded box (user, Aug 29).
        <div className="mt-2 grid max-h-[min(calc(var(--app-vh-100)_*_.6),26rem)] gap-2 overflow-y-auto overscroll-contain pr-0.5">
          {visibleJobs.map((job) => {
            const jobStatus = normalizeJobStatus(job)
            const jobProgress = getJobProgressDetails(job, progressLabels)
            const isJobCancellable = CANCELLABLE_STATUSES.has(jobStatus)
            const isJobDismissable = DISMISSABLE_STATUSES.has(jobStatus)
            const isJobRemovable = REMOVABLE_STATUSES.has(jobStatus)
            const isAwaitingReview = jobStatus === 'awaiting_review'
            const lastError = String(job.last_error || '').trim()
            // Active status but either carrying an error, or simply not
            // having checked in for a long time (worker died mid-phase
            // without updating status at all -- see CANCELLABLE/REMOVABLE
            // comment above): flag it visually so it doesn't blend in with
            // jobs that are genuinely still progressing normally.
            const isStalled = isStalledActiveJob(job)
            const isStalledSilently = isStalled && !lastError
            // Only shown once the job has actually stopped running -- see
            // getJobTimingSummary's comment on why totalMs is meaningless
            // mid-run.
            const timingSummary = !ACTIVE_STATUSES.has(jobStatus) ? getJobTimingSummary(job) : null
            // Y9: the neutral breakdown (per-result tallies, phase timing,
            // applied import options) folds behind a per-job "Details"
            // toggle so each row stays a terse status chip + progress bar +
            // counts. An error or stall line is never folded -- it renders on
            // its own coloured row above the toggle.
            const resultParts = getJobResultParts(job, resultLabels)
            const policyLines = describeJobPolicy(job.policy)
            const hasFoldableDetails = resultParts.length > 0 || !!timingSummary || policyLines.length > 0
            const detailsOpen = openDetailJobIds.has(String(job.id || ''))
            return (
              <div
                key={String(job.id || '')}
                className={`rounded-xl border p-2 ${
                  isStalled
                    ? 'border-amber-300 bg-amber-50/70 dark:border-amber-800/60 dark:bg-amber-950/40'
                    : 'border-current/15 bg-white/65 dark:bg-slate-950/45'
                }`}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{getJobLabel(job)}</div>
                    {ACTIVE_STATUSES.has(jobStatus) ? (
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                        <div
                          className={`h-full rounded-full ${isStalled ? 'bg-amber-500' : 'bg-blue-500'} ${jobProgress.indeterminate ? 'animate-pulse' : ''}`}
                          style={{ width: `${Math.max(jobProgress.indeterminate ? 28 : 0, jobProgress.value)}%` }}
                        />
                      </div>
                    ) : null}
                    <div className="mt-1 text-xs opacity-75">
                      {getJobCountsSummary(job, { rows: rowsLabel, images: imagesLabel, issues: issuesLabel, analyzed: progressLabels.analyzed, queued: progressLabels.queued })}
                    </div>
                    {(lastError || isStalledSilently) ? (
                      <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                        {lastError || (t('import_stalled_no_error') || 'No updates for a while — likely stopped; safe to cancel or remove.')}
                      </div>
                    ) : null}
                    {hasFoldableDetails ? (
                      <div className="mt-1">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-medium opacity-70 transition-opacity hover:opacity-100"
                          aria-expanded={detailsOpen}
                          onClick={() => toggleJobDetails(String(job.id || ''))}
                        >
                          <ChevronDown className={`h-3 w-3 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                          {detailsOpen ? (t('hide_details') || 'Hide details') : (t('view_details') || 'View Details')}
                        </button>
                        {detailsOpen ? (
                          <div className="mt-1 flex flex-col gap-1">
                            {resultParts.length ? (
                              <div className="flex flex-wrap gap-1">
                                {resultParts.map((part) => (
                                  <span key={part} className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] dark:bg-white/10">{part}</span>
                                ))}
                              </div>
                            ) : null}
                            {timingSummary ? (
                              <div className="text-[11px] opacity-70">{t('import_took') || 'Took'} {timingSummary}</div>
                            ) : null}
                            {policyLines.length ? (
                              <div className="flex flex-wrap gap-1">
                                {policyLines.map((line) => (
                                  <span key={line.key} className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] dark:bg-white/10" title={`${line.label}: ${line.value}`}>
                                    {line.label}: {line.value}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-black/10 px-2 py-1 text-xs font-semibold dark:bg-white/10">{jobProgress.label}</span>
                    {isJobCancellable ? (
                      <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busyJobId === job.id} aria-label={`${cancelLabel} ${getJobLabel(job)}`} onClick={() => handleCancel(job)}>
                        <XCircle className="mr-1 inline h-3.5 w-3.5" /> {cancelLabel}
                      </button>
                    ) : null}
                    {isJobDismissable ? (
                      <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busyJobId === job.id} aria-label={`${reportLabel} ${getJobLabel(job)}`} onClick={() => setReportJobId(String(job.id || ''))}>
                        <FileWarning className="mr-1 inline h-3.5 w-3.5" /> {reportLabel}
                      </button>
                    ) : null}
                    {isJobDismissable && CONTACT_JOB_TYPES.has(String(job.type || '')) && Number(job.summary?.warned || 0) > 0 ? (
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        disabled={busyJobId === job.id}
                        aria-label={`${t('resolve_conflicts') || 'Resolve conflicts'} ${getJobLabel(job)}`}
                        onClick={() => openConflictsModal(String(job.id || ''), CONTACT_JOB_TYPE_LABELS[String(job.type || '')] || 'Contacts')}
                      >
                        <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> {t('resolve_conflicts') || 'Resolve conflicts'}
                      </button>
                    ) : null}
                    {isJobDismissable && String(job.type || '') === 'products' && Number(job.summary?.warned || 0) > 0 ? (
                      <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busyJobId === job.id} onClick={() => setProductConflictsJobId(String(job.id || ''))}>
                        <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Resolve product conflicts
                      </button>
                    ) : null}
                    {isAwaitingReview ? (
                      <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={busyJobId === job.id} aria-label={`${approveLabel} ${getJobLabel(job)}`} onClick={() => handleApprove(job)}>
                        <PlayCircle className="mr-1 inline h-3.5 w-3.5" /> {approveLabel}
                      </button>
                    ) : null}
                    {REVIEW_STATUSES.has(jobStatus) && !isAwaitingReview ? (
                      <>
                        <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busyJobId === job.id} aria-label={`${errorsLabel} ${getJobLabel(job)}`} onClick={() => handleDownloadErrors(job)}>
                          <FileDown className="mr-1 inline h-3.5 w-3.5" /> {errorsLabel}
                        </button>
                        <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busyJobId === job.id} aria-label={`${retryLabel} ${getJobLabel(job)}`} onClick={() => handleRetry(job)}>
                          <RotateCcw className="mr-1 inline h-3.5 w-3.5" /> {retryLabel}
                        </button>
                      </>
                    ) : null}
                    {isJobDismissable ? (
                      <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busyJobId === job.id} aria-label={`${closeLabel} ${getJobLabel(job)}`} onClick={() => handleDismiss(job)}>
                        <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> {closeLabel}
                      </button>
                    ) : null}
                    {isJobRemovable ? (
                      <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busyJobId === job.id} aria-label={`${removeLabel} ${getJobLabel(job)}`} onClick={() => handleRemove(job)}>
                        <XCircle className="mr-1 inline h-3.5 w-3.5" /> {removeLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
      </div>
      {reportJobId ? (
        <Suspense fallback={null}>
          <ImportReportModal jobId={reportJobId} onClose={() => setReportJobId(null)} />
        </Suspense>
      ) : null}
      {conflictsJob ? (
        <Suspense fallback={null}>
          <ContactImportConflictsModal
            jobId={conflictsJob.id}
            entityLabel={conflictsJob.entityLabel}
            t={t}
            notify={(message: string, tone?: string) => notify(message, tone as NotifyTone | undefined)}
            onClose={() => setConflictsJob(null)}
          />
        </Suspense>
      ) : null}
      {productConflictsJobId ? (
        <Suspense fallback={null}>
          <ProductImportConflictsModal
            jobId={productConflictsJobId}
            notify={(message: string, tone?: string) => notify(message, tone as NotifyTone | undefined)}
            // Every conflict decided -> re-fire the approve that the 409
            // interrupted, so "resolve, then it continues" needs no second
            // click on the tracker row.
            onAllResolved={() => {
              const job = jobsRef.current.find((candidate) => String(candidate.id || '') === productConflictsJobId)
              setProductConflictsJobId('')
              if (job) void handleApprove(job)
            }}
            onClose={() => setProductConflictsJobId('')}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
