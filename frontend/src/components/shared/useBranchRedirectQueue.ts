import { useCallback, useEffect, useRef, useState } from 'react'
import { registerBranchRedirectHandler, type BranchRedirectRequest } from '../../api/branchRedirect.ts'

// Registers the app shell as the one answerer of api/branchRedirect.ts and holds the question being asked, so the
// shell can mount the (lazily loaded) BranchRedirectHost only while there is one. Unmounting answers Back.
export function useBranchRedirectQueue(): { request: BranchRedirectRequest; answer: (target: number | null) => void } | null {
  const [request, setRequest] = useState<BranchRedirectRequest | null>(null)
  const resolveRef = useRef<((target: number | null) => void) | null>(null)

  useEffect(() => {
    const unregister = registerBranchRedirectHandler((next) => new Promise<number | null>((resolve) => {
      resolveRef.current?.(null)
      resolveRef.current = resolve
      setRequest(next)
    }))
    return () => {
      unregister()
      resolveRef.current?.(null)
      resolveRef.current = null
    }
  }, [])

  const answer = useCallback((target: number | null) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setRequest(null)
    resolve?.(target)
  }, [])

  return request ? { request, answer } : null
}
