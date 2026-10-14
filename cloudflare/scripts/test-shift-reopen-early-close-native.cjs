// An administrator closes early (closed_at before the last sales) and counts the drawer as it is NOW. The parent is
// flagged closed_at_earlier_time, but the reopened segment opens with that count and its own window re-counts every
// sale rung after the chosen time: a false shortage equal to those sales, unflagged. The segment now carries a
// review flag (reopened_after_earlier_close) so the difference is flagged, not silent, and its close keeps it. A
// reopen from an ordinary close carries nothing.
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

const root = path.resolve(__dirname, '..')
const ORIGIN = 'https://admin.shift-reopen-early-close.example'
const MIN = 60_000
const stored = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
const FLAG = 'reopened_after_earlier_close'

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: "import worker from './src/index.ts'; export default worker" },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:workers'], logLevel: 'silent' })
  const outbound = []
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], cache: false, bindings: { PLAN_TIER: 'paid', BUSINESS_OS_ADMIN_URL: ORIGIN },
    outboundService: async (request) => { outbound.push(request.url); return new Response('refused', { status: 503 }) }, log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    for (const name of fs.readdirSync(path.join(root, 'migrations')).filter((file) => file.endsWith('.sql')).sort()) {
      for (const statement of split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
        await db.prepare(statement).run()
      }
    }
    const first = (sql, ...values) => db.prepare(sql).bind(...values).first()
    const roleId = async (code, permissions) => {
      await db.prepare('INSERT OR IGNORE INTO roles(code,name,permissions) VALUES(?,?,?)').bind(code, code, permissions).run()
      return (await first('SELECT id FROM roles WHERE code=?', code)).id
    }
    const employeeRole = await roleId('shift_reopen_early_employee', '{"pos":true,"sales":true}')
    const adminRole = await roleId('admin', '{"all":true}')
    const people = {}
    const addPerson = async (key, id, role, permissions) => {
      const token = `shift-reopen-early-${key}`
      await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(?,?,?,'fixture',?,?,1)")
        .bind(id, `cashier_${key}`, `Cashier ${key}`, role, permissions).run()
      await db.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)')
        .bind(id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() - 3600000).toISOString(),
          new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()).run()
      people[key] = { id, token }
    }
    await addPerson('admin', 90, adminRole, '{"all":true}')
    for (const [index, key] of ['early', 'plain'].entries()) await addPerson(key, 41 + index, employeeRole, '{"pos":true,"sales":true}')
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
    const openShift = async (who, openedMinutesAgo, usd) => {
      const opened = await call(who, 'POST', '/open', { branch_id: 1, opening_float_usd: usd, opening_float_khr: 0 })
      assert.equal(opened.status, 201, opened.text)
      const id = opened.json.shift.id
      const openedAt = new Date(Date.now() - openedMinutesAgo * MIN).toISOString()
      await db.prepare("UPDATE shift_sessions SET opened_at=?, business_date=date(?, '+7 hours') WHERE id=?").bind(openedAt, openedAt, id).run()
      return id
    }
    const sell = (who, minutesAgo, usd) => db.prepare(`INSERT INTO sales(created_at,sale_status,branch_id,cashier_id,payment_method,amount_paid_usd,amount_paid_khr,total_usd,exchange_rate)
      VALUES(?,'completed',1,?, 'Cash',?,0,?,4000)`).bind(stored(Date.now() - minutesAgo * MIN), people[who].id, usd, usd).run()
    const rowOf = (id) => first('SELECT * FROM shift_sessions WHERE id=?', id)
    const reconciliationOf = async (id) => (await call('admin', 'GET', `/${id}/history`)).json.shift.reconciliation
    const reopen = async (who, id) => call(who, 'POST', `/${id}/reopen`, { expected_revision: (await rowOf(id)).revision, reason: 'A sale after the close' })

    const failures = []
    const check = async (name, work) => {
      try { await work() } catch (error) { failures.push(`${name}: ${String(error.message).split('\n')[0].slice(0, 400)}`) }
    }

    await check('an administrator closes 110 minutes ago counting the drawer now ($76): the reopened segment shows -$21 and is flagged', async () => {
      const parent = await openShift('early', 180, 50)
      await sell('early', 150, 5)
      await sell('early', 60, 21)
      const closed = await call('admin', 'POST', `/${parent}/close`, { expected_revision: 0, closed_at: new Date(Date.now() - 110 * MIN).toISOString(), closing_counted_usd: 76, closing_counted_khr: 0 })
      assert.equal(closed.status, 200, closed.text)
      const parentFigures = await reconciliationOf(parent)
      assert.ok(parentFigures.review_codes.includes('closed_at_earlier_time'), 'the parent is flagged')
      const reopened = await reopen('early', parent)
      assert.equal(reopened.status, 201, reopened.text)
      const child = reopened.json.shift
      assert.equal(child.opening_float_usd, 76)
      const open = await reconciliationOf(child.id)
      assert.ok(open.review_codes.includes(FLAG), `the open segment already carries the flag: ${open.review_codes}`)
      const done = await call('early', 'POST', `/${child.id}/close`, { expected_revision: (await rowOf(child.id)).revision, closing_counted_usd: 76, closing_counted_khr: 0 })
      assert.equal(done.status, 200, done.text)
      const figures = await reconciliationOf(child.id)
      assert.deepEqual(figures.difference, { usd: -21, khr: 0 }, 'the arithmetic is unchanged: the flag explains it, it does not hide it')
      assert.ok(figures.review_codes.includes(FLAG), `the close keeps the flag: ${figures.review_codes}`)
      assert.equal(figures.needs_review, true)
      const grand = await reopen('early', child.id)
      assert.equal(grand.status, 201, grand.text)
      assert.ok((await reconciliationOf(grand.json.shift.id)).review_codes.includes(FLAG), 'a second reopen inherits it')
    })

    await check('control: a reopen from an ordinary close carries no flag', async () => {
      const parent = await openShift('plain', 60, 50)
      await sell('plain', 50, 5)
      assert.equal((await call('plain', 'POST', `/${parent}/close`, { expected_revision: 0, closing_counted_usd: 55, closing_counted_khr: 0 })).status, 200)
      const reopened = await reopen('plain', parent)
      assert.equal(reopened.status, 201, reopened.text)
      const child = reopened.json.shift
      assert.equal((await call('plain', 'POST', `/${child.id}/close`, { expected_revision: (await rowOf(child.id)).revision, closing_counted_usd: 55, closing_counted_khr: 0 })).status, 200)
      const figures = await reconciliationOf(child.id)
      assert.deepEqual(figures.review_codes, [])
      assert.equal(figures.needs_review, false)
    })

    await check('nothing left the process', async () => assert.deepEqual(outbound, []))
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
    console.log('PASS shift reopen early close: a segment reopened from an earlier-time admin close is flagged (open, closed and re-reopened) with the -$21 difference visible, an ordinary reopen is not')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
