// /uploads/* served by the real runtime: local workerd + Miniflare's R2
// simulator, through Hono exactly as index.ts wires it (app.get, so HEAD is
// dispatched to the GET handler and re-wrapped). The pure tests
// (test-upload-byte-range-pure.cjs, test-upload-legacy-extensions-pure.cjs)
// pin the logic against a mocked bucket; this one proves the same responses
// survive the real R2 binding (range clamping, InvalidRange, size on a
// ranged read) and workerd's HTTP layer (explicit Content-Length on a
// streamed 206/200 and on a bodyless HEAD).
//
// No remote database, deployment or production state is touched; Miniflare
// runs in memory on an ephemeral port.
//
// UPLOAD_SERVE_SRC_ROOT points the same test at another checkout (the
// fail-on-base proof); packages still resolve from this checkout.
//
// Run: node scripts/test-upload-serve-native.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')

const root = path.resolve(process.env.UPLOAD_SERVE_SRC_ROOT || path.resolve(__dirname, '..'))

async function main() {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'ts',
      contents: `
        import { Hono } from 'hono';
        import { serveObject } from './src/lib/r2.ts';
        const app = new Hono();
        app.get('/uploads/*', async (c) => {
          const key = \`uploads/\${c.req.path.replace(/^\\/uploads\\//, '')}\`;
          return serveObject(c.env.ASSETS, key, c.req.raw, c.executionCtx);
        });
        export default app;
      `,
    },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
    external: ['node:*', 'cloudflare:*'],
    nodePaths: [path.resolve(__dirname, '..', 'node_modules')],
  })

  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    r2Buckets: ['ASSETS'], log: new Log(LogLevel.NONE),
  })
  const results = []
  const check = async (name, fn) => {
    try {
      await fn()
      results.push(true)
      console.log(`PASS ${name}`)
    } catch (error) {
      results.push(false)
      console.error(`FAIL ${name}`)
      console.error(error)
    }
  }
  try {
    const r2 = await mf.getR2Bucket('ASSETS')
    const VIDEO = Uint8Array.from({ length: 1000 }, (_, i) => (i * 13 + 5) & 0xff)
    VIDEO.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0)
    const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 296 }, (_, i) => (i * 3) & 0xff)])
    const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 120 }, (_, i) => i)])
    const HEIC = Uint8Array.from([0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...Buffer.from('mif1heic'), ...Array.from({ length: 80 }, (_, i) => i)])
    const HTML = new TextEncoder().encode('<!doctype html><script>alert(document.domain)</script>')
    const seed = {
      'uploads/about.mp4': [VIDEO, 'video/mp4'],
      'uploads/cat.jfif': [JPEG, 'image/pjpeg'],
      'uploads/iphone.heic': [HEIC, 'image/heic'],
      'uploads/paste.bin': [JPEG, 'application/octet-stream'],
      'uploads/legacy-avatar': [PNG, 'text/html'],
      'uploads/evil.bin': [HTML, 'image/png'],
      'uploads/page.html': [JPEG, 'text/html'],
    }
    for (const [key, [bytes, contentType]] of Object.entries(seed)) await r2.put(key, bytes, { httpMetadata: { contentType } })

    const fetchUpload = (key, init = {}) => mf.dispatchFetch(`http://local.test/${key}`, init)
    const bytesOf = async (res) => new Uint8Array(await res.arrayBuffer())

    await check('Range bytes=0-1 on a video: 206, Content-Range, Content-Length, Accept-Ranges', async () => {
      const res = await fetchUpload('uploads/about.mp4', { headers: { range: 'bytes=0-1' } })
      assert.equal(res.status, 206)
      assert.equal(res.headers.get('content-range'), 'bytes 0-1/1000')
      assert.equal(res.headers.get('content-length'), '2')
      assert.equal(res.headers.get('accept-ranges'), 'bytes')
      assert.equal(res.headers.get('content-type'), 'video/mp4')
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
      assert.deepEqual(await bytesOf(res), VIDEO.slice(0, 2))
    })

    await check('bytes=a-, -n and a clamped last-pos through the real R2 binding', async () => {
      const open = await fetchUpload('uploads/about.mp4', { headers: { range: 'bytes=900-' } })
      assert.equal(open.status, 206)
      assert.equal(open.headers.get('content-range'), 'bytes 900-999/1000')
      assert.deepEqual(await bytesOf(open), VIDEO.slice(900))
      const suffix = await fetchUpload('uploads/about.mp4', { headers: { range: 'bytes=-50' } })
      assert.equal(suffix.headers.get('content-range'), 'bytes 950-999/1000')
      assert.deepEqual(await bytesOf(suffix), VIDEO.slice(950))
      const clamped = await fetchUpload('uploads/about.mp4', { headers: { range: 'bytes=990-5000' } })
      assert.equal(clamped.status, 206)
      assert.equal(clamped.headers.get('content-range'), 'bytes 990-999/1000')
      assert.equal(clamped.headers.get('content-length'), '10')
      assert.deepEqual(await bytesOf(clamped), VIDEO.slice(990))
    })

    await check('unsatisfiable ranges: 416 with Content-Range bytes */1000', async () => {
      for (const range of ['bytes=1000-', 'bytes=5000-6000', 'bytes=-0']) {
        const res = await fetchUpload('uploads/about.mp4', { headers: { range } })
        assert.equal(res.status, 416, range)
        assert.equal(res.headers.get('content-range'), 'bytes */1000', range)
        await res.arrayBuffer()
      }
    })

    await check('HEAD: 200, the full Content-Length, Accept-Ranges, no body', async () => {
      const res = await fetchUpload('uploads/about.mp4', { method: 'HEAD' })
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-length'), '1000')
      assert.equal(res.headers.get('accept-ranges'), 'bytes')
      assert.equal(res.headers.get('content-type'), 'video/mp4')
      assert.ok(res.headers.get('etag'))
      assert.equal((await bytesOf(res)).length, 0)
      const revalidated = await fetchUpload('uploads/about.mp4', { method: 'HEAD', headers: { 'if-none-match': res.headers.get('etag') } })
      assert.equal(revalidated.status, 304)
    })

    await check('a plain GET: the whole object with Content-Length and Accept-Ranges (twice: R2, then the edge cache)', async () => {
      for (let i = 0; i < 2; i += 1) {
        const res = await fetchUpload('uploads/about.mp4')
        assert.equal(res.status, 200)
        assert.equal(res.headers.get('accept-ranges'), 'bytes')
        assert.equal(res.headers.get('content-length'), '1000')
        assert.deepEqual(await bytesOf(res), VIDEO)
      }
    })

    await check('legacy photos: .jfif, .heic, a .bin JPEG and an extensionless PNG are served as images', async () => {
      for (const [key, type, bytes] of [
        ['uploads/cat.jfif', 'image/jpeg', JPEG],
        ['uploads/iphone.heic', 'image/heic', HEIC],
        ['uploads/paste.bin', 'image/jpeg', JPEG],
        ['uploads/legacy-avatar', 'image/png', PNG],
      ]) {
        const res = await fetchUpload(key)
        assert.equal(res.status, 200, key)
        assert.equal(res.headers.get('content-type'), type, key)
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff', key)
        assert.equal(res.headers.get('content-disposition'), null, key)
        assert.deepEqual(await bytesOf(res), bytes, `${key}: whole object`)
      }
    })

    await check('refused: a .bin holding HTML and a .html are 404 with nosniff, for GET, Range and HEAD', async () => {
      for (const key of ['uploads/evil.bin', 'uploads/page.html']) {
        for (const init of [{}, { headers: { range: 'bytes=0-1' } }, { method: 'HEAD' }]) {
          const res = await fetchUpload(key, init)
          assert.equal(res.status, 404, `${key} ${JSON.stringify(init)}`)
          assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
          assert.ok(!/script/.test(await res.text()))
        }
      }
    })
  } finally {
    await mf.dispose()
  }
  const passed = results.filter(Boolean).length
  console.log(`${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
