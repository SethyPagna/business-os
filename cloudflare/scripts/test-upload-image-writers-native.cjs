// S-uploads (compliance audit P1-2): the import ZIP/image, product-image and
// avatar writers, executed as the real Hono routes against local
// workerd/D1/R2 (Miniflare) -- not copied route logic.
//
// Before this lane:
//  - POST /api/import-jobs/:id/zip stored the "ZIP" under the PUBLIC
//    uploads/ prefix with the client's File.type and no byte check, so HTML
//    named images.zip and declared text/html was served from /uploads as a
//    page (and got a Library file_assets row).
//  - Import, product-image and avatar uploads stored the client's File.type
//    and the client's file-name extension, so a real PNG named evil.html
//    and typed image/x-anything kept both.
// Each assertion below was false on f8ca5443.
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')

const enc = (text) => new TextEncoder().encode(text)
const bytes = (...parts) => {
  const arrays = parts.map((part) => (typeof part === 'string' ? enc(part) : Uint8Array.from(part)))
  const out = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0))
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 'IHDR', new Array(40).fill(1))
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF', new Array(40).fill(2))
const HTML = enc('<!doctype html><html><body><script>fetch("/api/users",{credentials:"include"})</script></body></html>')
const POLYGLOT_JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF', new Array(20).fill(2), '<html><body><SCRIPT>alert(document.domain)</SCRIPT></body></html>')
const SVG = enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
// Minimal STORED (method 0) ZIP writer.
function makeZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBytes = enc(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10); central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, Buffer.from(nameBytes), Buffer.from(data))
    centrals.push(central, Buffer.from(nameBytes))
    offset += 30 + nameBytes.length + data.length
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]))
}

async function main() {
  const root = path.resolve(__dirname, '..')
  const stubs = {
    auth: `export const requireAuth=async(c,next)=>{c.set('user',{id:1,username:'admin',name:'Admin',role_code:'admin'});return next()};export const revokeUserSessions=async()=>{}`,
    audit: `export const audit=async()=>{};export const changedFields=()=>[];export const auditChangeColumns=()=>[]`,
    imageAudit: `export const enqueueImageNormalization=async(env,key)=>{await env.DB.prepare('INSERT INTO enqueue_probe(key) VALUES(?)').bind(key).run()}`,
    broadcastHub: `export const broadcast=async()=>{}`,
    rateLimit: `export const checkRateLimit=async()=>({allowed:true});export const getClientIp=()=>'127.0.0.1'`,
  }
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { Hono } from 'hono';
    import importJobs from './src/routes/importJobs.ts';
    import products from './src/routes/products.ts';
    import users from './src/routes/users.ts';
    const app = new Hono();
    app.route('/api/import-jobs', importJobs);
    app.route('/api/products', products);
    app.route('/api', users);
    export default { fetch(request, env, ctx) { return app.fetch(request, env, ctx); } };
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
  external: ['node:*', 'cloudflare:*'],
  plugins: [{ name: 'route-stubs', setup(b) {
    b.onResolve({ filter: /\/(lib\/(auth|audit|imageAudit|rateLimit)|durable-objects\/broadcastHub)$/ }, (args) => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
    // Each stub re-exports the real module and overrides only the named
    // side-effect functions (a local export wins over export *).
    const real = { auth: 'src/lib/auth.ts', audit: 'src/lib/audit.ts', imageAudit: 'src/lib/imageAudit.ts', rateLimit: 'src/lib/rateLimit.ts', broadcastHub: 'src/durable-objects/broadcastHub.ts' }
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: `export * from ${JSON.stringify(path.join(root, real[args.path]).split(path.sep).join('/'))};
${stubs[args.path]}`,
      loader: 'ts', resolveDir: root,
    }))
  } }] })

  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB', 'IMPORT_DB'], r2Buckets: ['ASSETS'], log: new Log(LogLevel.ERROR),
  })
  try {
    const db = await mf.getD1Database('DB')
    const r2 = await mf.getR2Bucket('ASSETS')
    for (const sql of [
      'CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)',
      `CREATE TABLE import_jobs(id TEXT PRIMARY KEY,type TEXT,status TEXT,phase TEXT,queue_driver TEXT,policy_json TEXT,summary_json TEXT,
        cancel_requested INTEGER DEFAULT 0,created_by_id INTEGER,created_by_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,processed_rows INTEGER DEFAULT 0,failed_rows INTEGER DEFAULT 0,last_error TEXT,details_pruned_at TEXT)`,
      `CREATE TABLE import_job_files(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,kind TEXT NOT NULL,original_name TEXT,
        stored_path TEXT NOT NULL,relative_path TEXT,mime_type TEXT,byte_size INTEGER DEFAULT 0,status TEXT DEFAULT 'stored',error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,file_asset_id INTEGER)`,
      `CREATE TABLE file_assets(id INTEGER PRIMARY KEY AUTOINCREMENT,original_name TEXT NOT NULL,stored_name TEXT NOT NULL,public_path TEXT NOT NULL,
        mime_type TEXT,media_type TEXT DEFAULT 'image',byte_size INTEGER,source TEXT DEFAULT 'upload',created_by_id INTEGER,created_by_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,optimization_status TEXT)`,
      'CREATE TABLE enqueue_probe(key TEXT)',
      "INSERT INTO import_jobs(id,type,status,phase,policy_json,summary_json) VALUES('job1','products','pending','created','{}','{}')",
    ]) await db.prepare(sql).run()

    const keys = async () => (await r2.list()).objects.map((o) => o.key).sort()
    const typeOf = async (key) => (await r2.head(key))?.httpMetadata?.contentType
    const post = async (url, form) => {
      // Encode the multipart body in Node and hand Miniflare plain bytes.
      const encoded = new Request('http://encode.local/', { method: 'POST', body: form })
      const body = Buffer.from(await encoded.arrayBuffer())
      const response = await mf.dispatchFetch(`http://local.test${url}`, { method: 'POST', body, headers: { 'content-type': encoded.headers.get('content-type') } })
      const text = await response.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* not json */ }
      return { status: response.status, json, text }
    }
    const formWith = (field, data, name, type) => {
      const form = new FormData()
      form.append(field, new File([data], name, { type }))
      return form
    }

    // ---- import ZIP: HTML declared text/html is refused, nothing stored.
    {
      const result = await post('/api/import-jobs/job1/zip', formWith('file', HTML, 'images.zip', 'text/html'))
      assert.equal(result.status, 400, result.text)
      assert.match(result.json.error, /not a ZIP/)
      assert.deepEqual(await keys(), [], 'a non-ZIP must never reach R2')
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM file_assets').first()).n, 0)
    }

    // ---- import ZIP: a real ZIP is a private job object; only its real,
    // markup-free image entries reach public uploads/ with detected types.
    {
      const zip = makeZip([['good.jpg', PNG], ['evil.png', HTML], ['poly.jpg', POLYGLOT_JPEG], ['logo.png', SVG]])
      const result = await post('/api/import-jobs/job1/zip', formWith('file', zip, 'images.zip', 'text/html'))
      assert.equal(result.status, 200, result.text)
      assert.equal(result.json.file.public_path, null, 'the ZIP container is never publicly addressable')
      assert.equal(result.json.file.file_asset_id, null, 'the ZIP container is not a Library file')
      const all = await keys()
      const zipKeys = all.filter((k) => k.endsWith('.zip'))
      assert.equal(zipKeys.length, 1)
      assert.match(zipKeys[0], /^imports\/job1\/incoming\/images-\d+-[a-f0-9]{8}\.zip$/)
      assert.equal(await typeOf(zipKeys[0]), 'application/zip', 'ZIP stored with the server type, not the claimed text/html')
      const publicKeys = all.filter((k) => k.startsWith('uploads/'))
      assert.equal(publicKeys.length, 1, `only the real image is public: ${JSON.stringify(all)}`)
      // good.jpg carries PNG bytes: the stored extension and type follow the bytes.
      assert.match(publicKeys[0], /^uploads\/good-\d+-[a-f0-9]{8}\.png$/)
      assert.equal(await typeOf(publicKeys[0]), 'image/png')
      assert.deepEqual(result.json.failed_images.map((f) => f.file_name).sort(), ['evil.png', 'logo.png', 'poly.jpg'])
      const assets = (await db.prepare('SELECT public_path, mime_type FROM file_assets').all()).results
      assert.deepEqual(assets, [{ public_path: `/${publicKeys[0]}`, mime_type: 'image/png' }])
    }

    // ---- import per-file images: HTML named .png is rejected; a PNG
    // declared as something else is stored image/png.
    {
      const before = await keys()
      const form = new FormData()
      form.append('files', new File([HTML], 'x.png', { type: 'image/png' }))
      form.append('files', new File([POLYGLOT_JPEG], 'y.jpg', { type: 'image/jpeg' }))
      form.append('files', new File([PNG], 'z.jpg', { type: 'image/x-evil' }))
      const result = await post('/api/import-jobs/job1/images', form)
      assert.equal(result.status, 200, result.text)
      assert.deepEqual(result.json.files.map((f) => f.status), ['rejected', 'rejected', 'stored'])
      const added = (await keys()).filter((k) => !before.includes(k))
      assert.equal(added.length, 1)
      assert.match(added[0], /^uploads\/z-\d+-[a-f0-9]{8}\.png$/)
      assert.equal(await typeOf(added[0]), 'image/png')
    }

    // ---- product image + avatar: rejected shapes never reach R2; accepted
    // images are stored with the byte-derived type and extension.
    for (const [url, field] of [['/api/products/upload-image', 'image'], ['/api/users/avatar-upload', 'image']]) {
      for (const [data, name, type] of [
        [HTML, 'photo.jpg', 'image/jpeg'],
        [POLYGLOT_JPEG, 'photo.jpg', 'image/jpeg'],
        [SVG, 'logo.svg', 'image/svg+xml'],
        [PNG, 'photo.png', 'text/html'],
      ]) {
        const before = await keys()
        const result = await post(url, formWith(field, data, name, type))
        assert.equal(result.status, 400, `${url} ${name} (${type}): ${result.text}`)
        assert.deepEqual(await keys(), before, `${url} ${name} must not be stored`)
      }
      const before = await keys()
      const result = await post(url, formWith(field, JPEG, 'me.png', 'image/png'))
      assert.equal(result.status, 200, `${url}: ${result.text}`)
      const added = (await keys()).filter((k) => !before.includes(k))
      assert.equal(added.length, 1)
      assert.match(added[0], /^uploads\/me-\d+-[a-f0-9]{8}\.jpg$/, `${url}: ${added[0]}`)
      assert.equal(await typeOf(added[0]), 'image/jpeg', `${url} stored type must follow the bytes`)
      const row = await db.prepare('SELECT mime_type FROM file_assets WHERE public_path = ?').bind(`/${added[0]}`).first()
      assert.equal(row.mime_type, 'image/jpeg')
    }

    console.log('PASS import ZIP/images, product image and avatar writers: byte-derived types, private ZIP, no markup under /uploads')
  } finally {
    await mf.dispose()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
