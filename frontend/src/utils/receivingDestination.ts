import type { FastStockInCommitLine } from '../api/inventoryWriteTransport.ts'
import type { StockSessionLine } from './stockSessionDraft.ts'
import { adjustBranchQuantity } from './stockReceiptFields.ts'

export type ReceivingOption = { value: string; label: string; disabled?: boolean }
export type ReceivingSubmissions = {
  requests: Record<string, FastStockInCommitLine>
  products: Record<string, Record<string, unknown>>
  productOutcomes: Record<string, 'not_sent' | 'unknown' | 'pending'>
  unknown: string[]
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function activeReceivingDestination(branchId: string, options: readonly ReceivingOption[]): boolean {
  const id = Number(branchId)
  return Number.isSafeInteger(id) && id > 0 && options.some(option => !option.disabled && Number(option.value) === id)
}

export function lineReceivesStock(line: StockSessionLine, branchId: string): boolean {
  if (line.mode === 'remove') return false
  if (line.mode === 'add') return line.quantity + line.freeQuantity > 0 || Boolean(line.createPayload)
  const before = typeof line.batchChoice === 'number' && line.expectedLotQuantity != null
    ? line.expectedLotQuantity : adjustBranchQuantity(line.product.branch_stock, branchId, line.product.stock_quantity)
  return line.quantity > before
}

export function restoreReceivingSubmissions(raw: unknown, lines: readonly StockSessionLine[]): ReceivingSubmissions {
  const draft = object(raw)
  const stored = object(draft.receivingSubmissions)
  const requests = object(stored.requests)
  const products = object(stored.products)
  const productOutcomes = object(stored.productOutcomes)
  const rawLines = Array.isArray(draft.lines) ? draft.lines.map(object) : []
  const state: ReceivingSubmissions = { requests: Object.create(null), products: Object.create(null), productOutcomes: Object.create(null), unknown: [] }
  for (const line of lines) {
    const request = object(requests[line.key])
    const body = object(request.body)
    if (request.key === line.key && (request.wire === 'adjust' || request.wire === 'receive')
      && Number.isSafeInteger(Number(body.branchId)) && Number(body.branchId) > 0
      && String(body.client_request_id ?? body.clientRequestId ?? '') === line.requestId) {
      state.requests[line.key] = copy(request) as unknown as FastStockInCommitLine
    }
    const product = object(products[line.key])
    if (line.createRequestId && product.client_request_id === line.createRequestId) {
      state.products[line.key] = copy(product)
      const outcome = productOutcomes[line.key]
      state.productOutcomes[line.key] = outcome === 'not_sent' || outcome === 'pending' ? outcome : 'unknown'
    }
    const prior = rawLines.find(row => row.key === line.key)
    const attempted = prior?.status === 'saving' || line.status === 'error' || line.status === 'saved'
      || Object.prototype.hasOwnProperty.call(requests, line.key) || Object.prototype.hasOwnProperty.call(products, line.key)
      || (Array.isArray(stored.unknown) && stored.unknown.includes(line.key))
    if ((Object.prototype.hasOwnProperty.call(requests, line.key) && !state.requests[line.key])
      || (attempted && !state.requests[line.key] && !state.products[line.key])) state.unknown.push(line.key)
  }
  return state
}

export function receivingDetailsLocked(state: ReceivingSubmissions, lines: readonly StockSessionLine[]): boolean {
  return lines.some(line => line.status === 'saved' || Boolean(state.requests[line.key])
    || (Boolean(state.products[line.key]) && state.productOutcomes[line.key] !== 'not_sent') || state.unknown.includes(line.key))
}

export function productCreationRefusal(state: ReceivingSubmissions, line: StockSessionLine): string | null {
  if (!line.createPayload || Number(line.product.id) > 0) return null
  if (state.productOutcomes[line.key] === 'pending') return 'product_pending_review'
  if ((state.products[line.key] && state.productOutcomes[line.key] !== 'not_sent') || state.unknown.includes(line.key)) return 'product_create_outcome_unknown'
  return null
}

export function receivingDestinationRefusal(branchId: string, options: readonly ReceivingOption[], lines: readonly StockSessionLine[], state: ReceivingSubmissions): string | null {
  for (const line of lines) {
    if (line.status === 'saved') continue
    const creationCode = productCreationRefusal(state, line)
    if (creationCode) return creationCode
    if (state.unknown.includes(line.key)) return 'receiving_submission_unavailable'
    const request = state.requests[line.key]
    const originalBranch = request?.body.branchId
    if (originalBranch != null) {
      if (Number(originalBranch) !== Number(branchId)) return 'receiving_submission_locked'
      continue
    }
    if (lineReceivesStock(line, branchId) && !activeReceivingDestination(branchId, options)) return 'receiving_branch_inactive'
  }
  return null
}

export function captureReceivingRequest(state: ReceivingSubmissions, line: StockSessionLine, request: FastStockInCommitLine): FastStockInCommitLine {
  if (!state.requests[line.key]) state.requests[line.key] = copy(request)
  return copy(state.requests[line.key])
}

export function retainReceivingSubmissions(state: ReceivingSubmissions, lines: readonly StockSessionLine[]): ReceivingSubmissions {
  const keys = new Set(lines.map(line => line.key))
  return {
    requests: Object.assign(Object.create(null), Object.fromEntries(Object.entries(state.requests).filter(([key]) => keys.has(key)))),
    products: Object.assign(Object.create(null), Object.fromEntries(Object.entries(state.products).filter(([key]) => keys.has(key)))),
    productOutcomes: Object.assign(Object.create(null), Object.fromEntries(Object.entries(state.productOutcomes).filter(([key]) => keys.has(key)))),
    unknown: state.unknown.filter(key => keys.has(key)),
  }
}
