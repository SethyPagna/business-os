// Regression lock for the C-series leak scope on the CUSTOMER-FACING portal.
// GET /membership/:membershipNumber is the anonymous purchase-history endpoint
// a customer reaches with only their membership number. Three things it must
// never do, each proven here against the REAL shipped handler run on real
// in-memory SQLite with every migration applied:
//
//   1. Return ANOTHER registered customer's sales/returns. The handler ORs a
//      name-match clause into the customer_id scope so a walk-in receipt
//      recorded by name still shows up -- but the name clause must be scoped
//      to UNLINKED rows (customer_id IS NULL), or two customers who share a
//      display name leak each other's linked purchase history (worse when the
//      looked-up customer has a blank phone, which self-disables the sales
//      phone guard, and the returns table has no phone column at all).
//   2. Expose the staff-only `customers.notes` field. It is written only by
//      the admin Contacts tab and must never reach a customer surface.
//   3. Expose `review_note` / `reviewed_by_name` on share submissions -- the
//      internal moderation note and the staff member who reviewed it.
//
// Same harness approach as test-portal-membership-redaction-pure.cjs.
// Run (from cloudflare/): node scripts/test-portal-membership-crosscustomer-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return outputText
}

function loadReal(relPath, requireOverrides = {}) {
  const outputText = transpile(relPath)
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
    return moduleObj.exports
  } finally {
    Module._load = originalLoad
  }
}

const portalRoute = loadReal('routes/portal.ts', {
  '../index': {},
  '../lib/db': { getDb: () => db },
  '../lib/sqlBinding': { buildInClause: () => '', inlineIntegerIds: () => '', selectInChunks: async () => [] },
  '../lib/auth': { requireAuth: async (_c, next) => next() },
  '../lib/permissions': { hasPermission: () => true },
  '../lib/audit': { audit: async () => {} },
  '../lib/cache': { cachedJsonResponse: async (_r, _c, _v, _t, p) => p(), getVersionWithFallback: async () => '0' },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  '../lib/promotionRulesSql': { loadActivePromotionRules: async () => [], productPromotedSql: () => '0', productDiscountActiveSql: () => '0', anyRuleAppliesSql: () => '0', singleRuleAppliesSql: () => '0' },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' },
  '../lib/fileAssets': { buildUniqueStoredName: (n) => n },
  '../lib/media': { sanitizeMediaList: (l) => l },
  '../lib/uploadSecurity': { detectBufferKind: () => null },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/portalAi': { generatePortalAiResponse: async () => ({}), getPortalAiUsageStatus: () => ({}) },
  '../lib/searchMatch': {},
  '../lib/familyPagination': { paginateProductFamilies: async () => ({ items: [], total: 0 }) },
  '../lib/importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3, ADMIN_MAX_IMAGES_PER_PRODUCT: 5 },
})

const app = portalRoute.default
assert.strictEqual(typeof app?.request, 'function', 'portal.ts must default-export the Hono app')

const SHARED_NAME = 'Sophea Test'
const STAFF_NOTE = 'INTERNAL: pays late, watch credit'
const REVIEW_NOTE = 'INTERNAL: screenshot looked doctored'
const REVIEWER = 'Manager Dara'

// Customer A -- the one being looked up. Blank phone on purpose: that is what
// self-disables the sales name-match phone guard, the worst case.
db.prepare(`
  INSERT INTO customers (id, name, membership_number, phone, notes, created_at)
  VALUES (1, @name, 'GOLD-A', '', @notes, '2026-08-01 00:00:00')
`).run({ name: SHARED_NAME, notes: STAFF_NOTE })

// Customer B -- a DIFFERENT registered customer who happens to share the name.
db.prepare(`
  INSERT INTO customers (id, name, membership_number, phone, created_at)
  VALUES (2, @name, 'GOLD-B', '099 888 777', '2026-08-01 00:00:00')
`).run({ name: SHARED_NAME })

// B's sale and return, both explicitly LINKED to customer_id = 2.
db.prepare(`
  INSERT INTO sales (id, receipt_number, customer_id, customer_name, sale_status, total_usd, total_khr, created_at)
  VALUES (1, 'R-CUSTOMER-B-SECRET', 2, @name, 'completed', 999.99, 4099959, '2026-08-15 09:00:00')
`).run({ name: SHARED_NAME })
db.prepare(`
  INSERT INTO sale_items (id, sale_id, product_name, quantity, total_usd)
  VALUES (1, 1, 'B private item', 3, 999.99)
`).run({})
db.prepare(`
  INSERT INTO returns (id, return_number, customer_id, customer_name, status, total_refund_usd, total_refund_khr, created_at)
  VALUES (1, 'RET-CUSTOMER-B-SECRET', 2, @name, 'completed', 50.00, 205000, '2026-08-16 09:00:00')
`).run({ name: SHARED_NAME })

// A's own share submission carrying staff-only review fields.
db.prepare(`
  INSERT INTO customer_share_submissions
    (id, customer_id, membership_number, customer_name, platform, note, status, reward_points, review_note, reviewed_by_id, reviewed_by_name, reviewed_at, created_at)
  VALUES (1, 1, 'GOLD-A', @name, 'facebook', 'Shared your page!', 'approved', 20, @reviewNote, 7, @reviewer, '2026-08-17 09:00:00', '2026-08-17 08:00:00')
`).run({ name: SHARED_NAME, reviewNote: REVIEW_NOTE, reviewer: REVIEWER })

async function main() {
  let passed = 0
  const check = (label, cond) => {
    assert.ok(cond, label)
    passed++
    console.log(`PASS ${label}`)
  }

  const res = await app.request('/membership/GOLD-A', {}, { DB: db, BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com' })
  assert.strictEqual(res.status, 200, `membership lookup should return 200, got ${res.status}`)
  const body = await res.json()
  const serialized = JSON.stringify(body)

  // 1. Cross-customer isolation: none of B's linked rows may appear.
  check('customer A lookup returns NONE of customer B\'s linked sales', Array.isArray(body.sales) && !body.sales.some((s) => s.receipt_number === 'R-CUSTOMER-B-SECRET'))
  check('customer A lookup returns NONE of customer B\'s linked returns', Array.isArray(body.returns) && !body.returns.some((r) => r.return_number === 'RET-CUSTOMER-B-SECRET'))
  check('B\'s private receipt id never appears anywhere in the response body', !serialized.includes('R-CUSTOMER-B-SECRET'))
  check('B\'s private return id never appears anywhere in the response body', !serialized.includes('RET-CUSTOMER-B-SECRET'))

  // 2. Staff-only customer notes must be entirely absent.
  check('customer.notes is NOT a key on the returned customer', body.customer && !('notes' in body.customer))
  check('the staff note text never appears anywhere in the response body', !serialized.includes(STAFF_NOTE))

  // 3. Internal moderation fields must be absent from public submissions.
  check('no submission exposes review_note', Array.isArray(body.submissions) && body.submissions.every((s) => !('review_note' in s)))
  check('no submission exposes reviewed_by_name', Array.isArray(body.submissions) && body.submissions.every((s) => !('reviewed_by_name' in s)))
  check('the internal review note text never appears anywhere in the response body', !serialized.includes(REVIEW_NOTE))
  check('the reviewer staff name never appears anywhere in the response body', !serialized.includes(REVIEWER))

  console.log(`\nALL ${passed} CHECKS PASSED`)
}

main().catch((err) => {
  console.error('\nFAIL:', err.message)
  process.exit(1)
})
