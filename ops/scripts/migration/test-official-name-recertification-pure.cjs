const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

;(async () => {
  const helpers = await import('./official-name-recertification.mjs')
  const rows = Array.from({ length: 73 }, (_, index) => {
    const id = 6032 + index
    const shopName = `Shop product ${id}`
    return {
      id: String(id), expected_shop_name: shopName, expected_barcode: id === 6066 ? '' : String(900000000000 + id),
      expected_brand: 'Brand', expected_category: '', expected_old_description: `Official Product Name:\n${shopName}`,
      proposed_official_name: '', barcode_aliases: '', official_source_url: '', independent_source_url: '', barcode_source_url: '',
      confidence: 'pending', review_status: 'pending_recertification', unresolved_notes: '', evidence_notes: '', prior_confidence: '',
      prior_evidence: '', approved_for_apply: 'false', reviewed_by: '', reviewed_at_utc: '',
    }
  })

  const roundTrip = helpers.parseCsv(helpers.stringifyCsv(rows))
  assert.equal(roundTrip.length, 73)
  assert.equal(roundTrip[0].expected_old_description, rows[0].expected_old_description)

  const noop = helpers.buildGuardedSql(rows)
  assert.equal(noop.validation.approved.length, 0)
  assert.match(noop.sql, /intentionally performs no updates/)
  assert.doesNotMatch(noop.sql, /UPDATE products SET/)

  const verifiedButNotApproved = structuredClone(rows)
  Object.assign(verifiedButNotApproved[0], {
    proposed_official_name: 'Verified official product', official_source_url: 'https://brand.example/product',
    independent_source_url: 'https://retailer.example/product', barcode_source_url: 'https://barcode.example/item',
    confidence: 'high', review_status: 'verified', approved_for_apply: 'false', reviewed_by: 'Reviewer', reviewed_at_utc: '2026-09-02T12:00:00Z',
  })
  const verifiedNoop = helpers.buildGuardedSql(verifiedButNotApproved)
  assert.equal(verifiedNoop.validation.approved.length, 0)
  assert.doesNotMatch(verifiedNoop.sql, /UPDATE products SET/)

  const approved = structuredClone(rows)
  Object.assign(approved[0], {
    proposed_official_name: 'Verified official product', official_source_url: 'https://brand.example/product',
    independent_source_url: 'https://retailer.example/product', barcode_source_url: 'https://barcode.example/item',
    confidence: 'high', review_status: 'approved', approved_for_apply: 'true', reviewed_by: 'Reviewer', reviewed_at_utc: '2026-09-02T12:00:00Z',
  })
  const guarded = helpers.buildGuardedSql(approved)
  assert.equal(guarded.validation.approved.length, 1)
  assert.match(guarded.sql, /WHERE id=6032/)
  assert.match(guarded.sql, /AND COALESCE\(barcode,''\)='900000006032'/)
  assert.match(guarded.sql, /AND COALESCE\(description,''\)='Official Product Name:\nShop product 6032'/)
  assert.equal((guarded.sql.match(/UPDATE products SET/g) || []).length, 1)

  const missingEvidence = structuredClone(approved)
  missingEvidence[0].official_source_url = ''
  assert.throws(() => helpers.buildGuardedSql(missingEvidence), /requires official_source_url/)

  const staleDescription = structuredClone(rows)
  staleDescription[0].expected_old_description = 'changed'
  assert.throws(() => helpers.buildGuardedSql(staleDescription), /expected_old_description must exactly equal/)

  const blankBarcodeApproved = structuredClone(rows)
  Object.assign(blankBarcodeApproved[34], {
    proposed_official_name: 'Verified unbarcoded product', official_source_url: 'https://brand.example/unbarcoded',
    independent_source_url: 'https://retailer.example/unbarcoded', confidence: 'high', review_status: 'approved',
    approved_for_apply: 'true', reviewed_by: 'Reviewer', reviewed_at_utc: '2026-09-02T12:00:00Z',
  })
  const blankGuard = helpers.buildGuardedSql(blankBarcodeApproved)
  assert.match(blankGuard.sql, /WHERE id=6066[\s\S]*AND COALESCE\(barcode,''\)=''/)

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'official-name-recert-'))
  fs.writeFileSync(path.join(temp, 'review.csv'), helpers.stringifyCsv(approved), 'utf8')
  assert.equal(helpers.parseCsv(fs.readFileSync(path.join(temp, 'review.csv'), 'utf8')).length, 73)
  fs.rmSync(temp, { recursive: true, force: true })
  console.log('official-name recertification pure tests passed')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
