// Deterministic, offline provider: replays pre-recorded evidence from a
// fixtures directory instead of calling the network. Two uses:
//   1. Tests and dry runs, with hand-written fixtures.
//   2. The sample run this section's brief asks for, seeded with REAL web
//      evidence -- either replayed from the prior migration's own
//      web-verification pass (ops/product-verification/fixtures/
//      barcode-web-evidence.json, ops/product-verification/fixtures/
//      prior-recertification-6032-6104.json) or freshly gathered for this
//      section (see fixtures/sample-evidence/README.md for which is which,
//      product by product).
//
// Fixture layout: one JSON file per product id at
// `<dir>/<productId>.json`, shaped:
//   { "name": SearchHit[], "barcodes": { "<barcode>": SearchHit[] } }
// A product with no fixture file simply gets no evidence (empty arrays) --
// this is a legitimate outcome (reconcile.mjs treats it as low confidence,
// not an error), not a bug in the provider.
import fs from 'node:fs'
import path from 'node:path'

export class MockProvider {
  /** @param {string} fixturesDir */
  constructor(fixturesDir) {
    this.name = 'mock'
    this.fixturesDir = fixturesDir
  }

  loadFixture(productId) {
    const file = path.join(this.fixturesDir, `${productId}.json`)
    if (!fs.existsSync(file)) return { name: [], barcodes: {} }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      return { name: Array.isArray(parsed.name) ? parsed.name : [], barcodes: parsed.barcodes && typeof parsed.barcodes === 'object' ? parsed.barcodes : {} }
    } catch (error) {
      throw new Error(`Malformed mock fixture for product ${productId} (${file}): ${error.message}`)
    }
  }

  async searchByName(product) {
    const fixture = this.loadFixture(product.id)
    return fixture.name.map((hit) => ({ ...hit, source: hit.source || `name:${product.name}` }))
  }

  async searchByBarcode(barcode, product) {
    const fixture = this.loadFixture(product.id)
    const hits = fixture.barcodes[barcode] || fixture.barcodes[String(barcode)] || []
    return hits.map((hit) => ({ ...hit, source: hit.source || `barcode:${barcode}` }))
  }
}
