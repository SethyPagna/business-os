// ZOMBIE CODE gate (owner instruction, Sep 14 2026): an import binding that no
// line of its own file ever references is dead weight that survives review
// because nothing is red. The bundler tree-shakes it, so it never costs a byte
// in production -- which is exactly why it accumulates: 44 of them were living
// in cloudflare/src when this gate was written, including
// routes/sales.ts's `planSaleLinePriceEdit`, an import of a PLANNER for a sale
// line price edit the route does not perform. That one reads like a shipped
// feature to anyone grepping for it. This test makes the whole class fail.
//
// Scope is deliberately ONE class of zombie, mechanically decidable without
// type information: a binding introduced by an import declaration and never
// mentioned again in that file. It covers `import d from`, `import {a}`,
// `import {a as b}`, `import * as ns`, and type-only imports. A side-effect
// import (`import './x'`) declares no binding and is exempt by construction.
//
// Deliberately NOT covered here (see the note at the bottom of this file):
// unused locals, unused private functions and unused exports. tsconfig's
// noUnusedLocals would catch the first two but cannot be switched on today.
//
// Run (from cloudflare/scripts/): node test-zombie-imports-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const SLASH = String.fromCharCode(47)

// Bindings that are genuinely unused but MUST NOT be deleted mechanically,
// each with the reason removal would need a logic change rather than a text
// edit. Empty on purpose: every one of the 44 findings this scanner reported
// on 2026-09-14 was a plain unused binding and was deleted. Anything added
// here needs a sentence saying why it survives, not just its name.
const ALLOWLIST = new Map([
  // ['src/routes/example.ts', new Set(['bindingName'])],
])

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join(SLASH)
}

/**
 * Every binding an import declaration brings into `text`'s scope, with the
 * line it sits on, paired with whether any OTHER position in the file
 * mentions that name.
 *
 * The reference count deliberately errs toward "used": identifier positions
 * that can never resolve to an import (a member name in `obj.foo`, the right
 * side of a qualified type name `NS.Foo`, a non-shorthand object/class member
 * name) are skipped, but everything else counts, including type positions,
 * shorthand properties and `export { x }` re-exports. A scanner that
 * occasionally misses a dead import is a slow gate; one that accuses live code
 * is a broken gate, and this repository has to be able to trust it.
 */
function unusedImportBindings(file, text) {
  const source = ts.createSourceFile(
    file, text, ts.ScriptTarget.ES2022, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const bindings = []
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    const clause = statement.importClause
    if (clause.name) bindings.push({ name: clause.name.text, node: clause.name, form: 'default' })
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        bindings.push({ name: clause.namedBindings.name.text, node: clause.namedBindings.name, form: 'namespace' })
      } else {
        for (const element of clause.namedBindings.elements) {
          bindings.push({ name: element.name.text, node: element.name, form: element.propertyName ? 'alias' : 'named' })
        }
      }
    }
  }
  if (!bindings.length) return []

  const referenced = new Set()
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) return
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === node) return
      if (parent && ts.isQualifiedName(parent) && parent.right === node) return
      if (parent && (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)
        || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node) return
      referenced.add(node.text)
      return
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(source, visit)

  return bindings
    .filter(binding => !referenced.has(binding.name))
    .map(binding => ({
      name: binding.name,
      form: binding.form,
      line: source.getLineAndCharacterOfPosition(binding.node.getStart(source)).line + 1,
    }))
}

let failures = 0
function runTest(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) {
    failures++
    console.log(`FAIL ${name}`)
    console.log(String(error && error.message || error).split('\n').map(line => `     ${line}`).join('\n'))
  }
}

// ---------------------------------------------------------------------------
// 1. The instrument's own positive/negative controls.
//
// A sweep that answers "clean" for every shape is indistinguishable from a
// sweep that cannot see. These synthetic sources are cases the scanner MUST
// disagree about, one pair per import form, so a later refactor that quietly
// neuters the detector fails here rather than going green over real rot.
// ---------------------------------------------------------------------------
const SYNTHETIC = [
  { name: 'default import, never mentioned',
    text: "import helper from './helper'\nexport const value = 1\n", expect: ['helper'] },
  { name: 'default import, called',
    text: "import helper from './helper'\nexport const value = helper()\n", expect: [] },
  { name: 'named import, never mentioned',
    text: "import { alpha, beta } from './k'\nexport const value = alpha(1)\n", expect: ['beta'] },
  { name: 'aliased import, alias unused while original name appears',
    // `import { alpha as beta }` binds BETA. A file that still says `alpha`
    // somewhere (a comment, a string, another symbol) does not use the import.
    text: "import { alpha as beta } from './k'\nexport const alpha = 1\n", expect: ['beta'] },
  { name: 'aliased import, alias used',
    text: "import { alpha as beta } from './k'\nexport const value = beta\n", expect: [] },
  { name: 'namespace import, never mentioned',
    text: "import * as ns from './k'\nexport const value = 2\n", expect: ['ns'] },
  { name: 'namespace import, used through a member',
    text: "import * as ns from './k'\nexport const value = ns.thing\n", expect: [] },
  { name: 'side-effect import declares no binding',
    text: "import './register'\nexport const value = 3\n", expect: [] },
  { name: 'type-only import used only in a type position counts as used',
    text: "import type { Row } from './k'\nexport function f(row: Row) { return row }\n", expect: [] },
  { name: 'type-only import never mentioned',
    text: "import type { Row } from './k'\nexport function f(row: number) { return row }\n", expect: ['Row'] },
  { name: 'a name that appears only in a comment is still unused',
    text: "import { alpha } from './k'\n// alpha used to be called here\nexport const value = 4\n", expect: ['alpha'] },
  { name: 'a name that appears only as a member of another object is still unused',
    text: "import { alpha } from './k'\nexport const value = other.alpha\n", expect: ['alpha'] },
  { name: 'a shorthand property counts as a use',
    text: "import { alpha } from './k'\nexport const value = { alpha }\n", expect: [] },
  { name: 'a re-export counts as a use',
    text: "import { alpha } from './k'\nexport { alpha }\n", expect: [] },
  { name: 'use inside a template literal expression counts',
    text: "import { alpha } from './k'\nexport const value = `x${alpha}`\n", expect: [] },
  { name: 'default and named on one statement, only the named half used',
    text: "import helper, { alpha } from './k'\nexport const value = alpha\n", expect: ['helper'] },
]
for (const probe of SYNTHETIC) {
  runTest(`control: ${probe.name}`, () => {
    const found = unusedImportBindings(path.join(root, 'src', 'synthetic.ts'), probe.text).map(row => row.name)
    assert.deepEqual(found.sort(), [...probe.expect].sort())
  })
}

// ---------------------------------------------------------------------------
// 2. The real tree.
// ---------------------------------------------------------------------------
const files = sourceFiles(path.join(root, 'src')).sort()

runTest('the scan actually reaches the Worker source tree', () => {
  // Guard against a silently empty sweep (a moved directory, a bad filter):
  // an empty file list would make every assertion below vacuously true.
  assert.ok(files.length > 100, `expected the worker source tree, scanned ${files.length} files`)
  assert.ok(files.some(file => relative(file) === 'src/routes/sales.ts'), 'routes/sales.ts was not scanned')
})

const findings = []
const allowed = []
for (const file of files) {
  const rel = relative(file)
  for (const binding of unusedImportBindings(file, fs.readFileSync(file, 'utf8'))) {
    const entry = `${rel}:${binding.line} ${binding.name} (${binding.form})`
    if ((ALLOWLIST.get(rel) || new Set()).has(binding.name)) allowed.push(entry)
    else findings.push(entry)
  }
}

runTest('no cloudflare/src file imports a binding it never references', () => {
  assert.deepEqual(findings, [], `unused import bindings (delete them, or allowlist with a reason):\n${findings.join('\n')}`)
})

runTest('every allowlist entry is still a real finding', () => {
  // An allowlist entry that no longer matches anything is itself zombie code.
  const names = []
  for (const [file, set] of ALLOWLIST) for (const name of set) names.push(`${file} ${name}`)
  assert.equal(allowed.length, names.length,
    `allowlist has ${names.length} entries but ${allowed.length} matched; drop the stale ones`)
})

runTest('routes/sales.ts no longer imports the sale line price-edit planner', () => {
  // The specific zombie this gate was created for, pinned by behaviour rather
  // than by line number: sales.ts imported planSaleLinePriceEdit at line 97 and
  // never called it. Removed 2026-09-14. If a future change genuinely needs the
  // planner it will import AND call it, and this assertion is the place to
  // record that decision.
  const text = fs.readFileSync(path.join(root, 'src', 'routes', 'sales.ts'), 'utf8')
  const importsPlanner = /import\s[^\n]*\bplanSaleLinePriceEdit\b/.test(text)
  const callsPlanner = /planSaleLinePriceEdit\s*\(/.test(text)
  assert.equal(importsPlanner && !callsPlanner, false, 'planSaleLinePriceEdit is imported into routes/sales.ts but never called')
})

// tsconfig note (reported, not changed): `noUnusedLocals` would subsume this
// file's import check, but it CANNOT simply be switched on -- on 2026-09-14
// `npx tsc --noEmit --noUnusedLocals` reported 28 further TS6133/TS6196
// errors for unused locals and private helpers (promotionRules, salesAnalytics,
// routes/sales, routes/products, routes/returns ...). Each of those needs a
// judgement call about whether the dead local marks a dropped requirement, so
// the flag stays off until they are triaged and this test carries the part of
// the rule that is safe to enforce today.

process.exitCode = failures ? 1 : 0
console.log(failures ? `\n${failures} failing` : `\nall ${SYNTHETIC.length + 4} checks passed over ${files.length} files`)
