import { useCallback, useEffect, useRef, useState } from 'react'
import { ArchiveRestore, CheckCircle2, Cloud, FolderInput, FolderOutput, HardDriveDownload, Link2, Link2Off, RefreshCw, Upload } from 'lucide-react'
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
import SectionSwitcher from '../shared/SectionSwitcher.jsx'
import LoadingWatchdog from '../shared/LoadingWatchdog.jsx'

const QUICK_BACKUP_SECTIONS = [
  'Products + inventory',
  'Sales + returns',
  'Contacts + users',
  'Portal + files',
]

const BACKUP_SECTION_OPTIONS = [
  { value: 'overview', label: 'Overview', hint: 'Open one backup tool at a time so the page stays responsive.' },
  { value: 'doctor', label: 'Doctor', hint: 'Check Docker data, storage, Google Drive, Supabase Auth, and backup package readiness.' },
  { value: 'export', label: 'Export', hint: 'Create a full Docker-safe backup package.' },
  { value: 'restore', label: 'Restore', hint: 'Restore a verified Business OS backup folder.' },
  { value: 'drive', label: 'Google Drive', hint: 'Connect and manage Drive sync for backup mirrors.' },
  { value: 'maintenance', label: 'Maintenance', hint: 'Advanced maintenance and reset tools.' },
]

const BACKUP_LOCAL_COPY = {
  km: {
    backup: 'បម្រុងទុក',
    export_backup_desc: 'បង្កើតកញ្ចប់បម្រុងទុក Docker ពេញលេញ ដែលមានទិន្នន័យ Postgres, R2 ឬ object storage offline, ការកំណត់, អ្នកប្រើ, ឯកសារ portal និង metadata សម្រាប់ស្ដារ។',
    export_backup_title: 'នាំចេញបម្រុងទុក',
    folder_backup_placeholder: 'ថតម៉ាស៊ីនមេជាជម្រើសសម្រាប់ backup ពេញលេញ',
    browse_folder: 'ជ្រើសថត',
    browse: 'រុករក',
    hide_advanced_browser: 'លាក់',
    export_backup_btn: 'នាំចេញ',
    exporting: 'កំពុងនាំចេញ...',
    import_backup_title: 'ស្ដារបម្រុងទុក',
    import_backup_desc: 'ស្ដារថតបម្រុងទុក Business OS ពេញលេញពីម៉ាស៊ីនមេ។',
    folder_restore_placeholder: 'ជ្រើសផ្លូវថត backup ពេញលេញ',
    restore_backup_btn: 'ស្ដារ',
    importing_backup: 'កំពុងស្ដារ...',
    folder_restore_note: 'ការស្ដារទទួលយកតែកញ្ចប់ backup Business OS ចុងក្រោយ ឬ Google Drive datasync version។',
    rows: 'ជួរ',
    uploads: 'ឯកសារផ្ទុកឡើង',
    custom_tables: 'តារាងផ្ទាល់ខ្លួន',
    exported: 'បាននាំចេញ',
    clear: 'សម្អាត',
    choose_folder_first: 'សូមជ្រើសថតជាមុន',
    server_folder_note: 'សកម្មភាពថតប្រើ path នៅលើម៉ាស៊ីនមេ Business OS។ សូមវាយ path ដែលមាននៅលើម៉ាស៊ីនមេ មិនមែនឧបករណ៍ browser ពីចម្ងាយទេ។',
    server_restore_note: 'Restore ប្រើថត backup ចុងក្រោយពីម៉ាស៊ីនមេ Business OS។ សូមវាយ path ម៉ាស៊ីនមេ ឬស្ដារពី Google Drive datasync version។',
    host_ui_local_only: 'សកម្មភាពនេះដំណើរការបានតែលើម៉ាស៊ីនមេប៉ុណ្ណោះ។ ពេលភ្ជាប់ពីចម្ងាយ សូមវាយ ឬបិទភ្ជាប់ path ម៉ាស៊ីនមេដោយដៃ។',
    restore: 'ស្ដារ',
    export: 'នាំចេញ',
    refresh: 'ផ្ទុកឡើងវិញ',
    save: 'រក្សាទុក',
    integration_doctor_title: 'ពិនិត្យការភ្ជាប់ប្រព័ន្ធ',
    integration_doctor_desc: 'ពិនិត្យ Docker data, R2/offline storage, Google Drive, Supabase Auth, backup packages, Redis jobs និង DuckDB/Parquet ដោយមិនបង្ហាញ secret។',
    integration_doctor_complete: 'ពិនិត្យប្រព័ន្ធរួចរាល់',
    integration_doctor_failed: 'ពិនិត្យប្រព័ន្ធបរាជ័យ',
    run_deep_doctor: 'ពិនិត្យ storage',
    secrets_redacted: 'បង្ហាញតែមាន/ខ្វះប៉ុណ្ណោះ; តម្លៃត្រូវបានលាក់។',
    oauth_setup_checklist: 'បញ្ជីពិនិត្យ OAuth',
    authorized_redirect_uris: 'Authorized redirect URIs',
    authorized_js_origins: 'Authorized JavaScript origins',
    object_storage_write_test: 'តេស្តសរសេរ/អាន/លុប object storage',
    passed: 'បានជោគជ័យ',
    failed: 'បរាជ័យ',
    checking: 'កំពុងពិនិត្យ...',
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
            {job.type || 'system job'} Â· {job.phase || job.status || 'queued'}
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

function DoctorStatusPill({ label, check }) {
  const ok = check?.ok === true
  const attention = check?.status === 'needs_attention' || check?.ok === false
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200' : attention ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200' : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-300'}`}>
      <div className="flex items-center gap-2 font-semibold">
        <CheckCircle2 className={`h-3.5 w-3.5 ${ok ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`} />
        <span>{label}</span>
      </div>
      {check?.message ? <div className="mt-1 break-words opacity-80">{check.message}</div> : null}
    </div>
  )
}

function IntegrationDoctorCard({ copy, notify, active }) {
  const [doctor, setDoctor] = useState(null)
  const [busy, setBusy] = useState('')
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const runDoctor = useCallback(async (deep = false) => {
    if (busy) return
    setBusy(deep ? 'deep' : 'quick')
    try {
      await yieldToBrowser()
      const result = await window.api.getIntegrationDoctor?.({ deep })
      if (!mountedRef.current) return
      setDoctor(result?.item || null)
      if (deep) notify(copy('integration_doctor_complete', 'Integration doctor complete'), 'success')
    } catch (error) {
      if (mountedRef.current) notify(`${copy('integration_doctor_failed', 'Integration doctor failed')}: ${error?.message || copy('unknown_error', 'Unknown error')}`, 'error')
    } finally {
      if (mountedRef.current) setBusy('')
    }
  }, [busy, copy, notify])

  useEffect(() => {
    if (!active || doctor) return
    const timer = window.setTimeout(() => runDoctor(false), 250)
    return () => window.clearTimeout(timer)
  }, [active, doctor, runDoctor])

  const checks = doctor?.checks || {}
  const runtime = doctor?.runtime || {}
  const drive = checks.googleDrive || {}
  const supabase = checks.supabaseAuth || {}
  const storage = checks.objectStorage || {}
  const oauth = doctor?.expectedOauth || {}

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            {copy('integration_doctor_title', 'Integration doctor')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {copy('integration_doctor_desc', 'Checks Docker data, R2/offline storage, Google Drive, Supabase Auth, backup packages, Redis jobs, and DuckDB/Parquet without showing secrets.')}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <PathActionButton onClick={() => runDoctor(false)} disabled={!!busy}>
            <RefreshCw className={`h-4 w-4 ${busy === 'quick' ? 'animate-spin' : ''}`} />
            {busy === 'quick' ? copy('checking', 'Checking...') : copy('refresh', 'Refresh')}
          </PathActionButton>
          <PrimaryActionButton onClick={() => runDoctor(true)} disabled={!!busy}>
            <RefreshCw className={`h-4 w-4 ${busy === 'deep' ? 'animate-spin' : ''}`} />
            {busy === 'deep' ? copy('checking', 'Checking...') : copy('run_deep_doctor', 'Run storage test')}
          </PrimaryActionButton>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <DoctorStatusPill label="Postgres" check={checks.database} />
        <DoctorStatusPill label={`${String(runtime.objectStorageDriver || 'R2').toUpperCase()} storage`} check={storage} />
        <DoctorStatusPill label="Redis jobs" check={checks.queue} />
        <DoctorStatusPill label="DuckDB / Parquet" check={checks.analytics} />
        <DoctorStatusPill label="Google Drive" check={drive} />
        <DoctorStatusPill label="Supabase Auth" check={supabase} />
        <DoctorStatusPill label="Backup packages" check={checks.backup} />
        <DoctorStatusPill label="Secrets" check={{ ok: true, message: copy('secrets_redacted', 'Present/missing only; values are redacted.') }} />
      </div>

      {doctor ? (
        <details className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-300">
          <summary className="cursor-pointer font-semibold text-gray-800 dark:text-gray-100">
            {copy('oauth_setup_checklist', 'OAuth setup checklist')}
          </summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <div className="font-semibold text-gray-900 dark:text-white">{oauth.googleLoginClient?.name || 'business-os'}</div>
              <div className="mt-1">{copy('authorized_redirect_uris', 'Authorized redirect URIs')}: {(oauth.googleLoginClient?.authorizedRedirectUris || []).join(', ') || '--'}</div>
              <div className="mt-1">{copy('authorized_js_origins', 'Authorized JavaScript origins')}: {(oauth.googleLoginClient?.authorizedJavaScriptOrigins || []).join(', ') || '--'}</div>
            </div>
            <div>
              <div className="font-semibold text-gray-900 dark:text-white">{oauth.googleDriveClient?.name || 'Business-os Drive'}</div>
              <div className="mt-1">{copy('authorized_redirect_uris', 'Authorized redirect URIs')}: {(oauth.googleDriveClient?.authorizedRedirectUris || []).join(', ') || '--'}</div>
              <div className="mt-1">{copy('authorized_js_origins', 'Authorized JavaScript origins')}: {(oauth.googleDriveClient?.authorizedJavaScriptOrigins || []).join(', ') || '--'}</div>
            </div>
          </div>
          {storage.writeReadDelete ? (
            <div className="mt-3 rounded-lg border border-current/10 bg-white/60 p-2 dark:bg-zinc-900/50">
              {copy('object_storage_write_test', 'Object storage write/read/delete test')}: {storage.writeReadDelete.ok ? copy('passed', 'Passed') : storage.writeReadDelete.error || copy('failed', 'Failed')}
            </div>
          ) : null}
        </details>
      ) : null}
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


function GoogleDriveSyncSection({ t, notify, active = true, actionHistory = null }) {
  const copy = useCopy(t)
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState(null)
  const [form, setForm] = useState({
    clientId: '',
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
    if (status && !status.hasClientSecret) {
      notify(copy('drive_sync_secret_env_required', 'Google Drive client secret is missing from the server env. Add it to the ignored Docker env file, then restart Business OS.'), 'error')
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
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-gray-300">
          <div className="font-medium text-gray-800 dark:text-gray-100">{copy('drive_sync_client_secret', 'OAuth client secret')}</div>
          <div className={`mt-1 text-xs font-semibold ${status?.hasClientSecret ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {status?.hasClientSecret
              ? copy('drive_sync_secret_env_configured', 'Stored in server env')
              : copy('drive_sync_secret_env_missing', 'Missing from server env')}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {copy('drive_sync_secret_env_note', 'The secret is never typed or shown in the browser. Update the ignored Docker env file when it changes.')}
          </p>
        </div>
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

function BackupOverview({ copy, onSelect }) {
  const entries = [
    {
      id: 'doctor',
      icon: CheckCircle2,
      title: copy('integration_doctor_title', 'Integration doctor'),
      body: copy('backup_overview_doctor_desc', 'Run checks only when you need storage, Drive, auth, or package diagnostics.'),
    },
    {
      id: 'export',
      icon: FolderOutput,
      title: copy('export_backup_title', 'Export backup'),
      body: copy('backup_overview_export_desc', 'Queue a Docker-safe package without blocking the page.'),
    },
    {
      id: 'restore',
      icon: FolderInput,
      title: copy('import_backup_title', 'Restore backup'),
      body: copy('backup_overview_restore_desc', 'Validate a backup folder before any restore action.'),
    },
    {
      id: 'drive',
      icon: Cloud,
      title: copy('drive_sync_title', 'Google Drive Sync'),
      body: copy('backup_overview_drive_desc', 'Connect, sync, and troubleshoot Drive separately from backup jobs.'),
    },
    {
      id: 'maintenance',
      icon: HardDriveDownload,
      title: copy('advanced_maintenance', 'Advanced maintenance'),
      body: copy('backup_overview_maintenance_desc', 'Open reset tools only when you intentionally need them.'),
    },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry) => {
        const Icon = entry.icon
        return (
          <button
            key={entry.id}
            type="button"
            className="rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/60 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
            onClick={() => onSelect(entry.id)}
          >
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-blue-50 p-2 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900 dark:text-white">{entry.title}</span>
                <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">{entry.body}</span>
              </span>
            </div>
          </button>
        )
      })}
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
  const [backupSection, setBackupSection] = useState('overview')
  const aliveRef = useRef(true)
  const jobStopRef = useRef(null)
  const sectionStorageKey = 'business-os:backup:section'
  const showBackupSection = (sectionId) => backupSection === sectionId

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
        <SectionSwitcher
          label="Backup"
          options={BACKUP_SECTION_OPTIONS}
          value={backupSection}
          onChange={setBackupSection}
          storageKey={sectionStorageKey}
        />
        <LoadingWatchdog
          loading={!!loading}
          timeoutMs={9000}
          label={copy('checking', 'Checking...')}
          details={loading ? `Backup operation: ${loading}` : ''}
          onRetry={() => setLoading('')}
        />
        <ActionHistoryBar history={actionHistory} className="mb-3" />
        <JobProgressCard job={activeJob} copy={copy} onClear={() => setActiveJob(null)} />
        {backupSection === 'overview' ? <BackupOverview copy={copy} onSelect={setBackupSection} /> : null}
        {showBackupSection('doctor') ? (
        <IntegrationDoctorCard copy={copy} notify={notify} active={isActive} />
        ) : null}
        {showBackupSection('export') ? (
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
                    autoComplete="off"
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
        ) : null}

        {showBackupSection('restore') ? (
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
                    autoComplete="off"
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
        ) : null}

        {isActive && showBackupSection('drive') ? <GoogleDriveSyncSection t={t} notify={notify} active={isActive} actionHistory={actionHistory} /> : null}
        {showBackupSection('maintenance') ? (
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
        ) : null}
      </div>
    </div>
  )
}

