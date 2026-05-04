import { useState, useEffect, useRef, useCallback } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { isBrokenLocalizedString, useApp } from '../../AppContext'
import PageHeader from '../shared/PageHeader'
import { useIsPageActive } from '../shared/pageActivity'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

function useLocalCopy() {
  const { settings, t } = useApp()
  const isKhmer = settings?.language === 'km'
  return (key, fallbackEn, fallbackKm = fallbackEn) => {
    const translated = t?.(key)
    if (translated && translated !== key && !isBrokenLocalizedString(translated)) return translated
    return isKhmer ? fallbackKm : fallbackEn
  }
}

function isAutoDetected(syncUrl) {
  if (!syncUrl || typeof window === 'undefined') return false
  const isViteDev = window.location.hostname === 'localhost' &&
    (window.location.port === '5173' || window.location.port === '5174')
  return !isViteDev && syncUrl === window.location.origin
}

function StatusRow({ label, value, mono = false, extra = null }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="w-32 flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`flex-1 break-all text-xs text-gray-800 dark:text-gray-200 ${mono ? 'font-mono' : ''}`}>
        {value}
        {extra ? <span className="ml-2 text-gray-400">{extra}</span> : null}
      </span>
    </div>
  )
}

function InfoTab({ syncUrl, syncConnected, active = true }) {
  const { settings, t, formatDateTime, displayTimezone, deviceTimezone } = useApp()
  const copy = useLocalCopy()
  const [clientTime, setClientTime] = useState(new Date())
  const [serverTime, setServerTime] = useState(null)
  const [serverErr, setServerErr] = useState(null)
  const [drift, setDrift] = useState(null)
  const [fetching, setFetching] = useState(false)
  const [lastFetch, setLastFetch] = useState(null)
  const fetchRequestRef = useRef(0)

  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setClientTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [active])

  const fetchServerTime = useCallback(async () => {
    if (!active || !syncUrl) return
    const requestId = beginTrackedRequest(fetchRequestRef)
    setFetching(true)
    setServerErr(null)
    const startedAt = Date.now()
    try {
      const res = await fetch(`${syncUrl}/health`, {
        signal: AbortSignal.timeout(5000),
        headers: { 'bypass-tunnel-reminder': 'true' },
      })
      const rtt = Date.now() - startedAt
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const raw = data?.serverTime || res.headers.get('date')
      if (!raw) {
        if (!isTrackedRequestCurrent(fetchRequestRef, requestId)) return
        setServerTime(null)
        setServerErr('Server did not return time')
      } else {
        const serverDate = new Date(raw)
        const adjusted = new Date(serverDate.getTime() + rtt / 2)
        if (!isTrackedRequestCurrent(fetchRequestRef, requestId)) return
        setServerTime(adjusted)
        setDrift(Math.round(Date.now() - adjusted.getTime()))
      }
    } catch (error) {
      if (!isTrackedRequestCurrent(fetchRequestRef, requestId)) return
      setServerErr(error?.message || 'Fetch failed')
      setServerTime(null)
    }
    if (!isTrackedRequestCurrent(fetchRequestRef, requestId)) return
    setLastFetch(new Date())
    setFetching(false)
  }, [active, syncUrl])

  useEffect(() => {
    if (!active) {
      invalidateTrackedRequest(fetchRequestRef)
      setFetching(false)
      return undefined
    }
    fetchServerTime()
    const timer = setInterval(fetchServerTime, 15000)
    return () => clearInterval(timer)
  }, [active, fetchServerTime])
  useEffect(() => () => invalidateTrackedRequest(fetchRequestRef), [])

  const fmt = (value) => formatDateTime(value)
  const appliedTimezone = settings?.display_timezone || displayTimezone
  const mode = syncUrl ? (isAutoDetected(syncUrl) ? copy('sync_auto_mode', 'Auto-detected (same origin)', 'រកឃើញស្វ័យប្រវត្តិ (ដែនដើមដូចគ្នា)') : copy('manual', 'Manual', 'កំណត់ដោយដៃ')) : copy('sync_local_only_mode', 'Local (IndexedDB only)', 'មូលដ្ឋានីយ៉ាងតែប៉ុណ្ណោះ (IndexedDB)')
  const ws = syncUrl ? (syncConnected ? copy('connected', 'Connected', 'បានភ្ជាប់') : copy('reconnecting', 'Reconnecting...', 'កំពុងភ្ជាប់ឡើងវិញ...')) : copy('sync_local_only_short', 'Local only', 'មូលដ្ឋានីយ៉ាងតែប៉ុណ្ណោះ')

  const driftLabel = drift === null
    ? '--'
    : Math.abs(drift) < 1000
      ? `${drift}ms (in sync)`
      : Math.abs(drift) < 10000
        ? `${(drift / 1000).toFixed(1)}s slight drift`
        : `${(drift / 1000).toFixed(1)}s significant drift`

  const driftColor = drift === null
    ? 'text-gray-400'
    : Math.abs(drift) < 1000
      ? 'text-green-600 dark:text-green-400'
      : Math.abs(drift) < 10000
        ? 'text-yellow-600'
        : 'text-red-600'

  return (
    <div className="space-y-3 px-4 py-3 text-xs">
      <div className="space-y-1">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">{copy('sync_connection', 'Connection', 'ការតភ្ជាប់')}</p>
        <StatusRow label={copy('sync_mode', 'Mode', 'របៀប')} value={mode} />
        <StatusRow label={copy('server_url', 'Server URL', 'តំណម៉ាស៊ីនមេ')} value={syncUrl || copy('none', 'none', 'គ្មាន')} mono />
        <StatusRow label={copy('sync_websocket', 'WebSocket', 'WebSocket')} value={ws} />
      </div>

      <div className="space-y-1 border-t border-gray-100 pt-2 dark:border-gray-700">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">{copy('sync_client_this_device', 'Client (This Device)', 'ឧបករណ៍នេះ')}</p>
        <StatusRow label={copy('local_time', 'Local time', 'ម៉ោងមូលដ្ឋាន')} value={fmt(clientTime)} mono />
        <StatusRow label={copy('display_timezone', 'Display timezone', 'តំបន់ម៉ោងបង្ហាញ')} value={appliedTimezone} mono />
        <StatusRow label={copy('device_timezone', 'Device timezone', 'តំបន់ម៉ោងឧបករណ៍')} value={deviceTimezone} mono />
      </div>

      {syncUrl ? (
        <div className="space-y-1 border-t border-gray-100 pt-2 dark:border-gray-700">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">Server Time</p>
            <button
              onClick={fetchServerTime}
              disabled={fetching}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${fetching ? 'animate-spin' : ''}`} />
              {fetching ? copy('fetching', 'Fetching...', 'កំពុងទាញយក...') : copy('refresh', 'Refresh', 'ស្រស់ថ្មី')}
            </button>
          </div>

          {serverErr ? (
            <div className="rounded-lg bg-red-50 p-2 text-red-600 dark:bg-red-900/20 dark:text-red-400">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{serverErr} - server may be offline.</span>
              </div>
            </div>
          ) : (
            <>
              <StatusRow label="Server time" value={fmt(serverTime)} mono />
              <div className="flex gap-2 py-0.5">
                <span className="w-32 flex-shrink-0 text-gray-500 dark:text-gray-400">Drift</span>
                <span className={`text-xs font-mono ${driftColor}`}>{driftLabel}</span>
              </div>
              {lastFetch ? <StatusRow label="Last checked" value={fmt(lastFetch)} /> : null}
            </>
          )}

          <div className="mt-1 space-y-0.5 rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
            <p className="font-semibold">Time handling:</p>
            <p>Client and server previews use the selected <strong>{t('display_timezone')}</strong>.</p>
            <p>Audit metadata still keeps each device timezone for traceability.</p>
            <p>Reads may fall back locally, but writes are blocked until the server reconnects.</p>
            <p>If drift is above 10s, check the device clock settings.</p>
          </div>
        </div>
      ) : null}

      <div className="space-y-0.5 border-t border-gray-100 pt-2 text-gray-400 dark:border-gray-700">
        <p>Default login: admin / admin</p>
      </div>
    </div>
  )
}

function DiagnosticsPanel({ syncUrl, syncConnected, active = true }) {
  const copy = useLocalCopy()
  const [clientLog, setClientLog] = useState([])
  const [serverLog, setServerLog] = useState([])
  const [serverInfo, setServerInfo] = useState(null)
  const [writeErrors, setWriteErrors] = useState([])
  const [pendingSync, setPendingSync] = useState({ total: 0, pending: 0, syncing: 0, failed: 0, items: [] })
  const [retryingQueue, setRetryingQueue] = useState(false)
  const [tab, setTab] = useState('client')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const mounted = useRef(true)
  const queueRequestRef = useRef(0)
  const serverLogRequestRef = useRef(0)

  const loadQueueState = useCallback(async () => {
    if (!active) return
    const requestId = beginTrackedRequest(queueRequestRef)
    try {
      const state = await withLoaderTimeout(
        () => window.api?.getPendingSyncState?.(),
        'Pending sync queue',
      )
      if (mounted.current && isTrackedRequestCurrent(queueRequestRef, requestId) && state) {
        setPendingSync(state)
      }
    } catch (_) {}
  }, [active])

  useEffect(() => {
    if (!active) {
      mounted.current = false
      invalidateTrackedRequest(queueRequestRef)
      invalidateTrackedRequest(serverLogRequestRef)
      return undefined
    }
    mounted.current = true
    if (window.api?.getCallLog) setClientLog(window.api.getCallLog())
    loadQueueState()
    const onErr = (event) => {
      if (!mounted.current) return
      setWriteErrors((prev) => [{ ...event.detail, _id: Date.now() }, ...prev].slice(0, 20))
    }
    const onQueueChanged = () => {
      loadQueueState()
    }
    window.addEventListener('sync:error', onErr)
    window.addEventListener('sync:write-blocked', onErr)
    window.addEventListener('sync:queue-changed', onQueueChanged)
    return () => {
      mounted.current = false
      invalidateTrackedRequest(queueRequestRef)
      invalidateTrackedRequest(serverLogRequestRef)
      window.removeEventListener('sync:error', onErr)
      window.removeEventListener('sync:write-blocked', onErr)
      window.removeEventListener('sync:queue-changed', onQueueChanged)
    }
  }, [active, loadQueueState])

  const fetchServerLog = useCallback(async () => {
    if (!active || !syncUrl) return
    const requestId = beginTrackedRequest(serverLogRequestRef)
    try {
      const data = await withLoaderTimeout(() => window.api.getSystemDebugLog(), 'Server diagnostics')
      if (mounted.current && isTrackedRequestCurrent(serverLogRequestRef, requestId)) {
        setServerLog(data.entries || [])
        setServerInfo({ clients: data.clients, uptime: data.uptime })
      }
    } catch {
      // keep previous diagnostics visible if the authenticated fetch fails once
    }
  }, [active, syncUrl])

  useEffect(() => {
    if (!active || !syncUrl || !autoRefresh) return
    fetchServerLog()
    const timer = setInterval(fetchServerLog, 3000)
    return () => clearInterval(timer)
  }, [active, syncUrl, autoRefresh, fetchServerLog])

  const badge = {
    server: 'bg-blue-100 text-blue-700',
    local: 'bg-gray-100 text-gray-600',
  }

  async function handleRetryQueue() {
    if (!window.api?.retryPendingSyncNow) return
    setRetryingQueue(true)
    try {
      await window.api.retryPendingSyncNow()
      await loadQueueState()
    } finally {
      setRetryingQueue(false)
    }
  }

  async function handleDiscardQueue() {
    if (!window.api?.discardPendingSyncQueue) return
    setRetryingQueue(true)
    try {
      await window.api.discardPendingSyncQueue()
      await loadQueueState()
    } finally {
      setRetryingQueue(false)
    }
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-800 dark:text-white">{copy('diagnostics', 'Diagnostics', 'ការវិនិច្ឆ័យ')}</span>
          <span className={`h-2 w-2 rounded-full ${syncConnected ? 'bg-green-500' : syncUrl ? 'animate-pulse bg-yellow-400' : 'bg-gray-300'}`} />
          {serverInfo ? <span className="text-xs text-gray-500">{serverInfo.clients} {copy('devices', 'device(s)', 'ឧបករណ៍')} | {Math.round(serverInfo.uptime)}s {copy('uptime', 'uptime', 'ពេលដំណើរការ')}</span> : null}
          {pendingSync.total > 0 ? (
            <span className={`rounded-full px-2 py-0.5 text-xs ${pendingSync.failed > 0 ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
              {pendingSync.pending} pending / {pendingSync.failed} failed
            </span>
          ) : null}
          {writeErrors.length > 0 ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
              {writeErrors.length} write error{writeErrors.length > 1 ? 's' : ''}
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <label htmlFor="server-diagnostics-auto-refresh" className="flex cursor-pointer items-center gap-1 text-xs text-gray-500">
            <input
              id="server-diagnostics-auto-refresh"
              name="server_diagnostics_auto_refresh"
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
              className="h-3 w-3"
            />
            {copy('auto', 'Auto', 'ស្វ័យប្រវត្តិ')}
          </label>
          <button onClick={fetchServerLog} className="text-xs text-blue-600 hover:underline">{copy('refresh', 'Refresh', 'ស្រស់ថ្មី')}</button>
          <button onClick={() => { window.api?.clearCallLog?.(); setClientLog([]) }} className="text-xs text-gray-400 hover:text-red-500">{copy('clear', 'Clear', 'សម្អាត')}</button>
        </div>
      </div>

      {writeErrors.length > 0 ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 dark:bg-red-900/20">
          <p className="mb-1 text-xs font-semibold text-red-700">Write blocked - data was not saved to the server:</p>
          {writeErrors.slice(0, 5).map((entry) => (
            <p key={entry._id} className="truncate text-xs text-red-600">
              [{entry.ts?.slice(11, 19)}] <strong>{entry.channel}</strong>: {entry.error}
            </p>
          ))}
          <button onClick={() => setWriteErrors([])} className="mt-1 text-xs text-red-400 hover:underline">Dismiss</button>
        </div>
      ) : null}

      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {[
          { id: 'client', label: `${copy('client', 'Client', 'ឧបករណ៍')} (${clientLog.length})` },
          { id: 'server', label: `${copy('server', 'Server', 'ម៉ាស៊ីនមេ')} (${serverLog.length})`, disabled: !syncUrl },
          { id: 'queue', label: `${copy('queue', 'Queue', 'ជួរ')} (${pendingSync.total})` },
          { id: 'info', label: copy('info', 'Info', 'ព័ត៌មាន') },
        ].map(({ id, label, disabled }) => (
          <button
            key={id}
            disabled={!!disabled}
            onClick={() => setTab(id)}
            className={`border-b-2 px-4 py-2 text-xs font-medium ${tab === id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'} ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto bg-white dark:bg-gray-900" style={{ maxHeight: 280 }}>
        {tab === 'client' ? (
          <div className="px-3 py-2">
            {clientLog.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-400">No calls yet. Perform any action.</p>
            ) : clientLog.map((entry, index) => (
              <div key={index} className={`flex items-center gap-2 border-b border-gray-50 py-1 font-mono text-xs dark:border-gray-700/30 ${entry.ok === false ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                <span className="w-16 flex-shrink-0 text-gray-400">{entry.ts?.slice(11, 19)}</span>
                <span className={`flex-shrink-0 rounded px-1 text-xs ${badge[entry.source] || badge.local}`}>{entry.source || 'local'}</span>
                <span className={`flex-1 truncate ${entry.ok === false ? 'text-red-600' : 'text-gray-800 dark:text-gray-200'}`}>{entry.channel}</span>
                <span className="flex-shrink-0 text-gray-400">{entry.ms}ms</span>
                <span className={entry.ok === false ? 'text-red-500' : 'text-green-500'}>{entry.ok === false ? 'x' : 'ok'}</span>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'server' ? (
          <div className="px-3 py-2">
            {serverLog.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-400">{syncUrl ? 'No records yet.' : 'No server configured.'}</p>
            ) : serverLog.map((entry, index) => (
              <div key={index} className="flex items-center gap-2 border-b border-gray-50 py-1 font-mono text-xs dark:border-gray-700/30">
                <span className="w-16 text-gray-400">{entry.ts?.slice(11, 19)}</span>
                <span className="flex-1 truncate text-gray-800 dark:text-gray-200">{entry.channel}</span>
                <span className="text-gray-400">{entry.ms}ms</span>
                <span className={entry.ok ? 'text-green-500' : 'text-red-500'}>{entry.ok ? 'ok' : 'x'}</span>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'queue' ? (
          <div className="px-3 py-2">
            <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-800">
              <div className="flex flex-wrap gap-3 text-gray-600 dark:text-gray-300">
                <span><strong>{pendingSync.pending}</strong> pending</span>
                <span><strong>{pendingSync.syncing}</strong> syncing</span>
                <span><strong>{pendingSync.failed}</strong> failed</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={handleRetryQueue}
                  disabled={retryingQueue || pendingSync.total === 0 || !syncConnected}
                  className="text-blue-600 hover:underline disabled:opacity-40"
                >
                  {retryingQueue ? 'Syncing...' : 'Sync now'}
                </button>
                <button
                  onClick={handleDiscardQueue}
                  disabled={retryingQueue || pendingSync.total === 0}
                  className="text-red-500 hover:underline disabled:opacity-40"
                >
                  Clear queue
                </button>
              </div>
            </div>
            {pendingSync.total > 0 ? (
              <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                Offline actions are queued by timestamp and replayed oldest first when the server is reachable. Keep them unless support asks you to clear the queue.
              </p>
            ) : null}
            {pendingSync.total === 0 ? (
              <p className="py-4 text-center text-xs text-gray-400">No pending offline actions.</p>
            ) : pendingSync.items.map((item) => (
              <div key={item._seq} className="flex items-center gap-2 border-b border-gray-50 py-1 text-xs dark:border-gray-700/30">
                <span className="w-16 flex-shrink-0 font-mono text-gray-400">{item.created_at?.slice(11, 19) || '--:--:--'}</span>
                <span className={`flex-shrink-0 rounded px-1 ${item.status === 'failed' ? 'bg-red-100 text-red-700' : item.status === 'syncing' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                  {item.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">
                  {item.channel}
                  {item.entity_name ? ` - ${item.entity_name}` : ''}
                </span>
                {item.updated_at ? <span className="hidden text-gray-400 sm:inline">updated {item.updated_at.slice(11, 19)}</span> : null}
                {item.retry_at ? <span className="hidden text-amber-600 sm:inline">retry {item.retry_at.slice(11, 19)}</span> : null}
                {item.retry_count ? <span className="text-gray-400">retry {item.retry_count}</span> : null}
                {item.error ? <span className="truncate text-red-500">{item.error}</span> : null}
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'info' ? <InfoTab syncUrl={syncUrl} syncConnected={syncConnected} active={active} /> : null}
      </div>
    </div>
  )
}

export default function ServerPage() {
  const { t, notify, syncConnected, syncUrl, updateSyncUrl } = useApp()
  const isActive = useIsPageActive('server')
  const [urlInput, setUrlInput] = useState('')
  const [securityConfig, setSecurityConfig] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [onlineCount, setOnlineCount] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const onlineCheckRequestRef = useRef(0)
  const securityConfigRequestRef = useRef(0)

  const autoDetected = isAutoDetected(syncUrl)
  const hasServer = !!(syncUrl?.trim())

  useEffect(() => {
    setUrlInput(syncUrl || '')
  }, [syncUrl])

  useEffect(() => {
    if (!isActive || !syncUrl) {
      if (!isActive) invalidateTrackedRequest(onlineCheckRequestRef)
      setOnlineCount(null)
      return
    }

    const check = async () => {
      const requestId = beginTrackedRequest(onlineCheckRequestRef)
      try {
        const res = await fetch(`${syncUrl}/health`, {
          signal: AbortSignal.timeout?.(4000),
          headers: { 'bypass-tunnel-reminder': 'true' },
        })
        if (res.ok) {
          const data = await res.json().catch(() => ({}))
          if (!isTrackedRequestCurrent(onlineCheckRequestRef, requestId)) return
          setOnlineCount(data?.clients ?? null)
        }
      } catch (_) {}
    }

    check()
    const timer = setInterval(check, 10000)
    return () => clearInterval(timer)
  }, [isActive, syncUrl, syncConnected])
  useEffect(() => () => invalidateTrackedRequest(onlineCheckRequestRef), [])

  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(securityConfigRequestRef)
      return
    }
    const loadSecurityConfig = async () => {
      const requestId = beginTrackedRequest(securityConfigRequestRef)
      try {
        const config = await withLoaderTimeout(() => window.api.getSystemConfig?.(), 'Sync settings')
        if (!isTrackedRequestCurrent(securityConfigRequestRef, requestId)) return
        if (config) setSecurityConfig(config)
      } catch (_) {}
    }
    loadSecurityConfig()
  }, [isActive, syncUrl, syncConnected])
  useEffect(() => () => invalidateTrackedRequest(securityConfigRequestRef), [])

  async function handleTest() {
    const url = urlInput.trim().replace(/\/$/, '')
    if (!url) {
      setTestResult({ ok: false, message: 'Server URL is required' })
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.api.testSyncServer(url)
      setOnlineCount(result.clients ?? null)
      setTestResult({
        ok: result.ok,
        message: result.ok ? `Connected - ${result.clients ?? 0} device(s) online` : (result.message || 'Connection failed'),
      })
    } catch (error) {
      setTestResult({ ok: false, message: error?.message || 'Connection failed' })
    }
    setTesting(false)
  }

  function handleSave() {
    const url = urlInput.trim().replace(/\/$/, '')
    updateSyncUrl(url || null)
    if (url) notify('Server URL saved - reconnecting...', 'success')
    else notify('Switched to local-only mode', 'success')
  }

  function handleDisconnect() {
    setUrlInput('')
    setTestResult(null)
    setOnlineCount(null)
    updateSyncUrl(null)
    notify('Switched to local-only mode', 'success')
  }

  return (
    <div className="page-scroll p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          icon={Server}
          tone="blue"
          title={t('sync_server_title') || 'Sync Server'}
          subtitle={t('sync_server_desc') || 'One device runs the server. All others open the Cloudflare URL in their browser with no manual config needed.'}
        />

        <div className={`card flex items-center gap-4 p-4 ${
          hasServer && syncConnected ? 'border-green-300 dark:border-green-700' :
          hasServer ? 'border-yellow-300 dark:border-yellow-700' : ''
        }`}>
          <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
            hasServer && syncConnected ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
            hasServer ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
          }`}>
            {hasServer && syncConnected ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              {hasServer && syncConnected ? (t('sync_connected_label') || 'Connected') : hasServer ? (t('sync_connecting_label') || 'Connecting...') : (t('sync_local_label') || 'Local only')}
              {autoDetected ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-normal text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  {t('sync_auto_detected') || 'auto-detected'}
                </span>
              ) : null}
            </div>
            {hasServer ? <div className="mt-0.5 truncate font-mono text-xs text-gray-500 dark:text-gray-400">{syncUrl}</div> : null}
            {onlineCount !== null ? <div className="mt-0.5 text-xs text-blue-600 dark:text-blue-400">{(t('sync_online_devices') || '{n} device(s) currently online').replace('{n}', onlineCount)}</div> : null}
            {!hasServer ? <div className="mt-0.5 text-xs text-gray-400">{t('sync_local_only_desc') || 'Data stored locally on this device only.'}</div> : null}
          </div>
          {hasServer ? <button onClick={handleDisconnect} className="btn-danger flex-shrink-0 px-3 py-1 text-xs">{t('sync_disconnect') || 'Disconnect'}</button> : null}
        </div>

        {autoDetected && syncConnected ? (
          <div className="card border-green-200 bg-green-50 p-5 dark:border-green-800 dark:bg-green-900/20">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-7 w-7 flex-shrink-0 text-green-600 dark:text-green-400" />
              <div>
                <p className="mb-1 font-semibold text-green-800 dark:text-green-200">{t('sync_you_are_set') || 'You are all set!'}</p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  {t('sync_auto_connected_desc') || 'This device auto-connected because you opened the app directly from the server URL.'}
                  {' '}
                  <span className="break-all font-mono font-medium">{syncUrl}</span>
                </p>
                <p className="mt-2 text-xs text-green-600 dark:text-green-400">
                  {t('sync_default_login') || 'Default login:'} <code className="rounded bg-green-100 px-1 dark:bg-green-900/40">admin / admin</code>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="card border-blue-200 bg-blue-50 p-5 dark:border-blue-800 dark:bg-blue-900/20">
            <p className="mb-3 font-semibold text-blue-800 dark:text-blue-300">{t('sync_how_to_connect') || 'How to connect this device'}</p>
            <ol className="space-y-3 text-sm text-blue-700 dark:text-blue-300">
              <li className="flex gap-2">
                <span className="flex-shrink-0 font-bold text-blue-800 dark:text-blue-200">1.</span>
                <div>
                  <p className="font-medium text-blue-800 dark:text-blue-200">{t('sync_step1_title') || 'Run setup on the server PC'}</p>
                  <p className="mt-0.5">{t('sync_step1_desc') || 'Double-click Start Business OS.bat. It starts Docker, workers, and Cloudflare automatically.'}</p>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 font-bold text-blue-800 dark:text-blue-200">2.</span>
                <div>
                  <p className="font-medium text-blue-800 dark:text-blue-200">{t('sync_step2_title') || 'Wait for URL'}</p>
                  <p className="mt-0.5">{t('sync_step2_desc') || 'Wait ~10 seconds. A public Cloudflare URL appears in the terminal.'}</p>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 font-bold text-blue-800 dark:text-blue-200">3.</span>
                <div>
                  <p className="font-medium text-blue-800 dark:text-blue-200">{t('sync_step3_title') || 'Open the app on this device'}</p>
                  <p className="mt-0.5">{t('sync_step3_desc') || 'Copy that URL and paste it below on every device that needs to sync.'}</p>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 font-bold text-blue-800 dark:text-blue-200">4.</span>
                <div>
                  <p className="font-medium text-blue-800 dark:text-blue-200">{t('sync_step4_title') || 'Login with server credentials'}</p>
                  <p className="mt-0.5">{t('sync_step4_desc') || 'Default: admin / admin. Change this password after first login in Users.'}</p>
                </div>
              </li>
            </ol>
          </div>
        )}

        <div>
          <button
            onClick={() => setShowAdvanced((value) => !value)}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <span>{t('sync_advanced_settings') || 'Advanced / manual server settings'} {autoDetected ? `(${t('sync_auto_detected') || 'auto-detected'})` : ''}</span>
          </button>

          {showAdvanced ? (
            <div className="card mt-2 space-y-4 p-5">
              {autoDetected ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  {t('sync_auto_detected_note') || 'Your server was auto-detected from the page URL. Only change these settings if you need to connect to a different server.'}
                </div>
              ) : null}

              <div>
                <label htmlFor="server-manual-url" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sync_manual_url') || 'Server URL'}</label>
                <input
                  id="server-manual-url"
                  name="server_manual_url"
                  type="url"
                  autoComplete="url"
                  value={urlInput}
                  onChange={(event) => { setUrlInput(event.target.value); setTestResult(null) }}
                  placeholder="https://leangcosmetics.dpdns.org"
                  className="input text-sm"
                />
                <p className="mt-1 text-xs text-gray-400">{t('sync_manual_url_hint') || 'No trailing slash.'}</p>
              </div>

              {securityConfig ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
                  <p><strong>Detected mode:</strong> {securityConfig.accessMode || 'local'}</p>
                  <p><strong>Sign-in:</strong> Browser sessions now use your normal Business OS login after the page loads.</p>
                  <p><strong>Trusted path:</strong> {securityConfig.accessMode === 'tailscale-private' ? 'Legacy private tunnel identity' : 'Cloudflare or direct browser access'}</p>
                </div>
              ) : null}

              {testResult ? (
                <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
                  testResult.ok ? 'border-green-200 bg-green-50 text-green-700 dark:bg-green-900/20' : 'border-red-200 bg-red-50 text-red-700 dark:bg-red-900/20'
                }`}>
                  {testResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />}
                  <span>{testResult.message}</span>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-1">
                <button onClick={handleTest} disabled={testing || !urlInput.trim()} className="btn-secondary inline-flex items-center gap-2 disabled:opacity-40">
                  <RefreshCw className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} />
                  {testing ? (t('testing') || 'Testing...') : (t('sync_test') || 'Test Connection')}
                </button>
                <button onClick={handleSave} className="btn-primary">{t('sync_save_connect') || 'Save and Reconnect'}</button>
                {hasServer ? <button onClick={handleDisconnect} className="btn-danger">{t('sync_disconnect') || 'Disconnect'}</button> : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="card bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-800/50 dark:text-gray-400">
          <strong className="text-gray-700 dark:text-gray-300">{t('offline_first') || 'Server-required writes:'} </strong>
          Reads can fall back to local IndexedDB when the server is unreachable, but changes are blocked and treated as invalid until the live server reconnects.
        </div>

        <DiagnosticsPanel syncUrl={syncUrl} syncConnected={syncConnected} active={isActive} />
      </div>
    </div>
  )
}
