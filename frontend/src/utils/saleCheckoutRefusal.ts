import { isSaleSnapshotRefusal } from '../api/saleSubmitErrors.ts'

type CheckoutDraft = {id:unknown;checkoutRequestId?:string;checkoutPayload?:unknown;checkoutReviewRequestId?:string}

type CheckoutStore = Pick<Storage,'getItem'|'setItem'>

export function persistRefusedCheckoutDraft(options: {
  key:string;previous:string;next:string
  local:()=>CheckoutStore;session:()=>CheckoutStore
}): boolean {
  try {
    const local=options.local(), session=options.session()
    const beforeLocal=local.getItem(options.key), beforeSession=session.getItem(options.key)
    if((beforeLocal!==null&&beforeLocal!==options.previous)||(beforeSession!==null&&beforeSession!==options.previous))return false
    if(beforeLocal===null&&beforeSession===null)return false
    try { session.setItem(options.key,options.next) } catch {}
    const matches=(before:string|null,after:string|null)=>after===options.next||(before===null&&after===null)
    if(!matches(beforeSession,session.getItem(options.key)))return false
    if(local.getItem(options.key)!==beforeLocal)return false
    try { local.setItem(options.key,options.next) } catch {}
    const afterLocal=local.getItem(options.key), afterSession=session.getItem(options.key)
    return matches(beforeLocal,afterLocal)&&matches(beforeSession,afterSession)
      &&(afterLocal===options.next||afterSession===options.next)
  } catch { return false }
}

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
