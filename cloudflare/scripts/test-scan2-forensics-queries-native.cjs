#!/usr/bin/env node
// Fixture proof for the SCAN2 N16 read-only detection queries in ops/queries.
// Each query runs exactly as the ops workflow runs it (the guard's canonical
// text) on a fresh node:sqlite database built from every migration, seeded
// with rows the query must list and near-misses a plausible wrong query would
// also list.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const PERSONAL_COLUMN = /(^|_)(name|phone|address|email|note|notes)(_|$)/

const QUERY_RULES = {
  'forensics-u11-return-on-not-paid-sale': { minRows: 0, maxRows: 2000, expectZero: null },
  'forensics-u12-import-merge-stock-adds': { minRows: 0, maxRows: 5000, expectZero: null },
  'forensics-u2-sale-rate-outliers': { minRows: 0, maxRows: 2000, expectZero: null },
  'forensics-pp1-last-day-promo-miss': { minRows: 0, maxRows: 2000, expectZero: null },
  'forensics-pp2-discount-date-shape': { minRows: 0, maxRows: 5000, expectZero: null },
  'promo-rule-capture-risk': { minRows: 1, maxRows: 1, expectZero: null },
  'forensics-pp10-membership-discount-mismatch': { minRows: 0, maxRows: 2000, expectZero: null },
  'forensics-pp3-strip-link-shape': { minRows: 0, maxRows: 1000, expectZero: null },
  'forensics-perm-hidden-settings-audit': { minRows: 0, maxRows: 2000, expectZero: null },
}

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.stack}`)
    process.exitCode = 1
  }
}

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'scan2-forensics-'))
const TEMPLATE = path.join(SCRATCH, 'migrated.sqlite')
const opened = []

function buildTemplate() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  db.exec(`VACUUM INTO '${TEMPLATE.replace(/'/g, "''")}'`)
  db.close()
}

// A private copy of the migrated schema, so no check sees another's fixtures.
function migratedDatabase() {
  const file = path.join(SCRATCH, `db-${opened.length + 1}.sqlite`)
  fs.copyFileSync(TEMPLATE, file)
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = OFF;')
  opened.push(db)
  return db
}

function insert(db, table, rows) {
  for (const row of [].concat(rows)) {
    const columns = Object.keys(row)
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`).run(row)
  }
}

const plain = (rows) => rows.map((row) => ({ ...row }))

async function main() {
  buildTemplate()
  const guard = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  const run = (db, name) => plain(db.prepare(guard.loadQuery(name).sql).all())

  await check('every N16 query passes the guard with its row rules and runs on the bare migrated schema', () => {
    const db = migratedDatabase()
    for (const [name, rules] of Object.entries(QUERY_RULES)) {
      const query = guard.loadQuery(name)
      assert.deepEqual(query.rules, rules, name)
      const rows = run(db, name)
      assert.equal(rows.length, rules.minRows, `${name} on an empty schema`)
      const columns = db.prepare(query.sql).columns().map((c) => c.name)
      assert.deepEqual(columns.filter((c) => PERSONAL_COLUMN.test(c)), [], `${name} returns a personal column`)
    }
  })

  await check('U11 lists active customer returns on a sale still owed, with the shift that holds them', () => {
    const db = migratedDatabase()
    insert(db, 'sales', [
      { id: 101, receipt_number: 'R101', sale_status: 'partial_return', status_before_return: 'awaiting_payment', total_usd: 10, amount_paid_usd: 2, amount_paid_khr: 4100, exchange_rate: 4100, created_at: '2026-09-20T02:00:00.000Z' },
      { id: 102, receipt_number: 'R102', sale_status: 'awaiting_payment', total_usd: 5, created_at: '2026-09-20T02:05:00.000Z' },
      { id: 103, receipt_number: 'R103', sale_status: 'partial_return', status_before_return: 'completed', total_usd: 5, amount_paid_usd: 5, created_at: '2026-09-20T02:10:00.000Z' },
      { id: 104, receipt_number: 'R104', sale_status: 'awaiting_payment', total_usd: 5, created_at: '2026-09-20T02:15:00.000Z' },
      { id: 106, receipt_number: 'R106', sale_status: 'completed', status_before_return: 'awaiting_payment', total_usd: 5, amount_paid_usd: 5, created_at: '2026-09-20T02:20:00.000Z' },
    ])
    insert(db, 'shift_sessions', [
      { id: 301, shift_code: 'S301', user_id: 7, branch_id: 1, business_date: '2026-09-20', opened_at: '2026-09-20T01:00:00.000Z', closed_at: '2026-09-20T09:00:00.000Z', closing_counted_usd: 0, scope_mode: 'per_account' },
      { id: 302, shift_code: 'S302', user_id: 8, branch_id: 1, business_date: '2026-09-20', opened_at: '2026-09-20T01:00:00.000Z', scope_mode: 'per_account' },
    ])
    insert(db, 'returns', [
      { id: 201, return_number: 'RT201', sale_id: 101, cashier_id: 7, branch_id: 1, total_refund_usd: 4, total_refund_khr: 16400, status: 'completed', return_scope: 'customer', created_at: '2026-09-20 03:00:00' },
      { id: 202, return_number: 'RT202', sale_id: 102, cashier_id: 7, branch_id: 1, total_refund_usd: 1, status: 'completed', created_at: '2026-09-20T10:00:00.000Z' },
      { id: 203, return_number: 'RT203', sale_id: 103, cashier_id: 7, branch_id: 1, total_refund_usd: 1, status: 'completed', created_at: '2026-09-20T03:10:00.000Z' },
      { id: 204, return_number: 'RT204', sale_id: 104, cashier_id: 7, branch_id: 1, total_refund_usd: 1, status: 'cancelled', created_at: '2026-09-20T03:15:00.000Z' },
      { id: 205, return_number: 'RT205', sale_id: 102, cashier_id: 7, branch_id: 1, return_scope: 'supplier', status: 'completed', created_at: '2026-09-20T03:20:00.000Z' },
      { id: 206, return_number: 'RT206', sale_id: 106, cashier_id: 7, branch_id: 1, total_refund_usd: 1, status: 'completed', created_at: '2026-09-20T03:25:00.000Z' },
    ])
    const rows = run(db, 'forensics-u11-return-on-not-paid-sale')
    assert.deepEqual(rows.map((r) => r.return_id), [201, 202])
    assert.deepEqual(rows.map((r) => r.shift_id), [301, null], 'a space timestamp inside the ISO window finds its shift; the other cashier\'s per-account shift is not it')
    assert.deepEqual([rows[0].sale_id, rows[0].total_refund_usd, rows[0].total_refund_khr, rows[0].sale_paid_usd, rows[0].sale_paid_khr], [101, 4, 16400, 2, 4100])
    insert(db, 'shift_sessions', { id: 303, shift_code: 'S303', user_id: 9, branch_id: 1, business_date: '2026-09-20', opened_at: '2026-09-20T09:30:00.000Z', scope_mode: 'shop_wide' })
    assert.deepEqual(run(db, 'forensics-u11-return-on-not-paid-sale').map((r) => r.shift_id), [301, 303], 'a shop-wide shift holds another cashier\'s return')
  })

  await check('U12 lists import stock adds onto products that predate the job, and marks reverted ones', () => {
    const db = migratedDatabase()
    insert(db, 'import_jobs', { id: 'job-a', type: 'products', status: 'completed', created_at: '2026-09-20 10:00:00' })
    insert(db, 'products', [
      { id: 11, name: 'Kept', created_at: '2026-09-01 08:00:00' },
      { id: 12, name: 'New in job', created_at: '2026-09-20 10:05:00' },
    ])
    insert(db, 'product_batches', [
      { id: 501, variant_product_id: 11, batch_key: 'k501', notes: 'Stock merged via product import' },
      { id: 502, variant_product_id: 11, batch_key: 'k502', notes: 'Stock added via product import (override)' },
      { id: 503, variant_product_id: 11, batch_key: 'k503', notes: 'Opening stock' },
    ])
    insert(db, 'inventory_movements', [
      { id: 601, product_id: 11, branch_id: 1, batch_id: 501, movement_type: 'add', quantity: 5, reason: 'Product import job-a, row 2', created_at: '2026-09-18' },
      { id: 602, product_id: 11, branch_id: 2, batch_id: 502, movement_type: 'add', quantity: 3, reason: 'Product import job-a, row 3', created_at: '2026-09-18' },
      { id: 603, product_id: 12, branch_id: 1, movement_type: 'add', quantity: 4, reason: 'Product import job-a, row 4', created_at: '2026-09-18' },
      { id: 604, product_id: 11, branch_id: 1, batch_id: 503, movement_type: 'add', quantity: 6, reason: 'Product import job-gone, row 7', created_at: '2026-09-10' },
      { id: 605, product_id: 11, branch_id: 1, movement_type: 'add', quantity: 9, reason: 'Stock in', created_at: '2026-09-18' },
      { id: 606, product_id: 11, branch_id: 1, movement_type: 'remove', quantity: 1, reason: 'Product import job-a, row 9', created_at: '2026-09-18' },
      { id: 607, product_id: 11, branch_id: 1, batch_id: 501, movement_type: 'remove', quantity: 5, reason: 'Revert of #601', reference_id: 'revert:601', created_at: '2026-09-21 09:00:00' },
    ])
    const rows = run(db, 'forensics-u12-import-merge-stock-adds')
    assert.deepEqual(rows.map((r) => r.movement_id), [601, 602, 604])
    const byId = Object.fromEntries(rows.map((r) => [r.movement_id, r]))
    assert.deepEqual([byId[601].job_id, byId[601].row_number, byId[601].job_status, byId[601].job_adds, byId[601].job_units], ['job-a', 2, 'completed', 2, 8])
    assert.deepEqual([byId[604].job_id, byId[604].job_status, byId[604].row_number], ['job-gone', null, 7])
    assert.deepEqual(rows.map((r) => r.lot_origin), ['merge', 'override', 'existing_lot'])
    assert.deepEqual(rows.map((r) => r.reverted), [1, 0, 0])
  })

  await check('U2 lists rates outside the band or off their Cambodia business day\'s usual rate, never legacy sales', () => {
    const db = migratedDatabase()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('exchange_rate', '4100')").run()
    const sale = (id, rate, createdAt, extra = {}) => ({ id, receipt_number: `R${id}`, exchange_rate: rate, created_at: createdAt, ...extra })
    insert(db, 'sales', [
      sale(1, 4100, '2026-09-10T02:00:00.000Z'), sale(2, 4100, '2026-09-10T03:00:00.000Z'),
      sale(3, 4100, '2026-09-10T04:00:00.000Z'), sale(4, 4100, '2026-09-10T05:00:00.000Z'),
      sale(5, 4400, '2026-09-10T06:00:00.000Z', { amount_paid_khr: 10000 }),
      sale(6, 1, '2026-09-10T07:00:00.000Z', { amount_paid_khr: 40 }),
      sale(7, 4150, '2026-09-10T08:00:00.000Z'),
      sale(8, 1, '2026-09-10T08:30:00.000Z', { legacy_receipt_number: '000001@2026-09-10' }),
      sale(9, 3800, '2026-09-10T18:00:00.000Z'), sale(10, 3800, '2026-09-11T02:00:00.000Z'), sale(11, 3800, '2026-09-11T03:00:00.000Z'),
      sale(12, 4100, '2026-09-12T02:00:00.000Z'), sale(13, 3850, '2026-09-12T03:00:00.000Z'),
    ])
    const rows = run(db, 'forensics-u2-sale-rate-outliers')
    assert.deepEqual(rows.map((r) => [r.sale_id, r.reason, r.riel_tender]), [[5, 'off_day_mode', 1], [6, 'outside_band', 1], [13, 'off_day_mode', 0]])
    const five = rows.find((r) => r.sale_id === 5)
    assert.deepEqual([five.business_date, five.day_mode_rate, five.day_sales, five.settings_rate_now], ['2026-09-10', 4100, 7, 4100])
  })

  await check('PP-1 counts last-day lines rung at full price after 00:00 UTC, per rule and per product discount', () => {
    const db = migratedDatabase()
    insert(db, 'promotion_rules', [
      { id: 1, title: 'Hair 10%', rule_type: 'percent_off', percent_off: 10, scope_type: 'products', product_ids: '[21]', starts_at: '2026-09-01', ends_at: '2026-09-15' },
      { id: 2, title: 'Soap', rule_type: 'percent_off', percent_off: 5, scope_type: 'category', category: 'Soap', product_ids: '[]', ends_at: '2026-09-16' },
      { id: 3, title: 'Timed end', rule_type: 'percent_off', percent_off: 5, scope_type: 'products', product_ids: '[21]', ends_at: '2026-09-15 23:59:59' },
      { id: 4, title: 'Never started', rule_type: 'percent_off', percent_off: 5, scope_type: 'products', product_ids: '[22]', starts_at: '2026-09-20', ends_at: '2026-09-15' },
    ])
    insert(db, 'products', [
      { id: 21, name: 'Shampoo', category: 'Hair' },
      { id: 22, name: 'Comb' },
      { id: 23, name: 'Bar', category: 'Soap' },
      { id: 24, name: 'Wash', category: 'Care', categories: 'Care || soap' },
      { id: 25, name: 'Cream', discount_enabled: 1, discount_percent: 5, discount_ends_at: '2026-09-17' },
      { id: 26, name: 'Lotion', discount_enabled: 1, discount_percent: 0, discount_ends_at: '2026-09-17' },
    ])
    const sale = (id, createdAt, extra = {}) => ({ id, receipt_number: `R${id}`, created_at: createdAt, ...extra })
    insert(db, 'sales', [
      sale(1, '2026-09-15T02:00:00.000Z'), sale(2, '2026-09-14T18:00:00.000Z'), sale(3, '2026-09-15T05:00:00.000Z'),
      sale(4, '2026-09-15T06:00:00.000Z'), sale(5, '2026-09-15T16:59:00.000Z'), sale(6, '2026-09-15T17:30:00.000Z'),
      sale(7, '2026-09-16T04:00:00.000Z'), sale(8, '2026-09-15T03:00:00.000Z', { sale_status: 'cancelled' }),
      sale(9, '2026-09-15T03:00:00.000Z', { legacy_receipt_number: '000009@2026-09-15' }), sale(10, '2026-09-17T03:00:00.000Z'),
      sale(11, '2026-09-15T04:00:00.000Z'),
    ])
    const line = (id, saleId, productId, extra = {}) => ({ id, sale_id: saleId, product_id: productId, quantity: 1, total_usd: 2.5, ...extra })
    insert(db, 'sale_items', [
      line(1, 1, 21), line(2, 2, 21), line(3, 3, 21, { product_discount_usd: 0.25 }), line(4, 4, 21, { price_mode: 'wholesale' }),
      line(5, 5, 21, { quantity: 2, total_usd: 5 }), line(6, 6, 21), line(7, 7, 23), line(8, 7, 24), line(9, 7, 21),
      line(10, 8, 21), line(11, 9, 21), line(12, 10, 25), line(13, 10, 26), line(14, 11, 22),
    ])
    const rows = run(db, 'forensics-pp1-last-day-promo-miss')
    assert.deepEqual(rows.map((r) => [r.source, r.rule_id, r.product_id, r.last_day, r.lines, r.units, r.lines_total_usd, r.sales]), [
      ['product_discount', null, 25, '2026-09-17', 1, 1, 2.5, 1],
      ['rule', 1, null, '2026-09-15', 2, 3, 7.5, 2],
      ['rule', 2, null, '2026-09-16', 2, 2, 5, 1],
    ])
  })

  await check('PP-2 lists every discount date that is not a plain YYYY-MM-DD, by shape', () => {
    const db = migratedDatabase()
    const product = (id, starts, ends) => ({ id, name: `P${id}`, discount_starts_at: starts, discount_ends_at: ends })
    insert(db, 'products', [
      product(31, null, '2026-10-05'), product(32, null, '05/10/2026'), product(33, null, '45930'),
      product(34, null, '2026-02-30'), product(35, '2026-10-01T00:00:00Z', null), product(36, '  ', ''),
      product(37, null, null), product(38, null, 'now'), product(39, ' 2026-10-01 ', '2026-10-09'),
    ])
    const rows = run(db, 'forensics-pp2-discount-date-shape')
    assert.deepEqual(rows.map((r) => [r.product_id, r.field, r.shape, r.stored_value]), [
      [32, 'discount_ends_at', 'unparseable', '05/10/2026'],
      [33, 'discount_ends_at', 'not_iso_date', '45930'],
      [34, 'discount_ends_at', 'impossible_date', '2026-02-30'],
      [35, 'discount_starts_at', 'date_with_time', '2026-10-01T00:00:00Z'],
      [38, 'discount_ends_at', 'not_iso_date', 'now'],
    ])
  })

  await check('PP-5 / PP-12 count the active rules that stop checkout and the rules cut at 200 products', () => {
    const db = migratedDatabase()
    const ids = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => i + 1))
    const rule = (id, extra) => ({ id, title: `Rule ${id}`, product_ids: '[1]', ...extra })
    insert(db, 'promotion_rules', [
      rule(41, { min_quantity: 20000 }), rule(42, { percent_off: 150 }), rule(43, { product_ids: ids(10001) }),
      rule(44, { min_quantity: 20000, is_active: 0 }), rule(45, { product_ids: 'not json', is_active: 0 }),
      rule(46, { product_ids: ids(200), is_active: 0 }), rule(47, { percent_off: 10 }), rule(48, { min_quantity: 10000 }),
    ])
    const [row] = run(db, 'promo-rule-capture-risk')
    assert.deepEqual({ ...row }, {
      active_rules: 5,
      min_quantity_over_limit: 1, min_quantity_over_limit_ids: '41',
      percent_over_100: 1, percent_over_100_ids: '42',
      product_ids_over_limit: 1, product_ids_over_limit_ids: '43',
      product_ids_not_json: 1, product_ids_not_json_ids: '45',
      exactly_200_products: 1, exactly_200_products_ids: '46',
    })
  })

  await check('PP-3 lists strip links and pictures the storefront must not follow', () => {
    const db = migratedDatabase()
    const promo = (id, extra) => ({ id, title: `Strip ${id}`, ...extra })
    insert(db, 'promotions', [
      promo(51, { link_type: 'url', link_url: 'javascript:alert(1)' }), promo(52, { link_type: 'url', link_url: '//evil.example' }),
      promo(53, { link_type: 'url', link_url: '/products/1' }), promo(54, { link_type: 'url', link_url: 'https://ok.example' }),
      promo(55, { link_type: 'url', link_url: '/\\evil.example' }), promo(56, { image_path: 'data:image/png;base64,xx' }),
      promo(57, { image_path: '//cdn.example/x.png' }), promo(58, { image_path: '/uploads/x.png' }),
      promo(59, { image_path: 'https://cdn.example/a:b.png' }), promo(60, { image_path: 'uploads/a:b.png' }),
      promo(61, { link_type: 'url', link_url: 'HTTPS://OK.EXAMPLE' }), promo(62, { link_type: 'url', link_url: '/%2F%2Fevil.example' }),
    ])
    const rows = run(db, 'forensics-pp3-strip-link-shape')
    assert.deepEqual(rows.map((r) => [r.promotion_id, r.field, r.reason]), [
      [51, 'link_url', 'not_http_or_site_path'], [52, 'link_url', 'protocol_relative'], [55, 'link_url', 'backslash'],
      [56, 'image_path', 'non_http_scheme'], [57, 'image_path', 'protocol_relative'], [62, 'link_url', 'encoded_second_slash'],
    ])
  })

  await check('PP-10 lists redemptions whose discount is not whole units x the redeem value', () => {
    const db = migratedDatabase()
    insert(db, 'sales', [
      { id: 71, receipt_number: 'R71', membership_points_redeemed: 200, membership_discount_usd: 2 },
      { id: 72, receipt_number: 'R72', membership_points_redeemed: 200, membership_discount_usd: 5 },
      { id: 73, receipt_number: 'R73', membership_points_redeemed: 200, membership_discount_usd: 1 },
      { id: 74, receipt_number: 'R74', membership_points_redeemed: 250, membership_discount_usd: 2 },
      { id: 75, receipt_number: 'R75', membership_points_redeemed: 0, membership_discount_usd: 3 },
      { id: 76, receipt_number: 'R76', membership_points_redeemed: 200, membership_discount_usd: 2.004 },
    ])
    const classes = () => run(db, 'forensics-pp10-membership-discount-mismatch').map((r) => [r.sale_id, r.class, r.expected_discount_usd])
    assert.deepEqual(classes(), [[72, 'over_value', 2], [73, 'under_value', 2], [74, 'partial_units', 2]], 'absent settings read as 100 points = $1')
    insert(db, 'settings', [{ key: 'customer_portal_redeem_points', value: '50' }, { key: 'customer_portal_redeem_value_usd', value: '2.5' }])
    assert.deepEqual(classes(), [[71, 'under_value', 12], [72, 'under_value', 12], [73, 'under_value', 12], [74, 'under_value', 15], [76, 'under_value', 12]],
      '50 points = $3 (2.5 rounds up), as routes/portal.ts reads them')
  })

  await check('BP-13 / BP-10 / BP-7 / BP-12 list hidden-setting writes, delete bursts and the variant gap by non-admins only', () => {
    const db = migratedDatabase()
    insert(db, 'roles', [
      { id: 1, name: 'Admin', code: 'admin', permissions: '{}' },
      { id: 2, name: 'Manager', code: 'manager', permissions: JSON.stringify({ settings: true, products: true, 'products:bulk_delete': false, 'products:add': false }) },
      { id: 3, name: 'Employee', code: 'employee', permissions: JSON.stringify({ products: true }) },
    ])
    const user = (id, roleId, extra = {}) => ({ id, username: `u${id}`, name: `User ${id}`, password: 'x', role_id: roleId, ...extra })
    insert(db, 'users', [
      user(81, 1), user(82, 2), user(83, 3, { permissions: JSON.stringify({ all: true }) }),
      user(84, 3, { permissions: JSON.stringify({ 'products:add': false }) }),
      user(85, 2, { is_active: 0, deleted_at: '2026-09-01 00:00:00' }), user(86, 3, { permissions: '{bad json' }),
    ])
    const log = (id, userId, extra) => ({ id, user_id: userId, action: 'update', entity: 'settings', created_at: '2026-09-20 09:00:00', ...extra })
    insert(db, 'audit_logs', [
      log(1, 82, { new_value: JSON.stringify({ exchange_rate: '4000', receipt_footer: 'x' }) }),
      log(2, 81, { new_value: JSON.stringify({ tax_rate: '10' }) }),
      log(3, 83, { new_value: JSON.stringify({ exchange_rate: '1' }) }),
      log(4, 82, { new_value: JSON.stringify({ telegram_daily_summary: '0' }) }),
      log(5, null, { new_value: JSON.stringify({ telegram_topic_sales: '12' }) }),
      log(6, 82, { action: 'replace', entity: 'payment_method', entity_id: 'op-1', new_value: JSON.stringify({ configured_methods: ['Cash'] }) }),
      log(7, 82, { new_value: null }),
      log(8, 82, { new_value: JSON.stringify({ receipt_footer: 'y' }) }),
      log(9, 86, { new_value: JSON.stringify({ exchange_rate: '4050' }) }),
    ])
    const deletes = (firstId, userId, minute, count) => Array.from({ length: count }, (_, i) => ({
      id: firstId + i, user_id: userId, action: 'delete', entity: 'product', entity_id: String(900 + firstId + i), created_at: `${minute}:${String(10 + i).padStart(2, '0')}`,
    }))
    insert(db, 'audit_logs', [...deletes(20, 82, '2026-09-20 10:00', 5), ...deletes(30, 84, '2026-09-20 10:00', 5), ...deletes(40, 82, '2026-09-20 11:00', 4)])
    const rows = run(db, 'forensics-perm-hidden-settings-audit')
    assert.deepEqual(rows.map((r) => [r.kind, r.actor_user_id, r.role_code, r.detail, r.events]), [
      ['product_delete_burst', 82, 'manager', '2026-09-20 10:00', 5],
      ['settings_sales_policy', 82, 'manager', 'exchange_rate', 1],
      ['settings_sales_policy', 82, 'manager', 'pos_payment_methods', 1],
      ['settings_sales_policy', 86, 'employee', 'exchange_rate', 1],
      ['settings_telegram', 82, 'manager', 'telegram_daily_summary', 1],
      ['variant_add_exposure', 82, 'manager', 'products:add', null],
      ['variant_add_exposure', 84, 'employee', 'products:add', null],
    ])
    const burst = rows[0]
    assert.deepEqual([burst.first_audit_id, burst.last_audit_id], [20, 24])
  })

  for (const db of opened) db.close()
  fs.rmSync(SCRATCH, { recursive: true, force: true })
  if (process.exitCode) console.error(`test-scan2-forensics-queries-native: FAILED (${passed} passed)`)
  else console.log(`test-scan2-forensics-queries-native: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(`test-scan2-forensics-queries-native: crashed: ${err && err.stack}`)
  process.exitCode = 1
})
