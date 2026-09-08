import { useSyncExternalStore } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import {
  canRestoreMinimizedWork, dispatchRestore, getMinimizedWork, removeMinimizedWork, subscribeMinimizedWork,
  type MinimizedWorkEntry, type MinimizedWorkKind,
} from '../../utils/minimizedWork.ts'
import { discardStockAdjustDraft } from '../../utils/stockAdjustDraft.ts'
import { clearWorkDraft, scopedWorkDraftKey } from '../../utils/workDrafts.ts'

// F3 slice 2 (Part 424): the chips minimized flows park in. Mobile renders
// this inside the top bar; desktop inside the sidebar header row (desktop
// deliberately has no top bar -- the user removed it -- so the sidebar IS
// its chrome). Chip click = restore (navigate to the host page, then the
// host reopens the flow and slice 1's draft brings the content back);
// the chip's own ✕ = dismiss AND discard that flow's draft -- the chip is
// the draft's visible handle, so dismissing it silently keeping the draft
// would resurrect "closed" work at the next open.

const LEGACY_DRAFT_BASE_BY_KIND: Record<MinimizedWorkKind, string | null> = {
  add_product: 'product_new_standalone-create',
  // Product edit drafts are entity-specific. The host always supplies the
  // exact actor-scoped key; an older chip must never clear a sibling edit.
  edit_product: null,
  fast_stockin: 'fast_stockin',
  // Stock-adjust drafts are entity-specific; the parked entry carries the
  // exact key and an older chip must not guess which product to discard.
  stock_adjust: null,
  create_products_session: 'create_products_session',
  // Receive drafts are per product. New chips always carry their exact
  // actor-scoped key; an older chip cannot safely guess which one to clear.
  receive_batch: null,
  // Branch add/edit drafts are keyed by entity and new chips carry that key.
  branch_form: null,
  fee_form: null,
  // detail tabs manage their own keyed drafts; nothing global to clear
  product_detail: null,
}

const useApp = useAppHook as unknown as () => {
  can: (permissionKey: string, actionKey: string) => boolean
  language: string
  navigateTo: (pageId: string, anchor?: string) => void
  notify: (message: string, type?: string) => void
  t: (key: string) => string
  user: { id?: string | number; username?: string } | null
}

export default function MinimizedWorkTray({ variant }: { variant: 'mobile' | 'desktop' }) {
  const entries = useSyncExternalStore(subscribeMinimizedWork, getMinimizedWork, getMinimizedWork)
  const { can, navigateTo, notify, t, language, user } = useApp()
  const tr = (key: string, fallbackEn: string, fallbackKm: string): string => {
    const translated = t(key)
    if (translated && translated !== key) return translated
    return language === 'km' ? fallbackKm : fallbackEn
  }
  if (!entries.length) return null

  const restore = (entry: MinimizedWorkEntry) => {
    if (!canRestoreMinimizedWork(entry, can)) {
      notify(tr('access_denied', 'Access denied', 'គ្មានសិទ្ធិចូលប្រើ'), 'error')
      return
    }
    navigateTo(entry.pageId, entry.anchor)
    dispatchRestore(entry)
  }
  const dismiss = (entry: MinimizedWorkEntry) => {
    removeMinimizedWork(entry.key)
    const legacyDraftBase = LEGACY_DRAFT_BASE_BY_KIND[entry.kind]
    const draftKey = entry.draftKey || (legacyDraftBase ? scopedWorkDraftKey(legacyDraftBase) : null)
    if (!draftKey) return
    if (entry.kind === 'stock_adjust') {
      discardStockAdjustDraft(draftKey, user?.id ?? user?.username ?? null)
      return
    }
    clearWorkDraft(draftKey)
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
            title={`${tr('restore', 'Restore', 'ស្ដារ')} — ${entry.label}`}
          >
            {entry.label}
          </button>
          <button
            type="button"
            onClick={() => dismiss(entry)}
            aria-label={tr('minimized_dismiss_hint', 'Dismiss and discard this draft', 'បិទ ហើយបោះបង់សេចក្តីព្រាងនេះ')}
            title={tr('minimized_dismiss_hint', 'Dismiss and discard this draft', 'បិទ ហើយបោះបង់សេចក្តីព្រាងនេះ')}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full hover:bg-amber-200 dark:hover:bg-amber-800"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
