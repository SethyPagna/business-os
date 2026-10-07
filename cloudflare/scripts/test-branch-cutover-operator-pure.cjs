// Offline checks for the branch-cutover operator path (lane CUTOVER-RUNNER) that need no database:
//   - the token comparison (equal, unequal at every position, any length, empty, short secret) and that the route reads
//     the secret, checks it and only then the body, with no logging anywhere in the endpoint;
//   - the loop's retry rules on a scripted transport (identical request text, bounded, refusals never retried);
//   - the ops script: only the production origin, the token only in one request header, public output only from the fixed
//     vocabulary (a run of every mode against a scripted endpoint prints no token, no row, no name), main-only, the
//     bookmark parser, and the deterministic begin request id.
// The full run through the real route is test-branch-cutover-operator-native.cjs; the workflow is test-ops-workflow-pure.cjs.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '..')
const repo = path.resolve(root, '..')
const read = (...p) => fs.readFileSync(path.join(repo, ...p), 'utf8').replace(/\r\n/g, '\n')
const load = (...p) => import(pathToFileURL(path.join(repo, ...p)).href)
let checks = 0
const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name) }

async function operatorLib() {
  const out = await build({ stdin: { contents: "export * from './src/lib/branchCutoverOperator.ts'; export { isBranchCutoverOperatorPath } from './src/lib/maintenance.ts'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require)
  return module.exports
}

async function main() {
  const lib = await operatorLib()
  const loop = await load('ops', 'scripts', 'branch-cutover-loop.mjs')
  const script = await load('ops', 'scripts', 'ops-branch-cutover.mjs')
  const common = await load('ops', 'scripts', 'ops-common.mjs')
  const TOKEN = 'a'.repeat(31) + 'b' + 'c'.repeat(8)

  await check('the token comparison accepts only the exact secret, whatever differs and wherever', async () => {
    assert.equal(await lib.operatorTokenMatches(TOKEN, TOKEN), true)
    for (let index = 0; index < TOKEN.length; index++) {
      assert.equal(await lib.operatorTokenMatches(TOKEN, TOKEN.slice(0, index) + (TOKEN[index] === 'z' ? 'y' : 'z') + TOKEN.slice(index + 1)), false, 'position ' + index)
    }
    for (const presented of [undefined, null, '', ' ', TOKEN + ' ', ' ' + TOKEN, TOKEN.slice(1), TOKEN + TOKEN, TOKEN.toUpperCase(), 42, {}, [TOKEN]]) {
      assert.equal(await lib.operatorTokenMatches(TOKEN, presented), false, JSON.stringify(presented))
    }
    for (const configured of [undefined, null, '', 'short', 'x'.repeat(31), 42]) assert.equal(await lib.operatorTokenMatches(configured, configured), false, 'a missing or short secret never matches, even itself')
    assert.equal(await lib.operatorTokenMatches('x'.repeat(32), 'x'.repeat(32)), true, 'the minimum length is 32')
    assert.equal(lib.branchCutoverOperatorEnabled('x'.repeat(31)), false)
    assert.equal(lib.branchCutoverOperatorEnabled(undefined), false)
  })

  await check('the fence exemption is exactly the six operator paths', () => {
    for (const action of ['inspect', 'begin', 'resume', 'status', 'abort', 'finalize']) assert.equal(lib.isBranchCutoverOperatorPath('/api/internal/branch-cutover/' + action), true, action)
    for (const path of ['/api/internal/branch-cutover/', '/api/internal/branch-cutover', '/api/internal/branch-cutover/status/', '/api/internal/branch-cutover/status/x', '/api/internal/branch-cutover/other',
      '/api/internal/branch-cutover/../sales', '/api/internal/branch-cutover-x/status', '/api/sales', '/api/auth/login', '/api/internal/branch-cutover/STATUS', '//api/internal/branch-cutover/status']) {
      assert.equal(lib.isBranchCutoverOperatorPath(path), false, path)
    }
  })

  await check('the endpoint source: secret first, then the token, then the body; no logging, no secret in any response, no other import of it', () => {
    const route = read('cloudflare', 'src', 'routes', 'branchCutoverOperator.ts')
    const order = ['branchCutoverOperatorEnabled(configured)', 'operatorTokenMatches(configured', 'parseOperatorBody(await c.req.text())', 'runBranchCutoverOperatorAction(']
    const at = order.map(text => route.indexOf(text)); assert.ok(at.every(i => i > 0) && at.every((v, i) => i === 0 || v > at[i - 1]), 'order ' + at)
    for (const [file, text] of [['route', route], ['lib', read('cloudflare', 'src', 'lib', 'branchCutoverOperator.ts')]]) {
      assert.equal(/\bconsole\./.test(text), false, file + ' logs')
      assert.equal(/\b(configured|presented)\s*[!=]==\s*(configured|presented)\b/.test(text), false, file + ' compares the token with ===')
    }
    assert.equal((route.match(/\bBRANCH_CUTOVER_OPERATOR_TOKEN\b/g) || []).length, 1, 'the route reads the secret once')
    const index = read('cloudflare', 'src', 'index.ts')
    assert.ok(index.includes("app.route('/api/internal/branch-cutover', branchCutoverOperatorRoute)"))
    assert.ok(index.includes("const operatorStep = maintenance?.mode === 'branch-cutover' && isBranchCutoverOperatorPath(c.req.path)"), 'only during a branch-cutover run')
    assert.ok(index.includes('if (maintenance && !operatorStep && isMaintenanceGatedRequest('), 'every other write stays gated')
    assert.equal((index.match(/^\s+BRANCH_CUTOVER_OPERATOR_TOKEN\?: string$/gm) || []).length, 1, 'the secret is only a typed Env field there')
  })

  await check('the loop re-sends the identical request text, is bounded, never retries a refusal and stops on 401/404', async () => {
    const scripted = (responses) => { const seen = []; let i = 0; return { seen, send: async (action, text) => { seen.push([action, text]); const r = responses[Math.min(i++, responses.length - 1)]; if (r instanceof Error) throw r; return r } } }
    const ok = { status: 200, json: { ok: true, phase: 'capturing', revision: 1, next: 'continue' } }
    const sleeps = []
    let t = scripted([new Error('timeout'), { status: 502, json: null }, { status: 429, json: {} }, { status: 503, json: { ok: false, code: 'retryable' } }, { status: 500, json: { ok: false, code: 'internal' } }, ok])
    let client = loop.createClient({ send: t.send, sleep: async (ms) => sleeps.push(ms) })
    assert.deepEqual(await client.call('resume', { operationId: 'x', requestId: 'bcr_x_0' }), ok.json)
    assert.equal(new Set(t.seen.map(([, text]) => text)).size, 1); assert.equal(t.seen.length, 6)
    assert.deepEqual(client.stats, { calls: 1, attempts: 6, retries: 5, transport: 1, serverBusy: 3, retryable: 1, replayed: 0 })
    assert.deepEqual(sleeps, [500, 1000, 2000, 4000, 8000]); assert.ok(Math.max(...sleeps) <= 15000)
    for (const [status, json, code] of [[401, { ok: false }, 'unauthorized'], [404, { ok: false, code: 'not_found' }, 'endpoint-disabled'], [409, { ok: false, code: 'refused', refusal: 'open_shift_exists' }, 'refused-open-shift-exists'],
      [409, { ok: false, code: 'refused', refusal: 'Bad Value!' }, 'refused-refused'], [400, { ok: false, code: 'bad_request' }, 'refused-refused'], [413, null, 'refused-refused']]) {
      t = scripted([{ status, json }]); client = loop.createClient({ send: t.send, sleep: async () => { throw new Error('a refusal must not wait') } })
      await assert.rejects(client.call('status', {}), error => error.code === code, status + ' ' + code); assert.equal(t.seen.length, 1)
    }
    t = scripted([{ status: 500, json: null }]); client = loop.createClient({ send: t.send, sleep: async () => {}, maxAttempts: 7 })
    await assert.rejects(client.call('status', {}), error => error.code === 'retries-exhausted'); assert.equal(t.seen.length, 7)
    t = scripted([{ status: 503, json: { code: 'retryable' } }]); client = loop.createClient({ send: t.send, sleep: async () => {} })
    await assert.rejects(client.call('begin', {}), error => error.code === 'begin-not-confirmed'); assert.equal(t.seen.length, loop.BEGIN_ATTEMPTS)
    assert.equal(loop.stepRequestId('op', 7), 'bcr_op_7')
  })

  await check('resumeUntilReady needs every call to advance the revision, honours the time and step budgets and stops on abort', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const server = (script) => { let revision = 0; const sent = []; return { sent, send: async (action, text) => { const body = JSON.parse(text); sent.push(body)
      if (action === 'status') return { status: 200, json: { ok: true, operationId: id, phase: 'capturing', revision, next: 'continue' } }
      revision = script(revision, body); return { status: 200, json: { ok: true, operationId: id, phase: revision >= 5 ? 'ready' : 'capturing', revision, next: revision >= 5 ? 'ready' : 'continue' } } } } }
    let s = server(r => r + 1)
    const done = await loop.resumeUntilReady(loop.createClient({ send: s.send }), { operationId: id })
    assert.deepEqual([done.state.phase, done.steps], ['ready', 5])
    assert.deepEqual(s.sent.filter(b => b.requestId).map(b => [b.expectedRevision, b.requestId]), [0, 1, 2, 3, 4].map(r => [r, `bcr_${id}_${r}`]))
    s = server(r => r)
    await assert.rejects(loop.resumeUntilReady(loop.createClient({ send: s.send }), { operationId: id }), error => error.code === 'no-progress')
    s = server(r => r + 1)
    await assert.rejects(loop.resumeUntilReady(loop.createClient({ send: s.send }), { operationId: id, stepLimit: 2 }), error => error.code === 'step-limit-reached')
    let now = 0
    await assert.rejects(loop.resumeUntilReady(loop.createClient({ send: server(r => r + 1).send }), { operationId: id, now: () => now++, deadline: 3 }), error => error.code === 'time-budget-reached')
    await assert.rejects(loop.readStatus(loop.createClient({ send: async () => ({ status: 200, json: { ok: true, phase: 'none', revision: 0, next: 'none' } }) }), undefined), error => error.code === 'no-operation')
    await assert.rejects(loop.readStatus(loop.createClient({ send: async () => ({ status: 200, json: { ok: true, phase: 'weird', revision: 0, next: 'continue' } }) }), id), error => error.code === 'unexpected-response')
    assert.deepEqual(loop.inspectVerdict({ activationReady: true, capabilities: [] }), { ready: true, capabilityCodes: [] })
    assert.deepEqual(loop.inspectVerdict({ activationReady: true, capabilities: [{ code: 'pending_actions_open', detail: '3' }, { code: 'not in the list', detail: 'Alice' }] }), { ready: false, capabilityCodes: ['other', 'pending_actions_open'] })
    assert.equal(loop.inspectVerdict({ activationReady: false, capabilities: [] }).ready, false)
  })

  await check('the ops script talks only to the production origin, sends the token in one header, and re-checks main', async () => {
    const wrangler = read('cloudflare', 'wrangler.toml')
    const domains = [...wrangler.matchAll(/pattern = "([^"]+)", custom_domain = true/g)].map(m => m[1])
    assert.ok(domains.length >= 2); for (const host of script.ALLOWED_HOSTS) assert.ok(domains.includes(host), host + ' is a production custom domain')
    assert.equal(script.baseUrl(undefined), 'https://admin.leangbeauty.com'); assert.equal(script.baseUrl('https://leangbeauty.com/'), 'https://leangbeauty.com')
    for (const bad of ['http://admin.leangbeauty.com', 'https://admin.leangbeauty.com.evil.example', 'https://evil.example', 'https://admin.leangbeauty.com:8443', 'https://admin.leangbeauty.com/x',
      'https://admin.leangbeauty.com/?a=1', 'https://user@admin.leangbeauty.com', 'https://localhost', 'not a url', 'https://admin.leangbeauty.com#x']) {
      assert.throws(() => script.baseUrl(bad), error => error.code === 'bad-base-url', bad)
    }
    const source = read('ops', 'scripts', 'ops-branch-cutover.mjs')
    assert.equal((source.match(/\bfetchImpl\(/g) || []).length, 1); assert.ok(source.includes("redirect: 'error'"))
    assert.ok(source.includes('`${origin}/api/internal/branch-cutover/${action}`') && source.includes("method: 'POST'"))
    assert.equal((source.match(/x-cutover-operator-token/g) || []).length, 1)
    assert.equal((source.match(/operatorToken/g) || []).length, 2, 'read once from the environment, handed once to the request sender')
    assert.ok(source.includes("if (process.env.GITHUB_REF !== 'refs/heads/main') throw new OpsError('not-main'"))
    const calls = []
    const send = script.makeSend({ origin: 'https://admin.leangbeauty.com', token: TOKEN, fetchImpl: async (url, init) => { calls.push([url, init]); return { status: 200, text: async () => '{"ok":true}' } } })
    assert.deepEqual(await send('status', '{"a":1}'), { status: 200, json: { ok: true } })
    assert.equal(calls[0][0], 'https://admin.leangbeauty.com/api/internal/branch-cutover/status'); assert.equal(calls[0][1].headers['x-cutover-operator-token'], TOKEN)
    assert.equal(calls[0][1].redirect, 'error'); assert.equal(calls[0][1].body, '{"a":1}'); assert.equal(JSON.stringify(calls[0][1]).includes(TOKEN), true, 'the header carries it')
    const html = script.makeSend({ origin: 'https://admin.leangbeauty.com', token: TOKEN, fetchImpl: async () => ({ status: 403, text: async () => '<html>blocked</html>' }) })
    assert.deepEqual(await html('status', '{}'), { status: 403, json: null })
    assert.equal(script.beginRequestId('123456'), 'cutover_begin_123456'); assert.equal(script.beginRequestId('x y'), 'cutover_begin_local')
    assert.match(script.beginRequestId('99'), /^[A-Za-z0-9_-]{8,120}$/)
  })

  await check('the bookmark parser takes JSON or prose and nothing else', () => {
    const bookmark = '00000085-0000024c-00004c6d-8e61117bf38d7adb71b55be26ba38a30'
    assert.equal(script.parseBookmark(JSON.stringify({ bookmark, created_at: 'x' })), bookmark)
    assert.equal(script.parseBookmark(`The current bookmark is '${bookmark}'`), bookmark)
    for (const bad of ['', 'no bookmark', JSON.stringify({ bookmark: 'nope' }), '00000085-0000024c', undefined]) assert.equal(script.parseBookmark(bad), null, String(bad))
  })

  await check('every mode prints only the fixed vocabulary: no token, row, name or message reaches the public log', async () => {
    const id = '22222222-2222-4222-8222-222222222222'
    const printed = []
    const original = process.stdout.write
    process.stdout.write = (chunk) => { printed.push(String(chunk)); return true }
    const hostile = 'Alice Smith 555-0100 Shop Street'
    const state = (extra = {}) => ({ ok: true, operationId: id, phase: 'ready', revision: 9, committedChildren: 3, nextSequence: 3, next: 'ready', replayed: false, ...extra })
    try {
      const respond = (action) => {
        if (action === 'inspect') return { ok: true, inspect: { activationReady: true, capabilities: [], sourcePreimageJson: hostile, targetPreimageJson: hostile, schemaDigest: 'a'.repeat(64) } }
        if (action === 'begin') return state({ phase: 'capturing', revision: 0, next: 'continue' })
        if (action === 'repair-sk2') return { ok: true, state: 'done', applied: false, replayed: true, before: hostile }
        if (action === 'status') return state()
        if (action === 'resume') return state({ revision: 10, phase: 'ready' })
        if (action === 'abort') return state({ phase: 'aborted', next: 'aborted', revision: 10 })
        return state({ phase: 'completed', next: 'completed', revision: 10 })
      }
      const make = () => loop.createClient({ send: async (action) => ({ status: 200, json: respond(action) }) })
      const env = { OPS_ACTOR_USER_ID: '7', OPS_OPERATION_ID: id }
      for (const mode of script.MODES) {
        const out = await script.executeMode(mode, { client: make(), env, bookmark: async () => ({ bookmark: hostile }), run: '555' })
        assert.equal(out.mode, mode)
      }
      const blocked = loop.createClient({ send: async () => ({ status: 200, json: { ok: true, inspect: { activationReady: false, capabilities: [{ code: 'pending_actions_open', detail: hostile }, { code: hostile, detail: hostile }] } } }) })
      await assert.rejects(script.executeMode('inspect', { client: blocked, env }), error => error.code === 'inspect-not-ready')
      await assert.rejects(script.executeMode('inspect', { client: make(), env: {} }), error => error.code === 'actor-user-missing')
      await assert.rejects(script.executeMode('nonsense', { client: make(), env }), error => error.code === 'unknown-mode')
      await assert.rejects(script.executeMode('resume-until-ready', { client: make(), env: { ...env, OPS_CUTOVER_BUDGET_MINUTES: '9999' } }), error => error.code === 'bad-time-budget')
      assert.throws(() => script.vetted(hostile), error => error.code === 'unsafe-public-value')
      assert.throws(() => script.vetted('Alice'), error => error.code === 'unsafe-public-value')
    } finally { process.stdout.write = original }
    const text = printed.join('')
    assert.ok(text.length > 0)
    for (const secret of [TOKEN, hostile, 'Alice', 'Shop Street', 'a'.repeat(64), '00000085']) assert.equal(text.includes(secret), false, 'printed ' + secret)
    for (const line of text.trim().split('\n')) {
      assert.match(line, /^(inspect: (PASS|FAIL)|blocking capability: [a-z-]+|time travel bookmark: PASS \(in the encrypted file\)|operation [0-9a-f-]{36}: phase [a-z]+, revision \d+(, replayed (yes|no)|, next [a-z]+|, steps this run \d+)?|step \d+: phase [a-z]+, revision \d+|repair-sk2: state (pre|ab|done|stale|other), applied (yes|no))$/, line)
    }
    assert.equal(common.formatPublic('x {a}', { a: 'PASS' }), 'x PASS')
  })

  console.log(`test-branch-cutover-operator-pure: ${checks} checks passed`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
