import { useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import FilePickerModal from '../files/FilePickerModal'
import { useApp } from '../../AppContext'
import { resolvePublicAssetUrl } from '../../utils/publicAssetUrls.js'

function countCsvDataRows(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim())
  return Math.max(0, lines.length - 1)
}

const CONTACT_IMPORT_CONFIG = {
  customer: {
    label: 'Customers',
    jobType: 'customers',
    fields: ['name', 'membership_number', 'contact_options', 'phone', 'email', 'address', 'company', 'notes'],
  },
  supplier: {
    label: 'Suppliers',
    jobType: 'suppliers',
    fields: ['name', 'contact_options', 'phone', 'email', 'address', 'company', 'contact_person', 'notes'],
  },
  deliveryContact: {
    label: 'Delivery',
    jobType: 'delivery_contacts',
    fields: ['name', 'contact_options', 'phone', 'area', 'address', 'notes'],
  },
}

export default function ContactImportModal({ type, onClose, onDone }) {
  const { notify } = useApp()
  const config = CONTACT_IMPORT_CONFIG[type]
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [conflictMode, setConflictMode] = useState('merge')
  const [fieldRules, setFieldRules] = useState({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [filesOpen, setFilesOpen] = useState(false)
  const [rowCount, setRowCount] = useState(0)
  const aliveRef = useRef(true)
  const inFlightRef = useRef(false)

  const typeLabel = config?.label || 'Contacts'
  const fieldList = config?.fields || []

  useEffect(() => () => {
    aliveRef.current = false
  }, [])

  const loadCsvText = (text, name) => {
    const nextText = String(text || '')
    const nextCount = countCsvDataRows(nextText)
    setCsvText(nextText)
    setFileName(String(name || 'contacts.csv'))
    setRowCount(nextCount)
    setResult(null)
    if (!nextCount) notify('Choose a CSV with at least one data row.', 'error')
  }

  const handlePickFile = async () => {
    const picked = await window.api.openCSVDialog?.()
    if (!picked?.content) return
    loadCsvText(picked.content, picked.name || 'contacts.csv')
  }

  const handleChooseExistingFile = async (publicPath, asset) => {
    const path = String(publicPath || '').trim()
    if (!path) return
    if (!/\.csv($|\?)/i.test(path) && asset?.mime_type !== 'text/csv') {
      notify('Choose a CSV file from Files.', 'error')
      return
    }
    try {
      const headers = { 'bypass-tunnel-reminder': 'true' }
      const response = await fetch(resolvePublicAssetUrl(path), { headers, credentials: 'include' })
      if (!response.ok) throw new Error(`Could not read ${asset?.original_name || path}`)
      loadCsvText(await response.text(), asset?.original_name || path.split('/').pop() || 'contacts.csv')
    } catch (error) {
      notify(error?.message || 'Failed to load CSV from Files', 'error')
    }
  }

  const handleDownloadTemplate = () => {
    window.api.downloadImportTemplate(type)
  }

  const applyContactRulePreset = (preset) => {
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
      notify('Unsupported import type', 'error')
      return
    }
    if (!rowCount) {
      notify('Choose a CSV file first.', 'error')
      return
    }
    if (inFlightRef.current) return

    inFlightRef.current = true
    setLoading(true)
    try {
      const created = await window.api.createImportJob({
        type: config.jobType,
        policy: {
          source: 'contacts_modal',
          conflictMode,
          fieldRules,
        },
      })
      const job = created?.job || created
      if (!job?.id) throw new Error('Import job was not created')
      await window.api.uploadImportJobCsv({
        jobId: job.id,
        text: csvText,
        fileName: fileName || `${config.jobType}.csv`,
      })
      await window.api.startImportJob(job.id)
      const response = {
        imported: 0,
        updated: 0,
        failed: 0,
        queued: rowCount,
        jobId: job.id,
        errors: [],
        conflictMode,
      }
      if (!aliveRef.current) return
      setResult(response || null)
      notify(`Import analysis started: ${rowCount} row(s) queued. Review and approve it from the top progress bar.`, 'success')
    } catch (error) {
      if (!aliveRef.current) return
      notify(error?.message || 'Import failed', 'error')
    } finally {
      inFlightRef.current = false
      if (aliveRef.current) setLoading(false)
    }
  }

  return (
    <Modal title={`Import ${typeLabel}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Large files are processed in the background. Choose a conflict policy now; the server will validate, match, import, and report row errors without rendering every row.
        </p>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={handleDownloadTemplate}>
            Download template
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={handlePickFile}>
            Choose CSV
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={() => setFilesOpen(true)}>
            Files
          </button>
          <div className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-400">
            {fileName || 'No file selected'}
          </div>
        </div>

        {rowCount ? (
          <div className="grid gap-2 text-center text-xs sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-2 dark:bg-zinc-800/70">
              <div className="text-lg font-bold text-slate-700 dark:text-slate-200">{rowCount}</div>
              <div className="text-slate-500 dark:text-slate-400">Rows queued</div>
            </div>
            <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-900/20">
              <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{conflictMode}</div>
              <div className="text-blue-600 dark:text-blue-400">Default conflict action</div>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-900/20">
              <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">Job</div>
              <div className="text-emerald-600 dark:text-emerald-400">Background import</div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="contacts-conflict-mode" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Default conflict action
            </label>
            <select
              id="contacts-conflict-mode"
              name="contacts_conflict_mode"
              className="input"
              value={conflictMode}
              onChange={(event) => setConflictMode(event.target.value)}
            >
              <option value="skip">Skip existing records</option>
              <option value="merge">Merge into empty fields</option>
              <option value="overwrite">Overwrite existing records</option>
            </select>
          </div>
          <div>
            <label htmlFor="contacts-field-rule-preset" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Contact detail handling
            </label>
            <select
              id="contacts-field-rule-preset"
              className="input"
              value={fieldRules.__preset || 'merge_blank_only'}
              onChange={(event) => applyContactRulePreset(event.target.value)}
            >
              <option value="merge_blank_only">Fill blanks only</option>
              <option value="keep_existing">Keep existing</option>
              <option value="use_imported">Use imported</option>
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Conflicts focus on same name, same phone/email/contact info, and duplicate membership numbers. Blank customer membership IDs stay auto-generated.
            </p>
          </div>
        </div>

        {result ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-800/70">
            {result?.queued ? <div>Queued: {Number(result.queued || 0)} row(s) for analysis. Review and approve it from the top progress bar.</div> : null}
            <div>Imported: {Number(result?.imported || 0)}</div>
            <div>Updated: {Number(result?.updated || 0)}</div>
            <div>Failed: {Number(result?.failed || 0)}</div>
            {result?.jobId ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Job: {result.jobId}</div> : null}
            {Array.isArray(result?.errors) && result.errors.length ? (
              <div className="mt-2 max-h-32 overflow-y-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-300">
                {result.errors.map((message, index) => <div key={`${message}-${index}`}>{message}</div>)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1" disabled={loading || !rowCount} onClick={handleImport}>
            {loading ? 'Importing...' : 'Import'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      <FilePickerModal
        open={filesOpen}
        title="Choose CSV from Files"
        mediaType="document"
        onClose={() => setFilesOpen(false)}
        onSelect={handleChooseExistingFile}
      />
    </Modal>
  )
}
