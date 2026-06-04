/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const ROOT_DIR = path.resolve(__dirname, '../../../..')
const DEFAULT_PUBLIC_URL = 'https://leangcosmetics.dpdns.org'
const DEFAULT_ADMIN_URL = 'https://admin.leangcosmetics.dpdns.org'
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_LIMIT = 8
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const DEFAULT_OUTPUT = `ops/runtime/reports/cloudflare-startup-warmup-${TIMESTAMP}.json`
const LATEST_OUTPUT = 'ops/runtime/reports/cloudflare-startup-warmup-latest.json'

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

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    adminUrl: normalizeBaseUrl(process.env.BOS_ADMIN_URL, DEFAULT_ADMIN_URL),
    includeApi: false,
    limit: parsePositiveInt(process.env.BOS_WARMUP_CONCURRENCY, DEFAULT_LIMIT),
    output: DEFAULT_OUTPUT,
    publicUrl: normalizeBaseUrl(process.env.BOS_PUBLIC_URL, DEFAULT_PUBLIC_URL),
    timeoutMs: parsePositiveInt(process.env.BOS_WARMUP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--admin-url') args.adminUrl = normalizeBaseUrl(argv[++index], args.adminUrl)
    else if (value === '--public-url') args.publicUrl = normalizeBaseUrl(argv[++index], args.publicUrl)
    else if (value === '--output') args.output = argv[++index] || args.output
    else if (value === '--timeout-ms') args.timeoutMs = parsePositiveInt(argv[++index], args.timeoutMs)
    else if (value === '--limit') args.limit = parsePositiveInt(argv[++index], args.limit)
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
      contentType,
      bodyText: contentType.includes('text/html') ? body.toString('utf8') : '',
      url: response.url || url,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - startedAt),
      bytes: 0,
      cacheStatus: '',
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

async function warmSurface(name, baseUrl, routePath, args) {
  const documentUrl = asAbsoluteUrl(baseUrl, routePath)
  const documentResult = await fetchWithTimeout(documentUrl, args.timeoutMs)
  const html = documentResult.bodyText || ''
  const assets = documentResult.ok ? extractStartupAssets(baseUrl, html) : []
  const apiUrls = args.includeApi && name === 'public'
    ? [asAbsoluteUrl(baseUrl, '/api/portal/bootstrap')]
    : []
  const targets = [...new Set([...assets, ...apiUrls].filter(Boolean))]
  const assetResults = await runLimited(targets, args.limit, (url) => fetchWithTimeout(url, args.timeoutMs))
  const failed = assetResults.filter((result) => result.status >= 500 || result.status === 0)
  return {
    name,
    baseUrl,
    routePath,
    document: documentResult,
    assetCount: assets.length,
    targetCount: targets.length,
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
    { name: 'admin', baseUrl: args.adminUrl, path: '/' },
  ].filter((surface) => surface.baseUrl)
  const startedAt = performance.now()
  const results = []
  for (const surface of surfaces) {
    results.push(await warmSurface(surface.name, surface.baseUrl, surface.path, args))
  }
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
      limit: args.limit,
      timeoutMs: args.timeoutMs,
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
