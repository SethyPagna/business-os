#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGroupedManifest, sha256, summarizeManifest, assert } from './grouped-repair-core.mjs'

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

function parseArgs(tokens = process.argv.slice(2)) {
  const allowed = new Set(['input', 'schema', 'fees-read-1', 'fees-read-2', 'sales-read-1', 'sales-read-2', 'sale-items-read-1', 'sale-items-read-2', 'out'])
  const result = {}
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    assert(token.startsWith('--'), `Unexpected argument: ${token}`)
    const key = token.slice(2)
    assert(allowed.has(key), `Unknown option: --${key}`)
    assert(result[key] === undefined, `Duplicate option: --${key}`)
    const value = tokens[++index]
    assert(value && !value.startsWith('--'), `Missing value for --${key}`)
    result[key] = resolve(value)
  }
  for (const key of allowed) assert(result[key], `Missing required option: --${key}`)
  return result
}

function rowsFromD1(value, label) {
  if (Array.isArray(value)) return value
  const rows = value?.result?.[0]?.results
  assert(Array.isArray(rows), `${label} must be a row array or D1 query response`)
  return rows
}

function schemaRowsFromD1(value) {
  const rows = value?.result?.[0]?.results
  assert(Array.isArray(rows), 'schema must be a D1 query response')
  return rows
}

export function schemaColumnsFromSql(sql) {
  assert(typeof sql === 'string' && sql.includes('(') && sql.includes(')'), 'table schema SQL is invalid')
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'))
  const definitions = []
  let current = ''
  let depth = 0
  let quote = null
  for (const character of body) {
    if (quote) {
      current += character
      if (character === quote) quote = null
    } else if (character === "'" || character === '"' || character === '`') {
      quote = character
      current += character
    } else if (character === '(') {
      depth += 1
      current += character
    } else if (character === ')') {
      depth -= 1
      current += character
    } else if (character === ',' && depth === 0) {
      definitions.push(current)
      current = ''
    } else current += character
  }
  definitions.push(current)
  return definitions.flatMap((definition) => {
    const normalized = definition.trim().replace(/^,\s*/, '')
    const name = normalized.match(/^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))/)?.slice(1).find(Boolean)
    if (!name || /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$/i.test(name)) return []
    return [name]
  })
}

function loadSchema(path) {
  const payload = readJson(path)
  const rows = schemaRowsFromD1(payload)
  const columns = {}
  for (const table of ['fees', 'sales', 'sale_items']) {
    const sql = rows.find((row) => row.name === table)?.sql
    assert(sql, `production schema is missing ${table}`)
    columns[table] = schemaColumnsFromSql(sql)
  }
  return { columns, sha256: sha256(readFileSync(path)) }
}

export function buildFromFiles(args) {
  const input = readJson(args.input)
  const schema = loadSchema(args.schema)
  const readSet = (suffix) => ({
    fees: rowsFromD1(readJson(args[`fees-read-${suffix}`]), `fees read ${suffix}`),
    sales: rowsFromD1(readJson(args[`sales-read-${suffix}`]), `sales read ${suffix}`),
    sale_items: rowsFromD1(readJson(args[`sale-items-read-${suffix}`]), `sale-items read ${suffix}`),
  })
  return buildGroupedManifest({
    ...input,
    schema_sha256: schema.sha256,
    schema_columns: schema.columns,
    read_1: readSet(1),
    read_2: readSet(2),
  })
}

function main() {
  const args = parseArgs()
  const manifest = buildFromFiles(args)
  mkdirSync(args.out, { recursive: false })
  const manifestPath = join(args.out, 'grouped-execution-manifest.json')
  const reviewPath = join(args.out, 'review-summary.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  writeFileSync(reviewPath, `${JSON.stringify(summarizeManifest(manifest), null, 2)}\n`, { flag: 'wx' })
  process.stdout.write(`${JSON.stringify({ status: 'prepared_for_review', manifest: manifestPath, manifest_sha256: manifest.content_sha256, groups: manifest.groups.length, production_write: false }, null, 2)}\n`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try { main() }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'refused_or_failed', error: String(error?.message || error) })}\n`)
    process.exitCode = 1
  }
}
