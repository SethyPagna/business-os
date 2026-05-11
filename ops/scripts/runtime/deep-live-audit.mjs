/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { ADMIN_ROUTES, PUBLIC_ROUTES, getAuditProfiles } from './audit-manifest.mjs'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from './audit-auth.mjs'
import { writeDeepAuditHtmlReport } from './audit-report-html.mjs'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const REMOTE_PUBLIC_URL = process.env.BOS_REMOTE_PUBLIC_URL || 'https://leangcosmetics.dpdns.org/public'
const REMOTE_ADMIN_URL = process.env.BOS_REMOTE_ADMIN_URL || 'https://admin.leangcosmetics.dpdns.org'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const PROFILE = readArg('--profile') || 'exhaustive'
const REPORT_DIR = process.env.BOS_DEEP_AUDIT_REPORT_DIR
  ? path.resolve(process.env.BOS_DEEP_AUDIT_REPORT_DIR)
  : path.join(ROOT_DIR, 'ops/runtime/reports', `deep-live-audit-${TIMESTAMP}`)
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'screenshots')
const SMOKE_PREFIX = process.env.BOS_AUDIT_PREFIX || `QA Deep Audit ${Date.now()}`

const ROUTE_READY_WARN_MS = 3_000
const ROUTE_READY_FAIL_MS = 8_000
const API_WARN_MS = 2_000
const API_FAIL_MS = 10_000
const LONG_TASK_WARN_MS = 200
const LONG_TASK_FAIL_COUNT = 3
const JS_CHUNK_WARN_BYTES = 150 * 1024
const RAW_JS_TO_GZIP_ESTIMATE_RATIO = 0.35
const BUTTON_RESPONSE_WARN_MS = 300
const BUTTON_RESPONSE_FAIL_MS = 1_500
const LONG_RUNNING_API_RE = /\/api\/(?:backups|system\/drive-sync\/jobs|system\/jobs|import-jobs\/[^/]+\/(?:start|approve|preflight))/i

const PROFILES = getAuditProfiles(PROFILE)

const summary = {
  audit: {
    baseUrl: BASE_URL,
    remotePublicUrl: REMOTE_PUBLIC_URL,
    remoteAdminUrl: REMOTE_ADMIN_URL,
    reportDir: REPORT_DIR,
    smokePrefix: SMOKE_PREFIX,
    profile: PROFILE,
    startedAt: new Date().toISOString(),
  },
  health: {},
  docker: {},
  fullAudit: {},
  browser: {},
  remote: {},
  findings: [],
  artifacts: {},
}
const reportedAssetBudgetKeys = new Set()

const networkReport = []
const performanceReport = []
const consoleReport = []
const artifacts = {
  fullAuditReportDir: '',
  screenshots: [],
  traces: [],
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index >= 0) return process.argv[index + 1] || ''
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return prefixed ? prefixed.slice(name.length + 1) : ''
}

function safeName(value) {
  return String(value || 'artifact').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'artifact'
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function addFinding(priority, area, message, extra = {}) {
  summary.findings.push({
    priority,
    area,
    message,
    ...extra,
  })
}

function assetFileName(url) {
  try {
    return path.basename(new URL(url).pathname)
  } catch {
    return path.basename(String(url || ''))
  }
}

function getScriptBudgetBytes(script) {
  const transferBytes = Number(script.transferSize || 0)
  const encodedBytes = Number(script.encodedBodySize || 0)
  const decodedBytes = Number(script.decodedBodySize || 0)
  const rawBytes = Math.max(encodedBytes, decodedBytes, 0)
  if (transferBytes > 0) {
    return {
      bytes: transferBytes,
      rawBytes,
      source: 'transferSize',
      estimatedGzipEquivalent: false,
    }
  }
  return {
    bytes: Math.round(rawBytes * RAW_JS_TO_GZIP_ESTIMATE_RATIO),
    rawBytes,
    source: rawBytes ? 'estimated-gzip-equivalent' : 'unknown',
    estimatedGzipEquivalent: rawBytes > 0,
  }
}

function isFailingFinding(finding) {
  return Number(finding.priority || 0) <= 1
}

function appOwnedUrl(url) {
  const value = String(url || '')
  return value.startsWith(BASE_URL)
    || value.startsWith('/api/')
    || value.includes('127.0.0.1:4000')
    || value.includes('localhost:4000')
    || value.includes('admin.leangcosmetics.dpdns.org')
    || value.includes('leangcosmetics.dpdns.org')
}

function externalNoise(message) {
  return /chrome-extension:|ab\.chatgpt\.com|Statsig|No Listener: tabs:outgoing|ERR_BLOCKED_BY_CLIENT/i.test(String(message || ''))
}

function isAppConsoleIssue(entry) {
  const message = String(entry.text || entry.message || '')
  if (externalNoise(message)) return false
  if (!['error', 'warning', 'warn'].includes(String(entry.type || entry.level || '').toLowerCase())) return false
  return /PageErrorBoundary|ChunkReloadStall|methods is not defined|ReferenceError|TypeError|Dashboard .*failed|PageLoader|502|524|Bad Gateway|WebSocket connection|incomplete data|failed/i.test(message)
}

function isNavigationAbort(entry) {
  const failure = String(entry.failureText || entry.failure || '')
  if (!/net::ERR_ABORTED/i.test(failure)) return false
  const status = Number(entry.status || 0)
  return status === 0 || status === 200
}

async function writeJson(filename, value) {
  await fs.writeFile(path.join(REPORT_DIR, filename), `${JSON.stringify(value, null, 2)}\n`)
}

async function requestJson(url, options = {}) {
  const started = performance.now()
  const response = await fetch(url, {
    redirect: options.redirect || 'follow',
    signal: AbortSignal.timeout(options.timeoutMs || 30_000),
  })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '')
  return {
    status: response.status,
    ok: response.ok,
    redirected: response.redirected,
    url: response.url,
    ms: Math.round(performance.now() - started),
    headers: Object.fromEntries(response.headers.entries()),
    body,
  }
}

async function runCommand(command, args, options = {}) {
  const started = performance.now()
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      env: { ...process.env, ...(options.env || {}) },
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (options.stream) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (options.stream) process.stderr.write(chunk)
    })
    child.on('error', (error) => {
      resolve({
        code: 127,
        stdout,
        stderr: `${stderr}${error?.message || String(error)}`,
        ms: Math.round(performance.now() - started),
      })
    })
    child.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr,
        ms: Math.round(performance.now() - started),
      })
    })
  })
}

async function captureHealth(phase) {
  const health = await requestJson(`${BASE_URL}/health`, { timeoutMs: 20_000 })
  summary.health[phase] = {
    status: health.body?.status || null,
    frontendHash: health.body?.runtime?.frontend?.hash || null,
    frontendBuiltAt: health.body?.runtime?.frontend?.builtAt || null,
    sourceHash: health.body?.runtime?.sourceHash || null,
    drivers: health.body?.drivers || {},
    ms: health.ms,
  }
  if (!health.ok || health.body?.status !== 'ok') {
    addFinding(0, 'health', `Health check failed during ${phase}`, summary.health[phase])
  }
  return health.body || {}
}

async function runFullApiAudit() {
  const fullAuditDir = path.join(REPORT_DIR, 'api-system')
  artifacts.fullAuditReportDir = fullAuditDir
  await fs.mkdir(fullAuditDir, { recursive: true })
  const result = await runCommand(process.execPath, [path.join(ROOT_DIR, 'ops/scripts/runtime/full-app-audit.mjs')], {
    cwd: path.join(ROOT_DIR, 'backend'),
    env: {
      BOS_BASE_URL: BASE_URL,
      BOS_USERNAME: USERNAME,
      BOS_PASSWORD: PASSWORD,
      BOS_AUDIT_PREFIX: SMOKE_PREFIX,
      BOS_AUDIT_REPORT_DIR: fullAuditDir,
    },
    stream: false,
  })
  summary.fullAudit = {
    command: 'node ../ops/scripts/runtime/full-app-audit.mjs',
    code: result.code,
    ms: result.ms,
    stdoutTail: result.stdout.slice(-4000),
    stderrTail: result.stderr.slice(-4000),
    reportDir: fullAuditDir,
  }
  if (result.code !== 0) {
    addFinding(1, 'full-audit', 'Current full app audit failed; continuing browser performance audit', summary.fullAudit)
  }
  const fullSummaryPath = path.join(fullAuditDir, 'summary.json')
  let fullSummary = {}
  try {
    fullSummary = JSON.parse(await fs.readFile(fullSummaryPath, 'utf8'))
  } catch (error) {
    addFinding(1, 'full-audit', 'Full app audit summary could not be read', {
      reportDir: fullAuditDir,
      error: error?.message || String(error),
    })
  }
  summary.fullAudit.ok = fullSummary?.audit?.ok === true
  summary.fullAudit.findingCount = Array.isArray(fullSummary?.findings) ? fullSummary.findings.length : 0
  const hardFullAuditFindingCount = Array.isArray(fullSummary?.findings)
    ? fullSummary.findings.filter((finding) => Number(finding.priority ?? 1) <= 1).length
    : 0
  summary.fullAudit.hardFindingCount = hardFullAuditFindingCount
  summary.fullAudit.health = fullSummary?.health || {}
  if (Array.isArray(fullSummary?.findings)) {
    for (const finding of fullSummary.findings) {
      addFinding(Number(finding.priority ?? 1), finding.area || 'full-audit', finding.message || 'Full audit finding', {
        ...finding,
        source: 'full-app-audit',
      })
    }
  }
  summary.artifacts = {
    ...summary.artifacts,
    ...(fullSummary?.artifacts || {}),
  }
  if (!summary.fullAudit.ok || hardFullAuditFindingCount) {
    addFinding(1, 'full-audit', 'Full app audit returned findings; browser audit continued', {
      findingCount: summary.fullAudit.findingCount,
      hardFindingCount: hardFullAuditFindingCount,
      reportDir: fullAuditDir,
    })
  }
}

async function loginForAudit(context, page = null) {
  const session = await loginWithFetch({
    baseUrl: BASE_URL,
    username: USERNAME,
    password: PASSWORD,
    timeoutMs: 20_000,
  })
  const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
  if (page) {
    await hydratePlaywrightPage(page, storageState)
  }
  return storageState
}

async function isLoginScreen(page) {
  return page.evaluate(() => {
    return !!document.querySelector('#login-username, #login-password')
  }).catch(() => false)
}

async function ensureAuditLogin(page, authState = null) {
  if (authState?.userJson) {
    await hydratePlaywrightPage(page, { ...authState, baseUrl: BASE_URL })
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  }

  if (!(await isLoginScreen(page))) return

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.fill('#login-username', USERNAME)
    await page.fill('#login-password', PASSWORD)
    await page.selectOption('#session-duration', 'session').catch(() => {})
    const loginResponse = await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/auth/login'), { timeout: 20_000 }).catch(() => null),
      page.click('button[type="submit"]'),
    ]).then(([response]) => response)

    if (loginResponse?.status?.() === 429) {
      await page.waitForTimeout(3_000 * (attempt + 1))
      continue
    }

    try {
      await page.waitForFunction(() => !document.querySelector('#login-username, #login-password'), null, { timeout: 20_000 })
      return
    } catch (_) {
      if (attempt === 2) break
      await page.waitForTimeout(1_500 * (attempt + 1))
    }
  }

  throw new Error('Deep audit browser login did not complete successfully')
}

async function installPerfObservers(page) {
  await page.addInitScript(() => {
    const bosSelectorFor = (element) => {
      if (!element || typeof element !== 'object' || !('nodeType' in element) || element.nodeType !== 1) return ''
      const parts = []
      let current = element
      while (current && current.nodeType === 1 && parts.length < 4) {
        const tag = String(current.tagName || '').toLowerCase()
        if (!tag) break
        const id = current.id ? `#${current.id}` : ''
        const classNames = typeof current.className === 'string'
          ? current.className.trim().split(/\s+/).filter(Boolean).slice(0, 4).map((value) => `.${value}`).join('')
          : ''
        parts.unshift(`${tag}${id}${classNames}`)
        current = current.parentElement
      }
      return parts.join(' > ')
    }
    window.__bosPerf = {
      longTasks: [],
      layoutShift: 0,
      layoutShifts: [],
      lcp: 0,
      lcpEntries: [],
      lcpSelector: '',
      shiftSourceSelector: '',
      inp: 0,
      inpEntries: [],
    }
    window.__bosResetPerf = () => {
      window.__bosPerf.longTasks = []
      window.__bosPerf.layoutShift = 0
      window.__bosPerf.layoutShifts = []
      window.__bosPerf.lcp = 0
      window.__bosPerf.lcpEntries = []
      window.__bosPerf.lcpSelector = ''
      window.__bosPerf.shiftSourceSelector = ''
      window.__bosPerf.inp = 0
      window.__bosPerf.inpEntries = []
      try { performance.clearResourceTimings() } catch (_) {}
      try { performance.clearMarks() } catch (_) {}
      try { performance.clearMeasures() } catch (_) {}
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__bosPerf.longTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          })
        }
      }).observe({ type: 'longtask', buffered: true })
    } catch (_) {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue
          window.__bosPerf.layoutShift += entry.value || 0
          window.__bosPerf.layoutShifts.push({
            value: entry.value || 0,
            startTime: entry.startTime,
          })
          const sourceNode = Array.isArray(entry.sources)
            ? entry.sources.find((source) => source?.node instanceof Element)?.node
            : null
          if (sourceNode) {
            window.__bosPerf.shiftSourceSelector = bosSelectorFor(sourceNode)
          }
        }
      }).observe({ type: 'layout-shift', buffered: true })
    } catch (_) {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__bosPerf.lcp = entry.startTime || 0
          window.__bosPerf.lcpEntries.push({
            startTime: entry.startTime || 0,
            size: entry.size || 0,
            url: entry.url || '',
          })
          window.__bosPerf.lcpSelector = bosSelectorFor(entry.element)
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch (_) {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = Number(entry.duration || entry.processingEnd || 0)
          if (duration <= 0) continue
          if (duration >= window.__bosPerf.inp) {
            window.__bosPerf.inp = duration
          }
          window.__bosPerf.inpEntries.push({
            name: entry.name || '',
            startTime: entry.startTime || 0,
            duration,
          })
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 })
    } catch (_) {}
  })
}

async function createBrowserHarness(profile) {
  const browser = await chromium.launch({
    headless: process.env.BOS_DEEP_AUDIT_HEADED === '1' ? false : true,
  })
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.isMobile,
    deviceScaleFactor: profile.isMobile ? 2 : 1,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  })
  return { browser, context }
}

async function attachCollectors(page) {
  const consoleEntries = []
  const failedRequests = []
  const cdpEntries = new Map()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Performance.enable').catch(() => {})
  cdp.on('Network.requestWillBeSent', (event) => {
    cdpEntries.set(event.requestId, {
      requestId: event.requestId,
      url: event.request?.url || '',
      method: event.request?.method || '',
      type: event.type || '',
      startTimestamp: event.timestamp || 0,
      status: null,
      mimeType: '',
      fromDiskCache: false,
      fromServiceWorker: false,
      encodedDataLength: 0,
      failed: false,
      failureText: '',
      durationMs: 0,
    })
  })
  cdp.on('Network.responseReceived', (event) => {
    const entry = cdpEntries.get(event.requestId)
    if (!entry) return
    entry.status = event.response?.status || 0
    entry.mimeType = event.response?.mimeType || ''
    entry.fromDiskCache = !!event.response?.fromDiskCache
    entry.fromServiceWorker = !!event.response?.fromServiceWorker
    entry.responseTimestamp = event.timestamp || 0
  })
  cdp.on('Network.loadingFinished', (event) => {
    const entry = cdpEntries.get(event.requestId)
    if (!entry) return
    entry.encodedDataLength = Number(event.encodedDataLength || 0)
    entry.durationMs = entry.startTimestamp
      ? Math.round(((event.timestamp || entry.responseTimestamp || entry.startTimestamp) - entry.startTimestamp) * 1000)
      : 0
  })
  cdp.on('Network.loadingFailed', (event) => {
    const entry = cdpEntries.get(event.requestId)
    if (!entry) return
    entry.failed = true
    entry.failureText = event.errorText || ''
    entry.durationMs = entry.startTimestamp
      ? Math.round(((event.timestamp || entry.startTimestamp) - entry.startTimestamp) * 1000)
      : 0
  })
  page.on('console', (msg) => {
    consoleEntries.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
      ts: new Date().toISOString(),
    })
  })
  page.on('pageerror', (error) => {
    consoleEntries.push({
      type: 'error',
      text: error?.message || String(error),
      location: {},
      ts: new Date().toISOString(),
    })
  })
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || '',
      resourceType: request.resourceType(),
      ts: new Date().toISOString(),
    })
  })
  return {
    consoleEntries,
    failedRequests,
    cdpEntries,
    cdp,
    reset() {
      consoleEntries.length = 0
      failedRequests.length = 0
      cdpEntries.clear()
    },
  }
}

async function resetBrowserState(page) {
  await page.goto(`${BASE_URL}/?__bos_deep_reset=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.evaluate(() => {
    const stalePrefixes = [
      'business_os_page_loader_retry:',
      'bos-lazy-reload:',
      'business-os:public-dom-recovery-at',
    ]
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (const key of Object.keys(storage)) {
        if (stalePrefixes.some((prefix) => key.startsWith(prefix))) storage.removeItem(key)
      }
    }
  })
}

async function waitForRouteReady(page, route) {
  const started = performance.now()
  try {
    await page.waitForFunction(({ readyTexts, routeName }) => {
      const text = document.body?.innerText || ''
      const hasRoot = !!document.querySelector('#app-root, #root')
      const activeSlot = document.querySelector('[data-bos-active-page="true"]')
      const activePage = activeSlot?.getAttribute('data-bos-page-slot') || ''
      const activeText = activeSlot?.innerText || ''
      const expectedPage = routeName === 'public_catalog' ? '' : routeName
      const hasExpectedSlot = expectedPage && activePage === expectedPage
      const scanText = expectedPage ? activeText : text
      const hasReadyText = readyTexts.some((value) => scanText.includes(value))
      const isLoginScreen = !!document.querySelector('#login-username, #login-password')
      const hasErrorBoundary = /Page .* crashed|PageErrorBoundary|Loading chunk recovery reload did not complete/i.test(text)
      const hasPageLoaderStall = /Page bundle is still loading/i.test(text)
      const hasOnlyLoadingShell = expectedPage && /\bLoading\.\.\.|Page bundle is still loading/i.test(activeText)
      return hasRoot && !isLoginScreen && !hasErrorBoundary && !hasPageLoaderStall && (
        expectedPage ? (hasExpectedSlot && hasReadyText && !hasOnlyLoadingShell) : hasReadyText
      )
    }, { readyTexts: route.ready, routeName: route.name }, { timeout: ROUTE_READY_FAIL_MS })
  } catch (error) {
    await page.waitForSelector('#app-root, #root', { timeout: 2_000 }).catch(() => {})
  }
  return Math.round(performance.now() - started)
}

async function collectPerfSnapshot(page) {
  return await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      startTime: Math.round(entry.startTime),
      duration: Math.round(entry.duration),
      transferSize: Number(entry.transferSize || 0),
      encodedBodySize: Number(entry.encodedBodySize || 0),
      decodedBodySize: Number(entry.decodedBodySize || 0),
      responseEnd: Math.round(entry.responseEnd || 0),
    }))
    const scripts = resources.filter((entry) => /\.js(?:\?|$)/i.test(entry.name))
    const styles = resources.filter((entry) => /\.css(?:\?|$)/i.test(entry.name))
    const images = resources.filter((entry) => /image|\.png|\.jpe?g|\.webp|\.gif|\.svg/i.test(`${entry.initiatorType} ${entry.name}`))
    const api = resources.filter((entry) => /\/api\//i.test(entry.name))
    return {
      url: window.location.href,
      title: document.title,
      navigation: nav ? {
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadMs: Math.round(nav.loadEventEnd),
        responseEndMs: Math.round(nav.responseEnd),
        transferSize: Number(nav.transferSize || 0),
        encodedBodySize: Number(nav.encodedBodySize || 0),
      } : null,
      resourceCounts: {
        total: resources.length,
        scripts: scripts.length,
        styles: styles.length,
        images: images.length,
        api: api.length,
      },
      resourceBytes: {
        scripts: scripts.reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0), 0),
        styles: styles.reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0), 0),
        images: images.reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0), 0),
        api: api.reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0), 0),
        total: resources.reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0), 0),
      },
      mainScripts: scripts
        .filter((entry) => /\/assets\/(?:index|Products|Inventory|POS|Backup|catalog|app-shared|app-api|vendor)/i.test(entry.name))
        .map((entry) => ({
          name: entry.name,
          duration: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
        })),
      metrics: window.__bosPerf || {},
      memory: performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      } : null,
    }
  })
}

async function saveScreenshot(page, name) {
  const file = path.join(SCREENSHOT_DIR, `${safeName(name)}.png`)
  await page.screenshot({ path: file, fullPage: false })
  artifacts.screenshots.push(file)
  return file
}

async function performSearchInteraction(page, routeName) {
  const started = performance.now()
  const candidates = [
    'input[type="search"]',
    'input[placeholder*="Search" i]',
    'input[aria-label*="Search" i]',
  ]
  for (const selector of candidates) {
    const input = page.locator(selector).first()
    if (await input.count().catch(() => 0)) {
      if (!(await input.isVisible().catch(() => false))) continue
      const fillStarted = performance.now()
      await input.fill('QA')
      const responseMs = Math.round(performance.now() - fillStarted)
      await page.waitForTimeout(250)
      const settleMs = Math.round(performance.now() - fillStarted)
      await input.fill('')
      return {
        name: `${routeName}:search`,
        ok: true,
        ms: responseMs,
        settleMs,
        setupMs: Math.round(fillStarted - started),
      }
    }
  }
  return {
    name: `${routeName}:search`,
    ok: false,
    skipped: true,
    ms: Math.round(performance.now() - started),
    reason: 'No visible search input found',
  }
}

async function dismissTransientUi(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(120)
  const closeButtons = [
    page.locator('button[aria-label*="Close" i]').first(),
    page.getByRole('button', { name: /^Close$/i }).first(),
    page.getByRole('button', { name: /^Cancel$/i }).first(),
    page.getByRole('button', { name: /^Back$/i }).first(),
  ]
  for (const button of closeButtons) {
    if (!(await button.count().catch(() => 0))) continue
    if (!(await button.isVisible().catch(() => false))) continue
    await button.click({ timeout: 1_500 }).catch(() => {})
    await page.waitForTimeout(120)
    break
  }
}

async function clickNamedButton(page, label, routeName) {
  await dismissTransientUi(page)
  const button = page.getByRole('button', { name: label }).first()
  if (!(await button.count().catch(() => 0))) {
    return { name: `${routeName}:button:${label}`, ok: false, skipped: true, ms: 0, reason: 'Button not found' }
  }
  if (!(await button.isVisible().catch(() => false)) || !(await button.isEnabled().catch(() => false))) {
    return { name: `${routeName}:button:${label}`, ok: false, skipped: true, ms: 0, reason: 'Button not visible/enabled' }
  }
  const started = performance.now()
  try {
    await button.click({ timeout: BUTTON_RESPONSE_FAIL_MS })
    const responseMs = Math.round(performance.now() - started)
    await page.waitForTimeout(75)
    const settleMs = Math.round(performance.now() - started)
    const cleanupStarted = performance.now()
    await dismissTransientUi(page)
    return {
      name: `${routeName}:button:${label}`,
      ok: true,
      ms: responseMs,
      settleMs,
      cleanupMs: Math.round(performance.now() - cleanupStarted),
    }
  } catch (error) {
    await dismissTransientUi(page)
    return {
      name: `${routeName}:button:${label}`,
      ok: false,
      ms: Math.round(performance.now() - started),
      error: error?.message || String(error),
    }
  }
}

async function clickTestIdButton(page, testId, routeName, { waitForProgress = false } = {}) {
  await dismissTransientUi(page)
  const button = page.locator(`[data-testid="${testId}"]`).first()
  if (!(await button.count().catch(() => 0))) {
    return { name: `${routeName}:testid:${testId}`, ok: false, skipped: true, ms: 0, reason: 'Button not found' }
  }
  if (!(await button.isVisible().catch(() => false)) || !(await button.isEnabled().catch(() => false))) {
    return { name: `${routeName}:testid:${testId}`, ok: false, skipped: true, ms: 0, reason: 'Button not visible/enabled' }
  }
  const started = performance.now()
  let responseMs = 0
  try {
    await button.click({ timeout: BUTTON_RESPONSE_FAIL_MS })
    responseMs = Math.round(performance.now() - started)
  } catch (error) {
    return {
      name: `${routeName}:testid:${testId}`,
      ok: false,
      ms: Math.round(performance.now() - started),
      error: error?.message || String(error),
    }
  }
  let progressMs = null
  if (waitForProgress) {
    const progressStarted = performance.now()
    const progress = page.locator('[data-testid="backup-job-progress"]').first()
    await progress.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => {})
    progressMs = Math.round(performance.now() - progressStarted)
  }
  await page.waitForTimeout(75)
  const settleMs = Math.round(performance.now() - started)
  return {
    name: `${routeName}:testid:${testId}`,
    ok: true,
    ms: responseMs,
    settleMs,
    progressMs,
  }
}

async function runRouteInteractions(page, route) {
  const interactions = []
  if (route?.interactions?.search) {
    interactions.push(await performSearchInteraction(page, route.name))
  }
  for (const label of route?.interactions?.primaryButtons || []) {
    interactions.push(await clickNamedButton(page, label, route.name))
  }
  for (const action of route?.interactions?.testIdButtons || []) {
    interactions.push(await clickTestIdButton(page, action.testId, route.name, { waitForProgress: !!action.waitForProgress }))
  }
  return interactions
}

function analyzeRoute(profileName, route, routeResult, networkEntries, perf, consoleEntries, failedRequests, interactions) {
  if (routeResult.readyMs > ROUTE_READY_FAIL_MS) {
    addFinding(0, 'browser-ready', `${profileName}/${route.name} exceeded route ready fail budget`, routeResult)
  } else if (routeResult.readyMs > ROUTE_READY_WARN_MS) {
    addFinding(2, 'browser-ready', `${profileName}/${route.name} exceeded route ready warning budget`, routeResult)
  }

  for (const entry of networkEntries) {
    if (!appOwnedUrl(entry.url)) continue
    if (entry.failed && !isNavigationAbort(entry)) {
      addFinding(0, 'network', `${profileName}/${route.name} app-owned request failed`, entry)
    }
    if (Number(entry.status || 0) >= 500) {
      addFinding(0, 'network', `${profileName}/${route.name} app-owned request returned ${entry.status}`, entry)
    }
    if (/\/api\//i.test(entry.url) && !LONG_RUNNING_API_RE.test(entry.url)) {
      if (entry.durationMs > API_FAIL_MS) {
        addFinding(0, 'api-performance', `${profileName}/${route.name} API exceeded fail budget`, entry)
      } else if (entry.durationMs > API_WARN_MS) {
        addFinding(2, 'api-performance', `${profileName}/${route.name} API exceeded warning budget`, entry)
      }
    }
  }

  for (const script of perf.mainScripts || []) {
    const budget = getScriptBudgetBytes(script)
    const assetKey = `${profileName}:${assetFileName(script.name)}`
    if (budget.bytes > JS_CHUNK_WARN_BYTES && !reportedAssetBudgetKeys.has(assetKey)) {
      reportedAssetBudgetKeys.add(assetKey)
      addFinding(2, 'asset-weight', `${profileName} large route script`, {
        route: route.name,
        profile: profileName,
        url: script.name,
        bytes: budget.bytes,
        rawBytes: budget.rawBytes,
        budgetSource: budget.source,
        estimatedGzipEquivalent: budget.estimatedGzipEquivalent,
      })
    }
  }

  const longTasks = (perf.metrics?.longTasks || []).filter((task) => Number(task.duration || 0) > LONG_TASK_WARN_MS)
  if (longTasks.length >= LONG_TASK_FAIL_COUNT) {
    addFinding(1, 'rendering', `${profileName}/${route.name} has repeated long tasks`, {
      route: route.name,
      profile: profileName,
      count: longTasks.length,
      longestMs: Math.round(Math.max(...longTasks.map((task) => Number(task.duration || 0)))),
    })
  } else if (longTasks.length) {
    addFinding(2, 'rendering', `${profileName}/${route.name} has long tasks`, {
      route: route.name,
      profile: profileName,
      count: longTasks.length,
      longestMs: Math.round(Math.max(...longTasks.map((task) => Number(task.duration || 0)))),
    })
  }

  const appConsoleIssues = consoleEntries.filter(isAppConsoleIssue)
  for (const issue of appConsoleIssues) {
    addFinding(0, 'console', `${profileName}/${route.name} app-owned console issue`, issue)
  }

  for (const request of failedRequests) {
    if (appOwnedUrl(request.url) && !isNavigationAbort(request)) {
      addFinding(0, 'network', `${profileName}/${route.name} app-owned browser requestfailed`, request)
    }
  }

  for (const interaction of interactions) {
    if (interaction.skipped) continue
    if (interaction.ok === false) {
      addFinding(1, 'interaction', `${profileName}/${interaction.name} did not respond cleanly`, interaction)
      continue
    }
    if (interaction.ms > BUTTON_RESPONSE_FAIL_MS) {
      addFinding(1, 'interaction', `${profileName}/${interaction.name} exceeded fail budget`, interaction)
    } else if (interaction.ms > BUTTON_RESPONSE_WARN_MS) {
      addFinding(2, 'interaction', `${profileName}/${interaction.name} exceeded warning budget`, interaction)
    }
    if (interaction.progressMs != null && interaction.progressMs > 1_000) {
      addFinding(1, 'interaction', `${profileName}/${interaction.name} did not show job progress within 1s`, interaction)
    }
  }
}

async function auditRoute(page, collectors, profileName, route, authenticated = true, authState = null) {
  collectors.reset()
  await page.evaluate(() => {
    window.__bosResetPerf?.()
  }).catch(() => {})

  const tracePath = path.join(REPORT_DIR, `${safeName(`${profileName}-${route.name}`)}-trace.zip`)
  await page.context().tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false,
  })

  const started = performance.now()
  const url = `${BASE_URL}${route.path === '/' ? '/' : route.path}?__bos_deep=${Date.now()}&profile=${encodeURIComponent(profileName)}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  if (authenticated && await isLoginScreen(page)) {
    await ensureAuditLogin(page, authState)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  }
  const domContentLoadedMs = Math.round(performance.now() - started)
  await page.waitForLoadState('load', { timeout: 45_000 }).catch(() => {})
  const readyMs = await waitForRouteReady(page, route)
  await page.waitForTimeout(500)
  const screenshot = await saveScreenshot(page, `${profileName}-${route.name}-ready`)
  const loadPerf = await collectPerfSnapshot(page)
  const interactions = authenticated ? await runRouteInteractions(page, route) : []

  if (route.name === 'public_catalog') {
    await page.mouse.wheel(0, 1200)
    const visibilityStarted = performance.now()
    await page.waitForTimeout(600)
    const pinnedNavLabels = route?.interactions?.pinnedNavLabels || ['About', 'Products', 'Membership', 'FAQ', 'Beauty Assistant']
    const navVisibility = await page.evaluate((labels) => {
      return labels.map((label) => {
        const elements = Array.from(document.querySelectorAll('a,button,[role="tab"],[role="link"],nav *'))
        const match = elements.find((element) => (element.textContent || '').trim().includes(label))
        if (!match) return { label, found: false, visibleNearTop: false }
        const rect = match.getBoundingClientRect()
        const style = window.getComputedStyle(match)
        return {
          label,
          found: true,
          visibleNearTop: rect.width > 0
            && rect.height > 0
            && rect.bottom > 0
            && rect.top < Math.min(180, window.innerHeight * 0.35)
            && style.visibility !== 'hidden'
            && style.display !== 'none',
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
        }
      })
    }, pinnedNavLabels).catch(() => {
      return []
    })
    const visibleCount = navVisibility.filter((entry) => entry.visibleNearTop).length
    const navStillVisible = visibleCount >= 3
    interactions.push({
      name: `${route.name}:pinned-nav-scroll`,
      ok: navStillVisible,
      ms: Math.round(performance.now() - visibilityStarted - 600),
      settleMs: 600,
      visibleCount,
      navVisibility,
    })
    await saveScreenshot(page, `${profileName}-${route.name}-after-scroll`)
    if (!navStillVisible) {
      addFinding(0, 'public-nav', `${profileName}/public navigation not visible after scroll`, {
        navVisibility,
      })
    }
    const tabChecks = []
    for (const label of route?.interactions?.tabs || ['About', 'Products', 'Membership', 'FAQ']) {
      const tab = page.getByRole('button', { name: new RegExp(escapeRegExp(label), 'i') }).first()
      const startedClick = performance.now()
      await tab.click({ timeout: BUTTON_RESPONSE_FAIL_MS }).catch((error) => {
        tabChecks.push({ label, ok: false, error: error?.message || String(error) })
      })
      if (tabChecks.some((entry) => entry.label === label && entry.ok === false)) continue
      await page.waitForTimeout(120)
      const check = await tab.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        const root = document.documentElement
        return {
          ok: rect.width > 0
            && rect.height > 0
            && rect.left >= -1
            && rect.right <= window.innerWidth + 1
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && style.color !== style.backgroundColor
            && root.scrollWidth <= window.innerWidth + 2,
          color: style.color,
          backgroundColor: style.backgroundColor,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          viewportWidth: window.innerWidth,
          documentWidth: root.scrollWidth,
        }
      }).catch((error) => ({ ok: false, error: error?.message || String(error) }))
      tabChecks.push({
        label,
        ...check,
        ms: Math.round(performance.now() - startedClick),
      })
    }
    const tabsOk = tabChecks.every((entry) => entry.ok)
    interactions.push({
      name: `${route.name}:section-tabs`,
      ok: tabsOk,
      ms: tabChecks.reduce((max, entry) => Math.max(max, Number(entry.ms || 0)), 0),
      tabChecks,
    })
    await saveScreenshot(page, `${profileName}-${route.name}-after-tab-clicks`)
    if (!tabsOk) {
      addFinding(0, 'public-nav', `${profileName}/public section tabs failed click/contrast/bounds checks`, { tabChecks })
    }
  }

  const postInteractionPerf = await collectPerfSnapshot(page)
  await page.context().tracing.stop({ path: tracePath }).catch(() => {})
  artifacts.traces.push(tracePath)

  const networkEntries = Array.from(collectors.cdpEntries.values())
    .filter((entry) => entry.url && !entry.url.startsWith('data:'))
    .map((entry) => ({
      ...entry,
      profile: profileName,
      route: route.name,
      cacheStatus: entry.fromServiceWorker ? 'service-worker' : (entry.fromDiskCache ? 'disk-cache' : 'network'),
    }))
  const consoleEntries = collectors.consoleEntries.map((entry) => ({
    ...entry,
    profile: profileName,
    route: route.name,
    appOwned: isAppConsoleIssue(entry),
    externalNoise: externalNoise(entry.text),
  }))
  const failedRequests = collectors.failedRequests.map((entry) => ({
    ...entry,
    profile: profileName,
    route: route.name,
  }))

  networkReport.push(...networkEntries)
  consoleReport.push(...consoleEntries)
  performanceReport.push({
    profile: profileName,
    route: route.name,
    path: route.path,
    url: await page.url(),
    domContentLoadedMs,
    readyMs,
    screenshot,
    interactions,
    performance: loadPerf,
    postInteractionPerformance: postInteractionPerf,
    failedRequests,
  })

  const routeResult = {
    profile: profileName,
    route: route.name,
    path: route.path,
    domContentLoadedMs,
    readyMs,
    screenshot,
  }
  analyzeRoute(profileName, route, routeResult, networkEntries, loadPerf, consoleEntries, failedRequests, interactions)
  return routeResult
}

async function auditBrowserProfile(profile) {
  const { browser, context } = await createBrowserHarness(profile)
  let collectors = null
  const profileResult = {
    routes: [],
    profile: profile.name,
    viewport: profile.viewport,
  }
  try {
    const page = await context.newPage()
    const authState = await loginForAudit(context, page)
    await installPerfObservers(page)
    collectors = await attachCollectors(page)
    await page.goto(`${BASE_URL}/?__bos_deep_login=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await ensureAuditLogin(page, authState)
    await waitForRouteReady(page, ADMIN_ROUTES[0])
    await saveScreenshot(page, `${profile.name}-login-complete`)

    for (const route of ADMIN_ROUTES) {
      profileResult.routes.push(await auditRoute(page, collectors, profile.name, route, true, authState))
    }
    for (const route of PUBLIC_ROUTES) {
      profileResult.routes.push(await auditRoute(page, collectors, profile.name, route, false))
    }
  } finally {
    await collectors?.cdp?.detach().catch(() => {})
    await browser.close().catch(() => {})
  }
  summary.browser[profile.name] = profileResult
}

async function auditRemoteReadOnly() {
  let publicResult = null
  try {
    publicResult = await requestJson(REMOTE_PUBLIC_URL, { timeoutMs: 30_000 })
  } catch (error) {
    publicResult = { ok: false, status: 0, ms: 0, error: error?.message || String(error), headers: {} }
  }
  let adminResult = null
  try {
    adminResult = await requestJson(REMOTE_ADMIN_URL, { timeoutMs: 30_000, redirect: 'manual' })
  } catch (error) {
    adminResult = { ok: false, status: 0, ms: 0, error: error?.message || String(error), headers: {} }
  }
  summary.remote = {
    public: {
      url: REMOTE_PUBLIC_URL,
      status: publicResult.status,
      ok: publicResult.status === 200,
      ms: publicResult.ms,
    },
    admin: {
      url: REMOTE_ADMIN_URL,
      status: adminResult.status,
      ok: [200, 302, 401, 403].includes(Number(adminResult.status || 0)),
      ms: adminResult.ms,
      location: adminResult.headers?.location || '',
      authenticate: adminResult.headers?.['www-authenticate'] || '',
      error: adminResult.error || '',
    },
  }
  if (!summary.remote.public.ok) {
    addFinding(0, 'remote', 'Remote public site did not return 200', summary.remote.public)
  }
  if (!summary.remote.admin.ok) {
    addFinding(1, 'remote', 'Remote admin did not return expected Cloudflare Access/auth response', summary.remote.admin)
  }
}

async function captureDockerStateAndLogs() {
  const ps = await runCommand('docker', [
    'compose',
    '--env-file',
    path.join(ROOT_DIR, 'ops/runtime/docker-release/docker-release.env'),
    '-f',
    path.join(ROOT_DIR, 'ops/docker/compose.release.yml'),
    'ps',
    '--format',
    'json',
  ])
  summary.docker.ps = ps.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) } catch { return { raw: line } }
    })

  const logs = await runCommand('docker', [
    'compose',
    '--env-file',
    path.join(ROOT_DIR, 'ops/runtime/docker-release/docker-release.env'),
    '-f',
    path.join(ROOT_DIR, 'ops/docker/compose.release.yml'),
    'logs',
    '--since',
    '30m',
    'app',
    'import-worker',
    'media-worker',
  ])
  await fs.writeFile(path.join(REPORT_DIR, 'docker-log-scan.txt'), logs.stdout + logs.stderr)
  const badLines = `${logs.stdout}\n${logs.stderr}`
    .split(/\r?\n/)
    .filter((line) => !/NOTICE:.*last_error.*already exists/i.test(line))
    .filter((line) => /MaxListenersExceededWarning|non-retryable streaming|PageErrorBoundary|ChunkReloadStall|ReferenceError|methods is not defined|Unhandled|uncaught|\bERROR\b|Bad Gateway|502|524/i.test(line))
  summary.docker.logScan = {
    scannedSince: '30m',
    issueCount: badLines.length,
    issues: badLines.slice(0, 50),
  }
  if (badLines.length) {
    addFinding(1, 'docker-logs', 'Fresh runtime log warnings/errors matched failure patterns', summary.docker.logScan)
  }
}

async function compareWithPreviousBaseline() {
  const reportsDir = path.join(ROOT_DIR, 'ops/runtime/reports')
  let previous = []
  try {
    previous = (await fs.readdir(reportsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^deep-live-audit-/.test(entry.name) && entry.name !== path.basename(REPORT_DIR))
      .map((entry) => path.join(reportsDir, entry.name))
  } catch {
    return
  }
  const candidates = []
  for (const dir of previous) {
    try {
      const stat = await fs.stat(dir)
      const summaryPath = path.join(dir, 'summary.json')
      const parsedSummary = JSON.parse(await fs.readFile(summaryPath, 'utf8'))
      const auditOk = parsedSummary?.audit?.ok === true
      const profile = String(parsedSummary?.audit?.profile || '').trim().toLowerCase()
      candidates.push({ dir, mtimeMs: stat.mtimeMs, auditOk, profile })
    } catch (_) {}
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const latest = candidates.find((candidate) => candidate.auditOk && (!PROFILE || candidate.profile === PROFILE))?.dir
    || candidates.find((candidate) => candidate.auditOk)?.dir
  if (!latest) return
  const previousPerfPath = path.join(latest, 'performance.json')
  let previousPerf = []
  try {
    previousPerf = JSON.parse(await fs.readFile(previousPerfPath, 'utf8'))
  } catch {
    return
  }
  summary.audit.baselineReportDir = latest
  for (const current of performanceReport) {
    const before = previousPerf.find((entry) => entry.profile === current.profile && entry.route === current.route)
    if (!before) continue
    const previousBytes = Number(before.performance?.resourceBytes?.scripts || 0)
    const currentBytes = Number(current.performance?.resourceBytes?.scripts || 0)
    if (previousBytes > 0 && currentBytes > previousBytes * 1.25) {
      addFinding(1, 'asset-regression', `${current.profile}/${current.route} script weight regressed by >25%`, {
        previousBytes,
        currentBytes,
        previousReport: latest,
      })
    }
  }
}

async function main() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true })
  await captureHealth('before')
  await runFullApiAudit()
  for (const profile of PROFILES) {
    await auditBrowserProfile(profile)
  }
  await auditRemoteReadOnly()
  await captureDockerStateAndLogs()
  await captureHealth('after')
  await compareWithPreviousBaseline()

  summary.audit.finishedAt = new Date().toISOString()
  summary.audit.durationMs = Math.round(new Date(summary.audit.finishedAt).getTime() - new Date(summary.audit.startedAt).getTime())
  summary.artifacts = { ...summary.artifacts, ...artifacts }
  summary.artifacts.htmlReport = path.join(REPORT_DIR, 'summary.html')
  summary.audit.ok = !summary.findings.some(isFailingFinding)

  await writeJson('summary.json', summary)
  await writeJson('network.json', networkReport)
  await writeJson('performance.json', performanceReport)
  await writeJson('console.json', consoleReport)
  await writeJson('artifacts.json', artifacts)
  await writeDeepAuditHtmlReport({
    reportDir: REPORT_DIR,
    summary,
    performanceReport,
    networkReport,
    consoleReport,
  })

  console.log(JSON.stringify({
    ok: summary.audit.ok,
    reportDir: REPORT_DIR,
    frontendHash: summary.health.after?.frontendHash || summary.health.before?.frontendHash || null,
    findings: summary.findings,
  }, null, 2))

  if (!summary.audit.ok) process.exitCode = 1
}

main().catch(async (error) => {
  addFinding(0, 'deep-audit', error?.message || String(error), {
    stack: error?.stack || '',
  })
  summary.audit.finishedAt = new Date().toISOString()
  summary.audit.ok = false
  summary.artifacts = { ...summary.artifacts, ...artifacts }
  await fs.mkdir(REPORT_DIR, { recursive: true }).catch(() => {})
  await writeJson('summary.json', summary).catch(() => {})
  await writeJson('network.json', networkReport).catch(() => {})
  await writeJson('performance.json', performanceReport).catch(() => {})
  await writeJson('console.json', consoleReport).catch(() => {})
  await writeJson('artifacts.json', artifacts).catch(() => {})
  console.error(error)
  process.exitCode = 1
})
