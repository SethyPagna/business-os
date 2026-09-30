#!/usr/bin/env node
// Offline checks for the owner-run release kit (run\release.bat ->
// ops/scripts/deploy-kit/) and the GitHub deploy workflows. Nothing here
// touches the network or Cloudflare:
//   1. every npm script / file / wrangler sub-command the kit calls exists;
//   2. no step runs --remote, deploy, rollback or restore without a
//      confirmation gate (catalogue, runtime guard, and a real -DryRun walk);
//   3. the kit never reads or copies the credential files itself;
//   4. the challenge detector classifies the challenge and normal fixtures;
//   5. the workflows are manual-only, gated, and never echo a secret;
//   6. the pure helpers (counts comparison, certificates, release folder);
//   7. the live step confirms the published version through the Cloudflare API
//      when the site challenges the runner (network and Cloudflare stubbed).
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const KIT = path.join(ROOT, 'ops', 'scripts', 'deploy-kit')
const lib = require(path.join(KIT, 'lib.cjs'))

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}
// Normalise CRLF: Windows checkouts (core.autocrlf=true) must read the same text as CI.
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')
const pkg = (name) => JSON.parse(read(name, 'package.json')).scripts

// ------------------------------------------------------------- 1. exists

check('every npm script the kit declares exists', () => {
  for (const [name, scripts] of Object.entries(lib.NPM_SCRIPTS_USED)) {
    const have = pkg(name)
    for (const s of scripts) assert.ok(have[s], `${name}/package.json has no "${s}" script`)
  }
})

check('every npm script the kit source calls is declared and exists', () => {
  const src = read('ops', 'scripts', 'deploy-kit', 'release.cjs')
  const called = [...src.matchAll(/npmLocal\('([^']+)'/g)].map((m) => m[1])
  assert.ok(called.length >= 3, 'expected npmLocal calls')
  for (const s of called) {
    assert.ok(pkg('frontend')[s] || pkg('cloudflare')[s], `npm script ${s} exists in neither package`)
  }
  for (const spec of lib.sampleCatalog()) {
    if (spec.kind === 'npm') assert.ok(pkg(spec.pkg)[spec.script], `${spec.pkg} has no ${spec.script}`)
  }
})

check('the npm scripts run\\*.bat call through PowerShell exist', () => {
  for (const [file, dir] of [['full-automation.ps1', ''], ['verify-local.ps1', '']]) {
    const src = read('ops', 'scripts', 'powershell', file)
    for (const m of src.matchAll(/npm run ([\w:.-]+)/g)) {
      assert.ok(pkg('frontend')[m[1]] || pkg('cloudflare')[m[1]], `${file}${dir}: npm run ${m[1]} does not exist`)
    }
  }
  for (const bat of ['full-automation.bat', 'verify-local.bat', 'release.bat']) {
    const src = read('run', bat)
    for (const m of src.matchAll(/%ROOT%\\([^"\s]+)/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, m[1])), `${bat} points at missing ${m[1]}`)
    }
  }
})

check('the files the kit relies on exist', () => {
  for (const p of [
    'cloudflare/scripts/with-wrangler-auth.cjs', 'cloudflare/scripts/deploy.cjs',
    'cloudflare/wrangler.toml', 'cloudflare/wrangler.free.toml', 'run/verify-local.bat', 'run/full-automation.bat',
  ]) assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} missing`)
  const toml = read('cloudflare', 'wrangler.toml')
  for (const db of lib.DATABASES) {
    assert.ok(toml.includes(`database_name = "${db.name}"`), `wrangler.toml has no ${db.name}`)
    assert.ok(toml.includes(`migrations_dir = "${db.migrationsDir}"`), `wrangler.toml has no ${db.migrationsDir}`)
    assert.ok(pkg('cloudflare')[db.applyScript].includes(`apply ${db.name} --remote`), `${db.applyScript} does not apply ${db.name}`)
  }
})

check('the key tables exist in the migrations', () => {
  const init = read('cloudflare', 'migrations', '0001_init.sql')
  for (const t of lib.KEY_TABLES) assert.ok(new RegExp(`CREATE TABLE (IF NOT EXISTS )?${t}\\b`).test(init), `no table ${t}`)
})

check('every wrangler sub-command the kit calls exists (local --help, offline)', () => {
  const bin = path.join(ROOT, 'cloudflare', 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  if (!fs.existsSync(bin)) { console.log('  (wrangler not installed here; sub-command check skipped)'); return }
  for (const sub of lib.WRANGLER_SUBCOMMANDS_USED) {
    const r = spawnSync(process.execPath, [bin, ...sub, '--help'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } })
    assert.strictEqual(r.status, 0, `wrangler ${sub.join(' ')} --help failed`)
    assert.ok(!/Unknown (argument|command)/i.test(r.stdout + r.stderr), `wrangler ${sub.join(' ')} unknown`)
  }
})

// -------------------------------------------------------------- 2. gates

check('every production command in the catalogue has a confirmation gate', () => {
  const specs = lib.sampleCatalog()
  const prod = specs.filter(lib.isProductionSpec)
  assert.ok(prod.length >= 12, `expected the production commands to be recognised, got ${prod.length}`)
  for (const s of prod) assert.ok(lib.GATE_RANK[s.gate] >= 1, `${s.id} has gate ${s.gate}`)
  for (const s of specs.filter((x) => x.args.includes('--remote') || /deploy|rollback|restore|apply|remote/.test(x.id))) {
    assert.ok(lib.isProductionSpec(s), `${s.id} is not recognised as production`)
  }
  const byId = Object.fromEntries(specs.map((s) => [s.id, s]))
  assert.strictEqual(byId['deploy:paid'].gate, 'typeYES')
  assert.strictEqual(byId['migrations-apply:business-os'].gate, 'typeYES')
  assert.strictEqual(byId['migrations-apply:business-os-import'].gate, 'typeYES')
  assert.strictEqual(byId['rollback-worker'].gate, 'double')
  assert.strictEqual(byId['restore:business-os'].gate, 'double')
  assert.ok(!lib.isProductionSpec(byId.whoami), 'whoami reads nothing from production')
})

check('the runtime guard refuses unconfirmed or under-confirmed production commands', () => {
  const deploy = lib.commandCatalog.deploy('paid')
  assert.throws(() => lib.assertApproved(deploy, null), /not confirmed/)
  assert.throws(() => lib.assertApproved(deploy, { ok: false, gate: 'typeYES' }), /not confirmed/)
  assert.throws(() => lib.assertApproved(deploy, { ok: true, gate: 'confirm' }), /needs a "typeYES"/)
  assert.ok(lib.assertApproved(deploy, { ok: true, gate: 'typeYES' }))
  const restore = lib.commandCatalog.restoreDatabase('business-os', 'b')
  assert.throws(() => lib.assertApproved(restore, { ok: true, gate: 'typeYES' }), /needs a "double"/)
  assert.throws(() => lib.assertApproved({ id: 'x', kind: 'wrangler', args: ['deploy'], gate: 'none' }, { ok: true, gate: 'double' }), /no confirmation gate/)
  assert.ok(lib.assertApproved(lib.commandCatalog.whoami(), null))
})

check('only exec.cjs starts processes, and production commands only come from the catalogue', () => {
  const release = read('ops', 'scripts', 'deploy-kit', 'release.cjs')
  const exec = read('ops', 'scripts', 'deploy-kit', 'exec.cjs')
  assert.ok(!/child_process/.test(release), 'release.cjs must not start processes itself')
  assert.ok(!/['"`]--remote['"`]/.test(release + exec), '--remote may only appear in lib.cjs commandCatalog')
  assert.ok(!/['"`](deploy|deploy:free|rollback|restore|migrate:remote|migrate:import:remote|secrets:sync)['"`]/.test(release + exec), 'production words may only appear in lib.cjs')
  assert.ok(/lib\.assertApproved\(spec, approval\)/.test(exec), 'runSpec must call assertApproved')
  assert.ok(/isProductionSpec\(spec\)\) throw/.test(exec), 'runLocal must refuse production-shaped commands')
  // Every runSpec call in release.cjs passes an approval from confirm(), except whoami.
  for (const m of release.matchAll(/ex\.runSpec\(([^,]+),\s*ctx,\s*([^,)]+)/g)) {
    if (/whoami/.test(m[1])) continue
    assert.ok(/approval|write/.test(m[2]), `runSpec(${m[1]}) without an approval`)
  }
})

check('a -DryRun walk asks for confirmation before every production command', () => {
  const records = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-kit-test-'))
  try {
    const r = spawnSync(process.execPath, [path.join(KIT, 'release.cjs'), 'menu', '-DryRun', '-Records', records], {
      encoding: 'utf8', timeout: 120000, input: '', env: { ...process.env, BUSINESS_OS_HOME: records },
    })
    assert.strictEqual(r.status, 0, `dry run failed: ${r.stderr}${r.stdout.slice(-2000)}`)
    const lines = r.stdout.split(/\r?\n/)
    let asked = ''
    let prodSeen = 0
    for (const line of lines) {
      if (/would ask for a "(confirm|typeYES|double)"/.test(line)) { asked = /"(\w+)"/.exec(line)[1]; continue }
      if (/^\[dry-run\] \(in /.test(line)) {
        const isProd = /--remote|npm run (deploy|migrate:)|wrangler (rollback|d1 time-travel|deployments)|full-automation\.bat/.test(line)
        if (isProd) {
          prodSeen += 1
          assert.ok(asked, `production command without a question before it: ${line}`)
          if (/npm run (deploy|migrate:)|full-automation/.test(line)) assert.ok(lib.GATE_RANK[asked] >= 2, `write without typed YES: ${line}`)
          if (/rollback|time-travel restore/.test(line)) assert.strictEqual(asked, 'double', `undo without double confirmation: ${line}`)
        }
      }
      if (/^={10,}/.test(line)) asked = ''
    }
    assert.ok(prodSeen >= 12, `expected the walk to reach the production commands, saw ${prodSeen}`)
    assert.ok(/Full log: /.test(r.stdout), 'the run must end by printing the log location')
  } finally {
    fs.rmSync(records, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------- 3. credentials

check('the kit never reads or copies the credential files', () => {
  const files = [
    ...fs.readdirSync(KIT).filter((f) => /\.(c?js|mjs|ps1)$/.test(f)).map((f) => path.join(KIT, f)),
    path.join(ROOT, 'run', 'release.bat'),
    path.join(ROOT, '.github', 'workflows', 'deploy.yml'),
    path.join(ROOT, '.github', 'workflows', 'deploy-rollback.yml'),
  ]
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    assert.ok(!/copyFile|cpSync|\bcopy\b.*\.(wrangler-auth|dev\.vars)|Copy-Item/i.test(src), `${path.basename(file)} copies files`)
    src.split(/\r?\n/).forEach((line, i) => {
      if (/wrangler-auth\.local|\.dev\.vars/.test(line) && !/^\s*(\/\/|#|REM)/i.test(line)) {
        assert.ok(!/readFile|createReadStream|Get-Content|\btype\b|open\(/.test(line), `${path.basename(file)}:${i + 1} reads a credential file`)
        assert.ok(/existsSync/.test(line), `${path.basename(file)}:${i + 1} may only check that the file exists`)
      }
    })
  }
})

check('with-wrangler-auth.cjs passes an environment token through when no saved file exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrangler-auth-test-'))
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'))
    fs.copyFileSync(path.join(ROOT, 'cloudflare', 'scripts', 'with-wrangler-auth.cjs'), path.join(tmp, 'scripts', 'with-wrangler-auth.cjs'))
    const r = spawnSync(process.execPath, [
      path.join(tmp, 'scripts', 'with-wrangler-auth.cjs'), process.execPath, '-e',
      'process.exit(process.env.CLOUDFLARE_API_TOKEN === "fixture-not-a-token" ? 0 : 3)',
    ], { encoding: 'utf8', cwd: tmp, env: { ...process.env, CLOUDFLARE_API_TOKEN: 'fixture-not-a-token' } })
    assert.strictEqual(r.status, 0, `token not passed through (${r.status}) ${r.stderr}`)
    assert.ok(/using CLOUDFLARE_API_TOKEN from the environment/.test(r.stderr), 'expected the CI message')
    assert.ok(!/fixture-not-a-token/.test(r.stdout + r.stderr), 'the token value must never be printed')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ----------------------------------------------------------- 4. challenge

check('challenge fixtures are classified as challenge', () => {
  const fixtures = JSON.parse(fs.readFileSync(path.join(KIT, 'fixtures', 'challenge-responses.json'), 'utf8'))
  assert.ok(fixtures.length >= 2)
  for (const f of fixtures) assert.strictEqual(lib.classifyResponse(f), 'challenge', f.name)
})

check('normal fixtures are not classified as challenge', () => {
  const fixtures = JSON.parse(fs.readFileSync(path.join(KIT, 'fixtures', 'normal-responses.json'), 'utf8'))
  assert.ok(fixtures.length >= 2)
  for (const f of fixtures) assert.strictEqual(lib.classifyResponse(f), f.expect, f.name)
  assert.strictEqual(lib.classifyResponse(null), 'error')
})

// ----------------------------------------------------------- 5. workflows

for (const [file, word] of [['deploy.yml', 'DEPLOY'], ['deploy-rollback.yml', 'ROLLBACK']]) {
  check(`${file}: manual only, production environment, confirm gate, secrets never echoed`, () => {
    const y = read('.github', 'workflows', file)
    const on = /^on:\n([\s\S]*?)^\S/m.exec(y)
    assert.ok(on, 'no on: block')
    const triggers = [...on[1].matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1])
    assert.deepStrictEqual(triggers, ['workflow_dispatch'], `triggers: ${triggers}`)
    assert.ok(!/pull_request_target|pull_request|^\s*push:|schedule:|workflow_run|repository_dispatch/m.test(y), 'extra trigger')
    assert.ok(/^\s+environment: production$/m.test(y), 'environment: production')
    assert.ok(/^permissions:\n {2}contents: read\n/m.test(y), 'permissions: contents: read')
    assert.ok(/^concurrency:\n {2}group: production-deploy\n/m.test(y), 'concurrency group')
    assert.ok(/ confirm:\n[\s\S]*?type: string/.test(y), 'confirm input')
    // Ordinal, byte for byte: PowerShell's -cne compares by culture and admits look-alikes
    // (test-ops-workflow-pure.cjs runs these checks under PowerShell with such words).
    const gate = `if (-not [string]::Equals($env:CONFIRM, '${word}', [System.StringComparison]::Ordinal)) {`
    assert.ok(y.includes(gate) && /\[System\.StringComparison\]::Ordinal\)\) \{[\s\S]*?exit 1/.test(y), `the job must stop unless confirm is exactly ${word}`)
    const confirmLines = y.split('\n').filter((l) => /\$env:CONFIRM/.test(l)).join('\n')
    assert.ok(!/\s-[ci]?(ne|eq|like|notlike|match|notmatch)\b/i.test(confirmLines), `no culture-aware comparison operator on the confirm word: ${confirmLines}`)
    for (const [i, line] of y.split('\n').entries()) {
      if (/secrets\./.test(line)) {
        assert.ok(/^\s+[A-Z_]+: \$\{\{ secrets\.(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID) \}\}$/.test(line), `line ${i + 1}: secrets only via env: (${line.trim()})`)
      }
      assert.ok(!/(echo|Write-(Output|Host)|\bprint)\b.*(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|secrets\.)/i.test(line), `line ${i + 1} echoes a secret`)
    }
    // Inputs reach shell commands only through env: (no ${{ inputs.x }} inside run: bodies).
    for (const block of y.split(/\n\s+- name: /).slice(1)) {
      const run = /\n\s+run: \|?([\s\S]*)$/.exec(block)
      if (run) assert.ok(!/\$\{\{\s*inputs\./.test(run[1]), `inputs interpolated into a run: script in step "${block.split('\n')[0]}"`)
    }
    assert.ok(!/secrets:sync|secret put/.test(y), 'CI must never sync secrets')
    assert.ok(!/persist-credentials: true/.test(y), 'checkout must not persist credentials')
    for (const m of y.matchAll(/uses: ([^\s]+)/g)) assert.ok(/@v\d+$/.test(m[1]), `${m[1]} must be pinned to a major version`)
  })
}

check('deploy.yml gives no Cloudflare secret to the test step', () => {
  const y = read('.github', 'workflows', 'deploy.yml')
  const gates = /- name: Safety tests[\s\S]*?(?=\n\s+- name: )/.exec(y)
  assert.ok(gates, 'gates step')
  assert.ok(!/secrets\./.test(gates[0]), 'the test step must not see secrets')
  assert.ok(/-NoApply/.test(y) && /RUN_MIGRATIONS/.test(y), 'run_migrations input wired')
})

// ------------------------------------------------------------ 6. helpers

check('parseArgs accepts PowerShell and GNU spellings', () => {
  const a = lib.parseArgs(['deploy', '-DryRun', '-Plan', 'free', '--ref=abc'])
  assert.strictEqual(a.command, 'deploy'); assert.strictEqual(a.dryRun, true); assert.strictEqual(a.plan, 'free'); assert.strictEqual(a.ref, 'abc')
  assert.throws(() => lib.parseArgs(['-Plan', 'gold']), /paid or free/)
  assert.throws(() => lib.parseArgs(['-Force']), /Unknown option/)
})

check('counts comparison: equal ok, migration and live traffic warn, loss fails', () => {
  const pre = Object.fromEntries(lib.KEY_TABLES.map((t) => [t, 10]))
  assert.ok(lib.compareCounts(pre, { ...pre }).ok)
  const grew = lib.compareCounts(pre, { ...pre, sales: 12 })
  assert.ok(grew.ok); assert.strictEqual(grew.warnings[0].verdict, 'grew-live-traffic')
  const mig = lib.compareCounts(pre, { ...pre, products: 7 }, new Set(['products']))
  assert.ok(mig.ok); assert.strictEqual(mig.warnings[0].verdict, 'changed-by-migration')
  const lost = lib.compareCounts(pre, { ...pre, sales: 9 })
  assert.ok(!lost.ok); assert.strictEqual(lost.failed[0].table, 'sales')
  const productsGrew = lib.compareCounts(pre, { ...pre, products: 11 })
  assert.ok(!productsGrew.ok, 'products is not written by the till, so an unexplained change fails')
})

check('row counts: one D1-safe query (no compound SELECT) and a strict one-row parser', () => {
  // D1 refused the old one-UNION-ALL-term-per-table query with this exact
  // error, so the release stopped at the snapshot on its first CI run.
  const sql = lib.countsSql()
  assert.ok(!/\b(UNION|INTERSECT|EXCEPT)\b/i.test(sql), 'D1 caps compound SELECT terms; the counts query must use none')
  for (const t of lib.KEY_TABLES) assert.ok(sql.includes(`(SELECT COUNT(*) FROM ${t}) AS ${t}`), `${t} must be counted`)
  const row = Object.fromEntries(lib.KEY_TABLES.map((t, i) => [t, 100 + i]))
  const ok = lib.parseCounts(lib.parseWranglerJson(`[with-wrangler-auth] note\n${JSON.stringify([{ results: [row], success: true, meta: {} }], null, 2)}\n`))
  assert.deepStrictEqual(ok, row)
  const refused = lib.parseWranglerJson('\n{\n  "error": {\n    "text": "too many terms in compound SELECT: SQLITE_ERROR"\n  }\n}\n')
  assert.strictEqual(lib.parseCounts(refused), null)
  const { returns: _dropped, ...partial } = row
  assert.strictEqual(lib.parseCounts([{ results: [partial] }]), null, 'a missing table is unreadable, not zero')
  assert.strictEqual(lib.parseCounts([{ results: [row, row] }]), null, 'more than the one summary row is unexpected')
})

check('the saved rollback target is the live Worker VERSION, not the deployment id listed first', () => {
  // Field order of `wrangler deployments status --json`: the deployment's own
  // id precedes versions[]. The first UUID in the text is therefore the wrong one.
  const dep = { id: 'aaaaaaaa-0000-4000-8000-000000000001', source: 'wrangler', strategy: 'percentage', annotations: {},
    versions: [{ version_id: 'bbbbbbbb-0000-4000-8000-000000000002', percentage: 100 }], created_on: '2026-09-24T21:48:00Z' }
  assert.strictEqual(lib.liveVersionId(lib.parseWranglerJson(`[with-wrangler-auth] note\n${JSON.stringify(dep, null, 2)}`)), 'bbbbbbbb-0000-4000-8000-000000000002')
  const split = { ...dep, versions: [{ version_id: 'cccccccc-0000-4000-8000-000000000003', percentage: 10 }, { version_id: 'dddddddd-0000-4000-8000-000000000004', percentage: 90 }] }
  assert.strictEqual(lib.liveVersionId(split), 'dddddddd-0000-4000-8000-000000000004', 'with split traffic, the version carrying most of it')
  assert.strictEqual(lib.liveVersionId(null), '')
  assert.strictEqual(lib.liveVersionId({ id: dep.id }), '', 'no versions[] -> unknown, never the deployment id')
  const src = read('ops', 'scripts', 'deploy-kit', 'release.cjs')
  assert.ok(/previousVersionId = lib\.liveVersionId\(dep\.json\)/.test(src), 'stepSnapshot must save the version id')
})

check('row counts stay out of the public CI log and summary; local runs still show them', () => {
  const pre = Object.fromEntries(lib.KEY_TABLES.map((t, i) => [t, 48210 + i]))
  const cmp = lib.compareCounts(pre, { ...pre, sales: pre.sales + 6, products: pre.products - 2 })
  const ci = [lib.countsLines(cmp.rows, { ci: true }), lib.countsLines(lib.KEY_TABLES.map((t) => ({ table: t, pre: pre[t] })), { ci: true }),
    ...cmp.rows.map((r) => lib.countChange(r, { ci: true }))].join('\n')
  for (const n of Object.values(pre)) assert.ok(!ci.includes(String(n)), `CI output must not show a table size (${n})`)
  assert.ok(ci.includes('grew-live-traffic (+6 rows)') && ci.includes('UNEXPECTED (-2 rows)'), 'CI output still says what changed and by how much')
  assert.ok(lib.countsLines(cmp.rows).includes(String(pre.sales)), 'a local run keeps the full numbers')
  const src = read('ops', 'scripts', 'deploy-kit', 'release.cjs')
  assert.ok(!/\$\{\s*[a-z]\.(?:pre|post)\b/.test(src), 'release.cjs must print counts through lib.countsLines / lib.countChange')
})

check('migration list parsing, first comment and touched tables', () => {
  const out = 'Migrations to be applied:\n│ 0195_example_one.sql │\n│ 0196_example-two.sql │\n'
  assert.deepStrictEqual(lib.parseMigrationNames(out), ['0195_example_one.sql', '0196_example-two.sql'])
  assert.deepStrictEqual(lib.parseMigrationNames('✅ No migrations to apply!'), [])
  assert.strictEqual(lib.firstCommentLine('\n-- -----\n-- Adds the thing.\nCREATE TABLE x (a);'), 'Adds the thing.')
  const t = lib.tablesTouched('ALTER TABLE products ADD COLUMN x;\nUPDATE sales SET a=1;\n-- DELETE FROM customers\nINSERT OR IGNORE INTO settings VALUES (1);')
  assert.deepStrictEqual([...t].sort(), ['products', 'sales', 'settings'])
})

check('live version check needs the exact commit, a clean stamp and the plan', () => {
  const sha = 'a0064847eab5d52bf4bab2b89e4096f7f5d17ec8'
  assert.ok(lib.checkVersion({ revision: 'a0064847eab5', tier: 'paid' }, sha, 'paid').ok)
  assert.ok(!lib.checkVersion({ revision: 'a0064847eab5-dirty', tier: 'paid' }, sha, 'paid').ok)
  assert.ok(!lib.checkVersion({ revision: '42beebf92b46', tier: 'paid' }, sha, 'paid').ok)
  assert.ok(!lib.checkVersion({ revision: 'a0064847eab5', tier: 'free' }, sha, 'paid').ok)
  assert.ok(!lib.checkVersion(null, sha, 'paid').ok)
})

check('live plan verification accepts matching Paid and Free profiles', () => {
  const sha = 'a0064847eab5d52bf4bab2b89e4096f7f5d17ec8'
  const revision = sha.slice(0, 12)
  for (const plan of ['paid', 'free']) {
    assert.deepStrictEqual(lib.checkVersion({ revision, tier: plan }, sha, plan), { ok: true, problems: [], revision })
    const otherPlan = plan === 'paid' ? 'free' : 'paid'
    const mismatch = lib.checkVersion({ revision, tier: otherPlan }, sha, plan)
    assert.strictEqual(mismatch.ok, false)
    assert.deepStrictEqual(mismatch.problems, [`tier is ${otherPlan}, expected ${plan}`])
  }
  assert.ok(lib.checkVersion({ revision }, sha).ok, 'revision-only callers need no reported plan')
})

check('live plan verification rejects absent or empty tier with an actionable reason', () => {
  const sha = 'a0064847eab5d52bf4bab2b89e4096f7f5d17ec8'
  for (const plan of ['paid', 'free']) {
    for (const tier of [undefined, null, '']) {
      const result = lib.checkVersion({ revision: sha.slice(0, 12), tier }, sha, plan)
      assert.strictEqual(result.ok, false, `${plan}: missing tier must not pass`)
      assert.deepStrictEqual(result.problems, [`no tier reported, expected ${plan}`])
    }
  }
})

check('live plan verification rejects malformed or unknown reported profiles', () => {
  const sha = 'a0064847eab5d52bf4bab2b89e4096f7f5d17ec8'
  for (const plan of ['paid', 'free']) {
    for (const tier of [' ', 'Paid', 'enterprise', false, 0, {}, ['paid']]) {
      const result = lib.checkVersion({ revision: sha.slice(0, 12), tier }, sha, plan)
      assert.strictEqual(result.ok, false, `${plan}: malformed tier must not pass`)
      assert.deepStrictEqual(result.problems, [`invalid tier reported, expected ${plan}`])
    }
  }
})

check('certificates must name the exact full sha', () => {
  const sha = 'a0064847eab5d52bf4bab2b89e4096f7f5d17ec8'
  assert.strictEqual(lib.certFileName(sha), `release-cert-${sha}.txt`)
  assert.ok(lib.certMatches(`certified by Claude\nsha: ${sha}\n`, sha))
  assert.ok(!lib.certMatches(`sha: ${sha.slice(0, 12)}`, sha))
  assert.ok(!lib.certMatches('sha: 42beebf92b46c03b3a08d2a7788f96b6bfb65323', sha))
  assert.ok(!lib.certMatches(`sha: ${sha}`, sha.slice(0, 12)))
})

check('the release folder is never a working, branch or recovery checkout', () => {
  const base = path.resolve(os.tmpdir(), 'bos')
  const opts = { protectedPaths: [path.join(base, 'Source')], branchWorktrees: [path.join(base, 'Worktrees', 'lane')] }
  assert.strictEqual(lib.forbiddenReleasePath(path.join(base, 'Worktrees', 'release'), opts), '')
  assert.ok(lib.forbiddenReleasePath(path.join(base, 'Source'), opts))
  assert.ok(lib.forbiddenReleasePath(path.join(base, 'Worktrees', 'lane'), opts))
  assert.ok(lib.forbiddenReleasePath(path.join(base, 'Recovery', 'x'), opts))
  assert.ok(lib.forbiddenReleasePath(path.join(base, 'Worktrees', 'business-os-recovery'), opts))
})

check('the release runs every test file the package runners discover, frontend .test.cjs included', () => {
  // The frontend runner's own discovery rule, read from its source so the two cannot drift apart.
  const chain = read('frontend', 'tests', 'runTestChain.ts')
  const m = /entry\.isFile\(\) && \/((?:\\.|[^/\\])+)\/\.test\(entry\.name\)/.exec(chain)
  assert.ok(m, 'could not find the discovery pattern in frontend/tests/runTestChain.ts')
  const chainRe = new RegExp(m[1])
  const names = fs.readdirSync(path.join(ROOT, 'frontend', 'tests'), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
  const discovered = names.filter((n) => chainRe.test(n)).sort()
  const gated = names.filter((n) => lib.GATE_TEST_FILES.frontend.re.test(`frontend/tests/${n}`)).sort()
  assert.ok(discovered.some((n) => n.endsWith('.test.cjs')), 'no frontend .test.cjs file exists, so this check cannot tell a .ts-only pattern apart')
  assert.deepStrictEqual(gated, discovered)
  const cfNames = fs.readdirSync(path.join(ROOT, 'cloudflare', 'scripts')).filter((n) => /^test-.+\.cjs$/.test(n))
  assert.ok(cfNames.length > 0 && cfNames.every((n) => lib.GATE_TEST_FILES.cloudflare.re.test(`cloudflare/scripts/${n}`)))
  const release = read('ops', 'scripts', 'deploy-kit', 'release.cjs')
  assert.ok(!/listAtCommit\(ctx, '[^']*', \//.test(release), 'release.cjs lists test files with its own inline pattern')
  assert.ok(/lib\.GATE_TEST_FILES\.frontend/.test(release) && /lib\.GATE_TEST_FILES\.cloudflare/.test(release))
})

// ------------------------------------------------ 8. free and paid never mixed

const VID = 'bbbbbbbb-0000-4000-8000-000000000002'

check('deploy.yml: the plan input has no default, its first option is a placeholder, and a step stops anything but paid or free', () => {
  const y = read('.github', 'workflows', 'deploy.yml')
  const block = /\n {6}plan:\n([\s\S]*?)\n {6}run_migrations:/.exec(y)
  assert.ok(block, 'plan input block')
  assert.ok(!/^\s+default:/m.test(block[1]), 'a default plan lets a release pick a plan nobody chose')
  assert.ok(/required: true/.test(block[1]) && /type: choice/.test(block[1]))
  const options = [...block[1].matchAll(/^\s+- (\S+)$/gm)].map((m) => m[1])
  assert.deepStrictEqual(options.slice().sort(), ['choose-plan', 'free', 'paid'])
  assert.strictEqual(options[0], 'choose-plan', 'the UI preselects the first option, so it must not be a real plan')
  const guard = /- name: Check the plan choice[\s\S]*?(?=\n\s+- name: )/.exec(y)
  assert.ok(guard, 'a "Check the plan choice" step')
  assert.ok(y.indexOf('Check the plan choice') < y.indexOf('Check out the release kit'), 'the plan is checked before anything is fetched')
  assert.ok(/\$env:PLAN/.test(guard[0]) && /\[System\.StringComparison\]::Ordinal/.test(guard[0]))
  assert.ok(/'paid'/.test(guard[0]) && /'free'/.test(guard[0]) && /exit 1/.test(guard[0]))
})

check('the kit has no default plan: the constant is gone and release.cjs never falls back to paid', () => {
  assert.strictEqual(lib.DEFAULT_PLAN, undefined)
  const src = read('ops', 'scripts', 'deploy-kit', 'release.cjs')
  assert.ok(!/DEFAULT_PLAN/.test(src) && !/askDefault\(ctx, 'Cloudflare plan/.test(src))
})

check('explicitPlan accepts exactly paid or free', () => {
  assert.strictEqual(lib.explicitPlan('paid'), 'paid')
  assert.strictEqual(lib.explicitPlan('free'), 'free')
  for (const bad of ['', undefined, null, 'choose-plan', 'Paid', ' paid', 'gold', 0]) assert.strictEqual(lib.explicitPlan(bad), '', String(bad))
})

check('account plan and version view are read-only production reads with a confirm gate', () => {
  const account = lib.commandCatalog.accountPlan()
  const view = lib.commandCatalog.versionView(VID)
  for (const spec of [account, view]) {
    assert.ok(lib.isProductionSpec(spec), `${spec.id} reads the production account`)
    assert.strictEqual(spec.gate, 'confirm')
    assert.throws(() => lib.assertApproved(spec, null), /not confirmed/)
    assert.ok(lib.assertApproved(spec, { ok: true, gate: 'confirm' }))
  }
  assert.ok(view.args.includes('--json') && view.args.includes('--name') && view.args.includes(VID))
  assert.throws(() => lib.commandCatalog.versionView('../x'), /version id/)
  assert.ok(lib.sampleCatalog().some((s) => s.id === account.id) && lib.sampleCatalog().some((s) => s.id.startsWith('version-view')))
  assert.ok(lib.WRANGLER_SUBCOMMANDS_USED.some((s) => s.join(' ') === 'versions view'))
  assert.ok(fs.existsSync(path.join(KIT, account.file)), 'the account-plan helper the catalogue names exists')
})

check('classifyWorkersPlan: only a live Workers subscription names the plan; anything else is unknown', () => {
  const sub = (id, state = 'Paid') => ({ id: `s-${id}`, state, rate_plan: { id, public_name: id.replace(/_/g, ' ') } })
  const ok = (result) => ({ success: true, result })
  assert.strictEqual(lib.classifyWorkersPlan(ok([sub('workers_paid')])).plan, 'paid')
  assert.strictEqual(lib.classifyWorkersPlan(ok([sub('workers_unlimited')])).plan, 'paid')
  assert.strictEqual(lib.classifyWorkersPlan(ok([sub('workers_free', 'Provisioned')])).plan, 'free')
  assert.strictEqual(lib.classifyWorkersPlan(ok([sub('cf_pro'), sub('workers_paid')])).plan, 'paid', 'other products are ignored')
  assert.strictEqual(lib.classifyWorkersPlan(ok([sub('workers_paid', 'Expired'), sub('workers_free', 'Provisioned')])).plan, 'free', 'an expired Paid is not the plan')
  for (const [name, body] of Object.entries({
    'no Workers subscription listed': ok([sub('cf_pro')]),
    'empty list': ok([]),
    'cancelled Paid alone': ok([sub('workers_paid', 'Cancelled')]),
    'conflicting live subscriptions': ok([sub('workers_paid'), sub('workers_free', 'Provisioned')]),
    'api failure': { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
    'not json': null,
    'result is not a list': { success: true, result: {} },
  })) {
    const r = lib.classifyWorkersPlan(body)
    assert.strictEqual(r.plan, 'unknown', name)
    assert.ok(r.reason.length > 10, `${name}: says why`)
  }
})

check('versionTier reads PLAN_TIER from the version bindings, never from a secret or another name', () => {
  const bindings = (list) => ({ id: VID, resources: { bindings: list } })
  assert.strictEqual(lib.versionTier(bindings([{ type: 'plain_text', name: 'PLAN_TIER', text: 'free' }])), 'free')
  assert.strictEqual(lib.versionTier(bindings([{ type: 'kv_namespace', name: 'CACHE' }, { type: 'plain_text', name: 'PLAN_TIER', text: 'paid' }])), 'paid')
  for (const bad of [
    bindings([]), bindings([{ type: 'secret_text', name: 'PLAN_TIER' }]), bindings([{ type: 'plain_text', name: 'OTHER', text: 'paid' }]),
    { id: VID }, null, 'x', bindings('nope'),
  ]) assert.strictEqual(lib.versionTier(bad), '')
  assert.strictEqual(lib.versionTier(bindings([{ type: 'plain_text', name: 'PLAN_TIER', text: 'Paid ' }])), 'Paid ', 'returned verbatim so checkTier can reject a malformed label')
})

check('checkTier states the same reasons checkVersion always did', () => {
  assert.strictEqual(lib.checkTier('paid', 'paid'), '')
  assert.strictEqual(lib.checkTier('free', 'paid'), 'tier is free, expected paid')
  assert.strictEqual(lib.checkTier('', 'free'), 'no tier reported, expected free')
  assert.strictEqual(lib.checkTier('Paid ', 'paid'), 'invalid tier reported, expected paid')
})

check('checkAccountPlan: the profile must equal the account plan, and unknown fails closed', () => {
  assert.deepStrictEqual(lib.checkAccountPlan('paid', { plan: 'paid' }), { ok: true, problem: '' })
  assert.deepStrictEqual(lib.checkAccountPlan('free', { plan: 'free' }), { ok: true, problem: '' })
  assert.match(lib.checkAccountPlan('paid', { plan: 'free' }).problem, /account is on the free plan.*paid profile/i)
  assert.match(lib.checkAccountPlan('free', { plan: 'paid' }).problem, /account is on the paid plan.*free profile/i)
  for (const reading of [{ plan: 'unknown', reason: 'HTTP 403' }, {}, null, { plan: 'enterprise' }]) {
    const r = lib.checkAccountPlan('paid', reading)
    assert.strictEqual(r.ok, false)
    assert.match(r.problem, /could not be read/i)
  }
  assert.match(lib.checkAccountPlan('paid', { plan: 'unknown', reason: 'HTTP 403' }).problem, /HTTP 403/)
})

check('rollbackPlanVerdict: refuses a target from the wrong profile, warns when it cannot tell', () => {
  const v = (t) => lib.rollbackPlanVerdict(t)
  assert.strictEqual(v({ target: 'paid', live: 'paid', account: 'paid' }).level, 'ok')
  assert.strictEqual(v({ target: 'free', live: 'free', account: '' }).level, 'ok')
  assert.strictEqual(v({ target: 'free', live: 'paid', account: 'paid' }).level, 'refuse')
  assert.strictEqual(v({ target: 'paid', live: 'paid', account: 'free' }).level, 'refuse')
  assert.strictEqual(v({ target: 'free', live: 'paid', account: '' }).level, 'refuse', 'account unreadable: never cross the live profile')
  assert.strictEqual(v({ target: 'paid', live: 'free', account: '' }).level, 'refuse')
  assert.strictEqual(v({ target: 'free', live: 'paid', account: 'free' }).level, 'warn', 'recovering a wrong live profile is allowed, but the queue consumers stay on the live profile')
  assert.match(v({ target: 'free', live: 'paid', account: 'free' }).message, /queue/i)
  assert.strictEqual(v({ target: '', live: 'paid', account: 'paid' }).level, 'warn', 'target unreadable')
  assert.strictEqual(v({ target: 'paid', live: '', account: '' }).level, 'warn', 'nothing to compare with')
  assert.strictEqual(v({ target: 'paid', live: '', account: 'paid' }).level, 'ok', 'the account alone confirms the target')
  assert.strictEqual(v({ target: 'paid', live: 'paid', account: '' }).level, 'ok')
  assert.ok(v({ target: 'free', live: 'paid', account: 'paid' }).message.length > 20)
  assert.ok(v({ target: '', live: '', account: '' }).message.length > 20)
})

// ------------------------- 7. the live step, with the network and Cloudflare stubbed

const ex = require(path.join(KIT, 'exec.cjs'))
const accountPlanHelper = require(path.join(KIT, 'account-plan.cjs'))
const { COMMANDS } = require(path.join(KIT, 'release.cjs'))

async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}

// Swaps the kit's side-effect layer for the duration of fn; always restores it.
async function withStubs(stubs, fn) {
  const saved = Object.fromEntries(Object.keys(stubs).map((k) => [k, ex[k]]))
  const said = []
  const write = process.stdout.write
  const env = { GITHUB_STEP_SUMMARY: process.env.GITHUB_STEP_SUMMARY, RELEASE_CONFIRM: process.env.RELEASE_CONFIRM }
  const summaryFile = path.join(os.tmpdir(), `test-deploy-kit-summary-${process.pid}.md`)
  fs.writeFileSync(summaryFile, '')
  Object.assign(ex, stubs)
  ex.log.say = (t = '') => { said.push(String(t)) }
  process.stdout.write = () => true
  process.env.GITHUB_STEP_SUMMARY = summaryFile
  process.env.RELEASE_CONFIRM = 'DEPLOY'
  try {
    const result = await fn()
    return { result, text: said.join('\n'), summary: fs.readFileSync(summaryFile, 'utf8') }
  } finally {
    Object.assign(ex, saved)
    delete ex.log.say
    process.stdout.write = write
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    fs.rmSync(summaryFile, { force: true })
  }
}

const SHA = 'c64eced5c2311ed361aa1cad25a83bca5811aafe'
const V_BEFORE = 'aaaaaaaa-0000-4000-8000-000000000001'
const V_PUBLISHED = 'bbbbbbbb-0000-4000-8000-000000000002'
const V_OTHER = 'cccccccc-0000-4000-8000-000000000003'
const CHALLENGE = { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }, body: '<!DOCTYPE html><title>Just a moment...</title>' }

// One live step. challenged: the site answers every request with a bot challenge
// (what GitHub's runner gets). api: the version `deployments status` reports,
// or 'fail' when the Cloudflare API does not answer.
function runLive({ ci = true, challenged = true, api = V_PUBLISHED, published = V_PUBLISHED, apiTier = 'paid', plan = 'paid' }) {
  const counts = Object.fromEntries(lib.KEY_TABLES.map((t, i) => [t, 10 + i]))
  const ctx = { ci, dryRun: false, sha: SHA, subject: 'test', site: 'https://site.invalid', plan, ciConfirmWord: 'DEPLOY', recordDir: '', args: {},
    state: { deploy: published ? { versionId: published } : {}, snapshot: { previousVersionId: V_BEFORE, preCounts: counts } } }
  const stubs = {
    httpGet: async (url) => {
      if (challenged) return CHALLENGE
      if (url.endsWith('/api/runtime/version')) return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: SHA.slice(0, 12), tier: 'paid' }) }
      if (url.endsWith('/health')) return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'ok', version: '1' }) }
      return { status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><div id="root"></div>' }
    },
    runSpec: async (spec, _ctx, approval) => {
      lib.assertApproved(spec, approval)
      if (spec.id === 'deployments-status') {
        return api === 'fail' ? { code: 1, out: 'Authentication error [code: 10000]' }
          : { code: 0, out: JSON.stringify({ id: 'dddddddd-0000-4000-8000-000000000009', versions: [{ version_id: api, percentage: 100 }] }) }
      }
      if (spec.id.startsWith('version-view:')) {
        if (apiTier === 'fail') return { code: 1, out: 'Authentication error [code: 10000]' }
        return { code: 0, out: JSON.stringify({ id: spec.id.slice(13), resources: { bindings: apiTier === '' ? [] : [{ type: 'plain_text', name: 'PLAN_TIER', text: apiTier }] } }) }
      }
      if (spec.id === 'counts') return { code: 0, out: JSON.stringify([{ results: [counts], success: true }]) }
      throw new Error(`unexpected command ${spec.id}`)
    },
    // CI uses the real confirm (RELEASE_CONFIRM); a keyboard run would read stdin.
    ...(ci ? {} : { confirm: async () => ({ ok: true, gate: 'confirm' }) }),
  }
  return withStubs(stubs, () => COMMANDS.live(ctx))
}

;(async () => {
  await checkAsync('live, CI, site challenged: passes only because the Cloudflare API confirmed the published version AND its PLAN_TIER', async () => {
    const r = await runLive({})
    assert.strictEqual(r.result, true)
    assert.ok(r.text.includes(`Cloudflare serves Worker version ${V_PUBLISHED}, the one this release published - matches`), 'the version must be confirmed through the API')
    assert.ok(r.text.includes(`Worker version ${V_PUBLISHED} carries PLAN_TIER paid (read through the Cloudflare API) - matches`), 'the plan must be confirmed through the API, not waved through with a warning')
    assert.ok(/Live checks passed with 3 warning\(s\)/.test(r.text), 'the unchecked /health and admin page still show as warnings')
    assert.ok(!/WARNING: .*(PLAN_TIER|tier|plan)/i.test(r.text), 'no warning stands in for the plan check')
    assert.ok(!/^Live checks passed\.$/m.test(r.text))
    assert.ok(r.text.includes("GitHub's runner") && !/VPN/.test(r.text), 'CI wording, never the laptop VPN advice')
    assert.ok(r.summary.includes('### Live checks: OK with warnings'))
  })
  await checkAsync('live, CI, site challenged: another version live is a problem', async () => {
    const r = await runLive({ api: V_OTHER })
    assert.strictEqual(r.result, false)
    assert.ok(r.text.includes(`PROBLEM: Cloudflare serves Worker version ${V_OTHER}, not ${V_PUBLISHED} that this release published`))
    assert.ok(r.summary.includes('### Live checks: PROBLEMS'))
  })
  await checkAsync('live, CI, site challenged and the API silent: unconfirmed is a problem, not a pass', async () => {
    const r = await runLive({ api: 'fail' })
    assert.strictEqual(r.result, false)
    assert.ok(r.text.includes('PROBLEM: the live version could not be confirmed'))
  })
  await checkAsync('live, CI, no recorded version: the version from before the release still live is a problem', async () => {
    const r = await runLive({ api: V_BEFORE, published: '' })
    assert.strictEqual(r.result, false)
    assert.ok(r.text.includes(`PROBLEM: Cloudflare still serves Worker version ${V_BEFORE}, the one from before this release`))
  })
  await checkAsync('live, keyboard run, challenged and the API silent: a warning with the VPN advice, never a bare pass', async () => {
    const r = await runLive({ ci: false, api: 'fail' })
    assert.strictEqual(r.result, true)
    assert.ok(/turn the VPN off/.test(r.text))
    assert.ok(r.text.includes('WARNING: the live version could not be confirmed'))
    assert.ok(!/^Live checks passed\.$/m.test(r.text))
  })
  await checkAsync('live, CI, site readable: both the site and the API confirm, and it passes cleanly', async () => {
    const r = await runLive({ challenged: false })
    assert.strictEqual(r.result, true)
    assert.ok(r.text.includes(`/api/runtime/version reports ${SHA.slice(0, 12)} (paid) - matches`))
    assert.ok(r.text.includes(`Cloudflare serves Worker version ${V_PUBLISHED}, the one this release published - matches`))
    assert.ok(/^Live checks passed\.$/m.test(r.text))
    assert.ok(r.summary.includes('### Live checks: OK\n'))
  })
  // ---- 8. free and paid never mixed: the account plan, the live tier and the rollback target

  await checkAsync('readAccountPlan: reads the subscription with a GET, names a plan, and never echoes the token or the billing body', async () => {
    const calls = []
    const body = JSON.stringify({ success: true, result: [{ id: 's1', state: 'Paid', price: 5, rate_plan: { id: 'workers_paid', public_name: 'Workers Paid' } }] })
    const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return { ok: true, status: 200, text: async () => body } }
    const r = await accountPlanHelper.readAccountPlan({ fetchImpl, token: 'fixture-not-a-token', accountId: 'acc123' })
    assert.strictEqual(r.plan, 'paid')
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc123/subscriptions')
    assert.ok(!calls[0].init || !calls[0].init.method || calls[0].init.method === 'GET', 'read-only')
    assert.ok(!calls[0].init || !calls[0].init.body, 'no request body')
    assert.strictEqual(calls[0].init.headers.authorization, 'Bearer fixture-not-a-token')
    assert.ok(!JSON.stringify(r).includes('fixture-not-a-token') && !JSON.stringify(r).includes('price'))
  })

  await checkAsync('readAccountPlan: every failure is "unknown" with a reason, and the response body is never repeated', async () => {
    const mk = (status, text) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => text })
    for (const [name, args] of Object.entries({
      'billing permission missing': { fetchImpl: mk(403, '{"success":false,"errors":[{"code":9109,"message":"SECRET_BODY_MARK"}]}'), token: 't', accountId: 'a' },
      'server error': { fetchImpl: mk(500, 'SECRET_BODY_MARK'), token: 't', accountId: 'a' },
      'unparseable answer': { fetchImpl: mk(200, 'SECRET_BODY_MARK <html>'), token: 't', accountId: 'a' },
      'network error': { fetchImpl: async () => { throw new Error('getaddrinfo SECRET_BODY_MARK') }, token: 't', accountId: 'a' },
      'no token': { fetchImpl: async () => { throw new Error('must not be called') }, token: '', accountId: 'a' },
      'no account id': { fetchImpl: async () => { throw new Error('must not be called') }, token: 't', accountId: '' },
    })) {
      const r = await accountPlanHelper.readAccountPlan(args)
      assert.strictEqual(r.plan, 'unknown', name)
      assert.ok(r.reason.length > 10 && !/SECRET_BODY_MARK/.test(r.reason), `${name}: ${r.reason}`)
    }
    assert.match((await accountPlanHelper.readAccountPlan({ fetchImpl: mk(403, ''), token: 't', accountId: 'a' })).reason, /HTTP 403.*billing|billing.*HTTP 403/i)
  })

  await checkAsync('account-plan.cjs as a program: prints one JSON line, reads the account id from wrangler.toml, and does nothing without a token', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-account-plan-'))
    try {
      fs.writeFileSync(path.join(tmp, 'wrangler.toml'), 'name = "business-os"\naccount_id = "743e5b727d139e85ed11679097f6f99e"\n')
      assert.strictEqual(accountPlanHelper.accountIdFromToml(fs.readFileSync(path.join(tmp, 'wrangler.toml'), 'utf8')), '743e5b727d139e85ed11679097f6f99e')
      assert.strictEqual(accountPlanHelper.accountIdFromToml('name = "x"'), '')
      const env = { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' }
      const r = spawnSync(process.execPath, [path.join(KIT, 'account-plan.cjs')], { cwd: tmp, encoding: 'utf8', env, timeout: 30000 })
      assert.strictEqual(r.status, 0, r.stderr)
      const out = JSON.parse(r.stdout.trim())
      assert.strictEqual(out.plan, 'unknown')
      assert.ok(/token/i.test(out.reason))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  // One deploy step with the account read, the build check and the publish stubbed.
  function runDeploy({ ci = true, plan = 'paid', account = { plan: 'paid' }, typed = 'paid' }) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-deploy-plan-'))
    fs.mkdirSync(path.join(tmp, 'frontend', 'dist'), { recursive: true })
    const ran = []
    const ctx = { ci, dryRun: false, sha: SHA, subject: 'test', site: 'https://site.invalid', plan, releaseDir: tmp, ciConfirmWord: 'DEPLOY', recordDir: '', args: {}, state: { frontendBuiltFor: SHA } }
    const stubs = {
      gitRead: (args) => (args[0] === 'rev-parse' ? SHA : ''),
      runSpec: async (spec, _ctx, approval) => {
        lib.assertApproved(spec, approval)
        ran.push(spec.id)
        if (spec.id === 'account-plan') return account === 'fail' ? { code: 1, out: 'boom' } : { code: 0, out: `[with-wrangler-auth] note\n${JSON.stringify(account)}\n` }
        if (spec.id.startsWith('deploy:')) return { code: 0, out: `Current Version ID: ${V_PUBLISHED}` }
        throw new Error(`unexpected command ${spec.id}`)
      },
      ...(ci ? {} : { confirm: async (_c, gate) => ({ ok: true, gate }), ask: async () => typed }),
    }
    return withStubs(stubs, () => COMMANDS.deploy(ctx)).then((r) => { fs.rmSync(tmp, { recursive: true, force: true }); return { ...r, ran, ctx } })
  }

  await checkAsync('deploy, CI, no plan given: stops before reading the account or publishing (no silent default)', async () => {
    const r = await runDeploy({ plan: '' })
    assert.strictEqual(r.result, false)
    assert.deepStrictEqual(r.ran, [])
    assert.match(r.text, /STOP: .*plan.*paid or free/i)
  })

  await checkAsync('deploy: the profile matches the real account plan, so it publishes, after the account read', async () => {
    for (const plan of ['paid', 'free']) {
      const r = await runDeploy({ plan, account: { plan } })
      assert.strictEqual(r.result, true, plan)
      assert.deepStrictEqual(r.ran, ['account-plan', `deploy:${plan}`])
      assert.strictEqual(r.ctx.state.deploy.accountPlan, plan, 'the release records the plan the account had')
    }
  })

  await checkAsync('deploy: a profile that differs from the real account plan is refused before anything is published', async () => {
    for (const [plan, account] of [['paid', 'free'], ['free', 'paid']]) {
      const r = await runDeploy({ plan, account: { plan: account } })
      assert.strictEqual(r.result, false, `${plan} profile on a ${account} account`)
      assert.deepStrictEqual(r.ran, ['account-plan'], 'nothing published')
      assert.ok(r.text.includes(`account is on the ${account} plan`) && r.text.includes(`${plan} profile`), r.text)
    }
  })

  await checkAsync('deploy fails closed when the account plan cannot be read', async () => {
    for (const account of ['fail', { plan: 'unknown', reason: 'HTTP 403 (the token cannot read billing)' }, {}, { plan: 'enterprise' }]) {
      const r = await runDeploy({ account })
      assert.strictEqual(r.result, false, JSON.stringify(account))
      assert.deepStrictEqual(r.ran, ['account-plan'])
      assert.match(r.text, /could not be read/i)
    }
  })

  await checkAsync('deploy at a keyboard: no -Plan means the owner types one, and an empty answer stops', async () => {
    const empty = await runDeploy({ ci: false, plan: '', typed: '' })
    assert.strictEqual(empty.result, false)
    assert.deepStrictEqual(empty.ran, [])
    const typed = await runDeploy({ ci: false, plan: '', typed: 'free', account: { plan: 'free' } })
    assert.strictEqual(typed.result, true)
    assert.deepStrictEqual(typed.ran, ['account-plan', 'deploy:free'])
    const wrong = await runDeploy({ ci: false, plan: '', typed: 'gold' })
    assert.strictEqual(wrong.result, false)
  })

  await checkAsync('live with no plan chosen or recorded stops instead of assuming paid', async () => {
    const ctx = { ci: true, dryRun: false, sha: SHA, subject: 'test', site: 'https://site.invalid', plan: '', ciConfirmWord: 'DEPLOY', recordDir: '', args: {}, state: { deploy: {} } }
    const r = await withStubs({ httpGet: async () => { throw new Error('must not reach the site') } }, () => COMMANDS.live(ctx))
    assert.strictEqual(r.result, false)
    assert.match(r.text, /STOP: .*plan/i)
  })

  await checkAsync('live, CI, site challenged: the plan the Worker version carries (PLAN_TIER via the API) must match', async () => {
    const same = await runLive({ apiTier: 'paid' })
    assert.strictEqual(same.result, true)
    assert.ok(same.text.includes(`Worker version ${V_PUBLISHED} carries PLAN_TIER paid (read through the Cloudflare API) - matches`), same.text)
    for (const apiTier of ['free', '', 'Paid ']) {
      const r = await runLive({ apiTier })
      assert.strictEqual(r.result, false, `tier ${JSON.stringify(apiTier)} must not pass on a challenged runner`)
      assert.ok(/PROBLEM: Worker version .*(tier is free, expected paid|no tier reported, expected paid|invalid tier reported, expected paid)/.test(r.text), r.text)
      assert.ok(r.summary.includes('### Live checks: PROBLEMS'))
    }
    const unreadable = await runLive({ apiTier: 'fail' })
    assert.strictEqual(unreadable.result, false, 'CI: a tier that cannot be read is a problem, not a warning')
    assert.match(unreadable.text, /PROBLEM: the plan of Worker version .* could not be read/)
    const freeProfile = await runLive({ apiTier: 'paid', plan: 'free' })
    assert.strictEqual(freeProfile.result, false, 'the Free profile against a Paid version is a mix')
  })

  await checkAsync('live, keyboard run, challenged: a tier that cannot be read is a warning; a wrong tier is still a problem', async () => {
    const unreadable = await runLive({ ci: false, apiTier: 'fail' })
    assert.strictEqual(unreadable.result, true)
    assert.match(unreadable.text, /WARNING: the plan of Worker version .* could not be read/)
    const wrong = await runLive({ ci: false, apiTier: 'free' })
    assert.strictEqual(wrong.result, false)
  })

  // The rollback step with the reads stubbed. tiers: version id -> tier ('' = no PLAN_TIER, 'fail' = unreadable).
  function runRollback({ live = 'paid', target = 'paid', account = { plan: 'paid' }, versionId = V_BEFORE, targetGiven = true, withSnapshot = true }) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-rollback-plan-'))
    const ran = []
    const ctx = { ci: false, dryRun: false, sha: SHA, subject: 'test', plan: '', releaseDir: tmp, fixedRelease: true, ciConfirmWord: 'DEPLOY', recordDir: '', args: { target: 'worker', ...(targetGiven ? { versionId } : {}) },
      state: withSnapshot ? { snapshot: { previousVersionId: V_BEFORE } } : {} }
    const view = (id, tier) => (tier === 'fail' ? { code: 1, out: 'Authentication error' }
      : { code: 0, out: JSON.stringify({ id, resources: { bindings: tier === '' ? [] : [{ type: 'plain_text', name: 'PLAN_TIER', text: tier }] } }) })
    const stubs = {
      runSpec: async (spec, _ctx, approval) => {
        lib.assertApproved(spec, approval)
        ran.push(spec.id)
        if (spec.id === 'deployments-status') return { code: 0, out: JSON.stringify({ id: 'dddddddd-0000-4000-8000-000000000009', versions: [{ version_id: V_PUBLISHED, percentage: 100 }] }) }
        if (spec.id === `version-view:${V_PUBLISHED}`) return view(V_PUBLISHED, live)
        if (spec.id === `version-view:${versionId}`) return view(versionId, target)
        if (spec.id === 'account-plan') return account === 'fail' ? { code: 1, out: 'boom' } : { code: 0, out: JSON.stringify(account) }
        if (spec.id === 'rollback-worker') return { code: 0, out: '' }
        throw new Error(`unexpected command ${spec.id}`)
      },
      confirm: async (_c, gate) => ({ ok: true, gate }),
    }
    return withStubs(stubs, () => COMMANDS.rollback(ctx)).then((r) => { fs.rmSync(tmp, { recursive: true, force: true }); return { ...r, ran } })
  }

  await checkAsync('rollback: a target from the other profile is refused and nothing is rolled back', async () => {
    const r = await runRollback({ live: 'paid', target: 'free', account: { plan: 'paid' } })
    assert.strictEqual(r.result, false)
    assert.ok(!r.ran.includes('rollback-worker'), 'the rollback must not run')
    assert.match(r.text, /REFUSED: .*free.*paid/i)
    const noAccount = await runRollback({ live: 'paid', target: 'free', account: 'fail' })
    assert.strictEqual(noAccount.result, false, 'account unreadable: never cross the live profile')
    assert.ok(!noAccount.ran.includes('rollback-worker'))
  })

  await checkAsync('rollback: a target of the same profile goes ahead', async () => {
    const r = await runRollback({})
    assert.strictEqual(r.result, true)
    assert.ok(r.ran.includes('rollback-worker'))
    assert.ok(r.ran.indexOf('rollback-worker') > r.ran.indexOf(`version-view:${V_BEFORE}`), 'the target is read first')
  })

  await checkAsync('rollback: recovering a wrong live profile is allowed with a loud warning about the queue consumers', async () => {
    const r = await runRollback({ live: 'paid', target: 'free', account: { plan: 'free' } })
    assert.strictEqual(r.result, true)
    assert.match(r.text, /WARNING: .*queue/i)
  })

  await checkAsync('rollback: an unreadable target profile warns loudly but does not block an emergency rollback', async () => {
    const r = await runRollback({ target: 'fail' })
    assert.strictEqual(r.result, true)
    assert.match(r.text, /WARNING: .*could not be (read|compared)/i)
    const noId = await runRollback({ targetGiven: false, withSnapshot: false })
    assert.ok(noId.ran.includes('rollback-worker'))
    assert.match(noId.text, /WARNING: .*previous version.*(plan|profile)/i)
  })

  await checkAsync('runSpec tee shows AND returns the output; a plain run returns none, so the deploy step must tee', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-deploy-kit-tee-'))
    try {
      const bin = path.join(tmp, 'cloudflare', 'node_modules', 'wrangler', 'bin')
      fs.mkdirSync(bin, { recursive: true })
      fs.writeFileSync(path.join(bin, 'wrangler.js'), `console.log('Current Version ID: ${V_PUBLISHED}')\n`)
      const ctx = { ci: true, dryRun: false, releaseDir: tmp, authWrapper: '' }
      const spec = { id: 'probe', kind: 'wrangler', args: ['whoami'], gate: 'none' }
      const { result } = await withStubs({}, async () => [await ex.runSpec(spec, ctx, null), await ex.runSpec(spec, ctx, null, { tee: true })])
      const [plain, tee] = result
      assert.strictEqual(plain.code, 0)
      assert.strictEqual(plain.out, '', 'a plain run returns no output: why no release ever recorded the version it published')
      assert.ok(tee.out.includes(`Current Version ID: ${V_PUBLISHED}`), 'tee returns the output')
      const src = read('ops', 'scripts', 'deploy-kit', 'release.cjs')
      assert.ok(/ex\.runSpec\(lib\.commandCatalog\.deploy\(plan\), ctx, approval, \{ tee: true \}\)/.test(src), 'the deploy step must tee its output')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  if (process.exitCode) {
    console.error(`test-deploy-kit-pure: FAILED (${passed} passed)`)
  } else {
    console.log(`test-deploy-kit-pure: ${passed} checks passed`)
  }
})()
