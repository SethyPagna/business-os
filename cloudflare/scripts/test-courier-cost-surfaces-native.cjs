'use strict'
// Courier (actual delivery) cost on every sale surface, against the WHOLE Worker
// on workerd + D1.
//
// Owner rule (14 Oct 2026): the courier cost sits behind one permission,
// sales:view_courier_cost. It is on for an administrator and for every role that
// holds Sales until the role editor switches it off. A caller with it off is a
// cost viewer who gets GOODS profit or a plain reader who gets neither (cost grant,
// amend right and Sales tier do not open it); the customer's delivery FEE is
// revenue and stays visible to everyone who can see the sale.
//
// Fixture (all on the real routes; nothing is written to a table directly):
//   sale A  2026-10-05  delivery, fee $2.00, courier cost $0.83 at checkout,
//                       corrected to $1.37 by a cost amendment (delta $0.54)
//   sale B  2026-10-06  counter sale, then "delivery added": fee $3.25, courier
//                       cost $1.91, then the fee corrected to $3.75
// The hidden figures are chosen so that none of them occurs anywhere a
// non-administrator is legitimately shown (prices, fees, totals, ids).
//
// The scan is value-based, not key-based: it walks every response (decoding JSON
// held in strings) and flags the hidden numbers, the hidden amounts written into
// text such as "Actual delivery cost $0.83 to $1.37", and any courier-cost key.
// Every surface is read by an administrator first as the positive control that
// proves the instrument can see the figure where it is allowed.
//
// Run (from cloudflare/):  node scripts/test-courier-cost-surfaces-native.cjs
// Negative controls rewrite source text in memory at bundle time:
//   --wrong=open        every caller may see the courier cost
//   --wrong=cost-grant  the cost-view grant also opens it (the plausible wrong gate)
//   --wrong=amend       a full amender also reads it (the retired interim rule)
//   --wrong=admin-only  only an administrator reads it (the rule this permission replaced)
//   --wrong=summary     the record text keeps its amounts
//   --wrong=ledger      the amendment ledger keeps its amount columns and snapshots
//   --wrong=mutation    the write responses (create, replay, items, ...) are not projected
// And the red-on-the-base run: --base=<commit> bundles every src file that differs from that
// commit as that commit had it (nothing on disk changes), e.g. --base=dde1ba879.
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const flag = name => (process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`)) || '').slice(name.length + 3)
const WRONG = flag('wrong')
const BASE = flag('base')
const GATE = 'src/lib/courierCostAccess.ts'
const GATE_EXPRESSION = "  return isAdminControlUser(user) || getActionTier(user, 'sales', 'view_courier_cost') !== 'none'"
const MUTANTS = {
  open: [{ name: 'open', file: GATE, from: GATE_EXPRESSION, to: '  return true' }],
  amend: [{ name: 'amend', file: GATE, from: GATE_EXPRESSION, to: "  return isAdminControlUser(user) || getActionTier(user, 'sales', 'amend') === 'full'" }],
  'admin-only': [{ name: 'admin-only', file: GATE, from: GATE_EXPRESSION, to: '  return isAdminControlUser(user)' }],
  mutation: [{ name: 'mutation', file: GATE, from: 'if (mutation) args[0]', to: 'if (false) args[0]' }],
  'cost-grant': [
    { name: 'cost-grant-import', file: GATE, from: "import { getActionTier, isAdminControlUser, type PermissionUser } from './permissions'",
      to: "import { getActionTier, getMergedPermissions, isAdminControlUser, type PermissionUser } from './permissions'" },
    { name: 'cost-grant', file: GATE, from: GATE_EXPRESSION, to: '  return isAdminControlUser(user) || getMergedPermissions(user).product_cost_view === true' },
  ],
  summary: [{ name: 'summary', file: GATE, from: "record.summary.replace(COURIER_COST_SUMMARY, '$1 changed')", to: 'record.summary' }],
  ledger: [{ name: 'ledger', file: GATE, from: 'const costEntry = row.kind === COST_LEDGER_KIND', to: 'const costEntry = false' }],
}
if (WRONG && !MUTANTS[WRONG]) throw new Error(`unknown --wrong=${WRONG}; choose one of ${Object.keys(MUTANTS).join(', ')}`)

const day = (date, hourUtc = 3) => `${date}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`
const QUOTE = { gross_usd: 10, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 10, total_khr: 40000 }
const RANGE = 'startDate=2026-10-05&endDate=2026-10-06'

// Per-sale hidden figures and the sum / margin / delta a reader could derive.
const HIDDEN_USD = [0.83, 1.37, 1.91, 0.54, 3.28, 2.46]
const HIDDEN_KHR = [3320, 5480, 7640, 9840]
const HIDDEN_TEXT = [...HIDDEN_USD, ...HIDDEN_KHR].map(value => ({
  label: String(value), re: new RegExp(`(?<![\\d.])${String(value).replace('.', '\\.')}(?!\\d)`),
}))
const COURIER_KEY = /(^|_)(actual_delivery_cost|delivery_actual_cost)(_|$)|(^|_)courier_cost(?!_hidden)(_|$)|^actual_cost_(usd|khr|count|before|after)$|(^|_)delivery_(margin|net)_usd$|^(recognized|pending)_delivery_cost_usd$/i

function scan(body) {
  const hits = []
  const walk = (value, trail) => {
    if (value === null || value === undefined) return
    if (typeof value === 'string') {
      const text = value.trim()
      if (text.length > 1 && text.length < 50000 && /^[[{]/.test(text)) {
        try { walk(JSON.parse(text), `${trail}(json)`); return } catch { /* plain text */ }
      }
      for (const hidden of HIDDEN_TEXT) if (hidden.re.test(value)) hits.push(`${trail} text ${hidden.label}`)
      return
    }
    if (typeof value === 'number') {
      if ([...HIDDEN_USD, ...HIDDEN_KHR].some(hidden => Math.abs(value - hidden) < 1e-9)) hits.push(`${trail}=${value}`)
      return
    }
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${trail}[${index}]`)); return }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (COURIER_KEY.test(key)) hits.push(`${trail}.${key} (key)`)
        walk(child, `${trail}.${key}`)
      }
    }
  }
  walk(body, '')
  return [...new Set(hits)]
}

async function main() {
  const started = Date.now()
  const h = await H.startWorker({ patches: WRONG ? MUTANTS[WRONG] : BASE ? H.basePatches(BASE) : [] })
  const r = H.recorder('CCS')
  try {
    await H.seedProduct(h, 704, 'CCS Delivered Cream', 10, 1000, 1)
    await h.db.prepare("INSERT INTO delivery_contacts(id,name,phone) VALUES(1,'CCS Driver','012000444')").run()

    // ---- fixture -------------------------------------------------------------
    const a = await H.createSale(h, { key: 'ccs-a', createdAt: day('2026-10-05'), lines: [{ productId: 704, quantity: 1, quote: QUOTE }],
      paymentDetails: [{ method: 'Cash', amount_usd: 12, amount_khr: 0 }],
      extra: { is_delivery: true, delivery_contact_id: 1, delivery_fee_usd: 2, delivery_fee_paid_by: 'customer', delivery_actual_cost_usd: 0.83 } })
    assert.equal(a.status, 200, JSON.stringify(a.body).slice(0, 300))
    const idA = a.body.id
    const costChange = await H.amendSale(h, idA, { kind: 'delivery_actual_cost_changed', client_request_id: 'ccs-a-cost', delivery_actual_cost_usd: 1.37 })
    assert.equal(costChange.status, 200, JSON.stringify(costChange.body).slice(0, 300))

    const b = await H.createSale(h, { key: 'ccs-b', createdAt: day('2026-10-06'), lines: [{ productId: 704, quantity: 1, quote: QUOTE }],
      paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }] })
    assert.equal(b.status, 200, JSON.stringify(b.body).slice(0, 300))
    const idB = b.body.id
    const added = await H.amendSale(h, idB, { kind: 'delivery_added', client_request_id: 'ccs-b-delivery', delivery_contact_id: 1,
      delivery_fee_usd: 3.25, delivery_actual_cost_usd: 1.91 })
    assert.equal(added.status, 200, JSON.stringify(added.body).slice(0, 300))
    const feeChange = await H.amendSale(h, idB, { kind: 'delivery_fee_changed', client_request_id: 'ccs-b-fee', delivery_fee_usd: 3.75, delivery_fee_paid_by: 'customer' })
    assert.equal(feeChange.status, 200, JSON.stringify(feeChange.body).slice(0, 300))
    console.log(`TIME fixture ready at ${((Date.now() - started) / 1000).toFixed(1)} s (sale A #${idA}, sale B #${idB})`)

    const OFF = { 'sales:view_courier_cost': false }
    const accounts = {
      admin: undefined,
      'cost-viewer': await h.addEmployee(960, 'ccs_cost_viewer', { sales: 'view', reports: true, dashboard: true, contacts: true, audit_log: true, product_cost_view: true, ...OFF }),
      'plain-reader': await h.addEmployee(961, 'ccs_plain_reader', { sales: 'view', reports: true, dashboard: true, contacts: true, audit_log: true, ...OFF }),
      'default-viewer': await h.addEmployee(964, 'ccs_default_viewer', { sales: 'view', reports: true, dashboard: true, contacts: true, audit_log: true }),
    }
    const amender = await h.addEmployee(962, 'ccs_amender', { sales: true, reports: true, dashboard: true, contacts: true, product_cost_view: true, ...OFF })
    const defaultAmender = await h.addEmployee(966, 'ccs_default_amender', { sales: true, reports: true, dashboard: true, contacts: true })

    const read = async (who, url, cookie = accounts[who]) => {
      const res = await h.call('GET', H.fresh(url), undefined, `${who} ${url}`, cookie ? { cookie } : {})
      return { status: res.status, body: res.body, hits: res.status === 200 ? scan(res.body) : [] }
    }

    // [label, url, admin must show the figure (positive control)]
    const surfaces = [
      ['records A', `/api/sales/${idA}/records`, true],
      ['records B', `/api/sales/${idB}/records`, true],
      ['amendments A', `/api/sales/${idA}/amendments`, true],
      ['amendments B', `/api/sales/${idB}/amendments`, true],
      ['sales list', `/api/sales?${RANGE}`, true],
      ['sales by id', `/api/sales?id=${idA},${idB}`, true],
      ['sales export', `/api/sales/export?${RANGE}`, false],
      ['sales export rows', `/api/sales/export?${RANGE}&detailsOnly=1`, false],
      ['stats strip', `/api/sales/stats-strip?${RANGE}`, true],
      ['daily report', `/api/sales/daily-report?${RANGE}`, false],
      ['day report A', '/api/sales/day-report?date=2026-10-05', true],
      ['delivery-contact report', `/api/sales/delivery-contact-report?${RANGE}&contactId=1`, true],
      ['reports overview', `/api/reports/overview?${RANGE}`, true],
      ['reports periods', `/api/reports/periods?granularity=day&${RANGE}`, true],
      ['reports grouped customer', `/api/reports/grouped?by=customer&${RANGE}`, true],
      ['reports grouped courier', `/api/reports/grouped?by=courier&${RANGE}`, true],
      ['reports grouped payment', `/api/reports/grouped?by=payment_method&${RANGE}`, true],
      ['business summary', `/api/reports/business-summary/sales?${RANGE}`, false],
      ['business summary export', `/api/reports/business-summary/sales?${RANGE}&intent=export`, false],
      ['dashboard analytics', `/api/analytics?${RANGE}&granularity=day`, true],
      ['dashboard startup', `/api/dashboard/startup?${RANGE}&granularity=day`, true],
      ['audit log (sales)', '/api/system/audit-logs?entity=sale&pageSize=100', true],
    ]

    const matrix = []
    const results = {}
    for (const [label, url] of surfaces) {
      for (const who of ['admin', 'cost-viewer', 'plain-reader', 'default-viewer']) {
        const got = await read(who, url)
        results[`${who}|${label}`] = got
        matrix.push({ label, who, status: got.status, hits: got.hits })
      }
    }

    // ---- instrument controls: the administrator sees the figure where it is allowed ----
    for (const [label, , control] of surfaces) {
      if (!control) continue
      r.check(`control: administrator sees the courier cost on ${label}`, () => {
        const got = results[`admin|${label}`]
        assert.equal(got.status, 200, `admin ${label} answered ${got.status}`)
        assert.ok(got.hits.length > 0, `the scan found no courier cost on the administrator's ${label}; the instrument cannot see it`)
      })
    }

    // ---- the default: a Sales role nobody switched off reads what the administrator reads ----
    for (const [label, , control] of surfaces) {
      if (!control) continue
      r.check(`a Sales role with the permission left on reads the courier cost on ${label}`, () => {
        const got = results[`default-viewer|${label}`]
        assert.equal(got.status, 200, `default-viewer ${label} answered ${got.status}`)
        assert.ok(got.hits.length > 0, `the Sales role with the default permission sees no courier cost on ${label}`)
      })
    }

    // ---- the rule: with the permission off, neither a cost viewer nor a plain reader sees it ----
    for (const [label] of surfaces) {
      for (const who of ['cost-viewer', 'plain-reader']) {
        r.check(`${who} cannot read the courier cost on ${label}`, () => {
          const got = results[`${who}|${label}`]
          assert.equal(got.status, 200, `${who} ${label} answered ${got.status} ${JSON.stringify(got.body).slice(0, 120)}`)
          assert.deepEqual(got.hits, [], `${who} ${label} leaks the courier cost at ${got.hits.slice(0, 6).join(', ')}`)
        })
      }
    }

    // ---- the history stays complete and the customer fee stays visible --------------
    const recordIds = who => ['records A', 'records B'].map(label => results[`${who}|${label}`].body.records.map(record => record.id))
    const fieldOf = (who, label, kind, field) => (results[`${who}|${label}`].body.records.find(record => record.kind === kind)?.changes || []).find(change => change.field === field)
    for (const who of ['cost-viewer', 'plain-reader']) {
      r.check(`${who} still sees every record of both sales (the trail is redacted, never shortened)`, () => {
        assert.deepEqual(recordIds(who), recordIds('admin'))
        assert.deepEqual(
          results[`${who}|records A`].body.records.map(record => record.kind),
          results['admin|records A'].body.records.map(record => record.kind))
        assert.ok(results[`${who}|records A`].body.records.some(record => record.kind === 'delivery_cost_changed'), 'the cost-change record is gone')
        assert.equal(results[`${who}|records A`].body.count, results['admin|records A'].body.count)
      })
      r.check(`${who} still sees the customer delivery fee on records (a fee is revenue)`, () => {
        const created = fieldOf(who, 'records A', 'sale_created', 'delivery')
        assert.equal(created.after.value.delivery_fee_usd, 2)
        assert.equal(created.after.value.driver.name, 'CCS Driver')
        assert.equal(Object.hasOwn(created.after.value, 'actual_delivery_cost_usd'), false)
        const addedFee = fieldOf(who, 'records B', 'delivery_added', 'delivery_fee_usd')
        assert.equal(addedFee.after.value, 3.25)
        const changedFee = fieldOf(who, 'records B', 'delivery_fee_changed', 'delivery_fee_usd')
        assert.deepEqual([changedFee.before.value, changedFee.after.value], [3.25, 3.75])
      })
      r.check(`${who} still sees the amendment ledger, its kinds, its actors and the fee amounts`, () => {
        const ledger = results[`${who}|amendments B`].body
        const adminLedger = results['admin|amendments B'].body
        assert.deepEqual(ledger.entries.map(entry => [entry.id, entry.kind, entry.user_name]), adminLedger.entries.map(entry => [entry.id, entry.kind, entry.user_name]))
        const fee = ledger.entries.find(entry => entry.kind === 'delivery_fee_changed')
        assert.deepEqual([fee.amount_before_usd, fee.amount_after_usd], [3.25, 3.75])
        assert.equal(ledger.summary.deliveryFeeAfterUsd, 3.75)
        const costOnly = results[`${who}|amendments A`].body.entries.find(entry => entry.kind === 'delivery_actual_cost_changed')
        assert.ok(costOnly, 'the cost-change ledger entry is gone')
      })
      r.check(`${who} reads the cost-change record as a text that names no amount`, () => {
        const record = results[`${who}|records A`].body.records.find(entry => entry.kind === 'delivery_cost_changed')
        assert.match(record.summary, /^Actual delivery cost changed/)
      })
    }

    // ---- the administrator is unchanged -------------------------------------------
    r.check('administrator still reads the full before/after on the cost-change record', () => {
      const change = fieldOf('admin', 'records A', 'delivery_cost_changed', 'actual_delivery_cost_usd')
      assert.deepEqual([change.before.value, change.after.value], [0.83, 1.37])
      const created = fieldOf('admin', 'records A', 'sale_created', 'delivery')
      assert.equal(created.after.value.actual_delivery_cost_usd, 0.83)
      const record = results['admin|records A'].body.records.find(entry => entry.kind === 'delivery_cost_changed')
      assert.match(record.summary, /\$0\.83 to \$1\.37/)
    })
    r.check('administrator still reads the cost-change ledger entry amounts and snapshots', () => {
      const entry = results['admin|amendments A'].body.entries.find(item => item.kind === 'delivery_actual_cost_changed')
      assert.deepEqual([entry.amount_before_usd, entry.amount_after_usd, entry.amount_delta_usd], [0.83, 1.37, 0.54])
      assert.equal(entry.courier_cost_hidden, undefined)
      const addedEntry = results['admin|amendments B'].body.entries.find(item => item.kind === 'delivery_added')
      assert.equal(JSON.parse(addedEntry.after_json).delivery_actual_cost_usd, 1.91)
    })

    // ---- a full sales amender is decided by the permission alone: amending is not a way to the cost ----
    const amenderRecords = await read('amender', `/api/sales/${idA}/records`, amender)
    const amenderLedger = await read('amender', `/api/sales/${idA}/amendments`, amender)
    const amenderList = await read('amender', `/api/sales?${RANGE}`, amender)
    r.check('a full sales amender with the cost grant and the permission off cannot read the courier cost in the records, the ledger or the list', () => {
      assert.deepEqual(amenderRecords.hits, [])
      assert.deepEqual(amenderLedger.hits, [])
      assert.deepEqual(amenderList.hits, [])
    })
    const defaultAmenderList = await read('default-amender', `/api/sales?${RANGE}`, defaultAmender)
    const defaultAmenderRecords = await read('default-amender', `/api/sales/${idA}/records`, defaultAmender)
    r.check('a full sales amender with the permission left on reads it on the list and in the records', () => {
      assert.ok(defaultAmenderList.hits.length > 0)
      assert.ok(defaultAmenderRecords.hits.length > 0)
    })

    // ---- every write that returns the sale's canonical snapshot leaves by the list's rule ----
    // Sale C is placed by a staff account that may create sales and add items but may not amend (sales:amend false);
    // sale D is the same sale placed by the administrator, the positive control that the scan sees the figure on
    // each write path. The status route returns id/status only, so it carries no figure either way.
    const staff = await h.addEmployee(963, 'ccs_staff', { sales: true, 'sales:amend': false, ...OFF })
    const staffOn = await h.addEmployee(965, 'ccs_staff_on', { sales: true, 'sales:amend': false })
    const costSale = { is_delivery: true, delivery_contact_id: 1, delivery_fee_usd: 2, delivery_fee_paid_by: 'customer', delivery_actual_cost_usd: 2.46 }
    const place = (key, cookie, actorId) => H.createSale(h, { key, createdAt: day('2026-10-07'), lines: [{ productId: 704, quantity: 1, quote: QUOTE }],
      paymentDetails: [{ method: 'Cash', amount_usd: 12, amount_khr: 0 }], cookie,
      extra: { ...(actorId ? { offline_owner: { ...h.owner, actor_id: actorId } } : {}), ...costSale } })
    const writes = []
    const wrote = (path, who, res) => { writes.push({ path, who, status: res.status, hits: res.status === 200 ? scan(res.body) : [] }); return res }
    wrote('create', 'staff-on', await place('ccs-e', staffOn, 965))
    const staffCreate = wrote('create', 'staff', await place('ccs-c', staff, 963))
    assert.equal(staffCreate.status, 200, JSON.stringify(staffCreate.body).slice(0, 300))
    wrote('create replay', 'staff', await place('ccs-c', staff, 963))
    wrote('create', 'admin', await place('ccs-d', undefined, undefined))
    wrote('create replay', 'admin', await place('ccs-d', undefined, undefined))
    const idC = staffCreate.body.id
    const receiptUrl = H.fresh('/api/sales/create-receipt?client_request_id=ccs-c')
    wrote('create-receipt (GET)', 'staff', await h.call('GET', receiptUrl, undefined, 'staff create-receipt', { cookie: staff }))
    wrote('create-receipt (GET)', 'admin', await h.call('GET', receiptUrl, undefined, 'admin create-receipt'))
    wrote('add items', 'staff', await H.addSaleItems(h, idC, 'ccs-c-items-staff', [{ productId: 704, quantity: 1 }], 'staff add items', staff))
    wrote('add items', 'admin', await H.addSaleItems(h, idC, 'ccs-c-items-admin', [{ productId: 704, quantity: 1 }], 'admin add items'))
    const feeChange2 = { kind: 'delivery_fee_changed', delivery_fee_usd: 2.5, delivery_fee_paid_by: 'customer' }
    wrote('amend (fee change)', 'admin', await H.amendSale(h, idC, { ...feeChange2, client_request_id: 'ccs-c-fee-admin' }))
    wrote('amend (fee change)', 'amender', await H.amendSale(h, idC, { ...feeChange2, delivery_fee_usd: 2.75, client_request_id: 'ccs-c-fee-amender' }, 'amender fee change', amender))
    const staffAmend = await H.amendSale(h, idC, { ...feeChange2, delivery_fee_usd: 3, client_request_id: 'ccs-c-fee-staff' }, 'staff fee change', staff)
    wrote('status change', 'staff', await h.call('PATCH', `/api/sales/${idC}/status`, { sale_status: 'awaiting_delivery', client_request_id: 'ccs-c-status-staff' }, 'staff status', { cookie: staff }))
    const writeOf = (path, who) => writes.find(entry => entry.path === path && entry.who === who)

    for (const path of ['create', 'create replay', 'create-receipt (GET)', 'add items', 'amend (fee change)']) {
      r.check(`control: administrator sees the courier cost on the ${path} response`, () => {
        const got = writeOf(path, 'admin')
        assert.equal(got.status, 200, `admin ${path} answered ${got.status}`)
        assert.ok(got.hits.length > 0, `the scan found no courier cost on the administrator's ${path} response`)
      })
    }
    r.check('control: a staff account without sales:amend but with the permission left on reads the courier cost on the create response', () => {
      const got = writeOf('create', 'staff-on')
      assert.equal(got.status, 200, `staff-on create answered ${got.status}`)
      assert.ok(got.hits.length > 0)
    })
    for (const path of ['create', 'create replay', 'create-receipt (GET)', 'add items', 'status change']) {
      r.check(`a staff account with the permission off cannot read the courier cost on the ${path} response`, () => {
        const got = writeOf(path, 'staff')
        assert.equal(got.status, 200, `staff ${path} answered ${got.status}`)
        assert.deepEqual(got.hits, [], `staff ${path} leaks the courier cost at ${got.hits.slice(0, 6).join(', ')}`)
      })
    }
    r.check('a staff account without sales:amend is refused the amendment route, and the refusal names no figure', () => {
      assert.equal(staffAmend.status, 403)
      assert.deepEqual(scan(staffAmend.body), [])
    })
    const staffList = await read('staff', `/api/sales?id=${idC}`, staff)
    const adminList = await read('admin', `/api/sales?id=${idC}`)
    r.check('the rule is the list rule: the same staff account (permission off) is hidden the cost on GET /api/sales and the administrator is not', () => {
      assert.deepEqual(staffList.hits, [])
      assert.ok(adminList.hits.length > 0)
    })
    r.check('a full amender with the permission off reads no courier cost on the amend response; the administrator does', () => {
      assert.equal(writeOf('amend (fee change)', 'amender').status, 200)
      assert.deepEqual(writeOf('amend (fee change)', 'amender').hits, [])
      assert.ok(writeOf('amend (fee change)', 'admin').hits.length > 0)
    })
    console.log('\nWRITE-RESPONSE MATRIX (hits = hidden figures or courier-cost keys found in the response)')
    for (const entry of writes) console.log(`MATRIX write ${entry.path.padEnd(22)} ${entry.who.padEnd(8)} ${entry.status} ${entry.hits.length ? `VISIBLE(${entry.hits.length})` : 'hidden'}`)

    // ---- the audit trail still lists every sale amendment; only the figure leaves it ----
    const auditRows = who => results[`${who}|audit log (sales)`].body.items.filter(item => item.entity === 'sale').map(item => [item.id, item.action, item.user_name])
    for (const who of ['cost-viewer', 'plain-reader']) {
      r.check(`${who} still sees every audit row of the sale amendments, and the amounts a fee change names`, () => {
        assert.ok(auditRows('admin').length >= 3, 'the fixture writes an audit row per amendment (one cost change, one delivery added, one fee change)')
        assert.deepEqual(auditRows(who), auditRows('admin'))
        const fee = results[`${who}|audit log (sales)`].body.items.map(item => JSON.parse(item.details || 'null')).find(details => details && details.kind === 'delivery_fee_changed')
        assert.deepEqual([fee.fee_before, fee.fee_after], [3.25, 3.75])
      })
    }
    // The undo history holds no courier-cost amendment at all (none of these writes one); the read is kept as a standing probe.
    const history = await read('plain-reader', '/api/action-history?scope=sales&all=1&limit=100')
    console.log(`INFO action history (sales) rows ${Array.isArray(history.body?.items) ? history.body.items.length : 'n/a'}; plain reader sees ${history.hits.length ? `${history.hits.length} figures` : 'no courier figure'}`)
    r.check('the action history shows a plain reader no courier cost', () => assert.deepEqual(history.hits, []))

    console.log('\nSURFACE MATRIX (hits = hidden figures or courier-cost keys found in the response)')
    for (const [label] of surfaces) {
      const cells = ['admin', 'default-viewer', 'cost-viewer', 'plain-reader'].map(who => {
        const entry = matrix.find(item => item.label === label && item.who === who)
        return `${who} ${entry.status} ${entry.hits.length ? `VISIBLE(${entry.hits.length})` : 'hidden'}`
      })
      console.log(`MATRIX ${label.padEnd(26)} ${cells.join(' | ')}`)
    }
    console.log(`MATRIX ${'sales list (amender off)'.padEnd(26)} ${amenderList.hits.length ? 'VISIBLE' : 'hidden'}`)
  } finally {
    await h.mf.dispose?.()
  }
  const failed = r.results.filter(entry => !entry.ok)
  console.log(`\n${failed.length ? 'RED' : 'GREEN'} courier cost surfaces: ${r.results.length - failed.length}/${r.results.length} checks hold${WRONG ? ` (mutant --wrong=${WRONG})` : BASE ? ` (src as of ${BASE})` : ''}`)
  process.exitCode = failed.length ? 1 : 0
}

main().then(() => process.exit(process.exitCode || 0)).catch(error => { console.error(error); process.exit(1) })
