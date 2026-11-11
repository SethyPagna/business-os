'use strict'
// A phone saved with a slash ("023 216 666/7", written by the customer CSV import and the API create/update path) must still name its owner:
//   - GET /customers/check-duplicate returns the owner as phone_conflict (the digits-index narrowing sees it through the adjacent-pair phrases);
//   - POST /customers with the same number answers 409 (never a 500);
//   - when the narrowed pre-check cannot see an owner but the write guard refuses (an option phone stored as a JSON number, which the digits view does not read),
//     the refusal still resolves to 409 phone_conflict, because duplicateBlockAfterGuardFailure reads today's full statement.
// Real mounted Contacts route on Miniflare D1 with every migration applied. Invented numbers only.
// Run (from cloudflare/): node scripts/test-contacts-slash-phone-conflict-native.cjs
// CSM_ROOT=<other checkout of cloudflare/> runs it against that tree (used to show it red on the previous head).
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
    const send = async (method, url, body) => {
      const r = await mf.dispatchFetch('http://local' + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const text = await r.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* keep text */ }
      return { status: r.status, json, text }
    }
    const before = (await db.prepare('SELECT COUNT(*) c FROM customers').first()).c
    let passed = 0
    for (const [label, ownerName, , , , typed] of owners) {
      const guardOnly = label.includes('guard-only')
      if (!guardOnly) {
        const check = await send('GET', '/customers/check-duplicate?name=Newcomer&phone=' + encodeURIComponent(typed))
        assert.equal(check.status, 200, `${label}: check-duplicate ${check.text.slice(0, 120)}`)
        assert.ok((check.json.matches || []).some((m) => m.name === ownerName && m.severity === 'phone_conflict'), `${label}: check-duplicate names ${ownerName}: ${check.text.slice(0, 160)}`)
      }
      const create = await send('POST', '/customers', { name: 'Newcomer', phone: typed })
      assert.equal(create.status, 409, `${label}: POST /customers must refuse with 409, got ${create.status} ${create.text.slice(0, 160)}`)
      assert.ok(JSON.stringify(create.json).includes(ownerName), `${label}: the refusal names ${ownerName}`)
      passed += 1
      console.log(`PASS ${label}`)
    }
    assert.equal((await db.prepare('SELECT COUNT(*) c FROM customers').first()).c, before, 'no customer was created')
    console.log(`${passed} passed`)
  } finally { await mf.dispose() }
}
main().catch((e) => { console.error(e); process.exit(1) })
