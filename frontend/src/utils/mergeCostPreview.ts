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

export function mergeCostReviewMatches(review: MergeCostReview | undefined, groups: ReadonlyArray<{canonicalId:number; duplicates: ReadonlyArray<{id:number}>; mergeable?:boolean}>): boolean {
  if (!review || review.version !== 1 || !/^[a-f0-9]{64}$/.test(review.reviewed_digest) || !Array.isArray(review.groups)) return false
  const expected = groups.filter(g => g.mergeable !== false).map(g => ({keeper:g.canonicalId, ids:[g.canonicalId,...g.duplicates.map(d=>d.id)].sort((a,b)=>a-b)})).sort((a,b)=>a.keeper-b.keeper)
  if (review.groups.length !== expected.length) return false
  return review.groups.every((g,index) => {
    const target=expected[index]
    return g.keeper_id === target.keeper && (index===0 || g.keeper_id>review.groups![index-1].keeper_id) && /^[a-f0-9]{64}$/.test(g.reviewed_digest) && Array.isArray(g.member_ids) && g.member_ids.length>=2 && g.member_ids.length<=12 && g.member_ids.length===target.ids.length && g.member_ids.every((id,i)=>Number.isSafeInteger(id) && id>0 && (i===0 || id>g.member_ids[i-1]) && id===target.ids[i])
  })
}

export type MergeCostQuotation = {costAuthority:MergeCostAuthority; costReview:MergeCostReview}

export function readGroupCostAuthorities(
  reviewId: string,
  groups: readonly { group_key: string; member_ids: number[]; blocked: unknown }[],
  choices: Readonly<Record<string, { keeper_id?: number } | undefined>>,
  finalized: { review_id: string; manifest_digest: string; counts: { ready_groups: number }; costAuthorities?: unknown },
): Map<string, MergeCostAuthority> | null {
  if (finalized.review_id !== reviewId || !/^[a-f0-9]{64}$/.test(finalized.manifest_digest) || !Array.isArray(finalized.costAuthorities)
    || new Set(groups.map(group => group.group_key)).size !== groups.length) return null
  const ready = groups.filter(group => !group.blocked)
  if (finalized.counts.ready_groups !== ready.length || finalized.costAuthorities.length !== ready.length) return null
  const expected = new Map(ready.map(group => [group.group_key, group]))
  const result = new Map<string, MergeCostAuthority>()
  try {
    for (const entry of finalized.costAuthorities) {
      if (!entry || typeof entry !== 'object' || typeof entry.group_key !== 'string' || result.has(entry.group_key)) return null
      const group = expected.get(entry.group_key), keeper = choices[entry.group_key]?.keeper_id
      if (!group || !Number.isSafeInteger(keeper) || !group.member_ids.includes(Number(keeper))) return null
      result.set(entry.group_key, readMergeCostAuthority(entry.costAuthority, Number(keeper)))
    }
    return result
  } catch { return null }
}

export function readMergeCostQuotation(value: unknown, keeperId: number): MergeCostQuotation {
  const raw=value as {costAuthority?:unknown;costReview?:Partial<MergeCostReview>} | null
  const review=raw?.costReview
  if (!review || review.version !== 1 || typeof review.reviewed_digest !== 'string' || !/^[a-f0-9]{64}$/.test(review.reviewed_digest) || Object.keys(review).some(key=>key!=='version'&&key!=='reviewed_digest')) throw Object.assign(new Error('Cost preview unavailable'),{code:'merge_cost_preview_unavailable'})
  return {costAuthority:readMergeCostAuthority(raw?.costAuthority,keeperId),costReview:{version:1,reviewed_digest:review.reviewed_digest}}
}
