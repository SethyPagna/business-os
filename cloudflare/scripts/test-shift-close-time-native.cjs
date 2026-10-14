// Who may choose the time a shift closes at. A shift's drawer is the sales, returns and expenses
// recorded between its opening and its closing, so a close at or before the second of one of those
// records leaves it in no shift's expected cash: choosing such a time hides money. A cashier's close
// may not fall at or before the drawer's latest record, nor more than five minutes before now (409,
// a code the app translates, nothing written); an administrator may pick any past time, and that
// close is stored with the review code closed_at_earlier_time.
//
// The real Worker (src/index.ts, real auth and sessions) on a Miniflare D1 with every migration
// applied. Sales are written straight into D1 with the created_at the scenario needs. Nothing leaves
// the process: outbound fetches are recorded and refused, and no Telegram chat is configured.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const ORIGIN = 'https://admin.shift-close-time.example'
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
    const employeeRole = await roleId('shift_close_time_employee', '{"pos":true,"sales":true}')
    const adminRole = await roleId('admin', '{"all":true}')
    const people = {}
    for (const [key, id, role, permissions] of [['emp', 31, employeeRole, '{"pos":true,"sales":true}'], ['emp2', 32, employeeRole, '{"pos":true,"sales":true}'],
      ['emp3', 34, employeeRole, '{"pos":true,"sales":true}'], ['admin', 33, adminRole, '{"all":true}']]) {
      const token = `shift-close-time-${key}`
      await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(?,?,?,'fixture',?,?,1)")
        .bind(id, `cashier_${key}`, `Cashier ${key}`, role, permissions).run()
      await db.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)')
        .bind(id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() - 3600000).toISOString(),
          new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()).run()
      people[key] = { id, token }
    }
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
    // A shift opened through the real route, then backdated so its sales can sit in its past.
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
    const figuresOf = async (id) => {
      const row = await first('SELECT figures_json FROM shift_close_figures WHERE shift_session_id=?', id)
      return row ? JSON.parse(row.figures_json) : null
    }
    const auditCount = async (action) => (await first("SELECT COUNT(*) AS n FROM audit_logs WHERE action=?", action)).n
    const unwritten = async (label, id, work) => {
      const [row, closes, figures] = [await rowOf(id), await auditCount('shift.close'), await first('SELECT COUNT(*) AS n FROM shift_close_figures')]
      await work()
      assert.deepEqual(await rowOf(id), row, `${label}: the shift row is untouched`)
      assert.equal(await auditCount('shift.close'), closes, `${label}: no close was audited`)
      assert.deepEqual(await first('SELECT COUNT(*) AS n FROM shift_close_figures'), figures, `${label}: no figures were stored`)
    }

    const failures = []
    const check = async (name, work) => {
      try { await work() } catch (error) { failures.push(`${name}: ${String(error.message).split('\n')[0].slice(0, 240)}`) }
    }

    // ---- the cashier: opened 20 min ago, two $5 cash sales 12 and 8 minutes ago ----------
    const emp = await openShift('emp', 20)
    await sell('emp', 12)
    await sell('emp', 8)
    const empOpenedAt = (await rowOf(emp)).opened_at
    const early = (extra = {}) => ({ expected_revision: 0, closing_counted_usd: 0, closing_counted_khr: 0, ...extra })
    const refusal = (label, response, code) => {
      assert.equal(response.status, 409, `${label}: ${response.text}`)
      assert.equal(response.json.code, code, `${label}: ${response.text}`)
      assert.ok(response.json.error, `${label}: carries an English fallback`)
    }

    await check('employee closing at the opening time (the cash-hiding close) is refused, nothing written', () => unwritten('closed_at = opened_at', emp, async () => {
      refusal('closed_at = opened_at', await call('emp', 'POST', `/${emp}/close`, early({ closed_at: empOpenedAt })), 'shift_close_before_last_activity')
    }))
    await check('employee closing between the two sales is refused', () => unwritten('between the sales', emp, async () => {
      refusal('between the sales', await call('emp', 'POST', `/${emp}/close`, early({ closed_at: new Date(Date.now() - 10 * MIN).toISOString() })), 'shift_close_before_last_activity')
    }))
    await check('employee closing after the last sale but more than 5 minutes ago is refused', () => unwritten('too early', emp, async () => {
      refusal('too early', await call('emp', 'POST', `/${emp}/close`, early({ closed_at: new Date(Date.now() - 7 * MIN).toISOString() })), 'shift_close_too_early')
    }))
    await check('the sales are still in the open drawer after the refusals', async () => {
      const inWindow = await first(`SELECT COUNT(*) AS n FROM sales WHERE cashier_id=? AND datetime(created_at) >= datetime(?)`, people.emp.id, empOpenedAt)
      assert.equal(inWindow.n, 2)
    })

    await check('employee closing now (no closed_at) is accepted and stores both cash sales', async () => {
      const closed = await call('emp', 'POST', `/${emp}/close`, early({ closing_counted_usd: 60 }))
      assert.equal(closed.status, 200, closed.text)
      const figures = await figuresOf(emp)
      assert.equal(figures.reconciliation.cash_sales.usd, 10, 'both sales are in the stored drawer')
      assert.equal(figures.reconciliation.expected.usd, 60)
      assert.equal(figures.reconciliation.difference.usd, 0)
      assert.equal(figures.reconciliation.needs_review, false)
      assert.deepEqual(figures.reconciliation.review_codes, [])
    })
    await check('no sale of the cashier falls outside every shift window', async () => {
      const orphans = await first(`SELECT COUNT(*) AS n FROM sales s WHERE s.cashier_id=? AND NOT EXISTS (SELECT 1 FROM shift_sessions h WHERE h.user_id=s.cashier_id
        AND datetime(s.created_at) >= datetime(h.opened_at) AND datetime(s.created_at) < datetime(COALESCE(h.closed_at, '9999-12-31')))`, people.emp.id)
      assert.equal(orphans.n, 0)
    })
    await check('employee amending the closed shift\'s close time to before its last sale is refused', () => unwritten('amend closed_at earlier', emp, async () => {
      const revision = (await rowOf(emp)).revision
      const amended = await call('emp', 'PATCH', `/${emp}`, { expected_revision: revision, reason: 'Earlier please', closed_at: new Date(Date.now() - 15 * MIN).toISOString() })
      refusal('amend closed_at earlier', amended, 'shift_close_before_last_activity')
    }))

    // ---- a second cashier: the same early close, by an administrator -------------------
    const emp2 = await openShift('emp2', 20)
    await sell('emp2', 12)
    await sell('emp2', 8)
    const emp2OpenedAt = (await rowOf(emp2)).opened_at
    await check('administrator closing at the opening time is accepted and flagged for review', async () => {
      const closed = await call('admin', 'POST', `/${emp2}/close`, early({ closed_at: emp2OpenedAt, closing_counted_usd: 50 }))
      assert.equal(closed.status, 200, closed.text)
      const figures = await figuresOf(emp2)
      assert.equal(figures.reconciliation.needs_review, true)
      assert.ok(figures.reconciliation.review_codes.includes('closed_at_earlier_time'), JSON.stringify(figures.reconciliation.review_codes))
      assert.equal(figures.reconciliation.cash_sales.usd, 0, 'the administrator chose a time before the sales, so they sit outside this drawer')
    })
    await check('the administrator\'s early close is the only way a sale ends up outside every shift', async () => {
      const orphans = await first(`SELECT COUNT(*) AS n FROM sales s WHERE s.cashier_id=? AND NOT EXISTS (SELECT 1 FROM shift_sessions h WHERE h.user_id=s.cashier_id
        AND datetime(s.created_at) >= datetime(h.opened_at) AND datetime(s.created_at) < datetime(COALESCE(h.closed_at, '9999-12-31')))`, people.emp2.id)
      assert.equal(orphans.n, 2, 'flagged, not hidden: the review code is what tells the owner')
    })

    // ---- a third cashier, an administrator closing normally: no flag ---------------------
    const emp3 = await openShift('emp3', 20)
    await sell('emp3', 12)
    await check('administrator closing now is not flagged', async () => {
      const closed = await call('admin', 'POST', `/${emp3}/close`, early({ closing_counted_usd: 55 }))
      assert.equal(closed.status, 200, closed.text)
      const figures = await figuresOf(emp3)
      assert.equal(figures.reconciliation.needs_review, false)
      assert.deepEqual(figures.reconciliation.review_codes, [])
    })

    await check('nothing left the process', async () => assert.deepEqual(outbound, []))
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
    console.log('PASS shift close time: a cashier cannot close at or before the last sale, return or expense nor 5 minutes into the past (409, nothing written, amend too); '
      + 'a normal close keeps every sale in the drawer; an administrator may pick a past time and the close is flagged closed_at_earlier_time')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
