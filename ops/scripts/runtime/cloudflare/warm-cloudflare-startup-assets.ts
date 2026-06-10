/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const ROOT_DIR = path.resolve(__dirname, '../../../..')
const DEFAULT_PUBLIC_URL = 'https://leangcosmetics.dpdns.org'
const DEFAULT_ADMIN_URL = 'https://admin.leangcosmetics.dpdns.org'
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_LIMIT = 8
const DEFAULT_DOCUMENT_ATTEMPTS = 5
const DEFAULT_DOCUMENT_RETRY_DELAY_MS = 2_000
const DEFAULT_ASSET_ATTEMPTS = 3
const DEFAULT_ASSET_RETRY_DELAY_MS = 750
const DEFAULT_ADMIN_ROUTE_PATHS = ['/', '/products', '/inventory', '/pos', '/branches', '/files', '/users', '/audit-log']
const DEFAULT_ASSET_GRAPH_DEPTH = 1
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const DEFAULT_OUTPUT = `ops/runtime/reports/cloudflare-startup-warmup-${TIMESTAMP}.json`
const LATEST_OUTPUT = 'ops/runtime/reports/cloudflare-startup-warmup-latest.json'
const ADMIN_FIRST_WINDOW_DEPENDENCY_RE = /\/assets\/(?:AdminRoot|Sidebar|app-(?:api|auth|bootstrap|local-db|routing|shared|shell)|api-http-(?:core|state)|catalog-(?:icons|public|public-core)|dashboard-(?:api|charts)|product-(?:read-api|shared)|productDisplayHelpers|inventory-api|branch-api|audit-log-api|file-api|ai-api|multipart-headers-api|user-(?:admin-api|read-api|permission-definitions)|refresh-cw|monitor-smartphone|vendor-dexie|csv-utils|route-sync-utils|settings-refresh|shared-(?:action-history|formatters|lazy-portal-menu|modal|page-header|portal-menu|ui)|lang-en)-/i

function assertInsideWorkspace(target) {
  const relative = path.relative(ROOT_DIR, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Refusing output outside workspace: ${target}`)
  return target
}

function normalizeBaseUrl(value, fallback) {
  const raw = String(value || fallback || '').trim()
  if (!raw) return ''
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function normalizeRoutePath(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw, 'https://business-os.local')
    return parsed.pathname.startsWith('/') ? parsed.pathname : `/${parsed.pathname}`
  } catch (_) {
    const withoutQuery = raw.split('?')[0].split('#')[0].trim()
    if (!withoutQuery) return ''
    return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`
  }
}

function parseRouteList(value, fallback) {
  const routes = String(value || '')
    .split(',')
    .map(normalizeRoutePath)
    .filter(Boolean)
  return routes.length ? [...new Set(routes)] : [...fallback]
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetryDocumentFetch(result) {
  return result.status === 0 || result.status === 429 || result.status >= 500
}

function shouldRetryAssetFetch(result) {
  return result.status === 0 || result.status === 429 || result.status >= 500
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    adminUrl: normalizeBaseUrl(process.env.BOS_ADMIN_URL, DEFAULT_ADMIN_URL),
    adminRoutes: parseRouteList(process.env.BOS_WARMUP_ADMIN_ROUTES, DEFAULT_ADMIN_ROUTE_PATHS),
    assetAttempts: parsePositiveInt(process.env.BOS_WARMUP_ASSET_ATTEMPTS, DEFAULT_ASSET_ATTEMPTS),
    assetGraphDepth: parsePositiveInt(process.env.BOS_WARMUP_ASSET_GRAPH_DEPTH, DEFAULT_ASSET_GRAPH_DEPTH),
    assetRetryDelayMs: parsePositiveInt(process.env.BOS_WARMUP_ASSET_RETRY_DELAY_MS, DEFAULT_ASSET_RETRY_DELAY_MS),
    includeApi: false,
    documentAttempts: parsePositiveInt(process.env.BOS_WARMUP_DOCUMENT_ATTEMPTS, DEFAULT_DOCUMENT_ATTEMPTS),
    documentRetryDelayMs: parsePositiveInt(process.env.BOS_WARMUP_DOCUMENT_RETRY_DELAY_MS, DEFAULT_DOCUMENT_RETRY_DELAY_MS),
    limit: parsePositiveInt(process.env.BOS_WARMUP_CONCURRENCY, DEFAULT_LIMIT),
    output: DEFAULT_OUTPUT,
    publicUrl: normalizeBaseUrl(process.env.BOS_PUBLIC_URL, DEFAULT_PUBLIC_URL),
    timeoutMs: parsePositiveInt(process.env.BOS_WARMUP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--admin-url') args.adminUrl = normalizeBaseUrl(argv[++index], args.adminUrl)
    else if (value === '--admin-route') {
      const routePath = normalizeRoutePath(argv[++index])
      if (routePath) args.adminRoutes = [...new Set([...args.adminRoutes, routePath])]
    }
    else if (value === '--admin-routes') args.adminRoutes = parseRouteList(argv[++index], args.adminRoutes)
    else if (value === '--asset-attempts') args.assetAttempts = parsePositiveInt(argv[++index], args.assetAttempts)
    else if (value === '--asset-graph-depth') args.assetGraphDepth = parsePositiveInt(argv[++index], args.assetGraphDepth)
    else if (value === '--asset-retry-delay-ms') args.assetRetryDelayMs = parsePositiveInt(argv[++index], args.assetRetryDelayMs)
    else if (value === '--public-url') args.publicUrl = normalizeBaseUrl(argv[++index], args.publicUrl)
    else if (value === '--output') args.output = argv[++index] || args.output
    else if (value === '--timeout-ms') args.timeoutMs = parsePositiveInt(argv[++index], args.timeoutMs)
    else if (value === '--limit') args.limit = parsePositiveInt(argv[++index], args.limit)
    else if (value === '--document-attempts') args.documentAttempts = parsePositiveInt(argv[++index], args.documentAttempts)
    else if (value === '--document-retry-delay-ms') args.documentRetryDelayMs = parsePositiveInt(argv[++index], args.documentRetryDelayMs)
    else if (value === '--include-api') args.includeApi = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  args.output = assertInsideWorkspace(path.resolve(ROOT_DIR, args.output))
  return args
}

function asAbsoluteUrl(baseUrl, rawUrl) {
  try {
    return new URL(rawUrl, baseUrl).toString()
  } catch (_) {
    return ''
  }
}

function isWarmableAsset(baseUrl, rawUrl) {
  const absoluteUrl = asAbsoluteUrl(baseUrl, rawUrl)
  if (!absoluteUrl) return ''
  const parsedBase = new URL(baseUrl)
  const parsedAsset = new URL(absoluteUrl)
  if (parsedBase.origin !== parsedAsset.origin) return ''
  if (parsedAsset.pathname.startsWith('/assets/')) return absoluteUrl
  if (parsedAsset.pathname === '/theme-bootstrap.js') return absoluteUrl
  if (parsedAsset.pathname === '/runtime-noise-guard.js') return absoluteUrl
  return ''
}

function extractStartupAssets(baseUrl, html) {
  const assets = new Set()
  const scriptRe = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
  const linkRe = /<link\b([^>]+)>/gi
  for (const match of html.matchAll(scriptRe)) {
    const asset = isWarmableAsset(baseUrl, match[1])
    if (asset) assets.add(asset)
  }
  for (const match of html.matchAll(linkRe)) {
    const tag = match[1] || ''
    const relMatch = tag.match(/\brel=["']([^"']+)["']/i)
    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i)
    const rel = String(relMatch?.[1] || '').toLowerCase()
    if (!hrefMatch || !/(stylesheet|modulepreload|preload|prefetch)/.test(rel)) continue
    const asset = isWarmableAsset(baseUrl, hrefMatch[1])
    if (asset) assets.add(asset)
  }
  return [...assets]
}

function extractLinkHeaderAssets(baseUrl, linkHeader) {
  const assets = new Set()
  const raw = String(linkHeader || '')
  const linkRe = /<([^>]+)>\s*;\s*([^,]+)/gi
  for (const match of raw.matchAll(linkRe)) {
    const params = String(match[2] || '').toLowerCase()
    if (!/\brel=["']?(modulepreload|preload|stylesheet|prefetch)["']?/.test(params)) continue
    const asset = isWarmableAsset(baseUrl, match[1])
    if (asset) assets.add(asset)
  }
  return [...assets]
}

function routePreloadKey(routePath) {
  const normalized = normalizeRoutePath(routePath)
  const segment = normalized.split('/').filter(Boolean)[0] || ''
  if (segment === 'product') return 'products'
  if (segment === 'point-of-sale') return 'pos'
  if (segment === 'branch') return 'branches'
  return segment || 'admin'
}

function parseInlineRoutePreloadMap(html) {
  const match = String(html || '').match(/<script\b[^>]*data-business-os-route-preloads[^>]*>([\s\S]*?)<\/script>/i)
  const source = match?.[1] || ''
  const preloadsMatch = source.match(/var\s+preloads\s*=\s*(\{[\s\S]*?\});/)
  if (!preloadsMatch) return {}
  try {
    const parsed = JSON.parse(preloadsMatch[1])
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function extractInlineRoutePreloadAssets(baseUrl, html, routePath) {
  const preloadMap = parseInlineRoutePreloadMap(html)
  const routeKey = routePreloadKey(routePath)
  const fileNames = [
    ...(Array.isArray(preloadMap.admin) ? preloadMap.admin : []),
    ...(Array.isArray(preloadMap[routeKey]) ? preloadMap[routeKey] : []),
  ]
  const assets = new Set()
  for (const fileName of fileNames) {
    const asset = isWarmableAsset(baseUrl, `/${String(fileName || '').replace(/^\/+/, '')}`)
    if (asset) assets.add(asset)
  }
  return [...assets]
}

function extractFetchedChunkDependencies(baseUrl, assetUrl, source) {
  const assets = new Set()
  const dependencyRe = /["']\.\/([^"']+\.(?:js|css))["']/g
  for (const match of String(source || '').matchAll(dependencyRe)) {
    let absoluteDependency = ''
    try {
      absoluteDependency = new URL(match[1], assetUrl).toString()
    } catch (_) {}
    const asset = isWarmableAsset(baseUrl, absoluteDependency)
    if (asset && ADMIN_FIRST_WINDOW_DEPENDENCY_RE.test(asset)) assets.add(asset)
  }
  return [...assets]
}

async function warmAssetsWithGraph(baseUrl, assets, args, expandGraph) {
  const depth = Math.max(0, Number(args.assetGraphDepth) || 0)
  const discovered = new Set(assets)
  const fetched = new Set()
  const results = []
  let frontier = [...assets]
  for (let level = 0; frontier.length; level += 1) {
    const toFetch = frontier.filter((assetUrl) => !fetched.has(assetUrl))
    if (!toFetch.length) break
    const fetchedResults = await runLimited(toFetch, args.limit, (url) => fetchAssetWithRetry(url, args))
    for (const result of fetchedResults) fetched.add(result.url)
    results.push(...fetchedResults)
    if (!expandGraph || level >= depth) break
    const next = []
    for (const result of fetchedResults) {
      if (!/javascript/i.test(result.contentType || '') || !result.bodyText) continue
      for (const dependencyUrl of extractFetchedChunkDependencies(baseUrl, result.url, result.bodyText)) {
        if (discovered.has(dependencyUrl)) continue
        discovered.add(dependencyUrl)
        next.push(dependencyUrl)
      }
    }
    frontier = next
  }
  return {
    assets: [...discovered],
    results,
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = performance.now()
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: '*/*',
        'bypass-tunnel-reminder': 'true',
        'user-agent': 'BusinessOSStartupWarmup/1.0',
      },
      signal: controller.signal,
    })
    const body = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') || ''
    return {
      ok: response.ok,
      status: response.status,
      ms: Math.round(performance.now() - startedAt),
      bytes: body.byteLength,
      cacheStatus: response.headers.get('cf-cache-status') || '',
      linkHeader: response.headers.get('link') || '',
      contentType,
      bodyText: /text\/html|javascript|text\/css/i.test(contentType) ? body.toString('utf8') : '',
      url: response.url || url,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - startedAt),
      bytes: 0,
      cacheStatus: '',
      linkHeader: '',
      contentType: '',
      error: error?.message || String(error),
      url,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function runLimited(items, limit, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

async function fetchDocumentWithRetry(url, args) {
  const attempts = []
  const maxAttempts = Math.max(1, args.documentAttempts)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await fetchWithTimeout(url, args.timeoutMs)
    attempts.push(result)
    if (!shouldRetryDocumentFetch(result) || attempt === maxAttempts) {
      return {
        ...result,
        attempts,
        attemptCount: attempts.length,
      }
    }
    await sleep(args.documentRetryDelayMs)
  }
  return {
    ok: false,
    status: 0,
    ms: 0,
    bytes: 0,
    cacheStatus: '',
    linkHeader: '',
    contentType: '',
    error: 'Document fetch retry loop did not run',
    url,
    attempts,
    attemptCount: attempts.length,
  }
}

async function fetchAssetWithRetry(url, args) {
  const attempts = []
  const maxAttempts = Math.max(1, args.assetAttempts)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await fetchWithTimeout(url, args.timeoutMs)
    attempts.push(result)
    if (!shouldRetryAssetFetch(result) || attempt === maxAttempts) {
      return {
        ...result,
        attempts,
        attemptCount: attempts.length,
      }
    }
    await sleep(args.assetRetryDelayMs)
  }
  return {
    ok: false,
    status: 0,
    ms: 0,
    bytes: 0,
    cacheStatus: '',
    linkHeader: '',
    contentType: '',
    error: 'Asset fetch retry loop did not run',
    url,
    attempts,
    attemptCount: attempts.length,
  }
}

async function warmSurface(name, baseUrl, routePath, args) {
  const documentUrl = asAbsoluteUrl(baseUrl, routePath)
  const documentResult = await fetchDocumentWithRetry(documentUrl, args)
  const html = documentResult.bodyText || ''
  const documentAssets = documentResult.ok
    ? [...new Set([
      ...extractStartupAssets(baseUrl, html),
      ...extractLinkHeaderAssets(baseUrl, documentResult.linkHeader),
      ...extractInlineRoutePreloadAssets(baseUrl, html, routePath),
    ])]
    : []
  const apiUrls = args.includeApi && name === 'public'
    ? [asAbsoluteUrl(baseUrl, '/api/portal/bootstrap')]
    : []
  const warmup = await warmAssetsWithGraph(baseUrl, documentAssets, args, name !== 'public')
  const assets = warmup.assets
  const apiResults = await runLimited(apiUrls.filter(Boolean), args.limit, (url) => fetchWithTimeout(url, args.timeoutMs))
  const assetResults = [...warmup.results, ...apiResults]
  const failed = assetResults.filter((result) => result.status >= 500 || result.status === 0)
  return {
    name,
    baseUrl,
    routePath,
    document: documentResult,
    assetCount: assets.length,
    documentAssetCount: documentAssets.length,
    dependencyAssetCount: Math.max(0, assets.length - documentAssets.length),
    targetCount: assets.length + apiUrls.filter(Boolean).length,
    failedCount: failed.length,
    targets: assetResults,
  }
}

function summarizeCache(results) {
  const summary = {}
  for (const result of results) {
    const key = result.cacheStatus || 'none'
    summary[key] = (summary[key] || 0) + 1
  }
  return summary
}

async function main() {
  const args = parseArgs()
  const surfaces = [
    { name: 'public', baseUrl: args.publicUrl, path: '/public' },
    ...args.adminRoutes.map((routePath) => ({
      name: routePath === '/' ? 'admin' : `admin:${routePath}`,
      baseUrl: args.adminUrl,
      path: routePath,
    })),
  ].filter((surface) => surface.baseUrl)
  const startedAt = performance.now()
  const results = await runLimited(
    surfaces,
    Math.min(args.limit, surfaces.length),
    (surface) => warmSurface(surface.name, surface.baseUrl, surface.path, args),
  )
  const allTargets = results.flatMap((result) => result.targets)
  const failed = results.flatMap((result) => [
    ...(result.document.status >= 500 || result.document.status === 0 ? [result.document] : []),
    ...result.targets.filter((target) => target.status >= 500 || target.status === 0),
  ])
  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    ok: failed.length === 0,
    options: {
      includeApi: args.includeApi,
      documentAttempts: args.documentAttempts,
      documentRetryDelayMs: args.documentRetryDelayMs,
      assetAttempts: args.assetAttempts,
      assetRetryDelayMs: args.assetRetryDelayMs,
      assetGraphDepth: args.assetGraphDepth,
      limit: args.limit,
      timeoutMs: args.timeoutMs,
      adminRoutes: args.adminRoutes,
    },
    cacheStatus: summarizeCache(allTargets),
    failedCount: failed.length,
    results,
  }
  fs.mkdirSync(path.dirname(args.output), { recursive: true })
  fs.writeFileSync(args.output, JSON.stringify(report, null, 2))
  fs.writeFileSync(assertInsideWorkspace(path.resolve(ROOT_DIR, LATEST_OUTPUT)), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    ok: report.ok,
    report: path.relative(ROOT_DIR, args.output),
    latest: LATEST_OUTPUT,
    surfaces: results.length,
    targets: allTargets.length,
    cacheStatus: report.cacheStatus,
    failedCount: failed.length,
  }, null, 2))
  if (!report.ok) process.exit(1)
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
})
