/**
 * e2e/server/fixtureServer.mjs -- the Tier "app" backend.
 *
 * WHY A SERVER AND NOT page.route(). Three of the error classes these specs
 * cover cannot be reproduced through Playwright request interception:
 *
 *  1. The service worker. Its own script fetch, and every fetch IT makes, are
 *     outside the page's request chain; WebKit cannot intercept them at all.
 *     pwa-update.spec.ts needs to serve a genuinely different /sw.js body on a
 *     later request, which is a server behaviour, not a page behaviour.
 *  2. The offline app shell. Going offline with page.route installed proves
 *     nothing about what the shell serves from cache.
 *  3. Request COUNTING before first paint (perf-budget.spec.ts) has to see the
 *     same request stream a real browser makes, including the ones a route
 *     handler would have swallowed.
 *
 * So Tier "app" serves the REAL built dist over HTTP and answers /api/** from
 * the committed fixtures. Nothing here talks to a database, a Worker, or any
 * remote host. Specs still layer page.route() on top for per-test variations
 * (a delayed page, a 500, a dropped field).
 *
 * HOSTNAMES ARE LOAD-BEARING. frontend/src/app/pathRouting.ts routes "/" to the
 * ADMIN shell on localhost / 127.0.0.1 / ::1 / admin.* and to the STOREFRONT on
 * anything else -- exactly how admin.leangbeauty.com and leangbeauty.com split
 * in production. This server binds 0.0.0.0 so the suite can reach it as:
 *     http://127.0.0.1:<port>   -> admin shell        (admin hostname)
 *     http://127.0.0.2:<port>   -> public storefront  (non-admin hostname)
 * Both are in 127.0.0.0/8, so both are secure contexts and service workers
 * register on both. Testing the storefront at a made-up /shop path instead
 * would exercise a route the customer domain never uses.
 *
 * Control surface (never present in production, only this file):
 *   GET  /__e2e/state          -> { requests }
 *   POST /__e2e/reset          -> clear the request log
 *
 * The "a new build was deployed" switch is deliberately NOT part of that
 * control surface. It is the per-request cookie `e2e_sw_generation`, so each
 * browser context decides for itself which build it is being served. A global
 * mutable generation was tried first and was measurably wrong: the three
 * projects run the same spec concurrently, one project's bump reached another
 * project's "a first install never nags" test, and that test failed against
 * correct product code. A cookie cannot leak between contexts.
 */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(here, '..', '..')
const distDir = path.join(frontendDir, 'dist')
const fixturesDir = path.join(frontendDir, 'e2e', 'fixtures')

const PORT = Number(process.env.E2E_PORT || 4318)

function readFixture(name) {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'))
}

const PORTAL_CONFIG = readFixture('portal-config.json')
const PORTAL_META = readFixture('portal-meta.json')
const PORTAL_PRODUCTS = readFixture('portal-products.json')
const ADMIN_SETTINGS = readFixture('admin-settings.json')
const ADMIN_SESSION = readFixture('admin-session.json')
const ADMIN_SALES = readFixture('admin-sales.json')
const RUNTIME_VERSION = readFixture('runtime-version.json')
const ADMIN_CATALOG = readFixture('admin-products.json')

// ---------------------------------------------------------------------------
// Mutable test state
// ---------------------------------------------------------------------------
let requestLog = []

/**
 * Which build this particular browser context is being served.
 *
 * 0 = the real dist/sw.js, byte for byte. Anything higher = "a deploy
 * happened since you loaded". Read per request from a cookie so parallel
 * contexts never see each other's deploys.
 */
function readSwGeneration(req) {
  const cookie = req.headers.cookie || ''
  const match = /(?:^|;\s*)e2e_sw_generation=(\d+)/.exec(cookie)
  return match ? Number(match[1]) : 0
}

// ---------------------------------------------------------------------------
// Portal search -- the same cut cloudflare/src/routes/portal.ts makes
// ---------------------------------------------------------------------------
// routes/portal.ts: page = max(1, parseInt(page||'1')); pageSize = min(100,
// max(1, parseInt(pageSize||'50'))). Reproduced exactly, including the 100 cap,
// so a client asking for 5,000 gets the same 100 the Worker would serve.
function parsePaging(query) {
  const page = Math.max(1, Number.parseInt(query.get('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.get('pageSize') || '50', 10) || 50))
  return { page, pageSize }
}

function matchesQuery(product, term) {
  if (!term) return true
  const haystack = `${product.name} ${product.brand} ${product.category}`.toLowerCase()
  return term
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

// buildPortalMeta/buildPortalCatalog index the A-Z rail on BRAND initials and
// count DISTINCT product names, not rows (see the long comment above the
// `initials` query in routes/portal.ts).
function buildInitials(rows) {
  const counts = new Map()
  for (const row of rows) {
    const value = String(row.brand || '').trim().slice(0, 1).toUpperCase()
    if (!value) continue
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }))
}

function filterProducts(query) {
  const term = String(query.get('query') || query.get('q') || '').trim()
  const brand = String(query.get('brand') || '').trim().toLowerCase()
  const category = String(query.get('category') || '').trim().toLowerCase()
  const initial = String(query.get('initial') || '').trim()
  const stockState = String(query.get('stockState') || '').trim()
  const branchIds = String(query.get('branchId') || '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0)

  return PORTAL_PRODUCTS.filter((product) => {
    if (!matchesQuery(product, term)) return false
    if (brand && String(product.brand).toLowerCase() !== brand) return false
    if (category && String(product.category).toLowerCase() !== category) return false
    if (initial && initial.toLowerCase() !== 'all'
      && String(product.brand || '').trim().slice(0, 1).toUpperCase() !== initial.toUpperCase()) return false
    if (stockState && product.stock_status !== stockState) return false
    if (branchIds.length) {
      const available = (product.branch_availability || [])
        .some((entry) => branchIds.includes(Number(entry.branch_id)) && entry.status !== 'out_of_stock')
      if (!available) return false
    }
    return true
  })
}

function buildCatalogPayload(query) {
  const { page, pageSize } = parsePaging(query)
  const rows = filterProducts(query)
  const total = rows.length
  const start = (page - 1) * pageSize
  return {
    items: rows.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    initials: buildInitials(rows),
    promotion_rules: [],
  }
}

// buildPortalCatalog()'s snapshot is ALWAYS page 1 at pageSize 50 -- it ignores
// the request's paging entirely. The storefront's "shopper chose 20 but the
// bootstrap is cut at 50" case (catalogPagination.ts
// bootstrapPageSizeMatchesViewer) only exists because of that, so the fixture
// must hard-code it rather than echo whatever the client asked for.
function buildBootstrapPayload() {
  const snapshot = buildCatalogPayload(new URLSearchParams({ page: '1', pageSize: '50' }))
  return {
    config: PORTAL_CONFIG,
    meta: PORTAL_META,
    catalog: snapshot,
    products: snapshot.items,
    reviewItems: [],
    promotions: { items: [] },
  }
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  res.end(body)
}

function sendFile(res, filePath, extraHeaders = {}) {
  const ext = path.extname(filePath).toLowerCase()
  const body = readFileSync(filePath)
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    // The suite must never be answered from the HTTP cache: two runs of the
    // same spec have to make the same requests, and perf-budget.spec.ts counts
    // them.
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  res.end(body)
}

// ---------------------------------------------------------------------------
// Service worker: the update path
// ---------------------------------------------------------------------------
// index.tsx registers /sw.js and then calls registration.update(). The browser
// only shows "Restart now" when the BYTES of sw.js differ AND an incumbent
// worker is already active (public-runtime/service-worker.ts's install handler
// checks self.registration.active before broadcasting). Bumping the generation
// rewrites the build-hash constant the worker names its caches with, which is
// exactly what a real deploy does -- so this is a real update, not a simulated
// message.
/**
 * index.html, stamped with the build generation.
 *
 * A real deploy changes index.html too (the hashed asset filenames it points
 * at move), and the service worker precaches it. Without a visible difference
 * between generations "the stale cached document was replaced" is not
 * observable at all -- the assertion would be reading identical bytes and
 * calling that success. The stamp is a meta tag, which changes nothing about
 * how the app boots.
 */
function sendIndexHtml(res, swGeneration) {
  const source = readFileSync(path.join(distDir, 'index.html'), 'utf8')
  const body = swGeneration === 0
    ? source
    : source.replace('<head>', `<head><meta name="e2e-build-generation" content="${swGeneration}">`)
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readServiceWorker(swGeneration) {
  const source = readFileSync(path.join(distDir, 'sw.js'), 'utf8')
  if (swGeneration === 0) return source
  const marker = `/* e2e build generation ${swGeneration} */\n`
  // Retarget every cache name at once by rewriting the hash the built file
  // baked in. The banner's own guard (App.tsx acceptAppUpdate) drops an
  // announcement whose hash equals the running build, so the hash MUST change.
  return marker + source.replace(
    /const BUILD_HASH = '([^']*)'/,
    (_match, hash) => `const BUILD_HASH = '${hash}-e2e${swGeneration}'`,
  )
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
// Three accounts on one device. The shop really works this way -- a shared
// till tablet that several cashiers sign into in turn -- and
// storage-isolation.spec.ts needs two DIFFERENT signed-in identities in one
// browser profile to prove that one cashier's parked work never surfaces for
// the next.
//
// admin-session.json is the shape source (its _provenance names the Worker
// routes field by field); the cashiers differ only in the fields the app scopes
// storage by, id and username, so the difference the specs assert on is exactly
// the difference under test.
const SESSION_USERS = {
  admin: ADMIN_SESSION.user,
  cashier_a: { ...ADMIN_SESSION.user, id: 11, username: 'cashier_a', name: 'Cashier A' },
  cashier_b: { ...ADMIN_SESSION.user, id: 12, username: 'cashier_b', name: 'Cashier B' },
}
// Any non-empty password is accepted; only the username selects the account.
// A real password check would prove nothing here and would tempt someone into
// putting a credential in the repository.
const SESSION_COOKIE = 'bos_session'

// cloudflare/src/lib/salesAnalytics.ts emptySalesTotals(), field for field.
const EMPTY_SALES_TOTALS = {
  tx_count: 0, gross_sales_usd: 0, store_discount_usd: 0, membership_discount_usd: 0,
  discount_usd: 0, item_discount_usd: 0, total_discount_usd: 0, tax_usd: 0, delivery_usd: 0, store_delivery_usd: 0,
  delivery_actual_cost_usd: 0, delivery_actual_cost_count: 0, delivery_sale_count: 0, delivery_margin_usd: 0,
  delivery_net_usd: 0, recognized_delivery_usd: 0, recognized_delivery_cost_usd: 0,
  pending_tx_count: 0, pending_gross_sales_usd: 0, pending_store_discount_usd: 0, pending_membership_discount_usd: 0,
  pending_delivery_usd: 0, pending_delivery_cost_usd: 0, pending_cost_usd: 0, pending_profit_usd: 0,
  pending_item_discount_usd: 0, cancelled_tx_count: 0,
  returned_cost_usd: 0, returned_cost_shortfall_usd: 0,
  unvalued_tx_count: 0, unvalued_cost_usd: 0, net_sales_usd: 0,
  refund_usd: 0, refund_charged_usd: 0, refund_excess_usd: 0,
  revenue_usd: 0, pending_revenue_usd: 0, collected_total_usd: 0, cost_usd: 0, profit_usd: 0, avg_order_usd: 0,
}

function readSessionUser(req) {
  const cookie = req.headers.cookie || ''
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookie)
  return match ? (SESSION_USERS[decodeURIComponent(match[1])] || null) : null
}

/**
 * Which mobile navigation the org has configured.
 *
 * frontend/src/App.tsx:1812 and Sidebar.tsx:222 read
 * settings.ui_mobile_section_nav through useMobileSectionNavMode(): 'pages'
 * (the default -- inline navigation, NO fixed bottom bar) or 'sections' (the
 * fixed bottom <nav> with safe-area-inset-bottom padding). ios-layout.spec.ts
 * has to assert on the fixed bar, which simply does not exist in the default
 * mode, so the spec asks for it per context -- a cookie, for the same reason
 * the service-worker generation is a cookie: three projects run concurrently
 * against ONE server and a global switch leaks between them.
 */
function settingsFor(req) {
  const cookie = req.headers.cookie || ''
  const match = /(?:^|;\s*)e2e_mobile_section_nav=(pages|sections)/.exec(cookie)
  return match ? { ...ADMIN_SETTINGS, ui_mobile_section_nav: match[1] } : ADMIN_SETTINGS
}

function sessionPayload(user, req) {
  return {
    user,
    settings: settingsFor(req),
    organization: ADMIN_SESSION.organization,
    group: ADMIN_SESSION.defaultGroup,
    system: { runtime: { runtime: 'cloudflare-workers', database: 'd1', objectStorage: 'r2', cache: 'kv' } },
  }
}

function handleApi(pathname, query, req, res, body) {
  // --- Public storefront (cloudflare/src/routes/portal.ts) ---
  if (pathname === '/api/portal/config') return sendJson(res, 200, PORTAL_CONFIG)
  if (pathname === '/api/portal/bootstrap') return sendJson(res, 200, buildBootstrapPayload())
  if (pathname === '/api/portal/catalog/meta') return sendJson(res, 200, PORTAL_META)
  if (pathname === '/api/portal/catalog/products') {
    return sendJson(res, 200, buildCatalogPayload(new URLSearchParams({ page: '1', pageSize: '50' })))
  }
  if (pathname === '/api/portal/catalog/products/search') return sendJson(res, 200, buildCatalogPayload(query))
  if (pathname === '/api/portal/promotions') return sendJson(res, 200, { items: [] })
  if (pathname === '/api/portal/ai/status') {
    return sendJson(res, 200, { enabled: false, provider: null, requestsPerMinute: 0 })
  }
  // A signed-out visitor. Matches routes/portal.ts GET /auth/me's 200 shape.
  if (pathname === '/api/portal/auth/me') return sendJson(res, 200, { account: null })
  if (pathname === '/api/portal/account/cart' || pathname === '/api/portal/account/wishlist') {
    return sendJson(res, 401, { error: 'Not signed in', code: 'portal_unauthenticated' })
  }

  // --- Admin (cloudflare/src/routes/*.ts) ---
  if (pathname === '/api/runtime/version') return sendJson(res, 200, RUNTIME_VERSION)
  if (pathname === '/api/organizations/bootstrap') {
    return sendJson(res, 200, {
      organizationCreationEnabled: false,
      organization: ADMIN_SESSION.organization,
      defaultGroup: ADMIN_SESSION.defaultGroup,
    })
  }
  if (pathname === '/api/organizations/search') {
    // routes/organizations.ts GET /search -> { items: [...] } with the
    // six-column projection below (NOT ORG_COLUMNS -- created_at is absent).
    const term = String(query.get('q') || '').trim().toLowerCase()
    const org = ADMIN_SESSION.organization
    const matches = !term
      || [org.name, org.slug, org.public_id].some((value) => String(value).toLowerCase().includes(term))
    return sendJson(res, 200, {
      items: matches
        ? [{
            id: org.id,
            name: org.name,
            slug: org.slug,
            public_id: org.public_id,
            is_active: org.is_active,
            setup_enabled: org.setup_enabled,
          }]
        : [],
    })
  }
  if (pathname === '/api/auth/verification-capabilities') {
    return sendJson(res, 200, {
      otp: true,
      email: false,
      google_oauth: false,
      google_login: { enabled: false },
      facebook_oauth: false,
      google_email_auth: false,
      passwordReset: false,
    })
  }
  // Sign-in goes through the REAL login form and the REAL cookie name
  // (cloudflare/src/lib/auth.ts SESSION_COOKIE_NAME = 'bos_session'), because
  // "who is signed in" has to be able to CHANGE inside one browser profile --
  // a context-wide request header is fixed for the life of the context and
  // cannot express "user A logged out, user B logged in".
  //
  // Secure is deliberately omitted: the suite speaks http to 127.0.0.x, and a
  // Secure cookie would simply be dropped there. Everything else matches.
  if (pathname === '/api/auth/login') {
    const username = String(body?.username || '').trim().toLowerCase()
    const user = SESSION_USERS[username]
    if (!user || !String(body?.password || '')) {
      return sendJson(res, 401, { error: 'Invalid username or password', failedAttempts: 1 })
    }
    return sendJson(res, 200, {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        organizationId: user.organizationId,
        roleId: user.roleId,
        permissions: user.permissions,
        role_code: user.role_code,
        role_permissions: user.role_permissions,
        organization_public_id: user.organization_public_id,
      },
    }, { 'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(username)}; Path=/; HttpOnly; SameSite=Lax` })
  }
  if (pathname === '/api/auth/logout') {
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    })
  }

  const sessionUser = readSessionUser(req)
  if (pathname === '/api/auth/bootstrap' || pathname === '/api/auth/me') {
    if (!sessionUser) return sendJson(res, 401, { error: 'Not authenticated', code: 'invalid_session' })
    return sendJson(res, 200, sessionPayload(sessionUser, req))
  }
  // The signed-in shell's own first-paint calls. Each is the route's declared
  // EMPTY state, copied from the function that produces it, so the shell paints
  // a real zero-state rather than an error card -- an error card would change
  // the layout the iOS specs measure and would put noise in the console the
  // hygiene spec has to stay strict about.
  if (pathname === '/api/dashboard/startup') {
    if (!sessionUser) return sendJson(res, 401, { error: 'Not authenticated', code: 'invalid_session' })
    // compat.ts emptySummary() / emptyAnalytics(), field for field.
    return sendJson(res, 200, {
      summary: {
        today_count: 0, today_total: 0, today_total_khr: 0, today_return_count: 0, today_return_usd: 0,
        all_total: 0, all_total_khr: 0, cost_in: 0, cost_out: 0, cost_in_khr: 0, cost_out_khr: 0,
        product_count: PORTAL_PRODUCTS.length, in_stock_count: PORTAL_PRODUCTS.length,
        low_stock_count: 0, out_of_stock_count: 0, stock_value_usd: 0, stock_value_khr: 0,
        low_stock: [], out_of_stock: [], expiring_products: [], expiring_count: 0, recent_sales: [],
      },
      analytics: {
        // NOT compat.ts emptyAnalytics(). That helper returns `totals: {}`,
        // and the frontend's own validator (Dashboard.tsx:615
        // isDashboardAnalyticsPayload) requires totals.revenue_usd and
        // totals.tx_count to be finite numbers -- `{}` fails it and paints
        // "Dashboard startup returned incomplete analytics data." Reproduced
        // here while building these fixtures. (emptyAnalytics() turns out to
        // have no call sites at all; reported separately.) The real route
        // returns getSalesTotals(), whose zero state is
        // lib/salesAnalytics.ts emptySalesTotals() -- copied below.
        totals: EMPTY_SALES_TOTALS,
        prevTotals: EMPTY_SALES_TOTALS,
        periodReturns: {}, periodSupplierReturns: {},
        periodData: [], byPayment: [], byBranch: [], topProducts: [], topProductsQty: [],
        topCustomers: [], hourlyDist: [],
      },
    })
  }
  // --- the admin catalogue (POS and Products) ---
  // Same paging envelope as routes/products.ts searchProductsPayload():
  // { items, total, page, pageSize, totalPages, promotion_rules }.
  if (pathname === '/api/products/search' || pathname === '/api/products/bootstrap') {
    if (!sessionUser) return sendJson(res, 401, { error: 'Not authenticated', code: 'invalid_session' })
    const { page, pageSize } = parsePaging(query)
    const term = String(query.get('search') || query.get('query') || query.get('q') || '').trim().toLowerCase()
    const rows = term
      ? ADMIN_CATALOG.items.filter((item) => (
        `${item.name} ${item.brand} ${item.category} ${item.barcode} ${item.sku}`.toLowerCase().includes(term)
      ))
      : ADMIN_CATALOG.items
    const start = (page - 1) * pageSize
    const payload = {
      items: rows.slice(start, start + pageSize),
      total: rows.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
      promotion_rules: [],
    }
    // GET /bootstrap adds branches + the facet vocabulary on top of the same
    // envelope; POS.tsx only treats branch metadata as loaded once `branches`
    // comes back as a real array (see the long comment at products.ts:1045).
    if (pathname === '/api/products/bootstrap') {
      payload.branches = ADMIN_CATALOG.branches
      payload.filters = {
        categories: PORTAL_META.categories.map((entry) => entry.name),
        brands: PORTAL_META.brands.map((entry) => entry.name),
        suppliers: [],
        units: [...new Set(ADMIN_CATALOG.items.map((item) => item.unit))],
        initials: buildInitials(ADMIN_CATALOG.items),
      }
      payload.initials = payload.filters.initials
    }
    return sendJson(res, 200, payload)
  }
  if (pathname === '/api/products') {
    if (!sessionUser) return sendJson(res, 401, { error: 'Not authenticated', code: 'invalid_session' })
    // routes/products.ts GET / returns a BARE ARRAY of the first 100 items.
    return sendJson(res, 200, ADMIN_CATALOG.items.slice(0, 100))
  }
  if (pathname === '/api/products/possible-duplicates') {
    return sendJson(res, 200, { success: true, clusters: [] })
  }
  if (pathname === '/api/products/filters') {
    return sendJson(res, 200, {
      categories: PORTAL_META.categories.map((entry) => entry.name),
      brands: PORTAL_META.brands.map((entry) => entry.name),
      suppliers: [],
      units: [...new Set(ADMIN_CATALOG.items.map((item) => item.unit))],
      initials: buildInitials(ADMIN_CATALOG.items),
    })
  }
  if (pathname === '/api/branches') return sendJson(res, 200, ADMIN_CATALOG.branches)
  // routes/lookups.ts GET /categories and /units -- a BARE ARRAY of rows
  // tagged with their source (lib/lookupSuggestions.ts:77 mergeLookupSuggestionRows).
  if (pathname === '/api/categories') {
    return sendJson(res, 200, PORTAL_META.categories.map((entry, index) => ({
      id: index + 1, name: entry.name, source: 'lookup',
    })))
  }
  if (pathname === '/api/units') {
    return sendJson(res, 200, [...new Set(ADMIN_CATALOG.items.map((item) => item.unit))].map((name, index) => ({
      id: index + 1, name, source: 'lookup',
    })))
  }
  // routes/actionHistory.ts GET / -- { success, items }.
  if (pathname === '/api/action-history') {
    if (!sessionUser) return sendJson(res, 401, { error: 'Not authenticated', code: 'invalid_session' })
    return sendJson(res, 200, { success: true, items: [] })
  }
  // routes/users.ts GET / -- the staff list. Exactly the three accounts this
  // server can sign in, so "who can I filter history by" agrees with "who can
  // actually log in".
  if (pathname === '/api/users') {
    if (!sessionUser) return sendJson(res, 401, { error: 'Not authenticated', code: 'invalid_session' })
    return sendJson(res, 200, Object.values(SESSION_USERS).map((user) => ({
      id: user.id,
      username: user.username,
      name: user.name,
      role_id: user.roleId,
      role_code: user.role_code,
      is_active: 1,
    })))
  }
  // routes/batches.ts GET /tracked-product-ids. Empty = no batch/expiry
  // tracking anywhere, which is a real configuration and the one that keeps
  // POS's received-date step out of the way of the specs that use it.
  if (pathname === '/api/batches/tracked-product-ids') return sendJson(res, 200, { productIds: [] })
  // routes/batches.ts GET /picker-lots -> { batches, known_positive_quantity }.
  //
  // Empty `batches` is the untracked-product answer, and it is REQUIRED for the
  // POS to be usable at all: without this route the product detail sheet shows
  // "Received dates: No e2e fixture for this route" and its add button stays
  // disabled reading "Pick a received date first", so nothing can ever reach
  // the cart. Measured while writing storage-isolation.spec.ts.
  //
  // known_positive_quantity mirrors the real route's
  //     SELECT SUM(quantity) FROM branch_batch_stock ... WHERE quantity > 0
  // i.e. how much of the branch's stock is HELD IN LOTS. With `batches: []`
  // that is 0, and productSheetState.ts:438 then derives the "unlotted stock"
  // option as branch_stock - 0, which is what lets a cashier sell stock that
  // predates batch tracking.
  //
  // Getting this wrong is silent and total: returning the branch quantity here
  // instead makes unlotted = 13 - 13 = 0, the sheet offers no option at all,
  // and every add button in the POS stays disabled on "Pick a received date
  // first". Measured, and the reason this comment exists.
  if (pathname === '/api/batches/picker-lots') {
    const productId = Number(query.get('productId'))
    const branchId = Number(query.get('branchId'))
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(branchId) || branchId <= 0) {
      return sendJson(res, 400, { error: 'Positive integer productId and branchId are required' })
    }
    return sendJson(res, 200, { batches: [], known_positive_quantity: 0 })
  }
  // routes/batches.ts GET /damaged-lots -> { lots }. Nothing damaged in the
  // fixture shop; the returns flow is Tier "system" territory.
  if (pathname === '/api/batches/damaged-lots') {
    if (!Number(query.get('productId'))) return sendJson(res, 400, { error: 'productId is required' })
    return sendJson(res, 200, { lots: [] })
  }
  // routes/sales.ts GET /money-precision-capability.
  if (pathname === '/api/sales/money-precision-capability') {
    return sendJson(res, 200, { money_precision_version: 1, schema_ready: true, historical_edit_ready: true })
  }
  // routes/shifts.ts currentResponse() for an admin-exempt user -- the default
  // policy (shift_admin_exempt defaults to true, readShiftPolicy:262), so no
  // shift prompt stands between a spec and the POS screen. The prompt itself
  // is deliberate product behaviour and is NOT what these specs are about.
  if (pathname === '/api/shifts/current') {
    if (!sessionUser) return sendJson(res, 401, { error: 'Not authenticated', code: 'invalid_session' })
    return sendJson(res, 200, {
      shift: null,
      policy: { scope_mode: 'per_account', admin_exempt: true },
      exempt: true,
      needs_registration: false,
      is_open: false,
      can_end: false,
    })
  }
  if (pathname === '/api/shifts/policy') {
    return sendJson(res, 200, { scope_mode: 'per_account', admin_exempt: true })
  }
  // routes/notifications.ts GET /summary.
  if (pathname === '/api/notifications/summary') {
    if (!sessionUser) return sendJson(res, 401, { error: 'Not authenticated', code: 'invalid_session' })
    return sendJson(res, 200, {
      unreadCount: 0,
      unread: 0,
      generatedAt: new Date().toISOString(),
      preferences: {},
      sections: [],
    })
  }
  if (pathname === '/api/import-jobs') {
    if (!sessionUser) return sendJson(res, 401, { error: 'Not authenticated', code: 'invalid_session' })
    // compat.ts GET /import-jobs paging envelope.
    return sendJson(res, 200, { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 })
  }
  if (pathname === '/api/import-jobs/queue/status') {
    return sendJson(res, 200, { import: { waiting: 0, active: 0 }, media: { waiting: 0, active: 0 } })
  }
  if (pathname === '/api/settings') {
    if (!sessionUser) return sendJson(res, 401, { error: 'Not authenticated', code: 'invalid_session' })
    return sendJson(res, 200, settingsFor(req))
  }
  if (pathname === '/api/sales' || pathname === '/api/sales/search') {
    if (!sessionUser) return sendJson(res, 401, { error: 'Not authenticated', code: 'invalid_session' })
    return sendJson(res, 200, ADMIN_SALES)
  }

  // Anything the specs have not pinned. 404 with an explicit marker rather than
  // an empty 200: a silent {} lets a new first-paint dependency appear without
  // anyone noticing, and console-hygiene.spec.ts asserts on the log this
  // produces.
  return sendJson(res, 404, { error: 'No e2e fixture for this route', code: 'e2e_unmocked', path: pathname })
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
  const pathname = url.pathname.replace(/\/{2,}/g, '/')
  requestLog.push({ method: req.method, path: pathname, at: Date.now() })

  // --- control surface ---
  if (pathname === '/__e2e/state') {
    return sendJson(res, 200, { swGeneration: readSwGeneration(req), requests: requestLog })
  }
  if (pathname === '/__e2e/reset') {
    requestLog = []
    return sendJson(res, 200, { requests: [] })
  }

  if (pathname.startsWith('/api/')) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return handleApi(pathname, url.searchParams, req, res, null)
    }
    // POST/PUT bodies are read here rather than inside handleApi so every
    // route stays synchronous and cannot forget to drain the stream (an
    // undrained request body stalls keep-alive connections, which shows up
    // much later as a mystery timeout in an unrelated spec).
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      let parsed = null
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw) { try { parsed = JSON.parse(raw) } catch { parsed = null } }
      handleApi(pathname, url.searchParams, req, res, parsed)
    })
    return undefined
  }

  // /health is the Worker's, not the SPA's -- pathRouting.ts excludes it from
  // the public catalog, so it must not fall through to index.html.
  if (pathname === '/health') return sendJson(res, 200, { status: 'ok' })

  if (pathname === '/sw.js') {
    const body = readServiceWorker(readSwGeneration(req))
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/',
    })
    return res.end(body)
  }

  // The worker precaches '/index.html' by that literal name (service-worker.ts
  // APP_SHELL_URLS) and looks the shell up under it again, so it must get the
  // same stamped document the SPA fallback serves -- otherwise a bumped
  // context would cache generation 0 under one key and generation N under the
  // other.
  if (pathname === '/index.html') return sendIndexHtml(res, readSwGeneration(req))

  const candidate = path.join(distDir, pathname)
  if (candidate.startsWith(distDir) && existsSync(candidate) && statSync(candidate).isFile()) {
    return sendFile(res, candidate)
  }

  // SPA fallback -- every non-asset path is the app (pathRouting.ts decides
  // which of the two roots it mounts).
  if (!path.extname(pathname)) return sendIndexHtml(res, readSwGeneration(req))

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  return res.end('Not found')
})

// ---------------------------------------------------------------------------
// /ws -- the realtime channel (frontend/src/api/websocket.ts)
// ---------------------------------------------------------------------------
// A signed-in shell opens a WebSocket immediately. Leaving it unanswered is not
// neutral: the handshake fails, Chromium logs a console error the app never
// wrote, the client reconnects on a backoff, and every spec that asserts "no
// console errors" in the shell would have to allow-list harness noise -- which
// is precisely how a real console error later gets waved through.
//
// So the handshake is implemented here, by hand, in ~40 lines and with no new
// dependency: accept, say { type: 'connected' }, and answer the client's
// 25-second { type: 'ping' } with { type: 'pong' } so it never hits its own
// pong timeout. Nothing is ever pushed; no spec asserts on realtime delivery.
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8')
  if (payload.length > 125) {
    const header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
    return Buffer.concat([header, payload])
  }
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
}

function decodeClientFrames(buffer) {
  // Good enough for this one client: unfragmented text frames, always masked
  // (browsers must mask), payloads far below 64 KiB.
  const messages = []
  let offset = 0
  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset] & 0x0f
    let length = buffer[offset + 1] & 0x7f
    let cursor = offset + 2
    if (length === 126) { length = buffer.readUInt16BE(cursor); cursor += 2 }
    else if (length === 127) return { messages, rest: Buffer.alloc(0) }
    const mask = buffer.subarray(cursor, cursor + 4)
    cursor += 4
    if (cursor + length > buffer.length) break
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length))
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4]
    cursor += length
    offset = cursor
    if (opcode === 0x8) return { messages, rest: Buffer.alloc(0), closed: true }
    if (opcode === 0x1) messages.push(payload.toString('utf8'))
  }
  return { messages, rest: buffer.subarray(offset) }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']
  if (!req.url?.startsWith('/ws') || !key) {
    socket.destroy()
    return
  }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  socket.write(encodeTextFrame(JSON.stringify({ type: 'connected' })))

  let pending = Buffer.alloc(0)
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk])
    const { messages, rest, closed } = decodeClientFrames(pending)
    pending = rest
    for (const message of messages) {
      let parsed = null
      try { parsed = JSON.parse(message) } catch { parsed = null }
      if (parsed?.type === 'ping') socket.write(encodeTextFrame(JSON.stringify({ type: 'pong' })))
    }
    if (closed) socket.destroy()
  })
  socket.on('error', () => socket.destroy())
})

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error(`[e2e] ${distDir}/index.html is missing -- run "npm run build" first.`)
  process.exit(1)
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[e2e] fixture server on http://127.0.0.1:${PORT} (admin) and http://127.0.0.2:${PORT} (storefront)`)
})
