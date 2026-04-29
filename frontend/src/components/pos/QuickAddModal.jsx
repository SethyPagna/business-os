// QuickAddModal
// Reusable inline modal for quick-adding customers or delivery contacts in POS.

export default function QuickAddModal({ title, children, onSave, onClose, saving, t }) {
  const T = (k, fb) => (typeof t === 'function' ? t(k) : fb)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md fade-in">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 text-2xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            x
          </button>
        </div>
        <div className="p-5 space-y-3">
          {children}
          <div className="flex gap-3 pt-1">
            <button className="btn-primary flex-1" onClick={onSave} disabled={saving}>
              {saving ? T('saving_label', 'Saving...') : T('save', 'Save')}
            </button>
            <button
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
