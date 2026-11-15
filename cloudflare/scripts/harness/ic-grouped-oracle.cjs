'use strict'
// The independent JS oracle of the grouped Inventory Check list, shared by the ic_simple oracle and the wired (ic_wired) oracle: it rebuilds the cohort from the name-ordered reader's rows, then
// applies the rules from the raw tables (a family's date is the MAX over its rows of the newest done/issue item, organization, session branch and chosen branch honoured; the day is UTC+7;
// "never" and "no category" last; ties by lowercased name, then family key). { wired: true } reads the cohort as Products' own rows and orders a family's rows by lower(name), id.

const asciiLower = text => text.replace(/[A-Z]/g, c => c.toLowerCase())
const trimSpaces = text => text.replace(/^ +| +$/g, '')
const bytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))
const dayOf = at => new Date(Date.parse(at.includes('T') ? at : at.replace(' ', 'T') + 'Z') + 7 * 3600000).toISOString().slice(0, 10)

function newestChecks(db, org, branch) {
  const sessions = new Map(db.prepare('SELECT id, organization_id AS org, branch_id AS branch FROM inventory_check_sessions').all().map(s => [s.id, s]))
  const best = new Map()
  for (const item of db.prepare('SELECT session_id, product_id, branch_id, state, updated_at FROM inventory_check_items').all()) {
    const s = sessions.get(item.session_id)
    if (s.org !== org || s.branch !== item.branch_id || (branch !== null && item.branch_id !== branch)) continue
    if (item.state !== 'done' && item.state !== 'issue') continue
    if (!best.has(item.product_id) || item.updated_at > best.get(item.product_id)) best.set(item.product_id, item.updated_at)
  }
  return best
}

// The expected grouped read for one world, scope and pager, from the name-ordered rows.
function expectedRead(db, nameRows, by, org, branch, page, pageSize, { wired = false } = {}) {
  const dates = newestChecks(db, org, branch)
  const info = new Map(db.prepare(`SELECT p.id AS id, p.name AS name, p.parent_id AS parent_id, p.category AS category,
      COALESCE(NULLIF(COALESCE(parent.name_key,p.name_key),''),'id:'||COALESCE(parent.id,p.id)) AS k, lower(trim(COALESCE(parent.name,p.name))) AS n
    FROM products p LEFT JOIN products parent ON parent.id=p.parent_id`).all().map(r => [r.id, r]))
  // The ic_simple list shows leaves under synthetic header rows (checkable:false); the wired list shows Products' own rows, headers included, in one family with their children.
  const leaves = (wired ? nameRows : nameRows.filter(row => row.checkable)).map(row => row.id)
  const headers = new Set(db.prepare('SELECT id FROM products WHERE COALESCE(is_group,0)=1').all().map(r => r.id))
  const isHeader = id => headers.has(id)
  const families = new Map()
  for (const id of leaves) {
    const row = info.get(id), f = families.get(row.k) || { k: row.k, n: row.n, ids: [], products: 0, date: null, cat: null, firstCat: new Map() }
    f.ids.push(id)
    // A header row is the family's title, not a product: group counts (and the product total) count products only, as the ic_simple list does.
    if (!isHeader(id)) f.products++
    const at = dates.get(id) ?? null
    if (at !== null && (f.date === null || at > f.date)) f.date = at
    const norm = row.category === null ? null : (trimSpaces(asciiLower(String(row.category))) || null)
    if (norm !== null && (f.cat === null || bytes(norm, f.cat) < 0)) f.cat = norm
    if (norm !== null && !f.firstCat.has(norm)) f.firstCat.set(norm, trimSpaces(String(row.category)))
    families.set(row.k, f)
  }
  const keyOf = f => by === 'checked' ? (f.date === null ? 'never' : `d:${dayOf(f.date)}`) : (f.cat === null ? 'none' : `c:${f.cat}`)
  const sortKey = f => by === 'checked' ? f.date : f.cat
  const ordered = [...families.values()].sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b)
    if ((ka === null) !== (kb === null)) return ka === null ? 1 : -1
    if (ka !== null && ka !== kb) return by === 'checked' ? (ka < kb ? 1 : -1) : bytes(ka, kb)
    return bytes(a.n, b.n) || bytes(a.k, b.k)
  })
  const totals = new Map()
  ordered.forEach((f, index) => { const key = keyOf(f), g = totals.get(key) || { key, families: 0, products: 0, first: index + 1, last: index + 1 }; g.families++; g.products += f.products; g.last = index + 1; totals.set(key, g) })
  const slice = ordered.slice((page - 1) * pageSize, page * pageSize), items = [], seenHeader = new Set()
  for (const f of slice) for (const id of wired ? f.ids.sort((x, y) => bytes(asciiLower(info.get(x).name), asciiLower(info.get(y).name)) || x - y) : f.ids.sort((x, y) => x - y)) {
    const parent = wired ? null : info.get(id).parent_id
    if (parent && !seenHeader.has(parent)) { seenHeader.add(parent); items.push({ id: parent, group_key: keyOf(f) }) }
    items.push({ id, group_key: keyOf(f) })
  }
  const present = [...new Set(slice.map(keyOf))]
  const offset = (page - 1) * pageSize
  const groups = present.map(key => {
    const g = totals.get(key), first = slice.find(f => keyOf(f) === key)
    const label = by === 'category' && key !== 'none' ? [...families.values()].filter(f => keyOf(f) === key && slice.includes(f)).map(f => f.firstCat.get(f.cat)).find(Boolean) ?? null : null
    return { key, label, families: g.families, products: g.products, continued_before: g.first < offset + 1, continues_after: g.last > offset + pageSize, _first: first }
  }).map(({ _first, ...g }) => g)
  return { items, groups, total: ordered.length, products: leaves.filter(id => !isHeader(id)).length, totals }
}

module.exports = { asciiLower, trimSpaces, bytes, dayOf, newestChecks, expectedRead }
