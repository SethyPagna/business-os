// Parity: the template, rendered with a client's real values, must reproduce
// that client's last committed Worker config BYTE FOR BYTE. Moving a client's
// configuration out of the tree must not change what is deployed.
//
// The real values are private and live outside this repository, so this test
// only runs where that file exists:
//
//   CLIENT_PARITY_ENV_FILE       path of the dotenv file (default: the first of
//                                ../../Records/Clients/leang.env and
//                                ../Records/Clients/leang.env relative to the checkout)
//   CLIENT_PARITY_REF            the commit holding the baseline wrangler.toml and
//                                wrangler.free.toml (default 95dd89f15, the last
//                                commit that tracked them before the move)
//   CLIENT_PARITY_REF_IDENTITY   the same two files after lane 6.0.956 added the
//                                shop identity (default 6d63a36bb, that lane's tip)
//
// Three facts are proved, for the paid and the free file:
//   1. rendered WITH the client's identity variables, the template reproduces the
//      6.0.956 files byte for byte (the move changed nothing that is deployed);
//   2. those files are 95dd89f15's files plus EXACTLY the 6.0.956 edits, listed
//      below as removed and added lines (nothing else moved);
//   3. rendered WITHOUT the identity variables, the template gives the 6.0.956 file
//      minus its identity block: the block is the only thing the variables switch.
// The two manifest routes and the reworded comments are not switchable any more
// (6.0.962 retired MANIFEST_ROUTES), so the identity-less render is not
// 95dd89f15's bytes any more; fact 2 says exactly how it differs.
//
// Without the file (CI, a fresh clone) it prints SKIP and passes. With the
// file present and the baseline readable it must be identical, or it fails.
//
// Run: node scripts/test-client-wrangler-parity-pure.cjs
'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const wrangler = require('./harness/rendered_wrangler.cjs')

const { lib, ROOT } = wrangler
const REF = process.env.CLIENT_PARITY_REF || '95dd89f15'
const REF_IDENTITY = process.env.CLIENT_PARITY_REF_IDENTITY || '6d63a36bb'
const envFile = wrangler.clientEnvFile()

if (!envFile) {
  console.log('test-client-wrangler-parity-pure: SKIP (no client env file: set CLIENT_PARITY_ENV_FILE, or keep it at Records/Clients/leang.env)')
  process.exit(0)
}

function show(ref, file) {
  const r = spawnSync('git', ['show', `${ref}:cloudflare/${file}`], { cwd: ROOT, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } })
  return r.status === 0 ? r.stdout : null
}

const FILES = ['wrangler.toml', 'wrangler.free.toml']
const base = Object.fromEntries(FILES.map((f) => [f, show(REF, f)]))
const withIdentity = Object.fromEntries(FILES.map((f) => [f, show(REF_IDENTITY, f)]))
if (FILES.some((f) => !base[f])) {
  console.log(`test-client-wrangler-parity-pure: SKIP (commit ${REF} with the baseline config is not in this repository's history)`)
  process.exit(0)
}
if (FILES.some((f) => !withIdentity[f])) {
  console.log(`test-client-wrangler-parity-pure: SKIP (commit ${REF_IDENTITY} with the 6.0.956 config is not in this repository's history)`)
  process.exit(0)
}

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.message ? err.message : err}`)
    process.exitCode = 1
  }
}

const text = (buffer) => buffer.toString('utf8')
const lines = (value) => (Buffer.isBuffer(value) ? text(value) : value).split('\n')

function firstDifference(a, b) {
  const x = lines(a)
  const y = lines(b)
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if (x[i] !== y[i]) return `line ${i + 1}: rendered ${JSON.stringify(x[i])} vs expected ${JSON.stringify(y[i])}`
  }
  return 'no differing line (length or line ending differs)'
}

// Longest-common-subsequence line diff: what a -> b removed and added, in order.
function lineDiff(a, b) {
  const x = lines(a)
  const y = lines(b)
  const lcs = Array.from({ length: x.length + 1 }, () => new Int32Array(y.length + 1))
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  const removed = []
  const added = []
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i += 1; j += 1 } else if (j < y.length && (i === x.length || lcs[i][j + 1] >= lcs[i + 1][j])) { added.push(y[j]); j += 1 } else { removed.push(x[i]); i += 1 }
  }
  return { removed, added }
}

const template = wrangler.template()
const IDENTITY_KEYS = lib.VARIABLES.filter((v) => v.kind === 'identity').map((v) => v.name)
const privateMap = () => new Map(lib.readEnvFile(envFile))
const withoutIdentityMap = () => {
  const map = privateMap()
  for (const key of IDENTITY_KEYS) map.delete(key)
  return map
}
const full = lib.renderFiles(template, lib.resolveValues(privateMap(), { strict: true }), { all: true })
const bare = lib.renderFiles(template, lib.resolveValues(withoutIdentityMap(), { strict: true }), { all: true })
const resolved = lib.resolveValues(privateMap(), { strict: true })
for (const name of IDENTITY_KEYS) assert.ok(resolved[name], `${name} is not in the private client file`)

// The 6.0.956 edits to a baseline file, as the diff must show them. The identity block is the comment that
// introduces the seven variables, the variables in the order the template writes them, and the blank line after.
const VAR_LINES = IDENTITY_KEYS.map((n) => `BUSINESS_OS_${n} = "${resolved[n]}"`)
const reworded = {
  removed: ['# admin-host identity rewrite has to happen before iOS reads those bytes (see', '# src/lib/adminDocumentIdentity.ts). The list mirrors that file\'s'],
  added: ['# identity rewrite has to happen before iOS reads those bytes (see', '# src/lib/documentIdentity.ts). The list mirrors that file\'s'],
}
// The free file repeats the paragraph that says the document-route list is copied from the paid file.
const rewordedFree = {
  removed: ['# what makes the Worker see a page request at all, and the admin-host', '# identity rewrite in src/lib/adminDocumentIdentity.ts has to run on Free'],
  added: ['# what makes the Worker see a page request at all, and the document', '# identity rewrite in src/lib/documentIdentity.ts has to run on Free'],
}
const manifestAdded = ['  # The install manifests carry the configured names (src/lib/clientIdentity.ts).', '  "/manifest.json", "/portal-manifest.json",']

const sorted = (list) => [...list].sort()

for (const file of FILES) {
  const rendered = Buffer.from(full[file], 'utf8')

  check(`${file}: rendered with the identity, byte-identical to ${REF_IDENTITY}:cloudflare/${file}`, () => {
    assert.ok(Buffer.compare(rendered, withIdentity[file]) === 0, `${file} differs from ${REF_IDENTITY} (${rendered.length} vs ${withIdentity[file].length} bytes); first difference at ${firstDifference(rendered, withIdentity[file])}`)
  })

  check(`${file}: ${REF_IDENTITY}'s file is ${REF}'s file plus exactly the 6.0.956 edits, nothing else`, () => {
    const { removed, added } = lineDiff(base[file], withIdentity[file])
    const free = file === 'wrangler.free.toml'
    assert.deepEqual(sorted(removed), sorted([...reworded.removed, ...(free ? rewordedFree.removed : [])]), `${file}: lines the 6.0.956 lane removed`)
    // the added lines: the reworded comments, the manifest routes, and the identity block (its comment and the seven
    // variables, with one blank line to keep a blank line on each side)
    const all = lines(withIdentity[file])
    const first = all.findIndex((l) => l.startsWith('# Who this deployment is'))
    const at = all.findIndex((l) => l === VAR_LINES[0])
    assert.ok(first >= 0 && at > first, `${file}: the identity comment was added above the variables`)
    const block = all.slice(first, at + VAR_LINES.length)
    assert.deepEqual(all.slice(at, at + VAR_LINES.length), VAR_LINES, `${file}: the seven variables sit together in the template's order`)
    assert.ok(block.slice(0, at - first).every((l) => l.startsWith('#')), `${file}: only comment lines above them`)
    assert.equal(all[first - 1], '', `${file}: a blank line above the block`)
    assert.equal(all[at + VAR_LINES.length], '', `${file}: a blank line below the block`)
    assert.deepEqual(sorted(added), sorted([...reworded.added, ...(free ? rewordedFree.added : []), ...manifestAdded, ...block, '']), `${file}: the added lines`)
  })

  check(`${file}: rendered without the identity variables, it is ${REF_IDENTITY}'s file minus the identity block, byte for byte`, () => {
    const all = lines(withIdentity[file])
    const first = all.findIndex((l) => l.startsWith('# Who this deployment is'))
    const last = all.findIndex((l) => l === VAR_LINES[VAR_LINES.length - 1])
    assert.ok(first > 0 && last > first, 'the identity block was found')
    assert.equal(all[first - 1], '', 'a blank line above the block')
    assert.equal(all[last + 1], '', 'a blank line below the block')
    const expected = [...all.slice(0, first), ...all.slice(last + 2)].join('\n')
    assert.equal(bare[file], expected, `${file}: ${firstDifference(bare[file], expected)}`)
  })
}

check('the configuration lines are identical even without the client\'s comment notes (CI renders from GitHub variables, which carry none)', () => {
  const map = privateMap()
  for (const key of [...map.keys()]) if (key.startsWith('NOTE_')) map.delete(key)
  const noNotes = lib.renderFiles(template, lib.resolveValues(map, { strict: true }), { all: true })
  const code = (value) => lines(value).filter((l) => l.trim() && !l.trim().startsWith('#'))
  for (const file of FILES) {
    assert.deepEqual(code(noNotes[file]), code(withIdentity[file]), `${file}: configuration differs once the notes are left out`)
    assert.notEqual(noNotes[file], text(withIdentity[file]), 'the control must differ in comments only')
  }
})

check('POSITIVE CONTROL: changing any one value changes the output, so identity is not by construction', () => {
  for (const [key, change] of [['D1_MAIN_ID', '49795be9-eabe-43f1-8e16-b86faed60cb2'], ['QUEUE_PREFIX', 'business-os-x'], ['ROUTES', 'leangbeauty.com'], ['PLACEMENT_REGION', 'aws:ap-southeast-2'], ['MEMBERSHIP_PREFIX', 'ZZ-']]) {
    const map = privateMap()
    assert.notEqual(map.get(key), change)
    map.set(key, change)
    const other = lib.renderVariant(template, lib.resolveValues(map, { strict: true }), 'paid')
    assert.notEqual(other, full['wrangler.toml'], `${key} has no effect on the output`)
  }
})

check('the identity-less render differs from the baseline in exactly the 6.0.956 non-identity edits (the reworded comments and the two manifest routes)', () => {
  for (const file of FILES) {
    const { removed, added } = lineDiff(base[file], bare[file])
    const free = file === 'wrangler.free.toml'
    assert.deepEqual(sorted(removed), sorted([...reworded.removed, ...(free ? rewordedFree.removed : [])]), `${file}: removed`)
    assert.deepEqual(sorted(added), sorted([...reworded.added, ...(free ? rewordedFree.added : []), ...manifestAdded]), `${file}: added`)
  }
})

console.log(`test-client-wrangler-parity-pure: ${passed} checks passed against ${REF} and ${REF_IDENTITY} using ${path.basename(envFile)}`)
