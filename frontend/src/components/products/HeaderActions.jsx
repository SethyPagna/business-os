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
  const cleanFallback = (fallbackEn, fallbackKm) => {
    const candidate = fallbackKm || fallbackEn
    return /(Ã|Â|â€|â€™|â€œ|â€|áž|áŸ|à¸|áº|Ð|Ñ|Ø|Ù|�|ï¿½)/.test(String(candidate || ''))
      ? fallbackEn
      : candidate
  }
  const tr = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? cleanFallback(fallbackEn, fallbackKm) : fallbackEn
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
      <div className="grid w-full grid-cols-[1fr_1.08fr_1.12fr_1.08fr] gap-0.5 pb-1 md:hidden">
        <button
          onClick={onImport}
          className="btn-secondary inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-0.5 overflow-hidden rounded-xl px-1.5 py-2 text-[11px] font-semibold leading-tight"
          title={importLabel}
          aria-label={importLabel}
        >
          <Upload className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate whitespace-nowrap">{importLabel}</span>
        </button>
        {Array.isArray(exportMenuItems) && exportMenuItems.length ? (
          <ExportMenu
            label={exportLabel}
            items={exportMenuItems}
            compact
          triggerClassName="!min-w-0 min-h-10 w-full rounded-xl px-1.5 py-2 text-[11px] font-semibold leading-tight"
            triggerWrapperClassName="w-full min-w-0"
          />
        ) : (
          <button
            onClick={onExport}
            className="btn-secondary inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-0.5 overflow-hidden rounded-xl px-1.5 py-2 text-[11px] font-semibold leading-tight"
            title={exportLabel}
            aria-label={exportLabel}
          >
            <Download className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate whitespace-nowrap">{exportLabel}</span>
          </button>
        )}
        <PortalMenu
          align="right"
          triggerWrapperClassName="w-full min-w-0"
          trigger={(
            <button className="btn-secondary inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-0.5 overflow-hidden rounded-xl px-1.5 py-2 text-[11px] font-semibold leading-tight" aria-label={manageLabel}>
              <Settings2 className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate whitespace-nowrap">{manageLabel}</span>
            </button>
          )}
          items={manageItems}
        />
        <button
          onClick={onAdd}
          className="btn-primary inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-0.5 overflow-hidden rounded-xl px-1.5 py-2 text-[11px] font-semibold leading-tight"
          aria-label={productLabel}
        >
          <PackagePlus className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate whitespace-nowrap">{productLabel}</span>
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
