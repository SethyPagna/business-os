'use strict'
// D9 (wave-3 Slice C): the two OTHER writers of a customer phone refuse a number another customer owns exactly as POST /customers does. The sibling test
// (test-contacts-slash-phone-conflict-native.cjs) covers POST and check-duplicate; this one covers
//   - PUT /customers/:id (editing a customer's phone to a number someone else owns), and
//   - POST /customers/link-conflicts/resolve-missing without a target (it creates the customer, a contacts Add like POST /customers),
// for the same owner shapes: a slashed number, a +855 slashed option, a primary slash with a NULL key, a foreign slash, an option phone stored as a JSON number
// (the digits view does not read it: only the write guard sees it) and a phone on a 4th option that carries data (the classifier must read every option, not the first 3). It is refused with 409 naming the owner too (the classifier reads every stored option, as the write guard does).
// Each answers 409 and the refusal names the owner (never a 500, never a created or changed row). Every shape is also sent to POST /customers and must agree with it.
// Real mounted Contacts route on Miniflare D1 with every migration applied. Invented numbers only.
// Run (from cloudflare/): node scripts/test-customers-duplicate-routes-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = process.env.CSM_ROOT || path.resolve(__dirname, '..')
const entry = `import contacts from './src/routes/contacts.ts'\nexport default { fetch: (r, e, c) => contacts.fetch(r, e, c) }`
const fixtureAuth = {
  name: 'fixture-auth',
  setup(b) {
    b.onResolve({ filter: /lib\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export const requireAuth=async(c,next)=>{c.set('user',{id:1,username:'owner',role_code:'admin',permissions:JSON.stringify({all:true}),role_permissions:'{}'});return next()};", loader: 'ts' }))
  },
}
const owners = [
  ['option slash', 'Owner A', '011 222 301', '011222301', [{ label: 'Office', phone: '023 216 666/7' }], '023 216 6667'],
  ['option slash +855', 'Owner B', '011 222 302', '011222302', [{ label: 'Office', phone: '+855 12/888 999' }], '012 888 999'],
  ['primary slash, NULL key', 'Owner C', '098 765/432', null, null, '098 765 432'],
  ['foreign slash', 'Owner D', '+44 20/7946 0958', null, null, '+44 20 7946 0958'],
  ['option phone stored as a JSON number (guard-only)', 'Owner E', '011 222 305', '011222305', [{ label: 'N', phone: 85512555001 }], '012 555 001'],
  ['phone on a 4th option that carries data', 'Owner F', '011 222 306', '011222306', [{ label: 'A', phone: '011 222 307' }, { label: 'B', phone: '011 222 308' }, { label: 'C', phone: '011 222 309' }, { label: 'D', phone: '010 100 103' }], '010 100 103'],
]

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: entry }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], nodePaths: [path.resolve(__dirname, '..', 'node_modules')], logLevel: 'error', plugins: [fixtureAuth] })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], r2Buckets: ['ASSETS'], kvNamespaces: ['CACHE'], log: new Log(LogLevel.NONE) })
  try {
    const db = await mf.getD1Database('DB')
    const dir = path.join(root, 'migrations')
    const stmts = []
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(dir, name), 'utf8')).filter((s) => s.trim())) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        stmts.push(sql)
      }
    }
    for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100).map((s) => db.prepare(s)))
    await db.prepare("INSERT INTO users (id, username, name, password) VALUES (1,'owner','Owner','x')").run().catch(() => {})
    let id = 50
    for (const [, name, phone, key, options] of owners) {
      id += 1
      await db.prepare('INSERT INTO customers (id,name,phone,phone_normalized,address,membership_number,is_anonymous) VALUES (?,?,?,?,?,?,0)').bind(id, name, phone, key, options ? JSON.stringify(options) : null, `LC-${id}`).run()
    }
    // The customer whose phone the PUT edits to each typed number, and the one the group of unlinked sales names.
    await db.prepare("INSERT INTO customers (id,name,phone,phone_normalized,membership_number,is_anonymous) VALUES (900,'Mover','099 000 900','099000900','LC-900',0)").run()
    const send = async (method, url, body) => {
      const r = await mf.dispatchFetch('http://local' + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const text = await r.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* keep text */ }
      return { status: r.status, json, text }
    }
    const count = async () => (await db.prepare('SELECT COUNT(*) c FROM customers').first()).c
    const before = await count()
    const moverBefore = await db.prepare('SELECT name, phone, phone_normalized, address FROM customers WHERE id = 900').first()
    let passed = 0
    for (const [label, ownerName, , , , typed] of owners) {
      const create = await send('POST', '/customers', { name: 'Newcomer', phone: typed })
      assert.equal(create.status, 409, `${label}: control, POST /customers refuses with 409, got ${create.status} ${create.text.slice(0, 160)}`)
      assert.ok(JSON.stringify(create.json).includes(ownerName), `${label}: control, the POST refusal names ${ownerName}`)

      const put = await send('PUT', '/customers/900', { name: 'Mover', phone: typed })
      assert.equal(put.status, 409, `${label}: PUT /customers/:id must refuse with 409, got ${put.status} ${put.text.slice(0, 160)}`)
      assert.ok(JSON.stringify(put.json).includes(ownerName), `${label}: the PUT refusal names ${ownerName}: ${put.text.slice(0, 160)}`)

      const resolve = await send('POST', '/customers/link-conflicts/resolve-missing', { name: 'Newcomer', phone: typed, phone_key: typed.replace(/D/g, '') })
      assert.equal(resolve.status, 409, `${label}: resolve-missing must refuse with 409, got ${resolve.status} ${resolve.text.slice(0, 160)}`)
      assert.ok(JSON.stringify(resolve.json).includes(ownerName), `${label}: the resolve-missing refusal names ${ownerName}: ${resolve.text.slice(0, 160)}`)
      passed += 1
      console.log(`PASS ${label}`)
    }
    assert.equal(await count(), before, 'no customer was created by any of the three writers')
    assert.deepEqual(await db.prepare('SELECT name, phone, phone_normalized, address FROM customers WHERE id = 900').first(), moverBefore, 'the refused PUTs changed nothing')
    // Control: the same two writers accept a number nobody owns, so the 409s above are the duplicate guard and not a refusal of the route itself.
    const free = await send('PUT', '/customers/900', { name: 'Mover', phone: '077 123 456' })
    assert.equal(free.status, 200, `control: PUT with a free number: ${free.status} ${free.text.slice(0, 160)}`)
    const made = await send('POST', '/customers/link-conflicts/resolve-missing', { name: 'Fresh Group', phone: '066 123 456', phone_key: '066123456' })
    assert.equal(made.status, 200, `control: resolve-missing with a free number: ${made.status} ${made.text.slice(0, 160)}`)
    assert.equal(made.json.created, true)
    console.log(`${passed} passed`)
  } finally { await mf.dispose() }
}
main().catch((e) => { console.error(e); process.exit(1) })
