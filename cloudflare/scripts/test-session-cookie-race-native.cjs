// Real Hono auth library + native workerd/D1. Authentication credential entry
// is fixture-only; createSession, cookie issuance, requireAuth and renewal SQL
// are production code. Delayed DB completion makes browser response order explicit.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')

async function main() {
  const bundle = await build({ stdin: { resolveDir: path.join(__dirname, '..'), loader: 'ts', contents: `
    import { Hono } from 'hono';
    import { requireAuth, createSession, setSessionCookie } from './src/lib/auth';
    let release = () => {}, entered = () => {}, gate = Promise.resolve(), entry = Promise.resolve();
    const app = new Hono();
    app.post('/arm', c => { gate = new Promise(r=>release=r); entry = new Promise(r=>entered=r); return c.json({ok:true}); });
    app.get('/entered', async c => { await entry; return c.json({ok:true}); });
    app.post('/release', c => { release(); return c.json({ok:true}); });
    app.post('/login', async c => {
      const { userId, duration } = await c.req.json();
      const session = await createSession(c.env, userId, {sessionDuration:duration});
      setSessionCookie(c, session.token, session.expiresAt);
      return c.json({sessionExpiresAt:session.expiresAt});
    });
    app.get('/protected', requireAuth, async c => {
      await Promise.all(c.env.pending);
      return c.json({id:c.get('user').id});
    });
    export default { fetch(request, env, ctx) {
      const pending = [];
      const db = request.headers.get('x-hold') === '1' ? {
        prepare(sql) { const stmt = env.DB.prepare(sql); return { bind(...values) {
          const bound = stmt.bind(...values); return {
            first:()=>bound.first(), all:()=>bound.all(), run:async()=>{
              if (/UPDATE user_sessions SET expires_at/.test(sql)) { entered(); await gate; }
              return bound.run();
            }
          };
        }}; }
      } : env.DB;
      return app.fetch(request,{...env,DB:db,pending},{waitUntil(p){pending.push(p);ctx.waitUntil(p)},passThroughOnException(){}});
    }};
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })
  // Test-only scheduling: hold one request until a second request releases it.
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'], compatibilityDate: '2026-08-01', compatibilityFlags: ['no_handle_cross_request_promise_resolution'] })
  try {
    const db = await mf.getD1Database('DB')
    await db.batch([
      db.prepare('CREATE TABLE roles(id INTEGER PRIMARY KEY,code TEXT,permissions TEXT,name TEXT)'),
      db.prepare('CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,name TEXT,organization_id INTEGER,role_id INTEGER,permissions TEXT,is_active INTEGER,deleted_at TEXT)'),
      db.prepare(`CREATE TABLE user_sessions(id INTEGER PRIMARY KEY,user_id INTEGER,token_hash TEXT,device_name TEXT,device_tz TEXT,user_agent TEXT,last_ip TEXT,device_id TEXT,expires_at TEXT,revoked_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
      db.prepare(`INSERT INTO users VALUES(1,'admin-a','A',NULL,NULL,'{"all":true}',1,NULL),(2,'employee-b','B',NULL,NULL,'{"pos":true}',1,NULL)`),
    ])
    const hash = token => createHash('sha256').update(token).digest('hex')
    const day = 86400000
    const oldExpiry = new Date(Date.now() + 10 * day).toISOString()
    const oldCreated = new Date(Date.now() - 20 * day).toISOString()
    await db.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at) VALUES(1,?,?,?)').bind(hash('old-a'), oldCreated, oldExpiry).run()
    const call = (url, init = {}) => mf.dispatchFetch('https://local' + url, init)
    const beginHeld = async () => {
      await call('/arm', { method: 'POST' })
      const request = call('/protected', { headers: { cookie: 'bos_session=old-a', 'x-hold': '1' } })
      await call('/entered')
      return { request }
    }
    let held = await beginHeld()
    const login = await call('/login', { method: 'POST', body: JSON.stringify({ userId: 2, duration: '1d' }) })
    const cookie = login.headers.get('set-cookie')
    assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=Lax/i)
    const cookieExpiry = Date.parse(cookie.match(/Expires=([^;]+)/i)[1])
    assert.ok(cookieExpiry > Date.now() + 398 * day && cookieExpiry <= Date.now() + 399 * day)
    const serverExpiry = (await login.json()).sessionExpiresAt
    assert.ok(Date.parse(serverExpiry) < Date.now() + 1.01 * day, 'transport retention never lengthens selected D1 lifetime')
    let browserCookie = cookie.split(';')[0]
    await call('/release', { method: 'POST' })
    const oldResponse = await held.request
    assert.equal(oldResponse.headers.get('set-cookie'), null, 'late A ordinary response cannot overwrite newer login B')
    const employee = await call('/protected', { headers: { cookie: browserCookie } })
    assert.equal((await employee.json()).id, 2)
    assert.equal(employee.headers.get('set-cookie'), null)
    const renewed = await db.prepare('SELECT expires_at FROM user_sessions WHERE token_hash=?').bind(hash('old-a')).first()
    assert.ok(Date.parse(renewed.expires_at) > Date.parse(oldExpiry), 'ordinary request still renews live D1 session')
    console.log('PASS native delayed A renewal / login B / late A response: no cookie rollback, live server renewal retained')

    for (const mode of ['revoked', 'expired', 'changed']) {
      await db.prepare('UPDATE user_sessions SET revoked_at=NULL,created_at=?,expires_at=? WHERE token_hash=?').bind(oldCreated,oldExpiry,hash('old-a')).run()
      held = await beginHeld()
      if (mode === 'revoked') await db.prepare("UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(hash('old-a')).run()
      else await db.prepare('UPDATE user_sessions SET expires_at=? WHERE token_hash=?').bind(mode === 'expired' ? new Date(Date.now()-1000).toISOString() : new Date(Date.now()+2*day).toISOString(),hash('old-a')).run()
      const before = await db.prepare('SELECT expires_at,revoked_at FROM user_sessions WHERE token_hash=?').bind(hash('old-a')).first()
      await call('/release', { method: 'POST' })
      assert.equal((await held.request).headers.get('set-cookie'), null)
      assert.deepEqual(await db.prepare('SELECT expires_at,revoked_at FROM user_sessions WHERE token_hash=?').bind(hash('old-a')).first(), before, mode)
      if (mode !== 'changed') assert.equal((await call('/protected',{headers:{cookie:'bos_session=old-a'}})).status,401)
    }
    console.log('PASS native atomic renewal rejects revoked, expired and concurrently changed expiry rows')
    const tokenB = browserCookie.slice(browserCookie.indexOf('=')+1)
    await db.prepare('UPDATE user_sessions SET expires_at=? WHERE token_hash=?').bind(new Date(Date.now()-1000).toISOString(),hash(tokenB)).run()
    assert.equal((await call('/protected',{headers:{cookie:browserCookie}})).status,401,'retained browser token never authenticates after D1 expiry')
    console.log('PASS native long-lived transport cookie cannot bypass authoritative server expiry')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
