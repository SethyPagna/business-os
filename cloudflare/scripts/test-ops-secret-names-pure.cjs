#!/usr/bin/env node
// Offline checks for the secret-names job (ops/scripts/ops-secret-names.mjs):
// which of the app's secrets the production Worker has, by NAME and binding
// type only. A fake Cloudflare API serves the secret list, the deployments and
// the version bindings; the last checks run the real script in a child process
// with fetch() replaced, and read exactly what it prints. No network.
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(ROOT, 'ops', 'scripts', 'ops-secret-names.mjs')
const load = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href)

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n  ') : err}`)
    process.exitCode = 1
  }
}

const ACCOUNT = '0123456789abcdef0123456789abcdef'
const BASE = `/accounts/${ACCOUNT}/workers/scripts/business-os`
const V1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const V2 = 'aaaaaaaa-0000-4000-8000-000000000002'
// Neither may ever reach the public log; the value may not even reach the report.
const CANARY_VALUE = 'plain-value-canary-7f3a'
const CANARY_NAME = 'ZZ_CANARY_UNEXPECTED_SECRET'

const EXPECTED = [
  'APP_ENCRYPTION_KEY', 'AUTH_SESSION_SECRET', 'OAUTH_STATE_SECRET', 'GOOGLE_LOGIN_CLIENT_ID',
  'GOOGLE_LOGIN_CLIENT_SECRET', 'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'TELEGRAM_BOT_TOKEN',
]
const SECRETS6 = EXPECTED.filter((n) => !/_CLIENT_ID$/.test(n))

// The production Worker's bindings as the version API returns them: the two
// client ids are [vars] (plain_text, WITH their value), the rest secret_text.
function versionBindings({ drop = [], extra = [] } = {}) {
  return [
    { type: 'd1', name: 'DB', id: '11111111-2222-4333-8444-555555555555' },
    { type: 'r2_bucket', name: 'ASSETS', bucket_name: 'business-os-assets' },
    { type: 'plain_text', name: 'GOOGLE_LOGIN_CLIENT_ID', text: CANARY_VALUE },
    { type: 'plain_text', name: 'GOOGLE_DRIVE_CLIENT_ID', text: CANARY_VALUE },
    ...SECRETS6.filter((n) => !drop.includes(n)).map((name) => ({ type: 'secret_text', name })),
    { type: 'secret_text', name: CANARY_NAME },
    ...extra,
  ]
}

function scenario(overrides = {}) {
  return {
    secrets: [...SECRETS6.map((name) => ({ name, type: 'secret_text', text: CANARY_VALUE })), { name: CANARY_NAME, type: 'secret_text' }],
    // Newest first, as the API lists them; the old deployment has no secrets at all.
    deployments: [
      { id: 'new', created_on: '2026-09-25T00:00:00Z', versions: [{ version_id: V1, percentage: 100 }] },
      { id: 'old', created_on: '2026-09-01T00:00:00Z', versions: [{ version_id: V2, percentage: 100 }] },
    ],
    versions: { [V1]: versionBindings(), [V2]: versionBindings({ drop: SECRETS6 }) },
    ...overrides,
  }
}

// Also serialised into the child-process fetch stub below: no outer references but BASE.
function respond(s, method, p) {
  if (method !== 'GET') return { status: 405, json: { success: false, errors: [{ code: 10405 }] } }
  if (p === `${BASE}/secrets`) {
    if (s.secrets === 'forbidden') return { status: 403, json: { success: false, errors: [{ code: 10000 }] } }
    if (s.secrets === 'missing') return { status: 404, json: { success: false, errors: [{ code: 10007 }] } }
    return { status: 200, json: { success: true, result: s.secrets } }
  }
  if (p === `${BASE}/deployments`) {
    if (s.deployments === 'down') return { status: 503, json: null }
    return { status: 200, json: { success: true, result: { deployments: s.deployments } } }
  }
  const m = /^\/accounts\/[0-9a-f]{32}\/workers\/scripts\/business-os\/versions\/([0-9a-f-]+)$/.exec(p)
  if (m && Array.isArray(s.versions[m[1]])) return { status: 200, json: { success: true, result: { id: m[1], resources: { bindings: s.versions[m[1]] } } } }
  return { status: 404, json: { success: false, errors: [{ code: 10007 }] } }
}

function fakeApi(s) {
  const calls = []
  async function api(method, p) {
    calls.push(`${method} ${p}`)
    const r = respond(s, method, p)
    return { ok: r.status < 400 && (!r.json || r.json.success !== false), status: r.status, json: r.json }
  }
  return { api, calls }
}

const statuses = (result) => Object.fromEntries(Object.entries(result.expected).map(([n, s]) => [n, `${s.live}/${s.listed}`]))
const ALL_SET = Object.fromEntries(EXPECTED.map((n) => [n, /_CLIENT_ID$/.test(n) ? 'plain-text/absent' : 'secret/present']))

async function main() {
  const common = await load('ops', 'scripts', 'ops-common.mjs')
  const sn = await load('ops', 'scripts', 'ops-secret-names.mjs')
  const format = (result, bytes) => sn.publicLines({ result, bytes }).map(([t, v]) => common.formatPublic(t, v))

  await check('the expected names are the eight the app reads, frozen, each printable as a plain name', () => {
    assert.deepStrictEqual([...sn.EXPECTED_SECRETS], EXPECTED)
    assert.ok(Object.isFrozen(sn.EXPECTED_SECRETS))
    for (const name of sn.EXPECTED_SECRETS) assert.strictEqual(common.formatPublic('{n}', { n: common.publicToken(name) }), name)
    // The code really reads each of them (cloudflare/src), and the two client ids are plain [vars].
    const src = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name))
        else if (/\.ts$/.test(e.name)) src.push(fs.readFileSync(path.join(dir, e.name), 'utf8'))
      }
    }
    walk(path.join(ROOT, 'cloudflare', 'src'))
    const all = src.join('\n')
    const readByApp = EXPECTED.filter((n) => new RegExp(`\\b${n}\\b`).test(all))
    assert.deepStrictEqual(readByApp.filter((n) => n !== 'OAUTH_STATE_SECRET'), EXPECTED.filter((n) => n !== 'OAUTH_STATE_SECRET'), 'a listed name the app does not read')
    const vars = fs.readFileSync(path.join(ROOT, 'cloudflare', 'wrangler.toml'), 'utf8').replace(/\r\n/g, '\n')
    for (const n of ['GOOGLE_LOGIN_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_ID']) assert.ok(new RegExp(`^${n} = "`, 'm').test(vars), `${n} is a plain var`)
  })

  await check('every secret set: secrets read secret/present, the client ids plain-text/absent, the verdict PASS', async () => {
    const { api, calls } = fakeApi(scenario())
    const r = await sn.readSecretNames(api, ACCOUNT)
    assert.deepStrictEqual(statuses(r), ALL_SET)
    assert.strictEqual(r.ok, true)
    assert.deepStrictEqual(r.problems, [])
    assert.strictEqual(r.secretsInEveryLiveVersion, 6)
    assert.strictEqual(r.liveVersionCount, 1, 'only the newest deployment counts')
    assert.strictEqual(r.disagreements, 0)
    assert.deepStrictEqual(r.otherSecretNames, [CANARY_NAME])
    // GET only, and only these paths of the production Worker.
    assert.deepStrictEqual(calls, [`GET ${BASE}/secrets`, `GET ${BASE}/deployments`, `GET ${BASE}/versions/${V1}`])
  })

  await check('only { name, type } is kept: a plain-text value never reaches the report', async () => {
    const r = await sn.readSecretNames(fakeApi(scenario()).api, ACCOUNT)
    const text = JSON.stringify(r)
    assert.ok(!text.includes(CANARY_VALUE), 'a binding value reached the report')
    assert.ok(!text.includes('11111111-2222'), 'an unrelated binding reached the report')
    for (const v of r.liveVersions) for (const b of v.bindings) assert.deepStrictEqual(Object.keys(b).sort(), ['name', 'type'])
    for (const e of r.secretList.entries) assert.deepStrictEqual(Object.keys(e).sort(), ['name', 'type'])
  })

  await check('the public lines: fixed names, fixed words, counts; never another name or a value', async () => {
    const r = await sn.readSecretNames(fakeApi(scenario()).api, ACCOUNT)
    const lines = format(r, 1234)
    assert.deepStrictEqual(lines, [
      'secret-names: the production Worker, names and binding types only',
      ...EXPECTED.map((n) => `${n}: live versions ${ALL_SET[n].split('/')[0]}, secret list ${ALL_SET[n].split('/')[1]}`),
      'live versions read: 1',
      'bound as a secret in every live version: 6 of 8',
      'other secret names: 1 (the names are in the encrypted file)',
      'names the live versions and the secret list disagree on: 0',
      'encrypted file: 1234 bytes',
      'secret-names verdict: PASS',
    ])
    assert.ok(!lines.join('\n').includes('CANARY') && !lines.join('\n').includes('canary'))
  })

  await check('a missing APP_ENCRYPTION_KEY reads absent in both places; the read itself still PASSES', async () => {
    const s = scenario({
      secrets: scenario().secrets.filter((e) => e.name !== 'APP_ENCRYPTION_KEY'),
      versions: { [V1]: versionBindings({ drop: ['APP_ENCRYPTION_KEY'] }) },
    })
    const r = await sn.readSecretNames(fakeApi(s).api, ACCOUNT)
    assert.deepStrictEqual(statuses(r), { ...ALL_SET, APP_ENCRYPTION_KEY: 'absent/absent' })
    assert.strictEqual(r.secretsInEveryLiveVersion, 5)
    assert.strictEqual(r.ok, true)
    assert.ok(format(r).includes('APP_ENCRYPTION_KEY: live versions absent, secret list absent'))
  })

  await check('a gradual deployment: a secret in only one live version reads mixed and counts as a disagreement', async () => {
    const s = scenario({
      deployments: [
        { id: 'old', created_on: '2026-09-01T00:00:00Z', versions: [{ version_id: V1, percentage: 100 }] },
        { id: 'new', created_on: '2026-09-25T00:00:00Z', versions: [{ version_id: V1, percentage: 60 }, { version_id: V2, percentage: 40 }] },
      ],
      versions: { [V1]: versionBindings(), [V2]: versionBindings({ drop: ['APP_ENCRYPTION_KEY'] }) },
    })
    const r = await sn.readSecretNames(fakeApi(s).api, ACCOUNT)
    assert.strictEqual(r.liveVersionCount, 2, 'the newest deployment, even listed last')
    assert.deepStrictEqual(statuses(r), { ...ALL_SET, APP_ENCRYPTION_KEY: 'mixed/present' })
    assert.strictEqual(r.disagreements, 1)
    assert.strictEqual(r.secretsInEveryLiveVersion, 5)
    // A version at 0% carries no traffic and does not count.
    const idle = scenario({
      deployments: [{ id: 'new', created_on: '2026-09-25T00:00:00Z', versions: [{ version_id: V1, percentage: 100 }, { version_id: V2, percentage: 0 }] }],
    })
    assert.deepStrictEqual(statuses(await sn.readSecretNames(fakeApi(idle).api, ACCOUNT)), ALL_SET)
  })

  await check('a secret bound as another type reads other-type; the secret list still shows it', async () => {
    const s = scenario({
      versions: { [V1]: versionBindings({ drop: ['APP_ENCRYPTION_KEY'], extra: [{ type: 'secret_key', name: 'APP_ENCRYPTION_KEY', algorithm: { name: 'AES-GCM' } }] }) },
    })
    const r = await sn.readSecretNames(fakeApi(s).api, ACCOUNT)
    assert.strictEqual(r.expected.APP_ENCRYPTION_KEY.live, 'other-type')
    assert.strictEqual(r.disagreements, 1)
  })

  await check('an unreadable secret list: unknown there, the live versions still read, the verdict FAIL', async () => {
    for (const secrets of ['forbidden', 'missing']) {
      const r = await sn.readSecretNames(fakeApi(scenario({ secrets })).api, ACCOUNT)
      assert.deepStrictEqual(statuses(r), Object.fromEntries(EXPECTED.map((n) => [n, `${ALL_SET[n].split('/')[0]}/unknown`])))
      assert.deepStrictEqual(r.problems, ['secret-list-unreadable'])
      assert.strictEqual(r.ok, false)
      assert.ok(format(r).includes('secret-names verdict: FAIL') && format(r).includes('problem: secret-list-unreadable'))
    }
  })

  await check('unreadable deployments or versions: every live answer is unknown, never absent', async () => {
    for (const over of [{ deployments: 'down' }, { deployments: [] }, { versions: {} }]) {
      const r = await sn.readSecretNames(fakeApi(scenario(over)).api, ACCOUNT)
      assert.ok(Object.values(r.expected).every((s) => s.live === 'unknown'), JSON.stringify(over))
      assert.deepStrictEqual(r.problems, ['live-versions-unreadable'])
      assert.strictEqual(r.ok, false)
      assert.ok(r.liveFailure && /^[a-z-]+$/.test(r.liveFailure.reason))
    }
  })

  await check('positive control: a version read without the ASSETS binding observed nothing, so nothing reads absent', async () => {
    for (const bindings of [[], versionBindings().filter((b) => b.name !== 'ASSETS')]) {
      const r = await sn.readSecretNames(fakeApi(scenario({ versions: { [V1]: bindings } })).api, ACCOUNT)
      assert.ok(Object.values(r.expected).every((s) => s.live === 'unknown'))
      assert.deepStrictEqual(r.problems, ['bindings-not-observed'])
      assert.strictEqual(r.ok, false)
    }
  })

  await check('a malformed account id is refused before any request', async () => {
    for (const bad of ['', 'x', `${ACCOUNT}/../other`, ACCOUNT.toUpperCase()]) {
      const { api, calls } = fakeApi(scenario())
      await assert.rejects(() => sn.readSecretNames(api, bad), (e) => e instanceof common.OpsError && e.code === 'bad-account-id')
      assert.deepStrictEqual(calls, [])
    }
  })

  // ---------------------------------------------- the real script, end to end

  function runScript(s) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-secret-names-'))
    const out = path.join(tmp, 'out')
    const summaryFile = path.join(tmp, 'summary.md')
    const record = path.join(tmp, 'requests.jsonl')
    const stub = path.join(tmp, 'fetch-stub.mjs')
    fs.writeFileSync(stub, [
      "import fs from 'node:fs'",
      `const BASE = ${JSON.stringify(BASE)}`,
      `const RECORD = ${JSON.stringify(record)}`,
      `const scenario = ${JSON.stringify(s)}`,
      respond.toString(),
      'globalThis.fetch = async (url, init = {}) => {',
      '  const u = new URL(url)',
      "  const auth = String((init.headers && init.headers.authorization) || '')",
      "  fs.appendFileSync(RECORD, JSON.stringify({ method: init.method, origin: u.origin, path: u.pathname, search: u.search, bearer: auth === 'Bearer fake-token-for-test' }) + '\\n')",
      "  const p = u.pathname.replace(/^\\/client\\/v4/, '')",
      "  const r = respond(scenario, init.method || 'GET', p)",
      "  return new Response(r.json === null ? 'not json' : JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } })",
      '}',
      '',
    ].join('\n'))
    const env = {}
    for (const [k, v] of Object.entries(process.env)) if (!/^(CLOUDFLARE_|GITHUB_|OPS_)/i.test(k)) env[k] = v
    Object.assign(env, {
      OPS_OUT_DIR: out,
      CLOUDFLARE_API_TOKEN: 'fake-token-for-test',
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      GITHUB_STEP_SUMMARY: summaryFile,
      GITHUB_RUN_ID: '4242',
      GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
    })
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, SCRIPT], { env, encoding: 'utf8', timeout: 120000, windowsHide: true })
    const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '')
    const result = {
      status: r.status,
      stdout: r.stdout.replace(/\r\n/g, '\n'),
      stderr: r.stderr,
      summary: read(summaryFile),
      requests: read(record).split('\n').filter(Boolean).map((l) => JSON.parse(l)),
      files: fs.existsSync(out) ? fs.readdirSync(out) : [],
      report: read(path.join(out, 'secret-names-4242.enc.json')),
    }
    fs.rmSync(tmp, { recursive: true, force: true })
    return result
  }

  await check('the script, run for real: prints exactly the public lines, writes only the encrypted file, GETs only', () => {
    const r = runScript(scenario())
    assert.strictEqual(r.status, 0, r.stdout + r.stderr)
    assert.strictEqual(r.stderr, '')
    const lines = r.stdout.trimEnd().split('\n')
    const bytes = /^encrypted file: (\d+) bytes$/.exec(lines[lines.length - 2])
    assert.ok(bytes, lines.join('\n'))
    assert.deepStrictEqual(lines, [
      'secret-names: the production Worker, names and binding types only',
      ...EXPECTED.map((n) => `${n}: live versions ${ALL_SET[n].split('/')[0]}, secret list ${ALL_SET[n].split('/')[1]}`),
      'live versions read: 1',
      'bound as a secret in every live version: 6 of 8',
      'other secret names: 1 (the names are in the encrypted file)',
      'names the live versions and the secret list disagree on: 0',
      `encrypted file: ${bytes[1]} bytes`,
      'secret-names verdict: PASS',
    ])
    assert.strictEqual(r.summary, lines.map((l) => `- ${l}\n`).join(''))
    assert.deepStrictEqual(r.files, ['secret-names-4242.enc.json'])
    assert.strictEqual(Buffer.byteLength(r.report), Number(bytes[1]))
    for (const needle of [CANARY_NAME, CANARY_VALUE, 'APP_ENCRYPTION_KEY', 'secret_text']) {
      assert.ok(!r.report.includes(needle), `${needle} is readable in the uploaded file`)
      assert.ok(!r.summary.includes(needle) || EXPECTED.includes(needle), `${needle} reached the summary`)
    }
    assert.ok(!r.stdout.includes(CANARY_NAME) && !r.stdout.includes(CANARY_VALUE))
    const header = JSON.parse(JSON.parse(r.report).header)
    assert.strictEqual(header.meta.kind, 'secret-names')
    assert.deepStrictEqual(r.requests.map((q) => `${q.method} ${q.origin}${q.path}${q.search}`), [
      `GET https://api.cloudflare.com/client/v4${BASE}/secrets`,
      `GET https://api.cloudflare.com/client/v4${BASE}/deployments`,
      `GET https://api.cloudflare.com/client/v4${BASE}/versions/${V1}`,
    ])
    assert.ok(r.requests.every((q) => q.bearer), 'every request carries the token as a bearer header')
  })

  await check('the script, run for real: a refused read fails the step, prints the problem code, and still writes the file', () => {
    const r = runScript(scenario({ secrets: 'forbidden' }))
    assert.strictEqual(r.status, 1)
    const lines = r.stdout.trimEnd().split('\n')
    assert.ok(lines.includes('problem: secret-list-unreadable'), r.stdout)
    assert.strictEqual(lines[lines.length - 1], 'secret-names verdict: FAIL')
    assert.ok(lines.includes('APP_ENCRYPTION_KEY: live versions secret, secret list unknown'))
    assert.deepStrictEqual(r.files, ['secret-names-4242.enc.json'])
  })

  if (process.exitCode) console.error(`test-ops-secret-names-pure: FAILED (${passed} passed)`)
  else console.log(`test-ops-secret-names-pure: ${passed} checks passed`)
}

main().catch((err) => {
  process.exitCode = 1
  console.error(err)
})
