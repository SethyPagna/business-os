import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArchiveRestore, CheckCircle2, Cloud, DatabaseZap, FolderInput, FolderOutput, HardDriveDownload, Link2, Link2Off, RefreshCw, Upload } from 'lucide-react'
import { isBrokenLocalizedString, useApp } from '../../AppContext'
import { ResetData, FactoryReset } from './ResetData'
import { useActionHistory } from '../../utils/actionHistory.mjs'
import { useIsPageActive } from '../shared/pageActivity'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'
import PageHeader from '../shared/PageHeader'
import ActionHistoryBar from '../shared/ActionHistoryBar'

const QUICK_BACKUP_SECTIONS = [
  'Products + inventory',
  'Sales + returns',
  'Contacts + users',
  'Portal + files',
]

const BACKUP_LOCAL_COPY = {
  km: {
    backup: 'បម្រុងទុក',
    export_backup_desc: 'នាំចេញបម្រុងទុក Docker ពេញលេញសម្រាប់ Postgres, R2 ឬ object storage offline និង Drive sync។',
    export_backup_title: 'នាំចេញបម្រុងទុក',
    folder_backup_placeholder: 'ជ្រើសថតមេ សម្រាប់ចម្លង backup',
    browse_folder: 'ជ្រើសថត',
    browse: 'ថតនៅម៉ាស៊ីនមេ',
    hide_advanced_browser: 'លាក់',
    export_backup_btn: 'នាំចេញ',
    exporting: 'កំពុងនាំចេញ...',
    import_backup_title: 'ស្តារបម្រុងទុក',
    import_backup_desc: 'ស្តារបម្រុងទុក Docker ពេញលេញតែប៉ុណ្ណោះ។',
    folder_restore_placeholder: 'ជ្រើសថត backup ឬថត business-os-data',
    restore_backup_btn: 'ស្តារ',
    importing_backup: 'កំពុងនាំចូល...',
    folder_restore_note: 'ការស្តារជាថតនឹងជំនួសទិន្នន័យបច្ចុប្បន្នដោយមាតិកា backup ដែលបានជ្រើស។',
    rows: 'ជួរ',
    uploads: 'ឯកសារផ្ទុកឡើង',
    custom_tables: 'តារាងផ្ទាល់ខ្លួន',
    exported: 'បាននាំចេញ',
    clear: 'សម្អាត',
    choose_folder_first: 'សូមជ្រើសថតជាមុន',
    server_folder_note: 'សកម្មភាពថតប្រើ path នៅលើម៉ាស៊ីនមេ Business OS។ បើអ្នកភ្ជាប់ពីចម្ងាយ សូមជ្រើស ឬបិទភ្ជាប់ path ដែលមាននៅលើម៉ាស៊ីនមេនោះ។',
    server_restore_note: 'ការស្តារប្រើថតពីម៉ាស៊ីនមេ Business OS។ Browser ពីចម្ងាយមិនអាចរុករកថាសក្នុងម៉ាស៊ីនរបស់ខ្លួនចូល runtime ម៉ាស៊ីនមេបានទេ។',
    host_ui_local_only: 'សកម្មភាពនេះដំណើរការបានតែលើម៉ាស៊ីនមេប៉ុណ្ណោះ។ ប្រើ Browse folders ឬវាយ path របស់ម៉ាស៊ីនមេដោយដៃ នៅពេលភ្ជាប់ពីចម្ងាយ។',
    restore: 'ស្តារ',
    export: 'នាំចេញ',
    refresh: 'ស្រស់ថ្មី',
    save: 'រក្សាទុក',
  },
}

function PathActionButton({ children, ...props }) {
  return (
    <button
      type="button"
      className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium sm:text-sm"
      {...props}
    >
      {children}
    </button>
  )
}

function PrimaryActionButton({ children, ...props }) {
  return (
    <button
      type="button"
      className="btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium sm:text-sm"
      {...props}
    >
      {children}
    </button>
  )
}

function JobProgressCard({ job, copy, onClear }) {
  if (!job) return null
  const progress = Math.max(0, Math.min(100, Number(job.progress || 0)))
  const status = String(job.status || '').toLowerCase()
  const failed = status === 'failed' || status === 'cancelled'
  const completed = status === 'completed'
  const result = job.result || {}
  return (
    <div className={`mt-4 rounded-2xl border p-4 text-sm ${failed ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200' : completed ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-100'}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-semibold">{job.message || copy('job_running', 'Working...')}</div>
          <div className="mt-1 text-xs opacity-80">
            {job.type || 'system job'} · {job.phase || job.status || 'queued'}
          </div>
          {job.error ? <div className="mt-2 break-words text-xs font-medium">{job.error}</div> : null}
          {result.packageId || result.localPath || result.objectPrefix ? (
            <div className="mt-2 rounded-xl border border-current/20 bg-white/50 p-3 text-xs dark:bg-slate-950/30">
              {result.packageId ? <div><span className="font-semibold">{copy('backup_version', 'Version')}:</span> {result.packageId}</div> : null}
              {result.objectPrefix ? <div className="break-all"><span className="font-semibold">{copy('object_prefix', 'Object prefix')}:</span> {result.objectPrefix}</div> : null}
              {result.localPath ? <div className="break-all"><span className="font-semibold">{copy('local_copy', 'Local copy')}:</span> {result.localPath}</div> : null}
              {result.message ? <div className="mt-1">{result.message}</div> : null}
            </div>
          ) : null}
        </div>
        {completed || failed ? (
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onClear}>
            {copy('clear', 'Clear')}
          </button>
        ) : null}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-slate-950/50">
        <div className={`h-full rounded-full ${failed ? 'bg-red-500' : completed ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

function useCopy(t) {
  const isKhmer = /[\u1780-\u17FF]/.test(t?.('cancel') || '')
  return (key, fallback, fallbackKm = fallback) => {
    const value = t?.(key)
    if (value && value !== key && !isBrokenLocalizedString(value)) return value
    if (isKhmer) return BACKUP_LOCAL_COPY.km?.[key] || fallbackKm
    return fallback
  }
}

function buildPathCrumbs(basePath) {
  const raw = String(basePath || '')
  if (!raw) return []
  const normalized = raw.replace(/\//g, '\\')
  const parts = normalized.split('\\').filter(Boolean)
  if (!parts.length) return []
  const crumbs = []
  let cursor = normalized.startsWith('\\\\') ? '\\\\' : ''
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (/^[A-Za-z]:$/.test(part)) cursor = `${part}\\`
    else if (cursor.endsWith('\\') || cursor === '\\\\') cursor = `${cursor}${part}`
    else cursor = `${cursor}\\${part}`
    crumbs.push({ label: part, path: cursor })
  }
  return crumbs
}

function buildFinalDataFolderPath(basePath, folderName = 'business-os-data') {
  const raw = String(basePath || '').trim().replace(/\//g, '\\')
  if (!raw) return ''
  const normalized = /^[A-Za-z]:\\?$/.test(raw)
    ? raw.replace(/\\?$/, '\\')
    : raw.replace(/[\\]+$/, '')
  const parts = normalized.split('\\').filter(Boolean)
  const lastSegment = parts[parts.length - 1] || ''
  if (lastSegment.toLowerCase() === folderName.toLowerCase()) return normalized
  if (normalized.endsWith('\\')) return `${normalized}${folderName}`
  return `${normalized}\\${folderName}`
}

function formatDateTime(raw) {
  if (!raw) return '--'
  const value = raw.includes('T') || raw.endsWith('Z') ? raw : `${raw.replace(' ', 'T')}Z`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatBytes(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount) || amount <= 0) return '0 B'
  if (amount < 1024) return `${amount} B`
  if (amount < 1024 * 1024) return `${(amount / 1024).toFixed(1)} KB`
  if (amount < 1024 * 1024 * 1024) return `${(amount / (1024 * 1024)).toFixed(1)} MB`
  return `${(amount / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function yieldToBrowser() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (typeof window.requestAnimationFrame === 'function') {
    return new Promise((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)))
  }
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function startJobWatcher(jobId, {
  reason = 'System job',
  pollMs = 1200,
  onUpdate = null,
  onComplete = null,
  onError = null,
} = {}) {
  if (typeof window === 'undefined' || !jobId) return () => {}
  let stopped = false
  let inFlight = false
  let timer = null

  const stop = () => {
    stopped = true
    if (timer) window.clearInterval(timer)
    timer = null
  }

  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const result = await window.api.getSystemJob?.(jobId)
      const job = result?.item || result
      if (stopped) return
      if (job && typeof onUpdate === 'function') onUpdate(job)
      const status = String(job?.status || '').toLowerCase()
      if (status === 'completed') {
        stop()
        if (typeof onComplete === 'function') onComplete(job)
      } else if (status === 'failed' || status === 'cancelled') {
        stop()
        const message = job?.error || job?.message || `${reason} failed`
        if (typeof onError === 'function') onError(new Error(message), job)
      }
    } catch (error) {
      stop()
      if (typeof onError === 'function') onError(error)
    } finally {
      inFlight = false
    }
  }

  timer = window.setInterval(tick, Math.max(750, Number(pollMs || 1200)))
  window.setTimeout(tick, 0)
  return stop
}

function normalizeFolderBrowserResult(result, maxDirs = 200) {
  if (!result || typeof result !== 'object') return result
  const dirs = Array.isArray(result.dirs) ? result.dirs : []
  if (dirs.length <= maxDirs) return { ...result, dirs }
  return {
    ...result,
    dirs: dirs.slice(0, maxDirs),
    truncatedCount: dirs.length - maxDirs,
  }
}

function SectionChip({ label, value, tone = 'slate' }) {
  const toneClass = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200',
    blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-700/50 dark:bg-blue-900/20 dark:text-blue-200',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200',
  }[tone] || 'border-slate-200 bg-slate-50 text-slate-700'

  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  )
}

function FolderBrowserPanel({
  browseState,
  busy,
  copy,
  onBrowse,
  onBrowseDrives,
  onClose,
  onSelect,
  useCurrentLabel,
  currentPathLabel,
}) {
  if (!browseState) return null
  const browseCrumbs = buildPathCrumbs(browseState?.base || '')
  const selectedFolderLabel = String(browseState?.base || '').split(/[/\\]/).pop() || String(browseState?.base || '')

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-900/30">
      <div className="border-b border-gray-200 bg-gray-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-800/80">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => browseState.parent && onBrowse(browseState.parent)}
            disabled={busy || !browseState.parent}
            className={`rounded-lg px-2.5 py-1.5 text-xs ${browseState.parent ? 'bg-white text-gray-700 hover:bg-gray-100 dark:bg-zinc-700 dark:text-gray-200 dark:hover:bg-zinc-600' : 'cursor-not-allowed bg-gray-100 text-gray-300 dark:bg-zinc-800 dark:text-gray-600'}`}
          >
            {browseState.parent === '__ROOTS__' ? copy('browse_drives', 'Browse drives') : copy('up', 'Up')}
          </button>
          <button
            onClick={onBrowseDrives}
            disabled={busy}
            className="rounded-lg bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:bg-zinc-700 dark:text-gray-200 dark:hover:bg-zinc-600"
          >
            {copy('browse_drives', 'Browse drives')}
          </button>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-zinc-700 dark:hover:text-gray-200"
          >
            {copy('close', 'Close')}
          </button>
        </div>
        <div className="mt-3">
          {!browseState.isRootList && browseCrumbs.length ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {browseCrumbs.map((crumb, index) => (
                <button
                  key={`${crumb.path}-${index}`}
                  className="rounded-full bg-white px-2.5 py-1 font-mono text-gray-600 hover:bg-blue-50 hover:text-blue-700 dark:bg-zinc-700 dark:text-gray-300 dark:hover:bg-blue-900/30 dark:hover:text-blue-200"
                  onClick={() => onBrowse(crumb.path)}
                >
                  {crumb.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="font-mono text-xs text-gray-500 dark:text-gray-400">{browseState.base}</div>
          )}
        </div>
      </div>

      <div className="max-h-72 overflow-y-auto p-3">
        {browseState.error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-500 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            {browseState.error}
          </div>
        ) : null}
        {!browseState.error && browseState.dirs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 px-4 py-4 text-sm text-gray-400 dark:border-zinc-700">
            {copy('no_subfolders_found', 'No subfolders found')}
          </div>
        ) : null}
        {Number(browseState.truncatedCount || 0) > 0 ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
            {copy('folder_browser_limited', 'Showing the first 200 folders so the page stays responsive. Type a more specific path to narrow the list.')} ({browseState.truncatedCount} {copy('hidden', 'hidden')})
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {browseState.dirs.map((dir) => (
            <div key={dir.fullPath} className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/40">
              <button
                className="w-full text-left text-sm font-medium text-gray-700 hover:text-blue-700 dark:text-gray-200 dark:hover:text-blue-300"
                onClick={() => onBrowse(dir.fullPath)}
              >
                {dir.name}
              </button>
              <div className="mt-1 truncate text-[11px] font-mono text-gray-400">{dir.fullPath}</div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-400">
                  {dir.kind === 'drive'
                    ? copy('drive', 'Drive')
                    : browseState.isRootList
                      ? copy('shortcut', 'Shortcut')
                      : copy('folder', 'Folder')}
                </span>
                <button
                  className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-200 dark:hover:bg-blue-900/50"
                  onClick={() => onSelect(dir.fullPath)}
                >
                  {copy('use_folder', 'Use')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!browseState.isRootList ? (
        <div className="flex flex-col gap-2 border-t border-gray-200 bg-gray-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-800/70 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">{currentPathLabel}</span>
          <button className="btn-primary w-full px-3 py-1.5 text-xs sm:w-auto" onClick={() => onSelect(browseState.base)}>
            {useCurrentLabel || `${copy('use_folder', 'Use')} "${selectedFolderLabel}"`}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function DataFolderLocation({ t, notify, active = true, actionHistory = null }) {
  const copy = useCopy(t)
  const [info, setInfo] = useState(null)
  const [systemConfig, setSystemConfig] = useState(null)
  const [inputPath, setInputPath] = useState('')
  const [browseState, setBrowseState] = useState(null)
  const [showAdvancedBrowser, setShowAdvancedBrowser] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const loadRequestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = beginTrackedRequest(loadRequestRef)
    try {
      const [resultState, configState] = await Promise.allSettled([
        withLoaderTimeout(() => window.api.getDataPath(), 'Backup data path'),
        withLoaderTimeout(() => window.api.getSystemConfig?.(), 'Backup system config').catch(() => null),
      ])

      const result = resultState.status === 'fulfilled' ? resultState.value : null
      const config = configState.status === 'fulfilled' ? configState.value : null

      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      if (result) {
        setInfo(result)
        setInputPath(result?.storageRootParent || result?.dataRootParent || result?.storageRoot || result?.dataRoot || '')
      }
      setSystemConfig(config)

      if (!result && resultState.status === 'rejected') {
        throw resultState.reason || new Error('Failed to load data folder information')
      }
    } catch (error) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      notify(`${copy('data_folder_load_failed', 'Failed to load data folder information')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    }
  }, [copy, notify])

  useEffect(() => {
    if (!active) {
      invalidateTrackedRequest(loadRequestRef)
      return
    }
    load()
  }, [active, load])
  useEffect(() => () => invalidateTrackedRequest(loadRequestRef), [])

  const folderName = info?.dataFolderName || 'business-os-data'
  const currentSummary = info?.summary || {}
  const orgStorageStatus = info?.organizationStorageStatus || null
  const hostUiAvailable = !!systemConfig?.hostUiAvailable
  const previewPath = useMemo(
    () => buildFinalDataFolderPath(inputPath, folderName),
    [folderName, inputPath],
  )

  const openBrowser = async (dir) => {
    if (busy) return
    try {
      setBusy(true)
      await yieldToBrowser()
      const result = await window.api.browseDir(dir || inputPath || info?.storageRootParent || info?.storageRoot || info?.dataRoot || '')
      if (result) setBrowseState(normalizeFolderBrowserResult(result))
    } catch (error) {
      notify(`${copy('failed', 'Failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const openDriveBrowser = async () => {
    await openBrowser('__ROOTS__')
  }

  const pickFolderNatively = async () => {
    if (busy) return
    if (!hostUiAvailable) {
      notify(copy('host_ui_local_only', 'This action only works on the server machine. Use Browse folders or type a server path manually when connected remotely.'), 'info')
      setShowAdvancedBrowser(true)
      return
    }
    try {
      setBusy(true)
      await yieldToBrowser()
      const selectedFolder = await window.api.openFolderDialog?.(inputPath || info?.storageRootParent || info?.storageRoot || info?.dataRoot || '')
      if (selectedFolder && typeof selectedFolder === 'string') {
        setInputPath(selectedFolder)
        setBrowseState(null)
        inputRef.current?.focus()
        notify(copy('folder_selected', 'Folder selected'), 'success')
        return
      }
    } catch (error) {
      console.warn('[Backup] Native folder picker unavailable:', error?.message || error)
    } finally {
      setBusy(false)
    }
    notify(copy('folder_picker_fallback', 'Native folder picker is unavailable in this runtime. Use Browse folders below.'), 'info')
    setShowAdvancedBrowser(true)
    await openDriveBrowser()
  }

  const openInlinePicker = async () => {
    const next = !showAdvancedBrowser
    setShowAdvancedBrowser(next)
    if (next && !browseState && String(inputPath || '').trim()) await openBrowser(inputPath)
  }

  const openInExplorer = async () => {
    const target = String(info?.dataRoot || previewPath || '').trim()
    if (!target) return
    if (!hostUiAvailable) {
      notify(copy('open_folder_local_only', 'Opening the folder is only available on the server machine.'), 'info')
      return
    }
    try {
      const result = await window.api.openPath?.(target)
      if (result?.success === false) notify(result.error || result.message || copy('unknown_error', 'Unknown error'), 'error')
    } catch (error) {
      notify(`${copy('failed', 'Failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    }
  }

  const selectDir = (fullPath) => {
    setInputPath(fullPath)
    setBrowseState(null)
    inputRef.current?.focus()
  }

  const handleApply = async () => {
    if (busy) return
    const target = String(previewPath || '').trim()
    if (!target) return notify(copy('data_folder_path_required', 'Please enter a folder path'), 'error')
    if (!confirm(`${copy('data_folder_change_prompt', 'Copy current live Business OS data to')}:\n\n${target}\n\n${copy('data_folder_copy_safe', 'The current folder stays untouched as a safety copy. The server must be restarted after this change.')}\n\n${copy('proceed', 'Proceed?')}`)) return

    try {
      setBusy(true)
      const result = await window.api.setDataPath(target)
      if (result?.success) {
        actionHistory?.pushAction?.({
          scope: 'backup',
          entity: 'data_path',
          label: copy('data_folder_updated', 'Data folder updated. Restart the server to apply.'),
          undo_payload: { previousPath: info?.dataRoot || null },
          redo_payload: { nextPath: target },
        })
        notify(copy('data_folder_updated', 'Data folder updated. Restart the server to apply.'), 'success')
        load()
        return
      }
      notify(`${copy('failed', 'Failed')}: ${result?.error || copy('unknown_error', 'Unknown error')}`, 'error')
    } catch (error) {
      notify(`${copy('failed', 'Failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleReset = async () => {
    if (busy) return
    if (!confirm(`${copy('data_folder_reset_prompt', 'Copy current live data back to the default business-os-data folder?')}\n\n${copy('data_folder_copy_safe', 'The current folder stays untouched as a safety copy. The server must be restarted after this change.')}`)) return
    try {
      setBusy(true)
      const result = await window.api.resetDataPath()
      if (result?.success === false) {
        notify(result.error || copy('unknown_error', 'Unknown error'), 'error')
        return
      }
      notify(copy('data_folder_reset_done', 'Reverted to default folder. Restart the server to apply.'))
      actionHistory?.pushAction?.({
        scope: 'backup',
        entity: 'data_path',
        label: copy('data_folder_reset_done', 'Reverted to default folder. Restart the server to apply.'),
        undo_payload: { previousPath: info?.dataRoot || null },
      })
      load()
    } catch (error) {
      notify(`${copy('failed', 'Failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-5 sm:p-6">
      <h2 className="mb-1 text-base font-semibold text-gray-900 dark:text-white">
        {copy('data_folder_location', 'Live Data Location')}
      </h2>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        {copy('data_folder_desc', 'Choose the parent folder for live data. Business OS keeps the database, uploads, and generated files together in')} <code className="rounded bg-gray-100 px-1 text-xs dark:bg-zinc-800">{folderName}</code>.
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionChip label={copy('active_path', 'Active live folder')} value={info?.dataRoot || '--'} tone="blue" />
        <SectionChip label={copy('storage_home', 'Storage home')} value={info?.storageRoot || '--'} tone="amber" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SectionChip label={copy('location_mode', 'Location mode')} value={info?.hasOverride ? copy('custom_path', 'Custom path') : copy('portable_default', 'Portable default')} />
        <SectionChip label={copy('database_size', 'Database size')} value={formatBytes(currentSummary.dbSizeBytes)} />
        <SectionChip label={copy('uploads', 'Uploads')} value={currentSummary.uploadCount ?? 0} />
        <SectionChip label={copy('files_total', 'Files on disk')} value={currentSummary.totalFileCount ?? 0} />
      </div>

      {orgStorageStatus ? (
        <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/30">
          <div className="grid gap-3 lg:grid-cols-2">
            <SectionChip
              label={copy('organization_runtime_alignment', 'Organization runtime alignment')}
              value={orgStorageStatus.fullyAligned ? copy('aligned', 'Aligned') : copy('docker_runtime_pending', 'Docker runtime pending')}
              tone={orgStorageStatus.fullyAligned ? 'blue' : 'amber'}
            />
            <SectionChip
              label={copy('recommended_org_data_root', 'Recommended org data root')}
              value={orgStorageStatus.recommendedDataRoot || '--'}
            />
          </div>
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {orgStorageStatus.fullyAligned
              ? copy('organization_runtime_alignment_desc_ok', 'The active runtime data, database, and uploads are all aligned with the organization storage layout.')
              : copy('organization_runtime_alignment_desc_warn', 'The app is still running from the shared runtime data root. The organization layout exists, but the live database and uploads are not fully rooted there yet.')}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:flex-wrap">
        <input
          id="backup-data-folder-path"
          name="backup_data_folder_path"
          aria-label={copy('choose_data_folder_path', 'Choose parent folder for live data')}
          ref={inputRef}
          className="input min-w-0 w-full flex-1 font-mono text-sm"
          placeholder={copy('data_folder_placeholder', 'e.g. D:\\Business Data')}
          value={inputPath}
          onChange={(event) => setInputPath(event.target.value)}
          spellCheck={false}
        />
        <PathActionButton onClick={pickFolderNatively} disabled={busy}>
          <FolderOutput className="h-4 w-4" />
          {copy('browse_folder', 'Choose Folder')}
        </PathActionButton>
        <PathActionButton onClick={openInlinePicker} disabled={busy}>
          <FolderOutput className="h-4 w-4" />
          {showAdvancedBrowser ? copy('hide_advanced_browser', 'Hide') : copy('browse', 'Server folders')}
        </PathActionButton>
        <PathActionButton onClick={openInExplorer} disabled={!hostUiAvailable || !String(info?.dataRoot || previewPath || '').trim()}>
          <FolderOutput className="h-4 w-4" />
          {copy('open_in_explorer', 'Open')}
        </PathActionButton>
      </div>

      {!hostUiAvailable ? (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
          {copy('host_ui_remote_note', 'Remote sessions cannot open the server machine folder dialog or Explorer window. Use Browse folders below or type a server path manually.')}
        </p>
      ) : null}

      {showAdvancedBrowser ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button className="btn-secondary w-full text-xs sm:w-auto" onClick={() => openBrowser(inputPath || info?.storageRootParent || info?.storageRoot || info?.dataRoot)} disabled={busy}>
            {copy('open_typed_path', 'Open typed path')}
          </button>
          <button className="btn-secondary w-full text-xs sm:w-auto" onClick={openDriveBrowser} disabled={busy}>
            {copy('browse_drives', 'Browse drives')}
          </button>
        </div>
      ) : null}

      {showAdvancedBrowser ? (
        <FolderBrowserPanel
          browseState={browseState}
          busy={busy}
          copy={copy}
          onBrowse={openBrowser}
          onBrowseDrives={openDriveBrowser}
          onClose={() => setBrowseState(null)}
          onSelect={selectDir}
          currentPathLabel={copy('use_this_folder_directly', 'Use this folder as the parent location')}
        />
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <PrimaryActionButton onClick={handleApply} disabled={busy || !previewPath || previewPath === info?.dataRoot}>
          <HardDriveDownload className="h-4 w-4" />
          {busy ? copy('applying', 'Applying...') : copy('apply_new_location', 'Switch')}
        </PrimaryActionButton>
        {info?.hasOverride ? (
          <PathActionButton onClick={handleReset} disabled={busy}>
            <ArchiveRestore className="h-4 w-4" />
            {copy('reset_to_default', 'Reset')}
          </PathActionButton>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-gray-400">
        {copy('data_folder_safe_copy', 'Switch copies the current live data first, then leaves the old folder in place as a rollback copy.')}
      </p>
    </div>
  )
}

function GoogleDriveSyncSection({ t, notify, active = true, actionHistory = null }) {
  const copy = useCopy(t)
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState(null)
  const [form, setForm] = useState({
    clientId: '',
    clientSecret: '',
    folderName: 'Business OS Sync',
    deleteMissing: true,
    enabled: true,
    syncIntervalSeconds: 120,
  })
  const [activeJob, setActiveJob] = useState(null)
  const [pendingAuthUrl, setPendingAuthUrl] = useState('')
  const loadRequestRef = useRef(0)
  const retryTimerRef = useRef(null)
  const failureCountRef = useRef(0)
  const failureNotifiedRef = useRef(false)
  const inFlightRef = useRef(false)
  const unavailableUntilRef = useRef(0)
  const loadRef = useRef(null)
  const isMountedRef = useRef(true)
  const jobStopRef = useRef(null)

  const scheduleRetry = useCallback((delayMs) => {
    window.clearTimeout(retryTimerRef.current)
    if (!active) return
    retryTimerRef.current = window.setTimeout(() => {
      if (!isMountedRef.current || !active) return
      loadRef.current?.({ force: true })
    }, Math.max(5000, Number(delayMs || 0) || 30000))
  }, [active])

  const load = useCallback(async ({ force = false } = {}) => {
    if (!active) return
    if (inFlightRef.current) return
    if (!force && unavailableUntilRef.current > Date.now()) return
    const requestId = beginTrackedRequest(loadRequestRef)
    inFlightRef.current = true
    try {
      const result = await withLoaderTimeout(() => window.api.getGoogleDriveSyncStatus?.(), 'Drive sync status')
      const item = result?.item || null
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      if (result?.unavailable) {
        unavailableUntilRef.current = Math.max(Date.now() + 60000, Number(result?.cooldownUntil || 0) || 0)
        failureCountRef.current = Math.max(1, failureCountRef.current)
        scheduleRetry(unavailableUntilRef.current - Date.now())
      } else {
        unavailableUntilRef.current = 0
        failureCountRef.current = 0
        failureNotifiedRef.current = false
        window.clearTimeout(retryTimerRef.current)
      }
      setStatus((current) => item || current || null)
      setForm((current) => ({
        clientId: current.clientId || item?.clientId || '',
        clientSecret: current.clientSecret || '',
        folderName: item?.folderName || current.folderName || 'Business OS Sync',
        deleteMissing: !!item?.deleteMissing,
        enabled: item?.enabled !== false,
        syncIntervalSeconds: Number(item?.syncIntervalSeconds || current.syncIntervalSeconds || 120),
      }))
    } catch (error) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      failureCountRef.current += 1
      const nextDelayMs = Math.min(30000, 2000 * (2 ** Math.min(failureCountRef.current - 1, 4)))
      unavailableUntilRef.current = Date.now() + nextDelayMs
      scheduleRetry(nextDelayMs)
      if (!failureNotifiedRef.current) {
        failureNotifiedRef.current = true
        notify(`${copy('failed', 'Failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
      }
    } finally {
      if (isTrackedRequestCurrent(loadRequestRef, requestId)) {
        inFlightRef.current = false
      }
    }
  }, [active, copy, notify, scheduleRetry])

  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    isMountedRef.current = true
    if (!active) {
      unavailableUntilRef.current = 0
      inFlightRef.current = false
      window.clearTimeout(retryTimerRef.current)
      invalidateTrackedRequest(loadRequestRef)
      return
    }
    load({ force: true })
    return () => {
      isMountedRef.current = false
    }
  }, [active, load])
  useEffect(() => () => {
    isMountedRef.current = false
    window.clearTimeout(retryTimerRef.current)
    jobStopRef.current?.()
    invalidateTrackedRequest(loadRequestRef)
  }, [])

  useEffect(() => {
    if (!active) return undefined
    const handler = (event) => {
      if (event?.data?.type !== 'business-os-drive-sync') return
      if (event.data.status === 'connected') {
        notify(copy('drive_sync_connected', 'Google Drive connected'), 'success')
        setForm((current) => ({ ...current, clientSecret: '' }))
        load({ force: true })
        return
      }
      if (event.data.status === 'error') {
        notify(event.data.message || copy('drive_sync_connect_failed', 'Google Drive connection failed'), 'error')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [active, copy, load, notify])

  const trackQueuedJob = useCallback((queued, reason, handlers = {}) => {
    const jobId = queued?.job_id || queued?.item?.id
    if (!jobId) return queued
    jobStopRef.current?.()
    setActiveJob(queued.item || { id: jobId, status: 'queued', progress: 0, message: reason })
    jobStopRef.current = startJobWatcher(jobId, {
      reason,
      pollMs: 1000,
      onUpdate: (job) => {
        if (isMountedRef.current && job) setActiveJob(job)
      },
      onComplete: (job) => {
        if (!isMountedRef.current) return
        setActiveJob(job || null)
        load({ force: true })
        handlers.onComplete?.(job)
      },
      onError: (error, job) => {
        if (!isMountedRef.current) return
        if (job) setActiveJob(job)
        handlers.onError?.(error, job)
      },
    })
    return queued
  }, [load])

  const savePreferences = async () => {
    if (busy) return
    setBusy('save')
    try {
      await yieldToBrowser()
      const result = await window.api.saveGoogleDriveSyncPreferences?.({
        folderName: form.folderName,
        deleteMissing: form.deleteMissing,
        enabled: form.enabled,
        syncIntervalSeconds: form.syncIntervalSeconds,
      })
      setStatus(result?.item || status)
      actionHistory?.pushAction?.({
        scope: 'backup',
        entity: 'google_drive_sync',
        label: copy('drive_sync_preferences_saved', 'Google Drive sync preferences saved'),
      })
      notify(copy('saved', 'Saved'), 'success')
      window.setTimeout(() => load({ force: true }), 0)
    } catch (error) {
      notify(`${copy('save_failed', 'Save failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy('')
    }
  }

  const connectGoogleDrive = async () => {
    if (busy) return
    if (!String(form.clientId || '').trim() && !status?.clientId) {
      notify(copy('drive_sync_client_required', 'Google OAuth client ID is required'), 'error')
      return
    }
    if (!String(form.clientSecret || '').trim() && !status?.hasClientSecret) {
      notify(copy('drive_sync_secret_required', 'Google OAuth client secret is required'), 'error')
      return
    }

    setPendingAuthUrl('')
    const popup = window.open('', 'business-os-drive-sync', 'width=640,height=760')
    if (popup) {
      try {
        popup.document.title = 'Business OS Google Drive'
        popup.document.body.innerHTML = '<div style="font-family:system-ui;padding:24px"><h2>Business OS</h2><p>Preparing Google Drive connection...</p></div>'
      } catch (_) {}
    }
    setBusy('connect')
    try {
      await yieldToBrowser()
      const result = await window.api.startGoogleDriveSyncOauth?.({
        clientId: form.clientId,
        clientSecret: form.clientSecret,
        folderName: form.folderName,
        deleteMissing: form.deleteMissing,
        enabled: form.enabled,
        syncIntervalSeconds: form.syncIntervalSeconds,
        returnOrigin: window.location.origin,
        returnPath: window.location.pathname + window.location.search,
      })
      const authUrl = result?.authUrl
      if (!authUrl) throw new Error(copy('drive_sync_connect_failed', 'Google Drive connection failed'))
      actionHistory?.pushAction?.({
        scope: 'backup',
        entity: 'google_drive_sync',
        label: copy('drive_sync_connect_started', 'Google Drive connection started'),
      })
      if (popup && !popup.closed) {
        popup.location.href = authUrl
      } else {
        setPendingAuthUrl(authUrl)
        notify(copy('drive_sync_popup_blocked', 'Google Drive setup is ready. Use the open setup button to continue.'), 'info')
      }
      notify(copy('drive_sync_connect_started', 'Complete Google Drive access in the new tab.'), 'info')
    } catch (error) {
      if (popup && !popup.closed) popup.close()
      notify(`${copy('drive_sync_connect_failed', 'Google Drive connection failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy('')
    }
  }

  const syncNow = async () => {
    if (busy) return
    setBusy('sync')
    try {
      await yieldToBrowser()
      const queued = await window.api.queueGoogleDriveSyncNow?.()
      notify(copy('drive_sync_queued', 'Google Drive sync queued'), 'info')
      window.setTimeout(() => {
        trackQueuedJob(queued, 'Google Drive sync', {
          onComplete: (job) => {
            const summary = job?.result?.summary || {}
            actionHistory?.pushAction?.({
              scope: 'backup',
              entity: 'google_drive_sync',
              label: copy('drive_sync_complete', 'Drive sync complete'),
              undo_payload: summary,
            })
            notify(
              `${copy('drive_sync_complete', 'Drive sync complete')}: ${summary.uploaded || 0} ${copy('uploaded', 'uploaded')}, ${summary.updated || 0} ${copy('updated', 'updated')}, ${summary.skipped || 0} ${copy('skipped', 'skipped')}`,
              'success',
            )
          },
          onError: (error) => {
            notify(`${copy('drive_sync_failed', 'Drive sync failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
          },
        })
      }, 0)
    } catch (error) {
      notify(`${copy('drive_sync_failed', 'Drive sync failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy('')
    }
  }

  const disconnect = async () => {
    if (busy) return
    if (!confirm(copy('drive_sync_disconnect_confirm', 'Disconnect Google Drive sync from this app?'))) return
    setBusy('disconnect')
    try {
      await yieldToBrowser()
      await window.api.disconnectGoogleDriveSync?.()
      setForm((current) => ({ ...current, clientSecret: '' }))
      window.setTimeout(() => load({ force: true }), 0)
      actionHistory?.pushAction?.({
        scope: 'backup',
        entity: 'google_drive_sync',
        label: copy('drive_sync_disconnected', 'Google Drive disconnected'),
      })
      notify(copy('drive_sync_disconnected', 'Google Drive disconnected'), 'success')
    } catch (error) {
      notify(`${copy('failed', 'Failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy('')
    }
  }

  const forgetCredentials = async () => {
    if (busy) return
    if (!confirm(copy('drive_sync_forget_credentials_confirm', 'Forget the saved Google Drive app credentials too? This clears the client ID, client secret, and redirect URI defaults until you enter them again.'))) return
    setBusy('forget')
    try {
      await yieldToBrowser()
      await window.api.forgetGoogleDriveSyncCredentials?.({ confirm: true })
      setForm((current) => ({
        ...current,
        clientId: '',
        clientSecret: '',
      }))
      window.setTimeout(() => load({ force: true }), 0)
      actionHistory?.pushAction?.({
        scope: 'backup',
        entity: 'google_drive_sync',
        label: copy('drive_sync_credentials_forgotten', 'Saved Google Drive app credentials were removed'),
      })
      notify(copy('drive_sync_credentials_forgotten', 'Saved Google Drive app credentials were removed'), 'success')
    } catch (error) {
      notify(`${copy('failed', 'Failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <Cloud className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {copy('drive_sync_title', 'Google Drive Sync')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {copy('drive_sync_desc', 'Mirror the live Business OS data folder into Google Drive on an ongoing background schedule.')}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <SectionChip label={copy('status', 'Status')} value={status?.connected ? copy('connected', 'Connected') : copy('not_connected', 'Not connected')} tone={status?.connected ? 'blue' : 'amber'} />
          <SectionChip label={copy('last_sync', 'Last sync')} value={status?.lastSyncedAt ? formatDateTime(status.lastSyncedAt) : '--'} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="grid gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <span>{copy('drive_sync_client_id', 'OAuth client ID')}</span>
          <input
            id="drive-sync-client-id"
            name="drive_sync_client_id"
            className="input"
            autoComplete="off"
            value={form.clientId}
            onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))}
            placeholder="xxxxxxxx.apps.googleusercontent.com"
          />
        </label>
        <label className="grid gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <span>{copy('drive_sync_client_secret', 'OAuth client secret')}</span>
          <input
            id="drive-sync-client-secret"
            name="drive_sync_client_secret"
            type="password"
            className="input"
            autoComplete="off"
            value={form.clientSecret}
            onChange={(event) => setForm((current) => ({ ...current, clientSecret: event.target.value }))}
            placeholder={status?.hasClientSecret ? copy('drive_sync_secret_saved', 'Leave blank to keep the saved secret') : 'GOCSPX-...'}
          />
        </label>
        <label className="grid gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <span>{copy('drive_sync_folder_name', 'Drive folder name')}</span>
          <input
            id="drive-sync-folder-name"
            name="drive_sync_folder_name"
            className="input"
            autoComplete="off"
            value={form.folderName}
            onChange={(event) => setForm((current) => ({ ...current, folderName: event.target.value }))}
            placeholder="Business OS Sync"
          />
        </label>
        <label className="grid gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <span id="drive-sync-interval-label">{copy('drive_sync_interval', 'Sync every (seconds)')}</span>
          <input
            id="drive-sync-interval"
            name="drive_sync_interval_seconds"
            type="number"
            min="30"
            max="3600"
            className="input"
            autoComplete="off"
            aria-labelledby="drive-sync-interval-label"
            value={form.syncIntervalSeconds}
            onChange={(event) => setForm((current) => ({ ...current, syncIntervalSeconds: event.target.value }))}
          />
        </label>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-zinc-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={!!form.enabled}
            onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span>{copy('drive_sync_enabled', 'Enable background sync')}</span>
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-zinc-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={!!form.deleteMissing}
            onChange={(event) => setForm((current) => ({ ...current, deleteMissing: event.target.checked }))}
          />
          <span>{copy('drive_sync_delete_missing', 'Delete Drive files removed locally')}</span>
        </label>
      </div>

      <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/10 dark:text-blue-100">
        <div className="font-medium">{copy('drive_sync_redirect_uri', 'Redirect URI')}</div>
        <div className="mt-1 break-all font-mono text-xs">{status?.redirectUri || '--'}</div>
        <div className="mt-2 text-xs text-blue-700 dark:text-blue-200">
          {copy('drive_sync_setup_note', 'Add this exact redirect URI to your Google OAuth client, then connect the Drive account that should store the mirrored Business OS data folder.')}
        </div>
        <div className="mt-2 text-xs text-blue-700 dark:text-blue-200">
          {copy('drive_sync_credential_retention_note', 'Disconnect keeps these app credentials in place so reconnecting stays easy. Use Forget app credentials only when you intentionally want to remove them.')}
        </div>
      </div>

      {status?.connected && (status?.connectedEmail || status?.connectedName) ? (
        <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          {copy('drive_sync_connected_as', 'Connected as')} {status.connectedName || status.connectedEmail}
          {status.connectedName && status.connectedEmail ? ` (${status.connectedEmail})` : ''}
        </div>
      ) : null}

      {!status?.connected && (status?.connectedEmail || status?.connectedName) ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100">
          {copy('drive_sync_previous_account', 'Previous Google account')}: {status.connectedName || status.connectedEmail}
          {status.connectedName && status.connectedEmail ? ` (${status.connectedEmail})` : ''}. {copy('drive_sync_reconnect_required', 'Reconnect to resume Drive sync.')}
        </div>
      ) : null}

      {pendingAuthUrl ? (
        <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-100">
          <div className="font-medium">{copy('drive_sync_setup_ready', 'Google Drive setup is ready.')}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={pendingAuthUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              onClick={() => setPendingAuthUrl('')}
            >
              <Link2 className="h-4 w-4" />
              {copy('drive_sync_open_setup', 'Open Google Drive setup')}
            </a>
            <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={() => setPendingAuthUrl('')}>
              {copy('dismiss', 'Dismiss')}
            </button>
          </div>
        </div>
      ) : null}

      {status?.lastError ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {status.lastError}
        </div>
      ) : null}

      <JobProgressCard job={activeJob} copy={copy} onClear={() => setActiveJob(null)} />

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <PrimaryActionButton onClick={savePreferences} disabled={!!busy}>
          {busy === 'save' ? copy('saving', 'Saving...') : copy('save', 'Save')}
        </PrimaryActionButton>
        <PathActionButton onClick={connectGoogleDrive} disabled={!!busy}>
          <Link2 className="h-4 w-4" />
          {busy === 'connect' ? copy('connecting', 'Connecting...') : copy('drive_sync_connect', status?.connected ? 'Reconnect' : 'Connect Google Drive')}
        </PathActionButton>
        <PathActionButton onClick={syncNow} disabled={!!busy || !status?.connected}>
          <RefreshCw className="h-4 w-4" />
          {busy === 'sync' ? copy('syncing', 'Syncing...') : copy('drive_sync_sync_now', 'Sync now')}
        </PathActionButton>
        {status?.connected ? (
          <PathActionButton onClick={disconnect} disabled={!!busy}>
            <Link2Off className="h-4 w-4" />
            {busy === 'disconnect' ? copy('disconnecting', 'Disconnecting...') : copy('disconnect', 'Disconnect')}
          </PathActionButton>
        ) : null}
        <PathActionButton onClick={forgetCredentials} disabled={!!busy}>
          <Link2Off className="h-4 w-4" />
          {busy === 'forget' ? copy('forgetting', 'Forgetting...') : copy('drive_sync_forget_credentials', 'Forget app credentials')}
        </PathActionButton>
      </div>
    </div>
  )
}

function ScaleMigrationSection({ t, notify, active = true }) {
  const copy = useCopy(t)
  const [status, setStatus] = useState(null)
  const [prepared, setPrepared] = useState(null)
  const [busy, setBusy] = useState('')
  const requestRef = useRef(0)

  const loadStatus = useCallback(async () => {
    const requestId = beginTrackedRequest(requestRef)
    try {
      const result = await withLoaderTimeout(() => window.api.getScaleMigrationStatus?.(), 'Scale migration status', 10000)
      if (!isTrackedRequestCurrent(requestRef, requestId)) return
      setStatus(result?.item || null)
    } catch (error) {
      if (!isTrackedRequestCurrent(requestRef, requestId)) return
      notify(`${copy('migration_status_failed', 'Migration status failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    }
  }, [copy, notify])

  useEffect(() => {
    if (!active) {
      invalidateTrackedRequest(requestRef)
      return
    }
    loadStatus()
  }, [active, loadStatus])
  useEffect(() => () => invalidateTrackedRequest(requestRef), [])

  const prepare = async () => {
    if (busy) return
    setBusy('prepare')
    try {
      const result = await withLoaderTimeout(() => window.api.prepareScaleMigration?.(), 'Migration safety automation', 10 * 60 * 1000)
      setPrepared(result?.item || null)
      setStatus(result?.item || status)
      notify(copy('migration_precheck_complete', 'Safety backup complete. No live data was moved.'), 'success')
    } catch (error) {
      notify(`${copy('migration_precheck_failed', 'Migration safety automation failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy('')
    }
  }

  const totalRows = status?.verification?.totalRows ?? prepared?.verification?.totalRows ?? 0
  const queueStatus = status?.scaleServices?.queueStatus || {}
  const queueReady = !!status?.verification?.queueReady || queueStatus.reason === 'ready'
  const canRun = !!status?.canRunMigration && !!prepared
  const automation = prepared?.automation || status?.automation || {}
  const localBackup = automation.localBackup || {}
  const driveSafety = automation.driveSync || {}
  const driveSafetyOk = driveSafety.status === 'ok'
  const driveSafetySkipped = driveSafety.status === 'skipped' || driveSafety.status === 'not_run' || !driveSafety.status
  const activeDatabaseDriver = String(status?.authoritativeData?.databaseDriver || 'postgres').toLowerCase()
  const activeStorageLabel = activeDatabaseDriver === 'postgres'
    ? copy('postgres_object_storage', 'Postgres / object storage')
    : copy('unsupported_storage_mode', 'Unsupported storage mode')

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <DatabaseZap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {copy('scale_migration_title', 'Docker storage safety')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {copy('scale_migration_desc', 'Use this safety workflow before migration, restore, or major maintenance. It creates a local backup first and syncs Google Drive when connected.')}
          </p>
        </div>
        <button type="button" className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" onClick={loadStatus} disabled={!!busy}>
          <RefreshCw className="h-4 w-4" />
          {copy('refresh', 'Refresh')}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
          <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{copy('current_data_source', 'Current data')}</div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{activeStorageLabel}</div>
          <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400" title={status?.authoritativeData?.databasePath || ''}>
            {status?.authoritativeData?.databasePath || copy('loading', 'Loading...')}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
          <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{copy('scale_services', 'Scale services')}</div>
          <div className={`mt-1 flex items-center gap-2 text-sm font-semibold ${queueReady ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
            <CheckCircle2 className="h-4 w-4" />
            {queueReady ? copy('ready', 'Ready') : copy('checking', 'Checking')}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {copy('queue_driver', 'Queue')}: {queueStatus.driver || status?.scaleServices?.queueDriver || 'bullmq'}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
          <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{copy('migration_readiness', 'Migration readiness')}</div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            {Number(totalRows).toLocaleString()} {copy('rows', 'rows')}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {status?.canRunMigration ? copy('ready_after_precheck', 'Ready after precheck') : copy('locked_for_safety', 'Locked for safety')}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
          <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{copy('local_safety_backup', 'Local safety backup')}</div>
          <div className={`mt-1 text-sm font-semibold ${localBackup.exists ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {localBackup.exists ? copy('ready', 'Ready') : copy('not_created_yet', 'Not created yet')}
          </div>
          <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400" title={localBackup.backupRoot || ''}>
            {localBackup.createdAt ? formatDateTime(localBackup.createdAt) : copy('run_safety_first', 'Run safety first')}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
          <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{copy('drive_safety_sync', 'Drive safety sync')}</div>
          <div className={`mt-1 text-sm font-semibold ${driveSafetyOk ? 'text-emerald-700 dark:text-emerald-300' : driveSafetySkipped ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}`}>
            {driveSafetyOk ? copy('synced', 'Synced') : driveSafetySkipped ? copy('optional', 'Optional') : copy('needs_attention', 'Needs attention')}
          </div>
          <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400" title={driveSafety.error || ''}>
            {driveSafety.attemptedAt ? formatDateTime(driveSafety.attemptedAt) : copy('connect_drive_to_sync', 'Connect Drive to sync')}
          </div>
        </div>
      </div>

      {status?.blockedReason ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
          {status.blockedReason}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <PrimaryActionButton onClick={prepare} disabled={!!busy}>
          <DatabaseZap className="h-4 w-4" />
          {busy === 'prepare' ? copy('checking', 'Checking...') : copy('prepare_migration_check', 'Run safety backup')}
        </PrimaryActionButton>
        <PathActionButton disabled={!canRun || !!busy} title={!canRun ? copy('migration_run_disabled', 'Run migration unlocks only after a passing verified migration precheck and enabled migration runner.') : undefined}>
          <Upload className="h-4 w-4" />
          {copy('run_verified_migration', 'Run verified migration')}
        </PathActionButton>
      </div>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        {copy('migration_no_auto_move', 'Safety is automated: local backup first, Google Drive sync when connected, then verification. Live storage is not switched until the verified migration runner is available.')}
      </p>
    </div>
  )
}

export default function Backup() {
  const { t, notify, hasPermission } = useApp()
  const copy = useCopy(t)
  const isActive = useIsPageActive('backup')
  const actionHistory = useActionHistory({ limit: 3, notify, scope: 'backup' })
  const [loading, setLoading] = useState('')
  const [folderExportPath, setFolderExportPath] = useState('')
  const [folderImportPath, setFolderImportPath] = useState('')
  const [activeJob, setActiveJob] = useState(null)
  const [advancedMaintenanceOpen, setAdvancedMaintenanceOpen] = useState(false)
  const aliveRef = useRef(true)
  const jobStopRef = useRef(null)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      jobStopRef.current?.()
    }
  }, [])

  const handleFolderExport = async () => {
    if (loading) return
    if (!hasPermission('backup')) return notify(copy('no_permission', 'No permission'), 'error')
    const exportDestination = String(folderExportPath || '').trim()
    setLoading('folder-export')
    try {
      await yieldToBrowser()
      const queued = await window.api.queueBackupFolderExport?.(exportDestination)
      const jobId = queued?.job_id || queued?.item?.id
      if (jobId) setActiveJob(queued.item || { id: jobId, status: 'queued', progress: 0, message: copy('backup_export_queued', 'Backup export queued') })
      if (jobId) {
        notify(copy('backup_export_queued', 'Backup export queued'), 'info')
        jobStopRef.current?.()
        window.setTimeout(() => {
          jobStopRef.current = startJobWatcher(jobId, {
            reason: 'backup export',
            pollMs: 1000,
            onUpdate: (job) => {
              if (aliveRef.current && job) setActiveJob(job)
            },
            onComplete: (job) => {
              if (!aliveRef.current) return
              if (job) setActiveJob(job)
              const result = job?.result || {}
              actionHistory.pushAction({
                scope: 'backup',
                entity: 'backup',
                label: copy('export_backup_success', 'Backup exported successfully'),
                redo_payload: { packageId: result.packageId || '', objectPrefix: result.objectPrefix || '', destinationDir: exportDestination || 'default' },
              })
              notify(copy('export_backup_success', 'Backup exported successfully'), 'success')
              if (job?.result?.localPath) setFolderImportPath(job.result.localPath)
              setLoading('')
            },
            onError: (error, job) => {
              if (job && aliveRef.current) setActiveJob(job)
              if (aliveRef.current) notify(`${copy('export_failed', 'Export failed')}: ${error.message}`, 'error')
              if (aliveRef.current) setLoading('')
            },
          })
        }, 0)
        return
      }
      throw new Error(copy('backup_job_not_queued', 'Backup job could not be queued. Run Doctor or restart Business OS.'))
    } catch (error) {
      notify(`${copy('export_failed', 'Export failed')}: ${error.message}`, 'error')
    } finally {
      if (aliveRef.current) setLoading((current) => (current === 'folder-export' ? '' : current))
    }
  }

  const handleFolderImport = async () => {
    if (loading) return
    if (!hasPermission('backup')) return notify(copy('no_permission', 'No permission'), 'error')
    if (!folderImportPath) return notify(copy('choose_folder_first', 'Choose a folder first'), 'error')
    if (!confirm(`${copy('import_backup_warning', 'This validates a backup package before any restore can replace live data.')}\n\n${copy('import_backup_confirm', 'Continue?')}`)) return

    setLoading('folder-import')
    try {
      await yieldToBrowser()
      const queued = await window.api.queueBackupFolderRestore?.(folderImportPath)
      const jobId = queued?.job_id || queued?.item?.id
      if (jobId) setActiveJob(queued.item || { id: jobId, status: 'queued', progress: 0, message: copy('backup_restore_queued', 'Backup restore queued') })
      if (jobId) {
        notify(copy('backup_restore_queued', 'Backup restore queued'), 'info')
        jobStopRef.current?.()
        window.setTimeout(() => {
          jobStopRef.current = startJobWatcher(jobId, {
            reason: 'backup restore',
            pollMs: 1000,
            onUpdate: (job) => {
              if (aliveRef.current && job) setActiveJob(job)
            },
            onComplete: (job) => {
              if (!aliveRef.current) return
              if (job) setActiveJob(job)
              const result = job?.result || {}
              actionHistory.pushAction({
                scope: 'backup',
                entity: 'backup',
                label: copy('backup_restore_validated', 'Backup restore validated'),
                undo_payload: { sourceDir: folderImportPath, manifest: result.manifest || null },
              })
              notify(copy('backup_restore_validated', 'Backup restore validated'), 'success')
              setLoading('')
            },
            onError: (error, job) => {
              if (job && aliveRef.current) setActiveJob(job)
              if (aliveRef.current) notify(`${copy('import_failed', 'Import failed')}: ${error.message}`, 'error')
              if (aliveRef.current) setLoading('')
            },
          })
        }, 0)
        return
      }
      throw new Error(copy('backup_restore_job_not_queued', 'Restore job could not be queued. Run Doctor or restart Business OS.'))
    } catch (error) {
      notify(`${copy('import_failed', 'Import failed')}: ${error.message}`, 'error')
    } finally {
      if (aliveRef.current) setLoading((current) => (current === 'folder-import' ? '' : current))
    }
  }

  return (
    <div className="page-scroll p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader
          icon={HardDriveDownload}
          tone="blue"
          title={copy('backup', 'Backup')}
          subtitle={copy('export_backup_desc', 'Create a full Docker backup package with Postgres data, R2 or offline object assets, settings, users, portal files, and restore metadata.')}
        />
        <ActionHistoryBar history={actionHistory} className="mb-3" />
        <JobProgressCard job={activeJob} copy={copy} onClear={() => setActiveJob(null)} />
        <div className="card p-5 sm:p-6">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <FolderOutput className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {copy('export_backup_title', 'Export backup')}
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {copy('export_backup_desc', 'Create a full Docker backup package with Postgres data, R2 or offline object assets, settings, users, portal files, and restore metadata.')}
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK_BACKUP_SECTIONS.map((section) => (
              <span key={section} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-300">
                {section}
              </span>
            ))}
          </div>

          <div className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/40 dark:bg-blue-900/10">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <PrimaryActionButton onClick={handleFolderExport} disabled={!!loading}>
                <ArchiveRestore className="h-4 w-4" />
                {loading === 'folder-export' ? copy('exporting', 'Exporting...') : copy('export_backup_btn', 'Export')}
              </PrimaryActionButton>
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {folderExportPath
                ? copy('backup_custom_path_note', 'Export will use the advanced server path below.')
                : copy('backup_default_path_note', 'Export uses the safe Docker backup folder automatically. No folder choice is needed.')}
            </p>

            <details className="rounded-xl border border-blue-100 bg-white/60 p-3 text-sm dark:border-blue-900/50 dark:bg-zinc-900/40">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                {copy('advanced', 'Advanced')}
              </summary>
              <div className="mt-3 grid gap-3">
                <div className="flex flex-col gap-2 lg:flex-row">
                  <input
                    id="backup-folder-export-path"
                    name="backup_folder_export_path"
                    className="input flex-1 font-mono text-sm"
                    value={folderExportPath}
                    onChange={(event) => setFolderExportPath(event.target.value)}
                    placeholder={copy('folder_backup_placeholder', 'Optional server folder for full backups')}
                  />
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  {copy('server_folder_note', 'Folder actions use paths on the Business OS server/container. Type a path that exists on the server machine, not your phone or browser device.')}
                </p>
              </div>
            </details>
          </div>
        </div>

        <div className="card p-5 sm:p-6">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <FolderInput className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {copy('import_backup_title', 'Restore backup')}
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {copy('import_backup_desc', 'Restore a full Business OS backup folder from the server. This replaces current data, uploads, settings, users, portal files, stock, and custom tables.')}
          </p>

          <div className="grid gap-3 rounded-2xl border border-amber-100 bg-amber-50/70 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <PrimaryActionButton onClick={handleFolderImport} disabled={!!loading}>
                <Upload className="h-4 w-4" />
                {loading === 'folder-import' ? copy('importing_backup', 'Importing...') : copy('restore_backup_btn', 'Restore')}
              </PrimaryActionButton>
            </div>

            <p className="text-xs text-amber-700 dark:text-amber-300">
              {copy('folder_restore_note', 'Folder restore replaces current data with the selected backup contents.')}
            </p>

            <details className="rounded-xl border border-amber-100 bg-white/60 p-3 text-sm dark:border-amber-900/50 dark:bg-zinc-900/40">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                {copy('advanced', 'Advanced')}
              </summary>
              <div className="mt-3 grid gap-3">
                <div className="flex flex-col gap-2 lg:flex-row">
                  <input
                    id="backup-folder-import-path"
                    name="backup_folder_import_path"
                    className="input flex-1 font-mono text-sm"
                    value={folderImportPath}
                    onChange={(event) => setFolderImportPath(event.target.value)}
                    placeholder={copy('folder_restore_placeholder', 'Choose a full backup folder path')}
                  />
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {copy('server_restore_note', 'Restore uses a final backup folder from the Business OS server/container. Type a server path or restore from a Google Drive datasync version.')}
                </p>
              </div>
            </details>
          </div>

        </div>

        {isActive ? <GoogleDriveSyncSection t={t} notify={notify} active={isActive} actionHistory={actionHistory} /> : null}
        <details
          className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          onToggle={(event) => setAdvancedMaintenanceOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-sm font-semibold text-gray-800 dark:text-gray-100">
            {copy('advanced_maintenance', 'Advanced maintenance and reset tools')}
          </summary>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {copy('advanced_maintenance_desc', 'These tools are loaded only when opened so backup, restore, and Drive actions stay responsive.')}
          </p>
          {advancedMaintenanceOpen ? (
            <div className="mt-4 space-y-4">
              <ResetData actionHistory={actionHistory} />
              <FactoryReset actionHistory={actionHistory} />
            </div>
          ) : null}
        </details>
      </div>
    </div>
  )
}
