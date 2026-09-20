const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')

async function main() {
  const bundle = await build({ stdin: { resolveDir: path.join(__dirname, '..'), loader: 'ts', contents: `
    import auth from './src/routes/auth';
    export default { fetch(request, env, ctx) { return auth.fetch(request, env, ctx); } };
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'], compatibilityDate: '2026-08-01' })
  try {
    const db = await mf.getD1Database('DB')
    await db.batch([
      db.prepare('CREATE TABLE roles(id INTEGER PRIMARY KEY,code TEXT,permissions TEXT,name TEXT)'),
      db.prepare('CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,name TEXT,organization_id INTEGER,role_id INTEGER,permissions TEXT,is_active INTEGER,deleted_at TEXT)'),
      db.prepare('CREATE TABLE user_sessions(id INTEGER PRIMARY KEY,user_id INTEGER,token_hash TEXT,device_name TEXT,device_tz TEXT,user_agent TEXT,last_ip TEXT,device_id TEXT,expires_at TEXT,revoked_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP)'),
      db.prepare(`INSERT INTO users VALUES(1,'a','A',NULL,NULL,'{}',1,NULL),(2,'b','B',NULL,NULL,'{}',1,NULL),(3,'c','C',7,NULL,'{}',1,NULL)`),
    ])
    const hash = value => createHash('sha256').update(value).digest('hex')
    for (const [token, id] of [['a', 1], ['a-new', 1], ['b', 2], ['c', 3]]) {
      await db.prepare('INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES(?,?,?)').bind(id, hash(token), new Date(Date.now() + 86400000).toISOString()).run()
    }
    const revoked = async token => (await db.prepare('SELECT revoked_at FROM user_sessions WHERE token_hash=?').bind(hash(token)).first()).revoked_at
    const call = (token, body) => mf.dispatchFetch('https://local/logout', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { cookie: `bos_session=${token}` } : {}) }, body: JSON.stringify(body) })
    for (const body of [{ expected_actor_id: 1, expected_organization_id: null }, { expected_actor_id: 2, expected_organization_id: 7 }]) {
      const response = await call('b', body)
      assert.equal(response.status, 409)
      assert.equal(response.headers.get('set-cookie'), null)
      assert.equal(await revoked('b'), null)
    }
    for (const body of [{ expected_actor_id: 2 }, { expected_organization_id: null }, { expected_actor_id: '2', expected_organization_id: null }, { expected_actor_id: 2, expected_organization_id: 0 }]) {
      const response = await call('b', body)
      assert.equal(response.status, 400)
      assert.equal(response.headers.get('set-cookie'), null)
      assert.equal(await revoked('b'), null)
    }
    const anonymous = await call(null, { expected_actor_id: 1, expected_organization_id: null })
    assert.equal(anonymous.status, 401)
    assert.equal((await anonymous.json()).code, 'invalid_session')
    assert.equal(anonymous.headers.get('set-cookie'), null)
    const sameAccountNewSession = await call('a-new', { expected_actor_id: 1, expected_organization_id: null })
    assert.equal(sameAccountNewSession.status, 200)
    assert.match(sameAccountNewSession.headers.get('set-cookie'), /Max-Age=0/)
    assert.ok(await revoked('a-new'))
    assert.equal(await revoked('a'), null, 'only the current cookie session is revoked, not every device')
    const org = await call('c', { expected_actor_id: 3, expected_organization_id: 7 })
    assert.equal(org.status, 200)
    assert.ok(await revoked('c'))
    const legacy = await call('b', {})
    assert.equal(legacy.status, 200)
    assert.ok(await revoked('b'))
    console.log('PASS native actual logout route: foreign/partial/malformed owner denies without Set-Cookie/revoke; same-account new session, org identity, invalid session and legacy compatibility')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
