// Source lock-in for the permission gate on GET /api/products/auto-merges/:productId.
//
// This endpoint returns import_auto_merges.losing_json, which snapshotLosingRow
// fills with EVERY non-empty column of the losing import row -- including
// supplier, cost_price_usd, cost_price_khr. Its own header comment promised it
// "stays behind the same products read gate as the rest of this router", but
// the handler shipped with no gate at all, so any authenticated account (a
// POS-only cashier, a products_image_only uploader) could walk product ids and
// read cost/supplier data. This test greps the REAL shipped handler for the
// tier gate so a future edit that removes it fails here instead of silently
// re-opening the leak. Same source-lock approach as
// test-route-permissions-pure.cjs.
//
// Run (from cloudflare/): node scripts/test-auto-merges-gate-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

// Isolate the /auto-merges handler body up to the next `app.get(`/`app.post(.
const start = src.indexOf("app.get('/auto-merges/:productId'")
assert.ok(start > 0, 'the /auto-merges route must exist')
const rest = src.slice(start + 1)
const nextRoute = rest.search(/app\.(get|post|put|patch|delete)\(/)
const handler = nextRoute > 0 ? rest.slice(0, nextRoute) : rest

check('handler reads the caller user', /const user = c\.get\('user'\)/.test(handler))
check(
  'handler denies when both products and inventory tiers are none',
  /getPermissionTier\(user, 'products'\) === 'none'[\s\S]*getPermissionTier\(user, 'inventory'\) === 'none'[\s\S]*return c\.json\(\s*\{\s*error:[\s\S]*\},\s*403\s*\)/.test(handler),
)
check('the gate sits before the productId is parsed', handler.indexOf("getPermissionTier(user, 'products')") < handler.indexOf('Number(c.req.param'))

console.log(`\nALL ${passed} CHECKS PASSED`)
