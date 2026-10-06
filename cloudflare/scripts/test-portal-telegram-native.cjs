// G38 Telegram on NATIVE D1 (workerd via Miniflare), not node SQLite.
//
// Native D1 differs from better-sqlite3 in ways that have already broken
// member writes once (a 147-byte GLOB in 0230's member_code CHECK: native D1
// caps LIKE/GLOB patterns at 50 bytes). So the Telegram flows are proven here
// on the real engine: the REAL routes/portalTelegram.ts and routes/portal.ts,
// bundled by esbuild and mounted exactly as src/index.ts mounts them, run in
// workerd against a D1 database carrying EVERY migration (0232 included).
// Only auth, audit, cache and the live-update hub are fixtures; nothing calls
// Telegram (the bot answers in the webhook response).
//
// Covers: sign-up end to end (start -> /start -> own contact -> poll -> member
// + identity + session -> /auth/me), a forwarded contact refused, a replayed
// poll refused, another browser refused, an existing phone member not taken
// over, a bad webhook secret refused with nothing written, the 0232
// schema has no LIKE/GLOB pattern over 50 bytes, and a member's close drops its
// Telegram link and handshakes in the same batch (0232's trigger) so the
// Telegram account can join again as a new member.
//
// Run (from cloudflare/): node scripts/test-portal-telegram-native.cjs
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const SECRET = 'Native_portal_webhook_secret-0123456789abcdef'
const BINDINGS = {
  PORTAL_TELEGRAM_WEBHOOK_SECRET: SECRET,
  PORTAL_TELEGRAM_BOT_TOKEN: '7000000002:AAnative-portal-token-made-up',
  TELEGRAM_BOT_TOKEN: '6000000002:AAnative-staff-token-made-up',
  PORTAL_ABUSE_HMAC_SECRET: 'n'.repeat(48),
  BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com',
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.log(`FAIL ${name}\n  ${String(error && error.message || error).split('\n').slice(0, 6).join('\n  ')}`)
  }
}

async function workerBundle() {
  return build({
    stdin: {
      contents: `import { Hono } from 'hono'
        import portalTelegram from './src/routes/portalTelegram'
        import portal from './src/routes/portal'
        const app = new Hono()
        app.route('/api/portal', portalTelegram)
        app.route('/api/portal', portal)
        export default app`,
      resolveDir: root, loader: 'ts',
    },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    plugins: [{
      name: 'portal-telegram-native-fixtures',
      setup(builder) {
        const fixtures = {
          auth: "export const requireAuth=async(c)=>c.json({error:'Unauthorized'},401)",
          audit: 'export const audit=async()=>{}',
          cache: 'export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};export const getVersionWithFallback=async()=>0;export const cachedJsonResponse=async(_e,_k,_t,fn)=>fn()',
          broadcastHub: 'export const broadcast=async()=>{}',
        }
        builder.onResolve({ filter: /(?:lib\/(?:auth|audit|cache)|durable-objects\/broadcastHub)$/ },
          (args) => ({ path: args.path.split('/').pop(), namespace: 'telegram-native-fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'telegram-native-fixture' }, (args) => ({ contents: fixtures[args.path], loader: 'ts' }))
      },
    }],
  })
}

async function migrate(db) {
  const dir = path.join(root, 'migrations')
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) {
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8'))) {
      // The single exception every native suite makes (see
      // test-record-orphans-native.cjs): Miniflare's lower compound-SELECT cap
      // on 0098's alias seed, a no-op on an empty users table.
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      try { await db.prepare(statement).run() } catch (error) {
        error.message = `${name}: ${error.message}`
        throw error
      }
    }
  }
}

async function main() {
  const bundle = await workerBundle()
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'], bindings: BINDINGS,
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR),
  })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    const count = async (sql) => Number((await db.prepare(sql).first()).n)

    let ipSeq = 20
    const browser = () => {
      const jar = {}
      const ip = `198.51.100.${ipSeq += 1}`
      const send = async (pathname, method = 'POST', body) => {
        const headers = { 'CF-Connecting-IP': ip, 'Sec-Fetch-Site': 'same-origin', Origin: 'https://leangbeauty.com' }
        if (body !== undefined) headers['Content-Type'] = 'application/json'
        const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
        if (cookie) headers.Cookie = cookie
        const response = await mf.dispatchFetch(`https://leangbeauty.com/api/portal${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
        for (const line of response.headers.getSetCookie()) {
          const [pair, ...attrs] = line.split(';')
          const eq = pair.indexOf('=')
          const name = pair.slice(0, eq).trim(); const value = pair.slice(eq + 1).trim()
          if (!value || attrs.some((a) => /max-age=0\b/i.test(a.trim()))) delete jar[name]; else jar[name] = value
        }
        const text = await response.text()
        let json = null
        try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 300) } }
        return { status: response.status, body: json }
      }
      return {
        jar, send,
        // consentVersion: the policy version the storefront shows (legalContent.ts).
        start: (extra = {}) => send('/auth/telegram/start', 'POST', { consent: true, consentVersion: 'portal-legal-2026-09-30', consentLocale: 'km', locale: 'km', ...extra }),
        poll: (nonce) => send('/auth/telegram/poll', 'POST', { nonce }),
      }
    }
    const bot = async (message, secret = SECRET) => {
      const headers = { 'Content-Type': 'application/json' }
      if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret
      const response = await mf.dispatchFetch('https://admin.leangbeauty.com/api/portal/telegram/webhook', { method: 'POST', headers, body: JSON.stringify({ update_id: 1, message }) })
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : null }
    }
    const chat = (tg) => ({ id: tg, type: 'private' })
    const startMsg = (tg, nonce) => ({ message_id: 1, chat: chat(tg), from: { id: tg, first_name: 'Dara' }, text: `/start ${nonce}` })
    const contactMsg = (tg, contactUserId, phone) => ({ message_id: 2, chat: chat(tg), from: { id: tg, first_name: 'Dara' }, contact: { user_id: contactUserId, phone_number: phone, first_name: 'Dara', last_name: 'Sok' } })
    const prove = async (b, tg, phone, extra) => {
      const started = await b.start(extra)
      assert.equal(started.status, 200, `start: ${JSON.stringify(started.body)}`)
      assert.equal((await bot(startMsg(tg, started.body.nonce))).body.reply_markup.keyboard[0][0].request_contact, true)
      const shared = await bot(contactMsg(tg, tg, phone))
      assert.equal(shared.status, 200)
      return started.body.nonce
    }

    await check('0232 objects carry no LIKE/GLOB pattern over 50 bytes (native D1 limit)', async () => {
      const objects = (await db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND (tbl_name IN ('portal_login_identities', 'portal_telegram_challenges'))").all()).results
      assert.equal(objects.length >= 6, true, `0232 objects present: ${objects.map((o) => o.name).join(', ')}`)
      for (const { name, sql } of objects) assert.equal(/\b(?:LIKE|GLOB)\s+'[^']{51,}'/i.test(sql), false, `${name} has a long pattern`)
    })

    await check('native: sign-up through Telegram creates a W- member with the proven phone and signs it in', async () => {
      const b = browser()
      const nonce = await prove(b, 5560001, '+855 12 345 678')
      const done = await b.poll(nonce)
      assert.equal(done.status, 200, JSON.stringify(done.body))
      assert.equal(done.body.status, 'signed_in')
      assert.equal(done.body.created, true)
      assert.match(done.body.account.memberCode, /^W-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
      const row = await db.prepare("SELECT a.phone, a.password_hash, a.contact_id, i.subject_key, i.verified_at FROM portal_accounts a JOIN portal_login_identities i ON i.account_id = a.id WHERE i.provider = 'telegram' AND i.subject_key = '5560001'").first()
      assert.deepEqual([row.phone, row.password_hash, row.contact_id, row.subject_key, Boolean(row.verified_at)], ['012345678', null, null, '5560001', true])
      const me = await b.send('/auth/me', 'GET')
      assert.equal(me.body.account.memberCode, done.body.account.memberCode)
      assert.equal(await count('SELECT COUNT(*) AS n FROM customers'), 0)
    })

    await check('native: a forwarded contact is refused and verifies nothing', async () => {
      const b = browser()
      const started = await b.start()
      await bot(startMsg(5560002, started.body.nonce))
      const forwarded = await bot(contactMsg(5560002, 5569999, '012 999 888'))
      assert.equal(forwarded.body.reply_markup.keyboard[0][0].request_contact, true)
      assert.deepEqual((await b.poll(started.body.nonce)).body, { status: 'waiting', stage: 'started' })
      assert.equal(await count("SELECT COUNT(*) AS n FROM portal_accounts WHERE phone = '012999888'"), 0)
    })

    await check('native: a replayed poll and another browser are refused', async () => {
      const owner = browser()
      const nonce = await prove(owner, 5560003, '012 300 300')
      const thief = browser()
      await thief.start()
      assert.equal((await thief.poll(nonce)).status, 404)
      assert.equal((await owner.poll(nonce)).body.status, 'signed_in')
      delete owner.jar.bos_portal
      const replay = await owner.poll(nonce)
      assert.equal(replay.status, 409)
      assert.equal(replay.body.code, 'telegram_challenge_used')
      assert.equal(owner.jar.bos_portal, undefined)
    })

    await check('native: an existing phone account is not taken over', async () => {
      // A pre-existing phone + password member (as the old sign-up wrote them, W- code included).
      await db.prepare("INSERT INTO portal_accounts (name, phone, password_hash, member_code, status, consent_version, consent_at) VALUES ('Phone Member', '012400400', 'pbkdf2-sha256$1$x$y', 'W-0000-0000', 'active', 'portal-legal-2026-09-30', CURRENT_TIMESTAMP)").run()
      const b = browser()
      const nonce = await prove(b, 5560004, '012 400 400')
      const res = await b.poll(nonce)
      assert.equal(res.status, 409)
      assert.equal(res.body.code, 'telegram_phone_has_account')
      assert.equal(await count("SELECT COUNT(*) AS n FROM portal_login_identities WHERE subject_key = '5560004'"), 0)
      assert.equal(b.jar.bos_portal, undefined)
    })

    await check('native: a wrong or derived webhook secret is 401 and writes nothing', async () => {
      const b = browser()
      const started = await b.start()
      const before = [await count('SELECT COUNT(*) AS n FROM rate_limit_events'), await count("SELECT COUNT(*) AS n FROM portal_telegram_challenges WHERE status = 'started'")]
      for (const secret of [null, `${SECRET}x`, crypto.createHash('sha256').update(BINDINGS.TELEGRAM_BOT_TOKEN).digest('hex'), crypto.createHash('sha256').update(BINDINGS.PORTAL_TELEGRAM_BOT_TOKEN).digest('hex')]) {
        assert.equal((await bot(startMsg(5560005, started.body.nonce), secret)).status, 401)
      }
      assert.deepEqual([await count('SELECT COUNT(*) AS n FROM rate_limit_events'), await count("SELECT COUNT(*) AS n FROM portal_telegram_challenges WHERE status = 'started'")], before)
    })

    await check('native: closing a member drops its Telegram link and open handshakes in the same batch; the account joins again as a NEW member', async () => {
      const b = browser()
      const first = await prove(b, 5560006, '012 600 006')
      assert.equal((await b.poll(first)).body.status, 'signed_in')
      const old = await db.prepare("SELECT account_id FROM portal_login_identities WHERE subject_key = '5560006'").first()
      const open = await browser().start()
      await bot(startMsg(5560006, open.body.nonce))  // a sign-in that Telegram user has open
      assert.equal(await count("SELECT COUNT(*) AS n FROM portal_telegram_challenges WHERE telegram_user_id = '5560006' AND status = 'started'"), 1)
      // A close whose batch fails later keeps everything (D1 batch = one transaction).
      await assert.rejects(db.batch([
        db.prepare("UPDATE portal_accounts SET status = 'closed', phone = NULL WHERE id = ?").bind(old.account_id),
        db.prepare("INSERT INTO portal_login_identities (account_id, provider, subject_key) VALUES (?, 'sms', 'x')").bind(old.account_id),
      ]))
      assert.equal(await count(`SELECT COUNT(*) AS n FROM portal_login_identities WHERE account_id = ${Number(old.account_id)}`), 1)
      // The close as the 180-day purge writes it, in a batch with the session delete.
      await db.batch([
        db.prepare('DELETE FROM portal_sessions WHERE account_id = ?').bind(old.account_id),
        db.prepare("UPDATE portal_accounts SET status = 'closed', closed_at = CURRENT_TIMESTAMP, name = '', phone = NULL, password_hash = NULL WHERE id = ?").bind(old.account_id),
      ])
      assert.equal(await count(`SELECT COUNT(*) AS n FROM portal_login_identities WHERE account_id = ${Number(old.account_id)}`), 0, 'the link went with the close')
      assert.equal(await count("SELECT COUNT(*) AS n FROM portal_telegram_challenges WHERE telegram_user_id = '5560006'"), 0, 'and every handshake of that Telegram user')
      const again = browser()
      const nonce = await prove(again, 5560006, '012 600 006')
      const res = await again.poll(nonce)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.created, true, 'a new member')
      const now = await db.prepare("SELECT account_id FROM portal_login_identities WHERE subject_key = '5560006'").first()
      assert.notEqual(now.account_id, old.account_id)
      assert.equal((await db.prepare('SELECT status FROM portal_accounts WHERE id = ?').bind(old.account_id).first()).status, 'closed')
    })
  } finally {
    await mf.dispose()
  }
  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`)
  if (failed) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
