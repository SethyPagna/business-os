'use strict'
// The sales-daily kernel fingerprint hashes only the plan-limit keys that closure code reads, and it only sees the closure. That is sound while nothing anywhere writes to a plan limit: a write from a route
// would change what the kernel reads without a single kernel statement changing. So: no code under src assigns to a limit table or to a getPlanLimits(...) result (also through a variable that holds one),
// increments or deletes a property of one, or passes one to Object.assign / defineProperty. Run (from cloudflare/): node scripts/test-plan-limits-no-writes-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const TABLES = new Set(['PAID_LIMITS', 'FREE_LIMITS', 'PLAN_LIMITS_BY_TIER'])
const MUTATORS = new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf'])

function limitWrites(text) {
  const sf = ts.createSourceFile('x.ts', text.replace(/\r\n/g, '\n'), ts.ScriptTarget.ES2022, true)
  const aliases = new Set()
  const plain = (e) => (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) ? plain(e.expression) : e)
  const isLimit = (raw) => {
    const e = plain(raw)
    if (ts.isIdentifier(e)) return TABLES.has(e.text) || aliases.has(e.text)
    if (ts.isCallExpression(e)) return ts.isIdentifier(e.expression) && e.expression.text === 'getPlanLimits'
    return (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) && isLimit(e.expression)
  }
  const target = (raw) => { const e = plain(raw); return isLimit(e) && (!ts.isIdentifier(e) || TABLES.has(e.text)) }
  const each = (fn, node = sf) => { fn(node); ts.forEachChild(node, (n) => each(fn, n)) }
  for (let pass = 0; pass < 2; pass += 1) each((n) => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isLimit(n.initializer)) aliases.add(n.name.text) })
  const found = []
  each((n) => {
    const bad = (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && target(n.left))
      || ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) && target(n.operand))
      || (ts.isDeleteExpression(n) && target(n.expression))
      || (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && MUTATORS.has(n.expression.name.text) && n.arguments[0] && isLimit(n.arguments[0]))
    if (bad) found.push(`line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${n.getText(sf).slice(0, 60)}`)
  })
  return found
}

const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sourceFiles(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []))

const writes = [
  'PAID_LIMITS = other', 'PAID_LIMITS.x = 1', 'PLAN_LIMITS_BY_TIER.paid.x = 1', "PLAN_LIMITS_BY_TIER['free'].x = 1", 'getPlanLimits(env).x = 1', "getPlanLimits(env)['x'] += 1", '(getPlanLimits(env).x) = 1',
  'getPlanLimits(env).x++', 'delete getPlanLimits(env).x', 'Object.assign(getPlanLimits(env), { x: 1 })', 'Object.assign(FREE_LIMITS, { x: 1 })',
  'const l = getPlanLimits(env); l.x = 1', 'const l = getPlanLimits(env); l.x--', 'const l = getPlanLimits(env); Object.defineProperty(l, "x", { value: 1 })', 'const l = PLAN_LIMITS_BY_TIER.paid; delete l.x',
]
const clean = [
  'const x = getPlanLimits(env).x + 1', 'const l = getPlanLimits(env); const n = l.x * 2; limits = { x: n }', 'const { x } = getPlanLimits(env); let y = x; y += 1',
  "const PAID_LIMITS: PlanLimits = { tier: 'paid' }", 'export const PLAN_LIMITS_BY_TIER = { paid: PAID_LIMITS }', 'const m = new Map(); m.x = 1; Object.assign(m, { x: 1 })',
]
for (const body of writes) assert.equal(limitWrites(body).length, 1, `a write that must be found: ${body}`)
for (const body of clean) assert.deepEqual(limitWrites(body), [], `a read or a declaration that must pass: ${body}`)

const root = path.join(__dirname, '..', 'src')
const files = sourceFiles(root)
assert.ok(files.length > 100 && files.some((f) => /planTier\.ts$/.test(f)), 'the scan covers the whole of src')
const real = files.flatMap((f) => limitWrites(fs.readFileSync(f, 'utf8')).map((w) => `${path.relative(root, f)} ${w}`))
assert.deepEqual(real, [], 'no code under src writes to a plan limit')
console.log(`PASS plan limits are never written: ${files.length} files scanned, ${writes.length} write forms found, ${clean.length} clean forms passed`)
