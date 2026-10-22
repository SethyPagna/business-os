'use strict'
// Migration SQL reading shared by the client-neutral lint
// (test-migration-client-neutral-pure.cjs) and the baseline tooling
// (ops/scripts/client/*.mjs).
//
// Three things live here and nothing else:
//   - a tokenizer that knows SQLite strings, quoted identifiers and comments
//     (so a number inside a comment or a string is never read as a literal id),
//   - a statement splitter that keeps a CREATE TRIGGER ... BEGIN ... END body in
//     one piece (CASE ... END nesting included),
//   - the shape of each data statement: target table, row count of a VALUES
//     list, whether it has a WHERE, and which integer literals sit in a
//     predicate position.
//
// It does not execute anything and it does not judge anything. The rules are
// in the lint test; the schema replay is in the baseline builder.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations')

function tokenize(sql) {
  const tokens = []
  const n = sql.length
  let i = 0
  let line = 1
  const push = (t, v, start, end, startLine) => tokens.push({ t, v, u: t === 'word' ? v.toUpperCase() : v, i: start, end, line: startLine })
  while (i < n) {
    const c = sql[i]
    if (c === '\n') { line += 1; i += 1; continue }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') { i += 1; continue }
    if (c === '-' && sql[i + 1] === '-') {
      const eol = sql.indexOf('\n', i)
      i = eol < 0 ? n : eol
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2)
      const stop = close < 0 ? n : close + 2
      for (let k = i; k < stop; k += 1) if (sql[k] === '\n') line += 1
      i = stop
      continue
    }
    const start = i
    const startLine = line
    if (c === "'") {
      let value = ''
      i += 1
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { value += "'"; i += 2; continue }
          i += 1
          break
        }
        if (sql[i] === '\n') line += 1
        value += sql[i]
        i += 1
      }
      push('str', value, start, i, startLine)
      continue
    }
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      let value = ''
      i += 1
      while (i < n) {
        if (sql[i] === close) {
          if (close !== ']' && sql[i + 1] === close) { value += close; i += 2; continue }
          i += 1
          break
        }
        if (sql[i] === '\n') line += 1
        value += sql[i]
        i += 1
      }
      push('id', value, start, i, startLine)
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
      let j = i
      if (c === '0' && /[xX]/.test(sql[i + 1] || '')) {
        j = i + 2
        while (j < n && /[0-9a-fA-F]/.test(sql[j])) j += 1
      } else {
        while (j < n && /[0-9]/.test(sql[j])) j += 1
        if (sql[j] === '.') { j += 1; while (j < n && /[0-9]/.test(sql[j])) j += 1 }
        if (/[eE]/.test(sql[j] || '') && /[0-9+-]/.test(sql[j + 1] || '')) {
          j += 2
          while (j < n && /[0-9]/.test(sql[j])) j += 1
        }
      }
      i = j
      push('num', sql.slice(start, i), start, i, startLine)
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j += 1
      i = j
      push('word', sql.slice(start, i), start, i, startLine)
      continue
    }
    i += 1
    push('p', c, start, i, startLine)
  }
  return tokens
}

function isWord(tok, ...names) { return tok && tok.t === 'word' && names.includes(tok.u) }
function isPunct(tok, ch) { return tok && tok.t === 'p' && tok.v === ch }
function ident(tok) { return tok && (tok.t === 'word' || tok.t === 'id') ? tok.v : null }

function classify(tokens) {
  const first = tokens.find((tk) => tk.t === 'word')
  if (!first) return 'empty'
  const words = tokens.filter((tk) => tk.t === 'word').slice(0, 5).map((tk) => tk.u)
  switch (first.u) {
    case 'CREATE': {
      const rest = words.slice(1).filter((w) => !['TEMP', 'TEMPORARY', 'UNIQUE'].includes(w))
      if (rest[0] === 'VIRTUAL') return 'create_vtable'
      if (rest[0] === 'TABLE') return 'create_table'
      if (rest[0] === 'INDEX') return 'create_index'
      if (rest[0] === 'VIEW') return 'create_view'
      if (rest[0] === 'TRIGGER') return 'create_trigger'
      return 'create_other'
    }
    case 'ALTER': return 'alter'
    case 'DROP': return 'drop'
    case 'INSERT': case 'REPLACE': return 'insert'
    case 'UPDATE': return 'update'
    case 'DELETE': return 'delete'
    case 'SELECT': case 'VALUES': return 'select'
    case 'WITH': return 'with'
    case 'PRAGMA': return 'pragma'
    case 'BEGIN': case 'COMMIT': case 'END': case 'ROLLBACK': case 'SAVEPOINT': case 'RELEASE': return 'tx'
    default: return 'other'
  }
}

function splitStatements(sql) {
  const tokens = tokenize(sql)
  const out = []
  let cur = []
  let trigger = false
  let body = false
  let ended = false
  let caseDepth = 0
  const flush = () => {
    if (!cur.length) return
    const text = sql.slice(cur[0].i, cur[cur.length - 1].end)
    out.push({ text, tokens: cur, line: cur[0].line, kind: classify(cur) })
    cur = []
    trigger = false
    body = false
    ended = false
    caseDepth = 0
  }
  for (const tk of tokens) {
    if (isPunct(tk, ';')) {
      if (trigger && body && !ended) { cur.push(tk); continue }
      flush()
      continue
    }
    cur.push(tk)
    if (tk.t !== 'word') continue
    if (!trigger && cur.filter((x) => x.t === 'word').length <= 3) {
      const w = cur.filter((x) => x.t === 'word').map((x) => x.u)
      if (w[0] === 'CREATE' && (w[1] === 'TRIGGER' || ((w[1] === 'TEMP' || w[1] === 'TEMPORARY') && w[2] === 'TRIGGER'))) trigger = true
    }
    if (!trigger) continue
    if (tk.u === 'CASE') caseDepth += 1
    else if (tk.u === 'END') {
      if (caseDepth > 0) caseDepth -= 1
      else if (body) ended = true
    } else if (tk.u === 'BEGIN' && !body) body = true
  }
  flush()
  return out
}

/** Walk to the matching close paren for the open paren at tokens[start]. */
function matchParen(tokens, start) {
  let depth = 0
  for (let k = start; k < tokens.length; k += 1) {
    if (isPunct(tokens[k], '(')) depth += 1
    else if (isPunct(tokens[k], ')')) {
      depth -= 1
      if (depth === 0) return k
    }
  }
  return tokens.length - 1
}

/** Token index where the data statement proper begins (skips a WITH ... list). */
function mainVerbIndex(tokens) {
  if (!isWord(tokens[0], 'WITH')) return 0
  let depth = 0
  for (let k = 1; k < tokens.length; k += 1) {
    const tk = tokens[k]
    if (isPunct(tk, '(')) depth += 1
    else if (isPunct(tk, ')')) depth -= 1
    else if (depth === 0 && isWord(tk, 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'SELECT')) return k
  }
  return 0
}

function tableAfter(tokens, k) {
  let name = ident(tokens[k])
  if (name && isPunct(tokens[k + 1], '.') && ident(tokens[k + 2])) name = ident(tokens[k + 2])
  return name ? name.toLowerCase() : null
}

const TAUTOLOGY = /^(1|1=1|0=0|true|'1'='1'|1<>0|1!=0)$/i

function whereIsTautology(tokens, whereIdx) {
  let end = tokens.length
  let depth = 0
  for (let k = whereIdx + 1; k < tokens.length; k += 1) {
    if (isPunct(tokens[k], '(')) depth += 1
    else if (isPunct(tokens[k], ')')) depth -= 1
    else if (depth === 0 && isWord(tokens[k], 'RETURNING', 'ORDER', 'LIMIT')) { end = k; break }
  }
  const text = tokens.slice(whereIdx + 1, end).map((tk) => (tk.t === 'str' ? `'${tk.v}'` : tk.v)).join('').replace(/\s+/g, '')
  return text === '' || TAUTOLOGY.test(text)
}

function depthZeroIndex(tokens, from, predicate) {
  let depth = 0
  for (let k = from; k < tokens.length; k += 1) {
    const tk = tokens[k]
    if (isPunct(tk, '(')) depth += 1
    else if (isPunct(tk, ')')) depth -= 1
    else if (depth === 0 && predicate(tk, k)) return k
  }
  return -1
}

/**
 * The shape of one data statement. Returns null for anything that is not
 * INSERT / REPLACE / UPDATE / DELETE.
 *   insert: { verb, table, orFlavor, valuesRows, upserts: [{ action, hasWhere }] }
 *   update: { verb, table, hasWhere, whereTautology }
 *   delete: { verb, table, hasWhere, whereTautology }
 */
function dmlShape(statement) {
  const all = statement.tokens
  const start = mainVerbIndex(all)
  const tokens = all.slice(start)
  const verb = tokens[0] && tokens[0].u
  if (verb === 'INSERT' || verb === 'REPLACE') {
    let k = 1
    let orFlavor = verb === 'REPLACE' ? 'REPLACE' : null
    if (isWord(tokens[k], 'OR')) { orFlavor = tokens[k + 1].u; k += 2 }
    if (!isWord(tokens[k], 'INTO')) return null
    const table = tableAfter(tokens, k + 1)
    let valuesRows = 0
    const valuesAt = depthZeroIndex(tokens, k + 1, (tk) => isWord(tk, 'VALUES'))
    if (valuesAt >= 0) {
      let p = valuesAt + 1
      while (isPunct(tokens[p], '(')) {
        valuesRows += 1
        p = matchParen(tokens, p) + 1
        if (isPunct(tokens[p], ',')) p += 1
        else break
      }
    }
    const upserts = []
    let from = k + 1
    for (;;) {
      const at = depthZeroIndex(tokens, from, (tk, idx) => isWord(tk, 'ON') && isWord(tokens[idx + 1], 'CONFLICT'))
      if (at < 0) break
      const doAt = depthZeroIndex(tokens, at + 2, (tk, idx) => isWord(tk, 'DO') && isWord(tokens[idx + 1], 'NOTHING', 'UPDATE'))
      if (doAt < 0) break
      if (isWord(tokens[doAt + 1], 'NOTHING')) upserts.push({ action: 'nothing', hasWhere: false })
      else {
        const nextConflict = depthZeroIndex(tokens, doAt + 2, (tk, idx) => isWord(tk, 'ON') && isWord(tokens[idx + 1], 'CONFLICT'))
        const limit = nextConflict < 0 ? tokens.length : nextConflict
        const w = depthZeroIndex(tokens.slice(0, limit), doAt + 2, (tk) => isWord(tk, 'WHERE'))
        upserts.push({ action: 'update', hasWhere: w >= 0 && !whereIsTautology(tokens.slice(0, limit), w) })
      }
      from = doAt + 2
    }
    return { verb: 'insert', table, orFlavor, valuesRows, hasSelect: depthZeroIndex(tokens, k + 1, (tk) => isWord(tk, 'SELECT')) >= 0, upserts }
  }
  if (verb === 'UPDATE') {
    let k = 1
    if (isWord(tokens[k], 'OR')) k += 2
    const table = tableAfter(tokens, k)
    const w = depthZeroIndex(tokens, k, (tk) => isWord(tk, 'WHERE'))
    return { verb: 'update', table, hasWhere: w >= 0, whereTautology: w >= 0 && whereIsTautology(tokens, w) }
  }
  if (verb === 'DELETE') {
    const table = isWord(tokens[1], 'FROM') ? tableAfter(tokens, 2) : null
    const w = depthZeroIndex(tokens, 1, (tk) => isWord(tk, 'WHERE'))
    return { verb: 'delete', table, hasWhere: w >= 0, whereTautology: w >= 0 && whereIsTautology(tokens, w) }
  }
  return null
}

// Words that end the predicate region of the group they appear in.
const RESET_WORDS = new Set(['SELECT', 'FROM', 'SET', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'THEN', 'ELSE', 'END', 'UNION', 'EXCEPT', 'INTERSECT', 'RETURNING', 'USING', 'INTO', 'BEGIN', 'JOIN'])

function integerValue(text) {
  if (/^0[xX][0-9a-fA-F]+$/.test(text)) return BigInt(text)
  if (/^[0-9]+$/.test(text)) return BigInt(text)
  return null
}

/**
 * Integer literals at or above `min` that sit in a WHERE / ON / HAVING / WHEN
 * predicate, an IN (...) list, a BETWEEN, or a VALUES list. Numbers anywhere
 * else (LIMIT, a SET expression, a CASE result, a default) are not reported:
 * those are constants, not row identities.
 */
function predicateIntegerLiterals(tokens, min = 1000n) {
  const found = []
  const stack = [{ pred: false, values: false, inList: false, between: null }]
  for (let k = 0; k < tokens.length; k += 1) {
    const tk = tokens[k]
    const top = stack[stack.length - 1]
    if (isPunct(tk, '(')) {
      const afterIn = isWord(tokens[k - 1], 'IN')
      stack.push({ pred: top.pred, values: top.values, inList: afterIn, between: null })
      continue
    }
    if (isPunct(tk, ')')) {
      if (stack.length > 1) stack.pop()
      continue
    }
    if (tk.t === 'word') {
      if (tk.u === 'WHERE' || tk.u === 'HAVING' || tk.u === 'ON' || tk.u === 'WHEN') { top.pred = true; top.values = false; top.between = null }
      else if (tk.u === 'VALUES') { top.values = true; top.pred = false }
      else if (tk.u === 'BETWEEN') top.between = 'low'
      else if (tk.u === 'AND') top.between = top.between === 'low' ? 'high' : null
      else if (tk.u === 'OR') top.between = null
      else if (RESET_WORDS.has(tk.u)) {
        if (tk.u === 'SELECT') top.inList = false
        top.pred = false
        top.values = false
        top.between = null
      }
      continue
    }
    if (tk.t === 'p' && tk.v === ',' && top.between) { top.between = null; continue }
    if (tk.t !== 'num') continue
    const value = integerValue(tk.v)
    if (value === null || value < min) continue
    if (top.pred || top.values || top.inList || top.between) found.push({ value: tk.v, line: tk.line })
  }
  return found
}

/**
 * A row identity written into the statement: an id column (id, rowid, *_id)
 * compared with = to a non-zero integer literal, or tested with IN against a
 * literal-only list. Any magnitude: ids below 1000 pin a row just as well.
 */
function pinnedIdComparisons(tokens) {
  const found = []
  const isInt = (tk) => tk && tk.t === 'num' && /^[0-9]+$/.test(tk.v) && /[1-9]/.test(tk.v)
  for (let k = 0; k < tokens.length; k += 1) {
    const tk = tokens[k]
    if ((tk.t !== 'word' && tk.t !== 'id') || !/^(?:rowid|id|.+_id)$/i.test(tk.v)) continue
    const next = tokens[k + 1]
    if (isPunct(next, '=') && !isPunct(tokens[k - 1], '<') && !isPunct(tokens[k - 1], '>') && !isPunct(tokens[k - 1], '!') && isInt(tokens[k + 2])) {
      found.push({ column: tk.v, value: tokens[k + 2].v, line: tk.line })
    } else if (isWord(next, 'IN') && isPunct(tokens[k + 2], '(')) {
      const close = matchParen(tokens, k + 2)
      const inner = tokens.slice(k + 3, close)
      const literalOnly = inner.every((x) => x.t === 'num' || isPunct(x, ',') || isPunct(x, '-'))
      const first = inner.find((x) => isInt(x))
      if (literalOnly && first) found.push({ column: tk.v, value: first.v, line: tk.line })
    }
  }
  return found
}

/** Integer literals at or above `min` inside any CHECK ( ... ) of the statement. */
function checkIntegerLiterals(tokens, min = 1000n) {
  const found = []
  for (let k = 0; k < tokens.length; k += 1) {
    if (!isWord(tokens[k], 'CHECK') || !isPunct(tokens[k + 1], '(')) continue
    const close = matchParen(tokens, k + 1)
    for (let m = k + 2; m < close; m += 1) {
      if (tokens[m].t !== 'num') continue
      const value = integerValue(tokens[m].v)
      if (value !== null && value >= min) found.push({ value: tokens[m].v, line: tokens[m].line })
    }
  }
  return found
}

/** Name of the table a CREATE TABLE / CREATE VIRTUAL TABLE statement defines, lower-cased. */
function createdTableName(statement) {
  const t = statement.tokens
  const at = t.findIndex((tk) => isWord(tk, 'TABLE'))
  if (at < 0) return null
  let k = at + 1
  if (isWord(t[k], 'IF') && isWord(t[k + 1], 'NOT') && isWord(t[k + 2], 'EXISTS')) k += 3
  return tableAfter(t, k)
}

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex') }

function migrationFiles(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
}

function migrationNumber(name) { return Number(name.slice(0, 4)) }

module.exports = {
  MIGRATIONS_DIR,
  tokenize,
  splitStatements,
  classify,
  dmlShape,
  createdTableName,
  predicateIntegerLiterals,
  pinnedIdComparisons,
  checkIntegerLiterals,
  matchParen,
  sha256,
  migrationFiles,
  migrationNumber,
}
