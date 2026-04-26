import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
 * 3. chunk names are stable (no content hash on chunk filenames, only on
 *    asset filenames) so browser cache invalidation works correctly when only
 *    one chunk changes.
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
        // Stable chunk names ensure proper cache invalidation
        manualChunks: {
          vendor:  ['react', 'react-dom'],
          dexie:   ['dexie'],
          lucide:  ['lucide-react'],
        },
        // Keep lazy route chunk names stable so public Funnel sessions do not
        // break when an older shell requests a page bundle after a deploy.
        chunkFileNames: 'assets/[name].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
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
  },
})
