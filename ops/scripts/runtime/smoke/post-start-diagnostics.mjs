#!/usr/bin/env node
/* eslint-disable no-console */

import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const options = {
    baseUrl: String(argv[2] || 'http://127.0.0.1:4000').replace(/\/$/, ''),
    publicUrl: '',
    adminUrl: '',
    output: '',
    skipIfUnavailable: false,
  }
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--public-url') {
      options.publicUrl = String(argv[i + 1] || '').replace(/\/$/, '')
      i += 1
    } else if (arg === '--admin-url') {
      options.adminUrl = String(argv[i + 1] || '').replace(/\/$/, '')
      i += 1
    } else if (arg === '--output') {
      options.output = String(argv[i + 1] || '')
      i += 1
    } else if (arg === '--skip-if-unavailable') {
      options.skipIfUnavailable = true
    }
  }
  return options
}

async function readResponse(url, timeoutMs = 10_000) {
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      headers: { 'bypass-tunnel-reminder': 'true' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const contentType = response.headers.get('content-type') || ''
    const text = await response.text().catch(() => '')
    let json = null
    if (/json/i.test(contentType)) {
      try { json = JSON.parse(text) } catch (_) {}
    }
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - startedAt,
      contentType,
      json,
      textSample: json ? '' : text.slice(0, 160),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - startedAt,
      contentType: '',
      json: null,
      error: error?.message || String(error),
    }
  }
}

function hasBuildInfo(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    String(value.hash || '').trim() &&
    String(value.revision || '').trim(),
  )
}

function mkdirForFile(filePath) {
  if (!filePath) return
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true })
}

function writeReport(options, report) {
  if (!options.output) return
  mkdirForFile(options.output)
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`)
}

async function main() {
  const options = parseArgs(process.argv)
  const local = {
    health: await readResponse(`${options.baseUrl}/health`),
  }
  if (options.skipIfUnavailable && local.health.status === 0) {
    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: options.baseUrl,
      publicUrl: options.publicUrl || null,
      adminUrl: options.adminUrl || null,
      status: 'skipped',
      reason: local.health.error || 'local health unavailable',
      failures: [],
      local,
      remote: {},
      checklist: {
        health: false,
        runtimeVersion: false,
        buildManifest: false,
        serviceWorker: false,
        publicHealth: !options.publicUrl,
        adminHealth: !options.adminUrl,
      },
    }
    writeReport(options, report)
    console.warn(`[post-start-diagnostics] skipped: ${options.baseUrl} is unavailable (${report.reason})`)
    return
  }

  local.runtimeVersion = await readResponse(`${options.baseUrl}/api/runtime/version`)
  local.buildManifest = await readResponse(`${options.baseUrl}/business-os-build.json`)
  local.serviceWorker = await readResponse(`${options.baseUrl}/sw.js`)
  const remote = {}
  if (options.publicUrl) remote.publicHealth = await readResponse(`${options.publicUrl}/health`, 15_000)
  if (options.adminUrl) remote.adminHealth = await readResponse(`${options.adminUrl}/health`, 15_000)

  const healthRuntime = local.health.json?.runtime || local.health.json?.data?.runtime || null
  const runtimeData = local.runtimeVersion.json?.data || local.runtimeVersion.json || null
  const buildManifest = local.buildManifest.json || null
  const failures = []

  if (local.health.status !== 200) failures.push(`local health returned ${local.health.status}`)
  if (local.runtimeVersion.status !== 200) failures.push(`runtime version returned ${local.runtimeVersion.status}`)
  if (!hasBuildInfo(runtimeData?.frontend) && !hasBuildInfo(healthRuntime?.frontend)) {
    failures.push('runtime version did not expose served frontend build metadata')
  }
  if (local.buildManifest.status !== 200) failures.push(`build manifest returned ${local.buildManifest.status}`)
  if (!hasBuildInfo(buildManifest)) failures.push('build manifest is missing concrete hash/revision metadata')
  if (local.serviceWorker.status !== 200) failures.push(`service worker returned ${local.serviceWorker.status}`)
  if (!/javascript|text\/plain/i.test(local.serviceWorker.contentType || '')) {
    failures.push(`service worker content type is ${local.serviceWorker.contentType || 'empty'}`)
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    publicUrl: options.publicUrl || null,
    adminUrl: options.adminUrl || null,
    status: failures.length ? 'failed' : 'passed',
    failures,
    local,
    remote,
    checklist: {
      health: local.health.status === 200,
      runtimeVersion: local.runtimeVersion.status === 200,
      buildManifest: local.buildManifest.status === 200 && hasBuildInfo(buildManifest),
      serviceWorker: local.serviceWorker.status === 200,
      publicHealth: !options.publicUrl || remote.publicHealth?.status === 200,
      adminHealth: !options.adminUrl || remote.adminHealth?.status === 200,
    },
  }

  writeReport(options, report)

  console.log(JSON.stringify({
    status: report.status,
    failures,
    output: options.output || null,
    checklist: report.checklist,
  }, null, 2))

  if (failures.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exitCode = 1
})
