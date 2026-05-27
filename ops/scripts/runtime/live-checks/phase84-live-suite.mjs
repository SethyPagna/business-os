/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const DEFAULT_REPORT = 'ops/runtime/reports/phase84-live-suite-latest.json'

const SUITE_STEPS = [
  {
    name: 'broad Phase 8.4 UI live check',
    script: 'ops/scripts/runtime/live-checks/phase84-ui-live-check.mjs',
    flag: 'skipUi',
    reportPrefix: 'phase84-ui-live-check-',
  },
  {
    name: 'public Cloudflare portal check',
    script: 'ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.mjs',
    flag: 'skipPublic',
    reportPrefix: 'phase84-public-portal-cloudflare-check-',
  },
  {
    name: 'post-live hygiene gate',
    script: 'ops/scripts/runtime/storage/post-live-hygiene.mjs',
    flag: 'skipHygiene',
    reportPath: 'ops/runtime/reports/post-live-hygiene-latest.json',
  },
]

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
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

function assertInsideWorkspace(target) {
  const relative = path.relative(ROOT_DIR, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Refusing output outside workspace: ${target}`)
  return target
}

function tail(value) {
  return String(value || '').slice(-4000)
}

function readJsonIfExists(target) {
  if (!target || !fs.existsSync(target)) return null
  return JSON.parse(fs.readFileSync(target, 'utf8'))
}

function latestReportPathForPrefix(prefix) {
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

function relativePath(target) {
  if (!target) return ''
  return path.relative(ROOT_DIR, target).replace(/\\/g, '/')
}

function summarizeReport(step, report) {
  if (!report) return null
  if (step.reportPath?.includes('post-live-hygiene')) {
    return {
      ok: report.ok,
      checks: report.checks?.length || 0,
      failedChecks: (report.checks || []).filter((check) => !check.ok).map((check) => check.name),
      datasetStatus: report.checks?.find((check) => check.name === 'dataset readiness')?.reportSummary?.status,
      generatedIntegrityMatches: report.checks?.find((check) => check.name === 'generated integrity cleanup postcheck')?.reportSummary?.matchedTotal,
    }
  }
  if (step.reportPrefix?.includes('public-portal')) {
    return {
      renderedProductCount: report.checks?.renderedProductCount,
      failedResponseCount: report.checks?.failedResponseCount,
      relevantConsoleMessages: report.checks?.relevantConsoleMessages,
      pageErrors: report.checks?.pageErrors,
      enforcedCspPresent: report.checks?.enforcedCspPresent,
    }
  }
  if (step.reportPrefix?.includes('ui-live-check')) {
    return {
      frontendHash: report.build?.hash || report.health?.frontendHash,
      checkedSignals: report.checks ? Object.keys(report.checks).length : 0,
      relevantConsoleMessages: report.checks?.relevantConsoleMessages,
      frameworkOverlayVisible: report.checks?.frameworkOverlayVisible,
    }
  }
  return null
}

function readStepReport(step) {
  const reportPath = step.reportPath ? path.join(ROOT_DIR, step.reportPath) : latestReportPathForPrefix(step.reportPrefix)
  const report = readJsonIfExists(reportPath)
  if (!report) return {}
  return {
    reportPath: relativePath(reportPath),
    reportSummary: summarizeReport(step, report),
  }
}

function runNodeStep(step) {
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

function skippedStep(step) {
  return {
    name: step.name,
    script: step.script,
    ok: true,
    skipped: true,
    durationMs: 0,
  }
}

function runSuite(args) {
  const steps = []
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
