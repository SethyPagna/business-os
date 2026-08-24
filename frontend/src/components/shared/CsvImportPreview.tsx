import { useState } from 'react'
import { parseCsvRows } from '../../utils/csvImport.ts'

interface CsvImportPreviewProps {
  columnsLabel: string
  columnsText: string
  fileName: string
  csvText: string
  rowCount: number
  analyzing: boolean
  onDownloadTemplate: () => void
  onPickFile: () => void | Promise<void>
  // Fires with the dropped File when the person drags a file onto the
  // no-file / file-picked box below instead of clicking "Choose File".
  // Optional so callers that haven't wired drop handling yet degrade to the
  // previous click-only behavior instead of erroring.
  onDropFile?: (file: File) => void | Promise<void>
  dragLabel?: string
  loading?: boolean
  downloadLabel: string
  pickLabel: string
  analyzingLabel: string
  noFileLabel: string
  previewHeadingLabel: string
  maxPreviewRows?: number
}

/**
 * Replaces the old "paste CSV into a textarea" pattern (redundant once a file
 * picker exists) with a template-preview pattern matching the Products
 * bulk-import UX: a columns reference box, Download Template / Choose File
 * buttons, and a real preview table of the parsed rows so the person can see
 * what will be imported before confirming - no manual pasting.
 */
export default function CsvImportPreview({
  columnsLabel,
  columnsText,
  fileName,
  csvText,
  rowCount,
  analyzing,
  onDownloadTemplate,
  onPickFile,
  onDropFile,
  dragLabel,
  loading = false,
  downloadLabel,
  pickLabel,
  analyzingLabel,
  noFileLabel,
  previewHeadingLabel,
  maxPreviewRows = 5,
}: CsvImportPreviewProps) {
  let previewRows: Record<string, string | number>[] = []
  let previewColumns: string[] = []
  if (csvText) {
    try {
      previewRows = parseCsvRows(csvText).slice(0, maxPreviewRows)
      previewColumns = previewRows.length ? Object.keys(previewRows[0]) : []
    } catch (_) {
      previewRows = []
      previewColumns = []
    }
  }

  // Only tracks visual state (border highlight) -- the actual file handoff
  // happens in onDrop below, which fires regardless of whether this ever
  // got set (e.g. a fast drag that skips the dragenter event in some
  // browsers still delivers a drop event with the file).
  const [isDragActive, setIsDragActive] = useState(false)
  const dropEnabled = typeof onDropFile === 'function' && !loading

  const handleDragOver: React.DragEventHandler<HTMLDivElement> = (event) => {
    if (!dropEnabled) return
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(true)
  }
  const handleDragLeave: React.DragEventHandler<HTMLDivElement> = (event) => {
    if (!dropEnabled) return
    event.preventDefault()
    setIsDragActive(false)
  }
  const handleDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
    if (!dropEnabled) return
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(false)
    const file = event.dataTransfer?.files?.[0]
    if (file) void onDropFile?.(file)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
        <p className="mb-1 font-semibold">{columnsLabel}</p>
        <p className="font-mono text-xs leading-relaxed break-all">{columnsText}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary flex-1 text-sm" onClick={onDownloadTemplate}>
          {downloadLabel}
        </button>
        <button type="button" className="btn-primary flex-1 text-sm" onClick={onPickFile} disabled={loading}>
          {pickLabel}
        </button>
      </div>
      {fileName ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-xl border px-3 py-2 text-sm text-gray-600 transition-colors dark:text-gray-300 ${
            isDragActive
              ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          {fileName}
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-xl border border-dashed px-3 py-4 text-center text-sm transition-colors ${
            isDragActive
              ? 'border-blue-400 bg-blue-50 text-blue-500 dark:border-blue-600 dark:bg-blue-900/20 dark:text-blue-300'
              : 'border-gray-300 text-gray-400 dark:border-gray-700 dark:text-gray-500'
          }`}
        >
          {isDragActive && dragLabel ? dragLabel : noFileLabel}
        </div>
      )}
      {csvText ? (
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{previewHeadingLabel}</span>
            <span>{analyzing ? analyzingLabel : rowCount}</span>
          </div>
          {previewRows.length ? (
            <div className="max-h-56 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                  <tr>
                    {previewColumns.map((col) => (
                      <th key={col} className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-500 dark:text-slate-400">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={index} className="border-t border-gray-100 dark:border-gray-800">
                      {previewColumns.map((col) => (
                        <td key={col} className="whitespace-nowrap px-2 py-1.5 text-slate-600 dark:text-slate-300">
                          {String(row[col] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
