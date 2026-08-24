import type { Dispatch, SetStateAction } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'

type InventoryReasonType = 'adjust' | 'transfer' | 'move' | 'delete'
type Translator = (key: string) => string | undefined
type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

type InventoryReason = {
  id: string
  type?: InventoryReasonType
  label: string
}

type InventoryReasonGroups = Partial<Record<InventoryReasonType, InventoryReason[]>>

type ReasonManagerState = {
  open: boolean
  type: InventoryReasonType
}

type InventoryReasonManagerModalProps = {
  addSavedReason: () => void
  deleteSavedReason: (entry: InventoryReason) => void
  reasonDraft: string
  reasonManager: ReasonManagerState
  reasonsByType: InventoryReasonGroups
  renameSavedReason: (entry: InventoryReason) => void
  savingReasons: boolean
  setReasonDraft: Dispatch<SetStateAction<string>>
  setReasonManager: Dispatch<SetStateAction<ReasonManagerState>>
  t: Translator
  tr: TranslationWithFallback
}

export default function InventoryReasonManagerModal({
  addSavedReason,
  deleteSavedReason,
  reasonDraft,
  reasonManager,
  reasonsByType,
  renameSavedReason,
  savingReasons,
  setReasonDraft,
  setReasonManager,
  t,
  tr,
}: InventoryReasonManagerModalProps) {
  if (!reasonManager.open) return null

  const close = () => setReasonManager((current) => ({ ...current, open: false }))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={close}>
      <div className="flex max-h-modal-88 w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white">{tr('saved_reasons', 'Saved reasons')}</h2>
            <div className="mt-0.5 text-xs text-gray-400">{tr('saved_reasons_desc', 'Reuse common reasons for stock adjustments, transfers, row moves, and deletions.')}</div>
          </div>
          <button type="button" onClick={close} aria-label={tr('close', 'Close')} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="modal-scroll space-y-4 p-4">
          <div className="grid grid-cols-4 gap-2">
            {(['adjust', 'transfer', 'move', 'delete'] as InventoryReasonType[]).map((type) => (
              <button
                key={type}
                type="button"
                className={`rounded-xl border px-3 py-2 text-xs font-semibold ${reasonManager.type === type ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
                onClick={() => setReasonManager((current) => ({ ...current, type }))}
              >
                {type}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1 text-sm"
              value={reasonDraft}
              onChange={(event) => setReasonDraft(event.target.value)}
              placeholder={tr('new_reason_placeholder', 'Add a reusable reason')}
              autoComplete="off"
            />
            <button type="button" className="btn-primary px-3 text-sm" onClick={addSavedReason} disabled={savingReasons || !reasonDraft.trim()}>
              {t('add') || 'Add'}
            </button>
          </div>
          <div className="space-y-2">
            {(reasonsByType[reasonManager.type] ?? []).length ? (reasonsByType[reasonManager.type] ?? []).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/40">
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{entry.label}</span>
                <div className="flex items-center gap-1">
                  <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30" onClick={() => renameSavedReason(entry)}>{t('edit') || 'Edit'}</button>
                  <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30" onClick={() => deleteSavedReason(entry)}>{t('delete') || 'Delete'}</button>
                </div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700">
                {tr('no_saved_reasons', 'No saved reasons yet for this workflow.')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
