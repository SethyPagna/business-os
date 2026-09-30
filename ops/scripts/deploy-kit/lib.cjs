'use strict'
// Pure helpers for the owner-run release kit (run\release.bat) and the
// GitHub Actions deploy workflow. Nothing in this file touches the network,
// the disk or a child process, so cloudflare/scripts/test-deploy-kit-pure.cjs
// can check every rule offline.
//
// The one rule this file exists to hold: every command that reads or changes
// PRODUCTION is declared here, in commandCatalog(), with a confirmation gate,
// and exec.cjs refuses to run a production command without a matching
// approval (assertApproved).

const path = require('path')

const DEFAULT_REF = 'claude/urgent-20260925'
const DEFAULT_SITE = 'https://admin.leangbeauty.com'
const WORKER_NAME = 'business-os'
const CERT_DIR_NAME = 'certs'

// Both production D1 databases, with the npm script that applies each one's
// migrations (cloudflare/package.json) and its migrations folder
// (cloudflare/wrangler.toml migrations_dir).
const DATABASES = [
  { name: 'business-os', migrationsDir: 'migrations', applyScript: 'migrate:remote' },
  { name: 'business-os-import', migrationsDir: 'migrations-import', applyScript: 'migrate:import:remote' },
]

// Real table names, all created in cloudflare/migrations/0001_init.sql.
const KEY_TABLES = [
  'products', 'branch_stock', 'product_batches', 'sales', 'sale_items',
  'inventory_movements', 'customers', 'returns',
]
// Tables a live shop writes to during a release (the till keeps selling).
const LIVE_TRAFFIC_TABLES = new Set(['sales', 'sale_items', 'inventory_movements', 'customers', 'returns', 'branch_stock', 'product_batches'])

// Every npm script the kit (and the workflow) calls, per package.
const NPM_SCRIPTS_USED = {
  cloudflare: ['typecheck', 'deploy', 'deploy:free', 'migrate:remote', 'migrate:import:remote'],
  frontend: ['typecheck', 'verify:i18n', 'build'],
}
// Every wrangler sub-command the kit calls.
const WRANGLER_SUBCOMMANDS_USED = [
  ['whoami'],
  ['d1', 'time-travel', 'info'],
  ['d1', 'time-travel', 'restore'],
  ['d1', 'migrations', 'list'],
  ['d1', 'execute'],
  ['deployments', 'status'],
  ['versions', 'view'],
  ['rollback'],
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const GATE_RANK = { none: 0, confirm: 1, typeYES: 2, double: 3 }

// The test files the release runs, each in its own process, at the exact
// commit. frontend/tests/runTestChain.ts discovers *.test.ts AND *.test.cjs,
// so both are listed here: a .ts-only pattern silently skipped every
// .test.cjs file, the transfer regression tests among them.
const GATE_TEST_FILES = {
  cloudflare: { dir: 'cloudflare/scripts', re: /^cloudflare\/scripts\/test-[^/]+\.cjs$/, label: 'cloudflare scripts/test-*.cjs' },
  frontend: { dir: 'frontend/tests', re: /^frontend\/tests\/[^/]+\.test\.(?:ts|cjs)$/, label: 'frontend tests/*.test.{ts,cjs}' },
}

// ---------------------------------------------------------------- arguments

const FLAG_ALIASES = {
  dryrun: 'dryRun', 'dry-run': 'dryRun',
  plan: 'plan', ref: 'ref', records: 'records', worktree: 'worktree',
  'auth-from': 'authFrom', authfrom: 'authFrom', site: 'site', jobs: 'jobs',
  retries: 'retries', ci: 'ci', 'release-dir': 'releaseDir', releasedir: 'releaseDir',
  'use-cert': 'useCert', usecert: 'useCert', 'no-apply': 'noApply', noapply: 'noApply',
  target: 'target', db: 'db', bookmark: 'bookmark', 'version-id': 'versionId', versionid: 'versionId',
  help: 'help', h: 'help',
}
const BOOLEAN_FLAGS = new Set(['dryRun', 'ci', 'useCert', 'noApply', 'help'])

// Accepts both PowerShell style (-DryRun, -Plan free) and GNU style
// (--dry-run, --plan=free). The first bare word is the command.
function parseArgs(argv) {
  const out = { command: '', _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const raw = String(argv[i])
    const m = /^--?([A-Za-z][A-Za-z-]*)(?:=(.*))?$/.exec(raw)
    if (!m) {
      if (!out.command) out.command = raw.toLowerCase()
      else out._.push(raw)
      continue
    }
    const key = FLAG_ALIASES[m[1].toLowerCase()]
    if (!key) throw new Error(`Unknown option ${raw}`)
    if (BOOLEAN_FLAGS.has(key)) {
      out[key] = m[2] == null ? true : !/^(0|false|no)$/i.test(m[2])
    } else {
      const value = m[2] != null ? m[2] : argv[i + 1]
      if (m[2] == null) i += 1
      if (value == null) throw new Error(`Option ${raw} needs a value`)
      out[key] = value
    }
  }
  if (out.plan && !['paid', 'free'].includes(String(out.plan).toLowerCase())) {
    throw new Error(`-Plan must be paid or free, not ${out.plan}`)
  }
  if (out.plan) out.plan = String(out.plan).toLowerCase()
  return out
}

// ------------------------------------------------------- command catalogue

function wrangler(id, args, gate, extra = {}) {
  return { id, kind: 'wrangler', args, gate, ...extra }
}
function npm(id, pkg, script, gate, extra = {}) {
  return { id, kind: 'npm', pkg, script, args: ['run', script], gate, ...extra }
}

// One row, one column per table, each a scalar sub-count. D1's SQLite caps
// compound SELECTs at a few terms, so one UNION ALL term per table failed with
// "too many terms in compound SELECT" once the list grew past that cap.
function countsSql(tables = KEY_TABLES) {
  return `SELECT ${tables.map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(', ')}`
}

// Every production command the kit can run. Parameters are filled in by the
// caller; the gate is fixed here and cannot be lowered by a caller.
const commandCatalog = {
  whoami: () => wrangler('whoami', ['whoami'], 'none'),
  timeTravelInfo: (db) => wrangler(`time-travel-info:${db}`, ['d1', 'time-travel', 'info', db, '--json'], 'confirm'),
  // Reads the Cloudflare account's Workers subscription (read-only); see account-plan.cjs.
  accountPlan: () => ({ id: 'account-plan', kind: 'kit-node', file: 'account-plan.cjs', args: ['account-plan'], gate: 'confirm' }),
  versionView: (versionId) => {
    if (!UUID_RE.test(String(versionId))) throw new Error(`Not a Worker version id: ${versionId}`)
    return wrangler(`version-view:${versionId}`, ['versions', 'view', versionId, '--name', WORKER_NAME, '--json'], 'confirm')
  },
  deploymentStatus: () => wrangler('deployments-status', ['deployments', 'status', '--json'], 'confirm'),
  counts: () => wrangler('counts', ['d1', 'execute', 'business-os', '--remote', '--json', '--command', countsSql()], 'confirm'),
  migrationsList: (db) => wrangler(`migrations-list:${db}`, ['d1', 'migrations', 'list', db, '--remote'], 'confirm'),
  migrationsApply: (db) => {
    const entry = DATABASES.find((d) => d.name === db)
    if (!entry) throw new Error(`Unknown database ${db}`)
    return npm(`migrations-apply:${db}`, 'cloudflare', entry.applyScript, 'typeYES')
  },
  deploy: (plan) => npm(`deploy:${plan}`, 'cloudflare', plan === 'free' ? 'deploy:free' : 'deploy', 'typeYES'),
  rollbackWorker: (versionId, ci = false) => wrangler('rollback-worker', [
    'rollback', ...(versionId ? [versionId] : []), '--name', WORKER_NAME,
    '--message', 'Rollback from the release kit', ...(ci ? ['--yes'] : []),
  ], 'double'),
  restoreDatabase: (db, bookmark) => {
    if (!DATABASES.some((d) => d.name === db)) throw new Error(`Unknown database ${db}`)
    if (!bookmark) throw new Error('A bookmark is required to restore a database')
    return wrangler(`restore:${db}`, ['d1', 'time-travel', 'restore', db, '--bookmark', bookmark], 'double')
  },
  fullAutomationBat: () => ({ id: 'full-automation-bat', kind: 'bat', args: ['full-automation.bat'], gate: 'typeYES' }),
}

// One instance of every catalogue entry, for the offline test.
function sampleCatalog() {
  return [
    commandCatalog.whoami(),
    ...DATABASES.map((d) => commandCatalog.timeTravelInfo(d.name)),
    commandCatalog.deploymentStatus(),
    commandCatalog.accountPlan(),
    commandCatalog.versionView('00000000-0000-4000-8000-000000000000'),
    commandCatalog.counts(),
    ...DATABASES.map((d) => commandCatalog.migrationsList(d.name)),
    ...DATABASES.map((d) => commandCatalog.migrationsApply(d.name)),
    commandCatalog.deploy('paid'),
    commandCatalog.deploy('free'),
    commandCatalog.rollbackWorker(''),
    commandCatalog.rollbackWorker('00000000-0000-0000-0000-000000000000', true),
    ...DATABASES.map((d) => commandCatalog.restoreDatabase(d.name, 'sample-bookmark')),
    commandCatalog.fullAutomationBat(),
  ]
}

const PRODUCTION_WORDS = new Set([
  '--remote', 'deploy', 'deploy:free', 'deploy:full', 'deploy:full:free', 'rollback', 'restore', 'apply',
  'migrate:remote', 'migrate:import:remote', 'secret', 'secrets:sync', 'r2', 'deployments',
  'time-travel', 'full-automation.bat', 'd1:shell:remote', 'versions', 'triggers', 'account-plan',
])

// True when a command reads or changes production. Deliberately broad: a
// false positive only costs one extra confirmation.
function isProductionSpec(spec) {
  if (!spec) return false
  const words = [...(spec.args || []), spec.script || ''].map(String)
  return words.some((w) => PRODUCTION_WORDS.has(w) || /--remote\b/.test(w) || /^(deploy|migrate:.*remote|secrets?)/.test(w))
}

function assertApproved(spec, approval) {
  if (!isProductionSpec(spec)) return true
  const need = GATE_RANK[spec.gate]
  if (!need) throw new Error(`Refusing ${spec.id}: it touches production but has no confirmation gate`)
  if (!approval || approval.ok !== true) throw new Error(`Refusing ${spec.id}: not confirmed`)
  if ((GATE_RANK[approval.gate] || 0) < need) {
    throw new Error(`Refusing ${spec.id}: needs a "${spec.gate}" confirmation, got "${approval.gate}"`)
  }
  return true
}

// -------------------------------------------------------- challenge check

function lowerHeaders(headers) {
  const out = {}
  if (!headers) return out
  const entries = typeof headers.entries === 'function' ? [...headers.entries()] : Object.entries(headers)
  for (const [k, v] of entries) out[String(k).toLowerCase()] = String(v)
  return out
}

// 'challenge' | 'ok' | 'error'. A challenge is Cloudflare's bot check ("Just a
// moment..."), which a script cannot and must not get past.
function classifyResponse(res) {
  if (!res) return 'error'
  const headers = lowerHeaders(res.headers)
  const body = String(res.body || '')
  const status = Number(res.status) || 0
  if ((headers['cf-mitigated'] || '').toLowerCase().includes('challenge')) return 'challenge'
  const isHtml = /text\/html/i.test(headers['content-type'] || '') || /^\s*<!doctype html|^\s*<html/i.test(body)
  if (isHtml && /Just a moment\.\.\.|_cf_chl_opt|\/cdn-cgi\/challenge-platform\/|cf-browser-verification|Attention Required! \| Cloudflare/i.test(body)) {
    return 'challenge'
  }
  if (status >= 200 && status < 400) return 'ok'
  return 'error'
}

// ------------------------------------------------------------- migrations

function parseMigrationNames(text) {
  const seen = new Set()
  const out = []
  for (const m of String(text || '').matchAll(/\b(\d{4}_[A-Za-z0-9_.-]+?\.sql)\b/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]) }
  }
  return out
}

function firstCommentLine(sql) {
  for (const line of String(sql || '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('--')) {
      const text = t.replace(/^-+\s*/, '').trim()
      if (/[A-Za-z0-9]/.test(text)) return text
      continue
    }
    return ''
  }
  return ''
}

function tablesTouched(sql) {
  const out = new Set()
  const re = /\b(?:ALTER\s+TABLE|INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+["`[]?([A-Za-z_][A-Za-z0-9_]*)/gi
  const stripped = String(sql || '').replace(/--[^\n]*/g, '')
  for (const m of stripped.matchAll(re)) out.add(m[1].toLowerCase())
  return out
}

// ------------------------------------------------------------------ counts

function parseWranglerJson(text) {
  const s = String(text || '')
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '[' && s[i] !== '{') continue
    try { return JSON.parse(s.slice(i)) } catch { /* keep scanning */ }
  }
  return null
}

function findKey(value, key) {
  if (!value || typeof value !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key]
  for (const v of Object.values(value)) {
    const found = findKey(v, key)
    if (found !== undefined) return found
  }
  return undefined
}

// `wrangler deployments status --json` describes the live DEPLOYMENT: its own
// `id` comes first and the Worker version(s) it serves sit under versions[].
// A rollback needs the version id, so take the version with the most traffic.
function liveVersionId(json) {
  const versions = findKey(json, 'versions')
  if (!Array.isArray(versions)) return ''
  const top = versions
    .filter((v) => v && typeof v.version_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.version_id))
    .sort((a, b) => Number(b.percentage || 0) - Number(a.percentage || 0))[0]
  return top ? top.version_id : ''
}

// The single row countsSql returns; null unless every table has a count.
function parseCounts(json, tables = KEY_TABLES) {
  const rows = findKey(json, 'results')
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') return null
  const out = {}
  for (const t of tables) {
    const n = rows[0][t] == null ? NaN : Number(rows[0][t])
    if (!Number.isFinite(n)) return null
    out[t] = n
  }
  return out
}

// Post-release counts must equal pre-release counts, except tables the
// migrations change on purpose (warning) and tables the live shop writes to
// while the release runs (warning when they only grew). A table that lost
// rows without a migration touching it is a failure.
function compareCounts(pre, post, touched = new Set()) {
  const rows = []
  for (const table of KEY_TABLES) {
    const a = pre ? pre[table] : undefined
    const b = post ? post[table] : undefined
    let verdict
    if (a == null || b == null) verdict = 'MISSING'
    else if (a === b) verdict = 'same'
    else if (touched.has(table)) verdict = 'changed-by-migration'
    else if (b > a && LIVE_TRAFFIC_TABLES.has(table)) verdict = 'grew-live-traffic'
    else verdict = 'UNEXPECTED'
    rows.push({ table, pre: a, post: b, verdict })
  }
  const failed = rows.filter((r) => r.verdict === 'UNEXPECTED' || r.verdict === 'MISSING')
  const warnings = rows.filter((r) => r.verdict === 'changed-by-migration' || r.verdict === 'grew-live-traffic')
  return { rows, ok: failed.length === 0, failed, warnings }
}

// Row counts are business numbers, and the repository's Actions logs and job
// summaries are public: under CI a table shows its verdict and, when it
// changed, by how much -- never its size. The kit keeps the full numbers in
// its records folder for the before/after comparison.
function countsLines(rows, { ci = false } = {}) {
  if (ci) return rows.map((r) => `  ${r.table.padEnd(20)} ${r.verdict ? `${r.verdict}${r.pre !== r.post ? ` (${countChange(r, { ci })})` : ''}` : 'counted'}`).join('\n')
  return rows.map((r) => `  ${r.table.padEnd(20)} ${String(r.pre ?? '-').padStart(9)} ${String(r.post ?? '').padStart(9)}  ${r.verdict || ''}`).join('\n')
}

function countChange(row, { ci = false } = {}) {
  if (!ci) return `${row.pre ?? '-'} -> ${row.post ?? '-'}`
  if (row.pre == null || row.post == null) return 'not read'
  const d = row.post - row.pre
  return `${d > 0 ? '+' : ''}${d} row${Math.abs(d) === 1 ? '' : 's'}`
}

// ----------------------------------------------------------- live checks

// '' when the reported tier is exactly the plan, else why not.
function checkTier(tier, plan) {
  if (tier == null || tier === '') return `no tier reported, expected ${plan}`
  if (tier !== 'paid' && tier !== 'free') return `invalid tier reported, expected ${plan}`
  if (tier !== plan) return `tier is ${tier}, expected ${plan}`
  return ''
}

function checkVersion(json, sha, plan) {
  const problems = []
  const rev = json && typeof json.revision === 'string' ? json.revision : ''
  if (!rev) problems.push('no revision reported')
  else if (rev.endsWith('-dirty')) problems.push(`revision ${rev} is a DIRTY build`)
  else if (!sha.toLowerCase().startsWith(rev.toLowerCase().slice(0, 12)) || rev.length < 7) problems.push(`revision ${rev} is not ${sha.slice(0, 12)}`)
  if (plan) {
    const problem = checkTier(json && json.tier, plan)
    if (problem) problems.push(problem)
  }
  return { ok: problems.length === 0, problems, revision: rev }
}

// ------------------------------------------------- free and paid, never mixed

// A plan is only ever chosen, never assumed: '' unless the value is exactly paid or free.
function explicitPlan(value) {
  return value === 'paid' || value === 'free' ? value : ''
}

// The plan of a Worker version, from the vars stored with it (the same PLAN_TIER
// the running Worker reports at /api/runtime/version). Returned verbatim, or ''
// when the version carries no plain-text PLAN_TIER.
function versionTier(json) {
  const bindings = json && json.resources && json.resources.bindings
  if (!Array.isArray(bindings)) return ''
  const hit = bindings.find((b) => b && b.type === 'plain_text' && b.name === 'PLAN_TIER' && typeof b.text === 'string')
  return hit ? hit.text : ''
}

// The account's Workers plan from GET /accounts/{id}/subscriptions. Only a live
// Workers subscription names a plan; every other answer is 'unknown', because a
// deploy must never guess the plan.
const DEAD_SUBSCRIPTION_STATES = /^(cancelled|canceled|expired|failed|awaitingpayment)$/i
function classifyWorkersPlan(json) {
  if (!json || typeof json !== 'object') return { plan: 'unknown', reason: 'the subscription answer was not JSON' }
  if (json.success === false) return { plan: 'unknown', reason: 'the Cloudflare API reported an error reading the subscription' }
  if (!Array.isArray(json.result)) return { plan: 'unknown', reason: 'the subscription answer had no list of subscriptions' }
  const label = (sub) => `${(sub.rate_plan && sub.rate_plan.id) || ''} ${(sub.rate_plan && sub.rate_plan.public_name) || ''}`
  const live = json.result.filter((sub) => sub && typeof sub === 'object' && !DEAD_SUBSCRIPTION_STATES.test(String(sub.state || '')) && /workers/i.test(label(sub)))
  const paid = live.some((sub) => /paid|standard|unlimited|bundled/i.test(label(sub)))
  const free = live.some((sub) => /free/i.test(label(sub)))
  if (paid && free) return { plan: 'unknown', reason: 'the account lists both a Workers Paid and a Workers Free subscription' }
  if (paid) return { plan: 'paid', reason: 'a live Workers Paid subscription' }
  if (free) return { plan: 'free', reason: 'a live Workers Free subscription' }
  return { plan: 'unknown', reason: 'the account lists no live Workers subscription' }
}

// The profile being deployed must be the plan the account is really on.
function checkAccountPlan(profile, reading) {
  const plan = reading && reading.plan
  if (plan !== 'paid' && plan !== 'free') {
    const why = reading && reading.reason ? `: ${reading.reason}` : ''
    return { ok: false, problem: `the account's Workers plan could not be read${why}. A release is not published until it is known.` }
  }
  if (plan !== profile) return { ok: false, problem: `the account is on the ${plan} plan but this release uses the ${profile} profile. Choose the ${plan} profile, or change the plan in Cloudflare first.` }
  return { ok: true, problem: '' }
}

// May the Worker be rolled back to `target`? Each argument is 'paid', 'free' or
// '' (could not be read). A version carries PLAN_TIER, but the queue consumers'
// batch sizes are set at deploy time and do not roll back with it.
function rollbackPlanVerdict({ target, live, account }) {
  const known = (p) => p === 'paid' || p === 'free'
  if (!known(target)) return { level: 'warn', message: 'the plan of the version to roll back to could not be read, so it cannot be compared with the account. Check it in the Cloudflare dashboard before trusting the result.' }
  if (known(account)) {
    if (target !== account) return { level: 'refuse', message: `the version to roll back to uses the ${target} profile but the account is on the ${account} plan. Deploy the ${account} profile instead.` }
    if (known(live) && live !== target) return { level: 'warn', message: `the live Worker is on the ${live} profile and the rollback target on the ${target} profile: the code follows the account's ${account} plan, but the queue consumer settings stay on the ${live} profile until a ${target} deploy.` }
    return { level: 'ok', message: '' }
  }
  if (known(live)) {
    if (target !== live) return { level: 'refuse', message: `the version to roll back to uses the ${target} profile but the live Worker uses the ${live} profile, and the account plan could not be read. Deploy the right profile instead of rolling back across profiles.` }
    return { level: 'ok', message: '' }
  }
  return { level: 'warn', message: 'neither the live Worker plan nor the account plan could be read, so the rollback target cannot be compared. Check the plan in the Cloudflare dashboard.' }
}

// ---------------------------------------------------------- places, certs

function recordDirName(date, sha) {
  return `${date}-${String(sha).slice(0, 12)}`
}

function certFileName(sha) {
  return `release-cert-${sha}.txt`
}

// A certificate is valid only when its name AND its content carry the exact
// full 40-character sha on a `sha: <sha>` line.
function certMatches(content, sha) {
  if (!/^[0-9a-f]{40}$/i.test(String(sha))) return false
  const m = /^\s*sha:\s*([0-9a-f]{40})\s*$/im.exec(String(content || ''))
  return !!m && m[1].toLowerCase() === String(sha).toLowerCase()
}

function samePath(a, b) {
  const norm = (p) => {
    const r = path.resolve(String(p)).replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? r.toLowerCase().replace(/\//g, '\\') : r
  }
  return norm(a) === norm(b)
}

// Why a folder must not be used as the release folder, or '' when it may.
function forbiddenReleasePath(target, { protectedPaths = [], branchWorktrees = [] } = {}) {
  if (!target) return 'no release folder given'
  if (/(^|[\\/])recovery([\\/]|$)/i.test(String(target)) || /recovery/i.test(path.basename(String(target)))) {
    return 'it is a recovery checkout'
  }
  for (const p of protectedPaths) if (p && samePath(p, target)) return `it is a working checkout (${p})`
  for (const p of branchWorktrees) if (p && samePath(p, target)) return 'it is a worktree with a branch checked out (somebody works in it)'
  return ''
}

function todayStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

module.exports = {
  DEFAULT_REF, DEFAULT_SITE, WORKER_NAME, CERT_DIR_NAME,
  DATABASES, KEY_TABLES, LIVE_TRAFFIC_TABLES, NPM_SCRIPTS_USED, WRANGLER_SUBCOMMANDS_USED, GATE_RANK, GATE_TEST_FILES,
  parseArgs, commandCatalog, sampleCatalog, countsSql, isProductionSpec, assertApproved,
  classifyResponse, lowerHeaders, parseMigrationNames, firstCommentLine, tablesTouched,
  parseWranglerJson, findKey, liveVersionId, parseCounts, compareCounts, countsLines, countChange, checkVersion, checkTier,
  explicitPlan, versionTier, classifyWorkersPlan, checkAccountPlan, rollbackPlanVerdict,
  recordDirName, certFileName, certMatches, samePath, forbiddenReleasePath, todayStamp,
}
