// A shift closed under the retired courier formula (a payout also took its riel twin off the riel drawer) is shown
// as it closed, with no "changed after close" block for a change no record caused, and Telegram /shift prints the
// same figures. History is not rewritten: the stored row is only read under the formula that produced it. A real
// record added after the close still shows, and a new close is stamped with the current formula.
//
// The real Worker (src/index.ts, real auth and sessions) on a Miniflare D1 with every migration applied. A close
// from the retired formula is made by rewriting the stored row exactly as the retired build wrote it (no `formula`
// key, the riel twin in the courier and the expected riel). Telegram is intercepted in process; nothing else leaves.
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
const ORIGIN = 'https://admin.shift-figures-formula.example'
const MIN = 60_000
const stored = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: clock.entry }, banner: { js: clock.prelude },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:workers'], logLevel: 'silent' })
  const outbound = []
  const telegramSent = []
  const BOT_TOKEN = 'test-token-not-real'
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], cache: false, bindings: { PLAN_TIER: 'paid', BUSINESS_OS_ADMIN_URL: ORIGIN, TELEGRAM_BOT_TOKEN: BOT_TOKEN },
    outboundService: async (request) => {
      if (request.url.startsWith('https://api.telegram.org/')) {
        const body = await request.json().catch(() => ({}))
        telegramSent.push(String(body.text || ''))
        return Response.json({ ok: true, result: { message_id: telegramSent.length } })
      }
      outbound.push(request.url)
      return new Response('refused', { status: 503 })
    }, log: new Log(LogLevel.ERROR) })
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
    const employeeRole = await roleId('shift_figures_formula_employee', '{"pos":true,"sales":true}')
    const adminRole = await roleId('admin', '{"all":true}')
    const people = {}
    const addPerson = async (key, id, role, permissions) => {
      const token = `shift-figures-formula-${key}`
      await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(?,?,?,'fixture',?,?,1)")
        .bind(id, `cashier_${key}`, `Cashier ${key}`, role, permissions).run()
      await db.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)')
        .bind(id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() - 3600000).toISOString(),
          new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()).run()
      people[key] = { id, token }
    }
    await addPerson('admin', 90, adminRole, '{"all":true}')
    for (const [index, key] of ['old', 'later', 'courier', 'fresh'].entries()) await addPerson(key, 41 + index, employeeRole, '{"pos":true,"sales":true}')
    await db.prepare("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(1,'Shop','shop',1,1)").run()
    const setting = (key, value) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value).run()
    await setting('pos_payment_methods', '["Cash","ABA"]')
    await setting('telegram_chat_id', '-1001111111111')
    await setting('telegram_language', 'en')
    await setting('telegram_shift_overview_enabled', 'false')

    const call = async (who, method, route, body) => {
      const response = await mf.dispatchFetch(`${ORIGIN}/api/shifts${route}`, { method,
        headers: { cookie: `bos_session=${people[who].token}`, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await response.text()
      let json = null; try { json = JSON.parse(text) } catch { /* not JSON */ }
      return { status: response.status, json, text }
    }
    const historyOf = async (id) => (await call('admin', 'GET', `/${id}/history`)).json.shift
    const sell = (who, minutesAgo, usd, extra = {}) => db.prepare(`INSERT INTO sales(created_at,sale_status,branch_id,cashier_id,payment_method,amount_paid_usd,amount_paid_khr,total_usd,exchange_rate,
        is_delivery,delivery_actual_cost_usd,delivery_actual_cost_khr) VALUES(?,'completed',1,?,'Cash',?,0,?,4000,?,?,?)`)
      .bind(stored(Date.now() - minutesAgo * MIN), people[who].id, usd, usd, extra.costUsd == null ? 0 : 1, extra.costUsd ?? null, extra.costKhr ?? null).run()
    // A drawer of $50 + 20,000 riel, one $10 cash sale with a $1.50 courier (riel twin 6,000), counted at the true drawer.
    const closedShift = async (who) => {
      const opened = await call(who, 'POST', '/open', { branch_id: 1, opening_float_usd: 50, opening_float_khr: 20000 })
      assert.equal(opened.status, 201, opened.text)
      const id = opened.json.shift.id
      const openedAt = new Date(Date.now() - 60 * MIN).toISOString()
      await db.prepare("UPDATE shift_sessions SET opened_at=?, business_date=date(?, '+7 hours') WHERE id=?").bind(openedAt, openedAt, id).run()
      await sell(who, 40, 10, { costUsd: 1.5, costKhr: 6000 })
      const closed = await call(who, 'POST', `/${id}/close`, { expected_revision: 0, closing_counted_usd: 58.5, closing_counted_khr: 20000 })
      assert.equal(closed.status, 200, closed.text)
      return id
    }
    const figuresRow = async (id) => JSON.parse((await first('SELECT figures_json FROM shift_close_figures WHERE shift_session_id=?', id)).figures_json)
    // The row the retired build wrote for that close: the riel twin taken off the riel drawer a second time.
    // The table refuses updates (migration 0237), so the fixture drops that guard, as the migration's own rollback does.
    const asRetiredBuildStored = async (id) => {
      await db.prepare('DROP TRIGGER IF EXISTS shift_close_figures_no_update').run()
      const figures = await figuresRow(id)
      delete figures.formula
      figures.reconciliation.courier.khr = 6000
      figures.reconciliation.expected.khr = 14000
      figures.reconciliation.difference.khr = 6000
      await db.prepare('UPDATE shift_close_figures SET figures_json=? WHERE shift_session_id=?').bind(JSON.stringify(figures), id).run()
    }
    const SECRET = createHash('sha256').update(BOT_TOKEN).digest('hex')
    const shiftCommand = async (code) => {
      const mark = telegramSent.length
      const response = await mf.dispatchFetch(`${ORIGIN}/api/telegram/webhook`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
        body: JSON.stringify({ message: { text: '/shift', chat: { id: -1001111111111 } } }) })
      assert.equal(response.status, 200)
      for (let i = 0; i < 100 && telegramSent.length <= mark; i += 1) await new Promise((done) => setTimeout(done, 100))
      assert.ok(telegramSent.length > mark, 'the /shift reply arrived')
      return telegramSent.slice(mark).join('\n')
    }

    const failures = []
    const check = async (name, work) => {
      try { await work() } catch (error) { failures.push(`${name}: ${String(error.message).split('\n')[0].slice(0, 400)}`) }
    }

    await check('a close made now is stamped with the current formula and balances to 0 / 0', async () => {
      const id = await closedShift('fresh')
      assert.equal((await figuresRow(id)).formula, 2)
      const shift = await historyOf(id)
      assert.deepEqual(shift.reconciliation.courier, { usd: 1.5, khr: 0 })
      assert.deepEqual(shift.reconciliation.difference, { usd: 0, khr: 0 })
      assert.equal(shift.close_drift, null)
    })

    let oldId = null
    await check('a close from the retired formula shows its stored figures and no "changed after close" block', async () => {
      oldId = await closedShift('old')
      await asRetiredBuildStored(oldId)
      const shift = await historyOf(oldId)
      assert.equal(shift.reconciliation_source, 'stored')
      assert.deepEqual(shift.reconciliation.courier, { usd: 1.5, khr: 6000 }, 'the stored figures are shown as stored')
      assert.deepEqual(shift.reconciliation.difference, { usd: 0, khr: 6000 })
      assert.equal(shift.close_drift, null, `no record changed: ${JSON.stringify(shift.close_drift?.components)}`)
      assert.equal('formula' in (await figuresRow(oldId)), false, 'the stored row was not rewritten')
    })

    await check('Telegram /shift prints the stored riel difference of that close, as the report does', async () => {
      assert.ok(oldId, 'the retired close exists')
      const text = await shiftCommand()
      const lines = text.split('\n').filter((line) => /Difference/i.test(line))
      assert.ok(lines.some((line) => /6,000/.test(line)), `a Difference line carries the stored 6,000: ${lines.join(' | ')}`)
    })

    await check('control: a sale added inside the window after a retired-formula close is still flagged', async () => {
      const id = await closedShift('later')
      await asRetiredBuildStored(id)
      await sell('later', 20, 7)
      const shift = await historyOf(id)
      assert.ok(shift.close_drift, 'the added sale shows as drift')
      assert.equal(shift.close_drift.sales_total, 1)
      const keys = shift.close_drift.components.map((component) => component.key)
      assert.ok(keys.includes('cash_sales') && keys.includes('expected'), `cash and expected moved: ${keys}`)
      assert.equal(keys.includes('courier'), false, 'the courier line did not move')
      const expected = shift.close_drift.components.find((component) => component.key === 'expected')
      assert.equal(expected.current.khr, 14000, 'the live riel is read under the retired formula (14,000), not the current one (20,000)')
    })

    await check('control: a courier payout changed after a retired-formula close is still flagged', async () => {
      const id = await closedShift('courier')
      await asRetiredBuildStored(id)
      await db.prepare('UPDATE sales SET delivery_actual_cost_usd=2.5, delivery_actual_cost_khr=10000 WHERE cashier_id=?').bind(people.courier.id).run()
      const shift = await historyOf(id)
      assert.ok(shift.close_drift, 'the edited courier cost shows as drift')
      const courier = shift.close_drift.components.find((component) => component.key === 'courier')
      assert.ok(courier, 'the courier line is in the drift')
      assert.deepEqual(courier.stored, { usd: 1.5, khr: 6000 })
      assert.equal(courier.current.usd, 2.5)
    })

    await check('nothing left the process', async () => assert.deepEqual(outbound, []))
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
    console.log('PASS shift figures formula: a retired-formula close shows as stored with no spurious drift and /shift agrees, a real record or courier edit after it still flags, a new close is stamped formula 2')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
