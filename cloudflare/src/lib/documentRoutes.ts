// Which requests are app documents. A leaf module (no imports): src/index.ts
// reads it, and frontend tests import it directly. Which HOST is the staff
// app's is lib/publicHostGate.ts isStaffHostname.

// The SPA's document routes. Every one of these serves the same index.html,
// so every one of them is a URL someone can be sitting on when they tap Add
// to Home Screen -- which is why the identity rewrite cannot be limited to '/'.
//
// These segments mirror frontend/src/app/pathRouting.ts's
// ADMIN_ROUTE_PAGE_BY_SEGMENT plus ADMIN_AUTH_ROUTE_SEGMENTS; the pure test
// fails if the two lists drift apart or if wrangler.toml's run_worker_first
// stops covering them (a path routed to the Worker without a handler here
// would 404 the whole page, and a path handled here without being in
// run_worker_first never reaches the Worker at all).
export const ADMIN_DOCUMENT_SEGMENTS: readonly string[] = [
  'admin', 'app', 'login',
  'audit', 'audit-log', 'backup', 'backups', 'branches', 'catalog', 'contacts',
  'dashboard', 'delivery-contacts', 'fees', 'files', 'inventory', 'library',
  'loyalty', 'loyalty-points', 'notes', 'point-of-sale', 'pos', 'product',
  'products', 'promos', 'promotions', 'receipt-settings', 'receipts', 'returns',
  'review', 'review-queue', 'sales', 'server', 'settings', 'users',
]

export const APP_DOCUMENT_ROUTES: readonly string[] = [
  '/',
  '/index.html',
  ...ADMIN_DOCUMENT_SEGMENTS.flatMap((segment) => ['/' + segment, '/' + segment + '/*']),
]
