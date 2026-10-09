import type { BindParams } from './db'
import type { MergeOriginIdentity, ProductMergeOriginPlan } from './productMergeOriginPlan'
import { planProductMergeOrigins } from './productMergeOriginPlan'
import type { ProductMergeCaseSnapshot } from './productMergeSnapshot'
import { planProductMergeCaseSnapshot } from './productMergeSnapshot'
import { PRODUCT_MERGE_PLAN_V2, PRODUCT_MERGE_TRANSITION_V2, productMergePointer } from './productMergeProtocol'

export type ProductMergePhysicalSource = Readonly<MergeOriginIdentity & { memberKey: string }>
export type ProductMergePhysicalPath = Readonly<{
  planId: number; operationId: string; generation: number; sealId: number
}>
export type ProductMergePhysicalResolution = Readonly<{
  sources: readonly Readonly<{
    original: ProductMergePhysicalSource; effect: MergeOriginIdentity; path: readonly ProductMergePhysicalPath[]
  }>[]
  guard: Readonly<{ sql: string; params: BindParams }>
}>

export class ProductMergePhysicalOriginError extends Error {
  readonly code = 'merge_physical_origin_conflict'
  constructor() { super('merge_physical_origin_conflict'); this.name = 'ProductMergePhysicalOriginError' }
}

const MAX_SOURCES = 64
const MAX_NODES = 64
const MAX_DEPTH = 8
const MAX_BYTES = 8 * 1024 * 1024
const fail = (): never => { throw new ProductMergePhysicalOriginError() }
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  return value as Record<string, unknown>
}
const parsed = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string') return fail()
  try { return object(JSON.parse(value)) } catch { return fail() }
}
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)
const validTuple = (tuple: MergeOriginIdentity): boolean => id(tuple.productId) && id(tuple.branchId)
  && (tuple.batchId === null || id(tuple.batchId)) && (tuple.damagedLotId === null || id(tuple.damagedLotId))
  && (tuple.damagedLotId === null ? tuple.conditionTag === 'ordinary' : ['damaged', 'expired'].includes(tuple.conditionTag))

type CapturedPlan = {
  id: number; kind: string; status: string; actor: number; payload: string
  history: unknown; seal: unknown
}
type CapturedNode = { id: number; data: string | null; oversized: number }
type ValidPlan = { origins: ProductMergeOriginPlan; source: ProductMergeCaseSnapshot; path: ProductMergePhysicalPath }

function authenticate(row: CapturedPlan, historical = false): ValidPlan {
  const plan = parsed(row.payload), history = object(row.history), head = parsed(history.undo), seal = object(row.seal)
  const transition = parsed(seal.payload)
  const pointer = historical ? productMergePointer(row.id, String(plan.operation_id), Number(transition.to_generation), Number(seal.id)) : head
  if (row.kind !== PRODUCT_MERGE_PLAN_V2 || row.status !== 'recorded' || plan.version !== 2
    || !id(plan.actor_id) || row.actor !== plan.actor_id || !id(plan.history_id)
    || !id(plan.keeper_id) || !id(plan.loser_id) || plan.keeper_id === plan.loser_id
    || typeof plan.request_id !== 'string' || !plan.request_id.trim() || plan.request_id.length > 200
    || typeof plan.request_digest !== 'string' || !plan.request_digest.trim() || plan.request_digest.length > 200
    || typeof plan.operation_id !== 'string' || !plan.operation_id.trim()
    || history.id !== plan.history_id || history.actor !== plan.actor_id || history.scope !== 'products'
    || history.entity !== 'product_merge' || history.entityId !== plan.operation_id || history.undo !== history.redo
    || !Number.isSafeInteger(pointer.generation) || Number(pointer.generation) < 0 || !id(pointer.seal_id)
    || head.plan_id !== row.id || head.operation_id !== plan.operation_id || head.applier !== 'product.merge' || head.version !== 2
    || !same(pointer, productMergePointer(row.id, plan.operation_id, Number(pointer.generation), pointer.seal_id))
    || !historical && history.status !== (Number(pointer.generation) % 2 === 0 ? 'undoable' : 'redoable')
    || seal.id !== pointer.seal_id || seal.kind !== PRODUCT_MERGE_TRANSITION_V2 || seal.status !== 'sealed'
    || transition.plan_id !== row.id || transition.operation_id !== plan.operation_id
    || transition.history_id !== history.id || transition.keeper_id !== plan.keeper_id || transition.loser_id !== plan.loser_id
    || transition.to_generation !== pointer.generation || transition.from_generation !== Number(pointer.generation) - 1
    || transition.direction !== (Number(pointer.generation) % 2 === 0 ? 'redo' : 'undo')
    || !id(transition.actor_id) || seal.actor !== transition.actor_id || !transition.post_capture) return fail()
  const source = planProductMergeCaseSnapshot(Number(plan.keeper_id), Number(plan.loser_id), [])
    .decode(new Map([['capture', [{ data: plan.source_capture, oversized: 0 }]]]))
  const saved = object(plan.origins)
  if (!Array.isArray(saved.receiptOrigins) || !Array.isArray(saved.tagOrigins)) return fail()
  const origins = planProductMergeOrigins(source, {
    operationId: plan.operation_id,
    receiptIds: saved.receiptOrigins.map(value => { const entry = object(value); return {
      sourceReceiptId: Number(object(entry.original).id), targetReceiptId: Number(entry.targetReceiptId),
    } }),
    tagIds: saved.tagOrigins.map(value => { const entry = object(value); return {
      sourceTagId: Number(object(entry.original).id), targetTagId: Number(entry.targetTagId),
    } }),
  })
  const { receiptClones: _receipts, tagClones: _tags, ...expected } = origins
  if (!same(saved, expected) || origins.keeperId !== plan.keeper_id || origins.loserId !== plan.loser_id) return fail()
  return { origins, source, path: Object.freeze({ planId: row.id, operationId: plan.operation_id,
    generation: Number(pointer.generation), sealId: pointer.seal_id }) }
}

export function productMergePhysicalPathEvidenceSql(proof: string): string {
  return `(SELECT json_group_array(json_object('id',p.id,'kind',p.kind,'status',p.status,'actor',p.created_by_id,'payload',p.payload_json,
    'history',json_object('id',h.id,'scope',h.scope,'entity',h.entity,'entityId',h.entity_id,'actor',h.created_by_id,
      'status',h.status,'undo',h.undo_payload,'redo',h.redo_payload),
    'seal',json_object('id',s.id,'kind',s.kind,'status',s.status,'actor',s.created_by_id,'payload',s.payload_json)))
    FROM (SELECT DISTINCT json_extract(step.value,'$.planId') plan_id,json_extract(step.value,'$.sealId') seal_id
      FROM json_each(${proof},'$.sources') source,json_each(source.value,'$.path') step LIMIT ${MAX_NODES + 1}) selected
    JOIN undo_snapshots p ON p.id=selected.plan_id JOIN action_history h ON h.id=json_extract(p.payload_json,'$.history_id')
    JOIN undo_snapshots s ON s.id=selected.seal_id)`
}

export function validateProductMergePhysicalPaths(sources: ProductMergePhysicalResolution['sources'], evidence: string): void {
  try {
    if (!sources.length || sources.length > MAX_SOURCES || typeof evidence !== 'string'
      || new TextEncoder().encode(evidence).byteLength > MAX_BYTES) return fail()
    const rows = JSON.parse(evidence)
    if (!Array.isArray(rows) || rows.length > MAX_NODES) return fail()
    const plans = new Map<string, ValidPlan>()
    for (const row of rows) {
      const plan = authenticate(row, true), key = `${plan.path.planId}:${plan.path.sealId}`
      if (plans.has(key) || plan.path.generation % 2 !== 0) return fail()
      plans.set(key, plan)
    }
    const used = new Set<string>()
    for (const source of sources) {
      if (!validTuple(source.original) || !validTuple(source.effect) || !Array.isArray(source.path) || source.path.length > MAX_DEPTH) return fail()
      let effect: MergeOriginIdentity = { productId: source.original.productId, branchId: source.original.branchId,
        batchId: source.original.batchId, damagedLotId: source.original.damagedLotId, conditionTag: source.original.conditionTag }
      const seen = new Set<number>()
      for (const step of source.path) {
        if (seen.has(effect.productId)) return fail()
        seen.add(effect.productId)
        const key = `${step.planId}:${step.sealId}`, plan = plans.get(key)
        if (!plan || !same(plan.path, step) || plan.origins.loserId !== effect.productId) return fail()
        used.add(key)
        let batchId: number | null = null, damagedLotId: number | null = null
        if (effect.batchId !== null) {
          const receipt = plan.origins.receiptOrigins.find(entry => entry.original.id === effect.batchId)
          if (!receipt) return fail()
          batchId = receipt.targetReceiptId
        }
        if (effect.damagedLotId !== null) {
          const tag = plan.origins.tagOrigins.find(entry => entry.original.id === effect.damagedLotId)
          const original = tag && plan.source.damagedStockRows[tag.original.index]
          if (!tag || !original || original.product_id !== effect.productId || original.branch_id !== effect.branchId
            || original.batch_id !== effect.batchId || original.condition_tag !== effect.conditionTag || tag.targetReceiptId !== batchId) return fail()
          damagedLotId = tag.targetTagId
        }
        effect = { ...effect, productId: plan.origins.keeperId, batchId, damagedLotId }
      }
      if (!same(effect, source.effect)) return fail()
    }
    if (used.size !== plans.size) return fail()
  } catch { return fail() }
}

function assertOwned(tuple: MergeOriginIdentity, snapshot: ProductMergeCaseSnapshot): void {
  if (!snapshot.canonicalProduct || snapshot.canonicalProduct.id !== tuple.productId) return fail()
  if (tuple.batchId !== null && !snapshot.canonicalBatchRows.some(row => row.id === tuple.batchId
    && row.variant_product_id === tuple.productId && [null, 0, 1].includes(row.is_active as number | null))) return fail()
  if (tuple.damagedLotId !== null && !snapshot.damagedStockRows.some(row => row.id === tuple.damagedLotId
    && row.product_id === tuple.productId && row.branch_id === tuple.branchId && row.batch_id === tuple.batchId
    && row.condition_tag === tuple.conditionTag)) return fail()
}

function mapped(tuple: MergeOriginIdentity, plan: ValidPlan, current: ProductMergeCaseSnapshot,
  target: ProductMergeCaseSnapshot | undefined): MergeOriginIdentity {
  const { origins, source } = plan
  if (tuple.productId !== origins.loserId) return fail()
  assertOwned(tuple, current)
  let batchId: number | null = null
  if (tuple.batchId !== null) {
    const matches = origins.receiptOrigins.filter(entry => entry.original.id === tuple.batchId)
    if (matches.length !== 1) return fail()
    const entry = matches[0], saved = source.duplicateBatchRows[entry.original.index]
    const observed = current.canonicalBatchRows.find(row => row.id === tuple.batchId)
    if (!saved || !observed || saved.id !== tuple.batchId
      || Object.keys(observed).some(key => !same(observed[key], saved[key]))) return fail()
    const derivative = target?.canonicalBatchRows.find(row => row.id === entry.targetReceiptId)
    if (!derivative || derivative.variant_product_id !== origins.keeperId || derivative.batch_key !== entry.batchKey
      || derivative.batch_number !== entry.batchNumber) return fail()
    batchId = entry.targetReceiptId
  }
  let damagedLotId: number | null = null
  if (tuple.damagedLotId !== null) {
    const matches = origins.tagOrigins.filter(entry => entry.original.id === tuple.damagedLotId)
    if (matches.length !== 1) return fail()
    const entry = matches[0], saved = source.damagedStockRows[entry.original.index]
    const observed = current.damagedStockRows.find(row => row.id === tuple.damagedLotId)
    if (!saved || !observed || saved.product_id !== tuple.productId || saved.branch_id !== tuple.branchId
      || saved.batch_id !== tuple.batchId || saved.condition_tag !== tuple.conditionTag || entry.targetReceiptId !== batchId
      || Object.keys(saved).some(key => key !== 'quantity_remaining' && !same(saved[key], observed[key]))) return fail()
    const derivative = target?.damagedStockRows.find(row => row.id === entry.targetTagId)
    if (!derivative || derivative.product_id !== origins.keeperId || derivative.branch_id !== tuple.branchId
      || derivative.batch_id !== batchId || derivative.condition_tag !== tuple.conditionTag
      || derivative.quantity !== saved.quantity) return fail()
    damagedLotId = entry.targetTagId
  }
  return Object.freeze({ ...tuple, productId: origins.keeperId, batchId, damagedLotId })
}

export function planProductMergePhysicalOrigins(sources: readonly ProductMergePhysicalSource[]): {
  read: Readonly<{ sql: string; params: BindParams }>
  decode: (rows: readonly Record<string, unknown>[]) => ProductMergePhysicalResolution
} {
  if (!sources.length || sources.length > MAX_SOURCES || sources.some(source => !validTuple(source)
    || typeof source.memberKey !== 'string' || !source.memberKey.trim() || source.memberKey.length > 200)
    || new Set(sources.map(source => source.memberKey)).size !== sources.length) return fail()
  const originals = sources.map(source => Object.freeze({ ...source }))
  const shared = planProductMergeCaseSnapshot(1, 2, []).reads[0].sql
    .replaceAll('@keeperId', 'n.id').replaceAll('@duplicateId', 'n.id')
  const sql = `WITH RECURSIVE nodes(id) AS (
    SELECT DISTINCT json_extract(value,'$.productId') FROM json_each(@physicalOriginsSources)
    UNION SELECT json_extract(p.payload_json,'$.keeper_id') FROM nodes n JOIN undo_snapshots p
      ON p.kind='${PRODUCT_MERGE_PLAN_V2}' AND json_valid(p.payload_json)
      AND json_extract(p.payload_json,'$.loser_id')=n.id LIMIT ${MAX_NODES + 1}
  ), plans AS MATERIALIZED (
    SELECT p.* FROM undo_snapshots p JOIN nodes n ON json_valid(p.payload_json)
      AND json_extract(p.payload_json,'$.loser_id')=n.id WHERE p.kind='${PRODUCT_MERGE_PLAN_V2}'
      ORDER BY p.id LIMIT ${MAX_NODES + 1}
  ), node_captures AS MATERIALIZED (SELECT n.id,(SELECT data FROM (${shared})) AS data FROM nodes n),
  captured AS MATERIALIZED (SELECT json_object(
    'nodes',(SELECT json_group_array(json_object('id',id,'data',data,'oversized',data IS NULL)) FROM node_captures),
    'plans',(SELECT json_group_array(json_object('id',p.id,'kind',p.kind,'status',p.status,
      'actor',p.created_by_id,'payload',p.payload_json,
      'history',(SELECT json_object('id',h.id,'scope',h.scope,'entity',h.entity,'entityId',h.entity_id,
        'actor',h.created_by_id,'status',h.status,'undo',h.undo_payload,'redo',h.redo_payload)
        FROM action_history h WHERE h.id=json_extract(p.payload_json,'$.history_id')),
      'seal',(SELECT json_object('id',s.id,'kind',s.kind,'status',s.status,'actor',s.created_by_id,'payload',s.payload_json)
        FROM action_history h JOIN undo_snapshots s ON s.id=json_extract(h.undo_payload,'$.seal_id')
        WHERE h.id=json_extract(p.payload_json,'$.history_id') AND json_valid(h.undo_payload)))) FROM plans p),
    'branches',(SELECT json_group_array(json_array(id,name,is_active,updated_at,role,canonical_key,successor_branch_id)) FROM (
      SELECT id,name,is_active,updated_at,role,canonical_key,successor_branch_id FROM branches WHERE id IN (
        SELECT json_extract(value,'$.branchId') FROM json_each(@physicalOriginsSources)) ORDER BY id))
    ) AS data) SELECT CASE WHEN length(CAST(data AS BLOB))<=${MAX_BYTES} THEN data ELSE NULL END AS data,
      length(CAST(data AS BLOB))>${MAX_BYTES} AS oversized FROM captured`
  const params = { physicalOriginsSources: JSON.stringify(originals) }
  return { read: { sql, params }, decode: rows => {
    try {
      if (rows.length !== 1 || rows[0].oversized !== 0 || typeof rows[0].data !== 'string'
        || new TextEncoder().encode(rows[0].data).byteLength > MAX_BYTES) return fail()
      const envelope = parsed(rows[0].data)
      if (!Array.isArray(envelope.nodes) || !envelope.nodes.length || envelope.nodes.length > MAX_NODES
        || !Array.isArray(envelope.plans) || envelope.plans.length > MAX_NODES || !Array.isArray(envelope.branches)) return fail()
      const snapshots = new Map<number, ProductMergeCaseSnapshot>()
      for (const value of envelope.nodes) {
        const node = object(value) as unknown as CapturedNode
        if (!id(node.id) || snapshots.has(node.id) || node.oversized !== 0) return fail()
        snapshots.set(node.id, planProductMergeCaseSnapshot(node.id, node.id, [])
          .decode(new Map([['capture', [{ data: node.data, oversized: node.oversized }]]])))
      }
      const plans = new Map<number, ValidPlan>()
      for (const value of envelope.plans) {
        const plan = authenticate(object(value) as unknown as CapturedPlan)
        if (plans.has(plan.origins.loserId)) return fail()
        plans.set(plan.origins.loserId, plan)
      }
      const branches = envelope.branches as unknown[]
      const resolved = originals.map(original => {
        if (!branches.some(value => Array.isArray(value) && value[0] === original.branchId && value[2] === 1)) return fail()
        const path: ProductMergePhysicalPath[] = [], seen = new Set<number>()
        let effect: MergeOriginIdentity = Object.freeze({ productId: original.productId, branchId: original.branchId,
          batchId: original.batchId, damagedLotId: original.damagedLotId, conditionTag: original.conditionTag })
        while (true) {
          if (seen.has(effect.productId)) return fail()
          seen.add(effect.productId)
          const current = snapshots.get(effect.productId)
          if (!current?.canonicalProduct) return fail()
          assertOwned(effect, current)
          const plan = plans.get(effect.productId)
          if (current.canonicalProduct.is_active === 1) {
            if (plan && plan.path.generation % 2 === 0) return fail()
            break
          }
          if (current.canonicalProduct.is_active !== 0 || !plan || plan.path.generation % 2 !== 0
            || path.length >= MAX_DEPTH) return fail()
          effect = mapped(effect, plan, current, snapshots.get(plan.origins.keeperId))
          path.push(plan.path)
        }
        return Object.freeze({ original, effect, path: Object.freeze(path) })
      })
      return Object.freeze({ sources: Object.freeze(resolved), guard: Object.freeze({
        sql: `WITH physical_origins AS (${sql}) SELECT CASE WHEN
          (SELECT oversized FROM physical_origins)=0 AND (SELECT data FROM physical_origins)=@physicalOriginsObserved
          THEN 1 ELSE json_extract('[1]','$[merge_physical_origin_conflict]') END AS merge_physical_origin_guard`,
        params: { ...params, physicalOriginsObserved: rows[0].data },
      }) })
    } catch { return fail() }
  } }
}
