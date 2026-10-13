import { useCallback, useEffect, useRef, useState } from 'react'
import { isActorWriteIdentityCurrent, subscribeActorSessionQuarantine, type ActorWriteIdentity } from '../../api/actorReadScope.ts'
import { registerBranchRedirectHandler, type BranchRedirectRequest } from '../../api/branchRedirect.ts'

// Registers the app shell as the one answerer of api/branchRedirect.ts and holds the question being asked, so the
// shell can mount the (lazily loaded) BranchRedirectHost only while there is one. Unmounting answers Back. A question
// belongs to the owner it was asked for: once another account signs in it answers Back and is never shown, so one
// owner's branch names do not reach the next (the sign-in lock screen hides it while the change is checked).
export function useBranchRedirectQueue(): { request: BranchRedirectRequest; answer: (target: number | null) => void } | null {
  const [pending, setPending] = useState<{ request: BranchRedirectRequest; owner: ActorWriteIdentity } | null>(null)
  const [, recheckOwner] = useState(0)
  const resolveRef = useRef<((target: number | null) => void) | null>(null)

  useEffect(() => {
    const unregister = registerBranchRedirectHandler((next, owner) => new Promise<number | null>((resolve) => {
      resolveRef.current?.(null)
      resolveRef.current = resolve
      setPending({ request: next, owner })
    }))
    // The notice can fire inside another component's render: re-check on a microtask.
    const unsubscribe = subscribeActorSessionQuarantine(() => queueMicrotask(() => recheckOwner((count) => count + 1)))
    return () => {
      unsubscribe()
      unregister()
      resolveRef.current?.(null)
      resolveRef.current = null
    }
  }, [])

  const answer = useCallback((target: number | null) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setPending(null)
    resolve?.(target)
  }, [])

  const ownerCurrent = !!pending && isActorWriteIdentityCurrent(pending.owner, true)
  useEffect(() => { if (pending && !ownerCurrent) answer(null) }, [pending, ownerCurrent, answer])

  return pending && ownerCurrent ? { request: pending.request, answer } : null
}
