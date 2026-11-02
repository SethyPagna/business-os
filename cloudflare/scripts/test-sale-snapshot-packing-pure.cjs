#!/usr/bin/env node
// LS1: the pure pieces that keep a large sale inside D1's 2,000,000-byte value cap.
//   1. pack/unpack of a sale's line snapshots is lossless BYTE FOR BYTE (62 and 200 real lines, quotes, backslash, Khmer, emoji) and a
//      packed copy is a small fraction of the raw one; anything not canonical stays the raw string; an old copy (no packs) reads unchanged;
//   2. chunking keeps every group under the cap and loses no row;
//   3. validateCapturedSaleBasket answers exactly what the pairwise implementation answered (differential, with planted wrong baskets) and is
//      linear: 200 lines in seconds where the pairwise form needs gigabytes of JSON.stringify;
//   4. controls: a dropped line, a truncated pool, a swapped snapshot and a missing pool must turn the check red.
'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')

const lib = path.resolve(__dirname, '../src/lib')
const bundle = buildSync({
  stdin: { contents: "export * from './saleItemPricing'; export * from './saleSnapshotPacking'; export * from './moneyPrecision'", resolveDir: lib, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'error',
}).outputFiles[0].text
const module_ = { exports: {} }
new Function('module', 'exports', bundle)(module_, module_.exports)
const K = module_.exports

const CAP = 2_000_000
const text = 'ក្រែមថែរក្សាស្បែក "premium" \\ 100% / 😀 ' + 'ស'.repeat(30)

function basket(n, { keys = 'short', rules = [] } = {}) {
  const lines = Array.from({ length: n }, (_, i) => ({
    line_key: keys === 'pos' ? `${1000 + i}:selling:1:${500000 + i}:D0:1730500000000:ab${i}` : `l${i}`,
    source: 'selling',
    product: { id: 1000 + i, category: text, brand: `Brand ${i % 60}`, selling_price_usd: 5 + (i % 20), selling_price_khr: (5 + (i % 20)) * 4000, discount_enabled: 0, discount_type: null, discount_percent: 0,
      discount_amount_usd: 0, discount_amount_khr: 0, discount_starts_at: null, discount_ends_at: null, discount_label: null, discount_badge_color: null },
    selling_price_input_usd: null, manual: { type: 'none', value: 0 },
  }))
  const pool = { version: 1, pool_key: `pool-${n}-${keys}`, evaluation_time: '2026-11-02T01:00:00.000Z', exchange_rate: 4000, rules, lines }
  const quantities = Object.fromEntries(lines.map((l) => [l.line_key, 1]))
  const amounts = K.evaluateCapturedPricingPool(pool, quantities)
  const allocation = { version: 1, lines: lines.map((l) => ({ line_key: l.line_key, amount: amounts.get(l.line_key).total_usd })), discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 }
  const rows = lines.map((l, i) => K.materializeCapturedPricingRow({ id: i + 1, sale_id: 1, product_id: l.product.id }, pool, quantities, l.line_key, allocation))
  const subtotal = K.sumMoney4 ? K.sumMoney4(rows.map((r) => r.total_usd)) : rows.reduce((s, r) => Math.round((s + r.total_usd) * 1e4) / 1e4, 0)
  const header = { id: 1, exchange_rate: 4000, discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, subtotal_usd: subtotal }
  return { pool, quantities, rows, header, allocation }
}
const bytes = (v) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v)).length

// ---- 1. lossless packing ----
for (const [n, keys] of [[62, 'pos'], [86, 'pos'], [200, 'short']]) {
  const b = basket(n, { keys })
  const raw = b.rows.map((r) => r.pricing_snapshot_json)
  const total = raw.reduce((s, v) => s + bytes(v), 0)
  assert.ok(raw.every((v) => bytes(v) < 128_000), `${n} lines: each snapshot is within the app cap`)
  if (n >= 62) assert.ok(total > CAP, `${n} lines: the raw snapshots (${total}) exceed D1's cap, or the test proves nothing`)
  const packed = K.packSnapshotField(b.rows, 'pricing_snapshot_json')
  const packs = K.packsOf(packed.table)
  assert.ok(packs && packs.pools.length === 1 && packs.contexts.length === 1, `${n} lines: one pool and one allocation context in the pack`)
  const stored = JSON.stringify({ lines: packed.rows, pricing_packs: packs })
  assert.ok(bytes(stored) < CAP / 4, `${n} lines: the packed copy is ${bytes(stored)} bytes, raw ${total}`)
  assert.ok(packed.rows.every((r) => K.isPackedSnapshot(r.pricing_snapshot_json)), `${n} lines: every canonical snapshot is packed`)
  const back = K.unpackSnapshotField(JSON.parse(stored).lines, 'pricing_snapshot_json', JSON.parse(stored).pricing_packs)
  assert.deepEqual(back.map((r) => r.pricing_snapshot_json), raw, `${n} lines: unpack(pack(x)) is x byte for byte after a JSON round trip`)
  console.log(`ok  ${n} lines: raw ${total} bytes -> packed ${bytes(stored)} bytes, byte-exact`)
}

// ---- non-canonical and old shapes stay as they were ----
{
  const b = basket(5)
  const original = b.rows[0].pricing_snapshot_json
  const reordered = JSON.stringify({ line_key: JSON.parse(original).line_key, version: 1, ...JSON.parse(original) })
  const spaced = JSON.stringify(JSON.parse(original), null, 1)
  const rows = [{ id: 1, pricing_snapshot_json: reordered }, { id: 2, pricing_snapshot_json: spaced }, { id: 3, pricing_snapshot_json: null }, { id: 4 }, { id: 5, pricing_snapshot_json: 'not json' }, { id: 6, pricing_snapshot_json: original }]
  const packed = K.packSnapshotField(rows, 'pricing_snapshot_json')
  assert.deepEqual(packed.rows.slice(0, 5), rows.slice(0, 5), 'a snapshot that is not the canonical text (another key order, whitespace, null, absent, not JSON) is never touched')
  assert.ok(K.isPackedSnapshot(packed.rows[5].pricing_snapshot_json), 'the canonical one is packed')
  const oldPayload = { saleId: 7, lines: [{ saleItemId: 1, pricingSnapshotJson: original }], lineMoneyBefore: rows, lineMoneyAfter: rows, saleStateRevision: 3 }
  assert.deepEqual(K.unpackAddItemsReversal(oldPayload), oldPayload, 'a payload written before packing existed reads exactly as it did')
  const pack = K.newPackTable()
  const reversal = { saleId: 7, saleStateRevision: 3, lines: K.packSnapshotField(oldPayload.lines, 'pricingSnapshotJson', pack).rows,
    lineMoneyBefore: K.packSnapshotField([{ id: 1, pricing_snapshot_json: original }], 'pricing_snapshot_json', pack).rows, pricing_packs: K.packsOf(pack) }
  const restored = K.unpackAddItemsReversal(JSON.parse(JSON.stringify(reversal)))
  assert.equal(restored.lines[0].pricingSnapshotJson, original)
  assert.equal(restored.lineMoneyBefore[0].pricing_snapshot_json, original)
  assert.equal(restored.pricing_packs, undefined, 'the pack is consumed')
  console.log('ok  non-canonical, null, absent and old-shape payloads are left exactly as they were')
}

// ---- the stored response (SQL builds this shape; expandStoredSaleResponse rebuilds the wire form) ----
{
  const b = basket(62, { keys: 'pos' })
  const items = b.rows.map((r, i) => {
    const snap = JSON.parse(r.pricing_snapshot_json)
    return { id: i + 1, pricing_snapshot_packed: { line_key: snap.line_key, pool_key: snap.pool.pool_key, amounts: snap.amounts, receipt_allocation: snap.receipt_allocation } }
  })
  const stored = JSON.stringify({ id: 1, sale: { id: 1, items, pricing_packs: { allocation_context: b.allocation, pools: { [b.pool.pool_key]: { pool: b.pool, quantities: b.quantities } } } } })
  assert.ok(bytes(stored) < 600_000, `the stored response is ${bytes(stored)} bytes`)
  const wire = K.expandStoredSaleResponse(JSON.parse(stored))
  assert.deepEqual(wire.sale.items.map((i) => i.pricing_snapshot_json), b.rows.map((r) => r.pricing_snapshot_json), 'the expanded response carries the original snapshot text')
  assert.equal(wire.sale.pricing_packs, undefined)
  assert.equal(wire.sale.items[0].pricing_snapshot_packed, undefined)
  const old = { id: 1, sale: { id: 1, items: b.rows.map((r) => ({ id: r.id, pricing_snapshot_json: r.pricing_snapshot_json })) } }
  assert.deepEqual(K.expandStoredSaleResponse(old), old, 'a response stored before packing is returned unchanged')
  console.log('ok  stored response: expands to the original text; an old response is unchanged')
}

// ---- 2. chunking ----
{
  const b = basket(86, { keys: 'pos' })
  const rows = b.rows.map((r) => ({ id: r.id, pricing_snapshot_json: r.pricing_snapshot_json }))
  const chunks = K.chunkRowsByJsonBytes(rows)
  assert.ok(chunks.length >= 3, 'an 86-line sale needs several groups')
  for (const chunk of chunks) assert.ok(bytes(chunk) <= K.STORED_COPY_CHUNK_BYTES, `a group is ${bytes(chunk)} bytes`)
  assert.deepEqual(chunks.flat(), rows, 'groups lose no row and keep the order')
  assert.deepEqual(K.chunkRowsByJsonBytes([]), [])
  const huge = K.chunkRowsByJsonBytes([{ v: 'x'.repeat(1000) }, { v: 'y'.repeat(1000) }], 500)
  assert.equal(huge.length, 2, 'a row bigger than the limit still forms its own group')
  const statements = K.pricingRowsStatements(1, b.rows.map((r) => ({ ...r, id: r.id })))
  assert.ok(statements.length >= 3)
  for (const s of statements) assert.ok(bytes(s.params.pricing_rows) < CAP, 'a pricing update group is below the cap')
  assert.deepEqual(statements.flatMap((s) => JSON.parse(s.params.pricing_rows).map((r) => r.id)), b.rows.map((r) => r.id), 'every row is written by exactly one group, in order')
  assert.throws(() => K.pricingRowsStatement(1, b.rows), 'the single-statement form still refuses a basket that does not fit one parameter')
  console.log(`ok  chunking: ${chunks.length} groups, none above ${K.STORED_COPY_CHUNK_BYTES} bytes`)
}

// ---- 3. validateCapturedSaleBasket: the pairwise original (saleItemPricing.ts at 736929e91), as an independent oracle ----
function oldValidate(lines, header, identityBindings = []) {
  const invalid = () => { throw new Error('invalid') }
  if (!lines.length || lines.length > K.MAX_PRICING_LINES) invalid()
  const snapshots = lines.map((line) => {
    const snapshot = K.parseSaleItemPricing(line.pricing_snapshot_json)
    if (!snapshot || snapshot.pool.exchange_rate !== header.exchange_rate) invalid()
    const capture = snapshot.pool.lines.find((row) => row.line_key === snapshot.line_key)
    const binding = identityBindings.filter((b) => b.sale_item_id === line.id && b.sale_id === header.id && b.sale_id === line.sale_id
      && b.captured_product_id === capture?.product.id && b.current_product_id === line.product_id)
    if (!capture || (capture.product.id !== line.product_id && binding.length !== 1) || snapshot.quantities[snapshot.line_key] !== line.quantity) invalid()
    for (const [key, value] of Object.entries(K.capturedPricingMetadata(snapshot.pool, snapshot.line_key, snapshot.amounts))) if ((line[key] ?? null) !== value) invalid()
    for (const field of ['total_usd', 'total_khr', 'base_price_usd', 'base_price_khr', 'applied_price_usd', 'applied_price_khr']) if (line[field] !== snapshot.amounts[field]) invalid()
    if ((line.manual_discount_type ?? 'none') !== capture.manual.type || line.manual_discount_value !== capture.manual.value) invalid()
    for (const [field, amount] of [['product_discount_usd', snapshot.amounts.product_discount_usd], ['manual_discount_usd', snapshot.amounts.manual_discount_usd]]) {
      const unit = K.divideMoney4(amount, Number(line.quantity))
      if (line[field] !== unit || line[field.replace('_usd', '_khr')] !== K.multiplyMoney4(unit, snapshot.pool.exchange_rate)) invalid()
    }
    return snapshot
  })
  pairwiseCrossCheck(snapshots, header)
  if (K.sumMoney4(snapshots.map((s) => s.amounts.total_usd)) !== header.subtotal_usd) invalid()
  return snapshots
}
// The final loop of the original, applied to parsed snapshots.
function pairwiseCrossCheck(snapshots, header) {
  const invalid = () => { throw new Error('invalid') }
  const byKey = new Map(snapshots.map((s) => [s.line_key, s]))
  if (byKey.size !== snapshots.length) invalid()
  const allocation = snapshots[0].allocation_context
  if (allocation.discount_usd !== header.discount_usd || allocation.membership_discount_usd !== header.membership_discount_usd || allocation.tax_usd !== header.tax_usd
    || allocation.lines.length !== snapshots.length) invalid()
  for (const entry of allocation.lines) if (byKey.get(entry.line_key)?.amounts.total_usd !== entry.amount) invalid()
  const poolContexts = new Map()
  for (const snapshot of snapshots) {
    const context = JSON.stringify({ pool: snapshot.pool, quantities: snapshot.quantities })
    if (poolContexts.has(snapshot.pool.pool_key) && poolContexts.get(snapshot.pool.pool_key) !== context) invalid()
    poolContexts.set(snapshot.pool.pool_key, context)
    if (JSON.stringify(snapshot.allocation_context) !== JSON.stringify(allocation)) invalid()
    for (const member of snapshot.pool.lines) {
      const other = byKey.get(member.line_key)
      if (!other || JSON.stringify(other.pool) !== JSON.stringify(snapshot.pool) || JSON.stringify(other.quantities) !== JSON.stringify(snapshot.quantities)) invalid()
    }
  }
}
const verdict = (fn) => { try { fn(); return 'valid' } catch { return 'invalid' } }
{
  // Planted wrong baskets: each changes ONE thing a coherent sale never changes.
  const mutate = (b, how) => {
    const rows = b.rows.map((r) => ({ ...r })), header = { ...b.header }
    const snap = (i) => JSON.parse(rows[i].pricing_snapshot_json)
    const put = (i, v) => { rows[i].pricing_snapshot_json = JSON.stringify(v) }
    if (how === 'none') return { rows, header }
    if (how === 'foreign pool key on one line') { const s = snap(2); s.pool.pool_key = 'other'; put(2, s) }
    if (how === 'one pool line edited inside one snapshot') { const s = snap(1); s.pool.lines[0].manual = { type: 'none', value: 0 }; s.pool.lines[0].product.category = 'x'; put(1, s) }
    if (how === 'quantities differ on one line') { const s = snap(3); s.quantities[s.line_key] = 1; s.quantities.extra = 1; put(3, s) }
    if (how === 'allocation context differs on one line') { const s = snap(2); s.allocation_context.tax_usd = 0.0001; put(2, s) }
    if (how === 'a duplicate line') { rows[1] = { ...rows[0], id: 2 } }
    if (how === 'header subtotal') header.subtotal_usd = header.subtotal_usd + 0.01
    if (how === 'header rate') header.exchange_rate = 4100
    if (how === 'header discount') header.discount_usd = 1
    if (how === 'pool member not in the basket') rows.pop()
    return { rows, header }
  }
  for (const n of [3, 12, 30]) {
    const b = basket(n)
    for (const how of ['none', 'foreign pool key on one line', 'one pool line edited inside one snapshot', 'quantities differ on one line', 'allocation context differs on one line',
      'a duplicate line', 'header subtotal', 'header rate', 'header discount', 'pool member not in the basket']) {
      if (n < 4 && how === 'quantities differ on one line') continue
      const m = mutate(b, how)
      const now = verdict(() => K.validateCapturedSaleBasket(m.rows, m.header))
      const old = verdict(() => oldValidate(m.rows, m.header))
      if (how === 'none') assert.equal(now, 'valid', `${n} lines: the coherent basket validates`)
      else assert.equal(now, 'invalid', `${n} lines: "${how}" must be refused`)
      assert.equal(now, old, `${n} lines, "${how}": the linear check and the pairwise original disagree`)
    }
  }
  console.log('ok  validateCapturedSaleBasket: same verdict as the pairwise original on coherent and planted-wrong baskets')
}
{
  const b = basket(200, { keys: 'short' })
  const t0 = Date.now()
  K.validateCapturedSaleBasket(b.rows, b.header)
  const linear = Date.now() - t0
  assert.ok(linear < 30_000, `200 lines validated in ${linear} ms`)
  const b62 = basket(62, { keys: 'pos' })
  const snapshots = b62.rows.map((r) => K.parseSaleItemPricing(r.pricing_snapshot_json))
  const t1 = Date.now()
  pairwiseCrossCheck(snapshots, b62.header)
  const pairwise = Date.now() - t1
  console.log(`ok  200 lines validate in ${linear} ms; the pairwise cross check alone needs ${pairwise} ms at 62 lines (n^3: about ${Math.round(pairwise * (200 / 62) ** 3)} ms at 200)`)
}

// ---- 4. controls ----
{
  const b = basket(30, { keys: 'pos' })
  const raw = b.rows.map((r) => r.pricing_snapshot_json)
  const packed = K.packSnapshotField(b.rows, 'pricing_snapshot_json')
  const packs = JSON.parse(JSON.stringify(K.packsOf(packed.table)))
  const lines = JSON.parse(JSON.stringify(packed.rows))
  const expectRed = (label, make) => {
    let got
    try { const out = make(); got = out.map((r) => r.pricing_snapshot_json) } catch { return }
    assert.notDeepEqual(got, raw, `control "${label}" was NOT caught`)
  }
  expectRed('a dropped line', () => K.unpackSnapshotField(lines.slice(0, -1), 'pricing_snapshot_json', packs))
  expectRed('a truncated pool', () => { const p = JSON.parse(JSON.stringify(packs)); p.pools[0].pool.lines.pop(); return K.unpackSnapshotField(lines, 'pricing_snapshot_json', p) })
  expectRed('a swapped snapshot', () => { const l = JSON.parse(JSON.stringify(lines)); [l[0].pricing_snapshot_json, l[1].pricing_snapshot_json] = [l[1].pricing_snapshot_json, l[0].pricing_snapshot_json]; return K.unpackSnapshotField(l, 'pricing_snapshot_json', packs) })
  assert.throws(() => K.unpackSnapshotField(lines, 'pricing_snapshot_json', undefined), (e) => e.code === 'packed_snapshot_unavailable', 'a missing pack is an error, never a guess')
  assert.throws(() => K.unpackSnapshotField(lines, 'pricing_snapshot_json', { ...packs, pools: [] }), (e) => e.code === 'packed_snapshot_unavailable')
  // and a truncated pool makes the rebuilt snapshot fail the pricing validation the till runs
  const bad = JSON.parse(JSON.stringify(packs)); bad.pools[0].pool.lines.pop()
  const rebuilt = K.unpackSnapshotField(lines, 'pricing_snapshot_json', bad).map((r) => r.pricing_snapshot_json)
  assert.throws(() => K.validateCapturedSaleBasket(b.rows.map((r, i) => ({ ...r, pricing_snapshot_json: rebuilt[i] })), b.header), 'a truncated pool fails the basket validation')
  console.log('ok  controls: a dropped line, a truncated pool, a swapped snapshot and a missing pack are all caught')
}
console.log('test-sale-snapshot-packing-pure: all checks passed')
