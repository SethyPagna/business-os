import { Download, PackagePlus, Settings2, Upload } from 'lucide-react'
import PortalMenu from '../shared/PortalMenu'
import ExportMenu from '../shared/ExportMenu'

export default function ProductsHeaderActions({
  onManageCats,
  onManageBrands,
  onManageUnits,
  onImport,
  onExport,
  exportMenuItems = null,
  onAdd,
  t,
}) {
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  const manageLabel = tr('manage', 'Manage', 'គ្រប់គ្រង')
  const importLabel = tr('import', 'Import', 'នាំចូល')
  const exportLabel = tr('export', 'Export', 'នាំចេញ')
  const productLabel = tr('product', 'Product', 'ផលិតផល')
  const manageItems = [
    { label: tr('categories', 'Categories', 'ប្រភេទ'), onClick: onManageCats },
    { label: tr('brand', 'Brand', 'ម៉ាក'), onClick: onManageBrands },
    { label: tr('units', 'Units', 'ឯកតា'), onClick: onManageUnits },
    'divider',
    { label: importLabel, onClick: onImport, color: 'blue' },
    { label: exportLabel, onClick: onExport, color: 'green' },
  ]

  return (
    <>
      <div className="flex w-full flex-wrap items-center justify-end gap-1.5 pb-1 sm:hidden">
        <button
          onClick={onImport}
          className="btn-secondary inline-flex shrink-0 items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium"
          title={importLabel}
          aria-label={importLabel}
        >
          <Upload className="h-3.5 w-3.5" />
          <span>{importLabel}</span>
        </button>
        {Array.isArray(exportMenuItems) && exportMenuItems.length ? (
          <ExportMenu label={exportLabel} items={exportMenuItems} compact />
        ) : (
          <button
            onClick={onExport}
            className="btn-secondary inline-flex shrink-0 items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium"
            title={exportLabel}
            aria-label={exportLabel}
          >
            <Download className="h-3.5 w-3.5" />
            <span>{exportLabel}</span>
          </button>
        )}
        <PortalMenu
          align="right"
          trigger={(
            <button className="btn-secondary inline-flex shrink-0 items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium" aria-label={manageLabel}>
              <Settings2 className="h-3.5 w-3.5" />
              <span>{manageLabel}</span>
            </button>
          )}
          items={manageItems}
        />
        <button
          onClick={onAdd}
          className="btn-primary inline-flex shrink-0 items-center justify-center gap-1 px-2.5 py-2 text-[11px] font-medium"
          aria-label={productLabel}
        >
          <PackagePlus className="h-3.5 w-3.5" />
          <span>{productLabel}</span>
        </button>
      </div>

      <div className="hidden flex-wrap items-center justify-end gap-1.5 sm:flex">
        <PortalMenu
          align="right"
          trigger={(
            <button className="btn-secondary inline-flex items-center gap-1.5 text-sm" aria-haspopup="true">
              <Settings2 className="h-4 w-4" />
              {manageLabel}
            </button>
          )}
          items={[
            { label: tr('categories', 'Categories', 'ប្រភេទ'), onClick: onManageCats },
            { label: tr('brand', 'Brand', 'ម៉ាក'), onClick: onManageBrands },
            { label: tr('units', 'Units', 'ឯកតា'), onClick: onManageUnits },
          ]}
        />
        <button
          onClick={onImport}
          className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
          title={importLabel}
        >
          <Upload className="h-4 w-4" />
          {importLabel}
        </button>
        {Array.isArray(exportMenuItems) && exportMenuItems.length ? (
          <ExportMenu label={exportLabel} items={exportMenuItems} compact />
        ) : (
          <button
            onClick={onExport}
            className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
            title={exportLabel}
          >
            <Download className="h-4 w-4" />
            {exportLabel}
          </button>
        )}
        <button
          onClick={onAdd}
          className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
          aria-label={productLabel}
        >
          <PackagePlus className="h-4 w-4" />
          {productLabel}
        </button>
      </div>
    </>
  )
}
