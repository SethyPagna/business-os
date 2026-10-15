import { knownCost } from './costDisplay.ts'

export type MergeCostStep = { mergeId: number; stock: 'merge' | 'write_off' }
export type MergeCostAuthority = { version: 1; keeperId: number; cost_price_usd: number | null; cost_price_khr: number | null; needsReview: boolean; source: 'received_lot' | 'manual' | 'keeper_fallback' }
export type MergeCostPreviewPlan = { keepId: number; reviewedDigest: string; steps: MergeCostStep[] }

export function readMergeCostAuthority(value: unknown, keeperId: number): MergeCostAuthority {
  const a = value as Partial<MergeCostAuthority> | null
  const amount = (n: unknown) => n === null || (typeof n === 'number' && knownCost(n) !== null)
  if (!a || a.version !== 1 || a.keeperId !== keeperId || !amount(a.cost_price_usd) || !amount(a.cost_price_khr) || typeof a.needsReview !== 'boolean' || !['received_lot', 'manual', 'keeper_fallback'].includes(String(a.source))) throw Object.assign(new Error('Cost preview unavailable'), { code: 'merge_cost_preview_unavailable' })
  return { version: 1, keeperId, cost_price_usd: a.cost_price_usd!, cost_price_khr: a.cost_price_khr!, needsReview: a.needsReview, source: a.source! }
}

export type MergeCostReview = { version: 1; reviewed_digest: string; groups?: Array<{ keeper_id: number; member_ids: number[]; reviewed_digest: string }> }

export function formatMergeCost(value: number | null, currency: 'usd' | 'khr'): string {
  if (value === null) return '—'
  const amount = value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return currency === 'usd' ? '$' + amount : amount + '៛'
}
