import { useCallback, useMemo, useState } from 'react'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import {
  STOCK_REASON_TYPES,
  stockReasonsOfType,
  useStockReasonCatalog,
  type StockReasonType,
} from '../../utils/useStockReasonCatalog.ts'
import { PENDING_REVIEW_NEW } from '../../utils/pendingReviewTargets.ts'
import Modal from './Modal.tsx'
import PendingReviewSync from './PendingReviewSync.tsx'
import PendingReviewTag from './PendingReviewTag.tsx'
import ReasonListEditor, { useAskConfirm } from './ReasonListEditor.tsx'

// The one manager for saved stock reasons, opened from the Products and
// Inventory Manage menus, the stock session's reason row and the delete
// dialog. Self-contained: it loads and saves the catalog itself, so a host
// only decides which tab opens first and what to reload afterwards.

const useApp = useAppHook as unknown as () => {
  t: (key: string) => string
  notify: (message: string, type?: string) => void
  can: (section: string, action: string) => boolean
}

const TAB_LABELS: Record<StockReasonType, [key: string, fallback: string]> = {
  adjust: ['reason_tab_stock', 'Stock'],
  transfer: ['transfer', 'Transfer'],
  move: ['reason_tab_move', 'Move row'],
  delete: ['delete', 'Delete'],
}

export type StockReasonsManagerModalProps = {
  initialTab?: StockReasonType
  onClose: () => void
  onChanged?: () => void
  /** 'nested' when opened from inside another modal (the stock session, the delete dialog). */
  layer?: 'default' | 'nested'
}

export default function StockReasonsManagerModal({ initialTab = 'adjust', onClose, onChanged, layer = 'default' }: StockReasonsManagerModalProps) {
  const { t, notify, can } = useApp()
  const tr = useCallback((key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }, [t])
  const { askToConfirm, confirmDialog } = useAskConfirm(tr)
  const catalog = useStockReasonCatalog({ notify, tr, askToConfirm, onChanged })
  const [tab, setTab] = useState<StockReasonType>(initialTab)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const rows = useMemo(() => stockReasonsOfType(catalog.items, tab), [catalog.items, tab])
  // A Review Required edit of the saved reasons waits for approval and the list
  // below keeps its old content until then, so the title says so: a 10px slot
  // beside the words holds the "waiting for review" tag. The slot is the one
  // thing here that is in the flow, and it is a title, not a data row; the
  // tag itself stays out of the flow inside it, and renders nothing unless a
  // list edit is waiting. One request covers the whole list (not per type).
  const reasonsTitle = (
    <>
      {tr('reasons', 'Reasons')}
      <span className="relative ml-1.5 inline-block h-2.5 w-2.5 align-middle">
        <PendingReviewTag section="inventory" entityType="inventory_reason" ids={[PENDING_REVIEW_NEW]} className="left-0 top-0" />
      </span>
    </>
  )

  return (
    <Modal title={reasonsTitle} onClose={onClose} size="sm" layer={layer} unsavedChanges={{ dirty }}>
      <PendingReviewSync />
      <div className="space-y-2.5">
        <div role="tablist" aria-label={tr('reasons', 'Reasons')} className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {STOCK_REASON_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={tab === type}
              data-reason-tab={type}
              onClick={() => setTab(type)}
              className={`min-h-8 min-w-0 rounded-md px-1 text-xs font-semibold leading-relaxed ${tab === type ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}
            >
              {tr(TAB_LABELS[type][0], TAB_LABELS[type][1])}
            </button>
          ))}
        </div>
        <ReasonListEditor
          items={rows}
          tr={tr}
          loading={catalog.loading}
          busy={catalog.saving}
          draft={draft}
          onDraftChange={setDraft}
          onAdd={async (label) => { if (await catalog.add(tab, label)) setDraft('') }}
          onRename={can('inventory', 'rename_reasons') ? (entry, to) => catalog.rename(entry, to) : undefined}
          onDelete={async (entry) => { await catalog.remove(entry) }}
          onDirtyChange={setDirty}
        />
      </div>
      {confirmDialog}
    </Modal>
  )
}
