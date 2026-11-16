'use strict'
// The stored daily totals are only worth keeping if they are computed by EXACTLY the money kernel the live screens run: the same SQL text and the same JS.
// Design 7.6. Two sides, each with a mutant that must turn this test red.
//
// LIVE SIDE (K1-K4): src/lib/salesAnalytics.ts and every module it imports at run time (minus db.ts) are fingerprinted statement by statement and tied to
// SALES_DAILY_KERNEL_VERSION through scripts/sales-daily-kernel-pin.json. Any change to a kernel statement (one character of a SQL template included)
// fails until the version is bumped and the pin rewritten (--write-pin refuses to do that under the same version). Comment, whitespace and CRLF edits do not.
// CRON SIDE (C1-C5): the cron, its seam and the totals module hold no second copy of the kernel: they read no kernel table, copy no kernel SQL text and no
// kernel statement, and reach salesAnalytics only through the seam (lib/salesDailyKernel.ts). The only way a payload is produced is kernel.computeDays, and
// what the kernel returns is what is stored, byte for byte (D1, D2).
// Kernel status at this commit: the seam is NOT wired (getSalesDailyKernel() is null); when it is, the same checks apply to the wired seam.
//
// Run (from cloudflare/): node scripts/test-sales-daily-kernel-fingerprint-pure.cjs
// After a deliberate kernel change: bump SALES_DAILY_KERNEL_VERSION, then node scripts/harness/sales-daily-kernel-fingerprint.cjs --write-pin
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const F = require('./harness/sales-daily-kernel-fingerprint.cjs')
const { createWorld } = require('./harness/sales-daily-world.cjs')

let passed = 0
const check = async (name, run) => { await run(); passed += 1; console.log(`PASS ${name}`) }
const read = (rel) => fs.readFileSync(path.join(F.ROOT, rel), 'utf8')
const withText = (rel, edit) => { const before = read(rel); const after = edit(before); assert.notEqual(after, before, `the mutation of ${rel} must change the file`); return new Map([[rel, after]]) }

// ---------- live side ----------
/** Everything wrong with the kernel as given (overrides = mutated sources), as readable lines. Empty = the pin holds. */
function liveProblems(overrides) {
  const pin = F.readPin()
  const now = F.fingerprint(overrides)
  const problems = []
  const version = F.currentVersion(overrides)
  if (pin.version !== version) problems.push(`pin is for version ${pin.version}, SALES_DAILY_KERNEL_VERSION is ${version}`)
  const entry = pin.history.find((h) => h.version === version)
  if (!entry) problems.push(`no history entry for version ${version}`)
  else if (entry.aggregate !== pin.aggregate) problems.push('history aggregate differs from the pinned aggregate')
  problems.push(...F.diff(pin, now))
  if (pin.aggregate !== now.aggregate && !problems.length) problems.push('aggregate differs')
  return problems
}

// ---------- cron side ----------
const CRON_SIDE = ['src/lib/salesDailyCron.ts', 'src/lib/salesDailyKernel.ts', 'src/lib/salesDailyTotals.ts']
const SEAM = 'src/lib/salesDailyKernel.ts'
const KERNEL_TABLES = ['sales', 'sale_items', 'returns', 'return_items', 'fees', 'sale_amendments', 'sale_payment_events', 'sale_item_batch_allocations', 'return_item_batch_allocations', 'customers', 'products', 'categories', 'delivery_contacts', 'branches', 'payment_methods', 'inventory_movements']
const OWN_TABLES = new Set(['sales_daily_totals', 'system_flags'])
// the seed / rebuild statements name `sales` for its business date only; a money, status or label column in the same literal would be a second kernel
const MONEY_WORDS = /\b(total_usd|subtotal_usd|[a-z_]*_usd|[a-z_]*_khr|price|cost|discount|refund|qty|quantity|amount|status|payment_method|cashier|customer_id|product_id)\b/i

// The one accepted second copy: the exact-sum accumulator (SalesDailyExactSum) has a private gcd beside the kernel's. Not a second rule: the accumulator exists
// so a day is summed without the kernel's per-add reduction (CPU on Free), and test-sales-daily-accumulator-pure proves its result equals the kernel's own adds.
const ACCEPTED_SHADOWS = new Map([['src/lib/salesDailyTotals.ts', new Set(['function gcd'])]])

const squash = (text) => text.replace(/\s+/g, ' ').trim()
function literals(text) {
  const sf = ts.createSourceFile('x.ts', text.replace(/\r\n/g, '\n'), ts.ScriptTarget.ES2022, true)
  const out = []
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(squash(node.text))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}
function topLevel(text) {
  const sf = ts.createSourceFile('x.ts', text.replace(/\r\n/g, '\n'), ts.ScriptTarget.ES2022, true)
  return F.fileHashes(text)
}
const kernelFiles = (overrides) => F.fingerprint(overrides)

/** Everything wrong with the cron side, given the (maybe mutated) sources of the cron-side files and of the kernel. */
function cronProblems(overrides) {
  const problems = []
  const kernel = kernelFiles(overrides)
  const kernelLiterals = new Set()
  for (const text of Object.values(kernel.texts)) for (const lit of literals(text)) if (lit.length >= 40 && /[A-Za-z]/.test(lit)) kernelLiterals.add(lit)
  const kernelStatements = new Map()
  for (const [rel, { decls }] of Object.entries(kernel.files)) for (const [name, hash] of Object.entries(decls)) kernelStatements.set(`${name}`, { rel, hash })
  for (const rel of CRON_SIDE) {
    const text = overrides.has(rel) ? overrides.get(rel) : read(rel)
    // (1) tables named by any SQL literal
    for (const lit of literals(text)) {
      for (const m of lit.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)) {
        const table = m[1].toLowerCase()
        if (OWN_TABLES.has(table) || !KERNEL_TABLES.includes(table)) continue
        if (table !== 'sales') problems.push(`${rel}: SQL reads kernel table ${table}`)
        else if (MONEY_WORDS.test(lit)) problems.push(`${rel}: SQL on sales names a money/status column: ${lit.slice(0, 60)}`)
      }
      // (2) a kernel SQL text copied
      if (lit.length >= 40 && kernelLiterals.has(lit)) problems.push(`${rel}: copies a kernel text literal: ${lit.slice(0, 60)}`)
    }
    // (3) a kernel statement copied or shadowed
    for (const [name, hash] of Object.entries(topLevel(text).decls)) {
      const k = kernelStatements.get(name)
      if (k && !(ACCEPTED_SHADOWS.get(rel) || new Set()).has(name)) problems.push(`${rel}: declares ${name}, which the kernel (${k.rel}) already owns${k.hash === hash ? ' (identical copy)' : ''}`)
    }
    // (4) the kernel itself is reached only through the seam
    if (rel !== SEAM && /from\s+['"]\.\/salesAnalytics['"]|import\(\s*['"]\.\/salesAnalytics['"]\s*\)/.test(text)) problems.push(`${rel}: imports salesAnalytics outside the seam`)
  }
  // (5) the seam is the only file that may name the kernel module, and it holds no SQL of its own
  const seam = overrides.has(SEAM) ? overrides.get(SEAM) : read(SEAM)
  for (const lit of literals(seam)) if (/\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*\b(FROM|INTO|SET)\b/i.test(lit)) problems.push(`${SEAM}: carries SQL of its own: ${lit.slice(0, 60)}`)
  return problems
}

async function main() {
  await check('K1 the live kernel (13 files, every statement) matches the pin for the version in force, and the history entry agrees', () => {
    assert.deepEqual(liveProblems(new Map()), [])
    const pin = F.readPin()
    assert.equal(pin.version, F.currentVersion(new Map()))
    assert.ok(Object.keys(pin.files).includes('src/lib/salesAnalytics.ts') && Object.keys(pin.files).includes('src/lib/reportMoneyPrecision.ts'), 'the entry and the exact-decimal module are in the pin')
    assert.ok(!Object.keys(pin.files).includes('src/lib/db.ts'), 'db.ts is the documented exclusion')
    assert.ok(Object.keys(pin.files['src/lib/salesAnalytics.ts'].decls).length > 150, 'salesAnalytics is cut into its statements')
  })

  await check('K2 MUTANT (SQL): one word of a kernel SQL expression changes -> red, naming the statement', () => {
    const problems = liveProblems(withText('src/lib/salesAnalytics.ts', (t) => t.replace("'completed')` }", "'complete')` }")))
    assert.ok(problems.some((p) => /function saleStatusExpr CHANGED/.test(p)), problems.join('\n'))
  })

  await check('K2 MUTANT (JS): one operator in deriveTotals, and one in the exact-decimal module -> red', () => {
    const a = liveProblems(withText('src/lib/salesAnalytics.ts', (t) => t.replace('const discountUsd = storeDiscountUsd + membershipDiscountUsd', 'const discountUsd = storeDiscountUsd - membershipDiscountUsd')))
    assert.ok(a.some((p) => /function deriveTotals CHANGED/.test(p)), a.join('\n'))
    const b = liveProblems(withText('src/lib/moneyPrecision.ts', (t) => t.replace('MAX_MONEY_ABS = 100_000_000_000', 'MAX_MONEY_ABS = 100_000_000_001')))
    assert.ok(b.some((p) => /const MAX_MONEY_ABS CHANGED/.test(p)), b.join('\n'))
  })

  await check('K3 an added statement, a removed statement, a changed import and a new kernel module are all red', () => {
    const added = liveProblems(withText('src/lib/salesAnalytics.ts', (t) => `${t}\nexport function extraKernelRule(): number { return 1 }\n`))
    assert.ok(added.some((p) => /extraKernelRule ADDED/.test(p)), added.join('\n'))
    const removed = liveProblems(withText('src/lib/salesAnalytics.ts', (t) => t.replace(/export function saleStatusExpr\([^\n]*\n/, '')))
    assert.ok(removed.some((p) => /saleStatusExpr REMOVED/.test(p)), removed.join('\n'))
    const imp = liveProblems(withText('src/lib/salesAnalytics.ts', (t) => t.replace("import { validateSaleMoneySnapshot } from './saleMoneyPrecision'", "import { validateSaleMoneySnapshot as validateSaleMoneySnapshot } from './saleMoneyPrecision'")))
    assert.ok(imp.some((p) => /salesAnalytics\.ts: imports changed/.test(p)), imp.join('\n'))
    const joined = liveProblems(new Map([['src/lib/salesAnalytics.ts', `import { x } from './removalLossesNew'\n${read('src/lib/salesAnalytics.ts')}`], ['src/lib/removalLossesNew.ts', 'export const x = 1']]))
    assert.ok(joined.some((p) => /removalLossesNew\.ts: file joined the kernel/.test(p)), joined.join('\n'))
  })

  await check('K4 the version and the pin move together: a bump alone is red, a changed kernel under the same version is red, comments / whitespace / CRLF are not', () => {
    const bumped = liveProblems(withText(F.VERSION_FILE, (t) => t.replace('SALES_DAILY_KERNEL_VERSION = 1', 'SALES_DAILY_KERNEL_VERSION = 2')))
    assert.ok(bumped.some((p) => /pin is for version 1, SALES_DAILY_KERNEL_VERSION is 2/.test(p)), bumped.join('\n'))
    // the writer refuses to re-pin a changed kernel under the version already pinned
    const pinSource = fs.readFileSync(F.PIN_FILE, 'utf8')
    const harness = fs.readFileSync(path.join(__dirname, 'harness/sales-daily-kernel-fingerprint.cjs'), 'utf8')
    assert.ok(/REFUSED: the kernel changed/.test(harness) && /prior\.aggregate !== now\.aggregate/.test(harness))
    assert.ok(pinSource.endsWith('\n'), 'the pin ends with a newline')
    const harmless = liveProblems(withText('src/lib/salesAnalytics.ts', (t) => `// a new comment\n${t.replace(/\r\n/g, '\n').replace('export function saleStatusExpr', '/* more */\nexport   function   saleStatusExpr').replace(/\n/g, '\r\n')}`))
    assert.deepEqual(harmless, [], 'comments, spacing and CRLF do not move a hash')
  })

  await check('C1 the cron side is clean on the real tree: no kernel table, no copied kernel text, no shadowed kernel statement, kernel reached through the seam only', () => {
    assert.deepEqual(cronProblems(new Map()), [])
    for (const rel of CRON_SIDE) assert.ok(fs.existsSync(path.join(F.ROOT, rel)), rel)
  })

  await check('C1b the accepted shadow is exactly one, and its proof exists: the accumulator test compares it with the kernel own ReportExactDecimal adds', () => {
    assert.deepEqual([...ACCEPTED_SHADOWS].map(([file, names]) => [file, [...names]]), [['src/lib/salesDailyTotals.ts', ['function gcd']]])
    const proof = fs.readFileSync(path.join(__dirname, 'test-sales-daily-accumulator-pure.cjs'), 'utf8')
    assert.ok(/ReportExactDecimal/.test(proof) && /random/i.test(proof), 'the accumulator test runs the kernel adds on random days')
    const mutant = cronProblems(withText('src/lib/salesDailyCron.ts', (t) => `${t}
function gcd(a: bigint, b: bigint): bigint { return a }
`))
    assert.ok(mutant.some((p) => /salesDailyCron.ts: declares function gcd/.test(p)), 'the allowance is per file: only the totals module is excused')
  })

  await check('C2 MUTANT (cron SQL): a query of a kernel table or of sales money columns in the cron or the totals module -> red', () => {
    const a = cronProblems(withText('src/lib/salesDailyCron.ts', (t) => `${t}\nconst second = 'SELECT SUM(quantity) FROM sale_items WHERE 1'\n`))
    assert.ok(a.some((p) => /salesDailyCron\.ts: SQL reads kernel table sale_items/.test(p)), a.join('\n'))
    const b = cronProblems(withText('src/lib/salesDailyTotals.ts', (t) => `${t}\nconst second = "SELECT SUM(total_usd) FROM sales WHERE status = 'completed'"\n`))
    assert.ok(b.some((p) => /salesDailyTotals\.ts: SQL on sales names a money/.test(p)), b.join('\n'))
  })

  await check('C3 MUTANT (cron copy): a kernel statement pasted into the seam, and a kernel SQL text pasted into the cron -> red', () => {
    const a = cronProblems(withText(SEAM, (t) => `${t}\nexport function saleStatusExpr(p: string): string { return \`COALESCE(NULLIF(\${p}sale_status, ''), 'completed')\` }\n`))
    assert.ok(a.some((p) => /declares function saleStatusExpr.*identical copy/.test(p)), a.join('\n'))
    const lit = "`CASE WHEN ${p}sale_status = 'cancelled' THEN 0 ELSE ${p}total_usd - ${p}refund_usd END`"
    const realLiteral = [...literals(read('src/lib/salesAnalytics.ts'))].find((l) => l.length >= 60 && /CASE WHEN/.test(l))
    assert.ok(realLiteral, 'the kernel has a long SQL literal to copy')
    const b = cronProblems(withText('src/lib/salesDailyCron.ts', (t) => `${t}\nconst copied = \`${realLiteral.replace(/`/g, '')}\`\n`))
    assert.ok(b.some((p) => /salesDailyCron\.ts: (copies a kernel text literal|SQL)/.test(p)), `${b.join('\n')} ${lit.length}`)
  })

  await check('C4 MUTANT (bypass the seam): the cron or the totals module importing salesAnalytics directly -> red; the seam itself may', () => {
    const a = cronProblems(withText('src/lib/salesDailyCron.ts', (t) => `import { deriveTotals } from './salesAnalytics'\n${t}`))
    assert.ok(a.some((p) => /salesDailyCron\.ts: imports salesAnalytics outside the seam/.test(p)), a.join('\n'))
    const b = cronProblems(withText('src/lib/salesDailyTotals.ts', (t) => `${t}\nexport const lazy = () => import('./salesAnalytics')\n`))
    assert.ok(b.some((p) => /salesDailyTotals\.ts: imports salesAnalytics outside the seam/.test(p)), b.join('\n'))
    const wired = cronProblems(withText(SEAM, (t) => `import { getSalesTotals } from './salesAnalytics'\n${t}`))
    assert.deepEqual(wired, [], 'a seam that imports the kernel is the wiring, not a violation')
  })

  await check('C5 MUTANT (SQL in the seam): the seam carrying SQL of its own -> red', () => {
    const a = cronProblems(withText(SEAM, (t) => `${t}\nexport const own = 'SELECT date(created_at) FROM sales WHERE 1'\n`))
    assert.ok(a.some((p) => /salesDailyKernel\.ts: carries SQL of its own/.test(p)), a.join('\n'))
  })

  const w = createWorld()
  const DAYS = ['2026-11-09', '2026-11-10']
  await check('D1 the only producer of a payload is kernel.computeDays: with no kernel nothing is stored, with one the stored text is exactly its payload, key-sorted', async () => {
    const env = w.fresh(DAYS)
    const none = await w.cron.runSalesDailyRecompute(env, w.dep({ kernel: null }))
    assert.equal(none.skipped, 'kernel-not-wired')
    assert.ok(w.rows().every((r) => r.state === 1 && r.payload === '{}' && r.computed_at === null), 'nothing computed')
    const calls = []
    const kernel = w.kernelOf({ beforeRead: (days) => calls.push(['recompute', ...days]) })
    await w.cron.runSalesDailyRecompute(env, w.dep({ kernel }))
    await w.cron.runSalesDailyRecompute(env, w.dep({ kernel }))
    const expected = w.T.encodeSalesDailyPayload({ v: 1, branches: { 1: { bucket: { money: { revenue: '10' }, counts: { tx: 1 } } } } })
    const stored = w.rows().filter((r) => r.state === 0)
    assert.equal(stored.length, DAYS.length, JSON.stringify(w.rows().map((r) => [r.business_date, r.state])))
    for (const r of stored) assert.equal(r.payload, expected, 'byte for byte the kernel payload')
    assert.deepEqual(calls.map((c) => c.slice(1)).flat().sort(), [...DAYS].sort(), 'each day went through computeDays exactly once')
  })

  await check('D2 the nightly reconcile re-derives through the SAME computeDays and judges a changed kernel answer as a mismatch (it holds no figure of its own)', async () => {
    const env = w.fresh(DAYS)
    for (let i = 0; i < 3; i += 1) await w.cron.runSalesDailyRecompute(env, w.dep())
    const reads = []
    const same = w.kernelOf({ beforeRead: (days) => reads.push(...days) })
    const ok = await w.cron.runSalesDailyReconcile(env, w.dep({ kernel: same, alert: async () => true }))
    assert.deepEqual([ok.compared, ok.matched, ok.mismatched], [DAYS.length, DAYS.length, []])
    assert.deepEqual([...reads].sort(), [...DAYS].sort(), 'the reconcile read every compared day through computeDays')
    const drifted = w.kernelOf({ result: (d, sums) => ({ payload: { v: 1, branches: { 1: { bucket: { money: { revenue: `${sums.t + 1}` }, counts: { tx: sums.n } } } } }, sourceRows: sums.n, refusal: null }) })
    const bad = await w.cron.runSalesDailyReconcile(env, w.dep({ kernel: drifted, alert: async () => true }))
    assert.ok(bad.mismatched && bad.mismatched.length >= 1, 'a kernel that answers differently from the stored day is a mismatch, never a silent heal')
    assert.equal(w.flagsNow().quarantined, true)
  })

  console.log(`${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
