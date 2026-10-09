const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { Miniflare, Log, LogLevel } = require('miniflare'), { unstable_splitSqlQuery: split } = require('wrangler');
const fixture = fs.readFileSync(path.join(__dirname, 'test-sale-receipt-number-race-native.cjs'), 'utf8').split(';(async () => {')[0];
function harness(old = false) { let code = fixture.replace("if (BASELINE && rel === 'routes/sales.ts')", "if (BASELINE && ['lib/datedStockCountApply.ts','lib/datedStockCountDecisions.ts','lib/stockInLineEdit.ts','lib/dataIntegrity.ts'].includes(rel))").replace("const BASELINE = process.env.RECEIPT_RACE_BASELINE || ''", `const BASELINE = '${old ? '384fec8fd0f310d90d73718284a973e475c95c3b' : ''}'`).replace("permissions: JSON.stringify({ pos: true })", "permissions: JSON.stringify({ pos: true, inventory: true, products: true, backup: true, settings: true })"); return new Function('require', '__dirname', code + '\nreturn {load,overrides,USER};')(require, __dirname); }
const current = harness(), old = harness(true), root = path.join(__dirname, '..');
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; };
;
(async () => {
    const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-07-19', d1Databases: ['DB'], port: 0, log: new Log(LogLevel.ERROR) });
    try {
        const raw = await mf.getD1Database('DB');
        for (const name of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql') && n !== '0243_stock_schema_epoch.sql').sort()) {
            const ss = split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8')).filter(sql => !(name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())));
            for (let i = 0; i < ss.length; i += 50)
                await raw.batch(ss.slice(i, i + 50).map(sql => raw.prepare(sql)));
        }
        await raw.batch([raw.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0)"), raw.prepare("INSERT INTO products(id,name,sku,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Count','C1',1,10,4,5),(2,'Receipt','R2',1,10,4,5),(90,'Drift','D90',1,999,4,5)"), raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,10),(2,1,10),(90,1,5)'), raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,received_quantity,received_cost_usd,supplier_name,received_branch_id,received_branch_name) VALUES(200,2,'source-line','SOURCE','2026-09-01',1,1,4,10,40,'Fixture Supplier',1,'Shop')"), raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(200,1,10)'), raw.prepare("INSERT INTO inventory_movements(id,product_id,product_name,branch_id,branch_name,batch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id) VALUES(200,2,'Receipt',1,'Shop',200,'add',10,4,40,'fixture-receipt')")]);
        await raw.batch(split(fs.readFileSync(path.join(root, 'migrations/0243_stock_schema_epoch.sql'), 'utf8')).map(sql => raw.prepare(sql)));
        const one = async (sql, ...v) => raw.prepare(sql).bind(...v).first(), env = { DB: raw }, db = new (current.load('lib/db.ts').D1Compat)(raw), count = current.load('lib/datedStockCountApply.ts'), decisions = current.load('lib/datedStockCountDecisions.ts'), edit = current.load('lib/stockInLineEdit.ts'), integrity = current.load('lib/dataIntegrity.ts'), executor = current.load('lib/stockTransaction.ts');
        const permits = async () => check((await one("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'")).n === 0, 'no durable permit');
        const physical = async () => JSON.stringify(await Promise.all(['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'inventory_movements', 'dated_stock_count_batch_actions', 'stock_lot_adjustment_operations', 'action_history', 'audit_logs'].map(async (t) => (await raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()).results)));
        const empty = { movementsToDelete: [], supersededMovements: [], groupFingerprints: [], movementsToCreate: [], finalBranchStock: [], batchTopUps: [], batchCreates: [], batchDrains: [], batchDeactivations: [] };
        const plan = { ...empty, groupFingerprints: [{ productId: 1, branchId: 1, movementCount: 0, movementIdSum: 0 }], movementsToCreate: [{ productId: 1, productName: 'Count', branchId: 1, branchName: 'Shop', date: '2026-10-01', quantity: 2, movementType: 'add', reason: 'Dated stock count import', batchActions: [] }], finalBranchStock: [{ productId: 1, branchId: 1, quantity: 12 }] };
        let before = await physical();
        let oldCountSize;
        const oldCountDb = Object.create(db);
        oldCountDb.batch = ss => { oldCountSize = ss.length; return db.batch(ss); };
        await assert.rejects(() => old.load('lib/datedStockCountApply.ts').applyDatedStockCountPlan(oldCountDb, plan), /stock_transaction_required/);
        assert.equal(await physical(), before);
        checks++;
        await permits();
        let countSize;
        const measuredCountDb = Object.create(db);
        measuredCountDb.batch = ss => { countSize = ss.length; return db.batch(ss); };
        const counted = await count.applyDatedStockCountPlan(measuredCountDb, plan);
        check(countSize === oldCountSize + 2, 'count guard cost adds2 preserving canonical guard');
        check(counted.movementsApplied === 1 && (await one('SELECT stock_quantity n FROM products WHERE id=1')).n === 12, 'dated count commits quantity and history');
        before = await physical();
        await assert.rejects(() => count.applyDatedStockCountPlan(db, plan), e => e instanceof count.DatedStockCountConflictError);
        assert.equal(await physical(), before);
        checks++;
        await permits();
        const prior = await one("SELECT id FROM inventory_movements WHERE product_id=1 AND reason='Dated stock count import'");
        const repeat = { ...plan, movementsToDelete: [prior.id], supersededMovements: [{ id: prior.id, productId: 1, branchId: 1, date: '2026-10-01', signedQuantity: 2 }], groupFingerprints: [{ productId: 1, branchId: 1, movementCount: 1, movementIdSum: prior.id }] };
        await count.applyDatedStockCountPlan(db, repeat);
        check((await one('SELECT stock_quantity n FROM products WHERE id=1')).n === 12, 'count reapply replaces its own prior effect');
        check((await one("SELECT COUNT(*) n FROM inventory_movements WHERE product_id=1 AND reason='Dated stock count import'")).n === 1, 'count retains one current historical effect');
        await permits();
        const currentPrior = await one("SELECT id FROM inventory_movements WHERE product_id=1 AND reason='Dated stock count import'");
        const lostCountPlan = { ...repeat, movementsToDelete: [currentPrior.id], supersededMovements: [{ id: currentPrior.id, productId: 1, branchId: 1, date: '2026-10-01', signedQuantity: 2 }], groupFingerprints: [{ productId: 1, branchId: 1, movementCount: 1, movementIdSum: currentPrior.id }], movementsToCreate: [{ ...plan.movementsToCreate[0], quantity: 3 }] };
        let countAckAttempts = 0;
        const lostCountRaw = new Proxy(raw, { get(target, key) { if (key === 'batch')
                return async (ss) => { const result = await target.batch(ss); if (!countAckAttempts++)
                    throw Error('D1_ERROR: network lost acknowledgement'); return result; }; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
        let countFailure;
        try {
            await count.applyDatedStockCountPlan(new (current.load('lib/db.ts').D1Compat)(lostCountRaw), lostCountPlan);
        }
        catch (error) {
            countFailure = error;
        }
        check(countFailure instanceof count.DatedStockCountConflictError && (await one('SELECT stock_quantity n FROM products WHERE id=1')).n === 13, 'lostACK count refuses stale retry after one committed effect');
        check(!countFailure.message.includes('Nothing was changed'), 'count refusal does not falsely deny first-attempt commit');
        await permits();
        const unresolved = (row, name) => ({ rowNumber: row, reason: 'product_not_found', suggestedActions: ['create_new'], branchId: 1, raw: { productName: name, date: '2026-10-01', count: 0, sku: 'SKU' + row, sellingPriceUsd: 5, sellingPriceKhr: 20000 } });
        await assert.rejects(() => old.load('lib/datedStockCountDecisions.ts').applyDatedStockCountDecisions(db, [], [unresolved(2, 'Old create')], [{ rowNumber: 2, action: 'create_new' }]), /stock_transaction_required/);
        checks++;
        const made = await decisions.applyDatedStockCountDecisions(db, [], [unresolved(3, 'Decision identity')], [{ rowNumber: 3, action: 'create_new' }]);
        check(made.productsCreated.length === 1 && made.resolved[0].productId === made.productsCreated[0].productId, 'decision result keeps actual inserted row id');
        check((await one('SELECT name FROM products WHERE id=?', made.productsCreated[0].productId)).name === 'Decision identity', 'decision product identity exists');
        await permits();
        const childRow = { ...unresolved(4, 'Different child'), reason: 'ambiguous_name', suggestedActions: ['link_variant', 'create_child'], candidateProductIds: [1] };
        const child = await decisions.applyDatedStockCountDecisions(db, [], [childRow], [{ rowNumber: 4, action: 'create_child', candidateProductId: 1 }]);
        check(child.productsCreated.length === 1 && (await one('SELECT name FROM products WHERE id=?', child.productsCreated[0].productId)).name === 'Count', 'create_child locked name and actual inserted row id');
        await permits();
        const oldRepair = await old.load('lib/dataIntegrity.ts').runDataIntegrityCheck(env, true);
        check(oldRepair.details.stock.repairs > 0 && oldRepair.details.stock.errors.some(s => s.includes('stock_transaction_required')) && (await one('SELECT stock_quantity n FROM products WHERE id=90')).n === 999, 'old repair swallows refusal and reports planned repairs');
        const repaired = await integrity.runDataIntegrityCheck(env, true);
        check(repaired.details.stock.repairs === 1 && (await one('SELECT stock_quantity n FROM products WHERE id=90')).n === 5, 'new repair commits actual cache correction');
        await permits();
        const revision = async () => Number((await one("SELECT COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='batch' AND entity_key='200'),0) n")).n);
        const request = async (id, quantity, extra = {}) => ({ client_request_id: id, quantity, expected_batch_revision: await revision(), reason: 'Native stock edit', ...extra });
        const oldRequest = await request('ledger_old_edit', 12);
        before = await physical();
        let oldBatchSize;
        const oldMeasured = Object.create(db);
        oldMeasured.batch = ss => { oldBatchSize = ss.length; return db.batch(ss); };
        const oldEdit = await old.load('lib/stockInLineEdit.ts').applyStockInLineEdit(oldMeasured, current.USER, 200, oldRequest);
        check(oldEdit.status !== 200, 'old line edit refused by actual0243');
        assert.equal(await physical(), before);
        checks++;
        await permits();
        const forwardRequest = await request('ledger_forward_edit', 12);
        let forwardBatchSize;
        const forwardMeasured = Object.create(db);
        forwardMeasured.batch = ss => { forwardBatchSize = ss.length; return db.batch(ss); };
        const forward = await edit.applyStockInLineEdit(forwardMeasured, current.USER, 200, forwardRequest);
        check(forwardBatchSize === oldBatchSize + 1, 'forward guard overhead net1 after ordinary suffix removal');
        check(forward.status === 200, JSON.stringify(forward));
        check((await one('SELECT stock_quantity n FROM products WHERE id=2')).n === 12, 'line forward quantity and cache');
        check((await one('SELECT COUNT(*) n FROM stock_lot_adjustment_operations WHERE request_id=?', forwardRequest.client_request_id)).n === 1, 'one line edit receipt');
        await permits();
        before = await physical();
        const replay = await edit.applyStockInLineEdit(db, current.USER, 200, forwardRequest);
        check(replay.status === 200 && replay.body.replayed === true, 'same-ID line replay');
        assert.equal(await physical(), before);
        checks++;
        const operation = await one('SELECT * FROM stock_lot_adjustment_operations WHERE request_id=?', forwardRequest.client_request_id), historyId = operation.history_id, payload = JSON.parse((await one('SELECT undo_payload FROM action_history WHERE id=?', historyId)).undo_payload);
        await edit.replayStockInLineEdit(env, current.USER, 'undo', historyId, 0, payload);
        check((await one('SELECT stock_quantity n FROM products WHERE id=2')).n === 10, 'line undo compensates');
        await edit.replayStockInLineEdit(env, current.USER, 'redo', historyId, 1, { ...payload, generation: 1 });
        check((await one('SELECT stock_quantity n FROM products WHERE id=2')).n === 12, 'line redo compensates');
        await permits();
        await raw.prepare("CREATE TRIGGER ledger_bridge_tail_failure BEFORE INSERT ON audit_logs WHEN NEW.action='stock_in_line_edit' BEGIN SELECT RAISE(ABORT,'injected_line_tail_failure'); END").run();
        before = await physical();
        const failed = await edit.applyStockInLineEdit(db, current.USER, 200, await request('ledger_rollback_edit', 13));
        check(failed.status !== 200, 'forced audit tail refusal');
        assert.equal(await physical(), before);
        checks++;
        await permits();
        await raw.prepare('DROP TRIGGER ledger_bridge_tail_failure').run();
        let ackBatches = 0;
        const lostRaw = new Proxy(raw, { get(target, key) { if (key === 'batch')
                return async (ss) => { const result = await target.batch(ss); if (!ackBatches++)
                    throw Error('D1_ERROR: network lost acknowledgement'); return result; }; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } }), lostDb = new (current.load('lib/db.ts').D1Compat)(lostRaw), lostRequest = await request('ledger_lost_ack_edit', 13), lost = await edit.applyStockInLineEdit(lostDb, current.USER, 200, lostRequest);
        check(lost.status === 200, 'lostACK recovered original receipt');
        check((await one('SELECT stock_quantity n FROM products WHERE id=2')).n === 13 && (await one('SELECT COUNT(*) n FROM stock_lot_adjustment_operations WHERE request_id=?', lostRequest.client_request_id)).n === 1, 'lostACK exactly one edit and delta');
        before = await physical();
        await edit.applyStockInLineEdit(db, current.USER, 200, lostRequest);
        assert.equal(await physical(), before);
        checks++;
        await permits();
        let unkeyedAttempts = 0;
        const unkeyedRaw = new Proxy(raw, { get(target, key) { if (key === 'batch')
                return async (ss) => { const result = await target.batch(ss); if (!unkeyedAttempts++)
                    throw Error('D1_ERROR: network lost acknowledgement'); return result; }; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
        const unkeyedDb = new (current.load('lib/db.ts').D1Compat)(unkeyedRaw);
        await decisions.applyDatedStockCountDecisions(unkeyedDb, [], [unresolved(81, 'Unkeyed recovery probe')], [{ rowNumber: 81, action: 'create_new' }]);
        check(unkeyedAttempts === 2, 'decision retains original retry-batch policy');
        console.log('UNKEYED_RECOVERY_GAP ' + JSON.stringify({ attempts: unkeyedAttempts, products: (await one("SELECT COUNT(*) n FROM products WHERE name='Unkeyed recovery probe'")).n }));
        await permits();
        const shapeRaw = new Proxy(raw, { get(target, key) { if (key === 'batch')
                return async (ss) => { await target.batch(ss); return []; }; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
        const shapeRequest = await request('ledger_unknown_shape', 13, { supplier_name: 'Shape Supplier' });
        const shape = await edit.applyStockInLineEdit(new (current.load('lib/db.ts').D1Compat)(shapeRaw), current.USER, 200, shapeRequest);
        check(shape.status === 200 && shape.body.replayed === true, 'unknown result resolved only by exact committed receipt');
        check((await one('SELECT COUNT(*) n FROM stock_lot_adjustment_operations WHERE request_id=?', shapeRequest.client_request_id)).n === 1, 'unknown result one exact receipt');
        const noResultRaw = new Proxy(raw, { get(target, key) { if (key === 'batch')
                return async () => []; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
        before = await physical();
        const currentRevision = await revision();
        await assert.rejects(() => edit.applyStockInLineEdit(new (current.load('lib/db.ts').D1Compat)(noResultRaw), current.USER, 200, { ...shapeRequest, client_request_id: 'ledger_no_receipt_shape', supplier_name: 'Absent Supplier', expected_batch_revision: currentRevision }), e => e.code === 'stock_transaction_outcome_unknown');
        assert.equal(await physical(), before);
        checks++;
        await permits();
        const metadataRequest = await request('ledger_supplier_edit', 13, { supplier_name: 'New Supplier' });
        const metadataEdit = await edit.applyStockInLineEdit(db, current.USER, 200, metadataRequest);
        check(metadataEdit.status === 200, 'supplier edit forward');
        const metadataOperation = await one('SELECT history_id FROM stock_lot_adjustment_operations WHERE request_id=?', metadataRequest.client_request_id);
        const metadataPayload = JSON.parse((await one('SELECT undo_payload FROM action_history WHERE id=?', metadataOperation.history_id)).undo_payload);
        await raw.prepare("UPDATE system_flags SET value='wrong' WHERE key='stock_schema_epoch'").run();
        await edit.replayStockInLineEdit(env, current.USER, 'undo', metadataOperation.history_id, 0, metadataPayload);
        check((await one('SELECT supplier_name FROM product_batches WHERE id=200')).supplier_name === 'Shape Supplier', 'metadata-only line undo available under wrong epoch');
        await raw.prepare("UPDATE system_flags SET value='legacy-separate-pool-v1' WHERE key='stock_schema_epoch'").run();
        await permits();
        await executor.executeStockTransaction(db, [{ sql: 'UPDATE products SET stock_quantity=999 WHERE id=90' }], 'retry');
        for (const [epoch, held] of [['wrong', false], [null, false], ['legacy-separate-pool-v1', true]]) {
            await raw.prepare("DELETE FROM system_flags WHERE key IN ('stock_schema_epoch','maintenance')").run();
            if (epoch)
                await raw.prepare("INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch',?)").bind(epoch).run();
            if (held)
                await executor.executeStockTransaction(db, [{ sql: "INSERT INTO system_flags(key,value) VALUES('maintenance','{}')" }], 'retry');
            before = await physical();
            const blockedRequest = await request('blocked_' + checks, 14);
            await assert.rejects(() => decisions.applyDatedStockCountDecisions(db, [], [unresolved(80, 'Blocked identity')], [{ rowNumber: 80, action: 'create_new' }]), e => e.code === 'stock_schema_unavailable');
            await assert.rejects(() => integrity.runDataIntegrityCheck(env, true), e => e.code === 'stock_schema_unavailable');
            await assert.rejects(() => edit.applyStockInLineEdit(db, current.USER, 200, blockedRequest), e => e.code === 'stock_schema_unavailable');
            assert.equal(await physical(), before);
            checks++;
            await permits();
            const verified = await integrity.runDataIntegrityCheck(env, false);
            check(verified.action === 'verify-only' && (await one('SELECT stock_quantity n FROM products WHERE id=90')).n === 999, 'verify-only remains read-only under refusal');
            const resolved = [{ rowNumber: 50, productId: 1, branchId: 1, date: '2026-10-01', count: 12, priceConflict: { currentUsd: 5, currentKhr: 20000, importedUsd: 6, importedKhr: 24000, suggestedResolution: 'apply_new' } }];
            await decisions.applyDatedStockCountDecisions(db, resolved, [], [{ rowNumber: 50, action: 'skip', priceResolution: 'apply_new' }]);
            check((await one('SELECT selling_price_usd n FROM products WHERE id=1')).n === 6, 'metadata price remains available');
            check((await count.applyDatedStockCountPlan(db, empty)).movementsApplied === 0, 'empty count truthful no-op');
            await raw.prepare("DELETE FROM system_flags WHERE key IN ('stock_schema_epoch','maintenance')").run();
            await raw.prepare("INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch','legacy-separate-pool-v1')").run();
        }
        console.log(`PASS ${checks} ledger-writer actual0243 native checks`);
    }
    finally {
        await mf.dispose();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
