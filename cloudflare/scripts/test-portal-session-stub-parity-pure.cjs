// G38 R3-4 (review F9): every test stub of '../lib/portalSession' that provides createPortalSession must also provide
// createPortalSessionReplacingPresented, the helper routes/portal.ts mints through. A stub without it loads fine and then
// throws "is not a function" the first time a stubbed sign-in succeeds, in a test that is not about sign-in.
//
// Run (from cloudflare/): node scripts/test-portal-session-stub-parity-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SCRIPTS = __dirname
const SRC = path.join(SCRIPTS, '..', 'src')
const KEY = "'../lib/portalSession'"
const HELPER = 'createPortalSessionReplacingPresented'

let passed = 0
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) }
}

function listScripts(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listScripts(full))
    else if (entry.name.endsWith('.cjs')) out.push(full)
  }
  return out
}

// The text of the object literal that follows each "'../lib/portalSession':" key (balanced braces; strings and templates
// are not tracked, the stubs hold none with a brace in them).
function stubBodies(text) {
  const bodies = []
  let at = text.indexOf(KEY)
  while (at !== -1) {
    let i = at + KEY.length
    while (i < text.length && text[i] !== '{' && text[i] !== '\n') i += 1
    if (text[i] === '{') {
      let depth = 0
      let j = i
      for (; j < text.length; j += 1) {
        if (text[j] === '{') depth += 1
        else if (text[j] === '}') { depth -= 1; if (depth === 0) break }
      }
      bodies.push(text.slice(i, j + 1))
    }
    at = text.indexOf(KEY, at + KEY.length)
  }
  return bodies
}

check('the real module exports the helper the stubs must carry', () => {
  const source = fs.readFileSync(path.join(SRC, 'lib', 'portalSession.ts'), 'utf8')
  assert.ok(source.includes(`export async function ${HELPER}`))
  const portal = fs.readFileSync(path.join(SRC, 'routes', 'portal.ts'), 'utf8')
  assert.ok(portal.includes(`${HELPER}(c, `), 'routes/portal.ts mints through the helper')
})

const found = []
for (const file of listScripts(SCRIPTS)) {
  if (file === __filename) continue // its own self-test text holds a stub on purpose
  const text = fs.readFileSync(file, 'utf8')
  for (const body of stubBodies(text)) found.push({ file: path.relative(SCRIPTS, file).split(path.sep).join('/'), body })
}

check('the scan sees the stubs (a wrong root must not look like a clean tree)', () => {
  assert.ok(found.length >= 12, `only ${found.length} portalSession stubs found`)
  assert.ok(found.some((s) => s.file === 'harness/load_portal_route.cjs'), 'the shared route harness stub is scanned')
  assert.ok(found.some((s) => s.file === 'test-portal-cache-hardening-native.cjs'), 'a native stub is scanned')
  assert.ok(found.some((s) => s.file === 'test-request-body-guard-pure.cjs'), 'a multi-line stub is scanned')
})

check(`every stub that provides createPortalSession also provides ${HELPER}`, () => {
  const missing = found
    .filter((s) => s.body.includes('createPortalSession:') && !s.body.includes(`${HELPER}:`))
    .map((s) => s.file)
  assert.deepEqual(missing, [], `stubs without ${HELPER}: ${missing.join(', ')}`)
})

check('the check is not vacuous: a stub without the helper is reported', () => {
  const stub = "x = { '../lib/portalSession': { createPortalSession: async () => ({}), setPortalCookie: () => {} }, '../lib/db': {} }"
  const bodies = stubBodies(stub)
  assert.equal(bodies.length, 1)
  assert.ok(bodies[0].includes('createPortalSession:') && !bodies[0].includes(`${HELPER}:`))
  const fixed = stub.replace('createPortalSession: async', `${HELPER}: async () => ({}), createPortalSession: async`)
  assert.ok(stubBodies(fixed)[0].includes(`${HELPER}:`))
})

console.log(`${passed} portal session stub parity checks passed`)
