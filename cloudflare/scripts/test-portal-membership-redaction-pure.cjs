// Regression lock for the C2 redaction scope on the CUSTOMER-FACING portal.
// GET /membership/:membershipNumber is the anonymous purchase-history endpoint
// a customer hits with only their membership number -- so its payload must
// carry the delivery fee the customer was CHARGED (delivery_fee_usd/khr) while
// never exposing delivery_actual_cost_usd/khr, the staff-only money the shop
// paid the courier (migration 0068: "never on receipts or any customer/portal
// surface"). The redaction lives entirely in that handler's explicit SELECT
// column list; a later edit that adds the column, or replaces the list with
// SELECT *, would silently leak the shop's private courier cost to every
// customer. This test proves the real shipped handler, run against a real
// in-memory SQLite with every migration applied, does not.
//
// Same harness approach as test-reset-products-pure.cjs: transpile the REAL
// route file, run it against openDb(loadAll()), and call the actual Hono
// app.request() the way the Worker would. Only cross-cutting infra
// (auth/audit/cache/rate-limit/etc.) is stubbed; the query and its column
// list are the real, shipped SQL.
//
// Run (from cloudflare/): node scripts/test-portal-membership-redaction-pure.cjs

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

// Load the REAL portal route against the real DB. Everything here is
// cross-cutting infrastructure the redaction does not depend on; getDb is the
// one that matters -- it hands the handler the real, migrated, seeded database.
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
  // The membership route is disabled, so these account libs are imported by
  // portal.ts but never invoked here — stub them so the module loads.
  '../lib/portalAccounts': { signupPortalAccount: async () => ({ ok: false }), signinPortalAccount: async () => ({ ok: false }) },
  '../lib/portalSession': { createPortalSession: async () => ({ token: '', expiresAt: '' }), setPortalCookie: () => {}, clearPortalCookie: () => {}, revokePortalSession: async () => {}, getPortalAccount: async () => null },
  '../lib/portalAuthLockout': { getPortalLockoutState: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), recordPortalFailure: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), clearPortalLockout: async () => {} },
  '../lib/phone': { canonicalizePhone: (v) => String(v || '').replace(/\D/g, '') || null },
  '../lib/fileAssets': { buildUniqueStoredName: (n) => n },
  '../lib/media': { sanitizeMediaList: (l) => l },
  '../lib/uploadSecurity': { detectBufferKind: () => null },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/portalAi': { generatePortalAiResponse: async () => ({}), getPortalAiUsageStatus: () => ({}) },
  '../lib/barcodeAliases': { buildAliasExactClause: () => '' }, // route ORs alias barcodes into its search plan; not exercised here
  '../lib/searchMatch': {},
  '../lib/familyPagination': { paginateProductFamilies: async () => ({ items: [], total: 0 }) },
  '../lib/importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3, ADMIN_MAX_IMAGES_PER_PRODUCT: 5 },
})

const app = portalRoute.default
assert.strictEqual(typeof app?.request, 'function', 'portal.ts must default-export the Hono app')

// Sentinel courier cost the customer must never see. Distinctive so a
// substring scan of the whole response body is meaningful.
const SECRET_ACTUAL_USD = 7.77
const SECRET_ACTUAL_KHR = 31857
const CHARGED_FEE_USD = 2.5
const CHARGED_FEE_KHR = 10250
const MEMBERSHIP = 'GOLD-REDACT-1'

db.prepare(`
  INSERT INTO customers (id, name, membership_number, phone, created_at)
  VALUES (1, 'Redaction Test Customer', @m, '012 000 111', '2026-08-01 00:00:00')
`).run({ m: MEMBERSHIP })

db.prepare(`
  INSERT INTO sales (
    id, receipt_number, customer_id, customer_name, is_delivery, sale_status,
    delivery_fee_usd, delivery_fee_khr,
    delivery_actual_cost_usd, delivery_actual_cost_khr,
    total_usd, total_khr, created_at
  ) VALUES (
    1, 'R-REDACT-1', 1, 'Redaction Test Customer', 1, 'completed',
    @feeUsd, @feeKhr, @actualUsd, @actualKhr,
    12.5, 51250, '2026-08-15 09:00:00'
  )
`).run({ feeUsd: CHARGED_FEE_USD, feeKhr: CHARGED_FEE_KHR, actualUsd: SECRET_ACTUAL_USD, actualKhr: SECRET_ACTUAL_KHR })

db.prepare(`
  INSERT INTO sale_items (id, sale_id, product_name, quantity, total_usd)
  VALUES (1, 1, 'Test Lotion', 1, 12.5)
`).run({})

async function main() {
  let passed = 0
  const check = (label, cond) => {
    assert.ok(cond, label)
    passed++
    console.log(`PASS ${label}`)
  }

  // The anonymous membership lookup was DISABLED (§2, Part 533). It used to
  // return the customer's own sale history; the redaction guarded here (the
  // staff-only courier cost must never ride along) is now moot because the
  // endpoint returns NO sale data at all. This test proves the endpoint is
  // disabled and that the seeded secret can therefore never appear.
  const res = await app.request(`/membership/${encodeURIComponent(MEMBERSHIP)}`, {}, { DB: db, BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com' })
  assert.strictEqual(res.status, 403, `membership lookup must now be disabled (403), got ${res.status}`)
  const body = await res.json()
  const serialized = JSON.stringify(body)

  check('the disabled response is coded feature_disabled', body.code === 'feature_disabled')
  check('the disabled response carries no sales', !('sales' in body))
  check('the secret courier-cost value never appears in the response body', !serialized.includes(String(SECRET_ACTUAL_USD)) && !serialized.includes(String(SECRET_ACTUAL_KHR)))
  check('the delivery_actual_cost column name never appears in the response body', !serialized.includes('delivery_actual_cost'))

  console.log(`\nALL ${passed} CHECKS PASSED`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
