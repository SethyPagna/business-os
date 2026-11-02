// Inventory Check Back / Next / rows-per-page contract on local workerd (owner ask, 1 Nov 2026).
//
// A name-sorted page ranks families without the sales history and reads qty_sold / customer_count for the page rows
// only. That is only safe if paging over it is a stable partition, so this walks every page with Next and Back at
// several page sizes and asserts, against oracles that do not use the name-page path:
//   * every cohort row appears exactly once across the pages (no duplicate, no skip), against direct SQL;
//   * total and totalPages are the same on every page, and the page past the end is empty;
//   * every page size yields the same ordered row sequence;
//   * Back from page N returns exactly the page N-1 that Next returned;
//   * a family is complete on one page, and each page holds pageSize families except the last;
//   * qty_sold and customer_count equal the full-ranking path (qty_sold sort) and direct SQL buyer counts;
//   * the summary cards are identical on every page.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = path.resolve(__dirname, '..')
const P = 240
const sha = text => createHash('sha256').update(text).digest('hex')

const WORKER = `
  import { getDb } from './src/lib/db'
  import { readInventoryCheckProducts } from './src/lib/inventoryCheckProducts'
  import * as sessions from './src/lib/inventoryCheckSessions'
  const lowStock = { enabled: true, mode: 'product', threshold: 5 }
  export default { async fetch(request, env) {
    const { actor, query } = await request.json()
    const db = getDb(env)
    let out
    try {
      const user = await sessions.currentInventoryCheckActor(db, { id: actor.id, tokenHash: actor.tokenHash })
      out = await readInventoryCheckProducts(db, user, query, { lowStock, costReviewKeyAvailable: user.product_cost_review_key_available === 1,
        observationFilter: { organizationId: user.organization_id ?? null, viewerId: user.id } })
    } catch (error) { out = { error: error?.code || error?.message || String(error), status: error?.status } }
    return Response.json({ out })
  } }`

// Families by name_key: one of 9 rows (crosses every tested page size), threes, twos and singles; parent_id groups
// (a header row plus three differently named children); blank names, which tie on the empty family name and are
// ordered only by their id: keys; archived rows. Sales at two branches with cancelled and Not Paid rows,
// anonymous and missing customers, and customer returns (one cancelled, one supplier-scope).
const FIXTURE = [
  "INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')",
  "INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1)",
  `WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j+1 FROM n WHERE j<${P - 1}),
    shaped AS (SELECT j, 2000+j AS id, (j%41=20) AS grp, (j%41 IN (21,22,23)) AS child,
      CASE WHEN j<9 THEN 0 WHEN j%10 IN (0,1,2) THEN j-j%10 WHEN j%10 IN (3,4) THEN j-j%10+3 ELSE j END AS fam FROM n)
    INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,cost_price_usd,is_active,brand,category,parent_id,is_group)
    SELECT id,
      CASE WHEN j%59=13 THEN '  ' WHEN child THEN 'Shade '||(j%41-20)||' of '||(j-j%41+20) WHEN fam=0 THEN 'Mega family'
        ELSE (CASE fam%3 WHEN 0 THEN ' ' ELSE '' END)||(CASE fam%4 WHEN 0 THEN 'Serum' WHEN 1 THEN 'cream' WHEN 2 THEN 'Powder' ELSE 'balm' END)||' '||printf('%04d',fam) END,
      '885'||printf('%010d',id),'SKU-'||id,0,3+j%11,1+(j%5)/4.0,CASE WHEN j%31=5 AND NOT grp AND NOT child THEN 0 ELSE 1 END,'Brand'||(j%5),'Cat'||(j%3),
      CASE WHEN child THEN 2000+j-j%41+20 END, grp FROM shaped`,
  'INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT id,1,(id-2000)%9 FROM products WHERE is_group=0 AND is_active=1',
  `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number)
    SELECT product_id+600000,product_id,'b-'||product_id,'L-'||product_id,'2026-05-01',1,1 FROM branch_stock WHERE quantity>0`,
  'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT product_id+600000,1,quantity FROM branch_stock WHERE quantity>0',
  'UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock s WHERE s.product_id=products.id) WHERE is_group=0',
  `WITH RECURSIVE n(j) AS (SELECT 1 UNION ALL SELECT j+1 FROM n WHERE j<30) INSERT INTO customers(id,name,phone,is_anonymous) SELECT j,'Customer '||j,'0'||(10000000+j),CASE WHEN j=7 THEN 1 ELSE 0 END FROM n`,
  `WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<400)
    INSERT INTO sales(id,receipt_number,customer_id,created_at,sale_status,subtotal_usd,discount_usd,total_usd)
    SELECT k,'P-'||k,CASE WHEN k%4=0 THEN NULL ELSE 1+(k*7)%30 END,datetime('2026-02-01','+'||(k%200)||' days'),
      CASE WHEN k%19=0 THEN 'cancelled' WHEN k%13=0 THEN 'awaiting_payment' ELSE 'completed' END,20,CASE WHEN k%6=0 THEN 2 ELSE 0 END,20 FROM n`,
  `INSERT INTO sale_items(sale_id,product_id,branch_id,quantity,total_usd,total_khr,cost_price_usd,cost_price_khr)
    SELECT s.id,2000+((s.id*17+m.m*101)%${P}),1+((s.id+m.m)%2),1+(s.id+m.m)%3,10,40000,1.5,6000
    FROM sales s JOIN (SELECT 0 AS m UNION ALL SELECT 1) m`,
  `INSERT INTO returns(id,return_number,sale_id,customer_id,branch_id,status,return_scope,total_refund_usd)
    SELECT id,'RP-'||id,id,customer_id,1,CASE WHEN id=33 THEN 'cancelled' ELSE 'completed' END,CASE WHEN id=55 THEN 'supplier' ELSE 'customer' END,5 FROM sales WHERE id%11=0`,
  `INSERT INTO return_items(return_id,product_id,quantity,total_usd,total_khr,cost_price_usd,cost_price_khr,branch_id,return_to_stock,stock_action)
    SELECT r.id,2000+((r.id*17)%${P}),1,5,20000,1.5,6000,CASE WHEN r.id%2=0 THEN NULL ELSE 1+(r.id%2) END,1,'restock' FROM returns r`,
  `INSERT OR REPLACE INTO roles(id,name,code,permissions) VALUES(920001,'Administrator','admin','{}'),
    (920002,'Counter','employee','{"inventory":true,"inventory_checks":true,"inventory_check_show_price":true,"inventory_check_show_barcode":true,"inventory_check_show_category":true,"inventory_check_show_brand":true,"inventory_check_show_received":true,"inventory_check_show_sales":true,"inventory_check_show_customers":true,"inventory_check_show_stock":false}')`,
  "DELETE FROM system_flags WHERE key='stock_transaction_permit'",
  "INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES(920001,'page-admin','A','unused',920001,1),(920002,'page-counter','C','unused',920002,1)",
]

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: WORKER }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const migrationDir = path.join(root, 'migrations'), statements = []
    for (const name of fs.readdirSync(migrationDir).filter(n => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(migrationDir, name), 'utf8')).filter(sql => sql.trim())) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        statements.push(sql)
      }
    }
    for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100).map(sql => db.prepare(sql)))
    for (const sql of FIXTURE) try { await db.prepare(sql).run() } catch (error) { throw new Error(sql.slice(0, 80) + ': ' + error.message) }
    const actors = {}
    for (const [name, id] of [['admin', 920001], ['counter', 920002]]) {
      actors[name] = { id, tokenHash: sha(`page-token-${id}`) }
      await db.prepare("INSERT INTO user_sessions(user_id,token_hash,expires_at,last_seen_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',CURRENT_TIMESTAMP)").bind(id, actors[name].tokenHash).run()
    }
    const sql = async (text, ...binds) => (await db.prepare(text).bind(...binds).all()).results
    // Direct-SQL oracles: the cohort (visible rows that are not a parent with children), its family keys, and the
    // distinct identified buyers per product on recognised sales (scoped to a branch's lines when one is chosen).
    // A search matches the row's own name or its parent's (the barcodes and SKUs here are digits).
    const cohortIds = async (text = '') => (await sql(`SELECT p.id FROM products p LEFT JOIN products parent ON parent.id=p.parent_id
      WHERE p.is_active=1 AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_id=p.id AND c.id<>p.id)
      AND (?1='' OR instr(lower(p.name),?1)>0 OR instr(lower(COALESCE(parent.name,'')),?1)>0) ORDER BY p.id`, text)).map(row => row.id)
    const familyKeys = new Map((await sql(`SELECT p.id, COALESCE(NULLIF(COALESCE(parent.name_key,p.name_key),''),'id:'||COALESCE(parent.id,p.id)) AS k
      FROM products p LEFT JOIN products parent ON parent.id=p.parent_id`)).map(row => [row.id, row.k]))
    const buyers = async branchId => new Map((await sql(`SELECT si.product_id AS id, COUNT(DISTINCT s.customer_id) AS n FROM sale_items si JOIN sales s ON s.id=si.sale_id
      LEFT JOIN customers c ON c.id=s.customer_id WHERE s.sale_status<>'cancelled' AND s.customer_id IS NOT NULL AND COALESCE(c.is_anonymous,0)=0
      AND (?1 IS NULL OR si.branch_id=?1) GROUP BY si.product_id`, branchId ?? null)).map(row => [row.id, row.n]))
    const shape = (await sql(`SELECT (SELECT COUNT(*) FROM products WHERE is_group=1) parents,(SELECT COUNT(*) FROM products WHERE trim(name)='') blanks,
      (SELECT COUNT(*) FROM products WHERE is_active=0) archived,(SELECT COUNT(*) FROM sale_items) lines,(SELECT COUNT(*) FROM return_items) returned,
      (SELECT MAX(n) FROM (SELECT COUNT(*) n FROM products GROUP BY name_key)) biggest`))[0]
    assert.deepEqual(shape, { parents: 6, blanks: 4, archived: 8, lines: 800, returned: 36, biggest: 9 }, 'fixture shape')

    const read = async (query, actor = 'admin') => {
      const response = await mf.dispatchFetch('http://local.test/', { method: 'POST', body: JSON.stringify({ actor: actors[actor], query }) })
      assert.equal(response.status, 200)
      const { out } = await response.json()
      assert.equal(out.error, undefined, `${JSON.stringify(query)}: ${out.error}`)
      return { out, text: JSON.stringify(out) }
    }
    const rowKey = item => `${item.checkable ? 'row' : 'header'}:${item.id}`
    // Next from page 1 to one past the end, then Back from the end to page 1.
    const walk = async (base, actor) => {
      const pages = [await read({ ...base, page: '1' }, actor)]
      const { total, totalPages, pageSize } = pages[0].out
      assert.equal(totalPages, Math.max(1, Math.ceil(total / pageSize)), 'page count follows the family total and the page size')
      for (let page = 2; page <= totalPages + 1; page += 1) pages.push(await read({ ...base, page: String(page) }, actor))
      const beyond = pages.pop().out
      assert.equal(beyond.items.length, 0, 'the page past the end is empty')
      assert.equal(beyond.total, total, 'and still reports the same total')
      const families = pages.map(({ out }, index) => {
        assert.equal(out.page, index + 1)
        assert.equal(out.total, total, `page ${index + 1}: total is the same on every page`)
        assert.equal(out.totalPages, totalPages, `page ${index + 1}: page count is the same on every page`)
        assert.equal(JSON.stringify(out.stats), JSON.stringify(pages[0].out.stats), `page ${index + 1}: summary cards are the same on every page`)
        return new Set(out.items.filter(item => item.checkable).map(item => familyKeys.get(item.id)))
      })
      families.forEach((set, index) => assert.equal(set.size, index < families.length - 1 ? pageSize : total - pageSize * (families.length - 1), `page ${index + 1} holds ${pageSize} families until the last`))
      const familyPage = new Map()
      families.forEach((set, index) => { for (const key of set) { assert.ok(!familyPage.has(key), `family ${key} split across pages ${familyPage.get(key)} and ${index + 1}`); familyPage.set(key, index + 1) } })
      for (let page = totalPages; page >= 1; page -= 1) {
        const back = await read({ ...base, page: String(page) }, actor)
        assert.equal(back.text, pages[page - 1].text, `Back to page ${page} returns exactly the page Next showed`)
      }
      const items = pages.flatMap(({ out }) => out.items)
      const seen = new Set()
      for (const item of items) { assert.ok(!seen.has(rowKey(item)), `${rowKey(item)} is listed twice`); seen.add(rowKey(item)) }
      return { total, totalPages, items, rows: items.filter(item => item.checkable) }
    }

    for (const [label, base, actor] of [['all branches A-Z', {}, 'admin'], ['branch 1 Z-A', { branchId: '1', sortBy: 'name', sortDirection: 'desc' }, 'admin'],
      ['branch 2 A-Z without stock', { branchId: '2' }, 'counter'], ['search', { query: 'serum' }, 'admin']]) {
      const bySize = {}
      for (const pageSize of ['20', '7', '50', '100']) bySize[pageSize] = await walk({ ...base, pageSize }, actor)
      const reference = bySize['20']
      for (const [pageSize, result] of Object.entries(bySize)) {
        assert.equal(result.total, reference.total, `${label}: ${pageSize} per page counts the same families`)
        assert.deepEqual(result.items.map(rowKey), reference.items.map(rowKey), `${label}: ${pageSize} per page lists the same rows in the same order as 20 per page`)
        assert.equal(JSON.stringify(result.rows), JSON.stringify(reference.rows), `${label}: ${pageSize} per page returns identical row values`)
      }
      const cohort = await cohortIds(base.query)
      assert.ok(cohort.length > 0, `${label}: the oracle cohort is not empty`)
      assert.deepEqual(reference.rows.map(item => item.id).sort((a, b) => a - b), cohort, `${label}: every cohort row appears once, none skipped`)
      // The full-ranking path (qty_sold sort ranks with the cohort-wide ledger) is the oracle for the page-scoped figures.
      const ranked = await walk({ ...base, sortBy: 'qty_sold', sortDirection: 'desc', pageSize: '100' }, actor)
      const metric = rows => new Map(rows.map(item => [item.id, [item.qty_sold, item.customer_count]]))
      assert.deepEqual(metric(reference.rows), metric(ranked.rows), `${label}: name pages carry the same qty_sold and customer_count as the full ranking`)
      const direct = await buyers(base.branchId)
      for (const item of reference.rows) assert.equal(item.customer_count, direct.get(item.id) ?? 0, `${label}: product ${item.id} counts its distinct identified buyers`)
      assert.ok(reference.rows.some(item => item.qty_sold > 0) && reference.rows.some(item => item.customer_count > 1), `${label}: the walk covers sold products with several buyers`)
      assert.ok(reference.items.some(item => !item.checkable), `${label}: parent headers are on the walk`)
      console.log(`PASS ${label}: ${reference.total} families, ${reference.rows.length} rows; Next/Back and 20/7/50/100 per page agree; figures equal the full ranking`)
    }
    assert.ok((await read({ branchId: '2' }, 'counter')).out.items.every(item => !Object.hasOwn(item, 'quantity')), 'a counter without stock still gets no quantity on name pages')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
