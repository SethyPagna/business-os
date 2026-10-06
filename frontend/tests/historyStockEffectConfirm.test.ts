import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { historyEffectItems } from '../src/utils/stockRevertPreview.ts'
import { recordedRemovalEffect, recordedTransferEffect } from '../src/components/products/helpers/productWriteHelpers.ts'

// REVERT-SET (lead, 6 Oct 2026: "the Revert confirmation must always say
// exactly what it will add/remove, by lot/branch, on every surface that offers
// Revert or Undo"). The History panel ran a stock Undo/Redo on one click with
// no figure at all; the owner reverted a delivery of 30 believing it was a Set
// of +27. Now the panel asks first and lists the record's own change.

const tr = (_key: string, fallback: string) => fallback
const date = (value: string) => value.split('-').reverse().join('/')

// --- The screenshot Set, from the Worker's /effect: -27 on the 02/09 lot, Shop 60 -> 33.
const set = historyEffectItems({
  lines: [{ productName: 'SK-II Gentle Cleanser 20g', branchName: 'Shop', receivedAt: '2026-09-02', lotCode: '09022026', change: -27 }],
  branches: [{ productName: 'SK-II Gentle Cleanser 20g', branchName: 'Shop', before: 60, after: 33 }],
  more: 0,
}, tr, date)
assert.deepEqual(set, [
  { label: '−27', value: 'received 02/09/2026 · Shop' },
  { label: 'Shop', value: '60 → 33' },
], 'one product: the lot line and the branch total, no product name repeated')

// --- A transfer of two products: names appear, each side signed.
const transfer = historyEffectItems({
  lines: [
    { productName: 'A', branchName: 'Shop', change: 2 },
    { productName: 'A', branchName: 'Store', change: -2 },
    { productName: 'B', branchName: 'Shop', change: 1 },
  ],
  more: 3,
}, tr, date)
assert.deepEqual(transfer.map((item) => `${item.label} ${item.value}`), ['+2 A · Shop', '−2 A · Store', '+1 B · Shop', '… 3 more lines'])

// --- A client entry (Products' Set out of stock): Undo adds back exactly what was removed, Redo takes it again.
const names = { product: (id: number) => (id === 7 ? 'Serum' : `#${id}`), branch: (id: number) => (id === 1 ? 'Shop' : `#${id}`) }
const removal = recordedRemovalEffect([{ productId: 7, branchId: 1, quantity: 10 }, { productId: 7, branchId: 2, quantity: 0 }], names)
assert.deepEqual(removal.undo, [{ productName: 'Serum', branchName: 'Shop', change: 10 }], 'a zero row is not a line')
assert.deepEqual(removal.redo, [{ productName: 'Serum', branchName: 'Shop', change: -10 }])
const move = recordedTransferEffect([{ productId: 7, fromBranchId: 1, toBranchId: 2, quantity: 4 }], names)
assert.deepEqual(move.undo, [{ productName: 'Serum', branchName: '#2', change: -4 }, { productName: 'Serum', branchName: 'Shop', change: 4 }], 'Undo moves the 4 back')
assert.deepEqual(move.redo, [{ productName: 'Serum', branchName: 'Shop', change: -4 }, { productName: 'Serum', branchName: '#2', change: 4 }])

// --- Parity: the client's list of stock appliers is the Worker's.
const transport = readFileSync(new URL('../src/api/actionHistoryTransport.ts', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../../cloudflare/src/lib/stockRevertEffect.ts', import.meta.url), 'utf8')
const list = (source: string, pattern: RegExp) => JSON.parse(`[${(source.match(pattern)?.[1] || '').replaceAll("'", '"')}]`).sort()
assert.deepEqual(
  list(transport, /export const STOCK_EFFECT_APPLIERS: readonly string\[\] = \[([^\]]*)\]/),
  list(worker, /export const STOCK_EFFECT_APPLIERS: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/),
  'frontend and Worker name the same stock appliers',
)

// --- Wiring: every Undo/Redo control in the shared History panel confirms first.
const bar = readFileSync(new URL('../src/components/shared/ActionHistoryBar.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(bar, /onClick=\{\(\) => history\.(undo|redo)\(/, 'no Undo/Redo button runs without the stock confirm')
assert.doesNotMatch(bar, /onClick=\{\(\) => \{ closeMenu\(\); (history\.(undo|redo)|runServer!)\(/, 'no list row runs without the stock confirm')
assert.equal((bar.match(/runLocal\('(undo|redo)'/g) || []).length, 4, 'the two header buttons and both local lists confirm')
assert.match(bar, /confirmStockEffect\(direction, item, item\.id\)\.then\(\(confirmed\) => \{ if \(confirmed\) runServer!/, 'a server row confirms before it replays')
assert.match(bar, /catch \{\s*setEffectError\([\s\S]*?return false/, 'an unreadable change runs nothing')
assert.match(bar, /\{stockConfirm \? \(\s*<ConfirmDialog/, 'the confirm renders')
assert.doesNotMatch(bar, /from '\.\/useConfirmDialog/, 'no static chunk cycle: the hook chunk imports app-shared back')
const products = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
assert.match(products, /stockEffect: recordedRemovalEffect\(recorded, stockEffectNames\(\)\)/, 'out-of-stock entries carry their recorded change')
assert.match(products, /stockEffect: recordedTransferEffect\(transfers, stockEffectNames\(\)\)/, 'branch moves carry their recorded change')

// Stock Changes: a session Revert lists every line from the Worker's historyEffect; Stock-in Sessions lists each line it takes off.
const changes = readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')
assert.ok(changes.includes('historyEffect: response.historyEffect ?? null'), 'Stock Changes keeps the session effect')
assert.match(changes, /!revertPreview\?\.effect && revertPreview\?\.historyEffect \? \([\s\S]{0,400}historyEffectItems\(revertPreview\.historyEffect/, 'and prints every line')
const sessions = readFileSync(new URL('../src/components/products/StockInSessionsSection.tsx', import.meta.url), 'utf8')
assert.match(sessions, /\.\.\.historyEffectItems\(\{\s*lines: rows\.slice\(0, 12\)[\s\S]{0,400}change: -Math\.abs\(Number\(row\.quantity\) \|\| 0\)/, 'Stock-in Sessions lists each line it takes off')

for (const lang of ['en', 'km']) {
  const pack = JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>
  for (const key of ['history_effect_undo_title', 'history_effect_redo_title', 'history_effect_received', 'history_effect_more', 'history_effect_read_failed']) {
    assert.ok(pack[key], `${lang} has ${key}`)
  }
  assert.match(pack.history_effect_received, /\{date\}/)
  assert.match(pack.history_effect_more, /\{count\}/)
}

console.log('history stock effect confirm: ok')
