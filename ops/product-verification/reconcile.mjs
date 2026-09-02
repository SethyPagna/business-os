// Pure reconciliation logic for the product web-verification workflow.
// No I/O, no network, no filesystem -- takes a product row plus the search
// hits already collected for it (by name, and separately by each barcode)
// and returns a proposed official name, a confidence tier, flags, and the
// evidence trail. verify-products.mjs is the only caller that touches a
// network or a provider; everything decided here is deterministic given its
// inputs, which is what makes it independently testable (reconcile.test.mjs)
// and auditable by a human reviewer without re-running any search.
//
// Standing rule this module encodes (see the coordinated plan, Section 7,
// and the user's product-web-verification-barcode-and-name memory): the
// NAME is primary evidence, the BARCODE is corroborating evidence only.
// Concretely:
//   - A barcode can raise a strong name match from medium to high, or lower
//     it from high to medium when it points somewhere else -- but a barcode
//     match alone, with no independent name agreement, never reaches high.
//   - "Independent" means distinct source domains, not distinct URLs on the
//     same retailer.

import { classifyBarcode, dedupeBarcodes, sameBarcodeSet } from './lib/barcode.mjs'

/** @typedef {'high'|'medium'|'low'} Confidence */

/**
 * @typedef {Object} ProductRow
 * @property {string|number} id
 * @property {string} name                 current catalog display name
 * @property {string} [officialName]        current official_name value, if any (usually blank -- no such column exists in the live schema yet; see ops/product-verification/README.md)
 * @property {string} [brand]
 * @property {string[]} [barcodes]          every barcode currently on record for this product (0, 1, or many)
 * @property {string[]} [priorBarcodes]     barcode(s) on record at the last verification pass, for barcode_changed detection
 * @property {string|null} [lastVerifiedAt]
 */

/**
 * @typedef {Object} SearchHit
 * @property {string} url
 * @property {string} title                 the source's own page title (kept for the evidence trail)
 * @property {string} [proposedName]         the canonical product name this source asserts (brand + product + variant, as the source states it) -- used for majority-vote naming; falls back to `title` when absent
 * @property {boolean} matchesBrand          this source is about the same brand
 * @property {boolean} matchesProduct        this source is about the same product line (brand + core product), independent of variant
 * @property {boolean} matchesVariant        this source is about the exact same variant (size/shade/set) as the row's current name implies
 * @property {string} [source]               free-form: which query produced this hit (e.g. "name:Elixir The Serum" or "barcode:4909978282509") -- verify-products.mjs sets this; reconcile.mjs also derives it from the map key when absent
 */

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return String(url || '').trim().toLowerCase()
  }
}

function normalizeNameForVote(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Picks the proposed official name by majority vote across the hits that
 * agree on brand+product (and, when available, on variant): the most
 * frequent distinct `proposedName` wins; ties break on the lexicographically
 * first domain so the result is deterministic and reproducible run to run.
 * Falls back to the product's current name when there is no usable hit.
 */
function pickProposedName(hits, product) {
  if (!hits.length) return product.name || ''
  const votes = new Map() // normalized name -> { display, domains: Set }
  for (const hit of hits) {
    const display = String(hit.proposedName || hit.title || '').trim()
    if (!display) continue
    const key = normalizeNameForVote(display)
    if (!votes.has(key)) votes.set(key, { display, domains: new Set() })
    votes.get(key).domains.add(domainOf(hit.url))
  }
  if (!votes.size) return product.name || ''
  const ranked = [...votes.entries()].sort((a, b) => {
    const byCount = b[1].domains.size - a[1].domains.size
    if (byCount !== 0) return byCount
    const domainsA = [...a[1].domains].sort()[0] || ''
    const domainsB = [...b[1].domains].sort()[0] || ''
    return domainsA < domainsB ? -1 : domainsA > domainsB ? 1 : 0
  })
  return ranked[0][1].display
}

/**
 * @param {ProductRow} product
 * @param {SearchHit[]} nameHits          hits collected from the name search(es)
 * @param {Map<string, SearchHit[]>} barcodeHitsByBarcode  hits collected per barcode search, keyed by the raw barcode string
 * @returns {{
 *   productId: string|number,
 *   proposedOfficialName: string,
 *   confidence: Confidence,
 *   flags: string[],
 *   evidence: Array<{url: string, title: string, query: string}>,
 *   notes: string,
 * }}
 */
export function reconcileProduct(product, nameHits = [], barcodeHitsByBarcode = new Map()) {
  const flags = new Set()
  const evidence = []
  const noteParts = []

  const barcodes = dedupeBarcodes(product.barcodes)
  const classifications = barcodes.map((barcode) => classifyBarcode(barcode))
  const realBarcodes = barcodes.filter((_, index) => !classifications[index].isJunk)

  if (barcodes.length > 1) flags.add('multi_barcode')
  if (barcodes.length === 0 || classifications.some((c) => c.isJunk)) flags.add('junk_barcode')

  if (Array.isArray(product.priorBarcodes) && product.priorBarcodes.length
    && !sameBarcodeSet(product.priorBarcodes, barcodes)) {
    flags.add('barcode_changed')
    noteParts.push(`barcode changed since last verification (was ${product.priorBarcodes.join(' | ') || '(none)'}, now ${barcodes.join(' | ') || '(none)'})`)
  }

  // --- Name-side agreement -------------------------------------------------
  const goodNameHits = nameHits.filter((hit) => hit.matchesBrand && hit.matchesProduct)
  const nameDomains = new Set(goodNameHits.map((hit) => domainOf(hit.url)))
  const nameConfirmed = nameDomains.size >= 2

  const variantAgreedHits = goodNameHits.filter((hit) => hit.matchesVariant)
  const variantDomains = new Set(variantAgreedHits.map((hit) => domainOf(hit.url)))
  const variantConfirmed = variantDomains.size >= 2

  if (nameConfirmed && !variantConfirmed) {
    const distinctVariantNames = new Set(
      goodNameHits.map((hit) => normalizeNameForVote(hit.proposedName || hit.title)).filter(Boolean),
    )
    if (distinctVariantNames.size > 1) {
      flags.add('variant_ambiguous')
      noteParts.push('name sources agree on the product line but disagree on the exact variant')
    }
  }

  for (const hit of goodNameHits) {
    evidence.push({ url: hit.url, title: hit.title, query: hit.source || `name:${product.name}` })
  }

  // --- Barcode-side corroboration -------------------------------------------
  let barcodeCorroborates = false
  let barcodeConflicts = false
  let barcodeShared = false
  for (const barcode of realBarcodes) {
    const hits = barcodeHitsByBarcode.get(barcode) || []
    if (!hits.length) continue
    const agreeingHits = hits.filter((hit) => hit.matchesBrand && hit.matchesProduct)
    if (agreeingHits.length) {
      barcodeCorroborates = true
      for (const hit of agreeingHits) evidence.push({ url: hit.url, title: hit.title, query: hit.source || `barcode:${barcode}` })
      if (agreeingHits.some((hit) => !hit.matchesVariant)) {
        barcodeConflicts = true
        noteParts.push(`barcode ${barcode} corroborates the product line but points to a different variant/size`)
      }
    } else {
      // The barcode has web results, but none of them describe this
      // product at all -- the code is registered to something else
      // (shared/foreign barcode), not corroborating evidence.
      barcodeShared = true
      for (const hit of hits.slice(0, 3)) evidence.push({ url: hit.url, title: hit.title, query: hit.source || `barcode:${barcode}` })
    }
  }
  if (barcodeShared) {
    flags.add('shared_barcode')
    noteParts.push('at least one barcode\'s web results describe a different product entirely')
  }
  if (barcodeConflicts) flags.add('name_barcode_conflict')

  // --- Confidence ------------------------------------------------------------
  /** @type {Confidence} */
  let confidence
  if (!nameConfirmed) {
    // Covers: no name evidence, a single-source name match, and a
    // barcode-only match with no independent name agreement -- none of
    // these ever reach high, per the standing rule.
    confidence = 'low'
    noteParts.push(nameDomains.size === 1
      ? 'only one independent source confirms the name; a second is required for medium/high'
      : 'no independent source confirms the name')
  } else if (barcodeConflicts) {
    // Strong name match, but the barcode disagrees on variant: lowered,
    // not overridden -- the name evidence is still real evidence.
    confidence = 'medium'
    noteParts.push('name is independently confirmed but the barcode disagreement holds confidence at medium')
  } else if (barcodeCorroborates) {
    confidence = 'high'
    noteParts.push(`name confirmed by ${nameDomains.size} independent sources and corroborated by barcode`)
  } else {
    // Name confirmed, but no real barcode corroborates it -- junk/shared/
    // absent barcode, or a real barcode with no web results at all.
    confidence = 'medium'
    noteParts.push(`name confirmed by ${nameDomains.size} independent sources; barcode did not corroborate (${
      barcodes.length === 0 ? 'no barcode on record' : realBarcodes.length === 0 ? 'only junk barcodes on record' : 'no matching web evidence for the barcode'
    })`)
  }

  const proposedOfficialName = nameConfirmed ? pickProposedName(goodNameHits, product) : (product.officialName || product.name || '')

  return {
    productId: product.id,
    proposedOfficialName,
    confidence,
    flags: [...flags],
    evidence,
    notes: noteParts.join('; '),
  }
}
