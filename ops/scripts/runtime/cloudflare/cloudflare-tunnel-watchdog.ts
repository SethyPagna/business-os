#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

type ProbeResult = {
  ok: boolean
  status: number
  ms: number
  url: string
  error?: string
  textSample?: string
}

type WatchdogOptions = {
  adminUrl: string
  apply: boolean
  baseUrl: string
  container: string
  output: string
  publicUrl: string
  settleMs: number
  timeoutMs: number
  warmStartupAssets: boolean
}

type WatchdogReport = {
  action: 'none' | 'restart-cloudflared' | 'skipped'
  after?: Record<string, ProbeResult>
  before: Record<string, ProbeResult>
  container: string
  generatedAt: string
  localHealthy: boolean
  reason: string
  restart?: {
    attempted: boolean
    code: number | null
    stderr: string
    stdout: string
  }
  startupWarmup?: {
    attempted: boolean
    code: number | null
    stderr: string
    stdout: string
  }
}

const ROOT_DIR = path.resolve(__dirname, '../../../..')
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const DEFAULT_OUTPUT = `ops/runtime/reports/cloudflare-tunnel-watchdog-${TIMESTAMP}.json`
const LATEST_OUTPUT = 'ops/runtime/reports/cloudflare-tunnel-watchdog-latest.json'
const TRANSIENT_TUNNEL_STATUSES = new Set([0, 502, 520, 522, 523, 524, 530])

function normalizeBaseUrl(value: string, fallback: string): string {
  const raw = String(value || fallback || '').trim()
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function assertInsideWorkspace(target: string): string {
  const absolute = path.resolve(ROOT_DIR, target)
  const relative = path.relative(ROOT_DIR, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing output outside workspace: ${target}`)
  }
  return absolute
}

function parseArgs(argv = process.argv.slice(2)): WatchdogOptions {
  const args: WatchdogOptions = {
    adminUrl: normalizeBaseUrl(process.env.BOS_ADMIN_URL || process.env.CLOUDFLARE_ADMIN_URL || '', 'https://admin.leangcosmetics.dpdns.org'),
    apply: false,
    baseUrl: normalizeBaseUrl(process.env.BOS_BASE_URL || '', 'http://127.0.0.1:4000'),
    container: process.env.BOS_CLOUDFLARED_CONTAINER || 'business-os-cloudflared-1',
    output: DEFAULT_OUTPUT,
    publicUrl: normalizeBaseUrl(process.env.BOS_PUBLIC_URL || process.env.CLOUDFLARE_PUBLIC_URL || '', 'https://leangcosmetics.dpdns.org'),
    settleMs: parsePositiveInt(process.env.BOS_TUNNEL_WATCHDOG_SETTLE_MS, 6_000),
    timeoutMs: parsePositiveInt(process.env.BOS_TUNNEL_WATCHDOG_TIMEOUT_MS, 15_000),
    warmStartupAssets: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--apply') args.apply = true
    else if (value === '--admin-url') args.adminUrl = normalizeBaseUrl(argv[++index] || '', args.adminUrl)
    else if (value === '--base-url') args.baseUrl = normalizeBaseUrl(argv[++index] || '', args.baseUrl)
    else if (value === '--container') args.container = argv[++index] || args.container
    else if (value === '--output') args.output = argv[++index] || args.output
    else if (value === '--public-url') args.publicUrl = normalizeBaseUrl(argv[++index] || '', args.publicUrl)
    else if (value === '--settle-ms') args.settleMs = parsePositiveInt(argv[++index], args.settleMs)
    else if (value === '--timeout-ms') args.timeoutMs = parsePositiveInt(argv[++index], args.timeoutMs)
    else if (value === '--warm-startup-assets') args.warmStartupAssets = true
    else if (value === '--dry-run') args.apply = false
    else throw new Error(`Unknown argument: ${value}`)
  }

  args.output = assertInsideWorkspace(args.output)
  return args
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function probe(url: string, timeoutMs: number): Promise<ProbeResult> {
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      headers: {
        accept: '*/*',
        'bypass-tunnel-reminder': 'true',
        'user-agent': 'BusinessOSTunnelWatchdog/1.0',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const contentType = response.headers.get('content-type') || ''
    const text = /json|text|html/i.test(contentType)
      ? await response.text().catch(() => '')
      : ''
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - startedAt,
      url,
      textSample: text.slice(0, 180),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - startedAt,
      url,
      error: error?.message || String(error),
    }
  }
}

async function probeAll(args: WatchdogOptions): Promise<Record<string, ProbeResult>> {
  const entries = await Promise.all([
    probe(`${args.baseUrl}/health`, args.timeoutMs).then((result) => ['localHealth', result] as const),
    probe(`${args.publicUrl}/health`, args.timeoutMs).then((result) => ['publicHealth', result] as const),
    probe(`${args.publicUrl}/public`, args.timeoutMs).then((result) => ['publicPortal', result] as const),
    probe(`${args.adminUrl}/health`, args.timeoutMs).then((result) => ['adminHealth', result] as const),
  ])
  return Object.fromEntries(entries)
}

function needsTunnelRestart(probes: Record<string, ProbeResult>): boolean {
  const remote = [probes.publicHealth, probes.publicPortal, probes.adminHealth].filter(Boolean)
  return remote.some((result) => TRANSIENT_TUNNEL_STATUSES.has(Number(result.status)))
}

function restartContainer(container: string): WatchdogReport['restart'] {
  const result = spawnSync('docker', ['restart', container], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    windowsHide: true,
  })
  return {
    attempted: true,
    code: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  }
}

function runStartupWarmup(): WatchdogReport['startupWarmup'] {
  const result = spawnSync('node', ['ops/scripts/runtime/cloudflare/warm-cloudflare-startup-assets.ts', '--include-api', '--limit', '8', '--timeout-ms', '30000'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    windowsHide: true,
  })
  return {
    attempted: true,
    code: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  }
}

function writeReport(output: string, report: WatchdogReport): void {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(path.resolve(ROOT_DIR, LATEST_OUTPUT), `${JSON.stringify(report, null, 2)}\n`)
}

async function main(): Promise<void> {
  const args = parseArgs()
  const before = await probeAll(args)
  const localHealthy = before.localHealth?.status === 200
  const shouldRestart = localHealthy && needsTunnelRestart(before)
  const report: WatchdogReport = {
    action: shouldRestart ? 'restart-cloudflared' : 'none',
    before,
    container: args.container,
    generatedAt: new Date().toISOString(),
    localHealthy,
    reason: shouldRestart
      ? 'Local app is healthy but one or more remote Cloudflare probes returned a transient tunnel status.'
      : localHealthy
        ? 'Remote Cloudflare probes did not show a transient tunnel failure.'
        : 'Local app health failed; tunnel restart skipped because the app itself is not healthy.',
  }

  if (shouldRestart && args.apply) {
    report.restart = restartContainer(args.container)
    await sleep(args.settleMs)
    report.after = await probeAll(args)
    const recovered = report.after.publicHealth?.status === 200
      && report.after.publicPortal?.status === 200
      && report.after.adminHealth?.status === 200
    if (recovered && args.warmStartupAssets) {
      report.startupWarmup = runStartupWarmup()
    }
  } else if (shouldRestart) {
    report.restart = {
      attempted: false,
      code: null,
      stdout: '',
      stderr: 'Dry run: pass --apply to restart cloudflared.',
    }
  } else if (localHealthy && args.warmStartupAssets) {
    report.startupWarmup = runStartupWarmup()
  }

  writeReport(args.output, report)
  console.log(JSON.stringify({
    action: report.action,
    apply: args.apply,
    localHealthy,
    output: path.relative(ROOT_DIR, args.output),
    latest: LATEST_OUTPUT,
    before: Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value.status])),
    after: report.after ? Object.fromEntries(Object.entries(report.after).map(([key, value]) => [key, value.status])) : undefined,
    restart: report.restart ? { attempted: report.restart.attempted, code: report.restart.code } : undefined,
    startupWarmup: report.startupWarmup ? { attempted: report.startupWarmup.attempted, code: report.startupWarmup.code } : undefined,
  }, null, 2))

  if (report.restart?.attempted && report.restart.code !== 0) process.exitCode = 1
  if (report.startupWarmup?.attempted && report.startupWarmup.code !== 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[cloudflare-tunnel-watchdog] ${error?.message || error}`)
  process.exitCode = 1
})
