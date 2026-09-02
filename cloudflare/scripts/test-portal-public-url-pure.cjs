// Regression test for portalPublicUrl / buildPortalConfig's `publicUrl`
// resolution (routes/portal.ts).
//
// Bug this pins (found by the Aug-29 post-deploy audit): the live storefront
// advertised the OLD domain (leangcosmetics.dpdns.org) after the rebrand to
// leangbeauty.com, because a stored `customer_portal_public_url` setting
// shadowed `BUSINESS_OS_PUBLIC_URL`. That stored value was almost always
// FROZEN there by the portal editor round-tripping the resolved url back into
// the setting (CatalogPage.tsx prefills the override input with the already-
// resolved config.publicUrl), not a deliberate external-domain choice.
//
// The fix: portalPublicUrl now DROPS a stored override whose host is one of
// this shop's own DEPRECATED hosts (kept in sync with frontend/index.html's
// redirect map) and falls back to the live env url -- while still honoring a
// GENUINE external funnel domain (any host not on the deprecated list), so the
// documented override feature is preserved.
//
// Same "transpile the REAL route file and call the REAL exported function"
// approach as the other portal pure tests; buildPortalConfig is pure over
// (settings, env), so no DB is needed here.
//
// Run (from cloudflare/): node scripts/test-portal-public-url-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

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

// Minimal stubs -- enough to LOAD portal.ts (route registration runs at module
// load; no imported function is invoked until a handler runs, and we never run
// a handler here -- we only call the pure buildPortalConfig export).
const portalRoute = loadReal('routes/portal.ts', {
  '../index': {},
  '../lib/db': { getDb: () => null },
  '../lib/auth': { requireAuth: async (c, next) => next() },
  '../lib/permissions': { hasPermission: () => true },
  '../lib/audit': { audit: async () => {} },
  '../lib/cache': { cachedJsonResponse: async (_r, _c, _v, _t, p) => p(), getVersionWithFallback: async () => '0' },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  '../lib/promotionRulesSql': { loadActivePromotionRules: async () => [], productPromotedSql: () => '0', productDiscountActiveSql: () => '0', anyRuleAppliesSql: () => '0', singleRuleAppliesSql: () => '0' },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/portalAccounts': { signupPortalAccount: async () => ({ ok: false }), signinPortalAccount: async () => ({ ok: false }) },
  '../lib/portalSession': { createPortalSession: async () => ({ token: '', expiresAt: '' }), setPortalCookie: () => {}, clearPortalCookie: () => {}, revokePortalSession: async () => {}, getPortalAccount: async () => null },
  '../lib/portalAuthLockout': { getPortalLockoutState: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), recordPortalFailure: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), clearPortalLockout: async () => {} },
  '../lib/phone': { canonicalizePhone: (v) => String(v || '').replace(/\D/g, '') || null },
  '../lib/fileAssets': { buildUniqueStoredName: (n) => n },
  '../lib/media': { sanitizeMediaList: (l) => l },
  '../lib/uploadSecurity': { detectBufferKind: () => null },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/portalAi': { generatePortalAiResponse: async () => ({}), getPortalAiUsageStatus: () => ({}) },
  '../lib/searchMatch': {},
  '../lib/sqlBinding': {},
  '../lib/familyPagination': {},
  '../lib/importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3, ADMIN_MAX_IMAGES_PER_PRODUCT: 5 },
})

const buildPortalConfig = portalRoute.buildPortalConfig
assert.strictEqual(typeof buildPortalConfig, 'function', 'buildPortalConfig should be exported')

const ENV = { BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com' }
const publicUrlFor = (override) =>
  buildPortalConfig(override === undefined ? {} : { customer_portal_public_url: override }, ENV).publicUrl

let checks = 0
const check = (label, actual, expected) => {
  assert.strictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  checks++
  console.log(`PASS ${label}`)
}

// 1. The exact production repro: a stale deprecated-host override is dropped,
//    so publicUrl follows the live env instead of advertising the dead domain.
check('stale dpdns override -> env', publicUrlFor('https://leangcosmetics.dpdns.org'), 'https://leangbeauty.com')

// 2. Every hostname in the deprecated set is treated the same way.
for (const stale of [
  'https://admin.leangcosmetics.dpdns.org',
  'https://leangcosmetics.com',
  'https://www.leangcosmetics.com',
  'https://admin.leangcosmetics.com',
]) {
  check(`stale ${stale} -> env`, publicUrlFor(stale), 'https://leangbeauty.com')
}

// 3. A GENUINE external funnel domain (not one of our own deprecated hosts) is
//    still honored -- the override feature is preserved, not removed.
check('genuine external override honored', publicUrlFor('https://customers.example.com'), 'https://customers.example.com')

// 4. No override -> env fallback.
check('blank override -> env', publicUrlFor(''), 'https://leangbeauty.com')
check('unset override -> env', publicUrlFor(undefined), 'https://leangbeauty.com')

// 5. An override equal to the current live host is honored (harmless; equals env).
check('current-host override honored', publicUrlFor('https://leangbeauty.com'), 'https://leangbeauty.com')

// 6. The pre-existing `/public` suffix trim still applies to an honored override.
check('/public trimmed on honored override', publicUrlFor('https://customers.example.com/public'), 'https://customers.example.com')

// 7. Host match is case-insensitive (a deprecated host in caps is still dropped).
check('deprecated host is case-insensitive', publicUrlFor('https://LeangCosmetics.DPDNS.org'), 'https://leangbeauty.com')

// 8. Regression: the fix touches ONLY publicUrl -- an unrelated field still
//    reads from its own setting and is not disturbed.
const cfg = buildPortalConfig({ customer_portal_public_url: 'https://leangcosmetics.dpdns.org', business_name: 'Some Shop' }, ENV)
check('unrelated businessName unaffected', cfg.businessName, 'Some Shop')

// 9. publicUrlOverride: the RAW stored override the portal editor prefills its
//    input from -- exposed separately from the RESOLVED publicUrl so a blank
//    override stays blank on save instead of freezing the env fallback. It shows
//    the actual stored value (even a stale deprecated one, so the merchant can
//    see and clear it), and is empty when no override is set.
const overrideFor = (override) =>
  buildPortalConfig(override === undefined ? {} : { customer_portal_public_url: override }, ENV).publicUrlOverride
check('override exposed raw (stale value visible to editor, not resolved)', overrideFor('https://leangcosmetics.dpdns.org'), 'https://leangcosmetics.dpdns.org')
check('override exposed raw (genuine external)', overrideFor('https://customers.example.com'), 'https://customers.example.com')
check('blank override -> empty publicUrlOverride (stays blank, no freeze)', overrideFor(''), '')
check('unset override -> empty publicUrlOverride', overrideFor(undefined), '')
// And the resolved publicUrl on that same stale-override config is STILL the env
// (the deprecated-host guard), so the editor shows the stale override in its input
// while the live/resolved url is already correct.
check('resolved publicUrl stays env even while override input shows the stale value', cfg.publicUrl, 'https://leangbeauty.com')

// Public FAQ settings must survive the editor -> settings -> bootstrap path.
// Malformed or incomplete rows fail closed instead of breaking the portal.
const faqConfig = buildPortalConfig({
  customer_portal_show_membership: '1',
  customer_portal_faq_title: 'Delivery & products',
  customer_portal_faq_items: JSON.stringify([
    { id: 'delivery', question: 'Do you deliver?', answer: 'Yes.' },
    { id: 'incomplete', question: 'Missing answer', answer: '' },
  ]),
}, ENV)
check('guest membership navigation remains disabled', faqConfig.showMembership, false)
check('FAQ title round-trips through public config', faqConfig.faqTitle, 'Delivery & products')
assert.deepStrictEqual(faqConfig.faqItems, [{ id: 'delivery', question: 'Do you deliver?', answer: 'Yes.' }])
checks++
console.log('PASS FAQ rows round-trip and incomplete rows are removed')
assert.deepStrictEqual(buildPortalConfig({ customer_portal_faq_items: '{broken' }, ENV).faqItems, [])
checks++
console.log('PASS malformed FAQ JSON fails closed')

console.log(`\nALL ${checks} CHECKS PASSED`)
