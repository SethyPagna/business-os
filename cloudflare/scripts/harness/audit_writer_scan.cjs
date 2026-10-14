'use strict'
// Finds every place the Worker writes an audit_logs row and what entity and action it writes, from the TypeScript
// syntax tree of cloudflare/src (no regexes over source text, so comments and strings cannot fool it):
//   - calls of audit(), auditOrThrow(), buildAuditStatement() and auditImportEvent(), and any other reference to those names;
//   - write-receipt keys: object literals that carry actorId, action and entity;
//   - raw `INSERT INTO audit_logs (...) VALUES|SELECT ...` statements, parsed column by column.
// An entity or action is LITERAL when it is a string literal, a conditional of literals, or a const that holds one literal.
// Anything else is DYNAMIC and has to be listed, with a stated class, in audit_retention_classes.cjs (DYNAMIC_WRITERS).

const fs = require('fs')
const path = require('path')

const CALLS = {
  audit: { entityAt: 4, actionAt: 3 },
  auditOrThrow: { entityAt: 4, actionAt: 3 },
  buildAuditStatement: { entityAt: 3, actionAt: 2 },
  auditImportEvent: { entityAt: null, actionAt: 1, entity: 'import_job' },
}

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim()

function scanAuditWriters(ts, srcRoot, overrides = {}) {
  const files = walk(srcRoot).map((file) => {
    const rel = path.relative(srcRoot, file).replace(/\\/g, '/')
    const text = Object.prototype.hasOwnProperty.call(overrides, rel) ? overrides[rel] : fs.readFileSync(file, 'utf8')
    return { file, rel, source: ts.createSourceFile(file, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS) }
  })

  // const NAME = 'literal' (module-level SCREAMING_CASE) anywhere in src; a name that holds two different literals is ambiguous.
  const consts = new Map()
  for (const { source } of files) {
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z][A-Z0-9_]+$/.test(node.name.text) && node.initializer
        && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
        let init = node.initializer
        while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
        if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
          const seen = consts.get(node.name.text) || new Set()
          seen.add(init.text)
          consts.set(node.name.text, seen)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  // The set of literal strings an expression can evaluate to, or null when it is not statically known.
  const resolve = (expr) => {
    if (!expr) return null
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return new Set([expr.text])
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) return resolve(expr.expression)
    if (ts.isConditionalExpression(expr)) {
      const a = resolve(expr.whenTrue)
      const b = resolve(expr.whenFalse)
      return a && b ? new Set([...a, ...b]) : null
    }
    if (ts.isIdentifier(expr)) {
      const seen = consts.get(expr.text)
      return seen && seen.size === 1 ? new Set(seen) : null
    }
    return null
  }

  const writes = []
  const problems = []
  const record = (rel, line, via, entity, action, entityText, actionText) => writes.push({ rel, line, via, entity, action, entityText, actionText })

  for (const { rel, source } of files) {
    // Names this file imports from the audit module (possibly renamed); lib/audit.ts declares them itself.
    const local = new Map()
    for (const name of Object.keys(CALLS)) if (rel === 'lib/audit.ts') local.set(name, name)
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && /(^|\/)audit$/.test(statement.moduleSpecifier.text)
        && statement.importClause && statement.importClause.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
        for (const element of statement.importClause.namedBindings.elements) {
          const canonical = (element.propertyName || element.name).text
          if (Object.prototype.hasOwnProperty.call(CALLS, canonical)) local.set(element.name.text, canonical)
        }
      }
    }
    const canonicalOf = (name) => (local.has(name) ? local.get(name) : Object.prototype.hasOwnProperty.call(CALLS, name) ? name : null)
    const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = ts.isIdentifier(node.expression) ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null
        const canonicalCallee = callee ? canonicalOf(callee) : null
        const spec = canonicalCallee ? CALLS[canonicalCallee] : null
        if (spec) {
          const args = node.arguments
          const actionArg = args[spec.actionAt]
          const entityArg = spec.entityAt === null ? null : args[spec.entityAt]
          if (!actionArg || (spec.entityAt !== null && !entityArg)) {
            problems.push(`${rel}:${lineOf(node)} ${callee}() is called with too few arguments to read its entity and action`)
          } else {
            record(rel, lineOf(node), callee,
              spec.entity ? new Set([spec.entity]) : resolve(entityArg), resolve(actionArg),
              spec.entity ? `'${spec.entity}'` : normalize(entityArg.getText(source)), normalize(actionArg.getText(source)))
          }
        }
      } else if (ts.isIdentifier(node) && local.has(node.text)) {
        const parent = node.parent
        const isCallee = (ts.isCallExpression(parent) && parent.expression === node)
          || (ts.isPropertyAccessExpression(parent) && parent.name === node && ts.isCallExpression(parent.parent) && parent.parent.expression === parent)
        const isDeclaration = (ts.isFunctionDeclaration(parent) && parent.name === node)
          || ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)
          || (ts.isPropertyAccessExpression(parent) && parent.name === node && !isCallee)
          || (ts.isPropertyAssignment(parent) && parent.name === node) || (ts.isBindingElement(parent) && parent.propertyName === node)
        if (!isCallee && !isDeclaration) problems.push(`${rel}:${lineOf(node)} ${node.text} is used other than by a direct call, so the pair it writes cannot be read`)
      } else if (ts.isObjectLiteralExpression(node)) {
        const props = new Map()
        for (const prop of node.properties) {
          if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) props.set(prop.name.text, prop.initializer)
          else if (ts.isShorthandPropertyAssignment(prop)) props.set(prop.name.text, prop.name)
        }
        if (props.has('actorId') && props.has('action') && props.has('entity')) {
          record(rel, lineOf(node), 'receipt key', resolve(props.get('entity')), resolve(props.get('action')),
            normalize(props.get('entity').getText(source)), normalize(props.get('action').getText(source)))
        }
      }

      // Raw SQL: any string that inserts into audit_logs.
      let sql = null
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) sql = node.text
      else if (ts.isTemplateExpression(node)) {
        sql = node.head.text + node.templateSpans.map((span) => '${' + normalize(span.expression.getText(source)) + '}' + span.literal.text).join('')
      }
      if (sql !== null && /INTO\s+audit_logs\b/i.test(sql)) {
        const found = parseRawInsert(sql)
        if (found.error) problems.push(`${rel}:${lineOf(node)} raw INSERT INTO audit_logs: ${found.error}`)
        else {
          const lit = (text) => { const m = /^'((?:[^']|'')*)'$/.exec(text); return m ? new Set([m[1].replace(/''/g, "'")]) : null }
          record(rel, lineOf(node), 'raw SQL', lit(found.entity), lit(found.action), found.entity, found.action)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { writes, problems }
}

// Splits at top-level commas, outside quotes, parentheses and ${...} substitutions.
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  let quote = null
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue }
    if (ch === '$' && text[i + 1] === '{') {
      let braces = 0
      let j = i
      for (; j < text.length; j += 1) {
        if (text[j] === '{') braces += 1
        else if (text[j] === '}') { braces -= 1; if (braces === 0) break }
      }
      current += text.slice(i, j + 1)
      i = j
      continue
    }
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

// Reads the group that starts at text[start] === '(' and returns [inner, indexAfter].
function readParens(text, start) {
  let depth = 0
  let quote = null
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) { if (ch === quote) quote = null; continue }
    if (ch === "'" || ch === '"') { quote = ch; continue }
    if (ch === '(') depth += 1
    if (ch === ')') { depth -= 1; if (depth === 0) return [text.slice(start + 1, i), i + 1] }
  }
  return null
}

function parseRawInsert(sql) {
  const head = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+audit_logs\s*/i.exec(sql)
  if (!head) return { error: 'the INSERT is not written as INSERT INTO audit_logs' }
  let at = head.index + head[0].length
  if (sql[at] !== '(') return { error: 'no column list' }
  const cols = readParens(sql, at)
  if (!cols) return { error: 'unbalanced column list' }
  const columns = splitTopLevel(cols[0]).map((column) => column.toLowerCase())
  at = cols[1]
  const rest = sql.slice(at)
  let values
  const valuesMatch = /^\s*VALUES\s*\(/i.exec(rest)
  if (valuesMatch) {
    const group = readParens(sql, at + valuesMatch[0].length - 1)
    if (!group) return { error: 'unbalanced VALUES list' }
    values = splitTopLevel(group[0])
  } else {
    const selectMatch = /^\s*SELECT\s+/i.exec(rest)
    if (!selectMatch) return { error: 'neither VALUES nor SELECT follows the column list' }
    const body = rest.slice(selectMatch[0].length)
    let depth = 0
    let quote = null
    let end = body.length
    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i]
      if (quote) { if (ch === quote) quote = null; continue }
      if (ch === "'" || ch === '"') { quote = ch; continue }
      if (ch === '$' && body[i + 1] === '{') { let b = 0; let j = i; for (; j < body.length; j += 1) { if (body[j] === '{') b += 1; else if (body[j] === '}') { b -= 1; if (b === 0) break } } i = j; continue }
      if (ch === '(') depth += 1
      if (ch === ')') depth -= 1
      if (depth === 0 && /^(FROM|WHERE)\b/i.test(body.slice(i)) && (i === 0 || /\s/.test(body[i - 1]))) { end = i; break }
    }
    values = splitTopLevel(body.slice(0, end))
  }
  const entityAt = columns.indexOf('entity')
  const actionAt = columns.indexOf('action')
  if (entityAt < 0 || actionAt < 0) return { error: 'the column list has no entity or action column' }
  if (values.length < columns.length) return { error: `${columns.length} columns but ${values.length} values` }
  return { entity: normalize(values[entityAt]), action: normalize(values[actionAt]) }
}

module.exports = { scanAuditWriters, parseRawInsert }
