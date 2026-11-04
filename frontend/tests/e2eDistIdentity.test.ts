import assert from 'node:assert/strict'
import { assetNames, distMismatch } from '../e2e/support/distIdentity.ts'

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// What vite emits: a module script, preloads and stylesheets, all content-hashed.
const BUILD_A = [
  '<!doctype html><html><head>',
  '<link rel="stylesheet" href="/assets/index-BN_WQrF4.css">',
  '<link rel="modulepreload" href="/assets/vendor-react-DKmwvaIJ.js">',
  '<script type="module" src="/assets/index-DZJsw2Ws.js"></script>',
  '</head><body><div id="root"></div></body></html>',
].join('\n')

runTest('the asset list is every hashed js and css file, sorted, once', () => {
  const twice = `${BUILD_A}\n<link rel="modulepreload" href="/assets/vendor-react-DKmwvaIJ.js">`
  assert.deepEqual(assetNames(twice), [
    'assets/index-BN_WQrF4.css',
    'assets/index-DZJsw2Ws.js',
    'assets/vendor-react-DKmwvaIJ.js',
  ])
})

runTest('files that are not built assets do not count', () => {
  const html = '<link rel="icon" href="/leang-cosmetics-icon-512-v2.png"><script src="https://example.test/assets/x.js"></script><link href="/manifest.webmanifest">'
  assert.deepEqual(assetNames(html), [])
})

runTest('the same build served from the same port is fine, whatever order the tags come in', () => {
  const reordered = BUILD_A.split('\n').reverse().join('\n')
  assert.equal(distMismatch(reordered, BUILD_A, 4318), null)
})

runTest('the service-worker generation stamp the fixture server injects does not read as another build', () => {
  const stamped = BUILD_A.replace('<head>', '<head><meta name="e2e-build-generation" content="2">')
  assert.equal(distMismatch(stamped, BUILD_A, 4318), null)
})

runTest('another checkout\'s build on the port is refused, naming the port, the way out and a missing asset', () => {
  // Same entry file name, different content hashes: what two worktrees at different commits produce.
  const other = BUILD_A.replace('index-DZJsw2Ws.js', 'index-Qm7XkP2a.js').replace('vendor-react-DKmwvaIJ.js', 'vendor-react-Zz91LmNb.js')
  const message = distMismatch(other, BUILD_A, 4318)
  assert.ok(message, 'a different build must be refused')
  assert.match(message, /port 4318/)
  assert.match(message, /E2E_PORT/)
  assert.match(message, /3 assets|2 of 3/)
  assert.match(message, /assets\/index-DZJsw2Ws\.js|assets\/vendor-react-DKmwvaIJ\.js/)
})

runTest('a server that serves only a subset of this build is refused too, not just a disjoint one', () => {
  const subset = BUILD_A.replace('<link rel="modulepreload" href="/assets/vendor-react-DKmwvaIJ.js">', '')
  assert.ok(distMismatch(subset, BUILD_A, 4318))
})

runTest('a server that serves MORE than this build is refused as well (an extra chunk means a newer or older tree)', () => {
  const superset = BUILD_A.replace('</head>', '<link rel="modulepreload" href="/assets/extra-Aa11Bb22.js"></head>')
  assert.ok(distMismatch(superset, BUILD_A, 4318))
})

runTest('a dist that references no assets is reported as unbuilt, never compared', () => {
  const message = distMismatch(BUILD_A, '<html></html>', 4318)
  assert.ok(message)
  assert.match(message, /npm run build/)
})

runTest('a non-HTML answer (an unrelated service on the port) is refused', () => {
  assert.ok(distMismatch('{"error":"not found"}', BUILD_A, 4318))
})

if (failed > 0) {
  process.exitCode = 1
}
