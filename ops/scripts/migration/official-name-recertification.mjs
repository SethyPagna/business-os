#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REVIEW_HEADERS = [
  'id',
  'expected_shop_name',
  'expected_barcode',
  'expected_brand',
  'expected_category',
  'expected_old_description',
  'proposed_official_name',
  'barcode_aliases',
  'official_source_url',
  'independent_source_url',
  'barcode_source_url',
  'confidence',
  'review_status',
  'unresolved_notes',
  'evidence_notes',
  'prior_confidence',
  'prior_evidence',
  'approved_for_apply',
  'reviewed_by',
  'reviewed_at_utc',
]

export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (char === '"') quoted = false
      else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field')
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  if (!rows.length) return []
  const headers = rows[0]
  if (headers.length) headers[0] = headers[0].replace(/^\uFEFF/, '')
  return rows.slice(1).filter((values) => values.some((value) => value !== '')).map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Malformed CSV row ${index + 2}: expected ${headers.length} columns, found ${values.length}`)
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]))
  })
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function stringifyCsv(rows, headers = REVIEW_HEADERS) {
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n')}\r\n`
}

function urlList(value) {
  return String(value ?? '').split('|').map((item) => item.trim()).filter(Boolean)
}

function validHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function sqlLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`
}

function exactExpectedDescription(row) {
  return `Official Product Name:\n${String(row.expected_shop_name ?? '')}`
}

export function validateReviewRows(rows, { firstId = 6032, lastId = 6104 } = {}) {
  const errors = []
  const warnings = []
  const approved = []
  const ids = new Set()
  const expectedIds = new Set(Array.from({ length: lastId - firstId + 1 }, (_, index) => firstId + index))
  for (const [index, row] of rows.entries()) {
    const csvRow = index + 2
    const id = Number(row.id)
    if (!Number.isInteger(id)) {
      errors.push(`row ${csvRow}: id must be an integer`)
      continue
    }
    if (!expectedIds.has(id)) errors.push(`row ${csvRow}: id ${id} is outside ${firstId}-${lastId}`)
    if (ids.has(id)) errors.push(`row ${csvRow}: duplicate id ${id}`)
    ids.add(id)
    if (!String(row.expected_shop_name ?? '').trim()) errors.push(`row ${csvRow}: expected_shop_name is required`)
    if (String(row.expected_old_description ?? '') !== exactExpectedDescription(row)) {
      errors.push(`row ${csvRow}: expected_old_description must exactly equal the applied shop-name description`)
    }
    if (!['pending', 'low', 'medium', 'high'].includes(String(row.confidence ?? '').trim().toLowerCase())) {
      errors.push(`row ${csvRow}: confidence must be pending, low, medium, or high`)
    }
    if (!['pending_recertification', 'verified', 'probable', 'hold', 'approved', 'unresolved'].includes(String(row.review_status ?? '').trim().toLowerCase())) {
      errors.push(`row ${csvRow}: review_status must be pending_recertification, verified, probable, hold, approved, or unresolved`)
    }
    const aliases = String(row.barcode_aliases ?? '').split('|').map((item) => item.trim()).filter(Boolean)
    for (const alias of aliases) if (!/^\d+$/.test(alias)) errors.push(`row ${csvRow}: barcode alias ${alias} is not digits-only`)
    for (const field of ['official_source_url', 'independent_source_url', 'barcode_source_url']) {
      for (const url of urlList(row[field])) if (!validHttpUrl(url)) errors.push(`row ${csvRow}: ${field} contains an invalid HTTP(S) URL`)
    }
    const wantsApply = String(row.approved_for_apply ?? '').trim().toLowerCase() === 'true'
    if (!wantsApply) continue
    if (String(row.review_status).trim().toLowerCase() !== 'approved') errors.push(`row ${csvRow}: approved_for_apply requires review_status=approved`)
    if (String(row.confidence).trim().toLowerCase() !== 'high') errors.push(`row ${csvRow}: approved_for_apply requires confidence=high`)
    if (!String(row.proposed_official_name ?? '').trim()) errors.push(`row ${csvRow}: approved_for_apply requires proposed_official_name`)
    if (!urlList(row.official_source_url).length) errors.push(`row ${csvRow}: approved_for_apply requires official_source_url`)
    if (!urlList(row.independent_source_url).length) errors.push(`row ${csvRow}: approved_for_apply requires independent_source_url`)
    if (String(row.expected_barcode ?? '').trim() && !urlList(row.barcode_source_url).length) {
      errors.push(`row ${csvRow}: a barcoded approved row requires barcode_source_url`)
    }
    if (!String(row.reviewed_by ?? '').trim()) errors.push(`row ${csvRow}: approved_for_apply requires reviewed_by`)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(row.reviewed_at_utc ?? '').trim())) {
      errors.push(`row ${csvRow}: approved_for_apply requires reviewed_at_utc in ISO UTC form`)
    }
    approved.push({ ...row, id })
  }
  for (const id of expectedIds) if (!ids.has(id)) errors.push(`missing required id ${id}`)
  if (rows.length !== expectedIds.size) errors.push(`expected ${expectedIds.size} rows, found ${rows.length}`)
  const blankBarcodeCount = rows.filter((row) => !String(row.expected_barcode ?? '').trim()).length
  if (blankBarcodeCount) warnings.push(`${blankBarcodeCount} rows have blank expected barcodes; their SQL guard uses an exact blank-barcode predicate`)
  return { errors, warnings, approved: errors.length ? [] : approved.sort((a, b) => a.id - b.id) }
}

export function buildGuardedSql(rows, options = {}) {
  const validation = validateReviewRows(rows, options)
  if (validation.errors.length) throw new Error(`Review validation failed:\n- ${validation.errors.join('\n- ')}`)
  const lines = [
    '-- LOCAL REVIEW ARTIFACT ONLY. Generated by official-name-recertification.mjs.',
    '-- Every UPDATE is fail-closed on exact product id, barcode (including blank), and expected prior description.',
    '-- Only rows explicitly marked approved_for_apply=true, review_status=approved, and confidence=high are emitted.',
    '',
  ]
  if (!validation.approved.length) {
    lines.push('-- No approved high-confidence rows. This artifact intentionally performs no updates.')
    return { sql: `${lines.join('\n')}\n`, validation }
  }
  for (const row of validation.approved) {
    const nextDescription = `Official Product Name:\n${row.proposed_official_name}`
    lines.push(`-- Product ${row.id}; reviewed by ${row.reviewed_by} at ${row.reviewed_at_utc}`)
    lines.push(`UPDATE products SET description=${sqlLiteral(nextDescription)}, updated_at=CURRENT_TIMESTAMP`)
    lines.push(`WHERE id=${row.id}`)
    lines.push(`  AND COALESCE(barcode,'')=${sqlLiteral(row.expected_barcode)}`)
    lines.push(`  AND COALESCE(description,'')=${sqlLiteral(row.expected_old_description)};`)
    lines.push('')
  }
  return { sql: `${lines.join('\n').trimEnd()}\n`, validation }
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--review') args.review = argv[++index]
    else if (token === '--out') args.out = argv[++index]
    else if (token === '--validate-only') args.validateOnly = true
    else throw new Error(`Unknown argument: ${token}`)
  }
  return args
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  if (!args.review) throw new Error('Usage: node official-name-recertification.mjs --review <csv> [--out <sql>] [--validate-only]')
  const rows = parseCsv(fs.readFileSync(path.resolve(args.review), 'utf8'))
  const { sql, validation } = buildGuardedSql(rows)
  if (!args.validateOnly) {
    if (!args.out) throw new Error('--out is required unless --validate-only is used')
    const output = path.resolve(args.out)
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, sql, 'utf8')
  }
  console.log(JSON.stringify({ rows: rows.length, approved: validation.approved.length, warnings: validation.warnings, output: args.validateOnly ? null : path.resolve(args.out) }, null, 2))
}
