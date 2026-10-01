const assert=require('node:assert/strict')
const fs=require('node:fs'),ts=require('typescript'),path=require('node:path')
function load(rel){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib',rel+'.ts'),'utf8').replace(process.env.STOCK_FUNDING_NO_DEBT_CONTROL?'const offset = Math.min(next.debt4,amount4)':'__disabled_control__', 'const offset = 0'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(r=>load(r.replace('./','')),m,m.exports);return m.exports}
const {fundingTransition}=load('stockFundingMath')
for(const paid of [0,400000,800000,1000000]){
 const s={gross4:1000000,paid4:paid,debt4:1000000-paid,credit4:0,asset4:0,cashIn4:0,cashOut4:0,shipping4:0}
 assert.deepEqual(fundingTransition(s,'pending',300000),s)
 const c=fundingTransition(s,'accept',300000)
 assert.equal(c.debt4,Math.max(0,700000-paid));assert.equal(c.asset4,Math.max(0,paid-700000))
 assert.equal(c.gross4,c.paid4+c.debt4+c.credit4-c.asset4-c.cashIn4)
 if(paid===1000000){const r=fundingTransition(c,'refund',100000);assert.equal(r.asset4,200000);assert.equal(r.cashIn4,100000)}
 const shipping=fundingTransition(c,'shipping',70000);assert.equal(shipping.shipping4,70000);assert.equal(shipping.debt4,c.debt4);assert.equal(shipping.credit4,c.credit4)
 if(c.debt4){const pay=fundingTransition(c,'payment',c.debt4);assert.equal(pay.debt4,0);assert.equal(pay.cashOut4,c.debt4)}
 for(const bad of [-1,0,NaN,Infinity,0.5])assert.throws(()=>fundingTransition(c,'accept',bad))
 assert.throws(()=>fundingTransition(c,'accept',1000001))
 assert.throws(()=>fundingTransition(c,'refund',c.asset4+1))
 assert.throws(()=>fundingTransition(c,'payment',c.debt4+1))
}
console.log('PASS exact funding oracle paid0/40/80/100, pending, credit, refund, payment, separate shipping and unsupported money')
