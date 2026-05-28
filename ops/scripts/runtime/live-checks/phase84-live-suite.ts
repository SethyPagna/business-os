/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const DEFAULT_REPORT = 'ops/runtime/reports/phase84-live-suite-latest.json'

type SuiteArgs = {
  output: string
  skipUi: boolean
  skipPublic: boolean
  skipHygiene: boolean
  keepGoing: boolean
}

type SuiteStep = {
  name: string
  script: string
  flag: keyof Pick<SuiteArgs, 'skipUi' | 'skipPublic' | 'skipHygiene'>
  reportPrefix?: string
  reportPath?: string
}

type StepReport = {
  checks?: Record<string, unknown>
  build?: { hash?: string }
  health?: { frontendHash?: string }
  ok?: boolean
  [key: string]: unknown
}

type HygieneCheck = {
  name?: string
  ok?: boolean
  reportSummary?: {
    status?: string
    matchedTotal?: number
  }
}

type StepResult = {
  name: string
  script: string
  ok: boolean
  skipped?: boolean
  status?: number | null
  error?: string
  durationMs: number
  reportPath?: string
  reportSummary?: Record<string, unknown> | null
  stdoutTail?: string
  stderrTail?: string
}

const SUITE_STEPS: SuiteStep[] = [
  {
    name: 'broad Phase 8.4 UI live check',
    script: 'ops/scripts/runtime/live-checks/phase84-ui-live-check.ts',
    flag: 'skipUi',
    reportPrefix: 'phase84-ui-live-check-',
  },
  {
    name: 'public Cloudflare portal check',
    script: 'ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts',
    flag: 'skipPublic',
    reportPrefix: 'phase84-public-portal-cloudflare-check-',
  },
  {
    name: 'post-live hygiene gate',
    script: 'ops/scripts/runtime/storage/post-live-hygiene.ts',
    flag: 'skipHygiene',
    reportPath: 'ops/runtime/reports/post-live-hygiene-latest.json',
  },
]

function parseArgs(argv = process.argv.slice(2)): SuiteArgs {
  const args: SuiteArgs = {
    output: DEFAULT_REPORT,
    skipUi: false,
    skipPublic: false,
    skipHygiene: false,
    keepGoing: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--output') args.output = argv[++index] || args.output
    else if (value === '--skip-ui') args.skipUi = true
    else if (value === '--skip-public') args.skipPublic = true
    else if (value === '--skip-hygiene') args.skipHygiene = true
    else if (value === '--keep-going') args.keepGoing = true
    else throw new Error(`Unknown argument: ${value}`)
  }

  args.output = assertInsideWorkspace(path.resolve(ROOT_DIR, args.output))
  return args
}

function assertInsideWorkspace(target: string): string {
  const relative = path.relative(ROOT_DIR, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Refusing output outside workspace: ${target}`)
  return target
}

function tail(value: unknown): string {
  return String(value || '').slice(-4000)
}

function readJsonIfExists(target: string): StepReport | null {
  if (!target || !fs.existsSync(target)) return null
  return JSON.parse(fs.readFileSync(target, 'utf8'))
}

function latestReportPathForPrefix(prefix: string | undefined): string {
  if (!prefix) return ''
  const reportsDir = path.join(ROOT_DIR, 'ops/runtime/reports')
  if (!fs.existsSync(reportsDir)) return ''
  const candidates = fs.readdirSync(reportsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => {
      const reportPath = path.join(reportsDir, entry.name, 'report.json')
      return {
        reportPath,
        modifiedMs: fs.existsSync(reportPath) ? fs.statSync(reportPath).mtimeMs : 0,
      }
    })
    .filter((entry) => entry.modifiedMs > 0)
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
  return candidates[0]?.reportPath || ''
}

function relativePath(target: string): string {
  if (!target) return ''
  return path.relative(ROOT_DIR, target).replace(/\\/g, '/')
}

function summarizeReport(step: SuiteStep, report: StepReport): Record<string, unknown> | null {
  if (!report) return null
  const checks = report.checks || {}
  if (step.reportPath?.includes('post-live-hygiene')) {
    const hygieneChecks = Array.isArray(report.checks) ? report.checks as HygieneCheck[] : []
    return {
      ok: report.ok,
      checks: hygieneChecks.length,
      failedChecks: hygieneChecks.filter((check) => !check.ok).map((check) => check.name),
      datasetStatus: hygieneChecks.find((check) => check.name === 'dataset readiness')?.reportSummary?.status,
      generatedIntegrityMatches: hygieneChecks.find((check) => check.name === 'generated integrity cleanup postcheck')?.reportSummary?.matchedTotal,
    }
  }
  if (step.reportPrefix?.includes('public-portal')) {
    return {
      renderedProductCount: checks.renderedProductCount,
      failedResponseCount: checks.failedResponseCount,
      relevantConsoleMessages: checks.relevantConsoleMessages,
      pageErrors: checks.pageErrors,
      enforcedCspPresent: checks.enforcedCspPresent,
    }
  }
  if (step.reportPrefix?.includes('ui-live-check')) {
    return {
      frontendHash: report.build?.hash || report.health?.frontendHash,
      checkedSignals: Object.keys(checks).length,
      relevantConsoleMessages: checks.relevantConsoleMessages,
      frameworkOverlayVisible: checks.frameworkOverlayVisible,
    }
  }
  return null
}

function readStepReport(step: SuiteStep): Pick<StepResult, 'reportPath' | 'reportSummary'> | Record<string, never> {
  const reportPath = step.reportPath ? path.join(ROOT_DIR, step.reportPath) : latestReportPathForPrefix(step.reportPrefix)
  const report = readJsonIfExists(reportPath)
  if (!report) return {}
  return {
    reportPath: relativePath(reportPath),
    reportSummary: summarizeReport(step, report),
  }
}

function runNodeStep(step: SuiteStep): StepResult {
  const startedAt = Date.now()
  console.log(`[phase84-suite] ${step.name}`)
  const result = spawnSync(process.execPath, [path.join(ROOT_DIR, step.script)], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40,
  })
  return {
    name: step.name,
    script: step.script,
    ok: result.status === 0,
    status: result.status,
    error: result.error?.message,
    durationMs: Date.now() - startedAt,
    ...readStepReport(step),
    ...(result.status === 0 ? {} : { stdoutTail: tail(result.stdout), stderrTail: tail(result.stderr) }),
  }
}

function skippedStep(step: SuiteStep): StepResult {
  return {
    name: step.name,
    script: step.script,
    ok: true,
    skipped: true,
    durationMs: 0,
  }
}

function runSuite(args: SuiteArgs): StepResult[] {
  const steps: StepResult[] = []
  for (const step of SUITE_STEPS) {
    const result = args[step.flag] ? skippedStep(step) : runNodeStep(step)
    steps.push(result)
    if (!result.ok && !args.keepGoing) break
  }
  return steps
}

try {
  const args = parseArgs()
  const startedAt = Date.now()
  const steps = runSuite(args)
  const report = {
    generatedAt: new Date().toISOString(),
    ok: steps.every((step) => step.ok),
    durationMs: Date.now() - startedAt,
    options: {
      skipUi: args.skipUi,
      skipPublic: args.skipPublic,
      skipHygiene: args.skipHygiene,
      keepGoing: args.keepGoing,
    },
    steps,
  }

  fs.mkdirSync(path.dirname(args.output), { recursive: true })
  fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
} catch (error) {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
}
