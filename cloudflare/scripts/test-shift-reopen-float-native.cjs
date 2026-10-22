// A reopened shift segment is the SAME physical drawer, so it opens with the cash counted when the parent closed.
// A sale rung between the close and the reopen is cash already in the drawer; a fresh count typed at the reopen
// holds it, and the segment's window (it opens at the parent's close) counts it again -- a false shortage equal to
// every sale in between, unflagged. The Worker takes the opening float from the parent's stored count, ignores a
// typed one, and refuses a reopen when the parent has no count.
//
// The real Worker (src/index.ts, real auth and sessions) on a Miniflare D1 with every migration applied. Sales are
// written straight into D1 with the created_at the scenario needs. Nothing leaves the process.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const { shiftClock } = require('./shift-clock-fixture.cjs')
const clock = shiftClock()
const Date = clock.Date

const root = path.resolve(__dirname, '..')
const ORIGIN = 'https://admin.shift-reopen-float.example'
const MIN = 60_000
const stored = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: clock.entry }, banner: { js: clock.prelude },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:workers'], logLevel: 'silent' })
  const outbound = []
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], cache: false, bindings: { PLAN_TIER: 'paid', BUSINESS_OS_ADMIN_URL: ORIGIN },
    outboundService: async (request) => { outbound.push(request.url); return new Response('refused', { status: 503 }) }, log: new Log(LogLevel.ERROR) })
  try {
    const rawDb = await mf.getD1Database('DB')
    for (const name of fs.readdirSync(path.join(root, 'migrations')).filter((file) => file.endsWith('.sql')).sort()) {
      for (const statement of split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))) {
        await rawDb.prepare(statement).run()
      }
    }
    const db = clock.database(rawDb)
    const first = (sql, ...values) => db.prepare(sql).bind(...values).first()
    const clockState = await (await mf.dispatchFetch(`${ORIGIN}/__fixture_clock`)).json()
    assert.ok(Math.abs(clockState.now - Date.now()) < 1000, 'Worker and host use one advancing clock')
    assert.equal(clockState.sql.business_date, '2026-10-18')
    assert.equal((await first("SELECT date('now', '+7 hours') AS day")).day, clockState.sql.business_date)
    assert.ok(Math.abs(Date.parse(clockState.sql.now.replace(' ', 'T') + 'Z') - Date.now()) < 2000)
    const roleId = async (code, permissions) => {
      await db.prepare('INSERT OR IGNORE INTO roles(code,name,permissions) VALUES(?,?,?)').bind(code, code, permissions).run()
      return (await first('SELECT id FROM roles WHERE code=?', code)).id
    }
    const employeeRole = await roleId('shift_reopen_float_employee', '{"pos":true,"sales":true}')
    const adminRole = await roleId('admin', '{"all":true}')
    const people = {}
    const addPerson = async (key, id, role, permissions) => {
      const token = `shift-reopen-float-${key}`
      await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(?,?,?,'fixture',?,?,1)")
        .bind(id, `cashier_${key}`, `Cashier ${key}`, role, permissions).run()
      await db.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)')
        .bind(id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() - 3600000).toISOString(),
          new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()).run()
      people[key] = { id, token }
    }
    await addPerson('admin', 90, adminRole, '{"all":true}')
    for (const [index, key] of ['gap', 'gapshort', 'early', 'nocount', 'partial'].entries()) await addPerson(key, 41 + index, employeeRole, '{"pos":true,"sales":true}')
    await db.prepare("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(1,'Shop','shop',1,1)").run()
    await db.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_methods','[\"Cash\",\"ABA\"]') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()

    const call = async (who, method, route, body) => {
      const response = await mf.dispatchFetch(`${ORIGIN}/api/shifts${route}`, { method,
        headers: { cookie: `bos_session=${people[who].token}`, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await response.text()
      let json = null; try { json = JSON.parse(text) } catch { /* not JSON */ }
      return { status: response.status, json, text }
    }
    const openShift = async (who, openedMinutesAgo, usd, khr) => {
      const opened = await call(who, 'POST', '/open', { branch_id: 1, opening_float_usd: usd, opening_float_khr: khr })
      assert.equal(opened.status, 201, opened.text)
      const id = opened.json.shift.id
      const openedAt = new Date(Date.now() - openedMinutesAgo * MIN).toISOString()
      await db.prepare("UPDATE shift_sessions SET opened_at=?, business_date=date(?, '+7 hours') WHERE id=?").bind(openedAt, openedAt, id).run()
      return id
    }
    const sell = (who, minutesAgo, usd) => db.prepare(`INSERT INTO sales(created_at,sale_status,branch_id,cashier_id,payment_method,amount_paid_usd,amount_paid_khr,total_usd,exchange_rate)
      VALUES(?,'completed',1,?, 'Cash',?,0,?,4000)`).bind(stored(Date.now() - minutesAgo * MIN), people[who].id, usd, usd).run()
    const rowOf = (id) => first('SELECT * FROM shift_sessions WHERE id=?', id)
    const revisionOf = async (id) => (await rowOf(id)).revision
    const moveClose = async (id, minutesAgo) => db.prepare('UPDATE shift_sessions SET closed_at=? WHERE id=?').bind(new Date(Date.now() - minutesAgo * MIN).toISOString(), id).run()
    const reconciliationOf = async (id) => (await call('admin', 'GET', `/${id}/history`)).json.shift.reconciliation
    const reopen = async (who, id, typed) => call(who, 'POST', `/${id}/reopen`, { expected_revision: await revisionOf(id), reason: 'A sale after the close',
      ...(typed ? { opening_float_usd: typed.usd, opening_float_khr: typed.khr } : {}) })

    const failures = []
    const check = async (name, work) => {
      try { await work() } catch (error) { failures.push(`${name}: ${String(error.message).split('\n')[0].slice(0, 400)}`) }
    }

    await check('a $5 sale after the close, the cashier recounts $60 at the reopen: the segment opens at the counted close, difference 0', async () => {
      const parent = await openShift('gap', 60, 50, 20000)
      await sell('gap', 50, 5)
      const closed = await call('gap', 'POST', `/${parent}/close`, { expected_revision: 0, closing_counted_usd: 55, closing_counted_khr: 20000 })
      assert.equal(closed.status, 200, closed.text)
      await moveClose(parent, 20)
      await sell('gap', 10, 5)
      const reopened = await reopen('gap', parent, { usd: 60, khr: 20000 })
      assert.equal(reopened.status, 201, reopened.text)
      assert.equal(reopened.json.shift.opening_float_usd, 55, 'the typed 60 is ignored; the segment opens with the parent count')
      assert.equal(reopened.json.shift.opening_float_khr, 20000)
      const child = reopened.json.shift
      const done = await call('gap', 'POST', `/${child.id}/close`, { expected_revision: child.revision, closing_counted_usd: 60, closing_counted_khr: 20000 })
      assert.equal(done.status, 200, done.text)
      const figures = await reconciliationOf(child.id)
      assert.deepEqual(figures.opening, { usd: 55, khr: 20000 })
      assert.deepEqual(figures.cash_sales, { usd: 5, khr: 0 })
      assert.deepEqual(figures.expected, { usd: 60, khr: 20000 })
      assert.deepEqual(figures.difference, { usd: 0, khr: 0 })
    })

    await check('a real shortage at the child close still shows (counted $58 against an expected $60)', async () => {
      const parent = await openShift('gapshort', 60, 50, 0)
      await sell('gapshort', 50, 5)
      assert.equal((await call('gapshort', 'POST', `/${parent}/close`, { expected_revision: 0, closing_counted_usd: 55, closing_counted_khr: 0 })).status, 200)
      await moveClose(parent, 20)
      await sell('gapshort', 10, 5)
      const reopened = await reopen('gapshort', parent)
      assert.equal(reopened.status, 201, reopened.text)
      const child = reopened.json.shift
      assert.equal((await call('gapshort', 'POST', `/${child.id}/close`, { expected_revision: child.revision, closing_counted_usd: 58, closing_counted_khr: 0 })).status, 200)
      assert.deepEqual((await reconciliationOf(child.id)).difference, { usd: -2, khr: 0 })
    })

    await check('an administrator closed early, $21 was sold since, the employee recounts $71: the difference is 0', async () => {
      const parent = await openShift('early', 180, 50, 0)
      await sell('early', 150, 5)
      const closed = await call('admin', 'POST', `/${parent}/close`, { expected_revision: 0, closed_at: new Date(Date.now() - 110 * MIN).toISOString(), closing_counted_usd: 55, closing_counted_khr: 0 })
      assert.equal(closed.status, 200, closed.text)
      await sell('early', 60, 21)
      const reopened = await reopen('early', parent, { usd: 76, khr: 0 })
      assert.equal(reopened.status, 201, reopened.text)
      assert.equal(reopened.json.shift.opening_float_usd, 55)
      const child = reopened.json.shift
      assert.equal((await call('early', 'POST', `/${child.id}/close`, { expected_revision: child.revision, closing_counted_usd: 76, closing_counted_khr: 0 })).status, 200)
      const figures = await reconciliationOf(child.id)
      assert.deepEqual(figures.cash_sales, { usd: 21, khr: 0 })
      assert.deepEqual(figures.difference, { usd: 0, khr: 0 })
    })

    await check('a parent closed without a count cannot be reopened: 409 shift_reopen_needs_count, no segment written', async () => {
      const parent = await openShift('nocount', 60, 50, 0)
      assert.equal((await call('nocount', 'POST', `/${parent}/close`, { expected_revision: 0 })).status, 200)
      const before = (await first('SELECT COUNT(*) AS n FROM shift_sessions')).n
      const refused = await reopen('nocount', parent, { usd: 50, khr: 0 })
      assert.equal(refused.status, 409, refused.text)
      assert.equal(refused.json.code, 'shift_reopen_needs_count')
      assert.ok(refused.json.error, 'carries an English fallback')
      assert.equal((await first('SELECT COUNT(*) AS n FROM shift_sessions')).n, before, 'nothing was written')
    })

    await check('a parent counted in dollars only reopens with dollars; the riel opening stays unknown', async () => {
      const parent = await openShift('partial', 60, 50, 0)
      assert.equal((await call('partial', 'POST', `/${parent}/close`, { expected_revision: 0, closing_counted_usd: 52 })).status, 200)
      const reopened = await reopen('partial', parent, { usd: 99, khr: 99000 })
      assert.equal(reopened.status, 201, reopened.text)
      const row = await rowOf(reopened.json.shift.id)
      assert.equal(row.opening_float_usd, 52)
      assert.equal(row.opening_float_usd_registered, 1)
      assert.equal(row.opening_float_khr_registered, 0, 'the typed riel is not taken as a count')
    })

    await check('nothing left the process', async () => assert.deepEqual(outbound, []))
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
    console.log('PASS shift reopen float: the segment opens with the parent counted close (a typed float is ignored), a gap sale and an early admin close both reconcile to 0, a real shortage still shows, no count refuses the reopen')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
