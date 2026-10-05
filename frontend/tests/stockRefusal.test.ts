import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  STOCK_CHANGES_ANCHOR, STOCK_IN_SESSIONS_ANCHOR, queueStockInLineFocus, queueStockRecordFocus, stockInCorrectionLineId,
  stockInSessionKeyForReceipt, stockRefusalInfo, takeStockInLineFocus, takeStockRecordFocus,
} from '../src/utils/stockRefusal.ts'
import { translateMovementRowType } from '../src/components/inventory/movementGroups.ts'

// RET-D (owner, 5 Oct 2026): a refused stock Revert / Undo / line edit says
// concisely WHY and WHERE with an in-built link, and a stock-in line edit is a
// correction of the receipt, never a removal. The Worker half is driven for
// real by cloudflare/scripts/test-stock-refusal-blocker-pure.cjs; these
// checks hold the client half: the sentence in both languages, the link
// target, and the wiring on both stock-in surfaces.

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const packs = { en: JSON.parse(read('src/lang/en.json')), km: JSON.parse(read('src/lang/km.json')) } as Record<string, Record<string, string>>
const trFrom = (pack: Record<string, string>) => (key: string, fallback: string) => pack[key] ?? fallback
const sale = (extra: Record<string, unknown> = {}) => Object.assign(new Error('x'), {
  status: 409, code: 'below_consumed', reason: 'consumed',
  blocker: { kind: 'sale', movement_id: 812, movement_type: 'sale', label: '20261004-091200', qty: 4, count: 2, total_qty: 6, branch: 'Shop' },
  destination: { kind: 'movement', movement_id: 812 },
  ...extra,
})

runTest('a sale blocker: WHY names the receipt and the units, WHERE is its stock record', () => {
  const info = stockRefusalInfo(sale(), trFrom(packs.en))
  assert.deepEqual(info, { why: 'Sale 20261004-091200 used 4 of these units (+1 more)', movementId: 812, linkLabel: 'Open record' })
  const km = stockRefusalInfo(sale(), trFrom(packs.km))
  assert.ok(km && km.why.includes('20261004-091200') && km.why.includes('4') && !/\{\w+\}/.test(km.why), km?.why)
  assert.ok(km && !/Sale|used/.test(km.why), `Khmer, not the English: ${km?.why}`)
  assert.equal(km?.linkLabel, packs.km.stock_refusal_open)
})

runTest('each blocker kind and reason reads its own sentence; no placeholder is left', () => {
  const tr = trFrom(packs.en)
  const why = (blocker: Record<string, unknown>, reason = 'consumed') => stockRefusalInfo({ reason, blocker: { movement_id: 5, qty: 3, count: 1, ...blocker } }, tr)?.why
  assert.equal(why({ kind: 'sale', label: '' }), 'A sale used 3 of these units')
  assert.equal(why({ kind: 'return', label: 'RET-7' }), 'Return RET-7 used 3 of these units')
  assert.equal(why({ kind: 'transfer', branch: 'Shop' }), 'A transfer moved 3 of these units out of Shop')
  assert.equal(why({ kind: 'transfer', branch: '' }), 'A transfer moved 3 of these units out')
  assert.equal(why({ kind: 'stock_change' }), 'A stock change took 3 of these units')
  assert.equal(why({ kind: 'mystery' }), 'A stock change took 3 of these units', 'an unknown kind is a plain stock change')
  assert.equal(why({ kind: 'stock_in_edit' }, 'superseded'), 'This line was edited again later')
  assert.equal(why({ kind: 'stock_change' }, 'superseded'), 'A later stock change came after this one')
})

runTest('no blocker (older Worker, metadata-only change) or no usable record id -> no line', () => {
  assert.equal(stockRefusalInfo(new Error('x'), trFrom(packs.en)), null)
  assert.equal(stockRefusalInfo(null, trFrom(packs.en)), null)
  assert.equal(stockRefusalInfo(sale({ blocker: { kind: 'sale', movement_id: 0 }, destination: null }), trFrom(packs.en)), null)
  assert.equal(stockRefusalInfo(sale({ destination: { kind: 'movement', movement_id: 'x' } }), trFrom(packs.en)), null)
})

runTest('every key the sentences and the correction row use exists in both packs with the same placeholders', () => {
  const keys = [
    'stock_refusal_sale', 'stock_refusal_sale_unlabelled', 'stock_refusal_return', 'stock_refusal_transfer', 'stock_refusal_transfer_unnamed',
    'stock_refusal_change', 'stock_refusal_later_edit', 'stock_refusal_later_change', 'stock_refusal_more', 'stock_refusal_open',
    'movement_type_stock_in_correction', 'stock_in_correction_change_from_line', 'stock_in_correction_open_line',
  ]
  const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  for (const key of keys) {
    assert.ok(packs.en[key] && packs.km[key], `${key} in both packs`)
    assert.notEqual(packs.km[key], packs.en[key], `${key} is translated`)
    assert.equal(holes(packs.km[key]), holes(packs.en[key]), `${key} placeholders`)
  }
})

runTest('a stock-in line correction reads "Stock-in correction", never "Remove Stock"; other rows keep their type', () => {
  const t = (key: string) => packs.en[key]
  assert.equal(translateMovementRowType({ movement_type: 'remove', reference_id: 'stock-in-edit:48431:op-1:0' }, t), 'Stock-in correction')
  assert.equal(translateMovementRowType({ movement_type: 'add', reference_id: 'stock-in-edit:48431:op-1:1' }, t), 'Stock-in correction')
  assert.equal(translateMovementRowType({ movement_type: 'remove', reference_id: 'stock-in-edit:48431:op-1:0' }, (key) => packs.km[key]), packs.km.movement_type_stock_in_correction)
  assert.equal(translateMovementRowType({ movement_type: 'remove', reference_id: null }, t), packs.en.remove_stock)
  assert.equal(translateMovementRowType({ movement_type: 'remove', reference_id: 'revert:48516' }, t), packs.en.revert)
  assert.equal(translateMovementRowType({ movement_type: 'remove', reference_id: '17' }, t), packs.en.remove_stock, 'a session undo row is not an edit row')
})

runTest('every surface that labels ONE recorded row uses the row label, so a correction never reads "Remove Stock"', () => {
  for (const file of [
    'src/components/products/StockChangeSection.tsx', 'src/components/products/surfaces/ProductDetailReport.tsx',
    'src/components/inventory/MovementDetailFloat.tsx', 'src/components/inventory/ProductHistoryPreviewModal.tsx',
    'src/components/inventory/InventoryMovementsSurface.tsx',
  ]) {
    const source = read(file)
    assert.match(source, /translateMovementRowType\(/, file)
    assert.doesNotMatch(source, /translateMovementType\((?:row|movement|detail)\.movement_type/, `${file} labels a recorded row by its type alone`)
  }
})

runTest('the correction row names its line, and a receipt row names its session', () => {
  assert.equal(stockInCorrectionLineId('stock-in-edit:48431:ddbe33d5-dc25:0'), 48431)
  assert.equal(stockInCorrectionLineId('revert:48431'), null)
  assert.equal(stockInCorrectionLineId(17), null)
  assert.equal(stockInSessionKeyForReceipt(1203), 'session:1203')
  assert.equal(stockInSessionKeyForReceipt('revert:9'), null)
  assert.equal(stockInSessionKeyForReceipt(null), null)
})

runTest('the WHERE hand-off is queued once and consumed once, per section', () => {
  const store = new Map<string, string>()
  const events: string[] = []
  const g = globalThis as unknown as { window?: unknown; CustomEvent?: unknown }
  const hadWindow = 'window' in g
  g.window = {
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } },
    dispatchEvent: (event: { type: string }) => { events.push(event.type); return true },
  }
  try {
    queueStockRecordFocus(812)
    queueStockInLineFocus(48431)
    assert.equal(takeStockRecordFocus(), 812)
    assert.equal(takeStockRecordFocus(), null, 'consumed once')
    assert.equal(takeStockInLineFocus(), 48431)
    assert.equal(takeStockInLineFocus(), null)
    assert.equal(events.length, 2)
    queueStockRecordFocus(0)
    assert.equal(takeStockRecordFocus(), null, 'no id, nothing queued')
  } finally {
    if (hadWindow) { /* keep the host's own */ } else delete g.window
  }
  assert.equal(STOCK_CHANGES_ANCHOR, 'hub:products:stock_changes')
  assert.equal(STOCK_IN_SESSIONS_ANCHOR, 'hub:products:stock_in_sessions')
})

runTest('wiring: the error carries the blocker; both stock-in surfaces render the line; corrections are not offered a Revert', () => {
  const http = read('src/api/http.ts')
  assert.match(http, /error\.blocker = parsed\?\.blocker/)
  assert.match(http, /error\.destination = parsed\?\.destination/)
  const changes = read('src/components/products/StockChangeSection.tsx')
  assert.match(changes, /<StockRefusalLine info=\{revertRefusal\} onOpen=\{\(id\) => void openMovementById\(id\)\} \/>/)
  assert.equal((changes.match(/setRevertRefusal\(stockRefusalInfo\(error/g) || []).length, 2, 'the preview and the Revert both keep the WHY')
  assert.match(changes, /detailRevertedById == null && detailCorrectionLineId == null/)
  assert.match(changes, /window\.addEventListener\(STOCK_RECORD_FOCUS_EVENT, consume\)/)
  // The focus consumer runs after the reset effect, or the record it opens is closed again.
  assert.ok(changes.indexOf('useEffect(() => { closeDetail() }') < changes.indexOf('takeStockRecordFocus()'))
  const sessions = read('src/components/products/StockInSessionsSection.tsx')
  assert.match(sessions, /\{lineRefusal \? <StockRefusalLine info=\{lineRefusal\} \/> : null\}/)
  assert.ok((sessions.match(/setLineRefusal\(stockRefusalInfo\(error, tr\)\)/g) || []).length >= 3, 'edit, line Revert and session Revert refusals')
  assert.match(sessions, /window\.addEventListener\(STOCK_IN_LINE_FOCUS_EVENT, onFocus\)/)
})

if (failed) { console.error(`${failed} stock refusal check(s) failed`); process.exit(1) }
console.log('All stock refusal checks passed.')
