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
    assert.ok(new RegExp(`\\$env:CONFIRM -cne '${word}'[\\s\\S]*?exit 1`).test(y), `the job must stop unless confirm is ${word}`)
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

// ------------------------- 7. the live step, with the network and Cloudflare stubbed

const ex = require(path.join(KIT, 'exec.cjs'))
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
function runLive({ ci = true, challenged = true, api = V_PUBLISHED, published = V_PUBLISHED }) {
  const counts = Object.fromEntries(lib.KEY_TABLES.map((t, i) => [t, 10 + i]))
  const ctx = { ci, dryRun: false, sha: SHA, subject: 'test', site: 'https://site.invalid', plan: 'paid', ciConfirmWord: 'DEPLOY', recordDir: '', args: {},
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
      if (spec.id === 'counts') return { code: 0, out: JSON.stringify([{ results: [counts], success: true }]) }
      throw new Error(`unexpected command ${spec.id}`)
    },
    // CI uses the real confirm (RELEASE_CONFIRM); a keyboard run would read stdin.
    ...(ci ? {} : { confirm: async () => ({ ok: true, gate: 'confirm' }) }),
  }
  return withStubs(stubs, () => COMMANDS.live(ctx))
}

;(async () => {
  await checkAsync('live, CI, site challenged: the Cloudflare API confirms the published version, and it says "with warnings"', async () => {
    const r = await runLive({})
    assert.strictEqual(r.result, true)
    assert.ok(r.text.includes(`Cloudflare serves Worker version ${V_PUBLISHED}, the one this release published - matches`), 'the version must be confirmed through the API')
    assert.ok(/Live checks passed with 3 warning\(s\)/.test(r.text), 'a challenged run must not end with a bare "Live checks passed."')
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
