'use strict'
// The stored daily totals are only worth keeping if they are computed by EXACTLY the money kernel the live screens run: the same SQL text and the same JS.
// Design 7.6. Two sides, each with a mutant that must turn this test red.
//
// LIVE SIDE (K1-K17): src/lib/salesAnalytics.ts and every module it imports at run time (minus db.ts) are fingerprinted statement by statement and tied to
// SALES_DAILY_KERNEL_VERSION through scripts/sales-daily-kernel-pin.json. Any change to a kernel statement (one character of a SQL template included)
// fails until the version is bumped and the pin rewritten (--write-pin refuses to do that under the same version). Comment, whitespace and CRLF edits do not.
// The two plan-limit tables are hashed per key the kernel reads (K5-K11): the keys are derived by a scan that refuses every use of a limit table it does not recognise.
// The switch list of readSwitches.ts (KNOWN_READ_SWITCHES) is hashed the same way (K13-K17): its shape plus one entry per switch the kernel reads, so a lane that adds a read switch does not move the fingerprint.
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
  const literal = tableObject(sf, table).initializer.arguments[0]
  return { sf, obj: literal, list: literal.properties.map((p) => ({ key: p.name.getText(sf), start: p.getStart(sf), end: p.getEnd(), initStart: p.initializer.getStart(sf), initEnd: p.initializer.getEnd() })) }
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
    const walked = F.fingerprint(fixture)
    assert.ok(walked.refusals.some((r) => /^src\/lib\/salesAnalytics\.ts:\d+: refused: dynamic import with a computed specifier/.test(r)), `a computed import() in the walk is a refusal, not a silent skip: ${walked.refusals.join('|')}`)
    const hidden = F.fingerprint(new Map([[E, "export async function g() { return import('./sale' + 'X') }"], ['src/lib/saleX.ts', 'export const x = 1']]))
    assert.ok(hidden.refusals.length >= 1 && !('src/lib/saleX.ts' in hidden.files), 'MUTANT: a computed import of a new module is refused, never silently skipped')
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
  const MINI_PLAN = "export type PlanLimits = { tier: string }\nconst PAID_LIMITS: PlanLimits = deepFreeze({ tier: 'paid' })\nconst FREE_LIMITS: PlanLimits = deepFreeze({ tier: 'free' })\nexport const PLAN_LIMITS_BY_TIER: Record<PlanTier, PlanLimits> = deepFreeze({ paid: PAID_LIMITS, free: FREE_LIMITS })\nexport function getPlanLimits(env: Env): PlanLimits { return PLAN_LIMITS_BY_TIER[resolvePlanTier(env)] }\n"

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
      ['computed import, concatenation (M2a)', "export async function bellOf(env: Env): Promise<number> { const m = await import('./plan' + 'Tier'); return (m as any)['getPlanLimits'](env)['notificationSectionCacheSeconds'] }", 'dynamic import with a computed specifier', ''],
      ['computed import, variable', 'export const a = (n: string) => import(n)', 'dynamic import with a computed specifier', ''],
      ['computed import, template with a substitution', 'export const a = (n: string) => import(`./plan${n}`)', 'dynamic import with a computed specifier', ''],
      ['require call', "export const a = () => require('./planTier')", 'require\\(\\) call', ''],
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
    const literalImport = F.limitReads("export const a = async () => import('./reportAtomicSwitch')", 'src/lib/fxRead.ts')
    assert.deepEqual([literalImport.keys, literalImport.refusals], [[], []], 'positive control: the one real dynamic import form (a string literal) stays allowed')
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
    const want = ['const PAID_LIMITS', 'const FREE_LIMITS', ...fp0.limitKeys.flatMap((k) => [`const PAID_LIMITS.${k}`, `const FREE_LIMITS.${k}`]), 'const PLAN_LIMITS_BY_TIER', 'const cachedTier', 'function resolvePlanTier', 'function getPlanLimits', 'function deepFreeze', 'function freePlanRefusalSuffix', 'function __resetPlanTierCacheForTests'].sort()
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
      ['M2a computed import in salesAnalytics', F.ENTRY, (t) => `${t}\nexport async function bellOf(env: Env): Promise<number> { const m = await import('./plan' + 'Tier'); return (m as any)['getPlanLimits'](env)['notificationSectionCacheSeconds'] }\n`, 'dynamic import with a computed specifier'],
      ['require in the kernel', READ, (t) => `${t}\nexport const r = () => require('./planTier')\n`, 'require\\(\\) call'],
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

  // The aggregate of every kernel version, the one in force included, held here as literals: the pin file alone could be edited and re-pinned in one go. Each version bump appends one line here.
  const PINNED = { 1: 'e0fc6748b9692bad96e1', 2: '79ef55bb36a7d1f69a8a', 3: 'cca31e5c5ff7babd1346', 4: '2399ccc3a193ea8cf9c9', 5: '8624d772d0f89952f034', 6: 'cda86a72797044a9dd46', 7: '8618a56c3a1817692182', 8: '0924ce2f785e8a5fe0cf' }
  /** Everything wrong with a pin: a gap or no history, a history that does not end at the version in force, an entry or the pinned aggregate that differs from the literal map. */
  const historyProblems = (pin, version, pinned) => {
    const gap = F.historyGap(pin.history)
    if (gap) return [gap]
    const problems = []
    if (pin.history.length !== version) problems.push(`the history ends at ${pin.history.length}, the version in force is ${version}`)
    for (const h of pin.history) if (h.aggregate !== pinned[h.version]) problems.push(`history version ${h.version} aggregate ${h.aggregate} is not the recorded ${pinned[h.version]}`)
    if (pin.aggregate !== pinned[version]) problems.push(`pin aggregate ${pin.aggregate} for version ${version} is not the recorded ${pinned[version]}`)
    return problems
  }

  await check('K12 the pin history cannot be rewritten quietly: versions are exactly 1..current, every aggregate, the version in force included, equals the literal map held here, and the writer refuses a gap or a missing history', () => {
    const pin = F.readPin()
    const version = F.currentVersion(new Map())
    assert.deepEqual(pin.history.map((h) => h.version), Array.from({ length: version }, (_, i) => i + 1))
    assert.deepEqual(Object.keys(PINNED).map(Number), Array.from({ length: version }, (_, i) => i + 1), 'the literal map covers 1..the version in force, no gap')
    for (const h of pin.history) assert.equal(h.aggregate, PINNED[h.version], `history version ${h.version} equals the literal map`)
    assert.equal(pin.aggregate, PINNED[version], 'the pinned aggregate equals the literal of the version in force')
    assert.deepEqual(historyProblems(pin, version, PINNED), [], 'the real pin')
    const clone = (p) => JSON.parse(JSON.stringify(p))
    const lastGone = clone(pin); lastGone.history.pop()
    assert.ok(historyProblems(lastGone, version, PINNED).length >= 1, 'MUTANT: the last history entry deleted by hand')
    const middleGone = clone(pin); middleGone.history.splice(2, 1)
    assert.ok(historyProblems(middleGone, version, PINNED).some((p) => /without a gap/.test(p)), 'MUTANT: an entry in the middle deleted')
    const none = clone(pin); delete none.history
    assert.ok(historyProblems(none, version, PINNED).some((p) => /no history/.test(p)), 'MUTANT: no history')
    const edited = clone(pin); edited.history[3].aggregate = '0'.repeat(20)
    assert.ok(historyProblems(edited, version, PINNED).some((p) => /version 4 aggregate/.test(p)), 'MUTANT: an earlier aggregate edited')
    const mutated = F.fingerprint(sourceWith(F.ENTRY, (t) => `${t}\nexport const __kffixMutant = 1\n`))
    const cli = F.pinWrite({ history: [] }, mutated, version)
    assert.ok(cli.refused && /no history/.test(cli.refused), 'MUTANT: the pin file deleted, then --write-pin (the CLI passes { history: [] }) is refused')
    const gapped = F.pinWrite(middleGone, mutated, version)
    assert.ok(gapped.refused && /without a gap/.test(gapped.refused), 'the writer refuses a history with a gap')
    const skipped = F.pinWrite(pin, mutated, version + 2)
    assert.ok(skipped.refused && /does not follow/.test(skipped.refused), 'the writer refuses a version that skips ahead')
    // the rewrite the review showed: a changed kernel, the last entry (here: version 5) deleted, re-pinned under the same version. The writer lets it through; the recorded literal does not.
    const before = clone(pin); before.history = before.history.slice(0, 4)
    const rewritten = F.pinWrite(before, mutated, 5)
    assert.equal(rewritten.refused, null, 'the writer alone cannot tell (it is the same shape as a first pin of version 5)')
    assert.ok(historyProblems(rewritten.pin, 5, PINNED).some((p) => /version 5 aggregate/.test(p)), 'MUTANT: the rewrite of version 5 is red in the test, by the literal')
    const sameVersionRewrite = clone(pin); sameVersionRewrite.history.pop()
    const reRead = F.pinWrite(sameVersionRewrite, mutated, version)
    assert.equal(reRead.refused, null, 'the writer alone cannot tell a deleted last entry from a first pin of that version')
    assert.ok(historyProblems(reRead.pin, version, PINNED).some((p) => new RegExp(`version ${version} aggregate`).test(p)), `MUTANT: the entry of the version in force (${version}) deleted, a changed kernel re-pinned under it, is red by the literal`)
    console.log('  K12 red: last entry deleted, middle entry deleted, no history, edited aggregate, deleted pin file, version 5 rewritten, version in force rewritten')
  })

  await check('K11 MUTANT (planTier own structure): a new reader of a table, a spread, a computed or duplicate key, a non-constant unread value, let, and an as-wrapper are refused; a getPlanLimits read there is counted; export changes the shape entry', () => {
    const refusals = (edit) => F.fingerprint(planWith(edit)).refusals
    const cases = [
      ['new function reading PAID_LIMITS', (t) => `${t}\nexport function leak(): number { return PAID_LIMITS.readSwitchMemoSeconds }\n`, 'PAID_LIMITS used outside its place'],
      ['FREE_LIMITS spreading PAID_LIMITS', (t) => t.replace(/(const FREE_LIMITS: PlanLimits = deepFreeze\(\{\r?\n)/, '$1  ...PAID_LIMITS,\n'), 'FREE_LIMITS: property .* is not a plain name: value'],
      ['computed key', (t) => addProp(t, 'PAID_LIMITS', '[k]: 1'), 'PAID_LIMITS: property .* is not a plain name: value'],
      ['duplicate key', (t) => addProp(t, 'FREE_LIMITS', 'catalogListWindowPages: 9'), 'FREE_LIMITS\\.catalogListWindowPages appears twice'],
      ['unread value not a constant', (t) => setProp(t, 'FREE_LIMITS', 'catalogListWindowPages', 'Date.now()'), 'FREE_LIMITS\\.catalogListWindowPages is not a constant'],
      ['M1a getter returns a derived object', (t) => t.replace('return PLAN_LIMITS_BY_TIER[resolvePlanTier(env)]', 'const t = PLAN_LIMITS_BY_TIER[resolvePlanTier(env)]; return { ...t, readSwitchMemoSeconds: t.notificationSectionCacheSeconds }'), 'PLAN_LIMITS_BY_TIER used outside its place'],
      ['getter returns the table through a local variable', (t) => t.replace('return PLAN_LIMITS_BY_TIER[resolvePlanTier(env)]', 'const t = PLAN_LIMITS_BY_TIER[resolvePlanTier(env)]; return t'), 'PLAN_LIMITS_BY_TIER used outside its place'],
      ['getter stores the table elsewhere', (t) => t.replace('return PLAN_LIMITS_BY_TIER[resolvePlanTier(env)]', '(globalThis as any).__l = PLAN_LIMITS_BY_TIER[resolvePlanTier(env)]'), 'PLAN_LIMITS_BY_TIER used outside its place'],
      ['const -> let', (t) => t.replace('const PAID_LIMITS:', 'let PAID_LIMITS:'), 'PAID_LIMITS is not a single const initialised by deepFreeze'],
      ['as-wrapper', (t) => { const sf = ts.createSourceFile('p.ts', t, ts.ScriptTarget.ES2022, true); const end = tableObject(sf, 'PAID_LIMITS').initializer.getEnd(); return splice(t, end, end, ' as PlanLimits') }, 'PAID_LIMITS is not a single const initialised by deepFreeze'],
      ['freeze removed (a bare object literal)', (t) => t.replace('const PAID_LIMITS: PlanLimits = deepFreeze({', 'const PAID_LIMITS: PlanLimits = ({').replace(/\}\)\r?\n\r?\nconst FREE_LIMITS/, '})\n\nconst FREE_LIMITS'), 'PAID_LIMITS is not a single const initialised by deepFreeze'],
      ['a shallow Object.freeze instead of deepFreeze', (t) => t.replace('const FREE_LIMITS: PlanLimits = deepFreeze({', 'const FREE_LIMITS: PlanLimits = Object.freeze({'), 'FREE_LIMITS is not a single const initialised by deepFreeze'],
      ['deepFreeze with a second argument', (t) => t.replace('const FREE_LIMITS: PlanLimits = deepFreeze({', 'const FREE_LIMITS: PlanLimits = deepFreeze(extra, {'), 'FREE_LIMITS is not a single const initialised by deepFreeze'],
      ['the table of tables not frozen', (t) => t.replace('Record<PlanTier, PlanLimits> = deepFreeze({', 'Record<PlanTier, PlanLimits> = ({'), 'PAID_LIMITS used outside its place'],
    ]
    for (const [name, edit, reason] of cases) {
      assert.ok(refusedLine(refusals(edit), PLAN, reason), `${name}: ${refusals(edit).join('\n')}`)
      console.log(`  K11 refused (${name})`)
    }
    const counted = liveProblems(planWith((t) => `${t}\nexport function windowOf(env: Env): number { return getPlanLimits(env).catalogListWindowPages }\n`))
    for (const table of TABLES) assert.ok(counted.includes(`${PLAN}: const ${table}.catalogListWindowPages ADDED`), counted.join('\n'))
    assert.ok(!counted.some((p) => p.includes(': refused: ')))
    const clean = F.limitReads(read(PLAN), PLAN)
    assert.deepEqual([clean.keys, clean.refusals], [[], []], 'positive control: the real deepFreeze form of planTier is accepted as it is')
    const exported = liveProblems(planWith((t) => t.replace('const PAID_LIMITS:', 'export const PAID_LIMITS:')))
    assert.ok(exported.includes(`${PLAN}: const PAID_LIMITS CHANGED`), exported.join('\n'))
  })

  // ---------- read-switch list (K13-K17): the list is hashed as its shape plus one entry per switch the kernel reads ----------
  const RS = 'src/lib/readSwitches.ts'
  const RAS = 'src/lib/reportAtomicSwitch.ts'
  const SW = 'KNOWN_READ_SWITCHES'
  const swEntry = (n) => `const ${SW}.${n}`
  const withMany = (...pairs) => new Map(pairs.map(([rel, edit]) => { const before = read(rel); const after = edit(before); assert.notEqual(after, before, `the mutation of ${rel} must change the file`); return [rel, after] }))
  const swProblems = (overrides) => liveProblems(overrides)
  const refusalLines = (overrides, file) => F.fingerprint(overrides).refusals.filter((l) => l.startsWith(`${file}:`) && /^[^:]+:\d+: refused: /.test(l))
  const listEdit = (edit) => (t) => t.replace(/export const KNOWN_READ_SWITCHES = \[[^\]]*\] as const/, edit)

  await check('K13 the purpose: a read switch the kernel does not read can be added, removed, reordered or renamed in the list without moving the fingerprint (ic_marks appended is the case that forced a bump)', () => {
    const base = F.fingerprint().aggregate
    const extra = read(RS).includes("'ic_marks'") ? 'ic_marks_probe' : 'ic_marks'
    const appended = withText(RS, listEdit((s) => s.replace('] as const', `, '${extra}'] as const`)))
    assert.ok(appended.get(RS).includes(`, '${extra}'] as const`), `${extra} is appended to the real list`)
    assert.deepEqual(swProblems(appended), [], 'ic_marks appended')
    assert.equal(F.fingerprint(appended).aggregate, base)
    const dropped = withText(RS, listEdit((s) => s.replace("'probe', ", '')))
    assert.deepEqual(swProblems(dropped), [], 'an unread switch removed')
    const reordered = withText(RS, listEdit((s) => s.replace("'probe', 'report_atomic', 'report_atomic_long'", "'report_atomic_long', 'probe', 'report_atomic'")))
    assert.deepEqual(swProblems(reordered), [], 'the order is not hashed')
    const renamed = withText(RS, listEdit((s) => s.replace("'probe'", "'probe_renamed'")))
    assert.deepEqual(swProblems(renamed), [], 'an unread switch renamed')
    const comment = withText(RS, (t) => t.replace("export const KNOWN_READ_SWITCHES = [", "export const KNOWN_READ_SWITCHES = [ // c\n  "))
    assert.deepEqual(swProblems(comment), [], 'whitespace and comments inside the list')
    console.log('  K13 green: ic_marks appended, an unread switch removed, reordered, renamed')
  })

  await check('K14 MUTANT (membership): a kernel-read switch removed from the list, or renamed, is red with its entry REMOVED (and the read named as missing); the other statements of readSwitches.ts stay hashed whole', () => {
    assert.ok(F.fingerprint().switchNames.length >= 1, 'no vacuous loop')
    for (const name of F.fingerprint().switchNames) {
      const gone = withText(RS, listEdit((s) => s.replace(new RegExp(`'${name}', ?|, '${name}'`), '')))
      const p = swProblems(gone)
      assert.ok(p.includes(`${RS}: ${swEntry(name)} REMOVED`), p.join('\n'))
      assert.ok(p.some((l) => new RegExp(`^${RS}:\\d+: refused: the kernel reads switch ${name}, which is not in ${SW}$`).test(l)), p.join('\n'))
      const renamed = withText(RS, listEdit((s) => s.replace(`'${name}'`, `'${name}_x'`)))
      const q = swProblems(renamed)
      assert.ok(q.includes(`${RS}: ${swEntry(name)} REMOVED`), q.join('\n'))
    }
    const other = withText(RS, (t) => t.replace("export const READ_SWITCH_SHADOW_MAX_RATE = 0.1", "export const READ_SWITCH_SHADOW_MAX_RATE = 0.2"))
    assert.ok(swProblems(other).includes(`${RS}: const READ_SWITCH_SHADOW_MAX_RATE CHANGED`), 'every other statement is hashed whole')
    const elsewhere = withText(RS, (t) => t.replace("export const DATA_EPOCH_KEY = 'data_epoch'", "export const DATA_EPOCH_KEY = 'data_epoch2'"))
    assert.ok(swProblems(elsewhere).includes(`${RS}: const DATA_EPOCH_KEY CHANGED`))
    console.log('  K14 red: each kernel-read switch removed, each renamed, another statement changed')
  })

  await check('K15 MUTANT (shape): as const removed, export removed, const turned into let, the list turned into a non-array, an element that is not a string literal -> red', () => {
    const cases = [
      ['as const removed', (t) => t.replace(/(export const KNOWN_READ_SWITCHES = \[[^\]]*\]) as const/, '$1')],
      ['export removed', (t) => t.replace('export const KNOWN_READ_SWITCHES', 'const KNOWN_READ_SWITCHES')],
      ['const to let', (t) => t.replace('export const KNOWN_READ_SWITCHES', 'export let KNOWN_READ_SWITCHES')],
      ['a type annotation added', (t) => t.replace('export const KNOWN_READ_SWITCHES =', 'export const KNOWN_READ_SWITCHES: readonly string[] =')],
    ]
    for (const [label, edit] of cases) {
      const p = swProblems(withText(RS, edit))
      assert.ok(p.includes(`${RS}: ${'const'} ${SW} CHANGED`), `${label}: ${p.join('\n')}`)
    }
    const spread = swProblems(withText(RS, listEdit((s) => s.replace("'probe'", '...OTHER')))).filter((l) => /refused: KNOWN_READ_SWITCHES holds an element that is not a string literal/.test(l))
    assert.equal(spread.length, 1, 'a spread element is refused')
    const notArray = swProblems(withText(RS, listEdit(() => "export const KNOWN_READ_SWITCHES = Object.freeze(['report_atomic']) as const"))).filter((l) => /refused: KNOWN_READ_SWITCHES is not a single declaration initialised by an array literal/.test(l))
    assert.equal(notArray.length, 1)
    console.log('  K15 red: as const removed, export removed, let, annotation, spread element, non-array')
  })

  const nameOf = (over) => F.fingerprint(over).switchNames
  const refuses = (label, over, file, reason) => {
    const fp = F.fingerprint(over)
    assert.ok(fp.refusals.some((l) => l.startsWith(`${file}:`) && reason.test(l)), `${label}: expected ${reason} in ${file}, got ${JSON.stringify(fp.refusals)}`)
    const written = F.pinWrite(F.readPin(), fp, F.currentVersion(new Map()) + 1)
    assert.ok(written.refused && written.pin === null, `${label}: a refusal is never pinned`)
  }

  await check('K16 MUTANT (refusals): a template, a concatenation, a property, a spread, a parameter from outside, a local, an alias, a namespace import, a re-export, a dynamic import, a typed parameter (the old union form, the unclamped line included), a typed property and any use of KNOWN_READ_SWITCHES in another closure file are refusals naming file and line', () => {
    const call = 'const reading = name === REPORT_ATOMIC_LONG_SWITCH ? await readSwitchState(env, REPORT_ATOMIC_LONG_SWITCH) : await readSwitchState(env, REPORT_ATOMIC_SWITCH)'
    const unclamped = (t) => t.replace(call, 'const reading = await readSwitchState(env, name)')
    const callEdit = (replacement) => withText(RAS, (t) => t.replace(call, replacement))
    refuses('template', callEdit('const reading = await readSwitchState(env, `report_${name}`)'), RAS, /^src\/lib\/reportAtomicSwitch\.ts:23: refused: switch name is a template literal/)
    refuses('no-substitution template', callEdit('const reading = await readSwitchState(env, `report_atomic`)'), RAS, /^src\/lib\/reportAtomicSwitch\.ts:23: refused: switch name is a template literal/)
    refuses('concatenation', callEdit("const reading = await readSwitchState(env, 'report_' + name)"), RAS, /^src\/lib\/reportAtomicSwitch\.ts:23: refused: switch name is BinaryExpression/)
    refuses('property access', callEdit('const reading = await readSwitchState(env, env.DB_NAME)'), RAS, /^src\/lib\/reportAtomicSwitch\.ts:23: refused: switch name is PropertyAccessExpression/)
    refuses('spread', callEdit('const reading = await readSwitchState(env, ...[name])'), RAS, /^src\/lib\/reportAtomicSwitch\.ts:23: refused: switch name is SpreadElement/)
    refuses('call expression', callEdit('const reading = await readSwitchState(env, String(name))'), RAS, /^src\/lib\/reportAtomicSwitch\.ts:23: refused: switch name is CallExpression/)
    refuses('missing argument', callEdit('const reading = await readSwitchState(env)'), RAS, /^src\/lib\/reportAtomicSwitch\.ts:23: refused: readSwitchState called without its switch name argument/)
    refuses('a parameter passed in from outside', withText(RAS, (t) => `${t}\nexport async function readOutside(env: Env, outside: string) { return readSwitchState(env, outside) }\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name outside is a parameter/)
    refuses('a local', withText(RAS, (t) => `${t}\nexport async function readLocal(env: Env) { const local = 'report_atomic'; return readSwitchState(env, local) }\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name local is a local/)
    refuses('an unbound identifier', withText(RAS, (t) => `${t}\nexport async function readFree(env: Env) { return readSwitchState(env, someGlobal) }\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name someGlobal is not a top-level const/)
    refuses('a top-level let', withText(RAS, (t) => `${t}\nlet mutableName = 'report_atomic'\nexport async function readLet(env: Env) { return readSwitchState(env, mutableName) }\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name mutableName is not a top-level const/)
    refuses('an aliased import', withMany([RAS, (t) => t.replace("import { readSwitchState } from './readSwitches'", "import { readSwitchState as rss } from './readSwitches'").replace(call, 'const reading = await rss(env, name)')]), RAS, /^src\/lib\/reportAtomicSwitch\.ts:3: refused: aliased import readSwitchState/)
    refuses('a call through a local alias', callEdit('const via = readSwitchState; const reading = await via(env, name)'), RAS, /^src\/lib\/reportAtomicSwitch\.ts:23: refused: readSwitchState used other than called directly/)
    refuses('a namespace import', withMany([RAS, (t) => t.replace("import { readSwitchState } from './readSwitches'", "import * as RSW from './readSwitches'\nimport { readSwitchState } from './readSwitches'")]), RAS, /^src\/lib\/reportAtomicSwitch\.ts:3: refused: default or namespace import of readSwitches/)
    refuses('a re-export', withText(RAS, (t) => `${t}\nexport { readSwitch } from './readSwitches'\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: re-exports readSwitches/)
    refuses('a dynamic import', withText(RAS, (t) => `${t}\nexport const lazy = () => import('./readSwitches')\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: dynamic import of readSwitches/)
    refuses('the old unclamped line: the typed parameter is no longer accepted', withText(RAS, unclamped), RAS, /^src\/lib\/reportAtomicSwitch\.ts:23: refused: switch name name is a parameter/)
    refuses('a typed parameter of the old union form', withText(RAS, (t) => `${t}\nexport const typed = (env: Env, sw: ReportAtomicSwitchName = REPORT_ATOMIC_SWITCH) => readSwitchState(env, sw)\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name sw is a parameter/)
    refuses('a typed property of a parameter', withText(RAS, (t) => `${t}\nexport const prop = (env: Env, o: { switch?: ReportAtomicSwitchName }) => readSwitchState(env, o.switch)\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name is PropertyAccessExpression/)
    refuses('an import of createReadSwitchStore', withText(RAS, (t) => t.replace("import { readSwitchState } from './readSwitches'", "import { readSwitchState, createReadSwitchStore } from './readSwitches'")), RAS, /^src\/lib\/reportAtomicSwitch\.ts:3: refused: imports createReadSwitchStore from readSwitches, which is not a switch reader the scan checks$/)
    refuses('an import of parseReadSwitches', withText(RAS, (t) => t.replace("import { readSwitchState } from './readSwitches'", "import { readSwitchState, parseReadSwitches } from './readSwitches'")), RAS, /^src\/lib\/reportAtomicSwitch\.ts:3: refused: imports parseReadSwitches from readSwitches, which is not a switch reader the scan checks$/)
    refuses('an import of switchHeaderValue', withText(RAS, (t) => t.replace("import { readSwitchState } from './readSwitches'", "import { readSwitchState, switchHeaderValue } from './readSwitches'")), RAS, /^src\/lib\/reportAtomicSwitch\.ts:3: refused: imports switchHeaderValue from readSwitches, which is not a switch reader the scan checks$/)
    refuses('an aliased import of a function the scan does not check', withText(RAS, (t) => t.replace("import { readSwitchState } from './readSwitches'", "import { readSwitchState, parseReadSwitches as prs } from './readSwitches'")), RAS, /^src\/lib\/reportAtomicSwitch\.ts:3: refused: imports parseReadSwitches from readSwitches, which is not a switch reader the scan checks$/)
    refuses('a new reader whose key parameter is not called name', withMany([RS, (t) => `${t}\nexport const readSwitchFor = (env: Env, key: string): Promise<ReadSwitchReading> => store.read(env, key)\n`], [RAS, (t) => t.replace("import { readSwitchState } from './readSwitches'", "import { readSwitchState, readSwitchFor } from './readSwitches'").replace("export type ReportAtomicMode", "export const viaFor = (env: Env) => readSwitchFor(env, 'ic_marks')\nexport type ReportAtomicMode")]), RAS, /^src\/lib\/reportAtomicSwitch\.ts:3: refused: imports readSwitchFor from readSwitches, which is not a switch reader the scan checks$/)
    for (const [label, edit] of [['a type-only import', "import type { ReadSwitchName } from './readSwitches'\nimport { readSwitchState } from './readSwitches'"], ['an inline type import', "import { type ReadSwitchName, readSwitchState } from './readSwitches'"]]) {
      assert.deepEqual(F.fingerprint(withText(RAS, (t) => t.replace("import { readSwitchState } from './readSwitches'", edit))).refusals, [], `${label} is allowed`)
    }
    refuses('a destructured parameter named like the top-level const', withText(RAS, (t) => `${t}\nexport async function shadowParam(env: Env, { REPORT_ATOMIC_SWITCH }: { REPORT_ATOMIC_SWITCH: string }) { return readSwitchState(env, REPORT_ATOMIC_SWITCH) }\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name REPORT_ATOMIC_SWITCH is a local/)
    refuses('an array-destructured parameter', withText(RAS, (t) => `${t}\nexport async function shadowArray(env: Env, [REPORT_ATOMIC_SWITCH]: string[]) { return readSwitchState(env, REPORT_ATOMIC_SWITCH) }\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name REPORT_ATOMIC_SWITCH is a local/)
    refuses('a destructured local named like the top-level const', withText(RAS, (t) => `${t}\nexport async function shadowLocal(env: Env, o: { REPORT_ATOMIC_SWITCH: string }) { const { REPORT_ATOMIC_SWITCH } = o; return readSwitchState(env, REPORT_ATOMIC_SWITCH) }\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name REPORT_ATOMIC_SWITCH is a local/)
    refuses('a nested destructured local', withText(RAS, (t) => `${t}\nexport async function shadowNested(env: Env, o: { a: { REPORT_ATOMIC_SWITCH: string } }) { const { a: { REPORT_ATOMIC_SWITCH } } = o; return readSwitchState(env, REPORT_ATOMIC_SWITCH) }\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name REPORT_ATOMIC_SWITCH is a local/)
    refuses('a plain parameter named like the top-level const', withText(RAS, (t) => `${t}\nexport async function shadowPlain(env: Env, REPORT_ATOMIC_SWITCH: string) { return readSwitchState(env, REPORT_ATOMIC_SWITCH) }\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name REPORT_ATOMIC_SWITCH is a parameter/)
    refuses('a block-scoped const at the top level of the file', withText(RAS, (t) => `${t}\n{ const REPORT_ATOMIC_SWITCH = 'ic_marks'; void readSwitchState(null as never, REPORT_ATOMIC_SWITCH) }\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name REPORT_ATOMIC_SWITCH is a local/)
    refuses('a catch variable named like the top-level const', withText(RAS, (t) => `${t}\nexport async function shadowCatch(env: Env) { try { return null } catch (REPORT_ATOMIC_SWITCH) { return readSwitchState(env, REPORT_ATOMIC_SWITCH) } }\n`), RAS, /^src\/lib\/reportAtomicSwitch\.ts:\d+: refused: switch name REPORT_ATOMIC_SWITCH is a local/)
    assert.deepEqual(F.fingerprint(withText(RAS, (t) => `${t}\nexport async function notShadowed(env: Env, { other }: { other: string }) { return readSwitchState(env, REPORT_ATOMIC_SWITCH) }\n`)).refusals, [], 'a destructured name that is not the const does not refuse')
    refuses('another closure file iterating the list', withMany(['src/lib/analytics.ts', (t) => `import { KNOWN_READ_SWITCHES } from './readSwitches'\n${t}\nexport const everySwitch = () => KNOWN_READ_SWITCHES.map((n) => n)\n`]), 'src/lib/analytics.ts', /^src\/lib\/analytics\.ts:\d+: refused: uses KNOWN_READ_SWITCHES/)
    refuses('the entry file using the list', withText(F.ENTRY, (t) => `${t}\nexport const listed = (globalThis as any).KNOWN_READ_SWITCHES\n`), F.ENTRY, /refused: uses KNOWN_READ_SWITCHES/)
    assert.ok(swProblems(callEdit('const reading = await readSwitchState(env, `report_${name}`)')).some((l) => /refused: switch name is a template literal/.test(l)), 'the live test is red on a refusal')
    console.log('  K16 red: every refusal above names its file and line')
  })

  await check('K17 derivation on the real tree and the positive control: the scan finds the switches the kernel reads (report_atomic and report_atomic_long, through reportAtomicMode), nothing is refused, readSwitches.ts is accepted as it is, and the pin holds one entry per derived name', () => {
    const fp = F.fingerprint()
    assert.deepEqual(fp.refusals, [])
    assert.deepEqual(fp.switchTakers, { isKnownReadSwitch: 0, serializeReadSwitches: 1, readSwitchState: 1, readSwitch: 1 }, 'the functions of readSwitches.ts that take a switch name, found by the scan')
    assert.deepEqual(fp.switchNames, ['report_atomic', 'report_atomic_long'])
    const where = [...new Set(fp.switchReads.map((r) => `${r.name} @ ${r.at}: ${r.line}`))].sort()
    console.log(`  K17 derived: ${where.join(' | ')}`)
    assert.ok(fp.switchReads.length >= 1 && fp.switchReads.every((r) => r.file !== RS), 'no vacuous scan, and readSwitches.ts is not scanned')
    assert.ok(fp.switchReads.some((r) => r.name === 'report_atomic' && r.at === `${RAS}:23`), 'positive control')
    const names = Object.keys(F.readPin().files[RS].decls).filter((n) => n.startsWith(`${swEntry('')}`)).sort()
    assert.deepEqual(names, fp.switchNames.map(swEntry), 'one pin entry per derived name')
    assert.ok(!Object.keys(F.readPin().files[RS].decls).includes(swEntry('ic_marks')), 'a switch the kernel does not read is not hashed')
    const scanOne = F.switchReads(read(RAS), RAS, new Map(Object.entries(fp.switchTakers)))
    assert.deepEqual(scanOne.refusals, [])
    const fixture = F.switchReads("import { readSwitchState } from './readSwitches'\nconst S = 'a_switch'\nexport const f = (env: any) => [readSwitchState(env, 'lit'), readSwitchState(env, S)]\n", 'src/lib/fx.ts', new Map([['readSwitchState', 1]]))
    assert.deepEqual([fixture.names.map((n) => n.name), fixture.refusals], [['lit', 'a_switch'], []], 'a literal and a top-level const are accepted')
    const own = F.fileHashes(read(RS), RS, fp.limitKeys, fp.switchNames)
    assert.ok(own.decls[swEntry('report_atomic')] && own.decls[`const ${SW}`], 'the real readSwitches.ts hashes with no refusal')
    console.log('  K17 control: the real readSwitches.ts and reportAtomicSwitch.ts are accepted')
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
