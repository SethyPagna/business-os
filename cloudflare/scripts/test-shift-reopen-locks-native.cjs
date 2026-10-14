// A reopened segment copies its parent's counted close once. If either side is edited afterwards the segment is
// left on a stale copy: a parent count amended from 60 to 55 leaves the child opening at 60, a false unflagged
// shortage at its close; a child float amended to 99 undoes the guarantee that it opens where the parent ended.
// So the Worker refuses both, for everyone, with a code the app translates and a way through in the sentence.
// The replacement shift opened after a CANCELLATION is a different thing (its float is typed), and stays editable.
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
const ORIGIN = 'https://admin.shift-reopen-locks.example'
const MIN = 60_000
const stored = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')

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
    const employeeRole = await roleId('shift_reopen_locks_employee', '{"pos":true,"sales":true}')
    const adminRole = await roleId('admin', '{"all":true}')
    const people = {}
    const addPerson = async (key, id, role, permissions) => {
      const token = `shift-reopen-locks-${key}`
      await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(?,?,?,'fixture',?,?,1)")
        .bind(id, `cashier_${key}`, `Cashier ${key}`, role, permissions).run()
      await db.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)')
        .bind(id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() - 3600000).toISOString(),
          new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()).run()
      people[key] = { id, token }
    }
    await addPerson('admin', 90, adminRole, '{"all":true}')
    for (const [index, key] of ['count', 'repl'].entries()) await addPerson(key, 41 + index, employeeRole, '{"pos":true,"sales":true}')
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
    const amendments = async (id) => (await first('SELECT COUNT(*) AS n FROM shift_session_amendments WHERE shift_session_id=?', id)).n
    const amend = async (who, id, fields) => call(who, 'PATCH', `/${id}`, { expected_revision: (await rowOf(id)).revision, reason: 'A correction', ...fields })

    const failures = []
    const check = async (name, work) => {
      try { await work() } catch (error) { failures.push(`${name}: ${String(error.message).split('\n')[0].slice(0, 400)}`) }
    }

    const parent = await openShift('count', 60, 50, 0)
    await sell('count', 50, 5)
    assert.equal((await call('count', 'POST', `/${parent}/close`, { expected_revision: 0, closing_counted_usd: 60, closing_counted_khr: 0 })).status, 200)
    await db.prepare('UPDATE shift_sessions SET closed_at=? WHERE id=?').bind(new Date(Date.now() - 20 * MIN).toISOString(), parent).run()
    const reopened = await call('count', 'POST', `/${parent}/reopen`, { expected_revision: (await rowOf(parent)).revision, reason: 'A sale after the close' })
    assert.equal(reopened.status, 201, reopened.text)
    const child = reopened.json.shift.id
    assert.equal(reopened.json.shift.opening_float_usd, 60)

    await check('the count of a parent that has a reopened segment cannot be amended, by the cashier or an administrator', async () => {
      for (const who of ['count', 'admin']) {
        const before = await amendments(parent)
        const refused = await amend(who, parent, { closing_counted_usd: 55, closing_counted_khr: 0 })
        assert.equal(refused.status, 409, `${who}: ${refused.text}`)
        assert.equal(refused.json.code, 'shift_count_locked_by_reopen')
        assert.ok(/reopened/i.test(refused.json.error) && /administrator|reopened shift/i.test(refused.json.error), 'the English fallback names the way through')
        assert.equal((await rowOf(parent)).closing_counted_usd, 60, 'the count is untouched')
        assert.equal(await amendments(parent), before, 'no amendment was written')
      }
    })

    await check('the rest of that parent can still be amended (a note), and an unchanged count is not a change', async () => {
      const done = await amend('count', parent, { opening_note: 'counted twice', closing_counted_usd: 60, closing_counted_khr: 0 })
      assert.equal(done.status, 200, done.text)
      assert.equal((await rowOf(parent)).opening_note, 'counted twice')
    })

    await check('the opening float of a reopened segment cannot be amended, by the cashier or an administrator', async () => {
      for (const who of ['count', 'admin']) {
        const before = await amendments(child)
        const refused = await amend(who, child, { opening_float_usd: 99, opening_float_khr: 0 })
        assert.equal(refused.status, 409, `${who}: ${refused.text}`)
        assert.equal(refused.json.code, 'shift_opening_float_locked_by_reopen')
        assert.equal((await rowOf(child)).opening_float_usd, 60, 'the float is untouched')
        assert.equal(await amendments(child), before)
      }
    })

    await check('the way through works: the segment can still be closed, and its own count amended', async () => {
      await sell('count', 5, 5)
      const closed = await call('count', 'POST', `/${child}/close`, { expected_revision: (await rowOf(child)).revision, closing_counted_usd: 65, closing_counted_khr: 0 })
      assert.equal(closed.status, 200, closed.text)
      const fixed = await amend('count', child, { closing_counted_usd: 66, closing_counted_khr: 0 })
      assert.equal(fixed.status, 200, fixed.text)
      assert.equal((await rowOf(child)).closing_counted_usd, 66)
    })

    await check('a replacement opened after a cancellation keeps a typed float that can still be amended', async () => {
      const original = await openShift('repl', 30, 50, 0)
      const cancelled = await call('admin', 'POST', `/${original}/cancel`, { expected_revision: 0, reason: 'Opened by mistake' })
      assert.equal(cancelled.status, 200, cancelled.text)
      const replacement = await call('repl', 'POST', '/open', { branch_id: 1, opening_float_usd: 40, opening_float_khr: 0 })
      assert.equal(replacement.status, 201, replacement.text)
      assert.ok((await rowOf(replacement.json.shift.id)).parent_shift_id, 'it is a continuation of the cancelled shift')
      const done = await amend('repl', replacement.json.shift.id, { opening_float_usd: 45, opening_float_khr: 0 })
      assert.equal(done.status, 200, done.text)
      assert.equal((await rowOf(replacement.json.shift.id)).opening_float_usd, 45)
    })

    await check('nothing left the process', async () => assert.deepEqual(outbound, []))
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
    console.log('PASS shift reopen locks: a parent count and a reopened segment float are refused for everyone with a code, the rest still amends, the segment closes and amends its own count, a post-cancellation replacement float stays editable')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
