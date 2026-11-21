'use strict'
// The stored daily totals are only worth keeping if they are computed by EXACTLY the money kernel the live screens run: the same SQL text and the same JS.
// Design 7.6. Two sides, each with a mutant that must turn this test red.
//
// LIVE SIDE (K1-K11): src/lib/salesAnalytics.ts and every module it imports at run time (minus db.ts) are fingerprinted statement by statement and tied to
// SALES_DAILY_KERNEL_VERSION through scripts/sales-daily-kernel-pin.json. Any change to a kernel statement (one character of a SQL template included)
// fails until the version is bumped and the pin rewritten (--write-pin refuses to do that under the same version). Comment, whitespace and CRLF edits do not.
// The two plan-limit tables are hashed per key the kernel reads (K5-K11): the keys are derived by a scan that refuses every use of a limit table it does not recognise.
// CRON SIDE (C1-C5): the cron, its seam and the totals module hold no second copy of the kernel: they read no kernel table, copy no kernel SQL text and no
// kernel statement, and reach salesAnalytics only through the seam (lib/salesDailyKernel.ts). The only way a payload is produced is kernel.computeDays, and
// what the kernel returns is what is stored, byte for byte (D1, D2).
// Kernel status at this commit: the seam is NOT wired (getSalesDailyKernel() is null); when it is, the same checks apply to the wired seam.
//
// Run (from cloudflare/): node scripts/test-sales-daily-kernel-fingerprint-pure.cjs
// The walker (static imports, dynamic import(), re-exports) is unit-tested by K0, independent of the pin.
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
  const problems = [...(now.refusals || [])]
  const version = F.currentVersion(overrides)
  if (pin.version !== version) problems.push(`pin is for version ${pin.version}, SALES_DAILY_KERNEL_VERSION is ${version}`)
  const entry = pin.history.find((h) => h.version === version)
  if (!entry) problems.push(`no history entry for version ${version}`)
  else if (entry.aggregate !== pin.aggregate) problems.push('history aggregate differs from the pinned aggregate')
  problems.push(...F.diff(pin, now))
  if (pin.aggregate !== now.aggregate && !problems.length) problems.push('aggregate differs')
  return problems
}

// ---------- plan-limit mutant helpers (AST based, so a mutant cannot hit the other table or a comment) ----------
const PLAN = 'src/lib/planTier.ts'
const TABLES = ['PAID_LIMITS', 'FREE_LIMITS']
function tableObject(sf, table) {
  for (const st of sf.statements) if (ts.isVariableStatement(st) && st.declarationList.declarations[0].name.getText(sf) === table) return st.declarationList.declarations[0]
  throw new Error(`no table ${table}`)
}
function props(text, table) {
  const sf = ts.createSourceFile('planTier.ts', text, ts.ScriptTarget.ES2022, true)
  return { sf, obj: tableObject(sf, table).initializer, list: tableObject(sf, table).initializer.properties.map((p) => ({ key: p.name.getText(sf), start: p.getStart(sf), end: p.getEnd(), initStart: p.initializer.getStart(sf), initEnd: p.initializer.getEnd() })) }
}
const splice = (text, start, end, insert) => text.slice(0, start) + insert + text.slice(end)
function tableProp(text, table, key) {
  const found = props(text, table).list.find((p) => p.key === key)
  if (!found) throw new Error(`no ${table}.${key}`)
  return { ...found, init: text.slice(found.initStart, found.initEnd) }
}
const setProp = (text, table, key, initText) => { const p = tableProp(text, table, key); return splice(text, p.initStart, p.initEnd, initText) }
function dropProp(text, table, key) { const p = tableProp(text, table, key); return splice(text, p.start, text[p.end] === ',' ? p.end + 1 : p.end, '') }
function addProp(text, table, propText) {
  const last = props(text, table).list.at(-1)
  return text[last.end] === ',' ? splice(text, last.end + 1, last.end + 1, `\n  ${propText},`) : splice(text, last.end, last.end, `,\n  ${propText}`)
}
function mapProps(text, table, skipKeys, change) {
  let out = text
  for (const p of props(text, table).list.slice().reverse()) if (!skipKeys.includes(p.key)) out = splice(out, p.initStart, p.initEnd, change(text.slice(p.initStart, p.initEnd)))
  return out
}
const bump = (init) => (/^(true|false)$/.test(init) ? (init === 'true' ? 'false' : 'true') : /^['"`]/.test(init) ? `${init.slice(0, -1)}Z${init.slice(-1)}` : `(${init}) + 1`)
const bothTables = (text, change) => TABLES.reduce((acc, t) => change(acc, t), text)
const planWith = (edit) => withText(PLAN, edit)
const sourceWith = (rel, edit) => withText(rel, edit)

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
  await check('K0 the module walker follows static imports, string-literal dynamic import() and both re-export forms, transitively; type-only edges and computed imports are not edges (and a walker blind to dynamic imports, or to re-exports, fails this)', () => {
    const E = F.ENTRY
    const fixture = new Map([
      [E, `import { a } from './fxStatic'
import type { T } from './fxTypeOnly'
export * from './fxStar'
export { r } from './fxNamed'
export type { U } from './fxTypeExport'
export async function f(n: string) { const m = await import('./fxDynamic'); return import('./fx' + n) }
`],
      ['src/lib/fxStatic.ts', 'export const a = 1'],
      ['src/lib/fxStar.ts', "export const s = 1"],
      ['src/lib/fxNamed.ts', "export const r = 1; export const deep = () => import('./fxDeepDynamic')"],
      ['src/lib/fxDynamic.ts', "export * from './fxDeepReexport'"],
      ['src/lib/fxDeepDynamic.ts', 'export const d = 1'],
      ['src/lib/fxDeepReexport.ts', 'export const e = 1'],
      ['src/lib/fxTypeOnly.ts', 'export type T = 1'],
      ['src/lib/fxTypeExport.ts', 'export type U = 1'],
    ])
    const names = (opts) => Object.keys(F.fingerprint(fixture, opts).files).sort()
    const want = ['src/lib/fxDeepDynamic.ts', 'src/lib/fxDeepReexport.ts', 'src/lib/fxDynamic.ts', 'src/lib/fxNamed.ts', 'src/lib/fxStar.ts', 'src/lib/fxStatic.ts', E].sort()
    assert.deepEqual(names(), want)
    assert.deepEqual(F.relativeImports(fixture.get(E), E).sort(), ['src/lib/fxDynamic', 'src/lib/fxNamed', 'src/lib/fxStar', 'src/lib/fxStatic'])
    assert.notDeepEqual(names({ dynamic: false }), want, 'MUTANT: a walker that ignores dynamic imports')
    assert.ok(!names({ dynamic: false }).includes('src/lib/fxDynamic.ts'))
    assert.notDeepEqual(names({ reexports: false }), want, 'MUTANT: a walker that ignores re-exports')
    assert.ok(!names({ reexports: false }).includes('src/lib/fxStar.ts') && !names({ reexports: false }).includes('src/lib/fxNamed.ts'))
    // the real tree: the dynamic edge of salesAnalytics (the legacy/atomic switch) and what it imports are in the kernel
    const real = Object.keys(F.fingerprint(new Map()).files)
    for (const f of ['src/lib/reportAtomicSwitch.ts', 'src/lib/analytics.ts', 'src/lib/planTier.ts', 'src/lib/readSwitches.ts']) assert.ok(real.includes(f), f)
  })

  await check('K1 the live kernel (every file of the closure, every statement) matches the pin for the version in force, and the history entry agrees', () => {
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
    const now = F.currentVersion(new Map())
    const bumped = liveProblems(withText(F.VERSION_FILE, (t) => t.replace(`SALES_DAILY_KERNEL_VERSION = ${now}`, `SALES_DAILY_KERNEL_VERSION = ${now + 1}`)))
    assert.ok(bumped.some((p) => p.includes(`pin is for version ${now}, SALES_DAILY_KERNEL_VERSION is ${now + 1}`)), bumped.join('\n'))
    // the writer refuses to re-pin a changed kernel under the version already pinned
    const pinSource = fs.readFileSync(F.PIN_FILE, 'utf8')
    const harness = fs.readFileSync(path.join(__dirname, 'harness/sales-daily-kernel-fingerprint.cjs'), 'utf8')
    assert.ok(/REFUSED: the kernel changed/.test(harness) && /prior\.aggregate !== now\.aggregate/.test(harness))
    assert.ok(pinSource.endsWith('\n'), 'the pin ends with a newline')
    const harmless = liveProblems(withText('src/lib/salesAnalytics.ts', (t) => `// a new comment\n${t.replace(/\r\n/g, '\n').replace('export function saleStatusExpr', '/* more */\nexport   function   saleStatusExpr').replace(/\n/g, '\r\n')}`))
    assert.deepEqual(harmless, [], 'comments, spacing and CRLF do not move a hash')
  })

  const READ = 'src/lib/readSwitches.ts'
  const IMPORT_PLAN = "import { getPlanLimits } from './planTier'\n"
  const refusedLine = (problems, file, reason) => problems.some((p) => new RegExp(`^${file.replace(/\./g, '\\.')}:\\d+: refused: ${reason}`).test(p))
  const pinKeys = () => Object.keys(F.readPin().files[PLAN].decls).map((n) => /^const PAID_LIMITS\.(.+)$/.exec(n)).filter(Boolean).map((m) => m[1]).sort()
  const MINI_PLAN = "export type PlanLimits = { tier: string }\nconst PAID_LIMITS: PlanLimits = { tier: 'paid' }\nconst FREE_LIMITS: PlanLimits = { tier: 'free' }\nexport const PLAN_LIMITS_BY_TIER: Record<PlanTier, PlanLimits> = { paid: PAID_LIMITS, free: FREE_LIMITS }\nexport function getPlanLimits(env: Env): PlanLimits { return PLAN_LIMITS_BY_TIER[resolvePlanTier(env)] }\n"

  await check('K5 the limit-read scan on fixtures: getPlanLimits(env).key is the one counted read, every other use of a limit table is refused (a scan that refuses nothing, or a hand list, fails this)', () => {
    const scan = (body, rel = 'src/lib/fxRead.ts', head = IMPORT_PLAN) => F.limitReads(head + body, rel)
    const counted = [
      ['direct (case 1)', 'export const a = (env: Env) => getPlanLimits(env).notificationSectionCacheSeconds', ['notificationSectionCacheSeconds']],
      ['optional chain (case 2)', 'export const a = (env: Env) => getPlanLimits(env)?.x', ['x']],
    ]
    for (const [name, body, keys] of counted) { const r = scan(body); assert.deepEqual(r.keys.map((k) => k.key), keys, name); assert.deepEqual(r.refusals, [], name) }
    const planRead = F.limitReads(`${MINI_PLAN}export function f(env: Env) { return getPlanLimits(env).a }\n`, PLAN)
    assert.deepEqual([planRead.keys.map((k) => k.key), planRead.refusals], [['a'], []], 'case 17: a read inside planTier is counted')
    const clean = F.limitReads(MINI_PLAN, PLAN)
    assert.deepEqual([clean.keys, clean.refusals], [[], []], 'planTier own structure is the allowed positions')
    const refused = [
      ['destructuring (3)', 'export const a = (env: Env) => { const { x } = getPlanLimits(env); return x }', 'getPlanLimits used other than as getPlanLimits\\(env\\)\\.key'],
      ['alias variable (4)', 'export const a = (env: Env) => { const l = getPlanLimits(env); return l.x }', 'getPlanLimits used other than'],
      ['helper (5)', 'export const a = (env: Env) => helper(getPlanLimits(env))', 'getPlanLimits used other than'],
      ['Reflect.get (5)', "export const a = (env: Env) => Reflect.get(getPlanLimits(env), 'x')", 'getPlanLimits used other than'],
      ['Object.values (5)', 'export const a = (env: Env) => Object.values(getPlanLimits(env))', 'getPlanLimits used other than'],
      ['JSON.stringify (5)', 'export const a = (env: Env) => JSON.stringify(getPlanLimits(env))', 'getPlanLimits used other than'],
      ['spread (6)', 'export const a = (env: Env) => ({ ...getPlanLimits(env) })', 'getPlanLimits used other than'],
      ['element access, variable (7)', 'export const a = (env: Env, k: string) => getPlanLimits(env)[k]', 'getPlanLimits used other than'],
      ['element access, literal (7)', "export const a = (env: Env) => getPlanLimits(env)['x']", 'getPlanLimits used other than'],
      ['aliased import (8)', "export const a = (env: Env) => g(env).x", 'aliased import getPlanLimits', "import { getPlanLimits as g } from './planTier'\n"],
      ['namespace import (9)', 'export const a = (env: Env, k: string) => P[k](env).x', 'default or namespace import of planTier', "import * as P from './planTier'\n"],
      ['default import (9)', 'export const a = (env: Env, k: string) => P[k](env).x', 'default or namespace import of planTier', "import P from './planTier'\n"],
      ['dynamic import (10)', "export const a = async () => (await import('./planTier')).getPlanLimits", 'dynamic import of planTier', ''],
      ['named re-export (11)', "export { getPlanLimits } from './planTier'", 're-exports planTier', ''],
      ['star re-export (11)', "export * from './planTier'", 're-exports planTier', ''],
      ['passed as a value (12)', 'export const a = () => run(getPlanLimits)', 'getPlanLimits used other than'],
      ['exported as a value (12)', 'export const g = getPlanLimits', 'getPlanLimits used other than'],
      ['.call (12)', 'export const a = (env: Env) => getPlanLimits.call(null, env).x', 'getPlanLimits used other than'],
      ['assignment (13)', 'export const a = (env: Env) => { getPlanLimits(env).x = 1 }', 'writes getPlanLimits\\(\\.\\.\\.\\)\\.x'],
      ['compound assignment (13)', 'export const a = (env: Env) => { getPlanLimits(env).x += 1 }', 'writes getPlanLimits\\(\\.\\.\\.\\)\\.x'],
      ['increment (13)', 'export const a = (env: Env) => { getPlanLimits(env).x++ }', 'writes getPlanLimits\\(\\.\\.\\.\\)\\.x'],
      ['delete (13)', 'export const a = (env: Env) => { delete getPlanLimits(env).x }', 'writes getPlanLimits\\(\\.\\.\\.\\)\\.x'],
      ['PlanLimits as a parameter type (14)', 'export function f(l: PlanLimits) { return l.x }', 'PlanLimits used other than', "import type { PlanLimits } from './planTier'\n"],
      ['PlanLimits import (14)', 'export const a = 1', 'imports PlanLimits', "import type { PlanLimits } from './planTier'\n"],
      ['PLAN_LIMITS_BY_TIER import (15)', 'export const a = 1', 'imports PLAN_LIMITS_BY_TIER', "import { PLAN_LIMITS_BY_TIER } from './planTier'\n"],
      ['PAID_LIMITS import (15)', 'export const a = 1', 'imports PAID_LIMITS', "import { PAID_LIMITS } from './planTier'\n"],
    ]
    for (const [name, body, reason, head] of refused) {
      const r = scan(body, 'src/lib/fxRead.ts', head === undefined ? IMPORT_PLAN : head)
      assert.ok(r.refusals.some((l) => new RegExp(`^src/lib/fxRead\\.ts:\\d+: refused: ${reason}`).test(l)), `${name}: ${JSON.stringify(r)}`)
      assert.deepEqual(r.keys, [], `${name}: no key is counted from a refused form`)
    }
    const used = F.limitReads(`${MINI_PLAN}export function f() { return PAID_LIMITS.a }\n`, PLAN)
    assert.ok(refusedLine(used.refusals, PLAN, 'PAID_LIMITS used outside its place'), `case 16: ${JSON.stringify(used)}`)
    const line45 = read(READ).split(/\r?\n/).find((l) => l.includes('getPlanLimits(env).readSwitchMemoSeconds'))
    assert.ok(line45, 'the real read is still there')
    const real = F.limitReads(IMPORT_PLAN + line45, 'src/lib/readSwitches.ts')
    assert.deepEqual([real.keys.map((k) => k.key), real.refusals], [['readSwitchMemoSeconds'], []], 'positive control: the real line')
    const broken = F.limitReads(`${IMPORT_PLAN}export const readSwitchMemoMs = (env: Env): number => { const { readSwitchMemoSeconds } = getPlanLimits(env); return readSwitchMemoSeconds * 1000 }`, 'src/lib/readSwitches.ts')
    assert.ok(broken.refusals.length === 1 && broken.keys.length === 0, 'negative control: the same read by destructuring is refused')
  })

  const fp0 = F.fingerprint(new Map())
  await check('K6 the real tree: the kernel reads exactly the keys the pin hashes (one today, readSwitchMemoSeconds), nothing is refused, and the pin holds the two tables per key', () => {
    assert.deepEqual(fp0.refusals, [])
    assert.deepEqual([...fp0.limitKeys].sort(), pinKeys(), 'the derived keys are the pin entries')
    assert.ok(fp0.limitKeys.includes('readSwitchMemoSeconds'), 'positive control')
    assert.ok(fp0.limitReads.some((r) => r.key === 'readSwitchMemoSeconds' && r.line.includes('getPlanLimits(env).readSwitchMemoSeconds')), JSON.stringify(fp0.limitReads))
    const names = Object.keys(F.readPin().files[PLAN].decls).sort()
    const want = ['const PAID_LIMITS', 'const FREE_LIMITS', ...fp0.limitKeys.flatMap((k) => [`const PAID_LIMITS.${k}`, `const FREE_LIMITS.${k}`]), 'const PLAN_LIMITS_BY_TIER', 'const cachedTier', 'function resolvePlanTier', 'function getPlanLimits', 'function freePlanRefusalSuffix', 'function __resetPlanTierCacheForTests'].sort()
    assert.deepEqual(names, want)
    assert.ok(!names.some((n) => n.includes('notificationSectionCacheSeconds')), 'the bell lifetime is not hashed')
  })

  await check('K7 MUTANT (limits the kernel does not read): the bell lifetime, every other unread key, an added key and a dropped key all leave the pin green', () => {
    const unread = Object.keys(props(read(PLAN), 'PAID_LIMITS').list.reduce((a, p) => ({ ...a, [p.key]: 1 }), {})).filter((k) => !fp0.limitKeys.includes(k))
    assert.ok(unread.length > 70 && unread.includes('notificationSectionCacheSeconds') && unread.includes('tier'), 'the controls are among the unread keys')
    const cases = {
      'bell lifetime 245 -> 246 in both tables': (t) => bothTables(t, (x, table) => setProp(x, table, 'notificationSectionCacheSeconds', '246')),
      'every unread key changed in both tables': (t) => bothTables(t, (x, table) => mapProps(x, table, fp0.limitKeys, bump)),
      'an added unread key in both tables': (t) => bothTables(t, (x, table) => addProp(x, table, 'aNewUnreadLimit: 1')),
      'catalogListWindowPages dropped from FREE': (t) => dropProp(t, 'FREE_LIMITS', 'catalogListWindowPages'),
    }
    for (const [name, edit] of Object.entries(cases)) {
      const problems = liveProblems(planWith(edit))
      assert.deepEqual(problems, [], `${name}: ${problems.join('\n')}`)
      console.log(`  K7 green: ${name}`)
    }
  })

  await check('K8 MUTANT (each limit the kernel reads): changing or dropping it in either table is red, with a line naming the key (and not the whole table)', () => {
    assert.ok(fp0.limitKeys.length >= 1, 'no vacuous loop')
    for (const key of fp0.limitKeys) for (const table of TABLES) {
      const named = `${PLAN}: const ${table}.${key} CHANGED`
      for (const [how, edit] of [['changed', (t) => setProp(t, table, key, `(${tableProp(t, table, key).init}) + 1`)], ['dropped', (t) => dropProp(t, table, key)]]) {
        const problems = liveProblems(planWith(edit))
        assert.ok(problems.includes(named), `${key} ${how} in ${table}: ${problems.join('\n')}`)
        assert.ok(!problems.includes(`${PLAN}: const ${table} CHANGED`), `${key} ${how}: the shape is untouched`)
        console.log(`  K8 red: ${key} ${how} in ${table} -> ${named}`)
      }
    }
  })

  await check('K9 MUTANT (kernel code reads a new unhashed limit): written directly it is hashed from then on, and every other form is refused (never pinnable)', () => {
    const KEY = 'notificationSectionCacheSeconds'
    const readsDirect = (t) => `${t}\nexport const bellMs = (env: Env): number => getPlanLimits(env).${KEY} * 1000\n`
    const direct = sourceWith(READ, readsDirect)
    const problems = liveProblems(direct)
    for (const table of TABLES) assert.ok(problems.includes(`${PLAN}: const ${table}.${KEY} ADDED`), problems.join('\n'))
    console.log(`  K9 red (direct): ${problems.filter((p) => p.includes(KEY)).join(' | ')}`)
    const repinned = new Map([...direct, ...planWith((t) => bothTables(t, (x, table) => setProp(x, table, KEY, `(${tableProp(x, table, KEY).init}) + 1`)))])
    assert.deepEqual(F.diff(F.fingerprint(direct), F.fingerprint(repinned)).sort(), TABLES.map((table) => `${PLAN}: const ${table}.${KEY} CHANGED`).sort(), 're-pinned, the new key is guarded for good (a hand list would give an empty diff)')
    const forms = [
      ['destructuring', READ, (t) => `${t}\nexport const m = (env: Env) => { const { ${KEY} } = getPlanLimits(env); return ${KEY} }\n`, 'getPlanLimits used other than'],
      ['helper', READ, (t) => `${t}\nconst memoOf = (l: unknown) => l\nexport const m = (env: Env) => memoOf(getPlanLimits(env))\n`, 'getPlanLimits used other than'],
      ['spread', READ, (t) => `${t}\nexport const m = (env: Env) => ({ ...getPlanLimits(env) })\n`, 'getPlanLimits used other than'],
      ['alias variable', READ, (t) => `${t}\nexport const m = (env: Env) => { const l = getPlanLimits(env); return l.${KEY} }\n`, 'getPlanLimits used other than'],
      ['element access', READ, (t) => `${t}\nexport const m = (env: Env) => getPlanLimits(env)['${KEY}']\n`, 'getPlanLimits used other than'],
      ['namespace import', READ, (t) => `import * as P from './planTier'\n${t}\nexport const m = (env: Env) => P.getPlanLimits(env).${KEY}\n`, 'default or namespace import of planTier'],
      ['re-export from salesAnalytics', F.ENTRY, (t) => `${t}\nexport { getPlanLimits } from './planTier'\n`, 're-exports planTier'],
    ]
    for (const [name, rel, edit, reason] of forms) {
      const got = liveProblems(sourceWith(rel, edit))
      assert.ok(refusedLine(got, rel, reason), `${name}: ${got.join('\n')}`)
      console.log(`  K9 refused (${name}): ${got.find((p) => p.includes(': refused: '))}`)
    }
  })

  await check('K10 the writer: a refusal is never pinned, a changed kernel is never pinned under the same version, and a bump appends one history entry without touching the old ones', () => {
    const pin = F.readPin()
    const version = pin.version
    const refusedNow = F.fingerprint(sourceWith(READ, (t) => `${t}\nexport const m = (env: Env) => { const { x } = getPlanLimits(env); return x }\n`))
    assert.ok(refusedNow.refusals.length > 0)
    const a = F.pinWrite(pin, refusedNow, version + 1)
    assert.ok(a.refused && /refused/i.test(a.refused), 'a refusal blocks even with a bump')
    const changed = F.fingerprint(planWith((t) => setProp(t, 'PAID_LIMITS', 'readSwitchMemoSeconds', '99')))
    const b = F.pinWrite(pin, changed, version)
    assert.ok(b.refused && /REFUSED: the kernel changed/.test(b.refused), 'same version, changed aggregate')
    const c = F.pinWrite(pin, changed, version + 1)
    assert.equal(c.refused, null)
    assert.equal(JSON.stringify(c.pin.history.slice(0, pin.history.length)), JSON.stringify(pin.history), 'old history is byte-identical')
    assert.deepEqual(c.pin.history.slice(pin.history.length), [{ version: version + 1, aggregate: changed.aggregate }])
    assert.equal(c.pin.version, version + 1)
  })

  await check('K11 MUTANT (planTier own structure): a new reader of a table, a spread, a computed or duplicate key, a non-constant unread value, let, and an as-wrapper are refused; a getPlanLimits read there is counted; export changes the shape entry', () => {
    const refusals = (edit) => F.fingerprint(planWith(edit)).refusals
    const cases = [
      ['new function reading PAID_LIMITS', (t) => `${t}\nexport function leak(): number { return PAID_LIMITS.readSwitchMemoSeconds }\n`, 'PAID_LIMITS used outside its place'],
      ['FREE_LIMITS spreading PAID_LIMITS', (t) => t.replace(/(const FREE_LIMITS: PlanLimits = \{\r?\n)/, '$1  ...PAID_LIMITS,\n'), 'FREE_LIMITS: property .* is not a plain name: value'],
      ['computed key', (t) => addProp(t, 'PAID_LIMITS', '[k]: 1'), 'PAID_LIMITS: property .* is not a plain name: value'],
      ['duplicate key', (t) => addProp(t, 'FREE_LIMITS', 'catalogListWindowPages: 9'), 'FREE_LIMITS\\.catalogListWindowPages appears twice'],
      ['unread value not a constant', (t) => setProp(t, 'FREE_LIMITS', 'catalogListWindowPages', 'Date.now()'), 'FREE_LIMITS\\.catalogListWindowPages is not a constant'],
      ['const -> let', (t) => t.replace('const PAID_LIMITS:', 'let PAID_LIMITS:'), 'PAID_LIMITS is not a single const with an object literal'],
      ['as-wrapper', (t) => { const sf = ts.createSourceFile('p.ts', t, ts.ScriptTarget.ES2022, true); const end = tableObject(sf, 'PAID_LIMITS').initializer.getEnd(); return splice(t, end, end, ' as PlanLimits') }, 'PAID_LIMITS is not a single const with an object literal'],
    ]
    for (const [name, edit, reason] of cases) {
      assert.ok(refusedLine(refusals(edit), PLAN, reason), `${name}: ${refusals(edit).join('\n')}`)
      console.log(`  K11 refused (${name})`)
    }
    const counted = liveProblems(planWith((t) => `${t}\nexport function windowOf(env: Env): number { return getPlanLimits(env).catalogListWindowPages }\n`))
    for (const table of TABLES) assert.ok(counted.includes(`${PLAN}: const ${table}.catalogListWindowPages ADDED`), counted.join('\n'))
    assert.ok(!counted.some((p) => p.includes(': refused: ')))
    const exported = liveProblems(planWith((t) => t.replace('const PAID_LIMITS:', 'export const PAID_LIMITS:')))
    assert.ok(exported.includes(`${PLAN}: const PAID_LIMITS CHANGED`), exported.join('\n'))
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
