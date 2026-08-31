// Regression lock: the unauthenticated /api/catalog/* storefront must stay removed.
//
// It was a second, ungated, UNBOUNDED copy of the storefront read: GET
// /api/catalog/products selected every active product (no LIMIT, no auth) and
// then fanned out ~2 chunked statements per 100 ids for branch_stock +
// product_images -- ~174 sequential D1 statements on one anonymous request,
// and it bypassed the visibility gates the real /api/portal/catalog/* route
// applies (out-of-stock hiding, portalVisibleProductFilter). Nothing in the
// frontend ever called it (the storefront uses /api/portal/catalog/*), so it
// was removed as dead + duplicative rather than gated. This test fails if
// either the route file or its mount comes back, so a future edit can't
// silently reintroduce the unauthenticated surface.
//
// Run (from cloudflare/): node scripts/test-no-ungated-catalog-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

const routeFile = path.join(__dirname, '..', 'src', 'routes', 'catalog.ts')
check('the ungated routes/catalog.ts file does not exist', !fs.existsSync(routeFile))

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8')
check("index.ts has no import of './routes/catalog'", !/from '\.\/routes\/catalog'/.test(indexSrc))
check("index.ts does not mount '/api/catalog'", !/app\.route\(\s*['"]\/api\/catalog['"]/.test(indexSrc))

// The GATED, paginated storefront route must still be present -- removing the
// duplicate must not have taken the real one with it.
const portalSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'portal.ts'), 'utf8')
check('the gated /portal/catalog storefront route still exists', /\/catalog\/products/.test(portalSrc))

console.log(`\nALL ${passed} CHECKS PASSED`)
