// GET /api/files/:id/download streams a Library object as an attachment
// under its STORED mime_type -- which is text/html or image/svg+xml on some
// legacy rows. Attachment + nosniff alone left it one browser quirk (or one
// "open" in a viewer that honours the type) away from running script on the
// app origin. /uploads/* already answers every object with the sandbox CSP
// (lib/r2.ts applySafeUploadHeaders); the download route must too.
//
// Drives the REAL routes/files.ts with the REAL lib/r2.ts constant and pins:
//   - an HTML and an SVG row download with the exact UPLOAD_CONTENT_SECURITY_POLICY
//     (sandbox first), nosniff and an attachment disposition;
//   - control: a plain JPEG download carries the same headers and its bytes.
// Fails before U-profile3 (no Content-Security-Policy header at all).

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')

const SRC = path.join(__dirname, '..', 'src')

function load(rel, overrides = {}) {
  const sourcePath = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (request.startsWith('.')) throw new Error(`unstubbed relative import ${request} from ${rel}`)
      return require(request)
    },
    mod, mod.exports, sourcePath, path.dirname(sourcePath),
  )
  return mod.exports
}

const noop = async () => {}
const r2 = load('lib/r2.ts')
const fileAssets = load('lib/fileAssets.ts')
const OWNER = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: '{}' }

const filesRoute = load('routes/files.ts', {
  '../lib/imageAudit': { enqueueImageNormalization: noop },
  '../lib/imagePipeline': { optimizeImage: async () => null, IMAGE_MAX_BYTES: 8 * 1024 * 1024 },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', OWNER); return next() } },
  '../lib/permissions': load('lib/permissions.ts'),
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' },
  '../lib/fileAssets': fileAssets,
  '../lib/libraryLogicalAssets': load('lib/libraryLogicalAssets.ts', { './fileAssets': fileAssets }),
  '../lib/media': load('lib/media.ts'),
  '../lib/uploadReferences': { findUploadReferences: async () => ({ total: 0 }) },
  '../lib/r2': r2,
  '../lib/sqlBinding': load('lib/sqlBinding.ts'),
  '../lib/uploadSecurity': load('lib/uploadSecurity.ts'),
  '../lib/audit': { audit: noop },
  '../durable-objects/broadcastHub': { broadcast: noop },
  '../lib/cache': { bumpVersion: noop },
  '../index': {},
  '../lib/actorSnapshot': load('lib/actorSnapshot.ts'),
}).default

const db = openDb([`
  CREATE TABLE file_assets (id INTEGER PRIMARY KEY, stored_name TEXT, original_name TEXT, mime_type TEXT);
  INSERT INTO file_assets VALUES
    (1, 'legacy-page.html', 'legacy page.html', 'text/html'),
    (2, 'logo.svg', 'logo.svg', 'image/svg+xml'),
    (3, 'photo-1700000000000-0a1b2c3d.jpg', 'photo.jpg', 'image/jpeg');
`])
const objects = {
  'uploads/legacy-page.html': '<script>alert(document.cookie)</script>',
  'uploads/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  'uploads/photo-1700000000000-0a1b2c3d.jpg': 'JPEGBYTES',
}
const ASSETS = {
  async get(key) {
    if (!(key in objects)) return null
    const body = objects[key]
    return { body, size: body.length, writeHttpMetadata() {} }
  },
}
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }

async function download(id) {
  const res = await filesRoute.request(`/${id}/download`, { method: 'GET' }, { DB: db, ASSETS }, ctx)
  return { status: res.status, headers: res.headers, text: await res.text() }
}

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  assert.ok(String(r2.UPLOAD_CONTENT_SECURITY_POLICY).startsWith('sandbox'), 'the policy under test is the sandbox one')

  for (const [id, label] of [[1, 'a legacy text/html row'], [2, 'an SVG row'], [3, 'control: a JPEG row']]) {
    await check(`${label} downloads with the /uploads sandbox CSP, nosniff and attachment`, async () => {
      const res = await download(id)
      assert.equal(res.status, 200, res.text)
      assert.equal(res.headers.get('content-security-policy'), r2.UPLOAD_CONTENT_SECURITY_POLICY)
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
      assert.match(res.headers.get('content-disposition') || '', /^attachment;/)
      assert.equal(res.text, objects[`uploads/${(await db.prepare('SELECT stored_name FROM file_assets WHERE id = @id').get({ id })).stored_name}`])
    })
  }

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
