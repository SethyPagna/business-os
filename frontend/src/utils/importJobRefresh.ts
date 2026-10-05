const IMPORT_REFRESHABLE_STATUSES = new Set(['completed', 'completed_with_errors'])

type ImportJobLike = {
  id?: unknown
  status?: unknown
  type?: unknown
}

type ImportRefreshDetail = {
  reason?: unknown
  source?: unknown
}

type ImportRefreshEventDetail = {
  channel: string
  reason: string
  source: string
  importJobId: string
  importJobType: string
  importJobStatus: string
  ts: number
}

function normalizeImportJobStatus(job: ImportJobLike | null | undefined) {
  return String(job?.status || '').trim().toLowerCase()
}

function normalizeImportJobType(job: ImportJobLike | null | undefined) {
  return String(job?.type || '').trim().toLowerCase()
}

function uniqueChannels(channels: string[] = []) {
  const unique = new Set<string>()
  for (const channel of Array.isArray(channels) ? channels : []) {
    const value = String(channel || '').trim()
    if (value) unique.add(value)
  }
  return [...unique]
}

function dispatchSyncUpdate(detail: ImportRefreshEventDetail) {
  window.dispatchEvent(new CustomEvent('sync:update', { detail }))
}

export function getImportCompletionRefreshChannels(job: ImportJobLike | null | undefined) {
  const type = normalizeImportJobType(job)
  if (type === 'products') {
    return ['products', 'inventory', 'categories', 'units', 'settings', 'branches', 'suppliers', 'dashboard']
  }
  if (type === 'inventory') {
    return ['inventory', 'products', 'dashboard']
  }
  if (type === 'sales') {
    return ['sales', 'products', 'inventory', 'returns', 'dashboard']
  }
  if (type === 'customers') {
    return ['customers', 'pos']
  }
  if (type === 'suppliers') {
    return ['suppliers', 'products']
  }
  if (type === 'delivery_contacts') {
    return ['deliveryContacts', 'pos']
  }
  return []
}

export function shouldDispatchImportCompletionRefresh(
  previousJob: ImportJobLike | null | undefined,
  nextJob: ImportJobLike | null | undefined,
) {
  const nextStatus = normalizeImportJobStatus(nextJob)
  if (!IMPORT_REFRESHABLE_STATUSES.has(nextStatus)) return false
  const previousStatus = normalizeImportJobStatus(previousJob)
  if (previousStatus === nextStatus) return false
  return getImportCompletionRefreshChannels(nextJob).length > 0
}

export function dispatchImportCompletionRefresh(
  job: ImportJobLike | null | undefined,
  detail: ImportRefreshDetail = {},
) {
  if (typeof window === 'undefined') return []
  const channels = uniqueChannels(getImportCompletionRefreshChannels(job))
  const reason = String(detail.reason || 'import-completed').trim() || 'import-completed'
  const source = String(detail.source || 'import-tracker').trim() || 'import-tracker'
  const jobId = String(job?.id || '').trim()
  const jobType = normalizeImportJobType(job)
  const status = normalizeImportJobStatus(job)
  const ts = Date.now()

  for (const channel of channels) {
    dispatchSyncUpdate({
      channel,
      reason,
      source,
      importJobId: jobId,
      importJobType: jobType,
      importJobStatus: status,
      ts,
    })
  }

  return channels
}

// BackgroundImportTracker.tsx only ever learns about a freshly-created job
// through its own poll loop (up to IMPORT_TRACKER_IDLE_POLL_MS -- 12s --
// after a period with no active jobs, since creating this job is the first
// the tracker's timer hears of it). Every import modal's `createImportJob`
// call goes through this same api/methods.ts wrapper, so poking here once
// covers products/inventory/sales/contacts/image-only import uniformly
// instead of duplicating a dispatch in each modal. This doesn't explain a
// multi-minute gap by itself -- 12s was never going to look like 10
// minutes -- but there's no reason to leave even a small, real window
// where a fresh job exists server-side and the tracker doesn't know yet.
const IMPORT_TRACKER_POKE_EVENT = 'businessos:import-job-created'

export function pokeImportTracker(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(IMPORT_TRACKER_POKE_EVENT))
}

// The Worker broadcasts { action: 'import', jobId } on the channels an import
// wrote to when it finishes (lib/importEngine.ts). That push is how an idle tab
// learns about an import it did not start, so nothing needs to poll for it.
export function isImportJobPush(event: Event): boolean {
  const payload = (event as CustomEvent<{ payload?: { action?: unknown } | null }>).detail?.payload
  return !!payload && payload.action === 'import'
}

export function onImportJobPush(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => { if (isImportJobPush(event)) handler() }
  window.addEventListener('sync:update', listener)
  return () => window.removeEventListener('sync:update', listener)
}

// Shared by the tracker, the bell and the Dashboard card so their reads land
// on one cache key (importJobs:list:limit=8) and dedupe into one request.
export const IMPORT_JOBS_SHARED_LIMIT = 8

// The tracker's read cadence: null means no timer at all. It polls only while
// a job is active or an import was just started from this tab; a failing read
// backs off. Idle, the push and local activity are the only triggers.
export function importTrackerPollIntervalMs(input: { activeJobs: number; recentStart: boolean; backoffMs?: number; activeMs: number }): number | null {
  if (input.activeJobs <= 0 && !input.recentStart) return null
  return Math.max(input.activeMs, input.backoffMs || 0)
}

export function onImportTrackerPoke(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(IMPORT_TRACKER_POKE_EVENT, handler)
  return () => window.removeEventListener(IMPORT_TRACKER_POKE_EVENT, handler)
}
