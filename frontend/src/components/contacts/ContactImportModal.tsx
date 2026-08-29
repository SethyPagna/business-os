import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import ModalBase from '../shared/Modal'
import FilePickerModal from '../files/FilePickerModal'
import AppSelect from '../shared/AppSelect.tsx'
import ContactImportConflictsModal from './ContactImportConflictsModal'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { resolvePublicAssetUrl } from '../../utils/publicAssetUrls.ts'
import { withLoaderTimeout } from '../../utils/loaders.ts'
import { countCsvDataRows } from '../../utils/csvRowCounter.ts'
import { parseImportFile } from '../../utils/spreadsheetImport.ts'
import { getBlankCsvHeaderColumns } from '../../utils/csvImport.ts'
import { getImportJob, approveImportJob } from '../../api/importJobsTransport.ts'
import { decideContactImportPostStartAction, type ContactImportPostStartJob } from './contactImportPostStartFlow.ts'

type TranslateFn = (key: string) => string | undefined

type ContactImportType = 'customer' | 'supplier' | 'deliveryContact'
type ContactImportJobType = 'customers' | 'suppliers' | 'delivery_contacts'
type ConflictMode = 'skip' | 'merge' | 'overwrite'
type ContactRulePreset = 'merge_blank_only' | 'keep_existing' | 'use_imported'
type ContactFieldRule = ContactRulePreset
type NotifyFn = (message: string, tone?: string) => void

interface ContactImportConfig {
  label: string
  labelKey: string
  jobType: ContactImportJobType
  fields: string[]
}

interface ContactImportResult {
  imported: number
  updated: number
  failed: number
  queued: number
  jobId: string | number
  errors: string[]
  conflictMode: ConflictMode
}

interface ContactImportModalProps {
  type: ContactImportType
  onClose: () => void
  onDone?: (payload?: ContactImportResult) => void | Promise<void>
}

interface AppContextValue {
  notify: NotifyFn
  t: TranslateFn
}

interface CsvDialogResult {
  content?: string | null
  name?: string | null
}

interface ImportJob {
  id?: string | number | null
}

interface ImportJobResponse extends ImportJob {
  job?: ImportJob | null
}

interface ContactImportApi {
  openCSVDialog?: () => Promise<CsvDialogResult | null | undefined>
  downloadImportTemplate: (type: ContactImportType) => void
  createImportJob: (payload: {
    type: ContactImportJobType
    policy: {
      source: 'contacts_modal'
      conflictMode: ConflictMode
      fieldRules: ContactFieldRules
    }
  }) => Promise<ImportJobResponse>
  uploadImportJobCsv: (payload: { jobId: string | number; text: string; fileName: string }) => Promise<unknown>
  startImportJob: (jobId: string | number) => Promise<unknown>
}

interface ContactImportWorkerMessage {
  id?: string
  type?: 'result' | 'error'
  rowCount?: number | string
  error?: string
}

interface FileAsset {
  mime_type?: string
  original_name?: string
}

type ContactFieldRules = {
  __preset?: ContactRulePreset
} & Record<string, ContactFieldRule | undefined>

const CONTACT_IMPORT_CONFIG = {
  customer: {
    label: 'Customers',
    labelKey: 'contacts_import_type_customers',
    jobType: 'customers',
    // gender and created_date added per explicit user direction, matching
    // downloadCustomerTemplate's own template columns -- see that
    // function's comment for what each accepts and how created_date
    // behaves on a matched-existing-customer row (it's a no-op there,
    // never overwriting that customer's real original join date). Same
    // gender/created_date pair is now offered for suppliers and delivery
    // contacts below too, matching classifyContacts (importEngine.ts),
    // which parses `created_date` identically for all three tables.
    fields: ['name', 'membership_number', 'contact_options', 'phone', 'email', 'address', 'gender', 'created_date', 'notes'],
  },
  supplier: {
    label: 'Suppliers',
    labelKey: 'contacts_import_type_suppliers',
    jobType: 'suppliers',
    fields: ['name', 'contact_options', 'phone', 'email', 'address', 'company', 'contact_person', 'gender', 'created_date', 'notes'],
  },
  deliveryContact: {
    label: 'Delivery',
    labelKey: 'contacts_import_type_delivery',
    jobType: 'delivery_contacts',
    fields: ['name', 'contact_options', 'phone', 'area', 'address', 'gender', 'created_date', 'notes'],
  },
} satisfies Record<ContactImportType, ContactImportConfig>

const CONTACT_IMPORT_JOB_CREATE_TIMEOUT_MS = 12000
const CONTACT_IMPORT_JOB_UPLOAD_TIMEOUT_MS = 30000
const CONTACT_IMPORT_JOB_START_TIMEOUT_MS = 12000
const CONTACT_IMPORT_ROW_COUNT_TIMEOUT_MS = 5000

// Part 313 item 5 / Part 254 follow-up: fold conflict resolution into the
// SAME modal session instead of a separate floating-widget side door (see
// contactImportPostStartFlow.ts's own header comment for the full "why").
// This is a bounded FOREGROUND poll of the one job this modal just
// created, only while the modal itself stays open -- not a replacement
// for BackgroundImportTracker's own list polling, which still owns the
// job the instant this modal closes or this poll gives up. 1.5s interval,
// 80 attempts (~2 minutes) covers the realistic analyze-phase duration
// for a Contacts job (classifyContacts, not chunked on this path); past
// that, fall back to the pre-existing "closes with a toast, review from
// the top bar" behavior rather than blocking the operator indefinitely.
const CONTACT_IMPORT_POST_START_POLL_MS = 1500
const CONTACT_IMPORT_POST_START_MAX_ATTEMPTS = 80

const Modal = ModalBase
const useApp = useAppHook as () => AppContextValue

function getContactImportApi(): ContactImportApi {
  if (!window.api) throw new Error('Contact import API is not available.')
  return window.api as ContactImportApi
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function countCsvDataRowsInWorker(text: string): Promise<number> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(countCsvDataRows(text))
  }

  return new Promise<number>((resolve, reject) => {
    const id = `contact-import-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const worker = new Worker(new URL('./contactImportWorker.ts', import.meta.url), { type: 'module' })
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('Contact import row count timed out'))
    }, CONTACT_IMPORT_ROW_COUNT_TIMEOUT_MS)
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      worker.terminate()
    }

    worker.onmessage = (event: MessageEvent<ContactImportWorkerMessage>) => {
      const message = event.data || {}
      if (message.id !== id) return
      cleanup()
      if (message.type === 'result') resolve(Number(message.rowCount || 0))
      else reject(new Error(message.error || 'Contact import row count failed'))
    }
    worker.onerror = (error: ErrorEvent) => {
      cleanup()
      reject(new Error(error.message || 'Contact import worker failed'))
    }
    worker.postMessage({ id, text })
  })
}

export default function ContactImportModal({ type, onClose, onDone }: ContactImportModalProps) {
  const { notify, t } = useApp()
  const tr = (key: string, fallbackEn: string): string => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallbackEn
  }
  const config = CONTACT_IMPORT_CONFIG[type]
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [conflictMode, setConflictMode] = useState<ConflictMode>('merge')
  const [fieldRules, setFieldRules] = useState<ContactFieldRules>({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ContactImportResult | null>(null)
  const [filesOpen, setFilesOpen] = useState(false)
  const [rowCount, setRowCount] = useState(0)
  const [analyzingCsv, setAnalyzingCsv] = useState(false)
  // Visual-only (border highlight while a drag is over the drop target) --
  // matches the same split used by CsvImportPreview and BulkImportModal:
  // the actual file handoff happens in handleDropFile via onDrop below.
  const [isDragActive, setIsDragActive] = useState(false)
  const aliveRef = useRef(true)
  const inFlightRef = useRef(false)
  const rowCountRequestRef = useRef(0)
  // 'idle': the normal upload form (everything below, unchanged).
  // 'polling': job created/uploaded/started, waiting on the server's
  //   analyze phase -- see CONTACT_IMPORT_POST_START_POLL_MS's comment.
  // 'conflicts': analyze finished with name-match rows needing a decision
  //   -- renders ContactImportConflictsModal in this same modal's slot
  //   (swapped, not stacked -- same pattern ImportModeWizard already uses
  //   for its own launched-modal handoff).
  // 'ready_to_approve': analyze finished clean (or conflicts were just
  //   resolved) -- one Approve button, right here, no second surface to
  //   go find.
  const [postStartStep, setPostStartStep] = useState<'idle' | 'polling' | 'conflicts' | 'ready_to_approve'>('idle')
  const [postStartJobId, setPostStartJobId] = useState<string | number | null>(null)
  const [approving, setApproving] = useState(false)
  const pollTimeoutRef = useRef<number | null>(null)
  const pollAttemptRef = useRef(0)
  const pollGenerationRef = useRef(0)
  // Direct-apply: fire the approve once when a clean (no-conflict) import is
  // ready, so the operator doesn't click a second "approve now". Reset per run.
  const autoApproveAttemptedRef = useRef(false)

  const stopPostStartPoll = () => {
    pollGenerationRef.current += 1
    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }
  }

  useEffect(() => () => stopPostStartPoll(), [])

  // Falls back to the original (pre-Part-316) behavior: close the wait
  // step, tell the operator it's queued, hand off to the top progress
  // bar/BackgroundImportTracker exactly as before. Used both when the
  // operator explicitly chooses to stop waiting and when the bounded poll
  // above gives up -- same outcome either way, nothing regresses.
  const fallBackToBackgroundTracking = async (queuedRowCount: number, jobId: string | number, mode: ConflictMode): Promise<void> => {
    stopPostStartPoll()
    const response: ContactImportResult = { imported: 0, updated: 0, failed: 0, queued: queuedRowCount, jobId, errors: [], conflictMode: mode }
    if (!aliveRef.current) return
    setResult(response)
    setPostStartStep('idle')
    setPostStartJobId(null)
    await signalDone(response)
    notify(tr('contacts_import_started', 'Import analysis started: {count} row(s) queued. Review and approve it from the top progress bar.').replace('{count}', String(queuedRowCount)), 'success')
  }

  const pollPostStartJob = (jobId: string | number, queuedRowCount: number, mode: ConflictMode): void => {
    const generation = pollGenerationRef.current
    pollAttemptRef.current += 1
    getImportJob(jobId)
      .then((raw) => {
        if (!aliveRef.current || generation !== pollGenerationRef.current) return
        const action = decideContactImportPostStartAction(raw as ContactImportPostStartJob)
        if (action.kind === 'show_conflicts') {
          setPostStartStep('conflicts')
          return
        }
        if (action.kind === 'ready_to_approve') {
          setPostStartStep('ready_to_approve')
          return
        }
        if (action.kind === 'terminal') {
          void fallBackToBackgroundTracking(queuedRowCount, jobId, mode)
          return
        }
        if (pollAttemptRef.current >= CONTACT_IMPORT_POST_START_MAX_ATTEMPTS) {
          void fallBackToBackgroundTracking(queuedRowCount, jobId, mode)
          return
        }
        pollTimeoutRef.current = window.setTimeout(() => pollPostStartJob(jobId, queuedRowCount, mode), CONTACT_IMPORT_POST_START_POLL_MS)
      })
      .catch(() => {
        if (!aliveRef.current || generation !== pollGenerationRef.current) return
        // A transient read failure here shouldn't strand the operator on
        // a spinner forever -- keep retrying up to the same attempt cap,
        // same as a "still analyzing" response would.
        if (pollAttemptRef.current >= CONTACT_IMPORT_POST_START_MAX_ATTEMPTS) {
          void fallBackToBackgroundTracking(queuedRowCount, jobId, mode)
          return
        }
        pollTimeoutRef.current = window.setTimeout(() => pollPostStartJob(jobId, queuedRowCount, mode), CONTACT_IMPORT_POST_START_POLL_MS)
      })
  }

  const handleApproveNow = async (jobId: string | number, queuedRowCount: number, mode: ConflictMode) => {
    setApproving(true)
    try {
      await approveImportJob(jobId, { source: 'contacts_modal' })
      const response: ContactImportResult = { imported: 0, updated: 0, failed: 0, queued: queuedRowCount, jobId, errors: [], conflictMode: mode }
      if (!aliveRef.current) return
      setResult(response)
      setPostStartStep('idle')
      setPostStartJobId(null)
      await signalDone(response)
      notify(tr('contacts_import_approved', 'Approved -- applying now. Progress is shown in the top progress bar.'), 'success')
    } catch (error) {
      if (!aliveRef.current) return
      notify(getErrorMessage(error, tr('import_apply_failed', 'Could not approve import')), 'error')
    } finally {
      if (aliveRef.current) setApproving(false)
    }
  }

  // Direct-apply: a clean import (analysis found nothing to resolve) reaches
  // 'ready_to_approve' -- approve it automatically instead of waiting for a
  // second "approve now" click. Conflicts route to 'conflicts' (the merge
  // screen) instead and are unaffected, so real phone/name matches are still
  // resolved by hand.
  useEffect(() => {
    if (postStartStep !== 'ready_to_approve' || postStartJobId === null) return
    if (approving || autoApproveAttemptedRef.current) return
    autoApproveAttemptedRef.current = true
    void handleApproveNow(postStartJobId, rowCount, conflictMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postStartStep, postStartJobId])

  const signalDone = async (payload: ContactImportResult): Promise<void> => {
    if (typeof onDone === 'function') {
      await Promise.resolve(onDone(payload))
    }
  }

  const typeLabel = tr(config?.labelKey || '', config?.label || 'Contacts')
  const fieldList = config?.fields || []

  useEffect(() => () => {
    aliveRef.current = false
  }, [])

  const loadCsvText = async (text: unknown, name: unknown): Promise<void> => {
    const nextText = String(text || '')
    const requestId = rowCountRequestRef.current + 1
    rowCountRequestRef.current = requestId
    setCsvText(nextText)
    setFileName(String(name || 'contacts.csv'))
    setRowCount(0)
    setResult(null)
    setAnalyzingCsv(true)
    let nextCount = 0
    try {
      nextCount = await countCsvDataRowsInWorker(nextText)
    } catch (_) {
      nextCount = countCsvDataRows(nextText)
    }
    if (!aliveRef.current || rowCountRequestRef.current !== requestId) return
    setRowCount(nextCount)
    setAnalyzingCsv(false)
    if (!nextCount) notify(tr('contacts_import_choose_rows', 'Choose a CSV with at least one data row.'), 'error')
    // Real-file audit (Aug 23 2026) -- see getBlankCsvHeaderColumns' own
    // comment in csvImport.ts: a blank-header column with real data under
    // it (found via the user's own uploaded customers-template-final.csv,
    // which had a phone-number column with a deleted header) silently
    // loses that column's data on import, backend-side, with no signal
    // otherwise. Contacts import has no review-before-commit step like
    // Products does, so this is a heads-up toast at load time rather than
    // a persistent warning banner -- non-blocking, matches this modal's
    // existing pattern (the zero-row check just above).
    else {
      const blankColumns = getBlankCsvHeaderColumns(nextText)
      if (blankColumns.length) {
        notify(
          tr(
            'contacts_import_blank_header_columns',
            `Column${blankColumns.length > 1 ? 's' : ''} ${blankColumns.join(', ')} ${blankColumns.length > 1 ? 'have' : 'has'} no header but ${blankColumns.length > 1 ? 'contain' : 'contains'} data -- that data will be skipped on import. Add a header name to that column, or remove it, then re-upload.`,
          ),
          'warning',
        )
      }
    }
  }

  const handlePickFile = async (): Promise<void> => {
    const picked = await getContactImportApi().openCSVDialog?.()
    if (!picked?.content) return
    await loadCsvText(picked.content, picked.name || 'contacts.csv')
  }

  // Drag-and-drop counterpart to handlePickFile: same loadCsvText analysis
  // path, just a File handed over by the browser's drop event instead of
  // one returned by the native file-dialog. parseImportFile handles both
  // real CSV/TSV and real Excel (.xlsx/.xls/.xlsm) drops, matching the
  // other import modals (products, inventory, sales).
  const handleDropFile = async (file: File): Promise<void> => {
    try {
      const parsed = await parseImportFile(file)
      if (!parsed?.content) return
      await loadCsvText(parsed.content, parsed.name || file.name || 'contacts.csv')
    } catch (error) {
      notify(getErrorMessage(error, tr('contacts_import_drop_failed', 'Could not read that file.')), 'error')
    }
  }

  const handleDragOverCSV = (event: React.DragEvent<HTMLDivElement>) => {
    if (loading) return
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(true)
  }
  const handleDragLeaveCSV = (event: React.DragEvent<HTMLDivElement>) => {
    if (loading) return
    event.preventDefault()
    setIsDragActive(false)
  }
  const handleDropCSVEvent = (event: React.DragEvent<HTMLDivElement>) => {
    if (loading) return
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(false)
    const file = event.dataTransfer?.files?.[0]
    if (file) void handleDropFile(file)
  }

  const handleChooseExistingFile = async (publicPath: string, asset: FileAsset): Promise<void> => {
    const path = String(publicPath || '').trim()
    if (!path) return
    if (!/\.csv($|\?)/i.test(path) && asset?.mime_type !== 'text/csv') {
      notify(tr('contacts_import_choose_csv_from_files', 'Choose a CSV file from Files.'), 'error')
      return
    }
    try {
      const headers = { 'bypass-tunnel-reminder': 'true' }
      const response = await fetch(resolvePublicAssetUrl(path), { headers, credentials: 'include' })
      if (!response.ok) throw new Error(`Could not read ${asset?.original_name || path}`)
      await loadCsvText(await response.text(), asset?.original_name || path.split('/').pop() || 'contacts.csv')
    } catch (error) {
      notify(getErrorMessage(error, tr('contacts_import_load_failed', 'Failed to load CSV from Files')), 'error')
    }
  }

  const handleDownloadTemplate = () => {
    getContactImportApi().downloadImportTemplate(type)
  }

  const applyContactRulePreset = (preset: ContactRulePreset) => {
    const rule = preset === 'use_imported'
      ? 'use_imported'
      : preset === 'keep_existing'
        ? 'keep_existing'
        : 'merge_blank_only'
    const fields = fieldList.filter((field) => field !== 'name')
    setFieldRules({ __preset: preset, ...Object.fromEntries(fields.map((field) => [field, rule])) })
  }

  const handleImport = async () => {
    if (!config?.jobType) {
      notify(tr('contacts_import_unsupported_type', 'Unsupported import type'), 'error')
      return
    }
    if (analyzingCsv) {
      notify(tr('contacts_import_wait_row_check', 'Wait for the CSV row check to finish.'), 'error')
      return
    }
    if (!rowCount) {
      notify(tr('contacts_import_choose_file_first', 'Choose a CSV file first.'), 'error')
      return
    }
    if (!beginSingleAction(inFlightRef)) return

    setLoading(true)
    try {
      const api = getContactImportApi()
      const created = await withLoaderTimeout(
        () => api.createImportJob({
          type: config.jobType,
          policy: {
            source: 'contacts_modal',
            conflictMode,
            fieldRules,
          },
        }),
        'Contact import job',
        CONTACT_IMPORT_JOB_CREATE_TIMEOUT_MS,
      )
      const job = created?.job || created
      if (!job?.id) throw new Error('Import job was not created')
      const jobId = job.id
      await withLoaderTimeout(
        () => api.uploadImportJobCsv({
          jobId,
          text: csvText,
          fileName: fileName || `${config.jobType}.csv`,
        }),
        'Contact import CSV upload',
        CONTACT_IMPORT_JOB_UPLOAD_TIMEOUT_MS,
      )
      await withLoaderTimeout(
        () => api.startImportJob(jobId),
        'Contact import start',
        CONTACT_IMPORT_JOB_START_TIMEOUT_MS,
      )
      if (!aliveRef.current) return
      // Part 313 item 5: don't close here. Stay open and poll this one
      // job's own status so conflict resolution (if any) happens as the
      // next step of THIS session, instead of a separate discovery in
      // BackgroundImportTracker's floating widget later.
      autoApproveAttemptedRef.current = false
      setPostStartJobId(jobId)
      setPostStartStep('polling')
      pollAttemptRef.current = 0
      pollGenerationRef.current += 1
      pollPostStartJob(jobId, rowCount, conflictMode)
    } catch (error) {
      if (!aliveRef.current) return
      notify(getErrorMessage(error, tr('import_failed', 'Import failed')), 'error')
    } finally {
      finishSingleAction(inFlightRef)
      if (aliveRef.current) setLoading(false)
    }
  }

  // Analyze finished with name-match conflicts -- swap this modal's own
  // upload form out for the conflicts review, in the SAME modal slot
  // (not stacked on top of it), then land on the Approve step below once
  // the operator clicks Done there. Reuses ContactImportConflictsModal
  // completely unchanged (including its own Part 314 decision-echo/
  // bulk-actions/pointer-events fixes) -- nothing about that component
  // was touched to make this work.
  if (postStartStep === 'conflicts' && postStartJobId !== null) {
    return (
      <ContactImportConflictsModal
        jobId={postStartJobId}
        entityLabel={typeLabel}
        t={t}
        notify={notify}
        onClose={() => void fallBackToBackgroundTracking(rowCount, postStartJobId, conflictMode)}
        onConfirm={() => handleApproveNow(postStartJobId, rowCount, conflictMode)}
        confirming={approving}
      />
    )
  }

  return (
    <Modal title={tr('contacts_import_title', 'Import {type}').replace('{type}', typeLabel)} onClose={onClose} wide draggable>
      {postStartStep === 'polling' ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-gray-500 dark:text-gray-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 dark:border-zinc-700" />
            <p className="text-sm">{tr('contacts_import_checking_conflicts', 'Checking for name conflicts...')}</p>
            <p className="text-xs">{tr('contacts_import_checking_conflicts_hint', 'This can take a moment for a large contact list. You can keep waiting, or let it finish in the background.')}</p>
          </div>
          <div className="flex justify-center">
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => postStartJobId !== null && void fallBackToBackgroundTracking(rowCount, postStartJobId, conflictMode)}
            >
              {tr('contacts_import_continue_in_background', 'Continue in background')}
            </button>
          </div>
        </div>
      ) : postStartStep === 'ready_to_approve' && postStartJobId !== null ? (
        // Direct-apply: the auto-approve effect applies this the moment it's
        // ready, so this is a brief progress state, not a manual approve step.
        <div className="space-y-3 py-6 text-center">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{tr('import_applying_now', 'Importing…')}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{rowCount > 0 ? `${rowCount.toLocaleString()} ${tr('rows', 'rows')}` : tr('import_applying_hint', 'Applying your reviewed import. This closes when it starts.')}</p>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={approving}
            onClick={() => postStartJobId !== null && void fallBackToBackgroundTracking(rowCount, postStartJobId, conflictMode)}
          >
            {tr('contacts_import_continue_in_background', 'Continue in background')}
          </button>
        </div>
      ) : (
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {tr('contacts_import_help', 'Large files are processed in the background. Choose a conflict policy now; the server will validate, match, import, and report row errors without rendering every row.')}
        </p>
        <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
          <p className="mb-1 font-semibold">{tr('csv_columns_header', 'Columns')}</p>
          <p className="font-mono text-xs leading-relaxed break-all">{fieldList.join(', ')}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={handleDownloadTemplate}>
            {t('download_template') || 'Download Template'}
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={handlePickFile}>
            {tr('choose_csv_file', 'Choose CSV or Excel')}
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={() => setFilesOpen(true)}>
            {tr('contacts_import_browse_library', 'Library')}
          </button>
          <div
            onDragOver={handleDragOverCSV}
            onDragLeave={handleDragLeaveCSV}
            onDrop={handleDropCSVEvent}
            className={`min-w-0 flex-1 truncate rounded-lg border px-3 py-2 text-xs transition-colors ${
              isDragActive
                ? 'border-blue-400 bg-blue-50 text-blue-500 dark:border-blue-600 dark:bg-blue-900/20 dark:text-blue-300'
                : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-400'
            }`}
          >
            {isDragActive
              ? tr('contacts_import_drop_file', 'Drop file here to import')
              : fileName || tr('contacts_import_no_file', 'No CSV or Excel file selected')}
          </div>
        </div>

        {rowCount ? (
          <div className="grid gap-2 text-center text-xs sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-2 dark:bg-zinc-800/70">
              <div className="text-lg font-bold text-slate-700 dark:text-slate-200">{analyzingCsv ? '...' : rowCount}</div>
              <div className="text-slate-500 dark:text-slate-400">{analyzingCsv ? tr('contacts_import_checking_rows', 'Checking rows') : tr('contacts_import_rows_queued', 'Rows queued')}</div>
            </div>
            <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-900/20">
              <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{conflictMode}</div>
              <div className="text-blue-600 dark:text-blue-400">{tr('contacts_import_default_conflict_action', 'Default conflict action')}</div>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-900/20">
              <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{tr('contacts_import_job_label', 'Job')}</div>
              <div className="text-emerald-600 dark:text-emerald-400">{tr('contacts_import_background_label', 'Background import')}</div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="contacts-conflict-mode" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tr('contacts_import_default_conflict_action', 'Default conflict action')}
            </label>
            <AppSelect
              id="contacts-conflict-mode"
              name="contacts_conflict_mode"
              value={conflictMode}
              onChange={(nextValue) => setConflictMode(nextValue as ConflictMode)}
              ariaLabel={tr('contacts_import_default_conflict_action', 'Default conflict action')}
              className="w-full"
              buttonClassName="h-10 w-full text-sm"
              menuClassName="min-w-[15rem]"
              optionClassName="text-sm"
              options={[
                { value: 'skip', label: tr('contacts_import_conflict_skip', 'Skip existing records') },
                { value: 'merge', label: tr('contacts_import_conflict_merge', 'Merge into empty fields') },
                { value: 'overwrite', label: tr('contacts_import_conflict_overwrite', 'Overwrite existing records') },
              ]}
            />
          </div>
          <div>
            <label htmlFor="contacts-field-rule-preset" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tr('contacts_import_detail_handling', 'When a matching contact already exists, update it with')}
            </label>
            <AppSelect
              id="contacts-field-rule-preset"
              value={fieldRules.__preset || 'merge_blank_only'}
              onChange={(nextValue) => applyContactRulePreset(nextValue as ContactRulePreset)}
              ariaLabel={tr('contacts_import_detail_handling', 'When a matching contact already exists, update it with')}
              className="w-full"
              buttonClassName="h-10 w-full text-sm"
              menuClassName="min-w-[13rem]"
              optionClassName="text-sm"
              disabled={conflictMode !== 'merge'}
              options={[
                { value: 'merge_blank_only', label: tr('contacts_import_detail_fill_blanks', 'Only fill in blank fields (safest)') },
                { value: 'keep_existing', label: tr('contacts_import_detail_keep_existing', 'Keep the existing value on every field') },
                { value: 'use_imported', label: tr('contacts_import_detail_use_imported', 'Replace with the imported value on every field') },
              ]}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {conflictMode === 'merge'
                ? tr('contacts_import_detail_hint', 'A contact counts as "matching" by same name, phone, email, or membership number. This choice only affects what happens to the fields on that existing contact - it never creates a duplicate.')
                : tr('contacts_import_detail_hint_inactive', 'This only applies when the conflict action above is set to "Merge into empty fields".')}
            </p>
          </div>
        </div>

        {result ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-800/70">
            {result?.queued ? <div>{tr('contacts_import_queued_count', 'Queued: {count} row(s) for analysis. Review and approve it from the top progress bar.').replace('{count}', String(Number(result.queued || 0)))}</div> : null}
            <div>{tr('contacts_import_imported_count', 'Imported: {count}').replace('{count}', String(Number(result?.imported || 0)))}</div>
            <div>{tr('contacts_import_updated_count', 'Updated: {count}').replace('{count}', String(Number(result?.updated || 0)))}</div>
            <div>{tr('contacts_import_failed_count', 'Failed: {count}').replace('{count}', String(Number(result?.failed || 0)))}</div>
            {result?.jobId ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{tr('contacts_import_job_id_label', 'Job: {id}').replace('{id}', String(result.jobId))}</div> : null}
            {Array.isArray(result?.errors) && result.errors.length ? (
              <div className="mt-2 max-h-32 overflow-y-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-300">
                {result.errors.map((message, index) => <div key={`${message}-${index}`}>{message}</div>)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1" disabled={loading || analyzingCsv || !rowCount} onClick={handleImport}>
            {loading ? (t('importing') || 'Importing...') : analyzingCsv ? tr('contacts_import_checking', 'Checking...') : tr('contacts_import_button', 'Import')}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>{t('close') || 'Close'}</button>
        </div>
      </div>
      )}
      <FilePickerModal
        open={filesOpen}
        title={tr('contacts_import_choose_csv_title', 'Choose CSV from Files')}
        mediaType="document"
        onClose={() => setFilesOpen(false)}
        onSelect={handleChooseExistingFile}
      />
    </Modal>
  )
}
