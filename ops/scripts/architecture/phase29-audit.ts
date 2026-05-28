/* eslint-disable no-console */
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { mapLimit, pathExists: filePathExists, toPosix: normalizePath } = require('../lib/fs-utils.js')
const { markdownTable, outputTail, summarizeReportValue } = require('../lib/report-utils.js')
const ROOT_DIR = path.resolve(__dirname, '../../..')
const REPORT_PATH = path.join(ROOT_DIR, 'ops/docs/reference/PHASE29-AUDIT.md')
const SUMMARY_PATH = path.join(ROOT_DIR, 'ops/docs/reference/PHASE29-AUDIT.json')
const POLICY_PATH = path.join(ROOT_DIR, 'ops/automation/business-os-automation.json')

const CHECKS = [
  {
    label: 'Generated bulk audit',
    command: process.execPath,
    args: ['ops/scripts/architecture/generated-bulk-audit.ts', '--policy', 'ops/automation/business-os-automation.json'],
    reports: ['ops/docs/reference/GENERATED-BULK-AUDIT.md', 'ops/docs/reference/GENERATED-BULK-AUDIT.json'],
  },
  {
    label: 'Organization audit',
    command: process.execPath,
    args: ['ops/scripts/architecture/organization-audit.ts'],
    reports: ['ops/docs/reference/ORGANIZATION-AUDIT.md', 'ops/docs/reference/ORGANIZATION-AUDIT.json'],
  },
  {
    label: 'Schema audit',
    command: process.execPath,
    args: ['ops/scripts/backend/schema-audit.js'],
    reports: ['ops/docs/reference/SCHEMA-AUDIT.md', 'ops/docs/reference/SCHEMA-AUDIT.json'],
  },
  {
    label: 'Performance/code-flow scan',
    command: process.execPath,
    args: ['ops/scripts/docs/performance-scan.js'],
    reports: ['ops/docs/reference/PERFORMANCE-SCAN.md', 'ops/docs/reference/PERFORMANCE-SCAN.json'],
  },
  {
    label: 'Language/runtime audit',
    command: process.execPath,
    args: ['ops/scripts/architecture/language-runtime-audit.ts'],
    reports: ['ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md', 'ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json'],
  },
  {
    label: 'Docker release guardrail',
    command: process.execPath,
    args: ['ops/scripts/verification/verify-docker-release.js'],
    reports: ['ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json'],
  },
  {
    label: 'Runtime dependency guardrail',
    command: process.execPath,
    args: ['ops/scripts/verification/verify-runtime-deps.js'],
    reports: ['ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json'],
  },
]

const EXECUTION_MODE = 'contention-safe-reference-writers-then-bounded-guardrails'
const REFERENCE_WRITER_CONCURRENCY = 1
const PARALLEL_CHECK_CONCURRENCY = 2
const REFERENCE_WRITER_LABELS = new Set([
  'Generated bulk audit',
  'Schema audit',
  'Performance/code-flow scan',
  'Language/runtime audit',
])
const PARALLEL_CHECK_LABELS = new Set([
  'Docker release guardrail',
  'Runtime dependency guardrail',
])
const ORGANIZATION_CHECK_LABEL = 'Organization audit'

function parseArgs(argv) {
  const options = { repeat: 1, verbose: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--repeat') {
      const next = Number.parseInt(argv[index + 1] || '', 10)
      if (Number.isFinite(next) && next > 0) {
        options.repeat = Math.min(next, 10)
      }
      index += 1
    } else if (arg === '--verbose') {
      options.verbose = true
    }
  }
  return options
}

function parseLastJsonObject(output) {
  const text = String(output || '').trim()
  for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
    try {
      return JSON.parse(text.slice(index))
    } catch (_) {
      // Keep walking backward until we find the start of the last JSON object.
    }
  }
  return null
}

function runChildProcess(check, options) {
  return new Promise((resolve) => {
    const child = spawn(check.command, check.args, {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stdout += text
      if (options.verbose) process.stdout.write(text)
    })
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stderr += text
      if (options.verbose) process.stderr.write(text)
    })
    child.on('error', (error) => {
      resolve({ status: 1, stdout, stderr: `${stderr}\n${error?.stack || error?.message || String(error)}`.trim() })
    })
    child.on('close', (code) => {
      resolve({ status: code ?? 1, stdout, stderr })
    })
  })
}

async function runCheck(check, cycle, repeat, options) {
  console.log(`\n[phase29] cycle ${cycle}/${repeat}: ${check.label}`)
  const startedAt = Date.now()
  const result = await runChildProcess(check, options)
  const durationMs = Date.now() - startedAt
  if (!options.verbose && result.status !== 0) {
    const stdoutTail = outputTail(result.stdout)
    const stderrTail = outputTail(result.stderr)
    if (stdoutTail) console.log(`[phase29] stdout tail:\n${stdoutTail}`)
    if (stderrTail) console.error(`[phase29] stderr tail:\n${stderrTail}`)
  }
  const parsedOutput = parseLastJsonObject(result.stdout)
  const statusLabel = result.status === 0 ? 'passed' : 'failed'
  console.log(`[phase29] ${statusLabel} in ${durationMs} ms; reports: ${check.reports.join(', ')}`)
  return {
    label: check.label,
    command: `${path.basename(check.command)} ${check.args.join(' ')}`,
    status: result.status ?? 1,
    durationMs,
    reports: check.reports,
    parsedOutput,
    cycle,
  }
}

async function runCheckGroup(checks, cycle, repeat, options, concurrency = PARALLEL_CHECK_CONCURRENCY) {
  return mapLimit(checks, concurrency, (check) => runCheck(check, cycle, repeat, options))
}

function flattenCycles(cycles) {
  return cycles.flatMap((cycle) => cycle.results)
}

function buildDurationSummary(results) {
  const byLabel = new Map()
  for (const result of results) {
    const current = byLabel.get(result.label) || {
      label: result.label,
      runs: 0,
      totalMs: 0,
      maxMs: 0,
    }
    current.runs += 1
    current.totalMs += result.durationMs
    current.maxMs = Math.max(current.maxMs, result.durationMs)
    byLabel.set(result.label, current)
  }
  const byCheck = [...byLabel.values()]
    .map((entry) => ({
      ...entry,
      averageMs: Math.round(entry.totalMs / Math.max(entry.runs, 1)),
    }))
    .sort((left, right) => right.totalMs - left.totalMs || left.label.localeCompare(right.label))
  const slowestRuns = results
    .map((result) => ({
      cycle: result.cycle,
      label: result.label,
      durationMs: result.durationMs,
    }))
    .sort((left, right) => right.durationMs - left.durationMs || left.label.localeCompare(right.label))
    .slice(0, 5)
  return {
    totalMs: results.reduce((total, result) => total + result.durationMs, 0),
    byCheck,
    slowestRuns,
  }
}

async function renderReport(cycles, repeat) {
  const generatedAt = new Date().toISOString()
  const reportRows = []
  const results = flattenCycles(cycles)
  const repeatConsistency = buildRepeatConsistency(cycles)
  const durationSummary = buildDurationSummary(results)
  for (const result of results) {
    const reportLinks = []
    for (const report of result.reports) {
      reportLinks.push(await filePathExists(path.join(ROOT_DIR, report)) ? `\`${report}\`` : `missing: \`${report}\``)
    }
    reportRows.push([
      String(result.cycle),
      result.label,
      result.status === 0 ? 'passed' : 'failed',
      `${result.durationMs} ms`,
      `\`${result.command}\``,
      reportLinks.join('<br>') || 'none',
    ])
  }

  const failures = results.filter((result) => result.status !== 0)
  const durationRows = durationSummary.byCheck.map((entry) => [
    entry.label,
    String(entry.runs),
    `${entry.totalMs} ms`,
    `${entry.averageMs} ms`,
    `${entry.maxMs} ms`,
  ])
  const slowestRows = durationSummary.slowestRuns.map((entry) => [
    String(entry.cycle),
    entry.label,
    `${entry.durationMs} ms`,
  ])
  const consistencyRows = repeatConsistency.comparisons.map((comparison) => [
    comparison.label,
    comparison.field,
    comparison.stable ? 'stable' : 'drift',
    comparison.values.map((value) => `cycle ${value.cycle}: \`${summarizeReportValue(value.value)}\``).join('<br>'),
  ])
  return `# Phase 29 Audit

Generated: ${generatedAt}

Policy: \`${normalizePath(path.relative(ROOT_DIR, POLICY_PATH))}\`

## Summary

- Checks: ${results.length}
- Failures: ${failures.length + repeatConsistency.drift.length}
- Cycles: ${repeat}
- Total child-check duration: ${durationSummary.totalMs} ms
- Repeat consistency: ${repeatConsistency.stable ? 'stable' : 'drift detected'}
- Execution mode: ${EXECUTION_MODE}
- Reference writer concurrency: ${REFERENCE_WRITER_CONCURRENCY}
- Parallel child-check concurrency: ${PARALLEL_CHECK_CONCURRENCY}
- Mode: non-mutating audit. This command measures and verifies; it does not delete files, move folders, run migrations, or prune remote storage.

## Checks

${markdownTable(['Cycle', 'Check', 'Status', 'Duration', 'Command', 'Report output'], reportRows)}

## Duration Summary

${markdownTable(['Check', 'Runs', 'Total', 'Average', 'Max'], durationRows)}

## Slowest Runs

${slowestRows.length ? markdownTable(['Cycle', 'Check', 'Duration'], slowestRows) : 'No child-check durations were recorded.'}

## Repeat Consistency

${consistencyRows.length ? markdownTable(['Check', 'Field', 'Status', 'Values'], consistencyRows) : 'Repeat consistency checks are skipped for single-cycle runs.'}

Full repeat values are retained in \`${normalizePath(path.relative(ROOT_DIR, SUMMARY_PATH))}\`; this Markdown report summarizes long arrays and objects with counts, hashes, and previews.

## Boundary

- Generated/runtime bulk is measured through the generated-bulk audit and guarded by policy.
- Folder/schema consistency is checked through organization and schema audits.
- Reference-producing checks run one at a time to avoid Windows file-lock
  contention on generated Markdown/JSON reports; bounded-parallel guardrails run
  after them, then organization audit scans a coherent docs/reference tree.
- Code-flow and large-module candidates are measured through the performance/code-flow scan.
- Language/runtime conversion candidates are measured through the language/runtime audit.
- Docker/release cleanup boundaries are checked by the Docker release verifier.
- Destructive cleanup still requires an explicit cleanup command or retention script, never this audit.
- Console output is concise by default; run with \`--verbose\` to stream full child-check output while debugging.
`
}

function comparableValue(value, { label = '', field = '' } = {}) {
  let stableValue = value
  if (label === 'Runtime dependency guardrail' && field === 'runtimeVersionGuardCoverage') {
    const { distBuildManifestPresent: _distBuildManifestPresent, ...sourceWiringCoverage } = value || {}
    stableValue = sourceWiringCoverage
  }
  if (Array.isArray(stableValue) || (stableValue && typeof stableValue === 'object')) {
    return JSON.stringify(stableValue)
  }
  return stableValue
}

function collectParsedByCycle(cycles, label) {
  return cycles
    .map((cycle) => cycle.results.find((result) => result.label === label))
    .filter((result) => result?.parsedOutput)
}

function buildRepeatConsistency(cycles) {
  const specs = [
    {
      label: 'Generated bulk audit',
      fields: [
        'totalBytes',
        'protectedBytes',
        'cleanupCandidateBytes',
        'nestedTargetOverlaps',
        'nestedOverlapBytes',
        'adjustedTotalBytes',
        'adjustedProtectedBytes',
        'adjustedCleanupCandidateBytes',
        'largestProtectedTargets',
        'largestCleanupTargets',
        'dispositionTotals',
        'generatedBulkCandidateMaxBytes',
        'thresholdExceeded',
        'measurementMode',
        'measuredTargetsInParallel',
        'targetMeasureConcurrency',
        'fileStatMode',
        'fileStatConcurrency',
        'missingIgnoreCoverage',
        'protectedCleanupDrift',
        'cleanupCoverageGaps',
        'dependencyTopology',
      ],
    },
    {
      label: 'Organization audit',
      fields: [
        'filesScanned',
        'largeFiles',
        'compatibilityWrappers',
        'brokenCompatibilityWrappers',
        'wrapperRemovalCandidates',
        'generatedOnlyWrapperReferences',
        'scanRoots',
        'scanFiles',
        'fileReadMode',
        'rootWalkMode',
        'rootWalkConcurrency',
        'fileReadConcurrency',
        'largeFileThreshold',
        'largestAreas',
        'largeFilePaths',
        'wrapperFiles',
        'brokenWrapperFiles',
        'removableWrapperFiles',
      ],
    },
    {
      label: 'Schema audit',
      fields: [
        'staticTables',
        'runtimeCreateTables',
        'runtimeAlterColumns',
        'runtimeIndexes',
        'runtimeUniqueIndexes',
        'dexieLatestVersion',
        'dexieLatestStores',
        'backupTables',
        'foreignKeyDeclarations',
        'relationshipDocRequiredEntities',
        'relationshipDocMissingEntities',
        'backupActionNeededGaps',
        'staticPrimaryKeyGaps',
        'missingRelationshipEntities',
        'backupActionNeededTables',
        'staticPrimaryKeyGapTables',
        'staticPrimaryKeyGapDetails',
        'staticTableNames',
        'runtimeCreateTableNames',
        'runtimeIndexNames',
        'latestDexieStoreNames',
      ],
    },
    {
      label: 'Performance/code-flow scan',
      fields: [
        'sourceFiles',
        'distAssets',
        'totalSourceBytes',
        'totalSourceLines',
        'largestSourceFile',
        'largestSourceLinesFile',
        'largestBuiltChunk',
        'oversizedSourceFiles',
        'oversizedBuiltChunks',
        'topSourceBySize',
        'topSourceByLines',
        'topBuiltChunks',
        'manualNotesPreserved',
        'manualNotesLines',
        'sourceReadMode',
        'sourceReadConcurrency',
        'chunkStatConcurrency',
      ],
    },
    {
      label: 'Language/runtime audit',
      fields: [
        'mode',
        'scanRoots',
        'sourceFiles',
        'fileReadMode',
        'rootWalkMode',
        'rootWalkConcurrency',
        'matrixCheckMode',
        'matrixCheckConcurrency',
        'fileReadConcurrency',
        'languageCounts',
        'extensionCounts',
        'defaults',
        'packagingGate',
        'runtimePolicy',
        'rejectedRuntimeFamilies',
        'verificationMatrix',
        'firstExecutableSlices',
        'proofCommandCoverage',
        'missingProofCommands',
        'focusedTestCoverage',
        'focusedTestCoverageGaps',
        'convertedTypeScriptSlices',
        'convertedTypeScriptCoverageGaps',
        'conversionCandidates',
      ],
    },
    {
      label: 'Docker release guardrail',
      fields: [
        'requiredFiles',
        'missingRequiredFiles',
        'releaseWrappers',
        'retiredArtifactsPresent',
        'dockerignoreRequiredEntries',
        'dockerignoreCoverageMissing',
        'gitignoreRequiredEntries',
        'gitignoreCoverageMissing',
        'pruneRequiredEntries',
        'pruneCoverageMissing',
        'unsafeDockerPruneTokensPresent',
        'dockerSafePruneFlagInAutomation',
        'fullAutomationPolicyPrune',
        'dockerSafePrunePolicy',
        'postStartDiagnosticsCoverage',
        'cloudflareRuntimeCoverage',
        'testDataCleanupCoverage',
        'policyParseError',
      ],
    },
    {
      label: 'Runtime dependency guardrail',
      fields: [
        'appVersion',
        'backendVersion',
        'frontendVersion',
        'opsVersion',
        'versionConsistency',
        'requiredFrontendDeps',
        'missingFrontendDeps',
        'missingLockDeps',
        'forbiddenTrackedConfigsPresent',
        'runtimeVersionGuardCoverage',
        'localVerificationCoverage',
      ],
    },
  ]
  if (cycles.length <= 1) {
    return { checked: false, stable: true, comparisons: [], drift: [] }
  }
  const comparisons = []
  const drift = []
  for (const spec of specs) {
    const results = collectParsedByCycle(cycles, spec.label)
    if (results.length !== cycles.length) continue
    for (const field of spec.fields) {
      const values = results.map((result) => ({
        cycle: result.cycle,
        value: comparableValue(result.parsedOutput?.[field], { label: spec.label, field }),
      }))
      const firstValue = values[0]?.value
      const stable = values.every((entry) => entry.value === firstValue)
      const comparison = { label: spec.label, field, stable, values }
      comparisons.push(comparison)
      if (!stable) drift.push(comparison)
    }
  }
  return { checked: true, stable: drift.length === 0, comparisons, drift }
}

function buildSummary(cycles, repeat) {
  const results = flattenCycles(cycles)
  const failures = results.filter((result) => result.status !== 0)
  const repeatConsistency = buildRepeatConsistency(cycles)
  const durationSummary = buildDurationSummary(results)
  return {
    generatedAt: new Date().toISOString(),
    report: normalizePath(path.relative(ROOT_DIR, REPORT_PATH)),
    summary: normalizePath(path.relative(ROOT_DIR, SUMMARY_PATH)),
    policy: normalizePath(path.relative(ROOT_DIR, POLICY_PATH)),
    mode: 'non-mutating',
    executionMode: EXECUTION_MODE,
    referenceWriterConcurrency: REFERENCE_WRITER_CONCURRENCY,
    parallelCheckConcurrency: PARALLEL_CHECK_CONCURRENCY,
    verboseChildOutput: false,
    repeat,
    cycles: cycles.length,
    checks: results.length,
    failures: failures.length + repeatConsistency.drift.length,
    failedChecks: [
      ...failures.map((result) => result.label),
      ...repeatConsistency.drift.map((comparison) => `Repeat drift: ${comparison.label} ${comparison.field}`),
    ],
    durationSummary,
    repeatConsistency,
    results: results.map((result) => ({
      label: result.label,
      status: result.status === 0 ? 'passed' : 'failed',
      exitCode: result.status,
      durationMs: result.durationMs,
      command: result.command,
      reports: result.reports,
      parsedOutput: result.parsedOutput,
      cycle: result.cycle,
    })),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const cycles = []
  const referenceWriterChecks = CHECKS.filter((check) => REFERENCE_WRITER_LABELS.has(check.label))
  const parallelChecks = CHECKS.filter((check) => PARALLEL_CHECK_LABELS.has(check.label))
  const organizationCheck = CHECKS.find((check) => check.label === ORGANIZATION_CHECK_LABEL)
  for (let cycle = 1; cycle <= options.repeat; cycle += 1) {
    const cycleResults = await runCheckGroup(referenceWriterChecks, cycle, options.repeat, options, REFERENCE_WRITER_CONCURRENCY)
    cycleResults.push(...await runCheckGroup(parallelChecks, cycle, options.repeat, options, PARALLEL_CHECK_CONCURRENCY))
    if (organizationCheck) {
      cycleResults.push(...await runCheckGroup([organizationCheck], cycle, options.repeat, options, REFERENCE_WRITER_CONCURRENCY))
    }
    cycles.push({
      cycle,
      results: cycleResults,
    })
  }
  const summary = buildSummary(cycles, options.repeat)
  summary.verboseChildOutput = options.verbose
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await fs.writeFile(REPORT_PATH, await renderReport(cycles, options.repeat), 'utf8')
  await fs.writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    report: summary.report,
    summary: summary.summary,
    checks: summary.checks,
    failures: summary.failures,
    failedChecks: summary.failedChecks,
  }, null, 2))
  if (summary.failures) process.exitCode = 1
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
