// Writing / deleting persisted image variants (lib/imageVariantStore.ts) and
// every writer of an original that has to know about them.
//
// The browser sends a 320 px WebP next to the original; the Worker validates
// and copies it, nothing more (no decode, no transform quota -- Free plan).
// Cases are chosen so the plausible wrong implementation fails each:
//   - the thumbnail is written ONLY at variants/w320/<stored name>.webp, the
//     name the ORIGINAL was just stored under -- never at a client-chosen
//     name (the uploaded file name is hostile in every case below);
//   - bytes decide: a JPEG, a markup polyglot, an oversized blob or a
//     non-file field is refused and nothing is written;
//   - a missing thumbnail is 'absent' (the upload goes on); an R2 failure is
//     'failed' and never throws (the upload must not fail for a thumbnail);
//   - deleting an original deletes every width's variant AND the edge-cache
//     entries, so a deleted photo cannot keep answering;
//   - the writer census: both multipart image writers persist the variant,
//     the Library delete drops it, and the three R2 wipes cover variants/.
//
// Run: node scripts/test-image-variant-store-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const F = require('./harness/upload_fixtures.cjs')

const SRC = path.join(__dirname, '..', 'src')
const loaded = new Map()
function loadTs(file) {
  if (loaded.has(file)) return loaded.get(file).exports
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file })
  const module = { exports: {} }
  loaded.set(file, module)
  const localRequire = (request) => {
    if (!request.startsWith('.')) return require(request)
    const base = path.resolve(path.dirname(file), request)
    const resolved = [`${base}.ts`, path.join(base, 'index.ts')].find((candidate) => fs.existsSync(candidate))
    if (!resolved) throw new Error(`cannot resolve ${request}`)
    if (path.basename(resolved) === 'quotaGuard.ts') return { consumeQuota: async () => ({ allowed: true }) }
    if (path.basename(resolved) === 'index.ts') return {}
    return loadTs(resolved)
  }
  new Function('exports', 'require', 'module', outputText)(module.exports, localRequire, module)
  return module.exports
}
const store = loadTs(path.join(SRC, 'lib', 'imageVariantStore.ts'))
const { persistClientImageVariants, deleteImageVariants, variantKeysForStoredName, variantKeysForUploadKeys, clientVariantField, CLIENT_VARIANT_MAX_BYTES, CLIENT_VARIANT_WIDTHS } = store

const NAME = 'shirt-1758844800000-ab12cd34.jpg'
const THUMB = F.webp(F.webpChunk('VP8 ', F.randomBytes(F.mulberry32(3), 4000)))
const POLYGLOT = F.webp(F.webpChunk('EXIF', F.enc('<script>alert(1)</script>')), F.webpChunk('VP8 ', F.randomBytes(F.mulberry32(4), 64)))

function bucket({ failPut = false } = {}) {
  return {
    puts: [], deletes: [],
    async put(key, bytes, options) { if (failPut) throw new Error('r2 down'); this.puts.push({ key, size: bytes.length, contentType: options && options.httpMetadata && options.httpMetadata.contentType }) },
    async delete(keys) { this.deletes.push(keys) },
  }
}
// A form whose w320 AND w640 fields both carry `value` (or neither, for undefined).
function formWith(value, fileName = 'thumb.webp') {
  const form = new FormData()
  if (value !== undefined) {
    for (const width of CLIENT_VARIANT_WIDTHS) form.append(clientVariantField(width), value instanceof Uint8Array ? new File([value], fileName, { type: 'image/webp' }) : value)
  }
  return form
}
const keys = (env) => env.ASSETS.puts.map((p) => p.key).sort()
const both = (outcome) => [outcome[320], outcome[640]]

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('control: the fixtures are what the test says they are', () => {
  const { classifyUploadedBuffer } = loadTs(path.join(SRC, 'lib', 'uploadSecurity.ts'))
  assert.equal(classifyUploadedBuffer(THUMB).mime, 'image/webp')
  assert.throws(() => classifyUploadedBuffer(POLYGLOT))
})

test('valid WebPs are stored at variants/w320|w640/<stored name>.webp as image/webp', async () => {
  const env = { ASSETS: bucket() }
  assert.deepEqual(both(await persistClientImageVariants(env, NAME, formWith(THUMB))), ['stored', 'stored'])
  assert.deepEqual(env.ASSETS.puts.map((p) => [p.key, p.size, p.contentType]).sort(), [
    [`variants/w320/${NAME}.webp`, THUMB.length, 'image/webp'],
    [`variants/w640/${NAME}.webp`, THUMB.length, 'image/webp'],
  ])
})

test('widths are independent: only w640 sent -> only w640 stored; an oversized w320 does not block w640', async () => {
  const env = { ASSETS: bucket() }
  const form = new FormData()
  form.append(clientVariantField(640), new File([THUMB], 't.webp'))
  assert.deepEqual(both(await persistClientImageVariants(env, NAME, form)), ['absent', 'stored'])
  assert.deepEqual(keys(env), [`variants/w640/${NAME}.webp`])
  const env2 = { ASSETS: bucket() }
  const form2 = new FormData()
  form2.append(clientVariantField(320), new File([F.webp(F.webpChunk('VP8 ', new Uint8Array(CLIENT_VARIANT_MAX_BYTES[320])))], 'big.webp'))
  form2.append(clientVariantField(640), new File([THUMB], 't.webp'))
  assert.deepEqual(both(await persistClientImageVariants(env2, NAME, form2)), ['rejected', 'stored'])
})

test('only the allowlisted widths are read: a variant_w1280 / variant_w160 field is ignored', async () => {
  const env = { ASSETS: bucket() }
  const form = new FormData()
  form.append('variant_w1280', new File([THUMB], 't.webp'))
  form.append('variant_w160', new File([THUMB], 't.webp'))
  assert.deepEqual(both(await persistClientImageVariants(env, NAME, form)), ['absent', 'absent'])
  assert.deepEqual(env.ASSETS.puts, [])
})

test('the uploaded file name never decides the key', async () => {
  for (const hostile of ['../../uploads/evil.jpg', 'variants/w320/other.jpg.webp', '..\\x.webp', 'a/b.webp']) {
    const env = { ASSETS: bucket() }
    await persistClientImageVariants(env, NAME, formWith(THUMB, hostile))
    assert.deepEqual(keys(env), [`variants/w320/${NAME}.webp`, `variants/w640/${NAME}.webp`], hostile)
  }
})

test('no field -> absent, nothing written', async () => {
  const env = { ASSETS: bucket() }
  assert.deepEqual(both(await persistClientImageVariants(env, NAME, formWith(undefined))), ['absent', 'absent'])
  assert.deepEqual(both(await persistClientImageVariants(env, NAME, null)), ['absent', 'absent'])
  assert.deepEqual(env.ASSETS.puts, [])
})

test('refused: a string field, an empty file, an oversized file, a JPEG, a markup polyglot', async () => {
  const cases = {
    'string field': 'not a file',
    'empty': new File([new Uint8Array(0)], 't.webp'),
    'oversized': new File([F.webp(F.webpChunk('VP8 ', new Uint8Array(CLIENT_VARIANT_MAX_BYTES[640])))], 't.webp'),
    'jpeg': new File([F.jpeg()], 't.webp', { type: 'image/webp' }),
    'polyglot': new File([POLYGLOT], 't.webp'),
  }
  for (const [label, value] of Object.entries(cases)) {
    const env = { ASSETS: bucket() }
    assert.deepEqual(both(await persistClientImageVariants(env, NAME, formWith(value))), ['rejected', 'rejected'], label)
    assert.deepEqual(env.ASSETS.puts, [], label)
  }
})

test('refused: a stored name that is not a plain image name', async () => {
  for (const name of ['../backups/x.jpg', 'a/b.jpg', '_v-1.jpg', 'clip.mp4', 'noext', '']) {
    const env = { ASSETS: bucket() }
    assert.deepEqual(both(await persistClientImageVariants(env, name, formWith(THUMB))), ['rejected', 'rejected'], name)
    assert.deepEqual(env.ASSETS.puts, [], name)
  }
})

test('an R2 failure is reported, never thrown (the upload must not fail for a thumbnail)', async () => {
  const env = { ASSETS: bucket({ failPut: true }) }
  assert.deepEqual(both(await persistClientImageVariants(env, NAME, formWith(THUMB))), ['failed', 'failed'])
})

test('variantKeysForStoredName / variantKeysForUploadKeys: every width, uploads/ images only', () => {
  assert.deepEqual(variantKeysForStoredName(NAME), [160, 320, 640].map((w) => `variants/w${w}/${NAME}.webp`))
  assert.deepEqual(variantKeysForStoredName('../x.jpg'), [])
  assert.deepEqual(variantKeysForUploadKeys([`uploads/${NAME}`, 'uploads/clip.mp4', 'backups/cloudflare/a.json', 'uploads/_v/w320/a.jpg', 'uploads/../uploads/z.jpg']), variantKeysForStoredName(NAME))
})

test('deleting an original deletes all three variants in ONE call and purges the edge cache', async () => {
  const env = { ASSETS: bucket() }
  const purged = []
  globalThis.caches = { default: { async delete(request) { purged.push(new URL(request.url).pathname); return true } } }
  await deleteImageVariants(env, NAME, 'https://shop.example')
  assert.deepEqual(env.ASSETS.deletes, [[160, 320, 640].map((w) => `variants/w${w}/${NAME}.webp`)])
  assert.deepEqual(purged, [160, 320, 640].map((w) => `/uploads/_v/w${w}/${NAME}`))
})

test('deleteImageVariants never throws when R2 or the cache fails, and ignores an unsafe name', async () => {
  globalThis.caches = { default: { async delete() { throw new Error('cache down') } } }
  const env = { ASSETS: { async delete() { throw new Error('r2 down') } } }
  await deleteImageVariants(env, NAME, 'https://shop.example')
  const untouched = { ASSETS: bucket() }
  await deleteImageVariants(untouched, '../x.jpg', 'https://shop.example')
  assert.deepEqual(untouched.ASSETS.deletes, [])
})

test('legacy variant purge URLs encode raw identities once without percent/space aliases', async () => {
  const names = ['old#name.png', 'old%20name.png', 'old name.png', 'រូបថត.png']
  const purged = []
  globalThis.caches = { default: { async delete(request) { purged.push(request.url); return true } } }
  const env = { ASSETS: bucket() }
  for (const name of names) await deleteImageVariants(env, name, 'https://shop.example')
  assert.deepEqual(env.ASSETS.deletes, names.map(name => [160, 320, 640].map(width => `variants/w${width}/${name}.webp`)))
  assert.deepEqual(purged, names.flatMap(name => [160, 320, 640].map(width => `https://shop.example/uploads/_v/w${width}/${encodeURIComponent(name)}`)))
  assert.equal(new Set(purged).size, names.length * 3)
  const matched = []
  globalThis.caches = { default: { async match(request) {
    matched.push(request.url)
    return new Response(THUMB, { headers: { 'content-type': 'image/webp' } })
  } } }
  const { serveUpload } = loadTs(path.join(SRC, 'lib', 'imageVariants.ts'))
  for (const url of purged) {
    const request = new Request(url)
    const response = await serveUpload(env, new URL(url).pathname, request, { waitUntil() {} })
    assert.equal(response.status, 200)
  }
  assert.deepEqual(matched, purged, 'actual serving cache keys match deletion URLs')
})

// ------------------------------------------------------------ writer census
const read = (...parts) => fs.readFileSync(path.join(SRC, ...parts), 'utf8').replace(/\r\n/g, '\n')

test('census: product image upload persists the variant right after storing the original', () => {
  const src = read('routes', 'products.ts')
  const put = src.indexOf('await c.env.ASSETS.put(objectKey, buffer, { httpMetadata: { contentType: mimeType } })\n  // K3: same on-upload normalization')
  assert.ok(put > 0, 'upload-image original put not found')
  const call = src.indexOf('await persistClientImageVariants(c.env, storedName, form)', put)
  assert.ok(call > put && call - put < 600, 'POST /upload-image must call persistClientImageVariants(c.env, storedName, form) after the original is stored')
})

test('census: Library upload persists the variant for images only, and Library delete drops it', () => {
  const src = read('routes', 'files.ts')
  assert.match(src, /if \(mediaType === 'image'\) await persistClientImageVariants\(c\.env, storedName, form\)/)
  assert.match(src, /await c\.env\.ASSETS\.delete\(`uploads\/\$\{asset\.stored_name\}`\)\n[^\n]*\n\s*await deleteImageVariants\(c\.env, String\(asset\.stored_name\), new URL\(c\.req\.url\)\.origin\)/)
})

test('census: product reset (includeImages) and both full R2 wipes cover variants/', () => {
  const src = read('routes', 'system.ts')
  assert.equal((src.match(/\['uploads\/', 'variants\/', 'imports\/'\]/g) || []).length, 2, 'reset-data and factory-reset sweeps')
  assert.doesNotMatch(src, /\['uploads\/', 'imports\/'\]/)
  assert.match(src, /variantKeysForUploadKeys\(imageKeysToDelete\.slice\(0, imageDeleteCap\)\)/)
})

;(async () => {
  let failed = 0
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}\n  ${String(error && error.message || error).split('\n').join('\n  ')}`) }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exit(1)
})()
