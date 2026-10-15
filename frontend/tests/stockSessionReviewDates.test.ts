import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformSync } from 'esbuild'
import { buildStockLineRequest, reviewStockLine, type StockLineReview, type StockSessionLine, type LineRequestContext } from '../src/utils/stockSessionDraft.ts'

const source = readFileSync(new URL('../src/components/stock-session/StockSessionReviewStep.tsx', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code
const exported: { default?: ComponentType<{ tr: (key: string, fallback?: string) => string; usdSymbol: string; canViewCosts: boolean; summary: string[]; reviews: StockLineReview[] }> } = {}
const moduleBox = { exports: exported }
new Function('require', 'exports', 'module', compiled)(createRequire(import.meta.url), moduleBox.exports, moduleBox)
const Component = moduleBox.exports.default!
const line: StockSessionLine = {
  key: 'selected', requestId: 'stockline-selected', product: { id: 1, name: 'Date fixture', stock_quantity: 20, branch_stock: [{ branch_id: 1, quantity: 20 }], cost_price_usd: 4, selling_price_usd: 12 },
  productName: 'Date fixture', mode: 'add', quantity: 5, freeQuantity: 0, unitCost: '4', sellingPrice: '12', freeGoods: false, expiryDate: '', batchChoice: 547, batchLabel: '01/07/2026', lotSupplierName: 'Fixture supplier', reason: '', conditionTag: '', createdProduct: false, status: 'queued', detail: '',
}
const context: LineRequestContext = { branchId: '1', receivedDate: '2026-12-31', supplier: { supplierId: 4, supplierName: 'Fixture supplier' }, paymentStatus: 'paid', creditDueDate: '', sessionId: 7, canEditPrice: true, reasonFor: () => 'Date fixture' }
const selectedRequest = buildStockLineRequest(line, context)
assert.equal(selectedRequest.wire, 'receive')
assert.equal(selectedRequest.body.batchId, 547)
assert.equal((selectedRequest.body as { receivedDate?: string | null }).receivedDate, null)
const selected = reviewStockLine(line, '1')
assert.equal(selected.lotLabel, '01/07/2026')
assert.equal(selected.lotBefore, null)
assert.equal(selected.lotAfter, null)
const freshLine = { ...line, key: 'new', requestId: 'stockline-new', batchChoice: 'new' as const, batchLabel: '31/12/2026' }
const freshRequest = buildStockLineRequest(freshLine, context)
assert.equal(freshRequest.wire, 'receive')
assert.equal(freshRequest.body.batchId, null)
assert.equal((freshRequest.body as { receivedDate?: string }).receivedDate, '2026-12-31')
const fresh = reviewStockLine(freshLine, '1')
for (const language of ['en', 'km']) {
  const pack = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>
  const tr = (key: string, fallback?: string): string => pack[key] || fallback || key
  for (const canViewCosts of [true, false]) {
    const markup = renderToStaticMarkup(React.createElement(Component, { tr, usdSymbol: '$', canViewCosts, summary: ['Fixture branch', '31/12/2026'], reviews: [selected, fresh] }))
    assert.ok(markup.includes('01/07/2026'), `${language}: selected existing date must remain visible despite a different shared date`)
    assert.equal(markup.split('31/12/2026').length - 1, 2, `${language}: new receipt date appears in its own line as well as the shared summary`)
    assert.match(markup, /<span>01\/07\/2026<\/span>/, 'Add date is plain disclosure without invented per-lot quantities')
    if (!canViewCosts) assert.ok(!markup.includes('$4.0000'), `${language}: date disclosure never exposes hidden costs`)
  }
}
console.log('PASS actual EN/KM Add review date disclosure for selected547/newnull; final request identity and cost permissions unchanged')
