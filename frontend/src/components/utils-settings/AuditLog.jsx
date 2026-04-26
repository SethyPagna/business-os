import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, ClipboardList, Clock3, Download, MonitorSmartphone, RefreshCw, Search, User2, X } from 'lucide-react'
import { useApp } from '../../AppContext'
import { downloadCSV } from '../../utils/csv'

const DEFAULT_ACTION_CLASS = 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'

const ACTION_COLOR_CLASS = {
  create: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  sale: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  login: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  logout: DEFAULT_ACTION_CLASS,
  stock_add: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  stock_remove: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  stock_adjust: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  stock_set: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  bulk_import: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  image_import: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  upload: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  data_reset: 'bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  factory_reset: 'bg-red-300 text-red-900 dark:bg-red-900/60 dark:text-red-200',
  transfer: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  reset_password: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  repair: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  return: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  backup_export: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  backup_restore: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
}

function toIso(raw) {
  if (!raw) return null
  if (raw.includes('T') || raw.endsWith('Z')) return raw
  return `${raw.replace(' ', 'T')}Z`
}

function formatDateTime(raw) {
  const iso = toIso(raw)
  if (!iso) return '--'
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return raw
  }
}

function formatLogTime(log) {
  return formatDateTime(log.client_time || log.created_at)
}

function formatJsonPretty(value) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function parseLogJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function formatEntityName(log) {
  const raw = String(log.table_name || log.entity || '').trim()
  if (!raw) return 'System'
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase())
}

function extractReference(log) {
  const parsed = parseLogJson(log.new_value)
  if (!parsed || typeof parsed !== 'object') return null
  const candidates = [
    parsed.receiptNumber,
    parsed.returnNumber,
    parsed.username,
    parsed.name,
    parsed.original_name,
    parsed.destinationDir,
    parsed.sourceDir,
  ].filter(Boolean)
  return candidates[0] ? String(candidates[0]) : null
}

function readableSummary(log) {
  const parsed = parseLogJson(log.new_value)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const keys = ['name', 'receiptNumber', 'returnNumber', 'username', 'reason', 'status', 'branch', 'destinationDir', 'sourceDir']
    const parts = keys
      .filter((key) => parsed[key] !== undefined && parsed[key] !== null && parsed[key] !== '')
      .map((key) => String(parsed[key]))
    if (parts.length) return parts.join(' | ')
  }
  if (log.details) return String(log.details).slice(0, 120)
  if (log.new_value) return String(log.new_value).slice(0, 120)
  return null
}

function recordIdentifier(log) {
  if (log.record_id !== null && log.record_id !== undefined && String(log.record_id).trim()) {
    return `ID ${log.record_id}`
  }
  return 'No record ID'
}

function DetailRow({ label, value, mono }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex gap-3">
      <div className="w-28 flex-shrink-0 pt-0.5 text-xs text-gray-400">{label}</div>
      <div className={`flex-1 break-all text-xs text-gray-800 dark:text-gray-200 ${mono ? 'font-mono' : ''}`}>
        {String(value)}
      </div>
    </div>
  )
}

export default function AuditLog() {
  const { t } = useApp()
  const [logs, setLogs] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLog, setDetailLog] = useState(null)
  const [error, setError] = useState(null)

  const actionLabels = useMemo(() => ({
    create: t('create') || 'Create',
    update: t('edit') || 'Update',
    delete: t('delete') || 'Delete',
    sale: t('sale') || 'Sale',
    login: t('login') || 'Login',
    logout: t('logout') || 'Logout',
    stock_add: t('stock_in') || 'Stock Add',
    stock_remove: t('stock_out') || 'Stock Remove',
    stock_adjust: t('adjust_stock') || 'Adjust',
    stock_set: t('adjust_stock') || 'Set stock',
    bulk_import: t('bulk_import') || 'Bulk Import',
    image_import: t('image_import') || 'Image Import',
    upload: t('upload_file') || 'Upload',
    data_reset: t('data_reset') || 'Data Reset',
    factory_reset: t('factory_reset') || 'Factory Reset',
    transfer: t('stock_transfer') || 'Transfer',
    reset_password: t('reset_password') || 'Reset Password',
    repair: t('repair') || 'Repair',
    return: t('returns') || 'Return',
    backup_export: 'Backup Export',
    backup_restore: 'Backup Restore',
  }), [t])

  const actionLabel = useCallback((action) => {
    if (!action) return '--'
    const key = String(action).toLowerCase()
    return actionLabels[key] || key.replace(/_/g, ' ')
  }, [actionLabels])

  const actionColorClass = useCallback((action) => {
    if (!action) return DEFAULT_ACTION_CLASS
    return ACTION_COLOR_CLASS[String(action).toLowerCase()] || DEFAULT_ACTION_CLASS
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    window.api.getAuditLogs()
      .then((data) => setLogs(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error('Failed to load audit logs:', err)
        setLogs([])
        setError(err?.message || 'Failed to load audit logs.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const query = search.trim().toLowerCase()
  const filtered = useMemo(() => logs.filter((log) => {
    if (!query) return true
    return [
      log.user_name,
      log.action,
      log.table_name,
      log.device_tz,
      log.device_name,
      log.entity,
      readableSummary(log),
      extractReference(log),
      recordIdentifier(log),
    ]
      .map((value) => String(value || '').toLowerCase())
      .some((value) => value.includes(query))
  }), [logs, query])

  const exportCsv = useCallback(() => {
    const rows = filtered.map((log) => ({
      ID: log.id,
      Time: formatLogTime(log),
      Entity: formatEntityName(log),
      Record: recordIdentifier(log),
      Reference: extractReference(log) || '',
      User: log.user_name || '',
      Action: actionLabel(log.action),
      Device: log.device_name || '',
      Timezone: log.device_tz || '',
      Summary: readableSummary(log) || '',
    }))
    downloadCSV(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }, [actionLabel, filtered])

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2 min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
          <ClipboardList className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          {t('audit_log') || 'Audit Log'}
        </h1>
        <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
          <button onClick={load} className="btn-secondary inline-flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs sm:text-sm">
            <RefreshCw className="h-4 w-4" />
            {t('refresh') || 'Refresh'}
          </button>
          <button onClick={exportCsv} className="btn-secondary inline-flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs sm:text-sm">
            <Download className="h-4 w-4" />
            {t('export_csv') || 'CSV'}
          </button>
        </div>
      </div>

      <div className="mb-3">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            className="input w-full pl-9 text-sm"
            placeholder={t('search_audit_placeholder') || 'Search logs'}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      <p className="mb-3 text-xs text-gray-400">{t('audit_log_desc') || 'Click a row to see full details.'}</p>

      {error ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <ClipboardList className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
          <div className="flex-1">
            <p className="mb-1 text-sm font-semibold text-red-700 dark:text-red-300">
              {(t('error') || 'Error')}: {t('audit_log') || 'Audit Log'}
            </p>
            <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>
            <button onClick={load} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
              {t('retry') || 'Try again'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="card hidden flex-col overflow-hidden sm:flex">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[860px] text-sm table-bordered">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Entity</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Record</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Reference</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('user') || 'User'}</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('action') || 'Action'}</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('device') || 'Device'}</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('summary') || 'Summary'}</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('time') || 'Time'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {loading ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">{t('loading') || 'Loading...'}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">{t('no_data') || 'No data'}</td></tr>
              ) : filtered.map((log) => (
                <tr
                  key={log.id}
                  className="table-row cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10"
                  onClick={() => setDetailLog(log)}
                >
                  <td className="px-3 py-2">
                    <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{formatEntityName(log)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-xs font-mono text-gray-600 dark:text-gray-300">{recordIdentifier(log)}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{extractReference(log) || '--'}</td>
                  <td className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{log.user_name || '--'}</td>
                  <td className="px-3 py-2">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${actionColorClass(log.action)}`}>
                      {actionLabel(log.action)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="max-w-[170px] truncate text-xs text-gray-700 dark:text-gray-300" title={log.device_name || ''}>
                      {log.device_name || '--'}
                    </div>
                    <div className="text-xs font-mono text-blue-500 dark:text-blue-400">{log.device_tz || '--'}</div>
                  </td>
                  <td className="max-w-[220px] px-3 py-2 text-xs text-gray-500 dark:text-gray-400 truncate">
                    {readableSummary(log) || <span className="italic text-gray-300">{t('click_for_details') || 'Click to view'}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-400">{formatLogTime(log)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-xs text-gray-400 dark:border-gray-700">
          <span>{filtered.length} {t('entries') || 'entries'}</span>
          <span>{t('click_row_details') || 'Click a row for details'}</span>
        </div>
      </div>

      <div className="space-y-2 sm:hidden">
        {loading ? (
          <div className="py-10 text-center text-gray-400">{t('loading') || 'Loading...'}</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400">{t('no_data') || 'No data'}</div>
        ) : filtered.map((log) => (
          <button
            key={log.id}
            type="button"
            className="card w-full p-3 text-left active:bg-blue-50 dark:active:bg-blue-900/10"
            onClick={() => setDetailLog(log)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${actionColorClass(log.action)}`}>
                    {actionLabel(log.action)}
                  </span>
                  <span className="text-xs text-gray-500">{formatEntityName(log)}</span>
                </div>
                <div className="text-xs font-mono text-gray-500">{recordIdentifier(log)}</div>
                {extractReference(log) ? <div className="mt-1 text-xs text-gray-400">{extractReference(log)}</div> : null}
                <div className="mt-1 text-xs font-medium text-gray-700 dark:text-gray-300">{log.user_name || '--'}</div>
                <div className="mt-1 text-xs text-gray-400">{formatLogTime(log)}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-300" />
            </div>
          </button>
        ))}
      </div>

      {detailLog ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setDetailLog(null)}>
          <div
            className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${actionColorClass(detailLog.action)}`}>
                    {actionLabel(detailLog.action)}
                  </span>
                  <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{formatEntityName(detailLog)}</span>
                </div>
                <div className="mt-1 text-xs font-mono text-gray-400">{recordIdentifier(detailLog)}</div>
              </div>
              <button
                onClick={() => setDetailLog(null)}
                className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-3">
              <div className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex items-start gap-2">
                  <Clock3 className="mt-0.5 h-4 w-4 text-blue-500" />
                  <div className="space-y-2">
                    <DetailRow label={t('client_time') || 'Client Time'} value={formatLogTime(detailLog)} />
                    <DetailRow label={t('server_time') || 'Server Time'} value={formatDateTime(detailLog.created_at)} />
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <MonitorSmartphone className="mt-0.5 h-4 w-4 text-blue-500" />
                  <div className="space-y-2">
                    <DetailRow label={t('device') || 'Device'} value={detailLog.device_name || '--'} />
                    <DetailRow label={t('timezone') || 'Timezone'} value={detailLog.device_tz || '--'} mono />
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <User2 className="mt-0.5 h-4 w-4 text-blue-500" />
                  <div className="space-y-2">
                    <DetailRow label={t('user') || 'User'} value={detailLog.user_name || '--'} />
                    <DetailRow label={t('action') || 'Action'} value={actionLabel(detailLog.action)} />
                    <DetailRow label={t('table') || 'Entity'} value={formatEntityName(detailLog)} />
                    <DetailRow label={t('reference') || 'Reference'} value={extractReference(detailLog) || '--'} />
                  </div>
                </div>
              </div>

              {detailLog.old_value ? (
                <div>
                  <div className="mb-1 text-xs font-semibold text-red-500">{t('before_data') || 'Before (old data)'}</div>
                  <pre className="max-h-48 overflow-auto rounded-lg bg-red-50 p-3 text-xs font-mono text-red-700 whitespace-pre-wrap break-all dark:bg-red-900/20 dark:text-red-300">
                    {formatJsonPretty(detailLog.old_value)}
                  </pre>
                </div>
              ) : null}

              {detailLog.new_value ? (
                <div>
                  <div className="mb-1 text-xs font-semibold text-green-600">{t('after_data') || 'After (new data)'}</div>
                  <pre className="max-h-48 overflow-auto rounded-lg bg-green-50 p-3 text-xs font-mono text-green-700 whitespace-pre-wrap break-all dark:bg-green-900/20 dark:text-green-300">
                    {formatJsonPretty(detailLog.new_value)}
                  </pre>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
