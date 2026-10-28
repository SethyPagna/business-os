import { isSaleSnapshotRefusal } from '../api/saleSubmitErrors.ts'

type CheckoutDraft = {id:unknown;checkoutRequestId?:string;checkoutPayload?:unknown;checkoutReviewRequestId?:string}

export function releaseRefusedSaleCheckout<T extends CheckoutDraft>(options: {
  error:unknown
  requestId:string
  orderId:unknown
  orders:readonly T[]
  firstAttempt:boolean
  isCurrent:()=>boolean
  owns:(payload:unknown)=>boolean
  persist:(orders:T[])=>boolean
}): T[] | null {
  if (!options.firstAttempt || !isSaleSnapshotRefusal(options.error) || !options.requestId || !options.isCurrent()) return null
  const target = options.orders.find(order=>order.id===options.orderId && order.checkoutRequestId===options.requestId)
  if (!target?.checkoutPayload || !options.owns(target.checkoutPayload)) return null
  const next = options.orders.map(order=>order===target
    ? {...order,checkoutRequestId:'',checkoutPayload:undefined,checkoutReviewRequestId:undefined} : order)
  try {
    if (!options.persist(next) || !options.isCurrent()) return null
  } catch { return null }
  return next
}
