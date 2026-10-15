import assert from 'node:assert/strict'
import { validateMergeDuplicatesPreviewResponse } from '../src/components/products/mergeDuplicatesPreviewResponse.ts'

const fullPreview = {
  success: true,
  groupCount: 2,
  duplicateProductCount: 3,
  mergeableDuplicateProductCount: 2,
  blockedGroupCount: 1,
  costRefusalCount: 1,
  batchLimit: 25,
  groups: [
    {
      caseKeys: ['10:11', '10:12'],
      canonicalId: 10,
      canonicalName: 'Kept A',
      canonicalBarcode: '0010',
      duplicates: [
        { id: 11, name: 'Copy A1', barcode: '00010', quantity: 2, batchCount: 0 },
        { id: 12, name: null, barcode: null, quantity: 3, batchCount: 1 },
      ],
      totalQuantityToMove: 5,
      branchBreakdown: [{ branchId: 1, branchName: 'Shop', quantity: 5 }],
      costBefore: { cost_price_usd: 4, cost_price_khr: 0 },
      costAfter: { cost_price_usd: 5, cost_price_khr: 0 },
      mergeable: true,
      mergeBlockers: [],
      costRefusals: [],
    },
    {
      caseKeys: ['20:21'],
      canonicalId: 20,
      canonicalName: null,
      canonicalBarcode: '20',
      duplicates: [
        { id: 21, name: 'Copy B', barcode: '020', quantity: 4, batchCount: 2 },
      ],
      totalQuantityToMove: 4,
      branchBreakdown: [{ branchId: 2, branchName: null, quantity: 4 }],
      costBefore: { cost_price_usd: 7 },
      costAfter: { cost_price_usd: 7 },
      mergeable: false,
      mergeBlockers: [{ code: 'merge_plan_history_unavailable', error: 'History is unavailable.' }],
      costRefusals: [{ mergedId: 21, field: 'cost_price_usd', code: 'invalid_cost', error: 'Cost is invalid.' }],
    },
  ],
}

const parsed = validateMergeDuplicatesPreviewResponse(fullPreview)
assert.deepEqual(
  {
    groupCount: parsed.groupCount,
    duplicateProductCount: parsed.duplicateProductCount,
    mergeableDuplicateProductCount: parsed.mergeableDuplicateProductCount,
    blockedGroupCount: parsed.blockedGroupCount,
    costRefusalCount: parsed.costRefusalCount,
  },
  {
    groupCount: 2,
    duplicateProductCount: 3,
    mergeableDuplicateProductCount: 2,
    blockedGroupCount: 1,
    costRefusalCount: 1,
  },
  'a complete current Worker response is accepted without coercing its counts',
)

assert.deepEqual(
  validateMergeDuplicatesPreviewResponse({ success: true, groupCount: 0, duplicateProductCount: 0, groups: [] }),
  {
    groupCount: 0,
    duplicateProductCount: 0,
    mergeableDuplicateProductCount: 0,
    blockedGroupCount: 0,
    groups: [],
    costRefusalCount: 0,
  },
  'the current zero-result Worker response may omit metrics and normalizes them to zero',
)

function expectInvalid(name: string, mutate: (fixture: any) => void): void {
  const fixture = structuredClone(fullPreview) as any
  mutate(fixture)
  assert.throws(
    () => validateMergeDuplicatesPreviewResponse(fixture),
    /Invalid merge preview response:/,
    name,
  )
}

expectInvalid('success must be explicitly true', (value) => { delete value.success })
expectInvalid('numeric strings are not count values', (value) => { value.groupCount = '2' })
expectInvalid('negative values are not count values', (value) => { value.groupCount = -1 })
expectInvalid('fractional values are not count values', (value) => { value.groupCount = 2.5 })
expectInvalid('infinite values are not count values', (value) => { value.groupCount = Number.POSITIVE_INFINITY })
expectInvalid('unsafe integers are not count values', (value) => { value.groupCount = Number.MAX_SAFE_INTEGER + 1 })
expectInvalid('nonempty previews require every aggregate metric', (value) => { delete value.costRefusalCount })
expectInvalid('nonempty previews require a batch limit', (value) => { delete value.batchLimit })
expectInvalid('group count must match the group array', (value) => { value.groupCount = 1 })
expectInvalid('duplicate count must match the member arrays', (value) => { value.duplicateProductCount = 2 })
expectInvalid('mergeable count must match mergeable groups', (value) => { value.mergeableDuplicateProductCount = 3 })
expectInvalid('blocked count must match blocked groups', (value) => { value.blockedGroupCount = 0 })
expectInvalid('refusal count must match nested refusals', (value) => { value.costRefusalCount = 0 })
expectInvalid('nested duplicate collections must be arrays', (value) => { value.groups[0].duplicates = {} })
expectInvalid('nested branch collections must be arrays', (value) => { value.groups[0].branchBreakdown = {} })
expectInvalid('duplicate IDs must be unique inside a group', (value) => { value.groups[0].duplicates[1].id = 11 })
expectInvalid('product IDs must be disjoint across groups', (value) => { value.groups[1].canonicalId = 11 })
expectInvalid('case keys must be unique across the preview', (value) => { value.groups[1].caseKeys[0] = '10:11' })
expectInvalid('branch IDs must be unique inside a group', (value) => {
  value.groups[0].branchBreakdown.push({ branchId: 1, branchName: 'Shop again', quantity: 0 })
})
expectInvalid('quantity totals must match duplicate quantities', (value) => { value.groups[0].totalQuantityToMove = 6 })
expectInvalid('quantity totals must match branch quantities', (value) => { value.groups[0].branchBreakdown[0].quantity = 6 })
expectInvalid('NaN is not valid nested numeric data', (value) => { value.groups[0].costAfter.cost_price_usd = Number.NaN })
expectInvalid('mergeable must agree with blocker/refusal state', (value) => { value.groups[1].mergeable = true })
expectInvalid('unexpected root fields are rejected', (value) => { value.previewVersion = 1 })
expectInvalid('unexpected member fields are rejected', (value) => { value.groups[0].duplicates[0].secret = 'extra' })

console.log('PASS merge duplicate preview response validation')

const authorityPreview=structuredClone(fullPreview) as any
for(const g of authorityPreview.groups) if(g.mergeable) g.costAuthority={version:1,keeperId:g.canonicalId,cost_price_usd:null,cost_price_khr:0,needsReview:true,source:'keeper_fallback'}
authorityPreview.costReview={version:1,reviewed_digest:'a'.repeat(64),groups:authorityPreview.groups.filter((g:any)=>g.mergeable).map((g:any)=>({keeper_id:g.canonicalId,member_ids:[g.canonicalId,...g.duplicates.map((d:any)=>d.id)].sort((a:number,b:number)=>a-b),reviewed_digest:'b'.repeat(64)})).sort((a:any,b:any)=>a.keeper_id-b.keeper_id)}
assert.deepEqual(validateMergeDuplicatesPreviewResponse(authorityPreview).costReview,authorityPreview.costReview)
for(const mutate of [
 (r:any)=>{r.groups[0].member_ids[0]=999},
 (r:any)=>{r.groups.push({...r.groups[0],keeper_id:999})},
 (r:any)=>{r.groups.push(structuredClone(r.groups[0]))},
 (r:any)=>{r.groups[0].member_ids.reverse()},
 (r:any)=>{r.groups[0].member_ids.push(r.groups[0].member_ids[0])},
 (r:any)=>{r.groups=[]},
]){const bad=structuredClone(authorityPreview);mutate(bad.costReview);assert.throws(()=>validateMergeDuplicatesPreviewResponse(bad),'cost approval must match exact displayed group/member scope')}
for(const cost of [null,0,5.1244]){const value=structuredClone(authorityPreview);value.groups[0].costAuthority.cost_price_usd=cost;assert.equal(validateMergeDuplicatesPreviewResponse(value).groups[0].costAuthority?.cost_price_usd,cost)}
console.log('PASS exact displayed group approval scope, nullable authority and malformed/extra/duplicate/order controls')
