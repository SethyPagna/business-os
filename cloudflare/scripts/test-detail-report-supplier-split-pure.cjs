// D4 (Part 578, item 4): the product detail report's Suppliers query must NOT
// split one real supplier into two rows -- an 'id:5' row for its id-attributed
// lots and a 'name:acme' row for its name-only lots that never got linked. The
// fix resolves a name-only lot (supplier_id NULL) to the suppliers row its
// recorded name matches (lower/trim), the same match-only rule receive time used,
// so both fold into one 'id:5' group.
//
// This test runs the ACTUAL SQL fragments (RESOLVED_SUPPLIER_ID_SQL /
// SUPPLIER_KEY_SQL) extracted from src/routes/products.ts against a real migrated
// in-memory SQLite (better-sqlite3 via the d1compat harness) -- so it proves both
// the correctness of the collapse AND that SQLite accepts GROUP BY on an output
// alias whose expression contains a correlated subquery. A source-guard then
// asserts the route actually wires those fragments into both the grouping query
// and the /supplier-purchases drill-down, and that no inline naive key survives.
//
// Run (from cloudflare/): node scripts/test-detail-report-supplier-split-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

// --- Extract the real SQL fragments from the route source -----------------
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')

const ridMatch = routeSrc.match(/const RESOLVED_SUPPLIER_ID_SQL\s*=\s*`([\s\S]*?)`/)
const keyMatch = routeSrc.match(/const SUPPLIER_KEY_SQL\s*=\s*`([\s\S]*?)`/)
check('products.ts defines RESOLVED_SUPPLIER_ID_SQL', !!ridMatch)
check('products.ts defines SUPPLIER_KEY_SQL', !!keyMatch)

const RESOLVED_SUPPLIER_ID_SQL = ridMatch[1]
const SUPPLIER_KEY_SQL = keyMatch[1].replace('${RESOLVED_SUPPLIER_ID_SQL}', RESOLVED_SUPPLIER_ID_SQL)

// The resolution must actually consult the suppliers table by normalized name.
check('resolved id looks up suppliers by lower(trim(name))',
  /SELECT s\.id FROM suppliers s WHERE lower\(trim\(s\.name\)\) = lower\(trim\(pb\.supplier_name\)\)/.test(RESOLVED_SUPPLIER_ID_SQL))

// The route must wire the fragment into BOTH the grouping SELECT and the
// drill-down predicate, and must MAX the resolved id (not the raw supplier_id).
check('grouping query uses ${SUPPLIER_KEY_SQL} AS supplier_key',
  /\$\{SUPPLIER_KEY_SQL\} AS supplier_key/.test(routeSrc))
check('grouping query reports MAX(${RESOLVED_SUPPLIER_ID_SQL}) AS supplier_id',
  /MAX\(\$\{RESOLVED_SUPPLIER_ID_SQL\}\) AS supplier_id/.test(routeSrc))
check('drill-down predicate uses ${SUPPLIER_KEY_SQL} = @supplierKey',
  /AND \$\{SUPPLIER_KEY_SQL\} = @supplierKey/.test(routeSrc))
// No inline naive key ('id:' || pb.supplier_id, 'name:' ...) may survive -- that
// was the split bug; every key path must go through the resolved fragment.
check('no inline naive supplier key remains in products.ts',
  !/'id:' \|\| pb\.supplier_id, 'name:'/.test(routeSrc))

// --- Seed a real DB with a split-supplier scenario ------------------------
const db = openDb(loadAll())
db.prepare(`INSERT INTO suppliers (id, name) VALUES (5, 'Acme'), (7, 'Gamma')`).run({})

// variant_product_id 100. Lots exercise every path:
//   A id-attributed to 5; B/C/F name-only that must resolve to 5 (exact, case,
//   whitespace); D name-only 'Beta' with NO supplier row (stays name:beta);
//   E id-attributed to 7.
const lots = [
  { id: 1, sid: 5, sname: 'Acme', qty: 10 },
  { id: 2, sid: null, sname: 'Acme', qty: 5 },
  { id: 3, sid: null, sname: 'acme', qty: 3 },
  { id: 4, sid: null, sname: 'Beta', qty: 4 },
  { id: 5, sid: 7, sname: 'Gamma', qty: 8 },
  { id: 6, sid: null, sname: '  ACME  ', qty: 2 },
]
for (const l of lots) {
  db.prepare(
    `INSERT INTO product_batches (id, variant_product_id, batch_key, is_active, supplier_id, supplier_name, received_at)
     VALUES (@id, 100, @bk, 1, @sid, @sname, '2026-01-0' || @id)`,
  ).run({ id: l.id, bk: 'BK' + l.id, sid: l.sid, sname: l.sname })
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@id, 1, @qty)`).run({ id: l.id, qty: l.qty })
}

// --- The resolved grouping query (mirrors the route's Suppliers query) -----
const groupingSql = `
  SELECT
    ${SUPPLIER_KEY_SQL} AS supplier_key,
    MAX(${RESOLVED_SUPPLIER_ID_SQL}) AS supplier_id,
    COUNT(*) AS lot_count,
    COALESCE(SUM(bbs.qty), 0) AS current_qty
  FROM product_batches pb
  LEFT JOIN (SELECT batch_id, SUM(quantity) AS qty FROM branch_batch_stock GROUP BY batch_id) bbs ON bbs.batch_id = pb.id
  WHERE pb.variant_product_id = @productId
    AND pb.is_active = 1
    AND (pb.supplier_id IS NOT NULL OR trim(COALESCE(pb.supplier_name, '')) <> '')
  GROUP BY supplier_key
  ORDER BY supplier_key
`
const groups = db.prepare(groupingSql).all({ productId: 100 })
const byKey = Object.fromEntries(groups.map((g) => [g.supplier_key, g]))

check('collapses to exactly 3 supplier groups (no id/name split)', groups.length === 3)
check("Acme folds all 4 id+name-only lots into one 'id:5' group",
  byKey['id:5'] && Number(byKey['id:5'].lot_count) === 4)
check('Acme group reports resolved supplier_id = 5', byKey['id:5'] && Number(byKey['id:5'].supplier_id) === 5)
check('Acme group sums qty across the merged lots (10+5+3+2 = 20)',
  byKey['id:5'] && Number(byKey['id:5'].current_qty) === 20)
check("Gamma id-attributed stays its own 'id:7' group", byKey['id:7'] && Number(byKey['id:7'].lot_count) === 1)
check("unmatched name-only 'Beta' stays a 'name:beta' group (not merged away)",
  byKey['name:beta'] && Number(byKey['name:beta'].lot_count) === 1)
check('unmatched Beta group reports NULL supplier_id (genuinely unlinked)',
  byKey['name:beta'] && byKey['name:beta'].supplier_id == null)

// --- Prove the OLD naive key WOULD have split Acme -------------------------
const naiveGroups = db.prepare(`
  SELECT COALESCE('id:' || pb.supplier_id, 'name:' || lower(trim(pb.supplier_name))) AS supplier_key, COUNT(*) AS lot_count
  FROM product_batches pb
  WHERE pb.variant_product_id = 100 AND pb.is_active = 1
    AND (pb.supplier_id IS NOT NULL OR trim(COALESCE(pb.supplier_name, '')) <> '')
  GROUP BY supplier_key
`).all({})
const naiveByKey = Object.fromEntries(naiveGroups.map((g) => [g.supplier_key, g]))
check('regression witness: naive key splits Acme into id:5 (1 lot) + name:acme (3 lots)',
  naiveGroups.length === 4 && Number(naiveByKey['id:5'].lot_count) === 1 && Number(naiveByKey['name:acme'].lot_count) === 3)

// --- Drill-down predicate returns the whole resolved group -----------------
const drillSql = `
  SELECT pb.id
  FROM product_batches pb
  WHERE pb.variant_product_id = @productId AND pb.is_active = 1
    AND ${SUPPLIER_KEY_SQL} = @supplierKey
  ORDER BY pb.id
`
const acmeLots = db.prepare(drillSql).all({ productId: 100, supplierKey: 'id:5' }).map((r) => Number(r.id))
check("drill-down 'id:5' returns all 4 Acme lots (id-attributed + name-only)",
  acmeLots.length === 4 && acmeLots.join(',') === '1,2,3,6')
const betaLots = db.prepare(drillSql).all({ productId: 100, supplierKey: 'name:beta' }).map((r) => Number(r.id))
check("drill-down 'name:beta' returns only the unlinked Beta lot", betaLots.length === 1 && betaLots[0] === 4)
const gammaLots = db.prepare(drillSql).all({ productId: 100, supplierKey: 'id:7' }).map((r) => Number(r.id))
check("drill-down 'id:7' returns only the Gamma lot", gammaLots.length === 1 && gammaLots[0] === 5)

console.log(`\nAll ${checks} checks passed.`)
