import { useSyncExternalStore } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import {
  dispatchRestore, getMinimizedWork, removeMinimizedWork, subscribeMinimizedWork,
  type MinimizedWorkEntry, type MinimizedWorkKind,
} from '../../utils/minimizedWork.ts'
import { clearWorkDraft } from '../../utils/workDrafts.ts'

// F3 slice 2 (Part 424): the chips minimized flows park in. Mobile renders
// this inside the top bar; desktop inside the sidebar header row (desktop
// deliberately has no top bar -- the user removed it -- so the sidebar IS
// its chrome). Chip click = restore (navigate to the host page, then the
// host reopens the flow and slice 1's draft brings the content back);
// the chip's own ✕ = dismiss AND discard that flow's draft -- the chip is
// the draft's visible handle, so dismissing it silently keeping the draft
// would resurrect "closed" work at the next open.

const DRAFT_KEY_BY_KIND: Record<MinimizedWorkKind, string | null> = {
  add_product: 'bos_draft_product_new',
  fast_stockin: 'bos_draft_fast_stockin',
  // detail tabs manage their own keyed drafts; nothing global to clear
  product_detail: null,
}

const useApp = useAppHook as unknown as () => { navigateTo: (pageId: string) => void; t: (key: string) => string }

export default function MinimizedWorkTray({ variant }: { variant: 'mobile' | 'desktop' }) {
  const entries = useSyncExternalStore(subscribeMinimizedWork, getMinimizedWork, getMinimizedWork)
  const { navigateTo, t } = useApp()
  if (!entries.length) return null

  const restore = (entry: MinimizedWorkEntry) => {
    navigateTo(entry.pageId)
    dispatchRestore(entry)
  }
  const dismiss = (entry: MinimizedWorkEntry) => {
    removeMinimizedWork(entry.key)
    const draftKey = DRAFT_KEY_BY_KIND[entry.kind]
    if (draftKey) clearWorkDraft(draftKey)
  }

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${variant === 'mobile' ? 'overflow-x-auto' : 'flex-wrap'}`}>
      {entries.map((entry) => (
        <span
          key={entry.key}
          className="flex max-w-[11rem] flex-shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 py-1 pl-2.5 pr-1 text-[11px] font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
        >
          <button
            type="button"
            onClick={() => restore(entry)}
            className="min-w-0 truncate hover:underline"
            title={`${t('restore') || 'Restore'} — ${entry.label}`}
          >
            {entry.label}
          </button>
          <button
            type="button"
            onClick={() => dismiss(entry)}
            aria-label={t('dismiss') || 'Dismiss'}
            title={t('minimized_dismiss_hint') || 'Dismiss and discard this draft'}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full hover:bg-amber-200 dark:hover:bg-amber-800"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
