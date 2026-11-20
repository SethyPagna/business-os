#!/usr/bin/env node
// Offline checks for retiring the old R2 bucket: ops/scripts/ops-r2-retire.mjs and the parts of .github/workflows/ops.yml
// that run it. Every guard is killed by a planted mutant: the same check runs against a copy of the code (or the workflow
// text) with that guard removed, and must go red. No network, no wrangler, no Cloudflare call.
//
//   - r2-apac-copy: verify-only is the default mode; copy and topup are refused once production reads the apac bucket,
//     before anything is installed or deployed.
//   - r2-old-retire: one hard-coded bucket name, a name with "apac" refused first, production must be bound to the apac
//     bucket, the confirm word, the Production environment, counts only, and delete-bucket only on an empty listing.
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..', '..')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    process.exitCode = 1
    console.error(`FAIL ${name}\n  ${err && err.message ? err.message.split('\n').join('\n  ') : err}`)
  }
}

const ACCOUNT = '0123456789abcdef0123456789abcdef'
const V1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const OLD = 'business-os-assets'
const APAC = 'business-os-assets-apac'
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'r2ret-pure-'))

// A copy of the code with some text replaced, in a temp tree that mirrors ops/, so its relative imports resolve.
let variantCount = 0
async function loadVariant(replacements = []) {
  const dir = path.join(SCRATCH, `v${variantCount += 1}`)
  const scripts = path.join(dir, 'ops', 'scripts')
  const worker = path.join(dir, 'ops', 'r2-copy-worker', 'src')
  fs.mkdirSync(scripts, { recursive: true })
  fs.mkdirSync(worker, { recursive: true })
  for (const f of ['ops-common.mjs', 'ops-crypto.mjs', 'ops-r2-lib.mjs']) fs.copyFileSync(path.join(ROOT, 'ops', 'scripts', f), path.join(scripts, f))
  fs.copyFileSync(path.join(ROOT, 'ops', 'r2-copy-worker', 'src', 'core.mjs'), path.join(worker, 'core.mjs'))
  let text = read('ops', 'scripts', 'ops-r2-retire.mjs')
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `the mutant must change something: ${from.slice(0, 60)}`)
    text = text.replace(from, () => to)
  }
  fs.writeFileSync(path.join(scripts, 'ops-r2-retire.mjs'), text)
  return import(pathToFileURL(path.join(scripts, 'ops-r2-retire.mjs')).href)
}

// Fake Cloudflare API: the production binding, the old bucket's objects, lifecycle rules, and every call made.
function fakeApi({ production = 'destination', objects = [], lifecycleStored = true, deleteStatus = 200 } = {}) {
  const calls = []
  let rules = []
  let deleted = false
  async function api(method, p, opts) {
    calls.push(`${method} ${p.split('?')[0]}`)
    const prod = `/accounts/${ACCOUNT}/workers/scripts/business-os`
    if (method === 'GET' && p === `${prod}/deployments`) {
      return { ok: true, status: 200, json: { success: true, result: { deployments: [{ id: 'd', created_on: '2026-09-27T00:00:00Z', versions: [{ version_id: V1, percentage: 100 }] }] } } }
    }
    if (method === 'GET' && p === `${prod}/versions/${V1}`) {
      const bucket = production === 'destination' ? APAC : production === 'source' ? OLD : 'someone-else'
      return { ok: true, status: 200, json: { success: true, result: { resources: { bindings: [{ type: 'r2_bucket', name: 'ASSETS', bucket_name: bucket }] } } } }
    }
    const base = `/accounts/${ACCOUNT}/r2/buckets/${OLD}`
    if (method === 'GET' && p.startsWith(`${base}/objects`)) {
      return deleted ? { ok: false, status: 404, json: { success: false, errors: [{ code: 10006 }] } }
        : { ok: true, status: 200, json: { success: true, result: objects, result_info: { is_truncated: false } } }
    }
    if (method === 'PUT' && p === `${base}/lifecycle`) {
      if (lifecycleStored) rules = opts.body.rules
      return { ok: true, status: 200, json: { success: true, result: {} } }
    }
    if (method === 'GET' && p === `${base}/lifecycle`) return { ok: true, status: 200, json: { success: true, result: { rules } } }
    if (method === 'DELETE' && p === base) {
      if (deleteStatus === 200) deleted = true
      return { ok: deleteStatus === 200, status: deleteStatus, json: { success: deleteStatus === 200 } }
    }
    if (method === 'GET' && p === base) {
      return deleted ? { ok: false, status: 404, json: { success: false, errors: [{ code: 10006 }] } } : { ok: true, status: 200, json: { success: true, result: { name: OLD } } }
    }
    return { ok: false, status: 404, json: { success: false, errors: [{ code: 10007 }] } }
  }
  return { api, calls }
}

const objs = (...keys) => keys.map((key, i) => ({ key, size: 100 * (i + 1), last_modified: '2026-09-27T00:00:00Z' }))
const WRITES = /^(PUT|DELETE|POST|PATCH) /
const INPUT = { bucket: OLD, confirm: 'r2-old-retire', mode: 'plan' }

async function refusal(mod, input, fake) {
  try {
    await mod.runRetire({ api: fake.api, accountId: ACCOUNT, ...input })
  } catch (err) {
    return err && err.code
  }
  return null
}

// ------------------------------------------------------------- workflow text

function jobText(text, job) {
  const start = text.indexOf(`\n  ${job}:\n`)
  assert.ok(start >= 0, `job ${job} not found`)
  const next = text.slice(start + 1).search(/\n  [a-z0-9-]+:\n/)
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next)
}

// Returns the list of problems; empty means the workflow keeps every promise of this lane.
function workflowProblems(text) {
  const problems = []
  const mode = /\n      mode:\n([\s\S]*?)\n      pack:/.exec(text)
  if (!mode || !/\n        default: verify-only\n/.test(mode[1])) problems.push('the mode input must default to verify-only')
  const apac = jobText(text, 'r2-apac-copy')
  const guard = apac.indexOf('node ops/scripts/ops-r2-retire.mjs guard-copy-modes')
  const guardStep = guard < 0 ? '' : apac.slice(apac.lastIndexOf('- name:', guard), guard)
  if (guard < 0) problems.push('r2-apac-copy has no guard-copy-modes step')
  else {
    if (!/OPS_R2_MODE: \$\{\{ inputs\.mode \}\}/.test(guardStep)) problems.push('the guard step must read the chosen mode')
    for (const later of ['npm ci', 'ops-r2.mjs buckets', 'ops-r2.mjs run']) {
      const at = apac.indexOf(later)
      if (at < 0 || at < guard) problems.push(`the guard must run before ${later}`)
    }
  }
  const retire = jobText(text, 'r2-old-retire')
  if (!/\n    environment: production\n/.test(retire)) problems.push('r2-old-retire must run in the production environment')
  if (!/\n    needs: gate\n/.test(retire)) problems.push('r2-old-retire must wait for the gate')
  if (!/inputs\.task == 'r2-old-retire'/.test(retire)) problems.push('r2-old-retire must run only for its own task')
  if (!retire.includes("[string]::Equals($env:CONFIRM, 'r2-old-retire', [System.StringComparison]::Ordinal)")) problems.push('r2-old-retire needs the ordinal confirm check')
  if (!/\n          OPS_R2_RETIRE_BUCKET: business-os-assets\n/.test(retire)) problems.push('the bucket name must be the one literal business-os-assets')
  if (/OPS_R2_RETIRE_BUCKET: .*(\$\{\{|apac)/.test(retire)) problems.push('the bucket name must not be an expression or name apac')
  if (!/OPS_R2_RETIRE_MODE: \$\{\{ inputs\.mode \}\}/.test(retire)) problems.push('the retire step must read the chosen mode')
  if (!/CONFIRM: \$\{\{ inputs\.confirm \}\}\n        run: node ops\/scripts\/ops-r2-retire\.mjs run/.test(retire)) problems.push('the retire step must pass the confirm word on')
  const code = retire.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  if (/wrangler/.test(code)) problems.push('r2-old-retire must not run wrangler')
  return problems
}

async function main() {
  const real = await loadVariant()
  const WF = read('.github', 'workflows', 'ops.yml')

  // ---------------------------------------------------------------- workflow
  await check('workflow: the default mode is verify-only, the guard runs first, the retire job keeps every guard', () => {
    assert.deepStrictEqual(workflowProblems(WF), [])
  })

  await check('workflow mutants: each broken promise is caught', () => {
    const mutants = [
      ['default back to copy', ['\n        default: verify-only\n', '\n        default: copy\n']],
      ['guard step removed', ['node ops/scripts/ops-r2-retire.mjs guard-copy-modes', 'node ops/scripts/ops-r2.mjs delete-worker']],
      ['guard reads no mode', ['          OPS_R2_MODE: ${{ inputs.mode }}\n        run: node ops/scripts/ops-r2-retire.mjs guard-copy-modes', '        run: node ops/scripts/ops-r2-retire.mjs guard-copy-modes']],
      ['retire not in production', ['    if: inputs.task == \'r2-old-retire\'\n    runs-on: windows-latest\n    environment: production', '    if: inputs.task == \'r2-old-retire\'\n    runs-on: windows-latest\n    environment: staging']],
      ['retire bucket names apac', ['OPS_R2_RETIRE_BUCKET: business-os-assets\n', 'OPS_R2_RETIRE_BUCKET: business-os-assets-apac\n']],
      ['retire bucket from an input', ['OPS_R2_RETIRE_BUCKET: business-os-assets\n', 'OPS_R2_RETIRE_BUCKET: ${{ inputs.query }}\n']],
      ['retire confirm not passed on', ['          CONFIRM: ${{ inputs.confirm }}\n        run: node ops/scripts/ops-r2-retire.mjs run', '        run: node ops/scripts/ops-r2-retire.mjs run']],
      ['retire confirm check weakened', ["'r2-old-retire', [System.StringComparison]::Ordinal", "'r2-old-retire', [System.StringComparison]::OrdinalIgnoreCase"]],
    ]
    for (const [label, [from, to]] of mutants) {
      assert.ok(WF.includes(from), `${label}: the mutant must change the workflow`)
      assert.notDeepStrictEqual(workflowProblems(WF.replace(from, () => to)), [], `${label}: the check did not go red`)
    }
  })

  // ---------------------------------------------------------- copy modes
  await check('copy and topup are refused once production reads the apac bucket; verify-only always runs', () => {
    const after = { state: 'destination', buckets: [{ bucket: APAC }] }
    for (const mode of ['copy', 'topup']) {
      assert.throws(() => real.checkCopyModeAllowed({ mode, productionState: after }), (e) => e.code === 'refused-after-switch', mode)
    }
    for (const state of ['destination', 'source', 'mixed', 'unknown']) assert.doesNotThrow(() => real.checkCopyModeAllowed({ mode: 'verify-only', productionState: { state } }), state)
    assert.doesNotThrow(() => real.checkCopyModeAllowed({ mode: 'copy', productionState: { state: 'source' } }), 'copy before the switch is the driver\'s own call')
  })

  await check('copy-mode mutant: a guard that lets topup (or copy) through after the switch is caught', async () => {
    const mutant = await loadVariant([["if (productionState && productionState.state === 'destination') throw", "if (productionState && productionState.state === 'destination' && mode === 'copy') throw"]])
    const after = { state: 'destination', buckets: [{ bucket: APAC }] }
    let caught = 0
    for (const mode of ['copy', 'topup']) {
      try { mutant.checkCopyModeAllowed({ mode, productionState: after }) } catch { caught += 1 }
    }
    assert.strictEqual(caught, 1, 'the mutant lets exactly one mode through, so the real test above goes red for it')
    const dead = await loadVariant([["if (mode === 'verify-only') return\n", '']])
    assert.throws(() => dead.checkCopyModeAllowed({ mode: 'verify-only', productionState: { state: 'destination' } }), 'a guard that refuses verify-only is caught too')
  })

  // ------------------------------------------------------------ retire guards
  await check('retire: plan counts per top folder and returns no key', async () => {
    const fake = fakeApi({ objects: objs('uploads/a.webp', 'uploads/b.webp', 'backups/cloudflare/x.json', 'Alice Tan invoice.pdf') })
    const r = await real.runRetire({ api: fake.api, accountId: ACCOUNT, ...INPUT })
    assert.strictEqual(r.ok, true)
    assert.deepStrictEqual(r.counts.folders, { uploads: { objects: 2, bytes: 300 }, backups: { objects: 1, bytes: 300 }, other: { objects: 1, bytes: 400 } })
    assert.strictEqual(r.counts.objects, 4)
    assert.ok(!fake.calls.some((c) => WRITES.test(c)), 'plan wrote something')
    const text = JSON.stringify(r) + JSON.stringify(real.publicLines(r))
    assert.ok(!/Alice|invoice|a\.webp|x\.json/.test(text), 'a key name reached the result')
  })

  await check('retire: expire puts one lifecycle rule (1 day, every object) and reads it back', async () => {
    const fake = fakeApi({ objects: objs('uploads/a.webp') })
    const r = await real.runRetire({ api: fake.api, accountId: ACCOUNT, ...INPUT, mode: 'expire' })
    assert.deepStrictEqual([r.ok, r.counts.expiringRules], [true, 1])
    assert.deepStrictEqual(fake.calls.filter((c) => WRITES.test(c)), [`PUT /accounts/${ACCOUNT}/r2/buckets/${OLD}/lifecycle`])
    const body = real.lifecycleBody().rules.find((x) => x.deleteObjectsTransition)
    assert.deepStrictEqual([body.conditions.prefix, body.deleteObjectsTransition.condition], ['', { type: 'Age', maxAge: 86400 }])
    const lost = fakeApi({ lifecycleStored: false })
    const bad = await real.runRetire({ api: lost.api, accountId: ACCOUNT, ...INPUT, mode: 'expire' })
    assert.deepStrictEqual([bad.ok, bad.problems], [false, ['lifecycle-not-confirmed']], 'a rule that did not stick is not a pass')
  })

  await check('retire: delete-bucket deletes an empty bucket and confirms it is gone, and refuses a bucket with objects', async () => {
    const empty = fakeApi({ objects: [] })
    const ok = await real.runRetire({ api: empty.api, accountId: ACCOUNT, ...INPUT, mode: 'delete-bucket' })
    assert.deepStrictEqual([ok.ok, ok.counts.deleted], [true, 1])
    assert.deepStrictEqual(empty.calls.filter((c) => WRITES.test(c)), [`DELETE /accounts/${ACCOUNT}/r2/buckets/${OLD}`])
    const full = fakeApi({ objects: objs('uploads/a.webp') })
    const no = await real.runRetire({ api: full.api, accountId: ACCOUNT, ...INPUT, mode: 'delete-bucket' })
    assert.deepStrictEqual([no.ok, no.problems, no.counts.objects], [false, ['bucket-not-empty'], 1])
    assert.ok(!full.calls.some((c) => WRITES.test(c)), 'delete with objects left made a write')
  })

  await check('retire: each guard refuses before anything is changed', async () => {
    const cases = [
      ['a wrong bucket name', { bucket: 'business-os-assets-old' }, 'refused-bucket-name'],
      ['no bucket name', { bucket: undefined }, 'refused-bucket-name'],
      ['the apac name', { bucket: APAC }, 'refused-apac-bucket'],
      ['a name containing apac', { bucket: 'xAPACx' }, 'refused-apac-bucket'],
      ['a missing confirm', { confirm: '' }, 'refused-confirm'],
      ['a wrong confirm', { confirm: 'R2-OLD-RETIRE' }, 'refused-confirm'],
      ['a mode that is not a retire mode', { mode: 'copy' }, 'bad-mode'],
    ]
    for (const [label, change, code] of cases) {
      for (const mode of ['plan', 'expire', 'delete-bucket']) {
        const fake = fakeApi({ objects: [] })
        assert.strictEqual(await refusal(real, { ...INPUT, mode, ...change }, fake), code, `${label} (${mode})`)
        assert.deepStrictEqual(fake.calls, [], `${label} (${mode}): a call was made`)
      }
    }
    for (const production of ['source', 'other']) {
      for (const mode of ['plan', 'expire', 'delete-bucket']) {
        const fake = fakeApi({ production, objects: [] })
        assert.strictEqual(await refusal(real, { ...INPUT, mode }, fake), 'production-not-on-apac', `${production} ${mode}`)
        assert.ok(!fake.calls.some((c) => WRITES.test(c) || /objects/.test(c)), `${production} ${mode}: the bucket was touched`)
      }
    }
  })

  await check('retire mutants: removing any one guard turns this test red', async () => {
    const mutants = [
      ['bucket name check removed', "  if (name !== OLD_BUCKET) throw new OpsError('refused-bucket-name', 'Only the old bucket may be retired.')\n", '',
        async (m) => (await refusal(m, { ...INPUT, bucket: 'business-os-assets-old' }, fakeApi())) === 'refused-bucket-name'],
      ['apac check removed', "  if (name.toLowerCase().includes('apac')) throw new OpsError('refused-apac-bucket', 'The bucket name names the live apac bucket.')\n", '',
        async (m) => (await refusal(m, { ...INPUT, bucket: APAC }, fakeApi())) === 'refused-apac-bucket'],
      ['confirm check removed', "  if (confirm !== CONFIRM_WORD) throw new OpsError('refused-confirm', 'The confirm word is missing or wrong.')\n", '',
        async (m) => (await refusal(m, { ...INPUT, confirm: '' }, fakeApi())) === 'refused-confirm'],
      ['delete with objects left', "  if (l.objects !== 0) {\n    out.problems.push('bucket-not-empty')\n    return out\n  }\n", '',
        async (m) => { const f = fakeApi({ objects: objs('uploads/a') }); await refusal(m, { ...INPUT, mode: 'delete-bucket' }, f); return !f.calls.some((c) => WRITES.test(c)) }],
      ['production binding check removed', '  checkProduction(await productionAssetsState(api, accountId))\n', '',
        async (m) => { const f = fakeApi({ production: 'source' }); return (await refusal(m, { ...INPUT, mode: 'delete-bucket' }, f)) === 'production-not-on-apac' && !f.calls.some((c) => WRITES.test(c)) }],
    ]
    for (const [label, from, to, stillRefuses] of mutants) {
      assert.strictEqual(await stillRefuses(real), true, `${label}: the real code must pass its own probe`)
      const mutant = await loadVariant([[from, to]])
      assert.strictEqual(await stillRefuses(mutant), false, `${label}: the probe did not catch the mutant`)
    }
  })

  await check('retire: the bucket name is one constant and the live bucket is never a path in a write', async () => {
    assert.strictEqual(real.OLD_BUCKET, OLD)
    assert.strictEqual(real.CONFIRM_WORD, 'r2-old-retire')
    const src = read('ops', 'scripts', 'ops-r2-retire.mjs')
    assert.strictEqual((src.match(/'business-os-assets'/g) || []).length, 1, 'the bucket name is written once')
    assert.ok(!/business-os-assets-apac/.test(src.replace(/\/\/.*$/gm, '')), 'the code never writes the apac name (it takes it from ops-r2-lib)')
    assert.ok(!/wrangler|runWrangler/i.test(src.replace(/\/\/.*$/gm, '')), 'REST only')
    for (const mode of ['plan', 'expire', 'delete-bucket']) {
      const fake = fakeApi({ objects: [] })
      await real.runRetire({ api: fake.api, accountId: ACCOUNT, ...INPUT, mode })
      assert.ok(!fake.calls.some((c) => c.includes(`/buckets/${APAC}`)), `${mode} touched the apac bucket`)
    }
  })

  await check('retire: the public lines carry counts only', async () => {
    const fake = fakeApi({ objects: objs('uploads/a.webp', 'imports/x/incoming/Person Name.xlsx') })
    const r = await real.runRetire({ api: fake.api, accountId: ACCOUNT, ...INPUT })
    const common = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-common.mjs')).href)
    const lines = real.publicLines(r).map(([t, v]) => common.formatPublic(t, v))
    assert.ok(lines.includes('r2-old-retire plan: counts only') && lines.includes('objects: 2') && lines.includes('folder uploads: 1 objects, 100 bytes'), lines.join(' | '))
    assert.ok(!/Person|\.xlsx|\.webp/.test(lines.join('\n')))
  })

  console.log(`test-ops-r2-retire-pure: ${passed} checks passed`)
  fs.rmSync(SCRATCH, { recursive: true, force: true })
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
