// HTTP cache policy for /api/* (K1 edge cache core).
//
// Before this module no /api response said anything about caching unless a
// route happened to, so what a browser, a service worker or an intermediary
// did with (say) a customer list depended on their defaults. This file is the
// ONE table that answers "may this response be stored, by whom, and for how
// long", plus the middleware that applies it.
//
// RULES THE TABLE ENFORCES (and scripts/test-http-cache-policy-pure.cjs pins):
//
// - The default is `private, no-store`. A route nobody classified is never
//   stored anywhere; classifying a route can only ever be a deliberate act.
// - Only class E is `public`, and class E is only the anonymous storefront
//   reads whose bodies are identical for every visitor. No PII or transaction
//   route can match a public rule.
// - Every non-GET/HEAD request is class H, `no-store`, whatever its path.
// - A non-2xx/304 answer is `no-store` whatever its class: an error page or a
//   403 must not be replayed from a cache after the cause is fixed.
// - A response that sets a cookie is never public.
// - A route that set Cache-Control itself is left exactly as it set it (see
//   ROUTES_WITH_OWN_CACHE_CONTROL below for the known ones). The middleware
//   only fills a header nobody chose.
//
// Every /api response also carries X-BOS-Build (the build's source hash, the
// same value cachedJson() folds into its keys and ETags), so a client can see
// which build answered it without a second request.

import { getBuildStamp } from './buildStamp'
import { setHeaderSafely } from './serverTiming'

export type RouteClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'

export type RouteClassPolicy = {
  label: string
  cacheControl: string
  /** True only for E. The test asserts this matches cacheControl. */
  public: boolean
  /** Hint for cachedJson callers: pass stockBearing: true. */
  stockBearing: boolean
}

export const DEFAULT_CACHE_CONTROL = 'private, no-store'

export const ROUTE_CLASS_POLICY: Record<RouteClass, RouteClassPolicy> = {
  A: { label: 'auth and session', cacheControl: 'private, no-store', public: false, stockBearing: false },
  B: { label: 'runtime probes and capabilities', cacheControl: 'no-store', public: false, stockBearing: false },
  C: { label: 'admin, system and maintenance', cacheControl: 'private, no-store', public: false, stockBearing: false },
  D: { label: 'staff live stock reads', cacheControl: 'private, no-cache', public: false, stockBearing: true },
  E: { label: 'public storefront API', cacheControl: 'public, max-age=15, stale-while-revalidate=60', public: true, stockBearing: false },
  F: { label: 'staff catalog, vocabulary and dashboard', cacheControl: 'private, no-cache', public: false, stockBearing: false },
  G: { label: 'PII and transactions', cacheControl: 'private, no-store', public: false, stockBearing: false },
  H: { label: 'writes', cacheControl: 'no-store', public: false, stockBearing: false },
}

export type RouteClassRule = { pattern: RegExp; routeClass: RouteClass }

// GET/HEAD rules, FIRST MATCH WINS, so specific paths precede their prefixes.
// Paths are the full request path as Hono sees it (`c.req.path`). Anything
// that matches no rule falls to DEFAULT_CACHE_CONTROL (unclassified).
export const ROUTE_CLASS_RULES: RouteClassRule[] = [
  // ---- E: anonymous storefront reads (portal.ts). Each is actor-neutral and
  // four of them already sit behind cachedJsonResponse keyed on the
  // products+settings+stock versions.
  { pattern: /^\/api\/portal\/(config|bootstrap|promotions|ai\/status)$/, routeClass: 'E' },
  { pattern: /^\/api\/portal\/catalog\/(meta|products|products\/search)$/, routeClass: 'E' },
  // ---- G: every other portal read is a signed-in customer's own data or
  // staff review of customer submissions.
  { pattern: /^\/api\/portal(\/|$)/, routeClass: 'G' },

  // ---- A: auth and session (includes /api/auth/devices, the session list).
  { pattern: /^\/api\/auth(\/|$)/, routeClass: 'A' },
  { pattern: /^\/api\/sync\/owner$/, routeClass: 'A' },

  // ---- B: probes and capabilities (cheap, must always be live).
  { pattern: /^\/api\/runtime\/version$/, routeClass: 'B' },
  { pattern: /^\/api\/returns\/capabilities$/, routeClass: 'B' },
  { pattern: /^\/api\/sales\/(money-precision-capability|create-receipt)$/, routeClass: 'B' },
  { pattern: /^\/api\/settings\/meta$/, routeClass: 'B' },
  { pattern: /^\/api\/shifts\/policy$/, routeClass: 'B' },

  // ---- C: admin, system, maintenance, jobs, users and roles.
  { pattern: /^\/api\/(system|backups|runtime|organizations|import-jobs|telegram|ai)(\/|$)/, routeClass: 'C' },
  { pattern: /^\/api\/(users|roles)(\/|$)/, routeClass: 'C' },
  { pattern: /^\/api\/settings\/payment-methods(\/|$)/, routeClass: 'C' },
  { pattern: /^\/api\/branches\/stock-integrity$/, routeClass: 'C' },
  { pattern: /^\/api\/inventory\/reasons\/impact$/, routeClass: 'C' },
  { pattern: /^\/api\/products\/(bulk-delete-jobs|auto-merges|merge-duplicates|possible-duplicates|zero-quantity-candidates|rename-impact)(\/|$)/, routeClass: 'C' },
  { pattern: /^\/api\/(customers|suppliers|delivery-contacts)\/bulk-delete-jobs(\/|$)/, routeClass: 'C' },

  // ---- G carve-outs that sit under otherwise-F/D prefixes: per-product
  // sales, supplier purchases, stock-in history, ledgers and cost breakdown
  // are transaction records.
  { pattern: /^\/api\/products\/\d+\/(detail-report|sales-detail|supplier-purchases|cost-breakdown)$/, routeClass: 'G' },
  { pattern: /^\/api\/products\/(stock-in-sessions|stock-in-session-lines|stock-ledger)$/, routeClass: 'G' },
  { pattern: /^\/api\/inventory\/(movements|rfid)(\/|$)/, routeClass: 'G' },

  // ---- D: staff live stock reads.
  { pattern: /^\/api\/inventory\/(products\/search|bootstrap|summary|stats|tagged-lots)$/, routeClass: 'D' },
  { pattern: /^\/api\/batches(\/|$)/, routeClass: 'D' },
  { pattern: /^\/api\/branches\/(summary|\d+\/stock)$/, routeClass: 'D' },
  { pattern: /^\/api\/dashboard\/stock-alerts$/, routeClass: 'D' },

  // ---- F: staff catalog, vocabulary and dashboard.
  { pattern: /^\/api\/products(\/(search|bootstrap|filters|lookups\/usage))?$/, routeClass: 'F' },
  { pattern: /^\/api\/(categories|units)$/, routeClass: 'F' },
  { pattern: /^\/api\/branches$/, routeClass: 'F' },
  { pattern: /^\/api\/promotions(\/rules(\/active)?)?$/, routeClass: 'F' },
  { pattern: /^\/api\/settings$/, routeClass: 'F' },
  { pattern: /^\/api\/inventory\/reasons$/, routeClass: 'F' },
  { pattern: /^\/api\/returns\/reason-presets$/, routeClass: 'F' },
  { pattern: /^\/api\/fees\/labels$/, routeClass: 'F' },
  { pattern: /^\/api\/pos\/address-presets$/, routeClass: 'F' },
  { pattern: /^\/api\/(dashboard|analytics)(\/(startup|insight-list))?$/, routeClass: 'F' },

  // ---- G: PII and transactions.
  { pattern: /^\/api\/(customers|suppliers|delivery-contacts)(\/|$)/, routeClass: 'G' },
  { pattern: /^\/api\/(sales|returns|shifts|reports|fees|notes|files|action-history|notifications|review|transfers)(\/|$)/, routeClass: 'G' },
]

/** null means unclassified: DEFAULT_CACHE_CONTROL applies. */
export function classifyApiRoute(method: string, path: string): RouteClass | null {
  const verb = String(method || '').toUpperCase()
  if (verb !== 'GET' && verb !== 'HEAD') return 'H'
  for (const rule of ROUTE_CLASS_RULES) {
    if (rule.pattern.test(path)) return rule.routeClass
  }
  return null
}

/** The label used for Server-Timing/Analytics: the class letter or 'unclassified'. */
export function routeClassLabel(method: string, path: string): string {
  return classifyApiRoute(method, path) ?? 'unclassified'
}

export function cacheControlFor(method: string, path: string, status: number, setsCookie = false): string {
  const routeClass = classifyApiRoute(method, path)
  if (routeClass === 'H') return ROUTE_CLASS_POLICY.H.cacheControl
  const cacheable = (status >= 200 && status < 300) || status === 304
  if (!cacheable) return 'no-store'
  if (!routeClass) return DEFAULT_CACHE_CONTROL
  const policy = ROUTE_CLASS_POLICY[routeClass]
  if (policy.public && setsCookie) return DEFAULT_CACHE_CONTROL
  return policy.cacheControl
}

/**
 * Routes that set Cache-Control themselves and are therefore never touched
 * by the middleware. Documentation for reviewers; the middleware does not
 * consult it -- it simply never overwrites an existing header.
 */
export const ROUTES_WITH_OWN_CACHE_CONTROL: ReadonlyArray<{ where: string; value: string }> = [
  { where: 'lib/acquisitionCostAccess.ts acquisitionCostResponses (every c.json on actionHistory, batches, branches, importJobs, inventory, products, returns, reviewQueue, sales, stockInCommit; compat /system/audit-logs, /dashboard, /dashboard/*, /analytics; contacts /suppliers, /suppliers/*)', value: 'private, no-store' },
  { where: 'routes/batches.ts GET /api/batches/picker-lots', value: 'private, no-store' },
  { where: 'routes/contacts.ts GET /api/customers/membership/:membershipNumber', value: 'private, no-store' },
  { where: 'routes/files.ts GET /api/files/:id/download', value: 'private, no-store' },
  { where: 'routes/portal.ts GET /api/portal/submissions/:id/screenshot/:index', value: 'private, no-store' },
  { where: 'routes/returns.ts GET /api/returns/capabilities; POST /api/returns/quote', value: 'no-store' },
  { where: 'routes/sales.ts GET /api/sales/money-precision-capability, /create-receipt', value: 'private, no-store' },
  { where: 'routes/sales.ts POST /api/sales/:id/status-receipt, /:id/line-receipt/:kind', value: 'no-store' },
  { where: 'routes/sync.ts GET /api/sync/owner', value: 'private, no-store' },
  { where: 'routes/system.ts repair previews/applies and sale-not-paid recovery', value: 'no-store' },
  { where: 'lib/r2.ts serveObject (only under /api via files/portal, which override it)', value: 'public, max-age=31536000, immutable' },
]

type HttpCacheContext = {
  req: { raw: Request; path: string; method: string }
  res: Response
}

/**
 * Hono-compatible middleware for '/api/*'. Runs after the handler; fills
 * Cache-Control only where the route left it unset, and stamps X-BOS-Build
 * on every response.
 */
export function createHttpCacheMiddleware(options: { buildHash?: () => string } = {}) {
  const buildHash = options.buildHash ?? (() => getBuildStamp().sourceHash)
  return async (c: HttpCacheContext, next: () => Promise<void>): Promise<void> => {
    await next()
    const res = c.res
    if (!res) return
    setHeaderSafely(c, 'X-BOS-Build', buildHash())
    if (c.res.headers.has('cache-control')) return
    const value = cacheControlFor(c.req.method, c.req.path, c.res.status, c.res.headers.has('set-cookie'))
    setHeaderSafely(c, 'Cache-Control', value)
  }
}
