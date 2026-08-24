import type { ReactNode } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'

type Translator = (key: string) => string | undefined

type StatDetail = {
  id: string
  label: ReactNode
  details?: Array<{ label?: ReactNode; value?: ReactNode; note?: ReactNode }>
  detailSections?: Array<{
    title?: ReactNode
    subtitle?: ReactNode
    rows?: Array<{ label?: ReactNode; value?: ReactNode; note?: ReactNode }>
  }>
} | null

type InventoryStatDetailModalProps = {
  onClose: () => void
  statDetail: StatDetail
  t: Translator
}

export default function InventoryStatDetailModal({ onClose, statDetail, t }: InventoryStatDetailModalProps) {
  if (!statDetail) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-modal-85 w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-sm sm:rounded-2xl pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white">{statDetail.label}</h2>
            <p className="mt-1 text-xs text-gray-400">{t('inventory') || 'Inventory'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('close') || 'Close'} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="modal-scroll space-y-2 p-4">
          {Array.isArray(statDetail.detailSections) && statDetail.detailSections.length ? statDetail.detailSections.map((section, sectionIndex) => (
            <div key={`${statDetail.id}-section-${sectionIndex}`} className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="border-b border-gray-200 pb-2 dark:border-gray-700">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{section.title}</div>
                {section.subtitle ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{section.subtitle}</div> : null}
              </div>
              {Array.isArray(section.rows) ? section.rows.map((row, rowIndex) => (
                <div key={`${statDetail.id}-${sectionIndex}-${rowIndex}`} className="rounded-xl border border-gray-100 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950/40">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{row.label}</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{row.value}</div>
                </div>
              )) : null}
            </div>
          )) : null}
          {Array.isArray(statDetail.details) && statDetail.details.length ? statDetail.details.map((row, index) => (
            <div key={`${statDetail.id}-${index}`} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="text-[11px] uppercase tracking-wide text-gray-400">{row.label}</div>
              <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{row.value}</div>
            </div>
          )) : null}
        </div>
      </div>
    </div>
  )
}
