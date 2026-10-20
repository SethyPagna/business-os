// Storefront edge-cache keys (6.0.889, owner 20 Oct: cache-poisoning and
// cache-busting proof). The REAL canonicalPortalQuery from routes/portal.ts:
// one parse feeds both the key and the producer; parameter order, spelling,
// case and duplicates inside a list collapse to one key; unknown or repeated
// names and oversized values are refused; keys never take the request host.
// Replaces the pre-6.0.889 contract (unknown names ignored, no
// canonicalisation, Host-derived keys, stock version in every key).
const assert = require('node:assert/strict')
const { load } = require('./test-request-body-guard-pure.cjs')

async function main() {
  const portal = load('routes/portal.ts')
  const { canonicalPortalQuery: canon, portalEdgeKey, PORTAL_SEARCH_CACHE_PARAMS, PORTAL_QUERY_MAX_CHARS } = portal
  const key = (route, search) => {
    const result = canon(route, search)
    assert.equal(result.ok, true, `${route}?${search}: ${result.reason}`)
    return result.search
  }
  const refused = (route, search, pattern) => {
    const result = canon(route, search)
    assert.equal(result.ok, false, `${route}?${search} must be refused`)
    assert.match(result.reason, pattern)
  }

  // Parameter order and spelling.
  assert.equal(key('search', 'query=cream&page=2&brand=A'), key('search', 'brand=A&page=2&query=cream'))
  assert.equal(key('search', 'q=cream'), key('search', 'query=cream'), 'q folds into query')
  assert.equal(key('search', 'branch_id=2'), key('search', 'branchId=2'), 'branch_id folds into branchId')
  // Values with one meaning share one key (cache-busting).
  for (const [left, right] of [
    ['page=1', ''], ['page=01', ''], ['pageSize=50', ''], ['pageSize=020', 'pageSize=20'],
    ['brand=Dior,Chanel', 'brand=chanel,dior'], ['brand=dior,DIOR,all', 'brand=dior'],
    ['category=Skin', 'category=skin'], ['branchId=2,1,2', 'branchId=1,2'],
    ['stockState=low_stock,IN_STOCK,bogus', 'stockState=in_stock,low_stock'], ['stockState=bogus', ''],
    ['initial=a', 'initial=A'], ['initial=all', ''], ['initial=', ''],
    ['promo=PROMOTED', 'promo=promoted'], ['promo=rule:007', 'promo=rule:7'], ['promo=junk', ''],
    ['view=brand&sort=featured', ''], ['view=Category', 'view=category'], ['view=evil', ''], ['sort=evil', ''],
    ['query=%20serum%20%20cream%20', 'query=serum+cream'], ['query=', ''], ['productId=007', 'productId=7'],
  ]) assert.equal(key('search', left), key('search', right), `${left} == ${right}`)
  // Values with different meaning keep different keys.
  for (const [left, right] of [
    ['page=2', 'page=3'], ['pageSize=20', 'pageSize=100'], ['query=cream', 'query=serum'],
    ['brand=a', 'category=a'], ['branchId=1', 'branchId=1,2'], ['stockState=in_stock', 'stockState=low_stock'],
    ['initial=A', 'initial=B'], ['promo=promoted', 'promo=rule:1'], ['productId=1', 'productId=2'],
    ['view=category', 'view=all'], ['sort=price_asc', 'sort=price_desc'],
  ]) assert.notEqual(key('search', left), key('search', right), `${left} != ${right}`)
  // The producer receives exactly the canonical object.
  assert.deepEqual(canon('search', 'q=+Serum++Cream&branch_id=3,1&brand=B,a&page=02').params,
    { query: 'Serum Cream', branchId: '1,3', brand: 'a,b', page: '2' })

  // Unknown, repeated and oversized input is refused before any I/O.
  for (const route of ['config', 'bootstrap', 'meta', 'products', 'promotions']) {
    assert.equal(key(route, ''), '')
    refused(route, 'page=2', /unknown parameter page/)
    refused(route, '_v=attacker', /unknown parameter _v/)
  }
  refused('search', 'tracking=1', /unknown parameter tracking/)
  refused('search', '_v=attacker', /unknown parameter _v/)
  refused('search', 'Query=x', /unknown parameter Query/)
  refused('search', 'page=1&page=2', /repeated parameter page/)
  refused('search', 'query=a&q=b', /both set/)
  refused('search', 'branchId=1&branch_id=2', /both set/)
  refused('search', 'page=0', /page/)
  refused('search', 'page=10001', /page/)
  refused('search', 'page=2abc', /page/)
  refused('search', 'pageSize=101', /pageSize/)
  refused('search', 'branchId=1,x', /branchId/)
  refused('search', 'productId=-3', /productId/)
  refused('search', 'initial=ABCDEFGHI', /initial/)
  refused('search', 'query=' + 'x'.repeat(PORTAL_QUERY_MAX_CHARS + 1), /query too long/)
  assert.equal(canon('search', 'query=' + 'x'.repeat(PORTAL_QUERY_MAX_CHARS)).ok, true)
  refused('search', 'brand=' + Array.from({ length: 21 }, (_, i) => 'b' + i).join(','), /too many/)
  refused('search', 'brand=' + 'b'.repeat(101), /too long/)
  refused('search', 'query=x&brand=' + 'b,'.repeat(600), /too long/)
  // Every name the producer reads is accepted.
  for (const name of PORTAL_SEARCH_CACHE_PARAMS) assert.equal(canon('search', `${name}=1`).ok, true, name)

  // Keys: origin from configuration (never the Host header), fixed path, version generation.
  const k1 = portalEdgeKey('https://shop.test/', 'body', 'search', 'query=a', 'portal-body-v2:k2:1:k2:2')
  assert.equal(k1.url, 'https://shop.test/__portal-edge/body/search?query=a&_v=portal-body-v2%3Ak2%3A1%3Ak2%3A2')
  assert.equal([...k1.headers.keys()].length, 0, 'no request header (cookie, authorization) reaches the cache key')
  assert.notEqual(portalEdgeKey('https://shop.test', 'stock', 'search', 'query=a', 'v').url, portalEdgeKey('https://shop.test', 'body', 'search', 'query=a', 'v').url)
  assert.notEqual(portalEdgeKey('https://shop.test', 'body', 'search', '', 'v1').url, portalEdgeKey('https://shop.test', 'body', 'search', '', 'v2').url)
  assert.equal(new URL(portalEdgeKey('not a url', 'body', 'config', '', 'v').url).hostname, 'storefront.invalid')
  // A crafted query value cannot smuggle a second _v into the key.
  const smuggled = canon('search', 'query=' + encodeURIComponent('x&_v=old'))
  assert.equal(new URL(portalEdgeKey('https://shop.test', 'body', 'search', smuggled.search, 'new').url).searchParams.getAll('_v').join(), 'new')

  console.log('PASS portal cache keys: canonical order/spelling/values, unknown/repeated/oversized refused, host-independent versioned keys')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
