/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const ROOT_DIR = path.resolve(__dirname, '../../../..')
const DEFAULT_REPORT = 'ops/runtime/reports/post-live-hygiene-latest.json'
const INTEGRITY_BACKLOG_REPORT = 'ops/runtime/reports/cleanup-integrity-backlog-preview-latest.json'
const DATASET_READINESS_REPORT = 'ops/runtime/reports/dataset-readiness-latest.json'

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    output: DEFAULT_REPORT,
    skipIntegrity: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--output') args.output = argv[++index] || args.output
    else if (value === '--skip-integrity') args.skipIntegrity = true
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

function runCheck(name, command, args) {
  const startedAt = Date.now()
  const maxOutputBytes = 1024 * 1024 * 30
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const appendBounded = (current, chunk) => {
      const next = current + chunk.toString()
      return next.length > maxOutputBytes ? next.slice(-maxOutputBytes) : next
    }
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk)
    })
    child.on('error', (error) => {
      resolve({
        name,
        ok: false,
        status: 127,
        error: error?.message,
        durationMs: Date.now() - startedAt,
        stdoutTail: String(stdout || '').slice(-4000),
        stderrTail: String(stderr || '').slice(-4000),
      })
    })
    child.on('close', (status) => {
      resolve({
        name,
        ok: status === 0,
        status,
        durationMs: Date.now() - startedAt,
        stdoutTail: String(stdout || '').slice(-4000),
        stderrTail: String(stderr || '').slice(-4000),
      })
    })
  })
}

function readJsonReport(relativePath) {
  const target = assertInsideWorkspace(path.resolve(ROOT_DIR, relativePath))
  if (!fs.existsSync(target)) return null
  return JSON.parse(fs.readFileSync(target, 'utf8'))
}

function sumMatchedCounts(report) {
  const matched = report?.result?.matched || {}
  return Object.values(matched).reduce((total, value) => total + (Number(value) || 0), 0)
}

async function withReportCheck(checkPromise, reportPath, validateReport) {
  const check = await checkPromise
  if (!check.ok) return check
  try {
    const parsedReport = readJsonReport(reportPath)
    const reportResult = validateReport(parsedReport)
    return {
      ...check,
      ok: reportResult.ok,
      reportPath,
      reportSummary: reportResult.summary,
      failure: reportResult.ok ? undefined : reportResult.message,
    }
  } catch (error) {
    return {
      ...check,
      ok: false,
      reportPath,
      failure: error?.message || String(error),
    }
  }
}

function nodeCheck(name, script, args = []) {
  return runCheck(name, process.execPath, [path.join(ROOT_DIR, script), ...args])
}

function buildCheckPlan(args) {
  const checks = [
    () => nodeCheck('broad QA cleanup postcheck', 'ops/scripts/runtime/storage/cleanup-test-data.ts', [
      '--all-qa',
      '--dry-run',
      '--fail-on-match',
      '--output',
      'ops/runtime/reports/test-data-cleanup-postcheck-latest.json',
    ]),
    () => nodeCheck('QA Smoke cleanup postcheck', 'ops/scripts/runtime/storage/cleanup-test-data.ts', [
      '--prefix',
      'QA Smoke',
      '--dry-run',
      '--fail-on-match',
      '--output',
      'ops/runtime/reports/live-smoke-cleanup-postcheck-latest.json',
    ]),
    () => nodeCheck('QA Action History cleanup postcheck', 'ops/scripts/runtime/storage/cleanup-test-data.ts', [
      '--prefix',
      'QA Action History',
      '--dry-run',
      '--fail-on-match',
      '--output',
      'ops/runtime/reports/action-history-cleanup-postcheck-latest.json',
    ]),
    () => withReportCheck(
      nodeCheck('generated integrity cleanup postcheck', 'ops/scripts/runtime/storage/cleanup-integrity-backlog.ts', [
        '--dry-run',
        '--output',
        INTEGRITY_BACKLOG_REPORT,
      ]),
      INTEGRITY_BACKLOG_REPORT,
      (report) => {
        const matchedTotal = sumMatchedCounts(report)
        return {
          ok: matchedTotal === 0,
          message: `Generated integrity cleanup preview still matches ${matchedTotal} row(s).`,
          summary: { matchedTotal, matched: report?.result?.matched || {} },
        }
      },
    ),
    () => withReportCheck(
      nodeCheck('dataset readiness', 'ops/scripts/runtime/storage/dataset-readiness.ts', [
        '--fail-if-empty',
        '--output',
        DATASET_READINESS_REPORT,
      ]),
      DATASET_READINESS_REPORT,
      (report) => {
        const status = report?.readiness?.status || 'unknown'
        return {
          ok: status === 'loaded',
          message: `Dataset readiness is ${status}; expected loaded.`,
          summary: { status, counts: report?.readiness?.counts || {} },
        }
      },
    ),
  ]

  if (!args.skipIntegrity) {
    checks.push(() => nodeCheck('comprehensive data integrity', 'ops/scripts/backend/verify-data-integrity.js', [
      '--comprehensive',
      '--output',
      'ops/runtime/reports/data-integrity-comprehensive-latest.json',
    ]))
  }

  return checks
}

async function runChecks(args) {
  const checks = []
  for (const runCheckTask of buildCheckPlan(args)) {
    checks.push(await runCheckTask())
  }
  return checks
}

async function main() {
  const args = parseArgs()
  const checks = await runChecks(args)
  const report = {
    generatedAt: new Date().toISOString(),
    executionMode: 'contention-safe-sequential-checks',
    ok: checks.every((check) => check.ok),
    checks,
  }
  fs.mkdirSync(path.dirname(args.output), { recursive: true })
  fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
