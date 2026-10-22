// Per-client Worker config: cloudflare/wrangler.template.toml + a client's
// variables -> wrangler.toml / wrangler.free.toml.
//
// The tracked tree holds no client's deploy configuration. This pins the
// machinery that replaced it:
//   1. the template holds placeholders only: no id, domain, e-mail, DSN or name
//      of any client, and every placeholder is a declared variable (and every
//      declared variable is used);
//   2. clients/example.env documents every variable, once, with fake values;
//   3. the renderer fails loudly and completely on a missing, unknown or
//      invalid variable, never prints a value, and never writes a half file;
//   4. two clients in one Cloudflare account cannot collide on any resource
//      name the template emits;
//   5. the target parser reads back exactly what the renderer wrote;
//   6. everything a client may do without (Sentry, e-mail, Google, custom
//      domains, Analytics Engine, the rate limiter, Images, version metadata,
//      the shop identity, the admin forwarder) leaves no empty entry behind,
//      and the two manifest routes follow their own switch.
// Leang's byte-for-byte parity needs a private env file and lives in
// test-client-wrangler-parity-pure.cjs.
//
// Run: node scripts/test-client-config-render-pure.cjs
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const wrangler = require('./harness/rendered_wrangler.cjs')

const { lib, targetLib, ROOT } = wrangler
const CLI = path.join(ROOT, 'ops', 'scripts', 'client', 'render-wrangler.mjs')

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.message ? err.message.split('\n').join('\n  ') : err}`)
    process.exitCode = 1
  }
}

const throwsRender = (fn, re, label) => {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof lib.RenderError, `${label}: expected a RenderError, got ${err && err.stack}`)
    if (re) assert.match(err.problems.join('\n'), re, label)
    return err
  }
  assert.fail(`${label}: expected the render to be refused`)
}

const withOverrides = (o) => {
  const map = lib.readEnvFile(wrangler.EXAMPLE_ENV)
  for (const [k, v] of Object.entries(o)) { if (v === undefined) map.delete(k); else map.set(k, v) }
  return map
}

// ---------------------------------------------------------------- 1. template

check('the template holds placeholders only, no value of any client', () => {
  const text = wrangler.template()
  const body = text.split(/\r?\n/).filter((l) => !/^\{\{!.*\}\}$/.test(l.trim())).join('\n')
  const forbidden = [
    [/leang|dpdns|digitalplat/i, 'a client name or retired domain'],
    [/\b[0-9a-f]{32}\b/, 'a 32-hex account or KV id'],
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/, 'a database id'],
    [/https?:\/\/[A-Za-z0-9]/, 'a URL'],
    [/@[a-z0-9-]+\.[a-z]{2,}/i, 'an e-mail address or DSN'],
    [/apps\.googleusercontent\.com|sentry\.io/i, 'an OAuth client or Sentry project'],
    [/(?<![A-Za-z_])business-os(?![A-Za-z_])/, 'a hard-coded business-os resource name'],
    [/\b(?:aws|gcp|azure):[a-z]{2}-/, 'a hard-coded placement region'],
    [/Cambodia|Phnom/i, 'a place'],
  ]
  for (const [re, what] of forbidden) assert.ok(!re.test(body), `the template contains ${what}`)
  // the only account-specific numbers a template could carry
  assert.ok(!/namespace_id = "\d/.test(body), 'a hard-coded rate-limit namespace')
})

check('every placeholder is a declared variable, every declared variable is used, the template lints clean', () => {
  const text = wrangler.template()
  assert.deepEqual(lib.lintTemplate(text), [])
  const forwarder = fs.readFileSync(path.join(ROOT, 'cloudflare', 'admin-forwarder', 'wrangler.template.toml'), 'utf8')
  assert.deepEqual(lib.lintTemplate(forwarder), [])
  const used = new Set([...lib.templatePlaceholders(text), ...lib.templatePlaceholders(forwarder)])
  const declared = new Set(lib.VARIABLES.filter((v) => v.kind !== 'meta').map((v) => v.name))
  for (const name of used) assert.ok(declared.has(name) || lib.COMPUTED.includes(name), `{{${name}}} is not declared`)
  const viaComputed = new Set(lib.COMPUTED.filter((c) => used.has(c)).flatMap((c) => lib.COMPUTED_SOURCES[c]))
  for (const name of declared) assert.ok(used.has(name) || viaComputed.has(name), `${name} is declared but the template never uses it`)
  for (const name of lib.COMPUTED) assert.ok(used.has(name), `${name} is computed but unused`)
  // identity and plan are read by tooling, never spliced
  for (const meta of lib.VARIABLES.filter((v) => v.kind === 'meta')) assert.ok(!used.has(meta.name), `${meta.name} must not be a template placeholder`)
})

check('the free variant is derived from the same template with exactly the three documented differences', () => {
  const paid = wrangler.paid()
  const free = wrangler.free()
  const norm = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const p = norm(paid)
  const f = norm(free)
  const onlyPaid = p.filter((l) => !f.includes(l))
  const onlyFree = f.filter((l) => !p.includes(l))
  assert.deepEqual(onlyPaid.sort(), ['PLAN_TIER = "paid"', '[limits]', 'cpu_ms = 300000', 'max_batch_size = 5', 'subrequests = 10_000'].sort())
  assert.deepEqual(onlyFree.sort(), ['PLAN_TIER = "free"'].sort(), 'the free file only re-states max_batch_size = 1, which the paid file also has')
  assert.match(free, /DIFF 1 of 3/)
  assert.match(free, /DIFF 2 of 3/)
  assert.match(free, /DIFF 3 of 3/)
  assert.ok(!/DIFF \d of 3/.test(paid), 'the paid file carries no diff markers')
})

// ------------------------------------------------------------ 2. example.env

check('clients/example.env declares every variable exactly once, documented, with fake values', () => {
  const text = fs.readFileSync(wrangler.EXAMPLE_ENV, 'utf8').replace(/\r\n/g, '\n')
  const parsed = lib.parseEnvText(text)
  assert.deepEqual(parsed.problems, [])
  assert.deepEqual([...parsed.values.keys()], lib.VARIABLES.map((v) => v.name), 'same variables, same order as the registry')
  const lines = text.split('\n')
  for (const v of lib.VARIABLES) {
    const at = lines.findIndex((l) => l.startsWith(`${v.name}=`))
    assert.ok(at > 0 && lines[at - 1].startsWith('#'), `${v.name} has no comment line directly above it`)
    assert.ok(lines.slice(0, at).join('\n').includes(v.doc.split(' ').slice(0, 4).join(' ')), `${v.name}: the registry's description is not in the file`)
  }
  assert.ok(wrangler.values.CF_ACCOUNT_ID === '0'.repeat(32), 'example values must be obviously fake')
  assert.ok(!/leang/i.test(text), 'the example names no real client')
  for (const host of wrangler.values.ROUTES.split(',')) assert.match(host, /(^|\.)example\.com$/)
})

check('the example renders in both variants and the output has no unresolved placeholder and only LF', () => {
  for (const text of [wrangler.paid(), wrangler.free()]) {
    assert.ok(!/\{\{|\}\}/.test(text))
    assert.ok(!text.includes('\r'))
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'))
    assert.match(text, /^name = "example-shop"$/m)
    assert.match(text, /^account_id = "0{32}"$/m)
  }
})

// ----------------------------------------------------------- 3. fails loudly

check('a missing variable is named, together with every other problem, in one refusal', () => {
  const err = throwsRender(() => lib.resolveValues(withOverrides({ CF_ACCOUNT_ID: undefined, D1_MAIN_ID: undefined, SENTRY_DSN: undefined }), { strict: true }), /CF_ACCOUNT_ID is not set/, 'missing')
  assert.match(err.problems.join('\n'), /D1_MAIN_ID is not set/)
  assert.match(err.problems.join('\n'), /SENTRY_DSN is not set \(set it to none if the client has none\)/)
  assert.equal(err.problems.length, 3)
})

check('an unknown variable in a client file is refused (a typo must not be ignored), but the process environment is read leniently', () => {
  throwsRender(() => lib.resolveValues(withOverrides({ D1_MAIN_IDD: '1' }), { strict: true }), /D1_MAIN_IDD is not a variable/, 'typo')
  const lenient = new Map(withOverrides({}))
  const env = Object.fromEntries(lenient)
  env.PATH = '/usr/bin'
  env.GITHUB_SHA = 'abc'
  assert.equal(lib.resolveValues(env).CF_ACCOUNT_ID, '0'.repeat(32))
})

check('an invalid value is refused by variable name and format, and no message ever carries a value', () => {
  const SENTINEL = 'TOP-SECRET-SENTINEL-9f3a'
  for (const name of lib.VARIABLES.filter((v) => v.kind !== 'note').map((v) => v.name)) {
    const err = throwsRender(() => lib.resolveValues(withOverrides({ [name]: `${SENTINEL} "x"\nCF` })), new RegExp(`${name}`), `bad ${name}`)
    assert.ok(!err.message.includes(SENTINEL), `${name}: the message carries the value`)
  }
  throwsRender(() => lib.resolveValues(withOverrides({ ADMIN_URL: 'https://admin.example.com/' })), /ADMIN_URL has an invalid value/, 'trailing slash')
  throwsRender(() => lib.resolveValues(withOverrides({ ADMIN_URL: 'http://admin.example.com' })), /ADMIN_URL/, 'http')
  throwsRender(() => lib.resolveValues(withOverrides({ PLAN_TIER: 'gold' })), /PLAN_TIER/, 'plan')
  throwsRender(() => lib.resolveValues(withOverrides({ ROUTES: 'example.com,example.com' })), /lists a host twice/, 'duplicate route')
  throwsRender(() => lib.resolveValues(withOverrides({ ORG_NAME: 'Quote " inside' })), /ORG_NAME/, 'a quote would break the TOML string')
  throwsRender(() => lib.resolveValues(withOverrides({ ORG_NAME: 'Brace {{X}}' })), /template brace/, 'template injection')
  throwsRender(() => lib.resolveValues(withOverrides({ NOTE_ROUTES: 'not a comment' })), /must start with #/, 'a note must be comments')
  throwsRender(() => lib.resolveValues(withOverrides({ NOTE_ROUTES: '# fine\nCF_ACCOUNT_ID = "x"' })), /must start with #/, 'a note cannot smuggle config')
  throwsRender(() => lib.resolveValues(withOverrides({ D1_MAIN_NAME: '' })), /D1_MAIN_NAME is empty/, 'empty required')
})

check('optional integrations are explicit: none or empty means off, absence is an error, and none is refused where a value is required', () => {
  const off = lib.resolveValues(withOverrides({ SENTRY_DSN: 'none', RESEND_FROM_EMAIL: '', GOOGLE_LOGIN_CLIENT_ID: 'none', GOOGLE_LOGIN_REDIRECT_URI: 'none', GOOGLE_DRIVE_CLIENT_ID: 'none', GOOGLE_DRIVE_REDIRECT_URI: 'none', ROUTES: 'none' }))
  const text = lib.renderVariant(wrangler.template(), off, 'paid')
  for (const gone of ['SENTRY_DSN', 'RESEND_FROM_EMAIL', 'GOOGLE_LOGIN_CLIENT_ID', 'GOOGLE_LOGIN_REDIRECT_URI', 'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_REDIRECT_URI', 'routes = [']) {
    assert.ok(!text.includes(gone), `${gone} is switched off, so no entry (not even an empty one) is written`)
  }
  assert.match(text, /^BUSINESS_OS_ORGANIZATION_NAME = "Example Shop"$/m, 'what stays, stays')
  throwsRender(() => lib.resolveValues(withOverrides({ CF_ACCOUNT_ID: 'none' })), /CF_ACCOUNT_ID/, 'none for a required value')
})

check('a bad template is refused: unknown placeholder, unclosed block, stray brace', () => {
  const values = wrangler.values
  const t = wrangler.template()
  throwsRender(() => lib.renderVariant(`${t}\nx = "{{NOT_A_VARIABLE}}"\n`, values, 'paid'), /unknown placeholder \{\{NOT_A_VARIABLE\}\}/, 'unknown')
  throwsRender(() => lib.renderVariant(`${t}\n{{#free}}\nx = 1\n`, values, 'paid'), /never closed/, 'unclosed')
  throwsRender(() => lib.renderVariant(`${t}\n{{/paid}}\n`, values, 'paid'), /closes nothing/, 'closes nothing')
  throwsRender(() => lib.renderVariant(`${t}\nx = "{{ BAD NAME }}"\n`, values, 'paid'), /malformed/, 'malformed')
  throwsRender(() => lib.renderVariant(`${t}\nx = "{{CLIENT_SLUG}}"\n`, values, 'paid'), /unknown placeholder \{\{CLIENT_SLUG\}\}/, 'a meta variable is not a placeholder')
  throwsRender(() => lib.renderVariant(t, values, 'gold'), /plan must be paid or free/, 'plan')
})

check('dotenv reading: quotes, escapes, multi-line values, comments and duplicates', () => {
  const ok = lib.parseEnvText('# c\nA=1\nB="two words" # tail\nC=\'raw \\n text\'\nD="line1\\nline2"\nE="a\n# b"\nF=x # note\n\n')
  assert.deepEqual(ok.problems, [])
  assert.equal(ok.values.get('A'), '1')
  assert.equal(ok.values.get('B'), 'two words')
  assert.equal(ok.values.get('C'), 'raw \\n text')
  assert.equal(ok.values.get('D'), 'line1\nline2')
  assert.equal(ok.values.get('E'), 'a\n# b')
  assert.equal(ok.values.get('F'), 'x')
  assert.equal(lib.parseEnvText('A=1\r\nB=2\r\n').values.get('B'), '2', 'CRLF files read the same')
  assert.match(lib.parseEnvText('A=1\nA=2').problems.join(), /A is set twice/)
  assert.match(lib.parseEnvText('lower=1').problems.join(), /expected NAME=value/)
  assert.match(lib.parseEnvText('A="open').problems.join(), /no closing double quote/)
  assert.match(lib.parseEnvText('A="x" y').problems.join(), /text after the closing quote/)
  assert.match(lib.parseEnvText('A=x"y').problems.join(), /quote character/)
})

check('a note renders as comment lines, in place, in the right variant; an empty one drops its line', () => {
  const note = '# first\n#\n# third'
  const text = wrangler.paid({ NOTE_ROUTES: note, NOTE_PLACEMENT: '# paid-only note', NOTE_PLACEMENT_FREE: '# free-only note' })
  assert.match(text, /# first\n#\n# third\nroutes = \[/)
  assert.match(text, /# paid-only note\n\[placement\]/)
  assert.ok(!text.includes('free-only note'))
  const free = wrangler.free({ NOTE_PLACEMENT: '# paid-only note', NOTE_PLACEMENT_FREE: '# free-only note' })
  assert.match(free, /# free-only note\n\[placement\]/)
  assert.ok(!free.includes('paid-only note'))
  const bare = wrangler.paid()
  assert.match(bare, /^account_id = "0{32}"\nworkers_dev = false\n/m, 'an empty note leaves no blank line behind')
})

check('the renderer is deterministic and its two variants never share a file', () => {
  assert.equal(wrangler.paid(), wrangler.paid())
  assert.notEqual(wrangler.paid(), wrangler.free())
  const files = lib.renderFiles(wrangler.template(), wrangler.values, {})
  assert.deepEqual(Object.keys(files), ['wrangler.toml'])
  assert.deepEqual(Object.keys(lib.renderFiles(wrangler.template(), wrangler.valuesWith({ PLAN_TIER: 'free' }), {})), ['wrangler.toml', 'wrangler.free.toml'])
  assert.deepEqual(Object.keys(lib.renderFiles(wrangler.template(), wrangler.values, { all: true })), ['wrangler.toml', 'wrangler.free.toml'])
})

// ------------------------------------------------------------ 4. no collision

check('two clients in one account share no resource name: queues, dataset, Worker, databases, bucket, namespace all follow the variables', () => {
  const a = wrangler.valuesWith({})
  const b = wrangler.valuesWith({
    WORKER_NAME: 'second-shop', D1_MAIN_NAME: 'second-shop-db', D1_IMPORT_NAME: 'second-shop-import-db', R2_BUCKET: 'second-shop-assets',
    ANALYTICS_DATASET: 'Second_Shop_Analytics', RATELIMIT_NAMESPACE_ID: '2002', QUEUE_PREFIX: 'second-shop',
    D1_MAIN_ID: '11111111-1111-4111-8111-111111111111', D1_IMPORT_ID: '22222222-2222-4222-8222-222222222222', KV_CACHE_ID: '3'.repeat(32),
  })
  const ta = targetLib.parseTarget(lib.renderVariant(wrangler.template(), a, 'paid'))
  const tb = targetLib.parseTarget(lib.renderVariant(wrangler.template(), b, 'paid'))
  const names = (t) => [t.workerName, t.main.name, t.importDb.name, t.assetsBucket, t.analyticsDataset, ...Object.values(t.queues), ...t.consumers]
  const overlap = names(ta).filter((n) => names(tb).includes(n))
  assert.deepEqual(overlap, [], 'a name the template emits does not follow a variable, so two clients would collide')
  assert.equal(ta.consumers.length, 4)
  assert.deepEqual(ta.consumers.map((q) => q.slice(a.QUEUE_PREFIX.length)), ['-import', '-import-dlq', '-media', '-backup-assets'])
  // the rate-limit namespace and the identity of the databases are variables too
  assert.match(lib.renderVariant(wrangler.template(), b, 'paid'), /namespace_id = "2002"/)
  assert.notEqual(ta.main.id, tb.main.id)
})

check('the Worker tells its four queues apart by their ending, so any QUEUE_PREFIX is served', () => {
  const index = fs.readFileSync(path.join(ROOT, 'cloudflare', 'src', 'index.ts'), 'utf8')
  assert.ok(!/batch\.queue === 'business-os-/.test(index), 'index.ts still dispatches on a hard-coded queue name')
  assert.match(index, /queueRole\(batch\.queue\)/)
})

// ------------------------------------------------------------- 5. target parser

check('the target parser reads back what the renderer wrote', () => {
  const t = wrangler.target()
  const v = wrangler.values
  assert.equal(t.accountId, v.CF_ACCOUNT_ID)
  assert.equal(t.workerName, v.WORKER_NAME)
  assert.deepEqual(t.routes, v.ROUTES.split(','))
  assert.equal(t.main.binding, 'DB'); assert.equal(t.main.name, v.D1_MAIN_NAME); assert.equal(t.main.id, v.D1_MAIN_ID); assert.equal(t.main.migrationsDir, 'migrations')
  assert.equal(t.importDb.name, v.D1_IMPORT_NAME); assert.equal(t.importDb.id, v.D1_IMPORT_ID); assert.equal(t.importDb.migrationsDir, 'migrations-import')
  assert.equal(t.assetsBucket, v.R2_BUCKET)
  assert.equal(t.analyticsDataset, v.ANALYTICS_DATASET)
  assert.deepEqual(t.queues, { IMPORT_QUEUE: `${v.QUEUE_PREFIX}-import`, MEDIA_QUEUE: `${v.QUEUE_PREFIX}-media`, BACKUP_QUEUE: `${v.QUEUE_PREFIX}-backup-assets` })
  assert.equal(t.vars.BUSINESS_OS_ADMIN_URL, v.ADMIN_URL)
  assert.equal(t.vars.PLAN_TIER, 'paid')
  assert.equal(wrangler.targetLib.parseTarget(wrangler.free()).vars.PLAN_TIER, 'free')
  assert.throws(() => targetLib.parseTarget(''), /no account/)
  assert.throws(() => targetLib.parseTarget('name = "x"\naccount_id = "y"\n'), /no account/)
})

check('target expectations: equal passes, any difference is a fixed phrase without a value, and CI can demand all three', () => {
  const t = wrangler.target()
  const v = wrangler.values
  const ok = { accountId: v.CF_ACCOUNT_ID, d1MainId: v.D1_MAIN_ID, adminUrl: `${v.ADMIN_URL}/` }
  assert.deepEqual(targetLib.checkExpectations(t, ok, { accountSecret: v.CF_ACCOUNT_ID, require: true }), [])
  for (const [field, value, re] of [
    ['accountId', '1'.repeat(32), /account id differs/],
    ['d1MainId', '00000000-0000-4000-8000-0000000000ff', /main database id differs/],
    ['adminUrl', 'https://other.example.com', /admin url differs/],
  ]) {
    const problems = targetLib.checkExpectations(t, { ...ok, [field]: value })
    assert.equal(problems.length, 1); assert.match(problems[0], re); assert.ok(!problems[0].includes(value))
  }
  assert.match(targetLib.checkExpectations(t, ok, { accountSecret: '2'.repeat(32) }).join(), /CLOUDFLARE_ACCOUNT_ID secret differs/)
  assert.match(targetLib.checkExpectations(t, {}, { require: true }).join(), /not all provided/)
  assert.deepEqual(targetLib.checkExpectations(t, {}), [], 'a local run with nothing expected only checks the shape')
  assert.deepEqual(targetLib.expectationsFromEnv({ CF_ACCOUNT_ID: ' abc ', D1_MAIN_ID: '', ADMIN_URL: 'https://x.test//' }), { accountId: 'abc', d1MainId: '', adminUrl: 'https://x.test', planTier: '' })
  const who = JSON.stringify({ loggedIn: true, authType: 'Account API Token', accounts: [{ id: v.CF_ACCOUNT_ID, name: 'n' }] })
  assert.equal(targetLib.whoamiHasAccount(`[with-wrangler-auth] note\n${who}`, v.CF_ACCOUNT_ID), true)
  assert.equal(targetLib.whoamiHasAccount(who, '9'.repeat(32)), false, 'a token for another account fails')
  assert.equal(targetLib.whoamiHasAccount('You are not authenticated', v.CF_ACCOUNT_ID), false)
  assert.equal(targetLib.whoamiHasAccount(JSON.stringify({ loggedIn: false, accounts: [{ id: v.CF_ACCOUNT_ID }] }), v.CF_ACCOUNT_ID), false)
})

// ------------------------------------------------------------------- the CLI

function cli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 })
}

check('render-wrangler writes the paid file, adds the free file for a free client, and removes a stale free file', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'render-cli-'))
  try {
    let r = cli(['--env-file', wrangler.EXAMPLE_ENV, '--out-dir', out])
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(fs.readdirSync(out), ['wrangler.toml'])
    assert.equal(fs.readFileSync(path.join(out, 'wrangler.toml'), 'utf8'), wrangler.paid())
    r = cli(['--env-file', wrangler.EXAMPLE_ENV, '--out-dir', out, '--plan', 'free'])
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(fs.readdirSync(out).sort(), ['wrangler.free.toml', 'wrangler.toml'])
    assert.equal(fs.readFileSync(path.join(out, 'wrangler.free.toml'), 'utf8'), wrangler.free())
    r = cli(['--env-file', wrangler.EXAMPLE_ENV, '--out-dir', out])
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(fs.readdirSync(out), ['wrangler.toml'], 'a free file from an earlier client must not survive a paid render')
    assert.match(r.stdout, /removed a wrangler\.free\.toml/)
    r = cli(['--env-file', wrangler.EXAMPLE_ENV, '--out-dir', out, '--all'])
    assert.deepEqual(fs.readdirSync(out).sort(), ['wrangler.free.toml', 'wrangler.toml'])
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})

check('render-wrangler reads GitHub variables from a JSON environment variable and the process environment, and --check writes nothing', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'render-cli-'))
  try {
    const vars = Object.fromEntries(wrangler.lib.readEnvFile(wrangler.EXAMPLE_ENV))
    let r = cli(['--vars-json-env', 'CLIENT_VARS', '--out-dir', out], { CLIENT_VARS: JSON.stringify({ ...vars, UNRELATED_REPO_VARIABLE: 'x' }) })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(fs.readFileSync(path.join(out, 'wrangler.toml'), 'utf8'), wrangler.paid())
    fs.rmSync(path.join(out, 'wrangler.toml'))
    r = cli(['--out-dir', out], vars)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(fs.readFileSync(path.join(out, 'wrangler.toml'), 'utf8'), wrangler.paid())
    fs.rmSync(path.join(out, 'wrangler.toml'))
    r = cli(['--env-file', wrangler.EXAMPLE_ENV, '--out-dir', out, '--check'])
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(fs.readdirSync(out), [])
    r = cli(['--vars-json-env', 'CLIENT_VARS', '--out-dir', out], { CLIENT_VARS: 'not json' })
    assert.equal(r.status, 1); assert.match(r.stderr, /CLIENT_VARS is not a JSON object/)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})

check('render-wrangler refuses with every problem listed, writes nothing, and the output carries no value', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'render-cli-'))
  const bad = path.join(out, 'bad.env')
  try {
    const text = fs.readFileSync(wrangler.EXAMPLE_ENV, 'utf8')
      .replace(/^CF_ACCOUNT_ID=.*$/m, 'CF_ACCOUNT_ID=SENTINEL-NOT-AN-ID')
      .replace(/^D1_MAIN_ID=.*\r?\n/m, '')
      .replace(/^ORG_SLUG=.*$/m, 'ORG_SLUG=ok\nSURPRISE=1')
    fs.writeFileSync(bad, text)
    const dest = path.join(out, 'dest')
    const r = cli(['--env-file', bad, '--out-dir', dest])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /CF_ACCOUNT_ID has an invalid value/)
    assert.match(r.stderr, /D1_MAIN_ID is not set/)
    assert.match(r.stderr, /SURPRISE is not a variable/)
    assert.ok(!(r.stdout + r.stderr).includes('SENTINEL-NOT-AN-ID'), 'a value reached the output')
    assert.ok(!fs.existsSync(dest), 'a refused render must not create the output folder')
    // Node itself also reads --env-file, so a missing file stops inside Node (exit 9) before the renderer runs.
    assert.notEqual(cli(['--env-file', path.join(out, 'missing.env'), '--out-dir', dest]).status, 0)
    assert.ok(!fs.existsSync(dest))
    assert.equal(cli(['--bogus']).status, 1)
    assert.equal(cli(['--env-file', wrangler.EXAMPLE_ENV, '--vars-json-env', 'X']).status, 1)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})

check('a token for one account never runs against another client\'s rendered config (with-wrangler-auth refuses before running anything)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrangler-auth-guard-'))
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'))
    fs.copyFileSync(path.join(ROOT, 'cloudflare', 'scripts', 'with-wrangler-auth.cjs'), path.join(tmp, 'scripts', 'with-wrangler-auth.cjs'))
    const bin = path.join(tmp, 'node_modules', 'wrangler', 'bin')
    fs.mkdirSync(bin, { recursive: true })
    const marker = path.join(tmp, 'ran')
    fs.writeFileSync(path.join(bin, 'wrangler.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')\n`)
    fs.writeFileSync(path.join(tmp, 'wrangler.toml'), wrangler.paid())
    fs.writeFileSync(path.join(tmp, 'other.toml'), wrangler.paid({ CF_ACCOUNT_ID: '9'.repeat(32) }))
    const run = (account, args = ['wrangler', 'whoami']) => {
      fs.rmSync(marker, { force: true })
      const env = { ...process.env, CLOUDFLARE_API_TOKEN: 'fixture-not-a-token' }
      if (account === null) delete env.CLOUDFLARE_ACCOUNT_ID; else env.CLOUDFLARE_ACCOUNT_ID = account
      return spawnSync(process.execPath, [path.join(tmp, 'scripts', 'with-wrangler-auth.cjs'), ...args], { cwd: tmp, env, encoding: 'utf8' })
    }
    const same = run(wrangler.values.CF_ACCOUNT_ID)
    assert.equal(same.status, 0, same.stderr); assert.ok(fs.existsSync(marker), 'the matching account runs')
    const other = run('8'.repeat(32))
    assert.equal(other.status, 1); assert.ok(!fs.existsSync(marker), 'a mismatch must run nothing')
    assert.match(other.stderr, /REFUSED/); assert.ok(!other.stderr.includes('8'.repeat(32)) && !other.stderr.includes('0'.repeat(32)), 'no account id in the message')
    assert.equal(run('9'.repeat(32), ['wrangler', 'whoami', '--config', 'other.toml']).status, 0, 'the --config file is the one compared')
    assert.equal(run(wrangler.values.CF_ACCOUNT_ID, ['wrangler', 'whoami', '--config=other.toml']).status, 1)
    assert.equal(run('8'.repeat(32), [process.execPath, path.join(bin, 'wrangler.js'), 'whoami']).status, 1, 'the release kit runs node + wrangler.js: also guarded')
    assert.equal(run(null).status, 0, 'no account in the environment (a browser login) is not guessed at')
    const notWrangler = run('8'.repeat(32), [process.execPath, '-e', '0'])
    assert.equal(notWrangler.status, 0, 'only wrangler commands are guarded')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ------------------------------------------------- 6. leaving things out

const allOff = {
  SENTRY_DSN: 'none', RESEND_FROM_EMAIL: 'none', GOOGLE_LOGIN_CLIENT_ID: 'none', GOOGLE_LOGIN_REDIRECT_URI: 'none',
  GOOGLE_DRIVE_CLIENT_ID: 'none', GOOGLE_DRIVE_REDIRECT_URI: 'none', ROUTES: 'none', ANALYTICS_DATASET: 'none', RATELIMIT_NAMESPACE_ID: 'none',
  IMAGES_BINDING: 'false', VERSION_METADATA: 'false',
}
const GONE = ['[[analytics_engine_datasets]]', 'Business_OS_Analytics', '[[ratelimits]]', 'PORTAL_SEARCH_LIMITER', '[version_metadata]', 'CF_VERSION_METADATA', '[images]', 'IMAGES', 'routes = [', 'SENTRY_DSN', 'GOOGLE_']

check('every binding the code treats as optional can be left out, in both variants, and nothing empty or dangling is left behind', () => {
  const values = wrangler.valuesWith(allOff)
  for (const plan of ['paid', 'free']) {
    const text = lib.renderVariant(wrangler.template(), values, plan)
    for (const gone of GONE) assert.ok(!text.includes(gone), `${plan}: ${gone} should be gone`)
    assert.ok(!/\n\n\n\n/.test(text), `${plan}: no run of blank lines where blocks were left out`)
    assert.deepEqual(lib.lintTemplate(wrangler.template()), [])
    const t = targetLib.parseTarget(text)
    assert.equal(t.analyticsDataset, undefined, 'the target reads an absent dataset as absent')
    assert.deepEqual(t.routes, [])
    assert.equal(t.assetsBucket, 'example-shop-assets', 'the bindings the code needs are still there')
    assert.equal(t.queues.IMPORT_QUEUE, 'example-shop-import')
    assert.ok(text.includes('[[kv_namespaces]]') && text.includes('[[d1_databases]]') && text.includes('[[durable_objects.bindings]]'))
  }
  // each switch is independent: one optional block back at a time
  for (const [back, marker] of [[{ ANALYTICS_DATASET: 'Back_Analytics' }, 'dataset = "Back_Analytics"'], [{ RATELIMIT_NAMESPACE_ID: '7' }, 'namespace_id = "7"'], [{ IMAGES_BINDING: 'true' }, 'binding = "IMAGES"'], [{ VERSION_METADATA: 'true' }, 'binding = "CF_VERSION_METADATA"'], [{ SENTRY_DSN: 'https://abcdef@o1.ingest.example.invalid/1' }, 'SENTRY_DSN = "https://abcdef@o1.ingest.example.invalid/1"']]) {
    const text = lib.renderVariant(wrangler.template(), wrangler.valuesWith({ ...allOff, ...back }), 'paid')
    assert.ok(text.includes(marker), `${marker} is back when its variable is set`)
  }
})

check('a pair of integration variables is both set or both none: a half-set pair is refused', () => {
  throwsRender(() => lib.resolveValues(withOverrides({ GOOGLE_LOGIN_REDIRECT_URI: 'none' })), /GOOGLE_LOGIN_CLIENT_ID and GOOGLE_LOGIN_REDIRECT_URI must both/, 'login half')
  throwsRender(() => lib.resolveValues(withOverrides({ GOOGLE_DRIVE_CLIENT_ID: 'none' })), /GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_REDIRECT_URI must both/, 'drive half')
})

check('a Worker served on workers.dev gets no preview URLs and no routes; one without workers.dev writes neither line', () => {
  const dev = wrangler.paid({ WORKERS_DEV: 'true', ROUTES: 'none' })
  assert.match(dev, /^workers_dev = true\npreview_urls = false$/m)
  assert.ok(!dev.includes('routes = ['))
  const prod = wrangler.paid()
  assert.match(prod, /^workers_dev = false$/m)
  assert.ok(!prod.includes('preview_urls'))
})

const IDENTITY = {
  SHOP_NAME: 'Example Shop', SHOP_NAME_KM: 'ហាងគំរូ', SHOP_ALIAS: 'Example', SHOP_CATEGORY: 'beauty', SHOP_ICON_PREFIX: '/example-',
  ADMIN_SHORT_NAME: 'Example Admin', MEMBERSHIP_PREFIX: 'EX-',
}

check('the shop identity is seven optional [vars], written in a fixed order after the organization name, and absent when unset', () => {
  const none = wrangler.paid()
  assert.ok(!/BUSINESS_OS_(SHOP|ADMIN_SHORT|MEMBERSHIP)/.test(none), 'the example client sets no identity: not one line')
  assert.ok(!none.includes('Client identity'), 'and not its comment either')
  const text = wrangler.paid(IDENTITY)
  const lines = text.split('\n')
  const after = lines.indexOf('BUSINESS_OS_ORGANIZATION_NAME = "Example Shop"')
  assert.ok(after > 0)
  const block = lines.slice(after + 1).filter((l) => l.startsWith('BUSINESS_OS_')).slice(0, 7)
  assert.deepEqual(block, [
    'BUSINESS_OS_SHOP_NAME = "Example Shop"', 'BUSINESS_OS_SHOP_NAME_KM = "ហាងគំរូ"', 'BUSINESS_OS_SHOP_ALIAS = "Example"', 'BUSINESS_OS_SHOP_CATEGORY = "beauty"',
    'BUSINESS_OS_SHOP_ICON_PREFIX = "/example-"', 'BUSINESS_OS_ADMIN_SHORT_NAME = "Example Admin"', 'BUSINESS_OS_MEMBERSHIP_PREFIX = "EX-"',
  ])
  assert.match(text, /# Client identity \(cloudflare\/src\/lib\/clientIdentity\.ts\)/)
  // each is optional on its own
  const two = wrangler.paid({ SHOP_NAME: 'Only Name', MEMBERSHIP_PREFIX: 'ON-' })
  assert.deepEqual(two.split('\n').filter((l) => /^BUSINESS_OS_(SHOP|ADMIN_SHORT|MEMBERSHIP)/.test(l)), ['BUSINESS_OS_SHOP_NAME = "Only Name"', 'BUSINESS_OS_MEMBERSHIP_PREFIX = "ON-"'])
  // a set of "none" is the same as unset; a bad value is refused by name
  assert.equal(wrangler.paid({ SHOP_ALIAS: 'none' }), none)
  for (const [key, bad] of [['SHOP_NAME', 'a"b'], ['SHOP_CATEGORY', 'Beauty Shop'], ['SHOP_ICON_PREFIX', 'icons/x'], ['MEMBERSHIP_PREFIX', 'LC--01'], ['ADMIN_SHORT_NAME', '']]) {
    if (bad === '') { assert.ok(!wrangler.paid({ [key]: bad }).includes('ADMIN_SHORT')); continue }
    throwsRender(() => lib.resolveValues(withOverrides({ [key]: bad })), new RegExp(`${key} has an invalid value`), key)
  }
})

check('the two manifest routes follow MANIFEST_ROUTES alone, not the shop name, and sit right after the sitemap', () => {
  const route = '  "/manifest.json", "/portal-manifest.json",'
  assert.ok(!wrangler.paid(IDENTITY).includes('"/manifest.json"'), 'an identity without the switch leaves the manifests static')
  for (const plan of ['paid', 'free']) {
    const on = lib.renderVariant(wrangler.template(), wrangler.valuesWith({ ...IDENTITY, MANIFEST_ROUTES: 'true' }), plan)
    const lines = on.split('\n')
    const at = lines.indexOf(route)
    assert.ok(at > 0 && lines.filter((l) => l === route).length === 1, `${plan}: the two routes appear once`)
    assert.match(lines[at - 1], /"\/sitemap\.xml",$/)
    assert.equal(targetLib.parseTarget(on).workerName, 'example-shop')
  }
  assert.ok(wrangler.paid({ MANIFEST_ROUTES: 'true' }).includes('/portal-manifest.json'), 'the switch works without an identity too')
  throwsRender(() => lib.resolveValues(withOverrides({ MANIFEST_ROUTES: 'yes' })), /MANIFEST_ROUTES has an invalid value/, 'bad switch')
})

check('QUEUE_PREFIX defaults to the code\'s own queue names; another prefix needs release 6.0.959 or later and says so', () => {
  const v = lib.resolveValues(withOverrides({ QUEUE_PREFIX: undefined }))
  assert.equal(v.QUEUE_PREFIX, 'business-os')
  const t = targetLib.parseTarget(lib.renderVariant(wrangler.template(), v, 'paid'))
  assert.deepEqual(t.consumers, ['business-os-import', 'business-os-import-dlq', 'business-os-media', 'business-os-backup-assets'])
  assert.match(lib.VARIABLES.find((x) => x.name === 'QUEUE_PREFIX').doc, /6\.0\.959/)
})

check('the optional admin forwarder is rendered from its own template for a client that names one, and for nobody else', () => {
  const forwarderTemplate = fs.readFileSync(path.join(ROOT, 'cloudflare', 'admin-forwarder', 'wrangler.template.toml'), 'utf8')
  assert.ok(!/[0-9a-f]{32}|example|leang|bm|business-os/i.test(forwarderTemplate.replace(/\{\{[^}]*\}\}/g, '')), 'the forwarder template holds no client value')
  const none = lib.renderFiles(wrangler.template(), wrangler.valuesWith({}), { forwarderTemplate })
  assert.deepEqual(Object.keys(none), ['wrangler.toml'])
  const files = lib.renderFiles(wrangler.template(), wrangler.valuesWith({ FORWARDER_NAME: 'example-admin' }), { forwarderTemplate })
  assert.deepEqual(Object.keys(files), ['wrangler.toml', lib.FORWARDER_FILE])
  const text = files[lib.FORWARDER_FILE]
  assert.match(text, /^name = "example-admin"$/m)
  assert.match(text, /^account_id = "0{32}"$/m)
  assert.match(text, /\[\[services\]\]\nbinding = "TARGET"\nservice = "example-shop"$/m, 'it hands requests to this client\'s Worker')
  assert.match(text, /^workers_dev = true\npreview_urls = false$/m)
  assert.ok(!text.includes('{{') && !text.includes('\r'))
  // the name is a Worker name; it must not be this client's own Worker
  throwsRender(() => lib.resolveValues(withOverrides({ FORWARDER_NAME: 'Bad Name' })), /FORWARDER_NAME has an invalid value/, 'name')
  assert.equal(lib.resolveValues(withOverrides({ FORWARDER_NAME: 'none' })).FORWARDER_NAME, '')
})

check('render-wrangler writes the forwarder config next to the main one, and removes one left by an earlier client', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'render-forwarder-'))
  const envFile = path.join(out, 'client.env')
  try {
    fs.writeFileSync(envFile, `${fs.readFileSync(wrangler.EXAMPLE_ENV, 'utf8').replace(/^FORWARDER_NAME=.*$/m, 'FORWARDER_NAME=example-admin')}`)
    const dir = path.join(out, 'cf')
    let r = cli(['--env-file', envFile, '--out-dir', dir])
    assert.equal(r.status, 0, r.stderr)
    assert.ok(fs.existsSync(path.join(dir, 'admin-forwarder', 'wrangler.toml')))
    assert.match(fs.readFileSync(path.join(dir, 'admin-forwarder', 'wrangler.toml'), 'utf8'), /^name = "example-admin"$/m)
    assert.match(r.stdout, /rendered admin-forwarder\/wrangler\.toml/)
    r = cli(['--env-file', wrangler.EXAMPLE_ENV, '--out-dir', dir])
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!fs.existsSync(path.join(dir, 'admin-forwarder', 'wrangler.toml')), 'a forwarder of an earlier client must not survive')
    assert.match(r.stdout, /removed an admin forwarder config/)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})

check('with-wrangler-auth.cjs, deploy.cjs, the kit and every ops script name the client config explicitly (the BM incident: a cwd wrangler.toml beat CLOUDFLARE_ACCOUNT_ID)', () => {
  const guard = fs.readFileSync(path.join(ROOT, 'cloudflare', 'scripts', 'with-wrangler-auth.cjs'), 'utf8')
  assert.match(guard, /REFUSED: no --config/)
  const sync = fs.readFileSync(path.join(ROOT, 'cloudflare', 'scripts', 'sync-secrets.cjs'), 'utf8')
  assert.match(sync, /\['secret', 'put', key, '--config', 'wrangler\.toml'\]/)
  assert.match(sync, /REFUSED: the rendered wrangler\.toml is for a different Cloudflare account/)
  const common = fs.readFileSync(path.join(ROOT, 'ops', 'scripts', 'ops-common.mjs'), 'utf8')
  assert.match(common, /\[WRANGLER_JS, \.\.\.withClientConfig\(args\)\]/, 'every ops wrangler call goes through withClientConfig')
})

check('docs/setup/multi-client.md lists every variable of the registry, so a variable nobody documented cannot ship', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'setup', 'multi-client.md'), 'utf8')
  for (const v of lib.VARIABLES) assert.ok(doc.includes(`| \`${v.name}\` |`), `${v.name} is not in the variable tables of docs/setup/multi-client.md`)
  assert.match(doc, /\bCLOUDFLARE_API_TOKEN\b/)
  assert.match(doc, /A client's data is never fixed through the shared code/)
  assert.ok(!/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(doc), 'the guide holds no account or database id')
})

check('POSITIVE CONTROL: a template that hard-codes a value is caught by the same scan that passes the real one', () => {
  const tampered = wrangler.template().replace('{{CF_ACCOUNT_ID}}', 'abcdef0123456789abcdef0123456789')
  assert.notEqual(tampered, wrangler.template())
  assert.match(tampered, /\b[0-9a-f]{32}\b/, 'the control must contain a bare account id')
  assert.ok(!lib.templatePlaceholders(tampered).has('CF_ACCOUNT_ID'), 'and the declared variable must no longer be used')
})

console.log(`test-client-config-render-pure: ${passed} checks passed`)
if (process.exitCode) console.error('SOME CHECKS FAILED')
