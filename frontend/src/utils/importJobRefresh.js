const IMPORT_REFRESHABLE_STATUSES = new Set(['completed', 'completed_with_errors'])

function normalizeImportJobStatus(job) {
  return String(job?.status || '').trim().toLowerCase()
}

function normalizeImportJobType(job) {
  return String(job?.type || '').trim().toLowerCase()
}

function uniqueChannels(channels = []) {
  return [...new Set((Array.isArray(channels) ? channels : []).map((value) => String(value || '').trim()).filter(Boolean))]
}

export function getImportCompletionRefreshChannels(job) {
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

export function shouldDispatchImportCompletionRefresh(previousJob, nextJob) {
  const nextStatus = normalizeImportJobStatus(nextJob)
  if (!IMPORT_REFRESHABLE_STATUSES.has(nextStatus)) return false
  const previousStatus = normalizeImportJobStatus(previousJob)
  if (previousStatus === nextStatus) return false
  return getImportCompletionRefreshChannels(nextJob).length > 0
}

export function dispatchImportCompletionRefresh(job, detail = {}) {
  if (typeof window === 'undefined') return []
  const channels = uniqueChannels(getImportCompletionRefreshChannels(job))
  const reason = String(detail.reason || 'import-completed').trim() || 'import-completed'
  const source = String(detail.source || 'import-tracker').trim() || 'import-tracker'
  const jobId = String(job?.id || '').trim()
  const jobType = normalizeImportJobType(job)
  const status = normalizeImportJobStatus(job)
  const ts = Date.now()

  channels.forEach((channel) => {
    window.dispatchEvent(new CustomEvent('sync:update', {
      detail: {
        channel,
        reason,
        source,
        importJobId: jobId,
        importJobType: jobType,
        importJobStatus: status,
        ts,
      },
    }))
  })

  return channels
}
