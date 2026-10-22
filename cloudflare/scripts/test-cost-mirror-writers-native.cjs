'use strict'
// Lane 6.0.944: every writer of a product cost writes its purchase_price_* twin in the same statement (the rule is
// COST_MIRROR_COLUMNS in lib/catalogCostRecompute.ts, the same one 0269 and the health query apply). Real Hono routes, shared
// writers, the pending queue and the review applier on the migrated SQLite schema (the money-write-policy harness, evaluated
// from its own file so the two cannot drift): create, edit (a form that re-sends the stale twin it loaded, a typed cost on a
// product whose formula is silent, a cleared cost), the create-fold, the review-queue replay and the catalog-wide cost adjust;
// the helper itself; and a source guard that fails when a statement names a cost column and no twin.
// The import writers run in test-cost-mirror-import-native.cjs; the merge keeper, merge undo and stock-action creates are asserted
// in test-product-conflict-merge-batch-sqlite.cjs, test-product-merge-undo-pure.cjs and test-stock-action-commit-pure.cjs.
//
// Run: node scripts/test-cost-mirror-writers-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const harnessPath = path.join(__dirname, 'test-product-money-write-policy-native.cjs')
const harnessText = fs.readFileSync(harnessPath, 'utf8')
const harnessEnd = harnessText.indexOf(';(async () => {')
assert.ok(harnessEnd > 0, 'the money-write-policy harness moved')
const harnessModule = { exports: {} }
new Function('require', '__dirname', 'module', `${harnessText.slice(0, harnessEnd)}
module.exports = { products, reviews, writer, request, row, raw, admin, requester, seedFixture, load }`)(createRequire(harnessPath), __dirname, harnessModule)
const { products, reviews, writer, request, row, raw, admin, requester, seedFixture, load } = harnessModule.exports
const costs = load('lib/catalogCostRecompute.ts')

let passed = 0
const check = (name, run) => Promise.resolve(run()).then(() => { passed++; console.log(`PASS ${name}`) })
const aligned = (usd, khr) => (cost, twin) => cost === twin || (cost === null && (twin === 0 || twin === null))
const pair = (id) => { const r = row(id); return [r.cost_price_usd, r.purchase_price_usd, r.cost_price_khr, r.purchase_price_khr] }
const seed = (name, cost, twin, khr = null, twinKhr = 0, extra = {}) => Number(seedFixture(raw, () => raw.prepare(
  'INSERT INTO products(name,barcode,cost_price_usd,purchase_price_usd,cost_price_khr,purchase_price_khr,is_active) VALUES(?,?,?,?,?,?,?)')
  .run(name, extra.barcode ?? null, cost, twin, khr, twinKhr, extra.active ?? 1)).lastInsertRowid)

async function main() {
  await check('the helper: a cost column writes its twin (null as 0), replaces a twin the caller sent, and leaves a row without a cost alone', () => {
    assert.deepEqual(costs.COST_MIRROR_COLUMNS, { cost_price_usd: 'purchase_price_usd', cost_price_khr: 'purchase_price_khr' })
    assert.equal(costs.costMirrorSql('@cost'), 'COALESCE(@cost, 0)')
    const sent = { cost_price_usd: 12, purchase_price_usd: 9, name: 'x' }
    assert.equal(costs.mirrorCostColumns(sent), sent, 'the same object, written in place')
    assert.deepEqual(sent, { cost_price_usd: 12, purchase_price_usd: 12, name: 'x' })
    assert.deepEqual(costs.mirrorCostColumns({ cost_price_usd: null, cost_price_khr: null }), { cost_price_usd: null, cost_price_khr: null, purchase_price_usd: 0, purchase_price_khr: 0 })
    assert.deepEqual(costs.mirrorCostColumns({ cost_price_khr: 4000 }), { cost_price_khr: 4000, purchase_price_khr: 4000 }, 'only the currency written')
    assert.deepEqual(costs.mirrorCostColumns({ cost_price_usd: 0 }), { cost_price_usd: 0, purchase_price_usd: 0 }, 'a recorded $0 mirrors as 0')
    assert.deepEqual(costs.mirrorCostColumns({ name: 'x', purchase_price_usd: 7 }), { name: 'x', purchase_price_usd: 7 }, 'a lone twin is not this helper\'s to rewrite')
    assert.deepEqual(costs.mirrorCostColumns({ name: 'x' }), { name: 'x' })
  })

  await check('create: the typed cost is mirrored (a stale twin in the body is replaced), an absent or blank cost stays unknown with a twin of 0', async () => {
    const typed = await request(products, 'POST', '/', { name: 'Create typed', cost_price_usd: 6, cost_price_khr: 24000, purchase_price_usd: 99, purchase_price_khr: 99 })
    assert.equal(typed.status, 200, JSON.stringify(typed))
    assert.deepEqual(pair(typed.body.id), [6, 6, 24000, 24000])
    const usdOnly = await request(products, 'POST', '/', { name: 'Create usd only', cost_price_usd: 4.5 })
    assert.deepEqual(pair(usdOnly.body.id), [4.5, 4.5, null, 0], 'the unknown KHR cost keeps its default twin')
    const none = await request(products, 'POST', '/', { name: 'Create no cost' })
    assert.deepEqual(pair(none.body.id), [null, 0, null, 0])
    const blank = await request(products, 'POST', '/', { name: 'Create blank cost', cost_price_usd: '', cost_price_khr: '' })
    assert.deepEqual(pair(blank.body.id), [null, 0, null, 0])
    const free = await request(products, 'POST', '/', { name: 'Create free', cost_price_usd: 0 })
    assert.deepEqual(pair(free.body.id), [0, 0, null, 0], 'a recorded $0 is a real $0 on both')
  })

  await check('planInsertRow (the stock-in session and review create path) carries the twin in the same INSERT', () => {
    const columns = new Set(['name', 'cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr', 'is_active', 'created_at', 'updated_at'])
    const plan = writer.planInsertRow('products', { name: 'Planned', cost_price_usd: 3, purchase_price_usd: 50 }, columns, { is_active: 1 })
    const names = /INSERT INTO "products" \((.*?)\) VALUES/.exec(plan.sql)[1].split(', ').map(column => column.replace(/"/g, ''))
    const named = Object.fromEntries(names.map((column, index) => [column, plan.params[`value${index}`]]))
    assert.equal(named.cost_price_usd, 3)
    assert.equal(named.purchase_price_usd, 3, 'the twin of a typed cost, not the stale one sent')
    assert.equal(named.cost_price_khr, null, 'an absent cost is unknown')
    assert.ok(!names.includes('purchase_price_khr'), 'and its twin is left to the DEFAULT 0')
  })

  await check('edit: a form that re-sends the stale twin it loaded ends with the twin equal to the cost, whether or not the formula can derive one', async () => {
    // product 51 on 2 Oct: lot cost 9, manual override to 12, no stock left, so the formula is silent
    const p51 = seed('Edit override 51', 9, 9)
    assert.equal((await request(products, 'PUT', `/${p51}`, { cost_price_usd: 12, purchase_price_usd: 9 })).status, 200)
    assert.deepEqual(pair(p51).slice(0, 2), [12, 12])
    // an import-shaped row: cost 6, twin 0; the form loads and re-sends both
    const imported = seed('Edit imported 6', 6, 0, 24000, 0)
    assert.equal((await request(products, 'PUT', `/${imported}`, { cost_price_usd: 7, purchase_price_usd: 0, cost_price_khr: 24000, purchase_price_khr: 0 })).status, 200)
    assert.deepEqual(pair(imported), [7, 7, 24000, 24000], 'the KHR twin, unchanged cost, is also brought in line')
    // a cost-only body (no twin sent at all)
    const bare = seed('Edit bare', 5, 5)
    assert.equal((await request(products, 'PUT', `/${bare}`, { cost_price_usd: 8 })).status, 200)
    assert.deepEqual(pair(bare).slice(0, 2), [8, 8])
  })

  await check('edit: a cleared cost is unknown with a twin of 0; a body without a cost leaves both columns alone', async () => {
    const cleared = seed('Edit cleared', 9, 9)
    assert.equal((await request(products, 'PUT', `/${cleared}`, { cost_price_usd: null, purchase_price_usd: 9 })).status, 200)
    assert.deepEqual(pair(cleared).slice(0, 2), [null, 0])
    const split = seed('Edit unrelated', 6, 0)
    assert.equal((await request(products, 'PUT', `/${split}`, { description: 'only text' })).status, 200)
    assert.deepEqual(pair(split).slice(0, 2), [6, 0], 'an edit that writes no cost does not touch the pair (0269 repairs what exists)')
    const lone = seed('Edit lone twin', 4, 4)
    assert.equal((await request(products, 'PUT', `/${lone}`, { purchase_price_usd: '3.45675' })).status, 200)
    assert.equal(row(lone).purchase_price_usd, 3.4568, 'a lone purchase write is the API-only shape no client sends; kept as it was')
  })

  await check('create-fold: a typed cost folded onto an existing identity moves cost and twin together', async () => {
    const existing = seed('Fold target', 5, 0, null, 0, { barcode: '8851234567890' })
    const folded = await request(products, 'POST', '/', { name: 'Fold target', barcode: '8851234567890', cost_price_usd: 7 })
    assert.equal(folded.status, 200, JSON.stringify(folded))
    assert.equal(folded.body.folded_into, existing, 'the create folded into the existing product')
    const after = row(existing)
    assert.notEqual(after.cost_price_usd, 5, 'the fold changed the cost')
    assert.equal(after.purchase_price_usd, after.cost_price_usd, 'and the twin with it')
  })

  await check('review queue: an approved edit replays through the same writer, twin included', async () => {
    const queued = seed('Review edit', 5, 5)
    const pending = await request(products, 'PUT', `/${queued}`, { cost_price_usd: 3, purchase_price_usd: 99 }, requester)
    assert.equal(pending.status, 202, JSON.stringify(pending))
    assert.equal((await request(reviews, 'POST', `/${pending.body.pendingActionId}/approve`, {})).status, 200)
    assert.deepEqual(pair(queued).slice(0, 2), [3, 3])
    const created = await request(products, 'POST', '/', { name: 'Review create', cost_price_usd: 2.5 }, requester)
    assert.equal(created.status, 202)
    assert.equal((await request(reviews, 'POST', `/${created.body.pendingActionId}/approve`, {})).status, 200)
    const made = raw.prepare("SELECT cost_price_usd, purchase_price_usd FROM products WHERE name='Review create'").get()
    assert.deepEqual({ ...made }, { cost_price_usd: 2.5, purchase_price_usd: 2.5 })
  })

  await check('catalog-wide cost adjust: every cost it moves moves its twin to the same figure, both currencies; unknown, inactive and untouched columns stay', async () => {
    const a = seed('Adjust a', 6, 0, 24000, 0)
    const b = seed('Adjust b', 10, 7, null, 0)
    const unknown = seed('Adjust unknown', null, 0)
    const free = seed('Adjust free', 0, 0)
    const inactive = seed('Adjust inactive', 4, 0, null, 0, { active: 0 })
    const response = await request(products, 'POST', '/bulk-price-adjust', { direction: 'increase', amount: 1, fields: ['cost_price_usd', 'cost_price_khr'], client_request_id: 'mirror-adjust-up-0001' })
    assert.equal(response.status, 200, JSON.stringify(response))
    assert.deepEqual(pair(a), [7, 7, 24001, 24001])
    assert.deepEqual(pair(b), [11, 11, null, 0], 'the stale 7 becomes the new cost, the unknown KHR cost stays unknown')
    assert.deepEqual(pair(unknown), [null, 0, null, 0], 'an unknown cost has nothing to adjust')
    assert.deepEqual(pair(free), [1, 1, null, 0], 'a recorded $0 is a cost')
    assert.deepEqual(pair(inactive), [4, 0, null, 0], 'inactive rows are not adjusted')
    const down = await request(products, 'POST', '/bulk-price-adjust', { direction: 'decrease', amount: 2, fields: ['cost_price_usd'], client_request_id: 'mirror-adjust-down-0001' })
    assert.equal(down.status, 200, JSON.stringify(down))
    assert.deepEqual(pair(a).slice(0, 2), [5, 5])
    assert.deepEqual(pair(free).slice(0, 2), [0, 0], 'a decrease clamps at 0 on the cost and on its twin')
  })

  await check('source guard: a statement that names a product cost column names its twin, and each shared-helper call site is present', () => {
    const root = path.join(__dirname, '..', 'src')
    const BS = String.fromCharCode(92)
    const files = []
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.ts')) files.push(f) } }
    walk(root)
    // Statements whose cost is unknown by policy (NULL, twin left at its DEFAULT 0) or that restore a snapshot verbatim.
    const ALLOWED = { 'lib/datedStockCountDecisions.ts': 'inserts an unknown (NULL) cost; the twin keeps its DEFAULT 0' }
    const offenders = []
    let seen = 0
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      const rel = path.relative(root, file).split(path.sep).join('/')
      const re = /(UPDATE\s+products\b|INSERT\s+(?:OR\s+\w+\s+)?INTO\s+products\b)/g
      let m
      while ((m = re.exec(text))) {
        let s = m.index
        while (s > 0 && text[s] !== '`' && text[s] !== "'" && text[s] !== '"') s--
        const quote = text[s]
        let depth = 0
        let i = s + 1
        for (; i < text.length; i++) {
          const c = text[i]
          if (quote === '`') {
            if (c === '$' && text[i + 1] === '{') { depth++; i++; continue }
            if (c === '{' && depth) depth++
            if (c === '}' && depth) depth--
            if (c === '`' && !depth) break
          } else if (c === quote && text[i - 1] !== BS) break
        }
        const body = text.slice(s, i + 1)
        if (!/cost_price_(usd|khr)\s*=|INTO\s+products\s*\([^)]*cost_price_(usd|khr)/i.test(body.replace(/\s+/g, ' '))) continue
        seen++
        const twin = /purchase_price_(usd|khr)/.test(body) || /costMirrorSql|mirrorCostColumns|COST_MIRROR_COLUMNS/.test(body)
        if (!twin && !(rel in ALLOWED)) offenders.push(`${rel}:${text.slice(0, m.index).split('\n').length}`)
      }
    }
    assert.ok(seen >= 8, `the scanner found ${seen} statements that write a cost column; it has gone blind`)
    assert.deepEqual(offenders, [], 'a product statement writes a cost column without its purchase_price_* twin')
    const count = (rel, pattern) => (fs.readFileSync(path.join(root, rel), 'utf8').match(pattern) || []).length
    assert.equal(count('lib/productWrites.ts', /mirrorCostColumns\(/g), 3, 'insertRow, planInsertRow and updateRow')
    assert.equal(count('lib/createFold.ts', /mirrorCostColumns\(/g), 1)
    assert.equal(count('lib/importEngine.ts', /costMirrorSql\(/g), 7, 'the two full UPDATEs and the INSERT (usd and khr each), and the column-level UPDATE')
    assert.equal(count('lib/stockActionCommit.ts', /costMirrorSql\(/g), 1)
    assert.equal(count('lib/undoAppliers.ts', /purchase_price_(usd|khr) = @purchase(Usd|Khr)/g), 2, 'the merge undo restores the twin its snapshot recorded, usd and khr')
    assert.equal(count('routes/products.ts', /purchase_price_(usd|khr): costOrNull\(canonicalBefore/g), 2, 'the merge snapshot records the keeper twin, usd and khr')
    assert.equal(count('lib/productMergeSnapshot.ts', /cost_price_khr, purchase_price_usd, purchase_price_khr/g), 1, 'the pre-merge read selects the twins')
    assert.equal(count('routes/products.ts', /costMirrorSql\(/g), 2, 'the conflict-merge keeper write, usd and khr')
    assert.equal(count('routes/products.ts', /COST_MIRROR_COLUMNS\[/g), 1, 'the catalog-wide cost adjust')
    assert.equal(count('routes/inventory.ts', /mirrorCostColumns\(/g), 1, 'mirrorCostFields delegates to the shared rule')
  })

  console.log(`test-cost-mirror-writers-native: ${passed} checks passed`)
}

main().catch(error => { console.error(error); process.exit(1) })
