// Parity for BM Shop, the second client: cloudflare/wrangler.template.toml rendered with BM's own values must
// reproduce the Worker config BM is deployed from (branch claude/bmshop-20261022, clients/bmshop/wrangler.toml,
// at the commit the live deploy was made from), line for line, except for the differences listed below -- each
// one intended, each with its reason.
//
// BM's values (account, database and KV ids) are private and live outside this repository, and so does the copy
// of its files; the test only runs where they exist:
//
//   BM_PARITY_ENV_FILE   the dotenv file (default: Records/Clients/bmshop.env next to the checkout)
//   BM_PARITY_DIR        BM's files: wrangler.toml and admin-forwarder/wrangler.toml
//                        (default: Records/Clients/bmshop/)
//
// Without them (CI, a fresh clone) it prints SKIP and passes.
//
// The intended differences, in the code lines (comments are BM's own story and are not compared):
//   1. main, directory, migrations_dir x2: BM's file sits in clients/bmshop/ and reaches the code through ../../;
//      the rendered file sits in cloudflare/ like every client's. Same targets.
//   2. Analytics Engine: BM's file declares an Analytics Engine dataset, but the account has not enabled
//      Analytics Engine (deploy error 10089) so the live Worker is deployed without the binding. The live values
//      say ANALYTICS_DATASET=none, the second check turns it back on and then there is no difference at all.
//   3. Order inside [vars]: BM's file lists the Drive client before the e-mail sender, the template the other way
//      round. TOML tables are unordered, so the entries are compared sorted.
//   4. The admin forwarder: BM's calls its service binding BMSHOP, the template calls it TARGET (index.ts reads
//      TARGET). Everything else is equal.
//
// Run: node scripts/test-client-bm-parity-pure.cjs
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const wrangler = require('./harness/rendered_wrangler.cjs')

const { lib, ROOT } = wrangler
const recordsDir = [
  process.env.BM_PARITY_DIR,
  path.join(ROOT, '..', '..', 'Records', 'Clients', 'bmshop'),
  path.join(ROOT, '..', 'Records', 'Clients', 'bmshop'),
].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'wrangler.toml')))
const envFile = [
  process.env.BM_PARITY_ENV_FILE,
  path.join(ROOT, '..', '..', 'Records', 'Clients', 'bmshop.env'),
  path.join(ROOT, '..', 'Records', 'Clients', 'bmshop.env'),
].filter(Boolean).find((f) => fs.existsSync(f))

if (!recordsDir || !envFile) {
  console.log('test-client-bm-parity-pure: SKIP (no BM files: set BM_PARITY_ENV_FILE and BM_PARITY_DIR, or keep them at Records/Clients/bmshop.env and Records/Clients/bmshop/)')
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

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n')
const code = (text) => text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
// Difference 1: where BM's file sits.
const fromBmLocation = (line) => line.replace('../../cloudflare/', '').replace('../../frontend/', '../frontend/')
// Difference 3: the entries of [vars] in a fixed order.
const sortVars = (lines) => {
  const from = lines.indexOf('[vars]')
  const to = lines.indexOf('[observability]')
  assert.ok(from > 0 && to > from, 'a [vars] table followed by [observability]')
  return [...lines.slice(0, from + 1), ...lines.slice(from + 1, to).sort(), ...lines.slice(to)]
}

const bmMain = read(recordsDir, 'wrangler.toml')
const template = wrangler.template()
const privateMap = () => new Map(lib.readEnvFile(envFile))
const render = (overrides = {}, files = {}) => {
  const map = privateMap()
  for (const [k, v] of Object.entries(overrides)) map.set(k, v)
  const forwarderTemplate = fs.readFileSync(path.join(ROOT, 'cloudflare', 'admin-forwarder', 'wrangler.template.toml'), 'utf8')
  return lib.renderFiles(template, lib.resolveValues(map, { strict: true }), { all: true, forwarderTemplate, ...files })
}

// No client name or address is written in this file: every one comes from the private files being checked.
const bmValues = lib.resolveValues(privateMap(), { strict: true })
const bmDataset = (bmMain.match(/^dataset = "([^"]+)"$/m) || [])[1]
assert.ok(bmDataset, 'BM\'s file declares an Analytics Engine dataset')
const ANALYTICS = ['[[analytics_engine_datasets]]', 'binding = "Business_OS_Analytics"', `dataset = "${bmDataset}"`]
// The owner's scheme: <client>-admin.<subdomain>.workers.dev for staff, next to <client>.<subdomain>.workers.dev.
const movedAdmin = `https://${bmValues.WORKER_NAME}-admin.${new URL(bmValues.ADMIN_URL).hostname.split('.').slice(1).join('.')}`

check('BM is on the Free plan: the free file is its file, with no [limits], media batch size 1 and PLAN_TIER free', () => {
  const free = render()['wrangler.free.toml']
  assert.match(free, /^PLAN_TIER = "free"$/m)
  assert.ok(!code(free).includes('[limits]') && !code(free).some((l) => l.startsWith('cpu_ms')))
  const lines = code(free)
  const at = lines.findIndex((l, k) => l === 'queue = "business-os-media"' && lines[k - 1] === '[[queues.consumers]]')
  assert.ok(at > 0 && lines[at + 1] === 'max_batch_size = 1', 'the media consumer takes one message per batch')
  assert.match(bmMain, /^PLAN_TIER = "free"$/m)
})

check('the free render is BM\'s file line for line, except where its file sits (1), the Analytics Engine block it cannot deploy (2) and the order of [vars] (3)', () => {
  const rendered = sortVars(code(render()['wrangler.free.toml']))
  const bm = sortVars(code(bmMain).map(fromBmLocation))
  const withoutAnalytics = bm.filter((l) => !ANALYTICS.includes(l))
  assert.equal(bm.length - withoutAnalytics.length, 3, 'BM\'s file declares the dataset')
  assert.deepEqual(rendered, withoutAnalytics)
})

check('with Analytics Engine switched on the free render is BM\'s file with nothing else different (differences 1 and 3 only)', () => {
  const rendered = sortVars(code(render({ ANALYTICS_DATASET: bmDataset })['wrangler.free.toml']))
  assert.deepEqual(rendered, sortVars(code(bmMain).map(fromBmLocation)))
})

check('every key BM\'s file uses is covered by the template: the only line the template leaves out is the one the code skips without it', () => {
  // the template renders everything BM has (checked above); what the template adds beyond BM is what BM turned off
  const rendered = new Set(code(render({ ANALYTICS_DATASET: bmDataset })['wrangler.free.toml']))
  const missing = code(bmMain).map(fromBmLocation).filter((l) => !rendered.has(l))
  assert.deepEqual(missing, [])
  // BM's vars include the identity and the Drive client, and no Sentry, no Google sign-in
  for (const needle of [`BUSINESS_OS_SHOP_NAME = "${bmValues.SHOP_NAME}"`, `BUSINESS_OS_MEMBERSHIP_PREFIX = "${bmValues.MEMBERSHIP_PREFIX}"`, `BUSINESS_OS_PUBLIC_URL = "${bmValues.PUBLIC_URL}"`, `BUSINESS_OS_ORGANIZATION_SLUG = "${bmValues.ORG_SLUG}"`, `BUSINESS_OS_ORGANIZATION_NAME = "${bmValues.ORG_NAME}"`]) {
    assert.ok(rendered.has(needle), needle)
  }
  assert.ok(![...rendered].some((l) => l.startsWith('SENTRY_DSN') || l.startsWith('GOOGLE_LOGIN')), 'Sentry and Google sign-in are left out, not empty')
  // the manifests stay static until the code that serves them is deployed
  assert.ok(![...rendered].some((l) => l.includes('/manifest.json')))
})

check('queue names are exactly the ones the deployed code dispatches on', () => {
  const free = render()['wrangler.free.toml']
  for (const name of ['business-os-import', 'business-os-import-dlq', 'business-os-media', 'business-os-backup-assets']) assert.ok(free.includes(`"${name}"`), name)
  assert.equal(wrangler.lib.resolveValues(privateMap(), { strict: true }).QUEUE_PREFIX, 'business-os')
})

check('the admin forwarder renders as BM\'s does, with the binding named TARGET (difference 4)', () => {
  const forwarderFile = path.join(recordsDir, 'admin-forwarder', 'wrangler.toml')
  if (!fs.existsSync(forwarderFile)) { console.log('note: no admin-forwarder copy in the BM files'); return }
  const live = code(read(forwarderFile))
  const rendered = code(render({ FORWARDER_NAME: 'admin' })[lib.FORWARDER_FILE])
  assert.deepEqual(rendered, live.map((l) => l.replace('binding = "BMSHOP"', 'binding = "TARGET"')))
})

check('the owner\'s URL scheme: <client>-admin is a variable change, not a code change (forwarder name, ADMIN_URL and the Drive redirect)', () => {
  const callback = `${movedAdmin}/api/system/drive-sync/oauth/callback`
  const files = render({
    ADMIN_URL: movedAdmin,
    GOOGLE_DRIVE_REDIRECT_URI: callback,
    FORWARDER_NAME: `${bmValues.WORKER_NAME}-admin`,
  })
  const free = files['wrangler.free.toml']
  assert.ok(free.split('\n').includes(`BUSINESS_OS_ADMIN_URL = "${movedAdmin}"`))
  assert.ok(free.split('\n').includes(`GOOGLE_DRIVE_REDIRECT_URI = "${callback}"`))
  const forwarder = files[lib.FORWARDER_FILE]
  assert.ok(forwarder.split('\n').includes(`name = "${bmValues.WORKER_NAME}-admin"`))
  assert.ok(forwarder.split('\n').includes(`service = "${bmValues.WORKER_NAME}"`))
  assert.match(forwarder, /^account_id = "[0-9a-f]{32}"$/m)
  assert.notEqual(files['wrangler.free.toml'], render()['wrangler.free.toml'])
})

check('POSITIVE CONTROL: BM\'s ids land in BM\'s file and nowhere else, and changing one changes the render', () => {
  const text = render()['wrangler.free.toml']
  for (const key of ['CF_ACCOUNT_ID', 'D1_MAIN_ID', 'D1_IMPORT_ID', 'KV_CACHE_ID']) assert.ok(text.includes(bmValues[key]), key)
  const other = render({ D1_MAIN_ID: '00000000-0000-4000-8000-0000000000aa' })['wrangler.free.toml']
  assert.notDeepEqual(code(other), code(text))
  // and none of Leang's values is in BM's render
  const leang = wrangler.clientEnvFile()
  if (leang) {
    const leangValues = lib.resolveValues(new Map(lib.readEnvFile(leang)), { strict: true })
    for (const key of ['CF_ACCOUNT_ID', 'D1_MAIN_ID', 'D1_IMPORT_ID', 'KV_CACHE_ID']) assert.ok(!text.includes(leangValues[key]), `${key} of Leang appears in BM's render`)
  }
})

console.log(`test-client-bm-parity-pure: ${passed} checks passed using ${path.basename(envFile)} and ${recordsDir.replace(/\\/g, '/').split('/').slice(-2).join('/')}`)
