'use strict'
process.env.AL_PLAN_TIER=process.env.AL_PLAN_TIER||'free'
const assert=require('node:assert/strict')
const H=require('./harness/al_money_native.cjs')
const gateHeader='x-al-refusal-race-gate'
const budgetGuard='assertSaleSnapshotBudget({ header:saleInsertStatement.params, items:priced })'

async function main(){
  const h=await H.startWorker({d1CallLimit:H.FREE_QUERY_LIMIT,patches:[
    {name:'deterministic request gates',file:'src/routes/sales.ts',from:"app.post('/', async (c) => {",to:`
      const fixtureRefusalGates=new Map<string,boolean>()
      async function fixtureAwaitRefusalGate(gate:string){fixtureRefusalGates.set(gate,true);while(fixtureRefusalGates.get(gate))await new Promise(resolve=>setTimeout(resolve,25));fixtureRefusalGates.delete(gate)}
      app.get('/__fixture/refusal-gates',c=>c.json({gates:[...fixtureRefusalGates].filter(([,waiting])=>waiting).map(([gate])=>gate)}))
      app.post('/__fixture/release-refusal-gate',async c=>{const {gate}=await c.req.json();const waiting=fixtureRefusalGates.get(gate);fixtureRefusalGates.set(gate,false);return c.json({released:!!waiting})})
      app.post('/', async (c) => {`},
    {name:'capture before refusal gate',file:'src/routes/sales.ts',from:budgetGuard,
      to:`if(c.req.header('${gateHeader}')==='A')await fixtureAwaitRefusalGate('A'); ${budgetGuard}`},
    {name:'prepared competing write gate',file:'src/routes/sales.ts',
      from:"createResults = await executeStockTransaction(db, statements, 'retry') as typeof createResults",
      to:`if(c.req.header('${gateHeader}')==='B'&&attempt===0)await fixtureAwaitRefusalGate('B'); createResults = await executeStockTransaction(db, statements, 'retry') as typeof createResults`},
  ]})
  const pending=[]
  const release=gate=>h.call('POST','/api/sales/__fixture/release-refusal-gate',{gate},'release '+gate)
  const waitFor=async gate=>{
    const deadline=Date.now()+30_000
    while(Date.now()<deadline){
      const result=await h.call('GET','/api/sales/__fixture/refusal-gates',undefined,'wait for '+gate)
      if(result.body.gates?.includes(gate))return
      await new Promise(resolve=>setTimeout(resolve,25))
    }
    throw new Error('Fixture gate not reached: '+gate)
  }
  const gated=gate=>({...h,call:(method,url,body,label,options={})=>h.call(method,url,body,label,{...options,headers:{...options.headers,[gateHeader]:gate}})})
  try{
    const lines=[]
    for(let index=0;index<20;index++){
      const productId=18000+index
      await H.seedProduct(h,productId,'Refusal race product '+index,10,100,4)
      lines.push({productId,quantity:1})
    }
    const metadata=brand=>h.db.batch(lines.map(line=>h.db.prepare('UPDATE products SET brand=? WHERE id=?').bind(brand,line.productId)))
    for(const commitFirst of [false,true]){
      const key='refusal-concurrency-'+(commitFirst?'commit-first':'refuse-first')
      const request={key,lines,paymentDetails:[{method:'Cash',amount_usd:200,amount_khr:0}],createdAt:new Date().toISOString()}
      const before=await h.one('SELECT COUNT(*) sales,(SELECT COUNT(*) FROM sale_items) items,(SELECT SUM(quantity) FROM branch_stock) stock FROM sales')
      await metadata('a'.repeat(5000))
      const first=H.createSale(gated('A'),request)
      pending.push(first)
      await waitFor('A')
      await metadata('small metadata')
      const second=H.createSale(commitFirst?h:gated('B'),request)
      pending.push(second)
      if(commitFirst){
        const committed=await second
        assert.equal(committed.status,200,JSON.stringify(committed.body))
        await release('A')
        const reconciled=await first
        console.log(JSON.stringify({case:'commit-first',committed:committed.status,reconciled:reconciled.status,code:reconciled.body.code}))
        assert.equal(reconciled.status,200,JSON.stringify(reconciled.body))
        assert.equal(reconciled.body.id,committed.body.id)
      }else{
        await waitFor('B')
        await release('A')
        const refused=await first
        assert.equal(refused.status,409,JSON.stringify(refused.body))
        assert.equal(refused.body.proven_uncommitted,true)
        await release('B')
        const competitor=await second
        console.log(JSON.stringify({case:'refuse-first',refused:refused.status,competitor:competitor.status,competitorCode:competitor.body.code}))
        assert.equal(competitor.status,409,'A same-key request must not commit after a proven terminal refusal')
        assert.deepEqual(await h.one('SELECT COUNT(*) sales,(SELECT COUNT(*) FROM sale_items) items,(SELECT SUM(quantity) FROM branch_stock) stock FROM sales'),before)
      }
    }
    console.log(JSON.stringify({status:'PASS',tier:process.env.AL_PLAN_TIER,maxPhysicalCalls:Math.max(...h.metrics.filter(entry=>entry.label!=='login').map(entry=>entry.calls))}))
  }finally{
    await release('A').catch(()=>{})
    await release('B').catch(()=>{})
    await Promise.allSettled(pending)
    await h.mf.dispose()
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
