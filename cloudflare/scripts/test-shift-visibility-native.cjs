// A shift row is cash, so a route that takes a shift id answers for a shift the caller cannot see
// exactly as it answers for one that does not exist: 404 "Shift not found." (as GET /:id/history
// does), never a 403 that confirms the id. That covers PATCH /:id, POST /:id/close, POST /close,
// POST /:id/reopen and the receipt-replay middleware, before the action's own permission or state
// checks (a hidden cancelled shift is 404, not the 409 that names its state). POST /:id/cancel is
// administrator-only: a non-administrator gets one 403 for a missing and a hidden id alike.
//
// The real Worker (src/index.ts, real auth and sessions) on a Miniflare D1 with every migration
// applied, three plain POS cashiers and one administrator. Nothing leaves the process: outbound
// fetches are recorded and refused, and no Telegram chat is configured.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const ORIGIN = 'https://admin.shift-visibility.example'
const NOT_FOUND = { error: 'Shift not found.' }

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
        // The fixture has no users while migrations run, so 0098's alias seed is a no-op there.
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
        await db.prepare(statement).run()
      }
    }
    const first = (sql, ...values) => db.prepare(sql).bind(...values).first()
    const roleId = async (code, permissions) => {
      await db.prepare('INSERT OR IGNORE INTO roles(code,name,permissions) VALUES(?,?,?)').bind(code, code, permissions).run()
      return (await first('SELECT id FROM roles WHERE code=?', code)).id
    }
    const cashierRole = await roleId('shift_visibility_cashier', '{"pos":true}')
    const adminRole = await roleId('admin', '{"all":true}')
    const people = {}
    for (const [key, id, role, permissions] of [['a', 21, cashierRole, '{"pos":true}'], ['b', 22, cashierRole, '{"pos":true}'],
      ['c', 23, cashierRole, '{"pos":true}'], ['admin', 24, adminRole, '{"all":true}']]) {
      const token = `shift-visibility-${key}`
      await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(?,?,?,'fixture',?,?,1)")
        .bind(id, `cashier_${key}`, `Cashier ${key}`, role, permissions).run()
      await db.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)')
        .bind(id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() - 3600000).toISOString(),
          new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()).run()
      people[key] = { id, token }
    }
    await db.prepare("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(1,'Shop','shop',1,1)").run()
    const setScope = (mode) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind('shift_scope_mode', mode).run()

    const call = async (who, method, route, body) => {
      const response = await mf.dispatchFetch(`${ORIGIN}/api/shifts${route}`, { method,
        headers: { cookie: `bos_session=${people[who].token}`, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await response.text()
      let json = null; try { json = JSON.parse(text) } catch { /* not JSON */ }
      return { status: response.status, json, text }
    }
    const open = async (who) => {
      const opened = await call(who, 'POST', '/open', { branch_id: 1, opening_float_usd: 50, opening_float_khr: 20000 })
      assert.equal(opened.status, 201, opened.text)
      return opened.json.shift.id
    }
    const rowOf = (id) => first('SELECT * FROM shift_sessions WHERE id=?', id)
    const amendmentsOf = async (id) => (await db.prepare('SELECT actor_user_id, reason, before_json, after_json FROM shift_session_amendments WHERE shift_session_id=? ORDER BY id').bind(id).all()).results
    const auditCounts = async () => JSON.stringify((await db.prepare("SELECT action, COUNT(*) n FROM audit_logs WHERE action LIKE 'shift.%' GROUP BY action ORDER BY action").all()).results)
    const unchanged = async (label, id, work) => {
      const [row, amendments, audits] = [await rowOf(id), await amendmentsOf(id), await auditCounts()]
      await work()
      assert.deepEqual(await rowOf(id), row, `${label}: the shift row is untouched`)
      assert.deepEqual(await amendmentsOf(id), amendments, `${label}: no amendment was written`)
      assert.equal(await auditCounts(), audits, `${label}: nothing was audited`)
    }
    const refused = (label, response, reference) => {
      assert.equal(response.status, 404, `${label}: ${response.text}`)
      assert.deepEqual(response.json, NOT_FOUND, `${label}: the history route's body`)
      assert.equal(response.text, reference.text, `${label}: identical to a shift that does not exist, so ids cannot be probed`)
    }

    // Each check runs on its own and the failures are listed together at the end, so a mutation of
    // one route shows exactly which assertions it breaks instead of stopping at the first.
    const failures = []
    const check = async (name, work) => {
      try { await work() } catch (error) { failures.push(`${name}: ${String(error.message).split('\n')[0].slice(0, 220)}`) }
    }
    const revisionOf = async (id) => (await rowOf(id)).revision
    const amend = (revisionNow, extra = {}) => ({ expected_revision: revisionNow, reason: 'Recount', opening_float_usd: 0, ...extra })
    const ghost = 987654
    const ghostAmend = await call('b', 'PATCH', `/${ghost}`, amend(0))
    assert.equal(ghostAmend.status, 404, ghostAmend.text)

    // ---- 1. per_account, the default: B cannot reach A's shift by id ----------
    assert.deepEqual((await call('a', 'GET', '/policy')).json, { scope_mode: 'per_account', admin_exempt: true })
    const aShift = await open('a')
    await check('control: history and list already hide it', async () => {
      assert.equal((await call('b', 'GET', `/${aShift}/history`)).status, 404)
      assert.equal((await call('b', 'GET', '?branch_id=1')).json.shifts.some((shift) => shift.id === aShift), false)
    })
    await check('B PATCH A shift', () => unchanged('B PATCH', aShift, async () => {
      refused('B PATCH', await call('b', 'PATCH', `/${aShift}`, amend(await revisionOf(aShift))), ghostAmend)
    }))
    await check('B PATCH A shift with a request identity (middleware)', () => unchanged('B PATCH + identity', aShift, async () => {
      const identity = { client_request_id: 'b-amend-0000000001' }
      const ghostIdentity = await call('b', 'PATCH', `/${ghost}`, amend(0, identity))
      refused('B PATCH + identity', await call('b', 'PATCH', `/${aShift}`, amend(await revisionOf(aShift), identity)), ghostIdentity)
    }))
    await check('B POST /:id/close', () => unchanged('B close', aShift, async () => {
      const body = { expected_revision: await revisionOf(aShift), closing_counted_usd: 1 }
      refused('B POST /:id/close', await call('b', 'POST', `/${aShift}/close`, body), await call('b', 'POST', `/${ghost}/close`, body))
    }))
    await check('B POST /close (live close)', () => unchanged('B live close', aShift, async () => {
      const body = { shift_id: aShift, expected_revision: await revisionOf(aShift), client_request_id: 'b-close-0000000001', closing_counted_usd: 1 }
      refused('B POST /close', await call('b', 'POST', '/close', body), await call('b', 'POST', '/close', { ...body, shift_id: ghost }))
    }))
    await check('B POST /:id/reopen', () => unchanged('B reopen', aShift, async () => {
      const body = { expected_revision: await revisionOf(aShift), reason: 'probe' }
      refused('B POST /:id/reopen', await call('b', 'POST', `/${aShift}/reopen`, body), await call('b', 'POST', `/${ghost}/reopen`, body))
    }))
    await check('B POST /:id/cancel: administrator-only, one 403 for a missing and a hidden id, with and without a request identity', () => unchanged('B cancel', aShift, async () => {
      for (const identity of [{}, { client_request_id: 'b-cancel-0000000001' }]) {
        const body = { expected_revision: await revisionOf(aShift), reason: 'probe', ...identity }
        const hidden = await call('b', 'POST', `/${aShift}/cancel`, body)
        const missing = await call('b', 'POST', `/${ghost}/cancel`, body)
        assert.equal(hidden.status, 403, `${JSON.stringify(identity)}: ${hidden.text}`)
        assert.equal(hidden.text, missing.text, `${JSON.stringify(identity)}: a hidden id and a missing id answer alike`)
      }
    }))

    // The owner and the shift-review administrator still reach it, with and without a request identity.
    await check('owner and administrator still amend', async () => {
      const before = (await amendmentsOf(aShift)).length
      const identity = { client_request_id: 'a-amend-0000000001' }
      const own = await call('a', 'PATCH', `/${aShift}`, amend(await revisionOf(aShift), { opening_float_usd: 45, ...identity }))
      assert.equal(own.status, 200, own.text)
      assert.equal(own.json.shift.opening_float_usd, 45)
      const replay = await call('a', 'PATCH', `/${aShift}`, amend(own.json.shift.revision - 1, { opening_float_usd: 45, ...identity }))
      assert.equal(replay.status, 200, 'the owner replay of an exact retry still answers from the receipt')
      assert.equal(replay.json.mutation_committed, true)
      assert.equal((await call('admin', 'PATCH', `/${aShift}`, amend(await revisionOf(aShift), { opening_float_usd: 44, client_request_id: 'admin-amend-00000001' }))).status, 200)
      assert.equal((await call('admin', 'PATCH', `/${aShift}`, amend(await revisionOf(aShift), { opening_float_usd: 43 }))).status, 200)
      assert.equal((await call('admin', 'GET', `/${aShift}/history`)).status, 200)
      assert.deepEqual((await amendmentsOf(aShift)).slice(before).map((row) => row.actor_user_id), [people.a.id, people.admin.id, people.admin.id],
        'every amendment names the acting account, never the owner')
    })

    // ---- 2. shop_wide: a shift opened under it belongs to the branch --------------
    await setScope('shop_wide')
    const wide = await open('c')
    assert.equal((await rowOf(wide)).scope_mode, 'shop_wide')
    const wideIdentity = { client_request_id: 'b-amend-0000000002' }
    const wideFirst = await revisionOf(wide)
    await check('shop_wide: any POS account amends the branch shift', async () => {
      const byB = await call('b', 'PATCH', `/${wide}`, amend(wideFirst, wideIdentity))
      assert.equal(byB.status, 200, `owner ruling 14 Sep, employees amend shift records: ${byB.text}`)
      assert.equal((await amendmentsOf(wide)).at(-1).actor_user_id, people.b.id)
      assert.equal((await call('b', 'PATCH', `/${wide}`, amend(await revisionOf(wide), { opening_float_usd: 7 }))).status, 200, 'and without a request identity')
    })
    await check('shop_wide: visible is not owned, close stays 403', async () => {
      const closeWide = await call('b', 'POST', `/${wide}/close`, { expected_revision: await revisionOf(wide), closing_counted_usd: 1 })
      assert.equal(closeWide.status, 403, closeWide.text)
    })
    // A per_account shift stays hidden after the shop switches to shop_wide: it was not opened for the branch.
    await check('shop_wide: a per_account shift stays hidden', () => unchanged('B PATCH, stale scope', aShift, async () => {
      refused('stale scope', await call('b', 'PATCH', `/${aShift}`, amend(await revisionOf(aShift))), ghostAmend)
    }))

    // ---- 3. back to per_account: the shop_wide shift is hidden again, and a receipt cannot reopen the door ----------
    await setScope('per_account')
    await check('per_account again: the shop_wide shift is hidden', () => unchanged('B PATCH, policy switched back', wide, async () => {
      refused('policy switched back', await call('b', 'PATCH', `/${wide}`, amend(await revisionOf(wide))), ghostAmend)
    }))
    await check('B replays a receipt it earned while the shift was visible', () => unchanged('B replay', wide, async () => {
      const replayed = await call('b', 'PATCH', `/${wide}`, amend(wideFirst, wideIdentity))
      assert.equal(replayed.status, 404, `the receipt must not hand a hidden shift back: ${replayed.text}`)
      assert.deepEqual(replayed.json, NOT_FOUND)
    }))
    await check('owner and administrator still amend it', async () => {
      assert.equal((await call('c', 'PATCH', `/${wide}`, amend(await revisionOf(wide), { opening_float_usd: 6 }))).status, 200)
      assert.equal((await call('admin', 'PATCH', `/${wide}`, amend(await revisionOf(wide), { opening_float_usd: 5 }))).status, 200)
    })
    // ---- 4. a cancelled shift is hidden the same way: the 404 comes before the 409 that names its state ----------
    await check('administrator cancels with a request identity', async () => {
      const cancel = await call('admin', 'POST', `/${aShift}/cancel`,
        { expected_revision: await revisionOf(aShift), reason: 'Opened by mistake', client_request_id: 'admin-cancel-000000001' })
      assert.equal(cancel.status, 200, cancel.text)
      assert.equal(cancel.json.cancelled, true)
    })
    await check('B PATCH of a hidden cancelled shift answers 404, with and without a request identity', () => unchanged('B PATCH, cancelled', aShift, async () => {
      refused('B PATCH', await call('b', 'PATCH', `/${aShift}`, amend(await revisionOf(aShift))), ghostAmend)
      const identity = { client_request_id: 'b-amend-0000000003' }
      refused('B PATCH + identity', await call('b', 'PATCH', `/${aShift}`, amend(await revisionOf(aShift), identity)), await call('b', 'PATCH', `/${ghost}`, amend(0, identity)))
    }))
    await check('control: the owner can see the cancelled shift, so the owner hears its state (409)', async () => {
      const own = await call('a', 'PATCH', `/${aShift}`, amend(await revisionOf(aShift)))
      assert.equal(own.status, 409, own.text)
    })
    await check('nothing left the process', async () => assert.deepEqual(outbound, []))
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
    console.log('PASS shift visibility: per_account 404 (amend, amend+identity, close, live close, reopen, cancelled) with no row, amendment or audit change; '
      + 'cancel 403 alike for a missing and a hidden id; owner and administrator unchanged; shop_wide amend allowed; scope switches and receipt replay stay hidden')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
