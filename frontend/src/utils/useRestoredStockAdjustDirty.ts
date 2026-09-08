import { useRef } from 'react'

/**
 * Restoring a draft makes the modal dirty for its whole mounted lifetime.
 * The separate one-shot hydration ref may be cleared after applying the
 * restored form, but Close must still require an explicit decision.
 */
export function useRestoredStockAdjustDirty(restoredDraftAvailable: boolean): boolean {
  const wasRestoredRef = useRef(restoredDraftAvailable)
  if (restoredDraftAvailable) wasRestoredRef.current = true
  return wasRestoredRef.current
}
