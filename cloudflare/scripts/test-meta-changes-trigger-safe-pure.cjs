'use strict'
// D1 counts the rows a TRIGGER writes in meta.changes (measured: a one-row UPDATE answers 5 when its table has writing triggers), while SQL changes() counts
// only the statement's own rows. So `meta.changes === 1` (or `!== 1`) as "my row changed" breaks the day any table gets a writing trigger: Revert would say no
// count was taken back, a claim UPDATE would read as lost. "A row changed" is `> 0`; "no row changed" is `=== 0` (a trigger never fires without a row).
// AST census of cloudflare/src:
//   1. no equality or inequality compares a D1 changes figure (meta.changes, .changes, anything named *changes*, or a variable assigned straight from one)
//      with a non-zero number or another non-literal value;
//   2. every ALLOWED entry (a comparison that is truly exact, with the reason) still matches a real line, so the list cannot go stale.
// Comparison with 0, undefined or null is allowed: "nothing changed" is trigger-safe. Reading a count to report it (`changed`, a sum) is not a comparison.
// Run (from cloudflare/): node scripts/test-meta-changes-trigger-safe-pure.cjs
// CHANGES_SRC_ROOT=<dir containing src/> points it at another checkout (the required-red run on the old code).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken])
const NAMED = /changes(at|of)?$/i

// Truly exact comparisons: { file, text (a fragment of the comparison), reason }. Empty today: every site that read "did a row change" now reads > 0.
const ALLOWED = []

function mentionsChanges(node) {
  let found = false
  const visit = (n) => {
    if (found) return
    if (ts.isIdentifier(n) && NAMED.test(n.text)) {
      const parent = n.parent
      // `changes.length` is a list size, not a D1 figure.
      if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === n && parent.name.text === 'length') return
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

function isNoChangeLiteral(node) {
  const n = ts.isParenthesizedExpression(node) ? node.expression : node
  if (ts.isNumericLiteral(n)) return Number(n.text) === 0
  if (n.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isIdentifier(n) && n.text === 'undefined') return true
  return false
}

function enclosingFunction(node) {
  for (let n = node.parent; n; n = n.parent) if (ts.isFunctionLike(n)) return n
  return null
}

function taintedNames(sf) {
  const names = new Map()
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let init = n.initializer
      while (ts.isParenthesizedExpression(init) || ts.isAwaitExpression(init) || ts.isAsExpression(init)) init = init.expression
      const normalised = (ts.isBinaryExpression(init) && (EQUALITY.has(init.operatorToken.kind) || [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.LessThanEqualsToken].includes(init.operatorToken.kind))) || ts.isConditionalExpression(init)
      if (!normalised && !ts.isArrowFunction(init) && !ts.isFunctionExpression(init) && mentionsChanges(init)) names.set(n.name.text, enclosingFunction(n))
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return names
}

function mentionsTaint(node, tainted, scope) {
  let found = false
  const visit = (n) => {
    if (found) return
    if (ts.isIdentifier(n) && tainted.has(n.text) && tainted.get(n.text) === scope) { found = true; return }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

// Returns [{ line, text }] for each exact comparison of a changes figure in one source text.
function scan(text, fileName) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  const tainted = taintedNames(sf)
  const hits = []
  const visit = (n) => {
    if (ts.isBinaryExpression(n) && EQUALITY.has(n.operatorToken.kind)) {
      const sides = [n.left, n.right]
      for (let i = 0; i < 2; i++) {
        const figure = sides[i]
        const other = sides[1 - i]
        if (!(mentionsChanges(figure) || mentionsTaint(figure, tainted, enclosingFunction(n)))) continue
        if (isNoChangeLiteral(other)) continue
        // a comparison inside the figure's own side (a nested expression) is judged on its own node
        if (ts.isBinaryExpression(figure) && EQUALITY.has(figure.operatorToken.kind)) continue
        hits.push({ line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text: n.getText().replace(/\s+/g, ' ') })
        break
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full)
  }
  return out
}

function scanTree(root) {
  const srcDir = path.join(root, 'src')
  const found = []
  for (const file of walk(srcDir, [])) {
    const rel = path.relative(root, file).split(path.sep).join('/')
    for (const hit of scan(fs.readFileSync(file, 'utf8'), file)) found.push({ file: rel, ...hit })
  }
  return found
}

function violations(found) {
  return found.filter((hit) => !ALLOWED.some((entry) => entry.file === hit.file && hit.text.includes(entry.text)))
}

if (require.main === module) {
  const root = process.env.CHANGES_SRC_ROOT || path.join(__dirname, '..')

  // The instrument: it must catch every spelling of the exact check and leave the safe ones alone.
  const bad = [
    'async function f(r){ return Number(r?.meta?.changes ?? 0) === 1 }',
    'async function f(r){ if (r.meta.changes !== 1) throw new Error("x") }',
    'async function f(r){ return r.changes === 1 }',
    'async function f(r){ return 1 === r.changes }',
    'async function f(r){ if (Number(r.changes || 0) !== 2) return }',
    'const batchChanges = (v) => Number(v?.meta?.changes ?? 0)\nasync function f(r){ return batchChanges(r) === 1 }',
    'async function f(r){ const n = Number(r.meta.changes ?? 0); if (n === 1) return true }',
    'async function f(r, expected){ return r.meta.changes === expected }',
    'async function f(results){ return results[0]?.meta?.changes !== 1 }',
  ]
  for (const source of bad) assert.equal(scan(source, 'planted.ts').length, 1, `must flag: ${source}`)
  const good = [
    'async function f(r){ return Number(r?.meta?.changes ?? 0) > 0 }',
    'async function f(r){ if (!(Number(r.changes ?? 0) > 0)) return }',
    'async function f(r){ return Number(r.meta.changes ?? 0) === 0 }',
    'async function f(r){ return r.meta.changes !== 0 }',
    'async function f(record){ return record.changes !== undefined }',
    'async function f(changes){ return changes.length === 1 }',
    'async function f(r){ const changed = Number(r.changes ?? 0) > 0 ? 1 : 0; if (changed !== 1) return }',
    'async function f(r){ const n = Number(r.meta.changes ?? 0); deleted += n; if (n < 5000) return }',
    'const sql = "UPDATE t SET a = 1 WHERE changes() = 1"',
  ]
  for (const source of good) assert.deepEqual(scan(source, 'planted.ts'), [], `must not flag: ${source}`)

  const found = scanTree(root)
  const unexplained = violations(found)
  assert.deepEqual(unexplained, [], `exact comparisons on a D1 changes figure (use > 0 for "a row changed"; D1 counts trigger writes in meta.changes):\n${unexplained.map((hit) => `  ${hit.file}:${hit.line}  ${hit.text}`).join('\n')}`)
  for (const entry of ALLOWED) assert.ok(found.some((hit) => hit.file === entry.file && hit.text.includes(entry.text)), `stale allow-list entry: ${entry.file} ${entry.text}`)
  console.log(`meta.changes trigger-safe: ${walk(path.join(root, 'src'), []).length} files scanned, ${found.length} exact comparisons, ${ALLOWED.length} allowed, 0 unexplained`)
}

module.exports = { scan, scanTree, violations }
