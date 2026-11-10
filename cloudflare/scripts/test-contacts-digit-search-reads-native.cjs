'use strict'
// A typed number is found through customers_phone_digits_fts (migration 0302), so its reads follow the matches and not the table. This pins
// it: the Contacts list (count, year facet and page) and the Sales/POS picker read about as much as a name search, a miss reads next to
// nothing, and the same search on a table twice the size reads the same rows. A name search reads what it always did.
// Real mounted Contacts route on Miniflare D1 with every migration applied; rows are D1's own meta.rows_read.
//
// Run (from cloudflare/): node scripts/test-contacts-digit-search-reads-native.cjs
// CSM_ROOT=<other checkout of cloudflare/> CSM_REPORT=1 prints the numbers without asserting (used to measure the base commit).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build, buildSync } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = process.env.CSM_ROOT || path.resolve(__dirname, '..')
const reportOnly = process.env.CSM_REPORT === '1'
const CUSTOMERS = 400
const PAGE_SIZE = 20

const entry = `
import contacts from './src/routes/contacts.ts'
import { getPlanLimits } from './src/lib/planTier.ts'
let rows = 0, statements = 0
globalThis[Symbol.for('business-os.request-metrics.v1')] = {
  d1Start() {}, cache() {},
  d1Call(_wall, metas) { for (const meta of metas || []) { statements += 1; rows += Number(meta?.rows_read) || 0 } },
}
export default { async fetch(request, env, ctx) {
  rows = 0; statements = 0
  const response = await contacts.fetch(request, env, ctx)
  const headers = new Headers(response.headers)
  headers.set('x-rows-read', String(rows)); headers.set('x-statements', String(statements))
  headers.set('x-query-ceiling', String(getPlanLimits(env).d1QueriesPerInvocation))
  return new Response(response.body, { status: response.status, headers })
} }
`
const fixtureAuth = {
  name: 'fixture-auth',
  setup(b) {
    b.onResolve({ filter: /lib\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export const requireAuth=async(c,next)=>{const permissions=c.req.header('x-test-permissions');if(!permissions)return c.json({error:'Unauthorized'},401);c.set('user',{id:7,username:'employee',role_code:'employee',permissions});return next()};", loader: 'ts' }))
  },
}
const pad = (n, w) => String(n).padStart(w, '0')

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: entry }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error', plugins: [fixtureAuth] })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], r2Buckets: ['ASSETS'], kvNamespaces: ['CACHE'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const dir = path.join(root, 'migrations')
    const stmts = []
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(dir, name), 'utf8')).filter((s) => s.trim())) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        stmts.push(sql)
      }
    }
    for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100).map((s) => db.prepare(s)))

    const inserts = []
    for (let i = 1; i <= CUSTOMERS; i++) {
      let phone = `097${pad(i * 37, 6)}`
      let normalized = phone
      if (i % 10 === 0) phone = phone.replace(/^(\d{3})(\d{3})(\d+)$/, '$1 $2 $3')
      if (i > CUSTOMERS - 40) { phone = ''; normalized = null }
      const address = i % 3 === 0 ? JSON.stringify([{ label: 'Main', phone: phone || '096111222', address: `Street ${i}` }]) : null
      inserts.push(db.prepare('INSERT INTO customers (id,name,phone,phone_normalized,address,membership_number,is_anonymous,created_at) VALUES (?,?,?,?,?,?,0,?)')
        .bind(i, `Cust ${i}`, phone, normalized, address, `LC-${pad(i, 5)}`, `${2024 + (i % 3)}-0${1 + (i % 9)}-01 00:00:00`))
    }
    await db.batch(inserts)
    await db.prepare("UPDATE customers SET name='Dara', phone='012 345 678', phone_normalized='012345678', address=NULL WHERE id=5").run()
    await db.prepare(`UPDATE customers SET name='Sok', phone='', phone_normalized=NULL, address=? WHERE id=6`).bind(JSON.stringify([{ label: 'Work', phone: '+855 (12) 345-679' }])).run()

    await db.prepare(`UPDATE customers SET name='Tabbed', phone='', phone_normalized=NULL, address=? WHERE id=7`).bind(JSON.stringify([{ label: 'Work', phone: '012\t333\t444' }])).run()

    const stored = [
      [8, 'Nbsp', '012\u00a0333\u00a0555', null],
      [9, 'Khmer', String.fromCharCode(0x17e0, 0x17e1, 0x17e2) + ' ' + String.fromCharCode(0x17e3, 0x17e3, 0x17e3) + ' ' + String.fromCharCode(0x17e6, 0x17e6, 0x17e6), null],
      [10, 'Double zero', '00855 12 345 690', null],
      [11, 'Option nbsp', '', JSON.stringify([{ label: 'Work', phone: '012\u00a0777\u00a0888' }])],
    ]
    for (const [id, name, phone, address] of stored) await db.prepare('UPDATE customers SET name=?, phone=?, phone_normalized=NULL, address=? WHERE id=?').bind(name, phone, address, id).run()
    const crowd = ['Aaron Lee', 'Amy Lee', 'Anna Lee', 'Bora Lee', 'Chan Lee', 'Eang Lee', 'Fern Lee', 'Gina Lee', 'Lee', 'Leesa']
    for (const [index, name] of crowd.entries()) await db.prepare('UPDATE customers SET name=? WHERE id=?').bind(name, 301 + index).run()

    const HOLDER = { all: true }
    const NO_GRANT = { contacts: true }
    const call = async (url, permissions) => {
      const res = await mf.dispatchFetch('http://local' + url, { headers: { 'x-test-permissions': JSON.stringify(permissions) } })
      return { status: res.status, body: await res.json(), rows: Number(res.headers.get('x-rows-read')), statements: Number(res.headers.get('x-statements')), ceiling: Number(res.headers.get('x-query-ceiling')) }
    }
    const list = (search, permissions, suffix = '') => call(`/customers?search=${encodeURIComponent(search)}&page=1&pageSize=${PAGE_SIZE}${suffix}`, permissions)
    const picker = (search, permissions) => call(`/customers?fields=sales_picker&search=${encodeURIComponent(search)}`, permissions)

    const clauseModule = { exports: {} }
    new Function('module', 'exports', 'require', buildSync({ entryPoints: [path.join(root, 'src', 'lib', 'salesCustomerSearch.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error' }).outputFiles[0].text)(clauseModule, clauseModule.exports, require)
    const pickerModule = { exports: {} }
    new Function('module', 'exports', 'require', buildSync({ entryPoints: [path.join(root, 'src', 'lib', 'contactPicker.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error' }).outputFiles[0].text)(pickerModule, pickerModule.exports, require)
    // The picker's own SQL without the rank, run straight on D1: the plain order, and what it reads.
    const direct = async (search) => {
      const match = clauseModule.exports.buildSalesCustomerMatchClause(search)
      const order = []
      const sql = pickerModule.exports.buildSalesCustomerPickerSql([match.sql]).replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => { let i = order.indexOf(name); if (i < 0) { order.push(name); i = order.length - 1 } return '?' + (i + 1) })
      const result = await db.prepare(sql).bind(...order.map((name) => (name === 'limit' ? 50 : match.params[name]))).all()
      return { names: result.results.map((row) => row.name), rows: result.meta.rows_read }
    }

    await list('warm-up', HOLDER)
    const measured = {}
    const record = (key, r) => { measured[key] = r; console.log(`     ${key}: ${r.rows} rows, ${r.statements} statements`) }
    record('contacts digit, holder (012345678)', await list('012345678', HOLDER))
    record('contacts digit, holder (345678, a fragment)', await list('345678', HOLDER))
    record('contacts digit, no grant (whole number 012345678)', await list('012345678', NO_GRANT))
    record('contacts digit, no grant (345678, a fragment)', await list('345678', NO_GRANT))
    record('contacts digit, no grant (5678, the last four)', await list('5678', NO_GRANT))
    record('contacts name (dara)', await list('dara', HOLDER))
    record('picker digit, holder (012345678)', await picker('012345678', HOLDER))
    record('picker digit, no grant (012345678)', await picker('012345678', NO_GRANT))
    record('picker digit, no grant (5678, the last four)', await picker('5678', NO_GRANT))
    record('picker name (dara)', await picker('dara', HOLDER))
    record('picker name, ten people share the word (lee)', await picker('lee', HOLDER))
    if (reportOnly) return

    const ids = (r) => (r.body.items || []).map((row) => row.id)
    let failed = 0
    const check = async (name, fn) => { try { await fn(); console.log('PASS ' + name) } catch (error) { failed += 1; console.log('FAIL ' + name + '\n' + (error && error.stack || error)) } }
    // No literal row count: every bound is built from the name search on the same fixture and the page size.
    const nameRows = measured['contacts name (dara)'].rows
    const indexed = nameRows + 2 * PAGE_SIZE
    assert.ok(indexed < CUSTOMERS / 4, 'the fixture is large enough for the bound to mean something')

    await check('Contacts list: a typed number finds the same customers as before and reads near its matches', async () => {
      const whole = await list('012345678', HOLDER)
      assert.equal(whole.status, 200, JSON.stringify(whole.body))
      assert.deepEqual(ids(whole), [5])
      assert.equal(whole.body.total, 1)
      assert.deepEqual(whole.body.availableYears, ['2026'])
      assert.deepEqual(ids(await list('345679', HOLDER)), [6])
      assert.deepEqual(ids(await list('345678', HOLDER)), [5])
      assert.deepEqual(ids(await list('012345678', NO_GRANT)), [5])
      assert.deepEqual(ids(await list('345678', NO_GRANT)), [5], 'owner decision 10 Nov 2026: a fragment finds the customer without the grant')
      assert.deepEqual(ids(await list('5678', NO_GRANT)), ids(await list('5678', HOLDER)))
      assert.deepEqual(ids(await list('012333444', HOLDER)), [7], 'JSON escapes of a tab in a stored Contact Option phone are not part of the digits')
      assert.deepEqual(ids(await list('012333444', NO_GRANT)), [7])
      for (const key of Object.keys(measured).filter((name) => name.startsWith('contacts digit'))) assert.ok(measured[key].rows <= indexed, `${key} read ${measured[key].rows} rows (a name search reads ${nameRows})`)
      assert.ok(measured['contacts digit, no grant (345678, a fragment)'].rows <= measured['contacts digit, holder (345678, a fragment)'].rows, 'no grant reads no more than the holder')
    })

    await check('a number saved with no-break spaces, in Khmer digits or as 00855 is found by the number typed in Latin digits', async () => {
      for (const access of [HOLDER, NO_GRANT]) {
        assert.deepEqual(ids(await list('012333555', access)), [8], 'no-break spaces')
        assert.deepEqual(ids(await list('012333666', access)), [9], 'Khmer digits')
        assert.deepEqual(ids(await list('012345690', access)), [10], '00855 form')
        assert.deepEqual(ids(await list('012777888', access)), [11], 'Contact Option phone with no-break spaces')
        assert.deepEqual(ids(await list('+855 12 333 555', access)), [8])
        assert.deepEqual(ids(await picker('012333666', access)), [9], 'the picker agrees')
      }
      assert.deepEqual(ids(await list('333555', HOLDER)), [8])
      assert.deepEqual(ids(await list('333555', NO_GRANT)), [8], 'a fragment finds the customer without the grant too')
      assert.deepEqual(ids(await list('333666', NO_GRANT)), [9])
    })

    await check('Contacts list: a digit search costs the statements a name search costs, within the query ceiling', async () => {
      for (const key of Object.keys(measured).filter((name) => name.startsWith('contacts digit'))) {
        assert.ok(measured[key].statements <= measured['contacts name (dara)'].statements, `${key}: ${measured[key].statements} statements, name list ${measured['contacts name (dara)'].statements}`)
        assert.ok(measured[key].statements <= measured[key].ceiling, `${measured[key].statements} statements beside a ceiling of ${measured[key].ceiling}`)
      }
    })

    await check('Contacts list: a year filter and paging still work on a digit search', async () => {
      const all = await list('097', HOLDER)
      assert.equal(all.status, 200)
      const years = all.body.availableYears
      assert.deepEqual(years, ['2026', '2025', '2024'])
      const filtered = await list('097', HOLDER, '&year=2025')
      assert.ok(filtered.body.total < all.body.total && filtered.body.total > 0)
      assert.deepEqual(filtered.body.availableYears, years, 'the facet ignores the year filter')
      const secondPage = await call(`/customers?search=097&page=2&pageSize=${PAGE_SIZE}`, HOLDER)
      const firstPage = await list('097', HOLDER)
      assert.equal(secondPage.body.items.length, PAGE_SIZE)
      assert.equal(new Set([...ids(firstPage), ...ids(secondPage)]).size, 2 * PAGE_SIZE, 'pages do not overlap')
      const names = firstPage.body.items.map((row) => String(row.name).toLowerCase())
      assert.deepEqual(names, [...names].sort(), 'name order')
    })

    await check('Sales/POS picker: a digit search reads near its matches', async () => {
      const pickerName = measured['picker name (dara)']
      for (const key of ['picker digit, holder (012345678)', 'picker digit, no grant (012345678)', 'picker digit, no grant (5678, the last four)']) {
        assert.ok(measured[key].rows <= pickerName.rows + PAGE_SIZE, `${key} read ${measured[key].rows} rows (a name search reads ${pickerName.rows})`)
        assert.equal(measured[key].statements <= pickerName.statements, true)
      }
      assert.deepEqual((await picker('012345678', HOLDER)).body.items.map((r) => r.id), [5])
    })

    await check('Sales/POS picker: the name typed in full ranks first, then names that start with it, whatever the alphabet says, at no extra read', async () => {
      const names = (r) => r.body.items.map((row) => row.name)
      const alphabetical = ['Aaron Lee', 'Amy Lee', 'Anna Lee', 'Bora Lee', 'Chan Lee', 'Eang Lee', 'Fern Lee', 'Gina Lee', 'Lee', 'Leesa']
      const ranked = await picker('lee', HOLDER)
      assert.deepEqual(names(ranked), ['Lee', 'Leesa', ...alphabetical.slice(0, 8)])
      const topSix = await call('/customers?fields=sales_picker&limit=6&search=lee', HOLDER)
      assert.deepEqual(names(topSix), ['Lee', 'Leesa', 'Aaron Lee', 'Amy Lee', 'Anna Lee', 'Bora Lee'], 'the POS shows six: the typed name is among them')
      assert.deepEqual(names(await picker(' LEE ', NO_GRANT)), ['Lee', 'Leesa', ...alphabetical.slice(0, 8)], 'case and spaces around the search do not matter')
      assert.deepEqual(names(await picker('amy lee', HOLDER)), ['Amy Lee'])
      assert.deepEqual(names(await picker('lee', HOLDER)).length, 10)
      const unranked = await direct('lee')
      assert.deepEqual(unranked.names, alphabetical, 'the unranked order is the alphabetical one the picker had')
      assert.ok(ranked.rows <= unranked.rows, `ranking read ${ranked.rows} rows, the plain order read ${unranked.rows}`)
    })

    await check('a name search reads what it read before (index only, far below a table scan)', async () => {
      assert.ok(measured['contacts name (dara)'].rows < CUSTOMERS / 2, `${measured['contacts name (dara)'].rows} rows`)
      assert.ok(measured['picker name (dara)'].rows < CUSTOMERS / 2)
    })

    await check('a number held by nobody reads next to nothing, and a table twice the size reads the same rows', async () => {
      const miss = await picker('099999999', HOLDER)
      assert.deepEqual(miss.body.items, [])
      assert.ok(miss.rows <= PAGE_SIZE, `a miss read ${miss.rows} rows for ${CUSTOMERS} customers`)
      const before = { whole: (await picker('012345678', HOLDER)).rows, fragment: (await picker('345678', NO_GRANT)).rows, miss: miss.rows }
      const more = []
      for (let i = 1; i <= CUSTOMERS; i++) more.push(db.prepare('INSERT INTO customers (id,name,phone,phone_normalized,address,is_anonymous) VALUES (?,?,?,?,?,0)').bind(1000 + i, `Extra ${i}`, `098 ${pad(i * 53, 3)} ${pad(i * 7, 3)}`, `098${pad(i * 53, 3)}${pad(i * 7, 3)}`, i % 3 === 0 ? JSON.stringify([{ label: 'Main', phone: '096111333' }]) : null))
      await db.batch(more)
      const after = { whole: (await picker('012345678', HOLDER)).rows, fragment: (await picker('345678', NO_GRANT)).rows, miss: (await picker('099999999', HOLDER)).rows }
      assert.deepEqual(after, before, 'the rows read do not grow with the table')
      assert.deepEqual((await picker('098 053 007', HOLDER)).body.items.map((r) => r.id), [1001], 'a customer added after the index exists is found at once')
    })

    if (failed) { console.error(`${failed} check(s) failed`); process.exitCode = 1 } else console.log('PASS contacts digit-search read pins')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
