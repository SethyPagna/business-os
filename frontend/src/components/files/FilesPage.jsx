import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckSquare,
  Copy,
  FolderOpen,
  History,
  KeyRound,
  RefreshCcw,
  Square,
  Trash2,
  Upload,
} from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import PageHeader from '../shared/PageHeader'
import ActionHistoryBar from '../shared/ActionHistoryBar.jsx'
import { useIsPageActive } from '../shared/pageActivity'
import { useActionHistory } from '../../utils/actionHistory.mjs'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.mjs'
import { resolvePublicAssetUrl } from '../../utils/publicAssetUrls.js'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

const loadFilesProvidersTab = () => import('./FilesProvidersTab.jsx')
const loadFilesResponsesTab = () => import('./FilesResponsesTab.jsx')
const FilesProvidersTab = lazy(loadFilesProvidersTab)
const FilesResponsesTab = lazy(loadFilesResponsesTab)

function AssetPreview({ asset }) {
  const previewUrl = resolvePublicAssetUrl(asset?.public_path) || asset?.browser_public_path || asset?.public_path
  if (asset?.media_type === 'image') {
    return (
      <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-100">
        <img src={previewUrl} alt={asset.original_name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
      </div>
    )
  }
  if (asset?.media_type === 'video') {
    return (
      <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-100">
        <video src={previewUrl} className="h-full w-full object-cover" controls preload="none" />
      </div>
    )
  }
  return (
    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-slate-100 px-3 text-center text-xs text-slate-500">
      {asset?.mime_type || 'File'}
    </div>
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

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0)
  if (!Number.isFinite(size) || size <= 0) return '-'
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function emptyProviderForm() {
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

function compactTabLabel(label) {
  if (label === 'AI Providers') return 'Providers'
  if (label === 'AI Responses') return 'Responses'
  return label
}

function getDefaultFilesPageSize() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 24
  return window.matchMedia('(max-width: 767px)').matches ? 12 : 24
}

function downloadAssetFile(asset) {
  const downloadUrl = resolvePublicAssetUrl(asset?.public_path) || asset?.browser_public_path || asset?.public_path
  if (!downloadUrl || typeof document === 'undefined') return
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = asset.original_name || ''
  link.rel = 'noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export default function FilesPage() {
  const { notify, user, t } = useApp()
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('files')
  const [activeTab, setActiveTab] = useState('assets')

  const [files, setFiles] = useState([])
  const [search, setSearch] = useState('')
  const [mediaType, setMediaType] = useState('all')
  const deferredSearch = useDeferredValue(search)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => getDefaultFilesPageSize())
  const [totalFiles, setTotalFiles] = useState(0)
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingAssetId, setDeletingAssetId] = useState(null)
  const [selectedAssetIds, setSelectedAssetIds] = useState(() => new Set())

  const [providers, setProviders] = useState([])
  const [providerMeta, setProviderMeta] = useState({})
  const [providerForm, setProviderForm] = useState(() => emptyProviderForm())
  const [loadingProviders, setLoadingProviders] = useState(false)
  const [savingProvider, setSavingProvider] = useState(false)
  const [testingProviderId, setTestingProviderId] = useState(null)

  const [responses, setResponses] = useState([])
  const [loadingResponses, setLoadingResponses] = useState(false)
  const [expandedResponseId, setExpandedResponseId] = useState(null)
  const fileLoadRequestRef = useRef(0)
  const providerLoadRequestRef = useRef(0)
  const responseLoadRequestRef = useRef(0)
  const actionHistory = useActionHistory({ limit: 3, notify })

  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key, fallback, fallbackKm = fallback) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallback
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
    () => files.map((asset) => Number(asset?.id || 0)).filter((id) => id > 0),
    [files],
  )
  const allFilesSelected = selectableFileIds.length > 0 && selectableFileIds.every((id) => selectedAssetIds.has(id))
  const selectedAssets = useMemo(
    () => files.filter((asset) => selectedAssetIds.has(Number(asset?.id || 0))),
    [files, selectedAssetIds],
  )
  const bulkDeletableAssets = useMemo(
    () => selectedAssets.filter((asset) => asset?.canDelete),
    [selectedAssets],
  )

  const buildProviderPayload = useCallback((provider = {}, overrides = {}) => ({
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

  const loadFiles = useCallback(async () => {
    const requestId = beginTrackedRequest(fileLoadRequestRef)
    setLoadingFiles(true)
    try {
      const result = await withLoaderTimeout(() => window.api.getFiles({
        search: deferredSearch,
        mediaType,
        page,
        pageSize,
        includeMeta: true,
      }), 'Files library')
      if (!isTrackedRequestCurrent(fileLoadRequestRef, requestId)) return
      const nextFiles = Array.isArray(result?.items) ? result.items : []
      setFiles(nextFiles)
      setTotalFiles(Number(result?.total || nextFiles.length || 0))
      setSelectedAssetIds((current) => {
        const validIds = new Set(nextFiles.map((asset) => Number(asset?.id || 0)).filter((id) => id > 0))
        return new Set([...current].filter((id) => validIds.has(id)))
      })
    } catch (error) {
      if (!isTrackedRequestCurrent(fileLoadRequestRef, requestId)) return
      notify(error?.message || 'Failed to load files', 'error')
    } finally {
      if (isTrackedRequestCurrent(fileLoadRequestRef, requestId)) setLoadingFiles(false)
    }
  }, [deferredSearch, mediaType, notify, page, pageSize])

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
      const result = await withLoaderTimeout(() => window.api.getAiProviders(), label)
      if (!isTrackedRequestCurrent(providerLoadRequestRef, requestId)) return null
      setProviders(Array.isArray(result?.items) ? result.items : [])
      setProviderMeta(result?.providerMeta || {})
      return result
    } catch (error) {
      if (!isTrackedRequestCurrent(providerLoadRequestRef, requestId)) return null
      notify(error?.message || 'Failed to load AI providers', 'error')
      return null
    } finally {
      if (isTrackedRequestCurrent(providerLoadRequestRef, requestId)) {
        setLoadingProviders(false)
      }
    }
  }, [notify])

  const loadResponses = useCallback(async (label = 'AI responses') => {
    const requestId = beginTrackedRequest(responseLoadRequestRef)
    setLoadingResponses(true)
    try {
      const result = await withLoaderTimeout(() => window.api.getAiResponses(80), label)
      if (!isTrackedRequestCurrent(responseLoadRequestRef, requestId)) return null
      setResponses(Array.isArray(result?.items) ? result.items : [])
      return result
    } catch (error) {
      if (!isTrackedRequestCurrent(responseLoadRequestRef, requestId)) return null
      notify(error?.message || 'Failed to load AI responses', 'error')
      return null
    } finally {
      if (isTrackedRequestCurrent(responseLoadRequestRef, requestId)) {
        setLoadingResponses(false)
      }
    }
  }, [notify])

  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(fileLoadRequestRef)
      invalidateTrackedRequest(providerLoadRequestRef)
      invalidateTrackedRequest(responseLoadRequestRef)
      setLoadingFiles(false)
      setLoadingProviders(false)
      setLoadingResponses(false)
      return undefined
    }
    return undefined
  }, [isActive])

  useEffect(() => {
    if (!isActive) return undefined
    const timer = window.setTimeout(() => { void loadFiles() }, 120)
    return () => window.clearTimeout(timer)
  }, [isActive, loadFiles])

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

  async function handleDeleteAsset(asset) {
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
    } catch (error) {
      notify(error?.message || 'Delete failed', 'error')
    } finally {
      setDeletingAssetId(null)
    }
  }

  function toggleAssetSelection(assetId) {
    const numericId = Number(assetId || 0)
    if (!numericId) return
    setSelectedAssetIds((current) => {
      const next = new Set(current)
      if (next.has(numericId)) next.delete(numericId)
      else next.add(numericId)
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

  async function handleDeleteSelectedAssets() {
    if (!bulkDeletableAssets.length || deletingAssetId != null) return
    const blockedCount = selectedAssets.length - bulkDeletableAssets.length
    const confirmMessage = blockedCount > 0
      ? tr(
        'delete_selected_partial_confirm',
        `Delete ${bulkDeletableAssets.length} selected files? ${blockedCount} file(s) are still in use and will be skipped.`,
        `លុបឯកសារដែលបានជ្រើស ${bulkDeletableAssets.length} មែនទេ? មាន ${blockedCount} ឯកសារកំពុងត្រូវបានប្រើ ហើយនឹងត្រូវរំលង។`,
      )
      : tr(
        'delete_selected_confirm',
        `Delete ${bulkDeletableAssets.length} selected file(s)?`,
        `លុបឯកសារដែលបានជ្រើស ${bulkDeletableAssets.length} មែនទេ?`,
      )
    if (!window.confirm(confirmMessage)) return
    setDeletingAssetId('bulk')
    try {
      for (const asset of bulkDeletableAssets) {
        await window.api.deleteFileAsset(asset.id, { expectedUpdatedAt: asset.updated_at || undefined })
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
      await loadFiles()
    } catch (error) {
      notify(error?.message || 'Bulk delete failed', 'error')
    } finally {
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

  function startEditProvider(provider) {
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

    setSavingProvider(true)
    try {
      const result = providerForm.id
        ? await window.api.updateAiProvider(providerForm.id, payload)
        : await window.api.createAiProvider(payload)
      const savedProvider = cloneHistorySnapshot(result?.item || { ...payload, id: providerForm.id || extractHistoryResultId(result) })
      notify(providerForm.id ? 'Provider updated' : 'Provider added', 'success')
      startCreateProvider()
      await loadProviders()
      if (previousSnapshot?.id && !String(payload.api_key || '').trim()) {
        actionHistory.pushAction({
          label: `Edit provider ${previousSnapshot.name || savedProvider.name || ''}`.trim(),
          undo: async () => {
            const undoResult = await window.api.updateAiProvider(previousSnapshot.id, buildProviderPayload(previousSnapshot))
            if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to restore provider')
            await loadProviders()
          },
          redo: async () => {
            const redoResult = await window.api.updateAiProvider(savedProvider.id, buildProviderPayload(savedProvider))
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
            const undoResult = await window.api.deleteAiProvider(createdProviderId, { userId: user?.id, userName: user?.name, expectedUpdatedAt: savedProvider.updated_at || undefined })
            if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to undo provider creation')
            await loadProviders()
          },
          redo: async () => {
            const redoResult = await window.api.createAiProvider(createdProviderPayload)
            if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to recreate provider')
            createdProviderId = extractHistoryResultId(redoResult)
            await loadProviders()
          },
        })
      }
    } catch (error) {
      notify(error?.message || 'Failed to save provider', 'error')
    } finally {
      setSavingProvider(false)
    }
  }

  async function testProvider(providerId) {
    setTestingProviderId(providerId)
    try {
      const result = await window.api.testAiProvider(providerId, { userId: user?.id, userName: user?.name })
      if (result?.passed === false) {
        notify(result?.message || 'Provider test failed', 'error')
      } else {
        notify(result?.message || 'Provider test passed', 'success')
      }
      await loadProviders()
    } catch (error) {
      notify(error?.message || 'Provider test failed', 'error')
      await loadProviders()
    } finally {
      setTestingProviderId(null)
    }
  }

  async function removeProvider(provider) {
    if (!provider?.id) return
    if (!window.confirm(`Delete AI provider "${provider.name}"?`)) return
    try {
      await window.api.deleteAiProvider(provider.id, { userId: user?.id, userName: user?.name, expectedUpdatedAt: provider.updated_at || undefined })
      notify('Provider deleted', 'success')
      if (providerForm.id === provider.id) startCreateProvider()
      await loadProviders()
    } catch (error) {
      notify(error?.message || 'Failed to delete provider', 'error')
    }
  }

  const tabButton = (id, label, Icon) => (
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
        actions={(
          <div className="inline-flex min-w-0 items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {tabButton('assets', tr('library_assets', 'Assets'), FolderOpen)}
          {tabButton('providers', tr('library_ai_providers', 'AI Providers', 'AI Providers'), KeyRound)}
          {tabButton('responses', tr('library_ai_responses', 'AI Responses', 'ចម្លើយ AI'), History)}
          </div>
        )}
      />

      <ActionHistoryBar history={actionHistory} className="mb-1" />

      {activeTab === 'assets' ? (
        <>
          <div className="card p-3 sm:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid gap-3 sm:grid-cols-[1fr_180px] lg:flex-1">
                <div>
                  <label htmlFor="library-search" className="sr-only">{tr('search_files', 'Search files')}</label>
                  <input id="library-search" name="library_search" className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr('search_files', 'Search files')} />
                </div>
                <div>
                  <label htmlFor="library-media-type" className="sr-only">{tr('filter_media_type', 'Filter by media type')}</label>
                  <select id="library-media-type" name="library_media_type" className="input" value={mediaType} onChange={(event) => setMediaType(event.target.value)}>
                  <option value="all">{tr('all', 'All')}</option>
                  <option value="image">{tr('images', 'Images')}</option>
                  <option value="video">{tr('videos', 'Videos')}</option>
                  <option value="document">{tr('documents', 'Documents')}</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="library-page-size" className="sr-only">{tr('rows_per_page', 'Rows per page')}</label>
                <select
                  id="library-page-size"
                  name="library_page_size"
                  className="input min-w-[7.5rem]"
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value || 24))}
                >
                  {[12, 24, 48].map((value) => (
                    <option key={value} value={value}>{value} / {tr('page', 'page')}</option>
                  ))}
                </select>
                <label htmlFor="library-upload-file" className="btn-primary cursor-pointer text-sm">
                  {uploading ? tr('uploading', 'Uploading...') : tr('upload_file', 'Upload file')}
                  <input id="library-upload-file" name="library_upload_file" type="file" accept="image/*,video/*,.pdf,.csv,text/csv" className="hidden" onChange={handleUpload} />
                </label>
              </div>
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
                <button type="button" className="btn-secondary px-3 py-1.5 text-xs sm:text-sm" onClick={handleDownloadSelected}>
                  <Save className="mr-1.5 inline h-3.5 w-3.5" />
                  {tr('download', 'Download', 'ទាញយក')}
                </button>
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
                {bulkDeletableAssets.length !== selectedAssets.length ? (
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
                const assetId = Number(asset?.id || 0)
                const selected = selectedAssetIds.has(assetId)
                return (
                  <div key={asset.id} className="card min-w-0 overflow-hidden p-3 sm:p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        className="inline-flex min-w-0 items-center gap-2 rounded-full px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        onClick={() => toggleAssetSelection(asset.id)}
                      >
                        {selected ? <CheckSquare className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4" />}
                        <span>{tr('select', 'Select')}</span>
                      </button>
                      <span className={`max-w-full rounded-full px-2 py-1 text-[10px] font-semibold ${asset.usageCount ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200'}`}>
                        {asset.usageCount ? `${asset.usageCount} use(s)` : tr('unused', 'Unused')}
                      </span>
                    </div>
                    <AssetPreview asset={asset} />
                    <div className="mt-3 min-w-0">
                      <div className="truncate text-sm font-semibold leading-5 text-slate-900 dark:text-white" title={asset.original_name}>{asset.original_name}</div>
                      <div className="mt-1 truncate rounded-xl bg-slate-50 px-2 py-1 text-[10px] leading-4 text-slate-500 dark:bg-slate-800/60" title={resolvePublicAssetUrl(asset.public_path) || asset.browser_public_path || asset.public_path}>{resolvePublicAssetUrl(asset.public_path) || asset.browser_public_path || asset.public_path}</div>
                      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        <span>{asset.media_type || 'file'}</span>
                        <span className="text-right">{formatFileSize(asset.byte_size)}</span>
                        <span>{tr('date_added', 'Date added')}</span>
                        <span className="text-right">{formatDateTime(asset.created_at)}</span>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button type="button" className="btn-secondary min-w-0 justify-center px-2.5 text-sm sm:px-3" onClick={() => navigator.clipboard?.writeText(resolvePublicAssetUrl(asset.public_path) || asset.browser_public_path || asset.public_path).catch(() => {})} title={tr('copy', 'Copy')}>
                        <Copy className="inline h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">{tr('copy', 'Copy')}</span>
                      </button>
                      <button
                        type="button"
                        className="btn-secondary min-w-0 justify-center px-2.5 text-sm sm:px-3"
                        onClick={() => handleDeleteAsset(asset)}
                        disabled={!asset.canDelete || deletingAssetId != null}
                        title={tr('delete', 'Delete')}
                      >
                        <Trash2 className="inline h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">{deletingAssetId === asset.id ? tr('deleting', 'Deleting...') : tr('delete', 'Delete')}</span>
                        <span className="sm:hidden">{deletingAssetId === asset.id ? '...' : null}</span>
                      </button>
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
    </div>
  )
}
