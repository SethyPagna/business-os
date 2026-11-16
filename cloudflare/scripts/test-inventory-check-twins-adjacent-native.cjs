'use strict'
// Owner, 16 Nov 2026: unmerged duplicates (two product records, same name, same barcode) are shown next to each other on every
// staff list, so they are easy to notice. The Inventory Check list was the one list that still ordered a family by id alone.
//
// Seeded world (node:sqlite, every migration replayed) plus synthetic products inserted into it:
//   "Zq Probe Serum":  5001 (8851111111111), 5002 (8852222222222, a real variant BETWEEN the twins by id), 5003 (8851111111111)
//   "Zq Probe Toner":  5004 ('0885333333333'), 5005 ('1234567890123'), 5006 ('885333333333'), 5007 (' zq probe toner', '885333333333')
//                      -> 5004, 5006 and 5007 are one product (leading zero, padded name); 5005 is a variant between them.
// Both Inventory Check readers (the wired list and the simple list), under their sorts and with the grouped simple list, must return the twins
// consecutively, every record once, whole families on one page. Mutants put the id-only order back and must turn it red.
//
// Run: node scripts/test-inventory-check-twins-adjacent-native.cjs
const assert = require('node:assert/strict')
const { bundle, bundleMutated, buildWorld, adapter } = require('./harness/ic-grouped-world.cjs')

const lowStock = { enabled: true, mode: 'product', threshold: 10 }
const admin = { id: 1, role_code: 'admin', role_permissions: { all: true } }
const FIELDS = { inventory_check_show_stock: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_received: true }
// A counter who may not see barcodes: the twins must still sit together (the order reveals no code).
const noBarcode = { id: 2, role_code: 'staff', role_permissions: JSON.stringify({ inventory_checks: true, ...FIELDS }) }

function insertProbeProducts(db) {
  db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  const add = db.prepare('INSERT INTO products(id,name,barcode,stock_quantity,is_group,brand,brands,category,categories,unit,is_active) VALUES(?,?,?,?,0,?,?,?,?,?,1)')
  const stock = db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)')
  const rows = [[5001, 'Zq Probe Serum', '8851111111111', 8], [5002, 'Zq Probe Serum', '8852222222222', 5], [5003, 'Zq Probe Serum', '8851111111111', 50],
    [5004, 'Zq Probe Toner', '0885333333333', 3], [5005, 'Zq Probe Toner', '1234567890123', 4], [5006, 'Zq Probe Toner', '885333333333', 6], [5007, ' zq probe toner', '885333333333', 7]]
  for (const [id, name, barcode, qty] of rows) { add.run(id, name, barcode, qty, 'B', 'B', 'Skin', 'Skin', 'pcs'); stock.run(id, 1, qty) }
  db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
}

const consecutive = (ids, wanted) => {
  const at = wanted.map(id => ids.indexOf(id))
  assert.ok(at.every(index => index >= 0), `all of ${wanted} are listed: ${ids}`)
  const sorted = [...at].sort((a, b) => a - b)
  assert.deepEqual(sorted, sorted.map((_, i) => sorted[0] + i), `${wanted} are consecutive in ${ids}`)
}

async function probe(api, label) {
  const failures = []
  const check = async (name, fn) => { try { await fn() } catch (error) { failures.push(`${label} ${name}: ${String(error.message).split('\n')[0]}`) } }
  const { db } = buildWorld(1)
  insertProbeProducts(db)
  const probeIds = [5001, 5002, 5003, 5004, 5005, 5006, 5007]
  const options = { lowStock, check: { organizationId: 1, viewerId: 1, canSeeStaffIdentity: () => true } }
  const wiredOptions = { lowStock }
  const onlyProbe = items => items.map(item => item.id).filter(id => probeIds.includes(id))
  const simple = (user, query) => api.readInventoryCheckProductsSimple(adapter(db), user, { query: 'zq probe', pageSize: '50', ...query }, options)
  const wired = (user, query) => api.readInventoryCheckProducts(adapter(db), user, { query: 'zq probe', pageSize: '50', ...query }, wiredOptions)
  const readers = [['simple', simple], ['wired', wired]]
  for (const [kind, read] of readers) for (const user of [admin, noBarcode]) {
    const who = user === admin ? 'admin' : 'no-barcode counter'
    for (const sortBy of ['name', 'stock', 'price']) {
      if (sortBy === 'price' && (kind === 'simple' || user !== admin)) continue // the simple list carries no price; a counter without the price field cannot sort by it
      for (const sortDirection of ['asc', 'desc']) await check(`${kind} ${who} ${sortBy} ${sortDirection}: twins consecutive`, async () => {
        const result = await read(user, { sortBy, sortDirection })
        const ids = onlyProbe(result.items)
        assert.deepEqual([...ids].sort((a, b) => a - b), probeIds, 'every probe record exactly once')
        consecutive(ids, [5001, 5003])
        consecutive(ids, [5004, 5006, 5007])
      })
    }
    await check(`${kind} ${who}: a family is whole on one page when the page is one family`, async () => {
      const first = await read(user, { pageSize: '1', page: '1', sortBy: 'name' })
      const ids = onlyProbe(first.items)
      assert.ok(first.total >= 2, `${first.total} families`)
      assert.ok(ids.length === 3 || ids.length === 4, `page 1 holds one whole family: ${ids}`)
      if (ids.length === 3) consecutive(ids, [5001, 5003])
    })
  }
  await check('grouped simple list (groupBy=checked): twins consecutive', async () => {
    const result = await simple(admin, { groupBy: 'checked' })
    const ids = onlyProbe(result.items)
    assert.deepEqual([...ids].sort((a, b) => a - b), probeIds)
    consecutive(ids, [5001, 5003])
    consecutive(ids, [5004, 5006, 5007])
  })
  return failures
}

;(async () => {
  const real = await probe(bundle('inventoryCheckProducts.ts'), 'real')
  assert.deepEqual(real, [], `real code is red:\n${real.join('\n')}`)
  const mutants = {
    'simple and wired read order by id only': ['inventoryCheckProducts.ts', [["const IC_INTRA_FAMILY_ORDER_SQL = `${intraFamilyNameBarcodeSql('name', '__code_barcode')}, id ASC`", "const IC_INTRA_FAMILY_ORDER_SQL = 'id ASC'"],
      ["const IC_PAGE_INTRA_ORDER_SQL = `${intraFamilyNameBarcodeSql('__page.name', '__page.__code_barcode')}, __page.id ASC`", "const IC_PAGE_INTRA_ORDER_SQL = '__page.id ASC'"]]],
    'the page wrapper re-sorts by id only (the list leaves the helper order)': ['inventoryCheckProducts.ts', [["const IC_PAGE_INTRA_ORDER_SQL = `${intraFamilyNameBarcodeSql('__page.name', '__page.__code_barcode')}, __page.id ASC`", "const IC_PAGE_INTRA_ORDER_SQL = '__page.id ASC'"]]],
    'barcode order is raw (leading zeros not folded)': ['familyPagination.ts', [["NOT GLOB '*[^0-9]*' AND", "GLOB 'zzz' AND"]]],
    'name compared untrimmed': ['familyPagination.ts', [["return `lower(trim(${nameColumn})) ASC, (${code} = '')", "return `lower(${nameColumn}) ASC, (${code} = '')"]]],
  }
  for (const [name, [file, edits]] of Object.entries(mutants)) {
    const api = await bundleMutated('inventoryCheckProducts.ts', { [file]: edits })
    const failed = await probe(api, name)
    assert.ok(failed.length > 0, `mutant survived: ${name}`)
  }
  console.log(`PASS inventory check twins adjacent: simple and wired readers, name/stock/price sorts both ways, two users, grouped list, page of one family, ${Object.keys(mutants).length} mutants killed`)
})().catch(error => { console.error(error); process.exit(1) })
