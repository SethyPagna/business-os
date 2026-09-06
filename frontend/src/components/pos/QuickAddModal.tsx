import type { ReactNode } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'

type QuickAddModalProps = {
  title: ReactNode
  children: ReactNode
  onSave: () => void
  onClose: () => void
  saving?: boolean
  t?: (key: string) => string
}

export default function QuickAddModal({ title, children, onSave, onClose, saving = false, t }: QuickAddModalProps) {
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key) : fallback)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="flex max-h-modal-90 w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl dark:bg-gray-800 fade-in">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={T('close', 'Close')}
            className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-auto p-5 space-y-3">
          {children}
          {/* Sticky footer, same pattern as ProductForm.tsx/FeeForm.tsx's
              own fix. -mx-5 -mb-5 cancels this scroll area's own p-5. */}
          <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
            <button type="button" className="btn-primary flex-1" onClick={onSave} disabled={saving}>
              {saving ? T('saving_label', 'Saving...') : T('save', 'Save')}
            </button>
            <button
              type="button"
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onClose}
              disabled={saving}
            >
              {T('cancel', 'Cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
