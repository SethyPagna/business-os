import assert from 'node:assert/strict'
import { isConfirmedProductCreateApproval, isProductCreateReviewState } from '../src/utils/productCreateOutcome.ts'
const row = { id: 41, section: 'products', action_type: 'create', entity_type: 'product', status: 'approved' }
assert.equal(isConfirmedProductCreateApproval(41, { success: true, data: row }), true)
assert.equal(isConfirmedProductCreateApproval(41, { success: true, data: row, replayed: true }), true)
for (const value of [null, [], {}, { success: true }, { success: false, data: row }, { success: 1, data: row },
  { success: true, pending: true, data: row }, { success: true, pending: 'true', data: row },
  ...[{id:42},{id:'41'},{status:'open'},{status:'rejected'},{section:'branches'},{action_type:'update'},{entity_type:'variant'}]
    .map(change=>({success:true,data:{...row,...change}}))]) assert.equal(isConfirmedProductCreateApproval(41,value),false,JSON.stringify(value))
assert.equal(isProductCreateReviewState(41,{...row,status:'rejected'},'rejected'),true)
for (const id of [0,-1,1.2,NaN,Infinity]) assert.equal(isProductCreateReviewState(id,{...row,id},'approved'),false)
console.log('PASS exact product approval and reconciliation discriminate identity/status/pending')
