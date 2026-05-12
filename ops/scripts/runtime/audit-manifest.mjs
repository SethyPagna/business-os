export const ROUTE_MANIFEST = [
  {
    name: 'dashboard',
    scope: 'admin',
    path: '/',
    ready: ['Business OS', 'Dashboard', 'Products'],
    criticalApis: ['/api/dashboard'],
    interactions: {},
  },
  {
    name: 'products',
    scope: 'admin',
    path: '/products',
    ready: ['Products', 'Import', 'Export', 'Manage'],
    criticalApis: ['/api/products/search?page=1&pageSize=20', '/api/products/filters', '/api/products/stats'],
    interactions: {
      search: true,
      // Products exposes several menu/modal entry points that overlap and can
      // intentionally stack overlays. Keep the perf audit focused on the base
      // route/search path; product write flows are covered in dedicated audits.
      primaryButtons: [],
    },
  },
  {
    name: 'inventory',
    scope: 'admin',
    path: '/inventory',
    ready: ['Inventory', 'Products', 'Movements'],
    criticalApis: ['/api/inventory/stats?group=1', '/api/inventory/products/search?group=1&page=1&pageSize=20', '/api/inventory/movements?page=1&pageSize=20'],
    interactions: {
      search: true,
      primaryButtons: ['Filters'],
    },
  },
  {
    name: 'pos',
    scope: 'admin',
    path: '/pos',
    ready: ['Point of Sale', 'POS', 'Cart'],
    criticalApis: ['/api/products/search?page=1&pageSize=10&include=branch_stock,images,batches,family'],
    interactions: {
      search: true,
      primaryButtons: ['Filters'],
    },
  },
  {
    name: 'sales',
    scope: 'admin',
    path: '/sales',
    ready: ['Sales', 'Receipt', 'Search'],
    criticalApis: ['/api/sales?page=1&pageSize=20'],
    interactions: {
      search: true,
      primaryButtons: ['Filters'],
    },
  },
  {
    name: 'returns',
    scope: 'admin',
    path: '/returns',
    ready: ['Returns', 'Return', 'Search'],
    criticalApis: ['/api/returns?page=1&pageSize=20'],
    interactions: {
      search: true,
      primaryButtons: ['Filters'],
    },
  },
  {
    name: 'imports',
    scope: 'admin',
    path: '/imports',
    ready: ['Imports', 'Jobs', 'Queue'],
    criticalApis: ['/api/import-jobs?page=1&pageSize=20', '/api/import-jobs/queue/status'],
    interactions: {},
    browserAudit: false,
  },
  {
    name: 'backup',
    scope: 'admin',
    path: '/backup',
    ready: ['Backup', 'Drive', 'Versions'],
    criticalApis: ['/api/system/drive-sync/status', '/api/system/backups/versions?limit=10', '/api/system/integration-doctor'],
    interactions: {
      search: true,
      primaryButtons: ['Refresh'],
      testIdButtons: [
        { testId: 'backup-doctor-refresh' },
        { testId: 'backup-export-create', waitForProgress: true },
        { testId: 'backup-drive-sync-now', waitForProgress: true },
      ],
    },
  },
  {
    name: 'files',
    scope: 'admin',
    path: '/files',
    ready: ['Library', 'Files', 'Upload'],
    criticalApis: ['/api/files?mediaType=all'],
    interactions: {
      search: true,
      // Upload opens an OS/file-picker style flow that contaminates subsequent
      // same-page navigations in headless audit runs. Audit upload separately
      // with an explicit file-input flow instead of a generic button click.
      primaryButtons: [],
    },
  },
  {
    name: 'contacts',
    scope: 'admin',
    path: '/contacts',
    ready: ['Customers', 'Suppliers', 'Contacts'],
    criticalApis: ['/api/customers', '/api/suppliers', '/api/delivery-contacts'],
    interactions: {
      search: true,
      primaryButtons: ['Add'],
    },
  },
  {
    name: 'branches',
    scope: 'admin',
    path: '/branches',
    ready: ['Branches', 'Branch', 'Stock'],
    criticalApis: ['/api/branches', '/api/branches/summary', '/api/branches/stock-integrity'],
    interactions: {},
  },
  {
    name: 'users',
    scope: 'admin',
    path: '/users',
    ready: ['Users', 'Roles', 'Permissions'],
    criticalApis: ['/api/users', '/api/roles'],
    interactions: {},
  },
  {
    name: 'audit_log',
    scope: 'admin',
    path: '/audit-log',
    ready: ['Audit Log', 'Activity', 'Filters'],
    criticalApis: ['/api/system/audit-logs?page=1&pageSize=20'],
    interactions: {
      search: true,
      primaryButtons: ['Filters', 'Export'],
    },
  },
  {
    name: 'settings',
    scope: 'admin',
    path: '/settings',
    ready: ['Settings', 'Business', 'Appearance'],
    criticalApis: ['/api/settings', '/api/settings/meta'],
    interactions: {},
  },
  {
    name: 'receipt_settings',
    scope: 'admin',
    path: '/receipt-settings',
    ready: ['Receipt', 'Template', 'Preview'],
    criticalApis: ['/api/settings'],
    interactions: {},
  },
  {
    name: 'server',
    scope: 'admin',
    path: '/server',
    ready: ['Server', 'Runtime', 'Health'],
    criticalApis: ['/api/system/config', '/api/runtime/version'],
    interactions: {},
  },
  {
    name: 'loyalty_points',
    scope: 'admin',
    path: '/loyalty-points',
    ready: ['Loyalty', 'Points', 'Membership'],
    criticalApis: ['/api/settings'],
    interactions: {},
  },
  {
    name: 'public_catalog',
    scope: 'public',
    path: '/public',
    ready: ['About', 'Products', 'Membership', 'FAQ'],
    criticalApis: ['/api/portal/catalog/meta', '/api/portal/catalog/products?page=1&pageSize=20'],
    interactions: {
      tabs: ['About', 'Products', 'Membership', 'FAQ'],
      pinnedNavLabels: ['About', 'Products', 'Membership', 'FAQ', 'Beauty Assistant'],
    },
    authRequired: false,
  },
]

export function getRouteManifest(name) {
  return ROUTE_MANIFEST.find((route) => route.name === name) || null
}

export const ADMIN_ROUTES = ROUTE_MANIFEST.filter((route) => route.scope === 'admin' && route.browserAudit !== false)
export const PUBLIC_ROUTES = ROUTE_MANIFEST.filter((route) => route.scope === 'public' && route.browserAudit !== false)

export const FULL_AUDIT_ROUTES = ROUTE_MANIFEST.map((route) => ({
  name: route.name,
  path: route.path,
  api: route.criticalApis || [],
  scope: route.scope,
  authRequired: route.authRequired !== false,
}))

const DESKTOP_PROFILE = { name: 'desktop', viewport: { width: 1365, height: 900 }, isMobile: false }
const MOBILE_PROFILE = { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true }

export function getAuditProfiles(profileName = 'exhaustive') {
  return profileName === 'fast'
    ? [DESKTOP_PROFILE]
    : [DESKTOP_PROFILE, MOBILE_PROFILE]
}
