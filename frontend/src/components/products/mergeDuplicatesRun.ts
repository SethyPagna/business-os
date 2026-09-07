export function mergeDuplicateChunkRequiresManualResume<T extends { interruptionCode?: unknown }>(
  result: T | null | undefined,
): result is T & { interruptionCode: 'merge_infrastructure_interrupted' } {
  return result?.interruptionCode === 'merge_infrastructure_interrupted'
}

export function mergeDuplicateChunkCanContinueAutomatically<T extends {
  interruptionCode?: unknown
  madeProgress?: unknown
  maxAdditionalRequests?: unknown
}>(result: T | null | undefined): result is T & {
  interruptionCode: 'merge_budget_reached'
  madeProgress: true
  maxAdditionalRequests: number
} {
  return result?.interruptionCode === 'merge_budget_reached'
    && result.madeProgress === true
    && Number.isSafeInteger(result.maxAdditionalRequests)
    && Number(result.maxAdditionalRequests) > 0
}
