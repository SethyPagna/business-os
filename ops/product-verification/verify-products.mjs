#!/usr/bin/env node
// Runner for the cautious product web-verification workflow (coordinated
// plan, Section 7). Reads a product export, runs a name search and a
// per-barcode search for each product through a pluggable provider, feeds
// the results to reconcile.mjs, and writes a review sheet (CSV, and XLSX
// when --xlsx is passed). This script NEVER writes to the product
// catalogue -- see README.md's "what this does not do" section. It also
// never fails the whole run on one product: a lookup error for a single
// row is recorded as a low-confidence `lookup_error`-flagged row and the
// run continues.
//
// Output schema: the coordinator's Gate-1 audit required this sheet be
// REVIEW_HEADERS-compatible with the existing, narrower one-batch tool at
// ops/scripts/migration/official-name-recertification.mjs, rather than
// inventing a parallel column set -- so REVIEW_HEADERS is imported from
// that file, not redefined here. A human (or that script's own
// --validate-only / buildGuardedSql path) can point at THIS tool's output
// and find the columns it expects. See README.md for exactly how the 20
// REVIEW_HEADERS columns are populated from reconcile.mjs's output, and
// why 4 extension columns are appended after them.
//
// Usage:
//   node verify-products.mjs --input <csv|json> --out <csv> [options]
//
// Options:
//   --provider mock|http     default: mock
//   --fixtures <dir>         mock provider's fixture directory (default: fixtures/sample-evidence)
//   --cache-dir <dir>        default: .cache
//   --delay-ms <n>           delay between provider calls, default 250
//   --xlsx                   also write a .xlsx next to --out
//   --limit <n>              only process the first n input rows (smoke-testing)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcileProduct } from './reconcile.mjs'
import { extractOfficialNameFromDescription } from './lib/description.mjs'
import { parseCsv, stringifyCsv } from './lib/csv.mjs'
import { DiskCache, cacheKeyFor, sleep } from './lib/cache.mjs'
import { MockProvider } from './providers/mockProvider.mjs'
import { HttpProvider } from './providers/httpProvider.mjs'
import { REVIEW_HEADERS as MIGRATION_REVIEW_HEADERS } from '../scripts/migration/official-name-recertification.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

// The 20 columns a human reviewer (or official-name-recertification.mjs
// itself) already knows how to read -- reused verbatim, not redefined.
export const REVIEW_HEADERS = MIGRATION_REVIEW_HEADERS

// This tool's own columns, appended after the shared 20. They carry
// information the narrower migration tool has no field for (the full
// barcode list as recorded today, every flag this run raised, and the
// complete evidence trail) without disturbing the 20 columns any
// REVIEW_HEADERS-aware consumer already parses positionally-by-name.
export const EXTENSION_HEADERS = ['current_official_name', 'barcodes', 'flags', 'evidence']

export const OUTPUT_HEADERS = [...REVIEW_HEADERS, ...EXTENSION_HEADERS]

function splitList(value) {
  return String(value ?? '')
    .split(/[|;]/)
    .map((v) => v.trim())
    .filter(Boolean)
}

/**
 * Loads a product export (CSV or JSON) and normalizes it to the ProductRow
 * shape reconcile.mjs expects, plus the extra fields (category, description,
 * prior_confidence/prior_evidence passthrough) this sheet's REVIEW_HEADERS
 * columns need. `barcodes` and `prior_barcodes` columns are pipe- or
 * semicolon-separated lists (one barcode may be a bare number, so comma is
 * deliberately not a separator).
 *
 * `current_official_name` is resolved in priority order: an explicit
 * official_name/current_official_name column (if the input already carries
 * one), else extracted from a `description`/`current_description` column
 * via lib/description.mjs (there is no `official_name` DB column in the
 * live schema -- see README.md), else blank.
 */
export function loadProducts(inputPath) {
  const text = fs.readFileSync(inputPath, 'utf8')
  const isJson = inputPath.toLowerCase().endsWith('.json')
  const rawRows = isJson ? JSON.parse(text) : parseCsv(text)
  if (!Array.isArray(rawRows)) throw new Error(`${inputPath}: JSON input must be an array of product rows`)
  return rawRows.map((row) => {
    const description = String(row.description ?? row.current_description ?? '')
    const explicitOfficialName = String(row.official_name ?? row.current_official_name ?? '').trim()
    return {
      id: row.id ?? row.product_id,
      name: String(row.name ?? row.current_name ?? row.expected_shop_name ?? '').trim(),
      officialName: explicitOfficialName || extractOfficialNameFromDescription(description),
      brand: String(row.brand ?? row.expected_brand ?? '').trim(),
      category: String(row.category ?? row.expected_category ?? '').trim(),
      description,
      barcodes: Array.isArray(row.barcodes) ? row.barcodes.map(String) : splitList(row.barcodes ?? row.expected_barcode),
      priorBarcodes: Array.isArray(row.prior_barcodes) ? row.prior_barcodes.map(String) : splitList(row.prior_barcodes),
      barcodeUpdatedAt: row.barcode_updated_at || null,
      lastVerifiedAt: row.last_verified_at || null,
      priorConfidence: String(row.prior_confidence ?? '').trim(),
      priorEvidence: String(row.prior_evidence ?? '').trim(),
    }
  })
}

function formatEvidenceList(evidence) {
  return evidence.map((e) => `${e.url} (matched: "${e.title}"; via ${e.query})`).join(' | ')
}

// review_status is derived from confidence -- the migration tool's own
// vocabulary (approved/verified/probable/hold/rejected); this workflow
// never sets 'approved' itself (that is a human action, see README.md),
// so high confidence proposes 'verified' (a human still has to move it to
// 'approved' before official-name-recertification.mjs's buildGuardedSql
// will touch it -- approved_for_apply also stays 'false' below).
function reviewStatusFor(confidence) {
  if (confidence === 'high') return 'verified'
  if (confidence === 'medium') return 'probable'
  return 'hold'
}

/**
 * Splits reconcile.mjs's evidence trail (mixed name+barcode hits, in the
 * order reconcile.mjs pushed them) into the three single-URL REVIEW_HEADERS
 * source columns: the first name-search hit, a second name-search hit from
 * an independently different domain (when one exists), and the first
 * barcode-search hit. `evidence[].query` is the tag reconcile.mjs stamped
 * on each entry (`name:...` or `barcode:...`), set from the provider's
 * `source` field -- see reconcile.mjs's SearchHit typedef.
 */
function pickSourceUrls(evidence) {
  const nameHits = evidence.filter((e) => String(e.query || '').startsWith('name:'))
  const barcodeHits = evidence.filter((e) => String(e.query || '').startsWith('barcode:'))
  const officialSourceUrl = nameHits[0]?.url || ''
  const officialDomain = (() => { try { return new URL(officialSourceUrl).hostname } catch { return officialSourceUrl } })()
  const independentSourceUrl = nameHits.find((e) => {
    const domain = (() => { try { return new URL(e.url).hostname } catch { return e.url } })()
    return e.url !== officialSourceUrl && domain !== officialDomain
  })?.url || ''
  const barcodeSourceUrl = barcodeHits[0]?.url || ''
  return { officialSourceUrl, independentSourceUrl, barcodeSourceUrl }
}

function toReviewRow(product, result) {
  const { officialSourceUrl, independentSourceUrl, barcodeSourceUrl } = pickSourceUrls(result.evidence)
  const barcodes = product.barcodes || []
  return {
    // --- the 20 shared REVIEW_HEADERS columns ---
    id: String(product.id),
    expected_shop_name: product.name,
    expected_barcode: barcodes[0] || '',
    expected_brand: product.brand || '',
    expected_category: product.category || '',
    expected_old_description: product.description || '',
    proposed_official_name: result.proposedOfficialName,
    barcode_aliases: barcodes.slice(1).join('|'),
    official_source_url: officialSourceUrl,
    independent_source_url: independentSourceUrl,
    barcode_source_url: barcodeSourceUrl,
    confidence: result.confidence,
    review_status: reviewStatusFor(result.confidence),
    unresolved_notes: result.notes,
    evidence_notes: formatEvidenceList(result.evidence),
    prior_confidence: product.priorConfidence || '',
    prior_evidence: product.priorEvidence || '',
    // A human review-and-promote step is required before any row may be
    // applied to the catalogue -- this tool never sets this true itself.
    // See README.md's "what this does not do".
    approved_for_apply: 'false',
    reviewed_by: '',
    reviewed_at_utc: '',
    // --- extension columns ---
    current_official_name: product.officialName || '',
    barcodes: barcodes.join(';'),
    flags: result.flags.join(';'),
    evidence: formatEvidenceList(result.evidence),
  }
}

async function cachedCall(cache, providerName, queryType, keyValue, fn) {
  const cacheKey = cacheKeyFor(providerName, queryType, keyValue)
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return { value: cached, cached: true }
  const value = await fn()
  cache.set(cacheKey, value)
  return { value, cached: false }
}

function buildSummary(rows, errors) {
  const byConfidence = {}
  const byFlag = {}
  const byReviewStatus = {}
  for (const row of rows) {
    byConfidence[row.confidence] = (byConfidence[row.confidence] || 0) + 1
    byReviewStatus[row.review_status] = (byReviewStatus[row.review_status] || 0) + 1
    for (const flag of row.flags ? row.flags.split(';').filter(Boolean) : []) {
      byFlag[flag] = (byFlag[flag] || 0) + 1
    }
  }
  return { total: rows.length, byConfidence, byReviewStatus, byFlag, errors: errors.length }
}

function writeXlsx(outPath, rows) {
  const xlsxDir = path.join(repoRoot, 'frontend', 'node_modules', 'xlsx')
  if (!fs.existsSync(xlsxDir)) {
    console.warn(`--xlsx requested but ${xlsxDir} was not found (expected the frontend workspace's installed xlsx package); skipping XLSX output`)
    return null
  }
  // frontend/node_modules is a junction to the main checkout's installed
  // modules (isolation protocol, plan Section 0) -- required, never
  // installed, so this never triggers `npm install` in this worktree.
  return import('node:module').then(({ createRequire }) => {
    const req = createRequire(import.meta.url)
    const XLSX = req(xlsxDir)
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: OUTPUT_HEADERS })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Review')
    const xlsxPath = outPath.replace(/\.csv$/i, '.xlsx')
    XLSX.writeFile(workbook, xlsxPath)
    return xlsxPath
  })
}

function parseArgs(argv) {
  const args = {
    provider: 'mock',
    fixtures: path.join(here, 'fixtures', 'sample-evidence'),
    cacheDir: path.join(here, '.cache'),
    delayMs: 250,
    xlsx: false,
    limit: Infinity,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--input') args.input = argv[++i]
    else if (token === '--out') args.out = argv[++i]
    else if (token === '--provider') args.provider = argv[++i]
    else if (token === '--fixtures') args.fixtures = argv[++i]
    else if (token === '--cache-dir') args.cacheDir = argv[++i]
    else if (token === '--delay-ms') args.delayMs = Number(argv[++i])
    else if (token === '--xlsx') args.xlsx = true
    else if (token === '--limit') args.limit = Number(argv[++i])
    else throw new Error(`Unknown argument: ${token}`)
  }
  if (!args.input) throw new Error('Usage: node verify-products.mjs --input <csv|json> --out <csv> [--provider mock|http] [--fixtures <dir>] [--cache-dir <dir>] [--delay-ms <n>] [--xlsx] [--limit <n>]')
  if (!args.out) throw new Error('--out is required')
  return args
}

export async function runVerification(args) {
  const products = loadProducts(args.input).slice(0, args.limit)
  const provider = args.provider === 'http' ? new HttpProvider() : new MockProvider(args.fixtures)
  const cache = new DiskCache(args.cacheDir)

  const rows = []
  const errors = []
  let cacheHits = 0
  let providerCalls = 0

  for (const product of products) {
    try {
      const nameCall = await cachedCall(cache, provider.name, 'name', `${product.id}:${product.name}`, () => provider.searchByName(product))
      if (nameCall.cached) cacheHits += 1; else { providerCalls += 1; await sleep(args.delayMs) }
      const nameHits = nameCall.value

      const barcodeHitsByBarcode = new Map()
      for (const barcode of product.barcodes) {
        const barcodeCall = await cachedCall(cache, provider.name, 'barcode', `${product.id}:${barcode}`, () => provider.searchByBarcode(barcode, product))
        if (barcodeCall.cached) cacheHits += 1; else { providerCalls += 1; await sleep(args.delayMs) }
        barcodeHitsByBarcode.set(barcode, barcodeCall.value)
      }

      const result = reconcileProduct(product, nameHits, barcodeHitsByBarcode)
      rows.push(toReviewRow(product, result))
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      errors.push({ id: product.id, error: message })
      rows.push(toReviewRow(product, {
        proposedOfficialName: '', confidence: 'low', flags: ['lookup_error'], evidence: [], notes: `lookup failed: ${message}`,
      }))
    }
  }

  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
  fs.writeFileSync(args.out, stringifyCsv(rows, OUTPUT_HEADERS), 'utf8')

  let xlsxPath = null
  if (args.xlsx) xlsxPath = await writeXlsx(args.out, rows)

  const summary = buildSummary(rows, errors)
  return { rows, errors, summary, outCsv: path.resolve(args.out), outXlsx: xlsxPath, cacheHits, providerCalls }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const result = await runVerification(args)
  console.log(JSON.stringify({
    outCsv: result.outCsv,
    outXlsx: result.outXlsx,
    providerCalls: result.providerCalls,
    cacheHits: result.cacheHits,
    summary: result.summary,
    errors: result.errors,
  }, null, 2))
}
