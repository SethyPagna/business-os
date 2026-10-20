// The Website Editor preview searches through the admin portal transport. The
// Worker refuses search text over PORTAL_QUERY_MAX_CHARS with a 400, so the
// preview must bound the text the same way the public storefront does
// (6.0.896, security review P3-6) instead of failing on a long paste.
//
// Run: node tests/portalPreviewSearchBound.test.ts
import assert from 'node:assert/strict'

const requested: string[] = []
globalThis.fetch = (async (input: RequestInfo | URL) => {
  requested.push(String(input))
  return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

const { searchPortalCatalogProducts } = await import('../src/api/portalTransport.ts')
const { PORTAL_SEARCH_MAX_CHARS } = await import('../src/api/portalPublicTransport.ts')

const pasted = 'ថែរក្សាស្បែក '.repeat(30)
assert.ok(pasted.length > PORTAL_SEARCH_MAX_CHARS)
await searchPortalCatalogProducts({ query: pasted, page: 2 })
const sent = new URL(requested[0], 'https://admin.test').searchParams
assert.equal(sent.get('query'), pasted.slice(0, PORTAL_SEARCH_MAX_CHARS), 'the preview sends the bounded text')
assert.equal(sent.get('page'), '2', 'other parameters pass through unchanged')

await searchPortalCatalogProducts({ query: 'serum' })
assert.equal(new URL(requested[1], 'https://admin.test').searchParams.get('query'), 'serum', 'short text is untouched')

console.log('PASS editor preview search: text bounded to the Worker limit like the storefront')
