import { useCallback, useState } from 'react'
import MergeStockChoiceDialog, {
  type MergeIdentityDiff, type MergePricingChange, type MergeStockChoice, type MergeStockImpact,
} from './MergeStockChoiceDialog'
import { getMergePreview, getMergeCostPreview, type MergeCostAuthority, mergePossiblySameProducts } from '../../api/productWriteTransport.ts'

// The ONE merge-a-duplicate-pair flow, shared by every surface that resolves a
// twin: the Products → Conflicts review, the exact-duplicate "Keep this" action
// on the products list, and the product form's "this name already exists"
// collision path. Keeping it in one hook is what makes the answer to "what
// happens to the other row's stock?" identical everywhere instead of a question
// one surface asks and another quietly answers for you.
//
// Flow, per pair:
//   1. Read the preview (stock the discarded row holds, per branch and per lot;
//      any price the merge would move).
//   2. Ask -- via the shared ConfirmDialog -- when there is stock to decide
//      about, or when the merge would silently reprice the keeper. Never
//      window.confirm.
//   3. Merge with the operator's answer.
//
// The server is the real gate: it refuses a stocked row that arrives with no
// answer (400 stock_choice_required). If the preview could not be read -- offline,
// an older Worker -- the merge is attempted without an answer and that refusal
// is caught, its attached breakdown opening the same dialog for a retry. So the
// question gets asked even when the fast path is unavailable, and a merge that
// skipped it cannot land.

type TranslateFn = (key: string) => string | undefined
type Product = { id: number; name?: string | null }

type PendingAsk = {
  keeperName: string
  discardedName: string
  impact: MergeStockImpact
  pricing: MergePricingChange | null
  identity: MergeIdentityDiff | null
  needsChoice: boolean
  loadCost?: (choice: MergeStockChoice, signal: AbortSignal) => Promise<MergeCostAuthority>
  resolve: (choice: MergeStockChoice | null) => void
}

const EMPTY_IMPACT = (productId: number): MergeStockImpact => ({
  productId, totalQuantity: 0, lotCount: 0, branches: [],
})

function nameOf(product: Product): string {
  return String(product.name || '').trim() || `#${product.id}`
}

function errorCode(error: unknown): string {
  return String((error as { code?: unknown } | null)?.code || '')
}

// Named for the idiom the rest of the app uses (CatalogPage.replaceVars): a
// pack value is returned verbatim by t(), so every {mark} in it has to be
// substituted at the call site or it reaches the operator with braces intact.
function replaceVars(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => String(values[key] ?? ''))
}

// A refusal that is a DECISION, not a failure: the server declines to invent a
// cost out of two figures that cannot both be one product's cost. It reaches
// the caller as an ordinary throw -- every merge surface already reports
// error.message -- so the message has to be the translated one, not the
// server's English. Any other error passes through untouched.
function localizeRefusal(t: TranslateFn, error: unknown): unknown {
  const code = errorCode(error)
  if (code === 'cost_outlier_review') {
    const outlier = (error as { costOutlier?: { min?: number; max?: number } } | null)?.costOutlier
    const template = t('merge_cost_outlier_refused')
      || 'These two costs are too far apart to be one product\u2019s cost ({min} and {max}). Averaging them would store a cost nobody paid, so nothing was merged \u2014 correct whichever figure is wrong, then merge.'
    return new Error(replaceVars(template, { min: outlier?.min ?? '', max: outlier?.max ?? '' }))
  }
  // Both leave every table untouched; the operator's next move is to try again.
  if (code === 'merge_conflict_retry') {
    return Object.assign(new Error(t('resolve_refusal_retry') || 'Stock changed while merging. Nothing was saved. Try again.'), { code })
  }
  if (code === 'merge_case_exceeds_safe_limit') {
    return Object.assign(new Error(t('resolve_refusal_too_large') || 'This product has too many linked records for one safe merge. Nothing was saved.'), { code })
  }
  return error
}

export function useMergeStockChoice(t: TranslateFn) {
  const [pending, setPending] = useState<PendingAsk | null>(null)
  const [working, setWorking] = useState(false)

  const ask = useCallback((request: Omit<PendingAsk, 'resolve'>) => new Promise<MergeStockChoice | null>((resolve) => {
    setPending({ ...request, resolve })
  }), [])

  // Merge `other` into `keeper`, asking first whenever the decision is not the
  // operator's to skip. Resolves 'merged' or 'cancelled'; real failures throw so
  // the caller can report them the way it already does.
  const mergeWithChoice = useCallback(async (keeper: Product, other: Product): Promise<'merged' | 'cancelled'> => {
    const keeperName = nameOf(keeper)
    const discardedName = nameOf(other)

    let impact: MergeStockImpact | null = null
    let pricing: MergePricingChange | null = null
    let identity: MergeIdentityDiff | null = null
    let reviewedDigest = ''
    let needsChoice: boolean | null = null
    try {
      const preview = await getMergePreview(keeper.id, other.id) as {
        reviewedDigest?: string
        stockImpact?: MergeStockImpact
        pricing?: MergePricingChange
        identity?: MergeIdentityDiff
        needsStockChoice?: boolean
      }
      reviewedDigest = String(preview?.reviewedDigest ?? '')
      impact = preview?.stockImpact ?? EMPTY_IMPACT(other.id)
      pricing = preview?.pricing ?? null
      identity = preview?.identity ?? null
      needsChoice = Boolean(preview?.needsStockChoice)
    } catch {
      needsChoice = null
    }

    if (needsChoice !== null) {
      setWorking(false)
      const choice = await ask({ keeperName, discardedName, impact: impact!, pricing, identity, needsChoice, loadCost: (stock, signal) => getMergeCostPreview({ keepId: keeper.id, reviewedDigest, steps: [{ mergeId: other.id, stock }] }, signal) })
      if (!choice) return 'cancelled'
      setWorking(true)
      try {
        await mergePossiblySameProducts(keeper.id, other.id, choice, undefined, { version: 1, reviewed_digest: reviewedDigest })
        return 'merged'
      } catch (error) {
        throw localizeRefusal(t, error)
      } finally {
        setWorking(false)
        setPending(null)
      }
    }

    throw new Error(t('merge_cost_preview_unavailable') || 'Cost preview unavailable')
  }, [ask, t])

  const mergeStockChoiceDialog = pending ? (
    <MergeStockChoiceDialog
      t={t}
      keeperName={pending.keeperName}
      discardedName={pending.discardedName}
      impact={pending.impact}
      pricing={pending.pricing}
      identity={pending.identity}
      needsChoice={pending.needsChoice}
      loadCost={pending.loadCost}
      working={working}
      onConfirm={(choice) => pending.resolve(choice)}
      onClose={() => { if (!working) { setPending(null); pending.resolve(null) } }}
    />
  ) : null

  return { mergeWithChoice, mergeStockChoiceDialog }
}
