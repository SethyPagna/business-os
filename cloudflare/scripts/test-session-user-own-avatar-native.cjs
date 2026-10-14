// The signed-in account's own profile photo reaches the client.
//
// GET /api/auth/me and GET /api/auth/bootstrap return the session user, and the
// session lookup never selected users.avatar_path, so after any reload the top
// bar and the profile menu had no photo to draw and fell back to the initial
// even though the upload had persisted. Drives the real routes/auth.ts and the
// real lib/auth.ts session lookup over D1 (Miniflare):
//   - /me and /bootstrap carry the caller's own avatar_path and updated_at
//     (the client appends updated_at as ?v= to bust the cache on a change);
//   - a replaced photo is served on the next read, a removed one comes back null;
//   - another account's photo, name or any other user's row never rides along,
//     and the user object keeps its fixed key set (no other private columns).

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')

const EXPECTED_USER_KEYS = [
  'avatar_path', 'id', 'is_active', 'must_change_password', 'name', 'organization_id', 'permissions',
  'role_code', 'role_id', 'role_name', 'role_permissions', 'updated_at', 'username',
]

async function main() {
  const bundle = await build({ stdin: { resolveDir: path.join(__dirname, '..'), loader: 'ts', contents: `
    import auth from './src/routes/auth';
    export default { fetch(request, env, ctx) { return auth.fetch(request, env, ctx); } };
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:*', 'cloudflare:*'] })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'], compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'] })
  try {
    const db = await mf.getD1Database('DB')
    await db.batch([
      db.prepare('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)'),
      db.prepare('CREATE TABLE roles(id INTEGER PRIMARY KEY,code TEXT,permissions TEXT,name TEXT)'),
      db.prepare('CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,name TEXT,organization_id INTEGER,role_id INTEGER,permissions TEXT,is_active INTEGER,deleted_at TEXT,must_change_password INTEGER DEFAULT 0,avatar_path TEXT,updated_at TEXT,password TEXT,phone TEXT,email TEXT)'),
      db.prepare('CREATE TABLE user_sessions(id INTEGER PRIMARY KEY,user_id INTEGER,token_hash TEXT,device_name TEXT,device_tz TEXT,user_agent TEXT,last_ip TEXT,device_id TEXT,expires_at TEXT,revoked_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP)'),
      db.prepare(`INSERT INTO roles VALUES(1,'admin','{"all":true}','Administrator')`),
      db.prepare(`INSERT INTO users(id,username,name,role_id,permissions,is_active,avatar_path,updated_at,password,phone,email) VALUES
        (1,'owner','Owner A',1,'{}',1,'/uploads/owner-a.png','2026-10-14 08:00:00','hash','012345678','a@example.test'),
        (2,'cashier','Cashier B',1,'{}',1,'/uploads/cashier-b.png','2026-10-14 09:00:00','hash','099999999','b@example.test'),
        (3,'nophoto','No Photo',1,'{}',1,NULL,'2026-10-14 10:00:00','hash',NULL,NULL)`),
    ])
    const hash = value => createHash('sha256').update(value).digest('hex')
    for (const [token, id] of [['owner', 1], ['cashier', 2], ['nophoto', 3]]) {
      await db.prepare('INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES(?,?,?)').bind(id, hash(token), new Date(Date.now() + 86400000).toISOString()).run()
    }
    const get = async (route, token) => {
      const response = await mf.dispatchFetch(`https://local${route}`, { headers: { cookie: `bos_session=${token}` } })
      assert.equal(response.status, 200, `${route} as ${token}`)
      return { body: await response.json(), text: null }
    }

    for (const route of ['/me', '/bootstrap']) {
      const { body } = await get(route, 'owner')
      assert.equal(body.user.avatar_path, '/uploads/owner-a.png', `${route} carries the caller's own photo`)
      assert.equal(body.user.updated_at, '2026-10-14 08:00:00', `${route} carries the revision used as the cache-bust version`)
      assert.deepEqual(Object.keys(body.user).sort(), EXPECTED_USER_KEYS, `${route} user keeps its fixed, minimal key set`)
      const serialized = JSON.stringify(body)
      for (const foreign of ['cashier-b', 'Cashier B', '099999999', 'b@example.test', 'a@example.test', '012345678', 'hash']) {
        assert.ok(!serialized.includes(foreign), `${route} for the owner must not contain ${foreign}`)
      }

      const cashier = (await get(route, 'cashier')).body
      assert.equal(cashier.user.avatar_path, '/uploads/cashier-b.png', `${route} is per caller`)
      assert.ok(!JSON.stringify(cashier).includes('owner-a'), `${route} for the cashier must not contain the owner's photo`)

      assert.equal((await get(route, 'nophoto')).body.user.avatar_path, null, `${route} with no photo is null, not missing`)
    }

    await db.prepare(`UPDATE users SET avatar_path='/uploads/owner-a2.png', updated_at='2026-10-14 11:00:00' WHERE id=1`).run()
    const replaced = (await get('/bootstrap', 'owner')).body.user
    assert.equal(replaced.avatar_path, '/uploads/owner-a2.png')
    assert.equal(replaced.updated_at, '2026-10-14 11:00:00', 'a replaced photo changes the cache-bust version')

    await db.prepare(`UPDATE users SET avatar_path=NULL, updated_at='2026-10-14 12:00:00' WHERE id=1`).run()
    assert.equal((await get('/me', 'owner')).body.user.avatar_path, null, 'a removed photo reads back null')

    console.log('PASS native /me and /bootstrap: own avatar_path + updated_at, per caller, replaced/removed, no foreign data, fixed key set')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
