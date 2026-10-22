// Parity: the template, rendered with a client's real values, must reproduce
// that client's last committed Worker config BYTE FOR BYTE. Moving a client's
// configuration out of the tree must not change what is deployed.
//
// The real values are private and live outside this repository, so this test
// only runs where that file exists:
//
//   CLIENT_PARITY_ENV_FILE   path of the dotenv file (default: the first of
//                            ../../Records/Clients/leang.env and
//                            ../Records/Clients/leang.env relative to the checkout)
//   CLIENT_PARITY_REF        the commit holding the baseline wrangler.toml and
//                            wrangler.free.toml (default 95dd89f15, the last
//                            commit that tracked them)
//
// The file also holds the shop identity (lane 6.0.956: seven optional [vars] and
// the two manifest routes). 95dd89f15 predates them, so the byte-for-byte check
// renders WITHOUT them; a second check renders WITH them and expects the same
// file plus exactly those seven lines and two route entries.
//
// Without the file (CI, a fresh clone) it prints SKIP and passes. With the
// file present and the baseline readable it must be identical, or it fails.
//
// Run: node scripts/test-client-wrangler-parity-pure.cjs
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const wrangler = require('./harness/rendered_wrangler.cjs')

const { lib, ROOT } = wrangler
const REF = process.env.CLIENT_PARITY_REF || '95dd89f15'
const envFile = wrangler.clientEnvFile()

if (!envFile) {
  console.log('test-client-wrangler-parity-pure: SKIP (no client env file: set CLIENT_PARITY_ENV_FILE, or keep it at Records/Clients/leang.env)')
  process.exit(0)
}

function baseline(file) {
  const r = spawnSync('git', ['show', `${REF}:cloudflare/${file}`], { cwd: ROOT, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } })
  return r.status === 0 ? r.stdout : null
}

const basePaid = baseline('wrangler.toml')
const baseFree = baseline('wrangler.free.toml')
if (!basePaid || !baseFree) {
  console.log(`test-client-wrangler-parity-pure: SKIP (commit ${REF} with the baseline config is not in this repository's history)`)
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

function firstDifference(a, b) {
  const x = a.toString('utf8').split('\n')
  const y = b.toString('utf8').split('\n')
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if (x[i] !== y[i]) return `line ${i + 1}: rendered ${JSON.stringify(x[i])} vs baseline ${JSON.stringify(y[i])}`
  }
  return 'no differing line (length or line ending differs)'
}

const template = wrangler.template()
const IDENTITY_KEYS = lib.VARIABLES.filter((v) => v.kind === 'identity').map((v) => v.name)
// The private file as it was when 95dd89f15 was deployed: no shop identity, no manifest switch.
const privateMap = () => {
  const map = new Map(lib.readEnvFile(envFile))
  for (const key of IDENTITY_KEYS) map.delete(key)
  return map
}
const values = lib.resolveValues(privateMap(), { strict: true })
const files = lib.renderFiles(template, values, { all: true })

for (const [name, base] of [['wrangler.toml', basePaid], ['wrangler.free.toml', baseFree]]) {
  check(`${name}: byte-identical to ${REF}:cloudflare/${name}`, () => {
    const rendered = Buffer.from(files[name], 'utf8')
    assert.ok(Buffer.compare(rendered, base) === 0, `${name} differs from ${REF} (${rendered.length} vs ${base.length} bytes); first difference at ${firstDifference(rendered, base)}`)
  })
}

check('the configuration lines are identical even without the client\'s comment notes (CI renders from GitHub variables, which carry none)', () => {
  const bare = privateMap()
  for (const key of [...bare.keys()]) if (key.startsWith('NOTE_')) bare.delete(key)
  const noNotes = lib.renderFiles(template, lib.resolveValues(bare, { strict: true }), { all: true })
  const code = (text) => text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
  for (const [name, base] of [['wrangler.toml', basePaid], ['wrangler.free.toml', baseFree]]) {
    assert.deepEqual(code(noNotes[name]), code(base.toString('utf8')), `${name}: configuration differs once the notes are left out`)
    assert.notEqual(noNotes[name], base.toString('utf8'), 'the control must differ in comments only')
  }
})

check('POSITIVE CONTROL: changing any one value changes the output, so identity is not by construction', () => {
  for (const [key, change] of [['D1_MAIN_ID', '49795be9-eabe-43f1-8e16-b86faed60cb2'], ['QUEUE_PREFIX', 'business-os-x'], ['ROUTES', 'leangbeauty.com'], ['PLACEMENT_REGION', 'aws:ap-southeast-2']]) {
    const map = privateMap()
    assert.notEqual(map.get(key), change)
    map.set(key, change)
    const other = lib.renderVariant(template, lib.resolveValues(map, { strict: true }), 'paid')
    assert.notEqual(other, files['wrangler.toml'], `${key} has no effect on the output`)
  }
})

check('with the shop identity and the manifest routes on, the render is 95dd89f15\'s file plus exactly the seven [vars] lines and the two run_worker_first entries (and the comment that explains them)', () => {
  const map = new Map(lib.readEnvFile(envFile))
  const identityNames = ['SHOP_NAME', 'SHOP_NAME_KM', 'SHOP_ALIAS', 'SHOP_CATEGORY', 'SHOP_ICON_PREFIX', 'ADMIN_SHORT_NAME', 'MEMBERSHIP_PREFIX']
  for (const name of identityNames) assert.ok(map.get(name), `${name} is not in the private client file`)
  map.set('MANIFEST_ROUTES', 'true')
  const resolved = lib.resolveValues(map, { strict: true })
  const full = lib.renderFiles(template, resolved, { all: true })
  const code = (text) => text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
  const comments = (text) => text.split('\n').filter((l) => l.trim().startsWith('#'))
  for (const [name, base] of [['wrangler.toml', basePaid], ['wrangler.free.toml', baseFree]]) {
    const baseCode = code(base.toString('utf8'))
    const expected = []
    for (const line of baseCode) {
      expected.push(line)
      if (line.startsWith('BUSINESS_OS_ORGANIZATION_NAME = ')) for (const n of identityNames) expected.push(`BUSINESS_OS_${n} = "${resolved[n]}"`)
      if (line.endsWith('"/sitemap.xml",')) expected.push('  "/manifest.json", "/portal-manifest.json",')
    }
    assert.deepEqual(code(full[name]), expected, `${name}: not the baseline plus the seven vars and the two routes`)
    assert.equal(expected.length, baseCode.length + 8, "seven vars and one line holding the two routes")
    // only comments were added besides: every baseline comment line survives, in order
    const baseComments = comments(base.toString('utf8'))
    const fullComments = comments(full[name])
    let at = 0
    const added = []
    for (const line of fullComments) {
      if (at < baseComments.length && line === baseComments[at]) at += 1
      else added.push(line)
    }
    assert.equal(at, baseComments.length, `${name}: a baseline comment line went missing`)
    assert.ok(added.length > 0 && added[0].startsWith('# Client identity'), `${name}: the added comments are the identity block (got ${added[0]})`)
  }
  // and the manifest routes are a separate switch: the identity alone adds the seven lines but not the routes
  const without = lib.renderFiles(template, lib.resolveValues(new Map([...map].map(([k, v]) => [k, k === 'MANIFEST_ROUTES' ? 'false' : v])), { strict: true }), { all: true })
  assert.ok(!without['wrangler.toml'].includes('"/manifest.json"') && without['wrangler.toml'].includes('BUSINESS_OS_MEMBERSHIP_PREFIX = "'))
})

console.log(`test-client-wrangler-parity-pure: ${passed} checks passed against ${REF} using ${path.basename(envFile)}`)
