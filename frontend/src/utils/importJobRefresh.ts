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
