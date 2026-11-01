'use strict'
// Rule 2 of the read-switch design: writers always invalidate, switches only gate readers. No version bump, broadcast or
// change-log write may sit inside a block that a switch decides, because a switch OFF would then silently stop invalidating.
// Parses every source file with the TypeScript compiler API. A block is "switched" when the condition of an if, a ?: or a
// && / || / ?? contains a call of readSwitch / readSwitchState, or names a variable the same function assigned from one.
//
// Run: node scripts/test-read-switches-bump-outside-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SWITCH_CALLS = new Set(['readSwitch', 'readSwitchState'])
const WRITER_CALLS = new Set(['bumpVersion', 'bumpVersions', 'broadcast'])
const SRC = path.join(__dirname, '..', 'src')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.ts') ? [full] : []
  })
}

const calleeName = (call) => (ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null)
function containsCall(node, names) {
  let found = false
  ;(function visit(n) { if (found) return; if (ts.isCallExpression(n) && names.has(calleeName(n))) { found = true; return } ts.forEachChild(n, visit) })(node)
  return found
}
function mentions(node, identifiers) {
  let found = false
  ;(function visit(n) { if (found) return; if (ts.isIdentifier(n) && identifiers.has(n.text)) { found = true; return } ts.forEachChild(n, visit) })(node)
  return found
}

const LOGICAL = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken])

function scan(fileName, text) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true)
  const out = { switched: 0, violations: [] }
  const report = (node, label) => {
    const writers = []
    ;(function visit(n) { if (ts.isCallExpression(n) && WRITER_CALLS.has(calleeName(n))) writers.push(n); ts.forEachChild(n, visit) })(node)
    for (const call of writers) out.violations.push(`${path.basename(fileName)}:${source.getLineAndCharacterOfPosition(call.getStart()).line + 1} ${calleeName(call)}( inside ${label}`)
  }
  function visitFunction(fn) {
    const aliases = new Set()
    ;(function collect(n) {
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name) && containsCall(n.initializer, SWITCH_CALLS)) aliases.add(n.name.text)
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && containsCall(n.right, SWITCH_CALLS)) aliases.add(n.left.text)
      ts.forEachChild(n, collect)
    })(fn)
    const guarded = (condition) => containsCall(condition, SWITCH_CALLS) || mentions(condition, aliases)
    ;(function visit(n) {
      if (ts.isIfStatement(n) && guarded(n.expression)) {
        out.switched += 1
        report(n.thenStatement, 'the then-block of a switched if')
        if (n.elseStatement) report(n.elseStatement, 'the else-block of a switched if')
      } else if (ts.isConditionalExpression(n) && guarded(n.condition)) {
        out.switched += 1
        report(n.whenTrue, 'a switched ?:')
        report(n.whenFalse, 'a switched ?:')
      } else if (ts.isBinaryExpression(n) && LOGICAL.has(n.operatorToken.kind) && guarded(n.left)) {
        out.switched += 1
        report(n.right, 'a switched &&/||')
      }
      ts.forEachChild(n, visit)
    })(fn)
  }
  ;(function find(n) {
    if (ts.isFunctionLike(n) && n.body) visitFunction(n.body)
    ts.forEachChild(n, find)
  })(source)
  return out
}

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

const PLANTED = {
  direct: "async function a(env) { if (await readSwitch(env, 'x')) { await bumpVersion(env, 'products') } }",
  elseBranch: "async function a(env) { if (await readSwitch(env, 'x')) { return 1 } else { broadcast(env, 'x') } }",
  alias: "async function a(env) { const on = await readSwitch(env, 'x'); if (on) { await bumpVersions(env, ['a']) } }",
  stateAlias: "async function a(env) { const s = (await readSwitchState(env, 'x')).state; if (s !== 'off') { broadcast(env, 'x') } }",
  ternary: "async function a(env) { return (await readSwitch(env, 'x')) ? bumpVersion(env, 'a') : null }",
  logical: "async function a(env) { (await readSwitch(env, 'x')) && broadcast(env, 'x') }",
}
const CLEAN = "async function a(env) { await bumpVersion(env, 'products'); if (await readSwitch(env, 'x')) { return fast() } return slow() }"

check('control: every planted violation shape is found', () => {
  for (const [name, text] of Object.entries(PLANTED)) assert.equal(scan(`${name}.ts`, text).violations.length, 1, name)
})
check('control: a writer outside the switched block is not a violation, and the switched block is counted', () => {
  const result = scan('clean.ts', CLEAN)
  assert.deepEqual(result.violations, [])
  assert.equal(result.switched, 1)
})
check('source: no bumpVersion(, bumpVersions( or broadcast( call inside a block a switch decides', () => {
  const violations = []
  let switched = 0
  for (const file of walk(SRC)) {
    const result = scan(file, fs.readFileSync(file, 'utf8'))
    switched += result.switched
    violations.push(...result.violations)
  }
  console.log(`switched regions found in src: ${switched}`)
  assert.deepEqual(violations, [])
})
console.log(`${passed} checks passed`)
