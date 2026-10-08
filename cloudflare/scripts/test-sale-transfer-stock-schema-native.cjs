const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { Miniflare, Log, LogLevel } = require('miniflare'), { unstable_splitSqlQuery: split } = require('wrangler');
const fixture = fs.readFileSync(path.join(__dirname, 'test-sale-receipt-number-race-native.cjs'), 'utf8').split(';(async () => {')[0];
function harness(old = false) { let code = fixture.replace("const BASELINE = process.env.RECEIPT_RACE_BASELINE || ''", `const BASELINE = '${old ? '1dbf6d11f4b050d1996b62b9b9a355e39ce2e51f' : ''}'`).replace("permissions: JSON.stringify({ pos: true })", "permissions: JSON.stringify({ pos: true, sales: true, products: true, inventory: true, branches: true, returns: true })"); return new Function('require', '__dirname', code + '\nreturn {load,app,request,USER,executionCtx,background,PRODUCTS,lotOf};')(require, __dirname); }
const current = harness(), old = harness(true), root = path.join(__dirname, '..');
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; };
(async () => {
    const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-07-19', d1Databases: ['DB'], port: 0, log: new Log(LogLevel.ERROR) });
    try {
        const raw = await mf.getD1Database('DB');
        for (const name of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql') && n !== '0243_stock_schema_epoch.sql').sort()) {
            const ss = split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8')).filter(sql => !(name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())));
            for (let i = 0; i < ss.length; i += 50)
                await raw.batch(ss.slice(i, i + 50).map(sql => raw.prepare(sql)));
        }
        await raw.batch([raw.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Warehouse',0,1)"), ...current.PRODUCTS.flatMap(id => [
                raw.prepare('INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(?,?,?,10,9.5,38000,4,16000,1)').bind(id, `Powder ${id}`, `POWDER-${id}`), raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,10)').bind(id), raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number) VALUES(?,?,?,?,'2027-06-01','2026-09-01',1,1)").bind(current.lotOf(id), id, `powder-lot-${id}`, `POWDER-LOT-${id}`), raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,10)').bind(current.lotOf(id))
            ])]);
        await raw.batch([
            raw.prepare("INSERT INTO returns(id,return_number,return_scope,status,return_type,supplier_settlement,branch_id,updated_at) VALUES(900,'SRET-900','supplier','completed','supplier_return','refund',1,'supplier-v1')"),
            raw.prepare("INSERT INTO return_items(id,return_id,product_id,product_name,quantity,cost_price_usd,return_to_stock,stock_action,branch_id,batch_id) VALUES(900,900,12,'Powder 12',1,4,0,'none',1,NULL)"),
            raw.prepare('INSERT INTO return_item_batch_allocations(return_item_id,batch_id,branch_id,quantity) VALUES(900,502,1,1)')
        ]);
        await raw.batch(split(fs.readFileSync(path.join(root, 'migrations/0243_stock_schema_epoch.sql'), 'utf8')).map(sql => raw.prepare(sql)));
        const one = async (sql, ...values) => raw.prepare(sql).bind(...values).first();
        const permits = async () => check((await one("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'")).n === 0, 'no durable permit');
        const state = async () => ({ stock: (await raw.prepare('SELECT id,stock_quantity FROM products ORDER BY id').all()).results, movements: (await one('SELECT COUNT(*) n FROM inventory_movements')).n, sales: (await one('SELECT COUNT(*) n FROM sales')).n });
        const post = async (h, id, p = 10) => { const r = await h.app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(h.request(id, p)) }, { DB: raw }, h.executionCtx); await Promise.all(h.background.splice(0)); return { status: r.status, body: await r.json() }; };
        let before = await state(), r = await post(old, 'schema_old_writer_001');
        check(r.status !== 200, 'frozen writer refused by actual0243');
        assert.deepEqual(await state(), before);
        checks++;
        await permits();
        r = await post(current, 'schema_new_writer_001');
        check(r.status === 200, JSON.stringify(r));
        check((await one('SELECT stock_quantity n FROM products WHERE id=10')).n === 9, 'sale stock deducted once');
        await permits();
        const sale = (await one("SELECT id FROM sales WHERE client_request_id='schema_new_writer_001'")).id;
        for (const status of ['cancelled', 'completed']) {
            const res = await current.app.request(`/${sale}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sale_status: status, cancel_reason: 'mistake', client_request_id: 'schema_status_' + status }) }, { DB: raw }, current.executionCtx);
            const body = await res.json();
            check(res.status === 200, JSON.stringify(body));
            await permits();
        }
        check((await one('SELECT stock_quantity n FROM products WHERE id=10')).n === 9, 'cancel/un-cancel compensates exactly');
        const db = new (current.load('lib/db.ts').D1Compat)(raw), stock = current.load('lib/stockActionCommit.ts');
        const product = await stock.ensureUnifiedStockProduct(db, { jobId: 'schema-test', identityKey: 'new-product', productName: 'New imported product', sellingPriceUsd: 5, costPriceUsd: 4 });
        check(product.productId > 0 && (await one('SELECT COUNT(*) n FROM products WHERE id=?', product.productId)).n === 1, 'actual product identity writer');
        await permits();
        await stock.applyUnifiedStockAdd(db, { jobId: 'schema-test', rowNumber: 2, productId: product.productId, productName: 'New imported product', branchId: 1, branchName: 'Shop', quantity: 3, date: '2026-10-08', batchLabel: 'schema-lot', costPriceUsd: 4, supplierName: 'Supplier' });
        check((await one('SELECT stock_quantity n FROM products WHERE id=?', product.productId)).n === 3, 'actual import receipt credits once');
        await permits();
        const bulk = current.load('lib/saleBulkStatus.ts'), saleRow = await one('SELECT * FROM sales WHERE id=?', sale);
        const grouped = await bulk.applySaleBulkStatus({ DB: raw }, current.USER, { client_request_id: 'schema_bulk_cancel', items: [{ id: sale, expected_status: saleRow.sale_status, expected_updated_at: saleRow.updated_at }], target_status: 'cancelled', cancel_reason: 'mistake' });
        await permits();
        check((await one('SELECT stock_quantity n FROM products WHERE id=10')).n === 10, 'bulk cancellation credits once');
        const bulkHistory = await one('SELECT * FROM action_history WHERE id=?', grouped.actionHistoryId);
        await bulk.replaySaleBulkStatus({ DB: raw }, current.USER, 'undo', grouped.actionHistoryId, 0, JSON.parse(bulkHistory.undo_payload));
        await permits();
        check((await one('SELECT stock_quantity n FROM products WHERE id=10')).n === 9, 'bulk undo debits once');
        await raw.prepare("CREATE TRIGGER sale_bridge_test_failure AFTER INSERT ON inventory_movements WHEN NEW.product_id=12 AND NEW.movement_type='sale' BEGIN SELECT RAISE(ABORT,'injected_sale_tail_failure'); END").run();
        before = await state();
        r = await post(current, 'schema_rollback_001', 12);
        check(r.status !== 200, 'injected stock movement tail refuses sale');
        assert.deepEqual(await state(), before);
        checks++;
        check((await one("SELECT COUNT(*) n FROM sales WHERE client_request_id='schema_rollback_001'")).n === 0, 'failed sale header rolled back');
        await permits();
        await raw.prepare('DROP TRIGGER sale_bridge_test_failure').run();
        let lost = 0;
        const lostRaw = new Proxy(raw, { get(target, key) { if (key === 'batch')
                return async (ss) => { const result = await target.batch(ss); if (!lost++) {
                    throw Error('D1_ERROR: network lost acknowledgement');
                } return result; }; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
        const lostResponse = await current.app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(current.request('schema_lost_ack_001', 12)) }, { DB: lostRaw }, current.executionCtx);
        const lostBody = await lostResponse.json();
        check(lostResponse.status === 200, JSON.stringify(lostBody));
        check((await one('SELECT stock_quantity n FROM products WHERE id=12')).n === 9, 'lost ACK sale stock exactly once');
        check((await one("SELECT COUNT(*) n FROM sales WHERE client_request_id='schema_lost_ack_001'")).n === 1, 'lost ACK one sale receipt');
        await permits();
        const hookKey = Symbol.for('business-os.request-metrics.v1');
        let attempted = 0;
        globalThis[hookKey] = { d1Start: n => attempted += n, d1Call: () => { } };
        const measured = await stock.ensureUnifiedStockProduct(db, { jobId: 'measured', identityKey: 'new', productName: 'Measured' });
        check(attempted === 6, 'new identity counts two permit statements: ' + attempted);
        attempted = 0;
        await stock.ensureUnifiedStockProduct(db, { jobId: 'measured', identityKey: 'new', productName: 'Measured' });
        check(attempted === 4, 'existing identity counts guarded no-row seed: ' + attempted);
        delete globalThis[hookKey];
        await permits();
        const importFixture = fs.readFileSync(path.join(__dirname, 'test-sales-import-commit-pure.cjs'), 'utf8');
        const saleData = new Function(importFixture.slice(importFixture.indexOf('function saleData('), importFixture.indexOf('function customerMatch(')) + 'return saleData')();
        const importApi = current.load('lib/salesImportCommit.ts');
        const historical = saleData({ sale_status: 'partial_return' });
        historical.items[0].batch_id = 500;
        historical.items[0].batch_label = 'POWDER-LOT-10';
        historical.items[0].batch_expiry_date = '2027-06-01';
        historical.items[0].returned_quantity = 1;
        const imported = await importApi.applyHistoricalSaleImport(db, { jobId: 'bridge-history', rowNumber: 2, data: historical, nowIso: '2026-10-08T16:00:00.000Z', actor: current.USER });
        await permits();
        check(!imported.alreadyApplied, 'historical import applied');
        const replayed = await importApi.applyHistoricalSaleImport(db, { jobId: 'bridge-history', rowNumber: 2, data: historical, nowIso: '2026-10-08T16:00:00.000Z', actor: current.USER });
        check(replayed.alreadyApplied, 'historical import replay');
        await permits();
        const returnRow = await one('SELECT * FROM returns WHERE id=900');
        const returnBulk = current.load('lib/returnBulkAction.ts');
        const returned = await returnBulk.applyReturnBulkAction({ DB: raw }, current.USER, { client_request_id: 'schema_return_cancel', field: 'status', source: 'completed', target: 'cancelled', items: [{ id: returnRow.id, expected_status: returnRow.status, expected_method: returnRow.supplier_settlement, expected_updated_at: returnRow.updated_at }] });
        await permits();
        check((await one('SELECT stock_quantity n FROM products WHERE id=12')).n === 10, 'supplier return cancellation restores exact debit');
        const returnHistory = await one('SELECT * FROM action_history WHERE id=?', returned.actionHistoryId);
        await returnBulk.replayReturnBulkAction({ DB: raw }, current.USER, 'undo', returned.actionHistoryId, 0, JSON.parse(returnHistory.undo_payload));
        await permits();
        check((await one('SELECT stock_quantity n FROM products WHERE id=12')).n === 9, 'supplier return undo debits exact prior credit');
        const stockSaleInput = { jobId: 'schema-stock-sale', saleGroupKey: 'sale', date: '10/08/2026', actor: current.USER, recordedAt: '2026-10-08T16:00:00.000Z', lines: [{ rowNumber: 2, productId: 11, productName: 'Powder 11', branchId: 1, branchName: 'Shop', quantity: 1, sellingPriceUsd: 9.5, costPriceUsd: 4 }] };
        const stockSale = await stock.applyUnifiedStockSale(db, stockSaleInput);
        check(!stockSale.alreadyApplied, 'unified sale applied');
        await permits();
        check((await one('SELECT stock_quantity n FROM products WHERE id=11')).n === 9, 'unified sale physical debit');
        check((await stock.applyUnifiedStockSale(db, stockSaleInput)).alreadyApplied, 'unified sale repeat receipt');
        await permits();
        const transfer = current.load('lib/transferOperation.ts'), executor = current.load('lib/stockTransaction.ts');
        const planned = await transfer.planTransferOperation(db, { user: current.USER, requestId: 'schema-transfer', requestJson: JSON.stringify({ kind: 'inventory-transfer', reason: 'Native bridge test' }), digest: 'schema-digest', scope: 'inventory', fromBranchId: 1, toBranchId: 2, reason: 'Native bridge test', lines: [{ productId: 11, destProductId: 11, quantity: 1 }], response: { success: true } });
        before = await state();
        await assert.rejects(db.batch(planned.statements), /stock_transaction_required/);
        checks++;
        assert.deepEqual(await state(), before);
        checks++;
        await executor.executeStockTransaction(db, planned.statements, 'retry');
        await permits();
        check((await one('SELECT stock_quantity n FROM products WHERE id=11')).n === 9, 'transfer conserves product total');
        check((await one('SELECT quantity n FROM branch_stock WHERE product_id=11 AND branch_id=1')).n === 8, 'forward exact source');
        const receipt = await one('SELECT * FROM transfer_operation_receipts WHERE operation_id=?', planned.operationId);
        const payload = { operation_id: planned.operationId, generation: 0, permission: 'inventory' };
        await transfer.replayTransferOperation({ DB: raw }, current.USER, 'undo', receipt.action_history_id, 0, payload);
        await permits();
        check((await one('SELECT quantity n FROM branch_stock WHERE product_id=11 AND branch_id=1')).n === 9, 'undo exact source');
        await transfer.replayTransferOperation({ DB: raw }, current.USER, 'redo', receipt.action_history_id, 1, { ...payload, generation: 1 });
        await permits();
        check((await one('SELECT quantity n FROM branch_stock WHERE product_id=11 AND branch_id=1')).n === 8, 'redo exact source');
        for (const [epoch, maintenance] of [[null, false], ['wrong', false], ['legacy-separate-pool-v1', true]]) {
            await raw.prepare("DELETE FROM system_flags WHERE key IN ('stock_schema_epoch','maintenance')").run();
            if (epoch)
                await raw.prepare("INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch',?)").bind(epoch).run();
            if (maintenance)
                await executor.executeStockTransaction(db, [{ sql: "INSERT INTO system_flags(key,value) VALUES('maintenance','{}')" }], 'retry');
            before = await state();
            r = await post(current, `schema_blocked_${checks}`);
            check(r.status !== 200, 'epoch/maintenance refusal');
            assert.deepEqual(await state(), before);
            checks++;
            await assert.rejects(stock.ensureUnifiedStockProduct(db, { jobId: 'blocked', identityKey: String(checks), productName: 'Blocked' }), e => e.code === 'stock_schema_unavailable');
            checks++;
            await assert.rejects(stock.ensureUnifiedStockProduct(db, { jobId: 'schema-test', identityKey: 'new-product', productName: 'New imported product' }), e => e.code === 'stock_schema_unavailable');
            checks++;
            await permits();
        }
        console.log(`PASS ${checks} actual source/native D1 sale create, cancellation, import identity/receipt, frozen writer, epoch and maintenance controls`);
    }
    finally {
        await mf.dispose();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
