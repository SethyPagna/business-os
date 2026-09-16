import type { getDb } from './db'

export type ProductMergeIdentityBinding = { sale_id:number;sale_item_id:number;captured_product_id:number;current_product_id:number }
export class ProductMergeLineageError extends Error {
  readonly code='product_merge_lineage_conflict'
  constructor(){super('Recorded product identity requires review');this.name='ProductMergeLineageError'}
}
const fail=():never=>{throw new ProductMergeLineageError()}
const positive=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0
const MAX_ROWS=200,MAX_EVIDENCE=400,MAX_BYTES=500_000,MAX_DEPTH=16
type Evidence={id:number;kind:string;status:string;payload_json:string}
type Edge={from:number;to:number;ids:number[]}
const kinds="('product.merge','product.merge.bulk','product.merge.group.child')"
// Row identity is essential: a product-wide alias alone proves nothing about
// whether this particular recorded item was actually moved by the merge.
const relevant=`json_valid(payload_json)=1 AND (
 (kind IN ('product.merge','product.merge.group.child') AND EXISTS(
   SELECT 1 FROM json_each(payload_json,'$.reparentedSaleItemIds') i JOIN json_each(@lineageItems) wanted ON i.value=wanted.value))
 OR (kind='product.merge.bulk' AND EXISTS(SELECT 1 FROM json_each(payload_json,'$.reversals') r,
   json_each(r.value,'$.reparentedSaleItemIds') i JOIN json_each(@lineageItems) wanted ON i.value=wanted.value)))`

function edges(evidence:Evidence):Edge[]{
  let parsed:unknown
  try{parsed=JSON.parse(evidence.payload_json)}catch{return fail()}
  const reversals=evidence.kind==='product.merge.bulk'?(parsed as {reversals?:unknown})?.reversals:[parsed]
  if(!Array.isArray(reversals)||!reversals.length||reversals.length>MAX_EVIDENCE)fail()
  return (reversals as unknown[]).map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return fail()
    const row=value as Record<string,unknown>,ids=row.reparentedSaleItemIds
    if(!positive(row.dupId)||!positive(row.keeperId)||row.dupId===row.keeperId||!Array.isArray(ids)
      ||ids.length>100_000||ids.some(id=>!positive(id))||new Set(ids).size!==ids.length)fail()
    return {from:row.dupId as number,to:row.keeperId as number,ids:ids as number[]}
  })
}

/** Server-only resolver. Never accept bindings or merge evidence from a request. */
export async function resolveProductMergeLineage(db:ReturnType<typeof getDb>,saleId:number,lines:readonly Record<string,unknown>[]) {
  if(!positive(saleId)||!lines.length||lines.length>MAX_ROWS)fail()
  const requested:ProductMergeIdentityBinding[]=[]
  for(const line of lines){
    let parsed:any
    try{parsed=JSON.parse(String(line.pricing_snapshot_json))}catch{fail()}
    if(!Array.isArray(parsed?.pool?.lines))fail()
    const original=parsed.pool.lines.find((entry:any)=>entry?.line_key===parsed.line_key)?.product?.id
    if(!positive(line.id)||line.sale_id!==saleId||!positive(original)||!positive(line.product_id))fail()
    if(original!==line.product_id)requested.push({sale_id:saleId,sale_item_id:line.id as number,captured_product_id:original,current_product_id:line.product_id as number})
  }
  if(!requested.length)return {bindings:[] as ProductMergeIdentityBinding[],condition:'1=1',params:{} as Record<string,unknown>}
  const lineageItems=JSON.stringify(requested.map(row=>row.sale_item_id))
  const evidence=await db.prepare(`WITH candidates AS (SELECT id,kind,status,payload_json FROM undo_snapshots
    WHERE kind IN ${kinds} AND status='applied' AND ${relevant})
    SELECT * FROM candidates WHERE (SELECT COUNT(*) FROM candidates)<=${MAX_EVIDENCE}
      AND (SELECT COALESCE(SUM(length(CAST(payload_json AS BLOB))),0) FROM candidates)<=${MAX_BYTES}
    ORDER BY id LIMIT ${MAX_EVIDENCE+1}`)
    .all<Evidence>({lineageItems})
  if(!evidence.length||evidence.length>MAX_EVIDENCE||new TextEncoder().encode(JSON.stringify(evidence)).byteLength>MAX_BYTES)fail()
  const allEdges=evidence.flatMap(edges)
  for(const binding of requested){
    let current=binding.captured_product_id
    const seen=new Set<number>()
    for(let depth=0;current!==binding.current_product_id;depth++){
      if(depth>=MAX_DEPTH||seen.has(current))fail()
      seen.add(current)
      const next=allEdges.filter(edge=>edge.from===current&&edge.ids.includes(binding.sale_item_id))
      if(next.length!==1)fail()
      current=next[0].to
    }
    // Even an edge leaving the endpoint would contradict the recorded live row.
    if(allEdges.some(edge=>edge.from===current&&edge.ids.includes(binding.sale_item_id)))fail()
  }
  const lineageEvidence=JSON.stringify(evidence)
  return {bindings:requested,params:{lineageItems,lineageEvidence},condition:`
    (SELECT COUNT(*) FROM undo_snapshots WHERE kind IN ${kinds} AND status='applied' AND ${relevant})=json_array_length(@lineageEvidence)
    AND NOT EXISTS(SELECT 1 FROM json_each(@lineageEvidence) expected WHERE NOT EXISTS(
      SELECT 1 FROM undo_snapshots actual WHERE actual.id=json_extract(expected.value,'$.id')
      AND actual.kind=json_extract(expected.value,'$.kind') AND actual.status=json_extract(expected.value,'$.status')
      AND actual.payload_json=json_extract(expected.value,'$.payload_json')))`}
}

// Read-only companion for surfaces that must never 500 on an unprovable
// merge lineage (Sentry BUSINESS-OS-1F: migrations 0165/0168 reparented
// sale_items.product_id via raw SQL without writing the product.merge
// undo_snapshots evidence resolveProductMergeLineage requires, so every
// later GET /api/sales page containing one of those rows threw). This never
// accepts or proves an identity -- it only tells a READ path which lines it
// cannot prove, so the caller can render the sale and flag just those lines
// instead of failing the whole response. The strict resolver above remains
// the only path allowed to accept a binding, and stays the one writes use.
export function findSaleItemsRequiringIdentityReview(lines:readonly Record<string,unknown>[]):Set<number>{
  const flagged=new Set<number>()
  for(const line of lines){
    if(!positive(line.id))continue
    let parsed:any
    try{parsed=JSON.parse(String(line.pricing_snapshot_json))}catch{flagged.add(line.id as number);continue}
    const poolLines=parsed?.pool?.lines
    const original=Array.isArray(poolLines)?poolLines.find((entry:any)=>entry?.line_key===parsed.line_key)?.product?.id:undefined
    if(!positive(original)||!positive(line.product_id)||original!==line.product_id)flagged.add(line.id as number)
  }
  return flagged
}
