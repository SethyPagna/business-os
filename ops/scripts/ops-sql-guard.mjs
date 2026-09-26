// Read-only guard for the fixed D1 export queries in ops/queries/*.sql.
//
// The workflow has no free-form SQL input: the `query` input only picks a
// FILE, and the file must pass this guard before it reaches
// `wrangler d1 execute business-os --remote`. A file passes only if it is
// exactly one SELECT (or WITH ... SELECT) statement:
//   - a string-aware scan mirrors SQLite's lexer: '...' strings with ''
//     escapes, "..." / `...` / [...] identifiers, -- comments to end of line,
//     /* */ comments (an unterminated one is refused, where SQLite would
//     silently swallow the rest of the input);
//   - no ';' except one optional final one, so no second statement can
//     follow, whatever comments or strings surround it;
//   - no write / schema / transaction / attach / pragma word anywhere in the
//     code (string and identifier contents are data, not code);
//   - no non-ASCII outside strings (no look-alike characters), no control
//     characters anywhere;
//   - at most MAX_COMPOUND_OPERATORS UNION/INTERSECT/EXCEPT: D1 refuses
//     compound SELECTs past a few terms ("too many terms in compound SELECT");
//     use one row of scalar sub-queries instead.
// What runs is the CANONICAL text built here -- comments removed, whitespace
// outside literals collapsed -- never the raw file.
//
// Adding a query = dropping <name>.sql into ops/queries/. Optional directives
// (line comments, one each):
//   -- ops:min-rows N          fail unless at least N rows (default 1)
//   -- ops:max-rows N          fail if more than N rows
//   -- ops:expect-zero *       every column of every row must be 0
//   -- ops:expect-zero a,b     the named columns must be 0 in every row
// There is no directive that prints a row count: a row count is a table size,
// which the public log must not show, so every query's count stays in the
// encrypted file.

import fs from 'node:fs'
import path from 'node:path'
import { OpsError, REPO_ROOT } from './ops-common.mjs'

export const QUERIES_DIR = path.join(REPO_ROOT, 'ops', 'queries')
export const QUERY_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
export const MAX_FILE_BYTES = 64 * 1024
export const MAX_SQL_CHARS = 16000
export const MAX_COMPOUND_OPERATORS = 3

export const FORBIDDEN_WORDS = new Set([
  'ATTACH', 'DETACH', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'REPLACE',
  'TRIGGER', 'VACUUM', 'REINDEX', 'ANALYZE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
  'RELEASE', 'TRANSACTION', 'RETURNING', 'UPSERT',
  'LOAD_EXTENSION', 'READFILE', 'WRITEFILE', 'FTS3_TOKENIZER',
])

function reject(code, message) {
  throw new OpsError(code, message)
}

// Splits SQL text into code / string / ident / comment parts, exactly as
// SQLite would, or throws.
export function scanSql(input) {
  const text = String(input).replace(/^﻿/, '')
  const parts = []
  let code = ''
  const flush = () => {
    if (code) parts.push({ type: 'code', text: code })
    code = ''
  }
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      for (;;) {
        if (j >= text.length) reject('sql-unterminated', 'An unterminated string or quoted identifier.')
        if (text[j] === c) {
          if (text[j + 1] === c) { j += 2; continue }
          break
        }
        j += 1
      }
      flush()
      parts.push({ type: c === "'" ? 'string' : 'ident', text: text.slice(i, j + 1) })
      i = j + 1
      continue
    }
    if (c === '[') {
      const j = text.indexOf(']', i + 1)
      if (j === -1) reject('sql-unterminated', 'An unterminated [identifier].')
      flush()
      parts.push({ type: 'ident', text: text.slice(i, j + 1) })
      i = j + 1
      continue
    }
    if (c === '-' && next === '-') {
      const end = text.indexOf('\n', i + 2)
      const j = end === -1 ? text.length : end
      flush()
      parts.push({ type: 'line-comment', text: text.slice(i + 2, j) })
      i = j
      continue
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) reject('sql-unterminated', 'An unterminated /* comment.')
      flush()
      parts.push({ type: 'block-comment', text: text.slice(i + 2, end) })
      i = end + 2
      continue
    }
    code += c
    i += 1
  }
  flush()
  for (const part of parts) {
    // Tab, LF and CR only; no NUL or other control characters anywhere.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(part.text)) reject('sql-control-character', 'A control character.')
    if (part.type === 'code' && /[^\x09\x0a\x0d\x20-\x7e]/.test(part.text)) reject('sql-non-ascii', 'A non-ASCII character outside a string.')
  }
  return parts
}

function parseDirective(body, rules, seen) {
  const m = /^ops:([a-z-]+)(?:\s+(.*))?$/.exec(body)
  if (!m) reject('sql-bad-directive', 'A malformed ops: directive.')
  const [, name, rawArg = ''] = m
  const arg = rawArg.trim()
  if (seen.has(name)) reject('sql-duplicate-directive', `Directive ${name} appears twice.`)
  seen.add(name)
  const integer = () => {
    if (!/^\d{1,9}$/.test(arg)) reject('sql-bad-directive', `Directive ${name} needs a whole number.`)
    return Number(arg)
  }
  switch (name) {
    case 'min-rows': rules.minRows = integer(); break
    case 'max-rows': rules.maxRows = integer(); break
    case 'expect-zero':
      if (arg === '*') rules.expectZero = '*'
      else {
        const cols = arg.split(',').map((s) => s.trim())
        if (!cols.length || cols.some((s) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(s))) {
          reject('sql-bad-directive', 'expect-zero needs * or a list of column names.')
        }
        rules.expectZero = cols
      }
      break
    default:
      reject('sql-unknown-directive', `Unknown directive ops:${name}.`)
  }
}

// Returns { sql, rules } for a file that passes, or throws OpsError.
export function guardSql(input) {
  const raw = String(input)
  if (Buffer.byteLength(raw, 'utf8') > MAX_FILE_BYTES) reject('sql-too-long', 'The query file is too large.')
  const parts = scanSql(raw)
  const rules = { minRows: 1, maxRows: null, expectZero: null }
  const seen = new Set()
  for (const part of parts) {
    if (part.type === 'line-comment' || part.type === 'block-comment') {
      const body = part.text.trim()
      if (/^ops:/i.test(body)) {
        if (part.type === 'block-comment') reject('sql-bad-directive', 'Directives must be -- line comments.')
        parseDirective(body, rules, seen)
      }
    }
  }
  if (rules.maxRows !== null && rules.maxRows < rules.minRows) reject('sql-bad-directive', 'max-rows is below min-rows.')

  // Canonical text: literals verbatim, comments -> one space, whitespace
  // outside literals collapsed.
  let sql = ''
  let pending = ''
  const flushCode = () => {
    sql += pending.replace(/\s+/g, ' ')
    pending = ''
  }
  for (const part of parts) {
    if (part.type === 'code') pending += part.text
    else if (part.type === 'line-comment' || part.type === 'block-comment') pending += ' '
    else {
      flushCode()
      sql += part.text
    }
  }
  flushCode()
  sql = sql.trim()

  // Code-only view (literals blanked) for the structural checks.
  const codeOnly = scanSql(sql).map((p) => (p.type === 'code' ? p.text : ' ')).join('')
  const semicolons = [...codeOnly.matchAll(/;/g)].map((m) => m.index)
  if (semicolons.length > 1 || (semicolons.length === 1 && codeOnly.slice(semicolons[0] + 1).trim() !== '')) {
    reject('sql-multiple-statements', 'Only one statement is allowed (a ; may only end the file).')
  }
  if (semicolons.length === 1) {
    sql = sql.slice(0, sql.lastIndexOf(';')).trim()
  }
  const code = codeOnly.replace(/;\s*$/, '')
  if (!sql) reject('sql-empty', 'The query is empty.')
  if (sql.length > MAX_SQL_CHARS) reject('sql-too-long', 'The canonical query is too long.')

  const words = [...code.matchAll(/[A-Za-z_][A-Za-z0-9_$]*/g)]
  const first = words.length ? words[0][0].toUpperCase() : ''
  if (first !== 'SELECT' && first !== 'WITH') reject('sql-not-select', 'The statement must start with SELECT or WITH.')
  if (!/^[A-Za-z]/.test(code.trimStart())) reject('sql-not-select', 'The statement must start with SELECT or WITH.')
  let compound = 0
  for (const m of words) {
    const word = m[0].toUpperCase()
    if (word.startsWith('PRAGMA')) reject('sql-forbidden-word', 'PRAGMA is not allowed.')
    if (word === 'REPLACE') {
      // replace(x, y, z) the string function is fine; REPLACE INTO is a write.
      const after = code.slice(m.index + m[0].length).trimStart()
      if (after.startsWith('(')) continue
    }
    if (FORBIDDEN_WORDS.has(word)) reject('sql-forbidden-word', `${word} is not allowed in a read-only export.`)
    if (word === 'UNION' || word === 'INTERSECT' || word === 'EXCEPT') compound += 1
  }
  if (compound > MAX_COMPOUND_OPERATORS) {
    reject('sql-compound-too-long', 'Too many UNION/INTERSECT/EXCEPT terms for D1; use scalar sub-queries.')
  }
  return { sql, rules }
}

export function listQueries(dir = QUERIES_DIR) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.slice(0, -4))
    .filter((name) => QUERY_NAME.test(name))
    .sort()
}

// Loads ops/queries/<name>.sql through the guard. The name comes from a
// workflow input, so it is validated before it touches the filesystem.
export function loadQuery(name, dir = QUERIES_DIR) {
  if (typeof name !== 'string' || !QUERY_NAME.test(name)) reject('query-name-invalid', 'Query names are lower-case kebab-case.')
  if (!listQueries(dir).includes(name)) reject('query-not-found', 'No such query file in ops/queries/.')
  const file = path.join(dir, `${name}.sql`)
  const real = fs.realpathSync(file)
  if (path.dirname(real).toLowerCase() !== fs.realpathSync(dir).toLowerCase()) reject('query-not-found', 'The query file escapes ops/queries/.')
  return { name, file, ...guardSql(fs.readFileSync(real, 'utf8')) }
}
