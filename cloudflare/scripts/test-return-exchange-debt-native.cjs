// RET-A verifier findings P1 and P2 (6 Oct 2026) through the real POST
// /api/returns on workerd + D1 with every migration.
//
// P1 -- an exchange on a sale that carries a debt. The return lowers the debt
// first; the replacement follows the original sale's payment state: it is paid
// only from the cash part of the refund (in the refund's currency) and the rest
// of its value is owed. Owner model: a $10 Not Paid sale with $4 back and $4 of
// other goods out -> the drawer moves by 0 and the customer owes $10.
//   Not Paid ($0 paid), $4 back:  equal $4 / higher $6 / lower $2 out
//   $7 paid ($3 owed), $4 back ($3 lowers the debt, $1 cash):
//       equal $4 / higher $6 / lower $0.50 out, and a riel refund
//   Completed control: unchanged counter rule (refund out, replacement paid).
// The drawer is the real shiftRefunds plus the real tender reading
// (tenderWhere); what is owed is the real kernel over each sale row.
//
// P2 -- a riel refund whose lines carry no riel figure (a legacy line with no
// riel price; a product-matched line that posts 0 riel) takes its riel from
// the dollars at the sale's rate, so it leaves the riel drawer.
//
// Discriminating: on 32f0c48dc the Not Paid exchange expects +$4 in the drawer
// and owes $6, and both riel refunds leave neither drawer.
//
// Verify R2 X6-X8 and the 1-riel drift: a legacy line whose riel price is NOT
// USD x the sale rate (Serum $4 at 15,500 riel, rate 4,000), $7 paid, riel
// refund. The replacement funded from the refund's riel must owe exactly what
// the screen said (no phantom cents), and the riel the screen says to pay out
// must be the drawer's net to the riel. On 73c86210f the equal exchange owes
// 3.03125 instead of 3, the $0.50 one stays Not Paid owing 0.0155, and the
// screen says 1,938 riel while the drawer pays 1,937.
// Run: node scripts/test-return-exchange-debt-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
// The return detail's own reading of a recorded refund (shipped frontend module).
const { recordedRefundSplit } = require(path.join(root, '..', 'frontend', 'src', 'components', 'returns', 'helpers', 'refundCurrency.ts'))

async function kernels() {
  const bundle = await build({ stdin: { contents: `export { recordedSaleOutstandingUsd } from './src/lib/saleStatusResolution'
      export { returnOwedReductionSql } from './src/lib/returnRefundSplit'`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns'
      import { shiftRefunds, tenderWhere } from './src/lib/shiftReconciliation'
      const app=new Hono(); app.route('/api/returns',returns)
      app.get('/drawer',async c=>{
        const refunds=await shiftRefunds(c.env,{scope_mode:'per_account',user_id:7,branch_id:1,opened_at:'2020-01-01T00:00:00.000Z',closed_at:null},Date.now()+60000)
        const tender=await tenderWhere(c.env,['sales.source_return_id IS NOT NULL'],{},{kinds:{},configuredMethods:['Cash']})
        return c.json({usd:Math.round((tender.usd-refunds.usd)*100)/100,khr:tender.khr-refunds.khr})
      })
      export default app;`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
  plugins: [{ name: 'exchange-debt-fixtures', setup(b) {
    const fixtures = {
      auth: `export const requireAuth=async(c,next)=>{c.set('user',{id:7,username:'fixture',name:'Fixture',role_code:'admin',permissions:JSON.stringify({all:true})});return next()}`,
      audit: 'export const audit=async()=>{};export const buildAuditStatement=()=>({sql:"SELECT 1",params:{}});export const changedFields=()=>null;export const auditChangeColumns=()=>({old_value:null,new_value:null});export const isSecretShapedAuditKey=()=>false',
      cache: `export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};export const getVersionWithFallback=async()=>0;
        export const cachedJsonResponse=async(...args)=>args[args.length-1]()`,
      broadcastHub: 'export const broadcast=async()=>{}',
      telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendReturnStatusTelegramEvents=async()=>{};export const sendTelegramEvent=async()=>{};
        export const sendSaleTelegramEvent=async()=>{};export const formatSaleTelegramLines=()=>[];export const formatSaleStatusTelegramLines=()=>[];
        export const telegramMoney=()=>''`,
    }
    b.onResolve({ filter: /(?:lib\/(?:auth|audit|cache|telegram)|durable-objects\/broadcastHub)$/ }, args => ({
      path: args.path.split('/').pop(), namespace: 'exchange-fixture',
    }))
    b.onLoad({ filter: /.*/, namespace: 'exchange-fixture' }, args => ({ contents: fixtures[args.path], loader: 'ts' }))
  } }],
  })
}

async function migrate(db) {
  const dir = path.join(root, 'migrations')
  for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8'))) {
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      try { await db.prepare(statement).run() } catch (error) { error.message = `${name}: ${error.message}`; throw error }
    }
  }
}

async function main() {
  const [kernel, bundle] = await Promise.all([kernels(), workerBundle()])
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    await db.batch([
      "INSERT INTO settings(key,value) VALUES('pos_payment_methods','[\"Cash\",\"ABA\"]')",
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd,selling_price_khr) VALUES(1,'Serum',1,0,1,4,16000)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd,selling_price_khr) VALUES(2,'Gift',1,100,1,4,16000)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd,selling_price_khr) VALUES(3,'Toner',1,0,1,6,24000)",
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)',
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,100)',
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(3,1,0)',
      "INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,received_quantity) VALUES(600,2,'G600','G600','2026-09-01',1,100)",
      'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(600,1,100)',
    ].map(sql => db.prepare(sql)))
    // Each case gets its own $10 sale: Serum $4 (the line returned) + Toner $6.
    const sale = async (n, { status, paidUsd = 0, serumKhr = 16000, serumUsd = 4 }) => { const id = 100 + n; return db.batch([
      db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,amount_paid_usd,amount_paid_khr,
        money_precision_version,sale_status,payment_method) VALUES(?,?,1,'Shop',4000,?,?,?,0,0,?,'Cash')`).bind(id, `X-${id}`, serumUsd + 6, serumUsd + 6, paidUsd, status),
      db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,applied_price_khr,total_usd,total_khr,cost_price_usd)
        VALUES(?,?,1,'Serum',1,1,?,?,?,?,1)`).bind(id * 10 + 1, id, serumUsd, serumKhr, serumUsd, serumKhr),
      db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,applied_price_khr,total_usd,total_khr,cost_price_usd)
        VALUES(?,?,3,'Toner',1,1,6,24000,6,24000,1)`).bind(id * 10 + 2, id),
    ]) }
    // Every fixture sale exists before the first exchange: a replacement sale
    // takes the next id after the highest one.
    await sale(1, { status: 'awaiting_payment' })
    await sale(2, { status: 'awaiting_payment' })
    await sale(3, { status: 'awaiting_payment' })
    await sale(4, { status: 'awaiting_payment', paidUsd: 7 })
    await sale(5, { status: 'awaiting_payment', paidUsd: 7 })
    await sale(6, { status: 'awaiting_payment', paidUsd: 7 })
    await sale(7, { status: 'awaiting_payment', paidUsd: 7 })
    await sale(8, { status: 'completed', paidUsd: 10 })
    await sale(9, { status: 'completed', paidUsd: 10, serumKhr: 0 })
    await sale(10, { status: 'completed', paidUsd: 10 })
    await sale(11, { status: 'awaiting_payment' })
    await sale(12, { status: 'awaiting_payment', paidUsd: 7 })
    await sale(13, { status: 'awaiting_payment', paidUsd: 7, serumKhr: 15500 })
    await sale(14, { status: 'awaiting_payment', paidUsd: 7, serumKhr: 15500 })
    // verify R3 E1, the verifier's D1 repro: $1.20 Serum at 4,700 riel, owes $0.99.
    await sale(15, { status: 'awaiting_payment', paidUsd: 6.21, serumKhr: 4700, serumUsd: 1.2 })
    // verify R3 edit guard: two Serum units ($8) + Toner ($6), $11 paid, owes $3.
    await sale(16, { status: 'awaiting_payment', paidUsd: 11, serumUsd: 8, serumKhr: 32000 })
    await db.prepare('UPDATE sale_items SET quantity=2, applied_price_usd=4, applied_price_khr=16000 WHERE id=1161').run()
    const headers = { 'content-type': 'application/json' }
    const post = async (body) => {
      const response = await mf.dispatchFetch('http://local/api/returns', { method: 'POST', headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed; try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 400) } }
      return { status: response.status, body: parsed }
    }
    const drawer = async () => (await mf.dispatchFetch('http://local/drawer')).json()
    const owes = async (id) => kernel.recordedSaleOutstandingUsd(await db.prepare(`SELECT s.*,${kernel.returnOwedReductionSql('s')} FROM sales s WHERE s.id=?`).bind(id).first())
    const exchange = async (n, replacementUsd, extra = {}) => {
      const saleId = 100 + n
      const before = await drawer()
      const result = await post({ client_request_id: `x-${n}`, sale_id: saleId, reason: 'exchange', ...extra,
        items: [{ sale_item_id: saleId * 10 + 1, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1 }],
        replacement_items: replacementUsd == null ? [] : [{ product_id: 2, quantity: 1, branch_id: 1, applied_price_usd: replacementUsd, applied_price_khr: Math.round(replacementUsd * 4000) }] })
      assert.equal(result.status, 200, JSON.stringify(result.body))
      const after = await drawer()
      const replacement = result.body.replacementSaleId
        ? await db.prepare('SELECT id,sale_status,amount_paid_usd,amount_paid_khr,payment_method,payment_details FROM sales WHERE id=?').bind(result.body.replacementSaleId).first()
        : null
      return {
        drawerUsd: Math.round((after.usd - before.usd) * 100) / 100, drawerKhr: after.khr - before.khr,
        originalOwes: await owes(saleId), replacementOwes: replacement ? await owes(replacement.id) : 0,
        replacementStatus: replacement?.sale_status ?? null, replacement,
      }
    }

    // -- Not Paid, nothing paid: the replacement is owed in full ---------------------
    const equal = await exchange(1, 4)
    assert.deepEqual([equal.drawerUsd, equal.drawerKhr], [0, 0], 'equal exchange on a Not Paid sale: the drawer moves by nothing')
    assert.equal(equal.originalOwes + equal.replacementOwes, 10, 'the customer still owes $10 for $10 of goods')
    assert.deepEqual([equal.originalOwes, equal.replacementOwes, equal.replacementStatus], [6, 4, 'awaiting_payment'])
    assert.equal(equal.replacement.payment_details, '[]', 'no tender is recorded for the replacement')
    const higher = await exchange(2, 6)
    assert.deepEqual([higher.drawerUsd, higher.originalOwes, higher.replacementOwes, higher.replacementStatus], [0, 6, 6, 'awaiting_payment'],
      'higher-value replacement: owes $12 for $12 of goods, nothing in the drawer')
    const lower = await exchange(3, 2)
    assert.deepEqual([lower.drawerUsd, lower.originalOwes, lower.replacementOwes], [0, 6, 2], 'lower-value replacement: owes $8')
    console.log('PASS Not Paid exchange: equal, higher and lower replacements are owed; the drawer never expects money')

    // -- $7 paid of $10 ($3 owed): $3 lowers the debt, $1 is cash -----------------------
    const partEqual = await exchange(4, 4)
    assert.deepEqual([partEqual.drawerUsd, partEqual.originalOwes, partEqual.replacementOwes, partEqual.replacementStatus], [0, 0, 3, 'awaiting_payment'],
      'part paid, equal: the $1 cash pays the replacement, $3 owed, drawer 0')
    assert.deepEqual([partEqual.replacement.amount_paid_usd, partEqual.replacement.payment_method], [1, 'Cash'])
    const partHigher = await exchange(5, 6)
    assert.deepEqual([partHigher.drawerUsd, partHigher.originalOwes, partHigher.replacementOwes], [0, 0, 5], 'part paid, higher: owes $5 ($12 of goods, $7 paid)')
    const partLower = await exchange(6, 0.5)
    assert.deepEqual([partLower.drawerUsd, partLower.originalOwes, partLower.replacementOwes, partLower.replacementStatus], [-0.5, 0, 0, 'completed'],
      'part paid, lower: $0.50 pays the replacement and $0.50 leaves the drawer ($6.50 of goods, $7 paid)')
    const partRiel = await exchange(7, 4, { refund_currency: 'KHR' })
    assert.deepEqual([partRiel.drawerUsd, partRiel.drawerKhr, partRiel.originalOwes, partRiel.replacementOwes], [0, 0, 0, 3],
      'riel refund: the riel cash part pays the replacement in riel, both drawers net to 0')
    assert.deepEqual([partRiel.replacement.amount_paid_usd, partRiel.replacement.amount_paid_khr], [0, 4000])
    // verify R3 E4: riel at USD x the rate -- the replacement keeps the shop's rate.
    assert.equal((await db.prepare('SELECT exchange_rate FROM sales WHERE id=?').bind(partRiel.replacement.id).first()).exchange_rate, 4000,
      'a riel-funded replacement whose riel is USD x the rate is recorded at the shop rate')
    console.log('PASS part-paid exchange: the refund\'s cash part pays the replacement first, in its own currency; the rest is owed or paid out')

    // -- Completed control: the counter rule is unchanged ------------------------------
    const paid = await exchange(8, 4)
    assert.deepEqual([paid.drawerUsd, paid.originalOwes, paid.replacementOwes, paid.replacementStatus], [0, 0, 0, 'completed'],
      'Completed: $4 refunded and $4 paid for the replacement, as before')
    assert.equal(paid.replacement.amount_paid_usd, 4)
    console.log('PASS a Completed sale keeps the counter rule: refund out, replacement paid')

    // -- P2: a riel refund always leaves the riel drawer --------------------------------
    const legacyRiel = await exchange(9, null, { refund_currency: 'KHR' })
    assert.deepEqual([legacyRiel.drawerUsd, legacyRiel.drawerKhr], [0, -16000], 'a legacy line with no riel price: 16,000 riel out at the sale rate')
    assert.equal((await db.prepare("SELECT total_refund_khr FROM returns WHERE client_request_id='x-9'").first()).total_refund_khr, 16000)
    const before = await drawer()
    const productMatched = await post({ client_request_id: 'x-10', sale_id: 110, reason: 'riel', refund_currency: 'KHR',
      items: [{ product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1, applied_price_usd: 4, applied_price_khr: 0 }] })
    assert.equal(productMatched.status, 200, JSON.stringify(productMatched.body))
    const after = await drawer()
    assert.deepEqual([Math.round((after.usd - before.usd) * 100) / 100, after.khr - before.khr], [0, -16000],
      'a product-matched line posting 0 riel: the riel still comes out of the riel drawer')
    console.log('PASS a riel refund with no riel figure takes its riel from the dollars at the sale rate')

    // -- The Return screen's preview is the same arithmetic POST records ---------------
    const preview = async (body) => {
      const response = await mf.dispatchFetch('http://local/api/returns/split-preview', { method: 'POST', headers, body: JSON.stringify(body) })
      return { status: response.status, body: await response.json() }
    }
    const owner = await preview({ sale_id: 111, refund_usd: 4, refund_khr: 16000, refund_currency: 'KHR' })
    assert.equal(owner.status, 200, JSON.stringify(owner.body))
    assert.deepEqual([owner.body.owed_reduction_usd, owner.body.payout_usd, owner.body.payout_khr], [4, 0, 0],
      'owner example: the screen says lowers debt $4, pay out nothing -- not 16,000 riel')
    const part = await preview({ sale_id: 112, refund_usd: 4, refund_khr: 16000, refund_currency: 'KHR' })
    assert.deepEqual([part.body.owed_reduction_usd, part.body.cash_refund_usd, part.body.payout_usd, part.body.payout_khr], [3, 1, 1, 4000])
    const noRiel = await preview({ sale_id: 112, refund_usd: 4, refund_khr: 0, refund_currency: 'KHR', any_line_without_riel: true })
    assert.equal(noRiel.body.payout_khr, 4000, 'no riel price: the riel paid out comes from the dollars, as POST records it')
    const swap = await preview({ sale_id: 112, refund_usd: 4, refund_khr: 16000, refund_currency: 'USD', replacement_usd: 4 })
    assert.deepEqual([swap.body.replacement_follows_debt, swap.body.replacement_paid_from_refund_usd, swap.body.replacement_owed_usd, swap.body.payout_usd],
      [true, 1, 3, 0])
    assert.equal((await preview({ sale_id: true, refund_usd: 4 })).status, 400)
    const beforePart = await drawer()
    const recorded = await post({ client_request_id: 'x-12', sale_id: 112, reason: 'riel', refund_currency: 'KHR',
      items: [{ sale_item_id: 1121, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1 }] })
    assert.equal(recorded.status, 200, JSON.stringify(recorded.body))
    const afterPart = await drawer()
    assert.equal((await db.prepare("SELECT owed_reduction_usd FROM returns WHERE client_request_id='x-12'").first()).owed_reduction_usd, part.body.owed_reduction_usd)
    assert.equal(beforePart.khr - afterPart.khr, part.body.payout_khr, 'the drawer pays out exactly the riel the screen showed')
    console.log('PASS the Return screen preview shows debt lowered and the real payout, and POST records exactly that')

    // -- verify R2 X6-X8 + drift: riel price 15,500 for a $4 line at rate 4,000 ----------
    for (const [n, replacementUsd, owesAfter, payoutKhr] of [[13, 4, 3, 0], [14, 0.5, 0, 1937]]) {
      const screen = await preview({ sale_id: 100 + n, refund_usd: 4, refund_khr: 15500, refund_currency: 'KHR', replacement_usd: replacementUsd })
      assert.equal(screen.status, 200, JSON.stringify(screen.body))
      assert.deepEqual([screen.body.replacement_owed_usd, screen.body.payout_khr], [owesAfter, payoutKhr], `screen for ${replacementUsd} out`)
      const done = await exchange(n, replacementUsd, { refund_currency: 'KHR' })
      assert.equal(done.replacementOwes, screen.body.replacement_owed_usd, `${replacementUsd} out: the replacement owes exactly what the screen said, no phantom cents`)
      assert.equal(done.replacementStatus, owesAfter > 0 ? 'awaiting_payment' : 'completed', 'a replacement the refund paid in full is Completed')
      assert.deepEqual([done.drawerUsd, 0 - done.drawerKhr], [0, screen.body.payout_khr], 'the drawer pays out exactly the riel the screen showed')
      assert.equal(done.originalOwes + done.replacementOwes, owesAfter, 'the original owes nothing more; only the replacement remainder is owed')
      // Verify R2 item 3: the recorded return names the part that paid the
      // replacement, and the detail's "Paid out" is what the drawer paid.
      const id = (await db.prepare('SELECT id FROM returns WHERE client_request_id=?').bind(`x-${n}`).first()).id
      const detail = await (await mf.dispatchFetch(`http://local/api/returns/${id}`)).json()
      assert.equal(detail.to_replacement_usd, screen.body.replacement_paid_from_refund_usd, 'the detail names what the refund paid toward the replacement')
      const listed = await (await mf.dispatchFetch('http://local/api/returns?limit=50')).json()
      const row = (Array.isArray(listed) ? listed : listed.returns || []).find((r) => Number(r.id) === Number(id))
      assert.ok(row, 'the Returns list carries the return')
      assert.deepEqual([row.to_replacement_usd, row.to_replacement_khr], [detail.to_replacement_usd, detail.to_replacement_khr], 'the list row the detail opens from carries the same figures')
      const shown = recordedRefundSplit(detail)
      assert.deepEqual([shown.payoutKhr, shown.toReplacementKhr > 0], [0 - done.drawerKhr, true], 'Paid out on the detail is the riel the drawer paid out; the rest is To replacement')
    }
    // verify R3 E4: the legacy 15,500-riel line keeps the refund's riel basis
    // (at the shop rate its riel would leave a cent owed); see the pure fuzz.
    const legacyRate = (await db.prepare("SELECT s.exchange_rate FROM sales s JOIN returns r ON r.replacement_sale_id=s.id WHERE r.client_request_id='x-13'").first()).exchange_rate
    assert.equal(legacyRate, 3875, 'the legacy riel line: 15,500 riel for $4 is 3,875 riel per dollar, not the shop rate')
    console.log('PASS a riel-funded replacement on a legacy riel price owes no phantom cents and the screen riel is the drawer riel')

    // -- verify R3 E1: the verifier's D1 repro on the real routes ------------------------
    // The drawer SQL reads 4700 * (1.2 - 0.99) / 1.2 = 822.4999... -> 822 riel out.
    // The retired screen arithmetic rounded the dollars first and read 823.
    {
      const screen = await preview({ sale_id: 115, refund_usd: 1.2, refund_khr: 4700, refund_currency: 'KHR', replacement_usd: 0.21 })
      assert.equal(screen.status, 200, JSON.stringify(screen.body))
      assert.deepEqual([screen.body.owed_reduction_usd, screen.body.payout_khr, screen.body.replacement_owed_usd], [0.99, 0, 0], 'the screen: $0.99 lowered, nothing paid out, nothing owed')
      const done = await exchange(15, 0.21, { refund_currency: 'KHR' })
      assert.deepEqual([done.drawerUsd, done.drawerKhr], [0, 0], 'the drawer nets 0: 822 riel out on the refund leg, 822 in on the replacement')
      assert.deepEqual([done.replacement.amount_paid_khr, done.replacementStatus, done.replacementOwes], [822, 'completed', 0])
      const id = (await db.prepare("SELECT id FROM returns WHERE client_request_id='x-15'").first()).id
      const shown = recordedRefundSplit(await (await mf.dispatchFetch(`http://local/api/returns/${id}`)).json())
      assert.deepEqual([shown.payoutKhr, shown.toReplacementKhr], [0, 822], 'the detail: Paid out 0 riel, To replacement 822 riel')
    }
    console.log('PASS verify R3 E1: the screen, the detail and the drawer read the same riel to the riel')

    // -- verify R3: an edit cannot take back refund cash its replacement was paid with --
    {
      const line = (quantity) => [{ sale_item_id: 1161, product_id: 1, quantity, stock_action: 'restock', branch_id: 1 }]
      const created = await post({ client_request_id: 'x-16', sale_id: 116, reason: 'exchange', items: line(2),
        replacement_items: [{ product_id: 2, quantity: 1, branch_id: 1, applied_price_usd: 5, applied_price_khr: 20000 }] })
      assert.equal(created.status, 200, JSON.stringify(created.body))
      const row = await db.prepare("SELECT id,updated_at,total_refund_usd,owed_reduction_usd FROM returns WHERE client_request_id='x-16'").first()
      assert.deepEqual([row.total_refund_usd, row.owed_reduction_usd], [8, 3], '$8 back: $3 lowers the debt, $5 cash pays the $5 replacement')
      const patch = async (body) => {
        const response = await mf.dispatchFetch(`http://local/api/returns/${row.id}`, { method: 'PATCH', headers, body: JSON.stringify(body) })
        return { status: response.status, body: await response.json() }
      }
      const shrink = await patch({ client_request_id: 'x-16-edit', expected_updated_at: row.updated_at, reason: 'one unit only', items: line(1) })
      assert.deepEqual([shrink.status, shrink.body.code], [409, 'return_edit_replacement_funded'], JSON.stringify(shrink.body))
      const after = await db.prepare('SELECT updated_at,total_refund_usd,owed_reduction_usd FROM returns WHERE id=?').bind(row.id).first()
      assert.deepEqual(after, { updated_at: row.updated_at, total_refund_usd: 8, owed_reduction_usd: 3 }, 'the refused edit wrote nothing')
      const keep = await patch({ client_request_id: 'x-16-keep', expected_updated_at: row.updated_at, reason: 'reason corrected', items: line(2) })
      assert.equal(keep.status, 200, `CONTROL: an edit that keeps the cash the replacement used goes through: ${JSON.stringify(keep.body)}`)
    }
    console.log('PASS an edit that would take back refund cash the replacement was paid with is refused; one that keeps it goes through')

    // -- P3 (verifier N3, N4, N8): loose input is refused, with a code -----------------
    const countReturns = async () => (await db.prepare('SELECT COUNT(*) AS n FROM returns').first()).n
    const recordedBefore = await countReturns()
    const line = (saleItemId) => [{ sale_item_id: saleItemId, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1 }]
    for (const [label, saleId] of [['true', true], ['[101]', [101]], ['{}', {}], ['"101x"', '101x']]) {
      const loose = await post({ client_request_id: `loose-sale-${label}`, sale_id: saleId, reason: 'loose', items: line(1011) })
      assert.deepEqual([loose.status, loose.body.code], [400, 'return_sale_required'], `sale_id ${label} is not a sale id (Number(true) is sale #1)`)
    }
    const looseV1 = await post({ client_request_id: 'loose-sale-v1', money_precision_version: 1, sale_id: true, reason: 'loose', items: line(1011) })
    assert.deepEqual([looseV1.status, looseV1.body.code], [400, 'return_sale_required'], 'the v1 shape refuses sale_id true with the same code')
    for (const [label, currency] of [["['khr']", ['khr']], ['{}', {}], ['1', 1]]) {
      const loose = await post({ client_request_id: `loose-currency-${label}`, sale_id: 111, reason: 'loose', refund_currency: currency, items: line(1111) })
      assert.equal(loose.status, 400, `refund_currency ${label} is not a currency: ${JSON.stringify(loose.body)}`)
      assert.equal((await preview({ sale_id: 111, refund_usd: 4, refund_currency: currency })).status, 400, `the preview refuses refund_currency ${label} too`)
    }
    const otherSaleLine = await post({ client_request_id: 'other-sale-line', sale_id: 111, reason: 'loose', items: line(1011) })
    assert.deepEqual([otherSaleLine.status, otherSaleLine.body.code], [400, 'return_line_not_on_sale'], 'a line from another sale is refused with its code')
    assert.equal(await countReturns(), recordedBefore, 'no loose request recorded anything')
    const lowerCase = await preview({ sale_id: 111, refund_usd: 4, refund_currency: ' khr ' })
    assert.deepEqual([lowerCase.status, lowerCase.body.refund_currency], [200, 'KHR'], 'control: a text code is still read case- and space-insensitively')
    console.log('PASS loose sale ids and currencies are refused; a line from another sale carries return_line_not_on_sale')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
