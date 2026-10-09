const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),ts=require('typescript')
const {openDb}=require('./harness/d1compat.cjs'),{loadAll}=require('./harness/load_migrations.cjs')
const source=path.resolve(__dirname,'../src/lib/productMergeSnapshot.ts')
const parent=process.argv.includes('--gallery-parent')?'1714de97b00d8c21652c5796d83c08f2556c79bc':'24982912f9c3d14d9b260849e6768e887d96fe96'
const raw=(process.argv.includes('--parent')||process.argv.includes('--gallery-parent'))?cp.execFileSync('git',['show',parent+':cloudflare/src/lib/productMergeSnapshot.ts'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}):fs.readFileSync(source,'utf8')
const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,mod,mod.exports)
const capture=mod.exports
async function main(){
 const d1=openDb(loadAll(),{seedBeforeFence(d1){d1.db.exec(`INSERT INTO branches(id,name,is_active)VALUES(1,'Shop',1);
 INSERT INTO products(id,name,barcode,is_active,stock_quantity,parent_id,updated_at)VALUES(1,'Keeper','K',1,0,NULL,'2026-10-09 19:00:00'),(2,'Original','L',1,0,NULL,'2026-10-09 19:00:00'),(3,'Child','C',1,0,2,'2026-10-09 19:00:00'),(4,'Unrelated','U',1,0,NULL,'2026-10-09 19:00:00');
 INSERT INTO product_images(id,product_id,image_path,sort_order,created_at)VALUES(101,1,'/uploads/keeper.webp',2,'2026-09-01'),(102,1,'/uploads/keeper-next.webp',1,'2026-09-02'),(201,2,'/uploads/source.webp',1,'2026-09-03'),(202,2,'/uploads/source-first.webp',0,'2026-09-04'),(401,4,'/uploads/unrelated.webp',0,'2026-09-05');
 INSERT INTO promotion_rules(id,title,product_ids,updated_at)VALUES(301,'Original','[1,2]','2026-09-01'),(302,'Unrelated','[4]','2026-09-02');
 INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,1,0),(2,1,0),(3,1,0),(4,1,0);
 UPDATE products SET description='មាន "catalog"',custom_fields='{"material":"glass"}',categories='Tea||Drink',brands='Brand||Brand2',brand_compact='brandbrand2',name_normalized='keeper',unit='piece',unit_normalized='piece',tag_label='Original',created_at='2026-09-01 00:00:00',expiry_date='2027-01-01',discount_label='Original discount',discount_amount_usd=1.0000000000000002,purchase_price_usd=0.30000000000000004 WHERE id=1;`)}})
 const reads=[];const adapter={batch:statements=>{reads.push(statements.length);return d1.batch(statements)}}
 const read=()=>capture.readProductMergeCaseSnapshot(adapter,1,2,[])
 const snapshot=await read(),guard=capture.productMergeCaptureGuard(snapshot)
 const current=id=>({...d1.db.prepare('SELECT * FROM products WHERE id=@id').get({id})})
 const assertCurrent=()=>assert.equal(d1.db.prepare(guard.sql).get(guard.params).merge_source_guard,1)
 const assertStale=()=>assert.throws(()=>d1.db.prepare(guard.sql).get(guard.params),/merge_conflict_retry/)
 assertCurrent()
 if(process.argv.includes('--child-only')){
  d1.db.prepare("UPDATE products SET updated_at='2026-10-09 19:00:01' WHERE id=3").run();assertStale()
  d1.db.close();console.log('PASS child timestamp preimage refuses same-membership rival');return
 }
 const galleryRivals=[['keeper-sort','product_images',101,'sort_order',7],['keeper-identity','product_images',101,'id',99],['keeper-created','product_images',101,'created_at','2026-09-11'],['loser-identity','product_images',201,'id',211],['loser-created','product_images',201,'created_at','2026-09-12'],['promotion-timestamp','promotion_rules',301,'updated_at','2026-09-13']]
 const galleryCase=process.argv.find(arg=>arg.startsWith('--gallery-case='))?.slice('--gallery-case='.length)
 if(galleryCase)assert.equal(galleryRivals.filter(row=>row[0]===galleryCase).length,1,'known unique discriminator')
 for(const [name,table,id,field,value]of (galleryCase?galleryRivals.filter(row=>row[0]===galleryCase):process.argv.includes('--promotion-only')?galleryRivals.slice(-1):galleryRivals)){const old=d1.db.prepare(`SELECT ${field} AS value FROM ${table} WHERE id=@id`).get({id}).value;d1.db.prepare(`UPDATE ${table} SET ${field}=@value WHERE id=@id`).run({value,id});assertStale();d1.db.prepare(`UPDATE ${table} SET ${field}=@value WHERE id=@id`).run({value:old,id:field==='id'?value:id});assertCurrent()}
 if(galleryCase||process.argv.includes('--gallery-only')||process.argv.includes('--promotion-only')){d1.db.close();console.log('PASS gallery identity/order/created_at and promotion timestamp rivals');return}
 const imageColumns=d1.db.prepare('PRAGMA table_info(product_images)').all().map(row=>row.name)
 const gallery=(id,order)=>d1.db.prepare(`SELECT * FROM product_images WHERE product_id=@id ORDER BY ${order}`).all({id}).map(row=>({...row}))
 assert.deepEqual(snapshot.canonicalImageRows,gallery(1,'id'),'keeper complete original rows and ID ordering')
 assert.deepEqual(snapshot.duplicateImageRows,gallery(2,'sort_order,id'),'loser complete original rows and gallery ordering')
 assert.deepEqual(Object.keys(snapshot.canonicalImageRows[0]),imageColumns);assert.deepEqual(Object.keys(snapshot.duplicateImageRows[0]),imageColumns)
 assert.deepEqual(snapshot.promotionRuleRows,d1.db.prepare('SELECT id,product_ids,updated_at FROM promotion_rules ORDER BY id').all().map(row=>({...row})))
 d1.db.prepare("UPDATE product_images SET created_at='2026-09-15',sort_order=8 WHERE id=401").run();assertCurrent()
 d1.db.prepare("UPDATE promotion_rules SET title='unrelated-title' WHERE id=302").run();assertCurrent()
 d1.db.prepare("UPDATE product_images SET image_path='/uploads/rival.webp' WHERE id=201").run();assertStale();d1.db.prepare("UPDATE product_images SET image_path='/uploads/source.webp' WHERE id=201").run();assertCurrent()
 d1.db.prepare("UPDATE promotion_rules SET product_ids='[1]' WHERE id=301").run();assertStale();d1.db.prepare("UPDATE promotion_rules SET product_ids='[1,2]' WHERE id=301").run();assertCurrent()
 const fields={name_normalized:'rival',category:'rival',categories:'rival||next',brand:'rival',brands:'rival||next',brand_compact:'rival',unit:'rival',unit_normalized:'rival',parent_id:4,is_group:1,description:'rival',custom_fields:'{"rival":true}',tag_label:'rival',purchase_price_usd:1.0000000000000004,discount_amount_usd:1.0000000000000004}
 let rivals=0
 for(const id of [1,2])for(const [field,value]of Object.entries(fields)){const before=current(id);d1.db.prepare(`UPDATE products SET ${field}=@value WHERE id=@id`).run({value,id});assert.equal(current(id).updated_at,before.updated_at,'value-only same-second source');assertStale();d1.db.prepare(`UPDATE products SET ${field}=@value WHERE id=@id`).run({value:before[field],id});assertCurrent();rivals++}
 const columns=d1.db.prepare('PRAGMA table_info(products)').all().map(row=>row.name)
 assert.deepEqual(Object.keys(snapshot.canonicalProduct),columns,'complete schema in native order')
 assert.deepEqual(Object.keys(snapshot.duplicateProduct),columns)
 assert.deepEqual(snapshot.canonicalProduct,current(1),'all original native values/types/bits')
 assert.deepEqual(snapshot.duplicateProduct,current(2))
 assert.deepEqual(snapshot.childProductRows,[{id:3,parent_id:2,updated_at:'2026-10-09 19:00:00'}])
 assert.equal(snapshot.canonicalProduct.purchase_price_usd,0.30000000000000004)
 assert.equal(snapshot.canonicalProduct.discount_amount_usd,1.0000000000000002)
 d1.db.prepare("UPDATE products SET updated_at='2026-10-09 19:00:01' WHERE id=3").run();assertStale();d1.db.prepare("UPDATE products SET updated_at='2026-10-09 19:00:00' WHERE id=3").run();assertCurrent()
 d1.db.prepare('UPDATE products SET parent_id=4 WHERE id=3').run();assertStale();d1.db.prepare('UPDATE products SET parent_id=2 WHERE id=3').run();assertCurrent()
 d1.db.prepare("UPDATE products SET description='unrelated',updated_at='2026-10-09 19:00:01' WHERE id=4").run();assertCurrent()
 const before=JSON.stringify(await read());const row=current(1);d1.db.prepare('UPDATE products SET custom_fields=@value WHERE id=1').run({value:'X'.repeat(512*1024)});await assert.rejects(read(),/merge_case_snapshot_limit/);d1.db.prepare('UPDATE products SET custom_fields=@value WHERE id=1').run({value:row.custom_fields});assert.equal(JSON.stringify(await read()),before)
 const plan=capture.planProductMergeCaseSnapshot(1,2,[]);assert.equal(plan.reads.length,1);assert.ok(reads.every(count=>count===1));assert.equal(plan.reads[0].sql.includes('512000'),false);assert.ok(plan.reads[0].sql.includes('524288'))
 console.log(JSON.stringify({productColumns:columns.length,metadataRivals:rivals,childRivals:2,galleryPromotionRivals:galleryRivals.length,imageColumns:imageColumns.length,captureStatements:1,sourceGuardStatements:1,capturedBytes:Buffer.byteLength(guard.params.observedCapture,'utf8')}))
 d1.db.close();console.log('PASS complete two-product metadata/type/REAL capture; same-second rivals, child preimage, unrelated positive and bounded oversized refusal')
}
main().catch(error=>{console.error(error);process.exitCode=1})
