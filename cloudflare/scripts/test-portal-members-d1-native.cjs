// G38 Phase 1 on NATIVE D1 (Miniflare workerd), not node SQLite.
//
// The first draft of 0230 passed every node-SQLite test and would still have
// broken the storefront after deploy: its member_code CHECK was a 147-byte
// GLOB, and native D1 refuses any LIKE/GLOB pattern over 50 bytes when the
// CHECK is evaluated -- i.e. on every INSERT/UPDATE of portal_accounts. This
// test runs the REAL routes/portal.ts and routes/portalMembers.ts, bundled
// with esbuild, on workerd D1 carrying the COMPLETE migration chain
// (wrangler's own splitter), and drives the member life cycle through HTTP:
//
//   - sign-up is paused while the setting is unset (owner ruling 6 Oct);
//   - with it on, sign-up writes a W- code (CHECK evaluated natively), sets
//     the session cookie, and /auth/me answers the allowlisted view;
//   - sign-in by W- code + phone + password works, and a pre-G38 account
//     without a code gets one minted lazily on sign-in (an UPDATE under the
//     CHECK);
//   - the storefront credential guard refuses a text/plain sign-in;
//   - a member's link request, a staff link (in person) after which the
//     member sees the LC number, and a revert of that link, all native;
//   - control: on the same database a malformed W- code is refused by the
//     CHECK, so the passing writes above were really checked.
//
// Only platform pieces are fixtures: staff auth (a header carries the
// permissions), the live-update hub and the AI provider.
//
// Negative control: G38_MIGRATIONS_FROM=9300c775e swaps in that commit's
// 0230/0231 (the 147-byte GLOB): the sign-up step must FAIL natively.
//
// Run (from cloudflare/scripts/): node test-portal-members-d1-native.cjs
// About two minutes: most of it is the migration chain through Miniflare's D1.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')

async function workerBundle() {
  return build({
    stdin: {
      contents: `import { Hono } from 'hono'
        import portal from './src/routes/portal'
        import portalMembers from './src/routes/portalMembers'
        const app = new Hono()
        app.route('/api/portal', portal)
        app.route('/api/portal-members', portalMembers)
        export default app`,
      resolveDir: root, loader: 'ts',
    },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    plugins: [{
      name: 'portal-members-native-fixtures',
      setup(builder) {
        const fixtures = {
          auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');
            if(!raw)return c.json({error:'Unauthorized'},401);
            c.set('user',{id:7,username:'admin',name:'Fixture Admin',role_code:'admin',permissions:raw,role_permissions:'{}'});return next()}`,
          broadcastHub: 'export const broadcast=async()=>{}',
          portalAi: 'export const generatePortalAiResponse=async()=>({summary:"",recommendations:[],requestPolicy:{}})',
        }
        builder.onResolve({ filter: /(?:lib\/(?:auth|portalAi)|durable-objects\/broadcastHub)$/ },
          (args) => ({ path: args.path.split('/').pop(), namespace: 'g38-fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'g38-fixture' },
          (args) => ({ contents: fixtures[args.path], loader: 'ts' }))
      },
    }],
  })
}

async function migrate(db) {
  const dir = path.join(root, 'migrations')
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) {
    const swapped = process.env.G38_MIGRATIONS_FROM && /^023[01]_/.test(name)
    const text = swapped
      ? execFileSync('git', ['show', `${process.env.G38_MIGRATIONS_FROM}:cloudflare/migrations/${name}`], { cwd: root, encoding: 'utf8' })
      : fs.readFileSync(path.join(dir, name), 'utf8')
    for (const statement of split(text)) {
      // Same single exception as test-record-orphans-native.cjs: Miniflare's
      // D1 caps compound-SELECT terms lower than the deployed runner, and
      // 0098's alias seed is a no-op here (no users while migrations run).
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      try { await db.prepare(statement).run() } catch (error) {
        error.message = `${name}: ${error.message}`
        throw error
      }
    }
  }
}

let failures = 0
async function step(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failures += 1
    console.log(`FAIL ${name}`)
    console.log(String(error && error.stack || error).split('\n').slice(0, 8).map((line) => `     ${line}`).join('\n'))
  }
}

async function main() {
  const started = Date.now()
  const bundle = await workerBundle()
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'], kvNamespaces: ['CACHE'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR),
    bindings: {
      PORTAL_ABUSE_HMAC_SECRET: 'p'.repeat(48),
      BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com',
      BUSINESS_OS_ADMIN_URL: 'https://admin.leangbeauty.com',
    },
  })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    const applied = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('portal_member_link_events', 'portal_member_link_requests')").all()).results.length
    assert.equal(applied, 2, '0230/0231 applied on workerd D1')
    console.log(`migrated in ${Math.round((Date.now() - started) / 1000)}s`)

    const BROWSER = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.50' }
    async function call(url, { method = 'POST', body, headers = {}, cookie, staff = false, raw } = {}) {
      const all = { ...BROWSER, ...headers }
      if (cookie) all.cookie = cookie
      if (staff) all['x-test-permissions'] = JSON.stringify({ all: true })
      const response = await mf.dispatchFetch(`https://leangbeauty.com${url}`, {
        method, headers: all, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await response.text()
      let parsed = null
      try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 300) } }
      return { status: response.status, body: parsed, setCookie: response.headers.get('set-cookie') }
    }
    const cookieOf = (res) => String(res.setCookie || '').split(';')[0]
    const PHONE = '012 345 678'
    const PASSWORD = 'native-pass-1'
    let cookie = ''
    let accountId = 0
    let memberCode = ''

    await step('sign-up is paused while customer_portal_signup_enabled is unset', async () => {
      const res = await call('/api/portal/auth/signup', { body: { name: 'Native Member', phone: PHONE, password: PASSWORD, consent: true, consentLocale: 'en' } })
      assert.equal(res.status, 403, JSON.stringify(res.body))
      assert.equal(res.body.code, 'portal_signup_paused')
      assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM portal_accounts').first()).n), 0)
    })

    await db.prepare("INSERT INTO settings (key, value) VALUES ('customer_portal_signup_enabled', 'true')").run()

    await step('sign-up on native D1 writes a valid W- code under the CHECK and sets the session cookie', async () => {
      const res = await call('/api/portal/auth/signup', { body: { name: 'Native Member', phone: PHONE, password: PASSWORD, consent: true, consentLocale: 'en' } })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      cookie = cookieOf(res)
      assert.match(cookie, /^bos_portal=/)
      memberCode = res.body.account.memberCode
      assert.match(memberCode, /^W-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
      const row = await db.prepare('SELECT id, member_code, contact_id FROM portal_accounts WHERE member_code = ?').bind(memberCode).first()
      assert.ok(row, 'the account row carries the code')
      assert.equal(row.contact_id, null, 'sign-up never links a customer')
      accountId = Number(row.id)
    })

    await step('/auth/me answers the allowlisted member view', async () => {
      const res = await call('/api/portal/auth/me', { method: 'GET', cookie })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.deepEqual(Object.keys(res.body.account).sort(), ['email', 'linked', 'memberCode', 'membershipId', 'name'])
      assert.equal(res.body.account.memberCode, memberCode)
      assert.equal(res.body.account.linked, false)
    })

    await step('the credential guard refuses a text/plain sign-in natively (no cookie)', async () => {
      const res = await call('/api/portal/auth/signin', {
        raw: JSON.stringify({ identifier: memberCode, phone: PHONE, password: PASSWORD, consent: true }),
        headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'cross-site' },
      })
      assert.equal(res.status, 403)
      assert.equal(res.setCookie, null)
    })

    await step('sign-in by W- code + phone + password', async () => {
      const res = await call('/api/portal/auth/signin', { body: { identifier: memberCode, phone: PHONE, password: PASSWORD, consent: true } })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.account.memberCode, memberCode)
      cookie = cookieOf(res)
    })

    await step('a pre-G38 account without a code gets one minted on sign-in (UPDATE under the CHECK)', async () => {
      const phone = '012 345 679'
      const up = await call('/api/portal/auth/signup', { body: { name: 'Legacy Member', phone, password: PASSWORD, consent: true, consentLocale: 'en' }, headers: { 'cf-connecting-ip': '203.0.113.51' } })
      assert.equal(up.status, 200, JSON.stringify(up.body))
      await db.prepare("UPDATE portal_accounts SET member_code = NULL WHERE phone = '012345679'").run()
      const res = await call('/api/portal/auth/signin', { body: { identifier: 'Legacy Member', phone, password: PASSWORD, consent: true }, headers: { 'cf-connecting-ip': '203.0.113.51' } })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      const row = await db.prepare("SELECT member_code FROM portal_accounts WHERE phone = '012345679'").first()
      assert.match(String(row.member_code), /^W-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
      assert.equal(res.body.account.memberCode, row.member_code)
    })

    await step('member link request, staff link in person, the member then sees the LC number', async () => {
      const request = await call('/api/portal/account/link-request', { body: { note: 'I shop at the store' }, cookie })
      assert.equal(request.status, 200, JSON.stringify(request.body))
      const listed = await call('/api/portal-members?filter=requests', { method: 'GET', staff: true })
      assert.equal(listed.status, 200, JSON.stringify(listed.body))
      assert.deepEqual(listed.body.items.map((item) => item.id), [accountId])
      await db.prepare("INSERT INTO customers (id, name, phone, phone_normalized, membership_number) VALUES (900, 'Store Customer', '012 345 678', '012345678', 'LC-00900')").run()
      const version = Number((await db.prepare('SELECT link_version FROM portal_accounts WHERE id = ?').bind(accountId).first()).link_version)
      const linked = await call(`/api/portal-members/${accountId}/link`, {
        staff: true,
        body: { customerId: 900, expectedLinkVersion: version, evidence: 'in_person', linkRequestId: listed.body.items[0].pendingRequest.id, clientRequestId: 'native-link-0001' },
      })
      assert.equal(linked.status, 200, JSON.stringify(linked.body))
      const me = await call('/api/portal/auth/me', { method: 'GET', cookie })
      assert.equal(me.status, 200, JSON.stringify(me.body))
      assert.equal(me.body.account.linked, true)
      assert.equal(me.body.account.membershipId, 'LC-00900')
      assert.equal(me.body.account.memberCode, memberCode, 'the W- code stays as an alias')
      const request2 = await db.prepare('SELECT status, decided_event_id FROM portal_member_link_requests WHERE account_id = ?').bind(accountId).first()
      assert.equal(request2.status, 'approved')
      assert.ok(request2.decided_event_id)
    })

    await step('staff revert of the link (removes it, no evidence needed) appends one event', async () => {
      const history = await call(`/api/portal-members/${accountId}/history`, { method: 'GET', staff: true })
      assert.equal(history.status, 200, JSON.stringify(history.body))
      const latest = history.body.events[0]
      assert.equal(latest.action, 'link')
      const before = Number((await db.prepare('SELECT COUNT(*) AS n FROM portal_member_link_events WHERE account_id = ?').bind(accountId).first()).n)
      const reverted = await call(`/api/portal-members/${accountId}/revert`, { staff: true, body: { eventId: latest.id } })
      assert.equal(reverted.status, 200, JSON.stringify(reverted.body))
      const after = Number((await db.prepare('SELECT COUNT(*) AS n FROM portal_member_link_events WHERE account_id = ?').bind(accountId).first()).n)
      assert.equal(after, before + 1)
      assert.equal((await db.prepare('SELECT contact_id FROM portal_accounts WHERE id = ?').bind(accountId).first()).contact_id, null)
      await assert.rejects(db.prepare('UPDATE portal_member_link_events SET note = ? WHERE account_id = ?').bind('x', accountId).run(), /member_link_events_append_only/)
    })

    await step('control: the same native CHECK refuses a malformed W- code', async () => {
      for (const bad of ['W-0000-000I', 'w-0000-0000', 'W-00000000', 'W-0000-00000']) {
        await assert.rejects(db.prepare('UPDATE portal_accounts SET member_code = ? WHERE id = ?').bind(bad, accountId).run(), /CHECK constraint/, bad)
      }
      assert.equal((await db.prepare('SELECT member_code FROM portal_accounts WHERE id = ?').bind(accountId).first()).member_code, memberCode)
    })
  } finally {
    await mf.dispose()
  }
  console.log(`\n${failures ? `${failures} FAILED` : 'all passed'} in ${Math.round((Date.now() - started) / 1000)}s`)
  if (failures) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
