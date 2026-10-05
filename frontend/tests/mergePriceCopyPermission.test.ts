// Owner, 5 Oct 2026: copying another product's price during a merge needs the
// product-edit permission (FULL tier, Edit not switched off), the same rule the
// Worker enforces in foldDuplicateProductInto (403 product_edit_permission_required;
// cloudflare/scripts/test-merge-price-copy-needs-edit-native.cjs).
//
//   UTIL    canCopyMergePrice mirrors getActionTier(user, 'products', 'edit') === 'full'
//   DIALOG  the real MergeStockChoiceDialog disables Confirm, with the translated
//           reason as a tooltip and a visible state, when the merge would move a
//           price and the actor cannot edit products; costs and unchanged prices
//           never trigger it
//   PACKS   every new string exists in BOTH language packs
//
// Run: node tests/mergePriceCopyPermission.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { canCopyMergePrice, mergeChangesPrices } from '../src/utils/productMergePriceAccess.ts'
import type { PermissionUser } from '../src/utils/permissions.ts'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'

const context = globalThis as typeof globalThis & { __priceTestContext: Record<string, unknown> }
async function loadDialog() {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/components/products/MergeStockChoiceDialog.tsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'],
    plugins: [{ name: 'price-test-context', setup(builder) {
      builder.onResolve({ filter: /(?:AppContext|AppContextCore)(?:\.tsx)?$/ }, () => ({ path: 'context', namespace: 'price-test' }))
      builder.onResolve({ filter: /(?:^|\/)Modal(?:\.tsx)?$/ }, () => ({ path: 'modal', namespace: 'price-test' }))
      builder.onResolve({ filter: /InfoHint(?:\.tsx)?$/ }, () => ({ path: 'hint', namespace: 'price-test' }))
      builder.onLoad({ filter: /.*/, namespace: 'price-test' }, (args) => ({
        contents: args.path === 'context'
          ? 'export const useApp = () => globalThis.__priceTestContext;'
          : args.path === 'modal'
            ? "import React from 'react'; export default function Modal(p) { return React.createElement('section', null, p.children) }"
            : 'export default function Hint() { return null }',
        loader: 'js',
      }))
    } }],
  })
  const module = { exports: {} as { default: React.ComponentType<any> } }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports.default
}

const MERGER: PermissionUser = { role_code: 'manager', permissions: { products: true, 'products:edit': false } }
const EDITOR: PermissionUser = { role_code: 'manager', permissions: { products: true } }
const PARTIAL: PermissionUser = { role_code: 'manager', permissions: { products: 'review' } }
const ADMIN: PermissionUser = { role_code: 'admin', permissions: { products: true, 'products:edit': false } }
const NO_PRODUCTS: PermissionUser = { role_code: 'manager', permissions: {} }
// The Employee default (the real preset): edit product information + image, nothing else on Products. It may edit,
// so it may take a price in a merge dialog, but it holds no merge permission to reach one (products:merge_duplicates off).
const EMPLOYEE: PermissionUser = { role_code: 'employee', permissions: ROLE_PRESETS.find((preset) => preset.key === 'employee')!.permissions }

let failed = 0
function test(name: string, run: () => void | Promise<void>) {
  return Promise.resolve().then(run).then(() => console.log('PASS ' + name), (error) => { failed += 1; console.error('FAIL ' + name, error) })
}

await test('UTIL: only full-tier Edit product (or an administrator) may copy a price', () => {
  assert.equal(canCopyMergePrice(EDITOR), true)
  assert.equal(canCopyMergePrice(ADMIN), true, 'administrator control is never narrowed')
  assert.equal(canCopyMergePrice(EMPLOYEE), true, 'the employee default keeps Edit product')
  assert.equal(canCopyMergePrice(MERGER), false, 'Edit product switched off')
  assert.equal(canCopyMergePrice(PARTIAL), false, 'Partial access queues edits; the Worker needs FULL')
  assert.equal(canCopyMergePrice(NO_PRODUCTS), false)
  assert.equal(canCopyMergePrice(null), false)
  assert.equal(canCopyMergePrice({ role_code: 'manager', role_permissions: { products: true }, permissions: { 'products:edit': false } }), false, 'a user override beats the role')
})

await test('UTIL: only selling or wholesale price moves count; costs and other fields never do', () => {
  assert.equal(mergeChangesPrices([{ field: 'selling_price_usd' }]), true)
  assert.equal(mergeChangesPrices([{ field: 'wholesale_price_khr' }]), true)
  assert.equal(mergeChangesPrices([{ field: 'cost_price_usd' }]), false)
  assert.equal(mergeChangesPrices([]), false)
  assert.equal(mergeChangesPrices(null), false)
  assert.equal(mergeChangesPrices(undefined), false)
})

const Dialog = await loadDialog()
const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL('../src/lang/' + lang + '.json', import.meta.url), 'utf8')) as Record<string, string>]))
const baseProps = (language: 'en' | 'km', changes: Array<{ field: string; from: number; to: number }>) => ({
  t: (key: string) => packs[language][key] ?? '',
  keeperName: 'Kept', discardedName: 'Discarded', working: false, needsChoice: false,
  impact: { productId: 1, totalQuantity: 0, lotCount: 0, branches: [] },
  identity: null, pricing: { before: {}, after: {}, changes }, onConfirm: () => {}, onClose: () => {},
})
const render = (user: PermissionUser, language: 'en' | 'km', changes: Array<{ field: string; from: number; to: number }>) => {
  context.__priceTestContext = { user }
  return renderToStaticMarkup(React.createElement(Dialog, baseProps(language, changes)))
}
const confirmButton = (html: string) => {
  const match = html.match(/<button type="button"[^>]*>(?:Merge|ច្រូប|[^<]*)<\/button>/)
  assert.ok(match, 'the confirm button renders')
  return match![0]
}
const raise = [{ field: 'selling_price_usd', from: 12, to: 14 }]

for (const language of ['en', 'km'] as const) {
  await test(language + ': DIALOG disables Confirm with the translated reason for a user without product-edit, when a price would move', () => {
    for (const user of [MERGER, PARTIAL]) {
      const html = render(user, language, raise)
      const button = confirmButton(html)
      assert.match(button, / disabled=""/, 'Confirm is disabled')
      const reason = packs[language].merge_price_needs_edit
      assert.ok(reason && reason.length > 20, 'the reason is translated')
      assert.ok(button.includes('title="' + reason.replace(/'/g, '&#x27;') + '"') || button.includes('title="' + reason + '"'), 'the reason is the tooltip: ' + button)
    }
  })

  await test(language + ': DIALOG leaves Confirm enabled for Edit product, administrators and the employee default', () => {
    for (const user of [EDITOR, ADMIN, EMPLOYEE]) {
      const button = confirmButton(render(user, language, raise))
      assert.doesNotMatch(button, / disabled=""/, JSON.stringify(user))
      assert.doesNotMatch(button, /title=/)
    }
  })

  await test(language + ': DIALOG does not block a merge that moves no price, nor a cost-only change', () => {
    for (const changes of [[], [{ field: 'cost_price_usd', from: 4, to: 5 }]]) {
      const button = confirmButton(render(MERGER, language, changes))
      assert.doesNotMatch(button, / disabled=""/)
    }
  })
}

await test('PACKS: every new string exists in both languages and Khmer is not the English text', () => {
  for (const key of ['resolve_price_locked', 'merge_needs_product_edit', 'merge_price_needs_edit', 'selected_conflict_product_edit_permission_required']) {
    assert.ok(packs.en[key], 'en ' + key)
    assert.ok(packs.km[key], 'km ' + key)
    assert.notEqual(packs.en[key], packs.km[key], key + ' is translated')
    assert.match(packs.km[key], /[ក-៿]/, key + ' is Khmer script')
  }
})

await test('SOURCE: the merge dialog, the confirm tooltip and the refusal mapping are wired', () => {
  const dialog = readFileSync(new URL('../src/components/products/MergeStockChoiceDialog.tsx', import.meta.url), 'utf8')
  assert.match(dialog, /canCopyMergePrice\(actor\)/)
  assert.match(dialog, /confirmDisabledReason=\{priceNeedsEdit \? priceNeedsEditText : undefined\}/)
  const hook = readFileSync(new URL('../src/components/products/useMergeStockChoice.tsx', import.meta.url), 'utf8')
  assert.match(hook, /code === 'product_edit_permission_required'/)
  const products = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
  assert.match(products, /r\?\.code === 'product_edit_permission_required'/)
  const confirm = readFileSync(new URL('../src/components/shared/ConfirmDialog.tsx', import.meta.url), 'utf8')
  assert.match(confirm, /title=\{confirmDisabled && confirmDisabledReason \? confirmDisabledReason : undefined\}/)
})

process.exitCode = failed ? 1 : 0
