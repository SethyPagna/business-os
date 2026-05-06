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
      <div className="grid w-full grid-cols-4 gap-2 pb-1 md:hidden">
        <button
          onClick={onImport}
          className="btn-secondary inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-1 rounded-xl px-1 py-2 text-[9px] font-medium"
          title={importLabel}
          aria-label={importLabel}
        >
          <Upload className="h-3.5 w-3.5 shrink-0" />
          <span>{importLabel}</span>
        </button>
        {Array.isArray(exportMenuItems) && exportMenuItems.length ? (
          <ExportMenu
            label={exportLabel}
            items={exportMenuItems}
            compact
            triggerClassName="min-h-10 w-full min-w-0 rounded-xl px-1 py-2 text-[9px] font-medium"
            triggerWrapperClassName="w-full"
          />
        ) : (
          <button
            onClick={onExport}
            className="btn-secondary inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-1 rounded-xl px-1 py-2 text-[9px] font-medium"
            title={exportLabel}
            aria-label={exportLabel}
          >
            <Download className="h-3.5 w-3.5 shrink-0" />
            <span>{exportLabel}</span>
          </button>
        )}
        <PortalMenu
          align="right"
          triggerWrapperClassName="w-full"
          trigger={(
            <button className="btn-secondary inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-1 rounded-xl px-1 py-2 text-[9px] font-medium" aria-label={manageLabel}>
              <Settings2 className="h-3.5 w-3.5 shrink-0" />
              <span>{manageLabel}</span>
            </button>
          )}
          items={manageItems}
        />
        <button
          onClick={onAdd}
          className="btn-primary inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-1 rounded-xl px-1 py-2 text-[9px] font-medium"
          aria-label={productLabel}
        >
          <PackagePlus className="h-3.5 w-3.5 shrink-0" />
          <span>{productLabel}</span>
        </button>
      </div>

      <div className="hidden flex-wrap items-center justify-end gap-1.5 md:flex">
        <PortalMenu
          align="right"
          trigger={(
            <button className="btn-secondary inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 px-3 py-1.5 text-sm" aria-haspopup="true">
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
          className="btn-secondary inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 px-3 py-1.5 text-sm"
          title={importLabel}
        >
          <Upload className="h-4 w-4" />
          {importLabel}
        </button>
        {Array.isArray(exportMenuItems) && exportMenuItems.length ? (
          <ExportMenu label={exportLabel} items={exportMenuItems} compact triggerClassName="min-w-[6.5rem]" />
        ) : (
          <button
            onClick={onExport}
            className="btn-secondary inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 px-3 py-1.5 text-sm"
            title={exportLabel}
          >
            <Download className="h-4 w-4" />
            {exportLabel}
          </button>
        )}
        <button
          onClick={onAdd}
          className="btn-primary inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 px-3 py-1.5 text-sm"
          aria-label={productLabel}
        >
          <PackagePlus className="h-4 w-4" />
          {productLabel}
        </button>
      </div>
    </>
  )
}
