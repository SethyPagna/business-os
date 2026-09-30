import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf } from './mountedComponentHarness.ts'
import type { StockMovementRevertPreview } from '../src/api/actionHistoryTransport.ts'

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))]))
const row = {
  id: 81, product_id: 7, product_name: 'Synthetic stock correction', barcode: 'TEST-7',
  unit: 'pcs', branch_name: 'Synthetic branch', movement_type: 'remove', quantity: 3,
  signed_quantity: -3, reason: 'Correct counted stock', reference_id: 'stock-set:synthetic-op:0',
  user_name: 'Synthetic operator', created_at: '2026-09-30T01:00:00Z', ledger_bucket: 'out',
  before_qty: 8, after_qty: 5, batch_id: null, batch_lot_code: null,
  batch_received_at: null, batch_supplier_id: null, batch_supplier_name: null,
}
const scoped: StockMovementRevertPreview = { kind: 'stock_set', movementId: row.id, historyId: 43, operationId: 'synthetic-op', direction: 'undo', expectedGeneration: 0, lineCount: 3 }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const harness = await createHarness()
async function mount(options: {
  rows?: typeof row[]; lang?: string; allowed?: boolean
  preview?: (id: number) => Promise<StockMovementRevertPreview>
  write?: () => Promise<unknown>
} = {}) {
  const words = packs[options.lang || 'en'] as Record<string, string>
  const t = (key: string) => words[key] || key
  const calls: Array<{ direction: string; id: number; payload?: unknown }> = []
  const previews: number[] = []
  const notices: Array<{ message: string; type?: string }> = []
  let reads = 0
  const app = { t, page: 'products', user: { id: 1, username: 'fixture-admin', role_code: 'admin' }, can: () => options.allowed !== false, notify: (message: string, type?: string) => notices.push({ message, type }) }
  const write = async (direction: string, id: number, payload?: unknown) => { calls.push({ direction, id, payload }); return options.write ? options.write() : { success: true, applied: true } }
  const surface = await harness.mount({
    component: 'components/products/StockChangeSection.tsx', props: { t }, app,
    doubles: {
      'api/productReadTransport.ts': {
        getStockLedger: async () => { reads++; return { items: options.rows || [row], total: 1, totalPages: 1 } },
        getStockLedgerMovementBalance: async (id: number) => ({ id, before_qty: 8, after_qty: 5 }),
      },
      'api/inventoryWriteTransport.ts': { revertStockMovement: async (id: number) => write('movement', id) },
      'api/actionHistoryTransport.ts': {
        getStockMovementRevertPreview: async (id: number) => { previews.push(id); return { success: true, revert: options.preview ? await options.preview(id) : scoped } },
        undoActionHistory: async (id: number, payload: unknown) => write('undo', id, payload),
        redoActionHistory: async (id: number, payload: unknown) => write('redo', id, payload),
      },
      'api/branchTransport.ts': { getBranches: async () => [] },
      'components/shared/SupplierPickerField.tsx': { loadSupplierNames: async () => [] },
    },
  })
  const open = async (name = row.product_name) => surface.click(surface.find((node) => node.tagName === 'BUTTON' && node.textContent.includes(name), 'stock row'))
  // The Revert action, not a Revert row's "Reverts #N" link button.
  const revert = () => surface.button({ test: (text: string) => text.includes(words.revert) && !text.includes('#') } as RegExp)
  return { surface, words, app, calls, previews, notices, open, revert, reads: () => reads }
}
try {
  const pending = deferred<unknown>()
  const f = await mount({ write: () => pending.promise })
  await f.open()
  assert.equal(f.surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === f.words.revert).length, 1, 'a scoped Set must offer Revert in Stock Changes alongside History Undo/Redo')
  await f.surface.click(f.revert())
  assert.deepEqual(f.calls, [], 'preview never changes stock')
  assert.ok(f.surface.text().includes('Undo the entire stock correction synthetic-op (3 lines)?'), 'confirmation identifies the whole action and line count')
  await f.surface.click(f.surface.button(f.words.cancel))
  assert.deepEqual(f.calls, [], 'cancel never changes stock')
  await f.surface.click(f.revert())
  const submit = f.revert()
  await f.surface.click(submit)
  await f.surface.call(submit, 'onClick', [])
  assert.deepEqual(f.calls, [{ direction: 'undo', id: 43, payload: { require_applied: true, expected_generation: 0 } }], 'one captured generation reaches the existing History transition')
  assert.equal(propsOf(f.revert()).disabled, true)
  assert.equal(propsOf(f.surface.button(f.words.close)).disabled, true, 'cannot dismiss a stock mutation in flight')
  pending.resolve({ success: true, applied: true })
  await f.surface.settle()
  assert.equal(f.surface.findAll((node) => node.getAttribute('role') === 'dialog').length, 0)
  assert.equal(f.notices[0].message, f.words.movement_reverted)
  assert.ok(f.reads() > 1)
  await f.surface.unmount()

  for (const lang of ['en', 'km']) for (const kind of ['stock_set', 'stock_session'] as const) for (const direction of ['undo', 'redo'] as const) {
    const preview = { ...scoped, kind, direction, expectedGeneration: direction === 'redo' ? 1 : 2 }
    const currentRow = { ...row, reference_id: kind === 'stock_session' ? '12' : direction === 'redo' ? 'revert:80' : 'stock-set:synthetic-op:2', reason: kind === 'stock_session' ? `Stock session synthetic-op ${direction === 'redo' ? 'undo' : 'redo'} generation ${preview.expectedGeneration}` : row.reason }
    const c = await mount({ rows: [currentRow], lang, preview: async () => preview })
    await c.open(); await c.surface.click(c.revert())
    assert.ok(c.surface.text().includes(c.words[`movement_revert_${kind}_${direction}`].replace('{action}', 'synthetic-op').replace('{count}', '3')))
    await c.surface.click(c.revert())
    assert.deepEqual(c.calls, [{ direction, id: 43, payload: { require_applied: true, expected_generation: preview.expectedGeneration } }])
    await c.surface.unmount()
  }

  const ordinary = await mount({ rows: [{ ...row, reference_id: '' }], preview: async () => ({ kind: 'movement', movementId: row.id, lineCount: 1 }) })
  await ordinary.open(); await ordinary.surface.click(ordinary.revert())
  assert.ok(ordinary.surface.text().includes(ordinary.words.confirm_revert))
  await ordinary.surface.click(ordinary.revert())
  assert.deepEqual(ordinary.calls, [{ direction: 'movement', id: row.id, payload: undefined }], 'ordinary single movement keeps its original endpoint')
  await ordinary.surface.unmount()

  for (const currentRow of [{ ...row, movement_type: 'sale' }, { ...row, movement_type: 'transfer_in' }, { ...row, reference_id: 'damaged_lot:4' }]) {
    const c = await mount({ rows: [currentRow] }); await c.open()
    assert.equal(c.surface.findAll((node) => node.getAttribute('aria-label') === c.words.revert).length, 0)
    await c.surface.unmount()
  }
  const denied = await mount({ allowed: false }); await denied.open()
  assert.equal(denied.surface.findAll((node) => node.getAttribute('aria-label') === denied.words.revert).length, 0)
  assert.deepEqual(denied.previews, [])
  await denied.surface.unmount()

  for (const failure of ['preview', 'write', 'unapplied', 'invalid-preview']) {
    const c = await mount({
      preview: async () => { if (failure === 'preview') throw new Error('Synthetic server refusal'); return failure === 'invalid-preview' ? { ...scoped, historyId: undefined } : scoped },
      write: async () => { if (failure === 'write') throw Object.assign(new Error('Synthetic stale history'), { code: 'undo_history_stale' }); return { success: true, applied: false } },
    })
    await c.open(); await c.surface.click(c.revert())
    if (failure === 'write' || failure === 'unapplied') await c.surface.click(c.revert())
    assert.equal(c.notices.length, 1); assert.equal(c.notices[0].type, 'error')
    assert.equal(c.surface.findAll((node) => node.getAttribute('role') === 'dialog').length, 1, 'refusal keeps the selected record visible')
    assert.equal(c.previews.length, 1, 'refusal never silently adopts a newer generation')
    assert.equal(c.calls.length, failure === 'preview' || failure === 'invalid-preview' ? 0 : 1)
    await c.surface.unmount()
  }

  for (const sameRow of [false, true]) for (const rejects of [false, true]) {
    const late = deferred<StockMovementRevertPreview>()
    const second = { ...row, id: 82, product_name: 'Second synthetic product' }
    const c = await mount({ rows: [row, second], preview: () => late.promise })
    await c.open(); await c.surface.click(c.revert()); await c.surface.click(c.surface.button(c.words.close))
    await c.open(sameRow ? row.product_name : second.product_name)
    if (rejects) late.reject(new Error('Old refusal')); else late.resolve(scoped)
    await c.surface.settle()
    assert.equal(c.surface.text().includes('Undo the entire stock correction synthetic-op (3 lines)?'), false, 'old preview cannot confirm a new dialog, including same-row reopen')
    assert.deepEqual(c.notices, []); assert.deepEqual(c.calls, [])
    assert.equal(propsOf(c.revert()).disabled, false)
    await c.surface.unmount()
  }
  const actor = await mount(); await actor.open(); await actor.surface.click(actor.revert())
  actor.app.user = { ...actor.app.user, id: 2 }
  await actor.surface.render({ t: actor.app.t })
  assert.equal(actor.surface.findAll((node) => node.getAttribute('role') === 'dialog').length, 0, 'changing actor invalidates a captured confirmation')
  assert.deepEqual(actor.calls, [])
  await actor.surface.unmount()
  console.log('PASS mounted Stock Changes Revert: scoped Undo/Redo EN/KM, captured generation, applied result, permissions, ordinary control, refusal and stale-dialog fences')
} finally { await harness.close() }
