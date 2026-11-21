'use strict'
// Fingerprint of the LIVE money kernel that the stored daily totals must be computed by (design 7.6).
//
// The kernel is src/lib/salesAnalytics.ts and every module it reaches at run time (the relative closure over static imports, re-exports and string-literal dynamic import(), type-only left out; an import() whose argument is not a plain string literal, and any require(, in a closure file is a refusal), except
// db.ts (the connection seam, no money rule). Each file is cut into its top-level statements; interfaces and type aliases are erased at build time and
// are skipped; every other statement (imports, functions, consts, classes) is hashed over its TOKENS: comments, whitespace and line endings do not
// move a hash, any other change does, including a single character inside a SQL template. Token texts come from the TypeScript parser, so the hash does
// not depend on the printer of a TypeScript release.
//
// The plan-limit tables of src/lib/planTier.ts are the one place hashed per KEY, not whole: only the limit keys that kernel code reads (getPlanLimits(env).key) are hashed, so a limit the kernel does not read
// can change without a version bump. The keys are DERIVED by a scan of every closure file, which refuses (red, and never pinnable) every use of a limit table other than that one read form.
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

const PLAN_TIER_FILE = 'src/lib/planTier.ts'
const LIMIT_TABLES = ['PAID_LIMITS', 'FREE_LIMITS']
const GUARDED = new Set(['getPlanLimits', 'PLAN_LIMITS_BY_TIER', 'PAID_LIMITS', 'FREE_LIMITS', 'PlanLimits'])

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

const lineOf = (node, sf) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
const isConstant = (e) => ts.isNumericLiteral(e) || ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword
  || (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && isConstant(e.operand)) || (ts.isParenthesizedExpression(e) && isConstant(e.expression))
  || (ts.isBinaryExpression(e) && [ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.SlashToken].includes(e.operatorToken.kind) && isConstant(e.left) && isConstant(e.right))

function shapeTokens(node, sf, obj, out) {
  if (node === obj) { out.push('{', '}'); return }
  if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return
  const kids = node.getChildren(sf)
  if (!kids.length) { out.push(node.getText(sf)); return }
  for (const kid of kids) shapeTokens(kid, sf, obj, out)
}

/** A limit table statement as its shape plus one entry per kernel-read key, or null (not a table statement, or refused: the reason goes to `refusals`). */
function limitTable(stmt, sf, keys, rel, refusals) {
  if (!ts.isVariableStatement(stmt)) return null
  const list = stmt.declarationList
  const first = list.declarations[0]
  const table = first && ts.isIdentifier(first.name) ? LIMIT_TABLES.find((t) => t === first.name.text) : null
  if (!table) return null
  const refuse = (node, why) => refusals.push(`${rel}:${lineOf(node, sf)}: refused: ${why}`)
  const obj = first.initializer
  if (list.declarations.length !== 1 || !(list.flags & ts.NodeFlags.Const) || !obj || !ts.isObjectLiteralExpression(obj)) { refuse(stmt, `${table} is not a single const with an object literal initializer`); return null }
  const seen = new Set()
  let ok = true
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) { refuse(p, `${table}: property ${p.getText(sf).slice(0, 40)} is not a plain name: value`); ok = false; continue }
    const key = p.name.text
    if (seen.has(key)) { refuse(p, `${table}.${key} appears twice`); ok = false }
    seen.add(key)
    if (!keys.includes(key) && !isConstant(p.initializer)) { refuse(p, `${table}.${key} is not a constant`); ok = false }
  }
  if (!ok) return null
  const out = []
  shapeTokens(stmt, sf, obj, out)
  const entries = {}
  for (const key of keys) { const p = obj.properties.find((q) => q.name.text === key); entries[key] = p ? tokenHash(p, sf) : sha('absent') }
  return { shape: sha(out.join('\u0001')), entries }
}

/** The hashes of one file with its refusals: { imports, decls, refusals }. Duplicate names get a numbered suffix (overloads). `limitKeys` (only with rel = planTier.ts) narrows the two limit tables. */
function hashFile(text, rel, limitKeys) {
  const sf = ts.createSourceFile('kernel.ts', norm(text), ts.ScriptTarget.ES2022, true)
  const decls = {}
  const imports = []
  const refusals = []
  sf.statements.forEach((stmt, index) => {
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) return
    if (ts.isImportDeclaration(stmt)) { imports.push(tokenHash(stmt, sf)); return }
    let name = statementName(stmt, sf, index)
    for (let n = 2; decls[name]; n += 1) name = `${statementName(stmt, sf, index)} (${n})`
    const narrowed = rel === PLAN_TIER_FILE && limitKeys ? limitTable(stmt, sf, limitKeys, rel, refusals) : null
    if (!narrowed) { decls[name] = tokenHash(stmt, sf); return }
    decls[name] = narrowed.shape
    for (const key of Object.keys(narrowed.entries)) decls[`${name}.${key}`] = narrowed.entries[key]
  })
  return { imports: sha(imports.join(',')), decls, refusals }
}

/** The hashes of one file: { imports, decls: { name: hash } }, every statement whole unless rel and limitKeys narrow the plan-limit tables. */
function fileHashes(text, rel, limitKeys) {
  const { imports, decls } = hashFile(text, rel, limitKeys)
  return { imports, decls }
}

const isPlanSpec = (rel, spec) => spec.startsWith('.') && path.posix.join(path.posix.dirname(rel), spec).replace(/\.ts$/, '') === PLAN_TIER_FILE.replace(/\.ts$/, '')
const isAssignOp = (kind) => kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
const isDynamicImport = (node) => ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
const isRequireCall = (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
/** The refusal for a load the walk and the scan cannot follow: import() whose argument is not a plain string literal, or any require( call; else null. */
function unfollowableLoad(node) {
  if (isDynamicImport(node) && !(node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]))) return 'dynamic import with a computed specifier'
  if (isRequireCall(node)) return 'require() call'
  return null
}
const unwrap = (node) => { let top = node; while (top.parent && (ts.isParenthesizedExpression(top.parent) || ts.isNonNullExpression(top.parent) || ts.isAsExpression(top.parent) || ts.isSatisfiesExpression(top.parent) || ts.isTypeAssertionExpression(top.parent))) top = top.parent; return top }

/**
 * The plan-limit reads of one closure file, by position: { keys: [{ key, at, line }], refusals }. The one allowed read is `getPlanLimits(<args>).<identifier>` (not written to); every other occurrence of a
 * limit identifier, and every route that carries planTier into a file without naming it (namespace or default import, alias, re-export, dynamic import), is a refusal `<rel>:<line>: refused: <reason>`.
 * Inside planTier.ts only the positions of its own structure are allowed (the tables' declarations, their place in PLAN_LIMITS_BY_TIER, the lookup in getPlanLimits, the PlanLimits type).
 */
function limitReads(text, rel) {
  const sf = ts.createSourceFile(rel, norm(text), ts.ScriptTarget.ES2022, true)
  const lines = sf.text.split('\n')
  const keys = []
  const refusals = []
  const refuse = (node, why) => refusals.push(`${rel}:${lineOf(node, sf)}: refused: ${why}`)
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && isPlanSpec(rel, node.moduleSpecifier.text)) {
      if (ts.isExportDeclaration(node)) refuse(node, 're-exports planTier')
      else {
        const clause = node.importClause
        if (clause && (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)))) refuse(node, 'default or namespace import of planTier')
        if (clause && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const el of clause.namedBindings.elements) if (el.propertyName) refuse(el, `aliased import ${el.propertyName.text}`)
      }
    }
    const unfollowable = unfollowableLoad(node)
    if (unfollowable) refuse(node, unfollowable)
    if (isDynamicImport(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && isPlanSpec(rel, node.arguments[0].text)) refuse(node, 'dynamic import of planTier')
    if (ts.isIdentifier(node) && GUARDED.has(node.text)) {
      const p = node.parent
      const isRead = node.text === 'getPlanLimits' && ts.isCallExpression(p) && p.expression === node && ts.isPropertyAccessExpression(p.parent) && p.parent.expression === p && ts.isIdentifier(p.parent.name)
      if (isRead) {
        const access = p.parent
        const top = unwrap(access)
        const q = top.parent
        const written = (ts.isBinaryExpression(q) && q.left === top && isAssignOp(q.operatorToken.kind))
          || ((ts.isPrefixUnaryExpression(q) || ts.isPostfixUnaryExpression(q)) && (q.operator === ts.SyntaxKind.PlusPlusToken || q.operator === ts.SyntaxKind.MinusMinusToken))
          || ts.isDeleteExpression(q)
        if (written) refuse(node, `writes getPlanLimits(...).${access.name.text}`)
        else keys.push({ key: access.name.text, at: `${rel}:${lineOf(node, sf)}`, line: lines[lineOf(node, sf) - 1].trim() })
      } else if (rel === PLAN_TIER_FILE) {
        const decl = (ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isTypeAliasDeclaration(p)) && p.name === node
        const inTable = LIMIT_TABLES.includes(node.text) && ts.isPropertyAssignment(p) && p.initializer === node && ts.isObjectLiteralExpression(p.parent) && ts.isVariableDeclaration(p.parent.parent) && p.parent.parent.name.getText(sf) === 'PLAN_LIMITS_BY_TIER'
        let fn = node
        while (fn && !ts.isFunctionDeclaration(fn)) fn = fn.parent
        const inGetter = node.text === 'PLAN_LIMITS_BY_TIER' && fn && fn.name && fn.name.text === 'getPlanLimits' && ts.isElementAccessExpression(p) && p.expression === node && ts.isReturnStatement(p.parent) && fn.body && fn.body.statements.length === 1
        const typeUse = node.text === 'PlanLimits' && ts.isTypeReferenceNode(p)
        if (!(decl || inTable || inGetter || typeUse)) refuse(node, `${node.text} used outside its place`)
      } else if (ts.isImportSpecifier(p) && !p.propertyName) {
        if (node.text !== 'getPlanLimits') refuse(node, `imports ${node.text}`)
      } else refuse(node, `${node.text} used other than as getPlanLimits(env).key`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { keys, refusals }
}

/**
 * Every relative module this file pulls in at run time, as posix paths without extension: static imports, re-exports (`export { x } from './m'`,
 * `export * from './m'`) and dynamic `import('./m')` with a string literal, found anywhere in the file (function bodies included). Type-only imports and
 * exports are erased at build time and are left out. A load the walk cannot follow (import() with a computed argument, require()) goes to `opts.refusals` as a refusal line (never skipped quietly).
 * `opts.dynamic` / `opts.reexports` (default true) exist only so a test can run a blind walker as a mutant.
 */
function relativeImports(text, fromFile, opts) {
  const dynamic = !opts || opts.dynamic !== false
  const reexports = !opts || opts.reexports !== false
  const sf = ts.createSourceFile('kernel.ts', norm(text), ts.ScriptTarget.ES2022, true)
  const found = []
  const add = (spec) => { if (spec.startsWith('.')) found.push(posix(path.join(path.dirname(fromFile), spec))) }
  const visit = (node) => {
    const unfollowable = opts && opts.refusals ? unfollowableLoad(node) : null
    if (unfollowable) opts.refusals.push(`${fromFile}:${lineOf(node, sf)}: refused: ${unfollowable}`)
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
  const walkRefusals = []
  while (queue.length) {
    const rel = queue.shift()
    if (rel in texts || EXCLUDED_FILES.has(rel)) continue
    let text
    if (overrides && overrides.has(rel)) text = overrides.get(rel)
    else {
      const file = path.join(ROOT, rel)
      if (!fs.existsSync(file)) throw new Error(`kernel file not found: ${rel}`)
      text = fs.readFileSync(file, 'utf8')
    }
    texts[rel] = text
    for (const dep of relativeImports(text, rel, { ...walkOpts, refusals: walkRefusals })) {
      const resolved = [`${dep}.ts`, `${dep}/index.ts`].find((c) => (overrides && overrides.has(c)) || fs.existsSync(path.join(ROOT, c)))
      if (!resolved) throw new Error(`import ${dep} from ${rel} does not resolve`)
      queue.push(resolved)
    }
  }
  const limitReadList = []
  const refusals = [...walkRefusals]
  for (const rel of Object.keys(texts)) {
    const scan = limitReads(texts[rel], rel)
    limitReadList.push(...scan.keys.map((k) => ({ ...k, file: rel })))
    refusals.push(...scan.refusals)
  }
  const limitKeys = [...new Set(limitReadList.map((r) => r.key))].sort()
  for (const rel of Object.keys(texts)) {
    const hashed = hashFile(texts[rel], rel, limitKeys)
    files[rel] = { imports: hashed.imports, decls: hashed.decls }
    refusals.push(...hashed.refusals)
  }
  const sorted = Object.keys(files).sort()
  refusals.splice(0, refusals.length, ...new Set(refusals))
  const aggregate = sha(sorted.map((f) => `${f}\u0002${files[f].imports}\u0002${Object.keys(files[f].decls).sort().map((k) => `${k}=${files[f].decls[k]}`).join('\u0003')}`).join('\u0004'))
  return { files: Object.fromEntries(sorted.map((f) => [f, files[f]])), aggregate, texts, limitKeys, limitReads: limitReadList, refusals }
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

/** What --write-pin does, as a pure function: { refused: string | null, pin }. A refusal of the limit scan is never pinned; a changed aggregate is never pinned under a version that already has one. */
function pinWrite(pin, now, version) {
  if (now.refusals && now.refusals.length) return { refused: `REFUSED: ${now.refusals.length} plan-limit refusal(s), nothing is pinned:\n${now.refusals.join('\n')}`, pin: null }
  const prior = pin.history.find((h) => h.version === version)
  if (prior && prior.aggregate !== now.aggregate) return { refused: `REFUSED: the kernel changed (${diff({ files: pin.files || {} }, now).length} statements) but SALES_DAILY_KERNEL_VERSION is still ${version}. Bump it in ${VERSION_FILE} first.`, pin: null }
  const history = prior ? pin.history : [...pin.history, { version, aggregate: now.aggregate }]
  return { refused: null, pin: { version, aggregate: now.aggregate, history, files: now.files } }
}

if (require.main === module) {
  const now = fingerprint()
  const version = currentVersion()
  if (now.refusals.length) { console.error(now.refusals.join('\n')); process.exit(1) }
  if (!process.argv.includes('--write-pin')) { console.log(JSON.stringify({ version, aggregate: now.aggregate, files: Object.keys(now.files).length }, null, 1)); process.exit(0) }
  const written = pinWrite(fs.existsSync(PIN_FILE) ? readPin() : { history: [] }, now, version)
  if (written.refused) { console.error(written.refused); process.exit(1) }
  fs.writeFileSync(PIN_FILE, `${JSON.stringify(written.pin, null, 1)}\n`)
  console.log(`pinned version ${version}, aggregate ${now.aggregate}, ${Object.keys(now.files).length} files`)
}

module.exports = { fingerprint, diff, fileHashes, limitReads, pinWrite, relativeImports, readPin, currentVersion, kernelVersionOf, ENTRY, VERSION_FILE, ROOT, PIN_FILE }
