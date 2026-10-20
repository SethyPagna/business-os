// Shared by the Products table tests: bundles a real source module with esbuild
// (the app-context and portal imports stubbed) and renders the real list surface
// to static markup, so a test reads the header the code produced, not its JSX text.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'

const nodeRequire = createRequire(import.meta.url)

export async function loadSource(rel: string): Promise<Record<string, unknown>> {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(`../src/${rel}`, import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server'],
    plugins: [{ name: 'stubs', setup(builder) {
      builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'stub' }))
      builder.onResolve({ filter: /(?:^|\/)AppContext(?:\.tsx)?$/ }, () => ({ path: 'ctx', namespace: 'stub' }))
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
        contents: args.path === 'portal'
          ? 'export const createPortal = (node) => node;'
          : 'export const useApp = () => globalThis.__ctx; export const useSync = () => ({}); export const useLowStockConfig = () => ({}); export const isBrokenLocalizedString = () => false;',
        loader: 'js',
      }))
    } }],
  })
  const mod = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(nodeRequire, mod, mod.exports)
  return mod.exports
}

// ProductNameRail measures in a layout effect, which React warns about on the server.
const realError = console.error
console.error = (...args: unknown[]) => { if (!String(args[0]).includes('useLayoutEffect')) realError(...args) }
if (!('document' in globalThis)) Object.assign(globalThis, { document: { body: null } })
Object.assign(globalThis, { __ctx: { t: (key: string) => key, user: { permissions: {} }, getPermissionTier: () => 'none', can: () => false } })

const row = (id: number, name: string) => ({ id, name })
export const FIXTURE_SECTIONS = [{
  id: 'S', label: 'Skin', ids: [1, 2, 3], items: [row(1, 'A'), row(2, 'A'), row(3, 'B')],
  groups: [
    { key: 'a', name: 'A', anchorId: 1, ids: [1, 2], items: [row(1, 'A'), row(2, 'A')], rows: [row(1, 'A'), row(2, 'A')], hasMultipleItems: true },
    { key: 'b', name: 'B', anchorId: 3, ids: [3], items: [row(3, 'B')], rows: [row(3, 'B')], hasMultipleItems: false },
  ],
}]

const surface = (await loadSource('components/products/surfaces/ProductsListSurface.tsx')).default as React.ComponentType<Record<string, unknown>>

export function renderSurface(columns: unknown[], overrides: Record<string, unknown> = {}): string {
  const t = (key: string) => key
  return renderToStaticMarkup(React.createElement(surface, {
    allVisibleProducts: [row(1, 'A'), row(2, 'A'), row(3, 'B')], collapsedProductGroups: new Set(), collapsedProductSections: new Set(),
    getGroupSummaryParts: () => [], initialDesktopRevealReady: true, isSelectionScopeFullySelected: () => false,
    isSelectionScopePartiallySelected: () => false, allVisibleIds: [1, 2, 3], columns, columnChooser: React.createElement('button', { 'data-chooser': '' }),
    loading: false, productSections: FIXTURE_SECTIONS, refreshingProducts: false,
    renderDesktopProductRow: (product: { id: number }) => React.createElement('tr', { key: product.id, 'data-row': '' }),
    renderMobileProductCard: () => null, selectionModeActive: false, t, toggleProductGroup() {}, toggleProductSection() {},
    toggleSelectionScope() {}, tr: (_key: string, fallback: string) => fallback, visibleProducts: [row(1, 'A'), row(2, 'A'), row(3, 'B')], ...overrides,
  }))
}

export const headOf = (html: string) => html.slice(html.indexOf('<thead'), html.indexOf('</thead>'))
