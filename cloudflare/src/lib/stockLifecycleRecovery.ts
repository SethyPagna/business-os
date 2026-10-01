import type { Env } from '../index'
import { beginMaintenance, endMaintenance, updateMaintenance } from './maintenance'
import { hasPermission } from './permissions'
import { canViewAcquisitionCosts } from './acquisitionCostAccess'
import { fundingTransition, type FundingState, type FundingKind } from './stockFundingMath'
import { canonicalFeeCreateRequest, feeRequestDigest } from './feeOperationReceipt'
import { allocateDispositionBasis, exactMoney4, quantityDecimal, subtractQuantity } from './stockDispositionBasis'
import { STOCK_CONDITION_TAGS } from './stockCondition'

export const STOCK_RECOVERY_TABLES = [
  'stock_disposition_sources', 'stock_disposition_allocations', 'stock_disposition_events',
  'stock_disposition_fees', 'stock_disposition_receipts', 'stock_funding_invoice_openings',
  'stock_funding_sources', 'stock_funding_claims', 'stock_funding_events', 'stock_funding_receipts',
  'stock_valuation_sources', 'stock_valuation_events', 'stock_valuation_segments',
  'stock_valuation_agreements', 'stock_valuation_acceptances', 'stock_valuation_receipts',
] as const

type Fence = { token: string; actorId?: number; destructive: boolean; raw: Env; unwrap: (row: D1PreparedStatement) => D1PreparedStatement }
const fences = new WeakMap<object, Fence>()
const sourceTables = new Set(['stock_disposition_sources', 'stock_funding_sources', 'stock_valuation_sources'])

function ownerGuard(token: string, actor?: { id: number; snapshot: string }) {
  const actorClause = actor ? ` AND EXISTS(SELECT 1 FROM users u LEFT JOIN roles r ON r.id=u.role_id
    WHERE u.id=? AND u.is_active=1 AND u.deleted_at IS NULL
    AND json_array(u.username,u.permissions,u.role_id,r.code,r.permissions)=?)` : ''
  return {
    sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance'
      AND json_extract(value,'$.mode')='restore' AND json_extract(value,'$.token')=?)${actorClause}
      THEN 1 ELSE json_extract('[1]','$[stock_recovery_owner_changed]') END`,
    params: actor ? [token, actor.id, actor.snapshot] : [token],
  }
}

export async function withStockRecoveryFence<T>(env: Env, key: string, run: (guarded: Env) => Promise<T>, options: { token?: string; actorId?: number; requiredPermission?: string; requireCostView?: boolean } = {}): Promise<T> {
  if(Object.hasOwn(options,'actorId')&&(!Number.isSafeInteger(options.actorId)||Number(options.actorId)<=0))throw new Error('Stock recovery actor identity is invalid.')
  const existing = fences.get(env)
  if (existing) {
    if (options.token && options.token !== existing.token || options.actorId && options.actorId !== existing.actorId) throw new Error('Stock recovery owner changed.')
    return run(env)
  }
  const owned = !options.token
  const state = owned ? await beginMaintenance(env, { backupKey: key, startedBy: options.actorId ? String(options.actorId) : 'backup-recovery' }) : null
  const token = options.token || state!.token
  let actor: { id: number; snapshot: string } | undefined
  if (options.actorId) {
    const row = await env.DB.prepare(`SELECT json_array(u.username,u.permissions,u.role_id,r.code,r.permissions) snapshot,
      u.permissions,r.code role_code,r.permissions role_permissions
      FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.is_active=1 AND u.deleted_at IS NULL`).bind(options.actorId).first<{ snapshot: string; permissions: string; role_code: string; role_permissions: string }>()
    if (!row || options.requiredPermission && !hasPermission(row, options.requiredPermission) || options.requireCostView && !canViewAcquisitionCosts(row)) { if (owned) await endMaintenance(env, token); throw new Error('Stock recovery actor is no longer authorized.') }
    actor = { id: options.actorId, snapshot: row.snapshot }
  }
  const guard = () => { const item = ownerGuard(token, actor); return env.DB.prepare(item.sql).bind(...item.params) }
  const fence: Fence = { token, actorId: options.actorId, destructive: false, raw: env, unwrap: row => row }
  const batch = async <T = unknown>(items: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
    const result = await env.DB.batch<T>([...items, guard()])
    if (result.some(item => !(item as { success: boolean }).success)) throw new Error('Stock recovery database batch failed.')
    return result.slice(0, items.length)
  }
  function wrap(sql: string, statement: D1PreparedStatement): D1PreparedStatement {
    const execute = async () => {
      if (/^\s*(DELETE|DROP)\b/i.test(sql) && !/system_flags/i.test(sql)) fence.destructive = true
      return (await batch([statement]))[0]
    }
    return {
      bind: (...values: unknown[]) => wrap(sql, statement.bind(...values)),
      all: execute,
      run: execute,
      first: async (column?: string) => { const row = (await execute()).results?.[0] as Record<string, unknown> | undefined; return column ? row?.[column] ?? null : row ?? null },
      raw: async () => { throw new Error('Raw recovery reads are unsupported.') },
    } as D1PreparedStatement
  }
  const guarded = { ...env, DB: { ...env.DB } } as Env
  const originals = new WeakMap<object, D1PreparedStatement>()
  const queries = new WeakMap<object, string>()
  function prepared(sql: string, raw: D1PreparedStatement): D1PreparedStatement {
    const wrapped = wrap(sql, raw)
    wrapped.bind = (...values: unknown[]) => prepared(sql, raw.bind(...values))
    originals.set(wrapped, raw)
    queries.set(wrapped, sql)
    return wrapped
  }
  guarded.DB.prepare = sql => prepared(sql, env.DB.prepare(sql))
  guarded.DB.batch = async <T = unknown>(items: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
    fence.destructive ||= items.some(item => /^\s*(DELETE|DROP)\b/i.test(queries.get(item) || ''))
    return batch<T>(items.map(item => originals.get(item) || item))
  }
  fence.unwrap = row => originals.get(row) || row
  fences.set(guarded, fence)
  try {
    await batch([])
    const result = await run(guarded)
    await batch([])
    if (owned && !await endMaintenance(env, token)) throw new Error('Stock recovery maintenance could not be released.')
    return result
  } catch (error) {
    if (owned) {
      if (fence.destructive) await updateMaintenance(env, token, { phase: 'failed', error: error instanceof Error ? error.message : 'Recovery failed' })
      else await endMaintenance(env, token)
    }
    throw error
  } finally { fences.delete(guarded) }
}

export async function assertCompleteStockRecoveryGraph(env: Env, tables: ReadonlySet<string>, columns: ReadonlyMap<string, readonly string[]>) {
  if (fences.get(env)?.actorId && (tables.has('users') || tables.has('roles'))) throw new Error('Authenticated restore cannot replace its own authorization tables. Recover this complete backup into a separate compatible database with an operator-controlled recovery session. No business rows have been changed.')
  if (!['products','product_batches','inventory_movements','suppliers','supplier_invoices','users','branches','fees',...STOCK_RECOVERY_TABLES].some(table => tables.has(table))) return
  const rows = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(STOCK_RECOVERY_TABLES)).all<{ name: string }>()
  for (const { name } of rows.results || []) {
    if (!tables.has(name)) throw new Error(`Incomplete stock recovery graph: missing ${name}. No business rows have been changed.`)
    const live = await env.DB.prepare(`PRAGMA table_info("${name}")`).all<{ name: string }>()
    for (const column of live.results || []) if (!columns.get(name)?.includes(column.name)) throw new Error(`Incomplete stock recovery graph: missing ${name}.${column.name}. No business rows have been changed.`)
  }
}

export async function insertStockRecoveryRows(env: Env, table: string, rows: D1PreparedStatement[], sourceIds: string[]) {
  const fence = fences.get(env)
  if (!fence || !sourceTables.has(table)) return env.DB.batch(rows)
  const raw = fence.raw.DB
  const stored = await raw.prepare("SELECT value,updated_at FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.token')=?").bind(fence.token).first<{ value: string; updated_at: string }>()
  if (!stored) throw new Error('Stock recovery owner changed.')
  const changed = () => raw.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[1]','$[stock_recovery_ignored_write]') END")
  const statements: D1PreparedStatement[] = [raw.prepare(`INSERT INTO stock_lifecycle_recovery_context(token,table_name,source_ids,maintenance_json)
    VALUES(?,?,?,?)`).bind(fence.token, table, JSON.stringify(sourceIds), stored.value),
    changed(), raw.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM system_flags WHERE key='stock_lifecycle_recovery_admission' AND value=?) THEN 1 ELSE json_extract('[1]','$[stock_recovery_admission_marker_missing]') END").bind(fence.token),
    raw.prepare("DELETE FROM system_flags WHERE key='maintenance' AND value=?").bind(stored.value), changed(),
    ...rows.flatMap(row => [fence.unwrap(row), changed()]),
    raw.prepare("INSERT INTO system_flags(key,value,updated_at) VALUES('maintenance',?,?)").bind(stored.value, stored.updated_at), changed(),
    raw.prepare('DELETE FROM stock_lifecycle_recovery_context WHERE token=?').bind(fence.token), changed(),
    raw.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM stock_lifecycle_recovery_context) AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='stock_lifecycle_recovery_admission') THEN 1 ELSE json_extract('[1]','$[stock_recovery_context_leaked]') END")]
  await env.DB.batch(statements)
}

type RecoveryRow = Record<string, any>
const financialFields = ['gross4','paid4','debt4','credit4','asset4','cash_in4','cash_out4','shipping4'] as const
const parentFields: Record<string, string[]> = {
  users:['id'],branches:['id','is_active'],suppliers:['id'],products:['id','is_active'],
  product_batches:['id','variant_product_id','supplier_id','received_branch_id','received_quantity','received_cost_usd','is_active'],
  inventory_movements:['id','batch_id','product_id','branch_id','quantity','free_quantity','total_cost_usd','total_cost_khr','movement_type','reference_id'],
  fees:['id','fee_type','label','amount_usd','amount_khr','fee_date','sale_id','branch_id','delivery_contact_id','notes','created_by','created_by_name','created_at','updated_at'],supplier_invoices:['id','supplier_id','branch_id','total_amount_usd','amount_paid_usd','outstanding_balance_usd','status','source_branch','legacy_id','source_file','source_row'],
}
const historyFields: Record<string,string[]> = {
  fee_operation_receipts:['id','actor_id','fee_id','request_id','request_digest','request_json','response_json','occurred_at'],
  branch_batch_stock:['batch_id','branch_id','quantity'],
}

export class StockRecoveryGraphValidation {
  private rows = new Map<string, RecoveryRow[]>()
  private bytes = 0
  private count = 0

  add(table: string, row: RecoveryRow) {
    const financial=(STOCK_RECOVERY_TABLES as readonly string[]).includes(table)
    const fields=parentFields[table] || historyFields[table]
    if (!financial && !fields) return
    if(!financial)row=Object.fromEntries(fields.map(key=>[key,row[key]]))
    this.bytes += new TextEncoder().encode(JSON.stringify(row)).length
    if (financial && ++this.count > 10000 || this.bytes > 8 * 1024 * 1024) throw new Error('Stock recovery graph exceeds bounded validation capacity. Recover in a separate compatible database; no business rows have been changed.')
    for (const [key,value] of Object.entries(row)) if (key.endsWith('4') && (!Number.isSafeInteger(value) || Number(value)<0 || Number(value)>1e15)) this.fail(`${table}.${key} is not exact money`)
    const list = this.rows.get(table) || []
    list.push(row); this.rows.set(table,list)
  }

  private fail(reason: string): never { throw new Error(`Invalid stock recovery graph: ${reason}. No business rows have been changed.`) }
  private list(table: string) { return this.rows.get(table) || [] }
  private identity(table: string, key='id') {
    const entries = this.list(table).map(row => [String(row[key]),row] as const)
    const map = new Map(entries)
    if (map.size!==entries.length || entries.some(([id])=>!id || id==='undefined')) this.fail(`${table} duplicate or missing identity`)
    return map
  }
  private equal(actual: unknown, expected: unknown, name: string) {
    const canonical=(value: any): any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
    if (JSON.stringify(canonical(actual))!==JSON.stringify(canonical(expected))) this.fail(`${name} mismatch`)
  }
  private state(row: RecoveryRow): FundingState {
    return { gross4:row.gross4,paid4:row.paid4,debt4:row.debt4,credit4:row.credit4,asset4:row.asset4,cashIn4:row.cash_in4,cashOut4:row.cash_out4,shipping4:row.shipping4 }
  }

  async validate() {
    const parents=Object.fromEntries(Object.keys(parentFields).map(table=>[table,this.identity(table)]))
    for(const source of [...this.list('stock_disposition_sources'),...this.list('stock_funding_sources')]) {
      const batch=parents.product_batches.get(String(source.batch_id)), movement=parents.inventory_movements.get(String(source.movement_id))
      if(!batch||!movement||!parents.products.has(String(source.product_id))||!parents.branches.has(String(source.branch_id))||!parents.suppliers.has(String(source.supplier_id)))this.fail('stock source missing physical parent')
      if(batch.variant_product_id!==source.product_id||batch.supplier_id!==source.supplier_id||batch.received_branch_id!==source.branch_id||movement.batch_id!==source.batch_id||movement.product_id!==source.product_id||movement.branch_id!==source.branch_id)this.fail('stock source physical identity')
      try {
        if(quantityDecimal(batch.received_quantity)!==source.quantity||quantityDecimal(movement.quantity)!==source.quantity||quantityDecimal(movement.free_quantity,true)!==source.free_quantity||exactMoney4(batch.received_cost_usd)!==source.gross4||exactMoney4(movement.total_cost_usd)!==source.gross4)this.fail('stock source acquired basis')
      }catch {this.fail('stock source unsupported acquired basis')}
      if(source.gross4!==source.opening_paid4+source.opening_debt4)this.fail('stock opening balance')
      if(source.source_json) {
        const physical={product_id:batch.variant_product_id,supplier_id:batch.supplier_id,branch_id:batch.received_branch_id,received_quantity:batch.received_quantity,received_cost_usd:batch.received_cost_usd,batch_active:batch.is_active,movement_id:movement.id,batch_id:movement.batch_id,movement_product:movement.product_id,movement_branch:movement.branch_id,quantity:movement.quantity,free_quantity:movement.free_quantity,total_cost_usd:movement.total_cost_usd,total_cost_khr:movement.total_cost_khr,movement_type:movement.movement_type,reference_id:movement.reference_id,product_active:parents.products.get(String(source.product_id))?.is_active,branch_active:parents.branches.get(String(source.branch_id))?.is_active,receipt_count:this.list('inventory_movements').filter(row=>row.batch_id===source.batch_id&&['add','in'].includes(row.movement_type)).length}
        this.equal(JSON.parse(source.source_json),physical,'funding source immutable preimage')
      }
    }
    for (const prefix of ['stock_funding','stock_disposition','stock_valuation']) {
      const sources = this.identity(`${prefix}_sources`,prefix==='stock_valuation'?'source_id':'id')
      const events = this.identity(`${prefix}_events`)
      const receipts = this.list(`${prefix}_receipts`), covered = new Set<string>()
      for (const receipt of receipts) {
        const event=events.get(receipt.event_id)
        if (!event || covered.has(event.id)) this.fail(`${prefix} receipt event missing or duplicated`)
        covered.add(event.id)
        if (receipt.request_digest!==await feeRequestDigest(receipt.request_json)) this.fail(`${prefix} receipt digest`)
        let response: RecoveryRow, request: RecoveryRow
        try { response=JSON.parse(receipt.response_json); request=JSON.parse(receipt.request_json) } catch { this.fail(`${prefix} receipt JSON`) }
        for (const field of ['source_id','kind','actor_id']) {
          const actual=field==='actor_id'?receipt.actor_id:response[field]
          this.equal(actual,event[field],`${prefix} receipt ${field}`)
        }
        this.equal(response.event_id,event.id,`${prefix} receipt event_id`)
        const revision=prefix==='stock_valuation'?'revision':'generation'
        this.equal(response[revision],event[revision],`${prefix} receipt ${revision}`)
        const fields=prefix==='stock_funding'?financialFields:prefix==='stock_disposition'?['allocation_id','quantity','gross4','coverage4','net4','recognized4','remaining_quantity','remaining_gross4','remaining_coverage4']:[]
        for (const field of fields) this.equal(response[field],event[field],`${prefix} receipt ${field}`)
        if (prefix!=='stock_valuation') this.equal(request.sourceId,event.source_id,`${prefix} request source`)
        this.equal(request.kind,event.kind,`${prefix} request kind`)
        if(prefix==='stock_funding') {
          this.equal(request.generation,event.generation===0?0:event.generation-1,'funding request generation')
          if(!['accept','cancel'].includes(event.kind))this.equal(request.amount4,event.amount4,'funding request amount')
          if(event.kind==='admit')for(const [field,value] of Object.entries(request.opening||{}))this.equal(value,sources.get(event.source_id)?.[field],`funding opening request ${field}`)
        }
        if(prefix==='stock_valuation') {
          const funding=this.list('stock_funding_events').find(row=>row.id===response.funding?.id)
          if(!funding||funding.source_id!==event.source_id)this.fail('valuation receipt funding identity')
          for(const field of financialFields)this.equal(response.funding[field],funding[field],`valuation receipt funding ${field}`)
          const segments=this.list('stock_valuation_segments').filter(row=>row.event_id===event.id).map(({event_id,...row})=>row)
          this.equal(response.segments,segments,'valuation receipt segments')
        }
      }
      if (covered.size!==events.size) this.fail(`${prefix} event missing durable receipt`)
      for (const event of events.values()) if (!sources.has(event.source_id)) this.fail(`${prefix} event missing source`)
      for(const event of events.values())if(!parents.users.has(String(event.actor_id)))this.fail(`${prefix} event actor parent`)
      for (const source of sources.values()) {
        const id=source.id ?? source.source_id
        const ordered=[...events.values()].filter(e=>e.source_id===id).sort((a,b)=>(a.generation??a.revision)-(b.generation??b.revision))
        if (!ordered.length) this.fail(`${prefix} source missing event`)
        const start=prefix==='stock_disposition'?1:0
        for (let index=0;index<ordered.length;index++) if ((ordered[index].generation??ordered[index].revision)!==index+start) this.fail(`${prefix} event generation gap`)
        if (prefix==='stock_funding') {
          let state: FundingState={gross4:source.gross4,paid4:source.opening_paid4,debt4:source.opening_debt4,credit4:0,asset4:0,cashIn4:0,cashOut4:0,shipping4:0}
          for (const event of ordered) {
            if (event.generation===0) { if(event.kind!=='admit'||event.amount4!==0)this.fail('funding opening event') }
            else { try { state=fundingTransition(state,event.kind as FundingKind,event.amount4) } catch { this.fail('funding transition conservation') } }
            this.equal(this.state(event),state,'funding event balance')
          }
        }
      }
    }
    const claims=this.identity('stock_funding_claims'), sources=this.identity('stock_funding_sources')
    const openings=new Map(this.list('stock_funding_invoice_openings').map(row=>[row.invoice_id,row]))
    for(const source of sources.values())if(source.invoice_id!=null&&!openings.has(source.invoice_id))this.fail('funding invoice opening missing')
    for(const opening of openings.values()) {
      const header=parents.supplier_invoices.get(String(opening.invoice_id))
      if(!header||header.supplier_id!==opening.supplier_id||header.branch_id!==opening.branch_id||exactMoney4(header.total_amount_usd)!==opening.gross4||exactMoney4(header.amount_paid_usd)!==opening.paid4||exactMoney4(header.outstanding_balance_usd)!==opening.debt4)this.fail('funding invoice opening lineage')
      this.equal(JSON.parse(opening.header_json),header,'funding invoice immutable preimage')
    }
    for (const claim of claims.values()) if(!sources.has(claim.source_id))this.fail('funding claim missing source')
    for (const event of this.list('stock_funding_events')) if(event.claim_id!=null) {
      const claim=claims.get(event.claim_id)
      if(!claim||claim.source_id!==event.source_id||claim.amount4!==event.amount4)this.fail('funding claim/event amount')
    }
    const allocations=this.identity('stock_disposition_allocations')
    for(const event of this.list('stock_disposition_events')) {
      const allocation=allocations.get(event.allocation_id)
      if(!allocation||allocation.source_id!==event.source_id)this.fail('disposition event allocation')
      if(event.net4!==event.gross4-event.coverage4||event.recognized4!==(event.kind==='dispose'?event.net4:0))this.fail('disposition loss conservation')
    }
    const valuationEvents=this.identity('stock_valuation_events'), agreements=this.identity('stock_valuation_agreements'), fundingEvents=this.identity('stock_funding_events')
    for(const source of this.list('stock_valuation_sources'))if(!sources.has(source.source_id))this.fail('valuation funding source')
    for(const segment of this.list('stock_valuation_segments'))if(!valuationEvents.has(segment.event_id)||segment.coverage4>segment.gross4||segment.recovery4>segment.loss4)this.fail('valuation segment parent or basis')
    for(const event of valuationEvents.values()) {
      const source=sources.get(event.source_id)!,segments=this.list('stock_valuation_segments').filter(row=>row.event_id===event.id)
      if(!source||new Set(segments.map(row=>row.segment_id)).size!==segments.length||segments.reduce((sum,row)=>sum+row.gross4,0)!==source.gross4)this.fail('valuation segment acquired gross')
      try {if(subtractQuantity(source.quantity,segments.map(row=>row.quantity))!=='0')this.fail('valuation segment acquired quantity')}catch{this.fail('valuation segment acquired quantity')}
      for(const segment of segments)if(segment.fate==='disposed'?segment.loss4+segment.coverage4-segment.recovery4!==segment.gross4:segment.loss4!==0||segment.recovery4!==0)this.fail('valuation segment fate basis')
    }
    for(const share of this.list('stock_valuation_acceptances')) {
      const event=valuationEvents.get(share.event_id), agreement=agreements.get(share.agreement_id), funding=fundingEvents.get(share.funding_event_id)
      if(!event||!agreement||!funding||event.source_id!==agreement.source_id||event.source_id!==funding.source_id||funding.kind!=='accept')this.fail('valuation acceptance parent identity')
      if(!this.list('stock_valuation_segments').some(row=>row.event_id===share.event_id&&row.segment_id===share.target_segment_id))this.fail('valuation acceptance target segment')
    }
    for(const agreement of agreements.values())if(this.list('stock_valuation_acceptances').filter(row=>row.agreement_id===agreement.id).reduce((sum,row)=>sum+row.amount4,0)>agreement.amount4)this.fail('valuation agreement over-accepted')
    for(const event of valuationEvents.values())if(event.kind==='accept') {
      const shares=this.list('stock_valuation_acceptances').filter(row=>row.event_id===event.id)
      const linked=new Set(shares.map(row=>row.funding_event_id))
      if(linked.size!==1||shares.reduce((sum,row)=>sum+row.amount4,0)!==fundingEvents.get(shares[0]?.funding_event_id)?.amount4)this.fail('valuation accepted funding amount')
    }
    for(const link of this.list('stock_disposition_fees')) {
      const fee=parents.fees.get(String(link.fee_id))
      if(!fee||exactMoney4(fee.amount_usd)!==link.amount4||fee.amount_khr!==0)this.fail('disposition actual fee linkage')
    }
    for(const event of fundingEvents.values())if(event.fee_id!=null) {
      const fee=parents.fees.get(String(event.fee_id))
      if(!fee||exactMoney4(fee.amount_usd)!==event.amount4||fee.amount_khr!==0)this.fail('funding actual shipping fee linkage')
    }
    await this.validateCanonicalHistory()
  }

  private object(json: string, label: string): RecoveryRow {
    let value: RecoveryRow
    try {value=JSON.parse(json)}catch{this.fail(`${label} JSON`)}
    if(!value||typeof value!=='object'||Array.isArray(value))this.fail(`${label} object`)
    return value
  }

  private canonical(json: string, expected: RecoveryRow, label: string) {
    if(json!==JSON.stringify(expected))this.fail(`${label} canonical bytes`)
  }

  private nonempty(value: unknown, maximum: number, label: string) {
    if(typeof value!=='string'||!value.length||value!==value.trim()||value.length>maximum)this.fail(label)
  }

  private eventReceipts(prefix: string) {
    const map=new Map<string,{receipt:RecoveryRow;request:RecoveryRow;response:RecoveryRow}>()
    for(const receipt of this.list(`${prefix}_receipts`))map.set(receipt.event_id,{receipt,request:this.object(receipt.request_json,`${prefix} request`),response:this.object(receipt.response_json,`${prefix} response`)})
    return map
  }

  private jointClaimOrigin(event: RecoveryRow, request: RecoveryRow, claim: RecoveryRow) {
    const shares=this.list('stock_valuation_acceptances').filter(row=>row.funding_event_id===event.id)
    const valuationIds=new Set(shares.map(row=>row.event_id)),agreementIds=new Set(shares.map(row=>row.agreement_id))
    if(!shares.length||valuationIds.size!==1||agreementIds.size!==1)return false
    const valuation=this.list('stock_valuation_events').find(row=>row.id===shares[0].event_id)
    const agreement=this.list('stock_valuation_agreements').find(row=>row.id===shares[0].agreement_id)
    if(!valuation||!agreement||valuation.kind!=='accept'||valuation.source_id!==event.source_id||agreement.source_id!==event.source_id)return false
    const saved=this.eventReceipts('stock_valuation').get(valuation.id)
    if(!saved||saved.request.agreement_id!==agreement.id||saved.request.proof!==event.proof||saved.receipt.actor_id!==event.actor_id)return false
    const expectedShares=Array.isArray(saved.request.shares)?saved.request.shares.map((row:RecoveryRow)=>({segment_id:row.segment_id,amount4:exactMoney4(row.amount_usd)})):[]
    const actualShares=shares.map(row=>({segment_id:row.target_segment_id,amount4:row.amount4}))
    this.equal(actualShares.sort((a,b)=>a.segment_id.localeCompare(b.segment_id)),expectedShares.sort((a:RecoveryRow,b:RecoveryRow)=>a.segment_id.localeCompare(b.segment_id)),'joint claim canonical acceptance shares')
    return event.claim_id===`${agreement.id}:${valuation.id}`&&request.claim===agreement.id&&claim.proof===event.proof&&shares.reduce((sum,row)=>sum+row.amount4,0)===event.amount4
  }

  private async validateFundingHistory() {
    const sources=this.identity('stock_funding_sources'),claims=this.identity('stock_funding_claims'),receipts=this.eventReceipts('stock_funding')
    const origins=new Set<string>(),closed=new Set<string>()
    for(const source of sources.values()) {
      const events=this.list('stock_funding_events').filter(row=>row.source_id===source.id).sort((a,b)=>a.generation-b.generation)
      for(const event of events) {
        const saved=receipts.get(event.id)!
        const request=saved.request,admit=event.kind==='admit',cash=['payment','refund'].includes(event.kind),claim=claims.get(event.claim_id)
        this.nonempty(event.proof,500,'funding event proof')
        const joint=event.kind==='accept'&&claim&&!origins.has(claim.id)&&this.jointClaimOrigin(event,request,claim)
        const expectedClaim=['pending','accept','cancel'].includes(event.kind)?joint?request.claim:event.claim_id:null
        const opening=admit?Object.fromEntries(['id','movement_id','batch_id','product_id','branch_id','supplier_id','quantity','free_quantity','gross4','opening_paid4','opening_debt4','reconciliation_proof','invoice_id'].map(key=>[key,source[key]])):null
        this.canonical(saved.receipt.request_json,{kind:event.kind,sourceId:event.source_id,generation:admit?0:event.generation-1,opening,amount4:['accept','cancel'].includes(event.kind)?0:event.amount4,claim:expectedClaim,feeId:event.kind==='shipping'?event.fee_id:null,proof:event.proof,cashMethod:cash?event.cash_method:null,cashReference:cash?event.cash_reference:null,cashAt:cash?event.cash_recorded_at:null},'funding request')
        const response={funding_version:2,source_id:event.source_id,event_id:event.id,generation:event.generation,kind:event.kind,...Object.fromEntries(financialFields.map(key=>[key,event[key]])),claim_id:event.claim_id,fee_id:event.fee_id}
        this.canonical(saved.receipt.response_json,response,'funding response')
        if(admit) {
          this.equal(source.actor_id,event.actor_id,'funding admission actor')
          this.equal(source.reconciliation_proof,event.proof,'funding admission proof')
        }
        if(['pending','accept','cancel'].includes(event.kind)) {
          if(!claim||claim.source_id!==event.source_id||claim.amount4!==event.amount4)this.fail('funding canonical claim identity')
          if(event.kind==='pending'||joint) {
            if(origins.has(claim.id))this.fail('funding duplicate claim origin')
            this.equal(claim.proof,event.proof,'funding claim origin proof');origins.add(claim.id)
          }
          if(event.kind!=='pending') {
            if(!origins.has(claim.id)||closed.has(claim.id))this.fail('funding claim not pending chronologically')
            closed.add(claim.id)
          }
        }else if(event.claim_id!==null)this.fail('funding unexpected claim')
        if(cash) {
          if(event.cash_method!=='cash'||typeof event.cash_recorded_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.cash_recorded_at)||!Number.isFinite(Date.parse(event.cash_recorded_at)))this.fail('funding cash proof')
          this.nonempty(event.cash_reference,120,'funding cash reference')
          this.equal(event.id,`cash-${await feeRequestDigest(`${event.cash_method}:${event.cash_reference}`)}`,'funding cash identity')
        }else if(event.cash_method!==null||event.cash_reference!==null||event.cash_recorded_at!==null)this.fail('funding unexpected cash proof')
        if(event.kind==='shipping')await this.validateActualFee(event.fee_id,event.actor_id,source.branch_id,event.amount4)
        else if(event.fee_id!==null)this.fail('funding unexpected fee')
      }
    }
    if(origins.size!==claims.size)this.fail('funding claim missing canonical origin')
  }

  private async validateActualFee(feeId: number, actorId: number, branchId: number, amount4: number, disposition?: RecoveryRow) {
    const fee=this.list('fees').find(row=>row.id===feeId)
    if(!fee||fee.fee_type!=='other'||fee.sale_id!==null||fee.delivery_contact_id!==null||fee.branch_id!==branchId||fee.created_by!==actorId||fee.amount_khr!==0||exactMoney4(fee.amount_usd)!==amount4)this.fail('fee canonical amount or ownership')
    const receipts=this.list('fee_operation_receipts').filter(row=>row.fee_id===feeId&&row.actor_id===actorId&&(!disposition||row.request_id===`disposition_${disposition.id}`))
    if(receipts.length!==1)this.fail('fee missing unique canonical receipt')
    const receipt=receipts[0],intent=this.object(receipt.request_json,'fee request')
    if(receipt.request_digest!==await feeRequestDigest(receipt.request_json))this.fail('fee request digest')
    const expected={fee_type:fee.fee_type,label:fee.label,amount_usd:fee.amount_usd,amount_khr:fee.amount_khr,fee_date:fee.fee_date,sale_id:fee.sale_id,branch_id:fee.branch_id,delivery_contact_id:fee.delivery_contact_id,notes:fee.notes,...(intent.fee_money_version===1?{fee_money_version:1 as const}:{})}
    if(receipt.request_json!==canonicalFeeCreateRequest(expected))this.fail('fee canonical intent')
    this.equal(this.object(receipt.response_json,'fee response'),{fee},'fee exact response')
    this.equal(receipt.occurred_at,fee.created_at,'fee creation time')
    if(disposition) {
      this.equal(fee.label,'Stock disposition shipping','disposition fee label')
      this.equal(fee.notes,`Stock disposition ${disposition.id}`,'disposition fee event identity')
      this.equal(receipt.occurred_at,disposition.occurred_at,'disposition fee time')
      this.equal(intent.fee_money_version,1,'disposition fee money version')
      this.equal(fee.updated_at,fee.created_at,'disposition immutable fee')
    }
  }

  private async validateDispositionHistory() {
    const sources=this.identity('stock_disposition_sources'),allocations=this.identity('stock_disposition_allocations'),receipts=this.eventReceipts('stock_disposition')
    const originated=new Set<string>(),linkedFees=new Set<number>(),links=this.list('stock_disposition_fees')
    for(const source of sources.values()) {
      if(source.funding_state!=='reconciled_unpaid'||source.opening_paid4!==0||source.opening_debt4!==source.gross4)this.fail('disposition source funding')
      let sellable=source.quantity,sellableGross=source.gross4
      const remaining=new Map<string,{quantity:string;gross4:number;coverage4:number}>()
      for(const event of this.list('stock_disposition_events').filter(row=>row.source_id===source.id).sort((a,b)=>a.generation-b.generation)) {
        const saved=receipts.get(event.id)!,request=saved.request,allocation=allocations.get(event.allocation_id),hold=event.kind==='hold'
        if(!allocation||allocation.source_id!==source.id||(!hold&&event.kind!=='dispose'))this.fail('disposition allocation identity')
        this.nonempty(event.reason,500,'disposition reason')
        const extraFee4=request.extraFee4
        if(!Number.isSafeInteger(extraFee4)||extraFee4<0||extraFee4>1e15)this.fail('disposition exact extra fee')
        const coverageState=hold?(event.coverage4>0?'accepted_credit':'none'):'none'
        this.canonical(saved.receipt.request_json,{kind:event.kind,sourceId:source.id,batch:source.batch_id,product:source.product_id,branch:source.branch_id,supplier:source.supplier_id,quantity:event.quantity,coverage4:hold?event.coverage4:0,coverageState,extraFee4,allocationId:hold?null:allocation.id,condition:hold?allocation.condition_tag:null,reason:event.reason,category:event.expense_category,generation:event.generation-1},'disposition request')
        let before=hold?{quantity:sellable,gross4:sellableGross,coverage4:0}:remaining.get(allocation.id)
        if(!before||hold&&originated.has(allocation.id))this.fail('disposition allocation chronological origin')
        let basis: ReturnType<typeof allocateDispositionBasis>
        try {basis=allocateDispositionBasis(before.quantity,before.gross4,before.coverage4,event.quantity)}catch{this.fail('disposition chronological basis')}
        if(hold) {
          if(!STOCK_CONDITION_TAGS.includes(allocation.condition_tag)||event.coverage4>basis.gross4||event.expense_category!==null)this.fail('disposition hold intent')
          this.equal({quantity:allocation.quantity,gross4:allocation.gross4,coverage4:allocation.coverage4},{quantity:event.quantity,gross4:basis.gross4,coverage4:event.coverage4},'disposition allocation originating basis')
          originated.add(allocation.id);sellable=basis.remainingQuantity;sellableGross=basis.remainingGross4
        }
        const after=hold?{quantity:event.quantity,gross4:basis.gross4,coverage4:event.coverage4}:{quantity:basis.remainingQuantity,gross4:basis.remainingGross4,coverage4:basis.remainingCoverage4}
        remaining.set(allocation.id,after)
        const expected={event_id:event.id,allocation_id:allocation.id,source_id:source.id,generation:event.generation,kind:event.kind,quantity:event.quantity,gross4:basis.gross4,coverage4:hold?event.coverage4:basis.coverage4,coverage_state:hold?coverageState:basis.coverage4>0?'allocated_accepted_credit':'none',net4:hold?basis.gross4-event.coverage4:basis.net4,recognized4:hold?0:basis.net4,remaining_quantity:after.quantity,remaining_gross4:after.gross4,remaining_coverage4:after.coverage4,extra_fee4:extraFee4}
        for(const field of ['gross4','coverage4','net4','recognized4','remaining_quantity','remaining_gross4','remaining_coverage4'])this.equal(event[field],expected[field as keyof typeof expected],`disposition event ${field}`)
        this.canonical(saved.receipt.response_json,expected,'disposition response')
        const eventLinks=links.filter(row=>row.event_id===event.id)
        if(eventLinks.length!==(extraFee4>0?1:0))this.fail('disposition required extra fee link')
        if(extraFee4>0) {
          const link=eventLinks[0]
          if(linkedFees.has(link.fee_id)||link.amount4!==extraFee4)this.fail('disposition fee reused or wrong amount')
          linkedFees.add(link.fee_id);await this.validateActualFee(link.fee_id,event.actor_id,source.branch_id,extraFee4,event)
        }
      }
      const physical=this.list('branch_batch_stock').filter(row=>row.batch_id===source.batch_id&&row.branch_id===source.branch_id)
      if(physical.length!==1||quantityDecimal(physical[0].quantity,true)!==sellable)this.fail('disposition current stock projection')
    }
    if(originated.size!==allocations.size)this.fail('disposition allocation missing hold origin')
    if(linkedFees.size!==links.length)this.fail('disposition orphan fee link')
  }

  private async validateCanonicalHistory() {
    await this.validateFundingHistory()
    await this.validateDispositionHistory()
  }
}
