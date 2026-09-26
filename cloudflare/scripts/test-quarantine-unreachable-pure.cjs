// S-uploads2a fix 2 (2026-09-26): ops/scripts/purge-non-media-uploads.mjs
// --move puts files under quarantine/<time>/<their key> in the same bucket.
// Nothing the website serves may ever read them back out.
//
// The Worker's public door into the bucket is GET /uploads/* (index.ts).
// This test takes that handler out of index.ts (TypeScript AST), with the
// real lib/r2.ts and lib/imageVariants.ts it calls, mounts it on a real Hono
// app and sends it every traversal we can think of: dot segments, encoded
// and double-encoded dots and slashes, backslashes, overlong UTF-8, NULs,
// the image-variant path, upper case, empty segments. A recording bucket
// (literal keys, as R2 has: a key is an opaque string, "uploads/../x" is not
// "x") logs every key read. Every read must be under uploads/ or variants/,
// none under quarantine/, and the quarantined bytes must never come back.
// serveUpload (the variant-aware entry point) is also called directly with
// the raw, un-normalised paths.
//
// Positive controls: /uploads/a.jpg is served from uploads/a.jpg, and a
// deliberately wrong handler (one that decodes and normalises the path, the
// plausible mistake) is caught reading quarantine/ by the same list.
//
// The purge side: the quarantine root is outside every folder the script
// lists (so a quarantined file is never picked up again) and outside
// uploads/ and variants/.
//
// The Worker half confirms a property the code already had (it passes on
// the commit before fix 2 as well); the purge half fails there, because
// that script had no quarantine.
//
// Every failure is listed before the exit code is set.
// Overrides: WORKER_INDEX_TS=<index.ts>  PURGE_SCRIPT=<purge script>
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { pathToFileURL } = require('node:url')
const { Hono } = require('hono')
const F = require('./harness/upload_fixtures.cjs')

const SRC = path.join(__dirname, '..', 'src')
const INDEX_TS = process.env.WORKER_INDEX_TS || path.join(SRC, 'index.ts')
const PURGE_SOURCE = process.env.PURGE_SCRIPT || path.resolve(__dirname, '../../ops/scripts/purge-non-media-uploads.mjs')
const BACKSLASH = String.fromCharCode(92)
const STAMP = '2026-09-26T12-00-00-000Z'

const failures = []
let checks = 0
const firstLine = (error) => String((error && error.message) || error).split('\n')[0]
function check(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${firstLine(error)}`) }
}
async function checkAsync(label, fn) {
  checks += 1
  try { await fn() } catch (error) { failures.push(`${label}: ${firstLine(error)}`) }
}

// ------------------------------------------------ the Worker's own modules
// Transpiles src/*.ts on demand. quotaGuard (D1) is replaced by a stub that
// always allows; index.ts is only ever imported for its types.
const quotaStub = { consumeQuota: async () => ({ allowed: true, zone: 'ok', reservedZone: 'ok' }) }
const loaded = new Map()
function loadTs(file) {
  if (loaded.has(file)) return loaded.get(file).exports
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
  })
  const module = { exports: {} }
  loaded.set(file, module)
  const localRequire = (request) => {
    if (!request.startsWith('.')) return require(request)
    const base = path.resolve(path.dirname(file), request)
    const resolved = [`${base}.ts`, path.join(base, 'index.ts')].find((candidate) => fs.existsSync(candidate))
    if (!resolved) throw new Error(`cannot resolve ${request} from ${path.basename(file)}`)
    if (path.basename(resolved) === 'quotaGuard.ts') return quotaStub
    if (resolved === path.resolve(INDEX_TS)) return {}
    return loadTs(resolved)
  }
  new Function('exports', 'require', 'module', outputText)(module.exports, localRequire, module)
  return module.exports
}

// The GET /uploads/* handlers of index.ts, with every identifier they use
// from outside resolved through index.ts's own imports. Anything it cannot
// resolve is an error, never a guess.
function uploadsHandlers() {
  const source = fs.readFileSync(INDEX_TS, 'utf8')
  const file = ts.createSourceFile(INDEX_TS, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
  const imports = new Map()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue
    const from = statement.moduleSpecifier.text
    const clause = statement.importClause
    if (clause.name) imports.set(clause.name.text, { from, name: 'default' })
    const bindings = clause.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) if (!element.isTypeOnly) imports.set(element.name.text, { from, name: (element.propertyName || element.name).text })
    }
    if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, { from, name: '*' })
  }
  const routes = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'get'
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'app'
      && node.arguments.length >= 2 && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === '/uploads/*') {
      routes.push(node.arguments.slice(1).map((argument) => argument.getText(file)))
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (routes.length !== 1) throw new Error(`index.ts has ${routes.length} app.get('/uploads/*') routes, expected 1`)
  return routes[0].map((text) => {
    const js = ts.transpileModule(`module.exports = (${text})`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const jsFile = ts.createSourceFile('handler.js', js, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS)
    const declared = new Set(['module', 'exports'])
    const used = new Set()
    const walk = (node) => {
      if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) declared.add(node.name.text)
      if (ts.isIdentifier(node)) {
        const parent = node.parent
        const isMemberName = parent && ((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node))
        if (!isMemberName) used.add(node.text)
      }
      ts.forEachChild(node, walk)
    }
    walk(jsFile)
    const names = []
    const values = []
    for (const name of used) {
      if (declared.has(name) || name in globalThis) continue
      const origin = imports.get(name)
      if (!origin) throw new Error(`the /uploads/* handler uses ${name}, which is not imported in index.ts; teach this test where it comes from`)
      let target
      if (origin.from.startsWith('.')) {
        const base = path.resolve(path.dirname(INDEX_TS), origin.from)
        const resolved = [`${base}.ts`, path.join(base, 'index.ts')].find((candidate) => fs.existsSync(candidate))
        if (!resolved) throw new Error(`cannot resolve ${origin.from}`)
        target = loadTs(resolved)
      } else target = require(origin.from)
      const value = origin.name === '*' || (origin.name === 'default' && !('default' in target)) ? target : target[origin.name]
      if (value === undefined) throw new Error(`${origin.from} has no export ${origin.name}`)
      names.push(name)
      values.push(value)
    }
    const module = { exports: null }
    new Function('module', ...names, js)(module, ...values)
    if (typeof module.exports !== 'function') throw new Error('the /uploads/* handler is not a function')
    return { text, handler: module.exports, uses: names }
  })
}

// ------------------------------------------------------------- the bucket
const QUARANTINED = `quarantine/${STAMP}/uploads/invoice.jpg`
const SECRET = F.enc('%PDF-1.4 quarantined invoice, never to be served')
function makeBucket() {
  const store = new Map([
    ['uploads/a.jpg', { bytes: F.jpeg(), contentType: 'image/jpeg' }],
    // A document under an image name: the purge moves these by their bytes.
    [QUARANTINED, { bytes: SECRET, contentType: 'image/jpeg' }],
    [`quarantine/${STAMP}/uploads/invoice.pdf`, { bytes: SECRET, contentType: 'application/pdf' }],
    [`quarantine/${STAMP}/imports/job/incoming/p.png`, { bytes: SECRET, contentType: 'image/png' }],
  ])
  const reads = []
  return {
    reads,
    async get(key, options) {
      reads.push(String(key))
      const entry = store.get(String(key))
      if (!entry) return null
      const etag = `"etag-${Buffer.from(String(key)).toString('hex').slice(0, 16)}"`
      if (options && options.onlyIf) {
        const conditions = options.onlyIf instanceof Headers ? options.onlyIf : new Headers()
        if (conditions.get('if-none-match') === etag) return { httpEtag: etag, httpMetadata: { contentType: entry.contentType } }
      }
      return {
        body: new Blob([entry.bytes]).stream(), httpEtag: etag, httpMetadata: { contentType: entry.contentType },
        writeHttpMetadata(headers) { headers.set('content-type', entry.contentType) },
      }
    },
    async put() { throw new Error('this test never writes') },
  }
}
const cacheLog = []
globalThis.caches = {
  default: {
    async match(request) { cacheLog.push(new URL(request.url).pathname); return undefined },
    async put() {},
    async delete() { return true },
  },
}
const ctx = { pending: [], waitUntil(promise) { this.pending.push(promise) }, passThroughOnException() {} }

// ------------------------------------------------------- the hostile list
const Q = QUARANTINED
const enc = (text, slash) => text.split('/').join(slash)
const HOSTILE = [
  `/uploads/../${Q}`,
  `/uploads/./../${Q}`,
  `/uploads/a.jpg/../../${Q}`,
  `/uploads/%2e%2e/${Q}`,
  `/uploads/%2E%2E/${Q}`,
  `/uploads/.%2e/${Q}`,
  `/uploads/%2e./${Q}`,
  `/uploads/%2e%2e/%2e%2e/${Q}`,
  `/uploads/..%2f${enc(Q, '%2f')}`,
  `/uploads/..%2F${enc(Q, '%2F')}`,
  `/uploads/%2e%2e%2f${enc(Q, '%2f')}`,
  `/uploads/%2e%2e%2F${Q}`,
  `/uploads/%252e%252e/${Q}`,
  `/uploads/..%252f${enc(Q, '%252f')}`,
  `/uploads/..${BACKSLASH}${enc(Q, BACKSLASH)}`,
  `/uploads/..%5c${enc(Q, '%5c')}`,
  `/uploads/%2e%2e%5c${enc(Q, '%5C')}`,
  `/uploads//${Q}`,
  `/uploads/%2f${Q}`,
  `/uploads/%2f%2e%2e%2f${enc(Q, '%2f')}`,
  `/uploads/%c0%ae%c0%ae/${Q}`,
  `/uploads/..%c0%af${enc(Q, '%c0%af')}`,
  `/uploads/%u002e%u002e/${Q}`,
  `/uploads/..;/${Q}`,
  `/uploads/%00/../${Q}`,
  `/uploads/..%00/${Q}`,
  `/uploads/_v/w320/../../${Q}`,
  `/uploads/_v/w320/..%2f..%2f${enc(Q, '%2f')}`,
  `/uploads/_v/w320/%2e%2e%2f%2e%2e%2f${enc(Q, '%2f')}`,
  `/uploads/_v/w320/..${BACKSLASH}..${BACKSLASH}${enc(Q, BACKSLASH)}`,
  `/uploads/${Q}`,
  `/uploads/?/../${Q}`,
  `/uploads/none.jpg?key=${encodeURIComponent(Q)}&path=../${Q}&file=${Q}`,
  `/uploads/none.jpg#/../../${Q}`,
  `/UPLOADS/../${Q}`,
  `//uploads/../${Q}`,
  `/${Q}`,
  `/${enc(Q, '%2f')}`,
  '/uploads/../quarantine/',
  '/uploads/..%2fquarantine%2f',
]
const ORIGIN = 'https://business-os.example'
const sameBytes = (response, bytes) => response.arrayBuffer().then((body) => Buffer.from(body).equals(Buffer.from(bytes)))

async function probe(app, rawPath, bucket) {
  let request
  try { request = new Request(`${ORIGIN}${rawPath}`) } catch { return { refusedByUrlParser: true, reads: [] } }
  const before = bucket.reads.length
  const response = await app.request(request, undefined, { ASSETS: bucket }, ctx)
  return { status: response.status, leaked: await sameBytes(response, SECRET), reads: bucket.reads.slice(before), pathname: new URL(request.url).pathname }
}
const servedPrefixes = (key) => key.startsWith('uploads/') || key.startsWith('variants/')

async function main() {
  let handlers = null
  check('index.ts has one GET /uploads/* route and everything it calls resolves', () => { handlers = uploadsHandlers() })
  if (!handlers) handlers = []
  const imageVariants = loadTs(path.join(SRC, 'lib', 'imageVariants.ts'))
  const r2 = loadTs(path.join(SRC, 'lib', 'r2.ts'))

  const bucket = makeBucket()
  const app = new Hono()
  if (handlers.length) app.get('/uploads/*', ...handlers.map((entry) => entry.handler))

  await checkAsync('control: /uploads/a.jpg is served from uploads/a.jpg', async () => {
    const result = await probe(app, '/uploads/a.jpg', bucket)
    assert.equal(result.status, 200)
    assert.deepEqual(result.reads, ['uploads/a.jpg'])
  })

  const reached = []
  for (const rawPath of HOSTILE) {
    await checkAsync(`/uploads handler: ${rawPath}`, async () => {
      const result = await probe(app, rawPath, bucket)
      if (result.refusedByUrlParser) return
      const outside = result.reads.filter((key) => !servedPrefixes(key))
      assert.deepEqual(outside, [], `read ${outside.join(', ')} for ${result.pathname}`)
      assert.ok(!result.leaked, `served the quarantined bytes for ${result.pathname}`)
      assert.notEqual(result.status, 200, `answered 200 for ${result.pathname}`)
      reached.push(...result.reads)
    })
  }
  check('no request read a quarantine/ key, and the probes did reach the bucket', () => {
    assert.deepEqual(bucket.reads.filter((key) => key.startsWith('quarantine/')), [])
    assert.ok(reached.length > 0, 'the handler read nothing at all: the probe is not reaching R2')
  })

  // serveUpload with the raw paths, as any future caller could pass them.
  for (const rawPath of HOSTILE) {
    await checkAsync(`serveUpload raw: ${rawPath}`, async () => {
      const direct = makeBucket()
      const response = await imageVariants.serveUpload({ ASSETS: direct }, rawPath, new Request(`${ORIGIN}/uploads/x`), ctx)
      const outside = direct.reads.filter((key) => !servedPrefixes(key))
      assert.deepEqual(outside, [], `read ${outside.join(', ')}`)
      assert.ok(!(await sameBytes(response, SECRET)), 'served the quarantined bytes')
    })
  }

  // Positive control: the plausible mistake (decode, then normalise the
  // path) is caught by the same list, so the list and the recording work.
  await checkAsync('control: a handler that decodes and normalises the path is caught reading quarantine/', async () => {
    const wrongBucket = makeBucket()
    const wrong = new Hono()
    const decoded = (text) => { try { return decodeURIComponent(text) } catch { return text } }
    wrong.get('/uploads/*', (c) => r2.serveObject(c.env.ASSETS, path.posix.normalize(decoded(c.req.path)).replace(/^\/+/, ''), c.req.raw, c.executionCtx))
    let leaks = 0
    for (const rawPath of HOSTILE) {
      const result = await probe(wrong, rawPath, wrongBucket)
      if (!result.refusedByUrlParser && result.leaked) leaks += 1
    }
    assert.ok(wrongBucket.reads.some((key) => key.startsWith('quarantine/')), 'the wrong handler never reached quarantine/')
    assert.ok(leaks > 0, 'the wrong handler never served the quarantined bytes')
  })

  // ------------------------------------------------------ the purge side
  let purge = {}
  try { purge = await import(pathToFileURL(PURGE_SOURCE).href) } catch (error) { failures.push(`load the purge script: ${firstLine(error)}`) }
  check('purge: quarantine keys are quarantine/<time>/<key>', () => {
    assert.equal(purge.QUARANTINE_ROOT, 'quarantine/')
    for (const key of ['uploads/a.pdf', 'private/library/r.pdf', 'imports/j/incoming/i.csv', 'uploads/../x']) {
      assert.equal(purge.quarantineKeyFor(STAMP, key), `quarantine/${STAMP}/${key}`)
    }
  })
  check('purge: the quarantine is outside every folder the script lists and every folder the Worker serves', () => {
    assert.ok(Array.isArray(purge.PREFIXES) && purge.PREFIXES.length > 0)
    for (const prefix of [...purge.PREFIXES, 'uploads/', 'variants/']) {
      assert.ok(!purge.QUARANTINE_ROOT.startsWith(prefix) && !prefix.startsWith(purge.QUARANTINE_ROOT), prefix)
    }
  })
  check('purge: a manifest cannot point --restore at a key outside the listed folders or a quarantine key elsewhere', () => {
    const manifest = {
      tool: purge.MANIFEST_TOOL, format: purge.MANIFEST_FORMAT, bucket: purge.BUCKET, mode: 'move', stamp: STAMP,
      quarantinePrefix: `quarantine/${STAMP}/`, moves: [{ key: 'uploads/a.pdf', quarantineKey: `quarantine/${STAMP}/uploads/a.pdf`, sha256: 'a'.repeat(64), size: 1 }],
      rows: { file_assets: [], import_job_files: [] },
    }
    assert.deepEqual(purge.validateManifest(manifest), [])
    const outside = JSON.parse(JSON.stringify(manifest))
    outside.moves[0] = { ...outside.moves[0], key: 'variants/w320/a.webp', quarantineKey: `quarantine/${STAMP}/variants/w320/a.webp` }
    assert.ok(purge.validateManifest(outside).length > 0)
    const elsewhere = JSON.parse(JSON.stringify(manifest))
    elsewhere.moves[0].quarantineKey = 'uploads/a.pdf'
    assert.ok(purge.validateManifest(elsewhere).length > 0)
  })

  await Promise.allSettled(ctx.pending)
  if (failures.length) {
    for (const failure of failures.slice(0, 60)) console.error(`FAIL ${failure}`)
    if (failures.length > 60) console.error(`...and ${failures.length - 60} more`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  const uses = handlers.map((entry) => entry.uses.join(', ')).join('; ')
  console.log(`PASS ${checks} checks: GET /uploads/* (uses ${uses}) and serveUpload read only uploads/ and variants/ for ${HOSTILE.length} traversal paths; quarantine/ is never read or served; a normalising handler is caught; the purge's quarantine is outside every listed and served folder`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
