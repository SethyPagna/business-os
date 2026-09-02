// Real web-search provider. Uses Node's built-in fetch (Node >=18, nothing
// to install) against a search API you configure -- NO KEY IS BAKED IN OR
// COMMITTED HERE. Configure via environment variables:
//
//   PRODUCT_VERIFY_SEARCH_KEY      required -- your search API key
//   PRODUCT_VERIFY_SEARCH_TYPE     optional -- 'serper' (default) | 'google-cse' | 'bing'
//   PRODUCT_VERIFY_SEARCH_CSE_ID   required only for google-cse (Custom Search Engine id)
//
// 'serper' (https://serper.dev) is the default because it needs only one
// key and returns clean JSON; it is NOT an endorsement, just a reasonable
// default. Any of the three can be swapped for another provider by adding a
// branch to `runQuery` below -- the rest of this file (rate limiting,
// caching, match assessment) does not change.
//
// Every raw result is passed through lib/matchAssessment.mjs's assessHit()
// to get the matchesBrand/matchesProduct/matchesVariant judgment
// reconcile.mjs needs -- this provider itself never asserts a match, it
// only fetches and hands off to that shared, testable heuristic.
import { assessHit } from '../lib/matchAssessment.mjs'

const ENDPOINTS = {
  serper: 'https://google.serper.dev/search',
  'google-cse': 'https://www.googleapis.com/customsearch/v1',
  bing: 'https://api.bing.microsoft.com/v7.0/search',
}

async function runQuery(query, { type, key, cseId }) {
  if (type === 'serper') {
    const response = await fetch(ENDPOINTS.serper, {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query }),
    })
    if (!response.ok) throw new Error(`serper search failed: ${response.status} ${await response.text().catch(() => '')}`)
    const body = await response.json()
    return (body.organic || []).map((r) => ({ url: r.link, title: r.title, snippet: r.snippet || '' }))
  }
  if (type === 'google-cse') {
    if (!cseId) throw new Error('PRODUCT_VERIFY_SEARCH_CSE_ID is required for google-cse')
    const url = new URL(ENDPOINTS['google-cse'])
    url.searchParams.set('key', key)
    url.searchParams.set('cx', cseId)
    url.searchParams.set('q', query)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`google-cse search failed: ${response.status} ${await response.text().catch(() => '')}`)
    const body = await response.json()
    return (body.items || []).map((r) => ({ url: r.link, title: r.title, snippet: r.snippet || '' }))
  }
  if (type === 'bing') {
    const url = new URL(ENDPOINTS.bing)
    url.searchParams.set('q', query)
    const response = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key } })
    if (!response.ok) throw new Error(`bing search failed: ${response.status} ${await response.text().catch(() => '')}`)
    const body = await response.json()
    return (body.webPages?.value || []).map((r) => ({ url: r.url, title: r.name, snippet: r.snippet || '' }))
  }
  throw new Error(`Unknown PRODUCT_VERIFY_SEARCH_TYPE: ${type}`)
}

export class HttpProvider {
  constructor(env = process.env) {
    this.name = 'http'
    this.type = env.PRODUCT_VERIFY_SEARCH_TYPE || 'serper'
    this.key = env.PRODUCT_VERIFY_SEARCH_KEY || ''
    this.cseId = env.PRODUCT_VERIFY_SEARCH_CSE_ID || ''
    if (!this.key) {
      throw new Error(
        'HttpProvider requires PRODUCT_VERIFY_SEARCH_KEY to be set (and PRODUCT_VERIFY_SEARCH_CSE_ID too, for google-cse). '
        + 'No key is stored in this repo -- set it in your shell environment before running verify-products.mjs --provider http.',
      )
    }
  }

  async searchByName(product) {
    const query = `${product.brand || ''} ${product.name}`.trim()
    const raw = await runQuery(query, this)
    return raw.map((hit) => ({ ...hit, ...assessHit(product, hit), source: `name:${query}` }))
  }

  async searchByBarcode(barcode, product) {
    const raw = await runQuery(barcode, this)
    return raw.map((hit) => ({ ...hit, ...assessHit(product, hit), source: `barcode:${barcode}` }))
  }
}
