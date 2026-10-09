import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { isStockConditionTag } from '../src/utils/stockCondition.ts'
import { transformSync } from 'esbuild'
import { deriveProductSheetState } from '../src/components/pos/productSheetState.ts'
const product={id:1,stock_quantity:10,branch_stock:[{branch_id:2,branch_name:'Store',branch_role:'shop',branch_active:1,quantity:10}]}
const batch={id:11,quantity:10,__productId:1}
const tag={id:4,product_id:1,branch_id:2,batch_id:11,quantity_remaining:3}
const base={product,batches:[batch],damagedLots:[tag],trackedBatchProductIds:new Set([1]),knownPositiveBatchQuantityByProduct:{1:10}}
let state=deriveProductSheetState(base)
assert.equal(state.displayedStock,10,'D remains inside T, total never becomes13')
assert.equal(state.availableStock,7)
assert.equal(state.receivedDateOptions[0].quantity,7)
state=deriveProductSheetState({...base,selectedBatchId:11});assert.equal(state.availableStock,7);assert.equal(state.pickAllowed,true)
state=deriveProductSheetState({...base,selectedDamagedLotId:4});assert.equal(state.availableStock,3);assert.equal(state.pickAllowed,true)
assert.equal(deriveProductSheetState({...base,selectedDamagedLotId:4,conditionLookupUnavailable:true}).pickAllowed,false)
const mixed={...base,batches:[{...batch,quantity:6}],knownPositiveBatchQuantityByProduct:{1:6},damagedLots:[{...tag,quantity_remaining:2},{...tag,id:5,batch_id:null,quantity_remaining:1}]}
state=deriveProductSheetState(mixed);assert.equal(state.receivedDateOptions[0].quantity,4);assert.equal(state.unlottedStockQuantity,3,'only NULL tag is subtracted from physical NULL remainder')
assert.equal(deriveProductSheetState({...mixed,selectedDamagedLotId:5}).availableStock,1)
assert.equal(deriveProductSheetState({...base,damagedLots:[{...tag,product_id:99}]}).receivedDateOptions[0].quantity,10,'another product same-looking batch cannot consume this ordinary cap')
assert.equal(deriveProductSheetState({...base,damagedLots:[{...tag,branch_id:3}]}).availableStock,10)
const row2={...product,id:2,stock_quantity:3,branch_stock:[{...product.branch_stock[0],quantity:3}]}
state=deriveProductSheetState({product:{...product,stock_quantity:0,branch_stock:[{...product.branch_stock[0],quantity:0}]},variants:[{...product,stock_quantity:0,branch_stock:[{...product.branch_stock[0],quantity:0}]},row2],groupProduct:true,trackedBatchProductIds:new Set([1,2]),optionStepTitleFor:()=> 'Option',batches:[{...batch,id:22,quantity:3,__productId:2}],knownPositiveBatchQuantityByProduct:{1:0,2:3},damagedLots:[{...tag,product_id:2,batch_id:22}],selectedDamagedLotId:4})
assert.equal(state.mergeRowsIntoLotList,true);assert.equal(state.effectiveVariant?.id,2);assert.equal(state.availableStock,3)
assert.equal(deriveProductSheetState({...base,intent:'stock'}).receivedDateOptions[0].quantity,10,'receiving/stock selection preserves physical receipt quantity')
const pos=fs.readFileSync(new URL('../src/components/pos/POS.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('POS.tsx',pos,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let body='';function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==='addToCart')body=n.getText(ast);ts.forEachChild(n,visit)}visit(ast)
let notices=0,opened=0,patches=0
const scope={active:{checkoutRequestId:null,money_precision_version:1,cart:[{id:1,quantity:7,branch_id:2}]},notify:()=>{notices++},t:(key:string)=>key,setDetailProduct:()=>{opened++},moneyCapability:{assertReady:()=>{}},promotionReadVersion:1,resolveCartPriceValues:()=>({price_mode:'selling'}),exchangeRate:4000,promotionRules:[],CURRENCY:{usdToKhr:()=>0},findMatchingCartLineIndex:()=>0,patchActive:()=>{patches++}}
const add=new Function(...Object.keys(scope),ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return addToCart')(...Object.values(scope))
add(product,'selling',{quantity:7},2);assert.equal(notices,1,'ordinary eighth unit rejected by actual cart cap');assert.equal(patches,0)
add(product);assert.equal(opened,1,'plain/barcode add requires existing sheet condition proof')
console.log('PASS counted T-D, exact lot/product/branch, receipt/NULL, merged tagged-only row, stock intent and actual POS eighth-unit/plain guards')

// Execute the actual wire reader with its existing route seam, including malformed ownership refusals.
const transportSource = fs.readFileSync(new URL('../src/api/damagedLotsTransport.ts', import.meta.url), 'utf8')
const transportModule = { exports: {} as any }
let wire: any = { lots: [{ ...tag, condition_tag: 'damaged' }] }
let readOptions: any
let apiArgs: any[] = []
const requireTransport = (name: string) => name.endsWith('http.ts') ? {
  route: async (_key: string, fetcher: (signal: AbortSignal) => Promise<any>, _fallback: unknown, options: any) => { readOptions = options; return fetcher(options.signal) },
  apiFetch: async (...args: any[]) => { apiArgs = args; return wire },
} : name.endsWith('stockCondition.ts') ? { isStockConditionTag } : { ensureClientRequestId: (value: any) => value }
new Function('module', 'exports', 'require', transformSync(transportSource, { loader: 'ts', format: 'cjs' }).code)(transportModule, transportModule.exports, requireTransport)
const signal = new AbortController().signal
const read = transportModule.exports.getDamagedLots
assert.equal((await read(1, 2, signal)).lots[0].product_id, 1)
assert.equal(readOptions.bypassCache, true)
assert.equal(readOptions.raceLocalFallback, false)
assert.equal(apiArgs[4].signal, signal)
wire = { lots: [{ ...tag, product_id: undefined }] }
assert.equal((await read(1, 2, signal)).lots[0].product_id, 1, 'route-bound product identity added when old DTO omits it')
for (const bad of [{ lots: null }, { lots: [{ ...tag, product_id: 2 }] }, { lots: [{ ...tag, branch_id: 3 }] }, { lots: [{ ...tag, quantity_remaining: -1 }] }, { lots: [{ ...tag, id: 0 }] }, { lots: [{ ...tag, batch_id: undefined }] }, { lots: [{ ...tag, condition_tag: 'ordinary' }] }]) {
  wire = bad
  await assert.rejects(read(1, 2, signal), /Invalid condition stock/)
}
console.log('PASS actual condition transport fresh route, AbortSignal, source provenance and malformed/cross-owner refusals')
