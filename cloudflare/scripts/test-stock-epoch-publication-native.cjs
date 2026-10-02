const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const entry = path.join(__dirname, 'test-stock-valuation-consumption-native.cjs');
const source = fs.readFileSync(entry, 'utf8');
const marker = '(async()=>{const section=process.env.STOCK_CONSUMPTION_SECTION;';
assert.equal(source.split(marker).length, 2);
const harness = new Module(entry, module);
harness.filename = entry;
harness.paths = Module._nodeModulePaths(path.dirname(entry));
harness._compile(source.slice(0, source.indexOf(marker)) + '\nmodule.exports={fixture,call,inventory,sales,saleBody,businessState,context};\n', entry);
const { fixture, call, inventory, businessState, sales, saleBody, context } = harness.exports;

function emptyProduct(f) {
  f.db.exec("INSERT INTO products(id,name,sku,stock_quantity,is_active,selling_price_usd,cost_price_usd) VALUES(11,'Receipt source witness','TOTAL20',0,1,5,1); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(11,1,0)");
}

function completeState(f) {
  return JSON.stringify([businessState(f), ...['action_history', 'undo_snapshots'].map(name => [name, f.db.prepare(`SELECT * FROM ${name} ORDER BY id`).all()])]);
}

const catalogRecompute = sql => /^\s*UPDATE products SET\s*cost_price_usd/.test(sql);

function receipt(request, quantity, payment = 'paid') {
  return { client_request_id: request, mode: 'stock_in', items: [{ line_id: 'first', kind: 'receive', product_id: 11, branch_id: 1, quantity, unit_cost_usd: 1, supplier_id: 77, supplier_name: 'Source supplier', received_date: '2026-10-02', payment_status: payment, ...(payment === 'credit' ? { credit_due_date: '2026-10-09' } : {}) }] };
}

async function admission() {
  const f = fixture();
  try {
    emptyProduct(f);
    const a = await call(f, inventory, '/sessions', receipt('epoch-seven', 7));
    assert.equal(a.status, 200, JSON.stringify(a));
    let lastStatement;
    f.hooks.beforeStatement = (db, statement, index) => { lastStatement = { index, sql: statement.sql, values: statement.values }; };
    const b = await call(f, inventory, '/sessions', receipt('epoch-thirteen', 13, 'credit'));
    assert.equal(b.status, 200, JSON.stringify({ response: b, lastStatement }));
    const sources = f.db.prepare('SELECT id,movement_id,batch_id,quantity,gross4,opening_paid4,opening_debt4 FROM stock_epoch_sources WHERE product_id=11 ORDER BY movement_id').all();
    assert.equal(sources.length, 2);
    assert.notEqual(sources[0].id, sources[1].id);
    assert.notEqual(sources[0].movement_id, sources[1].movement_id);
    assert.equal(sources[0].batch_id, sources[1].batch_id);
    assert.deepEqual(sources.map(s => [s.quantity, s.gross4, s.opening_paid4, s.opening_debt4]), [['7', 70000, 70000, 0], ['13', 130000, 0, 130000]]);
    assert.equal(f.db.prepare('SELECT payment_status FROM product_batches WHERE id=?').get(sources[0].batch_id).payment_status, 'paid');
    assert.equal(f.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(sources[0].batch_id).quantity, 20);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM stock_epoch_publications p JOIN stock_epoch_operations o ON o.id=p.operation_id WHERE o.protocol=2').get().n, 2);
    const before = businessState(f);
    const replay = await call(f, inventory, '/sessions', receipt('epoch-thirteen', 13, 'credit'));
    assert.equal(replay.status, 200, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(businessState(f), before);
    console.log('PASS actual same-lot receipt7 paid plus receipt13 credit: distinct sources, exact financial opening, stock20 and replay');
  } finally { f.db.close(); }
}

async function fractionalAdmission() {
  const f = fixture();
  try {
    emptyProduct(f);
    for (const [request, quantity, payment] of [['fraction-a', 1.25, 'paid'], ['fraction-b', 1.125, 'credit']]) {
      const body = receipt(request, quantity, payment);
      body.items[0].unit_cost_usd = 0.1234;
      const result = await call(f, inventory, '/sessions', body);
      assert.equal(result.status, 200, JSON.stringify(result));
    }
    const sources = f.db.prepare('SELECT quantity,gross4,opening_paid4,opening_debt4,typeof(gross4) AS gross_type,typeof(opening_paid4) AS paid_type,typeof(opening_debt4) AS debt_type FROM stock_epoch_sources WHERE product_id=11 ORDER BY movement_id').all();
    assert.deepEqual(sources.map(s => [s.quantity, s.gross4, s.opening_paid4, s.opening_debt4, s.gross_type, s.paid_type, s.debt_type]), [['1.25', 1543, 1543, 0, 'integer', 'integer', 'integer'], ['1.125', 1388, 0, 1388, 'integer', 'integer', 'integer']]);
    const lot = f.db.prepare('SELECT b.received_quantity,b.received_cost_usd,s.quantity FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=11').get();
    assert.deepEqual([lot.received_quantity, lot.received_cost_usd, lot.quantity], [2.375, 0.2931, 2.375]);
    console.log('PASS actual fractional receipts1.25 and1.125 at unit0.1234 preserve literal integer4 openings1543/1388 and totals2.375/2931');
  } finally { f.db.close(); }
}

async function decimalQuantity() {
  const f = fixture();
  try {
    emptyProduct(f);
    for (const [name, quantity] of [['decimal-a', 0.1], ['decimal-b', 0.2]]) {
      const body = receipt(name, quantity);
      body.items[0].unit_cost_usd = 0.1;
      const result = await call(f, inventory, '/sessions', body);
      assert.equal(result.status, 200, JSON.stringify(result));
    }
    const sources = f.db.prepare('SELECT quantity,gross4 FROM stock_epoch_sources WHERE product_id=11 ORDER BY movement_id').all();
    assert.deepEqual(sources.map(s => [s.quantity, s.gross4]), [['0.1', 100], ['0.2', 200]]);
    assert.equal(f.db.prepare('SELECT quantity FROM branch_stock WHERE product_id=11 AND branch_id=1').get().quantity, 0.1 + 0.2);
    assert.equal(f.db.prepare('SELECT received_cost_usd FROM product_batches WHERE variant_product_id=11').get().received_cost_usd, 0.03);
    console.log('PASS decimal quantities0.1 and0.2 retain exact source quantities and gross100/200; physical stock follows existing REAL addition');
  } finally { f.db.close(); }
}

async function rollback() {
  const template = fixture();
  let statements;
  try {
    emptyProduct(template);
    const result = await call(template, inventory, '/sessions', receipt('rollback-template', 7));
    assert.equal(result.status, 200, JSON.stringify(result));
    statements = template.batches.find(batch => batch.some(sql => /INSERT INTO stock_epoch_operations/.test(sql)));
    assert.ok(statements);
  } finally { template.db.close(); }
  const f = fixture();
  try {
    emptyProduct(f);
    const baseline = completeState(f);
    const previousError = console.error;
    let ignoredCount = 0;
    console.error = () => {};
    try {
      for (let index = 0; index < statements.length; index++) {
        f.hooks.failAt = index;
        const result = await call(f, inventory, '/sessions', receipt('rollback-attempt', 7));
        assert.notEqual(result.status, 200, `failure ignored at ${index}: ${statements[index]}`);
        assert.equal(completeState(f), baseline, `failure did not roll back at ${index}`);
      }
      delete f.hooks.failAt;
      for (const [index, sql] of statements.entries()) {
        if (catalogRecompute(sql)) continue;
        if (!/^\s*(INSERT INTO (stock_epoch_|stock_session_operations|stock_session_members|product_batches|branch_batch_stock|branch_stock|inventory_movements|audit_logs|action_history|undo_snapshots)|UPDATE (stock_session_operations|products|product_batches|branch_batch_stock|branch_stock|undo_snapshots))/.test(sql)) continue;
        f.hooks.skipAt = index;
        const result = await call(f, inventory, '/sessions', receipt('rollback-attempt', 7));
        assert.notEqual(result.status, 200, `write ignored at ${index}: ${sql}`);
        assert.equal(completeState(f), baseline, `ignored write did not roll back at ${index}`);
        ignoredCount++;
      }
    } finally { console.error = previousError; delete f.hooks.failAt; delete f.hooks.skipAt; }
    console.log(`PASS receipt rollback at all${statements.length} statement positions and all${ignoredCount} required ignored writes`);
  } finally { f.db.close(); }
}

async function redundantRecompute() {
  const f = fixture();
  try {
    emptyProduct(f);
    f.db.exec('UPDATE products SET cost_price_usd=9,purchase_price_usd=9 WHERE id=11');
    for (const [name, quantity, cost, expected] of [['redundant-a', 7, 1, 1], ['redundant-b', 13, 3, 2.3]]) {
      let observed;
      f.hooks.beforeBatch = (db, statements) => {
        f.hooks.skipAt = statements.findIndex(statement => catalogRecompute(statement.sql));
        assert.ok(f.hooks.skipAt >= 0);
      };
      f.hooks.beforeStatement = (db, statement) => {
        if (/INSERT INTO stock_session_members/.test(statement.sql)) observed = db.prepare('SELECT cost_price_usd,purchase_price_usd FROM products WHERE id=11').get();
      };
      const body = receipt(name, quantity);
      body.items[0].unit_cost_usd = cost;
      const result = await call(f, inventory, '/sessions', body);
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.deepEqual([observed.cost_price_usd, observed.purchase_price_usd], [expected, expected]);
      const after = f.db.prepare('SELECT cost_price_usd,purchase_price_usd FROM products WHERE id=11').get();
      assert.deepEqual([after.cost_price_usd, after.purchase_price_usd], [expected, expected]);
    }
    console.log('CLASSIFIED redundant explicit catalog recompute: actual triggers change initial9 to1 and then weighted2.3 before the skipped statement; not counted as caught omission');
  } finally { f.db.close(); }
}

async function malformedPublication() {
  const mutations = [
    ['unsupported operation', 'INSERT INTO stock_epoch_operations', "'stock_session'", "'pending'"],
    ['lowered source count', 'INSERT INTO stock_epoch_operations', /\?\d+,0,0,2,/, '1,0,0,2,'],
    ['fractional opening', 'INSERT INTO stock_epoch_sources', /(\?\d+),(\?\d+),(\?\d+),(\?\d+),NULL,/, '$1,$2+0.5,$3-0.5,$4,NULL,'],
    ['wrong gross', 'INSERT INTO stock_epoch_sources', /('0',)(\?\d+),/, '$1$2+1,'],
    ['malformed quantity', 'INSERT INTO stock_epoch_sources', /(\?\d+),'0',/, "($1||'junk'),'0',"],
    ['wrong quantity', 'INSERT INTO stock_epoch_sources', /(\?\d+),'0',/, "'8','0',"],
    ['unsupported event', 'INSERT INTO stock_epoch_events', "0,'admit',0", "0,'hold',0"],
  ];
  const previousError = console.error;
  console.error = () => {};
  try {
    for (const [label, prefix, before, after] of mutations) {
      const f = fixture();
      try {
        emptyProduct(f);
        const body = receipt(`malformed-${label.replaceAll(' ', '-')}`, 7, 'credit');
        if (label === 'lowered source count') {
          f.db.exec("INSERT INTO products(id,name,sku,stock_quantity,is_active,selling_price_usd,cost_price_usd) VALUES(12,'Second source','SECOND',0,1,5,1); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(12,1,0)");
          body.items.push({ ...body.items[0], line_id: 'second', product_id: 12 });
        }
        const baseline = completeState(f), prepare = f.d1.prepare;
        let activated = 0;
        f.d1.prepare = sql => {
          if (sql.startsWith(prefix)) {
            assert.equal(before instanceof RegExp ? [...sql.matchAll(new RegExp(before.source, 'g'))].length : sql.split(before).length - 1, 1, `${label}: ${sql}`);
            activated++;
            sql = sql.replace(before, after);
          }
          return prepare(sql);
        };
        const result = await call(f, inventory, '/sessions', body);
        assert.ok(activated > 0, `${label} mutation inactive`);
        assert.notEqual(result.status, 200, `${label} published`);
        assert.equal(completeState(f), baseline, `${label} changed business state`);
      } finally { f.db.close(); }
    }
  } finally { console.error = previousError; }
  console.log(`PASS all${mutations.length} activated malformed operation/source/event mutations reject atomically`);
}

async function permissionAndClosure() {
  const f = fixture();
  try {
    emptyProduct(f);
    const body = receipt('permission-replay', 7);
    const admitted = await call(f, inventory, '/sessions', body);
    assert.equal(admitted.status, 200, JSON.stringify(admitted));
    const event = f.db.prepare('SELECT e.id,s.id AS source FROM stock_epoch_events e JOIN stock_epoch_sources s ON s.id=e.source_id WHERE s.product_id=11').get();
    const baseline = completeState(f);
    assert.throws(() => f.db.prepare("INSERT INTO stock_epoch_segments(event_id,segment_id,allocation_id,fate,quantity,gross4,coverage4,loss4,recovery4,reason,consumed_cost4,consumed_recovery4,source_id,branch_id) VALUES(?,'late','late','sellable','1',10000,0,0,0,'',0,0,?,1)").run(event.id, event.source), /publication closed/);
    assert.equal(completeState(f), baseline);
    f.db.exec("UPDATE users SET permissions='{}' WHERE id=71");
    const replay = await call(f, inventory, '/sessions', body);
    assert.equal(replay.status, 403, JSON.stringify(replay));
    assert.equal(completeState(f), baseline);
  } finally { f.db.close(); }
  for (const statement of ["UPDATE users SET permissions='{}' WHERE id=71", 'UPDATE users SET is_active=0 WHERE id=71', "INSERT INTO system_flags(key,value) VALUES('maintenance','{}')"]) {
    const f = fixture();
    try {
      emptyProduct(f);
      const before = completeState(f);
      f.hooks.beforeBatch = db => db.exec(statement);
      const previousError = console.error;
      console.error = () => {};
      let result;
      try { result = await call(f, inventory, '/sessions', receipt('authority-race', 7)); }
      finally { console.error = previousError; }
      assert.notEqual(result.status, 200, statement);
      assert.equal(completeState(f), before, statement);
    } finally { f.db.close(); }
  }
  console.log('PASS closed publication rejects late child; replay rechecks permissions; permission, inactive actor and maintenance races roll back');
}

async function disabledOrdinaryRoutes() {
  const f = fixture();
  const ordinary = async (app, url, body) => {
    const response = await app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { DB: f.d1, PLAN_TIER: 'paid', CACHE: { get: async () => null, put: async () => {} } }, context);
    return { status: response.status, data: await response.json() };
  };
  try {
    emptyProduct(f);
    f.db.exec('UPDATE products SET selling_price_usd=20 WHERE id=11');
    for (const cost of [7, 13]) {
      const body = receipt(`disabled-${cost}`, 1);
      body.items[0].unit_cost_usd = cost;
      const result = await ordinary(inventory, '/sessions', body);
      assert.equal(result.status, 200, JSON.stringify(result));
    }
    const lots = f.db.prepare('SELECT batch_id FROM inventory_movements WHERE product_id=11 ORDER BY id').all();
    assert.equal(lots.length, 2);
    assert.notEqual(lots[0].batch_id, lots[1].batch_id);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM stock_epoch_sources WHERE product_id=11').get().n, 0);
    const body = saleBody(null);
    Object.assign(body.items[0], { product_id: 11, quantity: 2, price_usd: 20, price_khr: 80000 });
    delete body.items[0].batch_id;
    const result = await ordinary(sales, '/', body);
    assert.equal(result.status, 200, JSON.stringify(result));
    const item = f.db.prepare('SELECT quantity,cost_price_usd,total_usd FROM sale_items WHERE product_id=11').get();
    assert.deepEqual([item.quantity * item.cost_price_usd, item.total_usd], [20, 40]);
    console.log('PASS disabled default preserves real different-cost lots and ordinary FIFO acquisition cost20/retail40');
  } finally { f.db.close(); }
}

async function physicalPartition() {
  const f = fixture();
  try {
    emptyProduct(f);
    const body = receipt('partition-receipt', 2);
    body.items[0].unit_cost_usd = 10;
    const admitted = await call(f, inventory, '/sessions', body);
    assert.equal(admitted.status, 200, JSON.stringify(admitted));
    const source = f.db.prepare('SELECT id,batch_id FROM stock_epoch_sources WHERE product_id=11').get();
    const held = await call(f, inventory, '/valuation-experiment', { kind: 'hold', source_id: source.id, expected_revision: 0, expected_generation: 0, client_request_id: 'partition-hold', segment_id: 'origin', child_segment_id: 'x', quantity: 1, reason: 'broken' });
    assert.equal(held.status, 200, JSON.stringify(held));
    const leaves = f.db.prepare('SELECT g.segment_id,g.fate,g.quantity,g.gross4,g.coverage4 FROM stock_epoch_current_fragments h JOIN stock_epoch_segments g ON g.event_id=h.event_id AND g.segment_id=h.segment_id WHERE h.source_id=? ORDER BY g.segment_id').all(source.id);
    assert.deepEqual(leaves.map(g => [g.segment_id, g.fate, g.quantity, g.gross4, g.coverage4]), [['x', 'held', '1', 100000, 0], ['x-remaining', 'sellable', '1', 100000, 0]]);
    assert.equal(f.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(source.batch_id).quantity, 1);
    const repaired = await call(f, inventory, '/valuation-experiment', { kind: 'repair', source_id: source.id, expected_revision: 1, expected_generation: 0, client_request_id: 'partition-repair', segment_id: 'x', child_segment_id: 'x-repaired', quantity: 1 });
    assert.equal(repaired.status, 200, JSON.stringify(repaired));
    assert.equal(f.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(source.batch_id).quantity, 2);
    console.log('PASS actual receipt hold/repair partitions one distinct source preimage and preserves both exact child bases');
  } finally { f.db.close(); }
}

async function fractionalPartition() {
  const f = fixture();
  try {
    emptyProduct(f);
    const body = receipt('fractional-partition-receipt', 0.3);
    body.items[0].unit_cost_usd = 0.1;
    assert.equal((await call(f, inventory, '/sessions', body)).status, 200);
    const source = f.db.prepare('SELECT id,batch_id FROM stock_epoch_sources WHERE product_id=11').get();
    const held = await call(f, inventory, '/valuation-experiment', { kind: 'hold', source_id: source.id, expected_revision: 0, expected_generation: 0, client_request_id: 'fractional-partition-hold', segment_id: 'origin', child_segment_id: 'x', quantity: 0.1, reason: 'broken' });
    assert.equal(held.status, 200, JSON.stringify(held));
    const leaves = f.db.prepare('SELECT g.segment_id,g.quantity,g.gross4 FROM stock_epoch_current_fragments h JOIN stock_epoch_segments g ON g.event_id=h.event_id AND g.segment_id=h.segment_id WHERE h.source_id=? ORDER BY g.segment_id').all(source.id);
    assert.deepEqual(leaves.map(g => [g.segment_id, g.quantity, g.gross4]), [['x', '0.1', 100], ['x-remaining', '0.2', 200]]);
    assert.equal(f.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(source.batch_id).quantity, 0.2);
    console.log('PASS fractional hold partitions0.3 into exact0.1/0.2 and basis100/200 without REAL sum drift');
  } finally { f.db.close(); }
}

async function partitionFixture() {
  const f = fixture();
  emptyProduct(f);
  const body = receipt('partition-fixture', 2);
  body.items[0].unit_cost_usd = 10;
  assert.equal((await call(f, inventory, '/sessions', body)).status, 200);
  const source = f.db.prepare('SELECT id,batch_id FROM stock_epoch_sources WHERE product_id=11').get();
  f.command = { kind: 'hold', source_id: source.id, expected_revision: 0, expected_generation: 0, client_request_id: 'partition-fault-hold', segment_id: 'origin', child_segment_id: 'x', quantity: 1, reason: 'broken' };
  const batch = f.d1.batch;
  f.hooks.beforeStatement = (db, statement, index) => { f.lastStatement = { index, sql: statement.sql }; };
  f.d1.batch = async statements => {
    try { return await batch(statements); }
    catch (error) { f.failure = { message: error.message, lastStatement: f.lastStatement }; throw error; }
  };
  return f;
}

async function partitionRollback() {
  const template = await partitionFixture();
  let statements;
  try {
    const result = await call(template, inventory, '/valuation-experiment', template.command);
    assert.equal(result.status, 200, JSON.stringify({result,failure:template.failure}));
    statements = template.batches.at(-1);
  } finally { template.db.close(); }
  const f = await partitionFixture();
  try {
    const before = completeState(f);
    for (let index = 0; index < statements.length; index++) {
      f.hooks.failAt = index;
      const result = await call(f, inventory, '/valuation-experiment', f.command);
      assert.notEqual(result.status, 200, `partition failure ${index}`);
      assert.equal(completeState(f), before, `partition failure rollback ${index}`);
    }
    delete f.hooks.failAt;
    let ignored = 0;
    for (const [index, sql] of statements.entries()) {
      if (!/^\s*(INSERT|UPDATE|DELETE)\b/.test(sql)) continue;
      f.hooks.skipAt = index;
      const result = await call(f, inventory, '/valuation-experiment', f.command);
      assert.notEqual(result.status, 200, `partition ignored write ${index}: ${sql}`);
      assert.equal(completeState(f), before, `partition ignored rollback ${index}`);
      ignored++;
    }
    delete f.hooks.skipAt;
    console.log(`PASS hold rollback all${statements.length} statement failures and all${ignored} omitted writes`);
  } finally { f.db.close(); }
}

async function partitionLostResponse() {
  const f = await partitionFixture();
  try {
    f.hooks.lost = true;
    const result = await call(f, inventory, '/valuation-experiment', f.command);
    assert.equal(result.status, 200, JSON.stringify({result,failure:f.failure,published:f.db.prepare("SELECT COUNT(*) AS n FROM stock_epoch_publications p JOIN stock_epoch_operations o ON o.id=p.operation_id WHERE o.kind='hold'").get().n}));
    assert.equal(result.data.replayed, true);
    const committed = completeState(f);
    const replay = await call(f, inventory, '/valuation-experiment', f.command);
    assert.equal(replay.status, 200, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(completeState(f), committed);
    console.log('PASS committed hold recovers a lost response and repeated replay without duplicate effects');
  } finally { f.db.close(); }
}

async function partitionTampering() {
  for (const kind of ['duplicate before', 'extra retired child', 'consistent false receipt']) {
    const f = await partitionFixture();
    try {
      const before = completeState(f);
      let activated = 0;
      if (kind === 'consistent false receipt') {
        const prepare = f.d1.prepare;
        f.d1.prepare = sql => {
          const statement = prepare(sql);
          return { ...statement, bind: (...values) => statement.bind(...values.map(value => {
            if (typeof value !== 'string' || !value.startsWith('{')) return value;
            let data;
            try { data = JSON.parse(value); } catch { return value; }
            if (data.protocol !== 2 || data.kind !== 'hold' || !data.totals) return value;
            activated++;
            data.totals.sellable_net4 = 0;
            return JSON.stringify(data);
          })) };
        };
      } else {
        const previous = f.hooks.beforeStatement;
        f.hooks.beforeStatement = (db, statement, index) => {
          previous(db, statement, index);
          if (!/^INSERT INTO stock_epoch_publications/.test(statement.sql)) return;
          activated++;
          const event = db.prepare("SELECT e.id FROM stock_epoch_events e JOIN stock_epoch_operations o ON o.id=e.operation_id WHERE o.kind='hold'").get().id;
          if (kind === 'duplicate before') db.prepare('INSERT OR REPLACE INTO stock_epoch_fragment_inputs SELECT * FROM stock_epoch_fragment_inputs WHERE event_id=?').run(event);
          else db.prepare("INSERT INTO stock_epoch_segments(event_id,segment_id,allocation_id,fate,quantity,gross4,coverage4,loss4,recovery4,reason,consumption_id,consumed_cost4,consumed_recovery4,source_id,branch_id,parent_segment_id) SELECT event_id,'unrequested',allocation_id,'retired','0',0,0,0,0,'',NULL,0,0,source_id,branch_id,parent_segment_id FROM stock_epoch_segments WHERE event_id=? AND segment_id='origin'").run(event);
        };
      }
      const result = await call(f, inventory, '/valuation-experiment', f.command);
      assert.ok(activated > 0, `${kind} inactive`);
      if (kind === 'consistent false receipt') assert.ok(activated >= 3, 'Command, receipt and audit JSON copies must all be altered');
      assert.notEqual(result.status, 200, `${kind} published`);
      assert.equal(completeState(f), before, `${kind} changed business state`);
    } finally { f.db.close(); }
  }
  console.log('PASS activated duplicate-before replacement, unrequested retired child and consistently falsified receipt/audit all reject atomically');
}

function mutateColumn(statement, column, value) {
  const match = statement.sql.match(/^INSERT INTO [^(]+\(([^)]+)\) VALUES\(([^)]+)\)/);
  assert.ok(match, statement.sql);
  const index = match[1].split(',').indexOf(column);
  assert.ok(index >= 0, column);
  const binding = match[2].split(',')[index].match(/^\?(\d+)$/);
  assert.ok(binding, column);
  statement.values[Number(binding[1]) - 1] = value;
}

async function proportionalMutation() {
  const f = await partitionFixture();
  try {
    const before = completeState(f);
    let activated = 0;
    f.hooks.beforeBatch = (db, statements) => {
      for (const statement of statements) {
        if (statement.sql.startsWith('INSERT INTO stock_epoch_segments')) {
          if (statement.values.includes('x') && statement.values.includes('held')) { mutateColumn(statement, 'gross4', 1); activated++; }
          else if (statement.values.includes('x-remaining')) { mutateColumn(statement, 'gross4', 199999); activated++; }
        }
        if (statement.sql.startsWith('INSERT INTO stock_epoch_source_states')) {
          mutateColumn(statement, 'sellable_net4', 199999);
          mutateColumn(statement, 'held_net4', 1);
          activated++;
        }
        for (const [index, value] of statement.values.entries()) {
          if (typeof value !== 'string' || !value.startsWith('{')) continue;
          let response;
          try { response = JSON.parse(value); } catch { continue; }
          if (response.protocol !== 2 || response.kind !== 'hold' || !response.totals) continue;
          response.totals.held_net4 = 1;
          response.totals.sellable_net4 = 199999;
          for (const fragment of response.changed_segments) fragment.gross4 = fragment.segment_id === 'x' ? 1 : 199999;
          statement.values[index] = JSON.stringify(response);
          activated++;
        }
      }
    };
    const result = await call(f, inventory, '/valuation-experiment', f.command);
    assert.equal(activated, 6);
    assert.equal(result.status, 409, 'F1 six-site conserved but misallocated basis published');
    assert.equal(completeState(f), before);
  } finally { f.db.close(); }
}

async function invalidTransitionQuantity() {
  const f = await partitionFixture();
  try {
    const before = completeState(f);
    for (const quantity of [0, -1, 3, 1000000001, 'bad', '0.0000000000000000000000001']) {
      const result = await call(f, inventory, '/valuation-experiment', { ...f.command, quantity });
      assert.equal(result.status, 400, `F2 quantity ${quantity}: ${JSON.stringify(result)}`);
      assert.equal(result.data.code, 'epoch_quantity_invalid');
      assert.equal(completeState(f), before);
    }
    const supported = await call(f, inventory, '/valuation-experiment', { ...f.command, quantity: '1' });
    assert.equal(supported.status, 200, JSON.stringify(supported));
  } finally { f.db.close(); }
}

async function sessionLostAuthority() {
  for (const revoke of [true, false]) {
    const f = fixture();
    try {
      emptyProduct(f);
      const body = receipt(`session-lost-authority-${revoke}`, 2);
      body.items[0].unit_cost_usd = 10;
      f.hooks.lost = true;
      const batch = f.d1.batch;
      let activated = 0;
      f.d1.batch = async statements => {
        try { return await batch(statements); }
        catch (error) {
          if (!f.db.isTransaction) {
            if (revoke) f.db.exec("UPDATE users SET permissions='{}' WHERE id=71");
            activated++;
          }
          throw error;
        }
      };
      const result = await call(f, inventory, '/sessions', body);
      assert.equal(activated, 1);
      assert.equal(result.status, revoke ? 403 : 200, `F3 ${JSON.stringify(result)}`);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stock_epoch_publications').get().n, 1);
      const committed = completeState(f);
      const replay = await call(f, inventory, '/sessions', body);
      assert.equal(replay.status, revoke ? 403 : 200);
      if (!revoke) assert.deepEqual(replay.data, result.data);
      assert.equal(completeState(f), committed);
    } finally { f.db.close(); }
  }
}

async function requestKindMutation() {
  const f = await partitionFixture();
  try {
    assert.equal((await call(f, inventory, '/valuation-experiment', f.command)).status, 200);
    const body = { kind: 'repair', source_id: f.command.source_id, expected_revision: 1, expected_generation: 0, client_request_id: 'kind-identity-repair', segment_id: 'x', child_segment_id: 'fixed', quantity: 1 };
    const before = completeState(f), crypto = require('node:crypto');
    const altered = { ...body, kind: 'hold', reason: 'tampered operation intent' };
    const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    let activated = 0;
    f.hooks.beforeBatch = (db, statements) => {
      for (const statement of statements) for (const [index, value] of statement.values.entries()) {
        if (value === digest(body)) { statement.values[index] = digest(altered); activated++; }
        if (value === JSON.stringify(body)) { statement.values[index] = JSON.stringify(altered); activated++; }
      }
    };
    const result = await call(f, inventory, '/valuation-experiment', body);
    assert.equal(activated, 4);
    assert.equal(result.status, 409, 'F4 matching-digest altered intent published');
    assert.equal(completeState(f), before);
  } finally { f.db.close(); }
}

async function guardRegressions() {
  const failures = [];
  for (const test of [proportionalMutation, invalidTransitionQuantity, sessionLostAuthority, requestKindMutation]) {
    try { await test(); console.log(`PASS ${test.name}`); }
    catch (error) { failures.push(`${test.name}: ${error.stack}`); }
  }
  assert.deepEqual(failures, []);
}

async function exactBasisSql() {
  const f = fixture();
  try {
    const migration = fs.readFileSync(path.join(__dirname, '../migrations/0218_stock_epoch_publication_guards.sql'), 'utf8');
    const start = migration.indexOf('WITH RECURSIVE\n'), end = migration.indexOf('\n)=2 THEN', start);
    assert.ok(start > 0 && end > start);
    const columns = 'operation_id,event_id,before_quantity,selected_quantity,before_gross4,before_coverage4,selected_gross4,selected_coverage4';
    const query = migration.slice(start, end).replace('WITH RECURSIVE\n', `WITH RECURSIVE stock_epoch_basis_inputs(${columns}) AS (VALUES('proof','event',?2,?3,?4,?5,?6,?7)),\n`).replaceAll('NEW.operation_id', '?1');
    const proof = f.db.prepare(query);
    const products = f.db.prepare(query.slice(0, query.lastIndexOf('SELECT COUNT(*) FROM floors')) + 'SELECT metric,side,position,carry,digits,typeof(carry) AS carry_type FROM products WHERE position=8 ORDER BY metric,side');
    const coefficients = f.db.prepare(query.slice(0, query.lastIndexOf('SELECT COUNT(*) FROM floors')) + 'SELECT COUNT(*) n,MAX(coefficient) maximum,MIN(typeof(coefficient)) minimum_type,MAX(typeof(coefficient)) maximum_type FROM coefficients');
    const scale = text => { const [whole, fraction = ''] = text.split('.'); return BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, '0')); };
    const examples = [
      ['3', '1', 70001, 0, 23333, 0],
      ['3', '2', 70001, 0, 46667, 0],
      ['2', '1', 46668, 0, 23334, 0],
      ['3', '1', 70001, 60001, 23333, 20000],
      ['3', '2', 70001, 1, 46667, 1],
      ['2', '1', 46668, 1, 23334, 1],
      ['0.000000000000000000000003', '0.000000000000000000000001', 70001, 60001, 23333, 20000],
      ['1000000000', '1000000000', 1000000000000000, 1, 1000000000000000, 1],
      ['1000000000', '999999999.999999', 1000000000000000, 999999999999999],
      ['999999999.123456', '0.000000000000000000000001', 1000000000000000, 0],
      ['0.3', '0.1', 0, 0, 0, 0],
    ];
    let seed = 1977;
    for (let index = 0; index < 100; index++) {
      seed = (seed * 48271) % 2147483647;
      const total = seed % 1000000 + 1, selected = seed % total + 1, gross = seed * 43217, covered = seed % (gross + 1);
      examples.push([String(total), String(selected), gross, covered]);
    }
    let mutations = 0;
    for (const [total, selected, gross, coverage, literalGross, literalCoverage] of examples) {
      const Q = scale(total), q = scale(selected), G = BigInt(gross), N = G - BigInt(coverage);
      const g = Number(G * q / Q), n = Number(N * q / Q), c = g - n;
      if (literalGross !== undefined) assert.deepEqual([g, c], [literalGross, literalCoverage]);
      const args = ['proof', total, selected, BigInt(gross), BigInt(coverage), BigInt(g), BigInt(c)];
      assert.equal(Object.values(proof.get(...args))[0], 2, `${total}/${selected}/${gross}/${coverage}`);
      const actualProducts = products.all(...args);
      assert.equal(actualProducts.length, 6);
      for (const row of actualProducts) {
        const sourceMoney = row.metric === 0 ? G : N, selectedMoney = BigInt(row.metric === 0 ? g : n);
        const expected = row.side === 1 ? sourceMoney * q : (selectedMoney + BigInt(row.side === 2 ? 1 : 0)) * Q;
        assert.equal(row.digits, String(expected).padStart(54, '0'));
        assert.equal(row.carry, 0);
        assert.equal(row.carry_type, 'integer');
      }
      const shape = coefficients.get(...args);
      assert.equal(shape.n, 48);
      assert.equal(shape.minimum_type, 'integer');
      assert.equal(shape.maximum_type, 'integer');
      assert.ok(shape.maximum < 3000000000000);
      if (g < gross) { assert.notEqual(Object.values(proof.get('proof', total, selected, BigInt(gross), BigInt(coverage), BigInt(g + 1), BigInt(c)))[0], 2); mutations++; }
      if (c < g) { assert.notEqual(Object.values(proof.get('proof', total, selected, BigInt(gross), BigInt(coverage), BigInt(g), BigInt(c + 1)))[0], 2); mutations++; }
    }
    for (const [from, to] of [["json_each('[0,1]') m", "json_each('[0]') m"], ["json_each('[0,1]') m", "json_each('[0,1,2]') m"], ["json_each('[0,1,2]') s", "json_each('[0,1]') s"], ["json_each('[0,1,2]') s", "json_each('[0,1,2,3]') s"]]) {
      assert.equal(query.split(from).length, 2);
      assert.notEqual(Object.values(f.db.prepare(query.replace(from, to)).get('proof', '3', '1', 70001n, 60001n, 23333n, 20000n))[0], 2);
    }
    console.log(`PASS exact SQL gross/net floor: ${examples.length} independent BigInt cases, ${mutations} wrong-basis controls, all6 product rows and48 bounded integer coefficients per case`);
  } finally { f.db.close(); }
}

async function basisDomainAndReceipt() {
  for (const quantity of ['', '1bad', '01', '1.', '1.0', '+1', '1e0', '1..0', '0.0000000000000000000000001', '1000000000.000000000000000000000001']) {
    const f = await partitionFixture();
    try {
      const before = completeState(f);
      let activated = 0;
      f.hooks.beforeBatch = (db, statements) => {
        for (const statement of statements) if (statement.sql.startsWith('INSERT INTO stock_epoch_segments') && statement.values.includes('held')) {
          mutateColumn(statement, 'quantity', quantity);
          activated++;
        }
      };
      const result = await call(f, inventory, '/valuation-experiment', f.command);
      assert.equal(activated, 1);
      assert.equal(result.status, 409, `SQL quantity ${quantity} published`);
      assert.equal(completeState(f), before);
    } finally { f.db.close(); }
  }
  const f = await partitionFixture();
  try {
    const batch = f.d1.batch, prepare = f.d1.prepare;
    let armed = false, activated = 0;
    f.d1.batch = async statements => { const result = await batch(statements); armed = true; return result; };
    f.d1.prepare = sql => {
      const wrap = statement => ({ ...statement, bind: (...values) => wrap(statement.bind(...values)), all: async () => {
        if (armed && sql.startsWith('SELECT r.* FROM stock_epoch_receipts')) { armed = false; activated++; return { success: true, results: [], meta: { changes: 0 } }; }
        return statement.all();
      } });
      return wrap(prepare(sql));
    };
    const result = await call(f, inventory, '/valuation-experiment', f.command);
    assert.equal(activated, 1);
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'epoch_committed_receipt_unavailable');
    const committed = completeState(f), batchCount = f.batches.length;
    const replay = await call(f, inventory, '/valuation-experiment', f.command);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(f.batches.length, batchCount);
    assert.equal(completeState(f), committed);
    const stored = JSON.parse(f.db.prepare('SELECT response_json FROM stock_epoch_receipts WHERE request_id=?').get(f.command.client_request_id).response_json);
    assert.deepEqual(replay.data, { ...stored, replayed: true });
  } finally { f.db.close(); }
  console.log('PASS10 activated malformed SQL quantity operands; unavailable committed receipt is truthful and retry only reads the original publication');
}

async function quantityTextFormat() {
  const fields = {
    stock_epoch_sources: ['quantity', 'free_quantity'],
    stock_epoch_segments: ['quantity'],
    stock_epoch_lines: ['original_quantity'],
    stock_epoch_line_allocations: ['original_quantity'],
    stock_epoch_epochs: ['target_quantity', 'returned_quantity'],
    stock_epoch_assignments: ['quantity'],
    stock_epoch_source_states: ['sellable_quantity', 'held_quantity', 'disposed_quantity', 'consumed_quantity'],
    stock_epoch_lot_heads: ['quantity', 'received_quantity'],
    stock_epoch_lot_effects: ['quantity_before', 'quantity_after', 'received_before', 'received_after'],
    stock_epoch_commands: ['quantity_before', 'quantity_after', 'branch_before', 'branch_after', 'product_before', 'product_after'],
  };
  const expected = Object.entries(fields).flatMap(([table, columns]) => columns.map(column => `${table}.${column}`)).sort();
  const full = fixture();
  try {
    const actual = full.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'stock_epoch_%'").all().flatMap(({ name }) => full.db.prepare(`PRAGMA table_info(${name})`).all().filter(column => column.type === 'TEXT' && (/quantity/.test(column.name) || /^(received|branch|product)_(before|after)$/.test(column.name))).map(column => `${name}.${column.name}`)).sort();
    assert.deepEqual(actual, expected);
    assert.equal(expected.length, 24);
  } finally { full.db.close(); }
  const migrationPath = path.join(__dirname, '../migrations/0220_stock_epoch_quantity_text.sql');
  const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';
  const tables = Object.entries(fields).map(([table, columns]) => `CREATE TABLE ${table}(${columns.map(column => `${column} TEXT NOT NULL DEFAULT '0'`).join(',')});`).join('\n');
  const db = require('./harness/d1compat.cjs').openDb([tables, migration]).db;
  try {
    for (const [table, columns] of Object.entries(fields)) for (const column of columns) {
      for (const value of ['0', '1', '0.125', '0.000000000000000000000001', '1000000000']) {
        const row = db.prepare(`INSERT INTO ${table}(${column}) VALUES(?)`).run(value).lastInsertRowid;
        assert.equal(db.prepare(`SELECT ${column} AS value FROM ${table} WHERE rowid=?`).get(row).value, value);
        db.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`).run(value, row);
        assert.equal(db.prepare(`SELECT ${column} AS value FROM ${table} WHERE rowid=?`).get(row).value, value);
      }
      assert.throws(() => db.prepare(`INSERT INTO ${table}(${column}) VALUES(?)`).run('1\u0000'), /epoch quantity text bytes/, `${table}.${column} accepted the known truncated-byte format`);
      const row = db.prepare(`INSERT INTO ${table}(${column}) VALUES('1')`).run().lastInsertRowid;
      assert.throws(() => db.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`).run('1\u0000', row), /epoch quantity text bytes/);
      assert.equal(db.prepare(`SELECT ${column} AS value FROM ${table} WHERE rowid=?`).get(row).value, '1');
    }
    console.log('PASS fixed quantity TEXT format:24 mapped columns,5 valid decimals unchanged on insert/update, known embedded-NUL format refused');
  } finally { db.close(); }
}

async function quantityTextPositive() {
  for (const test of [admission, fractionalAdmission, decimalQuantity, physicalPartition, fractionalPartition, disabledOrdinaryRoutes]) await test();
}

const cases = { admission, fractionalAdmission, decimalQuantity, rollback, redundantRecompute, malformedPublication, permissionAndClosure, disabledOrdinaryRoutes, physicalPartition, fractionalPartition, partitionRollback, partitionLostResponse, partitionTampering, guardRegressions, exactBasisSql, basisDomainAndReceipt, quantityTextFormat, quantityTextPositive };
(async () => {
  const selected = process.env.STOCK_EPOCH_SECTION;
  assert.ok(!selected || Object.hasOwn(cases, selected), 'Unknown publication section');
  for (const [name, test] of Object.entries(cases)) if (!selected || selected === name) await test();
})().catch(error => { console.error(error); process.exitCode = 1; });
