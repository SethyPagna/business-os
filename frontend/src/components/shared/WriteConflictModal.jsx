import Modal from './Modal'

function formatConflictTime(value) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

function summarizeCurrentValue(entity, current) {
  if (!current || typeof current !== 'object') return []

  if (entity === 'settings') {
    return Object.entries(current)
      .filter(([, value]) => value != null && value !== '')
      .slice(0, 6)
      .map(([key, value]) => ({
        label: key.replace(/_/g, ' '),
        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
      }))
  }

  if (entity === 'sale') {
    return [
      current.sale_number ? { label: 'Sale', value: String(current.sale_number) } : null,
      current.status ? { label: 'Status', value: String(current.status) } : null,
      current.customer_name ? { label: 'Customer', value: String(current.customer_name) } : null,
      current.updated_at ? { label: 'Updated', value: formatConflictTime(current.updated_at) } : null,
    ].filter(Boolean)
  }

  if (entity === 'return') {
    return [
      current.return_number ? { label: 'Return', value: String(current.return_number) } : null,
      current.reason ? { label: 'Reason', value: String(current.reason) } : null,
      current.return_type ? { label: 'Type', value: String(current.return_type) } : null,
      current.updated_at ? { label: 'Updated', value: formatConflictTime(current.updated_at) } : null,
    ].filter(Boolean)
  }

  return Object.entries(current)
    .slice(0, 4)
    .map(([key, value]) => ({
      label: key.replace(/_/g, ' '),
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }))
}

export default function WriteConflictModal({ conflict, onClose, onReload }) {
  if (!conflict) return null

  const entityLabel = conflict.entityLabel || 'Item'
  const currentSummary = summarizeCurrentValue(conflict.entity, conflict.current)

  return (
    <Modal title={`${entityLabel} changed on another device`} onClose={onClose} size="lg">
      <div className="space-y-5 text-sm text-gray-700 dark:text-gray-300">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-900/20">
          <p className="font-semibold text-amber-800 dark:text-amber-300">
            Your screen was holding an older version of this {entityLabel.toLowerCase()}.
          </p>
          <p className="mt-1 text-amber-700 dark:text-amber-200">
            We already refreshed the latest data in the background so you can review what won before trying again.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Your version expected
            </div>
            <div className="mt-1 font-medium text-gray-900 dark:text-white">
              {formatConflictTime(conflict.expectedUpdatedAt)}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Latest saved version
            </div>
            <div className="mt-1 font-medium text-gray-900 dark:text-white">
              {formatConflictTime(conflict.actualUpdatedAt)}
            </div>
          </div>
        </div>

        {currentSummary.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
              Current saved details
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {currentSummary.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-4 px-4 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {row.label}
                  </span>
                  <span className="max-w-[60%] text-right text-gray-900 dark:text-white break-words">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="btn-secondary">
            Dismiss
          </button>
          <button onClick={onReload} className="btn-primary">
            Reload latest
          </button>
        </div>
      </div>
    </Modal>
  )
}
