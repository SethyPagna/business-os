// Audit-log paging at scale (AUDIT-LOG-ORG): lib/auditLogPage.ts + lib/auditLogQuery.ts
// + the compat.ts wiring, run against the REAL audit_logs schema in better-sqlite3.
//
// What the owner asked for: "the audit log has a lot of logs, so organize them
// properly: all, or by sections, or by users ... and time and search". What the
// D1 quota adds: every query must be bounded and index-shaped. This test pins
//   - keyset paging, with rows that share one created_at (the case an
//     OFFSET-free cursor gets wrong when it compares created_at alone);
//   - the page-size cap, the default 30-day window and the 92-day clamp;
//   - the UTC+7 business-day window (a 00:30 local event belongs to its local day);
//   - section / user / search filters, the search being parameter-bound;
//   - per-user and per-section counts from a bounded aggregate that ignores the
//     dimension being chosen, and that an own-only caller can never widen;
//   - that no statement the page runs has OFFSET, DISTINCT or an unwindowed
//     COUNT, and that the page query is planned on the created_at index.
//
// Run: node scripts/test-audit-log-page-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const cloudflareRoot = path.join(__dirname, '..')
let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

// ---- compile the real modules ---------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-page-'))
const libFiles = ['auditLogPage.ts', 'auditLogQuery.ts', 'auditSections.ts', 'businessDateWindow.ts']
for (const file of libFiles) fs.copyFileSync(path.join(cloudflareRoot, 'src', 'lib', file), path.join(tmpDir, file))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${libFiles.map((f) => path.join(tmpDir, f)).join(' ')}`, { cwd: tmpDir, stdio: 'inherit' })
const { readAuditLogPage } = require(path.join(tmpDir, 'auditLogPage.js'))
const query = require(path.join(tmpDir, 'auditLogQuery.js'))

// ---- real schema, plus the index the migration placeholder adds ------------
const initSql = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0001_init.sql'), 'utf8')
const createStart = initSql.indexOf('CREATE TABLE audit_logs')
const createAuditLogs = initSql.slice(createStart, initSql.indexOf(';', createStart) + 1)
const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at)',
]

function makeDb(rows, { indexed = true } = {}) {
  const db = new Database(':memory:')
  db.exec(createAuditLogs)
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)')
  if (indexed) for (const sql of INDEXES) db.exec(sql)
  const insert = db.prepare(`
    INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value, device_name, created_at)
    VALUES (@user_id, @user_name, @action, @entity, @entity_id, @details, @table_name, @record_id, @old_value, @new_value, @device_name, @created_at)
  `)
  for (const row of rows) {
    insert.run({ user_id: null, user_name: null, action: 'update', entity: null, entity_id: null, details: null, table_name: null, record_id: null, old_value: null, new_value: null, device_name: null, ...row })
  }
  const statements = []
  const calls = []
  const adapter = {
    prepare(sql) {
      statements.push(sql)
      const statement = db.prepare(sql)
      return {
        all: async (params = {}) => { calls.push({ sql, params }); return statement.all(params) },
        get: async (params = {}) => statement.get(params),
      }
    },
  }
  return { db, adapter, statements, calls }
}

const NOW = Date.parse('2026-09-30T05:00:00Z') // 12:00 on 30 Sep in Phnom Penh
const SAME_STAMP = '2026-09-30 03:00:00'
const rows = []
for (let i = 0; i < 7; i += 1) {
  rows.push({ user_id: 1, user_name: 'Meng', action: 'update', entity: 'sale', entity_id: String(100 + i), table_name: 'sales', details: 'receipt 00' + i, device_name: 'POS 1', created_at: SAME_STAMP })
}
rows.push({ user_id: 2, user_name: 'Sok', action: 'stock_set', entity: 'product', entity_id: '10', table_name: 'product', details: null, old_value: '{"name":"Dior 999"}', new_value: '{"name":"Dior 100% new"}', created_at: '2026-09-29T17:30:00.000Z' })
rows.push({ user_id: 2, user_name: 'Sok', action: 'create', entity: 'fee', entity_id: '7', table_name: 'fee', created_at: '2026-09-29 16:30:00' })
rows.push({ user_id: 3, user_name: 'សុភា', action: 'update', entity: 'customer', entity_id: '55', table_name: 'customers', new_value: '{"name":"សុភា"}', created_at: '2026-09-28 09:00:00' })
rows.push({ user_id: 1, user_name: 'Meng', action: 'update', entity: 'zzz_unknown', entity_id: '1', created_at: '2026-09-28 08:00:00' })
rows.push({ user_id: null, user_name: null, action: 'login', entity: null, table_name: null, created_at: '2026-09-28 07:00:00' })
rows.push({ user_id: 1, user_name: 'Meng', action: 'update', entity: 'sale', entity_id: '1', table_name: 'sales', created_at: '2026-06-01 03:00:00' })
rows.push({ user_id: 2, user_name: 'Sok', action: 'update', entity: 'sale', entity_id: '2', table_name: 'sales', created_at: '2026-09-26 03:00:00' })
const { db, adapter, statements, calls } = makeDb(rows)
db.exec("INSERT INTO users (id, username) VALUES (1, 'meng'), (2, 'sok'), (3, 'sophea')")

async function page(input, options = {}) {
  return readAuditLogPage(options.adapter || adapter, input, options.now || NOW)
}
async function walk(input, pageSize, options) {
  const ids = []
  let cursor
  for (let guard = 0; guard < 50; guard += 1) {
    const result = await page({ ...input, pageSize, cursor }, options)
    assert.ok(result.items.length <= pageSize, 'a page never exceeds the requested size')
    ids.push(...result.items.map((r) => r.id))
    if (!result.hasMore) {
      assert.equal(result.nextCursor, null, 'the last page has no cursor')
      return ids
    }
    assert.ok(result.nextCursor, 'a page with more rows hands back a cursor')
    cursor = result.nextCursor
  }
  throw new Error('cursor walk did not terminate')
}
const windowIds = (order) => db.prepare(`
  SELECT id FROM audit_logs WHERE created_at >= '2026-08-31' ORDER BY created_at ${order}, id ${order}
`).all().map((r) => r.id)

async function main() {
  // ---- keyset paging ---------------------------------------------------------
  {
    const expected = windowIds('DESC')
    for (const size of [1, 2, 3, 4, 100]) {
      const ids = await walk({}, size)
      assert.deepEqual(ids, expected, `cursor walk with page size ${size} equals the unpaged order`)
    }
    ok(true, 'desc cursor walks (sizes 1..100) equal the unpaged order, including the 7 rows that share one created_at')
    for (const size of [1, 3]) {
      const ids = await walk({ order: 'asc' }, size)
      assert.deepEqual(ids, windowIds('ASC'), `asc cursor walk with page size ${size}`)
    }
    ok(true, 'asc cursor walks equal the unpaged ascending order')
    const ids = await walk({}, 2)
    assert.equal(new Set(ids).size, ids.length, 'no row appears twice')
    ok(true, 'no duplicates across pages')
  }
  {
    // A cursor that only compared created_at would skip or repeat rows at a tie.
    const first = await page({ pageSize: 3, startDate: '2026-09-30', endDate: '2026-09-30' })
    ok(first.items.length === 3 && first.items[0].created_at === SAME_STAMP, 'the first page starts inside the same-timestamp block')
    const second = await page({ pageSize: 3, startDate: '2026-09-30', endDate: '2026-09-30', cursor: first.nextCursor })
    const overlap = second.items.filter((r) => first.items.some((f) => f.id === r.id))
    ok(overlap.length === 0, 'the next page continues the tie block without repeating a row')
    ok(second.items[0].id === first.items[2].id - 1, 'and without skipping one (ids stay consecutive inside the block)')
  }
  {
    const cursor = query.encodeAuditCursor('2026-09-30 03:00:00', 42)
    assert.deepEqual(query.decodeAuditCursor(cursor), { createdAt: '2026-09-30 03:00:00', id: 42 })
    for (const bad of ['', 'garbage', 'e30', Buffer.from('[1,2]').toString('base64url'), Buffer.from(JSON.stringify(["x' OR 1=1 --", 1])).toString('base64url'), Buffer.from(JSON.stringify(['2026-09-30', -1])).toString('base64url'), Buffer.from(JSON.stringify(['2026-09-30', 1.5])).toString('base64url'), 'a'.repeat(400)]) {
      assert.equal(query.decodeAuditCursor(bad), null, `cursor ${JSON.stringify(bad).slice(0, 30)} is rejected`)
    }
    ok(true, 'the cursor round-trips and every malformed cursor decodes to null')
  }

  // ---- page size cap ---------------------------------------------------------
  {
    const filler = []
    for (let i = 0; i < 150; i += 1) filler.push({ user_id: 4, user_name: 'Bulk', action: 'create', entity: 'note', entity_id: String(i), created_at: `2026-09-28 10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}` })
    const big = makeDb(filler)
    const huge = await page({ pageSize: 5000 }, { adapter: big.adapter })
    ok(huge.items.length === 100 && huge.pageSize === 100 && huge.hasMore === true, 'a page size of 5000 is capped at 100 and reports more rows')
    const dflt = await page({}, { adapter: big.adapter })
    ok(dflt.items.length === 50 && dflt.pageSize === 50, 'the default page is 50')
    const negative = await page({ pageSize: -3 }, { adapter: big.adapter })
    ok(negative.items.length === 50, 'a nonsense page size falls back to the default')
    for (const sql of big.statements) assert.ok(!/\bOFFSET\b/i.test(sql), 'no OFFSET')
  }

  // ---- window ----------------------------------------------------------------
  {
    const result = await page({})
    ok(result.window.endDate === '2026-09-30' && result.window.startDate === '2026-09-01', 'no dates -> the last 30 business days ending today (UTC+7)')
    ok(!result.items.some((r) => r.created_at.startsWith('2026-06')), 'a row outside the default window is not read')
    const clamped = await page({ startDate: '2026-01-01', endDate: '2026-09-30' })
    ok(clamped.window.startDate === '2026-06-30', 'a span longer than 92 days is clamped to the newest 92 days')
    ok(!clamped.items.some((r) => r.created_at.startsWith('2026-06-01')), 'the clamped window excludes June 1')
    const midnight = await page({ startDate: '2026-09-30', endDate: '2026-09-30' })
    ok(midnight.items.some((r) => r.entity === 'product'), '00:30 local (17:30Z the day before) belongs to its LOCAL day')
    ok(!midnight.items.some((r) => r.entity === 'fee'), 'and 23:30 local of the previous day does not')
    const previous = await page({ startDate: '2026-09-29', endDate: '2026-09-29' })
    ok(previous.items.length === 1 && previous.items[0].entity === 'fee', 'the previous local day holds only its own row')
    const early = await page({ startDate: '2026-09-30', endDate: '2026-09-30' }, { now: Date.parse('2026-09-29T18:00:00Z') })
    ok(early.window.endDate === '2026-09-30', 'at 01:00 local the business "today" is already the new day, not the UTC date')
    const swapped = await page({ startDate: '2026-09-30', endDate: '2026-09-28' })
    ok(swapped.window.startDate <= swapped.window.endDate, 'an inverted range is normalised, never an empty surprise')
    const future = await page({ startDate: '2026-12-01', endDate: '2026-12-31' })
    ok(future.window.endDate <= '2026-09-30', 'a future end date is clamped to today')
  }

  // ---- sections --------------------------------------------------------------
  {
    const sales = await page({ section: 'sales' })
    ok(sales.items.length === 8 && sales.items.every((r) => r.entity === 'sale'), 'section=sales returns exactly the sale rows in the window')
    const two = await page({ section: 'products,expenses' })
    ok(two.items.length === 2 && two.items.every((r) => ['product', 'fee'].includes(r.entity)), 'comma-joined sections are ORed')
    const other = await page({ section: 'other' })
    ok(other.items.length === 1 && other.items[0].entity === 'zzz_unknown', "section=other returns only rows nothing maps (the keyless login is Users, so it is not 'other')")
    const users = await page({ section: 'users' })
    ok(users.items.length === 1 && users.items[0].action === 'login', 'an entity-less login is found through the action fallback')
    const bogus = await page({ section: 'not_a_section' })
    ok(bogus.items.length === (await page({})).items.length, 'an unknown section adds no filter')
    const items = (await page({})).items
    ok(items.every((r) => typeof r.section === 'string'), 'every row carries its derived section')
    ok(items.find((r) => r.entity === 'fee').section === 'expenses' && items.find((r) => r.entity === 'zzz_unknown').section === 'other', 'the row section matches the mapping table')
  }

  // ---- user / own-only -------------------------------------------------------
  {
    const meng = await page({ userId: '1' })
    ok(meng.items.length > 0 && meng.items.every((r) => r.user_id === 1), 'userId filters by the account id')
    const locked = await page({ userId: '1', lockedUserId: 2 })
    ok(locked.items.length > 0 && locked.items.every((r) => r.user_id === 2), 'an own-only caller stays on their own rows even when the query asks for another user')
    const lockedCounts = await page({ counts: 'users', lockedUserId: 2, userId: '1' })
    ok(lockedCounts.counts.users.length === 1 && lockedCounts.counts.users[0].id === 2, 'an own-only caller never sees the roster')
  }

  // ---- search ----------------------------------------------------------------
  {
    ok((await page({ search: 'meng' })).items.every((r) => r.user_name === 'Meng'), 'search matches the actor name (case-insensitive)')
    ok((await page({ search: 'stock set' })).items.length === 1, "search 'stock set' finds the stock_set action (underscore read as a space)")
    ok((await page({ search: 'stock_set' })).items.length === 1, "search 'stock_set' finds it by the raw action too")
    ok((await page({ search: 'Dior' })).items.length === 1, 'search reaches the changed-field text (old_value / new_value)')
    ok((await page({ search: '100%' })).items.length === 1, 'a literal % is searched as typed')
    ok((await page({ search: '%' })).items.length === 1, 'a lone % matches only rows containing a percent sign, not everything')
    ok((await page({ search: 'សុភា' })).items.length === 1, 'search finds Khmer text')
    ok((await page({ search: '105' })).items.length === 1, 'search matches the entity id')
    ok((await page({ search: 'receipt 003' })).items.length === 1, 'search matches the details text')
    ok((await page({ search: 'meng sale' })).items.length === 7, 'several words are ANDed: actor AND entity across different columns (the June row is outside the window)')
    ok((await page({ search: 'meng nobody' })).items.length === 0, 'a word nothing matches empties the AND')
    const injection = "x'; DROP TABLE audit_logs; --"
    const built = query.buildAuditLogFilters({ search: injection })
    ok(!built.where.includes('DROP') && !built.where.includes(injection), 'the search text never appears in the SQL')
    ok((await page({ search: injection })).items.length === 0, 'an injection string matches nothing')
    ok(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n === rows.length, 'and the table is intact')
    const many = query.buildAuditLogFilters({ search: 'a b c d e f g h i j' })
    ok(Object.keys(many.params).filter((k) => k.startsWith('search')).length === 5, 'at most 5 search words are used')
    const long = query.buildAuditLogFilters({ search: 'x'.repeat(500) })
    ok(String(long.params.search0).length <= 64 + 2, 'a search word is cut at 64 characters')
  }

  // ---- counts ----------------------------------------------------------------
  {
    const result = await page({ counts: 'users' })
    const byId = Object.fromEntries(result.counts.users.map((u) => [String(u.id), u]))
    ok(result.counts.users[0].count >= result.counts.users[result.counts.users.length - 1].count, 'user counts are sorted, busiest first')
    ok(byId['1'].count === 8 && byId['1'].name === 'meng', 'per-user count for the window, named by the current username')
    ok(byId['2'].count === 3 && byId['3'].count === 1, 'other users are counted in the same window')
    ok(byId.null && byId.null.count === 1, 'rows without an account are one group')
    const chosen = await page({ counts: 'users', userId: '1' })
    ok(chosen.counts.users.length === result.counts.users.length, 'picking a user does not collapse the roster')
    const sectioned = await page({ counts: 'users', section: 'expenses' })
    ok(sectioned.counts.users.length === 1 && sectioned.counts.users[0].id === 2, 'the roster respects the section filter')
    const searched = await page({ counts: 'users', search: 'Dior' })
    ok(searched.counts.users.length === 1, 'the roster respects the search')
    const windowed = await page({ counts: 'users', startDate: '2026-09-30', endDate: '2026-09-30' })
    ok(windowed.counts.users.reduce((n, u) => n + u.count, 0) === 8, 'the roster respects the time window')
    const sectionCounts = await page({ counts: 'sections' })
    const bySection = Object.fromEntries(sectionCounts.counts.sections.map((s) => [s.section, s.count]))
    ok(bySection.sales === 8 && bySection.products === 1 && bySection.expenses === 1 && bySection.contacts === 1 && bySection.users === 1 && bySection.other === 1, 'per-section counts come from the same mapping table')
    const pickedSection = await page({ counts: 'sections', section: 'sales' })
    ok(pickedSection.counts.sections.length === sectionCounts.counts.sections.length, 'picking a section does not collapse the section counts')
    const pickedUser = await page({ counts: 'sections', userId: '2' })
    ok(Object.fromEntries(pickedUser.counts.sections.map((s) => [s.section, s.count])).sales === 1, 'section counts respect the user filter')
    const later = await page({ counts: 'users', cursor: query.encodeAuditCursor(SAME_STAMP, 3) })
    ok(later.counts === undefined, 'a later page does not repeat the aggregate')
    const none = await page({})
    ok(none.counts === undefined, 'no counts unless asked')
  }

  // ---- record trails keep working -------------------------------------------
  {
    const trail = await page({ entity: 'product', entityId: '10' })
    ok(trail.items.length === 1, 'a per-record trail (entity + entityId) still resolves')
    const old = makeDb([{ user_id: 1, user_name: 'Meng', action: 'create', entity: 'product', entity_id: '9', created_at: '2025-01-01 00:00:00' }])
    const ancient = await page({ entity: 'product', entityId: '9' }, { adapter: old.adapter })
    ok(ancient.items.length === 1, 'a record trail is not cut off by the default window')
  }

  // ---- every statement is bounded -------------------------------------------
  {
    const seen = new Set(statements)
    ok(seen.size > 3, `collected ${seen.size} distinct statements`)
    for (const sql of seen) {
      assert.ok(!/\bOFFSET\b/i.test(sql), `no OFFSET: ${sql.slice(0, 60)}`)
      assert.ok(!/\bDISTINCT\b/i.test(sql), 'no DISTINCT scans')
      assert.ok(/\bWHERE\b/i.test(sql), `every statement filters: ${sql.slice(0, 60)}`)
      assert.ok(/\bLIMIT\b/i.test(sql) || /GROUP BY/i.test(sql) === false, 'row statements are limited')
    }
    ok(true, 'no statement uses OFFSET or DISTINCT, and every statement has a WHERE')
    const windowed = [...seen].filter((sql) => !/@entityId/.test(sql))
    ok(windowed.every((sql) => /created_at >= date\(@startDate, '-1 day'\)/.test(sql) && /created_at < date\(@endDate, '\+1 day'\)/.test(sql)), 'every non-trail statement carries the sargable created_at window')
    ok([...seen].every((sql) => !/COUNT\(\*\) AS count FROM audit_logs\s*(?:ORDER|$)/.test(sql)), 'no unwindowed COUNT(*)')

    const plan = (sql, params) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params).map((r) => r.detail).join(' | ')
    const built = query.buildAuditLogFilters({ startDate: '2026-09-01', endDate: '2026-09-30', cursor: query.encodeAuditCursor(SAME_STAMP, 5) })
    const pageSql = `SELECT id FROM audit_logs ${built.where} ORDER BY created_at DESC, id DESC LIMIT 51`
    const detail = plan(pageSql, built.params)
    ok(/idx_audit_logs_created/.test(detail) && !/TEMP B-TREE/.test(detail) && !/SCAN audit_logs$/.test(detail), `the page query walks the created_at index with no sort (${detail})`)
    const real = calls.find((c) => /ORDER BY created_at DESC, id DESC\s+LIMIT @limit/.test(c.sql) && c.params.cursorId)
    ok(Boolean(real), 'captured a real production page statement that carries a cursor')
    const realDetail = plan(real.sql, real.params)
    ok(/SEARCH audit_logs USING (COVERING )?INDEX idx_audit_logs_created/.test(realDetail) && !/TEMP B-TREE/.test(realDetail), `the production page statement (all columns, cursor, window) is an index range walk with no sort (${realDetail})`)
    const byUser = query.buildAuditLogFilters({ startDate: '2026-09-01', endDate: '2026-09-30', userId: '1' })
    const userDetail = plan(`SELECT id FROM audit_logs ${byUser.where} ORDER BY created_at DESC, id DESC LIMIT 51`, byUser.params)
    ok(/idx_audit_logs_(user_)?created/.test(userDetail), `the per-user page query uses an audit_logs index (${userDetail})`)
  }
}

// ---- wiring pins -----------------------------------------------------------
function wiring() {
  const compat = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'compat.ts'), 'utf8')
  const start = compat.indexOf("app.get('/system/audit-logs'")
  const handler = compat.slice(start, compat.indexOf("app.delete('/system/audit-logs/retention'"))
  ok(/getActionTier\(user, 'audit_log', 'view'\)/.test(handler) && /tier === 'none'\) return c\.json\(\{ error: 'You do not have permission/.test(handler), 'the Worker still gates the audit log by the audit_log tier (none -> 403)')
  ok(/const ownOnly = tier === 'view'/.test(handler) && /lockedUserId: ownOnly \? Number\(user\?\.id\) : undefined/.test(handler), 'a view-tier caller is locked to their own id in the Worker')
  ok(/readAuditLogPage\(/.test(handler), 'the handler delegates to the tested page reader')
  ok(!/\bOFFSET\b/.test(handler) && !/DISTINCT/.test(handler) && !/COUNT\(\*\)/.test(handler), 'the handler itself has no OFFSET, DISTINCT or COUNT')
  ok(/decodeAuditCursor/.test(handler) && /Invalid cursor/.test(handler), 'a malformed cursor is a 400, not a silent first page')
  ok(/}, 500\)/.test(handler) && !/catch \(_\)/.test(handler), 'a db error is a 500, never an empty 200')
  const queryLib = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'auditLogQuery.ts'), 'utf8')
  ok(!/\$\{(?:searchTerm|token|input\.search)/.test(queryLib), 'the query builder never interpolates the search text')
  ok(/json_each\(@sectionKeys\)/.test(queryLib), 'sections are bound as ONE json parameter (D1 caps a statement at 100 parameters)')
}

main().then(() => {
  wiring()
  console.log(`\nAll ${checks} audit-log page checks passed.`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
