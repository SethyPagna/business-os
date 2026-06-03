import { defineConfig } from 'vite'
import type { IndexHtmlTransformContext, Plugin, UserConfig } from 'vite'
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
 * 2. The inline suppressor script in index.html (added to template) runs
 *    before vendor.js is parsed, so it catches the Capacitor unhandledrejection
 *    BEFORE React's scheduler can pick it up.
 *
 * 3. Every JS/CSS chunk uses a content hash. This prevents Funnel/mobile
 *    browsers from combining a fresh entry bundle with an older cached shared
 *    chunk such as app-shared.js, which causes missing export boot failures.
 *
 * 4. assetsInlineLimit = 0 prevents base64-inlining of small assets, which
 *    can cause "data:..." URLs to be treated as cross-origin by strict browsers.
 */

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

const deferredModulePreloadPrefixes = [
  'assets/file-picker-modal-',
  'assets/image-lightbox-',
  'assets/media-upload-utils-',
  'assets/favicon-utils-',
  'assets/public-asset-urls-',
  'assets/notification-center-',
  'assets/background-import-tracker-',
  'assets/write-conflict-modal-',
  'assets/shared-portal-menu-',
  'assets/auth-login-',
  'assets/app-bootstrap-',
  'assets/app-auth-',
  'assets/app-portal-',
  'assets/app-system-',
  'assets/catalog-',
  'assets/catalog-preview-',
  'assets/catalog-editor-',
  'assets/portal-tools-',
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
  'bot',
  'check-circle-2',
  'chevron-down',
  'chevron-up',
  'eye',
  'external-link',
  'facebook',
  'globe',
  'help-circle',
  'images',
  'info',
  'instagram',
  'mail',
  'map-pin',
  'phone',
  'plus',
  'save',
  'search',
  'send',
  'settings-2',
  'sparkles',
  'store',
  'upload',
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
    if (normalized.endsWith('/src/api/methods.ts')) return 'app-api-methods'
    if (normalized.endsWith('/src/api/appBootstrapTransport.ts')) return 'app-bootstrap'
    if (normalized.endsWith('/src/api/authTransport.ts')) return 'app-auth'
    if (normalized.endsWith('/src/api/systemRuntime.ts')) return 'app-system'
    if (
      normalized.endsWith('/src/api/portalTransport.ts')
      || normalized.endsWith('/src/api/portalHttp.ts')
    ) return 'app-portal'
    if (normalized.endsWith('/src/api/localDb.ts')) return 'app-local-db'
    if (
      normalized.endsWith('/src/utils/csv.ts')
      || normalized.endsWith('/src/utils/csvTemplate.ts')
      || normalized.endsWith('/src/utils/csvImport.ts')
    ) {
      return 'csv-utils'
    }
    if (normalized.includes('/src/components/auth/Login.tsx')) return 'auth-login'
    if (
      normalized.includes('/src/components/products/shared/')
      || normalized.includes('/src/components/products/helpers/productGalleryHelpers.ts')
    ) {
      return 'product-shared'
    }
    if (normalized.endsWith('/src/utils/actionGuards.ts')) {
      return 'action-guards'
    }
    if (
      normalized.includes('/src/components/catalog/CatalogEditorSurface.tsx')
      || normalized.includes('/src/components/catalog/CatalogImageField.tsx')
    ) {
      return 'catalog-editor'
    }
    if (
      normalized.includes('/src/components/catalog/CatalogPreviewSurface.tsx')
      || normalized.includes('/src/components/catalog/CatalogSecondaryTabs.tsx')
      || normalized.includes('/src/components/catalog/CatalogProductsSection.tsx')
    ) {
      return 'catalog-preview'
    }
    if (normalized.includes('/src/utils/initials.ts')) {
      return 'initials-utils'
    }
    if (normalized.endsWith('/src/utils/publicAssetUrls.ts')) {
      return 'public-asset-urls'
    }
    if (normalized.includes('/src/components/catalog/catalogUi.tsx')) {
      return 'catalog-ui'
    }
    if (normalized.includes('/src/components/catalog/portalCatalogDisplay.ts')) {
      return 'catalog-display'
    }
    if (normalized.includes('/src/components/catalog/CatalogPageContext.tsx')) {
      return 'catalog-context'
    }
    if (normalized.includes('/src/components/catalog/')) return 'catalog'
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
      normalized.includes('/src/components/catalog/portalLanguagePacks.ts')
      || normalized.includes('/src/components/catalog/portalContentI18n.ts')
      || normalized.includes('/src/components/catalog/portalTranslateController.ts')
      || normalized.includes('/src/components/catalog/portalEditorUtils.ts')
    ) {
      return 'portal-tools'
    }
    if (
      normalized.includes('/src/components/products/surfaces/ProductDetailModal.tsx')
      || normalized.includes('/src/components/inventory/ProductDetailModal.tsx')
      || normalized.includes('/src/utils/productBatches.ts')
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
      normalized.endsWith('/src/api/http.ts')
      || normalized.endsWith('/src/api/websocket.ts')
      || normalized.endsWith('/src/api/syncRuntime.ts')
      || normalized.endsWith('/src/api/dashboardTransport.ts')
      || normalized.endsWith('/src/api/query.ts')
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
  plugins: [react(), fixCrossorigin(), emitBuildManifest()],

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
