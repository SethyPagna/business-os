// CUTOVER-LD: after the branch consolidation (Shop -> "Old Shop", Warehouse -> "LC Store") OLD RECORDS ARE NEVER
// RELABELLED. Every test below writes a record, THEN renames/retires the branch, THEN reads:
//   historical surfaces (a fee, a return summary, a sale line, a received lot, a stock-in invoice) must still show
//   the name AT THE TIME; live/operational surfaces (stock on hand by branch) must show the new name; and a row whose
//   snapshot is blank falls back to the live name (it is a fallback, not the rule).
// Also pins: the History list hides the closed consolidation entries (undo_closed:branch_cutover_move) but
// `include_cutover=1` lists them; the Undo/Redo 409 path answers both markers with their codes; the transfer list
// hides the ~3,400 consolidation transfers behind `includeCutover=1`; stock-session Undo still works for a
// postimage captured before the display-only label columns existed; and every inlined copy of the
// snapshot-first expression is byte-identical to the canonical one.
//
// Run (from cloudflare/): node scripts/test-cutover-ld-historical-readers-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const admin = { id: 7, name: 'Operator', username: 'operator', organization_id: null, role_id: null, role_code: 'admin', is_active: 1,
  permissions: JSON.stringify({ all: true }) }
function load(entry, overrides = {}) {
  const cache = new Map()
  function read(file) {
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }
    cache.set(file, mod)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText
    new Function('require', 'module', 'exports', output)((id) => {
      const name = id.split('/').at(-1)
      if (Object.hasOwn(overrides, name)) return overrides[name]
      if (name === 'cache') return { bumpVersion: async () => {}, getVersionWithFallback: async () => '0', getVersion: async () => '0', versionedKey: async (_kv, ns, suffix) => `${ns}:${suffix}`, getJson: async () => null, setJson: async () => {}, getOrSetJson: async (_kv, _key, _ttl, producer) => producer(), cachedJsonResponse: async (_request, _ctx, _version, _ttl, producer) => producer() }
      if (name === 'broadcastHub') return { broadcast: async () => {} }
      return id.startsWith('.') ? read(path.resolve(path.dirname(file), `${id}.ts`)) : require(id)
    }, mod, mod.exports)
    return mod.exports
  }
  return read(path.join(root, 'src', entry))
}
const auth = { requireAuth: async (c, next) => { c.set('user', admin); return next() } }

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.limits.exprDepth = 100
  sql.limits.variableNumber = 100
  sql.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(`
    INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Warehouse',0,1);
    INSERT INTO products(id,name,barcode,cost_price_usd,stock_quantity,is_active) VALUES(1,'Serum','SER-1',2,0,1);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0);
  `)
  const statement = (text, values = []) => {
    const prepared = sql.prepare(text)
    const args = Array.isArray(values) ? values : [values]
    return {
      text, values,
      async first() { return prepared.get(...args) || null },
      async all() { return { results: prepared.all(...args) } },
      async run() { const result = prepared.run(...args); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } },
    }
  }
  const DB = {
    prepare(text) { return { bind: (...values) => statement(text, values), ...statement(text) } },
    async batch(statements) {
      sql.exec('BEGIN')
      try {
        const results = []
        for (const item of statements) results.push(await item.run())
        sql.exec('COMMIT')
        return results
      } catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  return { sql, env: { DB } }
}
const session = load('lib/stockSession.ts')
const { getDb } = load('lib/db.ts')
const ctx = { waitUntil() {}, passThroughOnException() {} }
const receive = (key = 'ld-receive-001') => ({ client_request_id: key, mode: 'stock_in',
  defaults: { branch_id: 1, received_date: '2026-09-05', supplier_name: 'Supplier' },
  items: [{ line_id: 'receive-1', kind: 'receive', product_id: 1, quantity: 5, unit_cost_usd: 2 }] })
// The cutover, as far as readers can tell: Shop is retired and renamed, Warehouse takes the successor name.
const retireShop = (f) => f.sql.exec("UPDATE branches SET name='Old Shop', is_active=0, is_default=0 WHERE id=1; UPDATE branches SET name='LC Store', is_default=1 WHERE id=2")
async function json(app, url, env, init) {
  const response = await app.request(url, init || {}, env, ctx)
  assert.equal(response.status, 200, `${url} -> ${response.status} ${await response.clone().text()}`)
  return response.json()
}

const failures = []
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`) }
}

async function main() {
  await check('a stock-in receipt stamps the lot label, and the stock-in invoice report keeps it after the rename', async () => {
    const f = fixture()
    await session.commitStockSession(f.env, admin, receive())
    assert.equal(f.sql.prepare('SELECT received_branch_name FROM product_batches').get().received_branch_name, 'Shop', 'writer stamps the label with the id')
    retireShop(f)
    const app = load('routes/contacts.ts', { auth }).default
    const groups = await json(app, '/suppliers/reports/stock-in-invoices', f.env)
    assert.equal(groups.invoices.length, 1)
    assert.deepEqual(groups.invoices[0].branch_labels, [{ id: 1, name: 'Shop' }], 'historical: the name at the time')
    assert.equal(groups.invoices[0].branch_ids, '1')
    // The Branch filter still lists the retired branch (flagged), so the old invoice stays reachable through it.
    const retired = groups.meta.branches.find((b) => b.id === 1)
    assert.ok(retired, 'the retired branch is a filter option')
    assert.equal(Number(retired.is_active), 0)
    assert.deepEqual(groups.meta.branches.map((b) => Number(b.is_active)), [...groups.meta.branches.map((b) => Number(b.is_active))].sort((a, b) => b - a), 'live branches first')
    const filtered = await json(app, '/suppliers/reports/stock-in-invoices?branch_id=1', f.env)
    assert.equal(filtered.invoices.length, 1, 'filtering by the retired branch finds its invoice')
    assert.equal(Object.hasOwn(groups.invoices[0], 'branch_labels'), true)
    const lines = await json(app, `/suppliers/reports/stock-in-invoice-lines?supplier_key=${encodeURIComponent(groups.invoices[0].supplier_key)}&day=2026-09-05`, f.env)
    assert.equal(lines.lines.length, 1)
    assert.equal(lines.lines[0].received_branch_name, 'Shop')
    // Fallback, not the rule: a lot whose snapshot is blank (older than the label column) reads the live name.
    for (const blank of [null, '', ' ', ' ﻿　']) {
      f.sql.prepare('UPDATE product_batches SET received_branch_name=?').run(blank)
      const again = await json(app, `/suppliers/reports/stock-in-invoice-lines?supplier_key=${encodeURIComponent(groups.invoices[0].supplier_key)}&day=2026-09-05`, f.env)
      assert.equal(again.lines[0].received_branch_name, 'Old Shop')
      const regroup = await json(app, '/suppliers/reports/stock-in-invoices', f.env)
      assert.deepEqual(regroup.invoices[0].branch_labels, [{ id: 1, name: 'Old Shop' }])
    }
    f.sql.close()
  })

  await check('the catalog cost breakdown lot list keeps the received-at label; blank falls back to the live name', async () => {
    const f = fixture()
    await session.commitStockSession(f.env, admin, receive())
    retireShop(f)
    const recompute = load('lib/catalogCostRecompute.ts')
    const breakdown = await recompute.getCatalogCostBreakdown(getDb(f.env), 1)
    assert.equal(breakdown.inputs.length, 1)
    assert.match(breakdown.inputs[0].label, / . Shop$/, JSON.stringify(breakdown.inputs))
    f.sql.exec('UPDATE product_batches SET received_branch_name=NULL')
    const blank = await recompute.getCatalogCostBreakdown(getDb(f.env), 1)
    assert.match(blank.inputs[0].label, / . Old Shop$/, 'blank snapshot: the live name fills in')
    f.sql.close()
  })

  await check('live/operational control: the tagged-lot (damaged stock) groups show the CURRENT branch name', async () => {
    const f = fixture()
    f.sql.exec(`INSERT INTO damaged_stock_lots(product_id,product_name,branch_id,quantity_remaining,condition_tag,unit_cost_usd) VALUES(1,'Serum',2,3,'damaged',1)`)
    f.sql.exec("UPDATE branches SET name='LC Store' WHERE id=2")
    const lots = load('lib/damagedLotActions.ts')
    const groups = await lots.readTaggedLotGroups(getDb(f.env), [1])
    assert.equal(groups.length, 1)
    assert.equal(groups[0].branch_name, 'LC Store', 'where the stock is NOW is a live fact')
    f.sql.close()
  })

  await check('a sale line keeps the sale\'s branch label after the rename; another-branch line and blank snapshots read live', async () => {
    const f = fixture()
    f.sql.exec(`
      INSERT INTO sales(id,receipt_number,branch_id,branch_name,total_usd,sale_status,created_at,updated_at) VALUES(1,'R-1',1,'Shop',5,'paid','2026-09-05 03:00:00','2026-09-05 03:00:00');
      INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,total_usd) VALUES(1,1,1,'Serum',1,1,5),(2,1,1,'Serum',1,2,5);`)
    retireShop(f)
    const app = load('routes/sales.ts', { auth }).default
    const body = await json(app, '/?limit=10', f.env)
    const sale = (body.sales || body.items || body.data || body)[0] || (Array.isArray(body) ? body[0] : null)
    assert.ok(sale, JSON.stringify(body).slice(0, 300))
    assert.equal(sale.branch_name, 'Shop')
    const lines = sale.items
    assert.equal(lines.find(line => line.id === 1).branch_name, 'Shop', 'the line recorded at the sale branch reads the sale\'s own label')
    assert.equal(lines.find(line => line.id === 2).branch_name, 'LC Store', 'a line at a different branch has no snapshot: live name')
    f.sql.exec("UPDATE sales SET branch_name=NULL WHERE id=1")
    const blank = await json(app, '/?limit=10', f.env)
    const blankSale = (blank.sales || blank.items || blank.data || blank)[0]
    assert.equal(blankSale.items.find(line => line.id === 1).branch_name, 'Old Shop')
    f.sql.close()
  })

  await check('the History list hides the closed consolidation entries; include_cutover=1 lists them; 409 for both markers', async () => {
    const f = fixture()
    const insert = f.sql.prepare(`INSERT INTO action_history(scope,entity,entity_id,label,status,reversible,undo_payload,redo_payload,created_by_id,last_error,updated_at)
      VALUES('branches','stock_transfer',?,?,?,?,'{}','{}',7,?,?)`)
    insert.run('t1', 'Real transfer', 'undoable', 1, null, '2026-10-06 01:00:00')
    for (let i = 0; i < 30; i += 1) insert.run(`c${i}`, `Move ${i}`, 'recorded', 0, 'undo_closed:branch_cutover_move', `2026-10-06 02:00:${String(i).padStart(2, '0')}`)
    insert.run('r1', 'Closed at Shop', 'recorded', 0, 'undo_closed:branch_retired', '2026-10-06 00:30:00')
    const app = load('routes/actionHistory.ts', { auth }).default
    const list = await json(app, '/?scope=branches&limit=20&all=1', f.env)
    const labels = list.items.map(item => item.label)
    assert.deepEqual(labels, ['Real transfer', 'Closed at Shop'], 'newest-20 window is not buried by 30 closed moves')
    const all = await json(app, '/?scope=branches&limit=20&all=1&include_cutover=1', f.env)
    assert.equal(all.items.length, 20)
    assert.ok(all.items.every(item => item.label.startsWith('Move ')), 'reachable through the filter')
    const ids = f.sql.prepare("SELECT id,last_error FROM action_history WHERE last_error IS NOT NULL ORDER BY id").all()
    const moveId = ids.find(row => row.last_error === 'undo_closed:branch_cutover_move').id
    const retiredId = ids.find(row => row.last_error === 'undo_closed:branch_retired').id
    for (const direction of ['undo', 'redo']) {
      const move = await app.request(`/${moveId}/${direction}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, f.env, ctx)
      assert.equal(move.status, 409)
      const moveBody = await move.json()
      assert.equal(moveBody.code, 'undo_closed_branch_cutover_move')
      assert.match(moveBody.error, /branch consolidation/)
      const retired = await app.request(`/${retiredId}/${direction}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, f.env, ctx)
      assert.equal(retired.status, 409)
      assert.equal((await retired.json()).code, 'undo_closed_branch_retired')
    }
    // An ordinary recorded-only row is still the plain 400, not a closure code.
    insert.run('p1', 'Plain recorded', 'recorded', 0, null, '2026-10-06 03:00:00')
    const plainId = f.sql.prepare("SELECT id FROM action_history WHERE label='Plain recorded'").get().id
    assert.equal((await app.request(`/${plainId}/undo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, f.env, ctx)).status, 400)
    f.sql.close()
  })

  await check('the transfer list hides the closed consolidation transfers behind includeCutover=1', async () => {
    const f = fixture()
    f.sql.exec(`
      INSERT INTO action_history(id,scope,entity,entity_id,label,status,reversible,undo_payload,redo_payload,created_by_id,last_error) VALUES
        (101,'branches','stock_transfer','a','Real','undoable',1,'{}','{}',7,NULL),
        (102,'branches','stock_transfer','b','Move','recorded',0,'{}','{}',7,'undo_closed:branch_cutover_move');
      INSERT INTO transfer_operation_receipts(id,actor_id,request_id,request_digest,request_json,status,operation_id,provenance_version,replay_state,generation,action_history_id)
        VALUES(1,7,'req-real','d1','{}','committed','op-real',1,'applied',0,101),(2,7,'bc_op_1','d2','{}','committed','op-move',1,'applied',0,102);
      INSERT INTO stock_transfers(id,product_id,product_name,from_branch_id,to_branch_id,from_branch_name,to_branch_name,quantity,receipt_id,created_at) VALUES
        (1,1,'Serum',1,2,'Shop','Warehouse',1,1,'2026-10-06 01:00:00'),(2,1,'Serum',1,2,'Shop','Warehouse',4,2,'2026-10-06 02:00:00'),
        (3,1,'Serum',2,1,'Warehouse','Shop',2,NULL,'2026-10-05 02:00:00');`)
    retireShop(f)
    const app = load('routes/compat.ts', { auth, reports: { gateTotals: () => { throw new Error('unrelated') } } }).default
    for (const paged of [true, false]) {
      const base = paged ? '/transfers?page=1&pageSize=20' : '/transfers'
      const read = async (extra) => { const body = await json(app, base + extra, f.env); return paged ? body.items : body }
      assert.deepEqual((await read('')).map(row => row.id).sort(), [1, 3], 'default: the move row (id 2) is hidden; a legacy row with no receipt stays')
      assert.deepEqual((await read(paged ? '&includeCutover=1' : '?includeCutover=1')).map(row => row.id).sort(), [1, 2, 3])
      const rows = await read(paged ? '&includeCutover=1' : '?includeCutover=1')
      assert.equal(rows.find(row => row.id === 2).from_name, 'Shop', 'and they still say Shop -> Warehouse, never Old Shop -> LC Store')
    }
    f.sql.close()
  })

  await check('Undo of a stock session captured BEFORE the display-only label columns still works (older postimage)', async () => {
    const f = fixture()
    const result = await session.commitStockSession(f.env, admin, receive('ld-replay-001'))
    const snap = JSON.parse(f.sql.prepare('SELECT payload_json FROM undo_snapshots').get().payload_json)
    assert.equal(Object.hasOwn(snap.expected.batches[0], 'received_branch_name'), false, 'new postimages do not carry the display-only label')
    assert.equal(Object.hasOwn(snap.expected.movements[0], 'addressed_branch_name'), false)
    // A postimage captured by a Worker that predates the columns carries neither key (json_remove keeps every
    // number's text, so only the keys differ); it must still match the state read now.
    f.sql.exec(`UPDATE undo_snapshots SET payload_json=json_remove(payload_json,
      '$.after.batches[0].received_branch_name','$.expected.batches[0].received_branch_name',
      '$.after.movements[0].addressed_branch_name','$.expected.movements[0].addressed_branch_name')`)
    const history = f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(result.actionHistoryId)
    await session.replayStockSession(f.env, admin, 'undo', result.actionHistoryId, 0, JSON.parse(history.undo_payload))
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 0)
    f.sql.close()
  })

  await check('the closure markers, codes and messages restated in undoAppliers equal lib/branchCutoverHistory.ts and agree with its predicate', async () => {
    const history = load('lib/branchCutoverHistory.ts')
    const refusal = load('lib/undoAppliers.ts').branchCutoverClosureRefusal
    const expected = [
      [history.UNDO_CLOSED_BRANCH_RETIRED, history.UNDO_CLOSED_BRANCH_RETIRED_CODE, history.UNDO_CLOSED_BRANCH_RETIRED_MESSAGE],
      [history.UNDO_CLOSED_BRANCH_CUTOVER_MOVE, history.UNDO_CLOSED_BRANCH_CUTOVER_MOVE_CODE, history.UNDO_CLOSED_BRANCH_CUTOVER_MOVE_MESSAGE],
    ]
    for (const [marker, code, message] of expected) {
      assert.deepEqual(refusal({ reversible: 0, last_error: marker }), { code, message }, marker)
      assert.equal(refusal({ reversible: 1, last_error: marker }), null, 'a still-reversible row is not closed')
      assert.equal(Boolean(refusal({ reversible: 0, last_error: marker })), history.isUndoClosedByBranchCutover({ reversible: 0, last_error: marker }))
    }
    for (const last_error of [null, '', 'undo_closed:products_merged', 'undo_closed:branch_other', 'constructor', '__proto__']) {
      assert.equal(refusal({ reversible: 0, last_error }), null, String(last_error))
      assert.equal(history.isUndoClosedByBranchCutover({ reversible: 0, last_error }), false)
    }
    assert.equal(refusal(null), null)
  })

  await check('every inlined copy of the snapshot-first expression is byte-identical to the canonical one', async () => {
    const canonical = load('lib/stockInSessionsQuery.ts').branchHistoryNameSql('S', 'F')
    for (const file of ['routes/fees.ts', 'routes/reports.ts', 'routes/contacts.ts', 'routes/sales.ts', 'lib/telegram.ts', 'lib/catalogCostRecompute.ts']) {
      const source = fs.readFileSync(path.join(root, 'src', file), 'utf8')
      const match = /const branchHistoryNameSql = \(snapshot: string, fallback: string\): string =>\r?\n\s*`([^`]*)`/.exec(source)
      assert.ok(match, `${file} has the inlined expression`)
      const rendered = match[1].replace(/\$\{snapshot\}/g, 'S').replace(/\$\{fallback\}/g, 'F')
      assert.equal(rendered, canonical, file)
    }
    for (const file of ['routes/compat.ts', 'routes/actionHistory.ts']) {
      const literal = /const CUTOVER_MOVE_MARKER = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'src', file), 'utf8'))
      assert.ok(literal, `${file} names the marker`)
      assert.equal(literal[1], load('lib/branchCutoverHistory.ts').UNDO_CLOSED_BRANCH_CUTOVER_MOVE, `${file}: the inlined marker equals the constant`)
    }
  })
}
main().then(() => {
  if (failures.length) { console.error(`${failures.length} failed: ${failures.join('; ')}`); process.exit(1) }
  console.log('cutover LD historical readers: all checks passed')
}).catch((error) => { console.error(error); process.exit(1) })
