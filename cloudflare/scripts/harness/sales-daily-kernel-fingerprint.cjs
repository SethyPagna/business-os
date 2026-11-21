'use strict'
// Fingerprint of the LIVE money kernel that the stored daily totals must be computed by (design 7.6).
//
// The kernel is src/lib/salesAnalytics.ts and every module it reaches at run time (the relative closure over static imports, re-exports and string-literal dynamic import(), type-only left out; an import() whose argument is not a plain string literal, and any require(, in a closure file is a refusal), except
// db.ts (the connection seam, no money rule). Each file is cut into its top-level statements; interfaces and type aliases are erased at build time and
// are skipped; every other statement (imports, functions, consts, classes) is hashed over its TOKENS: comments, whitespace and line endings do not
// move a hash, any other change does, including a single character inside a SQL template. Token texts come from the TypeScript parser, so the hash does
// not depend on the printer of a TypeScript release.
//
// The plan-limit tables of src/lib/planTier.ts are deep-frozen where they are declared (deepFreeze({ ... }), the only declaration form accepted), so nothing can write to a limit at run time, and they are the one place hashed per KEY, not whole: only the limit keys that kernel code reads (getPlanLimits(env).key) are hashed, so a limit the kernel does not read
// can change without a version bump. The keys are DERIVED by a scan of every closure file, which refuses (red, and never pinnable) every use of a limit table other than that one read form.
//
// The switch list of src/lib/readSwitches.ts (KNOWN_READ_SWITCHES) is hashed the same way: its shape (the array's string elements left out) plus one entry per switch name the kernel reads, derived by a scan of every other closure file that refuses every other way of naming a switch.
// A switch name must be a string literal or a same-file top-level const bound to one; a parameter, a local, a property, a template or any other expression is refused, so a type (or a type assertion) never decides what the kernel reads:
// reportAtomicMode itself clamps whatever value arrives to report_atomic or report_atomic_long.
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
const SWITCH_FILE = 'src/lib/readSwitches.ts'
const SWITCH_LIST = 'KNOWN_READ_SWITCHES'
const GUARDED =new Set(['getPlanLimits', 'PLAN_LIMITS_BY_TIER', 'PAID_LIMITS', 'FREE_LIMITS', 'PlanLimits'])

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

function shapeTokens(node, sf, obj, out, open = '{', close = '}') {
  if (node === obj) { out.push(open, close); return }
  if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return
  const kids = node.getChildren(sf)
  if (!kids.length) { out.push(node.getText(sf)); return }
  for (const kid of kids) shapeTokens(kid, sf, obj, out, open, close)
}

/** The object literal of `deepFreeze({ ... })` (the one form a limit table is declared in: the tables are frozen at run time, see planTier.ts), or null for any other expression. */
const frozenLiteral = (e) => (e && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'deepFreeze' && !e.typeArguments && e.arguments.length === 1 && ts.isObjectLiteralExpression(e.arguments[0]) ? e.arguments[0] : null)

/** A limit table statement as its shape plus one entry per kernel-read key, or null (not a table statement, or refused: the reason goes to `refusals`). */
function limitTable(stmt, sf, keys, rel, refusals) {
  if (!ts.isVariableStatement(stmt)) return null
  const list = stmt.declarationList
  const first = list.declarations[0]
  const table = first && ts.isIdentifier(first.name) ? LIMIT_TABLES.find((t) => t === first.name.text) : null
  if (!table) return null
  const refuse = (node, why) => refusals.push(`${rel}:${lineOf(node, sf)}: refused: ${why}`)
  const obj = frozenLiteral(first.initializer)
  if (list.declarations.length !== 1 || !(list.flags & ts.NodeFlags.Const) || !obj) { refuse(stmt, `${table} is not a single const initialised by deepFreeze({ ... })`); return null }
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
function hashFile(text, rel, limitKeys, switchNames) {
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
    const narrowedList = !narrowed && rel === SWITCH_FILE && switchNames ? switchTable(stmt, sf, switchNames, rel, refusals) : null
    if (narrowedList) { decls[name] = narrowedList.shape; for (const n of Object.keys(narrowedList.entries)) decls[`${name}.${n}`] = narrowedList.entries[n]; return }
    if (!narrowed) { decls[name] = tokenHash(stmt, sf); return }
    decls[name] = narrowed.shape
    for (const key of Object.keys(narrowed.entries)) decls[`${name}.${key}`] = narrowed.entries[key]
  })
  return { imports: sha(imports.join(',')), decls, refusals }
}

/** The hashes of one file: { imports, decls: { name: hash } }, every statement whole unless rel and limitKeys narrow the plan-limit tables. */
function fileHashes(text, rel, limitKeys, switchNames) {
  const { imports, decls } = hashFile(text, rel, limitKeys, switchNames)
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
        const inTable = LIMIT_TABLES.includes(node.text) && ts.isPropertyAssignment(p) && p.initializer === node && ts.isObjectLiteralExpression(p.parent) && frozenLiteral(p.parent.parent) === p.parent && ts.isVariableDeclaration(p.parent.parent.parent) && p.parent.parent.parent.name.getText(sf) === 'PLAN_LIMITS_BY_TIER'
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

/** The `const X = '<literal>'` statements of a file's top level: Map identifier -> literal. */
function topLiteralConsts(sf) {
  const out = new Map()
  for (const st of sf.statements) if (ts.isVariableStatement(st) && (st.declarationList.flags & ts.NodeFlags.Const)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && ts.isStringLiteral(d.initializer)) out.set(d.name.text, d.initializer.text)
  return out
}
/**
 * What `name` means at `node`: { kind: 'param' } | { kind: 'local' } | null (not bound by a function, block, loop or catch around it). A name inside a binding pattern (a destructured parameter or local) is bound;
 * a destructured parameter counts as a local. A top-level const is bound by none of these, so a binding of the same name anywhere around the use means it is not that const.
 */
function bindingOf(node, name) {
  const binds = (b) => (ts.isIdentifier(b) ? b.text === name : (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b)) ? b.elements.some((e) => !ts.isOmittedExpression(e) && binds(e.name)) : false)
  const scope = (n) => ts.isFunctionLike(n) || ts.isBlock(n) || ts.isCaseBlock(n) || ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n) || ts.isCatchClause(n)
  const declares = (x) => (ts.isVariableDeclaration(x) && binds(x.name)) || ((ts.isFunctionDeclaration(x) || ts.isClassDeclaration(x)) && !!x.name && x.name.text === name)
  for (let n = node.parent; n; n = n.parent) {
    if (!scope(n)) continue
    const param = ts.isFunctionLike(n) ? n.parameters.find((p) => binds(p.name)) : null
    if (param) return { kind: ts.isIdentifier(param.name) ? 'param' : 'local' }
    let local = false
    const scan = (x) => { if (declares(x)) local = true; if (!local) ts.forEachChild(x, scan) }
    const root = ts.isFunctionLike(n) ? n.body : n
    if (root) scan(root)
    if (local) return { kind: 'local' }
  }
  return null
}

/**
 * The switch names one argument stands for: { names: [...] } or { why } (a refusal). Accepted forms: a string literal; an identifier bound to a top-level const literal in the same file. Nothing else:
 * the kernel's read must name its switches itself (reportAtomicMode clamps whatever value arrives to report_atomic or report_atomic_long).
 */
function switchArg(arg, sf) {
  if (ts.isStringLiteral(arg)) return { names: [arg.text] }
  if (ts.isIdentifier(arg)) {
    const bound = bindingOf(arg, arg.text)
    if (bound) return { why: bound.kind === 'param' ? `switch name ${arg.text} is a parameter` : `switch name ${arg.text} is a local, not a top-level const bound to a string literal` }
    const consts = topLiteralConsts(sf)
    return consts.has(arg.text) ? { names: [consts.get(arg.text)] } : { why: `switch name ${arg.text} is not a top-level const bound to a string literal` }
  }
  if (ts.isTemplateLiteral(arg)) return { why: 'switch name is a template literal' }
  return { why: `switch name is ${ts.SyntaxKind[arg.kind]}, not a string literal or a top-level const bound to one` }
}

/** The functions exported by readSwitches.ts that take a switch name: Map name -> argument index (a parameter called ...name..., or typed ReadSwitchName). */
function switchTakers(text) {
  const sf = ts.createSourceFile(SWITCH_FILE, norm(text), ts.ScriptTarget.ES2022, true)
  const out = new Map()
  const isTaker = (p) => ts.isIdentifier(p.name) && (/name/i.test(p.name.text) || (p.type && p.type.getText(sf).includes('ReadSwitchName')))
  const exported = (st) => ts.canHaveModifiers(st) && (ts.getModifiers(st) || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  for (const st of sf.statements) {
    if (!exported(st)) continue
    const fns = ts.isFunctionDeclaration(st) && st.name ? [[st.name.text, st]] : ts.isVariableStatement(st) ? st.declarationList.declarations.filter((d) => ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))).map((d) => [d.name.text, d.initializer]) : []
    for (const [name, fn] of fns) { const at = fn.parameters.findIndex(isTaker); if (at >= 0) out.set(name, at) }
  }
  return out
}

/**
 * The kernel-read switch names of one closure file other than readSwitches.ts: { names: [{ name, at, line }], refusals }.
 * Every call to a function of readSwitches.ts that takes a switch name must pass it in an accepted form (switchArg); every other route to the list or the functions is a refusal.
 */
function switchReads(text, rel, takers) {
  const sf = ts.createSourceFile(rel, norm(text), ts.ScriptTarget.ES2022, true)
  const lines = sf.text.split('\n')
  const names = []
  const refusals = []
  const refuse = (node, why) => refusals.push(`${rel}:${lineOf(node, sf)}: refused: ${why}`)
  const locals = new Set()
  const isSwitchSpec = (spec) => spec.startsWith('.') && path.posix.join(path.posix.dirname(rel), spec).replace(/\.ts$/, '') === SWITCH_FILE.replace(/\.ts$/, '')
  const imports = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && isSwitchSpec(node.moduleSpecifier.text)) {
      if (ts.isExportDeclaration(node)) refuse(node, 're-exports readSwitches')
      else {
        const clause = node.importClause
        if (clause && (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)))) refuse(node, 'default or namespace import of readSwitches')
        if (clause && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const el of clause.namedBindings.elements) {
          const imported = (el.propertyName || el.name).text
          if (el.isTypeOnly || clause.isTypeOnly) continue
          if (el.propertyName && (takers.has(imported) || imported === SWITCH_LIST)) refuse(el, `aliased import ${imported}`)
          else if (!takers.has(imported)) refuse(el, `imports ${imported} from readSwitches, which is not a switch reader the scan checks`)
          else locals.add(el.name.text)
        }
      }
    }
    ts.forEachChild(node, imports)
  }
  imports(sf)
  const visit = (node) => {
    if (isDynamicImport(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && isSwitchSpec(node.arguments[0].text)) refuse(node, 'dynamic import of readSwitches')
    if (ts.isIdentifier(node) && node.text === SWITCH_LIST) refuse(node, `uses ${SWITCH_LIST}`)
    if (ts.isIdentifier(node) && locals.has(node.text) && !ts.isImportSpecifier(node.parent)) {
      const p = node.parent
      if (!(ts.isCallExpression(p) && p.expression === node)) refuse(node, `${node.text} used other than called directly`)
      else {
        const arg = p.arguments[takers.get(node.text)]
        if (!arg) refuse(node, `${node.text} called without its switch name argument`)
        else {
          const r = switchArg(arg, sf)
          if (r.why) refuse(arg, r.why)
          else {
            for (const name of r.names) names.push({ name, at: `${rel}:${lineOf(arg, sf)}`, line: lines[lineOf(arg, sf) - 1].trim() })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { names, refusals }
}

/** The list statement as its shape (the array's string elements left out) plus one entry per kernel-read name that is in it, or null (not the list statement, or refused). */
function switchTable(stmt, sf, names, rel, refusals) {
  if (!ts.isVariableStatement(stmt)) return null
  const first = stmt.declarationList.declarations[0]
  if (!first || !ts.isIdentifier(first.name) || first.name.text !== SWITCH_LIST) return null
  const refuse = (node, why) => refusals.push(`${rel}:${lineOf(node, sf)}: refused: ${why}`)
  let e = first.initializer
  while (e && (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e))) e = e.expression
  if (stmt.declarationList.declarations.length !== 1 || !e || !ts.isArrayLiteralExpression(e)) { refuse(stmt, `${SWITCH_LIST} is not a single declaration initialised by an array literal`); return null }
  const present = new Map()
  let ok = true
  for (const el of e.elements) {
    if (!ts.isStringLiteral(el)) { refuse(el, `${SWITCH_LIST} holds an element that is not a string literal`); ok = false; continue }
    if (present.has(el.text)) { refuse(el, `${SWITCH_LIST} holds ${el.text} twice`); ok = false }
    present.set(el.text, el)
  }
  for (const name of names) if (!present.has(name)) { refuse(stmt, `the kernel reads switch ${name}, which is not in ${SWITCH_LIST}`); ok = false }
  if (!ok) return null
  const out = []
  shapeTokens(stmt, sf, e, out, '[', ']')
  const entries = {}
  for (const name of names) entries[name] = tokenHash(present.get(name), sf)
  return { shape: sha(out.join('\u0001')), entries }
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
  const takers = SWITCH_FILE in texts ? switchTakers(texts[SWITCH_FILE]) : new Map()
  const switchReadList = []
  for (const rel of Object.keys(texts)) {
    if (rel === SWITCH_FILE) continue
    const scan = switchReads(texts[rel], rel, takers)
    switchReadList.push(...scan.names.map((n) => ({ ...n, file: rel })))
    refusals.push(...scan.refusals)
  }
  const switchNames = [...new Set(switchReadList.map((r) => r.name))].sort()
  for (const rel of Object.keys(texts)) {
    const hashed = hashFile(texts[rel], rel, limitKeys, switchNames)
    files[rel] = { imports: hashed.imports, decls: hashed.decls }
    refusals.push(...hashed.refusals)
  }
  const sorted = Object.keys(files).sort()
  refusals.splice(0, refusals.length, ...new Set(refusals))
  const aggregate = sha(sorted.map((f) => `${f}\u0002${files[f].imports}\u0002${Object.keys(files[f].decls).sort().map((k) => `${k}=${files[f].decls[k]}`).join('\u0003')}`).join('\u0004'))
  return { files: Object.fromEntries(sorted.map((f) => [f, files[f]])), aggregate, texts, limitKeys, limitReads: limitReadList, switchNames, switchReads: switchReadList, switchTakers: Object.fromEntries(takers), refusals }
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

/** Why a pin history is not 1..n without a gap (or is missing), or null. */
const historyGap = (history) => {
  if (!Array.isArray(history) || !history.length) return 'the pin has no history (a deleted pin file cannot be rebuilt by a re-pin)'
  const at = history.findIndex((h, i) => !h || h.version !== i + 1)
  return at < 0 ? null : `the pin history is not versions 1..${history.length} without a gap (entry ${at + 1} is ${history[at] ? `version ${history[at].version}` : 'missing'})`
}

/** What --write-pin does, as a pure function: { refused: string | null, pin }. A refusal of the limit scan is never pinned; a changed aggregate is never pinned under a version that already has one; a history with a gap, or none, is never extended. */
function pinWrite(pin, now, version) {
  if (now.refusals && now.refusals.length) return { refused: `REFUSED: ${now.refusals.length} plan-limit refusal(s), nothing is pinned:\n${now.refusals.join('\n')}`, pin: null }
  const gap = historyGap(pin.history)
  if (gap) return { refused: `REFUSED: ${gap}.`, pin: null }
  if (version !== pin.history.length && version !== pin.history.length + 1) return { refused: `REFUSED: SALES_DAILY_KERNEL_VERSION ${version} does not follow the pin history (1..${pin.history.length}).`, pin: null }
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

module.exports = { historyGap, fingerprint, diff, fileHashes, limitReads, switchReads, switchTakers, pinWrite, relativeImports, readPin, currentVersion, kernelVersionOf, ENTRY, VERSION_FILE, ROOT, PIN_FILE }
