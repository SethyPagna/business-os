// STORAGE S1 (2026-09-29): ops/scripts/purge-non-media-uploads.mjs still
// named the OLD Europe bucket after the website moved to
// business-os-assets-apac on 27 Sep. A run would have listed and moved files
// in the old bucket -- the owner's spare photo copy, which nothing may write
// (owner, 28 Sep) -- and then removed PRODUCTION Library rows whose files are
// really in the live bucket. Pinned here:
//   - BUCKET is the ASSETS bucket_name of cloudflare/wrangler.toml AND
//     wrangler.free.toml, so the next bucket move fails this test until the
//     script moves with it;
//   - before its first R2 or D1 request (dry run, --move and --restore) the
//     script reads the production Worker's live ASSETS binding and refuses
//     unless every version carrying traffic binds it to BUCKET. The fake API
//     below counts R2 and D1 requests: a refusal must come with ZERO of each,
//     because a check made after the listing would already have read the
//     wrong bucket (an old copy of the script, or a rollback past the move);
//   - an unreadable answer (a token without Workers Scripts Read) refuses
//     with the permission to add -- never a silent pass;
//   - --move and --restore read the binding again after MOVE or RESTORE is
//     typed and refuse, with no R2 or D1 request, if it changed meanwhile;
//   - the owner steps name the live bucket, never the stale business-os-v1
//     folder, and the only mention of the old bucket is the warning never to
//     put a lifecycle rule on it.
// No network, no Cloudflare API, no production state. Every failure is
// listed before the exit code is set; to run against another copy:
//   PURGE_SCRIPT=/tmp/purge.mjs node test-purge-bucket-binding-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const F = require('./harness/upload_fixtures.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const PURGE_SOURCE = process.env.PURGE_SCRIPT || path.join(ROOT, 'ops', 'scripts', 'purge-non-media-uploads.mjs')
const LIVE_BUCKET = 'business-os-assets-apac'
const SPARE_BUCKET = ['business', 'os', 'assets'].join('-')
const TOKEN = ['tok', 'Binding', 'q3Rv8Lm2Wx6Tn1Zc4Pd9Hk7Fs5Gj0Ya'].join('_')
const ACCOUNT = 'fedcba9876543210fedcba9876543210'
const DATABASE = 'fedcba98-7654-3210-fedc-ba9876543210'
const ENV = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, BUSINESS_OS_D1_DATABASE_ID: DATABASE, CLOUDFLARE_API_TOKEN: TOKEN }
const WORKER = `/client/v4/accounts/${ACCOUNT}/workers/scripts/business-os`
const R2_PREFIX = `/client/v4/accounts/${ACCOUNT}/r2/`
const OBJECTS_PATH = `${R2_PREFIX}buckets/${LIVE_BUCKET}/objects/`
const D1_PATH = `/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`
const STAMP = '2026-09-29T01-00-00-000Z'

const failures = []
let checks = 0
const firstLine = (error) => String((error && error.message) || error).split('\n')[0]
function check(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${firstLine(error)}`) }
}

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')
// The same reading test-ops-workflow-pure.cjs uses for the ASSETS binding.
function assetsBucketOf(file) {
  const match = /^\[\[r2_buckets\]\]\nbinding = "ASSETS"\nbucket_name = "([a-z0-9-]+)"$/m.exec(read('cloudflare', file))
  assert.ok(match, `${file}: ASSETS is not a plain r2 binding`)
  return match[1]
}

// ------------------------------------------------------------ fake API
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const denied = () => reply(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] })
const r2Binding = (bucket, extra = {}) => ({ type: 'r2_bucket', name: 'ASSETS', bucket_name: bucket, ...extra })
const version = (id, percentage, bindings) => ({ id, percentage, bindings })

// `live` is what the production Worker's newest deployment carries:
//   { deploymentsStatus } -> the deployments GET answers that status
//   { versions: [{ id, percentage, bindings | status }] }
function fakeApi(live) {
  const world = { requests: [] }
  world.count = (kind) => world.requests.filter((request) => request.kind === kind).length
  world.fetch = async (url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase()
    const headers = new Headers(init.headers || {})
    const { pathname, searchParams } = new URL(url)
    const kind = pathname.startsWith(`${WORKER}/`) ? 'worker' : pathname.startsWith(R2_PREFIX) ? 'r2' : pathname === D1_PATH ? 'd1' : 'other'
    world.requests.push({ kind, method, pathname, prefix: searchParams.get('prefix') })
    if (headers.get('authorization') !== `Bearer ${TOKEN}`) return denied()
    if (kind === 'worker') {
      if (method !== 'GET') return reply(405, { success: false, errors: [{ code: 1, message: 'read only' }] })
      if (pathname === `${WORKER}/deployments`) {
        if (live.deploymentsStatus) return live.deploymentsStatus === 403 ? denied() : reply(live.deploymentsStatus, { success: false, errors: [] })
        return reply(200, {
          success: true,
          result: {
            deployments: [
              { id: 'dep-new', created_on: '2026-09-28T10:00:00Z', versions: live.versions.map((v) => ({ version_id: v.id, percentage: v.percentage })) },
              // An older deployment is not what serves traffic.
              { id: 'dep-old', created_on: '2026-09-20T10:00:00Z', versions: [{ version_id: 'aaaaaaaa-0000-4000-8000-000000000000', percentage: 100 }] },
            ],
          },
        })
      }
      const found = live.versions.find((v) => pathname === `${WORKER}/versions/${v.id}`)
      if (!found) return reply(404, { success: false, errors: [{ code: 10007, message: 'no such version' }] })
      if (found.status) return found.status === 403 ? denied() : reply(found.status, { success: false, errors: [] })
      return reply(200, { success: true, result: { id: found.id, resources: { bindings: found.bindings } } })
    }
    const objects = live.objects || new Map()
    if (kind === 'r2' && method === 'GET' && searchParams.has('prefix')) {
      const listed = [...objects.keys()].filter((key) => key.startsWith(searchParams.get('prefix'))).map((key) => ({ key, size: objects.get(key).length }))
      return reply(200, { success: true, result: listed, result_info: { cursor: '', is_truncated: false } })
    }
    if (kind === 'r2' && pathname.startsWith(OBJECTS_PATH)) {
      const key = pathname.slice(OBJECTS_PATH.length).split('/').map(decodeURIComponent).join('/')
      if (method === 'PUT') { objects.set(key, Uint8Array.from(init.body)); return reply(200, { success: true, result: {} }) }
      if (!objects.has(key)) return reply(404, { success: false, errors: [{ code: 10007, message: 'no such key' }] })
      if (method === 'DELETE') { objects.delete(key); return reply(200, { success: true, result: {} }) }
      const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get('range') || '')
      const bytes = objects.get(key)
      return new Response(range ? bytes.subarray(Number(range[1]), Number(range[2]) + 1) : bytes, { status: range ? 206 : 200 })
    }
    if (kind === 'd1') return reply(200, { success: true, errors: [], messages: [], result: [{ results: [], success: true, meta: {} }] })
    return reply(404, { success: false, errors: [{ code: 7003, message: 'no such route' }] })
  }
  return world
}

let script = null
const homes = []
async function invoke(live, argv) {
  const world = fakeApi(live)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-binding-'))
  homes.push(home)
  let manifestPath = null
  if (argv[0] === '--restore') {
    // A manifest --move would write for BUCKET, with nothing in it.
    manifestPath = path.join(home, 'manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      tool: script.MANIFEST_TOOL, format: script.MANIFEST_FORMAT, bucket: script.BUCKET, mode: 'move', stamp: STAMP,
      quarantinePrefix: script.quarantineKeyFor(STAMP, ''), moves: [], skipped: [], rows: { file_assets: [], import_job_files: [] },
    }))
    argv = ['--restore', manifestPath]
  }
  const lines = []
  const questions = []
  const prompts = {
    hidden: async () => TOKEN,
    visible: async (question) => {
      questions.push(question)
      world.promptAt = world.requests.length
      if (live.onPrompt) live.onPrompt(live)
      return argv[0] === '--restore' ? 'RESTORE' : 'MOVE'
    },
  }
  let code
  try {
    code = await script.run({
      argv, env: { ...ENV }, fetchImpl: world.fetch, prompts, homeDir: home, now: () => new Date('2026-09-29T01:00:00.000Z'),
      out: { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) },
    })
  } catch (error) {
    code = `threw: ${firstLine(error)}`
  }
  const files = []
  const walk = (dir) => { for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name); if (fs.statSync(file).isDirectory()) walk(file); else files.push(path.relative(home, file)) } }
  walk(home)
  return { world, code, text: lines.join('\n'), questions, files: files.filter((file) => file !== 'manifest.json') }
}

const V1 = 'b1b1b1b1-1111-4111-8111-111111111111'
const V2 = 'c2c2c2c2-2222-4222-8222-222222222222'
const LIVE_ON_BUCKET = () => ({ versions: [version(V1, 100, [{ type: 'd1', name: 'DB' }, r2Binding(script.BUCKET)])] })
// Each world the script must refuse, and what the refusal must say.
const REFUSALS = () => [
  ['live on the old bucket', { versions: [version(V1, 100, [r2Binding(SPARE_BUCKET)])] }, /stores its files in business-os-assets[^-]/],
  ['mixed versions, one old and one live', { versions: [version(V1, 10, [r2Binding(SPARE_BUCKET)]), version(V2, 90, [r2Binding(script.BUCKET)])] }, /stores its files in business-os-assets[^-]/],
  ['mixed versions, the old one second', { versions: [version(V2, 90, [r2Binding(script.BUCKET)]), version(V1, 10, [r2Binding(SPARE_BUCKET)])] }, /stores its files in business-os-assets[^-]/],
  ['deployments GET 403', { deploymentsStatus: 403 }, /Account \| Workers Scripts \| Read/],
  ['deployments GET 500', { deploymentsStatus: 500 }, /Account \| Workers Scripts \| Read/],
  ['version GET 403', { versions: [version(V1, 100, null)].map((v) => ({ ...v, status: 403 })) }, /Account \| Workers Scripts \| Read/],
  ['the live bucket name under a jurisdiction', { versions: [version(V1, 100, [r2Binding(script.BUCKET, { jurisdiction: 'eu' })])] }, /jurisdiction eu/],
  ['no ASSETS binding', { versions: [version(V1, 100, [{ type: 'd1', name: 'DB' }])] }, /ASSETS/],
  ['ASSETS is not an R2 bucket', { versions: [version(V1, 100, [{ type: 'kv_namespace', name: 'ASSETS', namespace_id: 'x' }])] }, /ASSETS/],
  ['two ASSETS bindings', { versions: [version(V1, 100, [r2Binding(script.BUCKET), r2Binding(SPARE_BUCKET)])] }, /ASSETS/],
]
const MODES = [['dry run', []], ['--move', ['--move']], ['--restore', ['--restore']]]

async function main() {
  try {
    script = { ...(await import(pathToFileURL(PURGE_SOURCE).href)) }
  } catch (error) {
    failures.push(`load the purge script: ${firstLine(error)}`)
    script = {}
  }
  if (typeof script.run !== 'function') script.run = async () => { throw new Error('the script has no run()') }

  // ------------------------------------------------ 1. the bucket pin
  check('BUCKET is the live bucket business-os-assets-apac', () => assert.equal(script.BUCKET, LIVE_BUCKET))
  check('BUCKET is the ASSETS bucket of cloudflare/wrangler.toml', () => assert.equal(script.BUCKET, assetsBucketOf('wrangler.toml')))
  check('BUCKET is the ASSETS bucket of cloudflare/wrangler.free.toml', () => assert.equal(script.BUCKET, assetsBucketOf('wrangler.free.toml')))

  // ----------------------------------- 2. live binding = BUCKET: proceeds
  for (const [mode, argv] of MODES) {
    const result = await invoke(LIVE_ON_BUCKET(), argv)
    const label = `live on BUCKET, ${mode}`
    check(`${label}: exits 0`, () => assert.equal(result.code, 0, result.text))
    check(`${label}: read the live binding first, with the token`, () => {
      assert.deepEqual(result.world.requests.slice(0, 2).map((request) => request.pathname), [`${WORKER}/deployments`, `${WORKER}/versions/${V1}`])
      assert.equal(result.world.requests.filter((request) => request.kind === 'worker' && request.method !== 'GET').length, 0, 'a Worker write')
    })
    check(`${label}: goes on to list BUCKET, and only BUCKET`, () => {
      const lists = result.world.requests.filter((request) => request.kind === 'r2')
      assert.ok(lists.length > 0, 'no R2 listing')
      for (const request of lists) assert.ok(request.pathname.startsWith(`${R2_PREFIX}buckets/${LIVE_BUCKET}/objects`), request.pathname)
    })
    if (mode !== '--restore') {
      check(`${label}: reads the database`, () => assert.ok(result.world.count('d1') > 0))
      check(`${label}: listing.json names BUCKET`, () => {
        const listing = result.files.find((file) => path.basename(file) === 'listing.json')
        assert.ok(listing, `files: ${result.files}`)
        assert.equal(JSON.parse(fs.readFileSync(path.join(homes[homes.length - 1], listing), 'utf8')).bucket, LIVE_BUCKET)
      })
    }
  }

  // -------------------- 3. anything else: refused before any R2/D1 request
  for (const [name, live, message] of REFUSALS()) {
    for (const [mode, argv] of MODES) {
      const result = await invoke(live, argv)
      const label = `${name}, ${mode}`
      check(`${label}: exits 1 with FAILED`, () => { assert.equal(result.code, 1, result.text); assert.match(result.text, /FAILED/) })
      check(`${label}: says why`, () => assert.match(result.text, message))
      check(`${label}: ZERO R2 requests`, () => assert.equal(result.world.count('r2'), 0, JSON.stringify(result.world.requests.filter((request) => request.kind === 'r2').slice(0, 3))))
      check(`${label}: ZERO D1 requests`, () => assert.equal(result.world.count('d1'), 0))
      check(`${label}: nothing but the binding read`, () => assert.deepEqual(result.world.requests.filter((request) => request.kind !== 'worker'), []))
      check(`${label}: asked nothing and wrote nothing`, () => { assert.deepEqual(result.questions, []); assert.deepEqual(result.files, []) })
      check(`${label}: the token is not printed`, () => assert.ok(!result.text.includes(TOKEN)))
    }
  }

  const withDocument = (live) => ({ ...live, objects: new Map([['uploads/invoice.pdf', F.pdf()]]) })
  const unchanged = await invoke(withDocument(LIVE_ON_BUCKET()), ['--move'])
  check('binding unchanged at MOVE: the document is moved', () => {
    assert.equal(unchanged.code, 0, unchanged.text)
    assert.ok(unchanged.world.requests.some((request) => request.kind === 'r2' && request.method === 'PUT'), 'no quarantine copy was written')
  })
  const CHANGES_AT_PROMPT = [
    ['rolled back to the old bucket', (live) => { live.versions = [version(V2, 100, [r2Binding(SPARE_BUCKET)])] }, /stores its files in business-os-assets[^-]/],
    ['a new deployment sends 10% to the old bucket', (live) => { live.versions = [version(V1, 90, [r2Binding(script.BUCKET)]), version(V2, 10, [r2Binding(SPARE_BUCKET)])] }, /stores its files in business-os-assets[^-]/],
    ['the binding became unreadable', (live) => { live.deploymentsStatus = 403 }, /Account \| Workers Scripts \| Read/],
  ]
  for (const [name, change, message] of CHANGES_AT_PROMPT) {
    for (const [mode, argv] of MODES.filter(([, args]) => args.length)) {
      const result = await invoke({ ...withDocument(LIVE_ON_BUCKET()), onPrompt: change }, argv)
      const afterPrompt = result.world.requests.slice(result.world.promptAt ?? result.world.requests.length)
      const label = `${name} while ${mode} waited`
      check(`${label}: the prompt was reached`, () => assert.equal(result.questions.length, 1, result.text))
      check(`${label}: exits 1 with FAILED and says why`, () => { assert.equal(result.code, 1, result.text); assert.match(result.text, /FAILED/); assert.match(result.text, message) })
      check(`${label}: read the binding again after the prompt`, () => assert.ok(afterPrompt.some((request) => request.kind === 'worker')))
      check(`${label}: no R2 or D1 request after the prompt`, () => assert.deepEqual(afterPrompt.filter((request) => request.kind === 'r2' || request.kind === 'd1'), []))
      check(`${label}: nothing written or deleted`, () => assert.deepEqual(result.world.requests.filter((request) => request.method === 'PUT' || request.method === 'DELETE'), []))
      check(`${label}: no manifest.json`, () => assert.ok(!result.files.some((file) => path.basename(file) === 'manifest.json'), result.files.join(', ')))
      check(`${label}: the token is not printed`, () => assert.ok(!result.text.includes(TOKEN)))
    }
  }

  // ------------------------------------------ 4. the owner instructions
  let source = ''
  try { source = fs.readFileSync(PURGE_SOURCE, 'utf8').replace(/\r\n/g, '\n') } catch (error) { failures.push(`read the purge script: ${firstLine(error)}`) }
  const lines = source.split('\n')
  check('no line names the stale business-os-v1 folder', () => assert.deepEqual(lines.filter((line) => line.includes('business-os-v1')), []))
  check('the old bucket is named exactly once: the warning never to add a lifecycle rule on it', () => {
    const mentions = lines.filter((line) => /business-os-assets(?!-apac)/.test(line))
    assert.equal(mentions.length, 1, mentions.join(' | '))
    assert.equal([...source.matchAll(/business-os-assets(?!-apac)/g)].length, 1)
    assert.match(mentions[0], /Never add a rule on business-os-assets \(the spare photo copy\)/)
  })
  check('step 1 adds the Workers Scripts Read row to the token', () => assert.match(source, /^\/\/ +Account \| Workers Scripts +\| Read$/m))
  check('step 2 is a fresh pull of main in the BusinessOS checkout', () => assert.match(source, /BusinessOS checkout[\s\S]{0,400}git pull/))
  check('the lifecycle step names the live bucket', () => {
    const start = source.indexOf('Deleting the quarantine for good')
    assert.ok(start > 0, 'no lifecycle step')
    assert.match(source.slice(start, start + 900), /R2 >\s*(?:\/\/\s*)?business-os-assets-apac > Settings > Object lifecycle rules/)
  })
  check('--help says it checks the live bucket first', () => assert.match(String(script.HELP || ''), /live website[\s\S]{0,200}business-os-assets-apac/))

  for (const home of homes) fs.rmSync(home, { recursive: true, force: true })
  if (failures.length) {
    for (const failure of failures.slice(0, 60)) console.error(`FAIL ${failure}`)
    if (failures.length > 60) console.error(`...and ${failures.length - 60} more`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: BUCKET is the ASSETS bucket of both wrangler files; the live binding is read before any R2 or D1 request in dry run, --move and --restore, and anything but every live version on BUCKET is refused with zero R2 and D1 requests; a change while MOVE or RESTORE waits is refused before any change; the owner steps name the live bucket and never the old one or business-os-v1`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
