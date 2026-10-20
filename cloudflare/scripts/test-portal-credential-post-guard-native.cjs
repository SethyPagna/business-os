// Storefront login CSRF + sign-up default, through the REAL Worker.
//
// src/index.ts is bundled whole and served by local workerd (Miniflare) over
// its own HTTP layer, on a disposable in-memory D1 carrying every migration.
// Nothing is stubbed: the storefront host gate, the global F4 originGuard,
// public body admission, core-data seeding, routes/portal.ts and the staff
// routes/auth.ts all run as deployed. No remote database, deployment or
// production state is touched and no fixed port is bound.
//
// What it pins:
//   1. Every storefront credential write -- POST /auth/signup, /auth/signin,
//      /auth/signout, PUT /account/cart and /account/wishlist, POST
//      /submissions -- refuses a request the browser does not vouch for as
//      same-origin JSON, with the SAME status and code the staff
//      /api/auth/login answers for the same headers (lib/requestBodyGuard
//      credentialPostRefusal). The decisive case is the one F4 lets through:
//      neither Origin nor Sec-Fetch-Site, text/plain or form body. Before the
//      fix the storefront answered 200 and set a bos_portal cookie for it.
//   2. The storefront's own requests still work: same-origin JSON with
//      credentials (portalPublicTransport.ts), and a Safari < 16.4 request
//      that sends a matching Origin but no Sec-Fetch-Site. GET /auth/me is
//      untouched.
//   3. Customer sign-up is OFF unless the owner turns it on: with no saved
//      customer_portal_signup_enabled, sign-up answers 403
//      portal_signup_paused, writes nothing and /config says signupEnabled
//      false; an explicit 'true' opens it; an explicit 'false' stays paused;
//      an existing member still signs in while sign-up is paused.
//   4. The guard runs BEFORE the sign-in rate limiter and lockout: 45 refused
//      header-less sign-ins with a wrong password from one network spend
//      neither, so the member's own same-origin sign-in from that network
//      still gets 200 (a guard placed after them would answer 429).
//   5. The admin host (tills, no redirect) serves the storefront API too: a
//      same-origin and a Safari < 16.4 sign-in there work, header-less
//      text/plain there is refused, and a page on one host posting to the
//      other is refused in both directions.
//   6. The shop host never shows admin however the path is spelled (review
//      F4): %73ubmissions, %2F, double encoding, other letter case and
//      malformed escapes are 404 there, while the admin host's router still
//      decodes %73 to the staff review (401 without a session).
//
// PORTAL_CSRF_SRC_ROOT=<dir holding src/ and migrations/> runs the same
// checks against another tree (the fail-on-base proof); packages still
// resolve from this checkout.
//
// Run: node scripts/test-portal-credential-post-guard-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: splitSql } = require('wrangler')

const here = path.resolve(__dirname, '..')
const root = path.resolve(process.env.PORTAL_CSRF_SRC_ROOT || here)
const SHOP = 'https://shop.csrf.example'
const ADMIN = 'https://admin.csrf.example'
const FOREIGN = 'https://attacker.example'
const PASSWORD = 'member-pass-1'
const SIGNUP_KEY = 'customer_portal_signup_enabled'
const CREDENTIAL_CODES = new Set(['credential_origin_refused', 'credential_json_required', 'cross_origin_write_refused'])

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}`); console.log(error && error.stack ? error.stack : error) }
}

// Header shapes a browser can produce. `site`/`origin` undefined = header absent.
const CASES = [
  { name: 'no Origin, no Sec-Fetch-Site, text/plain body (the F4 gap)', origin: undefined, site: undefined, type: 'text/plain', expect: [403, 'credential_origin_refused'] },
  { name: 'no Origin, no Sec-Fetch-Site, form-encoded body', origin: undefined, site: undefined, type: 'application/x-www-form-urlencoded', form: true, expect: [403, 'credential_origin_refused'] },
  { name: 'no Origin, no Sec-Fetch-Site, JSON body', origin: undefined, site: undefined, type: 'application/json', expect: [403, 'credential_origin_refused'] },
  { name: 'Sec-Fetch-Site none (address bar / bookmark), JSON body', origin: undefined, site: 'none', type: 'application/json', expect: [403, 'credential_origin_refused'] },
  { name: 'foreign Origin, cross-site form post', origin: FOREIGN, site: 'cross-site', type: 'application/x-www-form-urlencoded', form: true, expect: [403, 'cross_origin_write_refused'] },
  { name: 'foreign Origin without Sec-Fetch-Site, text/plain', origin: FOREIGN, site: undefined, type: 'text/plain', expect: [403, 'cross_origin_write_refused'] },
  { name: 'opaque Origin null (sandboxed form), text/plain', origin: 'null', site: undefined, type: 'text/plain', expect: [403, 'cross_origin_write_refused'] },
  { name: 'Sec-Fetch-Site same-site (sibling subdomain), JSON', origin: undefined, site: 'same-site', type: 'application/json', expect: [403, 'cross_origin_write_refused'] },
  { name: 'same-origin but text/plain body', origin: 'self', site: 'same-origin', type: 'text/plain', expect: [415, 'credential_json_required'] },
]

function encodeBody(payload, form) {
  if (!form) return JSON.stringify(payload)
  return new URLSearchParams(Object.entries(payload).map(([k, v]) => [k, String(v)])).toString()
}

async function main() {
  const bundle = await build({
    entryPoints: [path.join(root, 'src/index.ts')], bundle: true, write: false, platform: 'browser', format: 'esm',
    target: 'es2022', external: ['node:*', 'cloudflare:*'], logLevel: 'silent', nodePaths: [path.join(here, 'node_modules')],
  })
  const outbound = []
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], r2Buckets: ['ASSETS'], kvNamespaces: ['CACHE'], cache: false,
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: {
      PLAN_TIER: 'paid', BUSINESS_OS_PUBLIC_URL: SHOP, BUSINESS_OS_ADMIN_URL: ADMIN,
      BUSINESS_OS_ORGANIZATION_SLUG: 'leang-cosmetics', BUSINESS_OS_ORGANIZATION_NAME: 'Disposable CSRF fixture',
      PORTAL_ABUSE_HMAC_SECRET: 'p'.repeat(48),
    },
    outboundService: (request) => { outbound.push(request.url); return new Response('External network refused by local fixture', { status: 503 }) },
    log: new Log(LogLevel.ERROR),
  })
  try {
    const db = await mf.getD1Database('DB')
    for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
      for (const statement of splitSql(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))) {
        if (file === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
        try { await db.prepare(statement).run() } catch (error) { throw new Error(`Migration ${file}: ${error.message}`) }
      }
    }
    const one = async (sql, ...values) => (await db.prepare(sql).bind(...values).first())
    const count = async (table) => Number((await one(`SELECT COUNT(*) AS n FROM ${table}`)).n)
    async function setSignup(value) {
      await db.prepare('DELETE FROM settings WHERE key = ?').bind(SIGNUP_KEY).run()
      if (value !== undefined) await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(SIGNUP_KEY, value).run()
    }
    await db.prepare("INSERT INTO settings (key, value) VALUES ('customer_portal_submission_enabled', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run()

    let ipSeq = 0
    // One request through workerd's HTTP layer. `origin: 'self'` = this host.
    async function send(base, pathname, { method = 'POST', origin, site, type, body, cookie, ip } = {}) {
      const headers = { 'CF-Connecting-IP': ip || `198.51.100.${(ipSeq++ % 250) + 1}` }
      if (origin !== undefined) headers.Origin = origin === 'self' ? base : origin
      if (site !== undefined) headers['Sec-Fetch-Site'] = site
      if (type !== undefined) headers['Content-Type'] = type
      if (cookie) headers.Cookie = cookie
      const response = await mf.dispatchFetch(base + pathname, { method, headers, ...(body === undefined ? {} : { body }) })
      const text = await response.text()
      let json = null
      try { json = JSON.parse(text) } catch (_) {}
      return { status: response.status, body: json, text, setCookie: response.headers.get('set-cookie') }
    }
    // The storefront page itself: portalPublicTransport.ts portalAuthRequest
    // (same origin, Content-Type application/json, credentials: 'include').
    const storefront = (pathname, method, payload, cookie) => send(SHOP, `/api/portal${pathname}`, {
      method, origin: method === 'GET' ? undefined : 'self', site: 'same-origin',
      type: payload === undefined ? undefined : 'application/json', body: payload === undefined ? undefined : JSON.stringify(payload), cookie,
    })
    const portalCookie = (setCookie) => {
      const match = /(?:^|,\s*)(bos_portal=[^;]*)/.exec(String(setCookie || ''))
      return match ? match[1] : null
    }
    let phoneSeq = 0
    const freshPhone = () => `012 6${String(++phoneSeq).padStart(2, '0')} ${String(100 + phoneSeq).padStart(3, '0')}`
    const signupPayload = (phone) => ({ name: 'Csrf Member', phone, password: PASSWORD, consent: true, ageConfirmed: true, consentLocale: 'en' })

    // --- 3. sign-up default -------------------------------------------------
    await check('no saved setting: sign-up is paused (403 portal_signup_paused), nothing written, no cookie, /config says so', async () => {
      await setSignup(undefined)
      const accounts = await count('portal_accounts')
      const customers = await count('customers')
      const response = await storefront('/auth/signup', 'POST', signupPayload(freshPhone()))
      assert.equal(response.status, 403, response.text)
      assert.equal(response.body.code, 'portal_signup_paused')
      assert.equal(portalCookie(response.setCookie), null)
      assert.equal(await count('portal_accounts'), accounts)
      assert.equal(await count('customers'), customers)
      const config = await send(SHOP, '/api/portal/config', { method: 'GET' })
      assert.equal(config.status, 200, config.text)
      assert.equal(config.body.signupEnabled, false, 'the storefront hides Sign up when nothing is saved')
    })

    await check('explicit false stays paused (control)', async () => {
      await setSignup('false')
      const response = await storefront('/auth/signup', 'POST', signupPayload(freshPhone()))
      assert.equal(response.status, 403, response.text)
      assert.equal(response.body.code, 'portal_signup_paused')
      assert.equal((await send(SHOP, '/api/portal/config', { method: 'GET' })).body.signupEnabled, false)
    })

    let member = null
    await check('explicit true: the storefront sign-up (same-origin JSON) works, writes the account, sets bos_portal; /config says enabled', async () => {
      await setSignup('true')
      const accounts = await count('portal_accounts')
      const phone = freshPhone()
      const response = await storefront('/auth/signup', 'POST', signupPayload(phone))
      assert.equal(response.status, 200, response.text)
      assert.equal(response.body.ok, true)
      assert.ok(portalCookie(response.setCookie), 'sign-up sets the bos_portal session cookie')
      assert.equal(await count('portal_accounts'), accounts + 1)
      assert.equal((await send(SHOP, '/api/portal/config', { method: 'GET' })).body.signupEnabled, true)
      const row = await one('SELECT id FROM portal_accounts ORDER BY id DESC LIMIT 1')
      member = { id: Number(row.id), phone, cookie: portalCookie(response.setCookie) }
    })
    assert.ok(member, 'cannot continue without a member account')
    const signinPayload = { identifier: 'Csrf Member', phone: member.phone, password: PASSWORD, consent: true, consentLocale: 'en' }

    await check('paused sign-up never blocks an existing member: same-origin sign-in still works', async () => {
      await setSignup(undefined)
      const response = await storefront('/auth/signin', 'POST', signinPayload)
      assert.equal(response.status, 200, response.text)
      assert.ok(portalCookie(response.setCookie))
    })

    // --- 2. the storefront's own requests still work -----------------------
    await setSignup('true')
    await check('same-origin JSON sign-in works and sets bos_portal', async () => {
      const response = await storefront('/auth/signin', 'POST', signinPayload)
      assert.equal(response.status, 200, response.text)
      assert.equal(response.body.ok, true)
      member.cookie = portalCookie(response.setCookie)
      assert.ok(member.cookie)
    })

    await check('Safari < 16.4 shape (matching Origin, no Sec-Fetch-Site, JSON) signs in', async () => {
      const response = await send(SHOP, '/api/portal/auth/signin', { origin: 'self', type: 'application/json', body: JSON.stringify(signinPayload) })
      assert.equal(response.status, 200, response.text)
      assert.ok(portalCookie(response.setCookie))
    })

    await check('GET /auth/me needs no Origin or Sec-Fetch-Site (reads are untouched)', async () => {
      const response = await send(SHOP, '/api/portal/auth/me', { method: 'GET', cookie: member.cookie })
      assert.equal(response.status, 200, response.text)
      assert.equal(response.body.account && response.body.account.name, 'Csrf Member')
    })

    await check('same-origin JSON cart and wishlist saves work', async () => {
      const cart = await storefront('/account/cart', 'PUT', { items: [{ id: 'p-1', name: 'Lip tint', qty: 2 }] }, member.cookie)
      assert.equal(cart.status, 200, cart.text)
      assert.deepEqual(cart.body.items, [{ id: 'p-1', name: 'Lip tint', qty: 2 }])
      const wish = await storefront('/account/wishlist', 'PUT', { items: [{ id: 'p-2', name: 'Serum' }] }, member.cookie)
      assert.equal(wish.status, 200, wish.text)
      const saved = await storefront('/account/cart', 'GET', undefined, member.cookie)
      assert.deepEqual(saved.body.items, [{ id: 'p-1', name: 'Lip tint', qty: 2 }])
    })

    await check('same-origin JSON screenshot submission passes the guard and reaches body validation', async () => {
      const response = await storefront('/submissions', 'POST', { screenshots: [] }, member.cookie)
      assert.equal(response.status, 400, response.text)
      assert.equal(response.body.code, 'submission_consent_required')
    })

    // --- 1. refusals, identical to staff /api/auth/login -------------------
    const staffLoginBody = { username: 'nobody', password: 'irrelevant-pass' }
    for (const testCase of CASES) {
      await check(`staff /api/auth/login answers ${testCase.expect.join(' ')} for: ${testCase.name}`, async () => {
        const staff = await send(ADMIN, '/api/auth/login', { origin: testCase.origin, site: testCase.site, type: testCase.type, body: encodeBody(staffLoginBody, testCase.form) })
        assert.deepEqual([staff.status, staff.body && staff.body.code], testCase.expect, staff.text)
      })

      await check(`sign-up refused like staff login: ${testCase.name}`, async () => {
        await setSignup('true')
        const accounts = await count('portal_accounts')
        const response = await send(SHOP, '/api/portal/auth/signup', { origin: testCase.origin, site: testCase.site, type: testCase.type, body: encodeBody(signupPayload(freshPhone()), testCase.form) })
        assert.deepEqual([response.status, response.body && response.body.code], testCase.expect, response.text)
        assert.equal(portalCookie(response.setCookie), null, 'a refused sign-up sets no cookie')
        assert.equal(await count('portal_accounts'), accounts, 'a refused sign-up writes no account')
      })

      await check(`sign-in refused like staff login: ${testCase.name}`, async () => {
        const response = await send(SHOP, '/api/portal/auth/signin', { origin: testCase.origin, site: testCase.site, type: testCase.type, body: encodeBody(signinPayload, testCase.form) })
        assert.deepEqual([response.status, response.body && response.body.code], testCase.expect, response.text)
        assert.equal(portalCookie(response.setCookie), null, 'a refused sign-in plants no session cookie (login CSRF)')
      })
    }

    // The other cookie-bearing storefront writes, with the victim's cookie.
    const buckets = async () => {
      const row = await one('SELECT cart_json, wishlist_json FROM portal_accounts WHERE id = ?', member.id)
      return { cart: row.cart_json, wishlist: row.wishlist_json }
    }
    for (const testCase of CASES.filter((c) => c.expect[1] !== 'cross_origin_write_refused')) {
      await check(`sign-out, cart, wishlist and submissions refuse: ${testCase.name}`, async () => {
        const before = { buckets: await buckets(), submissions: await count('customer_share_submissions') }
        for (const [method, pathname, payload] of [
          ['POST', '/auth/signout', {}],
          ['PUT', '/account/cart', { items: [{ id: 'attacker', qty: 9 }] }],
          ['PUT', '/account/wishlist', { items: [{ id: 'attacker' }] }],
          ['POST', '/submissions', { rightsConsent: true, privacyConsent: true, screenshots: [] }],
        ]) {
          const response = await send(SHOP, `/api/portal${pathname}`, { method, origin: testCase.origin, site: testCase.site, type: testCase.type, body: encodeBody(payload, testCase.form), cookie: member.cookie })
          assert.deepEqual([response.status, response.body && response.body.code], testCase.expect, `${method} ${pathname}: ${response.text}`)
        }
        assert.deepEqual(await buckets(), before.buckets, 'refused cart / wishlist writes leave the saved buckets alone')
        assert.equal(await count('customer_share_submissions'), before.submissions)
        const me = await send(SHOP, '/api/portal/auth/me', { method: 'GET', cookie: member.cookie })
        assert.equal(me.body && me.body.account && me.body.account.name, 'Csrf Member', 'a refused sign-out leaves the session signed in')
      })
    }

    // --- 4. the guard runs before the rate limiter and the lockout ----------
    await check('45 refused header-less wrong-password sign-ins spend neither the rate limit nor the lockout', async () => {
      const ip = '203.0.113.77'
      const wrong = JSON.stringify({ ...signinPayload, password: 'not-the-password' })
      const answers = new Map()
      for (let i = 0; i < 45; i += 1) {
        const response = await send(SHOP, '/api/portal/auth/signin', { type: 'text/plain', body: wrong, ip })
        const key = `${response.status} ${response.body && response.body.code}`
        answers.set(key, (answers.get(key) || 0) + 1)
      }
      assert.deepEqual([...answers], [['403 credential_origin_refused', 45]], 'every forged attempt stops at the guard')
      const own = await send(SHOP, '/api/portal/auth/signin', { origin: 'self', site: 'same-origin', type: 'application/json', body: JSON.stringify(signinPayload), ip })
      assert.equal(own.status, 200, `the member's own sign-in from the same network: ${own.text}`)
      assert.ok(portalCookie(own.setCookie))
    })

    // --- 5. the admin host --------------------------------------------------
    await check('admin host: same-origin JSON and the Safari < 16.4 shape sign in to the storefront API', async () => {
      const same = await send(ADMIN, '/api/portal/auth/signin', { origin: 'self', site: 'same-origin', type: 'application/json', body: JSON.stringify(signinPayload) })
      assert.equal(same.status, 200, same.text)
      assert.ok(portalCookie(same.setCookie))
      const safari = await send(ADMIN, '/api/portal/auth/signin', { origin: 'self', type: 'application/json', body: JSON.stringify(signinPayload) })
      assert.equal(safari.status, 200, safari.text)
      assert.ok(portalCookie(safari.setCookie))
    })

    await check('admin host: header-less text/plain is refused like on the shop host', async () => {
      const response = await send(ADMIN, '/api/portal/auth/signin', { type: 'text/plain', body: JSON.stringify(signinPayload) })
      assert.deepEqual([response.status, response.body && response.body.code], [403, 'credential_origin_refused'], response.text)
      assert.equal(portalCookie(response.setCookie), null)
    })

    await check('cross-host: a shop page posting to the admin host, and an admin page posting to the shop host, are refused', async () => {
      const cases = [
        [ADMIN, { origin: SHOP, site: 'same-site' }],
        [ADMIN, { origin: SHOP }],
        [SHOP, { origin: ADMIN, site: 'same-site' }],
        [SHOP, { origin: ADMIN }],
      ]
      for (const [base, headers] of cases) {
        const response = await send(base, '/api/portal/auth/signin', { ...headers, type: 'application/json', body: JSON.stringify(signinPayload) })
        assert.deepEqual([response.status, response.body && response.body.code], [403, 'cross_origin_write_refused'], `${headers.origin} -> ${base}: ${response.text}`)
        assert.equal(portalCookie(response.setCookie), null)
      }
    })

    // --- 6. the shop host never shows admin, however the path is spelled ----
    await check('shop host: encoded staff paths are 404 through the real router; the admin host still routes them (control)', async () => {
      const control = await send(ADMIN, '/api/portal/%73ubmissions/review', { method: 'GET' })
      assert.equal(control.status, 401, `the router decodes %73 and reaches the staff review on the admin host: ${control.text}`)
      for (const [method, pathname] of [
        ['GET', '/api/portal/%73ubmissions/review'],
        ['PATCH', '/api/portal/%73ubmissions/1/review'],
        ['GET', '/api/portal/%73ubmissions/1/screenshot/0'],
        ['GET', '/api/portal/submissions%2F1%2Freview'],
        ['GET', '/api/portal/%2573ubmissions/review'],
        ['GET', '/api/portal/%53ubmissions/review'],
        ['GET', '/API/auth/login'],
        ['GET', '/api/%61uth/me'],
        ['GET', '/api/portal/%zz/review'],
        ['GET', '/api/portal/config%'],
      ]) {
        const response = await send(SHOP, pathname, { method, origin: 'self', site: 'same-origin', type: method === 'GET' ? undefined : 'application/json', body: method === 'GET' ? undefined : JSON.stringify({ status: 'approved' }) })
        assert.deepEqual([response.status, response.body], [404, { error: 'Not found' }], `${method} ${pathname} on the shop host: ${response.text}`)
      }
      const encodedStorefront = await send(SHOP, '/api/portal/%63onfig', { method: 'GET' })
      assert.equal(encodedStorefront.status, 200, `an encoded storefront path is still the storefront: ${encodedStorefront.text}`)
    })

    await check('same-origin JSON sign-out (the storefront sends {}) works', async () => {
      const response = await storefront('/auth/signout', 'POST', {}, member.cookie)
      assert.equal(response.status, 200, response.text)
      assert.equal(response.body.ok, true)
    })

    await check('no request left the machine', async () => {
      assert.deepEqual(outbound, [])
    })
  } finally {
    await mf.dispose()
  }
  if (failed) throw new Error(`${failed} storefront credential-guard check(s) failed`)
  console.log('PASS storefront credential posts: staff-identical CSRF refusals, same-origin JSON intact, sign-up OFF unless explicitly on')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
