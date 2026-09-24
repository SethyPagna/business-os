// Loads the REAL src/routes/portal.ts (transpiled, not reimplemented) for
// the pure tests that only call its exported pure functions
// (buildPortalConfig, normalizePortalPromoItems, ...). Route registration
// runs at module load; no imported function is invoked until a handler
// runs, and these tests never run a handler -- so every dependency that
// would need a platform (D1, KV, R2, the Durable Object hub, the AI
// provider) is stubbed, and the few pure kernels the config builder really
// calls (safeLinkUrl, actorSnapshot, ...) are loaded for real.
//
// Shared by test-portal-public-url-pure.cjs and
// test-portal-promo-items-link-pure.cjs so the stub list exists once.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Module = require('module')

const SRC = path.join(__dirname, '..', '..', 'src')

function transpile(relPath) {
  const sourcePath = path.join(SRC, relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return outputText
}

function loadReal(relPath, requireOverrides = {}) {
  const outputText = transpile(relPath)
  const sourcePath = path.join(SRC, relPath)
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

// N13: the shared actor / branch kernels these routes now import.
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
const portalRoute = loadReal('routes/portal.ts', {
  // Real platform-free imports of portal.ts, shared by every loader.
  ...require('./portal_route_pure_deps.cjs'),
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/anonymousCustomer': loadReal('lib/anonymousCustomer.ts'),
  '../lib/requestBodyGuard': loadReal('lib/requestBodyGuard.ts'),
  '../index': {},
  '../lib/db': { getDb: () => null },
  '../lib/auth': { requireAuth: async (c, next) => next() },
  '../lib/permissions': { hasPermission: () => true },
  '../lib/audit': { audit: async () => {} },
  '../lib/cache': { cachedJsonResponse: async (_r, _c, _v, _t, p) => p(), getVersionWithFallback: async () => '0' },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  '../lib/promotionRulesSql': { loadActivePromotionRules: async () => [], productPromotedSql: () => '0', productDiscountActiveSql: () => '0', anyRuleAppliesSql: () => '0', singleRuleAppliesSql: () => '0' },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/portalAbuseKey': loadReal('lib/portalAbuseKey.ts'),
  '../lib/safeLinkUrl': loadReal('lib/safeLinkUrl.ts'),
  ...(fs.existsSync(path.join(SRC, 'lib', 'portalImagePrivacy.ts'))
    ? { '../lib/portalImagePrivacy': loadReal('lib/portalImagePrivacy.ts') }
    : {}),
  '../lib/portalAccounts': { signupPortalAccount: async () => ({ ok: false }), signinPortalAccount: async () => ({ ok: false }) },
  '../lib/portalSession': { createPortalSession: async () => ({ token: '', expiresAt: '' }), setPortalCookie: () => {}, clearPortalCookie: () => {}, revokePortalSession: async () => {}, getPortalAccount: async () => null },
  '../lib/portalAuthLockout': { getPortalLockoutState: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), recordPortalFailure: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), clearPortalLockout: async () => {} },
  '../lib/phone': { canonicalizePhone: (v) => String(v || '').replace(/\D/g, '') || null },
  '../lib/fileAssets': { buildUniqueStoredName: (n) => n },
  '../lib/media': { sanitizeMediaList: (l) => l },
  '../lib/uploadSecurity': { detectBufferKind: () => null },
  '../lib/r2': { serveObject: async () => new Response(null, { status: 404 }) },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/portalAi': { generatePortalAiResponse: async () => ({}), getPortalAiUsageStatus: () => ({}) },
  '../lib/searchMatch': {},
  '../lib/productSearchQuery': {},
  '../lib/sqlBinding': {},
  '../lib/familyPagination': {},
  '../lib/importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3, ADMIN_MAX_IMAGES_PER_PRODUCT: 5 },
})

module.exports = portalRoute
