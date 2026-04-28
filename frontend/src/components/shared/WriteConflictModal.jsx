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

  if (entity === 'user') {
    return [
      current.name ? { label: 'Name', value: String(current.name) } : null,
      current.username ? { label: 'Username', value: String(current.username) } : null,
      current.email ? { label: 'Email', value: String(current.email) } : null,
      current.updated_at ? { label: 'Updated', value: formatConflictTime(current.updated_at) } : null,
    ].filter(Boolean)
  }

  if (entity === 'role') {
    return [
      current.name ? { label: 'Role', value: String(current.name) } : null,
      current.code ? { label: 'Code', value: String(current.code) } : null,
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

function formatValue(value) {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  return String(value)
}

function getConflictFieldRows(conflict) {
  const entity = String(conflict?.entity || '').trim().toLowerCase()
  const attempted = conflict?.attempted || {}
  const current = conflict?.current || {}

  if (entity === 'settings') {
    return Object.keys(attempted).map((key) => ({
      label: key.replace(/_/g, ' '),
      attempted: formatValue(attempted[key]),
      current: formatValue(current[key]),
    }))
  }

  if (entity === 'sale') {
    const rows = []
    if (Object.prototype.hasOwnProperty.call(attempted, 'sale_status')) {
      rows.push({
        label: 'Status',
        attempted: formatValue(attempted.sale_status),
        current: formatValue(current.sale_status),
      })
    }
    if (
      Object.prototype.hasOwnProperty.call(attempted, 'customer_name')
      || Object.prototype.hasOwnProperty.call(attempted, 'customer_id')
    ) {
      rows.push({
        label: 'Customer',
        attempted: formatValue(attempted.customer_name || attempted.customer_id),
        current: formatValue(current.customer_name || current.customer_id),
      })
    }
    if (Object.prototype.hasOwnProperty.call(attempted, 'notes')) {
      rows.push({
        label: 'Notes',
        attempted: formatValue(attempted.notes),
        current: formatValue(current.notes),
      })
    }
    return rows
  }

  if (entity === 'return') {
    const rows = [
      { label: 'Reason', attempted: formatValue(attempted.reason), current: formatValue(current.reason) },
      { label: 'Type', attempted: formatValue(attempted.return_type), current: formatValue(current.return_type) },
      { label: 'Notes', attempted: formatValue(attempted.notes), current: formatValue(current.notes) },
      { label: 'Refund (USD)', attempted: formatValue(attempted.total_refund_usd), current: formatValue(current.total_refund_usd) },
    ]
    const attemptedItems = Array.isArray(attempted.items)
      ? attempted.items.map((item) => `${item.product_name || 'Item'} x${item.quantity}${item.return_to_stock === false ? ' (no restock)' : ''}`).join(', ')
      : ''
    const currentItems = Array.isArray(current.items)
      ? current.items.map((item) => `${item.product_name || 'Item'} x${item.quantity}${item.return_to_stock === false ? ' (no restock)' : ''}`).join(', ')
      : ''
    if (attemptedItems || currentItems) {
      rows.push({
        label: 'Items',
        attempted: formatValue(attemptedItems),
        current: formatValue(currentItems),
      })
    }
    return rows
  }

  if (entity === 'user') {
    return [
      { label: 'Name', attempted: formatValue(attempted.name), current: formatValue(current.name) },
      { label: 'Username', attempted: formatValue(attempted.username), current: formatValue(current.username) },
      { label: 'Email', attempted: formatValue(attempted.email), current: formatValue(current.email) },
      { label: 'Phone', attempted: formatValue(attempted.phone), current: formatValue(current.phone) },
      { label: 'Role', attempted: formatValue(attempted.role_name || attempted.role_id), current: formatValue(current.role_name || current.role_id) },
      { label: 'Active', attempted: formatValue(attempted.is_active), current: formatValue(current.is_active) },
    ].filter((row) => row.attempted !== '—' || row.current !== '—')
  }

  if (entity === 'role') {
    return [
      { label: 'Role name', attempted: formatValue(attempted.name), current: formatValue(current.name) },
      {
        label: 'Permissions',
        attempted: formatValue(
          attempted.permissions && typeof attempted.permissions === 'object'
            ? JSON.stringify(attempted.permissions)
            : attempted.permissions,
        ),
        current: formatValue(
          current.permissions && typeof current.permissions === 'object'
            ? JSON.stringify(current.permissions)
            : current.permissions,
        ),
      },
    ].filter((row) => row.attempted !== '—' || row.current !== '—')
  }

  return []
}

export default function WriteConflictModal({ conflict, onClose, onReload }) {
  if (!conflict) return null

  const entityLabel = conflict.entityLabel || 'Item'
  const currentSummary = summarizeCurrentValue(conflict.entity, conflict.current)
  const fieldRows = getConflictFieldRows(conflict)

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

        {fieldRows.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
              Your edit vs current saved values
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {fieldRows.map((row) => (
                <div key={row.label} className="grid gap-3 px-4 py-3 sm:grid-cols-[140px_1fr_1fr]">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {row.label}
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Your edit</div>
                    <div className="mt-1 break-words text-gray-900 dark:text-white">{row.attempted}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Current saved</div>
                    <div className="mt-1 break-words text-gray-900 dark:text-white">{row.current}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
