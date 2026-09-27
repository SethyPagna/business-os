// S-uploads2a fix 1 (2026-09-26): the owner-run purge
// (ops/scripts/purge-non-media-uploads.mjs) decides what to keep with a
// plain-JavaScript mirror of the Worker's lib/uploadSecurity.ts --
// detectUploadFormat and containsEmbeddedMarkup. The two must not drift:
// the first purge judged by file name and would have removed real photos
// and videos the Worker accepts. Checked here:
//
//   1. Structure. Every top-level declaration the two functions reach in
//      uploadSecurity.ts (computed from the source, not listed by hand) is
//      in the purge script with the same tokens once the TypeScript types
//      are removed. Comments, whitespace, semicolons and trailing commas do
//      not count; everything else does.
//   2. Constants. Every exported brand, token and byte list is equal.
//   3. Behaviour. The same fixtures through both give the same format and
//      markup verdict: every refuter probe (the .jfif/.jpe/.bin/extension-
//      less/.m4v/QuickTime files, the polyglot bypasses in every carrier),
//      HEIC/BMP/TIFF, C2PA manifests, the ISO brand cases, every image in
//      the repo, prefixes of each small fixture (the purge reads only the
//      first 4 KB of large files) and 20,000 seeded mutations.
//
// Every failure is listed before the exit code is set. To see this fail on
// an older tree, point it at older copies:
//   UPLOAD_SECURITY_TS=/tmp/uploadSecurity.ts PURGE_SCRIPT=/tmp/purge.mjs node test-upload-classifier-parity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const ts = require('typescript')
const F = require('./harness/upload_fixtures.cjs')

const SECURITY_SOURCE = process.env.UPLOAD_SECURITY_TS || path.join(__dirname, '..', 'src', 'lib', 'uploadSecurity.ts')
const PURGE_SOURCE = process.env.PURGE_SCRIPT || path.join(__dirname, '..', '..', 'ops', 'scripts', 'purge-non-media-uploads.mjs')
// S-uploads3: the stored-media detection the backup restore and /uploads/*
// serving share with the purge is mirrored too.
const ROOTS = ['detectUploadFormat', 'containsEmbeddedMarkup', 'detectOtherMedia', 'otherMediaLooksLikeText']

const failures = []
let checks = 0
function check(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${String(error && error.message).split('\n')[0]}`) }
}

// The Worker module, as the other pure tests load it.
function loadWorker() {
  const outputText = ts.transpileModule(fs.readFileSync(SECURITY_SOURCE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: SECURITY_SOURCE,
  }).outputText
  const loaded = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(loaded.exports, require, loaded, SECURITY_SOURCE, path.dirname(SECURITY_SOURCE))
  return loaded.exports
}

// ------------------------------------------------------ 1. structure
function topLevelDeclarations(text, fileName) {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const declarations = new Map()
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, { node: statement, sourceFile })
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, { node: statement, sourceFile })
      }
    }
  }
  return declarations
}

function referencedDeclarations(entry, declarations, self) {
  const found = new Set()
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text !== self && declarations.has(node.text)) found.add(node.text)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(entry.node, visit)
  return found
}

function tokensOf(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.ES2022, true, ts.LanguageVariant.Standard, text)
  const raw = []
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) raw.push(scanner.getTokenText())
  const tokens = raw.filter((token, index) => token !== ';' && !(token === ',' && [']', '}', ')'].includes(raw[index + 1])))
  return tokens[0] === 'export' ? tokens.slice(1) : tokens
}

function structureSection() {
  const workerJs = ts.transpileModule(fs.readFileSync(SECURITY_SOURCE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: true },
    fileName: SECURITY_SOURCE,
  }).outputText
  const worker = topLevelDeclarations(workerJs, 'uploadSecurity.js')
  const purge = topLevelDeclarations(fs.readFileSync(PURGE_SOURCE, 'utf8'), 'purge.mjs')
  const closure = new Set()
  const queue = ROOTS.filter((name) => worker.has(name))
  check('uploadSecurity.ts declares both classifier functions', () => assert.deepEqual(queue, ROOTS))
  while (queue.length) {
    const name = queue.shift()
    if (closure.has(name)) continue
    closure.add(name)
    for (const next of referencedDeclarations(worker.get(name), worker, name)) if (!closure.has(next)) queue.push(next)
  }
  check('the classifier reaches a real set of declarations', () => assert.ok(closure.size >= 30, `only ${closure.size}`))
  for (const name of [...closure].sort()) {
    check(`mirror: ${name}`, () => {
      assert.ok(purge.has(name), 'missing from the purge script')
      const want = tokensOf(worker.get(name).node.getText(worker.get(name).sourceFile))
      const got = tokensOf(purge.get(name).node.getText(purge.get(name).sourceFile))
      const at = want.findIndex((token, index) => token !== got[index])
      if (at === -1 && want.length === got.length) return
      const where = at === -1 ? Math.min(want.length, got.length) : at
      assert.fail(`differs at token ${where}: uploadSecurity.ts "${want.slice(Math.max(0, where - 4), where + 4).join(' ')}" vs purge "${got.slice(Math.max(0, where - 4), where + 4).join(' ')}"`)
    })
  }
  return closure
}

// ------------------------------------------------------ 2. constants
const SHARED_CONSTANTS = [
  'MP4_VIDEO_BRANDS', 'QUICKTIME_BRAND', 'AVIF_BRANDS', 'HEIF_STRUCTURAL_BRANDS', 'HEVC_IMAGE_BRANDS', 'QUICKTIME_LEADING_ATOMS',
  'EMBEDDED_MARKUP_TOKENS', 'MARKUP_TAG_TERMINATORS', 'MARKUP_TOKEN_SEPARATORS', 'MARKUP_SNIFF_WINDOW_BYTES',
  'MARKUP_PAYLOAD_MIN_TOKEN_LENGTH', 'C2PA_MANIFEST_IGNORED_TOKENS', 'EVENT_HANDLER_PRECEDERS', 'C2PA_UUID',
]

// ------------------------------------------------------ 3. behaviour
function behaviourFixtures() {
  const fixtures = F.catalogue().map((entry) => ({ label: `catalogue ${entry.name}`, bytes: entry.bytes, worker: entry.worker, markup: entry.markup }))
  for (const [bypass, payload] of F.BYPASSES) {
    for (const [where, file] of F.bypassCarriers(payload)) fixtures.push({ label: `bypass ${bypass} in ${where}`, bytes: file, markup: true })
  }
  for (const [where, build] of F.c2paCarriers()) {
    for (const [label, icon, markup] of F.C2PA_ICONS) fixtures.push({ label: `C2PA ${where}: ${label}`, bytes: build(icon), markup })
  }
  for (const [label, file, mime] of F.brandCases()) fixtures.push({ label: `brand ${label}`, bytes: file, worker: mime })
  // Structured images with short tokens planted in compressed data (noise)
  // and '<script' planted there (markup).
  for (let seed = 1; seed <= 4; seed += 1) {
    const rng = F.mulberry32(seed * 7919)
    const payload = F.randomBytes(rng, 60000)
    payload.set(F.enc('<svg '), 20000)
    payload.set(F.enc('<img>'), 30000)
    const scripted = payload.slice()
    scripted.set(F.enc('<script>'), 40000)
    for (const [kind, data] of [['short tokens', payload], ['<script>', scripted]]) {
      fixtures.push({ label: `seed ${seed} JPEG scan with ${kind}`, bytes: F.jpeg({ scan: data, rng }) })
      fixtures.push({ label: `seed ${seed} PNG IDAT with ${kind}`, bytes: F.png(F.pngChunk('IDAT', data)) })
      fixtures.push({ label: `seed ${seed} GIF LZW with ${kind}`, bytes: F.gif({ lzw: data, rng }) })
      fixtures.push({ label: `seed ${seed} WebP VP8 with ${kind}`, bytes: F.webp(F.webpChunk('VP8 ', data)) })
      fixtures.push({ label: `seed ${seed} AVIF mdat with ${kind}`, bytes: F.avif(new Uint8Array(40), data) })
      fixtures.push({ label: `seed ${seed} Pixel motion photo with ${kind}`, bytes: F.jpeg({ rng, trailer: F.bytes(F.ftyp('isom', 'isom'), F.isoBox('mdat', data), F.MOOV) }) })
    }
  }
  return fixtures
}

function repoImages() {
  const repoRoot = path.resolve(__dirname, '..', '..')
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter((file) => /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|heic|heif|mp4|mov|webm)$/i.test(file))
  return files.map((file) => ({ label: `repo ${file}`, bytes: new Uint8Array(fs.readFileSync(path.join(repoRoot, file))) }))
}

const otherSeen = {}
function same(worker, purge, bytes) {
  const want = worker.detectUploadFormat(bytes)
  const got = purge.detectUploadFormat(bytes)
  assert.deepEqual(got, want, 'detectUploadFormat differs')
  assert.equal(purge.containsEmbeddedMarkup(bytes), worker.containsEmbeddedMarkup(bytes), 'containsEmbeddedMarkup differs')
  // An older uploadSecurity.ts has no stored-media detection: that shows as
  // structure failures above, not as a crash here.
  if (typeof worker.detectOtherMedia === 'function') {
    const other = worker.detectOtherMedia(bytes)
    assert.deepEqual(purge.detectOtherMedia(bytes), other, 'detectOtherMedia differs')
    for (const complete of [true, false]) {
      if (other) assert.equal(purge.otherMediaLooksLikeText(other, bytes, complete), worker.otherMediaLooksLikeText(other, bytes, complete), 'otherMediaLooksLikeText differs')
    }
    const kind = other ? other.kind : 'none'
    otherSeen[kind] = (otherSeen[kind] || 0) + 1
  }
  return want
}

// Seeded mutations of the small fixtures: byte flips, cuts, planted tokens
// (random case, terminator and UTF-16), brand and atom swaps, splices.
function mutations(pool, worker, count) {
  const rng = F.mulberry32(20260926)
  const pick = (items) => items[Math.floor(rng() * items.length)]
  // An older uploadSecurity.ts lacks some of these exports; the mutations
  // still run so that its verdicts are compared, not skipped.
  const list = (value) => [].concat(value === undefined ? [] : value)
  const brands = [...list(worker.MP4_VIDEO_BRANDS), ...list(worker.AVIF_BRANDS), ...list(worker.HEIF_STRUCTURAL_BRANDS), ...list(worker.HEVC_IMAGE_BRANDS), ...list(worker.QUICKTIME_BRAND), 'isom', 'avif', 'heic', 'qt  ', 'M4A ', 'crx ', 'miaf', 'abcd', 'MP42', 'AVIF']
  const atoms = [...list(worker.QUICKTIME_LEADING_ATOMS), 'wide', 'mdat', 'moov', 'free', 'skip', 'ftyp', 'uuid', 'meta', 'PICT', 'junk']
  const plants = [...list(worker.EMBEDDED_MARKUP_TOKENS), '<script', '<svg', '<html', ' onload=', '/onerror =', '"onclick=', 'ftyp', 'caBX', 'C2PA', 'JP', 'MotionPhoto_Data', 'IEND', 'mdat']
  const terminators = [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x2f, 0x3d, 0x3e, 0x41, 0x5f, 0x3c, -1]
  const out = []
  for (let index = 0; index < count; index += 1) {
    let data = pick(pool).slice()
    const operation = Math.floor(rng() * 7)
    if (operation === 0) {
      for (let flips = 1 + Math.floor(rng() * 4); flips > 0 && data.length; flips -= 1) data[Math.floor(rng() * data.length)] = (rng() * 256) | 0
    } else if (operation === 1) {
      data = data.slice(0, Math.floor(rng() * (data.length + 1)))
    } else if (operation === 2 || operation === 3) {
      let token = [...pick(plants)].map((char) => (rng() < 0.5 ? char.toUpperCase() : char)).join('')
      const terminator = pick(terminators)
      if (terminator >= 0) token += String.fromCharCode(terminator)
      const encoded = operation === 3 ? F.utf16le(token) : F.latin1(token)
      const at = Math.floor(rng() * (data.length + 1))
      data = F.bytes(data.subarray(0, at), encoded, data.subarray(Math.min(data.length, at + (rng() < 0.5 ? encoded.length : 0))))
    } else if (operation === 4 && data.length >= 12) {
      const offset = rng() < 0.5 ? 8 : 16 + 4 * Math.floor(rng() * 4)
      if (offset + 4 <= data.length) data.set(F.latin1(pick(brands)), offset)
    } else if (operation === 5 && data.length >= 8) {
      data.set(F.latin1(pick(atoms)), 4)
      if (rng() < 0.5) data.set(F.u32be(Math.floor(rng() * (data.length + 64))), 0)
    } else {
      const other = pick(pool)
      const from = Math.floor(rng() * other.length)
      const piece = other.subarray(from, from + Math.floor(rng() * 256))
      const at = Math.floor(rng() * (data.length + 1))
      data = F.bytes(data.subarray(0, at), piece, data.subarray(at))
    }
    out.push(data)
  }
  return out
}

async function main() {
  const worker = loadWorker()
  let purge = {}
  try {
    purge = await import(pathToFileURL(PURGE_SOURCE).href)
  } catch (error) {
    failures.push(`load the purge script: ${error.message}`)
  }

  const closure = structureSection()

  for (const name of SHARED_CONSTANTS) {
    check(`constant ${name}`, () => {
      assert.ok(name in worker, 'not exported by uploadSecurity.ts')
      assert.ok(name in purge, 'not exported by the purge script')
      assert.deepEqual([].concat(purge[name]), [].concat(worker[name]))
    })
  }

  const fixtures = behaviourFixtures()
  const seenFormats = {}
  for (const fixture of fixtures) {
    check(fixture.label, () => {
      if (fixture.worker !== undefined) {
        const detected = worker.detectUploadFormat(fixture.bytes)
        assert.equal(detected ? detected.mime : null, fixture.worker, 'the fixture is not what it claims (Worker verdict)')
      }
      if (fixture.markup !== undefined) assert.equal(worker.containsEmbeddedMarkup(fixture.bytes), fixture.markup, 'the fixture is not what it claims (Worker markup)')
      const detected = same(worker, purge, fixture.bytes)
      const label = detected ? detected.mime : 'refused'
      seenFormats[label] = (seenFormats[label] || 0) + 1
    })
  }
  check('the fixtures reach every stored-media outcome', () => {
    for (const kind of ['photo', 'video-audio', 'none']) assert.ok(otherSeen[kind] > 0, `no fixture detected as ${kind}`)
  })
  check('the fixtures cover every format the Worker accepts, and refusals', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/quicktime', 'video/webm', 'refused']) {
      assert.ok(seenFormats[mime] > 0, `no fixture for ${mime}`)
    }
  })

  const images = repoImages()
  for (const image of images) check(image.label, () => same(worker, purge, image.bytes))
  check('the repo sweep saw real images', () => assert.ok(images.length >= 10, `only ${images.length}`))

  // Prefixes of the small fixtures (the purge reads 4 KB heads): every
  // length through the headers, then every 8th, then random cuts.
  const small = fixtures.filter((fixture) => fixture.bytes.length <= 16384)
  let prefixes = 0
  for (const fixture of small) {
    const cuts = new Set()
    for (let length = 0; length <= Math.min(fixture.bytes.length, 2048); length += length < 256 ? 1 : 8) cuts.add(length)
    const rng = F.mulberry32(fixture.bytes.length)
    for (let sample = 0; sample < 48; sample += 1) cuts.add(Math.floor(rng() * (fixture.bytes.length + 1)))
    const bad = []
    for (const length of cuts) {
      prefixes += 1
      try { same(worker, purge, fixture.bytes.subarray(0, length)) } catch { bad.push(length) }
    }
    check(`prefixes of ${fixture.label}`, () => assert.deepEqual(bad.slice(0, 5), [], `${bad.length} prefixes differ`))
  }

  const mutated = mutations(small.map((fixture) => fixture.bytes), worker, 20000)
  const diverging = []
  const verdicts = { accepted: 0, refused: 0, markup: 0 }
  for (let index = 0; index < mutated.length; index += 1) {
    try {
      const detected = same(worker, purge, mutated[index])
      verdicts[detected ? 'accepted' : 'refused'] += 1
      if (worker.containsEmbeddedMarkup(mutated[index])) verdicts.markup += 1
    } catch (error) {
      diverging.push(`#${index}: ${error.message.split('\n')[0]}`)
    }
  }
  check('20,000 seeded mutations: same verdicts', () => assert.deepEqual(diverging.slice(0, 3), []))
  // The mutations must exercise both outcomes of both functions, or the
  // agreement above proves nothing.
  check('the mutations reach every outcome', () => {
    assert.ok(verdicts.accepted > 2000 && verdicts.refused > 2000, JSON.stringify(verdicts))
    assert.ok(verdicts.markup > 1000 && verdicts.markup < mutated.length - 1000, JSON.stringify(verdicts))
  })

  console.log(`mirrored declarations: ${closure.size}; fixtures: ${fixtures.length}; repo images: ${images.length}; prefixes: ${prefixes}; mutations: ${mutated.length} (${JSON.stringify(verdicts)})`)
  if (failures.length) {
    for (const failure of failures.slice(0, 60)) console.error(`FAIL ${failure}`)
    if (failures.length > 60) console.error(`...and ${failures.length - 60} more`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: the purge's mirror of uploadSecurity.ts is token-identical, its constants equal, and both classify every probe, prefix and mutation the same`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
