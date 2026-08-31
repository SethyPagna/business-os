import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import ArchiveRestore from 'lucide-react/dist/esm/icons/archive-restore.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import Cloud from 'lucide-react/dist/esm/icons/cloud.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import FolderInput from 'lucide-react/dist/esm/icons/folder-input.js'
import FolderOutput from 'lucide-react/dist/esm/icons/folder-output.js'
import HardDriveDownload from 'lucide-react/dist/esm/icons/hard-drive-download.js'
import Link2 from 'lucide-react/dist/esm/icons/link-2.js'
import Link2Off from 'lucide-react/dist/esm/icons/link-2-off.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import { isBrokenLocalizedString as isBrokenLocalizedStringHook, useApp as useAppHook } from '../../AppContext.tsx'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { useIsPageActive } from '../shared/pageActivity'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import PageHeader from '../shared/PageHeader'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import SectionSwitcher from '../shared/SectionSwitcher'
import LoadingWatchdog from '../shared/LoadingWatchdog'
import { clearBackupMaintenance, getBackupMaintenance, type RestoreMaintenanceState } from '../../api/systemJobs.ts'

type TranslateFn = (key: string) => string
type NotifyFn = (message: string, type?: string) => void
type BackupSectionId = 'all' | 'doctor' | 'export' | 'restore' | 'drive' | 'maintenance'
type BackupAction = '' | 'folder-export' | 'folder-import' | 'cancel' | 'save' | 'connect' | 'sync' | 'disconnect' | 'forget' | 'quick' | 'deep'
type BackupTone = 'slate' | 'blue' | 'amber'
type StopFn = () => void

interface BackupButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
}

interface AppContextValue {
  t: TranslateFn
  notify: NotifyFn
  hasPermission(permission: string): boolean
  user?: {
    id?: unknown
    name?: unknown
    username?: unknown
    role_code?: unknown
    permissions?: unknown
  } | null
}

interface ActionHistoryItem {
  id?: string | number
  label?: string
  status?: string
}

interface ActionHistoryUserOption {
  id: string | number
  name?: string
  username?: string
}

interface ActionHistoryValue {
  pushAction: (payload: Record<string, unknown>) => void
  undoItems?: ActionHistoryItem[]
  redoItems?: ActionHistoryItem[]
  serverItems?: ActionHistoryItem[]
  isAdmin?: boolean
  userFilter?: string
  setUserFilter?: (userId: string) => void
  userOptions?: ActionHistoryUserOption[]
  canUndo?: boolean
  canRedo?: boolean
  busy?: boolean | string
  lastUndoLabel?: string
  lastRedoLabel?: string
  undo: (id?: string | number) => void
  redo: (id?: string | number) => void
}

interface BackupJobMetrics {
  currentFile?: string
  currentTable?: string
  filesTotal?: number | string
  filesProcessed?: number | string
  currentTableTotal?: number | string
  currentTableRows?: number | string
  retryCount?: number | string
  totalBytes?: number | string
  uploadedBytes?: number | string
}

interface BackupJobResult {
  packageId?: string
  localPath?: string
  objectPrefix?: string
  manifest?: unknown
  message?: string
  summary?: Record<string, number | string | undefined>
}

interface BackupJob {
  id?: string | number
  type?: string
  status?: string
  phase?: string
  progress?: number | string
  message?: string
  error?: string
  created_at?: string
  started_at?: string
  updated_at?: string
  metrics?: BackupJobMetrics
  result?: BackupJobResult
  cancellable?: boolean
}

interface QueuedJobResponse {
  job_id?: string | number
  item?: BackupJob
}

interface DoctorCheck {
  ok?: boolean
  status?: string
  message?: string
  writeReadDelete?: {
    ok?: boolean
    error?: string
  }
}

interface IntegrationDoctorResult {
  checks?: Record<string, DoctorCheck | undefined>
  runtime?: Record<string, unknown>
  expectedOauth?: {
    googleLoginClient?: OauthClient
    googleDriveClient?: OauthClient
  }
}

interface OauthClient {
  name?: string
  authorizedRedirectUris?: string[]
  authorizedJavaScriptOrigins?: string[]
}

interface DriveSyncStatus {
  clientId?: string
  folderName?: string
  deleteMissing?: boolean
  enabled?: boolean
  syncIntervalSeconds?: number | string
  unavailable?: boolean
  cooldownUntil?: number | string
  connected?: boolean
  connectedEmail?: string
  connectedName?: string
  hasClientSecret?: boolean
  redirectUri?: string
  lastSyncedAt?: string
  lastError?: string
}

interface DriveSyncForm {
  clientId: string
  folderName: string
  deleteMissing: boolean
  enabled: boolean
  syncIntervalMinutes: number | string
}

interface BackupApi {
  getIntegrationDoctor?(options: { deep: boolean }): Promise<{ item?: IntegrationDoctorResult }>
  getSystemJob?(jobId: string | number): Promise<{ item?: BackupJob } | BackupJob>
  cancelSystemJob?(jobId: string | number, reason: string): Promise<{ item?: BackupJob } | BackupJob>
  getGoogleDriveSyncStatus?(): Promise<{ item?: DriveSyncStatus; unavailable?: boolean; cooldownUntil?: number | string }>
  saveGoogleDriveSyncPreferences?(payload: Record<string, unknown>): Promise<{ item?: DriveSyncStatus }>
  startGoogleDriveSyncOauth?(payload: Record<string, unknown>): Promise<{ url?: string }>
  queueGoogleDriveSyncNow?(): Promise<QueuedJobResponse>
  disconnectGoogleDriveSync?(): Promise<unknown>
  forgetGoogleDriveSyncCredentials?(payload: { confirm: boolean }): Promise<unknown>
  queueBackupFolderExport?(destinationDir: string): Promise<QueuedJobResponse>
  queueBackupFolderRestore?(sourceDir: string): Promise<QueuedJobResponse>
}

interface JobProgressCardProps {
  job: BackupJob | null
  copy: CopyFn
  onClear: () => void
  onCancel: (job: BackupJob) => void
}

interface DoctorStatusPillProps {
  label: string
  check?: DoctorCheck
}

interface IntegrationDoctorCardProps {
  copy: CopyFn
  notify: NotifyFn
  active: boolean
}

interface SectionChipProps {
  label: string
  value: ReactNode
  tone?: BackupTone
}

interface GoogleDriveSyncSectionProps {
  t: TranslateFn
  notify: NotifyFn
  active?: boolean
  actionHistory?: ActionHistoryValue | null
}

interface BackupOverviewProps {
  copy: CopyFn
  onSelect: (section: BackupSectionId) => void
}

interface MaintenanceResetPanelProps {
  actionHistory?: ActionHistoryValue | null
}

interface JobWatcherHandlers {
  onUpdate?: (job: BackupJob) => void
  onComplete?: (job: BackupJob | null) => void
  onError?: (error: Error, job?: BackupJob) => void
}

interface JobWatcherOptions extends JobWatcherHandlers {
  reason?: string
  pollMs?: number
}

type CopyFn = (key: string, fallback: string, fallbackKm?: string) => string
type BackupLocalCopy = {
  km: Record<string, string>
  en?: Record<string, string>
}

const useApp = useAppHook as () => AppContextValue
const isBrokenLocalizedString = isBrokenLocalizedStringHook as (value: unknown) => boolean

function getBackupApi(): BackupApi {
  return (window as unknown as { api: BackupApi }).api
}

// Slice C (Part-77): while a restore runs -- or after one CRASHED -- the
// server holds a write-blocking maintenance flag with the restore's last
// recorded position. This banner makes that state visible (it is otherwise
// only "every save fails with a 503"), and offers the two honest exits:
// restart the restore (safe: full delete+reinsert) or force-clear, which
// accepts the half-restored state. Renders nothing while maintenance is off.
function RestoreMaintenanceBanner({ copy, notify }: { copy: CopyFn; notify: NotifyFn }) {
  const [state, setState] = useState<RestoreMaintenanceState>(null)
  const [clearing, setClearing] = useState(false)
  // Same page id the GoogleDriveSyncSection below uses -- Backup renders
  // under the Settings hub.
  const pageActive = useIsPageActive('settings')
  useEffect(() => {
    if (!pageActive) return undefined
    let alive = true
    const poll = async () => {
      try {
        const result = await getBackupMaintenance()
        if (alive) setState(result?.maintenance || null)
      } catch { /* transient -- keep the last known state */ }
    }
    void poll()
    const timer = window.setInterval(poll, 15000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [pageActive])
  if (!state) return null
  const failed = state.phase === 'failed'
  const detail = [
    state.phase ? `${copy('restore_phase', 'Phase')}: ${state.phase}` : '',
    state.table ? `${copy('restore_table', 'Table')}: ${state.table}${state.rowsDone ? ` (${state.rowsDone} rows)` : ''}` : '',
    state.startedAt ? `${copy('restore_started', 'Started')}: ${fmtDateTime24(state.startedAt)} (${state.startedBy || '?'})` : '',
    state.error ? `${copy('restore_error', 'Error')}: ${state.error}` : '',
  ].filter(Boolean).join(' · ')
  const handleClear = async () => {
    if (clearing) return
    if (!window.confirm(copy(
      'restore_maintenance_clear_confirm',
      'Force-clear restore maintenance? Writes re-open on a database whose restore did NOT finish. Restart the restore instead if you can.',
    ))) return
    setClearing(true)
    try {
      await clearBackupMaintenance()
      setState(null)
      notify(copy('restore_maintenance_cleared', 'Maintenance cleared -- writes are open again'), 'warning')
    } catch (error) {
      notify(getErrorMessage(error, copy('unknown_error', 'Unknown error')), 'error')
    } finally {
      setClearing(false)
    }
  }
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm ${failed
      ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
      : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200'}`}
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span className="font-semibold">
        {failed
          ? copy('restore_maintenance_failed', 'A restore CRASHED mid-way -- the database is read-only and half-restored')
          : copy('restore_maintenance_running', 'Restore in progress -- the system is read-only')}
      </span>
      {detail ? <span className="min-w-0 flex-1 truncate text-xs opacity-90" title={detail}>{detail}</span> : null}
      {failed ? (
        <button type="button" className="btn-secondary whitespace-nowrap text-xs" onClick={handleClear} disabled={clearing}>
          {clearing ? copy('working', 'Working...') : copy('restore_maintenance_clear', 'Force clear (accept half-state)')}
        </button>
      ) : null}
    </div>
  )
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function unwrapJob(result: { item?: BackupJob } | BackupJob | null | undefined): BackupJob | null {
  if (!result) return null
  if (typeof result === 'object' && 'item' in result) {
    const wrapped = result as { item?: BackupJob }
    return wrapped.item || null
  }
  return result as BackupJob
}

const QUICK_BACKUP_SECTIONS = [
  'Products + inventory',
  'Sales + returns',
  'Contacts + users',
  'Portal + files',
]

const LazyResetData = lazyRetry(async () => {
  const module = await import('./ResetData')
  return { default: module.ResetData as ComponentType<MaintenanceResetPanelProps> }
}, 'backup-reset-data')

const LazySectionReset = lazyRetry(async () => {
  const module = await import('./ResetData')
  return { default: module.SectionReset as ComponentType<MaintenanceResetPanelProps> }
}, 'backup-section-reset')

const LazyFactoryReset = lazyRetry(async () => {
  const module = await import('./ResetData')
  return { default: module.FactoryReset as ComponentType<MaintenanceResetPanelProps> }
}, 'backup-factory-reset')

const LazyMigrationFinalize = lazyRetry(async () => {
  const module = await import('./ResetData')
  return { default: module.MigrationFinalize as ComponentType<MaintenanceResetPanelProps> }
}, 'backup-migration-finalize')

// Ordered least-to-most destructive -- 'section' (single entity: customers/
// suppliers/delivery contacts/audit log) is the safest and deliberately
// the default first-shown tab, 'data' (sales/products/all) is the next
// step up, 'factory' (everything, unrecoverable) is last. See this
// section's own render comment for why this tier layer exists.
const MAINTENANCE_TIERS: Array<{ id: 'section' | 'data' | 'migration' | 'factory'; icon: ComponentType<{ className?: string }>; labelKey: string; label: string; hintKey: string; hint: string }> = [
  // Products moved from the Data Reset tier into this one: it clears one
  // page's data, which is what this tier is for, and sitting next to two
  // whole-database operations is what made it hard to find.
  { id: 'section', icon: RotateCcw, labelKey: 'maintenance_tier_section', label: 'Page Reset', hintKey: 'maintenance_tier_section_hint', hint: 'Clear one page on its own -- products, customers, suppliers, delivery contacts, or the audit log. Everything else is kept.' },
  { id: 'data', icon: Trash2, labelKey: 'maintenance_tier_data', label: 'Data Reset', hintKey: 'maintenance_tier_data_hint', hint: 'Sales-only or a full data reset -- these span the whole database. Users, roles, branches, and settings are kept.' },
  // The old-system import finalize steps (IMPORT-MANIFEST.md 4d/4e) that used
  // to be hand-typed wrangler SQL. Sits between Data Reset and Factory Reset
  // because it mutates live stock wholesale but never deletes rows, so it is
  // less destructive than either full reset.
  { id: 'migration', icon: Layers, labelKey: 'maintenance_tier_migration', label: 'Finalize Migration', hintKey: 'maintenance_tier_migration_hint', hint: 'Run the last old-system import steps in order: zero live stock, re-import the product files, then park the historical lots. Only right after a fresh history import.' },
  { id: 'factory', icon: ShieldAlert, labelKey: 'maintenance_tier_factory', label: 'Factory Reset', hintKey: 'maintenance_tier_factory_hint', hint: 'Deletes everything and returns the app to factory defaults. The most dangerous option here, and unrecoverable.' },
]

const BACKUP_SECTION_OPTIONS: Array<{ value: BackupSectionId; labelKey: string; label: string; hintKey: string; hint: string }> = [
  { value: 'all', labelKey: 'overview', label: 'Overview', hintKey: 'backup_section_overview_hint', hint: 'Open one backup tool at a time so the page stays responsive.' },
  { value: 'doctor', labelKey: 'doctor', label: 'Doctor', hintKey: 'backup_section_doctor_hint', hint: 'Check Cloudflare data, storage, Google Drive, Google login, and backup package readiness.' },
  { value: 'export', labelKey: 'export', label: 'Export', hintKey: 'backup_section_export_hint', hint: 'Create a full Cloudflare-safe backup package.' },
  { value: 'restore', labelKey: 'restore', label: 'Restore', hintKey: 'backup_section_restore_hint', hint: 'Restore a verified Business OS backup folder.' },
  { value: 'drive', labelKey: 'google_drive', label: 'Google Drive', hintKey: 'backup_section_drive_hint', hint: 'Connect and manage Drive sync for backup mirrors.' },
  { value: 'maintenance', labelKey: 'maintenance', label: 'Maintenance', hintKey: 'backup_section_maintenance_hint', hint: 'Advanced maintenance and reset tools.' },
]

const BACKUP_SECTION_IDS = new Set<BackupSectionId>(BACKUP_SECTION_OPTIONS.map((option) => option.value))

function isBackupSectionId(value: string): value is BackupSectionId {
  return BACKUP_SECTION_IDS.has(value as BackupSectionId)
}

const BACKUP_LOCAL_COPY: BackupLocalCopy = {
  km: {
    backup: 'បម្រុងទុក',
    export_backup_desc: 'បង្កើត backup Cloudflare ពេញលេញទៅ R2 ដែលមានទិន្នន័យ D1 ការកំណត់ អ្នកប្រើ portal និង metadata សម្រាប់ស្ដារ។',
    export_backup_title: 'នាំចេញបម្រុងទុក',
    folder_backup_placeholder: 'ទុកទទេ ដើម្បីប្រើ R2 backups/cloudflare/',
    browse_folder: 'ជ្រើសថត',
    browse: 'រុករក',
    hide_advanced_browser: 'លាក់',
    export_backup_btn: 'នាំចេញ',
    exporting: 'កំពុងនាំចេញ...',
    import_backup_title: 'ស្ដារបម្រុងទុក',
    import_backup_desc: 'ស្ដារ backup Business OS ពី R2 ហើយសរសេរជំនួសទិន្នន័យ D1 បច្ចុប្បន្ន។',
    folder_restore_placeholder: 'ឈ្មោះ backup ឬ key R2',
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
    server_restore_note: 'សូមវាយឈ្មោះ backup R2 ដូចជា business-os-cloudflare-YYYYMMDD-HHmmssZ.json ឬ key ពេញ backups/cloudflare/...។ ការស្ដារនឹងសរសេរជំនួសទិន្នន័យ D1។',
    host_ui_local_only: 'សកម្មភាពនេះដំណើរការបានតែលើម៉ាស៊ីនមេប៉ុណ្ណោះ។ ពេលភ្ជាប់ពីចម្ងាយ សូមវាយ ឬបិទភ្ជាប់ path ម៉ាស៊ីនមេដោយដៃ។',
    restore: 'ស្ដារ',
    export: 'នាំចេញ',
    refresh: 'ផ្ទុកឡើងវិញ',
    save: 'រក្សាទុក',
    integration_doctor_title: 'ពិនិត្យការភ្ជាប់ប្រព័ន្ធ',
    integration_doctor_desc: 'ពិនិត្យ Cloudflare D1, R2, Queues, Google Drive ជាជម្រើស និង backup packages ដោយមិនបង្ហាញ secret។',
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
function PathActionButton({ children, ...props }: BackupButtonProps) {
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

function PrimaryActionButton({ children, ...props }: BackupButtonProps) {
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

function formatElapsed(createdAt: unknown): string {
  const started = Date.parse(String(createdAt || ''))
  if (!Number.isFinite(started)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - started) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function JobProgressCard({ job, copy, onClear, onCancel }: JobProgressCardProps) {
  if (!job) return null
  const progress = Math.max(0, Math.min(100, Number(job.progress || 0)))
  const status = String(job.status || '').toLowerCase()
  const failed = status === 'failed' || status === 'cancelled'
  const completed = status === 'completed'
  const result = job.result || {}
  const metrics = job.metrics || {}
  const elapsed = formatElapsed(job.started_at || job.created_at)
  return (
    <div data-testid="backup-job-progress" className={`mt-4 rounded-2xl border p-4 text-sm ${failed ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200' : completed ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-100'}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-semibold">{job.message || copy('job_running', 'Working...')}</div>
          <div className="mt-1 text-xs opacity-80" data-testid="backup-job-meta">
            {job.type || 'system job'} | {job.phase || job.status || 'queued'}
          </div>
          {elapsed || job.updated_at ? (
            <div className="mt-1 text-xs opacity-80">
              {elapsed ? `${copy('job_elapsed', 'Elapsed')}: ${elapsed}` : ''}
              {job.updated_at ? ` / ${copy('job_updated', 'Updated')}: ${fmtDateTime24(job.updated_at)}` : ''}
            </div>
          ) : null}
          {metrics.currentFile || metrics.currentTable || metrics.filesTotal || metrics.retryCount || metrics.totalBytes ? (
            <div className="mt-2 grid gap-1 rounded-xl border border-current/20 bg-white/50 p-3 text-xs dark:bg-slate-950/30 sm:grid-cols-2">
              {metrics.currentFile ? <div className="min-w-0 break-all"><span className="font-semibold">{copy('job_current_file', 'File')}:</span> {metrics.currentFile}</div> : null}
              {metrics.currentTable ? <div><span className="font-semibold">{copy('job_current_table', 'Table')}:</span> {metrics.currentTable}</div> : null}
              {metrics.filesTotal ? <div><span className="font-semibold">{copy('job_files', 'Files')}:</span> {Number(metrics.filesProcessed || 0)} / {metrics.filesTotal}</div> : null}
              {metrics.currentTableTotal ? <div><span className="font-semibold">{copy('job_rows', 'Rows')}:</span> {Number(metrics.currentTableRows || 0)} / {metrics.currentTableTotal}</div> : null}
              {metrics.totalBytes ? <div><span className="font-semibold">{copy('job_uploaded', 'Uploaded')}:</span> {Math.round(Number(metrics.uploadedBytes || 0) / 1024 / 1024)} / {Math.round(Number(metrics.totalBytes || 0) / 1024 / 1024)} MB</div> : null}
              {metrics.retryCount ? <div><span className="font-semibold">{copy('job_retries', 'Retries')}:</span> {metrics.retryCount}</div> : null}
            </div>
          ) : null}
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
        {job.cancellable && !completed && !failed ? (
          <button type="button" data-testid="backup-job-cancel" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => onCancel?.(job)}>
            {copy('cancel_job', 'Cancel job')}
          </button>
        ) : completed || failed ? (
          <button type="button" data-testid="backup-job-clear" className="btn-secondary px-3 py-1.5 text-xs" onClick={onClear}>
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

function DoctorStatusPill({ label, check }: DoctorStatusPillProps) {
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

const INTEGRATION_DOCTOR_TIMEOUT_MS = 12000
const INTEGRATION_DOCTOR_DEEP_TIMEOUT_MS = 30000
const SYSTEM_JOB_STATUS_TIMEOUT_MS = 10000
const SYSTEM_JOB_CANCEL_TIMEOUT_MS = 12000
const SYSTEM_JOB_STATUS_MAX_FAILURES = 4
const DRIVE_SYNC_ACTION_TIMEOUT_MS = 12000
const DRIVE_SYNC_OAUTH_TIMEOUT_MS = 15000
const DRIVE_SYNC_QUEUE_TIMEOUT_MS = 12000
const BACKUP_JOB_QUEUE_TIMEOUT_MS = 15000

function IntegrationDoctorCard({ copy, notify, active }: IntegrationDoctorCardProps) {
  const [doctor, setDoctor] = useState<IntegrationDoctorResult | null>(null)
  const [busy, setBusy] = useState<BackupAction>('')
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const runDoctor = useCallback(async (deep = false): Promise<void> => {
    if (busy) return
    setBusy(deep ? 'deep' : 'quick')
    try {
      await yieldToBrowser()
      const result = await withLoaderTimeout(
        () => getBackupApi().getIntegrationDoctor?.({ deep }),
        deep ? 'Deep integration doctor' : 'Integration doctor',
        deep ? INTEGRATION_DOCTOR_DEEP_TIMEOUT_MS : INTEGRATION_DOCTOR_TIMEOUT_MS,
      )
      if (!mountedRef.current) return
      setDoctor(result?.item || null)
      if (deep) notify(copy('integration_doctor_complete', 'Integration doctor complete'), 'success')
    } catch (error) {
      if (mountedRef.current) notify(`${copy('integration_doctor_failed', 'Integration doctor failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
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
  const google_login = checks.googleLogin || {}
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
            {copy('integration_doctor_desc', 'Checks Cloudflare D1, R2, Queues, optional Google Drive and backup packages, without showing secrets.')}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <PathActionButton data-testid="backup-doctor-refresh" onClick={() => runDoctor(false)} disabled={!!busy}>
            <RefreshCw className={`h-4 w-4 ${busy === 'quick' ? 'animate-spin' : ''}`} />
            {busy === 'quick' ? copy('checking', 'Checking...') : copy('refresh', 'Refresh')}
          </PathActionButton>
          <PrimaryActionButton data-testid="backup-doctor-deep" onClick={() => runDoctor(true)} disabled={!!busy}>
            <RefreshCw className={`h-4 w-4 ${busy === 'deep' ? 'animate-spin' : ''}`} />
            {busy === 'deep' ? copy('checking', 'Checking...') : copy('run_deep_doctor', 'Run storage test')}
          </PrimaryActionButton>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <DoctorStatusPill label="Cloudflare D1" check={checks.database} />
        <DoctorStatusPill label={`${String(runtime.objectStorageDriver || 'R2').toUpperCase()} storage`} check={storage} />
        <DoctorStatusPill label="Cloudflare Queues" check={checks.queue} />
        <DoctorStatusPill label="Analytics" check={checks.analytics} />
        <DoctorStatusPill label="Google Drive" check={drive} />
        <DoctorStatusPill label="Google login" check={google_login} />
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

function useCopy(t: TranslateFn): CopyFn {
  // Memoized on `t` alone -- this used to return a brand-new closure on
  // *every* render. Several callbacks in this file (most importantly
  // GoogleDriveSyncSection's `load`) list `copy` in their dependency
  // array, so a fresh identity every render made those callbacks -- and
  // any effect depending on them -- re-run every render too. Combined
  // with the Drive section's own state churn (activeJob updates every
  // ~2s while a job is polling), that turned into an unthrottled
  // render -> refetch -> setState -> render loop that hammered the
  // network and the main thread for as long as the Drive section stayed
  // mounted -- read as "the Backup page freezes/becomes unresponsive"
  // once the user then tried to click to another section. Memoizing
  // this hook's return value breaks the loop at its root, independent of
  // the effect-dependency fix applied below.
  return useMemo(() => {
    const isKhmer = /[\u1780-\u17FF]/.test(t?.('cancel') || '')
    return (key: string, fallback: string, fallbackKm = fallback): string => {
      const value = t?.(key)
      if (value && value !== key && !isBrokenLocalizedString(value)) return value
      if (isKhmer) {
        const localKm = BACKUP_LOCAL_COPY.km?.[key]
        if (localKm && !isBrokenLocalizedString(localKm)) return localKm
        if (fallbackKm && !isBrokenLocalizedString(fallbackKm)) return fallbackKm
      }
      const localEn = BACKUP_LOCAL_COPY.en?.[key]
      if (localEn && !isBrokenLocalizedString(localEn)) return localEn
      return isBrokenLocalizedString(fallback) ? key : fallback
    }
  }, [t])
}

function formatDateTime(raw: unknown): string {
  if (!raw) return '--'
  const rawValue = String(raw)
  const value = rawValue.includes('T') || rawValue.endsWith('Z') ? rawValue : `${rawValue.replace(' ', 'T')}Z`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return rawValue
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatBytes(value: unknown): string {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount) || amount <= 0) return '0 B'
  if (amount < 1024) return `${amount} B`
  if (amount < 1024 * 1024) return `${(amount / 1024).toFixed(1)} KB`
  if (amount < 1024 * 1024 * 1024) return `${(amount / (1024 * 1024)).toFixed(1)} MB`
  return `${(amount / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function yieldToBrowser(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (typeof window.requestAnimationFrame === 'function') {
    return new Promise((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)))
  }
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function getJobSignature(job: BackupJob | null | undefined): string {
  if (!job || typeof job !== 'object') return ''
  const metrics = job.metrics || {}
  return JSON.stringify({
    id: job.id || '',
    status: job.status || '',
    phase: job.phase || '',
    progress: Number(job.progress || 0) || 0,
    message: job.message || '',
    error: job.error || '',
    updated_at: job.updated_at || '',
    filesProcessed: Number(metrics.filesProcessed || 0) || 0,
    filesTotal: Number(metrics.filesTotal || 0) || 0,
    currentTableRows: Number(metrics.currentTableRows || 0) || 0,
    retryCount: Number(metrics.retryCount || 0) || 0,
    uploadedBytes: Number(metrics.uploadedBytes || 0) || 0,
  })
}

function startJobWatcher(jobId: string | number | undefined, {
  reason = 'System job',
  pollMs = 1200,
  onUpdate,
  onComplete,
  onError,
}: JobWatcherOptions = {}): StopFn {
  if (typeof window === 'undefined' || !jobId) return () => {}
  let stopped = false
  let inFlight = false
  let timer: number | null = null
  let lastSignature = ''
  let changedOnLastTick = true
  let consecutiveFailures = 0
  const basePollMs = Math.max(1000, Number(pollMs || 1200))

  const stop = () => {
    stopped = true
    if (timer) window.clearTimeout(timer)
    timer = null
  }

  const scheduleTick = (delayMs = basePollMs) => {
    if (stopped) return
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(tick, Math.max(250, Number(delayMs || basePollMs)))
  }

  const tick = async () => {
    if (stopped) return
    if (inFlight) {
      scheduleTick(basePollMs)
      return
    }
    inFlight = true
    try {
      const result = await withLoaderTimeout(
        () => getBackupApi().getSystemJob?.(jobId),
        `${reason} status`,
        SYSTEM_JOB_STATUS_TIMEOUT_MS,
      )
      const job = unwrapJob(result)
      if (stopped) return
      consecutiveFailures = 0
      const signature = getJobSignature(job)
      const changed = signature !== lastSignature
      changedOnLastTick = changed
      if (changed) lastSignature = signature
      if (changed && job && typeof onUpdate === 'function') onUpdate(job)
      const status = String(job?.status || '').toLowerCase()
      if (status === 'completed') {
        stop()
        if (typeof onComplete === 'function') onComplete(job || null)
      } else if (status === 'failed' || status === 'cancelled') {
        stop()
        const message = job?.error || job?.message || `${reason} failed`
        if (typeof onError === 'function') onError(new Error(message), job || undefined)
      }
    } catch (error) {
      consecutiveFailures += 1
      changedOnLastTick = false
      if (consecutiveFailures >= SYSTEM_JOB_STATUS_MAX_FAILURES) {
        stop()
        if (typeof onError === 'function') onError(error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      inFlight = false
      if (!stopped) {
        const hiddenDelay = typeof document !== 'undefined' && document.visibilityState === 'hidden'
          ? basePollMs * 4
          : basePollMs
        const failureDelay = consecutiveFailures > 0
          ? Math.min(15000, basePollMs * (2 ** Math.min(consecutiveFailures, 3)))
          : basePollMs
        const sameStateDelay = !changedOnLastTick && lastSignature ? Math.round(basePollMs * 1.35) : basePollMs
        const nextDelay = Math.max(failureDelay, hiddenDelay > basePollMs ? hiddenDelay : sameStateDelay)
        scheduleTick(nextDelay)
      }
    }
  }

  scheduleTick(0)
  return stop
}

function SectionChip({ label, value, tone = 'slate' }: SectionChipProps) {
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

const DRIVE_SYNC_DEFAULT_INTERVAL_MINUTES = 6 * 60
const DRIVE_SYNC_MIN_INTERVAL_MINUTES = 60
const DRIVE_SYNC_MAX_INTERVAL_MINUTES = 24 * 60
const DRIVE_SYNC_PRESET_HOURS = [3, 6, 9, 12, 24]
const DRIVE_SYNC_STATUS_TIMEOUT_MS = 5000
const DRIVE_SYNC_JOB_POLL_MS = 2000

function secondsToSyncMinutes(seconds: unknown): number {
  const raw = Number(seconds)
  if (!Number.isFinite(raw) || raw <= 0) return DRIVE_SYNC_DEFAULT_INTERVAL_MINUTES
  return Math.min(
    DRIVE_SYNC_MAX_INTERVAL_MINUTES,
    Math.max(DRIVE_SYNC_MIN_INTERVAL_MINUTES, Math.round(raw / 60)),
  )
}

function minutesToSyncSeconds(minutes: unknown): number {
  const raw = Number(minutes)
  const safeMinutes = Number.isFinite(raw)
    ? Math.min(DRIVE_SYNC_MAX_INTERVAL_MINUTES, Math.max(DRIVE_SYNC_MIN_INTERVAL_MINUTES, Math.round(raw)))
    : DRIVE_SYNC_DEFAULT_INTERVAL_MINUTES
  return safeMinutes * 60
}

function GoogleDriveSyncSection({ t, notify, active = true, actionHistory = null }: GoogleDriveSyncSectionProps) {
  const copy = useCopy(t)
  const [busy, setBusy] = useState<BackupAction>('')
  const [status, setStatus] = useState<DriveSyncStatus | null>(null)
  const [form, setForm] = useState<DriveSyncForm>({
    clientId: '',
    folderName: 'Business OS Sync',
    deleteMissing: true,
    enabled: true,
    syncIntervalMinutes: DRIVE_SYNC_DEFAULT_INTERVAL_MINUTES,
  })
  const [activeJob, setActiveJob] = useState<BackupJob | null>(null)
  const [pendingAuthUrl, setPendingAuthUrl] = useState('')
  const loadRequestRef = useRef(0)
  const retryTimerRef = useRef<number | null>(null)
  const failureCountRef = useRef(0)
  const failureNotifiedRef = useRef(false)
  const inFlightRef = useRef(false)
  const unavailableUntilRef = useRef(0)
  const loadRef = useRef<((options?: { force?: boolean }) => Promise<void>) | null>(null)
  const isMountedRef = useRef(true)
  const jobStopRef = useRef<StopFn | null>(null)
  const activeJobSignatureRef = useRef('')
  const dirtyFieldsRef = useRef<Set<keyof DriveSyncForm>>(new Set())
  const actionLockRef = useRef<BackupAction>('')

  const updateDraftField = useCallback((field: keyof DriveSyncForm, value: DriveSyncForm[keyof DriveSyncForm]) => {
    dirtyFieldsRef.current.add(field)
    setForm((current) => ({ ...current, [field]: value }))
  }, [])

  const applyDriveIntervalPreset = useCallback((hours: number) => {
    updateDraftField('syncIntervalMinutes', hours * 60)
  }, [updateDraftField])

  const scheduleRetry = useCallback((delayMs: unknown) => {
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current)
    if (!active) return
    retryTimerRef.current = window.setTimeout(() => {
      if (!isMountedRef.current || !active) return
      loadRef.current?.({ force: true })
    }, Math.max(5000, Number(delayMs || 0) || 30000))
  }, [active])

  const load = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!active) return
    if (inFlightRef.current) return
    if (!force && unavailableUntilRef.current > Date.now()) return
    const requestId = beginTrackedRequest(loadRequestRef)
    inFlightRef.current = true
    try {
      const result = await withLoaderTimeout(() => getBackupApi().getGoogleDriveSyncStatus?.(), 'Drive sync status', DRIVE_SYNC_STATUS_TIMEOUT_MS)
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
        if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current)
      }
      setStatus((current) => item || current || null)
      setForm((current) => {
        const dirty = dirtyFieldsRef.current
        return {
          clientId: dirty.has('clientId') ? current.clientId : current.clientId || item?.clientId || '',
          folderName: dirty.has('folderName') ? current.folderName : item?.folderName || current.folderName || 'Business OS Sync',
          deleteMissing: dirty.has('deleteMissing') ? current.deleteMissing : !!item?.deleteMissing,
          enabled: dirty.has('enabled') ? current.enabled : item?.enabled !== false,
          syncIntervalMinutes: dirty.has('syncIntervalMinutes')
            ? current.syncIntervalMinutes
            : secondsToSyncMinutes(item?.syncIntervalSeconds || minutesToSyncSeconds(current.syncIntervalMinutes)),
        }
      })
    } catch (error) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      failureCountRef.current += 1
      const nextDelayMs = Math.min(30000, 2000 * (2 ** Math.min(failureCountRef.current - 1, 4)))
      unavailableUntilRef.current = Date.now() + nextDelayMs
      scheduleRetry(nextDelayMs)
      if (!failureNotifiedRef.current) {
        failureNotifiedRef.current = true
        notify(`${copy('failed', 'Failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
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
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current)
      invalidateTrackedRequest(loadRequestRef)
      return
    }
    // Deliberately depends on `active` only, not `load` -- `load`'s own
    // identity churns with every state update inside this section
    // (activeJob polling, status/form changes), and this effect used to
    // list it as a dependency, so it re-ran (and re-fetched) on every
    // single one of those re-renders instead of once per real mount.
    // `loadRef` (kept current by the effect right above this one) is the
    // mechanism this file already uses elsewhere to call the latest
    // `load` without depending on its identity -- this effect just
    // wasn't using it. See useCopy's own memoization fix above for the
    // other half of what caused that loop.
    loadRef.current?.({ force: true })
    return () => {
      isMountedRef.current = false
    }
  }, [active])
  useEffect(() => () => {
    isMountedRef.current = false
    actionLockRef.current = ''
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current)
    jobStopRef.current?.()
    invalidateTrackedRequest(loadRequestRef)
  }, [])

  useEffect(() => {
    if (!active) return undefined
    const handler = (event: MessageEvent<{ type?: string; status?: string; message?: string }>) => {
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

  const trackQueuedJob = useCallback((queued: QueuedJobResponse | undefined, reason: string, handlers: JobWatcherHandlers = {}) => {
    const jobId = queued?.job_id || queued?.item?.id
    if (!jobId) return queued
    jobStopRef.current?.()
    const queuedJob = queued.item || { id: jobId, status: 'queued', progress: 0, message: reason }
    activeJobSignatureRef.current = getJobSignature(queuedJob)
    setActiveJob(queuedJob)
    jobStopRef.current = startJobWatcher(jobId, {
      reason,
      pollMs: DRIVE_SYNC_JOB_POLL_MS,
      onUpdate: (job) => {
        if (!isMountedRef.current || !job) return
        const signature = getJobSignature(job)
        if (signature === activeJobSignatureRef.current) return
        activeJobSignatureRef.current = signature
        setActiveJob(job)
      },
      onComplete: (job) => {
        if (!isMountedRef.current) return
        activeJobSignatureRef.current = getJobSignature(job)
        setActiveJob(job || null)
        load({ force: true })
        handlers.onComplete?.(job)
      },
      onError: (error, job) => {
        if (!isMountedRef.current) return
        if (job) {
          activeJobSignatureRef.current = getJobSignature(job)
          setActiveJob(job)
        }
        handlers.onError?.(error, job)
      },
    })
    return queued
  }, [load])

  const beginAction = useCallback((action: BackupAction) => {
    if (actionLockRef.current) return false
    actionLockRef.current = action
    setBusy(action)
    return true
  }, [])

  const finishAction = useCallback((action: BackupAction) => {
    if (actionLockRef.current === action) actionLockRef.current = ''
    setBusy('')
  }, [])

  const cancelActiveJob = useCallback(async (job: BackupJob) => {
    if (!job?.id || actionLockRef.current) return
    if (!beginAction('cancel')) return
    try {
      const result = await withLoaderTimeout(
        () => getBackupApi().cancelSystemJob?.(job.id!, 'Cancelled from Backup page'),
        'Cancel backup job',
        SYSTEM_JOB_CANCEL_TIMEOUT_MS,
      )
      const nextJob = unwrapJob(result)
      if (nextJob && isMountedRef.current) {
        activeJobSignatureRef.current = getJobSignature(nextJob)
        setActiveJob(nextJob)
      }
      notify(copy('job_cancel_requested', 'Cancel requested'), 'info')
    } catch (error) {
      notify(`${copy('job_cancel_failed', 'Cancel failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
    } finally {
      finishAction('cancel')
    }
  }, [beginAction, copy, finishAction, notify])

  const savePreferences = async () => {
    if (!beginAction('save')) return
    try {
      await yieldToBrowser()
      const result = await withLoaderTimeout(
        () => getBackupApi().saveGoogleDriveSyncPreferences?.({
          folderName: form.folderName,
          deleteMissing: form.deleteMissing,
          enabled: form.enabled,
          syncIntervalSeconds: minutesToSyncSeconds(form.syncIntervalMinutes),
        }),
        'Save Google Drive sync preferences',
        DRIVE_SYNC_ACTION_TIMEOUT_MS,
      )
      setStatus(result?.item || status)
      dirtyFieldsRef.current.clear()
      actionHistory?.pushAction?.({
        scope: 'backup',
        entity: 'google_drive_sync',
        label: copy('drive_sync_preferences_saved', 'Google Drive sync preferences saved'),
      })
      notify(copy('saved', 'Saved'), 'success')
      window.setTimeout(() => load({ force: true }), 0)
    } catch (error) {
      notify(`${copy('save_failed', 'Save failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
    } finally {
      finishAction('save')
    }
  }

  const connectGoogleDrive = async () => {
    if (actionLockRef.current) return
    if (!String(form.clientId || '').trim() && !status?.clientId) {
      notify(copy('drive_sync_client_required', 'Google OAuth client ID is required'), 'error')
      return
    }
    if (status && !status.hasClientSecret) {
      notify(copy('drive_sync_secret_env_required', 'Google Drive client secret is missing from Cloudflare Worker secrets. Add it with Wrangler, then redeploy Business OS.'), 'error')
      return
    }

    setPendingAuthUrl('')
    if (!beginAction('connect')) return
    try {
      await yieldToBrowser()
      const result = await withLoaderTimeout(
        () => getBackupApi().startGoogleDriveSyncOauth?.({
          clientId: form.clientId,
          folderName: form.folderName,
          deleteMissing: form.deleteMissing,
          enabled: form.enabled,
          syncIntervalSeconds: minutesToSyncSeconds(form.syncIntervalMinutes),
          returnOrigin: window.location.origin,
          returnPath: window.location.pathname + window.location.search,
        }),
        'Start Google Drive connection',
        DRIVE_SYNC_OAUTH_TIMEOUT_MS,
      )
      // The backend returns the consent URL as `url` (same shape as the SSO
      // /api/auth/oauth/start endpoint). Reading `authUrl` here always yielded
      // undefined, so a *successful* start still threw -- surfacing as the
      // doubled "Google Drive connection failed: Google Drive connection failed".
      const authUrl = result?.url
      if (!authUrl) throw new Error(copy('drive_sync_connect_failed', 'Google Drive connection failed'))
      actionHistory?.pushAction?.({
        scope: 'backup',
        entity: 'google_drive_sync',
        label: copy('drive_sync_connect_started', 'Google Drive connection started'),
      })
      setPendingAuthUrl(authUrl)
      dirtyFieldsRef.current.clear()
      notify(copy('drive_sync_setup_ready', 'Google Drive setup is ready.'), 'info')
    } catch (error) {
      notify(`${copy('drive_sync_connect_failed', 'Google Drive connection failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
    } finally {
      finishAction('connect')
    }
  }

  const syncNow = async () => {
    if (!beginAction('sync')) return
    try {
      await yieldToBrowser()
      const queued = await withLoaderTimeout(
        () => getBackupApi().queueGoogleDriveSyncNow?.(),
        'Queue Google Drive sync',
        DRIVE_SYNC_QUEUE_TIMEOUT_MS,
      )
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
            notify(`${copy('drive_sync_failed', 'Drive sync failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
          },
        })
      }, 0)
    } catch (error) {
      notify(`${copy('drive_sync_failed', 'Drive sync failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
    } finally {
      finishAction('sync')
    }
  }

  const disconnect = async () => {
    if (actionLockRef.current) return
    if (!confirm(copy('drive_sync_disconnect_confirm', 'Disconnect Google Drive sync from this app?'))) return
    if (!beginAction('disconnect')) return
    try {
      await yieldToBrowser()
      await withLoaderTimeout(
        () => getBackupApi().disconnectGoogleDriveSync?.(),
        'Disconnect Google Drive sync',
        DRIVE_SYNC_ACTION_TIMEOUT_MS,
      )
      window.setTimeout(() => load({ force: true }), 0)
      actionHistory?.pushAction?.({
        scope: 'backup',
        entity: 'google_drive_sync',
        label: copy('drive_sync_disconnected', 'Google Drive disconnected'),
      })
      notify(copy('drive_sync_disconnected', 'Google Drive disconnected'), 'success')
    } catch (error) {
      notify(`${copy('failed', 'Failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
    } finally {
      finishAction('disconnect')
    }
  }

  const forgetCredentials = async () => {
    if (actionLockRef.current) return
    if (!confirm(copy('drive_sync_forget_credentials_confirm', 'Forget the saved Google Drive app credentials too? This clears the client ID, client secret, and redirect URI defaults until you enter them again.'))) return
    if (!beginAction('forget')) return
    try {
      await yieldToBrowser()
      await withLoaderTimeout(
        () => getBackupApi().forgetGoogleDriveSyncCredentials?.({ confirm: true }),
        'Forget Google Drive credentials',
        DRIVE_SYNC_ACTION_TIMEOUT_MS,
      )
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
      notify(`${copy('failed', 'Failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
    } finally {
      finishAction('forget')
    }
  }

  const activeDriveJobRunning = ['queued', 'running', 'cancelling'].includes(String(activeJob?.status || '').toLowerCase())

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <Cloud className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {copy('drive_sync_title', 'Google Drive Sync')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {copy('drive_sync_desc', 'Mirror Cloudflare backups to Google Drive on an optional background schedule.')}
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
            onChange={(event) => updateDraftField('clientId', event.target.value)}
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
            {copy('drive_sync_secret_env_note', 'The secret is never typed or shown in the browser. Store it as a Cloudflare Worker secret when Google Drive sync is enabled.')}
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
            onChange={(event) => updateDraftField('folderName', event.target.value)}
            placeholder="Business OS Sync"
          />
        </label>
        <label className="grid gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <span id="drive-sync-interval-label">{copy('drive_sync_interval', 'Sync interval (mins)')}</span>
          <input
            id="drive-sync-interval"
            name="drive_sync_interval_minutes"
            type="number"
            min={DRIVE_SYNC_MIN_INTERVAL_MINUTES}
            max={DRIVE_SYNC_MAX_INTERVAL_MINUTES}
            step="30"
            className="input"
            autoComplete="off"
            aria-labelledby="drive-sync-interval-label"
            value={form.syncIntervalMinutes}
            onChange={(event) => updateDraftField('syncIntervalMinutes', event.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {DRIVE_SYNC_PRESET_HOURS.map((hours) => (
              <button
                key={hours}
                type="button"
                data-testid={`backup-drive-preset-${hours}h`}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  Number(form.syncIntervalMinutes) === hours * 60
                    ? 'border-blue-500 bg-blue-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-300'
                }`}
                onClick={() => applyDriveIntervalPreset(hours)}
              >
                {hours}h
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {copy('drive_sync_interval_note', 'Default is 360 minutes (every 6 hours). Quick choices use 1, 3, 6, 12, or 24 hours. Google Drive keeps up to 10 backup versions.')}
          </p>
        </label>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-zinc-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={!!form.enabled}
            onChange={(event) => updateDraftField('enabled', event.target.checked)}
          />
          <span>{copy('drive_sync_enabled', 'Enable background sync')}</span>
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-zinc-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={!!form.deleteMissing}
            onChange={(event) => updateDraftField('deleteMissing', event.target.checked)}
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

      <LoadingWatchdog
        loading={!!busy}
        timeoutMs={6000}
        label={copy('checking', 'Checking...')}
        details={busy ? `Google Drive action: ${busy}` : ''}
      />

      <JobProgressCard job={activeJob} copy={copy} onClear={() => setActiveJob(null)} onCancel={cancelActiveJob} />

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <PrimaryActionButton data-testid="backup-drive-save" onClick={savePreferences} disabled={!!busy}>
          {busy === 'save' ? copy('saving', 'Saving...') : copy('save', 'Save')}
        </PrimaryActionButton>
        <PathActionButton data-testid="backup-drive-connect" onClick={connectGoogleDrive} disabled={!!busy}>
          <Link2 className="h-4 w-4" />
          {busy === 'connect' ? copy('connecting', 'Connecting...') : copy('drive_sync_connect', status?.connected ? 'Reconnect' : 'Connect Google Drive')}
        </PathActionButton>
        <PathActionButton data-testid="backup-drive-sync-now" onClick={syncNow} disabled={!!busy || activeDriveJobRunning || !status?.connected}>
          <RefreshCw className="h-4 w-4" />
          {busy === 'sync' ? copy('syncing', 'Syncing...') : copy('drive_sync_sync_now', 'Sync now')}
        </PathActionButton>
        {status?.connected ? (
          <PathActionButton data-testid="backup-drive-disconnect" onClick={disconnect} disabled={!!busy}>
            <Link2Off className="h-4 w-4" />
            {busy === 'disconnect' ? copy('disconnecting', 'Disconnecting...') : copy('disconnect', 'Disconnect')}
          </PathActionButton>
        ) : null}
        <PathActionButton data-testid="backup-drive-forget" onClick={forgetCredentials} disabled={!!busy}>
          <Link2Off className="h-4 w-4" />
          {busy === 'forget' ? copy('forgetting', 'Forgetting...') : copy('drive_sync_forget_credentials', 'Forget app credentials')}
        </PathActionButton>
      </div>
    </div>
  )
}

function BackupOverview({ copy, onSelect }: BackupOverviewProps) {
  const entries: Array<{
    id: BackupSectionId
    icon: typeof CheckCircle2
    title: string
    body: string
  }> = [
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
      body: copy('backup_overview_export_desc', 'Create a Cloudflare R2 backup without blocking the page.'),
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
            data-testid={`backup-overview-${entry.id}`}
            className="min-h-[112px] rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/60 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
            onClick={() => onSelect(entry.id)}
          >
            <div className="flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{entry.title}</div>
                <div className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{entry.body}</div>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

const MemoIntegrationDoctorCard = memo(IntegrationDoctorCard)
const MemoGoogleDriveSyncSection = memo(GoogleDriveSyncSection)
const MemoBackupOverview = memo(BackupOverview)


export default function Backup() {
  const { t, notify, hasPermission, user } = useApp()
  const copy = useCopy(t)
  // E4: renders inside the Settings hub now.
  const isActive = useIsPageActive('settings')
  const [historyReady, setHistoryReady] = useState(false)
  const actionHistory = useActionHistory({ limit: 3, notify, scope: 'backup', enabled: historyReady, user }) as ActionHistoryValue
  const [loading, setLoading] = useState<BackupAction>('')
  const [folderExportPath, setFolderExportPath] = useState('')
  const [folderImportPath, setFolderImportPath] = useState('')
  const [activeJob, setActiveJob] = useState<BackupJob | null>(null)
  const [advancedMaintenanceOpen, setAdvancedMaintenanceOpen] = useState(false)
  const [maintenanceTier, setMaintenanceTier] = useState<'section' | 'data' | 'migration' | 'factory'>('section')
  const [backupSection, setBackupSection] = useState<BackupSectionId>('all')
  const aliveRef = useRef(true)
  const jobStopRef = useRef<StopFn | null>(null)
  const activeJobSignatureRef = useRef('')
  const actionLockRef = useRef<BackupAction>('')
  const showBackupSection = (sectionId: BackupSectionId) => backupSection === sectionId
  const backupSectionOptions = BACKUP_SECTION_OPTIONS.map((option) => ({
    value: option.value,
    label: copy(option.labelKey, option.label),
    hint: copy(option.hintKey, option.hint),
  }))
  const handleBackupSectionChange = useCallback((value: string) => {
    if (isBackupSectionId(value)) setBackupSection(value)
  }, [])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      actionLockRef.current = ''
      jobStopRef.current?.()
    }
  }, [])

  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      return undefined
    }
    setHistoryReady(true)
    return undefined
  }, [isActive])

  const beginBackupAction = useCallback((action: BackupAction) => {
    if (actionLockRef.current) return false
    actionLockRef.current = action
    setLoading(action)
    return true
  }, [])

  const finishBackupAction = useCallback((action: BackupAction) => {
    if (actionLockRef.current === action) actionLockRef.current = ''
    if (aliveRef.current) setLoading((current) => (current === action ? '' : current))
  }, [])

  const handleFolderExport = async () => {
    if (actionLockRef.current) return
    if (!hasPermission('backup')) return notify(copy('no_permission', 'No permission'), 'error')
    const exportDestination = String(folderExportPath || '').trim()
    if (!beginBackupAction('folder-export')) return
    try {
      await yieldToBrowser()
      const queued = await withLoaderTimeout(
        () => getBackupApi().queueBackupFolderExport?.(exportDestination),
        'Queue backup export',
        BACKUP_JOB_QUEUE_TIMEOUT_MS,
      )
      const jobId = queued?.job_id || queued?.item?.id
      if (jobId) {
        const queuedJob = queued.item || { id: jobId, status: 'queued', progress: 0, message: copy('backup_export_queued', 'Backup export queued') }
        activeJobSignatureRef.current = getJobSignature(queuedJob)
        setActiveJob(queuedJob)
      }
      if (jobId) {
        notify(copy('backup_export_queued', 'Backup export queued'), 'info')
        jobStopRef.current?.()
        window.setTimeout(() => {
          jobStopRef.current = startJobWatcher(jobId, {
            reason: 'backup export',
            pollMs: 2000,
            onUpdate: (job) => {
              if (!aliveRef.current || !job) return
              const signature = getJobSignature(job)
              if (signature === activeJobSignatureRef.current) return
              activeJobSignatureRef.current = signature
              setActiveJob(job)
            },
            onComplete: (job) => {
              if (!aliveRef.current) return
              if (job) {
                activeJobSignatureRef.current = getJobSignature(job)
                setActiveJob(job)
              }
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
              if (job && aliveRef.current) {
                activeJobSignatureRef.current = getJobSignature(job)
                setActiveJob(job)
              }
              if (aliveRef.current) notify(`${copy('export_failed', 'Export failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
              if (aliveRef.current) setLoading('')
            },
          })
        }, 0)
        return
      }
      throw new Error(copy('backup_job_not_queued', 'Backup job could not be queued. Run Doctor or restart Business OS.'))
    } catch (error) {
      notify(`${copy('export_failed', 'Export failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
    } finally {
      finishBackupAction('folder-export')
    }
  }

  const handleFolderImport = async () => {
    if (actionLockRef.current) return
    // Restore requires 'backup_restore' specifically, not just 'backup' --
    // matches the backend gate in routes/backups.ts. These used to be the
    // same check (backup_restore silently fell back to backup) which meant
    // granting someone "Backup export" also silently gave them full
    // database restore power; fixed both sides together this session.
    if (!hasPermission('backup_restore')) return notify(copy('no_permission', 'No permission'), 'error')
    if (!folderImportPath) return notify(copy('choose_folder_first', 'Choose a folder first'), 'error')
    if (!confirm(`${copy('import_backup_warning', 'This validates a backup package before any restore can replace live data.')}\n\n${copy('import_backup_confirm', 'Continue?')}`)) return

    if (!beginBackupAction('folder-import')) return
    try {
      await yieldToBrowser()
      const queued = await withLoaderTimeout(
        () => getBackupApi().queueBackupFolderRestore?.(folderImportPath),
        'Queue backup restore',
        BACKUP_JOB_QUEUE_TIMEOUT_MS,
      )
      const jobId = queued?.job_id || queued?.item?.id
      if (jobId) {
        const queuedJob = queued.item || { id: jobId, status: 'queued', progress: 0, message: copy('backup_restore_queued', 'Backup restore queued') }
        activeJobSignatureRef.current = getJobSignature(queuedJob)
        setActiveJob(queuedJob)
      }
      if (jobId) {
        notify(copy('backup_restore_queued', 'Backup restore queued'), 'info')
        jobStopRef.current?.()
        window.setTimeout(() => {
          jobStopRef.current = startJobWatcher(jobId, {
            reason: 'backup restore',
            pollMs: 2000,
            onUpdate: (job) => {
              if (!aliveRef.current || !job) return
              const signature = getJobSignature(job)
              if (signature === activeJobSignatureRef.current) return
              activeJobSignatureRef.current = signature
              setActiveJob(job)
            },
            onComplete: (job) => {
              if (!aliveRef.current) return
              if (job) {
                activeJobSignatureRef.current = getJobSignature(job)
                setActiveJob(job)
              }
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
              if (job && aliveRef.current) {
                activeJobSignatureRef.current = getJobSignature(job)
                setActiveJob(job)
              }
              if (aliveRef.current) notify(`${copy('import_failed', 'Import failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
              if (aliveRef.current) setLoading('')
            },
          })
        }, 0)
        return
      }
      throw new Error(copy('backup_restore_job_not_queued', 'Restore job could not be queued. Run Doctor or restart Business OS.'))
    } catch (error) {
      notify(`${copy('import_failed', 'Import failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
    } finally {
      finishBackupAction('folder-import')
    }
  }

  const activeBackupJobRunning = ['queued', 'running', 'cancelling'].includes(String(activeJob?.status || '').toLowerCase())

  const cancelActiveBackupJob = useCallback(async (job: BackupJob) => {
    if (!job?.id || actionLockRef.current) return
    if (!beginBackupAction('cancel')) return
    try {
      const result = await withLoaderTimeout(
        () => getBackupApi().cancelSystemJob?.(job.id!, 'Cancelled from Backup page'),
        'Cancel backup job',
        SYSTEM_JOB_CANCEL_TIMEOUT_MS,
      )
      const nextJob = unwrapJob(result)
      if (nextJob && aliveRef.current) {
        activeJobSignatureRef.current = getJobSignature(nextJob)
        setActiveJob(nextJob)
      }
      notify(copy('job_cancel_requested', 'Cancel requested'), 'info')
    } catch (error) {
      notify(`${copy('job_cancel_failed', 'Cancel failed')}: ${getErrorMessage(error, copy('unknown_error', 'Unknown error'))}`, 'error')
    } finally {
      finishBackupAction('cancel')
    }
  }, [beginBackupAction, copy, finishBackupAction, notify])

  return (
    <div className="page-scroll p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader
          icon={HardDriveDownload}
          tone="blue"
          title={copy('backup', 'Backup')}
          subtitle={copy('backup_page_subtitle', 'Create, restore, and verify full Business OS backups.', 'បង្កើត ស្ដារ និងពិនិត្យ backup Business OS ពេញលេញ។')}
          historySlot={<ActionHistoryBar history={actionHistory} className="flex-shrink-0" t={t} showLabel />}
        />
        <RestoreMaintenanceBanner copy={copy} notify={notify} />
        {/* Sections get their own full-width row now that History sits next
            to the page-guide icon in PageHeader's row above (per explicit
            user direction: the icon explaining what this page does, then
            History, both on the left) instead of sharing this row with the
            section pills. */}
        <div className="flex min-w-0 items-center gap-2">
          <SectionSwitcher
            label=""
            className="min-w-0 flex-1"
            options={backupSectionOptions}
            value={backupSection}
            onChange={handleBackupSectionChange}
          />
        </div>
        <LoadingWatchdog
          loading={!!loading}
          timeoutMs={9000}
          label={copy('checking', 'Checking...')}
          details={loading ? `Backup operation: ${loading}` : ''}
          onRetry={() => setLoading('')}
        />
        <JobProgressCard job={activeJob} copy={copy} onClear={() => setActiveJob(null)} onCancel={cancelActiveBackupJob} />
          {backupSection === 'all' ? <MemoBackupOverview copy={copy} onSelect={setBackupSection} /> : null}
          {showBackupSection('doctor') ? (
          <MemoIntegrationDoctorCard copy={copy} notify={notify} active={isActive} />
          ) : null}
        {showBackupSection('export') ? (
        <div className="card p-5 sm:p-6" data-testid="backup-export-section">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <FolderOutput className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {copy('export_backup_title', 'Export backup')}
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {copy('export_backup_desc', 'Create a full Cloudflare backup in R2 with D1 data, settings, users, portal records, inventory, sales, returns, and restore metadata. Automatic Cloudflare backups run every 6 hours and keep the newest 2.')}
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
              <PrimaryActionButton data-testid="backup-export-create" onClick={handleFolderExport} disabled={!!loading || activeBackupJobRunning}>
                <ArchiveRestore className="h-4 w-4" />
                {loading === 'folder-export' ? copy('exporting', 'Exporting...') : copy('export_backup_btn', 'Export')}
              </PrimaryActionButton>
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {folderExportPath
                ? copy('backup_custom_path_note', 'Export will still use R2; the value below is treated as an optional label.')
                : copy('backup_default_path_note', 'Export uses R2 backups/cloudflare/ automatically. No folder choice is needed.')}
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
                    placeholder={copy('folder_backup_placeholder', 'Leave blank to use R2 backups/cloudflare/')}
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
        <div className="card p-5 sm:p-6" data-testid="backup-restore-section">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <FolderInput className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {copy('import_backup_title', 'Restore backup')}
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {copy('import_backup_desc', 'Restore a full Business OS backup from R2. This overwrites current D1 data including settings, users, portal records, products, stock, sales, returns, and custom tables.')}
          </p>

          <div className="grid gap-3 rounded-2xl border border-amber-100 bg-amber-50/70 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <PrimaryActionButton data-testid="backup-restore-start" onClick={handleFolderImport} disabled={!!loading || activeBackupJobRunning}>
                <Download className="h-4 w-4" />
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
                    placeholder={copy('folder_restore_placeholder', 'business-os-cloudflare-YYYYMMDD-HHmmssZ.json')}
                  />
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {copy('server_restore_note', 'Restore uses an R2 backup key from backups/cloudflare/. It validates the backup format before replacing D1 rows.')}
                </p>
              </div>
            </details>
          </div>

        </div>
        ) : null}

        {isActive && showBackupSection('drive') ? <MemoGoogleDriveSyncSection t={t} notify={notify} active={isActive} actionHistory={actionHistory} /> : null}
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
            <Suspense
              fallback={(
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-300">
                  {copy('loading', 'Loading...')}
                </div>
              )}
            >
              {/* Was: all three tools (Section Reset, Data Reset, Factory
                  Reset) stacked and fully rendered at once under this one
                  toggle -- three separate mode-grids-with-full-descriptions
                  laid out flat, which is the "too text heavy" complaint on
                  the open backlog. Now a tier picker gates which single
                  tool renders below, ordered least-to-most destructive so
                  the safest tool is the default first thing shown, same
                  "pick one to reveal its options" pattern just applied to
                  each tool's own mode grid above (see ResetData.tsx). */}
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {MAINTENANCE_TIERS.map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setMaintenanceTier(tier.id)}
                      className={`rounded-xl border-2 p-3 text-left text-sm transition-colors ${
                        maintenanceTier === tier.id
                          ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                          : 'border-gray-200 hover:border-red-300 dark:border-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-200">
                        <tier.icon className="h-4 w-4 shrink-0" />
                        {copy(tier.labelKey, tier.label)}
                      </div>
                      {maintenanceTier === tier.id ? (
                        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{copy(tier.hintKey, tier.hint)}</div>
                      ) : null}
                    </button>
                  ))}
                </div>
                {maintenanceTier === 'section' ? <LazySectionReset actionHistory={actionHistory} /> : null}
                {maintenanceTier === 'data' ? <LazyResetData actionHistory={actionHistory} /> : null}
                {maintenanceTier === 'migration' ? <LazyMigrationFinalize actionHistory={actionHistory} /> : null}
                {maintenanceTier === 'factory' ? <LazyFactoryReset actionHistory={actionHistory} /> : null}
              </div>
            </Suspense>
          ) : null}
        </details>
        ) : null}
      </div>
    </div>
  )
}
