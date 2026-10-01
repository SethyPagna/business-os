const { DatabaseSync } = require('node:sqlite')
const { createHash } = require('node:crypto')
const nativePrepare = require('better-sqlite3').prototype.prepare
const activePreflights = new WeakSet()
const schemaCopies = new Map()

function sqliteD1Call(statement, method, values) {
  const sql = statement.sourceSQL ?? statement.source
  const numbered = new Set()
  const names = new Map()
  let slots = 0
  for (let i = 0; i < sql.length;) {
    const char = sql[i]
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const end = char === '[' ? ']' : char
      i++
      while (i < sql.length) {
        if (sql[i++] !== end) continue
        if (char !== '[' && sql[i] === end) { i++; continue }
        break
      }
      continue
    }
    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i + 2)
      i = end < 0 ? sql.length : end + 1
      continue
    }
    if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? sql.length : end + 2
      continue
    }
    if (char !== '?') { i++; continue }
    const start = ++i
    while (i < sql.length && /[0-9]/.test(sql[i])) i++
    if (i === start) slots++
    else {
      const name = sql.slice(start, i)
      const slot = Number(name)
      numbered.add(slot)
      names.set(name, slot)
      slots = Math.max(slots, slot)
    }
  }
  if (slots > 100 || values.length > 100) throw new Error('D1_ERROR: too many SQL variables')
  preflightSqliteD1(statement)
  if (!numbered.size) return statement[method](...values)
  if (values.length !== slots) throw new Error(`D1 parameter count mismatch: expected ${slots}, got ${values.length}`)
  if (statement.sourceSQL !== undefined) return statement[method](...values)
  const named = Object.fromEntries([...names].map(([name, slot]) => [name, values[slot - 1]]))
  const anonymous = values.filter((_, i) => !numbered.has(i + 1))
  return statement[method](named, ...anonymous)
}

function prepareSqliteControl(database, sql) {
  return nativePrepare.call(database, sql)
}

function preflightSqliteD1(statement, { variableNumber = 100 } = {}) {
  if (statement.sourceSQL !== undefined) return
  const source = statement.database
  if (!source) throw new Error('D1 SQLite preflight requires the original statement database')
  if (activePreflights.has(source)) return
  activePreflights.add(source)
  try {
    const shadows = new Set(source.prepare('PRAGMA table_list').all().filter(row => row.type === 'shadow').map(row => `${row.schema}.${row.name}`))
    const objects = ['main', 'temp'].flatMap(schema => source.prepare(`SELECT type,name,tbl_name,sql FROM ${schema}.sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' ORDER BY type,name`).all()
      .filter(row => !shadows.has(`${schema}.${row.name}`) && !shadows.has(`${schema}.${row.tbl_name}`))
      .map(row => ({ ...row, schema })))
    const functions = source.prepare('PRAGMA function_list').all().filter(row => !row.builtin)
      .map(({ name, type, narg, flags }) => ({ name, type, narg, flags })).sort((a, b) => a.name.localeCompare(b.name) || a.narg - b.narg)
    const pragmas = Object.fromEntries(['foreign_keys', 'recursive_triggers', 'trusted_schema'].map(name => [name, Number(source.pragma(name, { simple: true }))]))
    const key = createHash('sha256').update(JSON.stringify({ objects, functions, pragmas, variableNumber })).digest('hex')
    let copy = schemaCopies.get(key)
    if (!copy) {
      const db = new DatabaseSync(':memory:')
      try {
        for (const fn of functions) {
          const options = { deterministic: Boolean(fn.flags & 2048), varargs: true }
          if (fn.type === 's') db.function(fn.name, options, () => null)
          else if (fn.type === 'a' || fn.type === 'w') db.aggregate(fn.name, { ...options, start: null, step: () => null, result: () => null, ...(fn.type === 'w' ? { inverse: () => null } : {}) })
          else throw new Error(`Unsupported SQLite function kind ${fn.type} for ${fn.name}`)
        }
        const rank = { table: 0, view: 1, index: 2, trigger: 3 }
        objects.sort((a, b) => rank[a.type] - rank[b.type] || (a.schema === b.schema ? a.name.localeCompare(b.name) : a.schema === 'main' ? -1 : 1))
        for (const object of objects) {
          let sql = object.sql
          if (object.schema === 'temp') {
            if (object.type === 'index' || /^CREATE\s+VIRTUAL\s+TABLE\b/i.test(sql)) {
              sql = sql.replace(/^(CREATE\s+(?:(?:UNIQUE\s+)?INDEX|VIRTUAL\s+TABLE)\s+(?:IF\s+NOT\s+EXISTS\s+)?)(?:"(?:[^"]|"")*"|'(?:[^']|'')*'|`(?:[^`]|``)*`|\[[^\]]*\]|[^\s(]+)/i, (_, prefix) => `${prefix}temp."${object.name.replaceAll('"', '""')}"`)
            } else if (!/^CREATE\s+TEMP(?:ORARY)?\b/i.test(sql)) {
              sql = sql.replace(/^CREATE\s+/i, 'CREATE TEMP ')
            }
          }
          db.exec(sql)
        }
        for (const [name, value] of Object.entries(pragmas)) db.exec(`PRAGMA ${name}=${value}`)
        db.limits.exprDepth = 100
        db.limits.variableNumber = variableNumber
        copy = { db, statements: new Map() }
      } catch (error) {
        db.close()
        throw new Error(`D1 SQLite schema preflight cannot reproduce schema: ${error.message}`, { cause: error })
      }
      schemaCopies.set(key, copy)
      if (schemaCopies.size > 8) {
        const oldest = schemaCopies.keys().next().value
        schemaCopies.get(oldest).db.close()
        schemaCopies.delete(oldest)
      }
    } else {
      schemaCopies.delete(key)
      schemaCopies.set(key, copy)
    }
    if (!copy.statements.has(statement.source)) {
      try { copy.statements.set(statement.source, copy.db.prepare(statement.source)) }
      catch (error) {
        if (/no such (?:function|collation|module|table)/i.test(error.message)) throw new Error(`D1 SQLite preflight unsupported native capability: ${error.message}`, { cause: error })
        throw error
      }
      if (copy.statements.size > 1000) copy.statements.delete(copy.statements.keys().next().value)
    }
  } finally {
    activePreflights.delete(source)
  }
}

module.exports = { sqliteD1Call, preflightSqliteD1, prepareSqliteControl }
