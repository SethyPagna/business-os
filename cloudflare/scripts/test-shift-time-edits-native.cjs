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
  const telegramSent = []
  const BOT_TOKEN = 'test-token-not-real'
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], cache: false, bindings: { PLAN_TIER: 'paid', BUSINESS_OS_ADMIN_URL: ORIGIN, TELEGRAM_BOT_TOKEN: BOT_TOKEN },
    outboundService: async (request) => {
      if (request.url.startsWith('https://api.telegram.org/')) {
        const body = await request.json().catch(() => ({}))
        telegramSent.push({ text: String(body.text || ''), thread: body.message_thread_id })
        return Response.json({ ok: true, result: { message_id: telegramSent.length } })
      }
      outbound.push(request.url)
      return new Response('refused', { status: 503 })
    }, log: new Log(LogLevel.ERROR) })
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
    for (let index = 1; index <= 8; index += 1) await addPerson('tie' + index, 50 + index, employeeRole, '{"pos":true,"sales":true}')
    await db.prepare("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(1,'Shop','shop',1,1)").run()
    await db.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_methods','[\"Cash\",\"ABA\"]') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const setting = (key, value) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value).run()
    await setting('telegram_chat_id', '-1001111111111')
    await setting('telegram_language', 'both')
    await setting('telegram_shift_overview_enabled', 'false')

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
    let b2Open = null
    await check('B2: an employee moving the opening of an OPEN shift later is refused, nothing written', async () => {
      const open = await openShift('b2', 40)
      b2Open = open
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

    // ---- S4: an administrator's time edit that leaves money outside every shift is flagged, durably --------
    const SECRET = createHash('sha256').update(BOT_TOKEN).digest('hex')
    const waitFor = async (what, condition) => {
      for (let i = 0; i < 100; i += 1) { if (await condition()) return; await new Promise((done) => setTimeout(done, 100)) }
      throw new Error(`timed out waiting for ${what}`)
    }
    const reportsAbout = (mark, code) => telegramSent.slice(mark).map((message) => message.text).filter((text) => text.includes(code) && !/Overview|ទិដ្ឋភាព/.test(text.split('\n')[0]))
    const shiftReportBlock = (text, code) => text.split('🧑‍💼').find((block) => block.includes(code)) || ''
    const shiftCommand = async (language, code) => {
      await setting('telegram_language', language)
      const mark = telegramSent.length
      const response = await mf.dispatchFetch(`${ORIGIN}/api/telegram/webhook`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
        body: JSON.stringify({ message: { text: '/shift', chat: { id: -1001111111111 } } }) })
      assert.equal(response.status, 200)
      await waitFor('the /shift reply', () => telegramSent.length > mark)
      return shiftReportBlock(telegramSent.slice(mark).map((message) => message.text).join('\n'), code)
    }
    const EARLIER = { en: 'Closed at an earlier time by', km: 'បិទនៅម៉ោងមុនដោយ' }
    const LATER = { en: 'Opened at a later time by', km: 'បើកនៅម៉ោងក្រោយដោយ' }
    const lineWith = (text, phrase) => text.split('\n').find((line) => line.includes(phrase)) || null
    const timeReviewOf = async (id) => {
      const row = await first("SELECT json_extract(after_json,'$.time_review') AS review FROM shift_session_amendments WHERE shift_session_id=? AND json_type(after_json,'$.time_review')='array' ORDER BY id DESC LIMIT 1", id)
      return row ? JSON.parse(row.review) : null
    }
    const reviewCodesOf = async (who, id) => (await call(who, 'GET', `/${id}/history`)).json.shift.reconciliation?.review_codes ?? null
    const expectMark = (label, text, phrases, present) => {
      for (const [language, phrase] of Object.entries(phrases)) {
        const line = lineWith(text, phrase)
        if (present[language]) {
          assert.ok(line, `${label}: the ${language} mark is there`)
          assert.ok(line.includes('cashier_admin'), `${label}: the mark names the administrator: ${line}`)
          assert.equal(/[$៛\d]/.test(line.replace(/cashier_admin/g, '')), false, `${label}: the mark carries no amount: ${line}`)
        } else assert.equal(line, null, `${label}: no ${language} mark`)
      }
    }

    const s4 = await openShift('b3', 60)
    await sell('b3', 50)
    await sell('b3', 30)
    const s4Closed = await call('b3', 'POST', `/${s4}/close`, { expected_revision: 0, closing_counted_usd: 60, closing_counted_khr: 0 })
    assert.equal(s4Closed.status, 200, s4Closed.text)
    const s4Code = (await rowOf(s4)).shift_code
    await check('S4: the cashier close is not flagged', async () => {
      assert.deepEqual((await timeReviewOf(s4)), [], 'the close journals an evaluated, empty review')
      assert.equal((await reviewCodesOf('admin', s4)).includes('closed_at_earlier_time'), false)
    })
    await check('S4: an administrator moving the close before the last sale flags it, durably, and the amend re-send carries the mark', async () => {
      await setting('telegram_language', 'both')
      const mark = telegramSent.length
      const row = await rowOf(s4)
      const done = await amend('admin', s4, { expected_revision: row.revision, closed_at: new Date(Date.now() - 40 * MIN).toISOString() })
      assert.equal(done.status, 200, done.text)
      assert.equal(await orphanCount('b3'), 1, 'one sale now sits outside every shift')
      const review = await timeReviewOf(s4)
      assert.deepEqual(review, [{ code: 'closed_at_earlier_time', by: 'cashier_admin' }])
      assert.ok((await reviewCodesOf('admin', s4)).includes('closed_at_earlier_time'), 'the app reads the flag')
      await waitFor('the amend re-send', () => reportsAbout(mark, s4Code).length > 0)
      const text = reportsAbout(mark, s4Code).join('\n')
      expectMark('amend re-send (both)', text, EARLIER, { en: true, km: true })
      assert.ok(text.includes('Amended by'), 'it is the amend re-send')
    })
    await check('S4: /shift carries the mark in English, Khmer and both', async () => {
      expectMark('/shift en', await shiftCommand('en', s4Code), EARLIER, { en: true, km: false })
      expectMark('/shift km', await shiftCommand('km', s4Code), EARLIER, { en: false, km: true })
      expectMark('/shift both', await shiftCommand('both', s4Code), EARLIER, { en: true, km: true })
    })
    await check('S4: an administrator note amend and an employee count amend keep the flag', async () => {
      await setting('telegram_language', 'both')
      const mark = telegramSent.length
      let row = await rowOf(s4)
      assert.equal((await amend('admin', s4, { expected_revision: row.revision, closing_note: 'Checked by owner' })).status, 200)
      row = await rowOf(s4)
      assert.equal((await amend('b3', s4, { expected_revision: row.revision, closing_counted_usd: 61 })).status, 200)
      assert.deepEqual(await timeReviewOf(s4), [{ code: 'closed_at_earlier_time', by: 'cashier_admin' }], 'no evaluation without a time change; the last one stands')
      await waitFor('the re-sends', () => reportsAbout(mark, s4Code).length >= 2)
      for (const text of reportsAbout(mark, s4Code)) expectMark('re-send after a non-time amend', text, EARLIER, { en: true, km: true })
      assert.ok((await reviewCodesOf('admin', s4)).includes('closed_at_earlier_time'))
    })
    await check('S4: moving the close back so nothing is orphaned clears the flag everywhere', async () => {
      await setting('telegram_language', 'both')
      const mark = telegramSent.length
      const row = await rowOf(s4)
      const done = await amend('admin', s4, { expected_revision: row.revision, closed_at: new Date(Date.now() - 2 * MIN).toISOString() })
      assert.equal(done.status, 200, done.text)
      assert.equal(await orphanCount('b3'), 0)
      assert.deepEqual(await timeReviewOf(s4), [], 'the evaluation that cleared it is journaled')
      assert.equal((await reviewCodesOf('admin', s4)).includes('closed_at_earlier_time'), false)
      await waitFor('the amend re-send', () => reportsAbout(mark, s4Code).length > 0)
      expectMark('re-send after the move back', reportsAbout(mark, s4Code).join('\n'), EARLIER, { en: false, km: false })
      expectMark('/shift after the move back', await shiftCommand('both', s4Code), EARLIER, { en: false, km: false })
    })
    await check('S4: an administrator moving the opening later past a sale flags it with the sibling code, and moving it back clears it', async () => {
      await setting('telegram_language', 'both')
      const mark = telegramSent.length
      let row = await rowOf(s4)
      const done = await amend('admin', s4, { expected_revision: row.revision, opened_at: new Date(Date.now() - 20 * MIN).toISOString() })
      assert.equal(done.status, 200, done.text)
      assert.equal(await orphanCount('b3'), 2)
      assert.deepEqual(await timeReviewOf(s4), [{ code: 'opened_at_later_time', by: 'cashier_admin' }])
      assert.ok((await reviewCodesOf('admin', s4)).includes('opened_at_later_time'))
      await waitFor('the amend re-send', () => reportsAbout(mark, s4Code).length > 0)
      expectMark('opening later (both)', reportsAbout(mark, s4Code).join('\n'), LATER, { en: true, km: true })
      expectMark('opening later /shift en', await shiftCommand('en', s4Code), LATER, { en: true, km: false })
      row = await rowOf(s4)
      assert.equal((await amend('admin', s4, { expected_revision: row.revision, opened_at: new Date(Date.now() - 60 * MIN).toISOString() })).status, 200)
      assert.deepEqual(await timeReviewOf(s4), [])
      assert.equal(await orphanCount('b3'), 0)
    })
    await check('S4: the flag does not live only in the stored figures: a shift closed without them is flagged and marked all the same', async () => {
      await setting('telegram_language', 'both')
      const opened = new Date(Date.now() - 50 * MIN).toISOString()
      const closed = new Date(Date.now() - 5 * MIN).toISOString()
      await db.prepare(`INSERT INTO shift_sessions(shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at,opening_float_usd,opening_float_khr,
          opening_float_usd_registered,opening_float_khr_registered,closed_at,closing_counted_usd,closing_counted_khr,closed_by_user_id,closed_by_user_name)
        VALUES('S-LEGACY-NOFIGURES','per_account',?,?,1,'Shop',date(?, '+7 hours'),?,50,0,1,1,?,60,0,?,?)`)
        .bind(people.b4.id, 'cashier_b4', opened, opened, closed, people.b4.id, 'cashier_b4').run()
      const legacy = (await first("SELECT id FROM shift_sessions WHERE shift_code='S-LEGACY-NOFIGURES'")).id
      await sell('b4', 20)
      assert.equal((await first('SELECT COUNT(*) AS n FROM shift_close_figures WHERE shift_session_id=?', legacy)).n, 0, 'the fixture carries no stored figures')
      const mark = telegramSent.length
      const row = await rowOf(legacy)
      const done = await amend('admin', legacy, { expected_revision: row.revision, closed_at: new Date(Date.now() - 30 * MIN).toISOString() })
      assert.equal(done.status, 200, done.text)
      assert.deepEqual(await timeReviewOf(legacy), [{ code: 'closed_at_earlier_time', by: 'cashier_admin' }])
      assert.ok((await reviewCodesOf('admin', legacy)).includes('closed_at_earlier_time'))
      await waitFor('the amend re-send', () => reportsAbout(mark, 'S-LEGACY-NOFIGURES').length > 0)
      expectMark('legacy shift re-send', reportsAbout(mark, 'S-LEGACY-NOFIGURES').join('\n'), EARLIER, { en: true, km: true })
      expectMark('legacy shift /shift', await shiftCommand('both', 'S-LEGACY-NOFIGURES'), EARLIER, { en: true, km: true })
    })
    await check('S4: an administrator past close is flagged in the close journal and marked on the close message', async () => {
      await setting('telegram_language', 'both')
      const open = b2Open
      const mark = telegramSent.length
      const row = await rowOf(open)
      const closed = await call('admin', 'POST', `/${open}/close`, { expected_revision: row.revision, closed_at: row.opened_at, closing_counted_usd: 50, closing_counted_khr: 0 })
      assert.equal(closed.status, 200, closed.text)
      assert.deepEqual(await timeReviewOf(open), [{ code: 'closed_at_earlier_time', by: 'cashier_admin' }])
      await waitFor('the close message', () => reportsAbout(mark, row.shift_code).length > 0)
      expectMark('close message', reportsAbout(mark, row.shift_code).join('\n'), EARLIER, { en: true, km: true })
      expectMark('/shift after the close', await shiftCommand('km', row.shift_code), EARLIER, { en: false, km: true })
    })

    // ---- a close in the same second as the last money record lands after it, never before ---------------
    await check('an employee closing in the same second as their last sale is stamped the second after it, not refused', async () => {
      let observed = null
      for (let attempt = 0; attempt < 8 && !observed; attempt += 1) {
        const key = `tie${attempt + 1}`
        const id = await openShift(key, 20)
        // The sale is written early in a second so the close request, a few milliseconds later, falls in the same one.
        while (Date.now() % 1000 > 250) await new Promise((done) => setTimeout(done, 10))
        const saleMs = Date.now()
        await db.prepare(`INSERT INTO sales(created_at,sale_status,branch_id,cashier_id,payment_method,amount_paid_usd,amount_paid_khr,total_usd,exchange_rate)
          VALUES(?,'completed',1,?, 'Cash',5,0,5,4000)`).bind(stored(saleMs), people[key].id).run()
        const closed = await call(key, 'POST', `/${id}/close`, { expected_revision: 0, closing_counted_usd: 55, closing_counted_khr: 0 })
        const row = await rowOf(id)
        if (closed.status === 409) throw new Error(`the close in the sale's own second was refused: ${closed.text}`)
        assert.equal(closed.status, 200, closed.text)
        if (!row.closed_at.endsWith('.000Z')) continue
        observed = { row, saleSecond: Math.floor(saleMs / 1000), id, key }
      }
      assert.ok(observed, 'a close landed in the same second as a sale within 8 attempts')
      assert.equal(Math.floor(Date.parse(observed.row.closed_at) / 1000), observed.saleSecond + 1, 'stamped the second after the sale')
      assert.equal(await orphanCount(observed.key), 0, 'the sale is inside the shift it was rung in')
      const figures = JSON.parse((await first('SELECT figures_json FROM shift_close_figures WHERE shift_session_id=?', observed.id)).figures_json)
      assert.equal(figures.reconciliation.cash_sales.usd, 5, 'and counted in its drawer')
      assert.deepEqual(await timeReviewOf(observed.id), [], 'a bumped close is not an earlier-time close')
    })

    // (later rounds of this file append their scenarios here)

    await check('nothing left the process', async () => assert.deepEqual(outbound, []))
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
    console.log('PASS shift time edits: an employee cannot change opened_at or closed_at by amend (409 shift_time_admin_only, nothing written); other amend fields and an administrator are unaffected')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
