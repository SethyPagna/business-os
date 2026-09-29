// fetch resolves '.' and '..' URL path segments, so a stored or manifest key
// such as uploads/../../../<bucket>/objects/<key> reaches another bucket of
// ops/scripts/purge-non-media-uploads.mjs's account. The fake API below routes
// every request by the URL fetch really sends and records it; each request
// must address one object of the live bucket by a key the script may use.
// PURGE_SCRIPT=<copy> runs it against another copy of the script.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const F = require('./harness/upload_fixtures.cjs')

const PURGE_SOURCE = process.env.PURGE_SCRIPT || path.resolve(__dirname, '../../ops/scripts/purge-non-media-uploads.mjs')
const LIVE_BUCKET = 'business-os-assets-apac'
const SPARE_BUCKET = ['business', 'os', 'assets'].join('-')
const TOKEN = ['tok', 'Traversal', 'k8Vd3Qm6Zr1Wx9Lp4Tn7Hb2Fg5Jc0Ys'].join('_')
const ACCOUNT = 'abcdefabcdefabcdefabcdefabcdef01'
const DATABASE = 'abcdefab-cdef-4bcd-8fab-cdefabcdef01'
const ENV = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, BUSINESS_OS_D1_DATABASE_ID: DATABASE, CLOUDFLARE_API_TOKEN: TOKEN }
const ORIGIN = 'https://api.cloudflare.com'
const ACCOUNT_PATH = `/client/v4/accounts/${ACCOUNT}`
const WORKER = `${ACCOUNT_PATH}/workers/scripts/business-os`
const LIVE_VERSION = 'e5e5e5e5-5555-4555-8555-555555555555'
const OBJECT_ROUTE = new RegExp(`^${ACCOUNT_PATH}/r2/buckets/([^/]+)/objects(?:/(.*))?$`)
const CLOCK = new Date('2026-09-29T02:00:00.000Z')
const STAMP = '2026-09-29T02-00-00-000Z'
const SPARE_TARGET = 'uploads/owner-photo.pdf'

const SAFE_OBJECTS = [
  ['uploads/invoice.pdf', F.pdf()],
  ['uploads/photo.png', F.png()],
  ['uploads/v1..2 final.pdf', F.pdf()],
  ['uploads/.hidden.pdf', F.pdf()],
  ['uploads/Khmer ឯកសារ #1 100%+?.pdf', F.pdf()],
  ['private/library/a%2Gb%zz.pdf', F.pdf()],
  ['imports/done-job/incoming/items.csv', F.enc('sku,qty\nA1,3\n')],
]
const SAFE_KEYS = SAFE_OBJECTS.map(([key]) => key)
const UNSAFE_KEYS = [
  `uploads/../../../${SPARE_BUCKET}/objects/${SPARE_TARGET}`,
  `imports/job/incoming/../../../../../${SPARE_BUCKET}/objects/${SPARE_TARGET}`,
  'uploads/../backups/cloudflare/state.pdf',
  'uploads/./evil.pdf',
  'uploads/..',
  'uploads/.',
  'uploads//evil.pdf',
  'uploads/evil.pdf/',
  'uploads/',
  `uploads/..\\..\\..\\${SPARE_BUCKET}\\objects\\uploads\\owner-photo.pdf`,
  'uploads/a\\b.pdf',
  `uploads/%2e%2e/%2e%2e/%2e%2e/${SPARE_BUCKET}/objects/${SPARE_TARGET}`,
  'uploads/%2E%2E/evil.pdf',
  'uploads/.%2e/evil.pdf',
  'uploads/%2e./evil.pdf',
  'uploads/%2e/evil.pdf',
  `uploads/..%2f..%2f..%2f${SPARE_BUCKET}%2fobjects%2fuploads%2fowner-photo.pdf`,
  'uploads/%2F..%2Fevil.pdf',
  'uploads/%5c..%5cevil.pdf',
  'uploads/%5C..%5Cevil.pdf',
  'uploads/%252e%252e/evil.pdf',
  'uploads/%25252E%25252E/evil.pdf',
  'uploads/%252F..%252Fevil.pdf',
  'uploads/.\t./evil.pdf',
  'uploads/..\n/evil.pdf',
  'uploads/evil\r.pdf',
  'uploads/evil\u0000.pdf',
  'uploads/evil\u001b.pdf',
  'uploads/evil\u007f.pdf',
  'uploads/evil\u0085.pdf',
]

const failures = []
let checks = 0
const firstLine = (error) => String((error && error.message) || error).split('\n')[0]
function check(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${firstLine(error)}`) }
}
const shown = (key) => JSON.stringify(key).replace(/[\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const NOT_FOUND = { success: false, errors: [{ code: 10007, message: 'The specified key does not exist.' }] }
const bucketState = (store) => [...store.entries()].map(([key, bytes]) => [key, sha(bytes)]).sort()

function makeWorld(liveObjects) {
  const buckets = new Map([[LIVE_BUCKET, new Map(liveObjects)], [SPARE_BUCKET, new Map([[SPARE_TARGET, F.pdf()]])]])
  const world = { buckets, requests: [], spareBefore: bucketState(buckets.get(SPARE_BUCKET)) }
  world.fetch = async (url, init = {}) => {
    const sent = String(url)
    const method = String(init.method || 'GET').toUpperCase()
    const headers = new Headers(init.headers || {})
    const parsed = new URL(sent)
    const route = OBJECT_ROUTE.exec(parsed.pathname)
    const request = { method, sent, pathname: parsed.pathname, bucket: route ? route[1] : null, key: null }
    if (route && route[2] !== undefined) request.key = route[2].split('/').map(decodeURIComponent).join('/')
    world.requests.push(request)
    if (headers.get('authorization') !== `Bearer ${TOKEN}`) return reply(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] })
    if (parsed.pathname === `${WORKER}/deployments`) {
      return reply(200, { success: true, result: { deployments: [{ id: 'dep-1', created_on: '2026-09-28T00:00:00Z', versions: [{ version_id: LIVE_VERSION, percentage: 100 }] }] } })
    }
    if (parsed.pathname === `${WORKER}/versions/${LIVE_VERSION}`) {
      return reply(200, { success: true, result: { id: LIVE_VERSION, resources: { bindings: [{ type: 'r2_bucket', name: 'ASSETS', bucket_name: LIVE_BUCKET }] } } })
    }
    if (parsed.pathname === `${ACCOUNT_PATH}/d1/database/${DATABASE}/query`) return reply(200, { success: true, errors: [], messages: [], result: [{ results: [], success: true, meta: {} }] })
    const store = route && buckets.get(route[1])
    if (!store) return reply(404, { success: false, errors: [{ code: 7003, message: 'no such route' }] })
    if (request.key === null) {
      const prefix = parsed.searchParams.get('prefix') || ''
      const result = [...store.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key, size: store.get(key).length, etag: sha(store.get(key)).slice(0, 32) }))
      return reply(200, { success: true, result, result_info: { cursor: '', is_truncated: false } })
    }
    const object = store.get(request.key)
    if (method === 'GET') {
      if (!object) return reply(404, NOT_FOUND)
      const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get('range') || '')
      const data = range ? object.subarray(Number(range[1]), Number(range[2]) + 1) : object
      return new Response(data, { status: range ? 206 : 200, headers: { 'content-type': 'application/octet-stream' } })
    }
    if (method === 'PUT') {
      store.set(request.key, Uint8Array.from(init.body))
      return reply(200, { success: true, result: { key: request.key } })
    }
    if (method === 'DELETE') {
      if (!store.delete(request.key)) return reply(404, NOT_FOUND)
      return reply(200, { success: true, result: {} })
    }
    return reply(405, { success: false, errors: [{ code: 1, message: 'method' }] })
  }
  return world
}

let script = null
const homes = []
async function invoke(world, argv, answer) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-traversal-'))
  homes.push(home)
  const resolved = argv.map((arg) => (typeof arg === 'function' ? arg(home) : arg))
  const lines = []
  let code
  try {
    code = await script.run({
      argv: resolved, env: { ...ENV }, fetchImpl: world.fetch, homeDir: home, now: () => CLOCK, concurrency: 2,
      prompts: { hidden: async () => TOKEN, visible: async () => answer },
      out: { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) },
    })
  } catch (error) {
    code = `threw: ${firstLine(error)}`
  }
  return { code, text: lines.join('\n'), home }
}

// Every request the run made: none reaches another bucket, none has a path
// fetch rewrote, and every object request is for a key the script may use.
function expectOnlyLiveObjects(label, world, allowedKey) {
  check(`${label}: no request reaches the spare bucket or any bucket but the live one`, () => {
    const elsewhere = world.requests.filter((request) => request.bucket !== null && request.bucket !== LIVE_BUCKET)
    assert.deepEqual(elsewhere.map((request) => `${request.method} ${request.pathname}`), [])
  })
  check(`${label}: fetch sent every URL exactly as the script built it (no '.' or '..' resolved)`, () => {
    const rewritten = world.requests.filter((request) => request.sent.slice(ORIGIN.length).split('?')[0] !== request.pathname)
    assert.deepEqual(rewritten.map((request) => `${request.method} ${request.sent}`), [])
  })
  check(`${label}: every object request is for a key the script may use`, () => {
    const refused = world.requests.filter((request) => request.key !== null && !allowedKey(request.key))
    assert.deepEqual(refused.map((request) => `${request.method} ${shown(request.key)}`), [])
  })
  check(`${label}: the spare bucket is unchanged`, () => assert.deepEqual(bucketState(world.buckets.get(SPARE_BUCKET)), world.spareBefore))
}

const quarantined = (key) => script.quarantineKeyFor(STAMP, key)
const listedOrQuarantined = (key) => SAFE_KEYS.includes(key) || SAFE_KEYS.some((safe) => quarantined(safe) === key)

async function main() {
  try {
    script = { ...(await import(pathToFileURL(PURGE_SOURCE).href)) }
  } catch (error) {
    failures.push(`load the purge script: ${firstLine(error)}`)
    script = {}
  }
  if (typeof script.run !== 'function') script.run = async () => { throw new Error('the script has no run()') }
  if (typeof script.quarantineKeyFor !== 'function') script.quarantineKeyFor = (stamp, key) => `quarantine/${stamp}/${key}`

  const objectsBase = `${ORIGIN}${ACCOUNT_PATH}/r2/buckets/${LIVE_BUCKET}/objects`
  for (const key of UNSAFE_KEYS) {
    check(`objectPath refuses ${shown(key)}`, () => assert.throws(() => script.objectPath(key)))
  }
  for (const key of SAFE_KEYS) {
    check(`objectPath keeps ${shown(key)} as one object of the bucket`, () => {
      const built = `${objectsBase}/${script.objectPath(key)}`
      const { pathname } = new URL(built)
      assert.equal(pathname, built.slice(ORIGIN.length))
      assert.equal(pathname.slice(`${ACCOUNT_PATH}/r2/buckets/${LIVE_BUCKET}/objects/`.length).split('/').map(decodeURIComponent).join('/'), key)
    })
  }

  const withPdf = (key) => [key, F.pdf()]
  for (const [mode, argv, answer] of [['dry run', [], ''], ['--move', ['--move'], 'MOVE']]) {
    const world = makeWorld([...SAFE_OBJECTS, ...UNSAFE_KEYS.map(withPdf)])
    const liveBefore = world.buckets.get(LIVE_BUCKET)
    const unsafeBefore = UNSAFE_KEYS.map((key) => [key, sha(liveBefore.get(key))])
    const result = await invoke(world, argv, answer)
    const label = `a listing with unsafe keys, ${mode}`
    check(`${label}: exits 0`, () => assert.equal(result.code, 0, result.text))
    expectOnlyLiveObjects(label, world, listedOrQuarantined)
    check(`${label}: each unsafe key is kept for review, never purged`, () => {
      const listingFile = path.join(result.home, 'business-os-purge', STAMP, 'listing.json')
      const entries = new Map(JSON.parse(fs.readFileSync(listingFile, 'utf8')).entries.map((entry) => [entry.key, entry]))
      for (const key of UNSAFE_KEYS) assert.equal(entries.get(key)?.action, 'review', shown(key))
      assert.equal(entries.get('uploads/invoice.pdf')?.action, 'purge', 'a safe document is still purged')
    })
    check(`${label}: every unsafe object is still in the live bucket, unchanged`, () => {
      const live = world.buckets.get(LIVE_BUCKET)
      assert.deepEqual(UNSAFE_KEYS.map((key) => [key, live.has(key) ? sha(live.get(key)) : null]), unsafeBefore)
    })
    if (mode === '--move') {
      check(`${label}: the safe documents were moved`, () => {
        const live = world.buckets.get(LIVE_BUCKET)
        for (const key of ['uploads/invoice.pdf', 'uploads/v1..2 final.pdf', 'uploads/.hidden.pdf']) {
          assert.ok(!live.has(key) && live.has(quarantined(key)), shown(key))
        }
      })
    }
  }

  const goodMove = { key: 'uploads/invoice.pdf', quarantineKey: quarantined('uploads/invoice.pdf'), size: F.pdf().length, sha256: sha(F.pdf()), state: 'moved' }
  const manifestWith = (moves) => ({
    tool: script.MANIFEST_TOOL, format: script.MANIFEST_FORMAT, bucket: script.BUCKET, mode: 'move', stamp: STAMP,
    quarantinePrefix: quarantined(''), moves, skipped: [], rows: { file_assets: [], import_job_files: [] },
  })
  for (const key of UNSAFE_KEYS) {
    const edited = { key, quarantineKey: quarantined(key), size: F.pdf().length, sha256: sha(F.pdf()), state: 'moved' }
    check(`validateManifest names the unsafe key ${shown(key)}`, () => {
      const problems = script.validateManifest(manifestWith([goodMove, edited]))
      assert.ok(Array.isArray(problems) && problems.length > 0, 'no problem found')
    })
    const world = makeWorld([[quarantined(key), F.pdf()], [quarantined(goodMove.key), F.pdf()]])
    const writeManifest = (home) => {
      const file = path.join(home, 'manifest.json')
      fs.writeFileSync(file, JSON.stringify(manifestWith([goodMove, edited])))
      return file
    }
    const result = await invoke(world, ['--restore', writeManifest], 'RESTORE')
    const label = `--restore of a manifest edited to hold ${shown(key)}`
    check(`${label}: refused with FAILED`, () => { assert.equal(result.code, 1, result.text); assert.match(result.text, /FAILED/) })
    check(`${label}: no request at all`, () => assert.deepEqual(world.requests.map((request) => `${request.method} ${request.pathname}`), []))
    expectOnlyLiveObjects(label, world, () => false)
  }

  const strays = [UNSAFE_KEYS[0], 'uploads/%2e%2e/evil.pdf', 'uploads/..\\evil.pdf']
  const world = makeWorld([[quarantined(goodMove.key), F.pdf()], ...strays.map((key) => [quarantined(key), F.pdf()])])
  const result = await invoke(world, ['--restore', (home) => {
    const file = path.join(home, 'manifest.json')
    fs.writeFileSync(file, JSON.stringify(manifestWith([goodMove])))
    return file
  }], 'RESTORE')
  const label = '--restore meeting unrecorded quarantine copies with unsafe names'
  check(`${label}: puts the recorded file back and leaves the unsafe copies`, () => {
    assert.equal(result.code, 1, result.text)
    assert.match(result.text, /Files put back: 1;/)
    assert.match(result.text, new RegExp(`Unrecorded quarantine copies: ${strays.length} \\(${strays.length} left\\)`))
    for (const key of strays) assert.ok(world.buckets.get(LIVE_BUCKET).has(quarantined(key)), shown(key))
  })
  expectOnlyLiveObjects(label, world, (key) => key === goodMove.key || key === goodMove.quarantineKey)

  for (const home of homes) fs.rmSync(home, { recursive: true, force: true })
  if (failures.length) {
    for (const failure of failures.slice(0, 80)) console.error(`FAIL ${failure}`)
    if (failures.length > 80) console.error(`...and ${failures.length - 80} more`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: no key with an empty, '.' or '..' part, a backslash, an encoded dot, slash or backslash, or a control character reaches a request in the dry run, --move or --restore; every request addresses one object of ${LIVE_BUCKET}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
