'use strict'
// A-C3 / A-C4 / B-C10 / B-C11 (audit 14 Nov), the shapes test-bump-before-response-pure.cjs does not see:
//   - a writer must await its cache bump BEFORE it announces the write (a peer refetching on the push would otherwise read and re-cache
//     pre-write data under the old version): in each listed handler the awaited bump precedes the broadcast;
//   - one bumpVersions([...]) call per commit, never one bumpVersion per namespace;
//   - the multi-namespace readers use the batched getVersionsWithFallback;
//   - portal sign-up (a new customers row, or a claim that adds the portal_account badge an existing customer's cached row shows) moves the customers version before it answers;
//   - a users rename that carries the new name onto history moves BOTH sales and returns (both store the user's name).
// Static source check on purpose: each handler is a large route over D1; the AST census in test-bump-before-response-pure.cjs covers
// every other bump site. `check(source)` runs on scratch copies in the mutation controls at the bottom.
//
// Run (from cloudflare/): node scripts/test-bump-then-broadcast-order-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = path.join(__dirname, '..', 'src')
const read = (rel) => fs.readFileSync(path.join(src, rel), 'utf8').replace(/\r\n/g, '\n')
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

// file -> how many handlers announce (broadcast) after an awaited bump, and a human name for the failure
const ORDERED = {
  'routes/contacts.ts': ['create / relink / link-missing / award points'],
  'routes/promotions.ts': ['create / update / reorder / delete'],
  'routes/settings.ts': ['settings update, audit retention, payment method replace'],
  'routes/system.ts': ['section reset, legacy subtotal repair'],
  'routes/portal.ts': ['submission review'],
  'routes/pos.ts': ['address presets'],
  'routes/returns.ts': ['return reason presets'],
  'lib/telegramTopicSetting.ts': ['/settopic'],
}

// A bump that is not awaited: wrapped in waitUntil, or inside a Promise.all next to a broadcast.
function deferredBumps(text) {
  const out = []
  text.split('\n').forEach((line, index) => {
    if (/waitUntil\(\s*bumpVersions?\(/.test(line)) out.push(`${index + 1}: ${line.trim()}`)
  })
  // A bump listed beside a broadcast in one Promise.all / allSettled group runs concurrently with it, deferred or not.
  const grouped = /Promise\.(?:all|allSettled)\(\[([^\]]*)\]\)/g
  for (const match of text.matchAll(grouped)) {
    if (/\bbumpVersions?\(/.test(match[1]) && /\bbroadcast\(/.test(match[1])) out.push(`group: ${match[0].slice(0, 90)}`)
  }
  return out
}
// A broadcast line directly followed (same handler, before the next blank line or return) by a bump of the same write.
function broadcastBeforeBump(text) {
  const out = []
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    if (!/broadcast\(/.test(line)) return
    for (let next = index + 1; next < Math.min(lines.length, index + 4); next += 1) {
      if (/\breturn\b/.test(lines[next])) break
      if (/\bbumpVersions?\(/.test(lines[next])) { out.push(`${index + 1}: ${line.trim()} ... ${next + 1}: ${lines[next].trim()}`); break }
    }
  })
  return out
}
// Two awaited single-namespace bumps back to back (or Promise.all of them) where one bumpVersions([...]) would do.
function splitBumps(text) {
  const out = []
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    if (/Promise\.all\(\[\s*bumpVersion\(.*bumpVersion\(/.test(line)) out.push(`${index + 1}: ${line.trim()}`)
    if (/await bumpVersion\(/.test(line) && /await bumpVersion\(/.test(lines[index + 1] || '')) out.push(`${index + 1}: two awaited bumpVersion calls`)
  })
  return out
}

function checkWriters(read) {
  for (const [file, [what]] of Object.entries(ORDERED)) {
    const text = read(file)
    assert.deepEqual(deferredBumps(text), [], `${file} (${what}): await the bump, then waitUntil(broadcast(...))`)
    assert.deepEqual(broadcastBeforeBump(text), [], `${file} (${what}): the bump comes before the broadcast`)
  }
  for (const file of ['routes/contacts.ts', 'routes/users.ts', 'routes/settings.ts']) {
    assert.deepEqual(splitBumps(read(file)), [], `${file}: one bumpVersions([...]) call per commit`)
  }
  // Round 2 (review M12): the two rename-carry sites (admin edit, own profile) must each name sales AND returns; a rename that drops `returns` leaves the cached Returns list showing the old name.
  const carry = read('routes/users.ts').match(/await bumpVersions\(c\.env, \[([^\]]*)\]\)/g) || []
  assert.equal(carry.length, 2, 'routes/users.ts: both rename-carry sites bump through one bumpVersions call')
  for (const call of carry) assert.ok(/'sales'/.test(call) && /'returns'/.test(call), `routes/users.ts: a rename carries the name onto sales AND returns, got ${call}`)
}
function checkPortal(read) {
  const text = read('lib/portalAccounts.ts')
  const claim = text.slice(text.indexOf('async function claimAccount('), text.indexOf('export async function signinPortalAccount'))
  const bump = claim.indexOf("await bumpVersions(env, ['customers'])")
  assert.ok(bump > 0, 'claimAccount bumps customers')
  assert.ok(!/if \(args\.createContact\) await bumpVersions/.test(claim), 'a claim of an existing customer bumps too: the cached list shows its new portal_account')
  assert.ok(bump > claim.indexOf('accountId === null') && bump < claim.indexOf("return { ok: true, accountId"), 'after the commit, before the answer')
}
function checkReaders(read) {
  for (const file of ['routes/contacts.ts', 'routes/batches.ts']) {
    assert.ok(/await getVersionsWithFallback\(/.test(read(file)), `${file} reads its namespaces in one batched call`)
  }
  assert.ok(!/namespaces\.map\(\(namespace\) => getVersionWithFallback\(/.test(read('routes/batches.ts')), 'batches.ts tracked-product-ids: no per-namespace reads')
  const contacts = read('routes/contacts.ts')
  const fn = contacts.slice(contacts.indexOf('async function getContactReadCacheVersion'), contacts.indexOf('async function getContactReadCacheVersion') + 600)
  assert.ok(!/namespaces\.map\(\(namespace\) => getVersionWithFallback/.test(fn), 'getContactReadCacheVersion: no per-namespace reads')
  // Round 2: the dashboard stock overview key reads products (+ stock) in one batched call too.
  const overview = read('lib/dashboardStockOverview.ts')
  assert.ok(/await getVersionsWithFallback\(env, /.test(overview), 'dashboardStockOverview.ts reads its namespaces in one batched call')
  assert.ok(!/getVersionWithFallback\(/.test(overview), 'dashboardStockOverview.ts: no per-namespace reads')
}
function checkAuditLog(read) {
  assert.ok(!/'audit_log'/.test(read('lib/cache.ts')), 'MAINTENANCE_CACHE_NAMESPACES no longer bumps audit_log (nothing reads that version)')
  assert.ok(!/cacheNamespaces = \[[^\]]*'audit_log'/.test(read('routes/system.ts')), 'the not-paid stock recovery no longer bumps audit_log')
}

check('every listed writer awaits its bump before announcing, and uses one bumpVersions call per commit', () => checkWriters(read))
check('portal sign-up (new customer or claim) bumps customers before answering (A-C4)', () => checkPortal(read))
check('multi-namespace version readers are batched (B-C11)', () => checkReaders(read))
check('the unread audit_log namespace is no longer bumped', () => checkAuditLog(read))

// Mutation controls: each wrong version of a source file must turn its check red.
const mutate = (file, from, to) => (rel) => {
  const text = read(rel)
  if (rel !== file) return text
  assert.equal(text.split(from).length - 1, 1, `mutant anchor must occur once: ${from.slice(0, 60)}`)
  return text.replace(from, () => to)
}
const mutants = [
  ['contacts relink bumps after the broadcast', checkWriters, mutate('routes/contacts.ts', "  await bumpVersion(c.env, 'customers')\n  c.executionCtx.waitUntil(broadcast(c.env, 'customers', { action: 'relink', id: targetId }))", "  c.executionCtx.waitUntil(broadcast(c.env, 'customers', { action: 'relink', id: targetId }))\n  await bumpVersion(c.env, 'customers')")],
  ['pos presets bump in waitUntil', checkWriters, mutate('routes/pos.ts', "  await bumpVersion(c.env, 'settings')", "  c.executionCtx.waitUntil(bumpVersion(c.env, 'settings'))")],
  ['telegram topic bumps beside the broadcast', checkWriters, mutate('lib/telegramTopicSetting.ts', "  await bumpVersion(env, 'settings')\n  const refresh = Promise.allSettled([broadcast(env, 'settings', { action: 'update', keys })])", "  const refresh = Promise.allSettled([bumpVersion(env, 'settings'), broadcast(env, 'settings', { action: 'update', keys })])")],
  ['system repair bumps in a deferred group', checkWriters, mutate('routes/system.ts', "      await bumpVersion(c.env, 'sales')\n      c.executionCtx.waitUntil(broadcast(c.env, 'sales', { action: 'update', repair: LEGACY_SUBTOTAL_REPAIR_STEP }))", "      c.executionCtx.waitUntil(Promise.all([\n        bumpVersion(c.env, 'sales'),\n        broadcast(c.env, 'sales', { action: 'update', repair: LEGACY_SUBTOTAL_REPAIR_STEP }),\n      ]))")],
  ['users rename bumps per namespace', checkWriters, mutate('routes/users.ts', "await bumpVersions(c.env, ['sales', 'returns'])\n    }\n    c.executionCtx.waitUntil(broadcast(c.env, 'users', { action: 'update', id }))", "await Promise.all([bumpVersion(c.env, 'sales'), bumpVersion(c.env, 'returns')])\n    }\n    c.executionCtx.waitUntil(broadcast(c.env, 'users', { action: 'update', id }))")],
  ['portal sign-up never bumps', checkPortal, mutate('lib/portalAccounts.ts', "  await bumpVersions(env, ['customers'])\n", '')],
  ['portal sign-up bumps only on create (the round-1 shape)', checkPortal, mutate('lib/portalAccounts.ts', "  await bumpVersions(env, ['customers'])\n", "  if (args.createContact) await bumpVersions(env, ['customers'])\n")],
  ['users rename drops returns from its bump', checkWriters, mutate('routes/users.ts', "    if (usernameChanged && renameScope === 'carry') {\n      await bumpVersions(c.env, ['sales', 'returns'])\n    }\n    c.executionCtx.waitUntil(broadcast(c.env, 'users', { action: 'update', id }))", "    if (usernameChanged && renameScope === 'carry') {\n      await bumpVersions(c.env, ['sales'])\n    }\n    c.executionCtx.waitUntil(broadcast(c.env, 'users', { action: 'update', id }))")],
  ['batches reads per namespace again', checkReaders, mutate('routes/batches.ts', 'await getVersionsWithFallback(c.env, namespaces)', 'await Promise.all(namespaces.map((namespace) => getVersionWithFallback(c.env, namespace)))')],
  ['dashboard stock overview reads per namespace again', checkReaders, mutate('lib/dashboardStockOverview.ts', "await getVersionsWithFallback(env, fiveMinutes ? ['products'] : ['products', 'stock'])", "await Promise.all((fiveMinutes ? ['products'] : ['products', 'stock']).map((namespace) => getVersionWithFallback(env, namespace)))")],
  ['maintenance list bumps audit_log again', checkAuditLog, mutate('lib/cache.ts', "'inventory',\n]", "'inventory', 'audit_log',\n]")],
]
for (const [name, run, reader] of mutants) {
  let red = false
  try { run(reader) } catch (error) {
    if (/mutant anchor/.test(String(error && error.message))) throw error
    red = true
  }
  assert.ok(red, `mutant survived: ${name}`)
  console.log(`MUTANT killed: ${name}`)
}
console.log(`${passed} checks passed; ${mutants.length} mutants killed`)
