#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGuardedSql, parseCsv, stringifyCsv, validateReviewRows } from './official-name-recertification.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const migrationRoot = path.join(repo, 'Migration from old system')
const reconciliationFile = path.join(repo, 'cloudflare/.wrangler/tmp/legacy-sep01-import/reconciliation.json')
const importFile = path.join(migrationRoot, 'businessos-migration-aug28/products-import-NEW-from-review.csv')
const priorReviewFile = path.join(migrationRoot, 'review_official_names.csv')
const outputDir = path.join(migrationRoot, 'official-name-recertification')
const reviewFile = path.join(outputDir, 'official-name-recertification-6032-6104.csv')
const sqlFile = path.join(outputDir, 'approved-official-name-updates.sql')
const summaryFile = path.join(outputDir, 'inventory-summary.json')

for (const file of [reconciliationFile, importFile, priorReviewFile]) {
  if (!fs.existsSync(file)) throw new Error(`Missing source artifact: ${file}`)
}

const reconciliation = JSON.parse(fs.readFileSync(reconciliationFile, 'utf8'))
const candidates = reconciliation?.officialNameFill?.candidates || []
const importedProducts = parseCsv(fs.readFileSync(importFile, 'utf8'))
const priorReview = parseCsv(fs.readFileSync(priorReviewFile, 'utf8'))
const priorById = new Map(priorReview.map((row) => [Number(row.id), row]))

if (candidates.length !== 73) throw new Error(`Expected 73 official-name candidates, found ${candidates.length}`)

const rows = candidates.map((candidate) => {
  const exactMatches = importedProducts.filter((product) => String(product.name) === String(candidate.officialName)
    && String(product.barcode ?? '') === String(candidate.barcode ?? ''))
  if (!exactMatches.length) throw new Error(`No exact import evidence for product ${candidate.id}`)
  const brands = [...new Set(exactMatches.map((product) => String(product.brand ?? '')))]
  const categories = [...new Set(exactMatches.map((product) => String(product.category ?? '')))]
  if (brands.length !== 1 || categories.length !== 1) throw new Error(`Conflicting import metadata for product ${candidate.id}`)
  const prior = priorById.get(Number(candidate.id)) || {}
  return {
    id: candidate.id,
    expected_shop_name: candidate.officialName,
    expected_barcode: candidate.barcode ?? '',
    expected_brand: brands[0],
    expected_category: categories[0],
    expected_old_description: `Official Product Name:\n${candidate.officialName}`,
    proposed_official_name: prior.proposed_official_name || '',
    barcode_aliases: '',
    official_source_url: '',
    independent_source_url: '',
    barcode_source_url: '',
    confidence: 'pending',
    review_status: 'pending_recertification',
    unresolved_notes: '',
    evidence_notes: prior.note || '',
    prior_confidence: prior.confidence || '',
    prior_evidence: prior.source || '',
    approved_for_apply: 'false',
    reviewed_by: '',
    reviewed_at_utc: '',
  }
})

const validation = validateReviewRows(rows)
if (validation.errors.length) throw new Error(validation.errors.join('\n'))
const { sql } = buildGuardedSql(rows)
fs.mkdirSync(outputDir, { recursive: true })
fs.writeFileSync(reviewFile, stringifyCsv(rows), 'utf8')
fs.writeFileSync(sqlFile, sql, 'utf8')
fs.writeFileSync(summaryFile, `${JSON.stringify({
  sourceArtifacts: [reconciliationFile, importFile, priorReviewFile].map((file) => path.relative(repo, file)),
  idRange: [6032, 6104],
  rows: rows.length,
  blankBarcodes: rows.filter((row) => !row.expected_barcode).map((row) => row.id),
  blankCategories: rows.filter((row) => !row.expected_category).length,
  priorResearchCandidates: rows.filter((row) => row.proposed_official_name).length,
  approvedForApply: validation.approved.length,
  sqlMode: validation.approved.length ? 'guarded_updates' : 'safe_noop',
}, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ reviewFile, sqlFile, summaryFile, rows: rows.length, approved: validation.approved.length, warnings: validation.warnings }, null, 2))
