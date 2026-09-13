const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const files = ['frontend/src/utils/moneyPrecision.ts','cloudflare/src/lib/moneyPrecision.ts']
const texts = files.map(file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n'))
assert.equal(texts[0],texts[1],'exact-money twins remain byte-identical')
function compiled(source) {
  const mod={exports:{}}
  const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function('module','exports',out)(mod,mod.exports)
  return mod.exports
}
const defaults={paidUsd:1,paidKhr:20,payableUsd:1,exchangeRate:4020,changeExchangeRate:4020}
const vectors=[
  [{}, {changeUsd:0,changeKhr:20,hasOverpayment:true}],
  [{paidKhr:'20.099999'}, {changeUsd:0,changeKhr:20,hasOverpayment:true}],
  [{paidKhr:'20.1'}, {changeUsd:0.01,changeKhr:20,hasOverpayment:true}],
  [{paidKhr:'20.100001'}, {changeUsd:0.01,changeKhr:20,hasOverpayment:true}],
  [{paidKhr:'0.499999'}, {changeUsd:0,changeKhr:0,hasOverpayment:true}],
  [{paidKhr:'0.5'}, {changeUsd:0,changeKhr:1,hasOverpayment:true}],
  [{paidKhr:'0.500001'}, {changeUsd:0,changeKhr:1,hasOverpayment:true}],
  [{paidKhr:201,changeExchangeRate:4100}, {changeUsd:0.05,changeKhr:205,hasOverpayment:true}],
  [{paidKhr:'20.1025',exchangeRate:'4020.5',changeExchangeRate:'4001.25'}, {changeUsd:0.01,changeKhr:20,hasOverpayment:true}],
  [{paidUsd:'0.1',paidKhr:'0.2',payableUsd:'0.3',exchangeRate:1,changeExchangeRate:1}, {changeUsd:0,changeKhr:0,hasOverpayment:false}],
  [{paidKhr:0}, {changeUsd:0,changeKhr:0,hasOverpayment:false}],
  [{paidKhr:0,payableUsd:2}, {changeUsd:0,changeKhr:0,hasOverpayment:false}],
  [{paidUsd:0,paidKhr:0,payableUsd:0}, {changeUsd:0,changeKhr:0,hasOverpayment:false}],
  [{paidKhr:'0.000000000000000000000001'}, {changeUsd:0,changeKhr:0,hasOverpayment:true}],
]
// Independent positive-rational midpoint oracle in denomination integer units.
const nearest=(n,d)=>Number((2n*n+d)/(2n*d))
for(const [index,file] of files.entries()) for(const kernel of [require(path.join(root,file)),compiled(texts[index])]) {
  for(const [input,expected] of vectors) assert.deepEqual(kernel.nativeChangeAmounts({...defaults,...input}),expected,JSON.stringify(input))
  // Explicit discriminating regression: rounding the old intermediate4 first
  // would turn 20/4020 into .005 and incorrectly show .01 USD change.
  assert.equal(kernel.roundMoney2(kernel.divideMoney4(20,4020)),0.01)
  assert.equal(kernel.nativeChangeAmounts(defaults).changeUsd,0)
  for(const rate of [3999,4020,4100]) for(let milli=0;milli<=21000;milli+=37) {
    const value=kernel.nativeChangeAmounts({...defaults,paidKhr:String(milli/1000),exchangeRate:rate,changeExchangeRate:4100})
    const n=BigInt(Math.max(0,milli)),d=1000n*BigInt(rate)
    assert.deepEqual(value,{changeUsd:nearest(n*100n,d)/100,changeKhr:nearest(n*4100n,d),hasOverpayment:milli>0})
    assert.equal(Object.is(value.changeUsd,-0),false)
    assert.equal(Object.is(value.changeKhr,-0),false)
  }
  const reject=(input,code)=>assert.throws(()=>kernel.nativeChangeAmounts({...defaults,...input}),e=>e instanceof kernel.MoneyPrecisionError&&e.code===code)
  for(const field of Object.keys(defaults)) for(const bad of [null,undefined,'',NaN,Infinity,-Infinity,true,{},'1,000','1e25','0.'+'0'.repeat(24)+'1']) reject({[field]:bad},'invalid_decimal')
  for(const field of ['exchangeRate','changeExchangeRate']) {
    reject({[field]:0},'division_by_zero')
    reject({[field]:-1},'invalid_decimal')
    reject({[field]:0,paidUsd:0,paidKhr:0,payableUsd:1},'division_by_zero')
  }
  for(const field of ['paidUsd','paidKhr','payableUsd']) reject({[field]:'100000000000.0001'},'money_overflow')
  for(const field of ['paidUsd','paidKhr','payableUsd']) for(const negative of [-1,'-0.000000001','-0.000000000000000000000001']) reject({[field]:negative},'invalid_decimal')
  reject({paidUsd:kernel.MAX_MONEY_ABS,paidKhr:1,payableUsd:0,exchangeRate:1,changeExchangeRate:1},'money_overflow')
  reject({paidUsd:1,paidKhr:0,payableUsd:0,changeExchangeRate:'100000000001'},'money_overflow')
  reject({paidUsd:0,paidKhr:1,payableUsd:0,exchangeRate:'0.000000000001',changeExchangeRate:1},'money_overflow')
  assert.deepEqual(kernel.nativeChangeAmounts({paidUsd:kernel.MAX_MONEY_ABS,paidKhr:0,payableUsd:0,exchangeRate:1,changeExchangeRate:1}),{changeUsd:kernel.MAX_MONEY_ABS,changeKhr:kernel.MAX_MONEY_ABS,hasOverpayment:true})
}
console.log('PASS native change: exact denomination rounding, midpoint neighbors, decimals, independent rates, clamp/overpayment, invalid/range and native/transpiled twin parity')
