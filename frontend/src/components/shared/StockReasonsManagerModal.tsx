import { useCallback, useMemo, useState } from 'react'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import {
  STOCK_REASON_TYPES,
  stockReasonsOfType,
  useStockReasonCatalog,
  type StockReasonType,
} from '../../utils/useStockReasonCatalog.ts'
import Modal from './Modal.tsx'
import ReasonListEditor from './ReasonListEditor.tsx'
import { useConfirmDialog } from './useConfirmDialog.tsx'

// The one manager for saved stock reasons, opened from the Products and
// Inventory Manage menus, the stock session's reason row and the delete
// dialog. Self-contained: it loads and saves the catalog itself, so a host
// only decides which tab opens first and what to reload afterwards.

const useApp = useAppHook as unknown as () => {
  t: (key: string) => string
  notify: (message: string, type?: string) => void
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
  const { t, notify } = useApp()
  const tr = useCallback((key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }, [t])
  const { askToConfirm, confirmDialog } = useConfirmDialog((key, fallback) => tr(key, fallback || key))
  const catalog = useStockReasonCatalog({ notify, tr, askToConfirm, onChanged })
  const [tab, setTab] = useState<StockReasonType>(initialTab)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const rows = useMemo(() => stockReasonsOfType(catalog.items, tab), [catalog.items, tab])

  return (
    <Modal title={tr('reasons', 'Reasons')} onClose={onClose} size="sm" layer={layer} unsavedChanges={{ dirty }}>
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
          onRename={(entry, to) => catalog.rename(entry, to)}
          onDelete={async (entry) => { await catalog.remove(entry) }}
          onDirtyChange={setDirty}
        />
      </div>
      {confirmDialog}
    </Modal>
  )
}
