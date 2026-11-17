'use strict'
// Fingerprint of the LIVE money kernel that the stored daily totals must be computed by (design 7.6).
//
// The kernel is src/lib/salesAnalytics.ts and every module it reaches at run time (the relative closure over static imports, re-exports and string-literal dynamic import(), type-only left out), except
// db.ts (the connection seam, no money rule). Each file is cut into its top-level statements; interfaces and type aliases are erased at build time and
// are skipped; every other statement (imports, functions, consts, classes) is hashed over its TOKENS: comments, whitespace and line endings do not
// move a hash, any other change does, including a single character inside a SQL template. Token texts come from the TypeScript parser, so the hash does
// not depend on the printer of a TypeScript release.
//
// A pin file (scripts/sales-daily-kernel-pin.json) holds the per-statement hashes for the kernel version in force and an append-only history of
// { version, aggregate }. node scripts/harness/sales-daily-kernel-fingerprint.cjs --write-pin refuses to write a changed aggregate under a version that
// already has one, so a kernel change cannot be re-pinned without bumping SALES_DAILY_KERNEL_VERSION (which re-covers and re-computes every stored day).
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..', '..')
const ENTRY = 'src/lib/salesAnalytics.ts'
const EXCLUDED_FILES = new Set(['src/lib/db.ts'])
const PIN_FILE = path.join(__dirname, '..', 'sales-daily-kernel-pin.json')
const VERSION_FILE = 'src/lib/salesDailyTotals.ts'

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 20)
const norm = (text) => text.replace(/\r\n/g, '\n')
const posix = (p) => p.split(path.sep).join('/')

function leafTokens(node, sf, out) {
  if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return
  const kids = node.getChildren(sf)
  if (!kids.length) { out.push(node.getText(sf)); return }
  for (const kid of kids) leafTokens(kid, sf, out)
}
const tokenHash = (node, sf) => { const out = []; leafTokens(node, sf, out); return sha(out.join('\u0001')) }

function statementName(stmt, sf, index) {
  if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) return `${ts.isClassDeclaration(stmt) ? 'class' : 'function'} ${stmt.name ? stmt.name.text : `#${index}`}`
  if (ts.isVariableStatement(stmt)) return `const ${stmt.declarationList.declarations.map((d) => d.name.getText(sf)).join(',')}`
  return `${ts.SyntaxKind[stmt.kind]} #${index}`
}

/** The hashes of one file: { imports, decls: { name: hash } }. Duplicate names get a numbered suffix (overloads). */
function fileHashes(text) {
  const sf = ts.createSourceFile('kernel.ts', norm(text), ts.ScriptTarget.ES2022, true)
  const decls = {}
  const imports = []
  sf.statements.forEach((stmt, index) => {
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) return
    if (ts.isImportDeclaration(stmt)) { imports.push(tokenHash(stmt, sf)); return }
    let name = statementName(stmt, sf, index)
    for (let n = 2; decls[name]; n += 1) name = `${statementName(stmt, sf, index)} (${n})`
    decls[name] = tokenHash(stmt, sf)
  })
  return { imports: sha(imports.join(',')), decls }
}

/**
 * Every relative module this file pulls in at run time, as posix paths without extension: static imports, re-exports (`export { x } from './m'`,
 * `export * from './m'`) and dynamic `import('./m')` with a string literal, found anywhere in the file (function bodies included). Type-only imports and
 * exports are erased at build time and are left out. `opts.dynamic` / `opts.reexports` (default true) exist only so a test can run a blind walker as a mutant.
 */
function relativeImports(text, fromFile, opts) {
  const dynamic = !opts || opts.dynamic !== false
  const reexports = !opts || opts.reexports !== false
  const sf = ts.createSourceFile('kernel.ts', norm(text), ts.ScriptTarget.ES2022, true)
  const found = []
  const add = (spec) => { if (spec.startsWith('.')) found.push(posix(path.join(path.dirname(fromFile), spec))) }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !(node.importClause && node.importClause.isTypeOnly)) add(node.moduleSpecifier.text)
    else if (reexports && ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) add(node.moduleSpecifier.text)
    else if (dynamic && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) add(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** `overrides`: Map of posix path relative to cloudflare/ -> replacement source text (a mutant or a fixture). */
function fingerprint(overrides, walkOpts) {
  const files = {}
  const texts = {}
  const queue = [ENTRY]
  while (queue.length) {
    const rel = queue.shift()
    if (files[rel] || EXCLUDED_FILES.has(rel)) continue
    let text
    if (overrides && overrides.has(rel)) text = overrides.get(rel)
    else {
      const file = path.join(ROOT, rel)
      if (!fs.existsSync(file)) throw new Error(`kernel file not found: ${rel}`)
      text = fs.readFileSync(file, 'utf8')
    }
    files[rel] = fileHashes(text)
    texts[rel] = text
    for (const dep of relativeImports(text, rel, walkOpts)) {
      const resolved = [`${dep}.ts`, `${dep}/index.ts`].find((c) => (overrides && overrides.has(c)) || fs.existsSync(path.join(ROOT, c)))
      if (!resolved) throw new Error(`import ${dep} from ${rel} does not resolve`)
      queue.push(resolved)
    }
  }
  const sorted = Object.keys(files).sort()
  const aggregate = sha(sorted.map((f) => `${f}\u0002${files[f].imports}\u0002${Object.keys(files[f].decls).sort().map((k) => `${k}=${files[f].decls[k]}`).join('\u0003')}`).join('\u0004'))
  return { files: Object.fromEntries(sorted.map((f) => [f, files[f]])), aggregate, texts }
}

/** Every difference between two fingerprints, as readable lines (what was changed, added, removed). */
function diff(pinned, now) {
  const lines = []
  for (const f of new Set([...Object.keys(pinned.files), ...Object.keys(now.files)])) {
    const a = pinned.files[f]
    const b = now.files[f]
    if (!a) { lines.push(`${f}: file joined the kernel`); continue }
    if (!b) { lines.push(`${f}: file left the kernel`); continue }
    if (a.imports !== b.imports) lines.push(`${f}: imports changed`)
    for (const name of new Set([...Object.keys(a.decls), ...Object.keys(b.decls)])) {
      if (!(name in a.decls)) lines.push(`${f}: ${name} ADDED`)
      else if (!(name in b.decls)) lines.push(`${f}: ${name} REMOVED`)
      else if (a.decls[name] !== b.decls[name]) lines.push(`${f}: ${name} CHANGED`)
    }
  }
  return lines
}

const kernelVersionOf = (text) => { const m = /export const SALES_DAILY_KERNEL_VERSION = (\d+)\b/.exec(text); return m ? Number(m[1]) : null }
const currentVersion = (overrides) => kernelVersionOf(overrides && overrides.has(VERSION_FILE) ? overrides.get(VERSION_FILE) : fs.readFileSync(path.join(ROOT, VERSION_FILE), 'utf8'))
const readPin = () => JSON.parse(fs.readFileSync(PIN_FILE, 'utf8'))

if (require.main === module) {
  const now = fingerprint()
  const version = currentVersion()
  if (!process.argv.includes('--write-pin')) { console.log(JSON.stringify({ version, aggregate: now.aggregate, files: Object.keys(now.files).length }, null, 1)); process.exit(0) }
  const pin = fs.existsSync(PIN_FILE) ? readPin() : { history: [] }
  const prior = pin.history.find((h) => h.version === version)
  if (prior && prior.aggregate !== now.aggregate) {
    console.error(`REFUSED: the kernel changed (${diff(pin, now).length} statements) but SALES_DAILY_KERNEL_VERSION is still ${version}. Bump it in ${VERSION_FILE} first.`)
    process.exit(1)
  }
  if (!prior) pin.history.push({ version, aggregate: now.aggregate })
  const out = { version, aggregate: now.aggregate, history: pin.history, files: now.files }
  fs.writeFileSync(PIN_FILE, `${JSON.stringify(out, null, 1)}\n`)
  console.log(`pinned version ${version}, aggregate ${now.aggregate}, ${Object.keys(now.files).length} files`)
}

module.exports = { fingerprint, diff, fileHashes, relativeImports, readPin, currentVersion, kernelVersionOf, ENTRY, VERSION_FILE, ROOT, PIN_FILE }
