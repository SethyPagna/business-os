'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const cp = require('node:child_process')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../..')
const helper = path.join(root, 'ops/scripts/deploy-kit/export-records.mjs')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-record-export-'))
const canary = 'PRIVATE_CANARY_financial_notes_not_public'
const commit = 'a'.repeat(40)
const kitCommit = 'b'.repeat(40)
let passed = 0
const checks = []
function check(name, work) { work(); passed++; checks.push(name) }

;(async () => {
  const { exportRecords, precheck, LIMITS } = await import(pathToFileURL(helper).href)
  const { decryptEnvelope } = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-crypto.mjs')).href)
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const key = path.join(temporary, 'generated-public.pem')
  const privateKey = path.join(temporary, 'generated-private.pem')
  fs.writeFileSync(key, keys.publicKey.export({ type: 'spki', format: 'pem' }))
  fs.writeFileSync(privateKey, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }))
  let sequence = 0
  function fixture() {
    const runId = String(990000 + ++sequence)
    const records = path.join(temporary, `records-${runId}-1`)
    const output = path.join(temporary, `release-records-${runId}-1.enc.json`)
    fs.mkdirSync(records)
    return { runId, attempt: '1', commit, kitCommit, records, output, key }
  }
  function file(options, name, bytes) { const target = path.join(options.records, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); return target }
  function cli(options, mode = 'export') {
    return cp.spawnSync(process.execPath, [helper, mode, '--key', options.key, '--records', options.records, '--output', options.output, '--run-id', options.runId, '--attempt', options.attempt, '--commit', options.commit, '--kit-commit', options.kitCommit], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
  }
  check('old804 workflow has no retention; new workflow retains encrypted-only after failed steps', () => {
    const original = cp.execFileSync('git', ['show', '61b4a15130d0db450cc40600ae8e8f4142d17563:.github/workflows/deploy.yml'], { cwd: root, encoding: 'utf8' })
    const current = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8').replace(/\r\n/g, '\n')
    assert.ok(!original.includes('actions/upload-artifact'))
    assert.ok(original.includes('removes every sale made after the snapshot'))
    assert.ok(!current.includes('removes every sale made after the snapshot'))
    assert.ok(current.includes('Recovery requires reviewed compensating records'))
    assert.ok(current.includes('stop and reconcile the live Worker, migration ledger and installed guards'))
    assert.ok(current.includes('do not restore a database snapshot, delete history, remove fences or rerun the cutover'))
    assert.ok(current.includes('sparse-checkout-cone-mode: false'))
    for (const dependency of ['/ops/scripts/deploy-kit/', '/ops/scripts/ops-crypto.mjs', '/ops/keys/ops-export-public.pem']) assert.ok(current.includes(dependency))
    assert.ok(current.indexOf('Verify encrypted record protection') < current.indexOf('Safety snapshot'))
    assert.match(current, /id: export_records\n\s+if: always\(\) && steps.records_precheck.outcome == 'success' && steps.record_release.outcome != 'skipped'/)
    assert.match(current, /if: always\(\) && steps.export_records.outcome == 'success'\n\s+uses: actions\/upload-artifact@v4/)
    assert.match(current, /path: \$\{\{ env.RELEASE_RECORDS_OUTPUT \}\}\n\s+if-no-files-found: error\n\s+retention-days: 3/)
    assert.ok(current.includes('Join-Path $env:RUNNER_TEMP "release-records-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT.enc.json"'))
    assert.equal((current.match(/-Records "\$env:RELEASE_RECORDS_ROOT"/g) || []).length, 5)
    assert.ok(current.includes("'-Records', \"$env:RELEASE_RECORDS_ROOT\""))
    assert.ok(current.includes('-Jobs 2') && current.includes('if ($env:RUN_MIGRATIONS -ne \'true\')'))
  })
  for (const partial of [false, true]) check(partial ? 'partial migration failure bytes retained, not completion' : 'lossless manifest and existing owner decrypt compatibility', () => {
    const options = fixture()
    const binary = Buffer.from([0, 255, 128, 10, 13, 0])
    const originals = new Map([
      [`Deploys/${canary}/state.json`, Buffer.from(JSON.stringify({ sha: commit, secretNotes: canary }))],
      ['Deploys/run/guard-state-before.json', Buffer.from(canary + '\r\n')],
      ['Deploys/run/guard-state-installed.json', binary],
      ['Deploys/run/' + (partial ? 'migration-error.txt' : 'live-check.json'), Buffer.from(canary + (partial ? ' stopped after guard install' : ' live observations'))]
    ])
    for (const [name, bytes] of originals) file(options, name, bytes)
    const run = cli(options)
    assert.equal(run.status, 0)
    const ciphertext = fs.readFileSync(options.output, 'utf8')
    assert.ok(![ciphertext, run.stdout, run.stderr, path.basename(options.output)].some(text => text.includes(canary)))
    const envelope = JSON.parse(ciphertext)
    assert.deepEqual(JSON.parse(envelope.header).meta, { kind: 'release-records', runId: options.runId, commit })
    const manifest = JSON.parse(decryptEnvelope(envelope, keys.privateKey).plaintext)
    assert.equal(manifest.attempt, '1'); assert.equal(manifest.kitCommit, kitCommit); assert.equal(manifest.commit, commit)
    assert.match(manifest.qualification, /may be partial/)
    assert.equal(manifest.files.length, originals.size)
    for (const item of manifest.files) { const bytes = Buffer.from(item.contentBase64, 'base64'); assert.deepEqual(bytes, originals.get(item.path)); assert.equal(item.sha256, crypto.createHash('sha256').update(bytes).digest('hex')); assert.deepEqual(fs.readFileSync(path.join(options.records, item.path)), bytes) }
    const decoded = path.join(temporary, `decoded-${options.runId}.json`)
    const decrypt = cp.spawnSync(process.execPath, [path.join(root, 'ops/scripts/ops-decrypt.mjs'), options.output, privateKey, decoded], { encoding: 'utf8', windowsHide: true })
    assert.equal(decrypt.status, 0)
    assert.deepEqual(JSON.parse(fs.readFileSync(decoded, 'utf8')), manifest)
  })
  check('public key required before production and without expected records yet', () => {
    const options = fixture(); fs.rmdirSync(options.records)
    assert.doesNotThrow(() => precheck(options))
    for (const bad of [path.join(temporary, 'absent.pem'), privateKey]) { const run = cli({ ...options, key: bad }, 'precheck'); assert.notEqual(run.status, 0); assert.equal(run.stderr, 'Release records protection failed.\n'); assert.ok(!fs.existsSync(options.output)) }
    const invalid = path.join(temporary, 'invalid.pem'); fs.writeFileSync(invalid, canary)
    const run = cli({ ...options, key: invalid }, 'precheck'); assert.notEqual(run.status, 0); assert.ok(!run.stderr.includes(canary))
  })
  check('preexisting run-attempt records cannot pass freshness precheck', () => { const options = fixture(); file(options, 'stale.txt', canary); const run = cli(options, 'precheck'); assert.notEqual(run.status, 0); assert.equal(run.stderr, 'Release records protection failed.\n'); assert.equal(fs.readFileSync(path.join(options.records, 'stale.txt'), 'utf8'), canary) })
  check('expected absent or empty records refuse export without artifact', () => {
    const options = fixture(); assert.throws(() => exportRecords(options)); assert.ok(!fs.existsSync(options.output)); fs.rmdirSync(options.records); assert.throws(() => exportRecords(options))
  })
  check('identity, run attempt and output overlap/clobber refused', () => {
    const options = fixture(); file(options, 'keep.txt', canary)
    for (const override of [{ commit: canary }, { kitCommit: 'bad' }, { runId: '0' }, { attempt: '2' }, { output: path.join(options.records, path.basename(options.output)) }]) assert.throws(() => exportRecords({ ...options, ...override }))
    fs.writeFileSync(options.output, 'EXISTING_ENCRYPTED_EVIDENCE'); assert.throws(() => exportRecords(options)); assert.equal(fs.readFileSync(options.output, 'utf8'), 'EXISTING_ENCRYPTED_EVIDENCE'); assert.equal(fs.readFileSync(path.join(options.records, 'keep.txt'), 'utf8'), canary)
  })
  check('hardlinked records refused without deleting either link', () => {
    const options = fixture(); const original = file(options, 'keep.txt', canary); const alias = path.join(temporary, 'hardlink.txt'); fs.linkSync(original, alias); assert.throws(() => exportRecords(options)); assert.equal(fs.readFileSync(alias, 'utf8'), canary)
  })
  check('nested and root directory aliases cannot capture outside data', () => {
    const outside = path.join(temporary, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'private.txt'), canary)
    for (const rootAlias of [false, true]) { const options = fixture(); if (rootAlias) fs.rmdirSync(options.records); fs.symlinkSync(outside, rootAlias ? options.records : path.join(options.records, 'alias'), process.platform === 'win32' ? 'junction' : 'dir'); assert.throws(() => exportRecords(options)); assert.ok(!fs.existsSync(options.output)); assert.equal(fs.readFileSync(path.join(outside, 'private.txt'), 'utf8'), canary) }
  })
  check('file byte count and traversal depth bounds reject safely', () => {
    const large = fixture(); const fileName = file(large, 'large.bin', ''); fs.truncateSync(fileName, LIMITS.bytes + 1); assert.throws(() => exportRecords(large))
    const many = fixture(); for (let index = 0; index <= LIMITS.files; index++) file(many, `f-${index}`, ''); assert.throws(() => exportRecords(many))
    const deep = fixture(); file(deep, Array(LIMITS.depth + 2).fill('d').join('/') + '/x', canary); assert.throws(() => exportRecords(deep))
  })
  check('dangling output entry refuses precheck before production', () => {
    const options = fixture(); fs.rmdirSync(options.records)
    fs.symlinkSync(path.join(temporary, 'absent-output-target'), options.output, process.platform === 'win32' ? 'junction' : 'dir')
    assert.equal(fs.existsSync(options.output), false)
    const run = cli(options, 'precheck'); assert.notEqual(run.status, 0); assert.equal(run.stderr, 'Release records protection failed.\n'); assert.ok(fs.lstatSync(options.output).isSymbolicLink())
  })
  check('output directory alias preserves outside evidence', () => {
    const options = fixture(); file(options, 'keep.txt', canary)
    const outside = path.join(temporary, 'output-outside'); fs.mkdirSync(outside); const target = path.join(outside, path.basename(options.output)); fs.writeFileSync(target, 'OUTSIDE_KEEP')
    const alias = path.join(temporary, 'output-alias'); fs.symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => exportRecords({ ...options, output: path.join(alias, path.basename(options.output)) })); assert.equal(fs.readFileSync(target, 'utf8'), 'OUTSIDE_KEEP')
  })
  process.stdout.write(`PASS encrypted release records: ${passed} controls\n`)
  if (process.env.RELEASE_RECORDS_TEST_RECEIPT) fs.writeFileSync(process.env.RELEASE_RECORDS_TEST_RECEIPT, JSON.stringify({ status: 'PASS', node: process.version, passed, checks, helperSHA256: crypto.createHash('sha256').update(fs.readFileSync(helper)).digest('hex') }, null, 2))
})().catch(() => { process.stderr.write('FAIL encrypted release records control\n'); process.exitCode = 1 }).finally(() => {
  const absolute = path.resolve(temporary)
  assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()))
  assert.ok(path.basename(absolute).startsWith('business-os-record-export-'))
  fs.rmSync(absolute, { recursive: true, force: true })
})
