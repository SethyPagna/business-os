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
// The Worker config is generated per client and untracked: the kit is tested against the
// template rendered with the fake client of clients/example.env.
const wrangler = require('./harness/rendered_wrangler.cjs')
const TARGET = lib.targetFromConfig(wrangler.paid())
const catalog = lib.catalogFor(TARGET)
const MAIN = TARGET.main.name
const IMPORT = TARGET.importDb.name

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

const guardFiles = lib.GUARD_MIGRATIONS.map(file => ({ name: file.name, bytes: fs.readFileSync(path.join(ROOT, 'cloudflare', 'migrations', file.name)) }))
const guardExpected = lib.validateGuardFiles(guardFiles)
function guardState(names = lib.GUARD_MIGRATIONS.map(file => file.name)) {
  const first = names.includes(lib.GUARD_MIGRATIONS[0].name)
  return { applied: names, epoch: first ? 'legacy-separate-pool-v1' : null, boundary: first ? '42' : null, permits: 0,
    triggers: guardExpected.filter(file => names.includes(file.name)).flatMap(file => file.triggers) }
}

check('guard files reject wrong order, extra files and changed raw bytes', () => {
  assert.equal(guardExpected.length, 2)
  assert.equal(guardExpected[0].triggers.length, 18)
  assert.equal(guardExpected[1].triggers.length, 5)
  assert.throws(() => lib.validateGuardFiles([...guardFiles].reverse()), /order\/name\/hash/)
  assert.throws(() => lib.validateGuardFiles([...guardFiles, guardFiles[0]]), /exactly two/)
  assert.throws(() => lib.validateGuardFiles([{ ...guardFiles[0], bytes: Buffer.concat([guardFiles[0].bytes, Buffer.from('\n')]) }, guardFiles[1]]), /hash/)
})

check('guard preflight allows clean and0243-only resume but refuses formula exposure and corrupt guards', () => {
  for (const names of [[], [guardFiles[0].name], guardFiles.map(file => file.name)]) lib.validateGuardState(guardState(names), guardExpected)
  for (const names of [[guardFiles[1].name], ['0255_product_cost_review.sql'], [guardFiles[0].name, '0256_validated_cost.sql'], ['0257_confirmation.sql']]) assert.throws(() => lib.validateGuardState(guardState(names), guardExpected), /precede/)
  assert.throws(() => lib.validateGuardState(guardState([guardFiles[0].name]), guardExpected, true), /Both guard/)
  for (const changed of [{ permits: 1 }, { epoch: 'wrong' }, { boundary: null }, { triggers: [] }]) assert.throws(() => lib.validateGuardState({ ...guardState(), ...changed }, guardExpected, true))
  const changed = guardState(); changed.triggers = changed.triggers.map((row, i) => i ? row : { ...row, sql: 'CREATE TRIGGER wrong' })
  assert.throws(() => lib.validateGuardState(changed, guardExpected), /trigger/)
})

check('stage configuration changes only main migration directory and rejects DB/account/ledger mismatch', () => {
  const original = wrangler.paid()
  const stage = lib.guardStageConfig(original, '.guard-stage-fixture', TARGET)
  assert.equal(stage.replace('migrations_dir = ".guard-stage-fixture"', 'migrations_dir = "migrations"'), original)
  assert.ok(stage.includes('migrations_dir = "migrations-import"'))
  for (const changed of [original.replace(TARGET.main.id, 'wrong'), original.replace(TARGET.accountId, 'wrong'), original.replace(`database_name = "${MAIN}"`, 'database_name = "other"'), original.replace('migrations_dir = "migrations"', 'migrations_dir = "migrations"\nmigrations_table = "other"')]) assert.throws(() => lib.guardStageConfig(changed, '.guard-stage-fixture', TARGET), /mismatch/)
  assert.throws(() => lib.guardStageConfig(original, '../escape', TARGET), /directory/)
  assert.equal(catalog.guardStageApply('/safe/config.toml').gate, 'typeYES')
  assert.throws(() => lib.assertApproved(catalog.guardStageApply('/safe/config.toml'), { ok: true, gate: 'confirm' }), /confirmation/)
})

check('the guard stage only ever stages the client the release is aimed at: another client\'s config is refused, and so is no target', () => {
  const other = wrangler.paid({ CF_ACCOUNT_ID: '1'.repeat(32), D1_MAIN_ID: '11111111-1111-4111-8111-111111111111' })
  assert.throws(() => lib.guardStageConfig(other, '.guard-stage-fixture', TARGET), /mismatch/)
  assert.ok(lib.guardStageConfig(other, '.guard-stage-fixture', lib.targetFromConfig(other)), 'POSITIVE CONTROL: the same config passes for its own target')
  assert.throws(() => lib.guardStageConfig(wrangler.paid(), '.guard-stage-fixture'), /mismatch/, 'a stage with nothing to compare against must not be built')
  assert.throws(() => lib.guardStageConfig(wrangler.paid().replace('binding = "DB"', 'binding = "OTHER"'), '.guard-stage-fixture', TARGET), /mismatch/, 'exactly one database bound as DB')
})

check('the kit holds no client: no account, database, Worker, bucket or site constant in lib, release or exec', () => {
  const src = ['lib.cjs', 'release.cjs', 'exec.cjs'].map((f) => read('ops', 'scripts', 'deploy-kit', f)).join('\n')
  for (const [re, what] of [[/leang/i, 'a client name'], [/\b[0-9a-f]{32}\b/, 'an account or KV id'], [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/, 'a database id'],
    [/['"`]business-os(?:-[a-z-]+)?['"`]/, 'a hard-coded database or Worker name'], [/https:\/\/[a-z0-9.-]+\.(?:com|org|dev)/i, 'a site']]) {
    // the all-zero UUID is the kit's own sample Worker version id, not a database
    const hit = re.exec(src.replace(/business-os-release-kit/g, '').replace(/https:\/\/api\.cloudflare\.com/g, '').replace(/0{8}-0{4}-0{4}-0{4}-0{12}/g, ''))
    assert.ok(!hit, `the kit contains ${what}: ${hit && hit[0]}`)
  }
})

check('a target is read from the rendered config and checked against the environment; a config of another client is refused', () => {
  const v = wrangler.values
  const other = wrangler.paid({ CF_ACCOUNT_ID: '2'.repeat(32) })
  assert.equal(lib.targetFromConfig(wrangler.paid()).main.name, MAIN)
  assert.equal(TARGET.site, v.ADMIN_URL)
  assert.deepEqual(TARGET.databases.map((d) => [d.binding, d.applyScript]), [['DB', 'migrate:remote'], ['IMPORT_DB', 'migrate:import:remote']])
  const expect = { accountId: v.CF_ACCOUNT_ID, d1MainId: v.D1_MAIN_ID, adminUrl: v.ADMIN_URL }
  assert.ok(lib.targetFromConfig(wrangler.paid(), expect, { require: true, accountSecret: v.CF_ACCOUNT_ID }))
  assert.throws(() => lib.targetFromConfig(other, expect), /account id differs/)
  assert.throws(() => lib.targetFromConfig(wrangler.paid(), expect, { accountSecret: '3'.repeat(32) }), /secret differs/)
  assert.throws(() => lib.targetFromConfig(wrangler.paid(), {}, { require: true }), /not all provided/, 'CI must not run without the expectations')
  assert.throws(() => lib.targetFromConfig('name = "x"'), /no account, Worker name or main database/)
  assert.throws(() => lib.targetFromConfig(wrangler.paid().replace(/\[\[d1_databases\]\]\nbinding = "IMPORT_DB"[\s\S]*?migrations_dir = "migrations-import"\n/, '')), /no IMPORT_DB/)
  assert.ok(!lib.targetFromConfig(wrangler.paid({ ADMIN_URL: 'https://admin.example.org' }), { adminUrl: 'https://admin.example.org/' }).site.endsWith('/'))
})

check('the catalogue is built for one target: a database or Worker of another client cannot be named', () => {
  const second = lib.targetFromConfig(wrangler.paid({ WORKER_NAME: 'second-shop', D1_MAIN_NAME: 'second-db', D1_IMPORT_NAME: 'second-import' }))
  const c2 = lib.catalogFor(second)
  assert.deepEqual(c2.counts().args.slice(0, 3), ['d1', 'execute', 'second-db'])
  assert.deepEqual(catalog.counts().args.slice(0, 3), ['d1', 'execute', MAIN])
  assert.ok(c2.rollbackWorker('').args.includes('second-shop') && !c2.rollbackWorker('').args.includes(TARGET.workerName))
  assert.throws(() => c2.restoreDatabase(MAIN, 'b'), /Unknown database/)
  assert.throws(() => c2.migrationsApply(MAIN), /Unknown database/)
  assert.equal(c2.importMigrationLedger().args[2], 'second-import')
  assert.throws(() => lib.catalogFor(null), /needs a target/)
})

check('every wrangler command names the client\'s rendered config: a wrangler.toml left in the folder never decides the account', () => {
  const specs = [
    catalog.guardState('SELECT 1'), catalog.whoamiJson(), catalog.timeTravelInfo(MAIN), catalog.deploymentStatus(), catalog.counts(),
    catalog.importMigrationLedger(), catalog.migrationsList(MAIN), catalog.rollbackWorker(''), catalog.rollbackWorker('aaaaaaaa-0000-4000-8000-000000000001', true),
    catalog.restoreDatabase(MAIN, 'bookmark'), catalog.guardStageApply('/tmp/guard-stage/wrangler.toml'),
  ]
  for (const spec of specs) {
    if (spec.args[0] === 'whoami') { assert.ok(!spec.args.includes('--config'), 'the login check reads no config'); continue }
    const at = spec.args.indexOf('--config')
    assert.ok(at >= 0 && spec.args[at + 1], `${spec.id} names no config`)
  }
  assert.equal(catalog.counts().args.slice(-2).join(' '), '--config wrangler.toml', 'the kit runs in cloudflare/ and names the file rendered there')
  assert.equal(catalog.guardStageApply('/tmp/stage/wrangler.toml').args.filter((a) => a === '--config').length, 1, 'the staged guard config is not given a second one')
  // The npm scripts the kit and the developers run say it too, and so does the deploy script by default.
  const scripts = pkg('cloudflare')
  for (const [name, command] of Object.entries(scripts)) {
    if (!/with-wrangler-auth\.cjs wrangler /.test(command)) continue
    assert.ok(/--config [A-Za-z.]+/.test(command), `npm run ${name} names no --config`)
  }
  const deployScript = require(path.join(ROOT, 'cloudflare', 'scripts', 'deploy.cjs'))
  assert.deepEqual(deployScript.withConfig(['--dry-run']), ['--dry-run', '--config', 'wrangler.toml'])
  assert.deepEqual(deployScript.withConfig(['--config', 'wrangler.free.toml']), ['--config', 'wrangler.free.toml'])
  assert.equal(deployScript.configNamed(['--config=x.toml']), 'x.toml')
})

check('with-wrangler-auth.cjs refuses a wrangler command that names no config, and runs one that does', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrangler-config-guard-'))
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'))
    fs.copyFileSync(path.join(ROOT, 'cloudflare', 'scripts', 'with-wrangler-auth.cjs'), path.join(tmp, 'scripts', 'with-wrangler-auth.cjs'))
    const run = (args, env = {}) => spawnSync(process.execPath, [path.join(tmp, 'scripts', 'with-wrangler-auth.cjs'), ...args], {
      cwd: tmp, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, CLOUDFLARE_API_TOKEN: 'x', ...env },
    })
    const bare = run(['wrangler', 'd1', 'execute', 'db', '--remote', '--command', 'SELECT 1'])
    assert.equal(bare.status, 1)
    assert.match(bare.stderr, /REFUSED: no --config/)
    // commands that read no config are not asked for one
    for (const free of [['wrangler', '--version'], ['wrangler', 'whoami']]) assert.doesNotMatch(run(free).stderr, /REFUSED: no --config/, free.join(' '))
    // a wrangler.toml in the folder of another account is not picked up silently either
    fs.writeFileSync(path.join(tmp, 'wrangler.toml'), 'account_id = "' + '1'.repeat(32) + '"\n')
    const other = run(['wrangler', 'd1', 'execute', 'db', '--remote', '--config', 'wrangler.toml'], { CLOUDFLARE_ACCOUNT_ID: '2'.repeat(32) })
    assert.equal(other.status, 1)
    assert.match(other.stderr, /different Cloudflare account/)
    assert.ok(!other.stderr.includes('1'.repeat(32)) && !other.stderr.includes('2'.repeat(32)), 'no account id is printed')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

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
  for (const spec of lib.sampleCatalog(TARGET)) {
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
    'cloudflare/wrangler.template.toml', 'clients/example.env', 'ops/scripts/client/render-wrangler.mjs', 'run/verify-local.bat', 'run/full-automation.bat',
  ]) assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} missing`)
  const toml = wrangler.paid()
  for (const db of TARGET.databases) {
    assert.ok(toml.includes(`database_name = "${db.name}"`), `the rendered config has no ${db.name}`)
    assert.ok(toml.includes(`migrations_dir = "${db.migrationsDir}"`), `the rendered config has no ${db.migrationsDir}`)
    // package.json names each database by its BINDING, which the rendered config resolves to the client's own id.
    assert.ok(pkg('cloudflare')[db.applyScript].includes(`apply ${db.binding} --remote`), `${db.applyScript} does not apply ${db.binding}`)
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
  const specs = lib.sampleCatalog(TARGET)
  const prod = specs.filter(lib.isProductionSpec)
  assert.ok(prod.length >= 12, `expected the production commands to be recognised, got ${prod.length}`)
  for (const s of prod) assert.ok(lib.GATE_RANK[s.gate] >= 1, `${s.id} has gate ${s.gate}`)
  for (const s of specs.filter((x) => x.args.includes('--remote') || /deploy|rollback|restore|apply|remote/.test(x.id))) {
    assert.ok(lib.isProductionSpec(s), `${s.id} is not recognised as production`)
  }
  const byId = Object.fromEntries(specs.map((s) => [s.id, s]))
  assert.strictEqual(byId['deploy:paid'].gate, 'typeYES')
  assert.strictEqual(byId[`migrations-apply:${MAIN}`].gate, 'typeYES')
  assert.strictEqual(byId[`migrations-apply:${IMPORT}`].gate, 'typeYES')
  assert.strictEqual(byId['rollback-worker'].gate, 'double')
  assert.strictEqual(byId[`restore:${MAIN}`].gate, 'double')
  assert.ok(!lib.isProductionSpec(byId.whoami), 'whoami reads nothing from production')
  assert.ok(!lib.isProductionSpec(byId['whoami-json']), 'the account check reads nothing from production')
})

check('the runtime guard refuses unconfirmed or under-confirmed production commands', () => {
  const deploy = catalog.deploy('paid')
  assert.throws(() => lib.assertApproved(deploy, null), /not confirmed/)
  assert.throws(() => lib.assertApproved(deploy, { ok: false, gate: 'typeYES' }), /not confirmed/)
  assert.throws(() => lib.assertApproved(deploy, { ok: true, gate: 'confirm' }), /needs a "typeYES"/)
  assert.ok(lib.assertApproved(deploy, { ok: true, gate: 'typeYES' }))
  const restore = catalog.restoreDatabase(MAIN, 'b')
  assert.throws(() => lib.assertApproved(restore, { ok: true, gate: 'typeYES' }), /needs a "double"/)
  assert.throws(() => lib.assertApproved({ id: 'x', kind: 'wrangler', args: ['deploy'], gate: 'none' }, { ok: true, gate: 'double' }), /no confirmation gate/)
  assert.ok(lib.assertApproved(catalog.whoami(), null))
  assert.ok(lib.assertApproved(lib.whoamiSpec(), null))
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
  check(`${file}: manual only, one environment per client, confirm gate, secrets never echoed`, () => {
    const y = read('.github', 'workflows', file)
    const on = /^on:\n([\s\S]*?)^\S/m.exec(y)
    assert.ok(on, 'no on: block')
    const triggers = [...on[1].matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1])
    assert.deepStrictEqual(triggers, ['workflow_dispatch'], `triggers: ${triggers}`)
    assert.ok(!/pull_request_target|pull_request|^\s*push:|schedule:|workflow_run|repository_dispatch/m.test(y), 'extra trigger')
    assert.ok(/^\s+environment: \$\{\{ inputs\.client \}\}$/m.test(y), 'environment: the chosen client')
    assert.ok(!/environment: production/.test(y), 'no job may use the shared production environment any more')
    assert.ok(/^permissions:\n {2}contents: read\n/m.test(y), 'permissions: contents: read')
    assert.ok(/^concurrency:\n {2}group: deploy-\$\{\{ inputs\.client \}\}\n/m.test(y), 'one concurrency group per client')
    assert.ok(/ client:\n {8}description: [^\n]+\n {8}required: true\n {8}type: choice\n {8}options:\n {10}- leang\n {10}- bm\n/.test(y), 'a required client choice')
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
      if (/\bvars\./.test(line) && !/^\s*#/.test(line)) {
        assert.ok(/^\s+[A-Z_0-9]+: \$\{\{ (?:vars\.[A-Z_0-9]+|toJSON\(vars\)) \}\}$/.test(line), `line ${i + 1}: variables only via env: (${line.trim()})`)
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
  assert.deepStrictEqual(lib.parseMigrationNames('\u001b[32m✅ No migrations to apply!\u001b[0m\r\n'), [])
  assert.deepStrictEqual(lib.parseMigrationNames('Migrations to be applied:\n┌──────────────────────┐\n│ Name                 │\n├──────────────────────┤\n│ 0259_inventory.sql   │\n└──────────────────────┘'), ['0259_inventory.sql'])
  for (const invalid of ['', 'unknown response', 'No migrations to apply', 'Migrations to be applied:',
    'ERROR: unreadable\n✅ No migrations to apply!', '✅ No migrations to apply!\n✅ No migrations to apply!',
    'Migrations to be applied:\n│ 0259_inventory.sql │\n│ 0259_inventory.sql │']) assert.throws(() => lib.parseMigrationNames(invalid))
  const requireUnknownRefusal = parser => assert.throws(() => parser('unknown response'))
  requireUnknownRefusal(lib.parseMigrationNames)
  assert.throws(() => requireUnknownRefusal(() => []), /Missing expected exception/)
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

// ------------------------- 7. the live step, with the network and Cloudflare stubbed

const ex = require(path.join(KIT, 'exec.cjs'))
const release = require(path.join(KIT, 'release.cjs'))
const { COMMANDS } = release

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
    target: TARGET, catalog,
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

async function runGuardMigrationProbe(options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-guard-stage-'))
  const cf = path.join(tmp, 'cloudflare')
  fs.mkdirSync(path.join(cf, 'migrations'), { recursive: true })
  fs.mkdirSync(path.join(cf, 'migrations-import'))
  fs.writeFileSync(path.join(cf, 'migrations-import', '0001_import_staging.sql'), '-- fixture\n')
  fs.mkdirSync(path.join(cf, 'node_modules', 'wrangler'), { recursive: true })
  fs.writeFileSync(path.join(cf, 'wrangler.toml'), options.config || wrangler.paid())
  fs.writeFileSync(path.join(cf, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/wrangler': { version: '4.116.0' } } }))
  fs.writeFileSync(path.join(cf, 'node_modules', 'wrangler', 'package.json'), '{"version":"4.116.0"}')
  for (const file of guardFiles) fs.writeFileSync(path.join(cf, 'migrations', file.name), file.bytes)
  const later = ['0251_loyalty_reset.sql', '0255_product_review.sql', '0256_validated_cost.sql', '0257_confirmation.sql', '0259_inventory_check_sessions.sql']
  for (const name of later) fs.writeFileSync(path.join(cf, 'migrations', name), '-- fixture pending lower-numbered file\n')
  const calls = []
  let installed = false
  const before = options.allApplied ? guardState([...guardFiles.map(file => file.name), ...later]) : options.before || guardState([])
  const v = wrangler.values
  const ctx = { sha: SHA, args: { noApply: !!options.noApply }, ci: true, dryRun: false,
    releaseDir: tmp, recordDir: tmp, state: {}, site: '',
    expect: options.expect || { accountId: v.CF_ACCOUNT_ID, d1MainId: v.D1_MAIN_ID, adminUrl: v.ADMIN_URL } }
  try {
    const result = await withStubs({
      gitRead: args => args[0] === 'rev-parse' ? SHA : '',
      confirm: async (_ctx, gate) => ({ ok: true, gate }),
      runSpec: async (spec, _ctx, approval) => {
        lib.assertApproved(spec, approval)
        calls.push(spec.id)
        if (spec.id === `migrations-list:${MAIN}`) {
          const remaining = [...guardFiles.map(file => file.name), ...later].filter(name => !before.applied.includes(name))
          return { code: 0, out: remaining.length ? 'Migrations to be applied:\n' + remaining.map(name => `│ ${name} │`).join('\n') : '✅ No migrations to apply!' }
        }
        if (spec.id === 'import-migration-ledger') {
          assert.deepEqual(spec.args, ['d1', 'execute', IMPORT, '--remote', '--json', '--command', 'SELECT name FROM d1_migrations ORDER BY name', '--config', 'wrangler.toml'])
          return options.importResult || { code: 0, out: JSON.stringify([{ success: true, results: [{ name: '0001_import_staging.sql' }], meta: { rows_written: 0, changes: 0, changed_db: false } }]) }
        }
        if (spec.id === 'stock-guard-state') return { code: 0, out: JSON.stringify([{ success: true, results: [{ guard_state: JSON.stringify(installed ? (options.after || guardState()) : before) }] }]) }
        if (spec.id === 'stock-guard-stage') {
          const configFile = spec.args[spec.args.indexOf('--config') + 1]
          const config = fs.readFileSync(configFile, 'utf8')
          const directory = /^migrations_dir = "(\.guard-stage-[^"]+)"/m.exec(config)?.[1]
          assert.ok(directory)
          assert.equal(path.dirname(configFile), cf)
          assert.equal(config, lib.guardStageConfig(options.config || wrangler.paid(), directory, TARGET))
          const names = fs.readdirSync(path.join(cf, directory)).sort()
          assert.deepEqual(names, guardFiles.map(file => file.name))
          for (const file of guardFiles) assert.deepEqual(fs.readFileSync(path.join(cf, directory, file.name)), file.bytes)
          if (options.stageFails) return { code: 1, out: 'injected migration failure' }
          installed = true
          return { code: 0, out: '' }
        }
        if (spec.id === `migrations-apply:${MAIN}`) {
          assert.equal(installed, true)
          assert.ok(calls.lastIndexOf('stock-guard-state') > calls.indexOf('stock-guard-stage'))
          const unapplied = [...guardFiles.map(file => file.name), ...later].filter(name => !guardState().applied.includes(name))
          assert.deepEqual(unapplied, later, 'higher0258 ledger name must retain lower pending formula/loyalty files')
          return { code: 0, out: '' }
        }
        throw Error(`Unexpected migration command ${spec.id}`)
      },
    }, () => (options.command || COMMANDS.migrations)(ctx))
    assert.deepEqual(fs.readdirSync(cf).filter(name => name.startsWith('.guard-stage-')), [], 'temporary config and files removed')
    return { ...result, calls }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

function assertImportRefused(result) {
  assert.equal(result.result, false, result.text)
  assert.ok(!result.calls.includes('stock-guard-stage'), 'import admission precedes every fence')
  assert.ok(!result.calls.some(id => id.startsWith('migrations-apply:')), 'no database may be applied')
  assert.ok(!result.calls.includes(`migrations-list:${IMPORT}`), 'import ledger must never be initialized by migrations list')
  assert.ok(!result.calls.includes(`migrations-list:${MAIN}`), 'import admission precedes main ledger initialization')
}

;(async () => {
  await checkAsync('unexpected or unreadable import migrations refuse before any guard or migration write', async () => {
    for (const importResult of [
      { code: 0, out: JSON.stringify([{ success: true, results: [], meta: { rows_written: 0, changes: 0, changed_db: false } }]) },
      { code: 0, out: '' },
      { code: 0, out: 'unrecognized response' },
      { code: 1, out: 'no such table: d1_migrations' },
      ...[undefined, null, [], {}, { rows_written: 0, changes: 0 },
        { rows_written: false, changes: 0, changed_db: false },
        { rows_written: '0', changes: 0, changed_db: false },
        { rows_written: 0, changes: '0', changed_db: false },
        { rows_written: 0, changes: 0, changed_db: 'true' },
        { rows_written: 0, changes: 0, changed_db: true },
      ].map(meta => ({ code: 0, out: JSON.stringify([{ success: true, results: [{ name: '0001_import_staging.sql' }], meta }]) })),
      ...[
        [{ success: false, results: [{ name: '0001_import_staging.sql' }] }],
        [{ success: true, results: [{ name: '0001_import_staging.sql' }, { name: '0001_import_staging.sql' }] }],
        [{ success: true, results: [{ name: '0001_import_staging.sql' }, { name: '0002_unapproved.sql' }] }],
        [{ success: true, results: [{ name: null }] }],
        [{ success: true, results: [{ name: 'unknown' }] }],
        [{ success: true, results: [{ name: '0001_import_staging.sql' }], meta: { rows_written: 1 } }],
        [{ success: true, results: [{ name: '0001_import_staging.sql' }] }, { success: true, results: [] }],
      ].map(json => ({ code: 0, out: JSON.stringify(json.map(set => ({ meta: { rows_written: 0, changes: 0, changed_db: false }, ...set }))) })),
    ]) {
      const result = await runGuardMigrationProbe({ importResult })
      assertImportRefused(result)
    }
  })
  await checkAsync('import admission controls reject a check after guards and an unreadable-ledger-as-applied parser', async () => {
    const filename = path.join(KIT, 'release.cjs')
    const source = read('ops', 'scripts', 'deploy-kit', 'release.cjs')
    const early = 'const applied = lib.validateImportMigrationLedger(result.json, candidate)'
    assert.equal(source.split(early).length, 2)
    const anchor = '  for (const db of ctx.target.databases) {\n    if (pending[db.name]'
    assert.equal(source.split(anchor).length, 2)
    const late = source.replace(early, 'const applied = candidate; ctx.deferredImportCheck = () => lib.validateImportMigrationLedger(result.json, candidate)')
      .replace(anchor, '  try { ctx.deferredImportCheck() } catch { return false }\n' + anchor)
    const Module = require('module')
    const mutant = new Module(filename, module)
    mutant.filename = filename
    mutant.paths = Module._nodeModulePaths(KIT)
    mutant._compile(late, filename)
    const result = await runGuardMigrationProbe({ command: mutant.exports.COMMANDS.migrations,
      importResult: { code: 0, out: JSON.stringify([{ success: true, results: [], meta: { rows_written: 0, changes: 0, changed_db: false } }]) } })
    assert.throws(() => assertImportRefused(result), /precedes every fence/)
    const original = lib.validateImportMigrationLedger
    try {
      lib.validateImportMigrationLedger = (_json, candidate) => candidate
      const loose = await runGuardMigrationProbe({ importResult: { code: 0, out: 'unknown response' } })
      assert.throws(() => assertImportRefused(loose))
    } finally { lib.validateImportMigrationLedger = original }
  })
  await checkAsync('guard stage verifies both guards before ordinary lower-numbered pending migrations, including partial0243 resume', async () => {
    for (const before of [guardState([]), guardState([guardFiles[0].name]), guardState()]) {
      const result = await runGuardMigrationProbe({ before })
      assert.equal(result.result, true, result.text)
      assert.equal(result.calls.filter(id => id === 'stock-guard-stage').length, 1)
      assert.equal(result.calls.filter(id => id === `migrations-apply:${MAIN}`).length, 1)
      assert.equal(result.calls.filter(id => id === 'import-migration-ledger').length, 1)
      assert.ok(result.calls.indexOf('import-migration-ledger') < result.calls.indexOf(`migrations-list:${MAIN}`))
      assert.ok(!result.calls.includes(`migrations-list:${IMPORT}`))
      assert.ok(!result.calls.includes(`migrations-apply:${IMPORT}`))
    }
  })
  await checkAsync('guard stage failures and ambiguous verification never fall through to normal apply', async () => {
    for (const options of [{ stageFails: true }, { after: guardState([guardFiles[0].name]) }, { before: guardState([guardFiles[1].name]) }, { before: guardState(['0256_validated_cost.sql']) }]) {
      const result = await runGuardMigrationProbe(options)
      assert.equal(result.result, false, result.text)
      assert.ok(!result.calls.includes(`migrations-apply:${MAIN}`))
    }
    // A release aimed at the wrong target stops before it reads or writes anything at all.
    for (const options of [{ config: wrangler.paid().replace(TARGET.main.id, 'wrong') }, { config: wrangler.paid({ CF_ACCOUNT_ID: '4'.repeat(32) }) }, { expect: { accountId: TARGET.accountId } }]) {
      const result = await runGuardMigrationProbe(options)
      assert.equal(result.result, false, result.text)
      assert.deepEqual(result.calls, [], 'a release aimed at the wrong target touches nothing')
    }
  })
  await checkAsync('the release folder\'s rendered config decides the target; -EnvFile renders it first, and a release refuses a site that is not the client\'s', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-target-'))
    try {
      const cf = path.join(tmp, 'cloudflare')
      fs.mkdirSync(cf)
      fs.copyFileSync(path.join(ROOT, 'cloudflare', 'wrangler.template.toml'), path.join(cf, 'wrangler.template.toml'))
      const base = () => ({ releaseDir: tmp, dryRun: false, ci: false, args: {}, site: '', expect: {}, target: null, catalog: null })
      const said = []
      // The environment of the machine running the test must not decide the outcome.
      const run = async (ctx) => {
        const saved = Object.fromEntries(['CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID', 'D1_MAIN_ID', 'ADMIN_URL'].map((k) => [k, process.env[k]]))
        for (const k of Object.keys(saved)) delete process.env[k]
        try { return (await withStubs({}, async () => release.needTarget(ctx))).result } finally {
          for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v
        }
      }
      // no config yet, no env file: stop, and say how to make one
      let ctx = base()
      assert.equal(await run(ctx), false)
      // -EnvFile renders it and takes the expectations from the same file
      ctx = { ...base(), args: { envFile: wrangler.EXAMPLE_ENV } }
      assert.equal(await run(ctx), true)
      assert.equal(ctx.target.main.name, MAIN)
      assert.equal(ctx.site, wrangler.values.ADMIN_URL)
      assert.ok(fs.existsSync(path.join(cf, 'wrangler.toml')) && !fs.existsSync(path.join(cf, 'wrangler.free.toml')), 'a paid client gets no free file')
      // the rendered file is then read by every later step, with nothing else to say
      ctx = base()
      assert.equal(await run(ctx), true)
      assert.equal(ctx.catalog.counts().args[2], MAIN)
      // the environment expects another client than the one rendered: refused, nothing built
      ctx = { ...base(), expect: { accountId: '5'.repeat(32) } }
      assert.equal(await run(ctx), false)
      assert.equal(ctx.catalog, null)
      // CI must hold all three expectations
      ctx = { ...base(), ci: true }
      assert.equal(await run(ctx), false)
      ctx = { ...base(), ci: true, expect: { accountId: TARGET.accountId, d1MainId: TARGET.main.id, adminUrl: TARGET.site } }
      assert.equal(await run(ctx), true)
      // the live checks may only look at the client's own site
      ctx = { ...base(), site: 'https://somewhere-else.example.org' }
      assert.equal(await run(ctx), false)
      ctx = { ...base(), site: TARGET.site }
      assert.equal(await run(ctx), true)
      // a dry run with nothing rendered walks placeholders and reads nothing
      fs.rmSync(path.join(cf, 'wrangler.toml'))
      ctx = { ...base(), dryRun: true }
      assert.equal(await run(ctx), true)
      assert.equal(ctx.target.placeholder, true)
      void said
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
  await checkAsync('the target step needs the login to reach the rendered account, says nothing identifying in CI, and never writes', async () => {
    const run = async ({ ci, accounts, code = 0 }) => {
      const calls = []
      const ctx = { ci, dryRun: false, sha: SHA, subject: 't', site: TARGET.site, plan: 'paid', recordDir: '', args: {}, state: {}, target: TARGET, catalog,
        expect: { accountId: TARGET.accountId, d1MainId: TARGET.main.id, adminUrl: TARGET.site } }
      const out = await withStubs({ runSpec: async (spec, _c, approval) => { lib.assertApproved(spec, approval); calls.push(spec.id)
        return { code, out: `[with-wrangler-auth] note\n${JSON.stringify({ loggedIn: true, authType: 'Account API Token', accounts })}` } } }, () => COMMANDS.target(ctx))
      return { ...out, calls }
    }
    const ok = await run({ ci: true, accounts: [{ id: TARGET.accountId, name: 'n' }] })
    assert.equal(ok.result, true, ok.text)
    assert.deepEqual(ok.calls, ['whoami-json'])
    for (const secret of [TARGET.accountId, TARGET.main.id, MAIN, TARGET.workerName]) assert.ok(!ok.text.includes(secret) && !ok.summary.includes(secret), 'CI output must not carry the target')
    const local = await run({ ci: false, accounts: [{ id: TARGET.accountId, name: 'n' }] })
    assert.ok(local.text.includes(TARGET.accountId) && local.text.includes(MAIN) && local.text.includes(TARGET.workerName), 'a person at a keyboard sees the target')
    for (const bad of [await run({ ci: true, accounts: [{ id: '6'.repeat(32), name: 'someone else' }] }), await run({ ci: true, accounts: [] }), await run({ ci: true, accounts: [{ id: TARGET.accountId }], code: 1 })]) {
      assert.equal(bad.result, false)
      assert.match(bad.text, /cannot act in the account/)
    }
    assert.ok(read('ops', 'scripts', 'deploy-kit', 'release.cjs').includes('stepLogin, stepTarget, stepSnapshot'), 'a full release checks the target before it reads production')
  })
  await checkAsync('NoApply reads safe guard state without staging or applying any migration', async () => {
    const result = await runGuardMigrationProbe({ noApply: true })
    assert.equal(result.result, true, result.text)
    assert.ok(result.calls.includes('stock-guard-state'))
    assert.ok(!result.calls.includes('stock-guard-stage'))
    assert.ok(!result.calls.some(id => id.startsWith('migrations-apply:')))
  })
  await checkAsync('fully applied main and exact import ledgers resume without any migration writes', async () => {
    const result = await runGuardMigrationProbe({ allApplied: true })
    assert.equal(result.result, true, result.text)
    assert.ok(result.calls.includes('import-migration-ledger'))
    assert.ok(result.calls.includes('stock-guard-state'))
    assert.ok(!result.calls.includes('stock-guard-stage'))
    assert.ok(!result.calls.some(id => id.startsWith('migrations-apply:')))
  })
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
      assert.ok(/ex\.runSpec\(ctx\.catalog\.deploy\(plan\), ctx, approval, \{ tee: true \}\)/.test(src), 'the deploy step must tee its output')
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
