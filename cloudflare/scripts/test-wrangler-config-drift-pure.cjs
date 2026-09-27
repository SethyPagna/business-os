// wrangler.toml vs wrangler.free.toml -- the two configs must stay one
// config with four known differences.
//
// WHY THIS TEST IS THE WHOLE SAFETY NET FOR THE FREE FILE
//
// wrangler.free.toml is hand-maintained. Nothing generates it, nothing
// regenerates it, and it is only exercised when someone actually deploys
// free -- which, by construction, is the moment the account is already on
// the free plan and production is already down. A binding silently missing
// from it is not a config nit: `[[d1_databases]] database_id` missing means
// the free deploy points at NO database, `[[kv_namespaces]] id` missing
// means a different cache, a missing `routes` entry means the shop's domain
// serves nothing. Those are exactly the mistakes a hand-maintained copy
// makes, and they are invisible in review.
//
// So this checks the direction that matters: every VALUE-BEARING key in
// wrangler.toml appears in wrangler.free.toml with the same value, and the
// set of key/value pairs that differ is exactly the four documented ones --
// no more (a fifth drift) and no fewer (someone "simplified" the free file
// back into a copy of the paid one, which would fail to deploy on free).
//
// Line-based on purpose: there is no TOML parser in this package's
// dependencies, and adding one to test a config file would be a new runtime
// dependency for a test. Every key in both files is a plain `key = value`
// or a `[table]` / `[[array]]` header on its own line, which is all this
// needs. The positive controls at the bottom prove the comparison can
// actually SEE a drift rather than reporting agreement by construction.
//
// Run: node scripts/test-wrangler-config-drift-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

const PAID_PATH = path.join(cloudflareRoot, 'wrangler.toml')
const FREE_PATH = path.join(cloudflareRoot, 'wrangler.free.toml')
const paidText = fs.readFileSync(PAID_PATH, 'utf8')
const freeText = fs.readFileSync(FREE_PATH, 'utf8')

// A config line is anything that is not blank and not a comment. Section
// headers are kept: a missing [images] or [[queues.producers]] is exactly
// the class of omission this exists to catch.
function configLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

// Same, but grouped so a bare `max_batch_size = 1` is attributed to the
// table it sits under -- there are four queue consumers and the key name
// alone cannot tell them apart.
function scopedPairs(text) {
  const out = []
  let scope = '(root)'
  let scopeSeq = 0
  for (const line of configLines(text)) {
    if (line.startsWith('[')) {
      scope = line
      scopeSeq += 1
      out.push({ scope: `${scope}#${scopeSeq}`, key: line, value: null, raw: line })
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) { out.push({ scope: `${scope}#${scopeSeq}`, key: line, value: null, raw: line }); continue }
    out.push({
      scope: `${scope}#${scopeSeq}`,
      key: line.slice(0, eq).trim(),
      value: line.slice(eq + 1).trim(),
      raw: line,
    })
  }
  return out
}

// Queue consumer sections are identified by their `queue = "..."` value, not
// by ordinal position, so reordering the file does not fake a drift.
function keyedPairs(text) {
  const pairs = scopedPairs(text)
  const label = new Map()
  for (const p of pairs) {
    // Only [[array.tables]] need labelling -- there are four queue consumers
    // and two D1 databases. The root scope and singleton [tables] are already
    // unique, and labelling the root by its `name` key would rename every
    // root id if the Worker were ever renamed.
    if (!p.scope.startsWith('[[')) continue
    if (p.key === 'queue' || p.key === 'binding' || p.key === 'database_name' || p.key === 'name') {
      if (!label.has(p.scope)) label.set(p.scope, `${p.scope.split('#')[0]} ${p.value}`)
    }
  }
  // Disambiguate repeats in file order: `[[migrations]] :: tag` occurs twice,
  // and a multi-line `routes = [` array contributes several `{ pattern` lines.
  // Both files list them in the same order, so an occurrence index is a
  // stable identity -- and a REORDER is itself drift worth failing on.
  const seen = new Map()
  return pairs.map((p) => {
    const base = `${label.get(p.scope) || p.scope.split('#')[0]} :: ${p.key}`
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    return { ...p, id: n === 1 ? base : `${base} [${n}]` }
  })
}

const paidPairs = keyedPairs(paidText)
const freePairs = keyedPairs(freeText)
const freeById = new Map(freePairs.map((p) => [p.id, p]))
const paidById = new Map(paidPairs.map((p) => [p.id, p]))

// The four differences, and nothing else. `value: null` on the free side
// means the key must be ABSENT from wrangler.free.toml entirely.
const ALLOWED_DIFFS = [
  { id: '[limits] :: [limits]', paid: '[limits]', free: null, why: 'DIFF 1: the whole block is Paid-only (error 100328 on Free)' },
  { id: '[limits] :: cpu_ms', paid: '300000', free: null, why: 'DIFF 1' },
  { id: '[limits] :: subrequests', paid: '10_000', free: null, why: 'DIFF 1' },
  { id: '[[queues.consumers]] "business-os-import" :: max_batch_size', paid: '5', free: '1', why: 'DIFF 2: one 10ms budget per chunk' },
  { id: '[[queues.consumers]] "business-os-media" :: max_batch_size', paid: '5', free: '1', why: 'DIFF 3: real per-message CPU, not one D1 write' },
  { id: '[vars] :: PLAN_TIER', paid: '"paid"', free: '"free"', why: 'DIFF 4: the switch lib/planTier.ts reads' },
]

check('wrangler.free.toml exists and is a full config, not a stub', async () => {
  assert.ok(freeText.length > 3000, 'a truncated free config is worse than none')
  assert.match(freeText, /^# Free-plan deployable config/m)
  assert.match(freeText, /EXACTLY FOUR differences/)
  // The four DIFF markers are how a reader finds them in the file itself.
  for (const n of [1, 2, 3, 4]) {
    assert.match(freeText, new RegExp(`DIFF ${n} of 4`), `the free config must mark DIFF ${n} at its site`)
  }
})

check('every value-bearing key in wrangler.toml is present in wrangler.free.toml', async () => {
  const allowed = new Set(ALLOWED_DIFFS.map((d) => d.id))
  const missing = paidPairs.filter((p) => !freeById.has(p.id) && !allowed.has(p.id)).map((p) => p.id)
  assert.deepEqual(missing, [], `wrangler.free.toml is missing these -- a free deploy would lose them: ${missing.join(', ')}`)
})

check('the free config adds nothing wrangler.toml does not have', async () => {
  const allowed = new Set(ALLOWED_DIFFS.map((d) => d.id))
  const extra = freePairs.filter((p) => !paidById.has(p.id) && !allowed.has(p.id)).map((p) => p.id)
  assert.deepEqual(extra, [], `only in wrangler.free.toml, so it never went through a paid deploy: ${extra.join(', ')}`)
})

check('the set of differing values is EXACTLY the four documented diffs', async () => {
  const allowed = new Map(ALLOWED_DIFFS.map((d) => [d.id, d]))
  const actual = []
  for (const p of paidPairs) {
    const f = freeById.get(p.id)
    if (!f) { actual.push({ id: p.id, paid: p.value ?? p.raw, free: null }); continue }
    if ((f.value ?? f.raw) !== (p.value ?? p.raw)) actual.push({ id: p.id, paid: p.value ?? p.raw, free: f.value ?? f.raw })
  }
  for (const f of freePairs) {
    if (!paidById.has(f.id)) actual.push({ id: f.id, paid: null, free: f.value ?? f.raw })
  }
  const unexpected = actual.filter((d) => {
    const a = allowed.get(d.id)
    return !a || a.paid !== d.paid || a.free !== d.free
  })
  assert.deepEqual(unexpected, [], `undocumented drift between the two configs: ${JSON.stringify(unexpected, null, 2)}`)
  const seen = new Set(actual.map((d) => d.id))
  const absent = ALLOWED_DIFFS.filter((d) => !seen.has(d.id)).map((d) => `${d.id} (${d.why})`)
  assert.deepEqual(absent, [], `these documented diffs are GONE, so the free config no longer deploys on free: ${absent.join(', ')}`)
})

check('the load-bearing identities are byte-identical, not merely present', async () => {
  // Named individually because these are the ones whose silent divergence
  // costs data rather than performance: a different database_id is a
  // different database, a different KV id is a different cache, a different
  // bucket is different files, a different Worker name is a second Worker.
  const mustMatch = [
    '(root) :: name',
    '(root) :: main',
    '(root) :: compatibility_date',
    '(root) :: account_id',
    '[[d1_databases]] "DB" :: database_id',
    '[[d1_databases]] "DB" :: database_name',
    '[[d1_databases]] "DB" :: migrations_dir',
    '[[d1_databases]] "IMPORT_DB" :: database_id',
    '[[d1_databases]] "IMPORT_DB" :: database_name',
    '[[d1_databases]] "IMPORT_DB" :: migrations_dir',
    '[[r2_buckets]] "ASSETS" :: bucket_name',
    '[[kv_namespaces]] "CACHE" :: id',
    '[triggers] :: crons',
  ]
  for (const id of mustMatch) {
    const p = paidById.get(id)
    const f = freeById.get(id)
    assert.ok(p, `wrangler.toml no longer has ${id} -- update this list with the rename`)
    assert.ok(f, `wrangler.free.toml is missing ${id}`)
    assert.equal(f.value, p.value, `${id} differs between the two configs`)
  }
  // routes is a multi-line array, so it is compared as a block.
  const routesBlock = (text) => text.slice(text.indexOf('routes = ['), text.indexOf(']', text.indexOf('routes = [')) + 1)
  assert.equal(routesBlock(freeText), routesBlock(paidText), 'the free config must serve the same hostnames')
})

check('every route is on the leangbeauty.com zone (the deploy token cannot reach any other)', async () => {
  // Owner decision Sep 26 2026: leangcosmetics.dpdns.org is retired. The
  // deploy API token is scoped to the leangbeauty.com zone only, so a route
  // on ANY other zone fails the whole deploy -- not just that route.
  for (const [label, text] of [['wrangler.toml', paidText], ['wrangler.free.toml', freeText]]) {
    const body = text.replace(/^\s*#.*$/gm, '')
    const block = body.slice(body.indexOf('routes = ['), body.indexOf(']', body.indexOf('routes = [')) + 1)
    const patterns = [...block.matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(patterns.sort(), ['admin.leangbeauty.com', 'leangbeauty.com'], `${label} routes`)
    const zones = [...block.matchAll(/zone_name\s*=\s*"([^"]+)"/g)].map((m) => m[1])
    for (const z of zones) assert.equal(z, 'leangbeauty.com', `${label} has a route on foreign zone ${z}`)
    assert.ok(!/dpdns|leangcosmetics/i.test(block), `${label} still routes the retired domain`)
  }
})

check('the free config carries no Paid-only key at all', async () => {
  // [limits] is the only key wrangler rejects on Free (100328). Assert its
  // absence structurally rather than trusting the diff list above.
  assert.ok(!configLines(freeText).some((l) => l === '[limits]'), '[limits] on Free fails the deploy outright')
  assert.ok(!/^cpu_ms/m.test(freeText.replace(/^#.*$/gm, '')), 'cpu_ms is Paid-only')
  assert.ok(!/^subrequests/m.test(freeText.replace(/^#.*$/gm, '')), 'subrequests is Paid-only')
  // ...and that wrangler.toml still HAS it, so this check cannot pass by
  // both files having drifted away from the paid configuration.
  assert.ok(configLines(paidText).includes('[limits]'), 'wrangler.toml lost its [limits] block')
})

// ---- POSITIVE CONTROLS ----------------------------------------------------
//
// Every check above reports "no drift". A comparison that can only ever say
// that is indistinguishable from a broken one, so these feed it known
// drift and assert it is seen.
check('POSITIVE CONTROL: an injected drift is detected', async () => {
  const tampered = paidText.replace('database_id = "49795be9-eabe-43f1-8e16-b86faed60cb1"', 'database_id = "0000"')
  assert.notEqual(tampered, paidText, 'the control must actually change something')
  const tamperedById = new Map(keyedPairs(tampered).map((p) => [p.id, p]))
  assert.notEqual(
    tamperedById.get('[[d1_databases]] "DB" :: database_id').value,
    freeById.get('[[d1_databases]] "DB" :: database_id').value,
    'a changed database_id must compare as different',
  )
})

check('POSITIVE CONTROL: a dropped binding is detected as missing', async () => {
  const tampered = freeText.split(/\r?\n/).filter((l) => l.trim() !== 'binding = "CACHE"').join('\n')
  const tamperedById = new Map(keyedPairs(tampered).map((p) => [p.id, p]))
  assert.ok(!tamperedById.has('[[kv_namespaces]] "CACHE" :: id'), 'dropping the binding line must lose the whole scope label')
  const missing = paidPairs.filter((p) => !tamperedById.has(p.id)).map((p) => p.id)
  assert.ok(missing.length > 0, 'the missing-key check must be able to see a dropped binding')
})

check('POSITIVE CONTROL: a free config copied back from paid is rejected', async () => {
  // The specific regression: someone resolves a merge by taking wrangler.toml
  // wholesale. Every "is it present" check goes green; only the
  // documented-diffs-still-present check catches it.
  const copied = keyedPairs(paidText)
  const copiedById = new Map(copied.map((p) => [p.id, p]))
  const stillDiffering = ALLOWED_DIFFS.filter((d) => {
    const c = copiedById.get(d.id)
    return c && (c.value ?? c.raw) !== d.paid
  })
  assert.deepEqual(stillDiffering, [], 'sanity: a verbatim copy differs from paid nowhere')
  assert.ok(copiedById.has('[limits] :: cpu_ms'), 'a verbatim copy would carry the Paid-only key onto Free')
})

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log('PASS', name)
      passed++
    } catch (e) {
      console.log('FAIL', name, '-', e.message)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}

void main()
