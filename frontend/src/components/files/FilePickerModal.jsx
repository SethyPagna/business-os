import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp } from '../../AppContext'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

function AssetPreview({ asset }) {
  if (asset?.media_type === 'image') {
    return <img src={asset.public_path} alt={asset.original_name} className="h-24 w-full rounded-xl object-cover" />
  }
  if (asset?.media_type === 'video') {
    return <video src={asset.public_path} className="h-24 w-full rounded-xl object-cover" muted />
  }
  return <div className="flex h-24 w-full items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500">{asset?.mime_type || 'File'}</div>
}

export default function FilePickerModal({
  open,
  onClose,
  onSelect,
  onSelectMany,
  mediaType = 'all',
  title = 'Choose file',
  multiple = false,
  initialSelected = [],
}) {
  const { notify, user, t } = useApp()
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [deletingAssetId, setDeletingAssetId] = useState(null)
  const [selectedPaths, setSelectedPaths] = useState([])
  const inputRef = useRef(null)
  const loadRequestRef = useRef(0)

  const tr = (key, fallback) => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }

  const loadFiles = useCallback(async () => {
    const requestId = beginTrackedRequest(loadRequestRef)
    setLoading(true)
    try {
      const result = await withLoaderTimeout(() => window.api.getFiles({ search, mediaType }), 'Files library picker')
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      setFiles(Array.isArray(result) ? result : (result?.data || []))
    } catch (error) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      notify(error?.message || 'Failed to load files', 'error')
    } finally {
      if (isTrackedRequestCurrent(loadRequestRef, requestId)) setLoading(false)
    }
  }, [mediaType, notify, search])

  useEffect(() => {
    if (!open) return undefined
    setSelectedPaths(Array.isArray(initialSelected) ? initialSelected.filter(Boolean) : [])
    loadFiles()
  }, [initialSelected, loadFiles, open])

  useEffect(() => {
    if (!open) return undefined
    const timer = window.setTimeout(() => { loadFiles() }, 180)
    return () => window.clearTimeout(timer)
  }, [loadFiles, open])

  useEffect(() => () => invalidateTrackedRequest(loadRequestRef), [])

  const accept = useMemo(() => {
    if (mediaType === 'image') return 'image/*'
    if (mediaType === 'video') return 'video/*'
    if (mediaType === 'document') return '.csv,text/csv,application/pdf,.pdf'
    return 'image/*,video/*,.csv,text/csv,application/pdf,.pdf'
  }, [mediaType])

  function toggleSelectedPath(asset) {
    const publicPath = String(asset?.public_path || '').trim()
    if (!publicPath) return
    setSelectedPaths((current) => (
      current.includes(publicPath)
        ? current.filter((entry) => entry !== publicPath)
        : [...current, publicPath]
    ))
  }

  async function handleUpload(event) {
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ''
    if (!selectedFiles.length) return
    setUploading(true)
    try {
      const uploadedAssets = []
      for (const file of selectedFiles) {
        const asset = await window.api.uploadFileAsset({ file, userId: user?.id, userName: user?.name })
        if (asset?.public_path) uploadedAssets.push(asset)
      }
      notify(tr('upload_complete', 'Upload complete'), 'success')
      await loadFiles()
      if (!multiple) {
        const asset = uploadedAssets[0]
        if (asset?.public_path) onSelect?.(asset.public_path, asset)
        onClose()
        return
      }
      if (uploadedAssets.length) {
        setSelectedPaths((current) => {
          const next = new Set(current)
          uploadedAssets.forEach((asset) => {
            if (asset?.public_path) next.add(asset.public_path)
          })
          return Array.from(next)
        })
      }
    } catch (error) {
      notify(error?.message || 'Upload failed', 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(asset) {
    if (!asset?.id || deletingAssetId) return
    if (!asset.canDelete) {
      notify(tr('file_in_use', 'This file is still in use and cannot be deleted.'), 'error')
      return
    }
    if (!window.confirm(`Delete "${asset.original_name}"?`)) return
    setDeletingAssetId(asset.id)
    try {
      await window.api.deleteFileAsset(asset.id, { expectedUpdatedAt: asset.updated_at || undefined })
      notify(tr('file_deleted', 'File deleted'), 'success')
      await loadFiles()
      setSelectedPaths((current) => current.filter((entry) => entry !== asset.public_path))
    } catch (error) {
      notify(error?.message || 'Delete failed', 'error')
    } finally {
      setDeletingAssetId(null)
    }
  }

  if (!open) return null

  const selectedAssets = files.filter((asset) => selectedPaths.includes(asset.public_path))

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr('search_files', 'Search files')} />
          <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()} disabled={uploading || deletingAssetId != null}>
            {uploading ? tr('uploading', 'Uploading...') : tr('upload_file', 'Upload file')}
          </button>
          <input ref={inputRef} type="file" accept={accept} multiple={multiple} className="hidden" onChange={handleUpload} />
        </div>

        {loading ? <div className="py-10 text-center text-sm text-slate-400">{tr('loading', 'Loading...')}</div> : null}
        {!loading && !files.length ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">{tr('no_files_yet', 'No files yet.')}</div> : null}

        {files.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((asset) => {
              const isSelected = selectedPaths.includes(asset.public_path)
              return (
                <div key={asset.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <AssetPreview asset={asset} />
                  <div className="mt-3 min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{asset.original_name}</div>
                    <div className="mt-1 text-xs text-slate-500">{asset.media_type || 'file'}{asset.byte_size ? ` · ${(asset.byte_size / 1024).toFixed(0)} KB` : ''}</div>
                    {asset.usageCount ? <div className="mt-1 text-[11px] text-amber-600">{asset.usageCount} use(s)</div> : <div className="mt-1 text-[11px] text-emerald-600">Unused</div>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {multiple ? (
                      <button type="button" className={`text-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`} onClick={() => toggleSelectedPath(asset)}>
                        {isSelected ? tr('selected', 'Selected') : tr('select', 'Select')}
                      </button>
                    ) : (
                      <button type="button" className="btn-primary text-sm" onClick={() => { onSelect?.(asset.public_path, asset); onClose() }}>
                        {tr('select', 'Select')}
                      </button>
                    )}
                    <button type="button" className="btn-secondary text-sm" onClick={() => navigator.clipboard?.writeText(asset.public_path).catch(() => {})}>
                      {tr('copy', 'Copy')}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      onClick={() => handleDelete(asset)}
                      disabled={!asset.canDelete || deletingAssetId != null}
                    >
                      {deletingAssetId === asset.id ? tr('deleting', 'Deleting...') : tr('delete', 'Delete')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        {multiple ? (
          <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-500">
              {selectedAssets.length ? `${selectedAssets.length} ${tr('files', 'Files').toLowerCase()} ${tr('selected', 'selected').toLowerCase()}` : tr('no_files_selected', 'No files selected')}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={onClose}>
                {tr('cancel', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={!selectedAssets.length}
                onClick={() => {
                  onSelectMany?.(selectedAssets)
                  onClose()
                }}
              >
                {tr('use_selected_files', 'Use selected files')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
