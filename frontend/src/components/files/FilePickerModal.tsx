import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import Modal from '../shared/Modal'
import { useApp as useAppHook } from '../../AppContext.tsx'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { resolvePublicAssetUrl } from '../../utils/publicAssetUrls.ts'
import {
  deleteFileAsset as deletePickerFileAsset,
  getFiles as fetchPickerFiles,
  uploadFileAsset as uploadPickerFileAsset,
} from '../../api/fileTransport.ts'
import PaginationControls, { clampPage, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'

const FILE_PICKER_LOAD_TIMEOUT_MS = 8000
const FILE_PICKER_UPLOAD_TIMEOUT_MS = 30000
const FILE_PICKER_DELETE_TIMEOUT_MS = 12000
const EMPTY_INITIAL_SELECTED: string[] = []

type MediaTypeFilter = 'all' | 'image' | 'video' | 'document'
type TranslateFunction = (key: string) => string
type NotifyFunction = (message: string, type?: string) => void

type FileAsset = {
  id?: string | number
  public_path?: string
  browser_public_path?: string
  original_name?: string
  media_type?: string
  mime_type?: string
  byte_size?: number
  usageCount?: number
  canDelete?: boolean
  updated_at?: string
}

type FilePickerModalProps = {
  open: boolean
  onClose: () => void
  onSelect?: (publicPath: string, asset: FileAsset) => void
  onSelectMany?: (assets: FileAsset[]) => void
  mediaType?: MediaTypeFilter
  title?: ReactNode
  multiple?: boolean
  initialSelected?: string[]
  layer?: 'default' | 'nested'
}

type AppContextValue = {
  notify: NotifyFunction
  user?: { id?: string | number; name?: string }
  t?: TranslateFunction
}

const useApp = useAppHook as () => AppContextValue

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function normalizeFileAssets(value: unknown): FileAsset[] {
  return Array.isArray(value) ? value.filter((asset): asset is FileAsset => !!asset && typeof asset === 'object') : []
}

async function uploadFileAssetRequest(payload: { file: File; userId?: string | number; userName?: string }): Promise<FileAsset> {
  return await uploadPickerFileAsset(payload) as FileAsset
}

function deleteFileAssetRequest(id: string | number, options: { expectedUpdatedAt?: string }): Promise<unknown> {
  return deletePickerFileAsset(id, options)
}

function AssetPreview({ asset }: { asset: FileAsset }) {
  const previewUrl = resolvePublicAssetUrl(asset?.public_path) || asset?.browser_public_path || asset?.public_path
  if (asset?.media_type === 'image') {
    return (
      <div className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-100">
        <img src={previewUrl} alt={asset.original_name || ''} className="h-full w-full object-cover" loading="lazy" decoding="async" />
      </div>
    )
  }
  if (asset?.media_type === 'video') {
    return (
      <div className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-100">
        <video src={previewUrl} className="h-full w-full object-cover" muted preload="metadata" />
      </div>
    )
  }
  return (
    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl bg-slate-100 px-3 text-center text-xs text-slate-500">
      {asset?.mime_type || 'File'}
    </div>
  )
}

export default function FilePickerModal({
  open,
  onClose,
  onSelect,
  onSelectMany,
  mediaType = 'all',
  title = 'Choose file',
  multiple = false,
  initialSelected = EMPTY_INITIAL_SELECTED,
  layer = 'default',
}: FilePickerModalProps) {
  const { notify, user, t } = useApp()
  const normalizedInitialSelectedKey = Array.isArray(initialSelected) ? initialSelected.filter(Boolean).join('\u0000') : ''
  const [files, setFiles] = useState<FileAsset[]>([])
  const [loading, setLoading] = useState(false)
  // The picker used to fetch with NO page params, so the server's default
  // page (24 items) was ALL a user could ever see or select from — a
  // library past 24 files was silently unreachable here (Aug 28 report:
  // "no page to press next or back"). Real pagination now.
  const [page, setPage] = useState(1)
  const [totalFiles, setTotalFiles] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [deletingAssetId, setDeletingAssetId] = useState<string | number | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const loadRequestRef = useRef(0)
  const uploadInFlightRef = useRef(false)
  const deleteInFlightRef = useRef(false)
  const notifyRef = useRef(notify)

  useEffect(() => {
    notifyRef.current = notify
  }, [notify])

  const tr = (key: string, fallback: string): string => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }

  const loadFiles = useCallback(async () => {
    const requestId = beginTrackedRequest(loadRequestRef)
    setLoading(true)
    try {
      const result = await withLoaderTimeout(
        () => fetchPickerFiles({ search, mediaType, page, pageSize, includeMeta: true }),
        'Files library picker',
        FILE_PICKER_LOAD_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      const meta = result as { items?: unknown; total?: unknown } | null
      const rawItems = meta && Array.isArray(meta.items) ? meta.items : result
      const nextTotal = Number(meta?.total) || (Array.isArray(rawItems) ? rawItems.length : 0)
      const nextPage = clampPage(page, nextTotal, pageSize)
      if (nextPage !== page) {
        setPage(nextPage)
        return
      }
      setFiles(normalizeFileAssets(rawItems))
      setTotalFiles(nextTotal)
    } catch (error) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      notifyRef.current(getErrorMessage(error, 'Failed to load files'), 'error')
    } finally {
      if (isTrackedRequestCurrent(loadRequestRef, requestId)) setLoading(false)
    }
  }, [mediaType, page, pageSize, search])

  useEffect(() => {
    setPage(1)
  }, [search, mediaType])

  useEffect(() => {
    if (!open) return undefined
    setSelectedPaths((current) => {
      const next = normalizedInitialSelectedKey ? normalizedInitialSelectedKey.split('\u0000') : EMPTY_INITIAL_SELECTED
      if (current.length === next.length && current.every((entry, index) => entry === next[index])) return current
      return next
    })
    loadFiles()
  }, [normalizedInitialSelectedKey, loadFiles, open])

  useEffect(() => () => {
    invalidateTrackedRequest(loadRequestRef)
  }, [])

  const accept = useMemo(() => {
    if (mediaType === 'image') return 'image/*'
    if (mediaType === 'video') return 'video/*'
    if (mediaType === 'document') return '.csv,text/csv,application/pdf,.pdf'
    return 'image/*,video/*,.csv,text/csv,application/pdf,.pdf'
  }, [mediaType])

  function toggleSelectedPath(asset: FileAsset): void {
    const publicPath = String(asset?.public_path || '').trim()
    if (!publicPath) return
    setSelectedPaths((current) => (
      current.includes(publicPath)
        ? current.filter((entry) => entry !== publicPath)
        : [...current, publicPath]
    ))
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ''
    if (!selectedFiles.length) return
    if (uploadInFlightRef.current) return
    uploadInFlightRef.current = true
    setUploading(true)
    try {
      const uploadedAssets: FileAsset[] = []
      for (const file of selectedFiles) {
        const asset = await withLoaderTimeout<FileAsset>(
          () => uploadFileAssetRequest({ file, userId: user?.id, userName: user?.name }),
          'Upload picker file asset',
          FILE_PICKER_UPLOAD_TIMEOUT_MS,
        )
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
      notify(getErrorMessage(error, 'Upload failed'), 'error')
    } finally {
      uploadInFlightRef.current = false
      setUploading(false)
    }
  }

  async function handleDelete(asset: FileAsset): Promise<void> {
    if (!asset?.id || deletingAssetId || deleteInFlightRef.current) return
    const assetId = asset.id
    if (!asset.canDelete) {
      notify(tr('file_in_use', 'This file is still in use and cannot be deleted.'), 'error')
      return
    }
    deleteInFlightRef.current = true
    if (!window.confirm(`Delete "${asset.original_name}"?`)) {
      deleteInFlightRef.current = false
      return
    }
    setDeletingAssetId(assetId)
    try {
      await withLoaderTimeout(
        () => deleteFileAssetRequest(assetId, { expectedUpdatedAt: asset.updated_at || undefined }),
        'Delete picker file asset',
        FILE_PICKER_DELETE_TIMEOUT_MS,
      )
      notify(tr('file_deleted', 'File deleted'), 'success')
      await loadFiles()
      setSelectedPaths((current) => current.filter((entry) => entry !== asset.public_path))
    } catch (error) {
      notify(getErrorMessage(error, 'Delete failed'), 'error')
    } finally {
      deleteInFlightRef.current = false
      setDeletingAssetId(null)
    }
  }

  if (!open) return null

  // The picker IS paginated now (48 per page, Part 382 — it used to fetch
  // the server's default 24-item first page with no way to reach the rest),
  // but a multi-select session's selectedPaths can still run into the
  // hundreds across pages, so checking membership with
  // `selectedPaths.includes(...)` once per rendered file was an
  // O(files x selectedPaths) scan on every render, same shape as the
  // productGrouping.ts fix elsewhere in this project. A Set gives
  // O(1) membership checks for both the per-file render loop below and
  // the selectedAssets derivation.
  const selectedPathSet = new Set(selectedPaths)
  const selectedAssets = files.filter((asset) => selectedPathSet.has(asset.public_path || ''))

  return (
    // Library uploads/deletes commit immediately; selectedPaths is only the
    // picker choice that Cancel intentionally discards. Closing cannot lose
    // an uncommitted library write, so this modal is explicitly read-only.
    <Modal title={title} onClose={onClose} wide layer={layer} unsavedChanges="read-only">
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr('search_files', 'Search files')} />
          <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()} disabled={uploading || deletingAssetId != null}>
            {uploading ? tr('uploading', 'Uploading...') : tr('upload_file', 'Upload file')}
          </button>
          <input ref={inputRef} type="file" accept={accept} multiple={multiple} className="hidden" onChange={handleUpload} disabled={uploading || deletingAssetId != null} />
        </div>

        {loading ? <div className="py-10 text-center text-sm text-slate-400">{tr('loading', 'Loading...')}</div> : null}
        {!loading && !files.length ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">{tr('no_files_yet', 'No files yet.')}</div> : null}

        {files.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((asset) => {
              const publicPath = asset.public_path || ''
              const isSelected = selectedPathSet.has(publicPath)
              return (
                <div key={asset.id} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <AssetPreview asset={asset} />
                  <div className="mt-3 min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900" title={asset.original_name}>{asset.original_name}</div>
                    <div className="mt-1 text-xs text-slate-500">{asset.media_type || 'file'}{asset.byte_size ? ` · ${(asset.byte_size / 1024).toFixed(0)} KB` : ''}</div>
                    {asset.usageCount ? <div className="mt-1 text-[11px] text-amber-600">{asset.usageCount} use(s)</div> : <div className="mt-1 text-[11px] text-emerald-600">Unused</div>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {multiple ? (
                      <button type="button" className={`min-w-0 justify-center px-2.5 text-sm sm:px-3 ${isSelected ? 'btn-primary' : 'btn-secondary'}`} onClick={() => toggleSelectedPath(asset)}>
                        {isSelected ? tr('selected', 'Selected') : tr('select', 'Select')}
                      </button>
                    ) : (
                      <button type="button" className="btn-primary min-w-0 justify-center px-2.5 text-sm sm:px-3" onClick={() => { if (publicPath) onSelect?.(publicPath, asset); onClose() }}>
                        {tr('select', 'Select')}
                      </button>
                    )}
                    <button type="button" className="btn-secondary min-w-0 justify-center px-2.5 text-sm sm:px-3" onClick={() => navigator.clipboard?.writeText(resolvePublicAssetUrl(publicPath) || asset.browser_public_path || publicPath).catch(() => {})} title={tr('copy', 'Copy')}>
                      <span className="hidden sm:inline">{tr('copy', 'Copy')}</span>
                      <span className="sm:hidden">{tr('copy', 'Copy').slice(0, 4)}</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary col-span-2 min-w-0 justify-center px-2.5 text-sm sm:px-3"
                      onClick={() => handleDelete(asset)}
                      disabled={!asset.canDelete || deletingAssetId != null}
                      title={tr('delete', 'Delete')}
                    >
                      {deletingAssetId === asset.id ? tr('deleting', 'Deleting...') : tr('delete', 'Delete')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        {!loading ? <div className="mt-3 flex justify-center"><PaginationControls compact rangeAsPageSize page={page} pageSize={pageSize} totalItems={totalFiles} label={tr('files', 'files')} t={(key) => tr(key, key)} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} /></div> : null}

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
