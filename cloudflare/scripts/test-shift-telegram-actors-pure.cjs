const productStockGuard = require('./harness/product_stock_guard.cjs')
// 13 Oct 2026, owner item 14 follow-up (refuter S3): "A status-change notification
// names who did it." Amending a shift already did (Amended by). The same rule now
// covers the two other events that re-send the shift report on someone else's
// behalf:
//
//   * a REOPEN posted as a plain "Shift report: Open" under the original cashier's
//     name -- indistinguishable from a fresh open. It now carries
//     `Reopened by: <who>` (the stored reopened_by_user_name);
//   * a CLOSE done by someone other than the cashier (an administrator closing a
//     till) carried no trace of it. It now carries `Closed by: <who>` (the stored
//     closed_by_user_name) -- only when the closer is not the cashier, so a cashier
//     closing their own till is not told what the Cashier row already says.
//
// This test is ROUTE-DRIVEN. The refuter showed the first amend test only matched
// the route's source text. Here the real routes/shifts.ts handlers run on the real
// migrations, a real session user for each actor, and every report they send goes
// through the real lib/telegram.ts sender into a local recorder that stands in for
// the Telegram API -- nothing leaves this process. What is asserted is the text the
// chat would receive, in en, km and both, plus the options the route handed over.
//
// Run (from cloudflare/): node scripts/test-shift-telegram-actors-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

// The API stand-in comes first, so no code path below can reach the network.
const posts = []
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith('https://api.telegram.org/botTEST-TOKEN/sendMessage'), `unexpected fetch ${url}`)
  posts.push(JSON.parse(init.body))
  return { ok: true, status: 200, text: async () => '' }
}

function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(root, 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const original = Module._load
  Module._load = function (request, parent, main) {
    if (request === './productStockGuard') return productStockGuard
    return request in overrides ? overrides[request] : original.call(this, request, parent, main)
  }
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, sourcePath, path.dirname(sourcePath)) }
  finally { Module._load = original }
  return mod.exports
}

function d1(sqlite) {
  const translate = (sql, params = {}) => {
    // getTelegramConfig binds positionally (an array); the shift routes bind by name.
    if (Array.isArray(params)) return { sql, values: params }
    const values = []
    return { sql: sql.replace(/@(\w+)/g, (_m, key) => { values.push(params[key] ?? null); return '?' }), values }
  }
  const statement = (sql) => ({
    async get(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).get(...q.values) },
    async all(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).all(...q.values) },
    async run(params) { const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values); return { changes: info.changes, meta: { changes: info.changes } } },
  })
  return {
    prepare: statement,
    async batch(items) {
      return sqlite.transaction(() => items.map(({ sql, params }) => {
        const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values)
        return { meta: { changes: info.changes } }
      }))()
    },
  }
}

function database() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0116_shift_sessions.sql'), 'utf8'))
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
    CREATE TABLE branches (id INTEGER PRIMARY KEY,name TEXT NOT NULL,is_active INTEGER DEFAULT 1);
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY, created_at TEXT, cashier_id INTEGER, branch_id INTEGER,
      sale_status TEXT, payment_method TEXT, payment_details TEXT,
      amount_paid_usd REAL, amount_paid_khr REAL, change_usd REAL, change_khr REAL,
      change_is_actual INTEGER, change_exchange_rate REAL, total_usd REAL, exchange_rate REAL,
      subtotal_usd REAL, discount_usd REAL, membership_discount_usd REAL, tax_usd REAL,
      delivery_fee_usd REAL, delivery_fee_paid_by TEXT, delivery_actual_cost_usd REAL,
      delivery_actual_cost_khr REAL, is_delivery INTEGER, source_return_id INTEGER,
      customer_id INTEGER, delivery_contact_id INTEGER, delivery_contact_name TEXT
    );
    CREATE TABLE sale_amendments(id INTEGER PRIMARY KEY, sale_id INTEGER);
    CREATE TABLE sale_write_revisions (sale_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY, sale_id INTEGER, quantity REAL, cost_price_usd REAL,
      product_discount_usd REAL, manual_discount_usd REAL
    );
    CREATE TABLE returns (
      id INTEGER PRIMARY KEY, sale_id INTEGER, created_at TEXT, cashier_id INTEGER, branch_id INTEGER,
      status TEXT, return_scope TEXT, total_refund_usd REAL, total_refund_khr REAL
    );
    CREATE TABLE return_items (
      id INTEGER PRIMARY KEY, return_id INTEGER, quantity REAL, cost_price_usd REAL,
      return_to_stock INTEGER, stock_action TEXT
    );
    CREATE TABLE fees (
      id INTEGER PRIMARY KEY, created_at TEXT, created_by INTEGER, branch_id INTEGER,
      fee_date TEXT, fee_type TEXT, label TEXT, amount_usd REAL, amount_khr REAL,
      sale_id INTEGER, delivery_contact_id INTEGER, notes TEXT
    );
    CREATE TABLE customers (id INTEGER PRIMARY KEY, membership_number TEXT);
    CREATE TABLE delivery_contacts (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,
      entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,record_id TEXT,old_value TEXT,new_value TEXT,
      device_name TEXT,device_tz TEXT,client_time TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  for (const migration of ['0089_system_flags', '0118_shift_policy_and_amendments', '0119_shift_restore_guard', '0123_shift_reopen_segments',
    '0132_shift_opening_count_presence', '0147_shift_additional_cash', '0237_shift_close_figures']) {
    db.exec(fs.readFileSync(path.join(root, 'migrations', `${migration}.sql`), 'utf8'))
  }
  db.prepare('INSERT INTO branches(id,name,is_active) VALUES (1,?,1)').run('Shop')
  db.exec(`INSERT INTO settings(key,value) VALUES ('business_name','Fixture Shop'), ('telegram_chat_id','-100000000001'), ('pos_payment_methods','["Cash","ABA"]')`)
  return db
}

const KERNEL = {
  revenue_usd: 50, cost_usd: 20, profit_usd: 30, delivery_usd: 0, pending_revenue_usd: 0, refund_usd: 0,
  delivery_actual_cost_usd: 0, delivery_actual_cost_count: 0, item_discount_usd: 0, discount_usd: 0, gross_sales_usd: 50,
}
const ENV = { TELEGRAM_BOT_TOKEN: 'TEST-TOKEN' }
const KHMER = /[ក-៿]/

async function main() {
  const sqlite = database()
  const dbModule = { getDb: () => d1(sqlite) }
  const businessDateWindow = loadReal('lib/businessDateWindow.ts')
  const financialPrecision = loadReal('lib/financialPrecision.ts')
  const moneyPrecision = loadReal('lib/moneyPrecision.ts')
  const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
  const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
  const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
  const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
  const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
  const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
  const analyticsPrecision = { './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
  const saleTotals = loadReal('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
  const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
  const paymentMethodRegistry = loadReal('lib/paymentMethodRegistry.ts')
  const salesAnalytics = loadReal('lib/salesAnalytics.ts', {
    './schemaProbe': loadReal('lib/schemaProbe.ts'), './db': dbModule, './removalLosses': loadReal('lib/removalLosses.ts'),
    './businessDateWindow': businessDateWindow, ...analyticsPrecision,
  })
  const shiftReconciliation = loadReal('lib/shiftReconciliation.ts', {
    './db': dbModule, './nativeSaleChange': nativeSaleChange, './salesAnalytics': salesAnalytics, './paymentMethodRegistry': paymentMethodRegistry,
  })

  // The report sender, REAL, over the same database. Only the sales kernel is a fixed answer,
  // as in the other Telegram report tests: this test is about who is named, not about money.
  const kernelAnalytics = {
    ...salesAnalytics,
    getSalesTotals: async () => ({ ...KERNEL }),
    getPaymentMethodBreakdown: async () => [],
    getDeliveryContactTotals: async () => [],
  }
  const lang = loadReal('lib/telegramLang.ts')
  const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': dbModule })
  const telegram = loadReal('lib/telegram.ts', {
    './db': dbModule, './lowStockSettings': { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG },
    './saleTotals': saleTotals, './businessDateWindow': businessDateWindow, './telegramLang': lang,
    './salesAnalytics': kernelAnalytics, './nativeSaleChange': nativeSaleChange,
    './shiftReconciliation': loadReal('lib/shiftReconciliation.ts', {
      './db': dbModule, './nativeSaleChange': nativeSaleChange, './salesAnalytics': kernelAnalytics, './paymentMethodRegistry': paymentMethodRegistry,
    }),
  })

  const pack = {
    en: require(path.join(root, '..', 'frontend', 'src', 'lang', 'en.json')),
    km: require(path.join(root, '..', 'frontend', 'src', 'lang', 'km.json')),
  }

  // ---- the actors: real session users ------------------------------------------------------------
  const pos = JSON.stringify({ pos: true })
  const users = {
    za: { id: 7, name: 'Za Full Name', username: 'za', permissions: pos, phone: '+85511111111', email: 'za@example.com' },
    sok: { id: 8, name: 'Sok Full Name', username: 'sok', permissions: pos, phone: '+85522222222', email: 'sok@example.com' },
    dara: { id: 9, name: 'Dara Full Name', username: 'dara', permissions: pos },
    lee: { id: 10, name: 'Lee Full Name', username: 'lee', permissions: pos },
    owner: { id: 1, name: 'Owner Full Name', username: 'owner', role_code: 'admin', permissions: pos, phone: '+85533333333', email: 'owner@example.com' },
  }
  let user = users.za

  // ---- the real routes; sends go to the real sender and are recorded with their options -------------
  const waited = []
  const sends = []
  const route = loadReal('routes/shifts.ts', {
    '../lib/branchRedirectWrite': require('./harness/branch_redirect_write.cjs'),
    '../lib/continuousReadWindow': loadReal('lib/continuousReadWindow.ts'),
    '../lib/businessDateWindow': businessDateWindow,
    '../lib/clientTimestamp': loadReal('lib/clientTimestamp.ts'),
    '../lib/db': dbModule,
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', user); await next() } },
    '../lib/permissions': loadReal('lib/permissions.ts'),
    '../lib/shiftReconciliation': shiftReconciliation,
    '../lib/audit': { audit: async () => { throw new Error('shift audit must be in the D1 batch') } },
    '../lib/telegramLang': lang,
    '../lib/telegram': {
      sendTelegramShiftReport: async (_env, shiftId, nowMs, options) => {
        sends.push({ shiftId, options })
        return telegram.sendTelegramShiftReport(ENV, shiftId, nowMs, options)
      },
      scheduleTelegramShiftOverview: async () => 'queued',
    },
  })
  const app = route.default || route
  const call = async (as, method, url, body) => {
    user = users[as]
    const response = await app.fetch(new Request(`http://test${url}`, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), {}, { waitUntil(promise) { waited.push(promise) }, passThroughOnException() {} })
    await Promise.all(waited.splice(0))
    return response
  }
  /** One route action, and the one message (text) it posted plus the options the route handed the sender. */
  async function act(as, method, url, body, expectedStatus) {
    const postsBefore = posts.length; const sendsBefore = sends.length
    const response = await call(as, method, url, body)
    assert.equal(response.status, expectedStatus, `${method} ${url} as ${as}: ${response.status} ${JSON.stringify(await response.clone().json().catch(() => null))}`)
    assert.equal(sends.length, sendsBefore + 1, 'exactly one report was sent for the action')
    assert.equal(posts.length, postsBefore + 1, 'and it reached the (local) Telegram stand-in once')
    return { json: await response.json(), text: posts[posts.length - 1].text, options: sends[sends.length - 1].options, shiftId: sends[sends.length - 1].shiftId }
  }
  const setLanguage = (mode) => sqlite.prepare("INSERT INTO settings(key,value) VALUES('telegram_language', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(mode)
  /** The same report again, in a given language, with the options the route sent. */
  async function replay(sent, mode) {
    setLanguage(mode)
    const before = posts.length
    try {
      assert.equal(await telegram.sendTelegramShiftReport(ENV, sent.shiftId, Date.now(), sent.options), true)
      return posts[before].text
    } finally { setLanguage('both') }
  }
  // The label as the chat shows it, built from the PACK keys.
  const SEP = lang.BILINGUAL_SEPARATOR
  const packLabel = (mode, key) => (mode === 'en' ? pack.en[key] : mode === 'km' ? pack.km[key] : `${pack.en[key]}${SEP}${pack.km[key]}`)
  const idLabel = (mode) => (mode === 'en' ? lang.TELEGRAM_LABELS.shift.en : mode === 'km' ? lang.TELEGRAM_LABELS.shift.km : `${lang.TELEGRAM_LABELS.shift.en} ${lang.TELEGRAM_LABELS.shift.km}`)
  const rowsOf = (text) => text.split('\n')
  const actorRow = (mode, key, name) => `· ${packLabel(mode, key)}: ${name}`
  const idRow = (mode, code) => `· ${idLabel(mode)}: ${code}`
  const codeOf = (id) => sqlite.prepare('SELECT shift_code FROM shift_sessions WHERE id = ?').get(id).shift_code
  const ACTOR_KEYS = ['shift_closed_by', 'shift_reopened_by', 'shift_amended_by']
  const anyActorRow = (text) => rowsOf(text).filter((row) => ACTOR_KEYS.some((key) => [pack.en[key], pack.km[key], `${pack.en[key]}${SEP}${pack.km[key]}`].some((label) => row.startsWith(`· ${label}: `))))

  const failures = []
  const section = async (name, run) => {
    try { await run(); console.log(`PASS [${name}]`) } catch (error) {
      failures.push({ name, message: String((error && error.message) || error).split('\n').slice(0, 16).join('\n') })
      console.log(`FAIL [${name}]`)
    }
  }

  setLanguage('both')
  const TODAY_OPEN = { branch_id: 1, opening_float_usd: 50, opening_float_khr: 100000 }
  const counted = { closing_counted_usd: 182.5, closing_counted_khr: 240000 }

  // Open the shifts the scenarios need (each cashier once on this branch-day).
  const opened = {}
  for (const who of ['za', 'sok', 'dara', 'lee']) {
    const sent = await act(who, 'POST', '/open', TODAY_OPEN, 201)
    opened[who] = sent.json.shift
    assert.deepEqual(anyActorRow(sent.text), [], `a fresh open names nobody (${who})`)
  }

  await section('0. labels: the packs\' own words, Khmer in the Khmer pack', async () => {
    assert.deepEqual(lang.TELEGRAM_LABELS.closedBy, { en: pack.en.shift_closed_by, km: pack.km.shift_closed_by })
    assert.deepEqual(lang.TELEGRAM_LABELS.reopenedBy, { en: pack.en.shift_reopened_by, km: pack.km.shift_reopened_by })
    assert.equal(pack.en.shift_closed_by, 'Closed by')
    assert.equal(pack.en.shift_reopened_by, 'Reopened by')
    for (const key of ['shift_closed_by', 'shift_reopened_by']) {
      assert.ok(KHMER.test(pack.km[key]) && pack.km[key] !== pack.en[key], `km.json ${key} carries Khmer, not the English value`)
      assert.ok(pack.km[key].endsWith(lang.TELEGRAM_LABELS.by.km), `${key}: the packs' "<verb>ដោយ" shape`)
    }
    assert.ok(pack.km.shift_closed_by.startsWith('បិទ'), 'closed = the app\'s បិទ')
    assert.ok(pack.km.shift_reopened_by.startsWith('បើកឡើងវិញ') || pack.km.shift_reopened_by.startsWith('បើកវេនឡើងវិញ'), 'reopened = the app\'s reopen verb')
  })

  await section('1. a cashier closing their OWN till: no "Closed by" row (the Cashier row says it)', async () => {
    const sent = await act('za', 'POST', '/close', { shift_id: opened.za.id, expected_revision: opened.za.revision, client_request_id: 'actors-close-za-0001', ...counted }, 200)
    assert.equal(sent.options.closedBy, 'za', 'the route hands over the stored closer')
    assert.deepEqual(anyActorRow(sent.text), [], sent.text)
    for (const mode of ['en', 'km']) assert.deepEqual(anyActorRow(await replay(sent, mode)), [], `[${mode}]`)
  })

  await section('2. an administrator closing a cashier\'s till (live close): "Closed by: owner" under the cashier\'s ID', async () => {
    const sent = await act('owner', 'POST', '/close', { shift_id: opened.sok.id, expected_revision: opened.sok.revision, client_request_id: 'actors-close-sok-0001', ...counted }, 200)
    assert.equal(sent.options.closedBy, 'owner', 'the stored closed_by_user_name, not the cashier')
    const code = codeOf(opened.sok.id)
    for (const mode of ['both', 'en', 'km']) {
      const text = mode === 'both' ? sent.text : await replay(sent, mode)
      const rows = rowsOf(text)
      const at = rows.indexOf(idRow(mode, code))
      assert.ok(at >= 0, `[${mode}] ID row\n${text}`)
      assert.equal(rows[at + 1], actorRow(mode, 'shift_closed_by', 'owner'), `[${mode}] the closer follows the ID row\n${text}`)
      assert.equal(rows.filter((row) => row === actorRow(mode, 'shift_closed_by', 'owner')).length, 1)
      assert.deepEqual(anyActorRow(text), [actorRow(mode, 'shift_closed_by', 'owner')], `[${mode}] only that one actor row`)
      if (mode === 'en') assert.ok(!KHMER.test(text.replace(/៛/g, '')), 'en carries no Khmer word')
      if (mode === 'km') assert.ok(!/Closed by/.test(text), 'km carries no English label')
    }
    assert.ok(sent.text.includes('sok'), 'and the Cashier row is still the cashier, sok')
    for (const secret of ['+85533333333', 'owner@example.com', 'Owner Full Name']) assert.ok(!sent.text.includes(secret), `${secret} must not reach the chat`)
  })

  await section('3. an administrator closing through the historic close route: "Closed by: owner" too', async () => {
    const sent = await act('owner', 'POST', `/${opened.dara.id}/close`, {
      expected_revision: opened.dara.revision, closed_at: new Date().toISOString(), ...counted,
    }, 200)
    assert.equal(sent.options.closedBy, 'owner')
    assert.deepEqual(anyActorRow(sent.text), [actorRow('both', 'shift_closed_by', 'owner')], sent.text)
  })

  await section('4. a reopen names who reopened, whoever it is (administrator, or the cashier themself)', async () => {
    const byAdmin = await act('owner', 'POST', `/${opened.za.id}/reopen`, {
      expected_revision: (await (await call('owner', 'GET', `/${opened.za.id}/history`)).json()).shift.revision, reason: 'Recount drawer', opening_float_usd: 3, opening_float_khr: 3000,
    }, 201)
    assert.equal(byAdmin.options.reopenedBy, 'owner', 'the stored reopened_by_user_name')
    for (const mode of ['both', 'en', 'km']) {
      const text = mode === 'both' ? byAdmin.text : await replay(byAdmin, mode)
      const rows = rowsOf(text)
      const at = rows.indexOf(idRow(mode, codeOf(byAdmin.shiftId)))
      assert.ok(at >= 0 && rows[at + 1] === actorRow(mode, 'shift_reopened_by', 'owner'), `[${mode}] the reopener follows the ID row\n${text}`)
      assert.deepEqual(anyActorRow(text), [actorRow(mode, 'shift_reopened_by', 'owner')])
      if (mode === 'km') assert.ok(!/Reopened by/.test(text), 'km carries no English label')
    }
    assert.ok(byAdmin.text.includes('za'), 'under the original cashier, za')
    assert.notEqual(byAdmin.shiftId, opened.za.id, 'the report is the reopened SEGMENT\'s')
    // The cashier reopening their own shift is still a reopen, not a fresh open.
    const sokRevision = (await (await call('sok', 'GET', `/${opened.sok.id}/history`)).json()).shift.revision
    const bySelf = await act('sok', 'POST', `/${opened.sok.id}/reopen`, { expected_revision: sokRevision, reason: 'Missed a sale', opening_float_usd: 1, opening_float_khr: 1000 }, 201)
    assert.equal(bySelf.options.reopenedBy, 'sok')
    assert.deepEqual(anyActorRow(bySelf.text), [actorRow('both', 'shift_reopened_by', 'sok')], bySelf.text)
  })

  await section('5. an amend by another account (already shipped) goes through the same route-driven path', async () => {
    const revision = (await (await call('owner', 'GET', `/${opened.dara.id}/history`)).json()).shift.revision
    const amendment = { expected_revision: revision, reason: 'Recount', closing_counted_usd: 77 }
    // Another cashier cannot reach dara's shift under per_account (audit A1): not found, and no report goes out.
    const sendsBefore = sends.length
    assert.equal((await call('sok', 'PATCH', `/${opened.dara.id}`, amendment)).status, 404)
    assert.equal(sends.length, sendsBefore, 'a refused amend sends nothing')
    // The shift-review administrator reaches every shift, and the report names them.
    const sent = await act('owner', 'PATCH', `/${opened.dara.id}`, amendment, 200)
    assert.equal(sent.options.amendedBy, 'owner')
    assert.deepEqual(anyActorRow(sent.text), [actorRow('both', 'shift_amended_by', 'owner')], sent.text)
    for (const mode of ['en', 'km']) assert.deepEqual(anyActorRow(await replay(sent, mode)), [actorRow(mode, 'shift_amended_by', 'owner')])
    for (const secret of ['+85533333333', 'owner@example.com', 'Owner Full Name']) assert.ok(!sent.text.includes(secret), `${secret} must not reach the chat`)
  })

  await section('6. a replacement opening after a cancel is a fresh open, not a reopen: no actor row', async () => {
    const cancelled = await act('owner', 'POST', `/${opened.lee.id}/cancel`, { expected_revision: opened.lee.revision, reason: 'Opened by mistake' }, 200)
    assert.ok(/Cancelled by/.test(cancelled.text), 'cancel still says who cancelled')
    const replacement = await act('lee', 'POST', '/open', TODAY_OPEN, 201)
    assert.ok(replacement.json.replaced_cancelled_shift_id, 'it really was the replacement path')
    assert.equal(replacement.options, undefined, 'the open push passes no actor options')
    assert.deepEqual(anyActorRow(replacement.text), [], replacement.text)
  })

  await section('7. every other send names nobody: the three actor rows are reserved for their own events', async () => {
    const closeSends = sends.filter((send) => send.options)
    assert.deepEqual(closeSends.map((send) => Object.keys(send.options).sort()), [
      ['closedBy'], ['closedBy'], ['closedBy'], ['reopenedBy'], ['reopenedBy'], ['amendedBy'],
    ].map((keys) => keys.sort()), 'one actor key per event: close x3, reopen x2, amend x1')
    assert.equal(sends.filter((send) => !send.options).length, 6, 'open x4 + cancel + replacement open pass no options')
  })

  if (failures.length) {
    console.log(`\n${failures.length} section(s) FAILED:`)
    for (const failure of failures) console.log(`\n--- ${failure.name} ---\n${failure.message}`)
    process.exit(1)
  }
  console.log('test-shift-telegram-actors-pure: all sections ok')
}

main().catch((error) => { console.error(error); process.exit(1) })
