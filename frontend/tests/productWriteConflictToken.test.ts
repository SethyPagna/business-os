// The product edit sends the version the SCREEN holds, and a refused version
// names the product.
//
// Owner report, 22 Sep 2026 (phone screenshot): every product edit met
// "Product changed on another device", "Your version expected 16/09/2026
// 19:10", "Latest saved version 22/09/2026 13:33", and under "Current saved
// details" a raw "2026-09-22T06:33:25.086Z". Cause: the edit payload carried no
// version at all, so the (since deleted) expectedUpdatedAt helper fell back
// to the Dexie `products` mirror row -- a table the live app has not
// rewritten since 12 Sep 2026 -- and the Worker rightly refused the stale
// token. writeVersionFromScreen.test.ts pins the rest of the class. "Reload latest" could not help:
// the open form kept the same record, so the next press sent the same token.
//
// Pinned here, each with its negative control:
//   1. Products.tsx's save payload carries `expectedUpdatedAt` from `selected`
//      (the row the form opened), the single and bulk deletes pass the row's
//      updated_at, and a refused save re-reads the row so the next press
//      carries the version that won;
//   2. the dialog, rendered for a product conflict, shows the product's name,
//      barcode and a dd/mm/yyyy time -- never the raw ISO string -- and a
//      generic entity's *_at values are formatted the same way.
//
// Run: node tests/productWriteConflictToken.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => fs.readFileSync(path.join(here, '..', p), 'utf8')
const formatters = await import('../src/utils/formatters.ts')

let checks = 0
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks += 1 }
const eq = (actual: unknown, expected: unknown, message: string) => { assert.equal(actual, expected, message); checks += 1 }

// ── 1. the token is the screen's version ────────────────────────────────────
const products = read('src/components/products/Products.tsx')
const TOKEN_LINE = 'expectedUpdatedAt: selected?.updated_at || undefined,'
function savePayloadCarriesScreenVersion(source: string): boolean {
  const at = source.indexOf('const uploadedGallery = await uploadGalleryImages(')
  if (at < 0) return false
  const block = source.slice(at, source.indexOf('let createdProductId = 0', at))
  return block.includes('const payload = {') && block.includes(TOKEN_LINE)
}
ok(savePayloadCarriesScreenVersion(products), 'the edit payload carries the version the form opened with')
eq(savePayloadCarriesScreenVersion(products.replace(TOKEN_LINE, '')), false, 'negative control: a payload without the token fails the pin')
ok(/productApi\.deleteProduct\(p\.id \|\| 0, reason, p\.updated_at\)/.test(products), "the single delete passes the row's version")
ok(/productApi\.deleteProduct\(id, reason, snapshotById\.get\(Number\(id\)\)\?\.updated_at\)/.test(products), "the bulk delete passes each snapshot's version")
{
  const catchAt = products.indexOf("console.error('[handleSaveWithGallery] error:', e)")
  const block = products.slice(catchAt, products.indexOf('finishSingleAction(productSaveInFlightRef)', catchAt))
  ok(/isWriteConflictError\(e\)/.test(block) && /fetchProductsByIds\(\[conflictedId\]\)/.test(block) && /setSelected\(latest\)/.test(block),
    'a refused version re-reads the row so the next press carries the version that won')
}
const transport = read('src/api/productWriteTransport.ts')
ok(/export async function deleteProduct\(id: string \| number, reason\?: string, expectedUpdatedAt\?: string \| null\)/.test(transport)
  && transport.includes("{ reason: reason ?? '', ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }"),
  "the delete transport forwards the caller's token")

// ── 2. the dialog names the product and formats every time ──────────────────
type Node = { type: unknown; props: Record<string, any> } | string | number | null | undefined | boolean | Node[]
function textOf(node: Node): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  const { type, props } = node
  if (typeof type === 'function') return textOf((type as (p: Record<string, any>) => Node)(props))
  return textOf(props?.children)
}
function renderDialog(source: string, conflict: Record<string, unknown>): string {
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module: any = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
    if (name.includes('utils/formatters')) return formatters
    if (name.includes('./Modal')) return { default: (props: Record<string, any>) => ({ type: 'modal', props: { children: [props.title, props.children] } }) }
    throw new Error('unexpected import ' + name)
  }, module, module.exports)
  return textOf(module.exports.default({ conflict, onClose: () => {}, onReload: () => {} }))
}
const dialogSource = read('src/components/shared/WriteConflictModal.tsx')
const ISO = '2026-09-22T06:33:25.086Z'
const EXPECTED_ISO = '2026-09-16T12:10:41.000Z'
const shown = formatters.fmtDateTime24(new Date(ISO))
const productConflict = {
  entity: 'product', entityLabel: 'Product', expectedUpdatedAt: EXPECTED_ISO, actualUpdatedAt: ISO,
  current: { id: 2154, name: 'Abercrombie Fierce Cologne 100ml', barcode: '085715160002', updated_at: ISO },
}
{
  const text = renderDialog(dialogSource, productConflict)
  ok(text.includes('Abercrombie Fierce Cologne 100ml') && text.includes('085715160002'), 'the product conflict names the product and its barcode')
  ok(text.includes(shown), 'the current version is shown as dd/mm/yyyy 24-hour')
  ok(!text.includes(ISO) && !text.includes(EXPECTED_ISO), 'no raw ISO timestamp reaches the operator')
}
{
  const text = renderDialog(dialogSource, { ...productConflict, entity: 'file asset', entityLabel: 'File', current: { id: 9, updated_at: ISO } })
  ok(text.includes(shown) && !text.includes(ISO), "a generic entity's *_at values are formatted the same way")
}
{
  // Negative control: the pre-fix generic branch printed values verbatim.
  const old = dialogSource.replace("value: key.endsWith('_at') ? formatConflictTime(value) : valueToString(value),", 'value: valueToString(value),')
  assert.notEqual(old, dialogSource)
  const text = renderDialog(old, { ...productConflict, entity: 'file asset', entityLabel: 'File', current: { id: 9, updated_at: ISO } })
  ok(text.includes(ISO), 'negative control: the verbatim branch leaks the raw ISO, so the check above discriminates')
}

console.log(`productWriteConflictToken: ${checks} checks passed`)
