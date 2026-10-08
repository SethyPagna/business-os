const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const { Miniflare, Log, LogLevel } = require('miniflare'), { unstable_splitSqlQuery: split } = require('wrangler');
const fixture = fs.readFileSync(path.join(__dirname, 'test-sale-receipt-number-race-native.cjs'), 'utf8').split(';(async () => {')[0];
function harness(old = false) { let code = fixture.replace("if (BASELINE && rel === 'routes/sales.ts')", "if (BASELINE && ['lib/productWrites.ts','lib/importEngine.ts','lib/reviewApply.ts','routes/products.ts'].includes(rel))").replace("const BASELINE = process.env.RECEIPT_RACE_BASELINE || ''", `const BASELINE = '${old ? '9dec3a3ab906ee2183db81f4205cb56f38a417ff' : ''}'`); return new Function('require', '__dirname', code + '\nreturn {load,overrides};')(require, __dirname); }
const current = harness(), metrics = current.load('lib/requestMetrics.ts'), metricHook = globalThis[Symbol.for('business-os.request-metrics.v1')], old = harness(true), root = path.join(__dirname, '..');
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; };
;
(async () => {
    const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-07-19', d1Databases: ['DB'], port: 0, log: new Log(LogLevel.ERROR) });
    try {
        const raw = await mf.getD1Database('DB');
        for (const name of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql') && Number(n.slice(0,4)) <= 242).sort()) {
            const ss = split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8')).filter(sql => !(name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())));
            for (let i = 0; i < ss.length; i += 50)
                await raw.batch(ss.slice(i, i + 50).map(sql => raw.prepare(sql)));
        }
        await raw.batch([raw.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Warehouse',0,1)"), raw.prepare("INSERT INTO products(id,name,stock_quantity,is_active,updated_at) VALUES(1,'Old empty',0,1,'2000-01-01'),(2,'Held stock',2,1,'2099-01-01')"), raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,2)')]);
        for (const name of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql') && Number(n.slice(0,4)) > 242).sort())
            await raw.batch(split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8')).map(sql => raw.prepare(sql)));
        let physical = 0;
        const wrap = st => new Proxy(st, { get(target,key) {
            if (key === 'bind') return (...v) => wrap(target.bind(...v));
            if (['all','first','run'].includes(key)) return (...v) => { physical++; return target[key](...v); };
            const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
        } });
        const binding = new Proxy(raw, { get(target,key) {
            if(key === 'prepare') return sql => wrap(target.prepare(sql));
            if(key === 'batch') return ss => { physical+=ss.length; return target.batch(ss); };
            const value=Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
        } });
        const invoke = async work => { const priorHook=globalThis[Symbol.for('business-os.request-metrics.v1')];
            globalThis[Symbol.for('business-os.request-metrics.v1')]=metricHook;
            try { return await metrics.runBackground(undefined,'product-schema-finalizer',async()=>{
                const before=physical; try{return await work()}finally{
                    const attempts=physical-before; assert.equal(metrics.currentRequestMetrics().invocation.attemptedStatements,attempts);
                    assert.ok(attempts<=1000); await permits(); console.log('MEASURED schema finalizer '+attempts);
                }
            }); } finally {globalThis[Symbol.for('business-os.request-metrics.v1')]=priorHook;}
        };
        let finalRun = 0;
        const finalContext = async phase => { const id='schema-finalize-'+ ++finalRun;
            const state={startedAtMs:Date.now(),genericApply:{window:1,finalize:{phase,product:0,branch:0,deactivated:0,reconciled:0,unified:0}}};
            const context={jobId:id,leaseToken:'schema-holder',state,queued:true};
            await raw.prepare(`INSERT INTO import_jobs(id,type,status,lease_token,lease_expires_at,chunk_state_json)
                VALUES(?,'products','applying',?,?,?)`).bind(id,context.leaseToken,new Date(Date.now()+3600000).toISOString(),JSON.stringify(state)).run();
            return context;
        };
        const one = async (sql, ...v) => raw.prepare(sql).bind(...v).first(), permits = async () => check((await one("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'")).n === 0, 'no durable permit');
        const env = { DB: binding }, db = new (current.load('lib/db.ts').D1Compat)(binding), writes = current.load('lib/productWrites.ts'), imports = current.load('lib/importEngine.ts');
        await assert.rejects(() => old.load('lib/productWrites.ts').insertRow(env, 'products', { name: 'Old writer' }, { is_active: 1 }), /stock_transaction_required/);
        checks++;
        await permits();
        const id = await writes.insertRow(env, 'products', { name: 'Raw identity' }, { is_active: 1 });
        check(id > 2, 'raw identity RETURNING meta preserved');
        await permits();
        await writes.seedBranchStockForNewProduct(env, id, 1, 0);
        await writes.seedInitialBatchForNewProduct(env, id, 1, 0);
        check((await one('SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=?', id)).n === 1, 'initial identity and branches seeded');
        await permits();
        const created = await writes.createProductWithInitialStock(env, { name: 'Opening stock', stock_quantity: 3, branch_id: 1 }, { is_active: 1 });
        check(created.item.stock_quantity === 3, 'whole create opening quantity');
        check((await one('SELECT SUM(quantity) n FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id=?', created.id)).n === 3, 'whole create lot quantity');
        await permits();
        const group = [{ sql: 'UPDATE branch_stock SET quantity=quantity+1 WHERE product_id=2 AND branch_id=1', params: {} }, { sql: 'UPDATE products SET stock_quantity=stock_quantity+1 WHERE id=2', params: {} }];
        await assert.rejects(() => old.load('lib/importEngine.ts').runD1BatchGroupsInChunks(db, [group], 5, true), /stock_transaction_required/);
        checks++;
        await imports.runD1BatchGroupsInChunks(db, [group], 5, true);
        check((await one('SELECT stock_quantity n FROM products WHERE id=2')).n === 3, 'physical import group works');
        await permits();
        const stockBefore = (await one('SELECT stock_quantity n FROM products WHERE id=2')).n, branchBefore = (await one('SELECT quantity n FROM branch_stock WHERE product_id=2 AND branch_id=1')).n;
        await assert.rejects(() => imports.runD1BatchGroupsInChunks(db, [[...group, { sql: "SELECT json_extract('[1]','$[injected_group_tail_failure]')", params: {} }]], 6, true), /injected_group_tail_failure/);
        check((await one('SELECT stock_quantity n FROM products WHERE id=2')).n === stockBefore && (await one('SELECT quantity n FROM branch_stock WHERE product_id=2 AND branch_id=1')).n === branchBefore, 'whole group tail rolls back both quantity writes');
        await permits();
        let counts = [];
        const measured = { batch: async (ss) => { counts.push(ss.length); return db.batch(ss); } };
        await imports.runD1BatchGroupsInChunks(measured, [group, group], 5, true);
        assert.deepEqual(counts, [4, 4]);
        checks++;
        await assert.rejects(() => imports.runD1BatchGroupsInChunks(measured, [group], 3, true), /statement_budget/);
        checks++;
        await raw.prepare("CREATE TRIGGER product_bridge_test_failure AFTER INSERT ON branch_batch_stock WHEN NEW.quantity=7 BEGIN SELECT RAISE(ABORT,'injected_product_tail_failure'); END").run();
        const before = (await one('SELECT COUNT(*) n FROM products')).n;
        await assert.rejects(() => writes.createProductWithInitialStock(env, { name: 'Rollback', stock_quantity: 7, branch_id: 1 }, { is_active: 1 }), e => e.code === 'product_create_outcome_unknown');
        check((await one('SELECT COUNT(*) n FROM products')).n === before, 'create rollback includes header');
        await permits();
        await raw.prepare('DROP TRIGGER product_bridge_test_failure').run();
        current.overrides['./audit'] = { ...current.load('lib/audit.ts'), audit: async () => { } };
        current.overrides['./cache'] = current.overrides['../lib/cache'];
        const review = current.load('lib/reviewApply.ts'), reviewId = await writes.insertRow(env, 'products', { name: 'Review removal' }, { is_active: 1 });
        await review.applyApprovedPendingAction(env, { id: 900, section: 'products', action_type: 'delete', entity_type: 'product', entity_id: reviewId, payload_json: JSON.stringify({ reason: 'No stock' }) }, { id: 71, name: 'Reviewer' });
        check((await one('SELECT is_active n FROM products WHERE id=?', reviewId)).n === 0, 'actual review removal succeeds');
        await assert.rejects(() => review.applyApprovedPendingAction(env, { id: 901, section: 'products', action_type: 'delete', entity_type: 'product', entity_id: 2, payload_json: '{}' }, { id: 71, name: 'Reviewer' }), e => e.code === 'product_has_stock');
        check((await one('SELECT is_active n FROM products WHERE id=2')).n === 1, 'review cannot remove stock');
        await permits();
        let ackAttempts = 0;
        const lostRaw = new Proxy(raw, { get(target, key) { if (key === 'batch')
                return async (ss) => { ackAttempts++; const result = await target.batch(ss); throw Error('D1_ERROR: network lost acknowledgement'); }; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
        await assert.rejects(() => writes.createProductWithInitialStock({ DB: lostRaw }, { name: 'Lost ACK create', stock_quantity: 1, branch_id: 1 }, { is_active: 1 }), e => e.code === 'product_create_outcome_unknown');
        check(ackAttempts === 1, 'create once policy does not resend after lost ACK');
        check((await one("SELECT COUNT(*) n FROM products WHERE name='Lost ACK create'")).n === 1, 'lost ACK one product header');
        await permits();
        let replaceResults;
        const replaceRaw = new Proxy(binding, { get(target, key) { if (key === 'batch')
                return async (ss) => { replaceResults = await target.batch(ss); return replaceResults; }; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
        const replaceDb = new (current.load('lib/db.ts').D1Compat)(replaceRaw);
        const replacementContext = await finalContext('replace');
        const removed = await invoke(() => imports.finalizeProductReplacement(replaceDb, '2001-01-01', {jobId:replacementContext.jobId,finalize:replacementContext}));
        check(removed === Number(replaceResults[4].meta.changes), 'replace-all exact physical D1 removal result index includes permit and finalizer seal' );
        check((await one('SELECT is_active n FROM products WHERE id=1')).n === 0, 'replace-all empty removal');
        const refusedContext = await finalContext('replace');
        await assert.rejects(invoke(() => imports.finalizeProductReplacement(db, '2100-01-01', {jobId:refusedContext.jobId,finalize:refusedContext})), e => e.code === 'product_has_stock');
        checks++;
        await permits();
        const mergeA = await writes.createProductWithInitialStock(env, { name: 'Merge pair', stock_quantity: 1, branch_id: 1 }, { is_active: 1 }), mergeB = await writes.createProductWithInitialStock(env, { name: 'Merge pair', stock_quantity: 2, branch_id: 1 }, { is_active: 1 });
        current.overrides['../lib/audit'] = { ...current.load('lib/audit.ts'), audit: async () => { } };
        const products = current.load('routes/products.ts');
        await assert.rejects(() => old.load('routes/products.ts').foldDuplicateProductInto(env, db, null, { id: mergeA.id, name: 'Merge pair' }, { id: mergeB.id, name: 'Merge pair' }, new Map([[1, 'Shop'], [2, 'Warehouse']]), 'native-schema-proof'), /stock_transaction_required/);
        checks++;
        const folded = await products.foldDuplicateProductInto(env, db, null, { id: mergeA.id, name: 'Merge pair' }, { id: mergeB.id, name: 'Merge pair' }, new Map([[1, 'Shop'], [2, 'Warehouse']]), 'native-schema-proof');
        check(folded.quantityMoved === 2, 'actual merge moved exact duplicate quantity');
        check((await one('SELECT stock_quantity n FROM products WHERE id=?', mergeA.id)).n === 3 && (await one('SELECT is_active n FROM products WHERE id=?', mergeB.id)).n === 0, 'merge cache and identity commit together');
        await permits();
        await raw.batch([raw.prepare("INSERT INTO import_jobs(id,type,status) VALUES('snapshot','products','completed')"), ...[[2, 1], [3, 2]].map(([row, quantity]) => raw.prepare("INSERT INTO import_job_rows(job_id,phase,row_number,action,result_json) VALUES('snapshot','apply',?,'update',?)").bind(row, JSON.stringify({ existingId: mergeA.id, data: { branch_id: 1, stock_quantity: quantity, received_date: '2026-10-01' } })))]);
        await assert.rejects(() => old.load('lib/importEngine.ts').reconcileDuplicateProductSnapshotRows(db, 'snapshot'), /stock_transaction_required/);
        checks++;
        const snapshotContext = await finalContext('reconcile');
        await raw.prepare('UPDATE import_job_rows SET job_id=? WHERE job_id=?').bind(snapshotContext.jobId,'snapshot').run();
        check(await invoke(() => imports.reconcileDuplicateProductSnapshotRows(db, snapshotContext.jobId, snapshotContext)) === 0, 'first invocation persists actual snapshot digest');
        assert.match(snapshotContext.state.genericApply.finalize.pendingHash,/^[a-f0-9]{64}$/);
        check(await invoke(() => imports.reconcileDuplicateProductSnapshotRows(db, snapshotContext.jobId, snapshotContext)) === 1, 'next invocation reconciles whole group with exact digest and lease');
        check((await one('SELECT quantity n FROM branch_stock WHERE product_id=? AND branch_id=1', mergeA.id)).n === 3, 'snapshot branch quantity preserved');
        await permits();
        for (const [label, setup] of [['wrong epoch', "UPDATE system_flags SET value='other' WHERE key='stock_schema_epoch'"], ['missing epoch', "DELETE FROM system_flags WHERE key='stock_schema_epoch'"], ['held', "INSERT INTO system_flags(key,value) VALUES('maintenance','{}')"]]) {
            if (label === 'held')
                await current.load('lib/stockTransaction.ts').executeStockTransaction(db, [{ sql: setup }], 'retry');
            else
                await raw.prepare(setup).run();
            await assert.rejects(() => writes.insertRow(env, 'products', { name: label }, { is_active: 1 }), e => e.code === 'stock_schema_unavailable');
            checks++;
            await assert.rejects(() => imports.runD1BatchGroupsInChunks(db, [[{ sql: 'UPDATE products SET stock_quantity=stock_quantity WHERE id=-1', params: {} }]], 5, true), e => e.code === 'stock_schema_unavailable');
            checks++;
            await imports.runD1BatchGroupsInChunks(db, [[{ sql: 'UPDATE products SET description=@description WHERE id=2', params: { description: label } }]], 5);
            check((await one('SELECT description FROM products WHERE id=2')).description === label, 'metadata remains available');
            await permits();
            await raw.batch([raw.prepare("DELETE FROM system_flags WHERE key IN ('maintenance','stock_schema_epoch')"), raw.prepare("INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch','legacy-separate-pool-v1')")]);
        }
        console.log(`PASS ${checks} product/import native stock-schema checks`);
    }
    finally {
        await mf.dispose();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
