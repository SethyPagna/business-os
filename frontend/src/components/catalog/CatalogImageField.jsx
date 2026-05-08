import { Eye, Upload } from 'lucide-react'
import { createInitialUploadState } from '../../utils/mediaUpload.js'

export default function CatalogImageField({
  label,
  value,
  onUpload,
  onChooseExisting,
  onChange,
  onClear,
  onPreview,
  fieldId,
  uploadLabel = 'Upload',
  chooseLabel = 'Files',
  clearLabel = 'Clear',
  previewLabel = 'Preview',
  placeholder = 'https://... or upload below',
  hint = '',
  uploadState = createInitialUploadState(),
  onCancelUpload = null,
  cancelLabel = 'Cancel upload',
  uploadingLabel = 'Uploading...',
  uploadedQueuedLabel = 'Uploaded. Background optimization is running now.',
  uploadedReadyLabel = 'Uploaded and ready.',
}) {
  const rawValue = String(value || '')
  const displayValue = rawValue.startsWith('data:image/') || rawValue.startsWith('blob:')
    ? 'uploaded-image-preview'
    : rawValue
  const isUploading = uploadState?.status === 'uploading'

  return (
    <div className="space-y-2">
      <label htmlFor={fieldId} className="block text-sm font-medium text-slate-700">{label}</label>
      <input id={fieldId} name={fieldId} autoComplete="off" className="input" value={displayValue} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-sm" onClick={onUpload} disabled={isUploading}>
          <Upload className="mr-2 inline h-4 w-4" />
          {isUploading ? uploadingLabel : uploadLabel}
        </button>
        {isUploading && onCancelUpload ? <button type="button" className="btn-secondary text-sm" onClick={onCancelUpload}>{cancelLabel}</button> : null}
        {onChooseExisting ? <button type="button" className="btn-secondary text-sm" onClick={onChooseExisting} disabled={isUploading}>{chooseLabel}</button> : null}
        {value ? (
          <button type="button" className="btn-secondary text-sm" onClick={onPreview} disabled={isUploading}>
            <Eye className="mr-2 inline h-4 w-4" />
            {previewLabel}
          </button>
        ) : null}
        {value ? (
          <button type="button" className="btn-secondary text-sm" onClick={onClear} disabled={isUploading}>
            {clearLabel}
          </button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {isUploading ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          <div className="flex items-center justify-between gap-3">
            <span>{uploadState?.fileName || uploadingLabel}</span>
            <span>{Number(uploadState?.progress || 0)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(6, Number(uploadState?.progress || 0))}%` }} />
          </div>
        </div>
      ) : null}
      {uploadState?.processingStatus && uploadState.processingStatus !== 'idle' && uploadState?.status === 'uploaded' ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {uploadState.processingStatus === 'queued' ? uploadedQueuedLabel : uploadedReadyLabel}
        </div>
      ) : null}
      {uploadState?.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {uploadState.error}
        </div>
      ) : null}
      {value ? (
        <button
          type="button"
          className="block w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900/90"
          onClick={onPreview}
        >
          <div className="portal-image-checker flex h-40 items-center justify-center rounded-2xl p-4">
            <img src={value} alt={label} className="max-h-full max-w-full object-contain" loading="lazy" decoding="async" />
          </div>
        </button>
      ) : null}
    </div>
  )
}
