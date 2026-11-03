#!/usr/bin/env node
'use strict'
// One-line verdict for one browser-suite leg of .github/workflows/gate.yml.
//
// Reads the Playwright `json` reporter file and prints what the Gate run's log,
// its annotations and its job summary should say, in the same plain style as the
// "Testing <sha>" line of the safety job. It is information only: it exits 0
// whatever the verdict, because the red or green of the job belongs to the
// Playwright step itself (and the job's continue-on-error decides whether that
// fails the run). A summary that could fail on its own would turn a green leg
// red the day this file has a bug.
//
// Public repository, public Actions logs: only spec file:line and the test
// title are printed, never an assertion message, a URL or any fixture value.
//
//   node e2e-summary.cjs --project <name> --sha <sha> --results <file> [--blocking true|false]
//
// Pure functions are exported for cloudflare/scripts/test-gate-e2e-job-pure.cjs.

const fs = require('fs')

const MAX_LISTED = 25
const ANSI = /\x1b\[[0-9;]*m/g

// Playwright test statuses: expected | unexpected | flaky | skipped. A status
// this file does not know counts as a failure, so a future Playwright cannot
// turn an unreadable result into a green line.
function collect(suite, acc) {
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      const row = { where: `${spec.file}:${spec.line}`, title: String(spec.title || '') }
      if (test.status === 'expected') acc.passed += 1
      else if (test.status === 'skipped') acc.skipped += 1
      else if (test.status === 'flaky') { acc.flaky += 1; acc.flakes.push(row) }
      else { acc.failed += 1; acc.failures.push(row) }
    }
  }
  for (const child of suite.suites || []) collect(child, acc)
}

function firstLine(value) {
  return String(value == null ? '' : value).replace(ANSI, '').split(/\r?\n/).find((l) => l.trim()) || ''
}

function summarize(report) {
  const acc = { passed: 0, failed: 0, flaky: 0, skipped: 0, failures: [], flakes: [], errors: [], durationMs: 0 }
  for (const suite of (report && report.suites) || []) collect(suite, acc)
  // Top-level errors: the fixture server did not start, a spec file did not
  // load, the config is invalid. None of those is a failed test, so without
  // this a leg that ran nothing would read as zero failures.
  acc.errors = ((report && report.errors) || []).map((e) => firstLine(e && (e.message || e.value || e)).slice(0, 200))
  acc.durationMs = Number(report && report.stats && report.stats.duration) || 0
  return acc
}

// RED when anything failed, the harness reported an error, or no test passed at
// all (an empty run must never look green).
function verdictOf(summary) {
  if (!summary) return 'RED'
  return summary.failed > 0 || summary.errors.length > 0 || summary.passed + summary.flaky === 0 ? 'RED' : 'GREEN'
}

function minutes(ms) {
  const total = Math.round(ms / 1000)
  return total >= 60 ? `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s` : `${total}s`
}

// Workflow-command escaping (GitHub: %, CR, LF in data; plus : and , in properties).
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

function listed(rows, label, note = '') {
  const lines = rows.slice(0, MAX_LISTED).map((r) => `  ${label} ${r.where}  ${r.title}${note}`)
  if (rows.length > MAX_LISTED) lines.push(`  ... and ${rows.length - MAX_LISTED} more`)
  return lines
}

// { line, details[], annotation, markdown } for one leg. `summary` null means the
// report file could not be read; `problem` says why.
function format({ project, sha, blocking, summary, problem }) {
  const mode = blocking ? 'blocking' : 'report-only'
  const short = String(sha || '').slice(0, 12) || 'unknown'
  const verdict = verdictOf(summary)
  const head = `Browser suite ${project} @ ${short}`
  let line
  const details = []
  if (!summary) {
    line = `${head}: NO REPORT (${problem || 'the suite did not reach the reporter'}) [${mode}]`
  } else {
    const counts = `${summary.passed} passed, ${summary.failed} failed, ${summary.flaky} flaky, ${summary.skipped} skipped`
    const why = summary.errors.length ? `, ${summary.errors.length} harness error(s)` : summary.passed + summary.flaky === 0 ? ', no test passed' : ''
    line = `${head}: ${verdict} - ${counts}${why} in ${minutes(summary.durationMs)} [${mode}]`
    details.push(...listed(summary.failures, 'FAILED'))
    details.push(...listed(summary.flakes, 'FLAKY ', ' (failed, then passed on retry)'))
    for (const msg of summary.errors) details.push(`  ERROR  ${msg}`)
  }
  let annotation = ''
  if (verdict === 'RED') {
    const level = blocking ? 'error' : 'warning'
    // Parametrised specs share one file:line, so list each place once.
    const names = summary ? [...new Set(summary.failures.map((r) => r.where))].slice(0, 5).join(', ') : ''
    const what = !summary ? 'no report' : summary.failed ? `${summary.failed} failed${names ? `: ${names}` : ''}` : summary.errors.length ? 'harness error' : 'no test passed'
    annotation = `::${level} title=${escapeProperty(`Browser suite ${project} (${mode})`)}::${escapeData(`${project}: ${what}`)}`
  }
  const markdown = [
    `### Browser suite: ${project} - ${summary ? verdict : 'NO REPORT'} (${mode})`,
    '',
    `Commit \`${short}\`. ${summary ? `${summary.passed} passed, ${summary.failed} failed, ${summary.flaky} flaky, ${summary.skipped} skipped in ${minutes(summary.durationMs)}.` : (problem || 'The suite did not reach the reporter.')}`,
    ...(details.length ? ['', '```', ...details, '```'] : []),
    '',
  ].join('\n')
  return { line, details, annotation, markdown, verdict: summary ? verdict : 'RED' }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const m = /^--([a-z]+)$/.exec(String(argv[i]))
    if (m) { out[m[1]] = argv[i + 1]; i += 1 }
  }
  return out
}

function main(argv, env = process.env, say = console.log) {
  const a = parseArgs(argv)
  let summary = null
  let problem = ''
  try {
    summary = summarize(JSON.parse(fs.readFileSync(String(a.results), 'utf8')))
  } catch (err) {
    problem = `no readable report at the expected path: ${err.code || err.name}`
  }
  const out = format({ project: a.project || 'unknown', sha: a.sha, blocking: a.blocking === 'true', summary, problem })
  say(out.line)
  for (const d of out.details) say(d)
  if (out.annotation) say(out.annotation)
  if (env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${out.markdown}\n`) } catch { /* the log line above is the record */ }
  }
  return 0
}

module.exports = { summarize, verdictOf, format, minutes, escapeData, escapeProperty, parseArgs, main, MAX_LISTED }

if (require.main === module) process.exitCode = main(process.argv.slice(2))
