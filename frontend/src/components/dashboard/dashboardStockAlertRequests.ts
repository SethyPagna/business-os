import { invalidateTrackedRequest, isTrackedRequestCurrent } from '../../utils/loaders.ts'

type NumberRef = { current: number }
type BooleanRef = { current: boolean }

export function invalidateDashboardStockAlertRequest(requestRef: NumberRef, inFlightRef: BooleanRef): void {
  invalidateTrackedRequest(requestRef)
  inFlightRef.current = false
}

export function finishDashboardStockAlertRequest(
  requestRef: NumberRef,
  requestId: number,
  inFlightRef: BooleanRef,
): boolean {
  if (!isTrackedRequestCurrent(requestRef, requestId)) return false
  inFlightRef.current = false
  return true
}
