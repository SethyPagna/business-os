import type { ChangeEvent, ComponentProps, ComponentType, ReactNode } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import CheckSquare from 'lucide-react/dist/esm/icons/check-square.js'
import Copy from 'lucide-react/dist/esm/icons/copy.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open.js'
import History from 'lucide-react/dist/esm/icons/history.js'
import ImagePlus from 'lucide-react/dist/esm/icons/image-plus.js'
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import LockOpen from 'lucide-react/dist/esm/icons/unlock.js'
import PencilLine from 'lucide-react/dist/esm/icons/pencil-line.js'
import RefreshCcw from 'lucide-react/dist/esm/icons/refresh-ccw.js'
import Square from 'lucide-react/dist/esm/icons/square.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import PageHeader from '../shared/PageHeader'
import Modal from '../shared/Modal'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import AppSelect from '../shared/AppSelect'
import FilterMenu from '../shared/FilterMenu'
import { useIsPageActive } from '../shared/pageActivity'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.ts'
import { resolvePublicAssetUrl } from '../../utils/publicAssetUrls.ts'
import { getSyncServerUrl } from '../../api/http.ts'
import { logicalAssetDisplayName, logicalAssetDownloadPath, logicalAssetKey } from './libraryLogicalRows.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import {
  deleteFileAsset as deleteFileAssetRequest,
  getFiles as getFilesRequest,
  LIBRARY_IMAGE_COMPRESS_OPTIONS,
  renameFileAsset as renameFileAssetRequest,
  getFileUsage as getFileUsageRequest,
  rewireFileAsset as rewireFileAssetRequest,
  type FileUsageDetail,
  uploadFileAsset as uploadFileAssetRequest,
} from '../../api/fileTransport.ts'
import {
  createAiProvider as createAiProviderRequest,
  deleteAiProvider as deleteAiProviderRequest,
  getAiProviders as getAiProvidersRequest,
  getAiResponses as getAiResponsesRequest,
  testAiProvider as testAiProviderRequest,
  updateAiProvider as updateAiProviderRequest,
} from '../../api/aiTransport.ts'

const loadFilesProvidersTab = () => import('./FilesProvidersTab.tsx')
const loadFilesResponsesTab = () => import('./FilesResponsesTab')
const FilesProvidersTab = lazyRetry(loadFilesProvidersTab, 'files-providers-tab')
const FilesResponsesTab = lazyRetry(loadFilesResponsesTab as () => Promise<{ default: ComponentType<FilesResponsesTabProps> }>, 'files-responses-tab')

const FILES_LIBRARY_LOAD_TIMEOUT_MS = 10000
const AI_PROVIDERS_LOAD_TIMEOUT_MS = 8000
const AI_RESPONSES_LOAD_TIMEOUT_MS = 8000
const AI_PROVIDER_MUTATION_TIMEOUT_MS = 12000
const AI_PROVIDER_TEST_TIMEOUT_MS = 30000
const FILES_ASSET_UPLOAD_TIMEOUT_MS = 30000
const FILES_ASSET_DELETE_TIMEOUT_MS = 12000

type TranslateFunction = (key: string) => string | undefined
type TranslateWithFallback = (key: string, fallback?: string, fallbackKm?: string) => string
type NotifyFunction = (message: string, type?: string) => void
type FilesTab = 'assets' | 'providers' | 'responses'
type MediaTypeFilter = 'all' | 'image' | 'video' | 'document' | string

interface AppUser {
  id?: string | number
  name?: string
}

interface AppContextValue {
  notify: NotifyFunction
  user?: AppUser | null
  t: TranslateFunction
  hasPermission: (key: string) => boolean
  getPermissionTier: (key: string) => 'full' | 'review' | 'none'
  /** Per-action gate -- see AppContext's own can() comment. */
  can: (permissionKey: string, actionKey: string) => boolean
}

interface SyncContextValue {
  syncChannel?: {
    channel?: string
    ts?: unknown
  } | null
}

interface FileAsset {
  id: string | number
  logical_id?: string | null
  logical_name?: string | null
  physical_original_name?: string | null
  referenceProduct?: { id: string | number; name?: string | null } | null
  original_name?: string | null
  public_path?: string | null
  browser_public_path?: string | null
  media_type?: string | null
  mime_type?: string | null
  byte_size?: number | string | null
  created_at?: string | number | Date | null
  updated_at?: string | null
  usageCount?: number
  canDelete?: boolean
  // Breakdown behind usageCount, so the UI can say exactly what's using a
  // locked file ("Used by 2 products") instead of a generic "in use".
  usage?: { products?: number; gallery?: number; avatars?: number; settings?: number }
}

interface FilesResponse {
  items?: FileAsset[]
  total?: number | string
}

interface ProviderMeta {
  label?: string
  supportedTypes?: string[]
  defaultModel?: string
  defaultPriority?: number
  safeRequestsPerMinute?: number
  safeMaxInputChars?: number
  safeMaxCompletionTokens?: number
  safeTimeoutMs?: number
  safeCooldownSeconds?: number
}

type ProviderMetaMap = Record<string, ProviderMeta>
type ProviderOption = [string, ProviderMeta]

interface AiProvider {
  id: string | number
  name: string
  provider: string
  provider_type?: string
  account_email?: string
  project_name?: string
  default_model?: string
  supported_models?: string[]
  endpoint_override?: string
  notes?: string
  enabled?: boolean
  priority?: number | string
  requests_per_minute?: number | string
  max_input_chars?: number | string
  max_completion_tokens?: number | string
  timeout_ms?: number | string
  cooldown_seconds?: number | string
  updated_at?: string
}

interface ProviderFormState {
  id: string | number | null
  name: string
  provider: string
  provider_type: string
  account_email: string
  project_name: string
  api_key: string
  default_model: string
  supported_models_text: string
  endpoint_override: string
  notes: string
  enabled: boolean
  priority: number | string
  requests_per_minute: number | string
  max_input_chars: number | string
  max_completion_tokens: number | string
  timeout_ms: number | string
  cooldown_seconds: number | string
  updated_at?: string
}

interface ProviderPayload {
  [key: string]: unknown
  name: string
  provider: string
  provider_type: string
  account_email: string
  project_name: string
  api_key: string
  default_model: string
  supported_models: string[]
  endpoint_override: string
  notes: string
  enabled: boolean
  priority: number
  requests_per_minute: number
  max_input_chars: number
  max_completion_tokens: number
  timeout_ms: number
  cooldown_seconds: number
  userId?: string | number
  userName?: string
  expectedUpdatedAt?: string
}

interface ProviderMutationResult {
  success?: boolean
  error?: string
  id?: unknown
  data?: { id?: unknown } | null
  item?: AiProvider | null
}

interface ProviderTestResult {
  passed?: boolean
  message?: string
}

interface ProvidersResponse {
  items?: AiProvider[]
  providerMeta?: ProviderMetaMap
}

interface AiResponseEntry {
  id: string | number
  created_at?: string | number | Date | null
}

interface AiResponsesResponse {
  items?: AiResponseEntry[]
}

type FilesResponsesTabProps = {
  tr: TranslateWithFallback
  loadResponses: () => void
  loadingResponses: boolean
  responses: AiResponseEntry[]
  expandedResponseId: AiResponseEntry['id'] | null
  setExpandedResponseId: (updater: (current: AiResponseEntry['id'] | null) => AiResponseEntry['id'] | null) => void
  formatDateTime: (value: AiResponseEntry['created_at']) => string
}

interface FilesApi {
  getFiles: (options: { search: string; mediaType: MediaTypeFilter; page: number; pageSize: number; includeMeta: boolean }) => Promise<FilesResponse>
  uploadFileAsset: (payload: { file: File; userId?: string | number; userName?: string; compressOptions?: typeof LIBRARY_IMAGE_COMPRESS_OPTIONS }) => Promise<unknown>
  deleteFileAsset: (id: string | number, options: { expectedUpdatedAt?: string; force?: boolean; confirmText?: string }) => Promise<unknown>
  renameFileAsset: (id: string | number, originalName: string) => Promise<unknown>
  getFileUsage: (id: string | number) => Promise<FileUsageDetail>
  rewireFileAsset: (id: string | number, toFileId: string | number) => Promise<{ success?: boolean; rewired?: { products?: number; gallery?: number; avatars?: number }; settingsSkipped?: number } | null>
  getAiProviders: () => Promise<ProvidersResponse>
  getAiResponses: (limit: number) => Promise<AiResponsesResponse>
  createAiProvider: (payload: ProviderPayload) => Promise<ProviderMutationResult>
  updateAiProvider: (id: string | number, payload: ProviderPayload) => Promise<ProviderMutationResult>
  deleteAiProvider: (id: string | number, options: { userId?: string | number; userName?: string; expectedUpdatedAt?: string }) => Promise<ProviderMutationResult>
  testAiProvider: (id: string | number, options: { userId?: string | number; userName?: string }) => Promise<ProviderTestResult>
}

interface AssetPreviewProps {
  asset: FileAsset | null | undefined
  onOpenPreview?: (asset: FileAsset) => void
}

type ActionHistoryProp = ComponentProps<typeof ActionHistoryBar>['history']

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue

const focusedFilesApi: FilesApi = {
  getFiles: (options) => getFilesRequest(options) as Promise<FilesResponse>,
  uploadFileAsset: (payload) => uploadFileAssetRequest(payload),
  deleteFileAsset: (id, options) => deleteFileAssetRequest(id, options),
  renameFileAsset: (id, originalName) => renameFileAssetRequest(id, originalName),
  getFileUsage: (id) => getFileUsageRequest(id),
  rewireFileAsset: (id, toFileId) => rewireFileAssetRequest(id, toFileId),
  getAiProviders: () => getAiProvidersRequest() as Promise<ProvidersResponse>,
  getAiResponses: (limit) => getAiResponsesRequest(limit) as Promise<AiResponsesResponse>,
  createAiProvider: (payload) => createAiProviderRequest(payload) as Promise<ProviderMutationResult>,
  updateAiProvider: (id, payload) => updateAiProviderRequest(id, payload) as Promise<ProviderMutationResult>,
  deleteAiProvider: (id, options) => deleteAiProviderRequest(id, options) as Promise<ProviderMutationResult>,
  testAiProvider: (id, options) => testAiProviderRequest(id, options) as Promise<ProviderTestResult>,
}

function getFilesApi(): FilesApi {
  return focusedFilesApi
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function hasMojibake(value: string): boolean {
  return /áž|áŸ|Â|â/.test(value)
}

function sanitizeFallback(value: string): string {
  return hasMojibake(value) ? '' : value
}

// Clicking an image thumbnail opens the full-size lightbox (onOpenPreview,
// wired up by the grid below) -- previously these thumbnails were purely
// decorative with no way to see the asset any larger than the grid card
// itself. Video keeps its own inline controls (play/scrub/fullscreen
// already cover "see it properly" for video, and a click there is a
// play/pause gesture, not a preview-open one) and non-media files have
// nothing to preview, so neither gets the click handler.
function AssetPreview({ asset, onOpenPreview }: AssetPreviewProps) {
  const previewUrl = resolvePublicAssetUrl(asset?.public_path) || asset?.browser_public_path || asset?.public_path
  if (asset?.media_type === 'image') {
    return (
      <button
        type="button"
        onClick={() => asset && onOpenPreview?.(asset)}
        className="block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-2xl bg-slate-100 transition hover:opacity-90"
        aria-label={logicalAssetDisplayName(asset)}
      >
        <img src={previewUrl || ''} alt={logicalAssetDisplayName(asset)} className="h-full w-full object-cover" loading="lazy" decoding="async" />
      </button>
    )
  }
  if (asset?.media_type === 'video') {
    return (
      <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-100">
        <video src={previewUrl || ''} className="h-full w-full object-cover" controls preload="none" />
      </div>
    )
  }
  return (
    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-slate-100 px-3 text-center text-xs text-slate-500">
      {asset?.mime_type || 'File'}
    </div>
  )
}

// 8.1 (Part 418): clicking an image opens DETAILS -- the full preview plus
// what is actually USING this asset (named products/gallery rows/avatars/
// settings keys, the drill-in behind the card's usage counts) and, for
// Full Access, a rewire flow that repoints every product/avatar reference
// to another library image. Rename/delete stay on the card.
function AssetPreviewModal({ asset, onClose, canManage, notify, filesApi, onRewired }: {
  asset: FileAsset
  onClose: () => void
  canManage: boolean
  notify: NotifyFunction
  filesApi: FilesApi
  onRewired: () => void
}) {
  const previewUrl = resolvePublicAssetUrl(asset.public_path) || asset.browser_public_path || asset.public_path
  const [usage, setUsage] = useState<FileUsageDetail | null>(null)
  const [usageError, setUsageError] = useState('')
  const [rewireOpen, setRewireOpen] = useState(false)
  const [rewireSearch, setRewireSearch] = useState('')
  const [rewireCandidates, setRewireCandidates] = useState<FileAsset[]>([])
  const [rewireTargetId, setRewireTargetId] = useState<string | number | null>(null)
  const [rewiring, setRewiring] = useState(false)

  useEffect(() => {
    let cancelled = false
    setUsage(null)
    setUsageError('')
    filesApi.getFileUsage(asset.id).then((detail) => {
      if (!cancelled) setUsage(detail)
    }).catch((error) => {
      if (!cancelled) setUsageError(getErrorMessage(error, 'Could not load usage'))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id])

  useEffect(() => {
    if (!rewireOpen) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const response = await filesApi.getFiles({ search: rewireSearch.trim(), mediaType: 'image', page: 1, pageSize: 12, includeMeta: true })
        if (cancelled) return
        const items = (Array.isArray(response) ? response : (response as { items?: FileAsset[] })?.items) || []
        // physical rows only, minus this asset itself -- a rewire targets a
        // FILE, and offering the same file is a no-op the server refuses
        const seen = new Set<string>()
        setRewireCandidates((items as FileAsset[]).filter((row) => {
          if (String(row.id) === String(asset.id)) return false
          if (seen.has(String(row.id))) return false
          seen.add(String(row.id))
          return true
        }))
      } catch { if (!cancelled) setRewireCandidates([]) }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewireOpen, rewireSearch])

  const referenceCount = usage ? usage.covers.length + usage.gallery.length + usage.avatars.length : 0

  const handleRewire = async () => {
    if (rewireTargetId == null || rewiring) return
    setRewiring(true)
    try {
      const result = await filesApi.rewireFileAsset(asset.id, rewireTargetId)
      const rewired = result?.rewired || {}
      const moved = Number(rewired.products || 0) + Number(rewired.gallery || 0) + Number(rewired.avatars || 0)
      notify(`Rewired ${moved} reference${moved === 1 ? '' : 's'}${result?.settingsSkipped ? ' (settings references left for the Settings page)' : ''}`, 'success')
      setRewireOpen(false)
      setRewireTargetId(null)
      onRewired()
      onClose()
    } catch (error) {
      notify(getErrorMessage(error, 'Rewire failed'), 'error')
    } finally {
      setRewiring(false)
    }
  }

  return (
    <Modal title={sanitizeFallback(logicalAssetDisplayName(asset)) || 'Details'} onClose={onClose} size="xl">
      <div className="space-y-4">
        <div className="flex max-h-[55vh] w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
          <img src={previewUrl || ''} alt={logicalAssetDisplayName(asset)} className="max-h-[55vh] w-full object-contain" />
        </div>

        <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Used by</div>
          {usageError ? (
            <div className="text-xs font-medium text-red-500">{usageError}</div>
          ) : !usage ? (
            <div className="text-xs text-slate-400">Loading usage…</div>
          ) : referenceCount === 0 && usage.settings.length === 0 ? (
            <div className="text-xs text-slate-400">Not used anywhere — safe to delete from the card.</div>
          ) : (
            <div className="space-y-2">
              {usage.covers.length > 0 ? (
                <div>
                  <div className="text-xs font-medium text-slate-600 dark:text-slate-300">Product cover ({usage.covers.length})</div>
                  <ul className="mt-0.5 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {usage.covers.map((row) => (
                      <li key={`cover-${row.id}`} className="truncate">{row.name || `product #${row.id}`}{row.barcode ? ` · ${row.barcode}` : ''}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {usage.gallery.length > 0 ? (
                <div>
                  <div className="text-xs font-medium text-slate-600 dark:text-slate-300">Product gallery ({usage.gallery.length})</div>
                  <ul className="mt-0.5 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {usage.gallery.map((row, index) => (
                      <li key={`gallery-${row.product_id}-${index}`} className="truncate">{row.name || `product #${row.product_id}`}{row.sort_order != null ? ` · image ${Number(row.sort_order) + 1}` : ''}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {usage.avatars.length > 0 ? (
                <div>
                  <div className="text-xs font-medium text-slate-600 dark:text-slate-300">User avatar ({usage.avatars.length})</div>
                  <ul className="mt-0.5 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {usage.avatars.map((row) => (
                      <li key={`avatar-${row.id}`} className="truncate">{row.name || row.username || `user #${row.id}`}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {usage.settings.length > 0 ? (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Settings: {usage.settings.join(', ')} <span className="text-slate-400">(managed on the Settings page — rewire skips these)</span>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {canManage && asset.media_type === 'image' ? (
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            {!rewireOpen ? (
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={!usage || referenceCount === 0}
                title={referenceCount === 0 ? 'Nothing references this image' : undefined}
                onClick={() => setRewireOpen(true)}
              >
                🔀 Rewire {referenceCount} reference{referenceCount === 1 ? '' : 's'} to another image…
              </button>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Pick the image these references should point to</div>
                <input
                  className="input w-full text-sm"
                  placeholder="Search library images…"
                  value={rewireSearch}
                  onChange={(event) => setRewireSearch(event.target.value)}
                />
                <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                  {rewireCandidates.map((candidate) => {
                    const url = resolvePublicAssetUrl(candidate.public_path) || candidate.browser_public_path || candidate.public_path
                    const selected = String(candidate.id) === String(rewireTargetId)
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => setRewireTargetId(selected ? null : candidate.id)}
                        className={`aspect-square overflow-hidden rounded-lg border-2 transition ${selected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-transparent hover:border-slate-300'}`}
                        title={sanitizeFallback(String(candidate.original_name || ''))}
                      >
                        <img src={url || ''} alt="" className="h-full w-full object-cover" loading="lazy" />
                      </button>
                    )
                  })}
                  {rewireCandidates.length === 0 ? (
                    <div className="col-span-full py-4 text-center text-xs text-slate-400">No other images found</div>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary flex-1 text-xs" onClick={() => { setRewireOpen(false); setRewireTargetId(null) }}>Cancel</button>
                  <button
                    type="button"
                    className="btn-primary flex-1 text-xs disabled:opacity-50"
                    disabled={rewireTargetId == null || rewiring}
                    onClick={() => void handleRewire()}
                  >
                    {rewiring ? '⏳ Rewiring…' : `Repoint ${referenceCount} reference${referenceCount === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function AssetCardSkeleton() {
  return (
    <div className="card min-w-0 overflow-hidden p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="h-6 w-24 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
        <div className="h-5 w-20 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="aspect-[4/3] w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      <div className="mt-3 space-y-2">
        <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-7 w-full animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900/70" />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
          <div className="h-3 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-14 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="h-10 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-10 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  )
}

function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatFileSize(bytes: number | string | null | undefined): string {
  const size = Number(bytes || 0)
  if (!Number.isFinite(size) || size <= 0) return '-'
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function emptyProviderForm(): ProviderFormState {
  return {
    id: null,
    name: '',
    provider: 'groq',
    provider_type: 'chat',
    account_email: '',
    project_name: '',
    api_key: '',
    default_model: '',
    supported_models_text: '',
    endpoint_override: '',
    notes: '',
    enabled: true,
    priority: 50,
    requests_per_minute: 10,
    max_input_chars: 1000,
    max_completion_tokens: 1200,
    timeout_ms: 15000,
    cooldown_seconds: 20,
  }
}

function compactTabLabel(label: string): string {
  if (label === 'AI Providers') return 'Providers'
  if (label === 'AI Responses') return 'Responses'
  return label
}

function getDefaultFilesPageSize(): number {
  return 50
}

function downloadAssetFile(asset: FileAsset) {
  if (!asset?.id || typeof document === 'undefined') return
  const downloadUrl = `${getSyncServerUrl().replace(/\/$/, '')}${logicalAssetDownloadPath(asset)}`
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = logicalAssetDisplayName(asset)
  link.rel = 'noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

// The Library is where a photo actually lives, so it is the other obvious
// place to reach "attach these to products" from -- the Products page has
// the same entry in its Manage menu. Same component, same review step;
// lazily loaded because most visits to this page never open it.
const LazyWireImagesReviewModal = lazyRetry(async () => {
  const module = await import('../products/WireImagesReviewModal')
  return { default: module.default }
}, 'WireImagesReviewModal')

export default function FilesPage() {
  const { notify, user, t, can, hasPermission, getPermissionTier } = useApp()
  // Library view/manage split (see cloudflare/src/routes/files.ts's own
  // top-of-file comment for the full backend-side rule this mirrors):
  // browsing/searching/previewing an asset is available to every
  // authenticated user who can reach this page at all, no `library` grant
  // needed. Upload ("import"), bulk download ("export"), rename, and
  // delete are all management actions and need real Full Access to
  // `library` -- same legacy `settings`-full fallback the backend still
  // honors, kept here so the button doesn't disappear for an admin whose
  // role predates the `library` key existing.
  const canManageLibrary = getPermissionTier('library') === 'full' || hasPermission('settings')
  // Wiring library photos onto products is a PRODUCTS write, not a library
  // one -- it changes product rows and touches nothing in the library. So
  // it is gated on the same action the per-product image uploader uses,
  // exactly as the backend gates it (getActionTier(user, 'products',
  // 'image')), rather than on whatever `library` tier the person holds.
  const canWireImages = can('products', 'image')
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('files')
  const filesApi = useMemo(() => getFilesApi(), [])
  const [activeTab, setActiveTab] = useState<FilesTab>('assets')
  const [wireImagesOpen, setWireImagesOpen] = useState(false)
  const [wireImagesBusy, setWireImagesBusy] = useState(false)

  const [files, setFiles] = useState<FileAsset[]>([])
  const [search, setSearch] = useState('')
  const [mediaType, setMediaType] = useState<MediaTypeFilter>('all')
  const deferredSearch = useDeferredValue(search)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => getDefaultFilesPageSize())
  const [totalFiles, setTotalFiles] = useState(0)
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingAssetId, setDeletingAssetId] = useState<string | number | null>(null)
  // Rename (inline, see renderAssetCard below): `renamingAssetId` is which
  // asset's name field is in edit mode, `renameDraft` its in-progress text,
  // `renameSavingId` which one currently has a save request in flight (so
  // the input can disable/show a spinner without a global page-level lock,
  // same shape as `deletingAssetId` above but per-field rather than
  // per-row -- rename doesn't need the destructive-action confirm dialog
  // delete does, so no shared in-flight ref is needed here).
  const [renamingAssetId, setRenamingAssetId] = useState<string | number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [previewAsset, setPreviewAsset] = useState<FileAsset | null>(null)
  const [renameSavingId, setRenameSavingId] = useState<string | number | null>(null)
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set())
  // User-reported gap: single-file delete used a plain window.confirm() and
  // a generic "in use" notify with no reason and no way to proceed even
  // when the person genuinely wants to delete an in-use file. Replaced
  // with a real modal: always requires typing the literal phrase "CONFIRM
  // DELETE" (deleteConfirmText), and for a locked (in-use) file also shows
  // the usage breakdown and requires the explicit "unlock" checkbox before
  // the Delete button in the modal enables at all -- the actual override
  // still goes through the server's own force+confirmText check (routes/
  // files.ts), this is just the UI gate in front of it.
  const [deleteConfirmAsset, setDeleteConfirmAsset] = useState<FileAsset | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteUnlockChecked, setDeleteUnlockChecked] = useState(false)
  // Same "type CONFIRM DELETE" gate as the single-file modal above, applied
  // to the bulk action -- previously this used a plain window.confirm().
  // Bulk delete never force-deletes a locked file (no per-item unlock
  // makes sense for a mixed batch); it only ever removes the
  // already-unlocked subset and states the skipped count up front, same
  // as before, just through a real modal with the typed-confirmation gate
  // instead of window.confirm.
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState('')

  const [providers, setProviders] = useState<AiProvider[]>([])
  const [providerMeta, setProviderMeta] = useState<ProviderMetaMap>({})
  const [providerForm, setProviderForm] = useState(() => emptyProviderForm())
  const [loadingProviders, setLoadingProviders] = useState(false)
  const [savingProvider, setSavingProvider] = useState(false)
  const [testingProviderId, setTestingProviderId] = useState<string | number | null>(null)
  const [deletingProviderId, setDeletingProviderId] = useState<string | number | null>(null)

  const [responses, setResponses] = useState<AiResponseEntry[]>([])
  const [loadingResponses, setLoadingResponses] = useState(false)
  const [expandedResponseId, setExpandedResponseId] = useState<AiResponseEntry['id'] | null>(null)
  const fileLoadRequestRef = useRef(0)
  const providerLoadRequestRef = useRef(0)
  const responseLoadRequestRef = useRef(0)
  const filesLoadedOnceRef = useRef(false)
  const uploadInFlightRef = useRef(false)
  const deleteInFlightRef = useRef(false)
  const saveProviderInFlightRef = useRef(false)
  const testProviderInFlightRef = useRef(false)
  const deleteProviderInFlightRef = useRef(false)
  const [historyReady, setHistoryReady] = useState(false)
  const actionHistory = useActionHistory({ limit: 3, notify, enabled: historyReady, user })

  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr: TranslateWithFallback = (key, fallback = key, fallbackKm = fallback) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    if (!isKhmer) return fallback
    return sanitizeFallback(fallbackKm) || fallback
  }
  const providerText = {
    entryName: tr('entry_name', 'Entry name', 'ឈ្មោះធាតុ'),
    type: tr('type', 'Type', 'ប្រភេទ'),
    accountEmail: tr('account_email', 'Account email', 'អ៊ីមែលគណនី'),
    projectWorkspace: tr('project_workspace', 'Project / workspace', 'គម្រោង / កន្លែងការងារ'),
    apiKey: tr('api_key', 'API key', 'សោ API'),
    apiKeyHint: tr('api_key_hint', 'Keys are encrypted before they are stored and only shown later in masked form.', 'សោត្រូវបានអ៊ិនគ្រីបមុនពេលរក្សាទុក ហើយពេលក្រោយនឹងបង្ហាញតែជាទម្រង់លាក់ប៉ុណ្ណោះ។'),
    defaultModel: tr('default_model', 'Default model', 'ម៉ូឌែលលំនាំដើម'),
    endpointOverride: tr('endpoint_override', 'Endpoint override', 'ប្ដូរ endpoint'),
    priority: tr('priority', 'Priority', 'អាទិភាព'),
    priorityHint: tr('priority_hint', 'Lower numbers are tried first.', 'លេខតូចជាង នឹងត្រូវសាកមុន។'),
    rpm: tr('requests_per_minute', 'Requests / minute', 'សំណើ / នាទី'),
    maxInput: tr('max_input_chars', 'Max input chars', 'អក្សរបញ្ចូលអតិបរមា'),
    maxOutput: tr('max_completion_tokens', 'Max completion tokens', 'តូខិនចម្លើយអតិបរមា'),
    timeout: tr('timeout_ms', 'Timeout (ms)', 'អស់ពេល (មិល្លីវិនាទី)'),
    cooldown: tr('cooldown_seconds', 'Cooldown (seconds)', 'ពេលរង់ចាំ (វិនាទី)'),
    supportedModels: tr('supported_models', 'Supported models', 'ម៉ូឌែលដែលគាំទ្រ'),
    notes: tr('notes', 'Notes', 'កំណត់ចំណាំ'),
    enabled: tr('enabled', 'Enabled', 'បើក'),
    saveProvider: tr('save_provider', 'Save provider', 'រក្សាទុក provider'),
    addProvider: tr('add_provider', 'Add provider', 'បន្ថែម provider'),
    saving: tr('saving', 'Saving...', 'កំពុងរក្សាទុក...'),
  }

  const providerOptions = useMemo(() => Object.entries(providerMeta || {}), [providerMeta])
  const selectedProviderMeta = providerMeta?.[providerForm.provider] || null
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(Math.max(0, totalFiles) / Math.max(1, pageSize))),
    [pageSize, totalFiles],
  )
  const pageStart = files.length ? ((page - 1) * pageSize) + 1 : 0
  const pageEnd = files.length ? pageStart + files.length - 1 : 0
  const selectableFileIds = useMemo(
    () => files.map(logicalAssetKey),
    [files],
  )
  const allFilesSelected = selectableFileIds.length > 0 && selectableFileIds.every((id) => selectedAssetIds.has(id))
  const selectedAssets = useMemo(
    () => files.filter((asset) => selectedAssetIds.has(logicalAssetKey(asset))),
    [files, selectedAssetIds],
  )
  const bulkDeletableAssets = useMemo(
    () => selectedAssets.filter((asset) => asset?.canDelete),
    [selectedAssets],
  )

  const buildProviderPayload = useCallback((provider: Partial<AiProvider> = {}, overrides: Partial<ProviderFormState> & { supported_models?: string[] } = {}): ProviderPayload => ({
    name: String(overrides.name ?? provider.name ?? '').trim(),
    provider: overrides.provider ?? provider.provider ?? 'groq',
    provider_type: overrides.provider_type ?? provider.provider_type ?? 'chat',
    account_email: String(overrides.account_email ?? provider.account_email ?? '').trim(),
    project_name: String(overrides.project_name ?? provider.project_name ?? '').trim(),
    api_key: String(overrides.api_key ?? '').trim(),
    default_model: String(overrides.default_model ?? provider.default_model ?? '').trim(),
    supported_models: Array.isArray(overrides.supported_models)
      ? overrides.supported_models
      : Array.isArray(provider.supported_models)
        ? provider.supported_models
        : String(overrides.supported_models_text ?? '')
          .split('\n')
          .map((entry) => entry.trim())
          .filter(Boolean),
    endpoint_override: String(overrides.endpoint_override ?? provider.endpoint_override ?? '').trim(),
    notes: String(overrides.notes ?? provider.notes ?? '').trim(),
    enabled: overrides.enabled ?? provider.enabled ?? true,
    priority: Math.max(1, Number(overrides.priority ?? provider.priority ?? 50) || 50),
    requests_per_minute: Math.max(1, Number(overrides.requests_per_minute ?? provider.requests_per_minute ?? 10) || 10),
    max_input_chars: Math.max(200, Number(overrides.max_input_chars ?? provider.max_input_chars ?? 1000) || 1000),
    max_completion_tokens: Math.max(128, Number(overrides.max_completion_tokens ?? provider.max_completion_tokens ?? 1200) || 1200),
    timeout_ms: Math.max(3000, Number(overrides.timeout_ms ?? provider.timeout_ms ?? 15000) || 15000),
    cooldown_seconds: Math.max(5, Number(overrides.cooldown_seconds ?? provider.cooldown_seconds ?? 20) || 20),
    userId: user?.id,
    userName: user?.name,
    expectedUpdatedAt: overrides.updated_at ?? provider.updated_at ?? undefined,
  }), [user?.id, user?.name])
  const runProviderMutation = useCallback((loader: () => Promise<ProviderMutationResult>, label: string) => (
    withLoaderTimeout(loader, label, AI_PROVIDER_MUTATION_TIMEOUT_MS)
  ), [])
  const runProviderTest = useCallback((loader: () => Promise<ProviderTestResult>, label: string) => (
    withLoaderTimeout(loader, label, AI_PROVIDER_TEST_TIMEOUT_MS)
  ), [])

  // Wiring library photos to products. The transport module is imported
  // on demand rather than at the top: this page's usual job is uploading
  // and browsing files, and most visits never open this at all.
  const loadWireImagesPreview = useCallback(async () => {
    const module = await import('../../api/productWriteTransport.ts')
    const result = await module.previewWireProductImages() as Record<string, any> | undefined
    if (result?.success === false) throw new Error(result.error || 'Failed to match library images')
    return {
      changes: Array.isArray(result?.changes) ? result.changes : [],
      counts: {
        libraryImages: Number(result?.counts?.libraryImages || 0),
        matched: Number(result?.counts?.matched || 0),
        unmatched: Number(result?.counts?.unmatched || 0),
        ambiguous: Number(result?.counts?.ambiguous || 0),
        wouldChange: Number(result?.counts?.wouldChange || 0),
        wouldReplace: Number(result?.counts?.wouldReplace || 0),
      },
      unmatched: Array.isArray(result?.unmatched) ? result.unmatched : [],
      ambiguous: Array.isArray(result?.ambiguous) ? result.ambiguous : [],
    }
  }, [])

  const handleWireImages = useCallback(async (changes: unknown[]) => {
    if (!changes.length) return undefined
    setWireImagesBusy(true)
    try {
      const module = await import('../../api/productWriteTransport.ts')
      const result = await module.wireProductImages(changes) as { success?: boolean; error?: string; updated?: number; imagesAttached?: number } | undefined
      if (result?.success === false) throw new Error(result.error || 'Failed to attach images')
      return result
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Failed to attach images', 'error')
      return undefined
    } finally {
      setWireImagesBusy(false)
    }
  }, [notify])

  const handleUnwireImages = useCallback(async (productIds: number[]) => {
    if (!productIds.length) return undefined
    setWireImagesBusy(true)
    try {
      const module = await import('../../api/productWriteTransport.ts')
      const result = await module.unwireProductImages(productIds) as { success?: boolean; error?: string; cleared?: number } | undefined
      if (result?.success === false) throw new Error(result.error || 'Failed to detach images')
      return result
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Failed to detach images', 'error')
      return undefined
    } finally {
      setWireImagesBusy(false)
    }
  }, [notify])

  const loadFiles = useCallback(async () => {
    const requestId = beginTrackedRequest(fileLoadRequestRef)
    setLoadingFiles(true)
    try {
      const result = await withLoaderTimeout(() => filesApi.getFiles({
        search: deferredSearch,
        mediaType,
        page,
        pageSize,
        includeMeta: true,
      }), 'Files library', FILES_LIBRARY_LOAD_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(fileLoadRequestRef, requestId)) return
      // A malformed/transient response must not erase a library that is
      // already on screen. The transport normally rejects failures; this
      // guard also protects the UI against a proxy or stale runtime that
      // resolves without the expected payload shape.
      if (!result || !Array.isArray(result.items)) {
        throw new Error('Files library returned an invalid response')
      }
      const nextFiles = result.items
      setFiles(nextFiles)
      setTotalFiles(Number(result?.total || nextFiles.length || 0))
      filesLoadedOnceRef.current = true
      setSelectedAssetIds((current) => {
        const validIds = new Set(nextFiles.map(logicalAssetKey))
        return new Set([...current].filter((id) => validIds.has(id)))
      })
    } catch (error) {
      if (!isTrackedRequestCurrent(fileLoadRequestRef, requestId)) return
      notify(getErrorMessage(error, 'Failed to load files'), 'error')
    } finally {
      if (isTrackedRequestCurrent(fileLoadRequestRef, requestId)) setLoadingFiles(false)
    }
  }, [deferredSearch, filesApi, mediaType, notify, page, pageSize])

  useEffect(() => {
    setPage(1)
  }, [deferredSearch, mediaType, pageSize])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  useEffect(() => {
    if (!selectedProviderMeta) return
    setProviderForm((current) => {
      const nextType = selectedProviderMeta.supportedTypes?.includes(current.provider_type)
        ? current.provider_type
        : (selectedProviderMeta.supportedTypes?.[0] || 'chat')
      return {
        ...current,
        provider_type: nextType,
        name: current.name || selectedProviderMeta.label || '',
        default_model: current.default_model || selectedProviderMeta.defaultModel || '',
        priority: current.priority || selectedProviderMeta.defaultPriority || 50,
        requests_per_minute: current.requests_per_minute || selectedProviderMeta.safeRequestsPerMinute || 10,
        max_input_chars: current.max_input_chars || selectedProviderMeta.safeMaxInputChars || 1000,
        max_completion_tokens: current.max_completion_tokens || selectedProviderMeta.safeMaxCompletionTokens || 1200,
        timeout_ms: current.timeout_ms || selectedProviderMeta.safeTimeoutMs || 15000,
        cooldown_seconds: current.cooldown_seconds || selectedProviderMeta.safeCooldownSeconds || 20,
      }
    })
  }, [selectedProviderMeta])

  const loadProviders = useCallback(async (label = 'AI providers') => {
    const requestId = beginTrackedRequest(providerLoadRequestRef)
    setLoadingProviders(true)
    try {
      const result = await withLoaderTimeout(() => filesApi.getAiProviders(), label, AI_PROVIDERS_LOAD_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(providerLoadRequestRef, requestId)) return null
      setProviders(Array.isArray(result?.items) ? result.items : [])
      setProviderMeta(result?.providerMeta || {})
      return result
    } catch (error) {
      if (!isTrackedRequestCurrent(providerLoadRequestRef, requestId)) return null
      notify(getErrorMessage(error, 'Failed to load AI providers'), 'error')
      return null
    } finally {
      if (isTrackedRequestCurrent(providerLoadRequestRef, requestId)) {
        setLoadingProviders(false)
      }
    }
  }, [filesApi, notify])

  const loadResponses = useCallback(async (label = 'AI responses') => {
    const requestId = beginTrackedRequest(responseLoadRequestRef)
    setLoadingResponses(true)
    try {
      const result = await withLoaderTimeout(() => filesApi.getAiResponses(80), label, AI_RESPONSES_LOAD_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(responseLoadRequestRef, requestId)) return null
      setResponses(Array.isArray(result?.items) ? result.items : [])
      return result
    } catch (error) {
      if (!isTrackedRequestCurrent(responseLoadRequestRef, requestId)) return null
      notify(getErrorMessage(error, 'Failed to load AI responses'), 'error')
      return null
    } finally {
      if (isTrackedRequestCurrent(responseLoadRequestRef, requestId)) {
        setLoadingResponses(false)
      }
    }
  }, [filesApi, notify])

  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(fileLoadRequestRef)
      invalidateTrackedRequest(providerLoadRequestRef)
      invalidateTrackedRequest(responseLoadRequestRef)
      setHistoryReady(false)
      setLoadingFiles(false)
      setLoadingProviders(false)
      setLoadingResponses(false)
      return undefined
    }
    return undefined
  }, [isActive])

  useEffect(() => {
    if (!isActive) return undefined
    void loadFiles()
    return undefined
  }, [isActive, loadFiles])

  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      return undefined
    }
    if (!filesLoadedOnceRef.current || loadingFiles) return undefined
    setHistoryReady(true)
    return undefined
  }, [isActive, loadingFiles])

  useEffect(() => {
    if (!isActive || activeTab !== 'providers') return undefined
    void loadProviders()
    void loadResponses('AI responses prefetch')
    void loadFilesProvidersTab()
    return undefined
  }, [activeTab, isActive, loadProviders, loadResponses])

  useEffect(() => {
    if (!isActive || activeTab !== 'responses') return undefined
    void loadResponses()
    void loadProviders('AI providers prefetch')
    void loadFilesResponsesTab()
    return undefined
  }, [activeTab, isActive, loadProviders, loadResponses])

  useEffect(() => {
    if (!isActive || !syncChannel) return undefined
    const channel = String(syncChannel.channel || '')
    if (channel === 'files') {
      void loadFiles()
      if (activeTab === 'responses') void loadResponses('AI responses refresh')
    }
    if ((channel === 'files' || channel === 'settings') && activeTab === 'providers') {
      void loadProviders('AI providers refresh')
    }
    return undefined
  }, [activeTab, isActive, loadFiles, loadProviders, loadResponses, syncChannel?.channel, syncChannel?.ts])

  useEffect(() => () => {
    invalidateTrackedRequest(fileLoadRequestRef)
    invalidateTrackedRequest(providerLoadRequestRef)
    invalidateTrackedRequest(responseLoadRequestRef)
  }, [])

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (uploadInFlightRef.current) return
    uploadInFlightRef.current = true
    setUploading(true)
    try {
      await withLoaderTimeout(
        // Library uploads get a tighter compression budget than the
        // shared default (see LIBRARY_IMAGE_COMPRESS_OPTIONS) -- these
        // are content/reference thumbnails, not full-bleed product
        // photography, so they can afford to compress harder.
        () => filesApi.uploadFileAsset({ file, userId: user?.id, userName: user?.name, compressOptions: LIBRARY_IMAGE_COMPRESS_OPTIONS }),
        'Upload file asset',
        FILES_ASSET_UPLOAD_TIMEOUT_MS,
      )
      notify(tr('upload_complete', 'Upload complete'), 'success')
      await loadFiles()
    } catch (error) {
      notify(getErrorMessage(error, 'Upload failed'), 'error')
    } finally {
      uploadInFlightRef.current = false
      setUploading(false)
    }
  }

  function handleDeleteAsset(asset: FileAsset) {
    if (!asset?.id || deletingAssetId || deleteInFlightRef.current) return
    setDeleteConfirmText('')
    setDeleteUnlockChecked(false)
    setDeleteConfirmAsset(asset)
  }

  function closeDeleteConfirm() {
    if (deleteInFlightRef.current) return
    setDeleteConfirmAsset(null)
    setDeleteConfirmText('')
    setDeleteUnlockChecked(false)
  }

  async function performDeleteAsset() {
    const asset = deleteConfirmAsset
    if (!asset?.id || deleteInFlightRef.current) return
    if (deleteConfirmText.trim().toUpperCase() !== 'CONFIRM DELETE') return
    const locked = !asset.canDelete
    if (locked && !deleteUnlockChecked) return
    deleteInFlightRef.current = true
    setDeletingAssetId(asset.id)
    try {
      await withLoaderTimeout(
        () => filesApi.deleteFileAsset(asset.id, {
          expectedUpdatedAt: asset.updated_at || undefined,
          force: locked && deleteUnlockChecked,
          confirmText: deleteConfirmText.trim(),
        }),
        'Delete file asset',
        FILES_ASSET_DELETE_TIMEOUT_MS,
      )
      notify(tr('file_deleted', 'File deleted'), 'success')
      setDeleteConfirmAsset(null)
      setDeleteConfirmText('')
      setDeleteUnlockChecked(false)
      await loadFiles()
    } catch (error) {
      notify(getErrorMessage(error, 'Delete failed'), 'error')
    } finally {
      deleteInFlightRef.current = false
      setDeletingAssetId(null)
    }
  }

  // "Used by 2 products, 1 avatar" style summary from the usage breakdown
  // the server now sends -- replaces the old generic "in use" message with
  // the actual reason a file is locked.
  function describeAssetUsage(asset: FileAsset): string {
    const usage = asset.usage || {}
    const parts: string[] = []
    if (usage.products) parts.push(`${usage.products} product${usage.products === 1 ? '' : 's'}`)
    if (usage.gallery) parts.push(`${usage.gallery} product image${usage.gallery === 1 ? '' : 's'}`)
    if (usage.avatars) parts.push(`${usage.avatars} user avatar${usage.avatars === 1 ? '' : 's'}`)
    if (usage.settings) parts.push('a business/portal setting')
    if (!parts.length) return tr('file_in_use', 'This file is still in use.')
    return `${tr('used_by', 'Used by')} ${parts.join(', ')}`
  }

  function startRenameAsset(asset: FileAsset) {
    if (!asset?.id || renameSavingId) return
    setRenamingAssetId(asset.id)
    setRenameDraft(asset.original_name || '')
  }

  function cancelRenameAsset() {
    if (renameSavingId) return
    setRenamingAssetId(null)
    setRenameDraft('')
  }

  async function commitRenameAsset(asset: FileAsset) {
    if (!asset?.id || renameSavingId) return
    const nextName = renameDraft.trim()
    // No-op or empty submit both just close the field -- nothing worth a
    // round trip, and an empty name would be rejected server-side anyway.
    if (!nextName || nextName === (asset.original_name || '')) {
      setRenamingAssetId(null)
      setRenameDraft('')
      return
    }
    setRenameSavingId(asset.id)
    try {
      await withLoaderTimeout(
        () => filesApi.renameFileAsset(asset.id, nextName),
        'Rename file asset',
        FILES_ASSET_DELETE_TIMEOUT_MS,
      )
      notify(tr('file_renamed', 'File renamed'), 'success')
      setRenamingAssetId(null)
      setRenameDraft('')
      await loadFiles()
    } catch (error) {
      notify(getErrorMessage(error, 'Rename failed'), 'error')
    } finally {
      setRenameSavingId(null)
    }
  }

  function toggleAssetSelection(asset: FileAsset) {
    const rowKey = logicalAssetKey(asset)
    setSelectedAssetIds((current) => {
      const next = new Set<string>(current)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })
  }

  function toggleSelectAllAssets() {
    setSelectedAssetIds((current) => {
      if (allFilesSelected) return new Set()
      return new Set(selectableFileIds)
    })
  }

  async function handleCopySelectedPaths() {
    if (!selectedAssets.length) return
    try {
      await navigator.clipboard?.writeText(
        selectedAssets
          .map((asset) => resolvePublicAssetUrl(asset.public_path) || asset.browser_public_path || asset.public_path)
          .filter(Boolean)
          .join('\n'),
      )
      notify(tr('copied', 'Copied'), 'success')
    } catch {
      notify(tr('copy_failed', 'Copy failed'), 'error')
    }
  }

  function handleDownloadSelected() {
    if (!selectedAssets.length) return
    selectedAssets.forEach((asset, index) => {
      window.setTimeout(() => downloadAssetFile(asset), index * 140)
    })
    notify(tr('download_started', 'Download started'), 'success')
  }

  function handleDeleteSelectedAssets() {
    if (!bulkDeletableAssets.length || deletingAssetId != null || deleteInFlightRef.current) return
    setBulkDeleteConfirmText('')
    setBulkDeleteConfirmOpen(true)
  }

  function closeBulkDeleteConfirm() {
    if (deleteInFlightRef.current) return
    setBulkDeleteConfirmOpen(false)
    setBulkDeleteConfirmText('')
  }

  async function performDeleteSelectedAssets() {
    if (!bulkDeletableAssets.length || deleteInFlightRef.current) return
    if (bulkDeleteConfirmText.trim().toUpperCase() !== 'CONFIRM DELETE') return
    deleteInFlightRef.current = true
    setDeletingAssetId('bulk')
    try {
      for (const asset of bulkDeletableAssets) {
        await withLoaderTimeout(
          () => filesApi.deleteFileAsset(asset.id, { expectedUpdatedAt: asset.updated_at || undefined }),
          'Delete selected file asset',
          FILES_ASSET_DELETE_TIMEOUT_MS,
        )
      }
      notify(
        tr(
          'selected_files_deleted',
          `${bulkDeletableAssets.length} file(s) deleted`,
          `បានលុបឯកសារ ${bulkDeletableAssets.length}`,
        ),
        'success',
      )
      setSelectedAssetIds(new Set())
      setBulkDeleteConfirmOpen(false)
      setBulkDeleteConfirmText('')
      await loadFiles()
    } catch (error) {
      notify(getErrorMessage(error, 'Bulk delete failed'), 'error')
    } finally {
      deleteInFlightRef.current = false
      setDeletingAssetId(null)
    }
  }

  function startCreateProvider() {
    setProviderForm({
      ...emptyProviderForm(),
      provider: providerOptions[0]?.[0] || 'groq',
      name: providerOptions[0]?.[1]?.label || 'Groq',
      default_model: providerOptions[0]?.[1]?.defaultModel || '',
      provider_type: providerOptions[0]?.[1]?.supportedTypes?.[0] || 'chat',
      priority: providerOptions[0]?.[1]?.defaultPriority || 50,
      requests_per_minute: providerOptions[0]?.[1]?.safeRequestsPerMinute || 10,
      max_input_chars: providerOptions[0]?.[1]?.safeMaxInputChars || 1000,
      max_completion_tokens: providerOptions[0]?.[1]?.safeMaxCompletionTokens || 1200,
      timeout_ms: providerOptions[0]?.[1]?.safeTimeoutMs || 15000,
      cooldown_seconds: providerOptions[0]?.[1]?.safeCooldownSeconds || 20,
    })
  }

  function startEditProvider(provider: AiProvider) {
    setProviderForm({
      id: provider.id,
      updated_at: provider.updated_at || '',
      name: provider.name || '',
      provider: provider.provider || 'groq',
      provider_type: provider.provider_type || 'chat',
      account_email: provider.account_email || '',
      project_name: provider.project_name || '',
      api_key: '',
      default_model: provider.default_model || '',
      supported_models_text: Array.isArray(provider.supported_models) ? provider.supported_models.join('\n') : '',
      endpoint_override: provider.endpoint_override || '',
      notes: provider.notes || '',
      enabled: !!provider.enabled,
      priority: provider.priority || 50,
      requests_per_minute: provider.requests_per_minute || 10,
      max_input_chars: provider.max_input_chars || 1000,
      max_completion_tokens: provider.max_completion_tokens || 1200,
      timeout_ms: provider.timeout_ms || 15000,
      cooldown_seconds: provider.cooldown_seconds || 20,
    })
    setActiveTab('providers')
  }

  async function saveProvider() {
    const previousSnapshot = providerForm.id
      ? cloneHistorySnapshot(providers.find((provider) => Number(provider?.id || 0) === Number(providerForm.id)))
      : null
    const payload = {
      ...providerForm,
      supported_models: String(providerForm.supported_models_text || '')
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean),
      priority: Math.max(1, Number(providerForm.priority || 50) || 50),
      requests_per_minute: Math.max(1, Number(providerForm.requests_per_minute || 10) || 10),
      max_input_chars: Math.max(200, Number(providerForm.max_input_chars || 1000) || 1000),
      max_completion_tokens: Math.max(128, Number(providerForm.max_completion_tokens || 1200) || 1200),
      timeout_ms: Math.max(3000, Number(providerForm.timeout_ms || 15000) || 15000),
      cooldown_seconds: Math.max(5, Number(providerForm.cooldown_seconds || 20) || 20),
      userId: user?.id,
      userName: user?.name,
      expectedUpdatedAt: providerForm.updated_at || undefined,
    }
    if (!payload.name.trim()) {
      notify('Provider name is required', 'error')
      return
    }
    if (!payload.provider) {
      notify('Choose a provider', 'error')
      return
    }
    if (!providerForm.id && !payload.api_key.trim()) {
      notify('API key is required for a new provider', 'error')
      return
    }

    if (!beginSingleAction(saveProviderInFlightRef, { blocked: savingProvider })) return

    setSavingProvider(true)
    try {
      const result = providerForm.id
        ? await runProviderMutation(() => filesApi.updateAiProvider(providerForm.id as string | number, payload), 'Update AI provider')
        : await runProviderMutation(() => filesApi.createAiProvider(payload), 'Create AI provider')
      const savedProvider = cloneHistorySnapshot(result?.item || { ...payload, id: providerForm.id || extractHistoryResultId(result) })
      notify(providerForm.id ? 'Provider updated' : 'Provider added', 'success')
      startCreateProvider()
      await loadProviders()
      if (previousSnapshot?.id && !String(payload.api_key || '').trim()) {
        actionHistory.pushAction({
          label: `Edit provider ${previousSnapshot.name || savedProvider.name || ''}`.trim(),
          undo: async () => {
            const undoResult = await runProviderMutation(() => filesApi.updateAiProvider(previousSnapshot.id, buildProviderPayload(previousSnapshot)), 'Undo provider update')
            if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to restore provider')
            await loadProviders()
          },
          redo: async () => {
            const redoResult = await runProviderMutation(() => filesApi.updateAiProvider(savedProvider.id, buildProviderPayload(savedProvider)), 'Redo provider update')
            if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to reapply provider changes')
            await loadProviders()
          },
        })
      } else if (!previousSnapshot?.id && savedProvider?.id) {
        let createdProviderId = Number(savedProvider.id || 0)
        const createdProviderPayload = buildProviderPayload(savedProvider, { api_key: payload.api_key })
        actionHistory.pushAction({
          label: `Add provider ${savedProvider.name || ''}`.trim(),
          undo: async () => {
            const undoResult = await runProviderMutation(() => filesApi.deleteAiProvider(createdProviderId, { userId: user?.id, userName: user?.name, expectedUpdatedAt: savedProvider.updated_at || undefined }), 'Undo provider creation')
            if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to undo provider creation')
            await loadProviders()
          },
          redo: async () => {
            const redoResult = await runProviderMutation(() => filesApi.createAiProvider(createdProviderPayload), 'Redo provider creation')
            if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to recreate provider')
            createdProviderId = extractHistoryResultId(redoResult)
            await loadProviders()
          },
        })
      }
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to save provider'), 'error')
    } finally {
      finishSingleAction(saveProviderInFlightRef)
      setSavingProvider(false)
    }
  }

  async function testProvider(providerId: string | number) {
    if (!providerId) return
    if (!beginSingleAction(testProviderInFlightRef, { blocked: testingProviderId != null })) return
    setTestingProviderId(providerId)
    try {
      const result = await runProviderTest(() => filesApi.testAiProvider(providerId, { userId: user?.id, userName: user?.name }), 'Test AI provider')
      if (result?.passed === false) {
        notify(result?.message || 'Provider test failed', 'error')
      } else {
        notify(result?.message || 'Provider test passed', 'success')
      }
      await loadProviders()
    } catch (error) {
      notify(getErrorMessage(error, 'Provider test failed'), 'error')
      await loadProviders()
    } finally {
      finishSingleAction(testProviderInFlightRef)
      setTestingProviderId(null)
    }
  }

  async function removeProvider(provider: AiProvider) {
    if (!provider?.id) return
    if (!beginSingleAction(deleteProviderInFlightRef, { blocked: deletingProviderId != null })) return
    if (!window.confirm(`Delete AI provider "${provider.name}"?`)) {
      finishSingleAction(deleteProviderInFlightRef)
      return
    }
    setDeletingProviderId(provider.id)
    try {
      await runProviderMutation(() => filesApi.deleteAiProvider(provider.id, { userId: user?.id, userName: user?.name, expectedUpdatedAt: provider.updated_at || undefined }), 'Delete AI provider')
      notify('Provider deleted', 'success')
      if (providerForm.id === provider.id) startCreateProvider()
      await loadProviders()
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to delete provider'), 'error')
    } finally {
      finishSingleAction(deleteProviderInFlightRef)
      setDeletingProviderId(null)
    }
  }

  const tabButton = (id: FilesTab, label: string, Icon: ComponentType<{ className?: string }>): ReactNode => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition sm:text-sm ${activeTab === id ? 'bg-slate-950 text-white shadow-sm dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
    >
      <Icon className="h-4 w-4" />
      <span className="truncate">{compactTabLabel(label)}</span>
    </button>
  )

  return (
    <div className="page-scroll flex flex-col gap-4 p-3 sm:p-6">
      <PageHeader
        icon={FolderOpen}
        tone="blue"
        title={tr('library', 'Library')}
        subtitle={tr('library_page_hint', 'Manage uploaded assets, AI providers, and saved AI research from one place.', 'គ្រប់គ្រងឯកសារ AI providers និងចម្លើយ AI ដែលបានរក្សាទុក នៅកន្លែងតែមួយ។')}
        // Guide icon before History -- same historySlot treatment
        // Backup.tsx got in Part 212, per the same explicit user
        // direction. Kept scoped to the assets tab exactly like the old
        // inline placement was (activeTab === 'assets' below) -- this is
        // a pure relocation, not a fix to whether History should also be
        // visible on the providers/responses tabs (a separate, unasked
        // question; History does track provider add/edit actions too,
        // see actionHistory.pushAction calls in the provider handlers
        // above, but that's an existing mis-scoping this move
        // deliberately leaves untouched).
        historySlot={activeTab === 'assets' ? <ActionHistoryBar history={actionHistory as unknown as ActionHistoryProp} t={t} /> : null}
        actions={(
          <div className="inline-flex min-w-0 items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {tabButton('assets', tr('library_assets', 'Assets'), FolderOpen)}
          {tabButton('providers', tr('library_ai_providers', 'AI Providers', 'AI Providers'), KeyRound)}
          {tabButton('responses', tr('library_ai_responses', 'AI Responses', 'ចម្លើយ AI'), History)}
          </div>
        )}
      />

      {activeTab === 'assets' ? (
        <>
          {/* Upload button gets the row to itself now that History sits in
              PageHeader's own row above (next to the page-guide icon, per
              Part 212's historySlot convention) instead of sharing this
              row with it. */}
          {canManageLibrary ? (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {/* Reaches the same review modal the Products page's Manage
                  menu opens. Here because this is where the photos are:
                  after uploading a batch of files named after products,
                  the next thing wanted is attaching them, and sending
                  someone to another page to do it is the long way round. */}
              {canWireImages ? (
                <button
                  type="button"
                  onClick={() => setWireImagesOpen(true)}
                  className="ml-auto inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ImagePlus className="h-4 w-4" />
                  {tr('wire_images_title', 'Wire images to products')}
                </button>
              ) : null}
              <label htmlFor="library-upload-file" className={`btn-primary inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap px-4 text-sm${canWireImages ? '' : ' ml-auto'}`}>
                <Upload className="h-4 w-4" />
                {uploading ? tr('uploading', 'Uploading...') : tr('upload_file', 'Upload file')}
                <input id="library-upload-file" name="library_upload_file" type="file" accept="image/*,video/*,.pdf,.csv,text/csv" className="hidden" onChange={handleUpload} disabled={uploading || deletingAssetId != null} />
              </label>
            </div>
          ) : (
            <div className="mb-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
              {tr('library_view_only_hint', 'You can browse and preview the library. Uploading, downloading, renaming, and deleting need Full Access to Library.')}
            </div>
          )}

          {/* Search row, select-all summary, and bulk-action bar all pin to
              the top of the page's scroll container while scrolling (Aug 11
              2026 UI-polish request, same treatment as
              Products.tsx/Inventory.tsx/Sales.tsx/Returns.tsx/Branches.tsx/
              contacts tabs/AuditLog.tsx). Grouped into ONE sticky wrapper,
              rather than independently-sticky siblings, so there's no need
              to hand-compute a per-element `top` offset to stack them
              without overlapping. The original "card" box that used to wrap
              search+upload+select-all+bulk-bar together now wraps only the
              sticky portion -- Upload moved out above, everything else
              keeps its existing look/padding unchanged. */}
          <div className="sticky top-2 z-30 -mx-1 pb-2 sm:mx-0">
          <div className="card p-3 sm:p-4">
            {/* Search row: media type + rows-per-page are now one icon-only
                Filter trigger instead of two separate dropdowns. */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <label htmlFor="library-search" className="sr-only">{tr('search_files', 'Search files')}</label>
              <input
                id="library-search"
                name="library_search"
                className="input h-10 min-w-0 flex-1 rounded-xl text-sm"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={tr('search_files', 'Search files')}
              />
              <FilterMenu
                label={tr('filters', 'Filters')}
                activeCount={(mediaType !== 'all' ? 1 : 0) + (pageSize !== getDefaultFilesPageSize() ? 1 : 0)}
                mobileIconOnly
                onClear={() => {
                  setMediaType('all')
                  setPageSize(getDefaultFilesPageSize())
                }}
                sections={[
                  {
                    id: 'type',
                    label: tr('filter_media_type', 'Filter by media type'),
                    options: [
                      { id: 'all', label: tr('all', 'All'), active: mediaType === 'all', onClick: () => setMediaType('all') },
                      { id: 'image', label: tr('images', 'Images'), active: mediaType === 'image', onClick: () => setMediaType('image') },
                      { id: 'video', label: tr('videos', 'Videos'), active: mediaType === 'video', onClick: () => setMediaType('video') },
                      { id: 'document', label: tr('documents', 'Documents'), active: mediaType === 'document', onClick: () => setMediaType('document') },
                    ],
                  },
                  {
                    id: 'rows',
                    label: tr('rows_per_page', 'Rows per page'),
                    options: [12, 24, 48].map((nextPageSize) => ({
                      id: nextPageSize,
                      label: String(nextPageSize),
                      active: pageSize === nextPageSize,
                      onClick: () => setPageSize(nextPageSize),
                    })),
                  },
                ]}
              />
            </div>
            {files.length || totalFiles ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <button type="button" className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={toggleSelectAllAssets}>
                    {allFilesSelected ? <CheckSquare className="h-3.5 w-3.5 text-blue-600" /> : <Square className="h-3.5 w-3.5" />}
                    <span>{tr('select_all', 'Select all')}</span>
                  </button>
                  <span>{selectedAssetIds.size} {tr('selected', 'selected')}</span>
                </div>
                <div>{pageStart && pageEnd ? `${pageStart}-${pageEnd}` : '0'} / {totalFiles} {tr('files', 'files')}</div>
              </div>
            ) : null}
            {selectedAssets.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                <button type="button" className="btn-secondary px-3 py-1.5 text-xs sm:text-sm" onClick={handleCopySelectedPaths}>
                  <Copy className="mr-1.5 inline h-3.5 w-3.5" />
                  {tr('copy_links', 'Copy links', 'ចម្លងតំណ')}
                </button>
                {canManageLibrary ? (
                  <button type="button" className="btn-secondary px-3 py-1.5 text-xs sm:text-sm" onClick={handleDownloadSelected}>
                    <Download className="mr-1.5 inline h-3.5 w-3.5" />
                    {tr('download', 'Download', 'ទាញយក')}
                  </button>
                ) : null}
                {canManageLibrary ? (
                  <button
                    type="button"
                    className="btn-danger px-3 py-1.5 text-xs sm:text-sm"
                    onClick={handleDeleteSelectedAssets}
                    disabled={!bulkDeletableAssets.length || deletingAssetId != null}
                  >
                    <Trash2 className="mr-1.5 inline h-3.5 w-3.5" />
                    {deletingAssetId === 'bulk'
                      ? tr('deleting', 'Deleting...')
                      : tr('delete_selected', 'Delete selected', 'លុបដែលបានជ្រើស')}
                  </button>
                ) : null}
                {canManageLibrary && bulkDeletableAssets.length !== selectedAssets.length ? (
                  <span className="text-[11px] text-amber-600 dark:text-amber-300">
                    {tr(
                      'some_files_in_use',
                      `${selectedAssets.length - bulkDeletableAssets.length} in use`,
                      `${selectedAssets.length - bulkDeletableAssets.length} កំពុងប្រើ`,
                    )}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          </div>

          {loadingFiles && !files.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, index) => (
                <AssetCardSkeleton key={`files-skeleton-${index}`} />
              ))}
            </div>
          ) : null}
          {!loadingFiles && !files.length ? <div className="card px-4 py-10 text-center text-sm text-slate-500">{tr('no_files_yet', 'No files yet.')}</div> : null}

          {files.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {files.map((asset) => {
                const rowKey = logicalAssetKey(asset)
                const selected = selectedAssetIds.has(rowKey)
                const assetUrl = resolvePublicAssetUrl(asset.public_path) || asset.browser_public_path || asset.public_path || ''
                return (
                  <div key={rowKey} className="card min-w-0 overflow-hidden p-3 sm:p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        className="inline-flex min-w-0 items-center gap-2 rounded-full px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        onClick={() => toggleAssetSelection(asset)}
                      >
                        {selected ? <CheckSquare className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4" />}
                        <span>{tr('select', 'Select')}</span>
                      </button>
                      <span
                        className={`max-w-full rounded-full px-2 py-1 text-[10px] font-semibold ${asset.usageCount ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200'}`}
                        title={asset.usageCount ? describeAssetUsage(asset) : undefined}
                      >
                        {asset.usageCount ? `${asset.usageCount} use(s)` : tr('unused', 'Unused')}
                      </span>
                    </div>
                    <AssetPreview asset={asset} onOpenPreview={setPreviewAsset} />
                    <div className="mt-3 min-w-0">
                      {!asset.referenceProduct && canManageLibrary && renamingAssetId === asset.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            className="input min-w-0 flex-1 py-1 text-sm"
                            value={renameDraft}
                            autoFocus
                            disabled={renameSavingId === asset.id}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') { event.preventDefault(); void commitRenameAsset(asset) }
                              if (event.key === 'Escape') { event.preventDefault(); cancelRenameAsset() }
                            }}
                            onBlur={() => void commitRenameAsset(asset)}
                            aria-label={tr('rename_file', 'Rename file')}
                          />
                        </div>
                      ) : !asset.referenceProduct && canManageLibrary ? (
                        <button
                          type="button"
                          className="block w-full truncate rounded px-0.5 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800"
                          title={tr('rename_file_hint', 'Click to rename')}
                          onClick={() => startRenameAsset(asset)}
                        >
                          {logicalAssetDisplayName(asset)}
                        </button>
                      ) : (
                        <div className="block w-full truncate px-0.5 text-sm font-semibold leading-5 text-slate-900 dark:text-white" title={logicalAssetDisplayName(asset)}>
                          {logicalAssetDisplayName(asset)}
                        </div>
                      )}
                      {asset.referenceProduct ? (
                        <div className="mt-1 truncate px-0.5 text-[10px] text-slate-500" title={asset.physical_original_name || asset.original_name || ''}>
                          {tr('one_stored_file', 'One stored file')}: {asset.physical_original_name || asset.original_name || '-'}
                        </div>
                      ) : null}
                      <div className="mt-1 truncate rounded-xl bg-slate-50 px-2 py-1 text-[10px] leading-4 text-slate-500 dark:bg-slate-800/60" title={assetUrl}>{assetUrl}</div>
                      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        <span>{asset.media_type || 'file'}</span>
                        <span className="text-right">{formatFileSize(asset.byte_size)}</span>
                        <span>{tr('date_added', 'Date added')}</span>
                        <span className="text-right">{formatDateTime(asset.created_at)}</span>
                      </div>
                    </div>
                    <div className={`mt-4 grid gap-2 ${canManageLibrary ? (asset.referenceProduct ? 'grid-cols-2' : 'grid-cols-3') : 'grid-cols-1'}`}>
                      <button type="button" className="btn-secondary min-w-0 justify-center px-2.5 text-sm sm:px-3" onClick={() => navigator.clipboard?.writeText(assetUrl).catch(() => {})} title={tr('copy', 'Copy')}>
                        <Copy className="inline h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">{tr('copy', 'Copy')}</span>
                      </button>
                      {canManageLibrary && !asset.referenceProduct ? (
                        <button
                          type="button"
                          className="btn-secondary min-w-0 justify-center px-2.5 text-sm sm:px-3"
                          onClick={() => startRenameAsset(asset)}
                          disabled={renameSavingId != null}
                          title={tr('rename', 'Rename')}
                        >
                          <PencilLine className="inline h-4 w-4 sm:mr-2" />
                          <span className="hidden sm:inline">{tr('rename', 'Rename')}</span>
                        </button>
                      ) : null}
                      {canManageLibrary ? (
                        <button
                          type="button"
                          className="btn-secondary min-w-0 justify-center px-2.5 text-sm sm:px-3"
                          onClick={() => handleDeleteAsset(asset)}
                          disabled={deletingAssetId != null}
                          title={asset.canDelete ? tr('delete', 'Delete') : describeAssetUsage(asset)}
                        >
                          {asset.canDelete ? <Trash2 className="inline h-4 w-4 sm:mr-2" /> : <Lock className="inline h-4 w-4 sm:mr-2" />}
                          <span className="hidden sm:inline">{deletingAssetId === asset.id ? tr('deleting', 'Deleting...') : tr('delete', 'Delete')}</span>
                          <span className="sm:hidden">{deletingAssetId === asset.id ? '...' : null}</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
          {!loadingFiles && totalPages > 1 ? (
            <div className="card flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-500">
                {pageStart && pageEnd ? `${pageStart}-${pageEnd}` : '0'} / {totalFiles} {tr('files', 'files')}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-secondary text-sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  {tr('previous', 'Previous')}
                </button>
                <div className="min-w-[6rem] text-center text-sm font-medium text-slate-600 dark:text-slate-300">
                  {tr('page', 'Page')} {page} / {totalPages}
                </div>
                <button type="button" className="btn-secondary text-sm" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                  {tr('next', 'Next')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {activeTab === 'providers' ? (
        <Suspense fallback={<section className="card p-4 text-sm text-slate-500 sm:p-5">{tr('loading_providers', 'Loading providers...')}</section>}>
          <FilesProvidersTab
            tr={tr}
            loadingProviders={loadingProviders}
            providers={providers}
            loadProviders={loadProviders}
            testingProviderId={testingProviderId}
            deletingProviderId={deletingProviderId}
            startEditProvider={startEditProvider}
            testProvider={testProvider}
            removeProvider={removeProvider}
            providerForm={providerForm}
            providerMeta={providerMeta}
            providerOptions={providerOptions}
            selectedProviderMeta={selectedProviderMeta}
            setProviderForm={setProviderForm}
            providerText={providerText}
            isKhmer={isKhmer}
            startCreateProvider={startCreateProvider}
            saveProvider={saveProvider}
            savingProvider={savingProvider}
          />
        </Suspense>
      ) : null}

      {activeTab === 'responses' ? (
        <Suspense fallback={<section className="card p-4 text-sm text-slate-500 sm:p-5">{tr('loading_ai_responses', 'Loading AI responses...')}</section>}>
          <FilesResponsesTab
            tr={tr}
            loadResponses={loadResponses}
            loadingResponses={loadingResponses}
            responses={responses}
            expandedResponseId={expandedResponseId}
            setExpandedResponseId={setExpandedResponseId}
            formatDateTime={formatDateTime}
          />
        </Suspense>
      ) : null}

      {wireImagesOpen ? (
        <Suspense fallback={null}>
          <LazyWireImagesReviewModal
            t={t}
            onClose={() => { if (!wireImagesBusy) setWireImagesOpen(false) }}
            onLoadPreview={loadWireImagesPreview}
            onConfirmWire={handleWireImages}
            onUnwire={handleUnwireImages}
            working={wireImagesBusy}
          />
        </Suspense>
      ) : null}

      {previewAsset ? (
        <AssetPreviewModal
          asset={previewAsset}
          onClose={() => setPreviewAsset(null)}
          canManage={canManageLibrary}
          notify={notify}
          filesApi={filesApi}
          onRewired={() => { void loadFiles() }}
        />
      ) : null}

      {deleteConfirmAsset ? (
        <Modal title={tr('delete_file', 'Delete file')} onClose={closeDeleteConfirm} size="sm">
          <div className="flex flex-col gap-4">
            <p className="truncate text-sm font-medium text-slate-900 dark:text-white" title={deleteConfirmAsset.original_name || ''}>
              {deleteConfirmAsset.original_name || '-'}
            </p>
            {!deleteConfirmAsset.canDelete ? (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">{tr('file_locked', 'This file is locked')}</p>
                  <p className="mt-0.5">{describeAssetUsage(deleteConfirmAsset)}</p>
                </div>
              </div>
            ) : null}
            {!deleteConfirmAsset.canDelete ? (
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={deleteUnlockChecked}
                  onChange={(event) => setDeleteUnlockChecked(event.target.checked)}
                />
                <span className="flex items-center gap-1.5">
                  {deleteUnlockChecked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  {tr('unlock_and_delete_anyway', 'Unlock and delete this file anyway')}
                </span>
              </label>
            ) : null}
            <div>
              <label className="mb-1 block text-sm text-slate-600 dark:text-slate-300">
                {tr('type_confirm_delete', 'Type CONFIRM DELETE to continue')}
              </label>
              <input
                type="text"
                className="input w-full"
                value={deleteConfirmText}
                autoFocus
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder="CONFIRM DELETE"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={closeDeleteConfirm} disabled={deletingAssetId != null}>
                {tr('cancel', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn-danger text-sm"
                onClick={() => void performDeleteAsset()}
                disabled={
                  deletingAssetId != null
                  || deleteConfirmText.trim().toUpperCase() !== 'CONFIRM DELETE'
                  || (!deleteConfirmAsset.canDelete && !deleteUnlockChecked)
                }
              >
                {deletingAssetId === deleteConfirmAsset.id ? tr('deleting', 'Deleting...') : tr('delete', 'Delete')}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {bulkDeleteConfirmOpen ? (
        <Modal title={tr('delete_files', 'Delete files')} onClose={closeBulkDeleteConfirm} size="sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {selectedAssets.length - bulkDeletableAssets.length > 0
                ? tr(
                  'delete_selected_partial_confirm',
                  `Delete ${bulkDeletableAssets.length} selected files? ${selectedAssets.length - bulkDeletableAssets.length} file(s) are still in use and will be skipped.`,
                  `លុបឯកសារដែលបានជ្រើស ${bulkDeletableAssets.length} មែនទេ? មាន ${selectedAssets.length - bulkDeletableAssets.length} ឯកសារកំពុងត្រូវបានប្រើ ហើយនឹងត្រូវរំលង។`,
                )
                : tr(
                  'delete_selected_confirm',
                  `Delete ${bulkDeletableAssets.length} selected file(s)?`,
                  `លុបឯកសារដែលបានជ្រើស ${bulkDeletableAssets.length} មែនទេ?`,
                )}
            </p>
            <div>
              <label className="mb-1 block text-sm text-slate-600 dark:text-slate-300">
                {tr('type_confirm_delete', 'Type CONFIRM DELETE to continue')}
              </label>
              <input
                type="text"
                className="input w-full"
                value={bulkDeleteConfirmText}
                autoFocus
                onChange={(event) => setBulkDeleteConfirmText(event.target.value)}
                placeholder="CONFIRM DELETE"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={closeBulkDeleteConfirm} disabled={deletingAssetId != null}>
                {tr('cancel', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn-danger text-sm"
                onClick={() => void performDeleteSelectedAssets()}
                disabled={deletingAssetId != null || bulkDeleteConfirmText.trim().toUpperCase() !== 'CONFIRM DELETE'}
              >
                {deletingAssetId === 'bulk' ? tr('deleting', 'Deleting...') : tr('delete', 'Delete')}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
