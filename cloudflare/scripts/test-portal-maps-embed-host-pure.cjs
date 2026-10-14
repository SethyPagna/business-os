// X1 (security audit, 13 Oct 2026): the About-tab map iframe src must come from a Google host that
// is named exactly. The old pattern /^(.+\.)?google\.[a-z.]+$/ also accepted google.evil.com,
// maps.google.attacker.net and google.com.evil.io, and a /maps/embed URL on any of them was served
// verbatim as the iframe src.
//
// Loads BOTH real twins -- the Worker's normalizeGoogleMapsEmbed (routes/portal.ts) and the
// editor's (frontend portalEditorUtils.ts) -- and requires them to give the same answer for every
// case, so the editor never accepts a value the storefront refuses (or the reverse).
//
// Run: node scripts/test-portal-maps-embed-host-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const portalRoute = require('./harness/load_portal_route.cjs')
const workerNormalize = portalRoute.normalizeGoogleMapsEmbed

const editorPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'catalog', 'portalEditorUtils.ts')
const portalPath = path.join(__dirname, '..', 'src', 'routes', 'portal.ts')
const editorModule = { exports: {} }
new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync(editorPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: editorPath,
}).outputText)(editorModule.exports, require, editorModule)
const editorNormalize = editorModule.exports.normalizeGoogleMapsEmbed

assert.strictEqual(typeof workerNormalize, 'function', 'routes/portal.ts must export normalizeGoogleMapsEmbed so this test can load the real one')
assert.strictEqual(typeof editorNormalize, 'function', 'portalEditorUtils.ts must export normalizeGoogleMapsEmbed')

const SUFFIXES = ['com', 'com.kh', 'co.th', 'com.sg', 'co.uk', 'com.au', 'de', 'fr', 'co.jp']
const REWRITTEN = 'https://www.google.com/maps?q='

let checks = 0
let failed = 0
function check(label, fn) {
  try {
    fn()
    checks += 1
    console.log(`PASS ${label}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${label}`)
    console.error(error.message)
  }
}

function both(input) {
  const worker = workerNormalize(input)
  const editor = editorNormalize(input)
  assert.strictEqual(worker, editor, `the Worker and the editor disagree on ${JSON.stringify(input)}: ${JSON.stringify(worker)} vs ${JSON.stringify(editor)}`)
  return worker
}

check('a /maps/embed URL on a named Google host is accepted and served unchanged', () => {
  for (const url of [
    'https://www.google.com/maps/embed?pb=abc123',
    'https://google.com/maps/embed?pb=abc123',
    'https://maps.google.com/maps/embed?pb=abc123',
    'https://WWW.GOOGLE.COM/maps/embed?pb=abc123',
  ]) {
    assert.strictEqual(both(url), new URL(url).toString(), url)
  }
  assert.strictEqual(both('<iframe src="https://www.google.com/maps/embed?pb=abc123" width="600" height="450"></iframe>'), 'https://www.google.com/maps/embed?pb=abc123')
})

check('the listed country domains are accepted in all three forms', () => {
  for (const suffix of SUFFIXES) {
    for (const prefix of ['', 'www.', 'maps.']) {
      const url = `https://${prefix}google.${suffix}/maps/embed?pb=1`
      assert.strictEqual(both(url), url, url)
    }
  }
})

check('the audit cases and their relatives are refused by both twins', () => {
  for (const url of [
    'https://google.evil.com/maps/embed?pb=1',
    'https://maps.google.attacker.net/maps/embed?pb=1',
    'https://google.com.evil.io/maps/embed?pb=1',
    'https://www.google.com.evil.io/maps/embed?pb=1',
    'https://notgoogle.com/maps/embed?pb=1',
    'https://evilgoogle.com/maps/embed?pb=1',
    'https://google.com.kh.evil.com/maps/embed?pb=1',
    'https://google.fr.evil.com/maps/embed?pb=1',
    'https://evil.com/www.google.com/maps/embed?pb=1',
    'https://www.google.com@evil.com/maps/embed?pb=1',
    'https://www.google.com./maps/embed?pb=1',
    'https://www.google.in/maps/embed?pb=1',
    'https://google.evil.com/maps?q=x',
    'http://google.com.evil.io/maps/embed',
    '<iframe src="https://google.evil.com/maps/embed?pb=1"></iframe>',
  ]) {
    assert.strictEqual(both(url), '', url)
  }
})

check('credentials, relative, script and non-web values are refused', () => {
  for (const value of [
    'https://user:pass@www.google.com/maps/embed?pb=1',
    'https://user@www.google.com/maps/embed?pb=1',
    '//www.google.com/maps/embed?pb=1',
    'www.google.com/maps/embed?pb=1',
    'javascript:alert(1)',
    'ftp://www.google.com/maps/embed',
    'data:text/html,<p>x</p>',
    '',
    '   ',
    null,
    undefined,
  ]) {
    assert.strictEqual(both(value), '', String(value))
  }
})

check('a plain Google link is rewritten to the fixed embed URL on www.google.com', () => {
  for (const url of [
    'https://www.google.com/maps/place/Leang+Cosmetics',
    'https://maps.google.com/?q=Leang+Cosmetics',
    'https://www.google.com.kh/maps?q=Phnom+Penh',
  ]) {
    const out = both(url)
    assert.ok(out.startsWith(REWRITTEN) && out.includes('output=embed'), `${url} -> ${out}`)
  }
})

check('share links are rewritten whatever their path, never served as an embed host', () => {
  for (const url of [
    'https://maps.app.goo.gl/AbC123',
    'https://goo.gl/maps/AbC123',
    'https://share.google/AbC123',
    'https://goo.gl/maps/embed?pb=1',
    'https://maps.app.goo.gl/maps/embed?pb=1',
  ]) {
    const out = both(url)
    assert.ok(out.startsWith(REWRITTEN) && out.includes('output=embed'), `${url} -> ${out}`)
  }
  for (const url of ['https://goo.gl.evil.com/AbC', 'https://maps.app.goo.gl.evil.com/AbC', 'https://evilgoo.gl/AbC', 'https://share.google.evil.com/AbC']) {
    assert.strictEqual(both(url), '', url)
  }
})

check('every attacker shape built around a Google name is refused by both twins', () => {
  const attackers = ['evil.com', 'attacker.net', 'evil.io', 'com.evil.io', 'kh', 'in', 'ru']
  for (const attacker of attackers) {
    for (const url of [
      `https://google.${attacker}/maps/embed?pb=1`,
      `https://www.google.${attacker}/maps/embed?pb=1`,
      `https://maps.google.${attacker}/maps/embed?pb=1`,
      `https://google.com.${attacker}/maps/embed?pb=1`,
      `https://www.google.com.${attacker}/maps/embed?pb=1`,
      `https://${attacker}.google.com.${attacker}/maps/embed?pb=1`,
    ]) {
      const out = both(url)
      const host = new URL(url).hostname
      const named = SUFFIXES.some((suffix) => [`google.${suffix}`, `www.google.${suffix}`, `maps.google.${suffix}`].includes(host))
      assert.strictEqual(out !== '', named, `${url} -> ${out}`)
    }
  }
})

check('the two twins carry the same explicit suffix list', () => {
  const read = (file) => {
    const match = /const GOOGLE_MAPS_DOMAIN_SUFFIXES = \[([^\]]*)\]/.exec(fs.readFileSync(file, 'utf8'))
    assert.ok(match, `${path.basename(file)} must declare GOOGLE_MAPS_DOMAIN_SUFFIXES`)
    return match[1].replace(/\s+/g, '')
  }
  assert.strictEqual(read(portalPath), read(editorPath))
  assert.deepStrictEqual(read(portalPath).split(',').map((item) => item.replace(/'/g, '')), SUFFIXES, 'this test and the sources list the same suffixes')
})

check('the old suffix pattern is gone from both twins', () => {
  for (const file of [portalPath, editorPath]) {
    assert.ok(!/google\\\.\[a-z\.\]/.test(fs.readFileSync(file, 'utf8')), `${path.basename(file)} still carries a google.[a-z.] pattern`)
  }
})

if (failed) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log(`\n${checks} check(s) passed.`)
