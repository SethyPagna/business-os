// INV-A S8: products_parent_seek (default OFF). The default seek-page statement looks a family's child rows up with parent_id IN (SELECT ...), which the planner answers by scanning the whole
// idx_products_parent_pg index once ANALYZE statistics exist (every product has a NULL parent_id). ON, the same four candidate sets are spelled as index seeks (INDEXED BY). Same rows, so the gate is byte
// parity: every products/search shape answers the same bytes ON as OFF (alone, and together with catalog_ranked_scope), and the statement text is the old text OFF and the seek spelling ON.
//
// Run: node scripts/test-products-parent-seek-native.cjs
const assert = require('node:assert/strict')
const { createInvApp } = require('./harness/inv-app.cjs')

let checks = 0
function check(label, cond) { assert.ok(cond, `FAIL: ${label}`); checks++; console.log(`  ok  ${label}`) }

const utc = (offsetSeconds) => new Date(Date.now() + offsetSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
const NAMES = ['Powder Foundation', 'Powder Brush', 'Powder Puff', 'Rose Serum', 'Aloe Gel', 'Aloe Toner', 'Berry Balm', 'Cocoa Butter', 'Dew Mist', 'Eye Pencil', 'Face Wash', 'Gloss Pink',
  'Hair Oil', 'Ink Liner', 'Jade Roller', 'Kohl Black', 'Lip Tint', 'Mascara Long', 'Nail Polish', 'Oat Scrub', 'Primer Silk', 'Quartz Comb', 'Rouge Pot', 'Soap Bar', 'Tonic Water']
const BRANDS = ['Alpha', 'Beta', 'Gamma']
const CATEGORIES = ['Face', 'Lip', 'Hair', 'Eye']

const app = createInvApp({
  mount: {
    '/api/products': 'routes/products.ts',
    '/api/inventory-checks': 'routes/inventoryChecks.ts',
  },
  seed(raw, seedStockFixture) {
    seedStockFixture(raw.db, () => {
      NAMES.forEach((name, index) => {
        const id = 100 + index
        const stock = index % 5 === 0 ? 0 : index % 5 === 1 ? 2 : 9
        // created_at is deliberately tied in places, so the order tie-breaks are exercised
        const created = `2026-09-${String(1 + (index % 7)).padStart(2, '0')} 08:00:00`
        raw.prepare(`INSERT INTO products(id,name,sku,barcode,brand,category,stock_quantity,low_stock_threshold,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,3,9.5,38000,4,16000,1,?,?)`).run([id, name, `SKU${id}`, `88500000${id}`, BRANDS[index % 3], CATEGORIES[index % 4], stock, created, created])
        raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').run([id, stock])
      })
      // Child rows and a blank-named root: the candidate sets a page reads by key are the rows of the name_key, the children of those rows, a blank-named 'id:N' root and its children.
      for (const [id, name, parent] of [[150, '', null], [151, 'Blank Child', 150], [152, 'Aloe Child', 104], [153, 'Powder Child', 100], [99, '', null], [155, '', null]]) {
        raw.prepare(`INSERT INTO products(id,name,sku,barcode,brand,category,stock_quantity,low_stock_threshold,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,parent_id,created_at,updated_at)
          VALUES(?,?,?,?,'Alpha','Face',4,3,5,20000,2,8000,1,?,'2026-09-05 08:00:00','2026-09-05 08:00:00')`).run([id, name, `SKU${id}`, `88500000${id}`, parent])
      }
      // a product-level discount that is live now, and one with a rule behind it
      raw.prepare("UPDATE products SET discount_enabled=1, discount_type='percent', discount_percent=10 WHERE id IN (104, 111)").run()
      // Inventory Check: one open session with one issue (the latest state of product 101 is issue)
      raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES('sA',NULL,1," + 72 + ",'Count','open','{}','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z')").run()
      raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES('sA',101,1,'{}',2,'{}','issue',1,'Short',1,72,'2026-11-01T02:00:00.000Z')").run()
      raw.prepare("INSERT INTO promotion_rules(title,rule_type,percent_off,scope_type,product_ids,is_active) VALUES('Brush day','percent_off',15,'products','[101,120]',1)").run()
    })
  },
})

const INCLUDE = 'include=branch_stock,images,batches'
const url = (extra) => `/api/products/search?${extra}&${INCLUDE}`
// The candidate sets exactly as the statement has always spelled them (switch OFF must not change a character of them, whitespace aside).
const OLD_CANDIDATES = [
  'SELECT id FROM products WHERE name_key IN (SELECT family_root_id FROM page_families)',
  'UNION SELECT id FROM products WHERE parent_id IN (SELECT id FROM products WHERE name_key IN (SELECT family_root_id FROM page_families))',
  "UNION SELECT CAST(substr(family_root_id, 4) AS INTEGER) FROM page_families WHERE substr(family_root_id, 1, 3) = 'id:'",
  "UNION SELECT id FROM products WHERE parent_id IN (SELECT CAST(substr(family_root_id, 4) AS INTEGER) FROM page_families WHERE substr(family_root_id, 1, 3) = 'id:')",
].join(' ')
const squash = (sql) => sql.split(/[ \t\r\n]+/).join(String.fromCharCode(32))
const pageStatements = (mark) => app.since(mark).filter((sql) => /page_candidates AS MATERIALIZED/.test(sql))
async function read(seek, ranked, shape) {
  app.setSwitch('products_parent_seek', seek ? 'on' : 'off')
  app.setSwitch('catalog_ranked_scope', ranked ? 'on' : 'off')
  app.clearCaches()
  const mark = app.mark()
  const response = await app.get(shape)
  return { response, statements: pageStatements(mark) }
}

;(async () => {
  const SHAPES = [
    'page=1&pageSize=10&sort=created_desc', 'page=2&pageSize=10&sort=created_desc', 'page=3&pageSize=10&sort=created_desc', 'page=4&pageSize=10&sort=created_desc',
    'page=1&pageSize=7&sort=name_asc', 'page=3&pageSize=7&sort=name_asc', 'page=2&pageSize=7&sort=name_desc', 'page=1&pageSize=25&sort=created_asc',
    'page=1&pageSize=50&sort=name_asc', 'page=9&pageSize=10&sort=name_asc', 'page=1&pageSize=10&sort=name_asc&brand=Alpha', 'page=2&pageSize=4&sort=name_asc&category=Face',
    'page=1&pageSize=10&sort=name_asc&query=powder', 'page=1&pageSize=10&sort=name_asc&query=aloe', 'page=1&pageSize=10&query=88500000105', 'page=1&pageSize=10&sort=name_asc&query=zzzz',
    'page=1&pageSize=10&sort=name_asc&stockState=out', 'page=1&pageSize=10&sort=name_asc&stockState=low', 'page=1&pageSize=10&sort=name_asc&stockState=in',
    'page=1&pageSize=10&sort=name_asc&stockState=low&branchId=1', 'page=1&pageSize=10&sort=name_asc&branchId=2', 'page=1&pageSize=10&sort=name_asc&promo=promoted',
    'page=1&pageSize=10&sort=name_asc&promo=discounted', 'page=1&pageSize=10&sort=name_asc&promo=rules', 'page=1&pageSize=10&sort=name_asc&ids=100,103,110,124',
    'page=1&pageSize=5&sort=name_asc&ids=100', 'page=1&pageSize=10&sort=name_asc&surface=pos', 'page=2&pageSize=6&sort=created_desc&surface=pos',
  ]
  for (const shape of SHAPES) {
    const off = await read(false, false, url(shape))
    const on = await read(true, false, url(shape))
    const both = await read(true, true, url(shape))
    check(`parity ${shape}: ON answers the same bytes as OFF`, off.response.status === 200 && on.response.text === off.response.text)
    check(`parity ${shape}: with the ranked scope too`, both.response.text === off.response.text)
    if (off.statements.length) {
      check(`${shape}: OFF carries the old candidate text exactly`, off.statements.every((sql) => squash(sql).includes(`page_candidates AS MATERIALIZED ( ${OLD_CANDIDATES} )`)))
      check(`${shape}: OFF keeps the old child lookup text, ON seeks the index`, off.statements.every((sql) => !/INDEXED BY/.test(sql) && /parent_id IN \(SELECT id FROM products WHERE name_key IN/.test(sql))
        && on.statements.every((sql) => /INDEXED BY idx_products_parent_pg/.test(sql) && !/parent_id IN \(SELECT id FROM products/.test(sql)))
    }
  }
  // the control that proves the comparison can fail: the fixture has child rows and blank-named roots, and a page carries them
  const sample = (await read(true, false, url('page=1&pageSize=10&sort=name_asc'))).response.json
  check('control: pages carry the child rows and the blank-named roots', sample.items.some((row) => row.parent_id) && sample.items.some((row) => row.name === ''))
  console.log(`
${checks} checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
