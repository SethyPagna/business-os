import { useEffect, useState } from 'react'
import { useApp } from '../../AppContext'

function AssetPreview({ asset }) {
  if (asset?.media_type === 'image') {
    return <img src={asset.public_path} alt={asset.original_name} className="h-32 w-full rounded-2xl object-cover" />
  }
  if (asset?.media_type === 'video') {
    return <video src={asset.public_path} className="h-32 w-full rounded-2xl object-cover" controls />
  }
  return <div className="flex h-32 w-full items-center justify-center rounded-2xl bg-slate-100 text-xs text-slate-500">{asset?.mime_type || 'File'}</div>
}

export default function FilesPage() {
  const { notify, user, t } = useApp()
  const [files, setFiles] = useState([])
  const [search, setSearch] = useState('')
  const [mediaType, setMediaType] = useState('all')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const tr = (key, fallback) => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }

  async function loadFiles() {
    setLoading(true)
    try {
      const result = await window.api.getFiles({ search, mediaType })
      setFiles(Array.isArray(result) ? result : (result?.data || []))
    } catch (error) {
      notify(error?.message || 'Failed to load files', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadFiles() }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => { loadFiles() }, 180)
    return () => window.clearTimeout(timer)
  }, [search, mediaType])

  async function handleUpload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      await window.api.uploadFileAsset({ file, userId: user?.id, userName: user?.name })
      notify(tr('upload_complete', 'Upload complete'), 'success')
      await loadFiles()
    } catch (error) {
      notify(error?.message || 'Upload failed', 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(asset) {
    if (!asset?.id) return
    if (!asset.canDelete) {
      notify(tr('file_in_use', 'This file is still in use and cannot be deleted.'), 'error')
      return
    }
    if (!window.confirm(`Delete "${asset.original_name}"?`)) return
    try {
      await window.api.deleteFileAsset(asset.id)
      notify(tr('file_deleted', 'File deleted'), 'success')
      await loadFiles()
    } catch (error) {
      notify(error?.message || 'Delete failed', 'error')
    }
  }

  return (
    <div className="page-scroll flex flex-col gap-4 p-3 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{tr('files', 'Files')}</h1>
          <p className="mt-1 text-sm text-slate-500">{tr('files_page_hint', 'Browse uploaded assets, reuse them in the app, and safely delete unused files.')}</p>
        </div>
        <label className="btn-primary cursor-pointer text-sm">
          {uploading ? tr('uploading', 'Uploading...') : tr('upload_file', 'Upload file')}
          <input type="file" accept="image/*,video/*,.pdf,.csv,text/csv" className="hidden" onChange={handleUpload} />
        </label>
      </div>

      <div className="card p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr('search_files', 'Search files')} />
          <select className="input" value={mediaType} onChange={(event) => setMediaType(event.target.value)}>
            <option value="all">{tr('all', 'All')}</option>
            <option value="image">{tr('images', 'Images')}</option>
            <option value="video">{tr('videos', 'Videos')}</option>
            <option value="document">{tr('documents', 'Documents')}</option>
          </select>
        </div>
      </div>

      {loading ? <div className="card px-4 py-10 text-center text-sm text-slate-400">{tr('loading', 'Loading...')}</div> : null}
      {!loading && !files.length ? <div className="card px-4 py-10 text-center text-sm text-slate-500">{tr('no_files_yet', 'No files yet.')}</div> : null}

      {files.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((asset) => (
            <div key={asset.id} className="card p-4">
              <AssetPreview asset={asset} />
              <div className="mt-3 min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{asset.original_name}</div>
                <div className="mt-1 text-xs text-slate-500">{asset.public_path}</div>
                <div className="mt-1 text-xs text-slate-500">{asset.media_type || 'file'}{asset.byte_size ? ` · ${(asset.byte_size / 1024).toFixed(0)} KB` : ''}</div>
                {asset.usageCount ? <div className="mt-1 text-xs text-amber-600">{asset.usageCount} use(s)</div> : <div className="mt-1 text-xs text-emerald-600">Unused</div>}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-secondary text-sm" onClick={() => navigator.clipboard?.writeText(asset.public_path).catch(() => {})}>{tr('copy_path', 'Copy path')}</button>
                <button type="button" className="btn-secondary text-sm" onClick={() => handleDelete(asset)} disabled={!asset.canDelete}>{tr('delete', 'Delete')}</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}


