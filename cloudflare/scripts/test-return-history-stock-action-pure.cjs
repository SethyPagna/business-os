// 6.0.999 pure kernel + parity: how a stored return line becomes an Undo / Redo line, and when the Worker refuses to guess.
//
// A stock rule that lives in the Worker and is mirrored in the browser needs one table both must answer the same way:
//   - storedStockAction: the Worker's (cloudflare/src/lib/returnsStock.ts) and the client's
//     (frontend/src/components/returns/helpers/returnHistoryPayload.ts) are bundled from source and compared on every input;
//   - the client builder (returnHistoryPayloadFromSnapshot) sends stock_action for every line and the tag for a damaged
//     one, and builds NOTHING when a line would need a guess;
//   - the Worker's firstLineWithoutStockAction refuses every line that names no valid stock_action (no condition makes the
//     legacy restock default safe: see its comment);
//   - pairDamagedLinesToLots / storedDamagedChoices pair each damaged line with ITS lot by order (the Kth damaged line of a
//     product owns the Kth lot of that product), never another line's.
// The fixtures are chosen so the plausible wrong implementation disagrees with the right one: the integer 0 (which
// `!== false` reads as restock), two damaged lines of one product with different tags, a lot that was drawn.
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '..')

async function bundle(contents) {
  const out = await build({ stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', out.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

let failed = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error && error.message ? error.message : error) }
}

async function main() {
  const worker = await bundle("export { storedStockAction, firstLineWithoutStockAction, pairDamagedLinesToLots, storedDamagedChoices, normalizeStockAction } from './src/lib/returnsStock'")
  const client = await bundle("export { storedStockAction, returnHistoryPayloadFromSnapshot } from '../frontend/src/components/returns/helpers/returnHistoryPayload.ts'")

  check('the Worker and the client read a stored line the same way, on every input', () => {
    const flags = [undefined, null, true, false, 0, 1, '0', '1', '', 'yes', 2, NaN]
    const actions = [undefined, null, '', 'restock', 'damaged', 'none', 'RESTOCK', ' Damaged ', 'bogus', 7]
    for (const stock_action of actions) {
      for (const return_to_stock of flags) {
        const input = { stock_action, return_to_stock }
        assert.equal(client.storedStockAction(input), worker.storedStockAction(input), `parity on ${JSON.stringify(input)}`)
      }
    }
  })

  check('a stored flag of the integer 0 is NOT a restock (the 0 !== false trap), 1 is, and an unreadable row is null', () => {
    assert.equal(worker.storedStockAction({ stock_action: null, return_to_stock: 0 }), 'none')
    assert.equal(worker.storedStockAction({ stock_action: null, return_to_stock: 1 }), 'restock')
    assert.equal(worker.storedStockAction({ stock_action: 'damaged', return_to_stock: 0 }), 'damaged')
    assert.equal(worker.storedStockAction({}), null)
    // The wire default is a different thing and keeps its meaning: only `false` is "no restock".
    assert.equal(worker.normalizeStockAction({ return_to_stock: 0 }), 'restock', 'the legacy wire default still reads 0 as restock')
  })

  const server = (extra) => ({ sale_item_id: 11, product_id: 5, product_name: 'Serum', quantity: 2, applied_price_usd: 5, applied_price_khr: 20500, return_to_stock: 1, stock_action: 'restock', branch_id: 1, ...extra })
  const snapshot = (items) => ({ id: 41, reason: 'Changed mind', return_type: 'restock', notes: '', total_refund_usd: 10, total_refund_khr: 41000, branch_id: 1, items })

  check('the client sends stock_action for every line, a real boolean return_to_stock, and the tag for a damaged one', () => {
    const body = client.returnHistoryPayloadFromSnapshot(snapshot([
      server({ id: 1 }),
      server({ id: 2, sale_item_id: 12, product_id: 6, return_to_stock: 0, stock_action: 'damaged', condition_tag: 'expired', damaged_disposition: 'keep' }),
      server({ id: 3, sale_item_id: 13, product_id: 7, return_to_stock: 0, stock_action: 'none' }),
    ]))
    assert.ok(body, 'a body is built')
    assert.deepEqual(body.items.map((item) => [item.stock_action, item.return_to_stock, item.condition_tag ?? null, item.damaged_disposition ?? null]),
      [['restock', true, null, null], ['damaged', false, 'expired', 'keep'], ['none', false, null, null]])
    assert.deepEqual([body.reason, body.return_type, body.total_refund_usd, body.total_refund_khr, body.branch_id], ['Changed mind', 'restock', 10, 41000, 1], 'the header is unchanged')
    assert.deepEqual(body.items.map((item) => [item.sale_item_id, item.product_id, item.quantity, item.branch_id]), [[11, 5, 2, 1], [12, 6, 2, 1], [13, 7, 2, 1]])
  })

  check('a legacy row with no stock_action replays from its stored flag; an unreadable row builds nothing', () => {
    const legacy = client.returnHistoryPayloadFromSnapshot(snapshot([server({ stock_action: null, return_to_stock: 0 }), server({ id: 2, stock_action: null, return_to_stock: 1 })]))
    assert.deepEqual(legacy.items.map((item) => [item.stock_action, item.return_to_stock]), [['none', false], ['restock', true]])
    assert.equal(client.returnHistoryPayloadFromSnapshot(snapshot([server({ stock_action: null, return_to_stock: null })])), null)
    assert.equal(client.returnHistoryPayloadFromSnapshot(snapshot([server(), server({ id: 2, stock_action: 'sellable', return_to_stock: undefined })])), null, 'one bad line spoils the whole body')
  })

  check('a damaged line without its tag, or whose lot is not whole, builds nothing -- the client never defaults a tag', () => {
    const damaged = (extra) => server({ return_to_stock: 0, stock_action: 'damaged', ...extra })
    assert.ok(client.returnHistoryPayloadFromSnapshot(snapshot([damaged({ condition_tag: 'opened', damaged_disposition: 'keep' })])))
    for (const [label, extra] of [
      ['no tag at all', {}],
      ['a blank tag', { condition_tag: '  ', damaged_disposition: 'keep' }],
      ['a tag but no disposition (the lot was drawn)', { condition_tag: 'opened' }],
      ['a destroyed lot is never re-created by a replay', { condition_tag: 'opened', damaged_disposition: 'remove' }],
    ]) assert.equal(client.returnHistoryPayloadFromSnapshot(snapshot([damaged(extra)])), null, label)
  })

  // ---- the Worker's refusal --------------------------------------------------------------------------------------
  const posted = (extra) => ({ product_id: 5, sale_item_id: 11, quantity: 1, ...extra })

  check('the Worker refuses a line that names no valid stock_action, whatever the legacy default would have done', () => {
    for (const [label, line] of [
      ['nothing at all', posted({})],
      ['return_to_stock true', posted({ return_to_stock: true })],
      ['return_to_stock false', posted({ return_to_stock: false })],
      ['the integer 0, which `!== false` reads as restock', posted({ return_to_stock: 0 })],
      ['a blank action', posted({ stock_action: '  ' })],
      ['an unknown action', posted({ stock_action: 'sellable' })],
      ['a tag without the action', posted({ return_to_stock: true, condition_tag: 'expired' })],
      ['a disposition without the action', posted({ return_to_stock: true, damaged_disposition: 'keep' })],
      ['no product and no sale line either', { return_to_stock: true }],
    ]) assert.equal(worker.firstLineWithoutStockAction([line]), 0, label)
  })

  check('the Worker accepts a body in which every line names its action, in any case, and reports the first bare line', () => {
    for (const action of ['restock', 'damaged', 'none', 'RESTOCK', ' Damaged ']) {
      assert.equal(worker.firstLineWithoutStockAction([posted({ stock_action: action })]), -1, action)
    }
    assert.equal(worker.firstLineWithoutStockAction([]), -1, 'no lines to guess')
    assert.equal(worker.firstLineWithoutStockAction([posted({ stock_action: 'restock' }), posted({ stock_action: 'none' }), posted({ return_to_stock: true })]), 2, 'the index of the first bare line')
  })

  // ---- which tag belongs to which line ----------------------------------------------------------------------------
  const lot = (id, extra) => ({ id, product_id: 5, quantity: 2, quantity_remaining: 2, condition_tag: 'damaged', ...extra })
  const line = (extra) => ({ product_id: 5, quantity: 2, return_to_stock: 0, stock_action: 'damaged', ...extra })

  check('each damaged line gets the tag of its own lot: the Nth damaged line of a product is the Nth lot', () => {
    const choices = worker.storedDamagedChoices(
      [line({ quantity: 1 }), line({ quantity: 3 }), line({ quantity: 1 })],
      [lot(30, { quantity: 1, quantity_remaining: 1, condition_tag: 'broken' }), lot(10, { quantity: 1, quantity_remaining: 1, condition_tag: 'expired' }), lot(20, { quantity: 3, quantity_remaining: 3, condition_tag: 'opened' })],
    )
    // Lots by id: 10 expired(1), 20 opened(3), 30 broken(1) -- input order does not matter.
    assert.deepEqual(choices, [{ condition_tag: 'expired', damaged_disposition: 'keep' }, { condition_tag: 'opened', damaged_disposition: 'keep' }, { condition_tag: 'broken', damaged_disposition: 'keep' }])
  })

  check('lines of different products pair with their own product\'s lots, and restock / no-restock lines claim no lot', () => {
    const choices = worker.storedDamagedChoices(
      [line({ product_id: 6, quantity: 1 }), { product_id: 5, quantity: 4, return_to_stock: 1, stock_action: 'restock' }, line({ product_id: 5 }), { product_id: 5, quantity: 1, return_to_stock: 0, stock_action: 'none' }],
      [lot(1, { product_id: 5, condition_tag: 'expired' }), lot(2, { product_id: 6, quantity: 1, quantity_remaining: 1, condition_tag: 'other' })],
    )
    assert.deepEqual(choices, [{ condition_tag: 'other', damaged_disposition: 'keep' }, null, { condition_tag: 'expired', damaged_disposition: 'keep' }, null])
  })

  check('the pairing ignores the branch (a consolidation can move a lot) but never pairs lines and lots of different size', () => {
    assert.deepEqual(worker.storedDamagedChoices([line({ branch_id: 1 })], [lot(1, { branch_id: 2, condition_tag: 'opened' })]), [{ condition_tag: 'opened', damaged_disposition: 'keep' }])
    assert.deepEqual(worker.storedDamagedChoices([line({ quantity: 2 }), line({ quantity: 2 })], [lot(1, { quantity: 5, quantity_remaining: 5, condition_tag: 'broken' }), lot(2, { condition_tag: 'opened' })]), [null, { condition_tag: 'opened', damaged_disposition: 'keep' }],
      'a size mismatch gets no tag rather than another line\'s tag, and the next line still pairs with its own lot')
    assert.deepEqual(worker.storedDamagedChoices([line(), line()], [lot(1, { condition_tag: 'opened' })]), [{ condition_tag: 'opened', damaged_disposition: 'keep' }, null], 'more lines than lots: the extra line has no tag')
  })

  check('a drawn or destroyed lot reports its tag but no disposition, and an untagged or unknown-tag lot reports nothing', () => {
    assert.deepEqual(worker.storedDamagedChoices([line()], [lot(1, { quantity_remaining: 1, condition_tag: 'opened' })]), [{ condition_tag: 'opened' }], 'partly drawn')
    assert.deepEqual(worker.storedDamagedChoices([line()], [lot(1, { quantity_remaining: 0, condition_tag: 'opened' })]), [{ condition_tag: 'opened' }], 'destroyed')
    assert.deepEqual(worker.storedDamagedChoices([line()], [lot(1, { condition_tag: null })]), [null], 'no tag recorded')
    assert.deepEqual(worker.storedDamagedChoices([line()], [lot(1, { condition_tag: 'cracked' })]), [null], 'a tag the Worker does not know')
    assert.deepEqual(worker.storedDamagedChoices([line()], []), [null], 'no lot at all')
  })

  check('equal-size damaged lines of one product are told apart by ORDER alone (and stay in order whatever order the lots arrive in)', () => {
    const lines = [line({ quantity: 1 }), line({ quantity: 1 }), line({ quantity: 1 })]
    const lots = [lot(7, { quantity: 1, quantity_remaining: 1, condition_tag: 'other' }), lot(3, { quantity: 1, quantity_remaining: 1, condition_tag: 'expired' }), lot(5, { quantity: 1, quantity_remaining: 1, condition_tag: 'opened' })]
    assert.deepEqual(worker.pairDamagedLinesToLots(lines, lots).map((paired) => paired.id), [3, 5, 7], 'the Kth line owns the Kth lot by id')
    assert.deepEqual(worker.storedDamagedChoices(lines, lots).map((choice) => choice.condition_tag), ['expired', 'opened', 'other'])
    // The reverse tag order must reverse the answer: a matcher that sorts by tag, or hands out the first lot, cannot pass both.
    const reversed = [lot(3, { quantity: 1, quantity_remaining: 1, condition_tag: 'other' }), lot(5, { quantity: 1, quantity_remaining: 1, condition_tag: 'opened' }), lot(7, { quantity: 1, quantity_remaining: 1, condition_tag: 'expired' })]
    assert.deepEqual(worker.storedDamagedChoices(lines, reversed).map((choice) => choice.condition_tag), ['other', 'opened', 'expired'])
  })

  check('pairDamagedLinesToLots returns the lot itself (id, remaining units), null for non-damaged lines, and each lot at most once', () => {
    const lots = [lot(1, { quantity: 2 }), lot(2, { quantity: 2 })]
    const paired = worker.pairDamagedLinesToLots([line(), { product_id: 5, quantity: 2, return_to_stock: 1, stock_action: 'restock' }, line()], lots)
    assert.deepEqual(paired.map((p) => (p ? p.id : null)), [1, null, 2])
    assert.equal(new Set(paired.filter(Boolean)).size, 2)
  })

  check('end to end on the pure kernels: a snapshot built from the Worker\'s read replays as a body the Worker accepts', () => {
    const lines = [server({ id: 1, sale_item_id: 11, return_to_stock: 0, stock_action: 'damaged', quantity: 1 }), server({ id: 2, sale_item_id: 12, return_to_stock: 0, stock_action: 'damaged', quantity: 2 }), server({ id: 3, sale_item_id: 13, return_to_stock: 1, stock_action: 'restock', quantity: 4 })]
    const choices = worker.storedDamagedChoices(lines, [lot(1, { quantity: 1, quantity_remaining: 1, condition_tag: 'expired' }), lot(2, { quantity: 2, quantity_remaining: 2, condition_tag: 'opened' })])
    const attached = lines.map((row, index) => (choices[index] ? { ...row, ...choices[index] } : row))
    const body = client.returnHistoryPayloadFromSnapshot(snapshot(attached))
    assert.ok(body)
    assert.deepEqual(body.items.map((item) => item.condition_tag ?? null), ['expired', 'opened', null])
    assert.equal(worker.firstLineWithoutStockAction(body.items), -1, 'every line the new client builds names its action, so the Worker refuses nothing')
  })

  if (failed) { console.error(`${failed} check(s) failed`); process.exitCode = 1 } else console.log('PASS return history stock-action kernels and Worker/client parity')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
