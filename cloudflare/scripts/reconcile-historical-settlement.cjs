// Explicit operator tool, never invoked by runtime or deployment. Capture is read-only.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const cwd = path.resolve(__dirname, '..')
const cohort = `SELECT CAST(target_id AS INTEGER) FROM latest_data_source_links WHERE run_id='latest-data-20260902-v1' AND entity_type='sale' AND target_table='sales' AND link_status='linked'`
const assert = require('node:assert/strict')
const q = value => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
const runId = 'historical-settlement-20260905-v1'
// D1's expression-depth limit is lower than desktop SQLite's. Keep full-row
// guards logarithmic rather than a left-associated OR chain.
function balancedOr(parts) {
  if(parts.length===1)return parts[0]
  const mid=Math.floor(parts.length/2)
  return `(${balancedOr(parts.slice(0,mid))} OR ${balancedOr(parts.slice(mid))})`
}
function query(sql) {
  const result = spawnSync(process.execPath, [
    'C:/Users/mrkl6/Downloads/business-os-v1/cloudflare/scripts/with-wrangler-auth.cjs',
    'node', 'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute',
    '49795be9-eabe-43f1-8e16-b86faed60cb1', '--remote', '--json', '--command', sql,
  ], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) {
    let error = result.stderr || ''
    try { error = JSON.stringify(JSON.parse(result.stdout).error || {}).slice(0,1500) } catch {}
    throw new Error(`D1 command failed: ${result.error?.code || result.status}; ${error.slice(-1500)}`)
  }
  const output = JSON.parse(result.stdout)
  if (output.some(r => !r.success)) throw new Error('D1 query failed')
  return output.flatMap(r => r.results || [])
}
function buildPlan(snapshot, saleIndex, sourceRows) {
  assert.equal(snapshot.sales.length, 89, 'Fresh target count requires review')
  assert.equal(saleIndex.length, 15004, 'Exact source cohort changed')
  assert.equal(snapshot.sales.filter(s => s.sale_status === 'awaiting_payment').length, 82)
  assert(snapshot.sales.every(s => ['awaiting_payment', 'completed'].includes(s.sale_status)))
  assert(snapshot.sales.every(s => s.amount_paid_khr === 0 && s.payment_currency === 'USD' && s.amount_paid_usd <= s.total_usd))
  assert(snapshot.sales.every(s => !snapshot.returns.some(r => r.sale_id === s.id)))
  const at = new Date().toISOString()
  const additions = []
  for (const [saleId, productId, sourceRow, total, quantity, price, cost] of [[16812,1369,58,131,2,13,8.7],[16816,10111,72,79,1,25,0]]) {
    const sale = snapshot.sales.find(s => s.id === saleId)
    const product = snapshot.products.find(p => p.id === productId)
    const row = sourceRows[sourceRow - 1]
    assert(product && product.is_active === 1)
    assert.equal(row[8], product.name)
    assert.equal(Number(row[3]), Number(sale.legacy_receipt_number.split('@')[0]))
    assert.equal(Number(row[9]), quantity)
    assert.equal(Number(row[10]), price)
    assert.equal(Number(row[16]), total)
    assert.equal(Number(row[24]), cost)
    assert.equal(Number(row[22]), sale.exchange_rate)
    const existing = snapshot.items.filter(i => i.sale_id === saleId)
    assert(!existing.some(i => i.product_id === productId))
    assert.equal(existing.reduce((sum,i)=>sum+i.total_usd,0) + quantity*price, total)
    assert.equal(snapshot.products.filter(p=>p.is_active===1 && p.name===product.name).length, 1)
    additions.push({sale_id:saleId,product_id:productId,product_name:product.name,sku:product.sku,quantity,unit:null,
      applied_price_usd:price,applied_price_khr:price*sale.exchange_rate,cost_price_usd:cost,cost_price_khr:0,
      total_usd:quantity*price,total_khr:quantity*price*sale.exchange_rate,branch_id:sale.branch_id,price_mode:'custom',
      base_price_usd:price,base_price_khr:price*sale.exchange_rate,manual_discount_type:'fixed',manual_discount_value:0,
      manual_discount_usd:0,manual_discount_khr:0,batch_id:null,returned_quantity:0,
      product_discount_type:null,product_discount_label:null,product_discount_usd:0,product_discount_khr:0,
      batch_label:null,batch_expiry_date:null,damaged_lot_id:null})
  }
  const sales = snapshot.sales.map(before => {
    const added = additions.find(i=>i.sale_id===before.id)
    const total = before.total_usd + (added?.total_usd || 0)
    const sourceMethod = added ? String(sourceRows[(before.id===16812?58:72)-1][19]) : before.payment_method
    assert(['Cash','ABA'].includes(sourceMethod))
    const after = { ...before, sale_status:'completed', amount_paid_usd:total, stock_skipped:1,payment_method:sourceMethod,
      stock_skipped_at:before.stock_skipped_at || at, stock_skipped_by_name:before.stock_skipped_by_name || 'Owner-authorized reconciliation',
      updated_at:at, change_usd:0,change_khr:0,subtotal_usd:before.subtotal_usd+(added?.total_usd||0),
      subtotal_khr:before.subtotal_khr+(added?.total_khr||0), total_usd:total,total_khr:before.total_khr+(added?.total_khr||0),
      notes:[before.notes,`[${runId}] Owner-confirmed historical payment; no new cash receipt or stock movement.`].filter(Boolean).join('\n') }
    const details = JSON.parse(before.payment_details || '[]')
    assert(Array.isArray(details))
    if (details.length === 0 && before.amount_paid_usd > 0) details.push({method:before.payment_method,amount_usd:before.amount_paid_usd,amount_khr:0})
    assert(Math.abs(details.reduce((sum,d)=>sum+Number(d.amount_usd||0)+Number(d.amount_khr||0)/before.exchange_rate,0)-before.amount_paid_usd)<0.01)
    details.push({method:sourceMethod,amount_usd:Math.round((total-before.amount_paid_usd)*100)/100,amount_khr:0,source:runId})
    after.payment_details=JSON.stringify(details)
    if (added || before.id===16790) after.items=JSON.stringify([...snapshot.items.filter(i=>i.sale_id===before.id),...(added?[added]:[])])
    return {before,after}
  })
  const receivables = snapshot.receivables.filter(a=>a.outstanding_balance_usd>0).map(before=>{
    const day=before.invoice_date.slice(0,10)
    const matches=saleIndex.filter(s=>s.legacy_receipt_number===`${String(before.invoice_no).padStart(6,'0')}@${day}`)
    assert.equal(matches.length,1,`AR ${before.id} not uniquely source-linked`)
    const sale=matches[0]
    assert(['awaiting_payment','completed'].includes(sale.sale_status))
    if(sale.id===16790 && sale.total_usd===1064 && before.id===26494 && before.total_amount_usd===694) {
      // Owner explicitly confirmed the live-added $370 is already paid too.
      // This is a single reviewed legacy correction, not a generic AR override.
      const line=snapshot.items.find(i=>i.id===40261)
      assert(line && line.sale_id===16790 && line.product_id===4758 && line.quantity===20 && line.total_usd===370)
      assert.equal(snapshot.items.filter(i=>i.sale_id===16790).reduce((n,i)=>n+i.total_usd,0),1064)
    } else assert.equal(sale.total_usd,before.total_amount_usd,`AR ${before.id} total conflict`)
    const corrected=sales.find(s=>s.before.id===sale.id)?.after
    const total=corrected?.total_usd || sale.total_usd
    return {saleId:sale.id,before,after:{...before,taxable_amount_usd:before.taxable_amount_usd+(total-before.total_amount_usd),total_amount_usd:total,amount_paid_usd:total,outstanding_balance_usd:0,status:'Paid'}}
  })
  assert.equal(receivables.length,100)
  for(const sale of sales) assert.equal(receivables.filter(a=>a.saleId===sale.before.id).length,1)
  return {runId,at,sales,receivables,additions,itemsBefore:snapshot.items,sourceSales:saleIndex,
    controls:{products:snapshot.products.map(p=>({id:p.id,stock_quantity:p.stock_quantity})),branchStock:snapshot.branchStock,batchStock:snapshot.batchStock,movementControl:snapshot.movementControl}}
}

// Business changes run inside ONE trigger invocation: SQLite rolls the entire
// statement back on any stale-row guard or constraint failure. Staging is inert.
function generateSql(plan) {
  const stage='_settlement_20260905_rows'
  const saleRefs=plan.sourceSales.filter(s=>plan.receivables.some(a=>a.saleId===s.id))
  const records=[...plan.sales.map(r=>({kind:'sales',id:r.before.id,...r})),...plan.receivables.map(r=>({kind:'customer_receivables',id:r.before.id,...r})),
    ...saleRefs.map(before=>({kind:'sale_refs',id:before.id,before,after:before})),
    ...plan.sourceLinks.map(before=>({kind:'source_refs',id:Number(before.target_id),before,after:before})),
    ...plan.itemsBefore.map(before=>({kind:'sale_items_guard',id:before.id,before,after:before})),
    ...plan.additions.map((after,i)=>({kind:'sale_items_add',id:i+1,before:{},after}))]
  const setup=[`CREATE TABLE ${stage}(kind TEXT NOT NULL,id INTEGER NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,PRIMARY KEY(kind,id));`]
  for(const r of records) setup.push(`INSERT INTO ${stage} VALUES(${q(r.kind)},${r.id},${q(JSON.stringify(r.before))},${q(JSON.stringify(r.after))});`)
  // No application endpoint can write this operator staging table. Seal it
  // before creating the apply trigger; later retries cannot change the plan.
  for(const op of ['INSERT','UPDATE','DELETE'])setup.push(`CREATE TRIGGER ${stage}_no_${op.toLowerCase()} BEFORE ${op} ON ${stage} BEGIN SELECT RAISE(ABORT,'Settlement staging is sealed'); END;`)
  const body=[]
  body.push(`SELECT CASE WHEN EXISTS(SELECT 1 FROM action_history WHERE entity='historical_settlement' AND entity_id=${q(plan.runId)}) THEN RAISE(ABORT,'Settlement already applied') END;`)
  for(const [kind,rows,table] of [['sales',plan.sales,'sales'],['sale_refs',saleRefs.map(before=>({before})),'sales'],['customer_receivables',plan.receivables,'customer_receivables'],['sale_items_guard',plan.itemsBefore.map(before=>({before})),'sale_items']]) {
    const cols=Object.keys(rows[0].before)
    body.push(`SELECT CASE WHEN (SELECT COUNT(*) FROM ${stage} WHERE kind=${q(kind)})<>${rows.length} OR EXISTS(SELECT 1 FROM ${stage} r LEFT JOIN ${table} s ON s.id=r.id WHERE r.kind=${q(kind)} AND (s.id IS NULL OR ${balancedOr(cols.map(c=>`s.${c} IS NOT json_extract(r.before_json,'$.${c}')`))})) THEN RAISE(ABORT,'Stale ${kind} snapshot') END;`)
  }
  body.push(`SELECT CASE WHEN (SELECT COUNT(*) FROM sales WHERE id IN(SELECT id FROM ${stage} WHERE kind='sale_refs') AND id IN(${cohort}))<>100 THEN RAISE(ABORT,'Reconciliation source membership changed') END;`)
  const linkCols=Object.keys(plan.sourceLinks[0])
  body.push(`SELECT CASE WHEN (SELECT COUNT(*) FROM ${stage} WHERE kind='source_refs')<>100 OR EXISTS(SELECT 1 FROM ${stage} r LEFT JOIN latest_data_source_links l ON l.run_id=json_extract(r.before_json,'$.run_id') AND l.source_file=json_extract(r.before_json,'$.source_file') AND l.source_row=json_extract(r.before_json,'$.source_row') AND l.source_key=json_extract(r.before_json,'$.source_key') WHERE r.kind='source_refs' AND (l.target_id IS NULL OR ${balancedOr(linkCols.map(c=>`l.${c} IS NOT json_extract(r.before_json,'$.${c}')`))})) THEN RAISE(ABORT,'Reconciliation source identity changed') END;`)
  body.push(`SELECT CASE WHEN (SELECT COUNT(*) FROM ${stage} WHERE kind='sale_items_add')<>2 THEN RAISE(ABORT,'Missing source additions') END;`)
  body.push(`SELECT CASE WHEN (SELECT COUNT(*) FROM sale_items WHERE sale_id IN(${plan.sales.map(s=>s.before.id).join(',')}))<>${plan.itemsBefore.length} OR EXISTS(SELECT 1 FROM returns WHERE sale_id IN(${plan.sales.map(s=>s.before.id).join(',')})) THEN RAISE(ABORT,'Sale items or returns changed') END;`)
  for(const item of plan.additions) body.push(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=${item.product_id} AND name=${q(item.product_name)} AND is_active=1) OR EXISTS(SELECT 1 FROM sale_items WHERE sale_id=${item.sale_id} AND product_id=${item.product_id}) THEN RAISE(ABORT,'Source product changed') END;`)
  for(const [kind,rows] of [['sales',plan.sales],['customer_receivables',plan.receivables]]) {
    const changed=Object.keys(rows[0].after).filter(c=>rows.some(r=>JSON.stringify(r.before[c])!==JSON.stringify(r.after[c])))
    body.push(`UPDATE ${kind} SET ${changed.map(c=>`${c}=(SELECT json_extract(after_json,'$.${c}') FROM ${stage} WHERE kind=${q(kind)} AND id=${kind}.id)`).join(',')} WHERE id IN(SELECT id FROM ${stage} WHERE kind=${q(kind)});`)
    body.push(`INSERT INTO audit_logs(user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value,created_at) SELECT 'Owner-authorized reconciliation','historical_settlement',${q(kind)},CAST(id AS TEXT),${q(plan.runId)},${q(kind)},CAST(id AS TEXT),before_json,after_json,${q(plan.at)} FROM ${stage} WHERE kind=${q(kind)};`)
  }
  const cols=Object.keys(plan.additions[0])
  body.push(`INSERT INTO sale_items(${cols.join(',')}) SELECT ${cols.map(c=>`json_extract(after_json,'$.${c}')`).join(',')} FROM ${stage} WHERE kind='sale_items_add';`)
  body.push(`INSERT INTO audit_logs(user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value,created_at) SELECT 'Owner-authorized reconciliation','restore_missing_source_line','sale_items',CAST(i.id AS TEXT),${q(plan.runId)},'sale_items',CAST(i.id AS TEXT),'null',r.after_json,${q(plan.at)} FROM ${stage} r JOIN sale_items i ON i.sale_id=json_extract(r.after_json,'$.sale_id') AND i.product_id=json_extract(r.after_json,'$.product_id') WHERE r.kind='sale_items_add';`)
  body.push(`INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_name,created_at,updated_at) VALUES('global','historical_settlement',${q(plan.runId)},'Reconcile 89 historical sales and 100 receivables (stock unchanged)',0,'recorded','{}',${q(JSON.stringify({runId:plan.runId,saleIds:plan.sales.map(r=>r.before.id),receivableIds:plan.receivables.map(r=>r.before.id),sourceRun:'latest-data-20260902-v1',stockDelta:0}))},'Owner-authorized reconciliation',${q(plan.at)},${q(plan.at)});`)
  const trigger=`CREATE TRIGGER _settlement_20260905_apply AFTER INSERT ON audit_logs WHEN NEW.action='apply_historical_settlement' AND NEW.entity_id=${q(plan.runId)} BEGIN\n${body.join('\n')}\nEND;`
  assert(Buffer.byteLength(trigger)<90000)
  const apply=`INSERT INTO audit_logs(user_name,action,entity,entity_id,details,created_at) VALUES('Owner-authorized reconciliation','apply_historical_settlement','reconciliation',${q(plan.runId)},${q(JSON.stringify({sourceRun:'latest-data-20260902-v1',sales:89,receivables:100,addedLines:2,stockDelta:0}))},${q(plan.at)});`
  return {setup,trigger,apply,cleanup:`DROP TRIGGER IF EXISTS _settlement_20260905_reverse; DROP TRIGGER _settlement_20260905_apply; DROP TABLE ${stage};`}
}
function rollbackSql(plan) {
  const stage='_settlement_20260905_rows'
  const body=[`SELECT CASE WHEN (SELECT COUNT(*) FROM action_history WHERE entity='historical_settlement' AND entity_id=${q(plan.runId)} AND status='recorded' AND label NOT LIKE 'Reversed:%')<>1 THEN RAISE(ABORT,'Settlement missing or already reversed') END;`]
  const refs=plan.sourceSales.filter(s=>plan.receivables.some(a=>a.saleId===s.id)&&!plan.sales.some(a=>a.before.id===s.id))
  for(const ref of refs)body.push(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sales WHERE ${Object.entries(ref).map(([c,v])=>`${c} IS ${q(v)}`).join(' AND ')}) THEN RAISE(ABORT,'Reference-only sale changed') END;`)
  for(const [kind,rows] of [['sales',plan.sales],['customer_receivables',plan.receivables]]) {
    const cols=Object.keys(rows[0].after)
    body.push(`SELECT CASE WHEN (SELECT COUNT(*) FROM ${stage} WHERE kind=${q(kind)})<>${rows.length} OR EXISTS(SELECT 1 FROM ${stage} r LEFT JOIN ${kind} s ON s.id=r.id WHERE r.kind=${q(kind)} AND (s.id IS NULL OR ${balancedOr(cols.map(c=>`s.${c} IS NOT json_extract(r.after_json,'$.${c}')`))})) THEN RAISE(ABORT,'Cannot reverse changed ${kind}') END;`)
  }
  const originalCols=Object.keys(plan.itemsBefore[0])
  body.push(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${stage} r LEFT JOIN sale_items s ON s.id=r.id WHERE r.kind='sale_items_guard' AND (s.id IS NULL OR ${balancedOr(originalCols.map(c=>`s.${c} IS NOT json_extract(r.before_json,'$.${c}')`))})) OR (SELECT COUNT(*) FROM sale_items WHERE sale_id IN(${plan.sales.map(s=>s.before.id).join(',')}))<>${plan.itemsBefore.length+2} OR EXISTS(SELECT 1 FROM returns WHERE sale_id IN(${plan.sales.map(s=>s.before.id).join(',')})) THEN RAISE(ABORT,'Cannot reverse changed items or returns') END;`)
  for(const item of plan.additions)body.push(`SELECT CASE WHEN (SELECT COUNT(*) FROM sale_items WHERE ${Object.entries(item).map(([c,v])=>`${c} IS ${q(v)}`).join(' AND ')})<>1 THEN RAISE(ABORT,'Restored source line changed') END;`)
  for(const [kind,rows] of [['sales',plan.sales],['customer_receivables',plan.receivables]]) {
    const changed=Object.keys(rows[0].after).filter(c=>rows.some(r=>JSON.stringify(r.before[c])!==JSON.stringify(r.after[c])))
    body.push(`UPDATE ${kind} SET ${changed.map(c=>`${c}=(SELECT json_extract(before_json,'$.${c}') FROM ${stage} WHERE kind=${q(kind)} AND id=${kind}.id)`).join(',')} WHERE id IN(SELECT id FROM ${stage} WHERE kind=${q(kind)});`)
    body.push(`INSERT INTO audit_logs(user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value) SELECT 'Owner-authorized recovery','reverse_historical_settlement',${q(kind)},CAST(id AS TEXT),${q(plan.runId)},${q(kind)},CAST(id AS TEXT),after_json,before_json FROM ${stage} WHERE kind=${q(kind)};`)
  }
  for(const item of plan.additions)body.push(`DELETE FROM sale_items WHERE sale_id=${item.sale_id} AND product_id=${item.product_id};`)
  body.push(`UPDATE action_history SET label='Reversed: '||label,updated_at=CURRENT_TIMESTAMP WHERE entity='historical_settlement' AND entity_id=${q(plan.runId)};`)
  return {trigger:`CREATE TRIGGER _settlement_20260905_reverse AFTER INSERT ON audit_logs WHEN NEW.action='reverse_historical_settlement_run' AND NEW.entity_id=${q(plan.runId)} BEGIN\n${body.join('\n')}\nEND;`,
    apply:`INSERT INTO audit_logs(user_name,action,entity,entity_id,details) VALUES('Owner-authorized recovery','reverse_historical_settlement_run','reconciliation',${q(plan.runId)},'Guarded exact inverse; stock unchanged');`}
}
function rehearse(snapshot,plan) {
  const {DatabaseSync}=require('node:sqlite')
  const sql=generateSql(plan)
  function fixture() {
    const db=new DatabaseSync(':memory:')
    const tables=['sales','sale_items','customer_receivables','audit_logs','action_history','returns','products','branch_stock','branch_batch_stock','inventory_movements','latest_data_source_links']
    for(const name of tables) db.exec(snapshot.schema.find(s=>s.type==='table'&&s.name===name).sql)
    function insert(table,row) {
      const cols=Object.keys(row)
      db.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...cols.map(c=>row[c]))
    }
    for(const s of plan.sourceSales) insert('sales',snapshot.sales.find(x=>x.id===s.id)||s)
    for(const s of snapshot.otherSales) insert('sales',s)
    for(const [table,rows] of [['sale_items',snapshot.items],['customer_receivables',snapshot.receivables],['returns',snapshot.returns],['products',snapshot.products],['branch_stock',snapshot.branchStock],['branch_batch_stock',snapshot.batchStock],['inventory_movements',snapshot.incidentMovements]]) for(const row of rows)insert(table,row)
    for(const row of plan.sourceLinks)insert('latest_data_source_links',row)
    db.exec(sql.setup.join('\n'))
    db.exec(sql.trigger)
    return db
  }
  const all=(db,table)=>JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
  const controlTables=['products','branch_stock','branch_batch_stock','inventory_movements']
  const db=fixture()
  assert.throws(()=>db.exec("DELETE FROM _settlement_20260905_rows WHERE kind='sale_items_add'"),/sealed/)
  assert.throws(()=>db.exec("UPDATE _settlement_20260905_rows SET after_json=json_set(after_json,'$.amount_paid_usd',999999) WHERE kind='sales'"),/sealed/)
  assert.throws(()=>db.exec("UPDATE _settlement_20260905_rows SET before_json='{}' WHERE kind='sales'"),/sealed/)
  const before=Object.fromEntries(controlTables.map(t=>[t,all(db,t)]))
  db.exec(sql.apply)
  for(const r of plan.sales)assert.deepEqual({...db.prepare('SELECT * FROM sales WHERE id=?').get(r.before.id)},r.after)
  for(const r of plan.receivables)assert.deepEqual({...db.prepare('SELECT * FROM customer_receivables WHERE id=?').get(r.before.id)},r.after)
  for(const t of controlTables)assert.equal(all(db,t),before[t],`${t} changed`)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM action_history').get().n,1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,192)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sale_items').get().n,snapshot.items.length+2)
  assert.throws(()=>db.exec(sql.apply),/already applied/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,192)
  const inverse=rollbackSql(plan)
  db.exec(inverse.trigger)
  db.exec('UPDATE sales SET total_usd=121 WHERE id=16813')
  assert.throws(()=>db.exec(inverse.apply),/Reference-only/)
  db.exec('UPDATE sales SET total_usd=120 WHERE id=16813')
  db.exec(inverse.apply)
  for(const r of plan.sales)assert.deepEqual({...db.prepare('SELECT * FROM sales WHERE id=?').get(r.before.id)},r.before)
  for(const r of plan.receivables)assert.deepEqual({...db.prepare('SELECT * FROM customer_receivables WHERE id=?').get(r.before.id)},r.before)
  for(const t of controlTables)assert.equal(all(db,t),before[t],`${t} changed by inverse`)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sale_items').get().n,snapshot.items.length)
  assert.throws(()=>db.exec(inverse.apply),/already reversed/)
  db.close()
  const faults=[
    `UPDATE sales SET total_usd=total_usd+1 WHERE id=${plan.sales[0].before.id}`,
    `UPDATE customer_receivables SET amount_paid_usd=amount_paid_usd+1 WHERE id=${plan.receivables[0].before.id}`,
    `DELETE FROM sale_items WHERE id=${snapshot.items[0].id}`,
    `INSERT INTO sale_items(sale_id,quantity) VALUES(${plan.sales[0].before.id},1)`,
    `DELETE FROM latest_data_source_links WHERE target_id='${plan.sales[0].before.id}'`,
    `UPDATE latest_data_source_links SET source_key=source_key||'-changed' WHERE target_id='${plan.sales[0].before.id}'`,
    `CREATE TRIGGER injected_failure BEFORE INSERT ON sale_items BEGIN SELECT RAISE(ABORT,'injected late failure'); END`,
  ]
  for(const fault of faults) {
    const d=fixture();d.exec(fault)
    const preserved=Object.fromEntries(['sales','customer_receivables','sale_items',...controlTables].map(t=>[t,all(d,t)]))
    assert.throws(()=>d.exec(sql.apply))
    for(const [t,rows] of Object.entries(preserved))assert.equal(all(d,t),rows,`Partial change after ${fault}`)
    assert.equal(d.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,0)
    assert.equal(d.prepare('SELECT COUNT(*) n FROM action_history').get().n,0)
    d.close()
  }
  return {passed:true,checks:['89 sale rows exact','100 AR rows exact','2 restored lines','one history action','192 audit records','all stock tables byte-identical','sealed staging','exact source identities','replay rejected','exact guarded inverse including reference-only sales','seven stale/failure rollback cases']}
}
if (require.main === module && process.argv[2] === 'render-trigger') {
  const plan=JSON.parse(fs.readFileSync(process.argv[3],'utf8'))
  const destination=process.argv[4]
  assert(destination && !fs.existsSync(destination),'Use a new SQL artifact')
  fs.writeFileSync(destination,'DROP TRIGGER _settlement_20260905_apply;\n'+generateSql(plan).trigger+'\n',{flag:'wx'})
  console.log('Rendered replacement validation trigger; plan data unchanged')
} else if (require.main === module && ['verify','inspect-live'].includes(process.argv[2])) {
  const plan=JSON.parse(fs.readFileSync(process.argv[3],'utf8'))
  const destination=process.argv[4]
  assert(destination && !fs.existsSync(destination),'Use a new verification artifact')
  const evidence={capturedAt:new Date().toISOString(),runId:plan.runId,checks:{}}
  for(const [table,rows] of [['sales',plan.sales],['customer_receivables',plan.receivables]]) {
    const actual=query(`SELECT * FROM ${table} WHERE id IN(${rows.map(r=>r.before.id).join(',')}) ORDER BY id`)
    assert.equal(actual.length,rows.length)
    for(const r of rows)assert.ok(JSON.stringify(actual.find(a=>a.id===r.before.id))===JSON.stringify(r.after),`${table} ${r.before.id} differs`)
    evidence.checks[table]=actual.length
  }
  const items=query(`SELECT * FROM sale_items WHERE sale_id IN(${plan.sales.map(r=>r.before.id).join(',')}) ORDER BY id`)
  assert.equal(items.length,plan.itemsBefore.length+plan.additions.length)
  for(const old of plan.itemsBefore)assert.deepEqual(items.find(i=>i.id===old.id),old)
  for(const added of plan.additions){const matches=items.filter(i=>i.sale_id===added.sale_id&&i.product_id===added.product_id);assert.equal(matches.length,1);const {id,...rest}=matches[0];assert.deepEqual(rest,added)}
  evidence.checks.items=items.length
  for(const [key,sql] of Object.entries({products:'SELECT id,stock_quantity FROM products ORDER BY id',branchStock:'SELECT * FROM branch_stock ORDER BY id',batchStock:'SELECT * FROM branch_batch_stock ORDER BY id',movementControl:'SELECT COUNT(*) n,MAX(id) max_id,SUM(quantity) quantity FROM inventory_movements'})) {
    const actual=query(sql)
    const unchanged=JSON.stringify(actual)===JSON.stringify(plan.controls[key])
    if(process.argv[2]==='verify')assert.ok(unchanged,`${key} changed; investigate concurrent activity before attributing`)
    evidence.checks[key]={rows:actual.length,sha256:hash(JSON.stringify(actual)),unchanged}
    if(!unchanged){
      const old=new Map(plan.controls[key].map(r=>[r.id??'control',r]))
      const current=new Map(actual.map(r=>[r.id??'control',r]))
      evidence.checks[key].differences=[...new Set([...old.keys(),...current.keys()])].flatMap(id=>JSON.stringify(old.get(id))===JSON.stringify(current.get(id))?[]:[{before:old.get(id)??null,after:current.get(id)??null}])
    }
  }
  const history=query(`SELECT * FROM action_history WHERE entity='historical_settlement' AND entity_id=${q(plan.runId)}`)
  assert.equal(history.length,1)
  assert.equal(history[0].scope,'global');assert.equal(history[0].status,'recorded');assert.equal(history[0].reversible,0)
  assert.deepEqual(JSON.parse(history[0].redo_payload),{runId:plan.runId,saleIds:plan.sales.map(r=>r.before.id),receivableIds:plan.receivables.map(r=>r.before.id),sourceRun:'latest-data-20260902-v1',stockDelta:0})
  const audits=query(`SELECT action,entity,entity_id,old_value,new_value FROM audit_logs WHERE details=${q(plan.runId)} OR (action='apply_historical_settlement' AND entity_id=${q(plan.runId)})`)
  assert.equal(audits.length,192)
  for(const [table,rows] of [['sales',plan.sales],['customer_receivables',plan.receivables]])for(const row of rows){
    const matches=audits.filter(a=>a.action==='historical_settlement'&&a.entity===table&&a.entity_id===String(row.before.id))
    assert.equal(matches.length,1)
    assert.ok(matches[0].old_value===JSON.stringify(row.before)&&matches[0].new_value===JSON.stringify(row.after),`${table} audit ${row.before.id} differs`)
  }
  for(const added of plan.additions){const matches=audits.filter(a=>a.action==='restore_missing_source_line'&&a.entity==='sale_items'&&a.new_value===JSON.stringify(added));assert.equal(matches.length,1);assert.equal(matches[0].old_value,'null');assert(items.some(i=>String(i.id)===matches[0].entity_id&&i.sale_id===added.sale_id&&i.product_id===added.product_id))}
  assert.equal(audits.filter(a=>a.action==='apply_historical_settlement'&&a.entity==='reconciliation'&&a.entity_id===plan.runId).length,1)
  evidence.checks.history=1;evidence.checks.audit=192
  evidence.stockControlReviewRequired=Object.values(evidence.checks).some(v=>v&&typeof v==='object'&&v.unchanged===false)
  if(evidence.stockControlReviewRequired)evidence.concurrentMovements=query(`SELECT id,product_id,branch_id,batch_id,movement_type,quantity,reference_id,reason,created_at FROM inventory_movements WHERE id>${plan.controls.movementControl[0].max_id} ORDER BY id LIMIT 500`)
  fs.writeFileSync(destination,JSON.stringify(evidence,null,2),{flag:'wx'})
  console.log(JSON.stringify({destination,runId:plan.runId,sales:evidence.checks.sales,receivables:evidence.checks.customer_receivables,items:evidence.checks.items,history:1,audit:192,stockControlReviewRequired:evidence.stockControlReviewRequired}))
} else if (require.main === module && process.argv[2] === 'rehearse') {
  const snapshot=JSON.parse(fs.readFileSync(process.argv[3],'utf8'))
  const plan=JSON.parse(fs.readFileSync(process.argv[4],'utf8'))
  console.log(JSON.stringify(rehearse(snapshot,plan)))
} else if (require.main === module && process.argv[2] === 'plan') {
  const [, , , snapshotFile, destination] = process.argv
  assert(destination && !fs.existsSync(destination),'Use a new plan directory')
  const snapshot=JSON.parse(fs.readFileSync(snapshotFile,'utf8'))
  const saleIndex=query(`SELECT id,legacy_receipt_number,sale_status,total_usd,amount_paid_usd FROM sales WHERE id IN (${cohort}) ORDER BY id`)
  const source='C:/Users/mrkl6/Downloads/business-os-v1/Migration from old system/report-invoice-detail-sep02-04.xls'
  assert.equal(hash(fs.readFileSync(source)),'1d38db43d0738b22c63461e396bde75cbbbb95a9f16526247297aa1060cf09ee')
  const XLSX=require('C:/Users/mrkl6/Downloads/business-os-v1/frontend/node_modules/xlsx')
  const workbook=XLSX.readFile(source)
  const rows=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,defval:''})
  const plan=buildPlan(snapshot,saleIndex,rows)
  plan.sourceLinks=query(`SELECT * FROM latest_data_source_links WHERE run_id='latest-data-20260902-v1' AND entity_type='sale' AND target_table='sales' AND target_id IN(${plan.receivables.map(a=>q(String(a.saleId))).join(',')}) ORDER BY source_row`)
  assert.equal(plan.sourceLinks.length,100)
  assert.equal(new Set(plan.sourceLinks.map(l=>l.target_id)).size,100)
  assert(plan.sourceLinks.every(l=>l.link_status==='linked'&&l.source_file==='report-invoice-detail-2021-2026 shop.xls'))
  const sql=generateSql(plan)
  fs.mkdirSync(destination,{recursive:true})
  fs.writeFileSync(path.join(destination,'plan.json'),JSON.stringify(plan))
  fs.writeFileSync(path.join(destination,'sql.json'),JSON.stringify(sql))
  fs.writeFileSync(path.join(destination,'setup.sql'),sql.setup.join('\n')+'\n'+sql.trigger+'\n')
  fs.writeFileSync(path.join(destination,'apply.sql'),sql.apply+'\n')
  fs.writeFileSync(path.join(destination,'cleanup.sql'),sql.cleanup+'\n')
  const inverse=rollbackSql(plan)
  fs.writeFileSync(path.join(destination,'rollback-trigger.sql'),inverse.trigger+'\n')
  fs.writeFileSync(path.join(destination,'rollback-apply.sql'),inverse.apply+'\n')
  console.log(JSON.stringify({sales:plan.sales.length,receivables:plan.receivables.length,addedLines:plan.additions.length,settledTotal:plan.sales.reduce((s,r)=>s+r.after.total_usd,0),paymentIncrease:plan.sales.reduce((s,r)=>s+r.after.amount_paid_usd-r.before.amount_paid_usd,0),triggerBytes:Buffer.byteLength(sql.trigger)}))
} else if (require.main === module) {
  const [mode, destination] = process.argv.slice(2)
  if (mode !== 'capture' || !destination) throw new Error('Usage: node reconcile-historical-settlement.cjs capture <new-local-json>')
  if (fs.existsSync(destination)) throw new Error('Refusing to overwrite evidence')
  const snapshot = { capturedAt: new Date().toISOString() }
  const queries = {
    schema: `SELECT name,type,tbl_name,sql FROM sqlite_master WHERE type IN ('table','trigger','index') ORDER BY name`,
    sales: `SELECT * FROM sales WHERE id IN (${cohort}) AND (sale_status='awaiting_payment' OR total_usd > amount_paid_usd + amount_paid_khr/exchange_rate) ORDER BY id LIMIT 500`,
    cohortControl: `SELECT sale_status,COUNT(*) n,SUM(total_usd) total,SUM(amount_paid_usd) paid FROM sales WHERE id IN (${cohort}) GROUP BY sale_status`,
    otherSales: `SELECT id,created_at,legacy_receipt_number,sale_status,total_usd,amount_paid_usd,amount_paid_khr,updated_at FROM sales WHERE id NOT IN (${cohort}) ORDER BY id`,
    receivables: `SELECT * FROM customer_receivables ORDER BY id`,
    links: `SELECT * FROM latest_data_source_links WHERE run_id='latest-data-20260902-v1' AND target_table='sales' AND CAST(target_id AS INTEGER) IN(SELECT id FROM sales WHERE sale_status='awaiting_payment' OR total_usd > amount_paid_usd + amount_paid_khr/exchange_rate) ORDER BY source_file,source_row,source_key LIMIT 500`,
    items: `SELECT * FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE id IN (${cohort}) AND (sale_status='awaiting_payment' OR total_usd > amount_paid_usd + amount_paid_khr/exchange_rate)) ORDER BY id`,
    returns: `SELECT * FROM returns ORDER BY id`,
    products: `SELECT id,name,sku,barcode,stock_quantity,is_active FROM products ORDER BY id`,
    branchStock: `SELECT * FROM branch_stock ORDER BY id`,
    batchStock: `SELECT * FROM branch_batch_stock ORDER BY id`,
    movementControl: `SELECT COUNT(*) n,MAX(id) max_id,SUM(quantity) quantity FROM inventory_movements`,
    incidentMovements: `SELECT * FROM inventory_movements WHERE id BETWEEN 46189 AND 46197 ORDER BY id`,
  }
  for (const [key, sql] of Object.entries(queries)) {
    snapshot[key] = query(sql)
    console.log(`${key}: ${snapshot[key].length} rows`)
  }
  fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true })
  const data = JSON.stringify(snapshot)
  fs.writeFileSync(destination, data, { flag: 'wx' })
  console.log(JSON.stringify({ destination, sha256: crypto.createHash('sha256').update(data).digest('hex') }))
}
module.exports = { query, cohort, buildPlan, generateSql, rollbackSql, rehearse }
