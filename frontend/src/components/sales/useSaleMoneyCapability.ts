import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../api/http.ts'
import { captureActorReadScope, isActorReadScopeCurrent, type ActorReadScope } from '../../api/actorReadScope.ts'

export function readSaleMoneyCapability(signal: AbortSignal): Promise<boolean> {
  return apiFetch('GET', '/api/sales/money-precision-capability', undefined, 8000, { signal }).then(value => {
    const response = value as { money_precision_version?: unknown; schema_ready?: unknown }
    return response?.money_precision_version === 1 && response?.schema_ready === true
  })
}

export function useSaleMoneyCapability(enabled: boolean, securityKey: string) {
  const scope = captureActorReadScope('sale-money-capability')
  const key = `${enabled}:${securityKey}:${scope.authority}:${scope.revision}`
  const currentKey = useRef(key); currentKey.current = key
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; ready: boolean; failed: boolean; scope: ActorReadScope } | null>(null)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let cancelled = false
    const publish = (ready: boolean) => {
      if (!cancelled && currentKey.current === key && isActorReadScopeCurrent(scope)) setState({ key, ready, failed: !ready, scope })
    }
    void readSaleMoneyCapability(controller.signal).then(publish).catch(() => publish(false))
    return () => { cancelled = true; controller.abort() }
  // scope is a captured value; identity is represented by key, not object reference.
  }, [key, attempt])
  const ready = enabled && state?.key === key && state.ready && isActorReadScopeCurrent(state.scope)
  return { ready: Boolean(ready), failed: state?.key === key && state.failed, retry: () => setAttempt(value => value + 1),
    assertReady: () => { if (!ready || !state || !isActorReadScopeCurrent(state.scope) || currentKey.current !== key) throw new Error('money_precision_unavailable') } }
}
