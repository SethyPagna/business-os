// Companion for ops/queries/received-date-format-census.sql (branch cutover lane LB, owner ruling 6 Oct 2026:
// the DATE decides which lots merge, whatever text stored it).
// - the file passes the ops read-only guard, identically for LF and CRLF, with every LIKE/GLOB pattern <= 50 bytes
//   (D1 refuses longer ones: "LIKE or GLOB pattern too complex");
// - on the production-shaped e2e fixture (every migration) plus one lot of every text shape, each census row equals
//   an independent count written here in JS: shape, lots, positive lots, created_at range, the slash components and
//   the sibling probe;
// - it discriminates: a month-first-only database reports first_gt_12 = 0; one DD/MM value turns it to 1, and a
//   slash date whose product has an ISO lot on the month-first day counts as sibling_month_first, not day-first;
// - the sibling probe reads lots through the variant index (no full scan of product_batches per slash lot).
// Run (from cloudflare/): node scripts/test-received-date-format-census-query-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { world } = require('./test-branch-cutover-parent-e2e-native.cjs')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'ops/queries/received-date-format-census.sql'), 'utf8')

// independent shape classifier (regexes, not the query's GLOBs)
function shapeOf(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v !== 'string') return 'not text'
  const t = v.replace(/^ +| +$/g, '')
  if (t === '') return 'blank'
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return 'YYYY-MM-DD'
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return 'YYYY-MM-DD' + (t[10] === 'T' ? 'T...' : t[10] === ' ' ? ' ...' : ' + other')
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) return 'N/N/YYYY'
  if (/^\d+\/\d*\/\d*\d{2}$/.test(t) && /^[\d/]*$/.test(t) && t.length <= 8) return 'N/N/YY'
  if (t.includes('/')) return 'slash other'
  if (/^\d[\d-]*-[\d-]*\d{4}$/.test(t) && /^\d+-\d*-?\d*$/.test(t.replace(/-\d{4}$/, '')) && /^[\d-]+$/.test(t)) return 'N-N-YYYY'
  if (/^\d[\d.]*\.[\d.]*\d{4}$/.test(t) && /^[\d.]+$/.test(t)) return 'N.N.YYYY'
  return 'other'
}
const parts = (v) => {
  const t = String(v).replace(/^ +| +$/g, '')
  const [a, b] = t.split('/')
  const num = (x) => { const m = /^\s*[+-]?\d+/.exec(x ?? ''); return m ? Number(m[0]) : 0 }
  return { s1: num(a), s2: t.split('/').length >= 3 ? num(b) : null }
}

async function main() {
  let checks = 0
  const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name) }
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href)
  const { sql, rules } = guard.guardSql(source)

  await check('the census passes the ops read-only guard, identically for LF and CRLF, with D1-safe patterns', () => {
    assert.equal(rules.minRows, 1); assert.equal(rules.maxRows, 16)
    const lf = source.replace(/\r\n/g, '\n')
    assert.equal(guard.guardSql(lf).sql, sql); assert.equal(guard.guardSql(lf.replace(/\n/g, '\r\n')).sql, sql)
    const patterns = [...sql.matchAll(/\b(?:GLOB|LIKE)\s+'((?:[^']|'')*)'/gi)].map(m => m[1])
    assert.ok(patterns.length >= 10)
    for (const p of patterns) assert.ok(Buffer.byteLength(p) <= 50, 'pattern over 50 bytes: ' + p)
  })

  const extra = [
    // [id, product, received_at, created_at]
    [9001, 1, '08/24/2026', '2026-08-28 03:00:00'], [9002, 2, '4/8/2026', '2026-08-28 03:00:01'], [9003, 2, '2026-04-08', '2026-09-01 00:00:00'],
    [9004, 3, '12/12/2026', '2026-08-28 03:00:02'], [9005, 4, '08/24/26', '2026-08-28 03:00:03'], [9006, 4, '08/24/2026 10:00', '2026-08-28 03:00:04'],
    [9007, 5, '08-24-2026', '2026-08-28 03:00:05'], [9008, 5, '24.08.2026', '2026-08-28 03:00:06'], [9009, 6, 'soon', '2026-08-28 03:00:07'],
    [9010, 6, '', '2026-08-28 03:00:08'], [9011, 6, ' ', '2026-08-28 03:00:09'], [9012, 7, Buffer.from('2026-08-24'), '2026-08-28 03:00:10'],
    [9013, 8, '2026-08-24x', '2026-08-28 03:00:11'], [9014, 3, '9/1/2026', '2026-08-28 03:00:12'], [9015, 3, '2026-09-01T10:00:00Z', '2026-09-02 00:00:00'],
  ]
  const census = (raw) => raw.prepare(sql).all().map(r => ({ ...r }))
  const expectedRows = (raw) => {
    const positive = new Set(raw.prepare('SELECT DISTINCT batch_id FROM branch_batch_stock WHERE quantity > 0').all().map(r => r.batch_id))
    const lots = raw.prepare('SELECT id, variant_product_id p, received_at v, created_at FROM product_batches').all()
    const isoOf = new Map()
    for (const l of lots) if (typeof l.v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(l.v.trim())) { const k = l.p + '|' + l.v.trim().slice(0, 10); isoOf.set(k, (isoOf.get(k) || new Set()).add(l.id)) }
    const sibling = (l, iso) => [...(isoOf.get(l.p + '|' + iso) || [])].some(id => id !== l.id)
    const rows = new Map()
    for (const l of lots.sort((a, b) => a.id - b.id)) {
      const shape = shapeOf(l.v)
      const r = rows.get(shape) || { shape, lots: 0, positive_lots: 0, first_seen: null, last_seen: null, s1: [], s2: [], mf: 0, df: 0, examples: [] }
      r.lots++; if (positive.has(l.id)) r.positive_lots++
      if (l.created_at !== null && (r.first_seen === null || l.created_at < r.first_seen)) r.first_seen = l.created_at
      if (l.created_at !== null && (r.last_seen === null || l.created_at > r.last_seen)) r.last_seen = l.created_at
      if (typeof l.v === 'string' && l.v.includes('/')) { const { s1, s2 } = parts(l.v); r.s1.push(s1); if (s2 !== null) r.s2.push(s2); r.pairs = (r.pairs || []).concat([[s1, s2]]) }
      if (shape === 'N/N/YYYY') {
        const [a, b, y] = l.v.trim().split('/')
        const pad = (x) => String(Number(x)).padStart(2, '0')
        if (sibling(l, `${y}-${pad(a)}-${pad(b)}`)) r.mf++
        if (sibling(l, `${y}-${pad(b)}-${pad(a)}`)) r.df++
      }
      if (r.examples.length < 5) r.examples.push([l.p, l.id, l.v === null || typeof l.v === 'string' ? l.v : '<blob>'])
      rows.set(shape, r)
    }
    return [...rows.values()].map(r => {
      const slash = r.shape.includes('/') || r.shape === 'slash other'
      const pairs = r.pairs || []
      return { shape: r.shape, lots: r.lots, positive_lots: r.positive_lots, first_seen: r.first_seen, last_seen: r.last_seen,
        max_first: slash ? (r.s1.length ? Math.max(...r.s1) : null) : null, max_second: slash ? (r.s2.length ? Math.max(...r.s2) : null) : null,
        first_gt_12: slash ? pairs.filter(([a]) => a > 12).length : null, second_gt_12: slash ? pairs.filter(([, b]) => b !== null && b > 12).length : null,
        both_le_12_differ: slash ? pairs.filter(([a, b]) => b !== null && a <= 12 && b <= 12 && a !== b).length : null,
        sibling_month_first: r.shape === 'N/N/YYYY' ? r.mf : null, sibling_day_first: r.shape === 'N/N/YYYY' ? r.df : null, examples: r.examples }
    }).sort((a, b) => b.lots - a.lots || (a.shape < b.shape ? -1 : 1))
  }
  const insert = (raw, rows) => {
    const st = raw.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)`)
    for (const [id, p, v, at] of rows) st.run(id, p, 'census-' + id, 'C' + id, v, id, at, at)
  }

  await check('every census row equals an independent count of the fixture plus one lot of every shape', () => {
    const w = world({ generatedProducts: 6 })
    insert(w.raw, extra)
    const got = census(w.raw), want = expectedRows(w.raw)
    assert.deepEqual(got.map(r => ({ ...r, examples: JSON.parse(r.examples).sort((a, b) => a[1] - b[1]) })), want)
    const shapes = got.map(r => r.shape).sort()
    for (const s of ['NULL', 'not text', 'blank', 'YYYY-MM-DD', 'YYYY-MM-DDT...', 'YYYY-MM-DD ...', 'YYYY-MM-DD + other', 'N/N/YYYY', 'N/N/YY', 'slash other', 'N-N-YYYY', 'N.N.YYYY', 'other']) {
      assert.ok(shapes.includes(s), 'the fixture exercises ' + s)
    }
    w.raw.close()
  })

  await check('it discriminates the order: month-first only reads first_gt_12 = 0, one DD/MM value reads 1; siblings follow the real order', () => {
    const w = world({ generatedProducts: 0 })
    insert(w.raw, extra.filter(([id]) => [9001, 9002, 9003, 9004, 9014, 9015].includes(id)))
    w.raw.exec("UPDATE product_batches SET received_at = '2026-01-01' WHERE received_at LIKE '%/%' AND id < 9000") // only the census lots carry slashes
    const slash = () => census(w.raw).find(r => r.shape === 'N/N/YYYY')
    const before = slash()
    assert.deepEqual([before.lots, before.first_gt_12, before.second_gt_12, before.both_le_12_differ, before.max_first, before.max_second], [4, 0, 1, 2, 12, 24])
    // 4/8 has an ISO sibling on 8 Apr (month-first), 9/1 one on 1 Sep: two month-first hits, no day-first hit
    assert.deepEqual([before.sibling_month_first, before.sibling_day_first], [2, 0])
    insert(w.raw, [[9020, 1, '24/08/2026', '2026-09-20 00:00:00'], [9021, 9, '1/9/2026', '2026-09-20 00:00:00'], [9022, 9, '2026-09-01', '2026-09-20 00:00:00']])
    const after = slash()
    assert.deepEqual([after.lots, after.first_gt_12, after.max_first, after.sibling_month_first, after.sibling_day_first], [6, 1, 24, 2, 1])
    w.raw.close()
  })

  await check('the sibling probe reads each slash lot\'s product through the variant index, never a full scan per lot', () => {
    const w = world({ generatedProducts: 0 })
    const plan = w.raw.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(r => r.detail)
    const probe = plan.filter(d => / o\b| AS o\b/.test(d) || /product_batches AS o/.test(d))
    assert.ok(probe.length >= 1, plan.join('\n'))
    for (const d of probe) assert.match(d, /SEARCH .*USING (COVERING )?INDEX .*variant_product_id=/, d)
    w.raw.close()
  })

  console.log(`${checks} received-date format census checks passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
