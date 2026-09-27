// S-uploads2b: nothing a person puts in a products import is dropped without
// a word, and every image format the Library stores is imported.
//
// Before this lane POST /api/import-jobs/:id/zip kept only entries named
// .jpg/.jpeg/.png/.webp/.gif/.bmp. A ZIP's AVIF photos (which the Library
// stores), its .jfif, extensionless and .bin photos, its HEIC photos, text
// files and videos, and every image past the 200th vanished with no trace
// anywhere; each BMP was extracted only to fail with the Library's "images
// and videos (MP4, MOV, WebM)" message. POST /:id/images skipped such names
// the same way, and the recompress round trip refused an .avif name.
//
// Now every Library image format is imported (AVIF, the JPEG aliases, and a
// name that says nothing is judged by its bytes), and every other file --
// except the zipper's own bookkeeping (directories, dotfiles, __MACOSX/,
// Thumbs.db) -- is reported BY NAME AND REASON: in the upload's response
// (failed_images, which the upload toast counts), as an import_job_errors row
// that the import report (GET /:id/report -> ImportReportModal's error list)
// shows, and in import_jobs.failed_images (the tracker's issue count). A
// fresh analyze keeps those rows, because the uploads happen before /start.
//
// Executed against local workerd/D1/R2 (Miniflare) through the real Hono
// routes and the real runImportAnalyze; each case gets its own in-memory
// Miniflare. No remote database, deployment or production state is touched.
//
// IMPORT_ZIP_SRC_ROOT points the same test at another checkout (the
// fail-on-base proof); packages still resolve from this checkout.
//
// Run: node scripts/test-import-zip-skipped-entries-native.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')

const root = path.resolve(process.env.IMPORT_ZIP_SRC_ROOT || path.resolve(__dirname, '..'))
const SKIPPED_CODE = 'import_file_skipped'

const enc = (text) => new TextEncoder().encode(text)
const bytes = (...parts) => {
  const arrays = parts.map((part) => (typeof part === 'string' ? enc(part) : Uint8Array.from(part)))
  const out = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0))
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF', new Array(40).fill(2))
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 'IHDR', new Array(40).fill(1))
// ISO-BMFF: size, 'ftyp', major brand, minor version, compatible brands.
const ftyp = (brand, pad) => bytes([0, 0, 0, 24], 'ftyp', brand, [0, 0, 0, 0], brand, 'mif1', new Array(pad).fill(1))
const AVIF = ftyp('avif', 40)
const AVIF_SMALLER = ftyp('avif', 8)
const HEIC = ftyp('heic', 40)
const MP4 = bytes([0, 0, 0, 24], 'ftyp', 'isom', [0, 0, 2, 0], 'isom', 'iso2', new Array(40).fill(1))
const BMP = bytes('BM', new Array(60).fill(0))
const HTML = enc('<!doctype html><html><body><script>alert(1)</script></body></html>')
const TEXT = enc('SKU, notes\nA-1, restock\n')
const EMPTY = new Uint8Array(0)

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
// Minimal STORED (method 0) ZIP writer; a name ending in '/' is a directory.
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

async function bundleWorker() {
  const stubs = {
    auth: `export const requireAuth=async(c,next)=>{c.set('user',{id:1,username:'admin',name:'Admin',role_code:'admin'});return next()};export const revokeUserSessions=async()=>{}`,
    audit: `export const audit=async()=>{};export const changedFields=()=>[];export const auditChangeColumns=()=>[]`,
    broadcastHub: `export const broadcast=async()=>{}`,
    rateLimit: `export const checkRateLimit=async()=>({allowed:true});export const getClientIp=()=>'127.0.0.1'`,
  }
  const real = { auth: 'src/lib/auth.ts', audit: 'src/lib/audit.ts', rateLimit: 'src/lib/rateLimit.ts', broadcastHub: 'src/durable-objects/broadcastHub.ts' }
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'ts',
      contents: `
        import { Hono } from 'hono';
        import importJobs from './src/routes/importJobs.ts';
        import { runImportAnalyze } from './src/lib/importEngine.ts';
        import { registerInlineImportRunner } from './src/lib/queueDispatch.ts';
        registerInlineImportRunner(async () => {});
        const app = new Hono();
        app.route('/api/import-jobs', importJobs);
        export default { async fetch(request, env, ctx) {
          const url = new URL(request.url);
          if (url.pathname !== '/__test/analyze') return app.fetch(request, env, ctx);
          const body = await request.json();
          try { await runImportAnalyze(env, body.jobId); return Response.json({ ok: true }); }
          catch (error) { return Response.json({ ok: false, message: String(error?.message || error) }); }
        }};
      `,
    },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
    external: ['node:*', 'cloudflare:*'],
    nodePaths: [path.resolve(__dirname, '..', 'node_modules')],
    plugins: [{ name: 'route-stubs', setup(b) {
      b.onResolve({ filter: /\/(lib\/(auth|audit|rateLimit)|durable-objects\/broadcastHub)$/ }, (args) => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
        contents: `export * from ${JSON.stringify(path.join(root, real[args.path]).split(path.sep).join('/'))};
${stubs[args.path]}`,
        loader: 'ts', resolveDir: root,
      }))
    } }],
  })
  return bundle.outputFiles[0].text
}

// The production columns (migrations 0001, 0011, 0012, 0051 and the
// import_jobs/import_job_files ALTERs) of every table these routes touch.
const SCHEMA = [
  'CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)',
  `CREATE TABLE import_jobs(id TEXT PRIMARY KEY,type TEXT NOT NULL DEFAULT 'products',status TEXT DEFAULT 'pending' NOT NULL,
    phase TEXT DEFAULT 'created',queue_driver TEXT,total_rows INTEGER DEFAULT 0,processed_rows INTEGER DEFAULT 0,failed_rows INTEGER DEFAULT 0,
    total_images INTEGER DEFAULT 0,processed_images INTEGER DEFAULT 0,failed_images INTEGER DEFAULT 0,warning_count INTEGER DEFAULT 0,
    policy_json TEXT DEFAULT '{}',summary_json TEXT DEFAULT '{}',cancel_requested INTEGER DEFAULT 0,last_error TEXT,created_by_id INTEGER,
    created_by_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,started_at TEXT,finished_at TEXT,
    dismissed_at TEXT,dismissed_status TEXT,chunk_cursor INTEGER NOT NULL DEFAULT 0,chunk_state_json TEXT,materialize_state_json TEXT,
    materialize_done INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_expires_at TEXT,details_pruned_at TEXT)`,
  `CREATE TABLE import_job_errors(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,batch_id INTEGER,row_number INTEGER,
    file_name TEXT,code TEXT,message TEXT NOT NULL,raw_json TEXT DEFAULT '{}',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE import_job_files(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,kind TEXT NOT NULL,original_name TEXT,
    stored_path TEXT NOT NULL,relative_path TEXT,mime_type TEXT,byte_size INTEGER DEFAULT 0,status TEXT DEFAULT 'stored',error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,file_asset_id INTEGER)`,
  `CREATE TABLE file_assets(id INTEGER PRIMARY KEY AUTOINCREMENT,original_name TEXT NOT NULL,stored_name TEXT NOT NULL,public_path TEXT NOT NULL,
    mime_type TEXT,media_type TEXT DEFAULT 'image',byte_size INTEGER,width INTEGER,height INTEGER,source TEXT DEFAULT 'upload',
    created_by_id INTEGER,created_by_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    original_byte_size INTEGER,optimized_byte_size INTEGER,optimization_status TEXT DEFAULT 'not_optimized',optimization_note TEXT,
    duration_seconds REAL)`,
  'CREATE TABLE import_job_row_signatures(job_id TEXT NOT NULL,signature TEXT NOT NULL,row_number INTEGER NOT NULL,PRIMARY KEY(job_id,signature))',
]
const STAGING_SCHEMA = [
  `CREATE TABLE import_job_rows(job_id TEXT NOT NULL,phase TEXT NOT NULL,row_number INTEGER NOT NULL,group_index INTEGER,action TEXT NOT NULL,
    identifier TEXT,result_json TEXT NOT NULL,PRIMARY KEY(job_id,phase,row_number))`,
  'CREATE TABLE import_job_source_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT,sequence INTEGER,row_number INTEGER,raw_json TEXT)',
]

async function withWorker(script, run) {
  const mf = new Miniflare({
    modules: true, script, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB', 'IMPORT_DB'], r2Buckets: ['ASSETS'], log: new Log(LogLevel.NONE),
  })
  try {
    const db = await mf.getD1Database('DB')
    const staging = await mf.getD1Database('IMPORT_DB')
    const r2 = await mf.getR2Bucket('ASSETS')
    for (const sql of SCHEMA) await db.prepare(sql).run()
    for (const sql of STAGING_SCHEMA) await staging.prepare(sql).run()
    const read = async (response) => {
      const text = await response.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* not json */ }
      return { status: response.status, json, text }
    }
    const post = async (url, form) => {
      // Encode the multipart body in Node and hand Miniflare plain bytes.
      const encoded = new Request('http://encode.local/', { method: 'POST', body: form })
      const body = Buffer.from(await encoded.arrayBuffer())
      return read(await mf.dispatchFetch(`http://local.test${url}`, { method: 'POST', body, headers: { 'content-type': encoded.headers.get('content-type') } }))
    }
    const ctx = {
      db,
      r2,
      async job(id, status = 'pending') {
        await db.prepare(`INSERT INTO import_jobs(id,type,status,phase) VALUES(?,'products',?,?)`).bind(id, status, status === 'pending' ? 'created' : status).run()
      },
      async uploadZip(jobId, entries, name = 'product-photos.zip') {
        const form = new FormData()
        form.append('file', new File([makeZip(entries)], name, { type: 'application/zip' }))
        return post(`/api/import-jobs/${jobId}/zip`, form)
      },
      async uploadImages(jobId, files) {
        const form = new FormData()
        for (const [name, data] of files) form.append('files', new File([data], name.split('/').pop()))
        form.append('relative_paths', JSON.stringify(files.map(([name]) => name)))
        return post(`/api/import-jobs/${jobId}/images`, form)
      },
      async recompress(jobId, fileId, name, data) {
        const form = new FormData()
        form.append('file', new File([data], name))
        return post(`/api/import-jobs/${jobId}/images/${fileId}/recompress`, form)
      },
      get: async (url) => read(await mf.dispatchFetch(`http://local.test${url}`)),
      async analyze(jobId) {
        const response = await mf.dispatchFetch('http://local.test/__test/analyze', { method: 'POST', body: JSON.stringify({ jobId }) })
        return response.json()
      },
      publicKeys: async () => (await r2.list({ prefix: 'uploads/' })).objects.map((o) => o.key),
      typeOf: async (key) => (await r2.head(key))?.httpMetadata?.contentType,
      async skipRows(jobId) {
        return (await db.prepare('SELECT row_number, file_name, code, message, raw_json FROM import_job_errors WHERE job_id = ? AND code = ? ORDER BY id')
          .bind(jobId, SKIPPED_CODE).all()).results
      },
      failedImages: async (jobId) => (await db.prepare('SELECT failed_images FROM import_jobs WHERE id = ?').bind(jobId).first()).failed_images,
    }
    return await run(ctx)
  } finally {
    await mf.dispose()
  }
}

// An image-only writer's refusal: names the five formats, never the
// Library's videos.
function assertImagesOnlyMessage(message, label) {
  assert.match(message, /JPEG, PNG, WebP, GIF or AVIF/, `${label}: names the image formats`)
  assert.doesNotMatch(message, /video|MP4|MOV|WebM/i, `${label}: an import image is never told about videos`)
}

async function main() {
  const script = await bundleWorker()
  let failed = 0
  const check = async (name, fn) => {
    try {
      await withWorker(script, fn)
      console.log(`PASS ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    }
  }

  // The mixed ZIP of cases 1 and 2.
  const MIXED = [
    ['photos/', EMPTY],
    ['photos/apple.jpg', JPEG],
    ['photos/banana.avif', AVIF],
    ['photos/cherry.jfif', JPEG],
    ['photos/fig', PNG],
    ['photos/grape.bin', JPEG],
    ['photos/date.heic', HEIC],
    ['photos/elder.bmp', BMP],
    ['photos/notes.txt', TEXT],
    ['photos/clip.mp4', MP4],
    ['photos/fake.png', HTML],
    ['photos/empty.jpg', EMPTY],
    ['photos/kiwi', TEXT],
    ['__MACOSX/photos/._apple.jpg', JPEG],
    ['photos/.DS_Store', TEXT],
    ['photos/Thumbs.db', TEXT],
  ]
  const MIXED_SKIPPED = {
    'photos/date.heic': /HEIC/,
    'photos/elder.bmp': /BMP images are not supported/,
    'photos/notes.txt': /Not an image/,
    'photos/clip.mp4': /Videos cannot be product images/,
    'photos/fake.png': /JPEG, PNG, WebP, GIF or AVIF/,
    'photos/empty.jpg': /empty/,
    'photos/kiwi': /JPEG, PNG, WebP, GIF or AVIF/,
  }

  await check('a ZIP imports every Library image format and reports every other file by name and reason; OS bookkeeping stays quiet', async (ctx) => {
    await ctx.job('mixed')
    const result = await ctx.uploadZip('mixed', MIXED)
    assert.equal(result.status, 200, result.text)

    // AVIF, the .jfif alias, and the extensionless / .bin photos are imported,
    // each stored with the extension and type of its bytes.
    assert.deepEqual(result.json.images.map((image) => image.original_name).sort(), ['apple.jpg', 'banana.avif', 'cherry.jfif', 'fig', 'grape.bin'])
    const keys = await ctx.publicKeys()
    const expected = [[/^uploads\/apple-\d+-[a-f0-9]{8}\.jpg$/, 'image/jpeg'], [/^uploads\/banana-\d+-[a-f0-9]{8}\.avif$/, 'image/avif'],
      [/^uploads\/cherry-\d+-[a-f0-9]{8}\.jpg$/, 'image/jpeg'], [/^uploads\/fig-\d+-[a-f0-9]{8}\.png$/, 'image/png'],
      [/^uploads\/grape-\d+-[a-f0-9]{8}\.jpg$/, 'image/jpeg']]
    assert.equal(keys.length, expected.length, JSON.stringify(keys))
    for (const [pattern, type] of expected) {
      const key = keys.find((k) => pattern.test(k))
      assert.ok(key, `${pattern} stored: ${JSON.stringify(keys)}`)
      assert.equal(await ctx.typeOf(key), type, key)
    }

    // Everything else the person put in the ZIP is in the upload's response,
    // with a reason; the zipper's own entries are not.
    const failedImages = result.json.failed_images
    assert.deepEqual(failedImages.map((f) => f.file_name).sort(), Object.keys(MIXED_SKIPPED).sort())
    for (const entry of failedImages) {
      assert.match(entry.error_message, MIXED_SKIPPED[entry.file_name], `${entry.file_name}: ${entry.error_message}`)
      // BulkImportModal treats "could not be read" as "the whole ZIP is unusable".
      assert.doesNotMatch(entry.error_message, /could not be read/i, entry.file_name)
    }
    const messageOf = (name) => failedImages.find((f) => f.file_name === name).error_message
    assertImagesOnlyMessage(messageOf('photos/fake.png'), 'fake.png (HTML bytes)')
    assertImagesOnlyMessage(messageOf('photos/kiwi'), 'kiwi (no extension, text bytes)')
    // A BMP used to be extracted and fail with the Library's message.
    assert.doesNotMatch(messageOf('photos/elder.bmp'), /video|MP4|MOV|WebM/i, 'elder.bmp')
    assert.match(result.json.note, /7 files in the ZIP were not imported/)
    assert.doesNotMatch(result.json.note, /could not be read/i)

    // ...and in the job's report, where import problems already show.
    const report = await ctx.get('/api/import-jobs/mixed/report')
    assert.equal(report.status, 200, report.text)
    const reported = report.json.errors.filter((row) => row.code === SKIPPED_CODE)
    assert.equal(reported.length, 7, JSON.stringify(report.json.errors))
    assert.equal(report.json.errorCount, 7)
    for (const row of reported) {
      assert.equal(row.row_number, null, 'a file, not a CSV row')
      const name = Object.keys(MIXED_SKIPPED).find((entry) => row.message.startsWith(`${entry}: `))
      assert.ok(name, `the report line leads with the entry's name: ${row.message}`)
      assert.match(row.message, MIXED_SKIPPED[name])
    }
    const job = await ctx.get('/api/import-jobs/mixed')
    assert.equal(job.json.job.failed_images, 7, 'the tracker\'s issue count')
  })

  await check('uploading the same ZIP again does not repeat its report lines', async (ctx) => {
    await ctx.job('again')
    assert.equal((await ctx.uploadZip('again', MIXED)).status, 200)
    assert.equal((await ctx.uploadZip('again', MIXED)).status, 200)
    assert.equal((await ctx.skipRows('again')).length, 7)
    assert.equal(await ctx.failedImages('again'), 7)
  })

  await check('a fresh analyze clears the last run\'s row errors but keeps the report of skipped files', async (ctx) => {
    // cancel_requested ends the run right after the fresh-start reset, so
    // the real runImportAnalyze needs only the tables that reset touches.
    await ctx.db.prepare(`INSERT INTO import_jobs(id,type,status,phase,cancel_requested) VALUES('redo','products','queued','queued',1)`).run()
    await ctx.db.prepare(`INSERT INTO import_job_errors(job_id,row_number,file_name,code,message) VALUES('redo',3,'items.csv','validation_error','Row failed validation')`).run()
    await ctx.db.prepare(`INSERT INTO import_job_errors(job_id,row_number,file_name,code,message,raw_json) VALUES('redo',NULL,'photos/date.heic',?,'photos/date.heic: HEIC/HEIF photos are not supported.','{"files":1}')`).bind(SKIPPED_CODE).run()
    const outcome = await ctx.analyze('redo')
    assert.equal(outcome.ok, true, outcome.message)
    const left = (await ctx.db.prepare(`SELECT code FROM import_job_errors WHERE job_id = 'redo' ORDER BY id`).all()).results.map((row) => row.code)
    assert.deepEqual(left, [SKIPPED_CODE], 'the previous run\'s row error is gone; the skipped-file line is not')
  })

  await check('images past the 200 an upload adds are reported by name, not dropped', async (ctx) => {
    await ctx.job('bulk')
    const entries = Array.from({ length: 203 }, (_, i) => [`bulk/p${String(i + 1).padStart(3, '0')}.jpg`, JPEG])
    const result = await ctx.uploadZip('bulk', entries)
    assert.equal(result.status, 200, result.text)
    assert.equal(result.json.images.length, 200)
    assert.deepEqual(result.json.failed_images.map((f) => f.file_name), ['bulk/p201.jpg', 'bulk/p202.jpg', 'bulk/p203.jpg'])
    for (const f of result.json.failed_images) assert.match(f.error_message, /at most 200 images/)
    assert.deepEqual((await ctx.skipRows('bulk')).map((row) => row.file_name), ['bulk/p201.jpg', 'bulk/p202.jpg', 'bulk/p203.jpg'])
    assert.equal(await ctx.failedImages('bulk'), 3)
  })

  await check('past 200 skipped files, the rest are one counted line and the issue count stays exact', async (ctx) => {
    await ctx.job('notes')
    const entries = Array.from({ length: 205 }, (_, i) => [`docs/n${String(i + 1).padStart(3, '0')}.txt`, TEXT])
    const result = await ctx.uploadZip('notes', entries)
    assert.equal(result.status, 200, result.text)
    assert.equal(result.json.failed_images.length, 205)
    const rows = await ctx.skipRows('notes')
    assert.equal(rows.length, 201)
    assert.equal(rows[199].file_name, 'docs/n200.txt')
    assert.match(rows[200].message, /^product-photos\.zip: 5 more files were not imported/)
    assert.equal(await ctx.failedImages('notes'), 205)
  })

  await check('per-file image uploads: an AVIF is stored; HEIC, BMP, text, empty and fake images are reported, none silently left out', async (ctx) => {
    await ctx.job('files')
    const result = await ctx.uploadImages('files', [
      ['shots/ok.avif', AVIF],
      ['shots/IMG_2.heic', HEIC],
      ['shots/pic.bmp', BMP],
      ['shots/readme.txt', TEXT],
      ['shots/blank.png', EMPTY],
      ['shots/x.png', HTML],
    ])
    assert.equal(result.status, 200, result.text)
    assert.deepEqual(result.json.files.map((f) => [f.original_name, f.status]), [
      ['ok.avif', 'stored'], ['IMG_2.heic', 'rejected'], ['pic.bmp', 'rejected'], ['readme.txt', 'rejected'], ['blank.png', 'rejected'], ['x.png', 'rejected'],
    ])
    assertImagesOnlyMessage(result.json.files[5].error_message, 'x.png')
    const rows = await ctx.skipRows('files')
    assert.deepEqual(rows.map((row) => row.file_name), ['shots/IMG_2.heic', 'shots/pic.bmp', 'shots/readme.txt', 'shots/blank.png', 'shots/x.png'])
    assert.match(rows[0].message, /^shots\/IMG_2\.heic: HEIC/)
    assert.equal(await ctx.failedImages('files'), 5)
  })

  await check('per-file image uploads past 200 in one request are reported, not dropped', async (ctx) => {
    await ctx.job('many')
    const files = [...Array.from({ length: 199 }, (_, i) => [`n${i}.txt`, TEXT]), ['ok.jpg', JPEG], ['late.jpg', JPEG]]
    const result = await ctx.uploadImages('many', files)
    assert.equal(result.status, 200, result.text)
    assert.equal(result.json.files.length, 201, 'one result per file sent')
    assert.deepEqual(result.json.files.slice(199).map((f) => [f.original_name, f.status]), [['ok.jpg', 'stored'], ['late.jpg', 'rejected']])
    assert.match(result.json.files[200].error_message, /at most 200 images/)
    assert.equal((await ctx.skipRows('many')).at(-1).file_name, 'late.jpg')
  })

  await check('the ZIP recompress round trip takes an AVIF name and refuses other bytes with the images-only message', async (ctx) => {
    await ctx.job('squeeze')
    const stored = await ctx.uploadImages('squeeze', [['banana.avif', AVIF]])
    assert.equal(stored.status, 200, stored.text)
    const fileId = stored.json.files[0].id
    assert.ok(fileId, `the AVIF is stored: ${stored.text}`)
    const smaller = await ctx.recompress('squeeze', fileId, 'banana.avif', AVIF_SMALLER)
    assert.equal(smaller.status, 200, smaller.text)
    assert.equal(smaller.json.applied, true)
    const bmp = await ctx.recompress('squeeze', fileId, 'banana.jpg', BMP)
    assert.equal(bmp.status, 400, bmp.text)
    assertImagesOnlyMessage(bmp.json.error, 'recompress with BMP bytes')
  })

  if (failed) {
    console.error(`${failed} failed`)
    process.exitCode = 1
  } else {
    console.log('PASS import ZIP / per-file images: every Library image format imported; every other file reported by name and reason')
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
