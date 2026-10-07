// CUTOVER-LR: the disabled-branch redirect contract in lib/branchEffect.ts.
//
// Owner ruling (6 Oct 2026): a change addressed to a disabled branch is never redirected silently. The Worker refuses
// it with branch_redirect_required (409) carrying the successor and every active branch it may go to, until the
// request names the branch the operator confirmed in the X-Branch-Redirect header; then the effect lands there.
// While every branch is active the header is never read and nothing changes.
//
// The branch rows come from a real SQLite `branches` table with every migration applied, so the integer flags,
// NULLs and triggers are the ones D1 hands the Worker; the in-batch guard predicate is evaluated by SQLite itself.
//
// Run (from cloudflare/): node scripts/test-branch-redirect-kernel-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

function load(rel, shims) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8')
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path.basename(rel) }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', out)(mod.exports, (id) => {
    if (Object.prototype.hasOwnProperty.call(shims, id)) return shims[id]
    throw new Error(`unexpected import ${id}`)
  }, mod)
  return mod.exports
}
const roles = load('lib/branchRoles.ts', {})
const kernel = load('lib/branchEffect.ts', { './branchRoles': roles, './sqlBinding': { selectInChunks: async () => [] } })

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
for (const migration of loadAll()) db.exec(migration)
const withoutTriggers = (fn) => {
  const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='branches'").all()
  for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`)
  try { fn() } finally { for (const trigger of triggers) db.exec(trigger.sql) }
}
// before: both active, NULL roles (production today). after: the consolidation end state (ids as in production:
// 1 = LC Store, was Warehouse; 2 = Old Shop, was Shop), plus a third active storage branch for the alternatives.
function world(state) {
  withoutTriggers(() => {
    db.exec('DELETE FROM branches')
    if (state === 'before') db.exec("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Warehouse',1,0),(2,'Shop',1,1)")
    else {
      db.exec(`INSERT INTO branches(id,name,role,canonical_key,is_active,is_default) VALUES(1,'LC Store','shop','warehouse',1,1);
        INSERT INTO branches(id,name,role,is_active,is_default) VALUES(3,'Back room','warehouse',1,0);
        INSERT INTO branches(id,name,role,canonical_key,is_active,is_default,successor_branch_id) VALUES(2,'Old Shop','shop','shop',0,0,1);`)
    }
  })
  return db.prepare('SELECT id, name, role, is_active, successor_branch_id FROM branches ORDER BY id').all()
}
const thrown = (fn) => { try { fn(); return null } catch (error) { return error } }

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`) }

check('an active branch answers itself and never reads the redirect, so nothing changes before the cutover', () => {
  const rows = world('before')
  for (const target of [null, 1, 2, 99]) {
    for (const sells of [false, true]) {
      assert.deepEqual(kernel.resolveBranchEffect(rows, 2, { sells, target }), { addressedBranchId: 2, addressedName: 'Shop', effectBranchId: 2, effectName: 'Shop', redirected: false })
    }
  }
  const resolver = new kernel.BranchEffectResolver(rows, 1)
  assert.equal(resolver.effectId(2), 2)
  assert.deepEqual(resolver.guards(), [], 'no redirect, no guard statement')
  assert.equal(kernel.effectGuardStatement(resolver.guards()), null, 'and no statement is added to the batch')
})

check('a retired branch without a confirmed target is refused with the successor first and every valid target', () => {
  const rows = world('after')
  const error = thrown(() => kernel.resolveBranchEffect(rows, 2))
  assert.ok(error instanceof kernel.BranchRedirectRequiredError)
  assert.equal(error.code, 'branch_redirect_required')
  assert.equal(error.statusCode, 409)
  assert.deepEqual(error.body, {
    error: kernel.BRANCH_REDIRECT_REQUIRED_ERROR, code: 'branch_redirect_required',
    redirect: { addressed_branch_id: 2, addressed_branch_name: 'Old Shop', successor_branch_id: 1, successor_branch_name: 'LC Store',
      targets: [{ id: 1, name: 'LC Store' }, { id: 3, name: 'Back room' }], requested_target_id: null },
  }, 'a plain stock effect may go to any active branch; the successor leads')
  const selling = thrown(() => kernel.resolveBranchEffect(rows, 2, { sells: true }))
  assert.deepEqual(selling.redirect.targets, [{ id: 1, name: 'LC Store' }], 'a sale line only to an active selling branch')
  assert.ok(error instanceof kernel.BranchRetiredNoSuccessorError, 'callers that catch the retired-branch family catch it too')
  assert.equal(kernel.branchHasNoActiveTarget(error), false, 'and it is not the "no active branch at all" case')
})

check('a confirmed target lands the effect there, the successor or any other valid active branch', () => {
  const rows = world('after')
  assert.deepEqual(kernel.resolveBranchEffect(rows, 2, { target: 1 }), { addressedBranchId: 2, addressedName: 'Old Shop', effectBranchId: 1, effectName: 'LC Store', redirected: true })
  assert.deepEqual(kernel.resolveBranchEffect(rows, 2, { target: 3 }), { addressedBranchId: 2, addressedName: 'Old Shop', effectBranchId: 3, effectName: 'Back room', redirected: true }, 'the operator may switch the redirect branch')
  const resolver = new kernel.BranchEffectResolver(rows, 1)
  assert.equal(resolver.effectId(2, { sells: true }), 1)
  assert.equal(resolver.effectId(1), 1, 'an active branch in the same request is unaffected')
  assert.deepEqual(resolver.guards(), [{ addressed: 2, effect: 1, sells: 1 }])
})

check('an invalid target is refused: the disabled branch itself, an unknown id, a non-selling branch for a sale line', () => {
  const rows = world('after')
  for (const [target, sells] of [[2, false], [99, false], [3, true]]) {
    const error = thrown(() => kernel.resolveBranchEffect(rows, 2, { target, sells }))
    assert.ok(error instanceof kernel.BranchRedirectTargetInvalidError, `target ${target}`)
    assert.equal(error.code, 'branch_redirect_target_invalid')
    assert.equal(error.body.redirect.requested_target_id, target)
  }
})

check('no active branch can take it at all: refused as branch_retired_no_successor, even with a target', () => {
  const rows = world('after')
  withoutTriggers(() => db.exec("UPDATE branches SET role='warehouse' WHERE id=1; DELETE FROM branches WHERE id=3"))
  const shopless = db.prepare('SELECT id, name, role, is_active, successor_branch_id FROM branches ORDER BY id').all()
  for (const target of [null, 1]) {
    const error = thrown(() => kernel.resolveBranchEffect(shopless, 2, { sells: true, target }))
    assert.equal(error.code, 'branch_retired_no_successor')
    assert.equal(kernel.branchHasNoActiveTarget(error), true)
    assert.deepEqual(error.body, { error: kernel.BRANCH_RETIRED_NO_SUCCESSOR_ERROR, code: 'branch_retired_no_successor' })
  }
  assert.equal(kernel.resolveBranchEffect(shopless, 2, { target: 1 }).effectBranchId, 1, 'a plain stock effect may still land at the storage branch')
  assert.ok(rows.length)
})

check('the in-batch guard holds only while the confirmed branch is active and the addressed branch is still retired', () => {
  world('after')
  const holds = (effects) => db.prepare(`SELECT ${kernel.branchEffectGuardPredicate('@effects')} AS ok`).get({ effects: JSON.stringify(effects) }).ok
  assert.equal(holds([{ addressed: 2, effect: 1, sells: 1 }]), 1)
  assert.equal(holds([{ addressed: 2, effect: 3, sells: 0 }]), 1, 'an alternative the operator chose holds without a successor pointer')
  assert.equal(holds([{ addressed: 2, effect: 3, sells: 1 }]), 0, 'a sale line still needs a selling landing')
  withoutTriggers(() => db.exec('UPDATE branches SET is_active=0 WHERE id=1'))
  assert.equal(holds([{ addressed: 2, effect: 1, sells: 0 }]), 0, 'the confirmed branch was disabled before the commit')
  world('after')
  withoutTriggers(() => db.exec('UPDATE branches SET is_active=1, successor_branch_id=NULL WHERE id=2'))
  assert.equal(holds([{ addressed: 2, effect: 1, sells: 0 }]), 0, 'the addressed branch was reactivated: nothing may be redirected away from it')
  const statement = kernel.effectGuardStatement([{ addressed: 2, effect: 1, sells: 1 }])
  assert.match(statement.sql, /^INSERT INTO sale_bulk_guards\(guard_value\) SELECT CASE WHEN/)
})

check('the X-Branch-Redirect header is read as one positive integer and nothing else', () => {
  const ask = (value) => kernel.branchRedirectTarget({ req: { header: (name) => (name === 'x-branch-redirect' ? value : undefined) } })
  assert.equal(kernel.BRANCH_REDIRECT_HEADER, 'x-branch-redirect')
  assert.equal(ask('1'), 1)
  assert.equal(ask(' 12 '), 12)
  for (const bad of [undefined, '', '0', '-1', '1.5', 'abc', '1,2', '9'.repeat(20)]) assert.equal(ask(bad), null, String(bad))
})

check('every branch-effect refusal maps to one 409 body; anything else is not a refusal', () => {
  const rows = world('after')
  assert.equal(kernel.branchEffectRefusal(thrown(() => kernel.resolveBranchEffect(rows, 2))).code, 'branch_redirect_required')
  assert.deepEqual(kernel.branchEffectRefusal(new kernel.BranchRetiredDamagedError()), { error: kernel.BRANCH_RETIRED_DAMAGED_ERROR, code: 'branch_retired_damaged_stock' })
  assert.equal(kernel.branchEffectRefusal(new Error('boom')), null)
})

console.log(`${passed} branch redirect kernel checks passed`)
