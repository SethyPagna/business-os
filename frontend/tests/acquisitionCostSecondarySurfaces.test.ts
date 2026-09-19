import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { effectivePermissions, type PermissionUser } from '../src/utils/permissions.ts'

const context = globalThis as typeof globalThis & { __costTestContext: Record<string, unknown> }
async function loadComponent(path: string) {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['react', 'react-dom'],
    plugins: [{ name: 'cost-test-context', setup(builder) {
      builder.onResolve({ filter: /(?:AppContext|AppContextCore)(?:\.tsx)?$/ }, () => ({ path: 'context', namespace: 'cost-test' }))
      builder.onResolve({ filter: /(?:ConfirmDialog|InfoHint)(?:\.tsx)?$/ }, args => ({ path: args.path.includes('ConfirmDialog') ? 'dialog' : 'hint', namespace: 'cost-test' }))
      builder.onLoad({ filter: /.*/, namespace: 'cost-test' }, args => ({ contents: args.path === 'context'
        ? 'export const useApp = () => globalThis.__costTestContext;'
        : args.path === 'dialog' ? "import React from 'react'; export default function Dialog(p) { return React.createElement('section', null, p.children) }"
          : 'export default function Hint() { return null }', loader: 'js' }))
    } }],
  })
  const module = { exports: {} as { default: React.ComponentType<any> } }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports.default
}

const Dialog = await loadComponent('../src/components/products/MergeStockChoiceDialog.tsx')
const props = {
  t: () => '', keeperName: 'Kept', discardedName: 'Discarded', working: false, needsChoice: false,
  impact: { productId: 1, totalQuantity: 0, lotCount: 0, branches: [] },
  identity: { same: false, differs: [{ field: 'cost_price_usd', keeper: '913', discarded: '927' }], costVerdict: 'differs', costBefore: { cost_price_usd: 913 }, costAfter: { cost_price_usd: 920 }, costFill: [{ field: 'cost_price_khr', value: 7654321 }] },
  pricing: { before: {}, after: {}, changes: [{ field: 'selling_price_usd', from: 40, to: 50 }] },
  onConfirm: () => {}, onClose: () => {},
}
for (const [user, expected] of [
  [{ permissions: { products: true, inventory: true } }, false],
  [{ permissions: { product_cost_edit: true } }, false],
  [{ permissions: { product_cost_view: true } }, true],
  [{ username: 'admin', permissions: { product_cost_view: false } }, true],
] as [PermissionUser, boolean][]) {
  context.__costTestContext = { user, ...effectivePermissions(user) }
  const html = renderToStaticMarkup(React.createElement(Dialog, props))
  assert.equal(html.includes('913'), expected, 'real merge dialog respects independent cost view')
  assert.equal(html.includes('927'), expected, 'identity comparison cannot leak a hidden cost')
  assert.equal(html.includes('7,654,321'), expected, 'filled-in cost is hidden too')
  assert.ok(html.includes('$50'), 'selling-price changes stay visible')
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const ReviewScreen = await loadComponent('../src/components/products/import/ProductServerImportReviewScreen.tsx')
context.__costTestContext = { ...effectivePermissions({ permissions: { product_cost_edit: true } }) }
const deniedReview = renderToStaticMarkup(React.createElement(ReviewScreen, {
  jobId: 1, t: () => '', notify: () => {}, onApproved: () => {}, onReviewLater: () => {}, onCancel: () => {}, autoApprove: true,
}))
assert.ok(deniedReview.includes('Cost view permission is required'))
assert.ok(!deniedReview.includes('Importing'), 'edit permission alone cannot mount the financial review body')
const duplicates = read('../src/components/products/ProductDuplicatesTab.tsx')
assert.match(duplicates, /omitUnauthorizedCatalogCosts\(\(canViewCosts \|\| costEdited\)/)
assert.match(duplicates, /disabled=\{field === 'cost' && !canEditCosts\}/)
const review = read('../src/components/products/import/ProductServerImportReviewScreen.tsx')
assert.match(review, /if \(!hasPermission\('product_cost_view'\)\) return/)
assert.match(review, /const saveDecision[^]*?if \(!canEditCosts\) return/)
assert.match(review, /const confirm[^]*?if \(!canEditCosts\) return/)
assert.match(review, /autoApprove=\{props.autoApprove && hasPermission\('product_cost_edit'\)\}/)
const hub = read('../src/components/products/import/ImportHub.tsx')
assert.match(hub, /\['products', 'inventory', 'sales', 'stock_actions'\]/)
assert.match(hub, /if \(needsCostEdit\(entry.chosen\) && !canEditCosts\) throw new Error/)
console.log('PASS real merge cost rendering matrix, blind duplicate edits and financial import action guards')
