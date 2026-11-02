'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { createHash } = require('node:crypto'), { createRequire } = require('node:module')
assert.equal(process.argv.length, 2, 'This regression loads the current checkout; no arguments are supported')
const cf = path.resolve(__dirname, '..'), root = path.resolve(cf, '..'), ANALYTICS = 'cloudflare/src/lib/salesAnalytics.ts'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n')
const workerFile = path.join(__dirname, 'harness/dashboard-full-read-worker.ts'), workerBytes = fs.readFileSync(workerFile), worker = decode(workerBytes)
const sources = new Map(), missing = new Set(), bindings = {}, observationHashes = [], setup = [], checks = [], cases = []
const local = createRequire(path.join(cf, 'package.json')), { build } = local('esbuild'), { Miniflare, Log, LogLevel } = local('miniflare'), { unstable_splitSqlQuery: splitSql } = local('wrangler')
const exportsOnly = '\nexport {readSalesReportAtomicTotalsSnapshot as __fullAtomic,salesPeriodRowsFromSnapshot as __fullPeriod,reportRestoreValuesActive as __flagsActive};\n'
function shown(relative) {
  if (missing.has(relative)) return null
  if (!sources.has(relative)) {
    const file = path.resolve(root, relative)
    if (!file.startsWith(cf + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { missing.add(relative); return null }
    const bytes = fs.readFileSync(file), text = decode(bytes); sources.set(relative, { file, bytes, text }); bindings[relative] = { raw: sha(bytes), lf: sha(Buffer.from(text)) }
  }
  return sources.get(relative).text
}
const plugin = { name: 'one-current-checkout-graph-exports-only', setup(builder) {
  builder.onResolve({ filter: /^current:(analytics|money|schema|switches)$/ }, args => ({ path: { 'current:analytics': 'src/lib/salesAnalytics', 'current:money': 'src/lib/reportMoneyPrecision', 'current:schema': 'src/lib/schemaProbe', 'current:switches': 'src/lib/readSwitches' }[args.path], namespace: 'checkout' }))
  builder.onResolve({ filter: /^\.\.?\//, namespace: 'checkout' }, args => ({ path: path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path)), namespace: 'checkout' }))
  builder.onLoad({ filter: /.*/, namespace: 'checkout' }, args => {
    for (const suffix of ['.ts', '/index.ts', '.json', '']) {
      const relative = 'cloudflare/' + args.path + suffix, text = shown(relative)
      if (text === null) continue
      return { contents: text + (relative === ANALYTICS ? exportsOnly : ''), loader: relative.endsWith('.json') ? 'json' : 'ts', resolveDir: cf }
    }
    throw new Error('Missing current source ' + args.path)
  })
} }
let lastStage = { stage: 'start' }, bundleSha256, triggerCount
function life(stage, extra = {}) { lastStage = { stage, ...extra } }
function metrics(calls) {
  const results = calls.flatMap(call => call.results ?? []), unknown = calls.reduce((sum, call) => sum + (call.unknown_metadata ?? 0), 0)
  const total = key => unknown || results.some(row => typeof row.meta?.[key] !== 'number') ? null : results.reduce((sum, row) => sum + row.meta[key], 0)
  return { physical_calls: calls.length, statements: calls.reduce((sum, call) => sum + call.arity, 0), failed_calls: calls.filter(call => call.error).length,
    unknown_statement_metadata: unknown, rows_read: total('rows_read'), rows_written: total('rows_written'), result_array_utf8_proxy: unknown || results.some(row => row.result_array_utf8_bytes === null) ? null : results.reduce((sum, row) => sum + row.result_array_utf8_bytes, 0), atomic_main_batches: calls.filter(call => call.phase === 'atomic-main').length }
}
function financial(snapshotResult, fixture) {
  assert.equal(snapshotResult.kind, 'snapshot', JSON.stringify(snapshotResult.error))
  const { snapshot, views } = snapshotResult
  assert.equal(snapshot.sales.length, 1); assert.equal(snapshot.items.length, fixture.items)
  for (const group of ['voidSales', 'returns', 'returnItems', 'deliveryFees']) assert.equal(snapshot[group].length, 0)
  assert.equal(snapshot.row_count, fixture.items + 1); assert.equal(snapshot.precision_mode, 'exact_recorded')
  assert.equal(snapshot.sales[0].money_precision_version, 0); assert.equal(snapshot.sales[0].sale_status, 'completed')
  assert.equal(snapshot.sales[0].customer_name, fixture.customer); assert.equal(snapshot.sales[0].receipt_number, 'PRIVATE-LEGACY-FULL')
  for (let index = 0; index < snapshot.items.length; index++) {
    const item = snapshot.items[index]; assert.equal(item.id, index + 1); assert.equal(item.sale_id, 1); assert.equal(item.product_name, fixture.product)
    assert.equal(item.quantity, 1); assert.equal(item.total_usd, 1); assert.equal(item.cost_price_usd, 1)
  }
  for (const [key, expected] of Object.entries({ tx_count: 1, gross_sales_usd: fixture.items, net_sales_usd: fixture.items, revenue_usd: fixture.items, collected_total_usd: fixture.items, cost_usd: fixture.items, profit_usd: 0, pending_tx_count: 0, cancelled_tx_count: 0, cost_known_lines: fixture.items, cost_missing_snapshot_lines: 0 })) assert.equal(views.totals[key], expected, key)
  assert.ok(views.diagnostic); assert.equal(views.diagnostic.precision_mode, 'exact_recorded'); assert.equal(views.diagnostic.complete, true); assert.equal(views.diagnostic.unknown_cost_lines, 0); assert.equal(views.diagnostic.contributing_rows, fixture.items + 1)
  assert.equal(views.periodSeries.length, 1); assert.equal(views.periodSeries[0].tx_count, 1); assert.equal(views.periodSeries[0].revenue_usd, fixture.items)
  assert.equal(views.byPayment.length, 1); assert.equal(views.byPayment[0].count, 1); assert.equal(views.byPayment[0].revenue_usd, fixture.items)
  assert.equal(views.byBranch.length, 1); assert.equal(views.byBranch[0].tx_count, 1); assert.equal(views.byBranch[0].revenue_usd, fixture.items)
  assert.equal(views.topProducts.length, 1); assert.equal(views.topProducts[0].product_name, fixture.product); assert.equal(views.topProducts[0].revenue_usd, fixture.items)
  assert.equal(views.topProductsQty.length, 1); assert.equal(views.topProductsQty[0].qty_sold, fixture.items)
  return snapshot
}
const detailPhases = ['legacy-sales', 'legacy-voidSales', 'legacy-items', 'legacy-returns', 'legacy-returnItems']
function noUnexpectedErrors(value, expectedFailure) {
  for (const call of value.calls) {
    assert.ok(Number.isSafeInteger(call.started_order) && Number.isSafeInteger(call.completed_order))
    if (call === expectedFailure) continue
    assert.equal(call.error, undefined); assert.equal(call.observer_error, undefined); assert.equal(call.unknown_metadata ?? 0, 0)
    assert.equal(call.results.length, call.arity); assert.ok(call.results.every(row => row.success === true && typeof row.meta?.rows_read === 'number' && row.meta?.rows_written === 0))
  }
}
function ownFlagsFailure(call, arity) {
  assert.equal(call.operation, 'batch'); assert.equal(call.arity, arity); assert.equal(call.results, undefined)
  assert.match(call.error, /bad JSON path|JSON path error/i); assert.ok(call.error.includes('report_flags_bytes')); assert.equal(call.unknown_metadata, arity)
  assert.ok(!call.error.includes('report_totals_'))
}
function postLedger(record, active) {
  const value = record.value, mains = value.calls.filter(call => call.phase === 'atomic-main'), prefixes = value.calls.filter(call => call.phase === 'flags-prefetch'), posts = value.calls.filter(call => call.phase === 'flags-post')
  assert.equal(mains.length, 1); assert.equal(prefixes.length, 1); assert.equal(posts.length, 1)
  const main = mains[0], post = posts[0]
  assert.equal(main.arity, 7); assert.ok(main.results.every(row => row.success === true)); assert.equal(main.control_rows[0][0].allowed, 1); assert.equal(main.control_rows[1][0].allowed, 1); assert.equal(main.control_rows[1][0].data_rows, 19)
  assert.deepEqual(main.detail_groups.map(group => group.rows), [1, 0, 18, 0, 0]); assert.deepEqual(main.detail_groups[2].ids, Array.from({ length: 18 }, (_, index) => index + 1)); assert.ok(main.detail_groups[2].columns.includes('product_name'))
  assert.equal(prefixes[0].error, undefined); assert.equal(prefixes[0].arity, 3)
  ownFlagsFailure(post, 2); noUnexpectedErrors(value, post)
  const budgets = [...post.sqls[0].matchAll(/>\s*(\d+)\s+OR\s+\(/g)].map(match => Number(match[1])); assert.equal(budgets.length, 1); assert.ok(budgets[0] > 0 && budgets[0] < 18000283)
  const writer = value.writer_calls; assert.equal(writer.length, 3); assert.deepEqual(writer.map(call => call.stage), ['witness-before', 'write', 'witness-after']); assert.deepEqual(writer.map(call => call.arity), [2, 3, 2])
  for (const call of writer) { assert.equal(call.error, undefined); assert.equal(call.unknown_metadata ?? 0, 0); assert.ok(call.results.every(row => row.success === true && typeof row.meta?.rows_read === 'number' && typeof row.meta?.rows_written === 'number')) }
  assert.ok(main.native_completed_order < writer[0].started_order && writer[0].completed_order < writer[1].started_order && writer[1].completed_order < writer[2].started_order && writer[2].completed_order < main.completed_order && main.completed_order < post.started_order)
  assert.deepEqual(writer[0].witness_rows[1].map(row => [row.key, row.storage_type, row.byte_length, row.matches]), [['maintenance', 'text', 0, 1], ['maintenance_mode', 'text', 0, 1]])
  assert.deepEqual(writer[2].witness_rows[1].map(row => [row.key, row.storage_type, row.byte_length, row.matches]), [['maintenance', 'text', 1500000, 1], ['maintenance_mode', 'text', 1500000, 1]])
  assert.equal(writer[0].witness_rows[0][0].n, 0); assert.equal(writer[2].witness_rows[0][0].n, 0)
  const core = active ? JSON.stringify({ mode: 'restore' }) : '', expectedPayload = core + ' '.repeat(1500000 - core.length)
  assert.deepEqual(writer[1].bindings[1], [{ type: 'string', utf8_bytes: 1500000, sha256: sha(expectedPayload) }]); assert.deepEqual(writer[2].bindings[1], writer[1].bindings[1])
  const restores = value.calls.filter(call => call.phase === 'legacy-restore' && call.started_order > post.completed_order), details = value.calls.filter(call => detailPhases.includes(call.phase))
  assert.equal(restores.length, active ? 1 : 3); assert.ok(restores.every(call => call.restore_observation.active === active && call.restore_observation.rows.length === 2 && call.restore_observation.rows.every(row => row.type === 'string' && row.utf8_bytes === 1500000)))
  assert.ok(restores[0].started_order > post.completed_order)
  if (active) { assert.equal(value.kind, 'refusal'); assert.equal(value.error.code, 'maintenance_restore'); assert.equal(value.error.status, 409); assert.equal(details.length, 0) }
  else {
    assert.equal(details.length, 10); assert.deepEqual(details.map(call => call.phase), [...detailPhases, ...detailPhases])
    assert.ok(restores[0].completed_order < details[0].started_order && details[4].completed_order < restores[1].started_order && restores[1].completed_order < details[5].started_order && details[9].completed_order < restores[2].started_order)
  }
  return { post_payload_budget: budgets[0], modeled_new_payload: 18000283, discarded_main_detail_rows: 19, fallback_restore_reads: restores.length, fallback_detail_reads: details.length }
}
function prefixLedger(record, candidate) {
  const value = record.value, prefix = value.calls.filter(call => call.phase === 'flags-prefetch'), restore = value.calls.filter(call => call.phase === 'legacy-restore')
  assert.equal(value.kind, 'refusal'); assert.equal(value.error.code, 'maintenance_restore'); assert.equal(value.error.status, 409)
  assert.equal(value.calls.filter(call => call.phase === 'atomic-main' || call.phase === 'flags-post' || detailPhases.includes(call.phase)).length, 0); assert.equal(value.writer_calls.length, 0); assert.equal(restore.length, 1); assert.equal(restore[0].restore_observation.active, true)
  assert.equal(prefix.length, candidate ? 1 : 0)
  if (candidate) { ownFlagsFailure(prefix[0], 3); assert.ok(prefix[0].completed_order < restore[0].started_order) }
  noUnexpectedErrors(value, candidate ? prefix[0] : undefined)
}
function combinedParity(record, authority) {
  assert.equal(record.value.kind, 'combined', JSON.stringify(record.value.error)); assert.ok(record.value.diagnostic)
  assert.deepEqual(record.value.diagnostic, authority.value.views.diagnostic)
  for (const [key, value] of Object.entries(authority.value.views.totals)) assert.deepEqual(record.value.value.totals[key], value, 'base total ' + key)
  for (const key of ['periodSeries', 'byPayment', 'byBranch', 'topCustomers', 'hourlyDist', 'topProducts', 'topProductsQty']) assert.deepEqual(record.value.value[key], authority.value.views[key], key)
}
function fallbackReads(value, failure, restoresExpected) {
  const after = value.calls.filter(call => call.started_order > failure.completed_order), restores = after.filter(call => call.phase === 'legacy-restore'), details = after.filter(call => detailPhases.includes(call.phase))
  assert.equal(restores.length, restoresExpected); assert.ok(restores.every(call => call.restore_observation.active === false))
  assert.equal(details.length, 10); assert.deepEqual(details.map(call => call.phase), [...detailPhases, ...detailPhases])
  if (restoresExpected === 3) assert.ok(restores[0].completed_order < details[0].started_order)
  assert.ok(details[4].completed_order < restores[restoresExpected - 2].started_order && restores[restoresExpected - 2].completed_order < details[5].started_order && details[9].completed_order < restores[restoresExpected - 1].started_order)
  noUnexpectedErrors(value, failure)
}
function mainMiss(record, poisoned) {
  const value = record.value, main = value.calls.filter(call => call.phase === 'atomic-main')
  assert.equal(main.length, 1); assert.equal(main[0].arity, poisoned ? 8 : 7); assert.equal(main[0].original_arity, 7)
  assert.match(main[0].error, /bad JSON path|JSON path error/i); assert.ok(main[0].error.includes('report_totals_bytes')); assert.ok(!main[0].error.includes('__dashboard_full_detail_poison')); assert.equal(main[0].unknown_metadata, main[0].arity); assert.equal(main[0].results, undefined)
  assert.equal(main[0].instrumentation.length, poisoned ? 1 : 0); assert.equal(value.calls.filter(call => call.phase === 'flags-post').length, 0)
  fallbackReads(value, main[0], 2)
  assert.ok(value.calls.filter(call => call.phase === 'legacy-restore').every(call => call.restore_observation.rows.length === 2 && call.restore_observation.rows.every(row => row.type === 'string' && row.utf8_bytes === 0)))
}
function inactivePrefix(record) {
  const value = record.value, prefix = value.calls.filter(call => call.phase === 'flags-prefetch')
  assert.equal(prefix.length, 1); ownFlagsFailure(prefix[0], 3); assert.equal(value.calls.filter(call => call.phase === 'atomic-main' || call.phase === 'flags-post').length, 0)
  fallbackReads(value, prefix[0], 3)
  assert.ok(value.calls.filter(call => call.phase === 'legacy-restore').every(call => JSON.stringify(call.restore_observation.rows.map(row => [row.type, row.utf8_bytes])) === JSON.stringify([['string', 0], ['string', 1700000]])))
}
let mf, final, sequence = 0
async function main() {
  life('bundle-before')
  const bundle = (await build({ stdin: { contents: worker, resolveDir: cf, loader: 'ts', sourcefile: 'dashboard-full-read-worker.ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], plugins: [plugin], logLevel: 'error' })).outputFiles[0].text
  bundleSha256 = sha(bundle); assert.ok(bindings[ANALYTICS], 'The actual current analytics module must be loaded'); life('bundle-after')
  const migrations = fs.readdirSync(path.join(cf, 'migrations')).filter(name => name.endsWith('.sql')).sort().map(name => 'cloudflare/migrations/' + name)
  const migrationPlans = migrations.map(file => ({ file, sql: splitSql(shown(file)).filter(sql => sql.trim()) }))
  life('native-open-before')
  mf = new Miniflare({ modules: true, script: bundle, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], host: '127.0.0.1', port: 0, d1Databases: ['DB'], d1Persist: false, cachePersist: false, outboundService: () => new Response('No external network', { status: 503 }), log: new Log(LogLevel.ERROR) })
  await mf.ready; const raw = await mf.getD1Database('DB')
  for (const migration of migrationPlans) {
    const skipAliases = path.basename(migration.file) === '0098_user_aliases.sql'
    if (skipAliases) { const before = await raw.prepare('SELECT COUNT(*) AS n FROM users').all(); assert.equal(before.results[0].n, 0); setup.push({ kind: 'alias-seed-before', result: before }) }
    const sqls = migration.sql.filter(sql => !(skipAliases && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())))
    for (let offset = 0; offset < sqls.length; offset += 100) {
      const chosen = sqls.slice(offset, offset + 100); life('migration-batch-before', { file: migration.file, offset, statements: chosen.length, sql_sha256: sha(JSON.stringify(chosen)) })
      const result = await raw.batch(chosen.map(sql => raw.prepare(sql))); assert.ok(result.every(row => row.success === true)); setup.push({ file: migration.file, offset, results: result.map(row => ({ success: row.success, meta: row.meta })) }); life('migration-batch-after', { file: migration.file, offset })
    }
    if (skipAliases) { const after = await raw.prepare('SELECT COUNT(*) AS n FROM user_aliases').all(); assert.equal(after.results[0].n, 0); setup.push({ kind: 'alias-seed-after', result: after }) }
  }
  const initial = await raw.batch(['sales', 'sale_items', 'returns', 'return_items'].map(table => raw.prepare('SELECT COUNT(*) AS n FROM ' + table)))
  assert.ok(initial.every(row => row.results[0].n === 0)); setup.push({ kind: 'initial-business-counts', result: initial })
  const triggersBefore = await raw.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(); triggerCount = triggersBefore.results.length; assert.ok(triggerCount > 0)
  const permit = async (label, queries) => {
    const before = await raw.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'").all(); assert.equal(before.results[0].n, 0)
    life('owned-write-before', { label, statements: queries.length })
    const result = await raw.batch([raw.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"), ...queries.map(({ sql, values = [] }) => raw.prepare(sql).bind(...values)), raw.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'")])
    assert.ok(result.every(row => row.success === true)); const after = await raw.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'").all(); assert.equal(after.results[0].n, 0)
    setup.push({ label, before, queries: queries.map(query => ({ sql: query.sql, bindings: (query.values ?? []).map(value => typeof value === 'string' ? { type: 'string', bytes: Buffer.byteLength(value), sha256: sha(value) } : value) })), result, after }); life('owned-write-after', { label })
  }
  await permit('branch', [{ sql: "INSERT OR IGNORE INTO branches(id,name,is_default,is_active) VALUES(1,'Private legacy fixture',1,1)" }])
  await permit('read-switch', [{ sql: "INSERT INTO system_flags(key,value) VALUES('read_switches',?)", values: [JSON.stringify({ epoch: 1, switches: { report_atomic: 'on' } })] }])
  const invoke = async (input, label) => {
    life('request-before', { label, input }); const response = await mf.dispatchFetch('http://fixture.test/run', { method: 'POST', body: JSON.stringify(input) }), text = await response.text(), value = JSON.parse(text)
    const record = { input, transport_status: response.status, response_utf8_bytes: Buffer.byteLength(text), metrics: metrics(value.calls ?? []), external_writer_metrics: metrics((value.writer_calls ?? []).filter(call => call.stage === 'write')), external_writer_witness_metrics: metrics((value.writer_calls ?? []).filter(call => call.stage !== 'write')), value }
    sequence++; observationHashes.push({ sequence, label, input, response_status: response.status, body_sha256: sha(text), app: record.metrics, external_writer: record.external_writer_metrics, external_witnesses: record.external_writer_witness_metrics }); life('request-after', { label, transport_status: response.status, kind: value.kind, marker: value.error?.marker ?? null })
    assert.equal(response.status, 200, text); assert.equal(value.ok, true, text)
    // Every public reader pays the report_atomic switch read once on a cold isolate (in-flight readers share it); the direct atomic entry pays none.
    assert.equal(value.switch_reads.length, input.mode === 'atomic-full-snapshot' ? 0 : 1, label + ': switch reads')
    return record
  }
  const setFlags = async (label, primary, secondary = primary) => {
    await permit('flags-' + label, [{ sql: "UPDATE system_flags SET value=CASE key WHEN 'maintenance' THEN ? ELSE ? END WHERE key IN ('maintenance','maintenance_mode')", values: [primary, secondary] }])
    const result = await raw.batch([raw.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'"), raw.prepare("SELECT key,typeof(value) AS storage_type,length(CAST(value AS BLOB)) AS byte_length,CAST(value AS BLOB) IS CAST(CASE key WHEN 'maintenance' THEN ? ELSE ? END AS BLOB) AS matches FROM system_flags WHERE key IN ('maintenance','maintenance_mode') ORDER BY key").bind(primary, secondary)])
    assert.ok(result.every(row => row.success === true)); assert.equal(result[0].results[0].n, 0); assert.deepEqual(result[1].results.map(row => [row.key, row.storage_type, row.byte_length, row.matches]), [['maintenance', 'text', Buffer.byteLength(primary), 1], ['maintenance_mode', 'text', Buffer.byteLength(secondary), 1]])
    setup.push({ label: 'flag-witness-' + label, physical_calls: 1, statements: 2, expected_hashes: [sha(primary), sha(secondary)], result })
  }
  const seed = async fixture => {
    await permit('clear-recognized-flags-before-business', [{ sql: "DELETE FROM system_flags WHERE key IN ('maintenance','maintenance_mode')" }])
    await permit('business-' + fixture.name, [{ sql: 'DELETE FROM sale_items WHERE sale_id=1' }, { sql: 'DELETE FROM sales WHERE id=1' },
      { sql: "INSERT INTO sales(id,receipt_number,created_at,sale_status,branch_id,branch_name,customer_name,payment_method,payment_currency,subtotal_usd,total_usd,total_khr,amount_paid_usd,amount_paid_khr,exchange_rate,discount_usd,membership_discount_usd,tax_usd,delivery_fee_usd,is_delivery,money_precision_version) VALUES(1,'PRIVATE-LEGACY-FULL','2026-10-27 05:00:00','completed',1,'Private legacy fixture',?,'Cash','USD',?,?,?, ?,0,4000,0,0,0,0,0,0)", values: [fixture.customer, fixture.items, fixture.items, fixture.items * 4000, fixture.items] },
      ...Array.from({ length: fixture.items }, (_, index) => ({ sql: 'INSERT INTO sale_items(id,sale_id,product_id,product_name,branch_id,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,cost_price_usd,cost_price_khr,product_discount_usd,manual_discount_usd) VALUES(?,1,NULL,?,1,1,1,4000,1,4000,1,4000,0,0)', values: [index + 1, fixture.product] })),
    ])
    const storage = await raw.batch([raw.prepare('SELECT COUNT(*) AS n,MAX(length(CAST(customer_name AS BLOB))) AS name_bytes FROM sales'), raw.prepare('SELECT COUNT(*) AS n,MIN(length(CAST(product_name AS BLOB))) AS min_name_bytes,MAX(length(CAST(product_name AS BLOB))) AS max_name_bytes FROM sale_items')])
    assert.equal(storage[0].results[0].n, 1); assert.equal(storage[0].results[0].name_bytes, Buffer.byteLength(fixture.customer)); assert.equal(storage[1].results[0].n, fixture.items); assert.equal(storage[1].results[0].min_name_bytes, Buffer.byteLength(fixture.product)); assert.equal(storage[1].results[0].max_name_bytes, Buffer.byteLength(fixture.product)); setup.push({ kind: 'fixture-storage', name: fixture.name, storage })
    await permit('empty-flags-after-business', [{ sql: "INSERT INTO system_flags(key,value) VALUES('maintenance',''),('maintenance_mode','')" }])
  }
  const accept = (name, record, detail = {}) => { const outcome = { name, kind: record.value.kind, app: record.metrics, external_writer: record.external_writer_metrics, external_witnesses: record.external_writer_witness_metrics, ...detail }; cases.push(outcome); checks.push({ name, passed: true }) }
  const authority = async (fixture, flagBytes = [0, 0]) => { const record = await invoke({ mode: 'public-snapshot', reset: true }, fixture.name + '-authority'); financial(record.value, fixture); noUnexpectedErrors(record.value); assert.equal(record.value.writer_calls.length, 0); const restores = record.value.calls.filter(call => call.phase === 'legacy-restore'); assert.equal(restores.length, 3); for (const call of restores) { assert.equal(call.restore_observation.active, false); assert.deepEqual(call.restore_observation.rows.map(row => row.type), ['string', 'string']); assert.deepEqual(call.restore_observation.rows.map(row => row.utf8_bytes), flagBytes) } assert.ok(Buffer.byteLength(JSON.stringify(record.value.snapshot)) < 32 * 1024 * 1024); assert.ok(record.value.snapshot.items.every(row => Buffer.byteLength(JSON.stringify(row)) < 2000000)); accept(fixture.name + '-authority', record); return record }
  const sameFull = (record, expected, fixture) => { financial(record.value, fixture); assert.deepEqual(record.value.snapshot, expected.value.snapshot); assert.deepEqual(record.value.views, expected.value.views) }
  const tiny = { name: 'tiny', items: 1, customer: 'Fixture customer', product: 'Fixture item' }
  await seed(tiny); const tinyAuthority = await authority(tiny)
  const tinyCombined = await invoke({ mode: 'combined' }, 'tiny-combined'); assert.equal(tinyCombined.value.kind, 'combined'); assert.equal(tinyCombined.metrics.atomic_main_batches, 1, 'Eligible combined helper must dispatch exactly one full atomic main'); noUnexpectedErrors(tinyCombined.value); combinedParity(tinyCombined, tinyAuthority)
  const tinyMain = tinyCombined.value.calls.find(call => call.phase === 'atomic-main')
  const omittedSalesFields = ['cashier_id', 'cashier_name', 'customer_phone', 'receipt_number', 'delivery_contact_id', 'delivery_contact_name']
  const fullSalesFields = Object.keys(tinyAuthority.value.snapshot.sales[0])
  assert.ok(omittedSalesFields.every(key => fullSalesFields.includes(key)), 'Actual FULL authority retains all six declared metadata fields')
  assert.deepEqual(tinyMain.detail_groups[0].columns, fullSalesFields.filter(key => !omittedSalesFields.includes(key)), 'Dashboard native sales fields must omit only the six unused FULL metadata fields after complete financial parity')
  const fullItemFields = Object.keys(tinyAuthority.value.snapshot.items[0])
  assert.equal(fullItemFields.length, 9); assert.deepEqual(tinyMain.detail_groups[2].columns, fullItemFields, 'Dashboard native items retain all nine FULL fields')
  const nativeSalesBytes = tinyMain.results[2].result_array_utf8_bytes, fullSalesBytes = Buffer.byteLength(JSON.stringify(tinyAuthority.value.snapshot.sales), 'utf8')
  assert.equal(typeof nativeSalesBytes, 'number'); assert.ok(nativeSalesBytes < fullSalesBytes, 'Dashboard native sales result array must shrink against the actual complete FULL authority')
  const emptyVoidParts = tinyMain.sqls[3].split(/\bFROM sales s WHERE\b/); assert.equal(emptyVoidParts.length, 2)
  const emptyVoidSelect = emptyVoidParts[0]
  assert.doesNotMatch(emptyVoidSelect, /\bs\.(cashier_id|cashier_name|customer_phone)\b/, 'Empty void group: SQL-only omission of its three unused metadata fields')
  assert.match(emptyVoidSelect, /\bs\.sale_status\b/, 'Empty void group: SQL-only retention of sale status; no void-row value proof')
  accept('tiny-combined-atomic', tinyCombined)
  const tinyFull = await invoke({ mode: 'atomic-full-snapshot' }, 'tiny-full-bridge'); sameFull(tinyFull, tinyAuthority, tiny); noUnexpectedErrors(tinyFull.value); assert.equal(tinyFull.metrics.atomic_main_batches, 1); accept('tiny-full-bridge', tinyFull)
  const tinyPoison = await invoke({ mode: 'atomic-full-snapshot', poison: true }, 'tiny-native-poison-calibration'), poisonCall = tinyPoison.value.calls.find(call => call.phase === 'atomic-main')
  assert.equal(tinyPoison.value.kind, 'refusal'); assert.equal(tinyPoison.value.error.marker, '__dashboard_full_detail_poison'); assert.equal(poisonCall.arity, 8); assert.match(poisonCall.error, /bad JSON path|JSON path error/i); assert.ok(poisonCall.error.includes('__dashboard_full_detail_poison')); assert.equal(poisonCall.unknown_metadata, 8); assert.equal(tinyPoison.value.calls.filter(call => detailPhases.includes(call.phase) || call.phase === 'legacy-restore' || call.phase === 'flags-post').length, 0); noUnexpectedErrors(tinyPoison.value, poisonCall); accept('tiny-native-poison-calibration', tinyPoison)
  for (const fixture of [{ name: 'long-row', items: 1, customer: 'Fixture customer', product: '\u1780'.repeat(100000) }, { name: 'shared-bytes', items: 18, customer: '\u1780'.repeat(99000), product: '\u1780'.repeat(99000) }]) {
    await seed(fixture); const expected = await authority(fixture)
    const combined = await invoke({ mode: 'combined' }, fixture.name + '-combined-fallback'); mainMiss(combined, false); combinedParity(combined, expected); accept(fixture.name + '-combined-fallback', combined)
    const poisoned = await invoke({ mode: 'atomic-full-snapshot', poison: true }, fixture.name + '-full-poison-fallback'); mainMiss(poisoned, true); sameFull(poisoned, expected, fixture); accept(fixture.name + '-full-poison-fallback', poisoned)
  }
  const prefixFixture = { ...tiny, name: 'inactive-prefix' }; await seed(prefixFixture); await setFlags('giant-inactive-prefix', '', ' '.repeat(1700000)); const prefixAuthority = await authority(prefixFixture, [0, 1700000])
  for (const mode of ['atomic-full-snapshot', 'combined']) { const record = await invoke({ mode }, 'inactive-prefix-' + mode); inactivePrefix(record); if (mode === 'combined') combinedParity(record, prefixAuthority); else sameFull(record, prefixAuthority, prefixFixture); accept('inactive-prefix-' + mode, record) }
  const strict = await invoke({ mode: 'public-totals' }, 'inactive-prefix-strict-totals'), strictFailure = strict.value.calls.find(call => call.phase === 'flags-prefetch')
  assert.equal(strict.value.kind, 'refusal'); assert.equal(strict.value.error.code, 'too_many_rows'); assert.equal(strict.value.error.status, 413); ownFlagsFailure(strictFailure, 3); noUnexpectedErrors(strict.value, strictFailure); assert.equal(strict.value.calls.filter(call => detailPhases.includes(call.phase) || ['atomic-main', 'flags-post', 'legacy-restore'].includes(call.phase)).length, 0); accept('inactive-prefix-strict-totals', strict)
  const medium = { name: 'postflight', items: 18, customer: 'Fixture customer', product: '\u1780'.repeat(50000) }; await seed(medium)
  const inactive = ' '.repeat(1500000), core = JSON.stringify({ mode: 'restore' }), active = core + ' '.repeat(1500000 - core.length)
  await setFlags('postflight-inactive-authority', inactive); const postAuthority = await authority(medium, [1500000, 1500000])
  for (const postWriter of ['inactive', 'active']) for (const mode of ['atomic-full-snapshot', 'combined']) {
    await setFlags('reset-' + postWriter + '-' + mode, '')
    const record = await invoke({ mode, postWriter, reset: true }, 'post-' + postWriter + '-' + mode), ledger = postLedger(record, postWriter === 'active')
    if (postWriter === 'inactive') { if (mode === 'combined') combinedParity(record, postAuthority); else sameFull(record, postAuthority, medium) }
    accept('post-' + postWriter + '-' + mode, record, ledger)
  }
  await setFlags('initial-active-prefix', active)
  const legacyActive = await invoke({ mode: 'public-snapshot', reset: true }, 'legacy-active-prefix'); prefixLedger(legacyActive, false); accept('legacy-active-prefix', legacyActive)
  const optimizedActive = await invoke({ mode: 'atomic-full-snapshot', reset: true }, 'optimized-active-prefix'); prefixLedger(optimizedActive, true); accept('optimized-active-prefix', optimizedActive)
  await permit('final-recognized-flag-cleanup', [{ sql: "DELETE FROM system_flags WHERE key IN ('maintenance','maintenance_mode')" }])
  assert.equal(sequence, 21); assert.equal(checks.length, 21)
  const triggersAfter = await raw.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(); assert.deepEqual(triggersAfter.results, triggersBefore.results)
  const finalFlags = await raw.prepare("SELECT key FROM system_flags WHERE key IN ('maintenance','maintenance_mode','stock_transaction_permit')").all(); assert.equal(finalFlags.results.length, 0); setup.push({ kind: 'final-flags', result: finalFlags })
  for (const [relative, source] of sources) assert.ok(source.bytes.equals(fs.readFileSync(source.file)), 'Loaded source changed during full-reader regression: ' + relative)
  assert.ok(workerBytes.equals(fs.readFileSync(workerFile)), 'Worker source changed during full-reader regression')
  final = { status: 'PASS', checks: checks.length, requests: sequence, cases, triggers: triggerCount, migrations: migrations.length, trigger_inventory_sha256: sha(JSON.stringify(triggersBefore.results)), scope: 'Current full reader authority versus actual optimized combined/full bridge; valid legacy main/prefix/post resource compatibility, exact base totals/day arrays/diagnostics, strict totals refusal and fresh active409 before fallback data. External native writer and witness costs separate. No V1/returns/dates/scopes/auth/protocol/transport/CPU/peak/provider/Free certificate.' }
}
main().catch(error => { final = { status: 'FAIL', stage: lastStage, error: String(error?.stack ?? error).slice(0, 8000), checks: checks.length, requests: sequence, cases }; process.exitCode = 1 }).finally(async () => {
  let disposed = false
  try { if (mf) { life('dispose-before'); await mf.dispose(); disposed = true; life('dispose-after') } }
  catch (error) { final = { status: 'DISPOSAL_FAILURE', error: String(error?.stack ?? error), prior: final }; process.exitCode = 1 }
  console.log(JSON.stringify({ ...final, disposed, node: process.version, analytics: bindings[ANALYTICS], loaded_source_files: sources.size, source_bindings_sha256: sha(JSON.stringify(bindings)), analytics_export_append_sha256: sha(exportsOnly), worker_raw_sha256: sha(workerBytes), worker_lf_sha256: sha(worker), bundle_sha256: bundleSha256, setup_sha256: sha(JSON.stringify(setup)), observations_sha256: sha(JSON.stringify(observationHashes)) }))
})
