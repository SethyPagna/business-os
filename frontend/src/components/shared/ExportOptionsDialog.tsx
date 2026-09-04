import { useMemo, useState } from 'react'
import Modal from './Modal'
import {
  exportColumnLabel,
  loadRememberedColumns,
  openPrintExport,
  projectExportRows,
  saveRememberedColumns,
  type ExportColumn,
} from '../../utils/exportOptions.ts'

// H1 + X5 (Part 401): ONE export dialog for every page -- a column chooser
// (defaults pre-checked, the chosen set remembered per surface) and the
// format choice: CSV, Excel, or PDF (a clean print view; the platform's
// print dialog saves as PDF -- no PDF library, works offline, system Khmer
// fonts). Pages hand in their already-scoped rows (visible / selected /
// filtered), so scope stays the caller's concern and this stays one thing.

type TranslateFn = (key: string) => string | undefined

export type ExportFormat = 'csv' | 'xlsx' | 'pdf'

interface ExportOptionsDialogProps {
  title: string
  fileBaseName: string
  columns: ExportColumn[]
  rows: Array<Record<string, unknown>>
  rememberKey: string
  t: TranslateFn
  onClose: () => void
  notify?: (message: string, tone?: string) => void
}

function tr(t: TranslateFn, key: string, fallback: string): string {
  return t(key) || fallback
}

export default function ExportOptionsDialog({
  title,
  fileBaseName,
  columns,
  rows,
  rememberKey,
  t,
  onClose,
  notify,
}: ExportOptionsDialogProps) {
  const defaults = useMemo(
    () => new Set(columns.filter((column) => column.defaultSelected !== false).map((column) => column.key)),
    [columns],
  )
  const [selected, setSelected] = useState<Set<string>>(() => loadRememberedColumns(rememberKey, columns) || new Set(defaults))
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [busy, setBusy] = useState(false)

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const runExport = async () => {
    if (!selected.size) {
      notify?.(tr(t, 'export_pick_columns', 'Pick at least one column.'), 'error')
      return
    }
    setBusy(true)
    try {
      const projected = projectExportRows(rows, columns, selected)
      const stamp = new Date().toISOString().slice(0, 10)
      const filename = `${fileBaseName}-${stamp}`
      if (format === 'csv') {
        const { downloadCSV } = await import('../../utils/csv.ts')
        downloadCSV(`${filename}.csv`, projected)
      } else if (format === 'xlsx') {
        const { downloadXLSX } = await import('../../utils/xlsxExport.ts')
        downloadXLSX(`${filename}.xlsx`, projected)
      } else {
        const headers = columns.filter((column) => selected.has(column.key)).map((column) => column.label)
        const opened = openPrintExport({
          title,
          subtitle: `${rows.length} ${tr(t, 'records', 'records')} · ${stamp}`,
          headers,
          rows: projected,
        })
        if (!opened) {
          notify?.(tr(t, 'export_popup_blocked', 'The print view was blocked -- allow pop-ups for this site and try again.'), 'error')
          return
        }
      }
      saveRememberedColumns(rememberKey, selected)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const formatButton = (value: ExportFormat, label: string, hint: string) => (
    <button
      type="button"
      onClick={() => setFormat(value)}
      aria-pressed={format === value}
      className={`flex-1 rounded-xl border-2 px-3 py-2 text-left transition ${format === value
        ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30'
        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900'}`}
    >
      <span className="block text-sm font-semibold text-slate-900 dark:text-white">{label}</span>
      <span className="mt-0.5 block text-[11px] leading-tight text-slate-500 dark:text-slate-400">{hint}</span>
    </button>
  )

  return (
    <Modal title={title} onClose={onClose} unsavedChanges="read-only">
      <div className="space-y-3">
        <div className="flex gap-2">
          {formatButton('xlsx', tr(t, 'export_format_excel', 'Excel'), tr(t, 'export_format_excel_hint', '.xlsx — opens in Excel, Khmer-safe'))}
          {formatButton('csv', tr(t, 'export_format_csv', 'CSV'), tr(t, 'export_format_csv_hint', '.csv — for re-import/machines; opening in Excel can break barcodes'))}
          {formatButton('pdf', tr(t, 'export_format_pdf', 'PDF'), tr(t, 'export_format_pdf_hint', 'Print view — save as PDF or print'))}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {tr(t, 'export_columns', 'Columns')}
              <span className="ml-1.5 font-normal normal-case text-slate-400">{selected.size}/{columns.length}</span>
            </span>
            <span className="flex gap-2 text-xs">
              <button type="button" className="font-medium text-blue-600 hover:underline dark:text-blue-400" onClick={() => setSelected(new Set(columns.map((column) => column.key)))}>
                {tr(t, 'select_all', 'Select all')}
              </button>
              <button type="button" className="font-medium text-slate-500 hover:underline dark:text-slate-400" onClick={() => setSelected(new Set(defaults))}>
                {tr(t, 'export_defaults', 'Defaults')}
              </button>
            </span>
          </div>
          <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-slate-200 p-2 sm:grid-cols-3 dark:border-slate-700">
            {columns.map((column) => (
              <label key={column.key} className="flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded"
                  checked={selected.has(column.key)}
                  onChange={() => toggle(column.key)}
                />
                <span className="truncate" title={column.label}>{column.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {rows.length} {tr(t, 'records', 'records')}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={onClose} disabled={busy}>
              {tr(t, 'cancel', 'Cancel')}
            </button>
            <button type="button" className="btn-primary px-4 py-2 text-sm" onClick={runExport} disabled={busy || rows.length === 0}>
              {busy ? tr(t, 'exporting', 'Exporting…') : tr(t, 'export', 'Export')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export { exportColumnLabel, type ExportColumn }
