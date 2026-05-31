/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Response } from 'playwright'
import { ADMIN_ROUTES, PUBLIC_ROUTES, getAuditProfiles, resolveAuditRoutes, type AuditProfile, type AuditRoute } from '../audits/audit-manifest.ts'
import { applySessionToPlaywrightContext, hydratePlaywrightPage, loginWithFetch, type BrowserStorageState, type LoginSession } from '../audits/audit-auth.ts'

type ConsoleEntry = {
  type: string
  text: string
  location: unknown
  ts: string
}

type NetworkEntry = {
  method: string
  status: number
  url: string
  route: string
  profile: string
}

type ControlResult = {
  kind: string
  label: string
  ok: boolean
  ms: number
  proof?: string
  skipped?: boolean
  reason?: string
  error?: string
}

type ControlRecord = ControlResult & { profile: string; route: string }

type SeededRollbackCandidate = {
  profile: string
  route: string
  kind: string
  label: string
  reason: string
  category: string
  suggestedHarness: string
}

type ControlCoverage = {
  total: number
  tested: number
  passed: number
  failed: number
  skipped: number
  byKind: Record<string, number>
  skippedByReason: Record<string, number>
  byRoute: Record<string, {
    total: number
    tested: number
    failed: number
    skipped: number
  }>
}

type ButtonCandidate = {
  index: number
  label: string
  skipped: boolean
  reason?: string
}

type LayoutIssue = {
  type: string
  message: string
  selector?: string
  text?: string
  left?: number
  right?: number
  top?: number
  bottom?: number
}

type RouteResult = {
  profile: string
  route: string
  path: string
  navMs: number
  readyMs: number
  screenshot: string
  controls: {
    visibleButtons: number
    visibleInputs: number
    visibleSelects: number
    tested: number
    passed: number
    skipped: number
  }
  layoutIssues: LayoutIssue[]
  consoleIssues: ConsoleEntry[]
  networkIssues: NetworkEntry[]
}

type Finding = {
  priority: number
  area: string
  message: string
  [key: string]: unknown
}

type AuditSummary = {
  audit: {
    baseUrl: string
    reportDir: string
    profile: string
    startedAt: string
    finishedAt?: string
    ok?: boolean
  }
  routes: RouteResult[]
  controls: ControlRecord[]
  coverage: ControlCoverage
  findings: Finding[]
  artifacts: {
    screenshots: string[]
    coverageReports: string[]
    seededRollbackBacklog: string[]
  }
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const PROFILE = readArg('--profile') || 'exhaustive'
const REPORT_DIR = process.env.BOS_ALL_PAGES_AUDIT_REPORT_DIR
  ? path.resolve(process.env.BOS_ALL_PAGES_AUDIT_REPORT_DIR)
  : path.join(ROOT_DIR, 'ops/runtime/reports', `all-pages-control-audit-${TIMESTAMP}`)
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'screenshots')
const REPORT_PATH = path.join(REPORT_DIR, 'summary.json')
const COVERAGE_REPORT_PATH = path.join(REPORT_DIR, 'coverage.md')
const SEEDED_ROLLBACK_BACKLOG_PATH = path.join(REPORT_DIR, 'seeded-rollback-backlog.json')
const SEEDED_ROLLBACK_BACKLOG_MARKDOWN_PATH = path.join(REPORT_DIR, 'seeded-rollback-backlog.md')
const LATEST_REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/all-pages-control-audit-latest.json')
const LATEST_COVERAGE_REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/all-pages-control-audit-latest.md')
const LATEST_SEEDED_ROLLBACK_BACKLOG_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/all-pages-control-audit-seeded-rollback-latest.json')
const LATEST_SEEDED_ROLLBACK_BACKLOG_MARKDOWN_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/all-pages-control-audit-seeded-rollback-latest.md')
const ROUTE_READY_TIMEOUT_MS = Number(process.env.BOS_ALL_PAGES_READY_TIMEOUT_MS || 18_000)
const CONTROL_TIMEOUT_MS = Number(process.env.BOS_ALL_PAGES_CONTROL_TIMEOUT_MS || 2_500)
const MAX_BUTTON_CLICKS_PER_ROUTE = Number(process.env.BOS_ALL_PAGES_MAX_BUTTONS || 18)
const MAX_SELECT_CHANGES_PER_ROUTE = Number(process.env.BOS_ALL_PAGES_MAX_SELECTS || 6)
const MIN_TESTED_CONTROLS_PER_ROUTE = Number(process.env.BOS_ALL_PAGES_MIN_TESTED_PER_ROUTE || 3)
const MIN_TESTED_CONTROLS = Number(process.env.BOS_ALL_PAGES_MIN_TESTED_CONTROLS || 0)
const MAX_SKIPPED_CONTROL_RATIO = Number(process.env.BOS_ALL_PAGES_MAX_SKIPPED_RATIO || 0.75)
const MAX_ROUTE_SKIPPED_CONTROL_RATIO = Number(process.env.BOS_ALL_PAGES_MAX_ROUTE_SKIPPED_RATIO || 0.8)

const MUTATING_OR_NOISY_BUTTON_RE = /\b(delete|remove|restore|reset|save|submit|confirm|done|pay|checkout|void|logout|log out|upload file|upload|camera|scan|print|download|open files|sync now|create backup|start backup|run backup|apply|approve|reject|send|email|whatsapp)\b/i
const SETTINGS_LANGUAGE_BUTTON_RE = /^(en|kh|both)$/i
const LOW_VALUE_BUTTON_RE = /^\s*(\+|-|×|x|\.{1,3}|…|←|→|↑|↓|<|>|\/|a|b|c|d|e|f|g|h|i|j|k|[0-9]+)\s*$/i
const EXTERNAL_NOISE_RE = /chrome-extension:|No Listener: tabs:outgoing|Grammarly|Statsig|ab\.chatgpt\.com|ERR_BLOCKED_BY_CLIENT|webextension\.js|CoupertUIFont|unsafe-eval.*content\.js/i
const NON_BLOCKING_APP_DIAGNOSTIC_RE = /^\[PageLoader\] Page bundle is still loading\. The app shell is waiting instead of forcing a reload\.$/
const APP_API_RE = /\/api\/|\/health|\/business-os-build\.json|\/uploads\//i
const LAYOUT_SELECTOR = 'button, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], th, td, .card, .btn, .control, .table-row'
const INTENTIONAL_ROUTE_BUTTONS: Record<string, Array<{ label: RegExp; page: string; path: string }>> = {
  dashboard: [
    { label: /^Review in inventory$/i, page: 'inventory', path: '/inventory' },
    { label: /^Open inventory$/i, page: 'inventory', path: '/inventory' },
  ],
}

const summary: AuditSummary = {
  audit: {
    baseUrl: BASE_URL,
    reportDir: REPORT_DIR,
    profile: PROFILE,
    startedAt: new Date().toISOString(),
  },
  routes: [],
  controls: [],
  coverage: {
    total: 0,
    tested: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    byKind: {},
    skippedByReason: {},
    byRoute: {},
  },
  findings: [],
  artifacts: {
    screenshots: [],
    coverageReports: [],
    seededRollbackBacklog: [],
  },
}

function readArg(name: string): string {
  const index = process.argv.indexOf(name)
  if (index >= 0) return process.argv[index + 1] || ''
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return prefixed ? prefixed.slice(name.length + 1) : ''
}

function readArgs(name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index]
    if (arg === name) {
      values.push(process.argv[index + 1] || '')
      index += 1
      continue
    }
    if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1))
    }
  }
  return values
}

function safeName(value: unknown): string {
  return String(value || 'artifact')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'artifact'
}

function addFinding(priority: number, area: string, message: string, extra: Record<string, unknown> = {}): void {
  summary.findings.push({ priority, area, message, ...extra })
}

function isExternalNoise(message: unknown): boolean {
  return EXTERNAL_NOISE_RE.test(String(message || ''))
}

function isAppConsoleIssue(entry: ConsoleEntry): boolean {
  const type = String(entry.type || '').toLowerCase()
  if (!['error', 'warning', 'warn', 'pageerror'].includes(type)) return false
  if (NON_BLOCKING_APP_DIAGNOSTIC_RE.test(String(entry.text || ''))) return false
  return !isExternalNoise(entry.text)
}

function isAppNetworkIssue(entry: NetworkEntry): boolean {
  if (!APP_API_RE.test(entry.url)) return false
  if (entry.status === 0) return false
  return entry.status >= 400
}

function routeRoot(page: Page, route: AuditRoute): Locator {
  if (route.scope === 'public') return page.locator('body')
  return page.locator(`[data-bos-active-page="true"][data-bos-page-slot="${route.name}"]`).first()
}

function textForLabel(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function buttonSkipReason(label: string): string {
  const value = textForLabel(label)
  if (!value) return 'empty accessible label'
  if (value.length > 60) return 'label too long for stable broad audit'
  if (MUTATING_OR_NOISY_BUTTON_RE.test(value)) return 'mutating, noisy, file, print, or external action'
  if (SETTINGS_LANGUAGE_BUTTON_RE.test(value)) return 'settings language toggle requires rollback harness'
  if (LOW_VALUE_BUTTON_RE.test(value)) return 'low-value pagination, alphabet, icon-only, or numeric control'
  return ''
}

function expectedButtonNavigation(route: AuditRoute, label: string): { page: string; path: string } | null {
  const candidates = INTENTIONAL_ROUTE_BUTTONS[route.name] || []
  return candidates.find((candidate) => candidate.label.test(label)) || null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function attachCollectors(page: Page, profile: string, route: string): Promise<{
  consoleEntries: ConsoleEntry[]
  networkEntries: NetworkEntry[]
}> {
  const consoleEntries: ConsoleEntry[] = []
  const networkEntries: NetworkEntry[] = []
  page.on('console', (message) => {
    consoleEntries.push({
      type: message.type(),
      text: message.text(),
      location: message.location(),
      ts: new Date().toISOString(),
    })
  })
  page.on('pageerror', (error) => {
    consoleEntries.push({
      type: 'pageerror',
      text: error?.message || String(error),
      location: {},
      ts: new Date().toISOString(),
    })
  })
  page.on('response', (response: Response) => {
    const request = response.request()
    networkEntries.push({
      method: request.method(),
      status: response.status(),
      url: response.url(),
      profile,
      route,
    })
  })
  return { consoleEntries, networkEntries }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function writeText(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, 'utf8')
}

function incrementCount(target: Record<string, number>, key: string): void {
  target[key] = (target[key] || 0) + 1
}

function markdownCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
}

function markdownTable(headers: string[], rows: unknown[][]): string {
  const headerRow = `| ${headers.map(markdownCell).join(' | ')} |`
  const divider = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`)
  return [headerRow, divider, ...body].join('\n')
}

function percentage(numerator: number, denominator: number): string {
  if (!denominator) return 'n/a'
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

function computeControlCoverage(controls: ControlRecord[]): ControlCoverage {
  const coverage: ControlCoverage = {
    total: controls.length,
    tested: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    byKind: {},
    skippedByReason: {},
    byRoute: {},
  }
  for (const control of controls) {
    const routeKey = `${control.profile}/${control.route}`
    if (!coverage.byRoute[routeKey]) {
      coverage.byRoute[routeKey] = {
        total: 0,
        tested: 0,
        failed: 0,
        skipped: 0,
      }
    }
    const routeCoverage = coverage.byRoute[routeKey]
    routeCoverage.total += 1
    incrementCount(coverage.byKind, control.kind || 'unknown')
    if (control.skipped) {
      coverage.skipped += 1
      routeCoverage.skipped += 1
      incrementCount(coverage.skippedByReason, control.reason || 'unspecified')
      continue
    }
    coverage.tested += 1
    routeCoverage.tested += 1
    if (control.ok) {
      coverage.passed += 1
    } else {
      coverage.failed += 1
      routeCoverage.failed += 1
    }
  }
  return coverage
}

function routeCoverageRows(): Array<{ route: string; total: number; tested: number; failed: number; skipped: number; skippedRatio: number }> {
  return Object.entries(summary.coverage.byRoute)
    .map(([route, coverage]) => ({
      route,
      total: coverage.total,
      tested: coverage.tested,
      failed: coverage.failed,
      skipped: coverage.skipped,
      skippedRatio: coverage.total > 0 ? Number((coverage.skipped / coverage.total).toFixed(3)) : 1,
    }))
}

function seededRollbackCategory(control: ControlRecord): string {
  const label = control.label.toLowerCase()
  const reason = String(control.reason || '').toLowerCase()
  if (reason.includes('file chooser') || /\b(upload|file|camera|scan)\b/.test(label)) return 'file-or-media'
  if (/\b(print|download)\b/.test(label)) return 'print-or-download'
  if (/\b(email|whatsapp|send)\b/.test(label)) return 'external-message'
  if (reason.includes('settings language toggle') || SETTINGS_LANGUAGE_BUTTON_RE.test(control.label)) return 'settings-toggle'
  if (/(?:hide|show)\s*\d+\s*fields/.test(label)) return 'settings-toggle'
  if (/\b(delete|remove|restore|reset|save|submit|confirm|done|pay|checkout|void|apply|approve|reject|backup|sync)\b/.test(label)) {
    return 'data-mutating'
  }
  return 'mutation-risk'
}

function seededRollbackHarness(category: string): string {
  if (category === 'file-or-media') return 'Use a small fixture file and delete uploaded artifacts after the test.'
  if (category === 'print-or-download') return 'Intercept print/download APIs and assert the generated artifact without writing business rows.'
  if (category === 'external-message') return 'Stub external delivery clients and assert queued payloads in a rollback transaction.'
  if (category === 'settings-toggle') return 'Snapshot settings, toggle the seeded field group, assert preview output, then restore settings.'
  if (category === 'data-mutating') return 'Run against seeded rows inside a rollback or snapshot/restore transaction.'
  return 'Add a dedicated seeded test with before/after data assertions and cleanup.'
}

function seededRollbackCandidates(): SeededRollbackCandidate[] {
  const seen = new Set<string>()
  const candidates: SeededRollbackCandidate[] = []
  for (const control of summary.controls) {
    const reason = String(control.reason || '')
    const isRollbackCandidate = control.skipped && (
      reason === 'mutating, noisy, file, print, or external action'
      || reason === 'settings language toggle requires rollback harness'
      || reason === 'file chooser avoided'
    )
    if (!isRollbackCandidate) continue
    const category = seededRollbackCategory(control)
    const key = `${control.profile}|${control.route}|${control.kind}|${control.label}|${category}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      profile: control.profile,
      route: control.route,
      kind: control.kind,
      label: control.label,
      reason,
      category,
      suggestedHarness: seededRollbackHarness(category),
    })
  }
  return candidates.sort((left, right) => (
    left.category.localeCompare(right.category)
    || left.route.localeCompare(right.route)
    || left.profile.localeCompare(right.profile)
    || left.label.localeCompare(right.label)
  ))
}

function seededRollbackSummaryRows(candidates: SeededRollbackCandidate[]): unknown[][] {
  const totals = new Map<string, number>()
  for (const candidate of candidates) {
    totals.set(candidate.category, (totals.get(candidate.category) || 0) + 1)
  }
  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([category, count]) => [category, count, seededRollbackHarness(category)])
}

function renderSeededRollbackMarkdown(candidates: SeededRollbackCandidate[]): string {
  const candidateRows = candidates
    .slice(0, 80)
    .map((candidate) => [
      candidate.category,
      `${candidate.profile}/${candidate.route}`,
      candidate.kind,
      candidate.label,
      candidate.reason,
      candidate.suggestedHarness,
    ])

  return `# Seeded Rollback Control Backlog

Generated: ${new Date().toISOString()}

These controls are intentionally skipped by the broad non-mutating all-pages
audit because they can mutate business data, open files/media, print/download,
or call external delivery paths. They need dedicated seeded rollback coverage
before the broad audit should click them.

## Summary

- Candidates: ${candidates.length}

${markdownTable(['Category', 'Controls', 'Suggested Harness'], seededRollbackSummaryRows(candidates))}

## Candidate Controls

${candidateRows.length ? markdownTable(['Category', 'Route', 'Kind', 'Label', 'Skip Reason', 'Suggested Harness'], candidateRows) : 'No seeded rollback candidates.'}
`
}

function renderCoverageMarkdown(): string {
  const coverage = summary.coverage
  const kindRows = Object.entries(coverage.byKind)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([kind, count]) => [kind, count])
  const skipRows = Object.entries(coverage.skippedByReason)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => [reason, count])
  const routes = routeCoverageRows()
  const lowestTestedRows = [...routes]
    .sort((left, right) => left.tested - right.tested || right.skippedRatio - left.skippedRatio || left.route.localeCompare(right.route))
    .slice(0, 12)
    .map((route) => [route.route, route.total, route.tested, route.skipped, percentage(route.skipped, route.total), route.failed])
  const highestSkippedRows = [...routes]
    .sort((left, right) => right.skippedRatio - left.skippedRatio || left.tested - right.tested || left.route.localeCompare(right.route))
    .slice(0, 12)
    .map((route) => [route.route, route.total, route.tested, route.skipped, percentage(route.skipped, route.total), route.failed])
  const findingRows = summary.findings
    .map((finding) => [finding.priority, finding.area, finding.message])

  return `# All-Pages Control Audit Coverage

Generated: ${new Date().toISOString()}

## Summary

- OK: ${summary.audit.ok === undefined ? 'pending' : String(summary.audit.ok)}
- Profile: ${summary.audit.profile}
- Routes: ${summary.routes.length}
- Controls: ${coverage.total}
- Tested: ${coverage.tested}
- Passed: ${coverage.passed}
- Failed: ${coverage.failed}
- Skipped: ${coverage.skipped}
- Skipped ratio: ${percentage(coverage.skipped, coverage.total)}
- Findings: ${summary.findings.length}
- Screenshots: ${summary.artifacts.screenshots.length}

## Controls By Kind

${markdownTable(['Kind', 'Controls'], kindRows)}

## Skipped By Reason

${markdownTable(['Reason', 'Controls'], skipRows)}

## Lowest Tested Routes

${markdownTable(['Route', 'Total', 'Tested', 'Skipped', 'Skipped %', 'Failed'], lowestTestedRows)}

## Highest Skipped Routes

${markdownTable(['Route', 'Total', 'Tested', 'Skipped', 'Skipped %', 'Failed'], highestSkippedRows)}

## Findings

${findingRows.length ? markdownTable(['Priority', 'Area', 'Message'], findingRows) : 'No findings.'}
`
}

function addCoverageGateFindings(): void {
  const minimumTestedControls = Math.max(
    MIN_TESTED_CONTROLS,
    summary.routes.length * MIN_TESTED_CONTROLS_PER_ROUTE,
  )
  if (summary.coverage.tested < minimumTestedControls) {
    addFinding(0, 'coverage', 'all-pages audit tested too few controls', {
      testedControls: summary.coverage.tested,
      minimumTestedControls,
      routes: summary.routes.length,
      minTestedControlsPerRoute: MIN_TESTED_CONTROLS_PER_ROUTE,
    })
  }
  if (MIN_TESTED_CONTROLS_PER_ROUTE > 0) {
    const routeCoverage = summary.routes
      .map((route) => {
        const routeKey = `${route.profile}/${route.route}`
        const coverage = summary.coverage.byRoute[routeKey] || {
          total: 0,
          tested: 0,
          failed: 0,
          skipped: 0,
        }
        return { route: routeKey, ...coverage }
      })
    const weakRoutes = routeCoverage
      .filter((route) => route.tested < MIN_TESTED_CONTROLS_PER_ROUTE)
    if (weakRoutes.length) {
      addFinding(0, 'coverage', 'all-pages audit has routes with too few tested controls', {
        minTestedControlsPerRoute: MIN_TESTED_CONTROLS_PER_ROUTE,
        weakRoutes,
      })
    }
    const highSkippedRoutes = routeCoverage
      .map((route) => ({
        ...route,
        skippedRatio: route.total > 0 ? Number((route.skipped / route.total).toFixed(3)) : 1,
      }))
      .filter((route) => route.skippedRatio > MAX_ROUTE_SKIPPED_CONTROL_RATIO)
    if (highSkippedRoutes.length) {
      addFinding(0, 'coverage', 'all-pages audit has routes with too many skipped controls', {
        maxRouteSkippedRatio: MAX_ROUTE_SKIPPED_CONTROL_RATIO,
        highSkippedRoutes,
      })
    }
  }
  const skippedRatio = summary.coverage.total > 0
    ? summary.coverage.skipped / summary.coverage.total
    : 1
  if (skippedRatio > MAX_SKIPPED_CONTROL_RATIO) {
    addFinding(0, 'coverage', 'all-pages audit skipped too many controls', {
      totalControls: summary.coverage.total,
      skippedControls: summary.coverage.skipped,
      skippedRatio: Number(skippedRatio.toFixed(3)),
      maxSkippedRatio: MAX_SKIPPED_CONTROL_RATIO,
      skippedByReason: summary.coverage.skippedByReason,
    })
  }
}

async function persistSummary(): Promise<void> {
  summary.coverage = computeControlCoverage(summary.controls)
  summary.artifacts.coverageReports = [COVERAGE_REPORT_PATH, LATEST_COVERAGE_REPORT_PATH]
  summary.artifacts.seededRollbackBacklog = [
    SEEDED_ROLLBACK_BACKLOG_PATH,
    SEEDED_ROLLBACK_BACKLOG_MARKDOWN_PATH,
    LATEST_SEEDED_ROLLBACK_BACKLOG_PATH,
    LATEST_SEEDED_ROLLBACK_BACKLOG_MARKDOWN_PATH,
  ]
  await writeJson(REPORT_PATH, summary)
  await writeJson(LATEST_REPORT_PATH, summary)
  const coverageReport = renderCoverageMarkdown()
  await writeText(COVERAGE_REPORT_PATH, coverageReport)
  await writeText(LATEST_COVERAGE_REPORT_PATH, coverageReport)
  const rollbackCandidates = seededRollbackCandidates()
  const rollbackReport = {
    generatedAt: new Date().toISOString(),
    sourceSummary: REPORT_PATH,
    candidateCount: rollbackCandidates.length,
    categories: Object.fromEntries(
      seededRollbackSummaryRows(rollbackCandidates).map(([category, count]) => [category, count]),
    ),
    candidates: rollbackCandidates,
  }
  await writeJson(SEEDED_ROLLBACK_BACKLOG_PATH, rollbackReport)
  await writeJson(LATEST_SEEDED_ROLLBACK_BACKLOG_PATH, rollbackReport)
  const rollbackMarkdown = renderSeededRollbackMarkdown(rollbackCandidates)
  await writeText(SEEDED_ROLLBACK_BACKLOG_MARKDOWN_PATH, rollbackMarkdown)
  await writeText(LATEST_SEEDED_ROLLBACK_BACKLOG_MARKDOWN_PATH, rollbackMarkdown)
}

async function saveScreenshot(page: Page, name: string): Promise<string> {
  const file = path.join(SCREENSHOT_DIR, `${safeName(name)}.png`)
  await page.screenshot({ path: file, fullPage: false })
  summary.artifacts.screenshots.push(file)
  return file
}

async function dismissTransientUi(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(120)
  const candidates = [
    page.locator('button[aria-label*="Close" i]').first(),
    page.getByRole('button', { name: /^Close$/i }).first(),
    page.getByRole('button', { name: /^Cancel$/i }).first(),
    page.getByRole('button', { name: /^Back$/i }).first(),
  ]
  for (const button of candidates) {
    if (!(await button.count().catch(() => 0))) continue
    if (!(await button.isVisible().catch(() => false))) continue
    await button.click({ timeout: 1_000 }).catch(() => {})
    await page.waitForTimeout(120)
    break
  }
}

async function waitForRouteReady(page: Page, route: AuditRoute): Promise<number> {
  const started = performance.now()
  await page.waitForFunction(({ routeName, readyTexts, scope }) => {
    const root = document.querySelector('#root, #app-root')
    const activeSlot = document.querySelector('[data-bos-active-page="true"]')
    const activePage = activeSlot?.getAttribute('data-bos-page-slot') || ''
    const scanText = scope === 'public' ? document.body?.innerText || '' : activeSlot?.textContent || ''
    const hasReadyText = readyTexts.some((item) => scanText.includes(item))
    const hasUsefulText = scanText.trim().length >= 40 && !/\bLoading\.\.\./i.test(scanText)
    const onExpectedPage = scope === 'public' || activePage === routeName
    const loginVisible = !!document.querySelector('#login-username, #login-password')
    return !!root && !loginVisible && onExpectedPage && (hasReadyText || hasUsefulText)
  }, { routeName: route.name, readyTexts: route.ready, scope: route.scope }, { timeout: ROUTE_READY_TIMEOUT_MS })
  return Math.round(performance.now() - started)
}

async function navigateRoute(page: Page, route: AuditRoute, storageState: BrowserStorageState | null): Promise<{
  navMs: number
  readyMs: number
}> {
  const started = performance.now()
  await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  if (storageState) await hydratePlaywrightPage(page, storageState)
  await page.waitForLoadState('networkidle', { timeout: 7_500 }).catch(() => {})
  const readyMs = await waitForRouteReady(page, route)
  return {
    navMs: Math.round(performance.now() - started),
    readyMs,
  }
}

async function countVisible(locator: Locator): Promise<number> {
  const total = await locator.count().catch(() => 0)
  let visible = 0
  for (let index = 0; index < total; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) visible += 1
  }
  return visible
}

async function activeButtonCandidates(root: Locator): Promise<ButtonCandidate[]> {
  const buttons = root.locator('button, [role="button"], [role="tab"]')
  const total = await buttons.count().catch(() => 0)
  const seen = new Set<string>()
  const candidates: ButtonCandidate[] = []
  for (let index = 0; index < total; index += 1) {
    const button = buttons.nth(index)
    if (!(await button.isVisible().catch(() => false))) continue
    if (await button.isDisabled().catch(() => false)) continue
    const rawLabel = await button.evaluate((node) => (
      node.getAttribute('aria-label')
      || node.getAttribute('title')
      || node.textContent
      || ''
    )).catch(() => '')
    const label = textForLabel(rawLabel)
    const reason = buttonSkipReason(label)
    const reportLabel = label || `button ${index + 1}`
    const key = `${reportLabel.toLowerCase()}|${reason || 'clickable'}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      index,
      label: reportLabel,
      skipped: !!reason,
      reason: reason || undefined,
    })
  }
  return candidates
}

async function clickButtonCandidate(
  page: Page,
  root: Locator,
  route: AuditRoute,
  candidate: ButtonCandidate,
  storageState: BrowserStorageState | null,
): Promise<ControlResult> {
  const started = performance.now()
  const resultName = candidate.label
  const expectedNavigation = expectedButtonNavigation(route, resultName)
  try {
    await dismissTransientUi(page)
    const buttons = root.locator('button, [role="button"], [role="tab"]')
    const exactName = new RegExp(`^\\s*${escapeRegExp(resultName)}\\s*$`, 'i')
    let button = root.getByRole('button', { name: exactName }).first()
    if (!(await button.count().catch(() => 0))) {
      button = root.getByRole('tab', { name: exactName }).first()
    }
    if (!(await button.count().catch(() => 0))) {
      if (route.name !== 'receipt_settings') {
        button = buttons.nth(candidate.index)
      } else {
        return { kind: 'button', label: resultName, ok: true, skipped: true, ms: 0, reason: 'candidate hidden after earlier interaction' }
      }
    }
    if (!(await button.count().catch(() => 0))) {
      return { kind: 'button', label: resultName, ok: true, skipped: true, ms: 0, reason: 'candidate hidden after earlier interaction' }
    }
    if (!(await button.isVisible().catch(() => false))) {
      return { kind: 'button', label: resultName, ok: true, skipped: true, ms: 0, reason: 'candidate hidden after earlier interaction' }
    }
    if (await button.isDisabled().catch(() => false)) {
      return { kind: 'button', label: resultName, ok: true, skipped: true, ms: 0, reason: 'candidate disabled' }
    }
    const fileChooser = page.waitForEvent('filechooser', { timeout: 800 }).catch(() => null)
    await button.click({ timeout: CONTROL_TIMEOUT_MS }).catch(async (error) => {
      if (!/intercepts pointer events|Timeout/i.test(String(error?.message || ''))) throw error
      await button.click({ timeout: CONTROL_TIMEOUT_MS, force: true })
    })
    const chooser = await fileChooser
    if (chooser) {
      await page.keyboard.press('Escape').catch(() => {})
      return { kind: 'button', label: resultName, ok: true, skipped: true, ms: Math.round(performance.now() - started), reason: 'file chooser avoided' }
    }
    await page.waitForTimeout(180)
    const bodyTextLength = await page.locator('body').evaluate((node) => node.textContent?.trim().length || 0).catch(() => 0)
    const overlayCount = await page.locator('#vite-error-overlay, [data-nextjs-dialog-overlay]').count().catch(() => 0)
    await dismissTransientUi(page)
    const navigationState = await page.evaluate(() => {
      const active = document.querySelector('[data-bos-active-page="true"]')
      return {
        pathname: window.location.pathname,
        activePage: active?.getAttribute('data-bos-page-slot') || '',
      }
    }).catch(() => ({ pathname: '', activePage: '' }))
    const landedOnExpectedNavigation = !!expectedNavigation
      && (navigationState.activePage === expectedNavigation.page || navigationState.pathname === expectedNavigation.path)
    const stillReady = landedOnExpectedNavigation || (
      route.scope === 'public'
        ? bodyTextLength > 40
        : await page.locator(`[data-bos-active-page="true"][data-bos-page-slot="${route.name}"]`).count().catch(() => 0) > 0
          || navigationState.pathname === route.path
    )
    const ok = bodyTextLength > 40 && overlayCount === 0 && stillReady
    if (landedOnExpectedNavigation) {
      await navigateRoute(page, route, storageState).catch(() => {})
    }
    return {
      kind: 'button',
      label: resultName,
      ok,
      ms: Math.round(performance.now() - started),
      proof: ok
        ? (landedOnExpectedNavigation ? `navigated-to-${expectedNavigation?.page}` : 'clicked-and-route-still-rendered')
        : 'route-not-stable-after-click',
    }
  } catch (error) {
    await dismissTransientUi(page)
    return {
      kind: 'button',
      label: resultName,
      ok: false,
      ms: Math.round(performance.now() - started),
      error: error?.message || String(error),
    }
  }
}

async function exerciseSearchInputs(root: Locator): Promise<ControlResult[]> {
  const results: ControlResult[] = []
  const inputs = root.locator('input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i]')
  const total = await inputs.count().catch(() => 0)
  for (let index = 0; index < total; index += 1) {
    const started = performance.now()
    const input = inputs.nth(index)
    const label = await input.evaluate((node) => (
      node.getAttribute('aria-label')
      || node.getAttribute('placeholder')
      || `search input ${index + 1}`
    )).catch(() => `search input ${index + 1}`)
    if (!(await input.isVisible().catch(() => false))) {
      results.push({ kind: 'input', label, ok: true, skipped: true, reason: 'hidden', ms: 0 })
      continue
    }
    if (await input.isDisabled().catch(() => false)) {
      results.push({ kind: 'input', label, ok: true, skipped: true, reason: 'disabled', ms: 0 })
      continue
    }
    try {
      await input.fill('QA', { timeout: CONTROL_TIMEOUT_MS })
      await input.press('Enter').catch(() => {})
      await input.fill('', { timeout: CONTROL_TIMEOUT_MS })
      results.push({
        kind: 'input',
        label,
        ok: true,
        ms: Math.round(performance.now() - started),
        proof: 'filled-cleared',
      })
    } catch (error) {
      results.push({
        kind: 'input',
        label,
        ok: false,
        ms: Math.round(performance.now() - started),
        error: error?.message || String(error),
      })
    }
  }
  return results
}

async function exerciseSelects(root: Locator): Promise<ControlResult[]> {
  const results: ControlResult[] = []
  const selects = root.locator('select')
  const total = Math.min(await selects.count().catch(() => 0), MAX_SELECT_CHANGES_PER_ROUTE)
  for (let index = 0; index < total; index += 1) {
    const started = performance.now()
    const select = selects.nth(index)
    const label = await select.evaluate((node) => (
      node.getAttribute('aria-label')
      || node.getAttribute('name')
      || node.id
      || `select ${index + 1}`
    )).catch(() => `select ${index + 1}`)
    if (!(await select.isVisible().catch(() => false))) {
      results.push({ kind: 'select', label, ok: true, skipped: true, reason: 'hidden', ms: 0 })
      continue
    }
    if (await select.isDisabled().catch(() => false)) {
      results.push({ kind: 'select', label, ok: true, skipped: true, reason: 'disabled', ms: 0 })
      continue
    }
    try {
      const state = await select.evaluate((node: HTMLSelectElement) => {
        const options = Array.from(node.options)
          .filter((option) => !option.disabled)
          .map((option) => option.value)
        return {
          value: node.value,
          next: options.find((value) => value !== node.value) || '',
        }
      })
      if (!state.next) {
        results.push({ kind: 'select', label, ok: true, skipped: true, reason: 'no alternate option', ms: Math.round(performance.now() - started) })
        continue
      }
      await select.selectOption(state.next)
      await select.selectOption(state.value)
      results.push({
        kind: 'select',
        label,
        ok: true,
        ms: Math.round(performance.now() - started),
        proof: 'changed-restored',
      })
    } catch (error) {
      results.push({
        kind: 'select',
        label,
        ok: false,
        ms: Math.round(performance.now() - started),
        error: error?.message || String(error),
      })
    }
  }
  return results
}

async function collectLayoutIssues(page: Page, route: AuditRoute): Promise<LayoutIssue[]> {
  return page.evaluate(({ selector, routeName, scope }) => {
    const issues: LayoutIssue[] = []
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const root = scope === 'public'
      ? document.body
      : document.querySelector(`[data-bos-active-page="true"][data-bos-page-slot="${routeName}"]`) || document.body
    const doc = document.documentElement
    if (doc.scrollWidth > viewportWidth + 4) {
      issues.push({
        type: 'body-horizontal-overflow',
        message: `document scrollWidth ${doc.scrollWidth} exceeds viewport ${viewportWidth}`,
      })
    }
    const nodes = Array.from(root.querySelectorAll(selector)).slice(0, 1_200)
    for (const node of nodes) {
      const rect = node.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      const style = window.getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const hasScrollableAncestor = (() => {
        let parent = node.parentElement
        while (parent && parent !== document.body) {
          const parentStyle = window.getComputedStyle(parent)
          if (/(auto|scroll)/.test(`${parentStyle.overflowX} ${parentStyle.overflowY}`)) return true
          parent = parent.parentElement
        }
        return false
      })()
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (!hasScrollableAncestor && (rect.left < -8 || rect.right > viewportWidth + 8)) {
        issues.push({
          type: 'viewport-horizontal-overflow',
          message: 'visible control extends outside viewport without a scroll container',
          selector: node.tagName.toLowerCase(),
          text,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        })
      }
      if (rect.top < -80 || rect.bottom > viewportHeight + 240) continue
      if (style.whiteSpace === 'nowrap' && node.scrollWidth > rect.width + 8 && text.length > 8) {
        issues.push({
          type: 'clipped-nowrap-text',
          message: 'nowrap text is wider than its visible box',
          selector: node.tagName.toLowerCase(),
          text,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
        })
      }
      if (issues.length >= 30) break
    }
    return issues
  }, { selector: LAYOUT_SELECTOR, routeName: route.name, scope: route.scope })
}

async function runRoute(page: Page, profile: AuditProfile, route: AuditRoute, storageState: BrowserStorageState | null): Promise<RouteResult> {
  console.log(`[all-pages] ${profile.name}/${route.name}`)
  const { consoleEntries, networkEntries } = await attachCollectors(page, profile.name, route.name)
  const nav = await navigateRoute(page, route, storageState)
  const root = routeRoot(page, route)
  const screenshot = await saveScreenshot(page, `${profile.name}-${route.name}-ready`)
  const visibleButtons = await countVisible(root.locator('button, [role="button"], [role="tab"]'))
  const visibleInputs = await countVisible(root.locator('input, textarea'))
  const visibleSelects = await countVisible(root.locator('select'))
  const controls: ControlResult[] = []
  controls.push(...await exerciseSearchInputs(root))
  controls.push(...await exerciseSelects(root))
  const buttonCandidates = await activeButtonCandidates(root)
  for (const candidate of buttonCandidates.filter((item) => item.skipped)) {
    controls.push({
      kind: 'button',
      label: candidate.label,
      ok: true,
      skipped: true,
      reason: candidate.reason || 'skipped by audit policy',
      ms: 0,
    })
  }
  const clickableButtonCandidates = buttonCandidates
    .filter((item) => !item.skipped)
    .slice(0, MAX_BUTTON_CLICKS_PER_ROUTE)
  for (const candidate of clickableButtonCandidates) {
    controls.push(await clickButtonCandidate(page, root, route, candidate, storageState))
  }
  const layoutIssues = await collectLayoutIssues(page, route)
  const appConsoleIssues = consoleEntries.filter(isAppConsoleIssue)
  const appNetworkIssues = networkEntries.filter(isAppNetworkIssue)
  for (const issue of appConsoleIssues) {
    addFinding(0, 'console', `${profile.name}/${route.name} app-owned console issue`, issue)
  }
  for (const issue of appNetworkIssues) {
    addFinding(issue.status >= 500 ? 0 : 1, 'network', `${profile.name}/${route.name} app-owned request returned ${issue.status}`, issue)
  }
  for (const issue of layoutIssues) {
    addFinding(issue.type === 'body-horizontal-overflow' ? 1 : 2, 'layout', `${profile.name}/${route.name} ${issue.message}`, issue)
  }
  for (const control of controls) {
    summary.controls.push({ ...control, profile: profile.name, route: route.name })
    if (control.skipped || control.ok) continue
    addFinding(1, 'control', `${profile.name}/${route.name} ${control.kind} "${control.label}" failed`, control)
  }
  await saveScreenshot(page, `${profile.name}-${route.name}-after-controls`)
  return {
    profile: profile.name,
    route: route.name,
    path: route.path,
    navMs: nav.navMs,
    readyMs: nav.readyMs,
    screenshot,
    controls: {
      visibleButtons,
      visibleInputs,
      visibleSelects,
      tested: controls.filter((item) => !item.skipped).length,
      passed: controls.filter((item) => !item.skipped && item.ok).length,
      skipped: controls.filter((item) => item.skipped).length,
    },
    layoutIssues,
    consoleIssues: appConsoleIssues,
    networkIssues: appNetworkIssues,
  }
}

async function createAuthedPage(browser: Browser, profile: AuditProfile, session: LoginSession): Promise<{
  context: BrowserContext
  page: Page
  storageState: BrowserStorageState
}> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.isMobile,
    deviceScaleFactor: profile.isMobile ? 2 : 1,
    acceptDownloads: true,
  })
  const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
  const page = await context.newPage()
  await hydratePlaywrightPage(page, storageState)
  return { context, page, storageState }
}

async function runProfile(browser: Browser, profile: AuditProfile, routes: AuditRoute[]): Promise<void> {
  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  for (const route of routes) {
    let context: BrowserContext | null = null
    try {
      if (route.authRequired === false) {
        context = await browser.newContext({
          baseURL: BASE_URL,
          viewport: profile.viewport,
          isMobile: profile.isMobile,
          hasTouch: profile.isMobile,
          deviceScaleFactor: profile.isMobile ? 2 : 1,
          acceptDownloads: true,
        })
        const publicPage = await context.newPage()
        summary.routes.push(await runRoute(publicPage, profile, route, null))
      } else {
        const pageBundle = await createAuthedPage(browser, profile, session)
        context = pageBundle.context
        summary.routes.push(await runRoute(pageBundle.page, profile, route, pageBundle.storageState))
      }
      await persistSummary()
    } catch (error) {
      addFinding(0, 'route', `${profile.name}/${route.name} route audit failed`, {
        route: route.name,
        profile: profile.name,
        error: error?.message || String(error),
      })
      await persistSummary()
    } finally {
      await context?.close().catch(() => {})
    }
  }
}

async function main(): Promise<void> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true })
  const health = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(20_000) }).then((response) => response.json())
  if (health?.status !== 'ok') throw new Error('Health check is not ok')
  const selectedRoutes = resolveAuditRoutes(readArgs('--route'))
  if (selectedRoutes.unknownRoutes.length) {
    throw new Error(`Unknown route(s): ${selectedRoutes.unknownRoutes.join(', ')}`)
  }
  const routes = [...selectedRoutes.adminRoutes, ...selectedRoutes.publicRoutes]
    .filter((route) => route.browserAudit !== false)
  const profiles = getAuditProfiles(PROFILE)
  const browser = await chromium.launch({ headless: true })
  try {
    for (const profile of profiles) {
      await runProfile(browser, profile, routes)
    }
  } finally {
    await browser.close().catch(() => {})
  }
  summary.audit.finishedAt = new Date().toISOString()
  summary.coverage = computeControlCoverage(summary.controls)
  addCoverageGateFindings()
  summary.audit.ok = summary.findings.every((finding) => Number(finding.priority) > 0)
  await persistSummary()
  console.log(JSON.stringify({
    ok: summary.audit.ok,
    routes: summary.routes.length,
    controls: summary.controls.length,
    testedControls: summary.coverage.tested,
    skippedControls: summary.coverage.skipped,
    failedControls: summary.coverage.failed,
    skippedByReason: summary.coverage.skippedByReason,
    findings: summary.findings.length,
    reportPath: REPORT_PATH,
    screenshotCount: summary.artifacts.screenshots.length,
  }, null, 2))
  if (!summary.audit.ok) process.exitCode = 1
}

main().catch(async (error) => {
  summary.audit.finishedAt = new Date().toISOString()
  summary.audit.ok = false
  addFinding(0, 'runner', error?.message || String(error), { stack: error?.stack || '' })
  await persistSummary().catch(() => {})
  console.error(error)
  process.exitCode = 1
})
