// Shop-wide, an earlier day's drawer left open on a branch is announced once, when the first registration after it
// happens on THAT branch. A registration on another branch used to count as "seen" and suppress the alert for a
// drawer on a branch nobody there had registered on yet.
//
// The real Worker (src/index.ts, real auth and sessions) on a Miniflare D1 with every migration applied. Telegram
// is intercepted in process; nothing else leaves.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const ORIGIN = 'https://admin.shift-stale-alert-branch.example'
const HOUR = 60 * 60_000

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: "import worker from './src/index.ts'; export default worker" },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:workers'], logLevel: 'silent' })
  const outbound = []
  const telegramSent = []
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], cache: false, bindings: { PLAN_TIER: 'paid', BUSINESS_OS_ADMIN_URL: ORIGIN, TELEGRAM_BOT_TOKEN: 'test-token-not-real' },
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
    const db = await mf.getD1Database('DB')
    for (const name of fs.readdirSync(path.join(root, 'migrations')).filter((file) => file.endsWith('.sql')).sort()) {
      for (const statement of split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
        await db.prepare(statement).run()
      }
    }
    const first = (sql, ...values) => db.prepare(sql).bind(...values).first()
    const run = (sql, ...values) => db.prepare(sql).bind(...values).run()
    await run("INSERT OR IGNORE INTO roles(code,name,permissions) VALUES('shift_stale_branch_employee','shift_stale_branch_employee','{\"pos\":true,\"sales\":true}')")
    const employeeRole = (await first("SELECT id FROM roles WHERE code='shift_stale_branch_employee'")).id
    const people = {}
    for (const [index, key] of ['owner', 'reg3', 'reg5'].entries()) {
      const id = 41 + index; const token = `shift-stale-alert-branch-${key}`
      await run("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(?,?,?,'fixture',?,?,1)", id, `cashier_${key}`, `Cashier ${key}`, employeeRole, '{"pos":true,"sales":true}')
      await run('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)',
        id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() + 86400000).toISOString(), new Date().toISOString())
      people[key] = { id, token }
    }
    for (const [id, name] of [[1, 'Shop'], [3, 'B3'], [5, 'B5']]) await run("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(?,?,'shop',?,1)", id, name, id === 1 ? 1 : 0)
    const setting = (key, value) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value)
    await setting('pos_payment_methods', '["Cash","ABA"]')
    await setting('telegram_chat_id', '-1001111111111')
    await setting('telegram_language', 'en')
    await setting('telegram_shift_overview_enabled', 'false')
    await setting('shift_scope_mode', 'shop_wide')

    const open = async (who, branch) => {
      const response = await mf.dispatchFetch(`${ORIGIN}/api/shifts/open`, { method: 'POST',
        headers: { cookie: `bos_session=${people[who].token}`, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        body: JSON.stringify({ branch_id: branch, opening_float_usd: 1, opening_float_khr: 0 }) })
      assert.equal(response.status, 201, await response.text())
    }
    const staleDrawer = (code, branch, hoursAgo) => {
      const at = new Date(Date.now() - hoursAgo * HOUR).toISOString()
      return run(`INSERT INTO shift_sessions(shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at,opening_float_usd,opening_float_khr,opening_float_usd_registered,opening_float_khr_registered)
        VALUES(?,'shop_wide',?,'cashier_owner',?,'B',date(?, '+7 hours'),?,10,0,1,1)`, code, people.owner.id, branch, at, at)
    }
    const announced = async (mark, code) => {
      for (let i = 0; i < 30; i += 1) {
        if (telegramSent.slice(mark).some((text) => text.includes(code))) return true
        await new Promise((done) => setTimeout(done, 100))
      }
      return false
    }
    const failures = []
    const check = async (name, work) => {
      try { await work() } catch (error) { failures.push(`${name}: ${String(error.message).split('\n')[0].slice(0, 400)}`) }
    }

    await check('control: the first registration on the branch announces its stale drawer', async () => {
      await staleDrawer('S-STALE-B5', 5, 26)
      const mark = telegramSent.length
      await open('reg5', 5)
      assert.equal(await announced(mark, 'S-STALE-B5'), true)
    })

    await check('a registration on another branch does not suppress the alert for a drawer on a branch nobody there registered on', async () => {
      await staleDrawer('S-STALE-B3', 3, 25)
      const mark = telegramSent.length
      await open('reg3', 3)
      assert.equal(await announced(mark, 'S-STALE-B3'), true, 'the branch-3 drawer is announced at the first branch-3 registration')
    })

    await check('nothing left the process', async () => assert.deepEqual(outbound, []))
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
    console.log('PASS shift stale alert branch: a shop-wide stale drawer is announced at the first registration on its own branch, whatever happened on other branches')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
