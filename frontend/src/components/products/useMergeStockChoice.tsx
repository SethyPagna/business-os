import { useCallback, useEffect, useRef, useState } from 'react'
import MergeStockChoiceDialog, {
  type MergeIdentityDiff, type MergePricingChange, type MergeStockChoice, type MergeStockImpact,
} from './MergeStockChoiceDialog'
import { mergeNeedsConfirmation } from './mergeConfirmationRule'
import { getMergePreview, prepareProductPairMergeRequest, mergeProductPairRequest, type ProductPairMergeRequest } from '../../api/productWriteTransport.ts'
import { captureActorReadScope, assertActorSessionDispatchAllowed, isActorReadScopeCurrent, type ActorReadScope } from '../../api/actorReadScope.ts'
import { freezeDirectMutationBody } from '../../utils/directMutationRequest.ts'
import { directMutationRefusedBeforeWrite } from '../../utils/directMutationRefusal.ts'
import { presentWriteError } from '../../utils/writeErrorPresentation.ts'

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
  const key = ({
    merge_request_conflict: 'resolve_refusal_request_conflict',
    merge_request_permission: 'resolve_refusal_permission',
    merge_request_budget: 'resolve_refusal_too_large',
  } as Record<string, string>)[code]
  if (key && t(key)) return Object.assign(new Error(t(key)), error, { message: t(key) })
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

// The 400 refusal carries the same identity read the preview would have.
function errorIdentity(error: unknown): MergeIdentityDiff | null {
  const raw = (error as { identity?: unknown } | null)?.identity as MergeIdentityDiff | undefined
  return raw && Array.isArray(raw.differs) ? raw : null
}

function errorStockImpact(error: unknown, productId: number): MergeStockImpact {
  const raw = (error as { stockImpact?: unknown } | null)?.stockImpact as MergeStockImpact | undefined
  if (!raw || !Array.isArray(raw.branches)) return EMPTY_IMPACT(productId)
  return raw
}

export function useMergeStockChoice(t: TranslateFn) {
  const [pending, setPending] = useState<PendingAsk | null>(null)
  const [working, setWorking] = useState(false)
  const attemptRef = useRef<{ body: ProductPairMergeRequest; scope: ActorReadScope } | null>(null)
  const flightRef = useRef<{ pair: string; scope: ActorReadScope; promise: Promise<'merged' | 'cancelled'> } | null>(null)
  const cancelAskRef = useRef<(() => void) | null>(null)
  const authority = captureActorReadScope('products:merge').authority

  useEffect(() => {
    if (attemptRef.current && !isActorReadScopeCurrent(attemptRef.current.scope, false)) attemptRef.current = null
    if (flightRef.current && !isActorReadScopeCurrent(flightRef.current.scope, false)) {
      cancelAskRef.current?.()
      cancelAskRef.current = null
      setPending(null)
      setWorking(false)
    }
  }, [authority])

  const ask = useCallback((request: Omit<PendingAsk, 'resolve'>) => new Promise<MergeStockChoice | null>((resolve) => {
    cancelAskRef.current = () => resolve(null)
    setPending({ ...request, resolve })
  }), [])

  // Merge `other` into `keeper`, asking first whenever the decision is not the
  // operator's to skip. Resolves 'merged' or 'cancelled'; real failures throw so
  // the caller can report them the way it already does.
  const runMerge = useCallback(async (keeper: Product, other: Product, scope: ActorReadScope): Promise<'merged' | 'cancelled'> => {
    assertActorSessionDispatchAllowed(scope)
    const unknown = () => Object.assign(new Error(presentWriteError({ outcome: 'unknown' }, t).detail), { code: 'write_outcome_unknown', outcome: 'unknown' })
    const send = async (stock?: MergeStockChoice): Promise<'merged'> => {
      assertActorSessionDispatchAllowed(scope)
      const attempt = attemptRef.current ?? { body: freezeDirectMutationBody(prepareProductPairMergeRequest(keeper.id, other.id, stock)), scope }
      attemptRef.current = attempt
      setWorking(true)
      try {
        const result = await mergeProductPairRequest(freezeDirectMutationBody(attempt.body))
        assertActorSessionDispatchAllowed(attempt.scope)
        const receipt = result as { success?: unknown; keptId?: unknown; mergedId?: unknown; operationId?: unknown; actionHistoryId?: unknown } | null
        if (!receipt || receipt.success !== true || receipt.keptId !== attempt.body.keepId || receipt.mergedId !== attempt.body.mergeId
          || (attempt.body.stock !== 'write_off' && (
            typeof receipt.operationId !== 'string' || !receipt.operationId.trim()
            || !Number.isSafeInteger(receipt.actionHistoryId) || Number(receipt.actionHistoryId) <= 0))) throw unknown()
        if (attemptRef.current === attempt) attemptRef.current = null
        return 'merged'
      } catch (error) {
        if (attemptRef.current === attempt && (error as { outcome?: unknown } | null)?.outcome !== 'unknown' && directMutationRefusedBeforeWrite(error)) attemptRef.current = null
        throw error
      } finally {
        if (isActorReadScopeCurrent(scope, false)) setWorking(false)
      }
    }
    const original = attemptRef.current
    if (original) {
      if (!isActorReadScopeCurrent(original.scope, false)) attemptRef.current = null
      else {
        if (original.body.keepId !== keeper.id || original.body.mergeId !== other.id) throw unknown()
        return send()
      }
    }
    assertActorSessionDispatchAllowed(scope)
    const keeperName = nameOf(keeper)
    const discardedName = nameOf(other)

    let impact: MergeStockImpact | null = null
    let pricing: MergePricingChange | null = null
    let identity: MergeIdentityDiff | null = null
    let needsChoice: boolean | null = null
    try {
      const preview = await getMergePreview(keeper.id, other.id) as {
        stockImpact?: MergeStockImpact
        pricing?: MergePricingChange
        identity?: MergeIdentityDiff
        needsStockChoice?: boolean
      }
      impact = preview?.stockImpact ?? EMPTY_IMPACT(other.id)
      pricing = preview?.pricing ?? null
      identity = preview?.identity ?? null
      needsChoice = Boolean(preview?.needsStockChoice)
    } catch {
      // Preview unavailable -- fall through to the server's own refusal below
      // rather than assuming either answer.
      needsChoice = null
    }
    assertActorSessionDispatchAllowed(scope)

    if (needsChoice !== null) {
      // ONE rule, shared with the dialog that renders the consequences
      // (mergeConfirmationRule.ts). It lived inline here until 2026-09-06 and
      // had drifted from the panel it opens: it never looked at the cost the
      // merge AVERAGES, so the canonical leading-zero pair -- two recorded
      // costs, similar enough to average, no stock, equal selling prices --
      // merged with no dialog at all and the cost-average section could never
      // be reached.
      if (!mergeNeedsConfirmation({ needsChoice, pricing, identity })) {
        try {
          await send()
        } catch (error) {
          throw localizeRefusal(t, error)
        }
        return 'merged'
      }
      setWorking(false)
      const choice = await ask({ keeperName, discardedName, impact: impact!, pricing, identity, needsChoice })
      if (!choice) return 'cancelled'
      try {
        await send(needsChoice ? choice : undefined)
        return 'merged'
      } catch (error) {
        throw localizeRefusal(t, error)
      } finally {
        if (isActorReadScopeCurrent(scope, false)) { setWorking(false); setPending(null); cancelAskRef.current = null }
      }
    }

    // No preview: try, and let the server's refusal tell us what to ask.
    try {
      await send()
      return 'merged'
    } catch (error) {
      if (errorCode(error) !== 'stock_choice_required') throw localizeRefusal(t, error)
      const choice = await ask({
        keeperName,
        discardedName,
        impact: errorStockImpact(error, other.id),
        pricing: null,
        identity: errorIdentity(error),
        needsChoice: true,
      })
      if (!choice) return 'cancelled'
      try {
        await send(choice)
        return 'merged'
      } finally {
        if (isActorReadScopeCurrent(scope, false)) { setWorking(false); setPending(null); cancelAskRef.current = null }
      }
    }
  }, [ask, t])

  const mergeWithChoice = useCallback((keeper: Product, other: Product): Promise<'merged' | 'cancelled'> => {
    const scope = captureActorReadScope('products:merge')
    const pair = JSON.stringify([keeper.id, other.id])
    const flight = flightRef.current
    if (flight && isActorReadScopeCurrent(flight.scope, false)) {
      if (flight.pair === pair) return flight.promise
      return Promise.reject(Object.assign(new Error(presentWriteError({ outcome: 'unknown' }, t).detail), { code: 'write_outcome_unknown', outcome: 'unknown' }))
    }
    if (flight) { cancelAskRef.current?.(); cancelAskRef.current = null; setPending(null); setWorking(false) }
    // Install the latch before preview or the modal can yield to another click.
    const promise = Promise.resolve().then(() => runMerge(keeper, other, scope)).catch(error => {
      throw localizeRefusal(t, error)
    }).finally(() => {
      if (flightRef.current?.promise === promise) flightRef.current = null
    })
    flightRef.current = { pair, scope, promise }
    return promise
  }, [runMerge, t])

  const mergeStockChoiceDialog = pending ? (
    <MergeStockChoiceDialog
      t={t}
      keeperName={pending.keeperName}
      discardedName={pending.discardedName}
      impact={pending.impact}
      pricing={pending.pricing}
      identity={pending.identity}
      needsChoice={pending.needsChoice}
      working={working}
      onConfirm={(choice) => pending.resolve(choice)}
      onClose={() => { if (!working) { setPending(null); pending.resolve(null) } }}
    />
  ) : null

  return { mergeWithChoice, mergeStockChoiceDialog }
}
