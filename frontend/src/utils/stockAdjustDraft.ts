import { readWorkDraft, scopedWorkDraftKey } from './workDrafts.ts'

export const STOCK_ADJUST_RESTORE_HOST = {
  pageId: 'products',
  anchor: 'hub:products:stock_changes',
} as const

export type StockAdjustDraft = {
  version: 1
  product: Record<string, unknown>
  form: Record<string, unknown>
  initialType: 'add' | 'remove' | 'set'
  search: string
  receiptSessionId: number
  attemptId: string
  rows: unknown[]
}

export function stockAdjustDraftKey(productId: unknown): string {
  const entity = String(productId ?? '').trim()
  return scopedWorkDraftKey(`stock_adjust-${entity || 'picker'}`)
}

export function readStockAdjustDraft(key: string | null | undefined): StockAdjustDraft | null {
  if (!key) return null
  const value = readWorkDraft<unknown>(key)?.data
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<StockAdjustDraft>
  const productId = candidate.product && typeof candidate.product === 'object'
    ? (candidate.product as Record<string, unknown>).id
    : null
  const formProductId = candidate.form && typeof candidate.form === 'object'
    ? (candidate.form as Record<string, unknown>).product_id
    : null
  const formType = candidate.form && typeof candidate.form === 'object'
    ? (candidate.form as Record<string, unknown>).type
    : null
  if (candidate.version !== 1 || (candidate.initialType !== 'add' && candidate.initialType !== 'remove' && candidate.initialType !== 'set')) return null
  if ((typeof productId !== 'number' && typeof productId !== 'string') || !String(productId).trim()) return null
  if (String(formProductId ?? '') !== String(productId)) return null
  if (formType !== candidate.initialType) return null
  if (!Number.isSafeInteger(candidate.receiptSessionId) || Number(candidate.receiptSessionId) <= 0) return null
  if (typeof candidate.attemptId !== 'string' || !candidate.attemptId) return null
  return {
    version: 1,
    product: { ...(candidate.product as Record<string, unknown>) },
    form: { ...(candidate.form as Record<string, unknown>) },
    initialType: candidate.initialType,
    search: typeof candidate.search === 'string' ? candidate.search : '',
    receiptSessionId: Number(candidate.receiptSessionId),
    attemptId: candidate.attemptId,
    rows: Array.isArray(candidate.rows) ? candidate.rows.filter((row) => Boolean(row) && typeof row === 'object') : [],
  }
}
