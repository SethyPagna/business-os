const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Hono } = require('hono');
const f = require('./test-stock-bridge-core-native.cjs');
const { db, sql, load } = f;
f.actor.permissions = JSON.stringify({ all: true });
const kernel = load('lib/returnsStock.ts');
const executor = load('lib/stockTransaction.ts');
const cloudflareRoot = path.join(__dirname, '..');
const app = new Hono();
app.route('/returns', load('routes/returns.ts').default);
// The shared fixture stubs notification I/O but omits these sale formatters.
const saleSource = fs.readFileSync(path.join(cloudflareRoot, 'src/routes/sales.ts'), 'utf8').replace("import { formatSaleStatusTelegramLines, formatSaleTelegramLines, sendTelegramEvent } from '../lib/telegram'", "import { sendTelegramEvent } from '../lib/telegram'; const formatSaleStatusTelegramLines = () => []; const formatSaleTelegramLines = () => []");
app.route('/sales', load('routes/sales.ts', saleSource).default);
app.onError((error, c) => c.json({ error: error.message }, 503));
let sequence = 0;
async function send(url, body, method = 'POST') {
    const tails = [];
    const response = await app.request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { DB: f.raw, PLAN_TIER: 'paid' }, { waitUntil(p) { tails.push(Promise.resolve(p)); } });
    await Promise.allSettled(tails);
    return { status: response.status, body: await response.json() };
}
const physical = () => JSON.stringify(['products', 'branch_stock', 'branch_batch_stock', 'damaged_stock_lots', 'inventory_movements', 'sales', 'sale_items', 'returns', 'return_items'].map(t => sql.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all()));
const returnBody = (quantity = 2) => ({ client_request_id: 'cleanup-return-' + (++sequence), branch_id: 1, reason: 'crushed box', items: [{ product_id: 1001, product_name: 'Stock', quantity, stock_action: 'damaged', condition_tag: 'broken', damaged_disposition: 'keep', branch_id: 1, batch_id: 1001, applied_price_usd: 2, applied_price_khr: 0 }] });
let passed = 0;
async function check(name, fn) {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}
async function run() {
    sql.exec('UPDATE products SET selling_price_usd=2,selling_price_khr=8000 WHERE id IN(1001,1002)');
    const ids = { tc1: 1001, tc2: 1001, os1: 1002 }, batchId = 1001;
    await check('normalizeStockAction: explicit three-way wins, boolean keeps its historical default', async () => {
        assert.equal(kernel.normalizeStockAction({ stock_action: 'damaged', return_to_stock: true }), 'damaged');
        assert.equal(kernel.normalizeStockAction({ stock_action: 'none' }), 'none');
        assert.equal(kernel.normalizeStockAction({ stock_action: 'RESTOCK' }), 'restock');
        // the pre-0074 wire shape, byte for byte
        assert.equal(kernel.normalizeStockAction({}), 'restock');
        assert.equal(kernel.normalizeStockAction({ return_to_stock: false }), 'none');
        assert.equal(kernel.normalizeStockAction({ stock_action: 'garbage', return_to_stock: false }), 'none');
    });
    await check('resolveRefundUnitPrice: the ORIGINAL sale line wins over anything posted', async () => {
        // the sale charged $8; the client claims $25 -- the sale wins
        const fromSale = kernel.resolveRefundUnitPrice({
            saleLine: { applied_price_usd: 8, applied_price_khr: 32000 },
            postedUsd: 25, postedKhr: 100000,
        });
        assert.equal(fromSale.unitUsd, 8);
        assert.equal(fromSale.unitKhr, 32000);
        assert.equal(fromSale.fromSaleLine, true);
        // a line sold at $0 (a giveaway) refunds $0 -- not the posted price
        assert.equal(kernel.resolveRefundUnitPrice({ saleLine: { applied_price_usd: 0, applied_price_khr: 0 }, postedUsd: 9, postedKhr: 0 }).unitUsd, 0);
        // a manual return has no sale line, so the posted price is all there is
        const manual = kernel.resolveRefundUnitPrice({ saleLine: null, postedUsd: 9.5, postedKhr: 38000 });
        assert.equal(manual.unitUsd, 9.5);
        assert.equal(manual.fromSaleLine, false);
    });
    await check('planReturnLot: the sale names the lot, or the operator does, or it is refused', async () => {
        // multi-lot line: split back across the SAME lots, last drawn first
        const multi = kernel.planReturnLot({
            allocations: [{ batch_id: 11, outstanding: 3 }, { batch_id: 22, outstanding: 2 }],
            saleLineBatchId: null, operatorBatchId: null, quantity: 5, lotTracked: true,
        });
        assert.deepEqual(multi.splits, [{ batchId: 22, quantity: 2 }, { batchId: 11, quantity: 3 }]);
        assert.equal(multi.requiresLotPick, false);
        assert.equal(multi.plainQuantity, 0);
        // single-lot line falls back to the lot recorded on the sale line
        const single = kernel.planReturnLot({ allocations: [], saleLineBatchId: 9, operatorBatchId: null, quantity: 4, lotTracked: true });
        assert.deepEqual(single.splits, [{ batchId: 9, quantity: 4 }]);
        // an explicit pick is authoritative for the WHOLE line -- it never merges
        // with a derived split and leaves units somewhere nobody chose
        const picked = kernel.planReturnLot({
            allocations: [{ batch_id: 11, outstanding: 3 }],
            saleLineBatchId: 9, operatorBatchId: 77, quantity: 5, lotTracked: true,
        });
        assert.deepEqual(picked.splits, [{ batchId: 77, quantity: 5 }]);
        // lot-tracked with no answer anywhere: REFUSED, never a silent aggregate bump
        const stuck = kernel.planReturnLot({ allocations: [], saleLineBatchId: null, operatorBatchId: null, quantity: 2, lotTracked: true });
        assert.equal(stuck.requiresLotPick, true);
        assert.equal(stuck.plainQuantity, 0);
        // ...and a product that has never had a lot keeps the plain bump
        const legacy = kernel.planReturnLot({ allocations: [], saleLineBatchId: null, operatorBatchId: null, quantity: 2, lotTracked: false });
        assert.equal(legacy.requiresLotPick, false);
        assert.equal(legacy.plainQuantity, 2);
        // the settlement kernel is GONE, not merely unused
        assert.equal(typeof kernel.computeSettlement, 'undefined');
    });
    await check('removed standalone writers cannot reopen an unguarded path', async () => {
        for (const name of ['createDamagedLot', 'reverseDamagedLots', 'applyReplacementStock', 'consumeDamagedLot', 'restoreDamagedLot'])
            assert.equal(kernel[name], undefined);
    });
    await check('live damaged planner preserves provenance and is rejected without permit', async () => {
        const input = { productId: 1001, productName: 'Stock', branchId: 1, batchId: 1001, returnIdSql: 'NULL', quantity: 2, reason: 'fixture damage', userId: 7, userName: 'Fixture', tag: 'broken', disposition: 'keep', unitCostUsd: 2, unitCostKhr: 8000 };
        const plan = kernel.planDamagedReturnLine(input), before = physical();
        await assert.rejects(db.batch(plan), /stock_transaction_required/);
        assert.equal(physical(), before);
        await executor.executeStockTransaction(db, plan, 'once');
        const lot = sql.prepare('SELECT * FROM damaged_stock_lots WHERE return_id IS NULL').get();
        assert.equal(lot.quantity_remaining, 2);
        assert.equal(lot.batch_id, 1001);
        assert.equal(lot.created_by_user_name, 'Fixture');
        assert.equal(lot.condition_tag, 'broken');
        assert.equal(lot.source, 'return');
        assert.equal(lot.unit_cost_usd, 2);
        assert.equal(sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1001').get().quantity, 7);
        assert.equal((await kernel.listOpenDamagedLots(db, { productId: 1001, branchId: 1 })).length, 1);
        const move = sql.prepare("SELECT * FROM inventory_movements WHERE movement_type='damage_in'").get();
        assert.equal(move.quantity, 2);
        assert.equal(move.unit_cost_usd, 2);
        assert.equal(move.user_name, 'Fixture');
    });
    await check('live replacement planner drains plain and exact batch stores with costs', async () => {
        const input = { productId: 1001, productName: 'Stock', branchId: 1, batchId: null, quantity: 2, unitCostUsd: 3, unitCostKhr: 12300, returnIdSql: 'NULL', returnNumber: 'RET-TEST', userId: 7, userName: 'Fixture' };
        await executor.executeStockTransaction(db, kernel.planReplacementStock(input).statements, 'once');
        assert.equal(sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1001').get().quantity, 5);
        const plan = kernel.planReplacementStock({ ...input, batchId: 1001, quantity: 1 });
        assert.equal(plan.usedBatch, true);
        await executor.executeStockTransaction(db, plan.statements, 'once');
        assert.equal(sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1001').get().quantity, 6);
        assert.equal(sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1001').get().quantity, 4);
        assert.equal(sql.prepare('SELECT stock_quantity FROM products WHERE id=1001').get().stock_quantity, 4);
        const movement = sql.prepare("SELECT * FROM inventory_movements WHERE movement_type='replacement_out' ORDER BY id DESC").get();
        assert.equal(movement.quantity, -1);
        assert.equal(movement.unit_cost_usd, 3);
        assert.equal(movement.unit_cost_khr, 12300);
        assert.match(movement.reason, /RET-TEST/);
        assert.equal(movement.batch_id, 1001);
        const before = physical();
        f.failSql(/INSERT INTO inventory_movements/);
        await assert.rejects(executor.executeStockTransaction(db, kernel.planReplacementStock({ ...input, batchId: 1001, quantity: 1 }).statements, 'once'), /fixture transaction failure/);
        assert.equal(physical(), before);
    });
    await check('mounted replacement refuses shortage and wrong product without effects', async () => {
        for (const replacement of [{ product_id: 1001, quantity: 99 }, { product_id: 1002, batch_id: 1001, quantity: 1 }]) {
            const request = returnBody(1);
            request.items[0].stock_action = 'none';
            request.replacement_items = [{ ...replacement, branch_id: 1, applied_price_usd: 2 }];
            const before = physical(), result = await send('/returns', request);
            assert.notEqual(result.status, 200, JSON.stringify(result));
            assert.match(JSON.stringify(result.body), replacement.product_id === 1002 ? /does not belong to this replacement product/ : /stock|available/i);
            assert.equal(physical(), before);
        }
    });
    let returnId, damagedLotId;
    await check('mounted return reversal replaces untouched lot and keeps attribution', async () => {
        const saved = await send('/returns', returnBody());
        assert.equal(saved.status, 200, JSON.stringify(saved));
        returnId = saved.body.id;
        const oldLot = sql.prepare('SELECT * FROM damaged_stock_lots WHERE return_id=?').get(returnId);
        assert.equal(oldLot.quantity, 2);
        assert.equal(oldLot.batch_id, null);
        const request = returnBody(3);
        request.expected_updated_at = sql.prepare('SELECT updated_at FROM returns WHERE id=?').get(returnId).updated_at;
        const edited = await send('/returns/' + returnId, request, 'PATCH');
        assert.equal(edited.status, 200, JSON.stringify(edited));
        const lots = sql.prepare('SELECT * FROM damaged_stock_lots WHERE return_id=?').all(returnId);
        assert.equal(lots.length, 1);
        assert.equal(lots[0].quantity_remaining, 3);
        assert.equal(lots[0].created_by_user_name, 'admin');
        damagedLotId = lots[0].id;
        assert.equal(sql.prepare("SELECT quantity FROM inventory_movements WHERE reference_id=? AND movement_type='damage_reversal' ORDER BY id DESC").get(returnId).quantity, -2);
    });
    const saleBody = (productId, quantity) => ({ client_request_id: 'cleanup-sale-' + (++sequence), branch_id: 1, money_precision_version: 1, exchange_rate: 4000, payment_method: 'Cash', payment_currency: 'USD', amount_paid_usd: quantity * 2, offline_owner: { version: 1, actor_id: f.actor.id, organization_id: null, authority: 'http://localhost', runtime: 'cloudflare-workers' }, items: [{ product_id: productId, quantity, branch_id: 1, damaged_lot_id: damagedLotId, applied_price_usd: 2, client_line_key: "cleanup-damage-line", pricing_source: "selling", pricing_quote: { gross_usd: quantity * 2, product_discount_usd: 0, manual_discount_usd: 0, total_usd: quantity * 2, total_khr: quantity * 8000 } }] });
    await check('mounted damaged sale strictly refuses wrong product and shortage', async () => {
        for (const [productId, quantity] of [[1002, 1], [1001, 99]]) {
            const before = physical(), result = await send('/sales', saleBody(productId, quantity));
            assert.notEqual(result.status, 200, JSON.stringify(result));
            assert.match(JSON.stringify(result.body), productId === 1002 ? /no longer exists for that product/ : /Insufficient damaged stock/);
            assert.equal(physical(), before);
        }
    });
    await check('mounted damaged draw rolls back after later audit failure', async () => {
        const before = physical();
        f.failSql(/INSERT INTO audit_logs/);
        const result = await send('/sales', saleBody(1001, 1));
        assert.notEqual(result.status, 200, JSON.stringify(result));
        assert.match(JSON.stringify(result.body), /fixture transaction failure/);
        assert.equal(physical(), before);
    });
    await check('mounted consumed lot blocks reversal; sale cancellation restores safely', async () => {
        const saved = await send('/sales', saleBody(1001, 1));
        assert.equal(saved.status, 200, JSON.stringify(saved));
        assert.equal(sql.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=?').get(damagedLotId).quantity_remaining, 2);
        const before = physical(), request = returnBody(1);
        request.expected_updated_at = sql.prepare('SELECT updated_at FROM returns WHERE id=?').get(returnId).updated_at;
        const refused = await send('/returns/' + returnId, request, 'PATCH');
        assert.notEqual(refused.status, 200, JSON.stringify(refused));
        assert.equal(physical(), before);
        assert.match(JSON.stringify(refused.body), /drawn|consumed|edited/i);
        const saleId = saved.body.saleId || saved.body.id;
        const cancelRequest = { sale_status: 'cancelled', cancel_reason: 'mistake', client_request_id: 'cleanup-cancel-' + (++sequence) };
        const cancelled = await send('/sales/' + saleId + '/status', cancelRequest, 'PATCH');
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
        assert.equal(sql.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=?').get(damagedLotId).quantity_remaining, 3);
        const after = physical();
        const replay = await send('/sales/' + saleId + '/status', cancelRequest, 'PATCH');
        assert.equal(replay.status, 200, JSON.stringify(replay));
        assert.equal(physical(), after);
        assert.equal(f.permits(), 0);
    });
    await check('11.9: sales route + POS lookup wiring pins', async () => {
        const salesSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'sales.ts'), 'utf8');
        // damaged lines skip the sellable-stock checks and deductions...
        assert.match(salesSource, /shouldDeductStock && !item\.damaged_lot_id\)/);
        // ...guard and draw their lot inside the same atomic creation batch. The
        // route-level sale-create suite injects a later audit failure and proves
        // quantity_remaining rolls back with the header, line and movement.
        assert.match(salesSource, /SELECT CASE WHEN EXISTS \([\s\S]*?FROM damaged_stock_lots[\s\S]*?quantity_remaining >= @quantity/);
        assert.match(salesSource, /UPDATE damaged_stock_lots[\s\S]*?quantity_remaining = quantity_remaining - @quantity/);
        assert.doesNotMatch(salesSource, /await consumeDamagedLot\(db/);
        assert.doesNotMatch(salesSource, /restoreConsumedDamagedLots/);
        // ...record which damaged lot on the sale line. Sellable batch metadata
        // comes from the validated current-line CTE rather than trusting the
        // caller's batch label/expiry strings.
        assert.match(salesSource, /WITH current_batch AS \([\s\S]*?WHERE pb\.id = @batch_id[\s\S]*?pb\.variant_product_id = @product_id[\s\S]*?current_line AS \(/);
        assert.match(salesSource, /\(SELECT batch_id FROM current_line\),\s*\(SELECT lot_code FROM current_line\),\s*\(SELECT expiry_date FROM current_line\),\s*@damaged_lot_id/);
        assert.doesNotMatch(salesSource, /@batch_id,\s*@batch_label,\s*@batch_expiry_date,\s*@damaged_lot_id/);
        assert.match(salesSource, /DAMAGE_OUT_MOVEMENT/);
        // status transitions run damaged lines on the SAME heldQuantity state
        // machine, outside the branch-stock plan
        assert.match(salesSource, /const regularItems = items\.filter\(\(item\) => !item\.damaged_lot_id\)/);
        assert.match(salesSource, /heldQuantity\(saleStatus, item\.quantity, returned\) - heldQuantity\(oldStatus, item\.quantity, returned\)/);
        const batchesSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'batches.ts'), 'utf8');
        assert.match(batchesSource, /app\.get\('\/damaged-lots'/);
        assert.ok(batchesSource.indexOf(`app.get('/damaged-lots'`) < batchesSource.indexOf(`// GET /api/batches?productId=`));
        const migration75 = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0075_sale_items_damaged_lot.sql'), 'utf8');
        assert.match(migration75, /ALTER TABLE sale_items ADD COLUMN damaged_lot_id INTEGER/);
    });
    await check('route + migration wiring pins', async () => {
        const routeSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'returns.ts'), 'utf8');
        // three-way action drives both create and edit re-apply, and the
        // column is written on both INSERT INTO return_items statements
        assert.match(routeSource, /const stockAction = normalizeStockAction\(item\)/);
        assert.equal((routeSource.match(/@return_to_stock,\s*@stock_action,\s*@branch_id/g) || []).length, 2);
        // damaged lots reverse (and can block) before an edit re-applies
        assert.match(routeSource, /const damagedLots = await db\.prepare\(`[\s\S]*?FROM damaged_stock_lots WHERE return_id=@returnId/);
        assert.match(routeSource, /editReversedDamaged = damagedLots\.map[\s\S]*?DELETE FROM damaged_stock_lots WHERE return_id=@returnId/);
        assert.match(routeSource, /instanceof ConsumedDamagedStockError/);
        // replacements: any catalog item is accepted, a linked sale/receipt is
        // written, and the damaged-lots endpoint sits above the /:id param route.
        // The settlement gate is GONE from the route -- a return no longer nets
        // against its replacement, so there is nothing to refuse or to escalate.
        assert.doesNotMatch(routeSource, /assertReplacementsSameName/);
        assert.doesNotMatch(routeSource, /uneven_exchange/);
        assert.doesNotMatch(routeSource, /settle_difference/);
        assert.doesNotMatch(routeSource, /computeSettlement/);
        // ...and the lot refusal took its place
        assert.match(routeSource, /code: error\.code, product_id: productId/);
        assert.match(routeSource, /INSERT INTO sales\(/);
        assert.match(routeSource, /source_return_id/);
        assert.match(routeSource, /INSERT INTO sale_items\(/);
        assert.match(routeSource, /replacementReceiptNumber/);
        assert.ok(routeSource.indexOf(`app.get('/damaged-lots'`) < routeSource.indexOf(`app.get('/:id'`));
        // Create is one guarded atomic batch, so a failed create never needs a
        // compensating partial-row cleanup path.
        assert.match(routeSource, /returnCreateGuardStatement\(operationId, 'precondition'/);
        assert.match(routeSource, /INSERT INTO return_create_receipts\(/);
        assert.match(routeSource, /returnCreateGuardStatement\(operationId, 'postcondition'/);
        const migration = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0074_returns_replace_damaged.sql'), 'utf8');
        assert.match(migration, /CREATE TABLE IF NOT EXISTS damaged_stock_lots/);
        assert.match(migration, /CREATE TABLE IF NOT EXISTS return_replacement_items/);
        assert.match(migration, /ALTER TABLE return_items ADD COLUMN stock_action TEXT/);
        assert.match(migration, /WHEN COALESCE\(return_to_stock, 0\) = 1 THEN 'restock' ELSE 'none'/);
        const replacementSaleMigration = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0106_return_replacement_sales.sql'), 'utf8');
        assert.match(replacementSaleMigration, /ALTER TABLE returns ADD COLUMN replacement_sale_id INTEGER/);
        assert.match(replacementSaleMigration, /ALTER TABLE sales ADD COLUMN source_return_id INTEGER/);
        const atomicCreateMigration = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0142_return_create_receipts.sql'), 'utf8');
        assert.match(atomicCreateMigration, /CREATE TABLE return_create_receipts/);
    });
    console.log(`\n${passed} check(s) passed.`);
}
run().finally(() => sql.close()).catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
