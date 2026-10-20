import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../api/http.ts'
import { captureActorReadScope, isActorReadScopeCurrent, type ActorReadScope } from '../../api/actorReadScope.ts'

export function readSaleMoneyCapability(signal: AbortSignal, historical = false): Promise<boolean> {
  return apiFetch('GET', '/api/sales/money-precision-capability', undefined, 8000, { signal }).then(value => {
    const response = value as { money_precision_version?: unknown; schema_ready?: unknown; historical_edit_ready?: unknown }
    return response?.money_precision_version === 1 && response?.schema_ready === true && (!historical || response.historical_edit_ready === true)
  })
}

// A confirmed capability holds for the actor, permission fingerprint and session it was read for,
// and for this app build (a new build is a new page). A Worker redeploy announces itself as a
// runtime mismatch and forgets them. Only "ready" is kept: a refusal or failure is read again.
// Every write is still refused by the Worker when its schema is not ready.
const confirmedCapabilities = new Set<string>()
let forgetOnRuntimeChangeInstalled = false

function rememberConfirmedCapability(cacheKey: string): void {
  if (!forgetOnRuntimeChangeInstalled && typeof window !== 'undefined') {
    forgetOnRuntimeChangeInstalled = true
    const forget = () => confirmedCapabilities.clear()
    window.addEventListener('runtime:version-mismatch', forget)
    window.addEventListener('runtime:api-mismatch', forget)
  }
  confirmedCapabilities.add(cacheKey)
}

export function useSaleMoneyCapability(enabled: boolean, securityKey: string, historical = false) {
  const scope = captureActorReadScope('sale-money-capability')
  const [attempt, setAttempt] = useState(0)
  const key = `${enabled}:${securityKey}:${scope.authority}:${scope.revision}:${historical}:${attempt}`
  const cacheKey = JSON.stringify([securityKey, scope.authority, scope.revision, historical])
  const currentKey = useRef(key); currentKey.current = key
  const [state, setState] = useState<{ key: string; ready: boolean; failed: boolean; scope: ActorReadScope } | null>(null)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let cancelled = false
    const publish = (ready: boolean) => {
      if (!cancelled && currentKey.current === key && isActorReadScopeCurrent(scope)) setState({ key, ready, failed: !ready, scope })
    }
    if (confirmedCapabilities.has(cacheKey)) {
      void Promise.resolve(true).then(publish)
      return () => { cancelled = true }
    }
    void readSaleMoneyCapability(controller.signal, historical).then((ready) => {
      if (ready && isActorReadScopeCurrent(scope)) rememberConfirmedCapability(cacheKey)
      publish(ready)
    }).catch(() => publish(false))
    return () => { cancelled = true; controller.abort() }
  // scope is a captured value; identity is represented by key, not object reference.
  }, [key, attempt])
  const ready = enabled && state?.key === key && state.ready && isActorReadScopeCurrent(state.scope)
  return { ready: Boolean(ready), failed: state?.key === key && state.failed, retry: () => { confirmedCapabilities.delete(cacheKey); setAttempt(value => value + 1) },
    assertFreshReady: async () => {
      // Probe immediately before an unsupported historical write, after any
      // receipt lookup. Neither a cached capability nor an old actor reply is
      // authority to dispatch. A refused probe leaves the frozen body intact.
      const current = () => enabled && currentKey.current === key && isActorReadScopeCurrent(scope)
      if (!current()) throw new Error('money_precision_unavailable')
      const fresh = await readSaleMoneyCapability(new AbortController().signal, historical)
      if (!current() || !fresh) throw new Error('money_precision_unavailable')
    },
    assertReady: () => { if (!ready || !state || !isActorReadScopeCurrent(state.scope) || currentKey.current !== key) throw new Error('money_precision_unavailable') } }
}
