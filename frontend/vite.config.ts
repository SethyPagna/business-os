import { defineConfig } from 'vite'
import type { IndexHtmlTransformContext, Plugin, UserConfig } from 'vite'
import type { OutputBundle, OutputChunk } from 'rollup'
import react from '@vitejs/plugin-react'
import autoprefixer from 'autoprefixer'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from 'tailwindcss'

function readGitRevision(): string {
  if (process.env.BUSINESS_OS_BUILD_REVISION) return process.env.BUSINESS_OS_BUILD_REVISION
  try {
    return execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'dev'
  }
}

const buildRevision = readGitRevision()
const buildHash = process.env.BUSINESS_OS_BUILD_HASH
  || createHash('sha256').update(`frontend:${buildRevision}:${Date.now()}`).digest('hex').slice(0, 16)
const publicRuntimeScripts = [
  'runtime-noise-guard.js',
  'theme-bootstrap.js',
]

/**
 * vite.config.ts
 *
 * KEY FIXES (Tailscale + cross-origin compatibility):
 *
 * 1. crossorigin removed from ALL asset tags (scripts + stylesheets).
 *    Vite adds crossorigin="anonymous" to <link rel="stylesheet"> and
 *    <script type="module"> when manualChunks is used. This forces CORS
 *    mode on all asset fetches, which fails on Tailscale Funnel (and some
 *    LAN proxies) because the tunnel proxy doesn't forward ACAO headers for
 *    sub-resources. The fixCrossorigin plugin below strips the attribute from
 *    the compiled index.html.
 *
 * 2. Public runtime guards are authored in TypeScript, emitted to public/*.js,
 *    and inlined into built HTML. They must run before vendor.js is parsed, but
 *    they are too small and too critical to spend separate cold-start requests.
 *
 * 3. Every JS/CSS chunk uses a content hash. This prevents Funnel/mobile
 *    browsers from combining a fresh entry bundle with an older cached shared
 *    chunk such as app-shared.js, which causes missing export boot failures.
 *
 * 4. assetsInlineLimit = 0 prevents base64-inlining of small assets, which
 *    can cause "data:..." URLs to be treated as cross-origin by strict browsers.
 */

function escapeInlineScript(source: string): string {
  return source
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
}

function inlinePublicRuntimeScripts(): Plugin {
  return {
    name: 'inline-public-runtime-scripts',
    transformIndexHtml(html: string, _ctx?: IndexHtmlTransformContext): string {
      let nextHtml = html
      for (const fileName of publicRuntimeScripts) {
        const scriptPath = path.join(__dirname, 'public', fileName)
        let source = ''
        try {
          source = readFileSync(scriptPath, 'utf8').trim()
        } catch {
          continue
        }
        if (!source) continue
        const inlineTag = `<script data-business-os-runtime="${fileName}">${escapeInlineScript(source)}</script>`
        nextHtml = nextHtml.replace(
          new RegExp(`<script\\s+src=["']/${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\\s*>\\s*</script>`, 'i'),
          inlineTag,
        )
      }
      return nextHtml
    },
  }
}

function fixCrossorigin(): Plugin {
  return {
    name: 'fix-crossorigin',
    /**
     * Strip crossorigin from all link and script tags in the built HTML.
     * - <link rel="stylesheet" crossorigin>  → <link rel="stylesheet">
     * - <script type="module" crossorigin>   → <script type="module">
     * - <link rel="modulepreload" crossorigin> → <link rel="modulepreload">
     *
     * We keep crossorigin only on the Google Fonts preconnect tag (it's required
     * by the Fonts API spec) — that tag uses crossorigin without an = value so the
     * regex below (which only matches crossorigin=" or crossorigin ") won't touch it.
     */
    transformIndexHtml(html: string, _ctx?: IndexHtmlTransformContext): string {
      return html
        // Remove crossorigin="anonymous" and crossorigin="" from script/link tags
        .replace(/(<(?:link|script)[^>]*)\s+crossorigin(?:="[^"]*")?\s*/g, '$1 ')
        // Clean up any double spaces left by the replacement
        .replace(/ {2,}/g, ' ')
        // Fix self-closing tags that may now have a trailing space before />
        .replace(/ \/>/g, '/>')
    },
  }
}

function emitBuildManifest(): Plugin {
  return {
    name: 'business-os-build-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'business-os-build.json',
        source: JSON.stringify({
          revision: buildRevision,
          hash: buildHash,
          builtAt: new Date().toISOString(),
        }, null, 2),
      })
    },
    writeBundle(options): void {
      const outDir = path.resolve(options.dir || 'dist')
      const serviceWorkerPath = path.join(outDir, 'sw.js')
      try {
        const source = readFileSync(serviceWorkerPath, 'utf8')
        if (!source.includes('__BUSINESS_OS_BUILD_HASH__')) return
        writeFileSync(
          serviceWorkerPath,
          source.replaceAll('__BUSINESS_OS_BUILD_HASH__', buildHash),
          'utf8',
        )
      } catch {
        // Ignore missing service worker output during non-standard builds.
      }
    },
  }
}

const routePreloadChunkNames = {
  admin: [
    'AdminRoot',
    'auth-login',
    'app-auth',
    'app-bootstrap',
  ],
  public: [
    'PublicCatalogRoot',
    'catalog',
    'route-sync-utils',
    'app-portal',
    'portal-tools',
  ],
}

function isBundleChunk(value: unknown): value is OutputChunk {
  return Boolean(value && typeof value === 'object' && (value as OutputChunk).type === 'chunk')
}

function toRoutePreloadFiles(bundle: OutputBundle, names: string[]): string[] {
  const wanted = new Set(names)
  const files = Object.values(bundle)
    .filter(isBundleChunk)
    .filter((chunk) => wanted.has(chunk.name))
    .map((chunk) => chunk.fileName)
    .sort()
  return Array.from(new Set(files))
}

function buildRoutePreloadScript(preloads: Record<'admin' | 'public', string[]>): string {
  return `<script data-business-os-route-preloads>${escapeInlineScript(`(function installBusinessOsRoutePreloads() {
  var preloads = ${JSON.stringify(preloads)};
  function normalizePath(value) {
    return String(value || '/')
      .split('?')[0]
      .split('#')[0]
      .replace(/\\/{2,}/g, '/')
      .replace(/\\/+$/g, '')
      .toLowerCase() || '/';
  }
  function isAdminAppPath(pathname) {
    if (pathname === '/') return true;
    var segment = pathname.split('/').filter(Boolean)[0] || '';
    return [
      'admin',
      'app',
      'login',
      'dashboard',
      'products',
      'product',
      'pos',
      'point-of-sale',
      'inventory',
      'sales',
      'returns',
      'branches',
      'contacts',
      'catalog',
      'loyalty-points',
      'loyalty',
      'users',
      'audit-log',
      'audit',
      'receipt-settings',
      'receipts',
      'backup',
      'backups',
      'settings',
      'files',
      'library',
      'server'
    ].indexOf(segment) !== -1;
  }
  function isPublicCatalogPath(pathname) {
    if (!pathname || pathname === '/' || pathname === '/health') return false;
    if (pathname.indexOf('/api/') === 0 || pathname.indexOf('/uploads/') === 0) return false;
    if (/\\.[a-z0-9]+$/i.test(pathname)) return false;
    return !isAdminAppPath(pathname);
  }
  var pathname = normalizePath(window.location && window.location.pathname);
  var files = isPublicCatalogPath(pathname) ? preloads.public : preloads.admin;
  files.forEach(function preload(file) {
    var href = '/' + String(file || '').replace(/^\\/+/, '');
    if (!href || document.querySelector('link[rel="modulepreload"][href="' + href + '"]')) return;
    var link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = href;
    document.head.appendChild(link);
  });
}());`)}</script>`
}

function injectRouteAwareModulePreloads(): Plugin {
  return {
    name: 'business-os-route-aware-module-preloads',
    transformIndexHtml: {
      order: 'post',
      handler(html: string, ctx?: IndexHtmlTransformContext): string {
        const bundle = ctx?.bundle
        if (!bundle || html.includes('data-business-os-route-preloads')) return html
        const preloads = {
          admin: toRoutePreloadFiles(bundle, routePreloadChunkNames.admin),
          public: toRoutePreloadFiles(bundle, routePreloadChunkNames.public),
        }
        const script = buildRoutePreloadScript(preloads)
        return html.replace(/(\s*<script type="module")/, `\n    ${script}$1`)
      },
    },
  }
}

const deferredModulePreloadPrefixes = [
  'assets/file-picker-modal-',
  'assets/image-lightbox-',
  'assets/media-upload-utils-',
  'assets/favicon-utils-',
  'assets/notification-center-',
  'assets/background-import-tracker-',
  'assets/write-conflict-modal-',
  'assets/browser-dialogs-',
  'assets/product-detail-',
  'assets/shared-portal-menu-',
  'assets/auth-login-',
  'assets/app-bootstrap-',
  'assets/app-auth-',
  'assets/app-api-methods-',
  'assets/api-http-state-',
  'assets/app-portal-',
  'assets/app-shell-',
  'assets/app-shell-icons-',
  'assets/app-system-',
  'assets/action-history-api-',
  'assets/ai-api-',
  'assets/audit-log-api-',
  'assets/branch-api-',
  'assets/contacts-api-',
  'assets/custom-tables-api-',
  'assets/dashboard-api-',
  'assets/dashboard-export-',
  'assets/drive-sync-api-',
  'assets/file-api-',
  'assets/inventory-api-',
  'assets/inventory-export-',
  'assets/inventory-write-api-',
  'assets/import-jobs-api-',
  'assets/multipart-headers-api-',
  'assets/notification-api-',
  'assets/pending-sync-api-',
  'assets/product-export-',
  'assets/product-image-upload-api-',
  'assets/product-read-api-',
  'assets/product-write-api-',
  'assets/rfid-api-',
  'assets/returns-write-api-',
  'assets/sale-write-api-',
  'assets/sales-read-api-',
  'assets/shared-action-history-',
  'assets/system-jobs-api-',
  'assets/catalog-',
  'assets/catalog-secondary-tabs-',
  'assets/catalog-editor-',
  'assets/portal-language-packs-',
  'assets/portal-content-i18n-',
  'assets/backup-reset-tools-',
  'assets/settings-otp-modal-',
  'assets/settings-api-',
  'assets/Sidebar-',
  'assets/user-profile-modal-',
  'assets/user-detail-sheet-',
  'assets/user-permission-editor-',
  'assets/branch-transfer-modal-',
  'assets/app-local-db-',
  'assets/vendor-dexie-',
  'assets/vendor-zxing-',
]

const appShellIconNames = new Set([
  'arrow-down',
  'arrow-up',
  'badge-dollar-sign',
  'bell',
  'book-user',
  'boxes',
  'building-2',
  'clipboard-list',
  'database-backup',
  'folder-open',
  'languages',
  'layout-dashboard',
  'log-out',
  'moon',
  'more-horizontal',
  'package',
  'receipt',
  'rotate-ccw',
  'server',
  'settings',
  'shopping-bag',
  'shopping-cart',
  'sun',
  'ticket',
  'users',
])

const authLoginIconNames = new Set([
  'arrow-left',
  'chrome',
  'key-round',
  'loader-2',
  'lock-keyhole',
  'shield-check',
])

const routeSharedIconNames = new Set([
  'alert-circle',
  'alert-triangle',
  'arrow-down',
  'arrow-right',
  'arrow-up',
  'badge-check',
  'badge-dollar-sign',
  'badge-percent',
  'bell',
  'bot',
  'check-circle-2',
  'chevron-down',
  'chevron-up',
  'eye',
  'eye-off',
  'external-link',
  'facebook',
  'flame',
  'globe',
  'help-circle',
  'image-off',
  'images',
  'info',
  'instagram',
  'languages',
  'mail',
  'map-pin',
  'medal',
  'moon',
  'phone',
  'plus',
  'rotate-ccw',
  'save',
  'search',
  'send',
  'settings-2',
  'shield-alert',
  'shopping-bag',
  'sparkles',
  'store',
  'sun',
  'ticket',
  'trash-2',
  'truck',
  'trophy',
  'undo-2',
  'upload',
  'warehouse',
  'x',
])

function shouldDeferModulePreload(dep: string): boolean {
  return deferredModulePreloadPrefixes.some((prefix) => dep.includes(prefix))
}

function manualChunks(id: string): string | undefined {
  // Keep the shared vendor graph stable while still letting route chunks stay
  // small enough that first-open admin pages do not drag the whole app shell
  // over the wire up front.
  const normalized = id.replace(/\\/g, '/')
  if (normalized.includes('/node_modules/lucide-react/dist/esm/icons/')) {
    const iconName = path.basename(normalized, '.js')
    if (authLoginIconNames.has(iconName)) return 'auth-login'
    if (routeSharedIconNames.has(iconName)) return 'shared-icons'
    return appShellIconNames.has(iconName) ? 'app-shell-icons' : undefined
  }
  if (!id.includes('node_modules')) {
    if (normalized.endsWith('/src/lang/en.json')) return 'lang-en'
    if (normalized.endsWith('/src/lang/km.json')) return 'lang-km'
    if (
      normalized.endsWith('/src/api/http.ts')
      || normalized.endsWith('/src/api/query.ts')
      || normalized.endsWith('/src/api/actorQuery.ts')
    ) {
      return 'api-http-core'
    }
    if (normalized.endsWith('/src/api/httpState.ts')) return 'api-http-state'
    if (normalized.endsWith('/src/utils/settingsRefresh.ts')) return 'settings-refresh'
    if (normalized.endsWith('/src/utils/searchTerms.ts')) return 'route-sync-utils'
    if (normalized.endsWith('/src/utils/groupedRecords.ts')) return 'record-groups'
    if (normalized.endsWith('/src/api/methods.ts')) return 'app-api-methods'
    if (normalized.endsWith('/src/api/contactReadTransport.ts')) return 'contact-read-api'
    if (normalized.endsWith('/src/api/contactWriteTransport.ts')) return 'contact-write-api'
    if (normalized.endsWith('/src/api/contactsTransport.ts')) return 'contacts-api'
    if (normalized.endsWith('/src/api/auditLogTransport.ts')) return 'audit-log-api'
    if (
      normalized.endsWith('/src/api/fileTransport.ts')
    ) return 'file-api'
    if (normalized.endsWith('/src/api/multipartHeaders.ts')) return 'multipart-headers-api'
    if (normalized.endsWith('/src/api/aiTransport.ts')) return 'ai-api'
    if (normalized.endsWith('/src/api/salesTransport.ts')) return 'sales-read-api'
    if (normalized.endsWith('/src/api/saleWriteTransport.ts')) return 'sale-write-api'
    if (normalized.endsWith('/src/api/systemJobs.ts')) return 'system-jobs-api'
    if (
      normalized.endsWith('/src/api/notificationSummary.ts')
      || normalized.endsWith('/src/api/cooldownFallbacks.ts')
    ) return 'notification-api'
    if (normalized.endsWith('/src/api/productWriteTransport.ts')) return 'product-write-api'
    if (normalized.endsWith('/src/api/productImageUploadTransport.ts')) return 'product-image-upload-api'
    if (normalized.endsWith('/src/api/branchTransport.ts')) return 'branch-api'
    if (normalized.endsWith('/src/api/inventoryTransport.ts')) return 'inventory-api'
    if (normalized.endsWith('/src/components/inventory/inventoryExport.ts')) return 'inventory-export'
    if (normalized.endsWith('/src/api/inventoryWriteTransport.ts')) return 'inventory-write-api'
    if (
      normalized.endsWith('/src/api/importJobsTransport.ts')
      || normalized.endsWith('/src/api/importTransport.ts')
    ) return 'import-jobs-api'
    if (normalized.endsWith('/src/api/userAdminTransport.ts')) return 'user-admin-api'
    if (normalized.endsWith('/src/api/userReadTransport.ts')) return 'user-read-api'
    if (normalized.endsWith('/src/api/customTablesTransport.ts')) return 'custom-tables-api'
    if (normalized.endsWith('/src/api/driveSync.ts')) return 'drive-sync-api'
    if (normalized.endsWith('/src/api/dashboardTransport.ts')) return 'dashboard-api'
    if (normalized.includes('/src/components/dashboard/charts/')) return 'dashboard-charts'
    if (normalized.endsWith('/src/components/dashboard/dashboardExport.ts')) return 'dashboard-export'
    if (normalized.endsWith('/src/api/returnsReadTransport.ts')) return 'returns-read-api'
    if (normalized.endsWith('/src/api/returnsTransport.ts')) return 'returns-write-api'
    if (normalized.endsWith('/src/api/rfidTransport.ts')) return 'rfid-api'
    if (normalized.endsWith('/src/api/actionHistoryTransport.ts')) return 'action-history-api'
    if (normalized.endsWith('/src/api/offlineSnapshotTransport.ts')) return 'offline-snapshot-api'
    if (normalized.endsWith('/src/api/pendingSyncTransport.ts')) return 'pending-sync-api'
    if (normalized.endsWith('/src/api/settingsTransport.ts')) return 'settings-api'
    if (normalized.endsWith('/src/api/requestIds.ts')) return 'request-ids'
    if (normalized.endsWith('/src/api/conflicts.ts')) return 'api-conflicts'
    if (
      normalized.endsWith('/src/api/productReadTransport.ts')
      || normalized.endsWith('/src/api/lookupTransport.ts')
      || normalized.endsWith('/src/api/expectedUpdatedAt.ts')
      || normalized.endsWith('/src/api/localMirrors.ts')
      || normalized.endsWith('/src/api/lazyLocalDb.ts')
      || normalized.endsWith('/src/api/queryCache.ts')
    ) {
      return 'product-read-api'
    }
    if (normalized.endsWith('/src/api/appBootstrapTransport.ts')) return 'app-bootstrap'
    if (normalized.endsWith('/src/api/authTransport.ts')) return 'app-auth'
    if (normalized.endsWith('/src/api/systemRuntime.ts')) return 'app-system'
    if (normalized.endsWith('/src/api/browserDialogs.ts')) return 'browser-dialogs'
    if (
      normalized.endsWith('/src/api/portalTransport.ts')
      || normalized.endsWith('/src/api/portalHttp.ts')
    ) return 'app-portal'
    if (normalized.endsWith('/src/app/pathRouting.ts')) return 'app-routing'
    if (normalized.endsWith('/src/api/localDb.ts')) return 'app-local-db'
    if (
      normalized.endsWith('/src/utils/csv.ts')
      || normalized.endsWith('/src/utils/csvTemplate.ts')
      || normalized.endsWith('/src/utils/csvImport.ts')
    ) {
      return 'csv-utils'
    }
    if (normalized.endsWith('/src/components/products/helpers/productExport.ts')) {
      return 'product-export'
    }
    if (normalized.endsWith('/src/utils/mediaUploadState.ts')) {
      return 'media-upload-state'
    }
    if (normalized.endsWith('/src/utils/formatters.ts')) {
      return 'shared-formatters'
    }
    if (normalized.includes('/src/components/auth/Login.tsx')) return 'auth-login'
    if (
      normalized.includes('/src/components/products/shared/')
      || normalized.includes('/src/components/products/helpers/productGalleryHelpers.ts')
      || normalized.includes('/src/utils/productBatches.ts')
      || normalized.endsWith('/src/utils/productGrouping.ts')
      || normalized.includes('/src/utils/color.ts')
    ) {
      return 'product-shared'
    }
    if (normalized.endsWith('/src/utils/actionGuards.ts')) return 'route-sync-utils'
    if (normalized.endsWith('/src/utils/historyHelpers.ts')) return 'shared-action-history'
    if (normalized.endsWith('/src/utils/actionHistory.ts')) {
      return 'shared-action-history'
    }
    if (
      normalized.includes('/src/components/catalog/CatalogEditorSurface.tsx')
      || normalized.includes('/src/components/catalog/CatalogImageField.tsx')
    ) {
      return 'catalog-editor'
    }
    if (normalized.includes('/src/components/catalog/CatalogSecondaryTabs.tsx')) {
      return 'catalog-secondary-tabs'
    }
    if (normalized.includes('/src/utils/initials.ts')) return 'route-sync-utils'
    if (normalized.endsWith('/src/utils/scriptTypography.ts')) return 'route-sync-utils'
    if (normalized.endsWith('/src/utils/publicAssetUrls.ts')) {
      return 'app-shared'
    }
    if (normalized.includes('/src/components/catalog/portalTranslateController.ts')) {
      return 'portal-translate-controller'
    }
    if (normalized.includes('/src/components/catalog/portalLanguagePacks.ts')) {
      return 'portal-language-packs'
    }
    if (normalized.includes('/src/components/catalog/portalContentI18n.ts')) {
      return 'portal-content-i18n'
    }
    if (
      normalized.includes('/src/components/catalog/portalSubmissionHelpers.ts')
      || normalized.includes('/src/components/catalog/portalAssistantHelpers.ts')
    ) {
      return 'portal-tools'
    }
    if (normalized.includes('/src/components/catalog/')) return 'catalog'
    if (normalized.includes('/src/components/utils-settings/ResetData.tsx')) return 'backup-reset-tools'
    if (normalized.includes('/src/components/utils-settings/OtpModal.tsx')) return 'settings-otp-modal'
    if (normalized.includes('/src/components/users/permissionDefinitions.ts')) return 'user-permission-definitions'
    if (normalized.includes('/src/components/users/UserProfileModal.tsx')) return 'user-profile-modal'
    if (normalized.includes('/src/components/users/UserDetailSheet.tsx')) return 'user-detail-sheet'
    if (normalized.includes('/src/components/users/PermissionEditor.tsx')) return 'user-permission-editor'
    if (normalized.includes('/src/components/branches/TransferModal.tsx')) return 'branch-transfer-modal'
    if (normalized.includes('/src/utils/favicon')) {
      return 'favicon-utils'
    }
    if (normalized.includes('/src/utils/mediaUpload.ts')) {
      return 'media-upload-utils'
    }
    if (normalized.includes('/src/components/shared/ImageGalleryLightbox')) {
      return 'image-lightbox'
    }
    if (normalized.includes('/src/components/shared/PortalMenu.tsx')) return 'shared-portal-menu'
    if (normalized.includes('/src/components/files/FilePickerModal')) {
      return 'file-picker-modal'
    }
    if (
      normalized.includes('/src/components/products/surfaces/ProductDetailModal.tsx')
      || normalized.includes('/src/components/inventory/ProductDetailModal.tsx')
    ) {
      return 'product-detail'
    }
    if (normalized.includes('/src/components/shared/NotificationCenter.tsx')) return 'notification-center'
    if (normalized.includes('/src/components/shared/BackgroundImportTracker.tsx')) return 'background-import-tracker'
    if (normalized.includes('/src/components/shared/WriteConflictModal.tsx')) return 'write-conflict-modal'
    if (normalized.includes('/src/components/shared/PaginationControls.tsx')) return 'shared-pagination'
    if (normalized.includes('/src/components/shared/ActionHistoryBar.tsx')) return 'shared-action-history'
    if (normalized.includes('/src/components/shared/FilterMenu.tsx')) return 'shared-filter-menu'
    if (normalized.includes('/src/components/shared/SectionSwitcher.tsx')) return 'shared-section-switcher'
    if (normalized.includes('/src/components/shared/PageHeader.tsx')) return 'shared-page-header'
    if (normalized.includes('/src/components/shared/Modal.tsx')) return 'shared-modal'
    if (
      normalized.endsWith('/src/api/websocket.ts')
      || normalized.endsWith('/src/api/syncRuntime.ts')
      || normalized.endsWith('/src/api/dashboardTransport.ts')
    ) {
      return 'app-api'
    }
    if (normalized.includes('/src/api/')) return 'app-api-methods'
    if (normalized.includes('/src/app/')) return 'app-shell'
    if (normalized.includes('/src/components/shared/')) return 'app-shared'
    return undefined
  }
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
  if (/[\\/]node_modules[\\/]dexie[\\/]/.test(id)) return 'vendor-dexie'
  if (/[\\/]node_modules[\\/]@zxing[\\/]/.test(id)) return 'vendor-zxing'
  if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return undefined
  if (/[\\/]node_modules[\\/]@capacitor[\\/]/.test(id)) return 'vendor-capacitor'
  return 'vendor'
}

export default defineConfig({
  plugins: [react(), inlinePublicRuntimeScripts(), fixCrossorigin(), emitBuildManifest(), injectRouteAwareModulePreloads()],

  build: {
    outDir: 'dist',
    // Clean the output on each build. Stale-tab compatibility is handled by
    // the backend asset resolver, so the shipped build can stay lean.
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: {
      resolveDependencies(_filename: string, deps: string[]): string[] {
        return deps.filter((dep) => !shouldDeferModulePreload(dep))
      },
    },
    // Inline only files below 1 byte (effectively disables inlining)
    // Prevents base64 data: URLs for small images which confuse CSP/CORS
    assetsInlineLimit: 1,
    rollupOptions: {
      output: {
        manualChunks,
        // Hashed chunks keep the entry bundle and shared chunks in lockstep
        // after rebuilds. Stale tabs heal through lazy chunk reload handling.
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames(assetInfo): string {
          const name = String(assetInfo?.name || '')
          if (name.endsWith('.css')) return 'assets/[name]-[hash][extname]'
          return 'assets/[name]-[hash][extname]'
        },
      },
    },
  },

  css: {
    postcss: {
      plugins: [
        tailwindcss(),
        autoprefixer(),
      ],
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api':     { target: 'http://localhost:4000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: true },
      '/health':  { target: 'http://localhost:4000', changeOrigin: true },
      '/ws':      { target: 'ws://localhost:4000',   changeOrigin: true, ws: true },
    },
  },

  define: {
    __SERVER_URL__: JSON.stringify(process.env.VITE_SERVER_URL || ''),
    __FRONTEND_BUILD_HASH__: JSON.stringify(buildHash),
    __FRONTEND_BUILD_REVISION__: JSON.stringify(buildRevision),
  },
} satisfies UserConfig)
