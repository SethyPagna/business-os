import * as api from 'guard:analytics'
import {getDb} from 'guard:db'
import * as money from 'guard:money'
import {resetReadSwitchMemo} from 'guard:switches'
const encoder=new TextEncoder(),bytes=value=>encoder.encode(JSON.stringify(value)).byteLength
const POISON='__report_guard_detail_poison'
const poison={sql:"SELECT json_extract('[1]','$[__report_guard_detail_poison]') AS poisoned"}
const mainMarker='report_restore_state_changed'
function summarizeValue(value){if(value instanceof ArrayBuffer)return {binary_bytes:value.byteLength};if(ArrayBuffer.isView(value))return {binary_bytes:value.byteLength};return value}
function meter(raw,input){
 let phase='setup';const calls=[]
 const statement=(inner,sql,values=[])=>new Proxy(inner,{get(target,key){
  if(key==='__inner')return target;if(key==='__sql')return sql;if(key==='__values')return values
  if(key==='bind')return(...next)=>statement(target.bind(...next),sql,next)
  if(key==='all')return async(...args)=>{const event={phase,operation:'all',arity:1,sqls:[sql],bindings:[values.map(summarizeValue)]};calls.push(event);try{const result=await target.all(...args);event.results=[{rows_read:result.meta?.rows_read??null,rows_written:result.meta?.rows_written??null,rows:result.results?.length??null}];return result}catch(error){event.error=String(error);event.unknown_metadata=1;throw error}}
  if(['run','first','raw'].includes(key))return()=>{throw new Error('Unmeasured raw operation '+key)}
  const value=target[key];return typeof value==='function'?value.bind(target):value
 }})
 const db=new Proxy(raw,{get(target,key){
  if(key==='prepare')return sql=>statement(target.prepare(sql),sql)
  if(key==='batch')return async supplied=>{
   let items=supplied,patch=null
   const isMain=items.some(item=>item.__sql?.includes(mainMarker)),isFlags=items.some(item=>item.__sql?.includes('report_flags_bytes'))
   const selected=input.mode!=='diagnose'&&((input.stage||'main')==='main'?isMain:isFlags)
   if(selected){
    if(input.bypass){
     const index=isMain?1:0,before=items[index].__sql
     const pattern=isMain?/json_extract\('\[1\]','\$\[report_totals_(?:rows|bytes|receipts)\]'\)/g:/json_extract\('\[1\]','\$\[report_flags_(?:rows|bytes)\]'\)/g
     let count=0;const sql=before.replace(pattern,match=>{count++;return match.replace("'[1]'","'{}'")})
     if(count<2)throw new Error('Bypass instrument must alter named native error operands')
     const values=items[index].__values;items=items.slice();items[index]=db.prepare(sql).bind(...values);patch={kind:'named-no-throw-error-document',index,count,before,after:sql}
    }
    if(input.poison&&input.poison!=='none'){
     const at=input.poison==='before'?0:isMain?2:1
     items=items.slice();items.splice(at,0,db.prepare(poison.sql))
    }
   }
   const event={phase:selected?'guard':phase,operation:'batch',arity:items.length,sqls:items.map(item=>item.__sql),bindings:items.map(item=>item.__values.map(summarizeValue)),instrumentation:patch};calls.push(event)
   try{const result=await target.batch(items.map(item=>item.__inner));event.results=result.map(row=>({rows_read:row.meta?.rows_read??null,rows_written:row.meta?.rows_written??null,rows:row.results?.length??null}));return result}catch(error){event.error=String(error);event.unknown_metadata=items.length;throw error}
  }
  if(['exec','withSession','dump'].includes(key))return()=>{throw new Error('Unmeasured database operation '+key)}
  const value=target[key];return typeof value==='function'?value.bind(target):value
 }})
 return {db,calls,setPhase(value){phase=value}}
}
function stateView(state){if(!state)return null;const {flags,...rest}=state;return {...rest,flags:flags.map(flag=>({key:flag.key,kind:flag.kind,bytes:flag.bytes.byteLength}))}}
function nativeError(error,calls){const text=String(error?.message||error),nativeMessage=[...calls].reverse().find(call=>call.phase==='guard'&&call.error)?.error||'';const found=[POISON,'report_totals_receipts','report_totals_rows','report_totals_bytes','report_totals_storage','report_flags_rows','report_flags_bytes','report_restore_state_changed'].find(marker=>text.includes(marker)||nativeMessage.includes(marker))||null;return {name:error?.name,code:error?.code??null,message:text,native_message:nativeMessage,marker:found,mapped_status:error instanceof money.ReportMoneyPrecisionError?money.reportMoneyHttpError(error).status:null,native_guard_attempts:calls.filter(call=>call.phase==='guard').length}}
async function run(input,env){
 resetReadSwitchMemo()
 const raw=input.flagsDb?env.FLAGS:env.DB,measured=meter(raw,input),local={...env,DB:measured.db,PLAN_TIER:'paid'},db=getDb(local)
 const policy={...api.__guardPolicy,...(input.policy||{})}
 let state=null,plan=null,batch=null
 try{
  if(input.mode==='full-oracle'){
   measured.setPhase('full-oracle');const snapshot=await api.readSalesReportSnapshot(local,{},!!input.fees,undefined,input.options||{}),totals=api.salesTotalsFromSnapshot(snapshot)
   const value={totals,sale_count:snapshot.sales.length,cancelled_count:snapshot.voidSales.length,precision_mode:snapshot.precision_mode,row_count:snapshot.row_count,diagnostic:api.reportMoneyDiagnostic(totals)}
   return {ok:true,kind:'full-oracle-success',value,snapshot,calls:measured.calls}
  }
  if(input.mode==='execute'){
   measured.setPhase('application');const value=await api.readSalesReportTotals(local,{},!!input.fees,undefined,input.options||{})
   return {ok:true,kind:'application-success',value:{...value,diagnostic:api.reportMoneyDiagnostic(value.totals)},calls:measured.calls}
  }
  if(input.mode==='prefetch'){
   measured.setPhase('prefetch');state=await api.__guardState(db,input.maxBytes??policy.maxBytes,true,policy)
   return {ok:true,kind:'state',state:stateView(state),calls:measured.calls}
  }
  measured.setPhase('prefetch');state=await api.__guardState(db,api.__guardPolicy.maxBytes,true,api.__guardPolicy)
  if(!state||!state.atomicSupported||!state.firstRestoreChecked)throw new Error('Direct data guard needs a supported classified restore snapshot')
  measured.setPhase('plan');plan=await api.__guardPlan(local,{},!!input.fees,null,input.options||{},'totals')
  batch=api.__guardBatch(plan,state,input.options||{},policy)
  if(input.mode==='diagnose'){
   const admission=batch.statements[1],pattern=/json_extract\('\[1\]','\$\[report_totals_(?:rows|bytes|receipts)\]'\)/g
   let replacements=0;let sql=admission.sql.replace(pattern,()=>{replacements++;return'NULL'})
   if(replacements<2)throw new Error('Diagnostic must preserve and neutralize actual named error operands')
   if(sql.split('SUM(n) AS data_rows').length!==2)throw new Error('Diagnostic largest-row projection anchor')
   sql=sql.replace('SUM(n) AS data_rows','MAX(largest) AS probe_largest,SUM(n) AS data_rows')
   measured.setPhase('diagnostic')
   const result=await db.batch([batch.statements[0],{...admission,sql}])
   return {ok:true,kind:'diagnostic',admission:result[1].results[0],control:batch.control,state:stateView(state),policy,groups:plan.groups.map(group=>({kind:group.kind,columns:group.columns})),instrumentation:{kind:'diagnostic-no-error/one-extra-projection',replacements,before:admission.sql,after:sql},calls:measured.calls}
  }
  measured.setPhase('guard');const result=await db.batch(batch.statements)
  const arrays=result.slice(2).map(row=>row.results),actual=bytes(arrays),admission=result[1].results[0]
  if(actual>admission.detail_upper)throw new Error('Actual detail result arrays exceeded admitted native upper bound')
  return {ok:true,kind:'direct-success',admission,actual_detail_arrays_utf8:actual,control:batch.control,state:stateView(state),policy,calls:measured.calls}
 }catch(error){return {ok:true,kind:'error',error:nativeError(error,measured.calls),state:stateView(state),policy,control:batch?.control??null,calls:measured.calls}}
}
export default{async fetch(request,env){try{return Response.json(await run(await request.json(),env))}catch(error){return Response.json({ok:false,error:{name:error?.name,message:String(error?.message||error)}},{status:500})}}}
