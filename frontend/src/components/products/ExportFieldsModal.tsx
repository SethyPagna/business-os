import { useState } from 'react'
import ModalBase from '../shared/Modal'
import InfoHint from '../shared/InfoHint'
import type { ExportFieldGroup } from './helpers/productExport.ts'
import { EXPORT_FIELD_GROUPS } from './helpers/productExport.ts'

type Translate = (key: string, fallback?: string) => string | undefined

export interface ExportScopeOption {
  id: string
  label: string
  count: number
}

// H1+X5 (Part 402): this modal already WAS the column chooser H1 asks for
// (scope + field groups), so it keeps its shape and only gains the format
// choice -- Excel stays the default (barcode-as-text safe), CSV serves
// re-import/machines, PDF is the shared print view.
export type ProductExportFormat = 'csv' | 'xlsx' | 'pdf'

type ExportFieldsModalProps = {
  rowCount: number
  onClose: () => void
  // scopes/onScopeChange/selectedScopeId are optional so any other embedder
  // of this modal that doesn't have a scope concept (just one fixed row
  // set) keeps working exactly as before -- only Products.tsx passes them.
  scopes?: ExportScopeOption[]
  selectedScopeId?: string
  onScopeChange?: (id: string) => void
  onConfirm: (groups: ExportFieldGroup[], format: ProductExportFormat) => void
  t?: Translate
}

const GROUP_LABELS: Record<ExportFieldGroup, string> = {
  basic: 'Basic info (name, SKU, barcode, category, brand, unit)',
  pricing: 'Pricing (selling, special, purchase, cost)',
  discount: 'Discount settings',
  stock: 'Stock & branch quantities',
  supplier: 'Supplier',
  images: 'Image filenames & URLs',
}

// Single "floating panel" for every product export, combining what used to
// be two separate steps: (1) picking a scope -- previously up to 9 flat
// rows in the Manage dropdown (Export visible / selected / filtered by
// stock / by category / by brand / by supplier / by branch / by created
// range / full list), all of which exported the identical row set under
// different filenames -- and (2) this field-group picker. Aug 2026 polish
// pass (user-reported: too many export entries cluttering Manage). Default
// state keeps every field group checked and the richest available scope
// selected, so a plain "Export" click still produces the same result as
// before -- this only adds the ability to narrow things down.
export default function ExportFieldsModal({ rowCount, onClose, scopes, selectedScopeId, onScopeChange, onConfirm, t }: ExportFieldsModalProps) {
  // t() returns the raw key itself (never undefined/null) on a miss, so
  // `t(key) ?? fallback` never actually falls back -- same fix as
  // ProductDetailModal.tsx/ProductHistoryPreviewModal.tsx's T().
  const tr = (key: string, fallback: string) => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }
  const [selected, setSelected] = useState<Set<ExportFieldGroup>>(() => new Set(EXPORT_FIELD_GROUPS.map((g) => g.key)))
  const [format, setFormat] = useState<ProductExportFormat>('xlsx')

  const toggle = (key: ExportFieldGroup) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allSelected = selected.size === EXPORT_FIELD_GROUPS.length
  const activeCount = scopes?.find((scope) => scope.id === selectedScopeId)?.count ?? rowCount

  return (
    <ModalBase title={tr('export_products_title', 'Export products')} onClose={onClose} size="sm">
      {scopes && scopes.length > 1 && onScopeChange ? (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {tr('export_scope_label', 'What to export')}
          </p>
          <div className="space-y-1.5">
            {scopes.map((scope) => (
              <label
                key={scope.id}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  scope.id === selectedScopeId
                    ? 'border-green-500 bg-green-50 text-green-800 dark:border-green-500/70 dark:bg-green-500/10 dark:text-green-300'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:text-gray-200 dark:hover:bg-neutral-800'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="export-scope"
                    checked={scope.id === selectedScopeId}
                    onChange={() => onScopeChange(scope.id)}
                  />
                  {scope.label}
                </span>
                <span className="shrink-0 text-xs opacity-70">{scope.count}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        {tr('export_products_desc', `Choose which fields to include for ${activeCount} product${activeCount === 1 ? '' : 's'}. Name is always included.`)}
      </p>
      <div className="flex justify-end mb-2">
        <button
          type="button"
          className="text-xs text-[var(--ui-accent-ink)] hover:underline"
          onClick={() => setSelected(allSelected ? new Set() : new Set(EXPORT_FIELD_GROUPS.map((g) => g.key)))}
        >
          {allSelected ? tr('deselect_all', 'Deselect all') : tr('select_all', 'Select all')}
        </button>
      </div>
      <div className="space-y-2 mb-4">
        {EXPORT_FIELD_GROUPS.map(({ key }) => (
          <label key={key} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={selected.has(key)}
              onChange={() => toggle(key)}
            />
            <span>{tr(`export_field_group_${key}`, GROUP_LABELS[key])}</span>
          </label>
        ))}
      </div>
      <div className="mb-4">
        {/* Format tradeoffs used to live in each button's native `title`
            tooltip, which never opens on touch. Folded into one InfoHint by
            the label so a phone user can actually read them (the app's
            standing "explanations behind InfoHint, not inline / not native
            title" density rule). */}
        <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {tr('export_format_label', 'Format')}
          <InfoHint
            label={tr('export_format_label', 'Format')}
            text={`${tr('export_format_excel', 'Excel')}: ${tr('export_format_excel_hint', '.xlsx — opens in Excel, Khmer-safe')}. ${tr('export_format_csv', 'CSV')}: ${tr('export_format_csv_hint', '.csv — for re-import/machines; opening in Excel can break barcodes')}. ${tr('export_format_pdf', 'PDF')}: ${tr('export_format_pdf_hint', 'Print view — save as PDF or print')}.`}
          />
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {([
            ['xlsx', tr('export_format_excel', 'Excel')],
            ['csv', tr('export_format_csv', 'CSV')],
            ['pdf', tr('export_format_pdf', 'PDF')],
          ] as Array<[ProductExportFormat, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFormat(value)}
              aria-pressed={format === value}
              className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${format === value
                ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft)] text-[var(--ui-accent-ink)]'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          onClick={onClose}
        >
          {tr('cancel', 'Cancel')}
        </button>
        <button
          type="button"
          title={tr('export_confirm_hint', 'Download the chosen scope and fields in the selected format')}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
          disabled={!selected.size}
          onClick={() => onConfirm([...selected], format)}
        >
          {tr('export', 'Export')}
        </button>
      </div>
    </ModalBase>
  )
}
