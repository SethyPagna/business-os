import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Brain,
  ChevronDown,
  ChevronUp,
  Copy,
  FolderOpen,
  History,
  Image as ImageIcon,
  KeyRound,
  RefreshCcw,
  Save,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Trash2,
  Upload,
} from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import PageHeader from '../shared/PageHeader'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

function AssetPreview({ asset }) {
  if (asset?.media_type === 'image') {
    return <img src={asset.public_path} alt={asset.original_name} className="h-32 w-full rounded-2xl object-cover" loading="lazy" decoding="async" />
  }
  if (asset?.media_type === 'video') {
    return <video src={asset.public_path} className="h-32 w-full rounded-2xl object-cover" controls preload="none" />
  }
  return (
    <div className="flex h-32 w-full items-center justify-center rounded-2xl bg-slate-100 text-xs text-slate-500">
      {asset?.mime_type || 'File'}
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

function ProviderStatus({ provider }) {
  const status = provider?.last_status || 'untested'
  if (status === 'ok') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> Ready</span>
  }
  if (status === 'error') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">Needs attention</span>
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Untested</span>
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

export default function FilesPage() {
  const { notify, user, t, page } = useApp()
  const { syncChannel } = useSync()
  const [activeTab, setActiveTab] = useState('assets')

  const [files, setFiles] = useState([])
  const [search, setSearch] = useState('')
  const [mediaType, setMediaType] = useState('all')
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingAssetId, setDeletingAssetId] = useState(null)

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

  const loadFiles = useCallback(async () => {
    const requestId = beginTrackedRequest(fileLoadRequestRef)
    setLoadingFiles(true)
    try {
      const result = await withLoaderTimeout(() => window.api.getFiles({ search, mediaType }), 'Files library')
      if (!isTrackedRequestCurrent(fileLoadRequestRef, requestId)) return
      setFiles(Array.isArray(result) ? result : (result?.data || []))
    } catch (error) {
      if (!isTrackedRequestCurrent(fileLoadRequestRef, requestId)) return
      notify(error?.message || 'Failed to load files', 'error')
    } finally {
      if (isTrackedRequestCurrent(fileLoadRequestRef, requestId)) setLoadingFiles(false)
    }
  }, [mediaType, notify, search])

  useEffect(() => {
    loadFiles()
    loadProviders()
    loadResponses()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (page !== 'files') return
    if (!files.length && !loadingFiles) loadFiles()
    if (!providers.length && !loadingProviders) loadProviders()
    if (!responses.length && !loadingResponses) loadResponses()
  }, [files.length, loadingFiles, loadingProviders, loadingResponses, loadFiles, page, providers.length, responses.length])

  useEffect(() => {
    const timer = window.setTimeout(() => { loadFiles() }, 180)
    return () => window.clearTimeout(timer)
  }, [loadFiles])

  useEffect(() => {
    if (!syncChannel) return
    const channel = String(syncChannel.channel || '')
    if (channel === 'files') loadFiles()
    if (channel === 'files' || channel === 'settings') loadProviders()
  }, [loadFiles, syncChannel]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => invalidateTrackedRequest(fileLoadRequestRef), [])

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

  async function loadProviders() {
    setLoadingProviders(true)
    try {
      const result = await withLoaderTimeout(() => window.api.getAiProviders(), 'AI providers')
      setProviders(Array.isArray(result?.items) ? result.items : [])
      setProviderMeta(result?.providerMeta || {})
    } catch (error) {
      notify(error?.message || 'Failed to load AI providers', 'error')
    } finally {
      setLoadingProviders(false)
    }
  }

  async function loadResponses() {
    setLoadingResponses(true)
    try {
      const result = await withLoaderTimeout(() => window.api.getAiResponses(80), 'AI responses')
      setResponses(Array.isArray(result?.items) ? result.items : [])
    } catch (error) {
      notify(error?.message || 'Failed to load AI responses', 'error')
    } finally {
      setLoadingResponses(false)
    }
  }

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
      if (providerForm.id) await window.api.updateAiProvider(providerForm.id, payload)
      else await window.api.createAiProvider(payload)
      notify(providerForm.id ? 'Provider updated' : 'Provider added', 'success')
      startCreateProvider()
      await loadProviders()
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
      notify(result?.message || 'Provider test passed', 'success')
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
      className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition sm:text-sm ${activeTab === id ? 'bg-slate-950 text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
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
          <div className="grid grid-cols-3 gap-1.5">
          {tabButton('assets', tr('library_assets', 'Assets'), FolderOpen)}
          {tabButton('providers', tr('library_ai_providers', 'AI Providers', 'AI Providers'), KeyRound)}
          {tabButton('responses', tr('library_ai_responses', 'AI Responses', 'ចម្លើយ AI'), History)}
          </div>
        )}
      />

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
              <label htmlFor="library-upload-file" className="btn-primary cursor-pointer text-sm">
                {uploading ? tr('uploading', 'Uploading...') : tr('upload_file', 'Upload file')}
                <input id="library-upload-file" name="library_upload_file" type="file" accept="image/*,video/*,.pdf,.csv,text/csv" className="hidden" onChange={handleUpload} />
              </label>
            </div>
          </div>

          {loadingFiles ? <div className="card px-4 py-10 text-center text-sm text-slate-400">{tr('loading', 'Loading...')}</div> : null}
          {!loadingFiles && !files.length ? <div className="card px-4 py-10 text-center text-sm text-slate-500">{tr('no_files_yet', 'No files yet.')}</div> : null}

          {files.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {files.map((asset) => (
                <div key={asset.id} className="card p-4">
                  <AssetPreview asset={asset} />
                  <div className="mt-3 min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{asset.original_name}</div>
                    <div className="mt-1 break-all text-xs text-slate-500">{asset.public_path}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {asset.media_type || 'file'}{asset.byte_size ? ` · ${(asset.byte_size / 1024).toFixed(0)} KB` : ''}
                    </div>
                    {asset.usageCount
                      ? <div className="mt-1 text-xs text-amber-600">{asset.usageCount} use(s)</div>
                      : <div className="mt-1 text-xs text-emerald-600">Unused</div>}
                  </div>
                  <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                    <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={() => navigator.clipboard?.writeText(asset.public_path).catch(() => {})}>
                      <Copy className="mr-2 inline h-4 w-4" />
                      {tr('copy_path', 'Copy path')}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary shrink-0 whitespace-nowrap text-sm"
                      onClick={() => handleDeleteAsset(asset)}
                      disabled={!asset.canDelete || deletingAssetId != null}
                    >
                      <Trash2 className="mr-2 inline h-4 w-4" />
                      {deletingAssetId === asset.id ? tr('deleting', 'Deleting...') : tr('delete', 'Delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {activeTab === 'providers' ? (
        <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr] 2xl:grid-cols-[1.3fr,0.7fr]">
          <section className="card p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{tr('library_ai_providers', 'AI Providers', 'AI Providers')}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{tr('ai_providers_hint', 'Store provider keys securely, keep them masked after save, and test each connection before using it in the portal.', 'រក្សាទុកសោ provider ឲ្យមានសុវត្ថិភាព លាក់វាបន្ទាប់ពីរក្សាទុក ហើយសាកល្បងមុនប្រើក្នុង Customer Portal។')}</p>
              </div>
              <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={loadProviders}>
                <RefreshCcw className="mr-2 inline h-4 w-4" />
                {tr('refresh', 'Refresh', 'ស្រស់ថ្មី')}
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {loadingProviders ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">{tr('loading_providers', 'Loading providers...', 'កំពុងផ្ទុក providers...')}</div> : null}
              {!loadingProviders && !providers.length ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">{tr('no_ai_providers', 'No AI providers yet.', 'មិនទាន់មាន AI providers ទេ។')}</div> : null}
              {providers.map((provider) => (
                <article key={provider.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">{provider.name}</div>
                        <ProviderStatus provider={provider} />
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">{provider.provider_label || provider.provider}</span>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">{provider.default_model || 'No default model'}</span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {provider.account_email || 'No account email'}{provider.project_name ? ` · ${provider.project_name}` : ''}{provider.key_masked ? ` · ${provider.key_masked}` : ''}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span className="rounded-full bg-white px-2.5 py-1">Priority {provider.priority}</span>
                        <span className="rounded-full bg-white px-2.5 py-1">{provider.requests_per_minute}/min</span>
                        <span className="rounded-full bg-white px-2.5 py-1">{provider.max_input_chars} chars</span>
                        <span className="rounded-full bg-white px-2.5 py-1">{provider.timeout_ms} ms timeout</span>
                      </div>
                      {provider.last_error ? <div className="mt-2 text-xs text-rose-600">{provider.last_error}</div> : null}
                      {provider.notes ? <div className="mt-2 text-sm text-slate-600">{provider.notes}</div> : null}
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={() => startEditProvider(provider)}>
                        Edit
                      </button>
                      <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={() => testProvider(provider.id)} disabled={testingProviderId === provider.id}>
                        <TestTube2 className="mr-2 inline h-4 w-4" />
                        {testingProviderId === provider.id ? 'Testing...' : 'Test'}
                      </button>
                      <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={() => removeProvider(provider)}>
                        <Trash2 className="mr-2 inline h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{providerForm.id ? 'Edit provider' : 'Add provider'}</h2>
                <p className="mt-1 text-sm text-slate-500">Only the API key is required for a new entry. Everything else helps you keep the accounts organized.</p>
              </div>
              <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={startCreateProvider}>New</button>
            </div>

            <div className="mt-4 grid gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Provider</label>
                <select
                  id="provider-form-provider"
                  name="provider_form_provider"
                  className="input mt-1"
                  value={providerForm.provider}
                  onChange={(event) => setProviderForm((current) => ({
                    ...current,
                    provider: event.target.value,
                    provider_type: providerMeta?.[event.target.value]?.supportedTypes?.[0] || 'chat',
                    default_model: providerMeta?.[event.target.value]?.defaultModel || '',
                    priority: providerMeta?.[event.target.value]?.defaultPriority || 50,
                    requests_per_minute: providerMeta?.[event.target.value]?.safeRequestsPerMinute || 10,
                    max_input_chars: providerMeta?.[event.target.value]?.safeMaxInputChars || 1000,
                    max_completion_tokens: providerMeta?.[event.target.value]?.safeMaxCompletionTokens || 1200,
                    timeout_ms: providerMeta?.[event.target.value]?.safeTimeoutMs || 15000,
                    cooldown_seconds: providerMeta?.[event.target.value]?.safeCooldownSeconds || 20,
                  }))}
                >
                  {providerOptions.map(([key, meta]) => (
                    <option key={key} value={key}>{meta.label || key}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="provider-form-name" className="block text-sm font-medium text-slate-700">{providerText.entryName}</label>
                  <input id="provider-form-name" name="provider_form_name" className="input mt-1" value={providerForm.name} onChange={(event) => setProviderForm((current) => ({ ...current, name: event.target.value }))} placeholder={isKhmer ? 'គណនី Groq សំខាន់' : 'Groq main account'} />
                </div>
                <div>
                  <label htmlFor="provider-form-type" className="block text-sm font-medium text-slate-700">{providerText.type}</label>
                  <select id="provider-form-type" name="provider_form_type" className="input mt-1" value={providerForm.provider_type} onChange={(event) => setProviderForm((current) => ({ ...current, provider_type: event.target.value }))}>
                    {(selectedProviderMeta?.supportedTypes || ['chat']).map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="provider-form-email" className="block text-sm font-medium text-slate-700">{providerText.accountEmail}</label>
                  <input id="provider-form-email" name="provider_form_email" className="input mt-1" value={providerForm.account_email} onChange={(event) => setProviderForm((current) => ({ ...current, account_email: event.target.value }))} />
                </div>
                <div>
                  <label htmlFor="provider-form-project" className="block text-sm font-medium text-slate-700">{providerText.projectWorkspace}</label>
                  <input id="provider-form-project" name="provider_form_project" className="input mt-1" value={providerForm.project_name} onChange={(event) => setProviderForm((current) => ({ ...current, project_name: event.target.value }))} />
                </div>
              </div>
              <div>
                <label htmlFor="provider-form-api-key" className="block text-sm font-medium text-slate-700">{providerText.apiKey}</label>
                <input id="provider-form-api-key" name="provider_form_api_key" className="input mt-1" value={providerForm.api_key} onChange={(event) => setProviderForm((current) => ({ ...current, api_key: event.target.value }))} placeholder={providerForm.id ? (isKhmer ? 'ទុកទទេ ដើម្បីរក្សាសោបច្ចុប្បន្ន' : 'Leave blank to keep the current key') : (isKhmer ? 'បិទភ្ជាប់សោ API' : 'Paste API key')} />
                <p className="mt-1 text-xs text-slate-500">{providerText.apiKeyHint}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="provider-form-model" className="block text-sm font-medium text-slate-700">{providerText.defaultModel}</label>
                  <input id="provider-form-model" name="provider_form_model" className="input mt-1" value={providerForm.default_model} onChange={(event) => setProviderForm((current) => ({ ...current, default_model: event.target.value }))} placeholder={selectedProviderMeta?.defaultModel || ''} />
                </div>
                <div>
                  <label htmlFor="provider-form-endpoint" className="block text-sm font-medium text-slate-700">{providerText.endpointOverride}</label>
                  <input id="provider-form-endpoint" name="provider_form_endpoint" className="input mt-1" value={providerForm.endpoint_override} onChange={(event) => setProviderForm((current) => ({ ...current, endpoint_override: event.target.value }))} placeholder={selectedProviderMeta?.defaultEndpoint || ''} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label htmlFor="provider-form-priority" className="block text-sm font-medium text-slate-700">{providerText.priority}</label>
                  <input id="provider-form-priority" name="provider_form_priority" className="input mt-1" type="number" min="1" max="999" value={providerForm.priority} onChange={(event) => setProviderForm((current) => ({ ...current, priority: event.target.value }))} />
                  <p className="mt-1 text-xs text-slate-500">{providerText.priorityHint}</p>
                </div>
                <div>
                  <label htmlFor="provider-form-rpm" className="block text-sm font-medium text-slate-700">{providerText.rpm}</label>
                  <input id="provider-form-rpm" name="provider_form_requests_per_minute" className="input mt-1" type="number" min="1" max="120" value={providerForm.requests_per_minute} onChange={(event) => setProviderForm((current) => ({ ...current, requests_per_minute: event.target.value }))} />
                </div>
                <div>
                  <label htmlFor="provider-form-max-input" className="block text-sm font-medium text-slate-700">{providerText.maxInput}</label>
                  <input id="provider-form-max-input" name="provider_form_max_input_chars" className="input mt-1" type="number" min="200" max="4000" value={providerForm.max_input_chars} onChange={(event) => setProviderForm((current) => ({ ...current, max_input_chars: event.target.value }))} />
                </div>
                <div>
                  <label htmlFor="provider-form-max-output" className="block text-sm font-medium text-slate-700">{providerText.maxOutput}</label>
                  <input id="provider-form-max-output" name="provider_form_max_completion_tokens" className="input mt-1" type="number" min="128" max="8192" value={providerForm.max_completion_tokens} onChange={(event) => setProviderForm((current) => ({ ...current, max_completion_tokens: event.target.value }))} />
                </div>
                <div>
                  <label htmlFor="provider-form-timeout" className="block text-sm font-medium text-slate-700">{providerText.timeout}</label>
                  <input id="provider-form-timeout" name="provider_form_timeout_ms" className="input mt-1" type="number" min="3000" max="60000" step="500" value={providerForm.timeout_ms} onChange={(event) => setProviderForm((current) => ({ ...current, timeout_ms: event.target.value }))} />
                </div>
                <div>
                  <label htmlFor="provider-form-cooldown" className="block text-sm font-medium text-slate-700">{providerText.cooldown}</label>
                  <input id="provider-form-cooldown" name="provider_form_cooldown_seconds" className="input mt-1" type="number" min="5" max="300" value={providerForm.cooldown_seconds} onChange={(event) => setProviderForm((current) => ({ ...current, cooldown_seconds: event.target.value }))} />
                </div>
              </div>
              <div>
                <label htmlFor="provider-form-supported-models" className="block text-sm font-medium text-slate-700">{providerText.supportedModels}</label>
                <textarea id="provider-form-supported-models" name="provider_form_supported_models" className="input mt-1 resize-none" rows={4} value={providerForm.supported_models_text} onChange={(event) => setProviderForm((current) => ({ ...current, supported_models_text: event.target.value }))} placeholder={isKhmer ? 'មួយម៉ូឌែលក្នុងមួយបន្ទាត់' : 'One model per line'} />
              </div>
              <div>
                <label htmlFor="provider-form-notes" className="block text-sm font-medium text-slate-700">{providerText.notes}</label>
                <textarea id="provider-form-notes" name="provider_form_notes" className="input mt-1 resize-none" rows={4} value={providerForm.notes} onChange={(event) => setProviderForm((current) => ({ ...current, notes: event.target.value }))} placeholder={isKhmer ? 'គោលបំណង ថវិកាប្រចាំខែ ឬពេលណាគួរប្រើ provider នេះ' : 'Purpose, monthly budget, or when to use this provider'} />
              </div>
              <label htmlFor="provider-form-enabled" className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{providerText.enabled}</span>
                <input id="provider-form-enabled" name="provider_form_enabled" type="checkbox" checked={providerForm.enabled} onChange={(event) => setProviderForm((current) => ({ ...current, enabled: event.target.checked }))} />
              </label>
              <button type="button" className="btn-primary text-sm" onClick={saveProvider} disabled={savingProvider}>
                <Save className="mr-2 inline h-4 w-4" />
                {savingProvider ? providerText.saving : (providerForm.id ? providerText.saveProvider : providerText.addProvider)}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === 'responses' ? (
        <section className="card p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{tr('library_ai_responses', 'AI Responses', 'ចម្លើយ AI')}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{tr('ai_responses_hint', 'Saved portal answers stay here so the team can review what was suggested, by which provider, and with what product references.', 'ចម្លើយ Portal ដែលបានរក្សាទុកនឹងនៅទីនេះ ដើម្បីឲ្យក្រុមអាចពិនិត្យបានថា provider មួយណាបានផ្តល់សំណើអ្វី និងយោងផលិតផលណាខ្លះ។')}</p>
            </div>
            <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={loadResponses}>
              <RefreshCcw className="mr-2 inline h-4 w-4" />
              {tr('refresh', 'Refresh', 'ស្រស់ថ្មី')}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {loadingResponses ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">{tr('loading_ai_responses', 'Loading AI responses...', 'កំពុងផ្ទុកចម្លើយ AI...')}</div> : null}
            {!loadingResponses && !responses.length ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">{tr('no_ai_responses', 'No AI responses saved yet.', 'មិនទាន់មានចម្លើយ AI ដែលបានរក្សាទុកទេ។')}</div> : null}
            {responses.map((entry) => {
              const expanded = expandedResponseId === entry.id
              return (
                <article key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-4 text-left"
                    onClick={() => setExpandedResponseId((current) => current === entry.id ? null : entry.id)}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                          <Brain className="h-3.5 w-3.5" />
                          {entry.provider_name || entry.provider || 'AI'}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                          <Sparkles className="h-3.5 w-3.5" />
                          {entry.model || 'Model'}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                          {entry.surface || 'portal'}
                        </span>
                      </div>
                      <div className="mt-3 text-sm font-semibold text-slate-900">{entry.question_text || 'No question text'}</div>
                      <div className="mt-1 line-clamp-2 text-sm text-slate-600">{entry.answer_text || 'No saved summary.'}</div>
                      <div className="mt-2 text-xs text-slate-500">{entry.actor_label || entry.actor_user_name || 'Unknown user'} · {formatDateTime(entry.created_at)}</div>
                    </div>
                    <span className="mt-1 rounded-full bg-white p-2 text-slate-500">{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                  </button>

                  {expanded ? (
                    <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{tr('profile', 'Profile', 'ប្រវត្តិរូប')}</div>
                          <div className="mt-2 space-y-2 text-sm text-slate-600">
                            {Object.entries(entry.profile || {}).filter(([, value]) => value).map(([key, value]) => (
                              <div key={key}><span className="font-medium capitalize text-slate-900">{key}:</span> {String(value)}</div>
                            ))}
                            {!Object.entries(entry.profile || {}).filter(([, value]) => value).length ? <div>{tr('no_profile_fields', 'No profile fields were supplied.', 'មិនមានទិន្នន័យប្រវត្តិរូបត្រូវបានផ្តល់ទេ។')}</div> : null}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Candidate products</div>
                          <div className="mt-3 space-y-2">
                            {(entry.candidate_products || []).slice(0, 12).map((product) => (
                              <div key={product.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                <div className="font-medium text-slate-900">{product.name}</div>
                                <div className="text-xs text-slate-500">{product.brand || 'No brand'} · {product.category || 'No category'}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recommendations</div>
                          <div className="mt-3 space-y-3">
                            {(entry.recommendations || []).map((recommendation, index) => (
                              <div key={`${entry.id}-${recommendation.product_id || index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex items-start gap-3">
                                  {recommendation.image_path ? (
                                    <img src={recommendation.image_path} alt={recommendation.name} className="h-14 w-14 rounded-2xl object-cover" />
                                  ) : (
                                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400">
                                      <ImageIcon className="h-5 w-5" />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-900">{recommendation.name}</div>
                                    <div className="mt-1 text-xs text-slate-500">{recommendation.brand || 'No brand'} · {recommendation.category || 'No category'}</div>
                                    {recommendation.reason ? <div className="mt-2 text-sm text-slate-700">{recommendation.reason}</div> : null}
                                    {recommendation.fit_summary ? <div className="mt-2 text-sm text-slate-600">{recommendation.fit_summary}</div> : null}
                                    {recommendation.how_to_use ? <div className="mt-2 text-xs text-slate-500">Use: {recommendation.how_to_use}</div> : null}
                                    {recommendation.cautions ? <div className="mt-1 text-xs text-amber-700">Caution: {recommendation.cautions}</div> : null}
                                  </div>
                                </div>
                                {Array.isArray(recommendation.citations) && recommendation.citations.length ? (
                                  <div className="mt-3 rounded-xl bg-white px-3 py-2">
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Evidence</div>
                                    <div className="mt-2 space-y-2">
                                      {recommendation.citations.map((citation, citationIndex) => (
                                        <div key={`${entry.id}-${index}-${citationIndex}`} className="text-xs text-slate-600">
                                          <div className="font-medium text-slate-900">{citation.title || citation.source || citation.url}</div>
                                          <div>{citation.note || citation.source}</div>
                                          {citation.url ? <a href={citation.url} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">{citation.url}</a> : null}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}
