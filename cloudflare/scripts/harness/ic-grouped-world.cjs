'use strict'
// Seeded random Inventory Check worlds on node:sqlite (real migrations 1..242, 0259, 0285) for the grouped-list tests. Fixtures are synthetic.
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { buildSync, build } = require('esbuild')
const { loadAll } = require('./load_migrations.cjs')

const bundle = file => {
  const code = buildSync({ entryPoints: [path.join(__dirname, '../../src/lib', file)], bundle: true, platform: 'node', format: 'cjs', write: false, target: 'es2022', external: ['cloudflare:*'] }).outputFiles[0].text
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', code)(require, loaded, loaded.exports)
  return loaded.exports
}
// A copy of the library with source edits (a planted defect): edits maps a file name under src/lib to [from, to] pairs, each of which must match exactly once.
const bundleMutated = async (file, edits) => {
  const plugin = { name: 'mutate', setup(build) {
    build.onLoad({ filter: /.ts$/ }, args => {
      const name = path.basename(args.path)
      const text = fs.readFileSync(args.path, 'utf8').split('\r\n').join('\n')
      if (!edits[name]) return { contents: text, loader: 'ts' }
      let out = text
      for (const [from, to] of edits[name]) { if (out.split(from).length !== 2) throw new Error(`mutant edit must match once in ${name}: ${from.slice(0, 60)}`); out = out.replace(from, () => to) }
      return { contents: out, loader: 'ts' }
    }) } }
  const code = (await build({ entryPoints: [path.join(__dirname, '../../src/lib', file)], bundle: true, platform: 'node', format: 'cjs', write: false, target: 'es2022', external: ['cloudflare:*'], plugins: [plugin], logLevel: 'error' })).outputFiles[0].text
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', code)(require, loaded, loaded.exports)
  return loaded.exports
}
const lcg = seed => { let s = seed >>> 0; return n => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return Math.floor((s / 4294967296) * n) } }

// The instants a check can carry: ties, the 16:59:59.999Z / 17:00:00.000Z business-day boundary, and one space-separated text.
const INSTANTS = ['2026-11-01T03:00:00.000Z', '2026-11-01T16:59:59.999Z', '2026-11-01T17:00:00.000Z', '2026-11-02T09:30:00.000Z', '2026-11-02T09:30:00.000Z', '2026-11-05T01:00:00.000Z',
  '2026-11-05T23:59:59.999Z', '2026-11-09T12:00:00.000Z', '2026-11-14 08:00:00', '2026-10-30T10:00:00.000Z']
const NAMES = ['Serum', 'serum', 'Cream', 'Toner', 'Mist', 'Soap', 'Balm', 'Gel', 'Lotion', 'Oil', 'Powder', 'Wash', 'Mask', 'Scrub', 'ក្រែម']
const CATEGORIES = ['Skin', 'skin', ' Skin ', 'Hair', 'hair', '', null, 'Body', 'ក្រែម', 'Zed']

function buildWorld(seed, { branches = 2 } = {}) {
  const rnd = lcg(seed)
  const db = new DatabaseSync(':memory:')
  for (const sql of loadAll({ through: 242 })) db.exec(sql)
  for (const file of ['0259_inventory_check_sessions.sql', '0285_inventory_check_items_latest.sql']) db.exec(fs.readFileSync(path.join(__dirname, '../../migrations', file), 'utf8'))
  db.exec(`INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'One',1),(2,'Two',1),(3,'Closed',0);
    INSERT OR IGNORE INTO users(id,username,name,password,organization_id) VALUES(1,'a1','A1','x',1),(2,'a2','A2','x',1)`)
  const add = db.prepare('INSERT INTO products(id,name,stock_quantity,parent_id,is_group,brand,brands,category,categories,unit,is_active) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  const stock = db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)')
  const leaves = []
  let id = 100
  const leaf = (name, parent, active = 1, qty = null) => {
    const cat = CATEGORIES[rnd(CATEGORIES.length)]
    const q = qty ?? rnd(12)
    add.run(id, name, q, parent, 0, 'B', 'B', cat, cat, 'pcs', active)
    if (active) stock.run(id, 1, q)
    if (active && rnd(2) && branches > 1) stock.run(id, 2, rnd(9))
    leaves.push(id++)
  }
  const families = 8 + rnd(6)
  for (let f = 0; f < families; f++) for (let r = 0, n = 1 + rnd(3); r < n; r++) leaf(NAMES[rnd(NAMES.length)] + (rnd(3) === 0 ? '' : ' ' + f), null)
  for (let h = 0; h < 2; h++) {
    add.run(id, `Header ${h}`, 0, null, 1, 'B', 'B', null, null, 'pcs', 1); const header = id++
    for (let c = 0, n = 2 + rnd(2); c < n; c++) leaf(`Child ${h}-${c}`, header)
  }
  // Blank names tie on the empty family name; ids 998-1000 make the key order ('id:1000' < 'id:998') differ from the scan order.
  id = 998
  for (let b = 0; b < 3; b++) leaf('  ', null)
  leaf('Inactive empty', null, 0, 0)
  // Sessions: organizations 1, 2 and NULL, branches 1 and 2, open and closed.
  const sessions = []
  const insertSession = db.prepare('INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(?,?,?,?,?,?,0,?,?,?,?)')
  for (let s = 0; s < 10; s++) {
    const org = [1, 1, 1, 2, null][rnd(5)], branch = 1 + rnd(2), status = rnd(3) === 0 ? 'closed' : 'open'
    insertSession.run(`s${String(s).padStart(2, '0')}`, org, branch, 1, `Count ${s}`, status, '{}', '2026-10-19T01:00:00.000Z', '2026-10-20T01:00:00.000Z', status === 'closed' ? '2026-10-20T01:00:00.000Z' : null)
    sessions.push({ id: `s${String(s).padStart(2, '0')}`, org, branch })
  }
  const insertItem = db.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,updated_by,updated_at) VALUES(?,?,?,'{}',5,'{}',?,?,?,?,?)")
  const used = new Set()
  for (const session of sessions) for (const product of leaves) {
    if (rnd(100) >= 38) continue
    const mismatch = rnd(12) === 0, branch = mismatch ? 3 - session.branch : session.branch
    const key = `${session.id}:${product}:${branch}`
    if (used.has(key)) continue
    used.add(key)
    const state = ['unstarted', 'done', 'done', 'issue'][rnd(4)]
    insertItem.run(session.id, product, branch, state, state === 'unstarted' ? null : rnd(10), state === 'issue' ? 'short' : null, 2, state === 'unstarted' && rnd(2) ? null : INSTANTS[rnd(INSTANTS.length)])
  }
  return { db, leaves, sessions }
}
const adapter = db => ({ calls: 0, sql: [], async batch(statements) {
  this.calls++; this.sql.push(...statements.map(statement => statement.sql))
  db.exec('PRAGMA query_only=ON'); db.exec('BEGIN')
  try {
    const results = statements.map(({ sql, params = {} }) => { const prepared = db.prepare(sql); prepared.setAllowUnknownNamedParameters(true); return { success: true, results: prepared.all(params) } })
    db.exec('COMMIT'); return results
  } catch (error) { db.exec('ROLLBACK'); throw error } finally { db.exec('PRAGMA query_only=OFF') }
} })
module.exports = { bundle, bundleMutated, buildWorld, adapter, lcg }
