import { Suspense, useState, useSyncExternalStore } from 'react'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import {
  canRestoreMinimizedWork, dispatchRestore, getMinimizedWork, removeMinimizedWork, subscribeMinimizedWork,
  type MinimizedWorkEntry, type MinimizedWorkKind,
  discardTransferDraft,
} from '../../utils/minimizedWork.ts'
import { discardStockAdjustDraft } from '../../utils/stockAdjustDraft.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { useIsCompactViewport } from '../../utils/useViewport.ts'
import { clearWorkDraft, scopedWorkDraftKey } from '../../utils/workDrafts.ts'
import type { CloseGuard } from '../../utils/useCloseGuard.ts'
import MinimizedWorkDismissButton from './MinimizedWorkDismissButton.tsx'
import UnsavedChangesPrompt from './UnsavedChangesPrompt.tsx'

// F3 slice 2 (Part 424): the chips minimized flows park in. The sidebar aside
// is the ONE mount: it is CSS-hidden below md but always mounted, so on a
// phone it loads the floating "Draft" chip (DraftChipFloat, a lazy chunk)
// that works in pages and sections navigation and while the header is
// scrolled away (KNOWN-136). From md up the pills below show in the aside.
// Restore navigates to the host page and the host reopens the flow; the X
// asks "Discard unsaved changes?" first and then discards that flow's draft --
// the chip is the draft's visible handle, so dismissing it silently keeping
// the draft would resurrect "closed" work at the next open.

const DraftChipFloat = lazyRetry(() => import('./DraftChipFloat.tsx'), 'draft-chip-float')

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
  // Return details are read-only live records, so there is no draft to clear.
  return_detail: null,
  branch_transfer: null,
  inventory_transfer: null,
  // A parked contact Resolve carries its choices in the chip itself.
  contact_resolve: null,
}

const useApp = useAppHook as unknown as () => {
  can: (permissionKey: string, actionKey: string) => boolean
  language: string
  navigateTo: (pageId: string, anchor?: string) => void
  notify: (message: string, type?: string) => void
  t: (key: string) => string
  user: { id?: string | number; username?: string } | null
}

export default function MinimizedWorkTray() {
  const entries = useSyncExternalStore(subscribeMinimizedWork, getMinimizedWork, getMinimizedWork)
  const { can, navigateTo, notify, t, language, user } = useApp()
  const compact = useIsCompactViewport()
  const [pendingDismiss, setPendingDismiss] = useState<MinimizedWorkEntry | null>(null)
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
    if (entry.kind === 'branch_transfer' || entry.kind === 'inventory_transfer') {
      if (entry.draftKey) discardTransferDraft(entry.kind, user?.id, entry.draftKey)
      return
    }
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
  // A draft that vanished while the prompt was up has nothing left to discard.
  const pending = pendingDismiss && entries.some((entry) => entry.key === pendingDismiss.key) ? pendingDismiss : null
  const discardGuard: CloseGuard = {
    requestClose: () => setPendingDismiss(null),
    promptOpen: pending !== null,
    options: ['discard', 'back'],
    dismissPrompt: () => setPendingDismiss(null),
    discardAndClose: () => {
      if (pending) dismiss(pending)
      setPendingDismiss(null)
    },
    saveAndClose: () => undefined,
    saving: false,
    workLabel: pending?.label ?? null,
  }

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {entries.map((entry) => (
          <span
            key={entry.key}
            className="flex max-w-[11rem] flex-shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 py-1 pl-2.5 pr-1 text-[11px] font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
          >
            <button
              type="button"
              onClick={() => restore(entry)}
              className="min-w-0 hover:underline"
              title={`${tr('restore', 'Restore', 'ស្ដារ')} — ${entry.label}`}
            >
              <span className="detail-scroll-text">{entry.label}</span>
            </button>
            <MinimizedWorkDismissButton onDismiss={() => setPendingDismiss(entry)} tr={tr} />
          </span>
        ))}
      </div>
      {compact ? (
        <Suspense fallback={null}>
          <DraftChipFloat entries={entries} restore={restore} requestDismiss={setPendingDismiss} holdOpen={pending !== null} tr={tr} />
        </Suspense>
      ) : null}
      <UnsavedChangesPrompt guard={discardGuard} />
    </>
  )
}
