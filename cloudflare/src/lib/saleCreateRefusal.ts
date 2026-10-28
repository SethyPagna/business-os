import type { D1Compat } from './db'
import { ordinaryBusinessMaintenanceGuard } from './businessMaintenanceGuard'
import { offlineSaleOwnerError, type OfflineSaleOwner } from './offlineSaleOwnership'

const SCHEMA_HASHES: Readonly<Record<string,string>> = {
  sale_create_refusals:'18bf13790ef7859fa16fc1e9ef1c20ffcf90320625227556fe0190c21af8d844',
  sales_create_refusal_insert_0276:'15bd97515d1553095eda36bbb49060be488c165a4cb9a5d5451762ac67225127',
  sales_create_refusal_update_0276:'f6350baed1333dbf60287abb817e2c2a233c3a37c48a16b25a5310e4b7a87ab9',
}
const schemaSql = `SELECT name,sql FROM sqlite_master
  WHERE name IN('sale_create_refusals','sales_create_refusal_insert_0276','sales_create_refusal_update_0276')`
const refusalSql = 'SELECT client_request_id,actor_id,owner_json,reason FROM sale_create_refusals WHERE client_request_id=@request'
const committedSaleSql = `SELECT id,receipt_number,cashier_id,(SELECT COUNT(*) FROM sale_items WHERE sale_id=sales.id) item_count
  FROM sales WHERE client_request_id=@request AND client_request_id<>'' LIMIT 1`

type RefusalRow = {client_request_id:string;actor_id:number;owner_json:string;reason:string}
type CommittedSale = {id:number;receipt_number:string;cashier_id:number|null;item_count:number}
export type SaleCreateRefusalDecision =
  | {kind:'committed';sale:CommittedSale}
  | {kind:'refused'}
  | {kind:'owner_mismatch'}
  | {kind:'missing'}

export class SaleCreateRefusalUnavailableError extends Error {
  readonly code='sale_create_refusal_schema_not_ready'
  constructor(cause?:unknown){
    super('Checkout recovery protection is unavailable. Keep the original pending sale and try again after maintenance.',{cause})
    this.name='SaleCreateRefusalUnavailableError'
  }
}

export async function assertSaleCreateRefusalSchema(rows:readonly {name:string;sql:string|null}[]):Promise<void>{
  const definitions=new Map(rows.map(row=>[row.name,row.sql]))
  for(const [name,expected] of Object.entries(SCHEMA_HASHES)){
    const sql=definitions.get(name)
    if(typeof sql!=='string')throw new SaleCreateRefusalUnavailableError()
    const canonical=sql.trim().replace(/;\s*$/,'').replace(/\s+/g,' ')
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical))
    const actual=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')
    if(actual!==expected)throw new SaleCreateRefusalUnavailableError()
  }
}

function refusalDecision(row:RefusalRow|undefined,requestId:string,owner:OfflineSaleOwner):SaleCreateRefusalDecision{
  if(!row)return {kind:'missing'}
  let captured:unknown
  try{captured=JSON.parse(row.owner_json)}catch{return {kind:'owner_mismatch'}}
  if(row.client_request_id!==requestId||row.actor_id!==owner.actor_id||offlineSaleOwnerError(captured,owner))return {kind:'owner_mismatch'}
  if(row.reason!=='sale_snapshot_too_large')throw new SaleCreateRefusalUnavailableError()
  return {kind:'refused'}
}

export async function readSaleCreateRefusal(db:D1Compat,requestId:string,owner:OfflineSaleOwner):Promise<SaleCreateRefusalDecision>{
  let results:Awaited<ReturnType<D1Compat['batch']>>
  try{
    results=await db.batch([{sql:schemaSql},{sql:committedSaleSql,params:{request:requestId}},{sql:refusalSql,params:{request:requestId}},ordinaryBusinessMaintenanceGuard])
  }catch(error){throw new SaleCreateRefusalUnavailableError(error)}
  const sale=results[1].results[0] as CommittedSale|undefined
  if(sale)return sale.cashier_id===owner.actor_id?{kind:'committed',sale}:{kind:'owner_mismatch'}
  await assertSaleCreateRefusalSchema(results[0].results as {name:string;sql:string|null}[])
  return refusalDecision(results[2].results[0] as RefusalRow|undefined,requestId,owner)
}

/** The same transaction chooses either the existing sale or a permanent refusal. */
export async function certifySaleCreateRefusal(db:D1Compat,requestId:string,owner:OfflineSaleOwner):Promise<SaleCreateRefusalDecision>{
  if(!requestId||requestId!==requestId.trim()||requestId.length>120)throw new SaleCreateRefusalUnavailableError()
  let results:Awaited<ReturnType<D1Compat['batch']>>
  try{
    results=await db.batch([
      {sql:schemaSql},
      {sql:`INSERT OR IGNORE INTO sale_create_refusals(client_request_id,actor_id,owner_json,reason)
        SELECT @request,@actor,@owner,'sale_snapshot_too_large'
        WHERE NOT EXISTS(SELECT 1 FROM sales WHERE client_request_id=@request AND client_request_id<>'')`,
       params:{request:requestId,actor:owner.actor_id,owner:JSON.stringify(owner)}},
      {sql:committedSaleSql,params:{request:requestId}},
      {sql:refusalSql,params:{request:requestId}},
      ordinaryBusinessMaintenanceGuard,
    ])
  }catch(error){throw new SaleCreateRefusalUnavailableError(error)}
  const sale=results[2].results[0] as CommittedSale|undefined
  if(sale)return sale.cashier_id===owner.actor_id?{kind:'committed',sale}:{kind:'owner_mismatch'}
  await assertSaleCreateRefusalSchema(results[0].results as {name:string;sql:string|null}[])
  const decision=refusalDecision(results[3].results[0] as RefusalRow|undefined,requestId,owner)
  if(decision.kind==='missing')throw new SaleCreateRefusalUnavailableError()
  return decision
}
