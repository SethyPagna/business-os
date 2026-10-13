// Finding H on main (6.0.36-6.0.40): a review approval replays a write with the reviewer's authority, so every
// applier effect must be checked against the CURRENT reviewer's grant for that exact action and effect, and every
// product discount write must store the same canonical value the price gate compared (OPUS-H-1/H-2/H-3).
//
// Real routes (reviewQueue, fees, products), real appliers, real promotion kernel and SQL predicate, every
// migration, node:sqlite. Stubs: the session lookup (re-reads users/roles per request like production auth),
// cache bumps and the broadcast hub (counted). Each group runs on its own and the file fails if any group fails.
//
// REVIEW_AUTHORITY_MUTANT=allow-all replaces the helper with "always allowed"; the file must then fail.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const src = path.resolve(__dirname, '../src')
const MUTANT = process.env.REVIEW_AUTHORITY_MUTANT || ''
const cache = new Map()
let broadcasts = 0
let queryCalls = 0
let queryStatements = 0
let inBatch = false
const services = {
  'lib/auth.ts': { requireAuth: async (c, next) => {
    const user = await load('lib/db.ts').getDb(c.env).prepare(`SELECT u.*, r.code AS role_code, r.permissions AS role_permissions
      FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@id AND u.is_active=1 AND u.deleted_at IS NULL`).get({ id: c.env.ACTOR })
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    c.set('user', user); return next()
  } },
  'lib/cache.ts': { bumpVersion: async () => {}, bumpVersions: async () => {} },
  'durable-objects/broadcastHub.ts': { broadcast: async () => { broadcasts++ } },
}
// A registered applier with no entry in the action table must never run (P3, fail closed). Test-only: this
// registers one such applier inside the real registry; it writes a marker row if it is ever invoked.
const UNMAPPED_APPLIER = `
registerApplier('fees', 'archive', 'fee', async (env) => {
  await getDb(env).prepare("INSERT INTO settings(key, value) VALUES('unmapped_applier_ran', '1')").run()
})
`
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }; cache.set(rel, mod)
  if (services[rel]) { mod.exports = services[rel]; return mod.exports }
  let source = fs.readFileSync(path.join(src, rel), 'utf8')
  if (rel === 'lib/reviewApply.ts') source += UNMAPPED_APPLIER
  if (MUTANT === 'allow-all' && rel === 'lib/reviewApprovalPermission.ts') {
    source = source.replace(/export async function reviewApprovalPermissionError\(/, 'async function originalReviewApprovalPermissionError(')
    source += '\nexport async function reviewApprovalPermissionError() { return null }\n'
  }
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  new Function('require', 'module', 'exports', output)(request => {
    if (!request.startsWith('.')) return require(request)
    const next = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(next.endsWith('.ts') ? next : `${next}.ts`)
  }, mod, mod.exports)
  return mod.exports
}

const FULL = { review: true, products: true, fees: true, branches: true, inventory: true, product_cost_edit: true }
const NOPRICE = { ...FULL, 'products:price': false }
function world() {
  const raw = openDb(loadAll(path.resolve(__dirname, '../migrations'))).db
  raw.limits.variableNumber = 100
  raw.exec(`DELETE FROM fees;
    INSERT INTO users(id,username,name,password,permissions) VALUES
    (1,'requester','Requester','fixture','{"fees":"review","products":"review","inventory":"review","branches":"review"}'),
    (2,'reviewer','Reviewer','fixture','{"review":true,"fees":true,"fees:delete":false}'),
    (3,'editor','Editor','fixture','{"products":true,"products:price":false}'),
    (4,'priceeditor','Price editor','fixture','{"products":true}');
    INSERT INTO fees(id,fee_type,label,amount_usd,amount_khr,fee_date) VALUES(1,'other','Permission fixture',10,0,'2026-10-12');
    INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0);`)
  function prepared(sql, values = []) {
    assert.ok(values.length <= 100)
    function execute(read) {
      queryStatements++; if (!inBatch) queryCalls++
      const statement = raw.prepare(sql)
      const args = /\?\d/.test(sql) ? [Object.fromEntries(values.map((value, i) => [String(i + 1), value]))] : values
      if (read || statement.columns().length) return { success: true, results: statement.all(...args), meta: { changes: 0 } }
      const result = statement.run(...args)
      return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    return { bind: (...next) => prepared(sql, next), all: async () => execute(true),
      first: async () => execute(true).results[0] ?? null, run: async () => execute(false) }
  }
  const env = { DB: { prepare: prepared, batch: async statements => {
    queryCalls++; inBatch = true
    raw.exec('BEGIN IMMEDIATE')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      raw.exec('COMMIT'); return results
    } catch (error) { raw.exec('ROLLBACK'); throw error } finally { inBatch = false }
  } }, ACTOR: 2 }
  return { raw, env }
}
function snapshot(w) {
  return JSON.stringify(w.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, w.raw.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row, (k, v) => typeof v === 'bigint' ? String(v) : v)).sort()]))
}
async function request(w, route, method, url, body, actor = 2) {
  const pending = []; w.env.ACTOR = actor
  const response = await load(`routes/${route}.ts`).default.request(url, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }, w.env, { waitUntil: p => pending.push(p), passThroughOnException() {} })
  await Promise.all(pending); w.env.ACTOR = 2
  let parsed = null; try { parsed = await response.json() } catch { parsed = null }
  return { status: response.status, body: parsed }
}
function queueRaw(w, section, action, entity, payloadJson, id = 1, requester = 1) {
  return Number(w.raw.prepare(`INSERT INTO pending_actions(section,action_type,entity_type,entity_id,payload_json,requested_by,requested_by_name)
    VALUES(?,?,?,?,?,?,'Requester')`).run(section, action, entity, id, payloadJson, requester).lastInsertRowid)
}
const queue = (w, section, action, entity, payload = {}, id = 1, requester = 1) => queueRaw(w, section, action, entity, JSON.stringify(payload), id, requester)
const grants = (w, permissions, id = 2) => w.raw.prepare('UPDATE users SET permissions=? WHERE id=?').run(JSON.stringify(permissions), id)
const status = (w, id) => w.raw.prepare('SELECT status FROM pending_actions WHERE id=?').get(id).status
const approve = (w, id) => request(w, 'reviewQueue', 'POST', `/${id}/approve`)
async function refusedClean(w, pending, expected) {
  const before = snapshot(w), sent = broadcasts
  const result = await approve(w, pending)
  assert.equal(result.status, expected.status, JSON.stringify(result))
  if (expected.code) assert.equal(result.body?.code, expected.code, JSON.stringify(result))
  if (expected.permission) assert.equal(result.body?.permission, expected.permission, JSON.stringify(result))
  assert.equal(snapshot(w), before, 'a refusal leaves every business, queue, audit and history table unchanged')
  assert.equal(broadcasts, sent, 'a refusal broadcasts nothing')
  assert.equal(status(w, pending), 'open')
  return result
}
const denied = (w, pending, permission) => refusedClean(w, pending, { status: 403, code: 'review_action_full_required', permission })
async function makeProduct(w, name, extra = {}) {
  grants(w, FULL)
  const id = queue(w, 'products', 'create', 'product', { name, selling_price_usd: 5, ...extra }, null)
  const res = await approve(w, id)
  assert.equal(res.status, 200, JSON.stringify(res))
  return w.raw.prepare('SELECT id FROM products WHERE name=?').get(name).id
}

// ---------------------------------------------------------------------------------------------- group runner
const results = []
async function group(name, fn) {
  const w = world()
  try { await fn(w); results.push([name, true]); console.log(`PASS ${name}`) }
  catch (error) { results.push([name, false]); console.log(`FAIL ${name}: ${String(error && error.message || error).split('\n').slice(0, 6).join(' | ')}`) }
  finally { w.raw.close() }
}
// Collects every sub-case of a table group; the group fails if any sub-case does, and prints each failure.
function cases() {
  const failed = []
  let total = 0
  return {
    check(label, ok, detail) { total++; if (!ok) failed.push(`${label} ${JSON.stringify(detail, (k, v) => typeof v === 'bigint' ? String(v) : (Object.is(v, -0) ? '-0' : v))}`) },
    done(expected) {
      for (const line of failed.slice(0, 40)) console.log(`  case FAIL ${line}`)
      assert.equal(total, expected, 'every planned case ran')
      assert.equal(failed.length, 0, `${failed.length} of ${total} cases failed`)
      console.log(`  cases=${total} failed=0`)
    },
  }
}

// ---------------------------------------------------------------------------------------- till + SQL oracles
const NOW = new Date('2026-10-12T05:00:00Z')
function till(w, pid) {
  const row = w.raw.prepare('SELECT * FROM products WHERE id=?').get(pid)
  const ev = load('lib/promotionRules.ts').evaluatePromotionPricing(row, 1, [], 4100, NOW)
  return { active: ev.active, unit_price_usd: ev.unit_price_usd }
}
function sqlActive(w, pid) {
  const params = {}
  const expr = load('lib/promotionRulesSql.ts').productDiscountActiveSql(params, NOW)
  return w.raw.prepare(`SELECT ${expr.replace(/@promoNow/g, '?')} AS a FROM products p WHERE p.id=?`).get(params.promoNow, params.promoNow, pid).a
}
const DISCOUNT_SET = `UPDATE products SET selling_price_usd=5, discount_enabled=?, discount_type=?, discount_percent=?, discount_amount_usd=?,
  discount_amount_khr=?, discount_starts_at=?, discount_ends_at=? WHERE id=?`
function setDiscount(w, pid, d) {
  w.raw.prepare(DISCOUNT_SET).run(d.enabled ?? 0, d.type ?? 'percent', d.percent ?? 0, d.usd ?? 0, d.khr ?? 0, d.starts ?? null, d.ends ?? null, pid)
}
const DISCOUNT_PICK = `SELECT discount_enabled e, typeof(discount_enabled) et, discount_type ty, typeof(discount_type) tt, discount_percent pc,
  typeof(discount_percent) pt, discount_amount_usd au, discount_amount_khr ak, discount_starts_at s, discount_ends_at x FROM products WHERE id=?`
const effect = (w, pid) => ({ till: till(w, pid), sql: sqlActive(w, pid), row: w.raw.prepare(DISCOUNT_PICK).get(pid) })

// Odd spellings from OPUS-H-1 (13) plus padding/Unicode/structural neighbours. Every one is refused with a coded
// 400 on every write path, for every role, before any gate or write.
const ODD_ENABLED = [2, '2', ' 1', '1.0', '01', '+1', '1e0', 'false ', 'no', 'yes', '0x1', -1, 0.5,
  '1 ', ' 1', '1 ', 'on', 'off', 'enabled', '0.0', ' 0', [], {}, [1]]
const ODD_TYPE = ['fixed ', 'pct', ' fixed', 'fixed ', 'percent ', ' percent', 'amount', 0, 1, true, [], {}]

async function main() {
  // ===================================================================================== finding H (6.0.36)
  await group('H: review+fees, fees:delete=false cannot approve a fee delete; nothing is written', async w => {
    const pending = queue(w, 'fees', 'delete', 'fee', { id: 1 })
    assert.equal((await request(w, 'fees', 'DELETE', '/1')).status, 403, 'the direct route refuses this reviewer')
    await denied(w, pending, 'fees:delete')
    assert.equal(w.raw.prepare('SELECT COUNT(*) n FROM fees WHERE id=1').get().n, 1)
  })
  await group('H control: a reviewer WITH fees:delete approves the fee delete', async w => {
    const pending = queue(w, 'fees', 'delete', 'fee', { id: 1 })
    grants(w, { review: true, fees: true })
    const result = await approve(w, pending)
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.equal(w.raw.prepare('SELECT COUNT(*) n FROM fees').get().n, 0)
    assert.equal(status(w, pending), 'approved')
    assert.equal(w.raw.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('delete','approve')").get().n, 2)
  })
  await group('H: every registered applier needs its own action grant (section Full does not override it)', async w => {
    for (const [section, action, entity, capability] of [
      ['fees', 'delete', 'fee', 'delete'], ['products', 'create', 'product', 'add'],
      ['products', 'update', 'product', 'edit'], ['products', 'delete', 'product', 'delete'],
      ['inventory', 'update', 'inventory_reason', 'edit_reasons'], ['branches', 'create', 'branch', 'add'],
      ['branches', 'update', 'branch', 'edit'], ['branches', 'delete', 'branch', 'delete'],
    ]) {
      const key = `${section}:${capability}`
      grants(w, { ...FULL, [key]: false })
      await denied(w, queue(w, section, action, entity), key)
    }
  })
  await group('H: a role-level action denial is enforced live', async w => {
    w.raw.prepare("INSERT INTO roles(id,name,code,permissions,is_system) VALUES(99,'Fixture reviewer','fixture-reviewer',?,0)")
      .run(JSON.stringify({ ...FULL, 'fees:delete': false }))
    w.raw.exec('UPDATE users SET role_id=99 WHERE id=2')
    grants(w, {})
    await denied(w, queue(w, 'fees', 'delete', 'fee', { id: 1 }), 'fees:delete')
  })
  await group('H: revoked branch edit cannot bypass admission through an approved receipt', async w => {
    grants(w, { ...FULL, 'branches:edit': false })
    const id = queue(w, 'branches', 'update', 'branch', { notes: 'Receipt' })
    w.raw.prepare("UPDATE pending_actions SET status='approved',reviewed_by=2,reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(id)
    const before = snapshot(w)
    const result = await approve(w, id)
    assert.equal(result.status, 403, JSON.stringify(result))
    assert.equal(result.body?.permission, 'branches:edit')
    assert.equal(snapshot(w), before)
  })
  await group('H: unknown applier, self approval and view-only review keep their refusals', async w => {
    grants(w, FULL)
    const missing = queue(w, 'fees', 'update', 'fee')
    const unsupported = await refusedClean(w, missing, { status: 501, code: 'no_review_applier' })
    assert.ok(unsupported)
    w.raw.prepare('UPDATE users SET permissions=? WHERE id=1').run(JSON.stringify(FULL))
    assert.equal((await request(w, 'reviewQueue', 'POST', `/${missing}/approve`, undefined, 1)).status, 403)
    grants(w, { ...FULL, review: 'view' })
    assert.equal((await approve(w, missing)).status, 403)
  })

  // ============================================================================ P3: fail-closed action table
  await group('P3: action table keys equal the registered applier keys (parity from source)', async () => {
    const helper = fs.readFileSync(path.join(src, 'lib/reviewApprovalPermission.ts'), 'utf8')
    const apply = fs.readFileSync(path.join(src, 'lib/reviewApply.ts'), 'utf8')
    const mapped = [...helper.matchAll(/^ +'([a-z_]+:[a-z_]+:[a-z_]+)':/gm)].map(m => m[1]).sort()
    const registered = [...apply.matchAll(/registerApplier\('([a-z_]+)', '([a-z_]+)', '([a-z_]+)'/g)].map(m => m.slice(1).join(':')).sort()
    assert.ok(registered.length >= 8, `registered appliers parsed: ${registered.length}`)
    assert.deepEqual(mapped, registered)
  })
  await group('P3: a registered applier with no action-table entry fails closed, even for a reviewer with every grant', async w => {
    grants(w, { ...FULL, all: true })
    const id = queue(w, 'fees', 'archive', 'fee', { id: 1 })
    await refusedClean(w, id, { status: 501, code: 'no_review_applier' })
    assert.equal(w.raw.prepare("SELECT COUNT(*) n FROM settings WHERE key='unmapped_applier_ran'").get().n, 0)
  })

  // ========================================================================== product effects at approval
  await group('H effects: catalog cost keys require product_cost_edit on create and update (even unchanged zero)', async w => {
    const pid = await makeProduct(w, 'Cost effects')
    grants(w, { ...FULL, product_cost_edit: false })
    for (const field of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) {
      for (const action of ['create', 'update']) {
        await denied(w, queue(w, 'products', action, 'product', { name: 'Cost fixture', [field]: 0 }, action === 'create' ? null : pid), 'product_cost_edit')
      }
    }
  })
  await group('H effects: price and discount changes require products:price; controls with the grant succeed', async w => {
    const pid = await makeProduct(w, 'Price effects')
    grants(w, NOPRICE)
    for (const payload of [{ selling_price_usd: 6 }, { wholesale_price_khr: 1000 }, { discount_enabled: 1 }, { discount_percent: 5 }]) {
      await denied(w, queue(w, 'products', 'update', 'product', payload, pid), 'products:price')
    }
    await denied(w, queue(w, 'products', 'create', 'product', { name: 'Discounted new', discount_percent: 10 }, null), 'products:price')
    grants(w, FULL)
    const id = queue(w, 'products', 'update', 'product', { selling_price_usd: 6, discount_enabled: 1, discount_percent: 50 }, pid)
    const ok = await approve(w, id)
    assert.equal(ok.status, 200, JSON.stringify(ok))
    assert.deepEqual(till(w, pid), { active: true, unit_price_usd: 3 })
  })
  await group('H effects: image changes require products:image; unchanged full form and label-only edits stay approvable', async w => {
    const pid = await makeProduct(w, 'Image effects')
    grants(w, { ...FULL, 'products:image': false })
    for (const action of ['create', 'update']) {
      await denied(w, queue(w, 'products', action, 'product', { name: 'Image', image_gallery: ['https://example.invalid/image.png'] }, action === 'create' ? null : pid), 'products:image')
    }
    w.raw.prepare('UPDATE products SET image_path=? WHERE id=?').run('https://example.invalid/image.png', pid)
    await denied(w, queue(w, 'products', 'update', 'product', { image_path: null }, pid), 'products:image')
    grants(w, { ...FULL, product_cost_edit: false, 'products:price': false, 'products:image': false })
    const id = queue(w, 'products', 'update', 'product', { description: 'Unchanged permissions', selling_price_usd: 5,
      discount_percent: 0, discount_enabled: false, discount_type: 'percent', discount_label: 'Label only',
      image_path: 'https://example.invalid/image.png', image_gallery: ['https://example.invalid/image.png'] }, pid)
    const ok = await approve(w, id)
    assert.equal(ok.status, 200, JSON.stringify(ok))
    assert.equal(w.raw.prepare('SELECT description FROM products WHERE id=?').get(pid).description, 'Unchanged permissions')
  })
  await group('H effects: a saved money plan denies a missing price grant and succeeds with it', async w => {
    const pid = await makeProduct(w, 'Plan effects')
    const planned = { selling_price_usd: 7 }
    await load('lib/productWrites.ts').prepareProductMoneyWrite(w.env, planned, pid)
    grants(w, NOPRICE)
    await denied(w, queue(w, 'products', 'update', 'product', planned, pid), 'products:price')
    grants(w, FULL)
    const ok = await approve(w, queue(w, 'products', 'update', 'product', planned, pid))
    assert.equal(ok.status, 200, JSON.stringify(ok))
    assert.equal(w.raw.prepare('SELECT selling_price_usd p FROM products WHERE id=?').get(pid).p, 7)
  })

  // ================================================== OPUS-H 92 price-representation hunt cases (legacy rows)
  const S = s => JSON.stringify({ selling_price_usd: s })
  const sp = ' '.repeat(5000)
  const PRICE_CASES = [
    ['coercion number 5 vs 5', 5, S(5)], ['string 5', 5, S('5')], ['bool true vs 1', 1, S(true)], ['bool false vs 0', 0, S(false)],
    ['string true vs 1', 1, S('true')], ['1e2 vs 100', 100, S('1e2')], ['1E2 vs 100', 100, S('1E2')], ['100 vs 100', 100, S('100')],
    ['0.1e3 vs 100', 100, S('0.1e3')], ['1000e-1 vs 100', 100, S('1000e-1')], ['1e+2 vs 100', 100, S('1e+2')],
    ['0x10 vs 16', 16, S('0x10')], ['0X10 vs 16', 16, S('0X10')], ['0o20 vs 16', 16, S('0o20')], ['0b10000 vs 16', 16, S('0b10000')],
    ['1_6 vs 16', 16, S('1_6')], ['5.e0', 5, S('5.e0')], ['+.5e1', 5, S('+.5e1')], ['+.5 vs 0.5', 0.5, S('+.5')],
    ['05', 5, S('05')], ['0005.000', 5, S('0005.000')], ['5E+00', 5, S('5E+00')], ['5e-0', 5, S('5e-0')],
    ['VT lead', 5, S('\u000b5')], ['FF trail', 5, S('5\u000c')], ['5000 spaces lead', 5, S(sp + '5')], ['5000 spaces trail', 5, S('5' + sp)],
    ['NUL trail', 5, S('5\u0000')], ['NUL lead', 5, S('\u00005')],
    ['NBSP lead', 5, S(' 5')], ['NBSP trail', 5, S('5 ')], ['ideographic space lead', 5, S('　5')], ['ideographic space trail', 5, S('5　')],
    ['NEL lead', 5, S('\u00855')], ['MVS lead', 5, S('᠎5')], ['ZWSP lead', 5, S('​5')], ['LS trail', 5, S('5 ')],
    ['fullwidth 5', 5, S('５')], ['fullwidth 5.0', 5, S('５.０')], ['arabic-indic 5', 5, S('٥')], ['khmer digit 5', 5, S('៥')],
    ['-0 string vs 0', 0, S('-0')], ['+0 vs 0', 0, S('+0')], ['-0.0 vs 0', 0, S('-0.0')], ['0e5 vs 0', 0, S('0e5')],
    ['json -0 vs 0', 0, '{"selling_price_usd":-0}'], ['json 5.0', 5, '{"selling_price_usd":5.0}'], ['json 5e0', 5, '{"selling_price_usd":5e0}'],
    ['json 1e400 (Infinity)', 5, '{"selling_price_usd":1e400}'], ['json -1e400', 5, '{"selling_price_usd":-1e400}'],
    ['NaN', 5, S('NaN')], ['Infinity', 5, S('Infinity')], ['inf', 5, S('inf')], ['-Infinity', 5, S('-Infinity')],
    ['4dp equal 5.12340', 5.1234, S('5.12340')], ['24 tail digits equal', 5.1234, S('5.123400000000000000000000')],
    ['25 tail digits equal', 5.1234, S('5.1234000000000000000000000')], ['5dp change string', 5.1234, S('5.12341')], ['5dp change number', 5.1234, S(5.12341)],
    ['8dp historical string', 5.12345678, S('5.12345678')], ['9dp change', 5.12345678, S(5.123456781)],
    ['float noise string', 0.30000000000000004, S('0.30000000000000004')], ['float noise to 0.3', 0.30000000000000004, S('0.3')],
    ['sub-ulp string', 5, S('5.0000000000000001')], ['1e21 string', 1e21, S('1e21')], ['1e21 number', 1e21, S(1e21)],
    ['2^53+1 string', 9007199254740992, S('9007199254740993')], ['big 8dp', 12345678.12345678, S('12345678.12345678')],
    ['missing key', null, '{"description":"no price key"}'], ['empty string vs null', null, S('')], ['null vs 0', 0, S(null)],
    ['null vs null', null, S(null)], ['0 vs null', null, S(0)], ['array', 5, S([5])], ['object', 5, S({ v: 5 })],
    ['stored text 5', '5', S('5')], ['stored text 0x5', '0x5', S(5)],
  ]
  for (const field of ['selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr']) {
    for (const [label, stored, value] of [['khmer digit', 5, '៥'], ['0x', 16, '0x10'], ['NBSP', 5, '5 '], ['5dp', 5, '5.00001'], ['equal', 5, '5.0']]) {
      PRICE_CASES.push([`${field} ${label}`, stored, JSON.stringify({ [field]: value }), field])
    }
  }
  await group(`OPUS-H hunt: ${PRICE_CASES.length} legacy price representations never change storage without products:price`, async w => {
    assert.equal(PRICE_CASES.length, 92)
    const pid = await makeProduct(w, 'Price hunt')
    grants(w, NOPRICE)
    const t = cases()
    for (const [label, stored, payloadJson, field = 'selling_price_usd'] of PRICE_CASES) {
      w.raw.prepare(`UPDATE products SET ${field}=? WHERE id=?`).run(stored, pid)
      const pick = () => w.raw.prepare(`SELECT ${field} v, typeof(${field}) t FROM products WHERE id=?`).get(pid)
      const before = pick()
      const id = queueRaw(w, 'products', 'update', 'product', payloadJson, pid)
      const snap = snapshot(w), sent = broadcasts
      const result = await approve(w, id)
      const after = pick()
      const changed = !(Object.is(after.v, before.v) && after.t === before.t)
      const clean = result.status === 403 && snapshot(w) === snap && broadcasts === sent && status(w, id) === 'open'
      t.check(label, !(result.status === 200 && changed) && (result.status === 200 || clean), { stored: before, payloadJson: payloadJson.slice(0, 60), status: result.status, after })
    }
    t.done(PRICE_CASES.length)
  })
  await group('OPUS-H hunt: SQLite REAL affinity of String(x) equals x over 50000 money-range doubles', async w => {
    w.raw.exec('CREATE TEMP TABLE atof(i INTEGER, v REAL)')
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const xs = []
    for (let i = 0; i < 50000; i++) { const scale = [1, 100, 10000, 1e6, 1e8][i % 5]; xs.push(i % 3 === 0 ? Math.round(rnd() * scale * 10000) / 10000 : rnd() * scale) }
    const ins = w.raw.prepare('INSERT INTO temp.atof(i, v) VALUES(?, ?)')
    w.raw.exec('BEGIN'); xs.forEach((x, i) => ins.run(i, String(x))); w.raw.exec('COMMIT')
    const bad = w.raw.prepare('SELECT i, v, typeof(v) t FROM temp.atof ORDER BY i').all().filter(r => r.t !== 'real' || !Object.is(r.v, xs[r.i]))
    assert.equal(bad.length, 0)
  })

  // ============================================================= OPUS-H-1: discount switch spellings (6.0.37)
  await group(`OPUS-H-1 review: ${ODD_ENABLED.length} odd discount_enabled spellings are refused 400 for every reviewer, till unchanged`, async w => {
    const pid = await makeProduct(w, 'Enabled review')
    const t = cases()
    for (const reviewer of [NOPRICE, FULL]) {
      grants(w, reviewer)
      for (const value of ODD_ENABLED) {
        setDiscount(w, pid, { enabled: 0, percent: 50 })
        const before = effect(w, pid)
        const id = queue(w, 'products', 'update', 'product', { discount_enabled: value }, pid)
        const snap = snapshot(w)
        const result = await approve(w, id)
        const after = effect(w, pid)
        t.check(`${reviewer === FULL ? 'price' : 'no-price'} ${JSON.stringify(value)}`, result.status === 400 && result.body?.code === 'invalid_discount_enabled'
          && snapshot(w) === snap && status(w, id) === 'open', { status: result.status, code: result.body?.code, before: before.till, after: after.till })
      }
    }
    t.done(ODD_ENABLED.length * 2)
  })
  await group(`OPUS-H-1 direct PUT: ${ODD_ENABLED.length} odd discount_enabled spellings are refused 400 for every editor, till unchanged`, async w => {
    const pid = await makeProduct(w, 'Enabled direct')
    const t = cases()
    for (const editor of [3, 4]) {
      for (const value of ODD_ENABLED) {
        setDiscount(w, pid, { enabled: 0, percent: 50 })
        const snap = snapshot(w)
        const result = await request(w, 'products', 'PUT', `/${pid}`, { discount_enabled: value }, editor)
        t.check(`${editor === 4 ? 'price' : 'no-price'} ${JSON.stringify(value)}`, result.status === 400 && result.body?.code === 'invalid_discount_enabled'
          && snapshot(w) === snap, { status: result.status, code: result.body?.code, till: till(w, pid) })
      }
    }
    t.done(ODD_ENABLED.length * 2)
  })
  await group('OPUS-H-1 direct POST and review create: odd discount_enabled spellings are refused 400 and create nothing', async w => {
    grants(w, FULL)
    const t = cases()
    for (const value of ['1.0', 2, 'yes', ' 1', 'false ']) {
      const snap = snapshot(w)
      const direct = await request(w, 'products', 'POST', '/', { name: `Create ${JSON.stringify(value)}`, discount_enabled: value, discount_percent: 50 }, 4)
      t.check(`direct ${JSON.stringify(value)}`, direct.status === 400 && direct.body?.code === 'invalid_discount_enabled' && snapshot(w) === snap, direct)
      const id = queue(w, 'products', 'create', 'product', { name: `Queued ${JSON.stringify(value)}`, discount_enabled: value, discount_percent: 50 }, null)
      const snap2 = snapshot(w)
      const queued = await approve(w, id)
      t.check(`review ${JSON.stringify(value)}`, queued.status === 400 && queued.body?.code === 'invalid_discount_enabled' && snapshot(w) === snap2, queued)
    }
    t.done(10)
  })
  await group('OPUS-H-1 controls: canonical spellings compare on the stored value; with the grant they write exact 0/1', async w => {
    const pid = await makeProduct(w, 'Enabled controls')
    const t = cases()
    for (const value of [1, true, '1', 'true', 'TRUE']) {
      setDiscount(w, pid, { enabled: 0, percent: 50 })
      grants(w, NOPRICE)
      const id = queue(w, 'products', 'update', 'product', { discount_enabled: value }, pid)
      const snap = snapshot(w)
      const r = await approve(w, id)
      t.check(`no-price review ${JSON.stringify(value)} -> 403`, r.status === 403 && r.body?.permission === 'products:price' && snapshot(w) === snap, r)
      const d = await request(w, 'products', 'PUT', `/${pid}`, { discount_enabled: value }, 3)
      t.check(`no-price PUT ${JSON.stringify(value)} -> 403`, d.status === 403 && d.body?.code === 'product_price_edit_required', d)
      grants(w, FULL)
      const ok = await approve(w, id)
      const e = effect(w, pid)
      t.check(`price review ${JSON.stringify(value)} -> 200 exact 1`, ok.status === 200 && e.row.e === 1 && e.row.et === 'integer' && e.till.unit_price_usd === 2.5 && e.sql === 1, { ok, e })
    }
    for (const value of [0, false, '0', 'false', 'FALSE', null, '']) {
      setDiscount(w, pid, { enabled: 0, percent: 50 })
      grants(w, NOPRICE)
      const r = await approve(w, queue(w, 'products', 'update', 'product', { discount_enabled: value }, pid))
      const e = effect(w, pid)
      t.check(`no-price review unchanged ${JSON.stringify(value)} -> 200`, r.status === 200 && e.till.unit_price_usd === 5 && e.sql === 0
        && (e.row.e === 0 || e.row.e === null) && e.row.et !== 'text', { r, e })
      setDiscount(w, pid, { enabled: 0, percent: 50 })
      const d = await request(w, 'products', 'PUT', `/${pid}`, { discount_enabled: value }, 3)
      const e2 = effect(w, pid)
      t.check(`no-price PUT unchanged ${JSON.stringify(value)} -> 200`, d.status === 200 && e2.till.unit_price_usd === 5 && e2.sql === 0 && e2.row.et !== 'text', { d, e2 })
    }
    setDiscount(w, pid, { enabled: 1, percent: 50 })
    const d = await request(w, 'products', 'PUT', `/${pid}`, { discount_enabled: 'TRUE' }, 3)
    const e = effect(w, pid)
    t.check('active TRUE text stays exact INTEGER 1 and both readers agree', d.status === 200 && e.row.e === 1 && e.row.et === 'integer' && e.sql === 1 && e.till.active, { d, e })
    t.done(5 * 3 + 7 * 2 + 1)
  })
  await group(`OPUS-H-1 discount_type: ${ODD_TYPE.length} odd kinds are refused 400 on review and direct PUT; exact kinds compare on the stored value`, async w => {
    const pid = await makeProduct(w, 'Kind spellings')
    const t = cases()
    for (const value of ODD_TYPE) {
      setDiscount(w, pid, { enabled: 1, type: 'fixed', percent: 50, usd: 1 })
      grants(w, FULL)
      const id = queue(w, 'products', 'update', 'product', { discount_type: value }, pid)
      const snap = snapshot(w)
      const r = await approve(w, id)
      t.check(`review ${JSON.stringify(value)}`, r.status === 400 && r.body?.code === 'invalid_discount_type' && snapshot(w) === snap, r)
      const d = await request(w, 'products', 'PUT', `/${pid}`, { discount_type: value }, 4)
      t.check(`PUT ${JSON.stringify(value)}`, d.status === 400 && d.body?.code === 'invalid_discount_type' && snapshot(w) === snap, d)
    }
    setDiscount(w, pid, { enabled: 1, type: 'fixed', percent: 50, usd: 1 })
    const same = await request(w, 'products', 'PUT', `/${pid}`, { discount_type: 'FIXED' }, 3)
    const e = effect(w, pid)
    t.check('FIXED is the stored fixed kind: unchanged for no-price, stored lower-case', same.status === 200 && e.row.ty === 'fixed' && e.till.unit_price_usd === 4 && e.sql === 1, { same, e })
    const flip = await request(w, 'products', 'PUT', `/${pid}`, { discount_type: 'percent' }, 3)
    t.check('fixed -> percent needs products:price', flip.status === 403 && flip.body?.code === 'product_price_edit_required', flip)
    t.done(ODD_TYPE.length * 2 + 2)
  })
  await group('OPUS-H-1 legacy stored spellings: a value the readers disagree on is a change, never "unchanged"', async w => {
    const pid = await makeProduct(w, 'Legacy stored')
    grants(w, NOPRICE)
    const t = cases()
    // stored TEXT the kernel reads as ON (truthy) and SQL reads as OFF: writing canonical 0 would remove the discount
    // on the till, so it is a price change.
    for (const stored of ['false', 'no', 2, 'fixed ']) {
      const isKind = stored === 'fixed '
      w.raw.prepare(`UPDATE products SET selling_price_usd=5, discount_enabled=?, discount_type=?, discount_percent=50, discount_amount_usd=1 WHERE id=?`)
        .run(isKind ? 1 : stored, isKind ? stored : 'percent', pid)
      const payload = isKind ? { discount_type: 'fixed' } : { discount_enabled: 0 }
      const r = await approve(w, queue(w, 'products', 'update', 'product', payload, pid))
      t.check(`review over stored ${JSON.stringify(stored)}`, r.status === 403 && r.body?.permission === 'products:price', r)
      const d = await request(w, 'products', 'PUT', `/${pid}`, payload, 3)
      t.check(`PUT over stored ${JSON.stringify(stored)}`, d.status === 403, d)
    }
    t.done(8)
  })

  // ===================================================== OPUS-H-2/H-3: discount amounts at stored precision (6.0.38)
  await group('OPUS-H-2: a sub-4dp discount change is a price change on review and direct PUT; the price grant stores it exactly', async w => {
    const pid = await makeProduct(w, 'Precision')
    const t = cases()
    for (const [label, d, payload] of [
      ['percent 10 -> 10.00004', { enabled: 1, percent: 10 }, { discount_percent: 10.00004 }],
      ['percent 10 -> "10.00004"', { enabled: 1, percent: 10 }, { discount_percent: '10.00004' }],
      ['percent 10 -> 9.99999', { enabled: 1, percent: 10 }, { discount_percent: 9.99999 }],
      ['fixed usd 1 -> 1.00004', { enabled: 1, type: 'fixed', usd: 1 }, { discount_amount_usd: 1.00004 }],
      ['fixed khr 4000 -> 4000.00004', { enabled: 1, type: 'fixed', khr: 4000 }, { discount_amount_khr: 4000.00004 }],
      ['percent 10 -> 10.0001 (a real 4dp change)', { enabled: 1, percent: 10 }, { discount_percent: 10.0001 }],
    ]) {
      setDiscount(w, pid, d)
      grants(w, NOPRICE)
      const before = effect(w, pid)
      const id = queue(w, 'products', 'update', 'product', payload, pid)
      const snap = snapshot(w)
      const r = await approve(w, id)
      t.check(`review ${label}`, r.status === 403 && r.body?.permission === 'products:price' && snapshot(w) === snap, { r, before: before.till, after: till(w, pid) })
      const p = await request(w, 'products', 'PUT', `/${pid}`, payload, 3)
      t.check(`PUT ${label}`, p.status === 403 && snapshot(w) === snap, p)
      const ok = await request(w, 'products', 'PUT', `/${pid}`, payload, 4)
      const after = effect(w, pid)
      const key = Object.keys(payload)[0]
      const stored = w.raw.prepare(`SELECT ${key} v, typeof(${key}) t FROM products WHERE id=?`).get(pid)
      t.check(`price grant ${label} stores the exact number`, ok.status === 200 && stored.t === 'real' && stored.v === Number(payload[key]), { ok, stored, after: after.till })
    }
    for (const [label, d, payload] of [
      ['percent 10 vs 10', { enabled: 1, percent: 10 }, { discount_percent: 10 }],
      ['percent 10 vs "10.0000"', { enabled: 1, percent: 10 }, { discount_percent: '10.0000' }],
      ['percent 12.5 vs 12.5', { enabled: 1, percent: 12.5 }, { discount_percent: 12.5 }],
      ['legacy 10.00004 vs 10.00004', { enabled: 1, percent: 10.00004 }, { discount_percent: 10.00004 }],
      ['percent 0 vs null', { enabled: 0, percent: 0 }, { discount_percent: null }],
      ['usd 0 vs ""', { enabled: 0, usd: 0 }, { discount_amount_usd: '' }],
    ]) {
      setDiscount(w, pid, d)
      const before = effect(w, pid)
      grants(w, NOPRICE)
      const r = await approve(w, queue(w, 'products', 'update', 'product', payload, pid))
      const after = effect(w, pid)
      t.check(`review unchanged ${label}`, r.status === 200 && JSON.stringify(after.till) === JSON.stringify(before.till) && after.sql === before.sql, { r, before, after })
      setDiscount(w, pid, d)
      const p = await request(w, 'products', 'PUT', `/${pid}`, payload, 3)
      const after2 = effect(w, pid)
      t.check(`PUT unchanged ${label}`, p.status === 200 && JSON.stringify(after2.till) === JSON.stringify(before.till) && after2.sql === before.sql && after2.row.pt !== 'text', { p, before, after2 })
    }
    t.done(6 * 3 + 6 * 2)
  })
  await group('OPUS-H-2 form rendering: a 4-decimal rendering of a stored amount keeps the stored value; it is never written', async w => {
    const pid = await makeProduct(w, 'Rendering')
    const t = cases()
    for (const [label, d, payload, kept] of [
      ['percent 12.34565 posted as 12.3456', { enabled: 1, percent: 12.34565 }, { discount_percent: 12.3456 }, ['discount_percent', 12.34565]],
      ['usd 1.00004 posted as 1 (ProductForm roundMoney4)', { enabled: 1, type: 'fixed', usd: 1.00004 }, { discount_amount_usd: 1 }, ['discount_amount_usd', 1.00004]],
      ['khr float noise posted rounded, whole form', { enabled: 1, type: 'fixed', usd: 1.1, khr: 4510.000000000001 },
        { description: 'Employee edit', discount_enabled: 1, discount_type: 'fixed', discount_percent: 0, discount_amount_usd: 1.1, discount_amount_khr: 4510 },
        ['discount_amount_khr', 4510.000000000001]],
    ]) {
      setDiscount(w, pid, d)
      const before = effect(w, pid)
      grants(w, NOPRICE)
      const id = queue(w, 'products', 'update', 'product', payload, pid)
      const snap = snapshot(w)
      const r = await approve(w, id)
      t.check(`review ${label} -> 403 (exact at approval)`, r.status === 403 && r.body?.permission === 'products:price' && snapshot(w) === snap, r)
      const p = await request(w, 'products', 'PUT', `/${pid}`, payload, 3)
      const stored = w.raw.prepare(`SELECT ${kept[0]} v FROM products WHERE id=?`).get(pid).v
      t.check(`no-price PUT ${label} -> 200, stored value kept`, p.status === 200 && stored === kept[1]
        && JSON.stringify(till(w, pid)) === JSON.stringify(before.till), { status: p.status, code: p.body?.code, stored, before: before.till, after: till(w, pid) })
    }
    setDiscount(w, pid, { enabled: 1, type: 'fixed', usd: 1.00004 })
    const real = await request(w, 'products', 'PUT', `/${pid}`, { discount_amount_usd: 1.0001 }, 3)
    t.check('1.00004 posted as 1.0001 is not its rendering -> 403', real.status === 403 && real.body?.code === 'product_price_edit_required', real)
    t.done(7)
  })
  await group('OPUS-H-3: discount amounts never store as TEXT, so the SQL promoted predicate and the till agree', async w => {
    const pid = await makeProduct(w, 'Representation')
    const t = cases()
    for (const [label, d, payload, code] of [
      ['percent "" on enabled', { enabled: 1, percent: 0 }, { discount_percent: '' }, null],
      ['percent "0x0A"', { enabled: 1, percent: 10 }, { discount_percent: '0x0A' }, 'invalid_discount_value'],
      ['percent " 10"', { enabled: 1, percent: 10 }, { discount_percent: ' 10' }, 'invalid_discount_value'],
      ['percent "10 "', { enabled: 1, percent: 10 }, { discount_percent: '10 ' }, 'invalid_discount_value'],
      ['percent "NaN"', { enabled: 1, percent: 10 }, { discount_percent: 'NaN' }, 'invalid_discount_value'],
      ['usd true', { enabled: 1, type: 'fixed', usd: 1 }, { discount_amount_usd: true }, 'invalid_discount_value'],
      ['khr [1]', { enabled: 1, type: 'fixed', khr: 1 }, { discount_amount_khr: [1] }, 'invalid_discount_value'],
      ['starts_at number', { enabled: 1, percent: 10 }, { discount_starts_at: 5 }, 'invalid_discount_window'],
      ['ends_at object', { enabled: 1, percent: 10 }, { discount_ends_at: {} }, 'invalid_discount_window'],
    ]) {
      setDiscount(w, pid, d)
      const snap = snapshot(w)
      const p = await request(w, 'products', 'PUT', `/${pid}`, payload, 4)
      if (code) {
        t.check(`PUT ${label} -> 400 ${code}`, p.status === 400 && p.body?.code === code && snapshot(w) === snap, p)
        grants(w, FULL)
        const id = queue(w, 'products', 'update', 'product', payload, pid)
        const snap2 = snapshot(w)
        const r = await approve(w, id)
        t.check(`review ${label} -> 400 ${code}`, r.status === 400 && r.body?.code === code && snapshot(w) === snap2, r)
      } else {
        const e = effect(w, pid)
        t.check(`PUT ${label} stores no TEXT and readers agree`, p.status === 200 && e.row.pt !== 'text' && e.sql === (e.till.active ? 1 : 0), { p, e })
      }
    }
    t.done(17)
  })
  await group('OPUS-H discount window: a respelt start/end date is a change for no-price roles; the identical date is not', async w => {
    const pid = await makeProduct(w, 'Window')
    const t = cases()
    for (const [label, stored, value, change] of [
      ['identical', '2026-10-01', '2026-10-01', false], ['lead space', '2026-10-01', ' 2026-10-01', true],
      ['NBSP trail', '2026-10-01', '2026-10-01 ', true], ['null vs ""', null, '', false], ['"" vs null', '', null, false],
      ['date to datetime', '2026-10-01', '2026-10-01T00:00:00Z', true], ['null to date', null, '2026-12-31', true],
    ]) {
      setDiscount(w, pid, { enabled: 1, percent: 10, starts: stored })
      grants(w, NOPRICE)
      const r = await approve(w, queue(w, 'products', 'update', 'product', { discount_starts_at: value }, pid))
      t.check(`review ${label}`, change ? r.status === 403 : r.status === 200, r)
      setDiscount(w, pid, { enabled: 1, percent: 10, starts: stored })
      const p = await request(w, 'products', 'PUT', `/${pid}`, { discount_starts_at: value }, 3)
      t.check(`PUT ${label}`, change ? p.status === 403 : p.status === 200, p)
    }
    t.done(14)
  })

  // ============================================================== OPUS-H hunt: discount table, both paths
  await group('OPUS-H hunt: 22 discount cases on review and direct PUT never change the till or SQL predicate without products:price', async w => {
    const pid = await makeProduct(w, 'Discount hunt')
    const DISCOUNT_CASES = [
      ['enabled 2', 0, 'percent', 50, 0, { discount_enabled: 2 }], ['enabled "2"', 0, 'percent', 50, 0, { discount_enabled: '2' }],
      ['enabled " 1"', 0, 'percent', 50, 0, { discount_enabled: ' 1' }], ['enabled "1.0"', 0, 'percent', 50, 0, { discount_enabled: '1.0' }],
      ['enabled "01"', 0, 'percent', 50, 0, { discount_enabled: '01' }], ['enabled "+1"', 0, 'percent', 50, 0, { discount_enabled: '+1' }],
      ['enabled "1e0"', 0, 'percent', 50, 0, { discount_enabled: '1e0' }], ['enabled "false"', 0, 'percent', 50, 0, { discount_enabled: 'false' }],
      ['enabled "no"', 0, 'percent', 50, 0, { discount_enabled: 'no' }], ['enabled "yes"', 0, 'percent', 50, 0, { discount_enabled: 'yes' }],
      ['enabled "0x1"', 0, 'percent', 50, 0, { discount_enabled: '0x1' }], ['enabled -1', 0, 'percent', 50, 0, { discount_enabled: -1 }],
      ['enabled 0.5', 0, 'percent', 50, 0, { discount_enabled: 0.5 }],
      ['control enabled 1 (must refuse)', 0, 'percent', 50, 0, { discount_enabled: 1 }],
      ['control enabled "true" (must refuse)', 0, 'percent', 50, 0, { discount_enabled: 'true' }],
      ['control unchanged 0', 0, 'percent', 50, 0, { discount_enabled: 0 }],
      ['active TRUE text', 1, 'percent', 50, 0, { discount_enabled: 'TRUE' }],
      ['percent 0x0A vs 10', 1, 'percent', 10, 0, { discount_percent: '0x0A' }], ['percent 10.00004', 1, 'percent', 10, 0, { discount_percent: 10.00004 }],
      ['percent empty vs 0', 1, 'percent', 0, 0, { discount_percent: '' }],
      ['type fixed+NBSP', 1, 'fixed', 50, 1, { discount_type: 'fixed ' }], ['type pct vs percent', 1, 'percent', 50, 1, { discount_type: 'pct' }],
    ]
    assert.equal(DISCOUNT_CASES.length, 22)
    const t = cases()
    for (const [label, en, type, pct, amt, payload] of DISCOUNT_CASES) {
      for (const actor of ['review', 'direct']) {
        setDiscount(w, pid, { enabled: en, type, percent: pct, usd: amt })
        const before = effect(w, pid)
        let res
        if (actor === 'review') { grants(w, NOPRICE); res = await approve(w, queue(w, 'products', 'update', 'product', payload, pid)) }
        else res = await request(w, 'products', 'PUT', `/${pid}`, payload, 3)
        const after = effect(w, pid)
        const effectChanged = before.till.active !== after.till.active || before.till.unit_price_usd !== after.till.unit_price_usd || before.sql !== after.sql
        const mustRefuse = label.startsWith('control enabled')
        t.check(`${actor} ${label}`, mustRefuse ? res.status === 403 : !(res.status === 200 && effectChanged), { status: res.status, code: res.body?.code, before: before.till, after: after.till, sql: [before.sql, after.sql] })
      }
    }
    t.done(44)
  })

  // ======================================================= edit-fold survivor: price authority on the row that changes
  await group('Edit fold: a no-price editor moving a row onto a twin cannot rewrite the survivor price or discount; the grant can', async w => {
    const t = cases()
    const twin = (barcode, extra = '') => {
      w.raw.prepare(`INSERT INTO products(name, barcode, selling_price_usd, wholesale_price_usd, discount_enabled, discount_type, discount_percent, is_active)
        VALUES('Fold twin', ?, 9, 8, 1, 'percent', 50, 1)`).run(barcode)
      const id = w.raw.prepare('SELECT id FROM products WHERE barcode=?').get(barcode).id
      w.raw.prepare('INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(?,1,0),(?,2,0)').run(id, id)
      return id
    }
    const pick = id => w.raw.prepare('SELECT selling_price_usd s, wholesale_price_usd ws, discount_enabled e, discount_percent p, is_active a FROM products WHERE id=?').get(id)
    for (const [label, payload] of [
      ['prices and discount', { selling_price_usd: 5, wholesale_price_usd: 0, discount_enabled: 0, discount_percent: 0 }],
      ['selling price only', { selling_price_usd: 5 }],
      ['discount only', { discount_enabled: 0 }],
    ]) {
      const a = await makeProduct(w, `Fold source ${label}`, { barcode: String(8850000000000 + label.length) })
      const b = twin(String(8860000000000 + label.length))
      const snap = snapshot(w)
      const tillB = till(w, b)
      const r = await request(w, 'products', 'PUT', `/${a}`, { name: 'Fold twin', barcode: String(8860000000000 + label.length), ...payload }, 3)
      t.check(`no-price ${label} -> 403 before any write`, r.status === 403 && r.body?.code === 'product_price_edit_required' && snapshot(w) === snap
        && JSON.stringify(till(w, b)) === JSON.stringify(tillB), { r: { status: r.status, code: r.body?.code, merged_into: r.body?.merged_into }, b: pick(b), till: till(w, b) })
    }
    // A Review-tier editor's identity fold is finding I's (it will be queued, owner 13 Oct); not asserted here.
    // Unchanged survivor values: the fold itself is not a price edit.
    const a = await makeProduct(w, 'Fold source same', { barcode: '8870000000001' })
    w.raw.prepare("UPDATE products SET selling_price_usd=9, wholesale_price_usd=8, discount_enabled=1, discount_percent=50 WHERE id=?").run(a)
    const b = twin('8870000000002')
    const same = await request(w, 'products', 'PUT', `/${a}`, { name: 'Fold twin', barcode: '8870000000002', selling_price_usd: 9, wholesale_price_usd: 8, discount_enabled: 1, discount_percent: 50 }, 3)
    t.check('no-price fold with the survivor values unchanged -> 200 merged', same.status === 200 && same.body?.merged_into === b && JSON.stringify(till(w, b)) === JSON.stringify({ active: true, unit_price_usd: 4.5 }), same.body?.error ?? same.status)
    // The price grant may fold and reprice.
    const a2 = await makeProduct(w, 'Fold source grant', { barcode: '8880000000001' })
    const b2 = twin('8880000000002')
    const ok = await request(w, 'products', 'PUT', `/${a2}`, { name: 'Fold twin', barcode: '8880000000002', selling_price_usd: 5, discount_enabled: 0 }, 4)
    t.check('price editor fold reprices the survivor -> 200', ok.status === 200 && ok.body?.merged_into === b2 && pick(b2).s === 5 && pick(b2).e === 0, { status: ok.status, b: pick(b2) })
    t.done(5)
  })

  // ================================================================================ OPUS-H hunt: flow cases
  await group('OPUS-H hunt: 7 flow cases (revocation, self approval, forged pointer, case variant, mixed sequence, re-approval)', async w => {
    const pid = await makeProduct(w, 'Flow hunt')
    const feeRows = () => w.raw.prepare('SELECT COUNT(*) n FROM fees WHERE id=1').get().n
    const t = cases()
    grants(w, FULL)
    let id = queue(w, 'fees', 'delete', 'fee', { id: 1 })
    grants(w, { ...FULL, 'fees:delete': false })
    let snap = snapshot(w); let r = await approve(w, id)
    t.check('grant held at queue time, revoked before approve', r.status === 403 && snapshot(w) === snap, r)
    grants(w, FULL)
    snap = snapshot(w); r = await approve(w, queue(w, 'fees', 'delete', 'fee', { id: 1 }, 1, 2))
    t.check('reviewer approves own request (all grants)', r.status === 403 && feeRows() === 1, r)
    r = await approve(w, queueRaw(w, 'fees', 'delete', 'fee', JSON.stringify({ id: 1 }), 1, '2'))
    t.check('own request, requested_by stored as text 2', r.status === 403 && feeRows() === 1, r)
    grants(w, { ...FULL, 'fees:delete': false })
    const forged = queueRaw(w, 'fees', 'delete', 'fee', JSON.stringify({ kind: 'product.remove.pending', operation_id: 'op-x', plan_digest: 'd' }), 1)
    snap = snapshot(w); r = await approve(w, forged)
    t.check('fee row carrying a product-removal pointer; fees:delete=false, products:delete=true', r.status !== 200 && feeRows() === 1 && snapshot(w) === snap, r)
    const variant = queue(w, 'Fees', 'delete', 'fee', { id: 1 })
    snap = snapshot(w); r = await approve(w, variant)
    t.check('section Fees (case variant)', r.status !== 200 && feeRows() === 1 && snapshot(w) === snap, r)
    grants(w, { ...NOPRICE, 'fees:delete': false })
    w.raw.prepare('UPDATE products SET selling_price_usd=5 WHERE id=?').run(pid)
    const ids = [queue(w, 'fees', 'delete', 'fee', { id: 1 }), queue(w, 'inventory', 'update', 'inventory_reason', { items: ['Mixed batch reason'] }),
      queue(w, 'products', 'update', 'product', { selling_price_usd: 9 }, pid), queue(w, 'products', 'update', 'product', { description: 'Mixed batch description' }, pid)]
    const out = []
    for (const x of ids) out.push((await approve(w, x)).status)
    const st = ids.map(x => status(w, x))
    const prod = w.raw.prepare('SELECT selling_price_usd p, description d FROM products WHERE id=?').get(pid)
    t.check('mixed sequence', JSON.stringify(out) === '[403,200,403,200]' && feeRows() === 1 && prod.p === 5 && prod.d === 'Mixed batch description'
      && JSON.stringify(st) === JSON.stringify(['open', 'approved', 'open', 'approved']), { out, st, prod })
    grants(w, FULL)
    const done = queue(w, 'inventory', 'update', 'inventory_reason', { items: ['r'] })
    await approve(w, done)
    const r1 = await approve(w, done)
    grants(w, { ...FULL, 'inventory:edit_reasons': false })
    const r2 = await approve(w, done)
    t.check('already-approved row re-approved: with grant 409 / without grant 403', r1.status === 409 && r2.status === 403, { r1: r1.status, r2: r2.status })
    t.done(7)
  })

  // ========================================================= OPUS-H-7: rejected legacy rows can be resubmitted
  await group('OPUS-H-7: a requester resubmitting a rejected plan-less row with "1.0" cannot get a discount approved', async w => {
    const pid = await makeProduct(w, 'Resubmit')
    setDiscount(w, pid, { enabled: 0, percent: 50 })
    const id = queue(w, 'products', 'update', 'product', { description: 'first' }, pid)
    grants(w, FULL)
    assert.equal((await request(w, 'reviewQueue', 'POST', `/${id}/reject`, { reason: 'no' })).status, 200)
    const resubmit = await request(w, 'reviewQueue', 'POST', `/${id}/resubmit`, { payload: { discount_enabled: '1.0' } }, 1)
    assert.ok([200, 400].includes(resubmit.status), JSON.stringify(resubmit))
    grants(w, NOPRICE)
    const r = await approve(w, id)
    assert.notEqual(r.status, 200, JSON.stringify(r))
    assert.deepEqual(till(w, pid), { active: false, unit_price_usd: 5 })
  })

  // ========================================================================= D1 query budget (Free 50 / Paid 1000)
  await group('Query budget: approval admission adds bounded reads (Free 50 / Paid 1000)', async w => {
    const pid = await makeProduct(w, 'Budget', { image_path: 'https://example.invalid/a.png' })
    grants(w, NOPRICE)
    const measure = async (fn) => { queryCalls = 0; queryStatements = 0; const r = await fn(); return { status: r.status, calls: queryCalls, statements: queryStatements } }
    const fee = await measure(() => approve(w, queue(w, 'fees', 'delete', 'fee', { id: 1 })))
    const full = await measure(() => approve(w, queue(w, 'products', 'update', 'product', { description: 'Budget', selling_price_usd: 5,
      discount_enabled: 0, discount_type: 'percent', discount_percent: 0, image_path: 'https://example.invalid/a.png', image_gallery: ['https://example.invalid/a.png'] }, pid)))
    const put = await measure(() => request(w, 'products', 'PUT', `/${pid}`, { description: 'Budget PUT', selling_price_usd: 5, discount_enabled: 0, discount_type: 'percent', discount_percent: 0 }, 3))
    console.log(`  QUERY fee-delete-approved=${JSON.stringify(fee)} product-update-approved=${JSON.stringify(full)} direct-put=${JSON.stringify(put)}`)
    for (const m of [fee, full, put]) assert.ok(m.statements < 50, JSON.stringify(m))
  })

  const failed = results.filter(([, ok]) => !ok)
  console.log(`SUMMARY groups=${results.length} pass=${results.length - failed.length} fail=${failed.length}${MUTANT ? ` mutant=${MUTANT}` : ''}`)
  if (failed.length) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
