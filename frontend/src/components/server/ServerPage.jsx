import { useState, useEffect, useRef, useCallback } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useApp } from '../../AppContext'

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

function InfoTab({ syncUrl, syncConnected }) {
  const { settings, t, formatDateTime, displayTimezone, deviceTimezone } = useApp()
  const [clientTime, setClientTime] = useState(new Date())
  const [serverTime, setServerTime] = useState(null)
  const [serverErr, setServerErr] = useState(null)
  const [drift, setDrift] = useState(null)
  const [fetching, setFetching] = useState(false)
  const [lastFetch, setLastFetch] = useState(null)

  useEffect(() => {
    const timer = setInterval(() => setClientTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const fetchServerTime = useCallback(async () => {
    if (!syncUrl) return
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
        setServerTime(null)
        setServerErr('Server did not return time')
      } else {
        const serverDate = new Date(raw)
        const adjusted = new Date(serverDate.getTime() + rtt / 2)
        setServerTime(adjusted)
        setDrift(Math.round(Date.now() - adjusted.getTime()))
      }
    } catch (error) {
      setServerErr(error?.message || 'Fetch failed')
      setServerTime(null)
    }
    setLastFetch(new Date())
    setFetching(false)
  }, [syncUrl])

  useEffect(() => {
    fetchServerTime()
    const timer = setInterval(fetchServerTime, 15000)
    return () => clearInterval(timer)
  }, [fetchServerTime])

  const fmt = (value) => formatDateTime(value)
  const appliedTimezone = settings?.display_timezone || displayTimezone
  const mode = syncUrl ? (isAutoDetected(syncUrl) ? 'Auto-detected (same origin)' : 'Manual') : 'Local (IndexedDB only)'
  const ws = syncUrl ? (syncConnected ? 'Connected' : 'Reconnecting...') : 'Local only'

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
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">Connection</p>
        <StatusRow label="Mode" value={mode} />
        <StatusRow label="Server URL" value={syncUrl || 'none'} mono />
        <StatusRow label="WebSocket" value={ws} />
      </div>

      <div className="space-y-1 border-t border-gray-100 pt-2 dark:border-gray-700">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">Client (This Device)</p>
        <StatusRow label="Local time" value={fmt(clientTime)} mono />
        <StatusRow label="Display timezone" value={appliedTimezone} mono />
        <StatusRow label="Device timezone" value={deviceTimezone} mono />
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
              {fetching ? 'Fetching...' : 'Refresh'}
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
            <p>Offline activity queues locally and syncs timestamps after reconnect.</p>
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

function DiagnosticsPanel({ syncUrl, syncConnected }) {
  const [clientLog, setClientLog] = useState([])
  const [serverLog, setServerLog] = useState([])
  const [serverInfo, setServerInfo] = useState(null)
  const [writeErrors, setWriteErrors] = useState([])
  const [tab, setTab] = useState('client')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    if (window.api?.getCallLog) setClientLog(window.api.getCallLog())
    const onErr = (event) => {
      if (!mounted.current) return
      setWriteErrors((prev) => [{ ...event.detail, _id: Date.now() }, ...prev].slice(0, 20))
    }
    window.addEventListener('sync:error', onErr)
    return () => {
      mounted.current = false
      window.removeEventListener('sync:error', onErr)
    }
  }, [])

  const fetchServerLog = useCallback(async () => {
    if (!syncUrl) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    try {
      const res = await fetch(`${syncUrl}/api/system/debug/log`, {
        signal: ctrl.signal,
        headers: { 'bypass-tunnel-reminder': 'true' },
      })
      clearTimeout(timer)
      if (!res.ok) return
      const data = await res.json()
      if (mounted.current) {
        setServerLog(data.entries || [])
        setServerInfo({ clients: data.clients, uptime: data.uptime })
      }
    } catch {
      clearTimeout(timer)
    }
  }, [syncUrl])

  useEffect(() => {
    if (!syncUrl || !autoRefresh) return
    fetchServerLog()
    const timer = setInterval(fetchServerLog, 3000)
    return () => clearInterval(timer)
  }, [syncUrl, autoRefresh, fetchServerLog])

  const badge = {
    server: 'bg-blue-100 text-blue-700',
    local: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-800 dark:text-white">Diagnostics</span>
          <span className={`h-2 w-2 rounded-full ${syncConnected ? 'bg-green-500' : syncUrl ? 'animate-pulse bg-yellow-400' : 'bg-gray-300'}`} />
          {serverInfo ? <span className="text-xs text-gray-500">{serverInfo.clients} device(s) | {Math.round(serverInfo.uptime)}s uptime</span> : null}
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
            Auto
          </label>
          <button onClick={fetchServerLog} className="text-xs text-blue-600 hover:underline">Refresh</button>
          <button onClick={() => { window.api?.clearCallLog?.(); setClientLog([]) }} className="text-xs text-gray-400 hover:text-red-500">Clear</button>
        </div>
      </div>

      {writeErrors.length > 0 ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 dark:bg-red-900/20">
          <p className="mb-1 text-xs font-semibold text-red-700">Write failures - data not saved to server:</p>
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
          { id: 'client', label: `Client (${clientLog.length})` },
          { id: 'server', label: `Server (${serverLog.length})`, disabled: !syncUrl },
          { id: 'info', label: 'Info' },
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

        {tab === 'info' ? <InfoTab syncUrl={syncUrl} syncConnected={syncConnected} /> : null}
      </div>
    </div>
  )
}

export default function ServerPage() {
  const { t, notify, syncConnected, syncUrl, updateSyncUrl } = useApp()
  const [urlInput, setUrlInput] = useState('')
  const [securityConfig, setSecurityConfig] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [onlineCount, setOnlineCount] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const autoDetected = isAutoDetected(syncUrl)
  const hasServer = !!(syncUrl?.trim())

  useEffect(() => {
    setUrlInput(syncUrl || '')
  }, [syncUrl])

  useEffect(() => {
    if (!syncUrl) {
      setOnlineCount(null)
      return
    }

    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch(`${syncUrl}/health`, {
          signal: AbortSignal.timeout?.(4000),
          headers: { 'bypass-tunnel-reminder': 'true' },
        })
        if (!cancelled && res.ok) {
          const data = await res.json().catch(() => ({}))
          setOnlineCount(data?.clients ?? null)
        }
      } catch {}
    }

    check()
    const timer = setInterval(check, 10000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [syncUrl, syncConnected])

  useEffect(() => {
    const loadSecurityConfig = async () => {
      try {
        const res = await fetch(`${window.location.origin}/api/system/config`, {
          headers: { 'bypass-tunnel-reminder': 'true' },
        })
        if (!res.ok) return
        const config = await res.json().catch(() => null)
        if (config) setSecurityConfig(config)
      } catch (_) {}
    }
    loadSecurityConfig()
  }, [syncUrl, syncConnected])

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
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('sync_server_title') || 'Sync Server'}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('sync_server_desc') || 'One device runs the server. All others open the Tailscale URL in their browser with no manual config needed.'}
          </p>
        </div>

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
                  <p className="mt-0.5">{t('sync_step1_desc') || 'Double-click setup.bat (Windows) or run ./setup.sh (Mac/Linux). Installs everything and starts the server.'}</p>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 font-bold text-blue-800 dark:text-blue-200">2.</span>
                <div>
                  <p className="font-medium text-blue-800 dark:text-blue-200">{t('sync_step2_title') || 'Enable Tailscale Funnel (one-time on server)'}</p>
                  <p className="mt-0.5">{t('sync_step2_desc') || 'Run: tailscale funnel --bg 4000'}</p>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 font-bold text-blue-800 dark:text-blue-200">3.</span>
                <div>
                  <p className="font-medium text-blue-800 dark:text-blue-200">{t('sync_step3_title') || 'Open the app on this device'}</p>
                  <p className="mt-0.5">{t('sync_step3_desc') || 'Go to https://your-pc.tailnet.ts.net in the browser. The app connects automatically with no token needed.'}</p>
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
                  placeholder="https://your-device-name.ts.net"
                  className="input text-sm"
                />
                <p className="mt-1 text-xs text-gray-400">{t('sync_manual_url_hint') || 'No trailing slash.'}</p>
              </div>

              {securityConfig ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
                  <p><strong>Detected mode:</strong> {securityConfig.accessMode || 'local'}</p>
                  <p><strong>Sign-in:</strong> Browser sessions now use your normal Business OS login after the page loads.</p>
                  <p><strong>Trusted path:</strong> {securityConfig.accessMode === 'tailscale-private' ? 'Private Tailscale identity' : 'Public or direct browser access'}</p>
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
          <strong className="text-gray-700 dark:text-gray-300">{t('offline_first') || 'Offline-first:'} </strong>
          {t('offline_first_desc') || 'Reads fall back to local IndexedDB when the server is unreachable. Offline sales queue and push automatically on reconnect.'}
        </div>

        <DiagnosticsPanel syncUrl={syncUrl} syncConnected={syncConnected} />
      </div>
    </div>
  )
}
