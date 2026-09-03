// The PLAN matrix: every number, on both tiers, in one place.
//
// test-plan-tier-pure.cjs covers how the tier is RESOLVED (the env read, the
// isolate cache, the paid-by-default asymmetry) and pins the ten fields whose
// values come from recorded project history. This file covers the table
// ITSELF, now that it is what every plan-sensitive consumer reads:
//
//   1. Both tiers pinned field by field, completely. A limit that changes
//      value changes an operator's behaviour (how often they split a stock
//      file, how many passes an import takes), so it must never change
//      silently as a side effect of an unrelated edit.
//   2. paid >= free for EVERY limit. This is the invariant the whole section
//      rests on -- "Paid uses its headroom, Free degrades" is only true if
//      no field is accidentally larger on Free. A plain per-field pin would
//      not catch a swapped pair, since both numbers would still be
//      individually "expected".
//   3. The notice list, exactly. It is derived by diffing the two tiers, so
//      pinning it pins the derivation as well as the values -- and pins the
//      deliberate NON-notices (R2, the two image budgets, the plan-
//      independent D1/SQLite facts, which are equal on both tiers on
//      purpose).
//   4. wrangler.toml and wrangler.free.toml differ ONLY where they are meant
//      to: [limits], the queue consumers' max_batch_size, and PLAN_TIER.
//      The two files are otherwise a copy of each other, and a change made
//      to one and not the other -- a new binding, a changed route, a rotated
//      id -- is a deploy that behaves differently for reasons nobody
//      intended. Parsed, not regex-scanned: a regex over a whole config file
//      cannot tell a real assignment from the same text inside a comment,
//      and several of these stanzas' comments quote the very numbers under
//      test.
//   5. quotaGuard.ts really reads the table. It is the one consumer whose
//      behaviour changes on PAID (its ceilings used to be Free's on both
//      plans), so this proves the wiring rather than trusting the diff.
//
// Run: node scripts/test-plan-tier-matrix-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

// ---------------------------------------------------------------------------
// 1 + 2. the table
// ---------------------------------------------------------------------------

const EXPECTED_PAID = {
  tier: 'paid',
  rowsPerImportChunk: 600,
  preflightMaxRows: 500,
  stockActionMaxUnits: 480,
  stockActionMaxRows: 1920,
  maxAssetsPerBackup: 100,
  maxImageDeletesPerReset: 500,
  materializeRowsPerChunk: 600,
  d1BatchChunkStatements: 300,
  stockActionClassifyWindow: 480,
  stockActionDispatchRead: 400,
  stockActionAddConcurrency: 12,
  historicalSalesImportConcurrency: 12,
  backupTablePageSize: 500,
  backupRestoreRowsPerBatch: 80,
  maxImagesPerImportRequest: 200,
  kvWritesPerDay: 33_333,
  r2ClassAPerMonth: 1_000_000,
  imagesTransformsPerMonth: 5_000,
  cloudinaryTransformsPerMonth: 25_000,
  cpuMsPerInvocation: 300_000,
  subrequestsPerInvocation: 10_000,
  d1MaxBoundParams: 100,
  d1MaxSqlLengthBytes: 100_000,
  importQueueMaxBatchSize: 5,
  longAiImagePassesEnabled: true,
  d1DailyRowsReadCeiling: 833_000_000,
  d1DailyRowsWrittenCeiling: 1_666_000,
}

const EXPECTED_FREE = {
  tier: 'free',
  rowsPerImportChunk: 150,
  preflightMaxRows: 125,
  stockActionMaxUnits: 60,
  stockActionMaxRows: 480,
  maxAssetsPerBackup: 20,
  maxImageDeletesPerReset: 200,
  materializeRowsPerChunk: 100,
  d1BatchChunkStatements: 100,
  stockActionClassifyWindow: 120,
  stockActionDispatchRead: 100,
  stockActionAddConcurrency: 4,
  historicalSalesImportConcurrency: 4,
  backupTablePageSize: 200,
  backupRestoreRowsPerBatch: 40,
  maxImagesPerImportRequest: 40,
  kvWritesPerDay: 1_000,
  r2ClassAPerMonth: 1_000_000,
  imagesTransformsPerMonth: 5_000,
  cloudinaryTransformsPerMonth: 25_000,
  cpuMsPerInvocation: 10,
  subrequestsPerInvocation: 1_000,
  d1MaxBoundParams: 100,
  d1MaxSqlLengthBytes: 100_000,
  importQueueMaxBatchSize: 1,
  longAiImagePassesEnabled: false,
  d1DailyRowsReadCeiling: 5_000_000,
  d1DailyRowsWrittenCeiling: 100_000,
}

check('every Paid limit, field by field', async () => {
  const { PLAN_LIMITS_BY_TIER } = await loadPlanTier()
  assert.deepEqual(PLAN_LIMITS_BY_TIER.paid, EXPECTED_PAID)
})

check('every Free limit, field by field', async () => {
  const { PLAN_LIMITS_BY_TIER } = await loadPlanTier()
  assert.deepEqual(PLAN_LIMITS_BY_TIER.free, EXPECTED_FREE)
})

check('paid >= free for every limit -- no field is bigger on Free', async () => {
  const { PLAN_LIMITS_BY_TIER } = await loadPlanTier()
  const { paid, free } = PLAN_LIMITS_BY_TIER
  const offenders = []
  for (const key of Object.keys(paid)) {
    if (key === 'tier') continue
    const p = paid[key]
    const f = free[key]
    assert.equal(typeof p, typeof f, `${key} must have the same type on both tiers`)
    if (typeof p === 'number' && f > p) offenders.push(`${key}: free ${f} > paid ${p}`)
    // A capability ON for Free and OFF for Paid would be the same defect in
    // boolean form -- Free running work Paid refuses.
    if (typeof p === 'boolean' && f && !p) offenders.push(`${key}: enabled on free, disabled on paid`)
  }
  assert.deepEqual(offenders, [])
})

check('the table carries only numbers and booleans (plus tier)', async () => {
  const { PLAN_LIMITS_BY_TIER } = await loadPlanTier()
  for (const [tier, limits] of Object.entries(PLAN_LIMITS_BY_TIER)) {
    for (const [key, value] of Object.entries(limits)) {
      if (key === 'tier') { assert.equal(value, tier); continue }
      assert.ok(
        (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean',
        `${tier}.${key} is ${typeof value}; the notice diff and GET /api/system/plan both assume number|boolean`,
      )
    }
  }
})

// ---------------------------------------------------------------------------
// 3. the notices
// ---------------------------------------------------------------------------

const EXPECTED_FREE_NOTICES = [
  { id: 'rowsPerImportChunk', kind: 'smaller', free: 150, paid: 600 },
  { id: 'preflightMaxRows', kind: 'smaller', free: 125, paid: 500 },
  { id: 'stockActionMaxUnits', kind: 'smaller', free: 60, paid: 480 },
  { id: 'stockActionMaxRows', kind: 'smaller', free: 480, paid: 1920 },
  { id: 'maxAssetsPerBackup', kind: 'smaller', free: 20, paid: 100 },
  { id: 'maxImageDeletesPerReset', kind: 'smaller', free: 200, paid: 500 },
  { id: 'materializeRowsPerChunk', kind: 'smaller', free: 100, paid: 600 },
  { id: 'd1BatchChunkStatements', kind: 'smaller', free: 100, paid: 300 },
  { id: 'stockActionClassifyWindow', kind: 'smaller', free: 120, paid: 480 },
  { id: 'stockActionDispatchRead', kind: 'smaller', free: 100, paid: 400 },
  { id: 'stockActionAddConcurrency', kind: 'smaller', free: 4, paid: 12 },
  { id: 'historicalSalesImportConcurrency', kind: 'smaller', free: 4, paid: 12 },
  { id: 'backupTablePageSize', kind: 'smaller', free: 200, paid: 500 },
  { id: 'backupRestoreRowsPerBatch', kind: 'smaller', free: 40, paid: 80 },
  { id: 'maxImagesPerImportRequest', kind: 'smaller', free: 40, paid: 200 },
  { id: 'kvWritesPerDay', kind: 'smaller', free: 1000, paid: 33333 },
  { id: 'cpuMsPerInvocation', kind: 'smaller', free: 10, paid: 300000 },
  { id: 'subrequestsPerInvocation', kind: 'smaller', free: 1000, paid: 10000 },
  { id: 'importQueueMaxBatchSize', kind: 'smaller', free: 1, paid: 5 },
  { id: 'longAiImagePassesEnabled', kind: 'disabled', free: false, paid: true },
  { id: 'd1DailyRowsReadCeiling', kind: 'smaller', free: 5000000, paid: 833000000 },
  { id: 'd1DailyRowsWrittenCeiling', kind: 'smaller', free: 100000, paid: 1666000 },
]

check('Paid reports no notices -- it is the baseline, not a degradation', async () => {
  const { getPlanNotices } = await loadPlanTier()
  assert.deepEqual(getPlanNotices('paid'), [])
})

check('Free reports exactly the ceilings that shrank, with both numbers', async () => {
  const { getPlanNotices } = await loadPlanTier()
  assert.deepEqual(getPlanNotices('free'), EXPECTED_FREE_NOTICES)
})

check('the fields deliberately EQUAL on both tiers produce no notice', async () => {
  const { getPlanNotices } = await loadPlanTier()
  const reported = new Set(getPlanNotices('free').map((n) => n.id))
  // R2 and the two image services bill independently of the Workers plan;
  // the D1/SQLite facts are properties of the engine, not the plan. Claiming
  // any of them as a Free degradation would be a lie in the admin panel.
  for (const key of ['r2ClassAPerMonth', 'imagesTransformsPerMonth', 'cloudinaryTransformsPerMonth', 'd1MaxBoundParams', 'd1MaxSqlLengthBytes']) {
    assert.ok(key in EXPECTED_PAID, `${key} left the table -- update this list`)
    assert.equal(EXPECTED_PAID[key], EXPECTED_FREE[key], `${key} is no longer equal on both tiers`)
    assert.ok(!reported.has(key), `${key} must not be reported as a Free degradation`)
  }
})

check('the notice list is derived, not hand-written -- it matches a fresh diff', async () => {
  const { PLAN_LIMITS_BY_TIER, getPlanNotices } = await loadPlanTier()
  const { paid, free } = PLAN_LIMITS_BY_TIER
  const derived = []
  for (const key of Object.keys(paid)) {
    if (key === 'tier') continue
    if (typeof paid[key] === 'number' && free[key] < paid[key]) derived.push(key)
    if (typeof paid[key] === 'boolean' && paid[key] && !free[key]) derived.push(key)
  }
  assert.deepEqual(getPlanNotices('free').map((n) => n.id), derived)
})

// ---------------------------------------------------------------------------
// 4. the two wrangler configs
// ---------------------------------------------------------------------------

// A minimal TOML reader for exactly the grammar these two files use:
// [table], [[array of tables]] with dotted names, key = value where value is
// a quoted string, an integer (with optional _ separators), a boolean, or an
// array of strings / inline tables. It is deliberately STRICT -- anything it
// does not recognise throws, so this can never silently skip a line and call
// two configs identical because it failed to read the part that differs.
// (No TOML parser is installed in this package, and adding a dependency for
// one test is not worth it; wrangler carries its own, bundled and unreachable.)
function parseToml(text) {
  const root = {}
  let current = root
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    let line = stripComment(lines[i]).trim()
    if (!line) continue

    const arrayTable = /^\[\[([A-Za-z0-9_.-]+)\]\]$/.exec(line)
    if (arrayTable) {
      current = pushArrayTable(root, arrayTable[1].split('.'))
      continue
    }
    const table = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line)
    if (table) {
      current = descend(root, table[1].split('.'))
      continue
    }

    const assignment = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line)
    if (!assignment) throw new Error(`line ${i + 1}: not a table header or assignment: ${line}`)
    let raw = assignment[2]
    // Multi-line arrays: keep consuming until the brackets balance.
    while (bracketDepth(raw) > 0) {
      i += 1
      if (i >= lines.length) throw new Error(`unterminated array starting at line ${i}`)
      raw += ' ' + stripComment(lines[i]).trim()
    }
    if (assignment[1] in current) throw new Error(`line ${i + 1}: duplicate key ${assignment[1]}`)
    current[assignment[1]] = parseValue(raw.trim(), i + 1)
  }
  return root
}

// A '#' inside a quoted string is not a comment. Nothing here uses escaped
// quotes, and the parser throws on anything it cannot read, so a simple
// quote-aware scan is enough and cannot silently mis-read.
function stripComment(line) {
  let inString = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') inString = !inString
    else if (ch === '#' && !inString) return line.slice(0, i)
  }
  return line
}

function bracketDepth(text) {
  let depth = 0
  let inString = false
  for (const ch of text) {
    if (ch === '"') inString = !inString
    else if (!inString && (ch === '[' || ch === '{')) depth += 1
    else if (!inString && (ch === ']' || ch === '}')) depth -= 1
  }
  return depth
}

function descend(root, parts) {
  let node = root
  for (const part of parts) {
    if (Array.isArray(node[part])) node = node[part][node[part].length - 1]
    else node = (node[part] = node[part] || {})
  }
  return node
}

function pushArrayTable(root, parts) {
  const leaf = parts[parts.length - 1]
  const parent = descend(root, parts.slice(0, -1))
  if (!Array.isArray(parent[leaf])) parent[leaf] = []
  const entry = {}
  parent[leaf].push(entry)
  return entry
}

function parseValue(raw, lineNumber) {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^"[^"]*"$/.test(raw)) return raw.slice(1, -1)
  if (/^-?\d[\d_]*$/.test(raw)) return Number(raw.replace(/_/g, ''))
  if (raw.startsWith('[') && raw.endsWith(']')) return splitTopLevel(raw.slice(1, -1)).map((item) => parseValue(item, lineNumber))
  if (raw.startsWith('{') && raw.endsWith('}')) {
    const table = {}
    for (const pair of splitTopLevel(raw.slice(1, -1))) {
      const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(pair)
      if (!kv) throw new Error(`line ${lineNumber}: bad inline-table entry: ${pair}`)
      table[kv[1]] = parseValue(kv[2].trim(), lineNumber)
    }
    return table
  }
  throw new Error(`line ${lineNumber}: unsupported value: ${raw}`)
}

function splitTopLevel(body) {
  const parts = []
  let depth = 0
  let inString = false
  let start = 0
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (ch === '"') inString = !inString
    else if (!inString && (ch === '[' || ch === '{')) depth += 1
    else if (!inString && (ch === ']' || ch === '}')) depth -= 1
    else if (ch === ',' && !inString && depth === 0) { parts.push(body.slice(start, i)); start = i + 1 }
  }
  parts.push(body.slice(start))
  return parts.map((part) => part.trim()).filter(Boolean)
}

// Every leaf path where the two documents disagree, including keys present
// in only one of them.
function diffPaths(a, b, prefix = '') {
  const out = []
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
  for (const key of keys) {
    const pathKey = prefix ? `${prefix}.${key}` : key
    const left = a ? a[key] : undefined
    const right = b ? b[key] : undefined
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) { out.push(pathKey); continue }
      for (let i = 0; i < left.length; i += 1) {
        if (isPlainObject(left[i]) && isPlainObject(right[i])) out.push(...diffPaths(left[i], right[i], `${pathKey}[${i}]`))
        else if (JSON.stringify(left[i]) !== JSON.stringify(right[i])) out.push(`${pathKey}[${i}]`)
      }
      continue
    }
    if (isPlainObject(left) && isPlainObject(right)) { out.push(...diffPaths(left, right, pathKey)); continue }
    if (left !== right) out.push(pathKey)
  }
  return out.sort()
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readToml(name) {
  return parseToml(fs.readFileSync(path.join(cloudflareRoot, name), 'utf8'))
}

check('the parser reads the grammar these configs actually use', async () => {
  // Guard the guard: if this reader silently returned {} the diff below would
  // pass with the two files wildly out of sync.
  const paid = readToml('wrangler.toml')
  assert.equal(paid.name, 'business-os')
  assert.equal(paid.workers_dev, false)
  assert.deepEqual(paid.compatibility_flags, ['nodejs_compat'])
  assert.equal(paid.routes.length, 4)
  assert.equal(paid.routes[0].custom_domain, true)
  assert.equal(paid.limits.cpu_ms, 300000)
  assert.equal(paid.limits.subrequests, 10000, 'underscore separators must be read as digits, not text')
  assert.equal(paid.vars.PLAN_TIER, 'paid')
  assert.equal(paid.queues.consumers.length, 4)
  assert.equal(paid.d1_databases.length, 2)
  assert.equal(paid.triggers.crons[0], '0 */6 * * *')
})

check('a comment can never be mistaken for an assignment', async () => {
  const parsed = parseToml([
    '# max_batch_size = 999',
    '[vars]',
    'PLAN_TIER = "free" # was "paid" until the plan changed',
    'URL = "https://example.com/#anchor"',
  ].join('\n'))
  assert.deepEqual(parsed, { vars: { PLAN_TIER: 'free', URL: 'https://example.com/#anchor' } })
})

check('the parser refuses anything it does not understand', async () => {
  assert.throws(() => parseToml('key = 2026-07-01'), /unsupported value/)
  assert.throws(() => parseToml('just some prose'), /not a table header or assignment/)
  assert.throws(() => parseToml('[vars]\nA = "1"\nA = "2"'), /duplicate key/)
})

check('the two configs differ ONLY in [limits], queue max_batch_size and PLAN_TIER', async () => {
  const paid = readToml('wrangler.toml')
  const free = readToml('wrangler.free.toml')
  const differing = diffPaths(paid, free)
  const allowed = (p) => (
    p === 'limits'
    || p.startsWith('limits.')
    || /^queues\.consumers\[\d+\]\.max_batch_size$/.test(p)
    || p === 'vars.PLAN_TIER'
  )
  const unexpected = differing.filter((p) => !allowed(p))
  assert.deepEqual(
    unexpected,
    [],
    `wrangler.toml and wrangler.free.toml have drifted apart at: ${unexpected.join(', ')}`,
  )
  // And the intended differences are all actually THERE -- a free config that
  // quietly grew a [limits] block, or stopped saying PLAN_TIER = "free",
  // would also produce an empty `unexpected` list.
  assert.ok(differing.includes('limits'), '[limits] must be present on paid and absent on free')
  assert.equal(paid.limits.cpu_ms, 300000)
  assert.equal(free.limits, undefined, 'a Free deployment cannot raise cpu_ms -- the block must be absent')
  assert.ok(differing.includes('vars.PLAN_TIER'))
  assert.equal(paid.vars.PLAN_TIER, 'paid')
  assert.equal(free.vars.PLAN_TIER, 'free')
  assert.ok(
    differing.some((p) => /^queues\.consumers\[\d+\]\.max_batch_size$/.test(p)),
    'the free config must lower at least one queue consumer batch size',
  )
})

check('each config\'s import consumer matches the tier it declares', async () => {
  const { PLAN_LIMITS_BY_TIER } = await loadPlanTier()
  for (const [file, tier] of [['wrangler.toml', 'paid'], ['wrangler.free.toml', 'free']]) {
    const parsed = readToml(file)
    assert.equal(parsed.vars.PLAN_TIER, tier)
    const consumer = parsed.queues.consumers.find((c) => c.queue === 'business-os-import')
    assert.ok(consumer, `${file}: no business-os-import consumer`)
    assert.equal(
      consumer.max_batch_size,
      PLAN_LIMITS_BY_TIER[tier].importQueueMaxBatchSize,
      `${file}: planTier.ts's importQueueMaxBatchSize must mirror the real consumer setting`,
    )
  }
})

check('wrangler.toml pins the platform numbers planTier.ts claims for Paid', async () => {
  const { PLAN_LIMITS_BY_TIER } = await loadPlanTier()
  const paid = readToml('wrangler.toml')
  assert.equal(paid.limits.cpu_ms, PLAN_LIMITS_BY_TIER.paid.cpuMsPerInvocation)
  assert.equal(paid.limits.subrequests, PLAN_LIMITS_BY_TIER.paid.subrequestsPerInvocation)
})

// ---------------------------------------------------------------------------
// 5. the consumer whose behaviour changes on PAID
// ---------------------------------------------------------------------------

check('quotaGuard reads its ceilings from the table, on both tiers', async () => {
  const quotaGuard = await loadQuotaGuard()
  // No DB: readQuota fails open and still reports the ceiling, which is the
  // only thing under test here.
  const freeKv = await quotaGuard.readQuota({ DB: null, PLAN_TIER: 'free' }, 'kv_write')
  assert.equal(freeKv.limit, EXPECTED_FREE.kvWritesPerDay, 'Free must still see its 1,000/day wall')
  const { __resetPlanTierCacheForTests } = await loadPlanTier()
  __resetPlanTierCacheForTests()
  const paidKv = await quotaGuard.readQuota({ DB: null, PLAN_TIER: 'paid' }, 'kv_write')
  assert.equal(
    paidKv.limit,
    EXPECTED_PAID.kvWritesPerDay,
    'a Paid deployment used to back image work off at 70% of FREE\'s 1,000 KV writes/day',
  )
  __resetPlanTierCacheForTests()
})

check('quotaGuard keeps no numeric ceiling of its own', async () => {
  const source = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'quotaGuard.ts'), 'utf8')
  const start = source.indexOf('const LIMITS: Record<QuotaResource, QuotaLimit> = {')
  assert.ok(start > -1, 'the LIMITS table should still exist')
  const table = source.slice(start, source.indexOf('\n}', start))
  const entries = [...table.matchAll(/^ {2}([a-z0-9_]+): \{ (.+) \},$/gm)]
  assert.equal(entries.length, 4, 'expected all four tracked resources')
  for (const [, resource, body] of entries) {
    // A digit legitimately appears inside a FIELD NAME (r2ClassAPerMonth,
    // d1...), so the check is that no VALUE in the entry is a number -- i.e.
    // that no ceiling stayed behind when they moved into planTier.ts.
    assert.ok(!/:\s*-?\d/.test(body), `${resource} still hard-codes a number: ${body}`)
    assert.deepEqual(
      [...body.matchAll(/([A-Za-z]+):/g)].map((m) => m[1]),
      ['window', 'tierField'],
      `${resource} must carry only its reset window and the PlanLimits field naming its ceiling`,
    )
  }
})

// ---------------------------------------------------------------------------
// module loading -- same transpile-the-real-thing pattern as the sibling tests
// ---------------------------------------------------------------------------

const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))
const loaded = new Map()
function loadModule(name) {
  if (loaded.has(name)) return loaded.get(name)
  const sourcePath = path.join(cloudflareRoot, 'src', 'lib', name)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: name,
  })
  const moduleObj = { exports: {} }
  const requireShim = (request) => {
    if (request === '../index') return {}
    if (request === './db') return { getDb: (env) => env.DB }
    if (request === './analytics') return { recordAnalytics: () => {} }
    if (request === './planTier') return loadModule('planTier.ts')
    return require(request)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, requireShim, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  loaded.set(name, moduleObj.exports)
  return moduleObj.exports
}

async function loadPlanTier() { return loadModule('planTier.ts') }
async function loadQuotaGuard() { return loadModule('quotaGuard.ts') }

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log('PASS', name)
      passed++
    } catch (e) {
      console.log('FAIL', name, '-', e.message)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}

void main()
