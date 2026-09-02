import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileProduct } from './reconcile.mjs'
import { classifyBarcode, gtinCheckDigitValid, canonicalBarcodeKey, dedupeBarcodes, sameBarcodeSet } from './lib/barcode.mjs'

function nameHit({ domain, matchesBrand = true, matchesProduct = true, matchesVariant = true, proposedName = 'Elixir The Serum', source }) {
  return {
    url: `https://${domain}/product`,
    title: proposedName,
    proposedName,
    matchesBrand,
    matchesProduct,
    matchesVariant,
    source,
  }
}

// --- The agreement/disagreement matrix (plan Section 7, step 5) -----------

test('name + barcode agree -> high confidence, barcode listed as corroborating evidence', () => {
  const product = { id: 1, name: 'Elixir The Serum', brand: 'Shiseido', barcodes: ['4909978282509'] }
  const nameHits = [nameHit({ domain: 'shiseido.com' }), nameHit({ domain: 'sundrug-online.com' })]
  const barcodeHits = new Map([['4909978282509', [nameHit({ domain: 'sundrug-online.com', source: 'barcode:4909978282509' })]]])
  const result = reconcileProduct(product, nameHits, barcodeHits)
  assert.equal(result.confidence, 'high')
  assert.equal(result.proposedOfficialName, 'Elixir The Serum')
  assert.equal(result.flags.includes('junk_barcode'), false)
  assert.ok(result.evidence.some((e) => e.query.startsWith('barcode:')))
  assert.ok(result.evidence.length >= 3)
})

test('name agrees, barcode is junk ("0") -> medium, junk_barcode flagged, never high', () => {
  const product = { id: 2, name: 'Aveeno Eye Cream 14ml', brand: 'Aveeno', barcodes: ['0'] }
  const nameHits = [nameHit({ domain: 'walmart.com', proposedName: 'Aveeno Absolutely Ageless Eye Cream 14ml' }), nameHit({ domain: 'target.com', proposedName: 'Aveeno Absolutely Ageless Eye Cream 14ml' })]
  const result = reconcileProduct(product, nameHits, new Map())
  assert.equal(result.confidence, 'medium')
  assert.ok(result.flags.includes('junk_barcode'))
  assert.equal(result.flags.includes('multi_barcode'), false)
})

test('name agrees, barcode points to a sibling variant -> medium (lowered, not overridden), name_barcode_conflict flagged', () => {
  const product = { id: 3, name: 'Clinique Clarifying Lotion 2 200ml', brand: 'Clinique', barcodes: ['020714462789'] }
  const nameHits = [
    nameHit({ domain: 'clinique.com', proposedName: 'Clinique Clarifying Lotion 2 200ml' }),
    nameHit({ domain: 'sephora.com', proposedName: 'Clinique Clarifying Lotion 2 200ml' }),
  ]
  // The barcode's own web evidence agrees on brand+product line but for
  // "Lotion 4", not "Lotion 2" -- same product line, different variant.
  const barcodeHits = new Map([['020714462789', [nameHit({
    domain: 'iciparisxl.be', proposedName: 'Clinique Clarifying Lotion 4 200ml', matchesVariant: false, source: 'barcode:020714462789',
  })]]])
  const result = reconcileProduct(product, nameHits, barcodeHits)
  assert.equal(result.confidence, 'medium')
  assert.ok(result.flags.includes('name_barcode_conflict'))
  // Strong name evidence is not thrown away just because the barcode disagreed.
  assert.equal(result.proposedOfficialName, 'Clinique Clarifying Lotion 2 200ml')
})

test('barcode-only match (no independent name agreement) -> low, never high', () => {
  const product = { id: 4, name: 'Some Obscure Item', brand: 'Obscure', barcodes: ['4909978224479'] }
  const barcodeHits = new Map([['4909978224479', [
    nameHit({ domain: 'ainz-tulpe.jp', proposedName: 'HAKU Melanofocus IV 45g', source: 'barcode:4909978224479' }),
  ]]])
  const result = reconcileProduct(product, [], barcodeHits)
  assert.equal(result.confidence, 'low')
  assert.notEqual(result.confidence, 'high')
})

test('conflict: only a single source backs the name, and the barcode belongs to a different product -> low', () => {
  const product = { id: 5, name: 'Ambiguous Product X', brand: 'BrandX', barcodes: ['5056446657228'] }
  // Only one independent source ever confirms the product line, so name
  // agreement never reaches the 2-domain bar.
  const nameHits = [nameHit({ domain: 'siteA.example', proposedName: 'Ambiguous Product X' })]
  // The barcode resolves, but to an entirely different brand/product --
  // it does not corroborate this row at all.
  const barcodeHits = new Map([['5056446657228', [nameHit({ domain: 'siteC.example', proposedName: 'Unrelated Product Y', matchesBrand: false, matchesProduct: false, source: 'barcode:5056446657228' })]]])
  const result = reconcileProduct(product, nameHits, barcodeHits)
  assert.equal(result.confidence, 'low')
  assert.ok(result.flags.includes('shared_barcode'))
})

test('multi-barcode with one junk -> multi_barcode + junk_barcode flagged, real barcode still corroborates to high', () => {
  const product = { id: 6, name: 'Advanced Clinicals Vitamin C Serum 52ml', brand: 'Advanced Clinicals', barcodes: ['0819265008016', '0'] }
  const nameHits = [nameHit({ domain: 'iherb.com', proposedName: 'Advanced Clinicals Vitamin C Serum 52ml' }), nameHit({ domain: 'walmart.com', proposedName: 'Advanced Clinicals Vitamin C Serum 52ml' })]
  const barcodeHits = new Map([['0819265008016', [nameHit({ domain: 'walmart.com', proposedName: 'Advanced Clinicals Vitamin C Serum 52ml', source: 'barcode:0819265008016' })]]])
  const result = reconcileProduct(product, nameHits, barcodeHits)
  assert.ok(result.flags.includes('multi_barcode'))
  assert.ok(result.flags.includes('junk_barcode'))
  assert.equal(result.confidence, 'high')
})

test('changed barcode: current barcode differs from the prior verification artifact -> barcode_changed flagged', () => {
  const product = {
    id: 7, name: 'Aveeno Restorative Night Cream', brand: 'Aveeno',
    barcodes: ['381371163779'], priorBarcodes: ['0'],
  }
  const nameHits = [nameHit({ domain: 'karewell.com', proposedName: 'Aveeno Restorative Night Cream' }), nameHit({ domain: 'walgreens.com', proposedName: 'Aveeno Restorative Night Cream' })]
  const barcodeHits = new Map([['381371163779', [nameHit({ domain: 'karewell.com', proposedName: 'Aveeno Restorative Night Cream', source: 'barcode:381371163779' })]]])
  const result = reconcileProduct(product, nameHits, barcodeHits)
  assert.ok(result.flags.includes('barcode_changed'))
  assert.equal(result.confidence, 'high')
})

test('barcode not changed when it only differs by leading-zero padding', () => {
  const product = { id: 8, name: 'Sample', barcodes: ['0819265008016'], priorBarcodes: ['819265008016'] }
  const result = reconcileProduct(product, [], new Map())
  assert.equal(result.flags.includes('barcode_changed'), false)
})

// --- Additional coverage: variant ambiguity, no evidence at all -----------

test('variant_ambiguous: name sources agree on the product line but split on variant, with no single variant winning 2 independent sources', () => {
  const product = { id: 9, name: 'YSL Rouge Pur Couture Caring Satin', brand: 'YSL', barcodes: [] }
  const nameHits = [
    nameHit({ domain: 'yslbeauty.com', proposedName: 'YSL Rouge Pur Couture Caring Satin N1', matchesVariant: false }),
    nameHit({ domain: 'sephora.com', proposedName: 'YSL Rouge Pur Couture Caring Satin N5', matchesVariant: false }),
  ]
  const result = reconcileProduct(product, nameHits, new Map())
  assert.ok(result.flags.includes('variant_ambiguous'))
  assert.equal(result.confidence, 'medium')
})

test('no evidence at all -> low confidence, empty evidence, proposed name falls back to current name', () => {
  const product = { id: 10, name: 'Nothing Found Product', officialName: '', barcodes: [] }
  const result = reconcileProduct(product, [], new Map())
  assert.equal(result.confidence, 'low')
  assert.equal(result.proposedOfficialName, 'Nothing Found Product')
  assert.equal(result.evidence.length, 0)
  assert.ok(result.flags.includes('junk_barcode'))
})

test('empty barcode list does not set multi_barcode', () => {
  const product = { id: 11, name: 'No barcode product', barcodes: [] }
  const result = reconcileProduct(product, [], new Map())
  assert.equal(result.flags.includes('multi_barcode'), false)
  assert.ok(result.flags.includes('junk_barcode'))
})

// --- lib/barcode.mjs -------------------------------------------------------

test('classifyBarcode: blank, zero, and short barcodes are junk', () => {
  assert.equal(classifyBarcode('').isJunk, true)
  assert.equal(classifyBarcode('   ').isJunk, true)
  assert.equal(classifyBarcode('0').isJunk, true)
  assert.equal(classifyBarcode('12').isJunk, true)
  assert.equal(classifyBarcode('0').reason, 'zero')
  assert.equal(classifyBarcode('12').reason, 'too_short')
})

test('classifyBarcode: non-numeric placeholder SKUs are junk', () => {
  const result = classifyBarcode('arigrande10ml')
  assert.equal(result.isJunk, true)
  assert.equal(result.reason, 'non_numeric')
})

test('classifyBarcode: valid vs invalid GTIN check digits, verified against the prior migration\'s 15 real web-checked barcodes', () => {
  const knownValid = ['381371163816', '381371163779', '3522931005024', '5056446657228', '3380810378863', '020714215552', '851212151192', '192250042784', '4909978282509', '4909978224479', '194250053555']
  const knownInvalid = ['31458918', '112158815142', '297161516625', '165125209512']
  for (const code of knownValid) {
    const result = classifyBarcode(code)
    assert.equal(result.isJunk, false, `${code} should classify as a valid GTIN`)
    assert.equal(result.reason, 'valid_gtin')
  }
  for (const code of knownInvalid) {
    const result = classifyBarcode(code)
    assert.equal(result.isJunk, true, `${code} should classify as an invalid-check-digit GTIN`)
    assert.equal(result.reason, 'invalid_check_digit')
  }
})

test('gtinCheckDigitValid rejects non-digit and wrong-length input', () => {
  assert.equal(gtinCheckDigitValid('abc12345'), false)
  assert.equal(gtinCheckDigitValid('123456789'), false) // 9 digits, not a GTIN length
})

test('canonicalBarcodeKey strips one leading zero pad but leaves genuinely different codes distinct', () => {
  assert.equal(canonicalBarcodeKey('0819265008016'), canonicalBarcodeKey('819265008016'))
  assert.notEqual(canonicalBarcodeKey('689304077057'), canonicalBarcodeKey('689304189934'))
})

test('dedupeBarcodes collapses leading-zero duplicates and preserves first-seen display form', () => {
  const result = dedupeBarcodes(['0819265008016', '819265008016', ''])
  assert.deepEqual(result, ['0819265008016'])
})

test('sameBarcodeSet ignores order and leading-zero padding', () => {
  assert.equal(sameBarcodeSet(['819265008016'], ['0819265008016']), true)
  assert.equal(sameBarcodeSet(['a', 'b'], ['b', 'a']), true)
  assert.equal(sameBarcodeSet(['a'], ['a', 'b']), false)
})
