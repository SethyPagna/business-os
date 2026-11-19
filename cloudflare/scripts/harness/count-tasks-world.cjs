'use strict'
// ctprop: the world for the count-tasks property test (inv-app harness, plus the Set, batch and Undo routes).
const { createInvApp, person } = require('./inv-app.cjs')
const COUNTER = { inventory_checks: true, inventory_checks_check: true, inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_received: true }
const USERS = {
  admin: person(71, 'admin', { all: true }),
  manager: person(90, 'manager', { ...COUNTER, inventory: true, products: true, inventory_check_issue: true }),
  emp1: person(91, 'employee', { ...COUNTER }),
  emp2: person(92, 'employee', { ...COUNTER }),
  adminB: person(93, 'admin', { all: true }, 2),
  empB: person(94, 'employee', { ...COUNTER }, 2),
}
const PLAIN = Array.from({ length: 16 }, (_, i) => 100 + i) // 100..115, no received dates
const LOTTED = [130, 131, 132, 133] // two received dates each at both branches
const FAMILY = { header: 200, children: [201, 202] }
const INACTIVE = [140, 141]
const batchesOf = (p) => [p * 10 + 1, p * 10 + 2] // 1301,1302 ...
function buildWorld(sourceEdits = {}) {
  const app = createInvApp({
    users: JSON.parse(JSON.stringify(USERS)), sourceEdits, // each world gets its own users: a scenario that edits permissions never leaks into the next
    mount: {
      '/api/products': 'routes/products.ts', '/api/inventory-checks/products': 'routes/inventoryCheckProducts.ts', '/api/inventory-checks': 'routes/inventoryChecks.ts',
      '/api/inventory': 'routes/inventory.ts', '/api/batches': 'routes/batches.ts', '/api/action-history': 'routes/actionHistory.ts',
    },
    seed(raw, seedStockFixture) {
      seedStockFixture(raw.db, () => {
        const add = (id, name, brand, { group = 0, active = 1, qty = 10 } = {}) => {
          raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,is_group,created_at,updated_at)
            VALUES(?,?,?,?,?,9.5,38000,4,16000,?,?,?,?,'2026-09-01 00:00:00','2026-09-01 00:00:00')`).run([id, name, `SKU${id}`, `88500${id}`, group ? 0 : qty * 2, brand, 'Cat', active, group])
          if (!group) for (const b of [1, 2]) raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run([id, b, qty])
        }
        for (const id of PLAIN) add(id, `Item ${id}`, id % 2 ? 'A' : 'B')
        for (const id of LOTTED) {
          add(id, `Lotted ${id}`, 'L')
          const [b1, b2] = batchesOf(id)
          raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,'2026-09-02',1,3,1)").run([b1, id, `K${b1}`, `K${b1}`])
          raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,'2026-09-09',2,5,1)").run([b2, id, `K${b2}`, `K${b2}`])
          for (const b of [1, 2]) { raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,3)').run([b1, b]); raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,7)').run([b2, b]) }
        }
        add(FAMILY.header, 'Family', 'F', { group: 1 }); for (const c of FAMILY.children) add(c, 'Family', 'F')
        raw.prepare('UPDATE products SET parent_id=? WHERE id IN (?,?)').run([FAMILY.header, ...FAMILY.children])
        for (const id of INACTIVE) add(id, `Old ${id}`, 'A', { active: 0, qty: 0 })
      })
    },
  })
  for (const name of ['ic_wired', 'ic_simple', 'ic_fix_stock', 'ic_lot_counts']) app.setSwitch(name, 'on')
  const ready = app.load('lib/cache.ts').bumpVersion(app.env, 'products')
  const as = (key) => app.setUser(app.users[key])
  let n = 0
  const rid = (tag) => `${tag}-${String(++n).padStart(7, '0')}`
  const call = async (who, method, url, body) => { await ready; as(who); return app.send(method, url, body) }
  return {
    app, as, rid, call, USERS, raw: app.raw, row: (sql, ...p) => app.raw.prepare(sql).get(p), rows: (sql, ...p) => app.raw.prepare(sql).all(p),
    bumpProducts: () => app.load('lib/cache.ts').bumpVersion(app.env, 'products'), stockWrite: (fn) => app.seedStockFixture(app.raw.db, fn),
  }
}
module.exports = { buildWorld, USERS, PLAIN, LOTTED, FAMILY, INACTIVE, batchesOf, COUNTER }
