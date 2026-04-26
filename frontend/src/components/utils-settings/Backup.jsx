import { useEffect, useMemo, useRef, useState } from 'react'
import { ArchiveRestore, Cloud, Download, FileArchive, FolderInput, FolderOutput, HardDriveDownload, Link2, Link2Off, RefreshCw, Upload } from 'lucide-react'
import { useApp } from '../../AppContext'
import { ResetData, FactoryReset } from './ResetData'
import { cacheClearAll } from '../../api/http'
import { refreshAppData } from '../../utils/appRefresh'

const BACKUP_SECTION_CONFIG = [
  { key: 'products', label: 'Products' },
  { key: 'sales', label: 'Sales' },
  { key: 'returns', label: 'Returns' },
  { key: 'customers', label: 'Customers' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'delivery_contacts', label: 'Delivery' },
  { key: 'users', label: 'Users' },
  { key: 'roles', label: 'Roles' },
  { key: 'settings', label: 'Settings' },
  { key: 'customer_share_submissions', label: 'Portal submissions' },
  { key: 'audit_logs', label: 'Audit log' },
  { key: 'file_assets', label: 'Files library' },
]

const QUICK_BACKUP_SECTIONS = [
  'Products + inventory',
  'Sales + returns',
  'Contacts + users',
  'Portal + files',
]

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

function useCopy(t) {
  return (key, fallback) => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
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

function countBackupRows(backup, tableName) {
  if (backup?.summary?.tables && Number.isFinite(Number(backup.summary.tables[tableName]))) {
    return Number(backup.summary.tables[tableName]) || 0
  }
  if (backup?.tables && typeof backup.tables === 'object') {
    return Array.isArray(backup.tables[tableName]) ? backup.tables[tableName].length : 0
  }
  return Array.isArray(backup?.[tableName]) ? backup[tableName].length : 0
}

function buildBackupPreview(backup, fileName) {
  const counts = Object.fromEntries(
    BACKUP_SECTION_CONFIG.map((section) => [section.key, countBackupRows(backup, section.key)]),
  )
  const uploadsCount = Number(backup?.summary?.totals?.uploadCount)
    || (Array.isArray(backup?.uploads) ? backup.uploads.length : 0)
  const totalRows = Number(backup?.summary?.totals?.tableRowCount)
    || Object.values(counts).reduce((sum, value) => sum + value, 0)
  const customTableCount = Number(backup?.summary?.totals?.customTableCount)
    || (backup?.custom_table_rows && typeof backup.custom_table_rows === 'object' ? Object.keys(backup.custom_table_rows).length : 0)
  const customTableRowCount = Number(backup?.summary?.totals?.customTableRowCount)
    || Object.values(backup?.custom_table_rows || {}).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0)
  const populatedSections = BACKUP_SECTION_CONFIG
    .filter((section) => counts[section.key] > 0)
    .map((section) => ({ ...section, count: counts[section.key] }))

  const warnings = []
  if (!countBackupRows(backup, 'file_assets') && uploadsCount > 0) {
    warnings.push('This backup has uploads but no file-library metadata. Restore still works, but Files entries may need to be rebuilt.')
  }
  if (Number(backup?.version || 0) > 0 && Number(backup.version) < 10) {
    warnings.push('This is an older backup format. Business data should restore, but newer file coverage is more limited.')
  }

  return {
    fileName,
    version: Number(backup?.version || 0) || null,
    exportedAt: backup?.exported_at || '',
    uploadsCount,
    totalRows,
    customTableCount,
    customTableRowCount,
    populatedSections,
    warnings,
    counts,
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

function DataFolderLocation({ t, notify }) {
  const copy = useCopy(t)
  const [info, setInfo] = useState(null)
  const [systemConfig, setSystemConfig] = useState(null)
  const [inputPath, setInputPath] = useState('')
  const [browseState, setBrowseState] = useState(null)
  const [showAdvancedBrowser, setShowAdvancedBrowser] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const load = async () => {
    try {
      const [result, config] = await Promise.all([
        window.api.getDataPath(),
        window.api.getSystemConfig?.().catch(() => null),
      ])
      setInfo(result)
      setSystemConfig(config)
      setInputPath(result?.dataRootParent || result?.dataRoot || '')
    } catch (error) {
      notify(`${copy('data_folder_load_failed', 'Failed to load data folder information')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const folderName = info?.dataFolderName || 'business-os-data'
  const currentSummary = info?.summary || {}
  const hostUiAvailable = !!systemConfig?.hostUiAvailable
  const previewPath = useMemo(
    () => buildFinalDataFolderPath(inputPath, folderName),
    [folderName, inputPath],
  )

  const openBrowser = async (dir) => {
    try {
      setBusy(true)
      const result = await window.api.browseDir(dir || inputPath || info?.dataRootParent || info?.dataRoot || '')
      if (result) setBrowseState(result)
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
    if (!hostUiAvailable) {
      notify(copy('host_ui_local_only', 'This action only works on the server machine. Use Browse folders or type a server path manually when connected remotely.'), 'info')
      setShowAdvancedBrowser(true)
      await openDriveBrowser()
      return
    }
    try {
      setBusy(true)
      const selectedFolder = await window.api.openFolderDialog?.(inputPath || info?.dataRootParent || info?.dataRoot || '')
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
    if (next && !browseState) {
      await openDriveBrowser()
    }
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
    const target = String(previewPath || '').trim()
    if (!target) return notify(copy('data_folder_path_required', 'Please enter a folder path'), 'error')
    if (!confirm(`${copy('data_folder_change_prompt', 'Copy current live Business OS data to')}:\n\n${target}\n\n${copy('data_folder_copy_safe', 'The current folder stays untouched as a safety copy. The server must be restarted after this change.')}\n\n${copy('proceed', 'Proceed?')}`)) return

    try {
      setBusy(true)
      const result = await window.api.setDataPath(target)
      if (result?.success) {
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
    if (!confirm(`${copy('data_folder_reset_prompt', 'Copy current live data back to the default business-os-data folder?')}\n\n${copy('data_folder_copy_safe', 'The current folder stays untouched as a safety copy. The server must be restarted after this change.')}`)) return
    try {
      setBusy(true)
      const result = await window.api.resetDataPath()
      if (result?.success === false) {
        notify(result.error || copy('unknown_error', 'Unknown error'), 'error')
        return
      }
      notify(copy('data_folder_reset_done', 'Reverted to default folder. Restart the server to apply.'))
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
        <SectionChip label={copy('new_location_preview', 'Next live folder')} value={previewPath || '--'} tone="amber" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SectionChip label={copy('location_mode', 'Location mode')} value={info?.hasOverride ? copy('custom_path', 'Custom path') : copy('portable_default', 'Portable default')} />
        <SectionChip label={copy('database_size', 'Database size')} value={formatBytes(currentSummary.dbSizeBytes)} />
        <SectionChip label={copy('uploads', 'Uploads')} value={currentSummary.uploadCount ?? 0} />
        <SectionChip label={copy('files_total', 'Files on disk')} value={currentSummary.totalFileCount ?? 0} />
      </div>

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
        <PathActionButton onClick={openInlinePicker} disabled={busy}>
          <FolderOutput className="h-4 w-4" />
          {showAdvancedBrowser ? copy('hide_advanced_browser', 'Hide') : copy('browse', 'Browse')}
        </PathActionButton>
        <PathActionButton onClick={pickFolderNatively} disabled={busy}>
          <FolderOutput className="h-4 w-4" />
          {copy('browse_folder', 'Choose Folder')}
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
          <button className="btn-secondary w-full text-xs sm:w-auto" onClick={() => openBrowser(inputPath || info?.dataRootParent || info?.dataRoot)} disabled={busy}>
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

function GoogleDriveSyncSection({ t, notify }) {
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

  const load = async () => {
    try {
      const result = await window.api.getGoogleDriveSyncStatus?.()
      const item = result?.item || result || null
      setStatus(item)
      setForm((current) => ({
        clientId: current.clientId || item?.clientId || '',
        clientSecret: current.clientSecret || '',
        folderName: item?.folderName || current.folderName || 'Business OS Sync',
        deleteMissing: !!item?.deleteMissing,
        enabled: item?.enabled !== false,
        syncIntervalSeconds: Number(item?.syncIntervalSeconds || current.syncIntervalSeconds || 120),
      }))
    } catch (error) {
      notify(`${copy('failed', 'Failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (event) => {
      if (event?.data?.type !== 'business-os-drive-sync') return
      if (event.data.status === 'connected') {
        notify(copy('drive_sync_connected', 'Google Drive connected'), 'success')
        setForm((current) => ({ ...current, clientSecret: '' }))
        load()
        return
      }
      if (event.data.status === 'error') {
        notify(event.data.message || copy('drive_sync_connect_failed', 'Google Drive connection failed'), 'error')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const savePreferences = async () => {
    setBusy('save')
    try {
      const result = await window.api.saveGoogleDriveSyncPreferences?.({
        folderName: form.folderName,
        deleteMissing: form.deleteMissing,
        enabled: form.enabled,
        syncIntervalSeconds: form.syncIntervalSeconds,
      })
      setStatus(result?.item || status)
      notify(copy('saved', 'Saved'), 'success')
      await load()
    } catch (error) {
      notify(`${copy('save_failed', 'Save failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy('')
    }
  }

  const connectGoogleDrive = async () => {
    if (!String(form.clientId || '').trim() && !status?.clientId) {
      notify(copy('drive_sync_client_required', 'Google OAuth client ID is required'), 'error')
      return
    }
    if (!String(form.clientSecret || '').trim() && !status?.hasClientSecret) {
      notify(copy('drive_sync_secret_required', 'Google OAuth client secret is required'), 'error')
      return
    }

    setBusy('connect')
    try {
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
      const popup = window.open(authUrl, 'business-os-drive-sync', 'width=640,height=760')
      if (!popup) window.location.assign(authUrl)
      notify(copy('drive_sync_connect_started', 'Complete Google Drive access in the new tab.'), 'info')
    } catch (error) {
      notify(`${copy('drive_sync_connect_failed', 'Google Drive connection failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy('')
    }
  }

  const syncNow = async () => {
    setBusy('sync')
    try {
      const result = await window.api.syncGoogleDriveNow?.()
      const summary = result?.summary || {}
      await load()
      notify(
        `${copy('drive_sync_complete', 'Drive sync complete')}: ${summary.uploaded || 0} ${copy('uploaded', 'uploaded')}, ${summary.updated || 0} ${copy('updated', 'updated')}, ${summary.skipped || 0} ${copy('skipped', 'skipped')}`,
        'success',
      )
    } catch (error) {
      notify(`${copy('drive_sync_failed', 'Drive sync failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBusy('')
    }
  }

  const disconnect = async () => {
    if (!confirm(copy('drive_sync_disconnect_confirm', 'Disconnect Google Drive sync from this app?'))) return
    setBusy('disconnect')
    try {
      await window.api.disconnectGoogleDriveSync?.()
      setForm((current) => ({ ...current, clientSecret: '' }))
      await load()
      notify(copy('drive_sync_disconnected', 'Google Drive disconnected'), 'success')
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
            className="input"
            value={form.clientId}
            onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))}
            placeholder="xxxxxxxx.apps.googleusercontent.com"
          />
        </label>
        <label className="grid gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <span>{copy('drive_sync_client_secret', 'OAuth client secret')}</span>
          <input
            type="password"
            className="input"
            value={form.clientSecret}
            onChange={(event) => setForm((current) => ({ ...current, clientSecret: event.target.value }))}
            placeholder={status?.hasClientSecret ? copy('drive_sync_secret_saved', 'Leave blank to keep the saved secret') : 'GOCSPX-...'}
          />
        </label>
        <label className="grid gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <span>{copy('drive_sync_folder_name', 'Drive folder name')}</span>
          <input
            className="input"
            value={form.folderName}
            onChange={(event) => setForm((current) => ({ ...current, folderName: event.target.value }))}
            placeholder="Business OS Sync"
          />
        </label>
        <label className="grid gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <span>{copy('drive_sync_interval', 'Sync every (seconds)')}</span>
          <input
            type="number"
            min="30"
            max="3600"
            className="input"
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
      </div>

      {status?.connectedEmail || status?.connectedName ? (
        <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          {copy('drive_sync_connected_as', 'Connected as')} {status.connectedName || status.connectedEmail}
          {status.connectedName && status.connectedEmail ? ` (${status.connectedEmail})` : ''}
        </div>
      ) : null}

      {status?.lastError ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {status.lastError}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <PrimaryActionButton onClick={savePreferences} disabled={busy === 'save'}>
          {busy === 'save' ? copy('saving', 'Saving...') : copy('save', 'Save')}
        </PrimaryActionButton>
        <PathActionButton onClick={connectGoogleDrive} disabled={busy === 'connect'}>
          <Link2 className="h-4 w-4" />
          {busy === 'connect' ? copy('connecting', 'Connecting...') : copy('drive_sync_connect', status?.connected ? 'Reconnect' : 'Connect Google Drive')}
        </PathActionButton>
        <PathActionButton onClick={syncNow} disabled={busy === 'sync' || !status?.connected}>
          <RefreshCw className="h-4 w-4" />
          {busy === 'sync' ? copy('syncing', 'Syncing...') : copy('drive_sync_sync_now', 'Sync now')}
        </PathActionButton>
        {status?.connected ? (
          <PathActionButton onClick={disconnect} disabled={busy === 'disconnect'}>
            <Link2Off className="h-4 w-4" />
            {busy === 'disconnect' ? copy('disconnecting', 'Disconnecting...') : copy('disconnect', 'Disconnect')}
          </PathActionButton>
        ) : null}
      </div>
    </div>
  )
}

export default function Backup() {
  const { t, notify, hasPermission } = useApp()
  const copy = useCopy(t)
  const [loading, setLoading] = useState('')
  const [pendingImport, setPendingImport] = useState(null)
  const [folderExportPath, setFolderExportPath] = useState('')
  const [folderImportPath, setFolderImportPath] = useState('')
  const [hostUiAvailable, setHostUiAvailable] = useState(false)
  const [exportBrowser, setExportBrowser] = useState(null)
  const [restoreBrowser, setRestoreBrowser] = useState(null)
  const [browserBusy, setBrowserBusy] = useState('')

  useEffect(() => {
    let cancelled = false
    window.api.getSystemConfig?.()
      .then((config) => {
        if (!cancelled) setHostUiAvailable(!!config?.hostUiAvailable)
      })
      .catch(() => {
        if (!cancelled) setHostUiAvailable(false)
      })
    return () => { cancelled = true }
  }, [])

  const browseServerFolders = async (target, dir) => {
    try {
      setBrowserBusy(target)
      const result = await window.api.browseDir(dir || '__ROOTS__')
      if (target === 'export') setExportBrowser(result)
      if (target === 'restore') setRestoreBrowser(result)
    } catch (error) {
      notify(`${copy('failed', 'Failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      setBrowserBusy('')
    }
  }

  const toggleServerBrowser = async (target, currentPath = '') => {
    const isExport = target === 'export'
    const visible = isExport ? !!exportBrowser : !!restoreBrowser
    if (visible) {
      if (isExport) setExportBrowser(null)
      else setRestoreBrowser(null)
      return
    }
    await browseServerFolders(target, currentPath || '__ROOTS__')
  }

  const handleExport = async () => {
    if (!hasPermission('backup')) return notify(copy('no_permission', 'No permission'), 'error')
    setLoading('export')
    try {
      const result = await window.api.exportBackup()
      if (result?.success) notify(copy('export_backup_success', 'Backup exported successfully'), 'success')
      else notify(copy('export_failed', 'Export failed'), 'error')
    } catch (error) {
      notify(`${copy('export_failed', 'Export failed')}: ${error.message}`, 'error')
    }
    setLoading('')
  }

  const pickFolder = async (setter, hintPath = '') => {
    if (!hostUiAvailable) {
      notify(copy('host_ui_local_only', 'This action only works on the server machine. Use Browse folders or type a server path manually when connected remotely.'), 'info')
      return
    }
    try {
      const folder = await window.api.openFolderDialog?.(hintPath)
      if (folder && typeof folder === 'string') setter(folder)
    } catch (error) {
      notify(`${copy('failed', 'Failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    }
  }

  const handleFolderExport = async () => {
    if (!hasPermission('backup')) return notify(copy('no_permission', 'No permission'), 'error')
    if (!folderExportPath) return notify(copy('choose_folder_first', 'Choose a folder first'), 'error')
    setLoading('folder-export')
    try {
      const result = await window.api.exportBackupFolder(folderExportPath)
      if (result?.success) {
        notify(copy('export_backup_success', 'Backup exported successfully'), 'success')
        if (result.backupRoot) setFolderImportPath(result.backupRoot)
      } else {
        notify(result?.error || copy('export_failed', 'Export failed'), 'error')
      }
    } catch (error) {
      notify(`${copy('export_failed', 'Export failed')}: ${error.message}`, 'error')
    }
    setLoading('')
  }

  const handleFolderImport = async () => {
    if (!hasPermission('backup')) return notify(copy('no_permission', 'No permission'), 'error')
    if (!folderImportPath) return notify(copy('choose_folder_first', 'Choose a folder first'), 'error')
    if (!confirm(`${copy('import_backup_warning', 'This overwrites existing data. Export a fresh backup first if you want to keep current data.')}\n\n${copy('import_backup_confirm', 'Continue?')}`)) return

    setLoading('folder-import')
    try {
      const result = await window.api.importBackupFolder(folderImportPath)
      if (result?.success) {
        cacheClearAll()
        notify(copy('import_backup_success', 'Backup imported successfully'), 'success')
        setTimeout(() => refreshAppData(), 200)
      } else {
        notify(result?.error || copy('import_failed', 'Import failed'), 'error')
      }
    } catch (error) {
      notify(`${copy('import_failed', 'Import failed')}: ${error.message}`, 'error')
    }
    setLoading('')
  }

  const handleChooseImportFile = async () => {
    if (!hasPermission('backup')) return notify(copy('no_permission', 'No permission'), 'error')
    try {
      const file = await window.api.pickBackupFile?.()
      if (!file) return
      const parsed = JSON.parse(await file.text())
      setPendingImport({
        data: parsed,
        preview: buildBackupPreview(parsed, file.name || 'business-os-backup.json'),
      })
      notify(copy('backup_file_ready', 'Backup file loaded. Review it, then confirm restore.'), 'success')
    } catch (error) {
      notify(`${copy('import_failed', 'Import failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    }
  }

  const handleConfirmImport = async () => {
    if (!hasPermission('backup')) return notify(copy('no_permission', 'No permission'), 'error')
    if (!pendingImport?.data) return
    if (!confirm(`${copy('import_backup_warning', 'This overwrites existing data. Export a fresh backup first if you want to keep current data.')}\n\n${copy('import_backup_confirm', 'Continue?')}`)) return

    setLoading('import')
    try {
      const result = await window.api.importBackupData(pendingImport.data)
      if (result?.success) {
        cacheClearAll()
        setPendingImport(null)
        notify(copy('import_backup_success', 'Backup imported successfully'), 'success')
        setTimeout(() => refreshAppData(), 200)
      } else {
        notify(`${copy('import_failed', 'Import failed')}: ${result?.error || copy('unknown_error', 'Unknown error')}`, 'error')
      }
    } catch (error) {
      notify(`${copy('import_failed', 'Import failed')}: ${error.message}`, 'error')
    }
    setLoading('')
  }

  return (
    <div className="page-scroll p-4 sm:p-6">
      <h1 className="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
        <HardDriveDownload className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        {copy('backup', 'Backup')}
      </h1>
      <div className="max-w-4xl space-y-4">
        <div className="card p-5 sm:p-6">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <FolderOutput className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {copy('export_backup_title', 'Export backup')}
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {copy('export_backup_desc', 'Export a full folder backup, or download the legacy JSON version when needed.')}
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK_BACKUP_SECTIONS.map((section) => (
              <span key={section} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-300">
                {section}
              </span>
            ))}
          </div>

          <div className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/40 dark:bg-blue-900/10">
            <div className="flex flex-col gap-2 lg:flex-row">
              <input
                id="backup-folder-export-path"
                name="backup_folder_export_path"
                className="input flex-1 font-mono text-sm"
                value={folderExportPath}
                onChange={(event) => setFolderExportPath(event.target.value)}
                placeholder={copy('folder_backup_placeholder', 'Choose a parent folder for the backup copy')}
              />
              <PathActionButton onClick={() => toggleServerBrowser('export', folderExportPath)} disabled={browserBusy === 'export'}>
                <FolderOutput className="h-4 w-4" />
                {exportBrowser ? copy('hide_advanced_browser', 'Hide') : copy('browse', 'Browse')}
              </PathActionButton>
              {hostUiAvailable ? (
                <PathActionButton onClick={() => pickFolder(setFolderExportPath, folderExportPath)}>
                  <FolderOutput className="h-4 w-4" />
                  {copy('browse_folder', 'Choose Folder')}
                </PathActionButton>
              ) : null}
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {copy('server_folder_note', 'Folder actions use paths on the Business OS server device. When you are connected remotely, choose or paste a path that exists on that server machine.')}
            </p>

            {exportBrowser ? (
              <FolderBrowserPanel
                browseState={exportBrowser}
                busy={browserBusy === 'export'}
                copy={copy}
                onBrowse={(dir) => browseServerFolders('export', dir)}
                onBrowseDrives={() => browseServerFolders('export', '__ROOTS__')}
                onClose={() => setExportBrowser(null)}
                onSelect={(fullPath) => {
                  setFolderExportPath(fullPath)
                  setExportBrowser(null)
                }}
                currentPathLabel={copy('use_this_folder_directly', 'Use this folder as the parent location')}
              />
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <PrimaryActionButton onClick={handleFolderExport} disabled={loading === 'folder-export'}>
                <ArchiveRestore className="h-4 w-4" />
                {loading === 'folder-export' ? copy('exporting', 'Exporting...') : copy('export_backup_btn', 'Export')}
              </PrimaryActionButton>
              <PathActionButton onClick={handleExport} disabled={loading === 'export'}>
                <Download className="h-4 w-4" />
                {loading === 'export' ? copy('exporting', 'Exporting...') : copy('download_json_backup', 'JSON')}
              </PathActionButton>
            </div>
          </div>
        </div>

        <div className="card p-5 sm:p-6">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <FolderInput className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {copy('import_backup_title', 'Restore backup')}
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {copy('import_backup_desc', 'Restore a full folder backup, or choose a legacy JSON backup file if needed.')}
          </p>

          <div className="grid gap-3 rounded-2xl border border-amber-100 bg-amber-50/70 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
            <div className="flex flex-col gap-2 lg:flex-row">
              <input
                id="backup-folder-import-path"
                name="backup_folder_import_path"
                className="input flex-1 font-mono text-sm"
                value={folderImportPath}
                onChange={(event) => setFolderImportPath(event.target.value)}
                placeholder={copy('folder_restore_placeholder', 'Choose a backup folder or business-os-data folder')}
              />
              <PathActionButton onClick={() => toggleServerBrowser('restore', folderImportPath)} disabled={browserBusy === 'restore'}>
                <FolderInput className="h-4 w-4" />
                {restoreBrowser ? copy('hide_advanced_browser', 'Hide') : copy('browse', 'Browse')}
              </PathActionButton>
              {hostUiAvailable ? (
                <PathActionButton onClick={() => pickFolder(setFolderImportPath, folderImportPath)}>
                  <FolderInput className="h-4 w-4" />
                  {copy('browse_folder', 'Choose Folder')}
                </PathActionButton>
              ) : null}
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {copy('server_restore_note', 'Restore uses a folder from the Business OS server device. Remote browsers cannot browse their own local disk into the server runtime.')}
            </p>

            {restoreBrowser ? (
              <FolderBrowserPanel
                browseState={restoreBrowser}
                busy={browserBusy === 'restore'}
                copy={copy}
                onBrowse={(dir) => browseServerFolders('restore', dir)}
                onBrowseDrives={() => browseServerFolders('restore', '__ROOTS__')}
                onClose={() => setRestoreBrowser(null)}
                onSelect={(fullPath) => {
                  setFolderImportPath(fullPath)
                  setRestoreBrowser(null)
                }}
                currentPathLabel={copy('use_this_folder_directly', 'Use this folder as the parent location')}
              />
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <PrimaryActionButton onClick={handleFolderImport} disabled={loading === 'folder-import'}>
                <Upload className="h-4 w-4" />
                {loading === 'folder-import' ? copy('importing_backup', 'Importing...') : copy('restore_backup_btn', 'Restore')}
              </PrimaryActionButton>
              <PathActionButton onClick={handleChooseImportFile} disabled={loading === 'import'}>
                <FileArchive className="h-4 w-4" />
                {copy('legacy_json_backup', 'Legacy JSON')}
              </PathActionButton>
              {pendingImport ? (
                <PathActionButton onClick={handleConfirmImport} disabled={loading === 'import'}>
                  <Upload className="h-4 w-4" />
                  {loading === 'import' ? copy('importing_backup', 'Importing...') : copy('import_backup_btn', 'Import JSON')}
                </PathActionButton>
              ) : null}
            </div>

            <p className="text-xs text-amber-700 dark:text-amber-300">
              {copy('folder_restore_note', 'Folder restore replaces current data with the selected backup contents.')}
            </p>
          </div>

          {pendingImport ? (
            <div className="mt-4 rounded-2xl border border-gray-200 p-4 dark:border-zinc-700">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{pendingImport.preview.fileName}</div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Exported {formatDateTime(pendingImport.preview.exportedAt)}{pendingImport.preview.version ? ` | v${pendingImport.preview.version}` : ''}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[360px]">
                  <SectionChip label="Rows" value={pendingImport.preview.totalRows} />
                  <SectionChip label="Uploads" value={pendingImport.preview.uploadsCount} />
                  <SectionChip label="Custom tables" value={`${pendingImport.preview.customTableCount} (${pendingImport.preview.customTableRowCount} rows)`} />
                </div>
              </div>

              {pendingImport.preview.populatedSections.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {pendingImport.preview.populatedSections.map((section) => (
                    <span key={section.key} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700 dark:border-blue-700/50 dark:bg-blue-900/20 dark:text-blue-200">
                      {section.label}: {section.count}
                    </span>
                  ))}
                </div>
              ) : null}

              {pendingImport.preview.warnings.length ? (
                <div className="mt-4 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
                  {pendingImport.preview.warnings.map((warning, index) => (
                    <div key={`${warning}-${index}`}>{warning}</div>
                  ))}
                </div>
              ) : null}

              <p className="mt-4 text-xs text-amber-600 dark:text-amber-400">
                {copy('import_backup_warning', 'This overwrites existing data. Export a fresh backup first if you want to keep current data.')}
              </p>
              <div className="mt-3">
                <PathActionButton onClick={() => setPendingImport(null)} disabled={loading === 'import'}>
                  {copy('clear', 'Clear')}
                </PathActionButton>
              </div>
            </div>
          ) : null}
        </div>

        <GoogleDriveSyncSection t={t} notify={notify} />
        <DataFolderLocation t={t} notify={notify} />
        <ResetData />
        <FactoryReset />
      </div>
    </div>
  )
}
