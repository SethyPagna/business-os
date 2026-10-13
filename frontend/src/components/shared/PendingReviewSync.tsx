import { useApp as useAppHook, useSync as useSyncHook } from '../../app/AppContextCore.tsx'
import { usePendingReviewTargetsLoader } from '../../utils/pendingReviewTargets.ts'

// The page-level half of the "waiting for review" tags (see PendingReviewTag.tsx).
// A page that draws tags mounts exactly ONE of these; its rows only read the shared
// store, so a list of any length costs the one request this makes when the page
// becomes active and the one it makes each time the review queue changes.
//
// A headless component rather than a hook on the page: it keeps the two context
// reads (permissions, sync) out of pages that are thousands of lines long, and a
// page that re-renders for any other reason does not re-run them.

const useApp = useAppHook as unknown as () => { getPermissionTier?: (key: string) => string }
const useSync = useSyncHook as unknown as () => { syncChannel?: { channel?: string; ts?: number } | null }

export default function PendingReviewSync({ active = true }: { active?: boolean }) {
  const { getPermissionTier } = useApp()
  const { syncChannel } = useSync()
  usePendingReviewTargetsLoader({
    active,
    reviewTier: getPermissionTier?.('review'),
    syncChannel: syncChannel?.channel,
    syncTs: syncChannel?.ts,
  })
  return null
}
