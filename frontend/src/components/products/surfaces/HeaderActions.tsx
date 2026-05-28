import { Download, PackagePlus, Settings2, Upload } from 'lucide-react'
import PortalMenu from '../../shared/PortalMenu'
import type { PortalMenuItem } from '../../shared/PortalMenu'
import ExportMenu from '../../shared/ExportMenu'

type Translate = (key: string) => string | undefined

type ProductsHeaderActionsProps = {
  onManageCats: () => void
  onManageBrands: () => void
  onManageUnits: () => void
  onImport: () => void
  onExport: () => void
  exportMenuItems?: Array<PortalMenuItem | null | undefined | false> | null
  onAdd: () => void
  t: Translate
}

export default function ProductsHeaderActions({
  onManageCats,
  onManageBrands,
  onManageUnits,
  onImport,
  onExport,
  exportMenuItems = null,
  onAdd,
  t,
}: ProductsHeaderActionsProps) {
  const tr = (key: string, fallback: string) => {
    const value = t(key)
    if (value && value !== key) return value
    return fallback
  }

  const manageLabel = tr('manage', 'Manage')
  const importLabel = tr('import', 'Import')
  const exportLabel = tr('export', 'Export')
  const productLabel = tr('product', 'Product')
  const manageItems: PortalMenuItem[] = [
    { label: tr('categories', 'Categories'), onClick: onManageCats },
    { label: tr('brand', 'Brand'), onClick: onManageBrands },
    { label: tr('units', 'Units'), onClick: onManageUnits },
    'divider',
    { label: importLabel, onClick: onImport, color: 'blue' },
    { label: exportLabel, onClick: onExport, color: 'green' },
  ]
  const hasExportMenuItems = Array.isArray(exportMenuItems) && exportMenuItems.length > 0

  return (
    <>
      <div className="grid w-full grid-cols-[1fr_1.08fr_1.12fr_1.08fr] gap-0.5 pb-1 md:hidden">
        <button
          type="button"
          onClick={onImport}
          className="btn-secondary inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-0.5 overflow-hidden rounded-xl px-1.5 py-2 text-[11px] font-semibold leading-tight"
          title={importLabel}
          aria-label={importLabel}
        >
          <Upload className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate whitespace-nowrap">{importLabel}</span>
        </button>
        {hasExportMenuItems ? (
          <ExportMenu
            label={exportLabel}
            items={exportMenuItems}
            compact
            triggerClassName="!min-w-0 min-h-10 w-full rounded-xl px-1.5 py-2 text-[11px] font-semibold leading-tight"
            triggerWrapperClassName="w-full min-w-0"
          />
        ) : (
          <button
            type="button"
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
            <button type="button" className="btn-secondary inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-0.5 overflow-hidden rounded-xl px-1.5 py-2 text-[11px] font-semibold leading-tight" aria-label={manageLabel}>
              <Settings2 className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate whitespace-nowrap">{manageLabel}</span>
            </button>
          )}
          items={manageItems}
        />
        <button
          type="button"
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
            <button type="button" className="btn-secondary inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 px-3 py-1.5 text-sm" aria-haspopup="true">
              <Settings2 className="h-4 w-4" />
              {manageLabel}
            </button>
          )}
          items={[
            { label: tr('categories', 'Categories'), onClick: onManageCats },
            { label: tr('brand', 'Brand'), onClick: onManageBrands },
            { label: tr('units', 'Units'), onClick: onManageUnits },
          ]}
        />
        <button
          type="button"
          onClick={onImport}
          className="btn-secondary inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 px-3 py-1.5 text-sm"
          title={importLabel}
        >
          <Upload className="h-4 w-4" />
          {importLabel}
        </button>
        {hasExportMenuItems ? (
          <ExportMenu label={exportLabel} items={exportMenuItems} compact triggerClassName="min-w-[6.5rem]" />
        ) : (
          <button
            type="button"
            onClick={onExport}
            className="btn-secondary inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 px-3 py-1.5 text-sm"
            title={exportLabel}
          >
            <Download className="h-4 w-4" />
            {exportLabel}
          </button>
        )}
        <button
          type="button"
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
