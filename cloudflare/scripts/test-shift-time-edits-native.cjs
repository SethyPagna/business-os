// Who may change a shift's opening and closing time, and what an administrator's change leaves behind.
// A shift's drawer is the sales, returns and expenses recorded between its opening and its closing, so a
// time an employee chooses can hide cash. An employee closes now and never edits either time (409 with a
// code, nothing written); every other amend field stays open to them. An administrator may move a time,
// and a move that leaves money records outside every shift is flagged durably.
//
// The real Worker (src/index.ts, real auth and sessions) on a Miniflare D1 with every migration applied.
// Sales are written straight into D1 with the created_at the scenario needs. Nothing leaves the process:
// outbound fetches are recorded and refused, and no Telegram chat is configured.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const ORIGIN = 'https://admin.shift-time-edits.example'
const MIN = 60_000
const stored = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: "import worker from './src/index.ts'; export default worker" },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:workers'], logLevel: 'silent' })
  const outbound = []
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], cache: false, bindings: { PLAN_TIER: 'paid', BUSINESS_OS_ADMIN_URL: ORIGIN },
    outboundService: (request) => { outbound.push(request.url); return new Response('refused', { status: 503 }) }, log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    for (const name of fs.readdirSync(path.join(root, 'migrations')).filter((file) => file.endsWith('.sql')).sort()) {
      for (const statement of split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
        await db.prepare(statement).run()
      }
    }
    const first = (sql, ...values) => db.prepare(sql).bind(...values).first()
    const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results
    const roleId = async (code, permissions) => {
      await db.prepare('INSERT OR IGNORE INTO roles(code,name,permissions) VALUES(?,?,?)').bind(code, code, permissions).run()
      return (await first('SELECT id FROM roles WHERE code=?', code)).id
    }
    const employeeRole = await roleId('shift_time_edits_employee', '{"pos":true,"sales":true}')
    const adminRole = await roleId('admin', '{"all":true}')
    const people = {}
    const addPerson = async (key, id, role, permissions) => {
      const token = `shift-time-edits-${key}`
      await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(?,?,?,'fixture',?,?,1)")
        .bind(id, `cashier_${key}`, `Cashier ${key}`, role, permissions).run()
      await db.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)')
        .bind(id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() - 3600000).toISOString(),
          new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()).run()
      people[key] = { id, token }
    }
    await addPerson('admin', 90, adminRole, '{"all":true}')
    for (const [index, key] of ['b1', 'b2', 'b3', 'b4'].entries()) await addPerson(key, 41 + index, employeeRole, '{"pos":true,"sales":true}')
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
    const openShift = async (who, openedMinutesAgo) => {
      const opened = await call(who, 'POST', '/open', { branch_id: 1, opening_float_usd: 50, opening_float_khr: 0 })
      assert.equal(opened.status, 201, opened.text)
      const id = opened.json.shift.id
      const openedAt = new Date(Date.now() - openedMinutesAgo * MIN).toISOString()
      await db.prepare("UPDATE shift_sessions SET opened_at=?, business_date=date(?, '+7 hours') WHERE id=?").bind(openedAt, openedAt, id).run()
      return id
    }
    const sell = (who, minutesAgo, usd = 5) => db.prepare(`INSERT INTO sales(created_at,sale_status,branch_id,cashier_id,payment_method,amount_paid_usd,amount_paid_khr,total_usd,exchange_rate)
      VALUES(?,'completed',1,?, 'Cash',?,0,?,4000)`).bind(stored(Date.now() - minutesAgo * MIN), people[who].id, usd, usd).run()
    const rowOf = (id) => first('SELECT * FROM shift_sessions WHERE id=?', id)
    const amendmentCount = async (id) => (await first('SELECT COUNT(*) AS n FROM shift_session_amendments WHERE shift_session_id=?', id)).n
    const orphanCount = async (who) => (await first(`SELECT COUNT(*) AS n FROM sales s WHERE s.cashier_id=? AND NOT EXISTS (SELECT 1 FROM shift_sessions h WHERE h.user_id=s.cashier_id
      AND datetime(s.created_at) >= datetime(h.opened_at) AND datetime(s.created_at) < datetime(COALESCE(h.closed_at, '9999-12-31')))`, people[who].id)).n
    const untouched = async (label, id, work) => {
      const [row, journal] = [await rowOf(id), await amendmentCount(id)]
      await work()
      assert.deepEqual(await rowOf(id), row, `${label}: the shift row is untouched`)
      assert.equal(await amendmentCount(id), journal, `${label}: nothing was journaled`)
    }
    const refused = (label, response, code) => {
      assert.equal(response.status, 409, `${label}: ${response.text}`)
      assert.equal(response.json.code, code, `${label}: ${response.text}`)
      assert.ok(response.json.error, `${label}: carries an English fallback`)
    }
    const amend = (who, id, patch) => call(who, 'PATCH', `/${id}`, { reason: 'Fix', ...patch })

    const failures = []
    const check = async (name, work) => {
      try { await work() } catch (error) { failures.push(`${name}: ${String(error.message).split('\n')[0].slice(0, 300)}`) }
    }

    // ---- B1 / B2: an employee never edits either time ------------------------------------------
    const b1 = await openShift('b1', 40)
    await sell('b1', 30)
    await sell('b1', 20)
    const closedB1 = await call('b1', 'POST', `/${b1}/close`, { expected_revision: 0, closing_counted_usd: 60, closing_counted_khr: 0 })
    assert.equal(closedB1.status, 200, closedB1.text)

    await check('B1: an employee moving the close of a closed shift into the past is refused, nothing written', () => untouched('closed_at earlier', b1, async () => {
      const revision = (await rowOf(b1)).revision
      refused('closed_at now-20min', await amend('b1', b1, { expected_revision: revision, closed_at: new Date(Date.now() - 20 * MIN).toISOString() }), 'shift_time_admin_only')
    }))
    await check('B1: an employee moving the close LATER is refused too (the time is not theirs to edit)', () => untouched('closed_at later', b1, async () => {
      const row = await rowOf(b1)
      refused('closed_at later', await amend('b1', b1, { expected_revision: row.revision, closed_at: new Date(Date.parse(row.closed_at) + 30_000).toISOString() }), 'shift_time_admin_only')
    }))
    await check('B2: an employee moving the opening of a closed shift later (hiding both sales) is refused, nothing written', () => untouched('opened_at later', b1, async () => {
      const revision = (await rowOf(b1)).revision
      refused('opened_at now-5min', await amend('b1', b1, { expected_revision: revision, opened_at: new Date(Date.now() - 5 * MIN).toISOString() }), 'shift_time_admin_only')
      assert.equal(await orphanCount('b1'), 0, 'no sale was pushed outside the shift')
    }))
    await check('B2: an employee moving the opening of an OPEN shift later is refused, nothing written', async () => {
      const open = await openShift('b2', 40)
      await sell('b2', 30)
      await sell('b2', 20)
      await untouched('open shift opened_at later', open, async () => {
        refused('open opened_at', await amend('b2', open, { expected_revision: 0, opened_at: new Date(Date.now() - 5 * MIN).toISOString() }), 'shift_time_admin_only')
      })
    })
    await check('control: an employee amending a note and the counts, sending the stored times back unchanged, still succeeds', async () => {
      const row = await rowOf(b1)
      const done = await amend('b1', b1, { expected_revision: row.revision, opened_at: new Date(Date.parse(row.opened_at)).toISOString(),
        closed_at: new Date(Date.parse(row.closed_at)).toISOString(), closing_note: 'Counted twice', closing_counted_usd: 61 })
      assert.equal(done.status, 200, done.text)
      const after = await rowOf(b1)
      assert.equal(after.closing_note, 'Counted twice')
      assert.equal(after.opened_at, row.opened_at)
      assert.equal(after.closed_at, row.closed_at)
    })
    await check('control: an employee amending only a note (no time sent) still succeeds', async () => {
      const row = await rowOf(b1)
      const done = await amend('b1', b1, { expected_revision: row.revision, opening_note: 'Float from the safe' })
      assert.equal(done.status, 200, done.text)
    })
    await check('control: an administrator may move the close of the same shift', async () => {
      const row = await rowOf(b1)
      const done = await amend('admin', b1, { expected_revision: row.revision, closed_at: new Date(Date.parse(row.closed_at) - 2 * MIN).toISOString() })
      assert.equal(done.status, 200, done.text)
    })

    // (later rounds of this file append their scenarios here)

    await check('nothing left the process', async () => assert.deepEqual(outbound, []))
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
    console.log('PASS shift time edits: an employee cannot change opened_at or closed_at by amend (409 shift_time_admin_only, nothing written); other amend fields and an administrator are unaffected')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
