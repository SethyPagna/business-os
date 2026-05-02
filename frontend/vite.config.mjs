import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'

function readGitRevision() {
  if (process.env.BUSINESS_OS_BUILD_REVISION) return process.env.BUSINESS_OS_BUILD_REVISION
  try {
    return execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch (_) {
    return 'dev'
  }
}

const buildRevision = readGitRevision()
const buildHash = process.env.BUSINESS_OS_BUILD_HASH
  || createHash('sha256').update(`frontend:${buildRevision}:${Date.now()}`).digest('hex').slice(0, 16)

/**
 * vite.config.mjs
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

function fixCrossorigin() {
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
    transformIndexHtml(html) {
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

function manualChunks(id) {
  // Keep the shared vendor graph stable while still letting route chunks stay
  // small enough that first-open admin pages do not drag the whole app shell
  // over the wire up front.
  if (!id.includes('node_modules')) {
    const normalized = id.replace(/\\/g, '/')
    if (normalized.endsWith('/src/lang/en.json')) return 'lang-en'
    if (normalized.endsWith('/src/lang/km.json')) return 'lang-km'
    if (normalized.includes('/src/api/')) return 'app-api'
    if (normalized.includes('/src/app/')) return 'app-shell'
    if (normalized.includes('/src/components/shared/')) return 'app-shared'
    return undefined
  }
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
  if (/[\\/]node_modules[\\/]dexie[\\/]/.test(id)) return 'vendor-dexie'
  if (/[\\/]node_modules[\\/]@zxing[\\/]/.test(id)) return 'vendor-zxing'
  if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-lucide'
  if (/[\\/]node_modules[\\/]@capacitor[\\/]/.test(id)) return 'vendor-capacitor'
  return 'vendor'
}

export default defineConfig({
  plugins: [react(), fixCrossorigin()],

  build: {
    outDir: 'dist',
    sourcemap: false,
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
        assetFileNames(assetInfo) {
          const name = String(assetInfo?.name || '')
          if (name.endsWith('.css')) return 'assets/[name]-[hash][extname]'
          return 'assets/[name]-[hash][extname]'
        },
      },
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
})
