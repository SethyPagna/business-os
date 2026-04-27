import { Download, PackagePlus, Settings2, Upload } from 'lucide-react'
import PortalMenu from '../shared/PortalMenu'

export default function ProductsHeaderActions({
  onManageCats,
  onManageBrands,
  onManageUnits,
  onManageFields,
  onImport,
  onExport,
  onAdd,
  t,
}) {
  const manageItems = [
    { label: `Categories`, onClick: onManageCats },
    { label: `${t('brand') || 'Brand'}`, onClick: onManageBrands },
    { label: `Units`, onClick: onManageUnits },
    { label: `${t('custom_fields') || 'Custom Fields'}`, onClick: onManageFields },
    'divider',
    { label: 'Import CSV', onClick: onImport, color: 'blue' },
    { label: 'Export CSV', onClick: onExport, color: 'green' },
  ]

  return (
    <>
      <div className="flex w-full items-center gap-1.5 overflow-x-auto pb-1 sm:hidden">
        <button
          onClick={onImport}
          className="btn-secondary inline-flex shrink-0 items-center justify-center gap-1.5 px-2.5 py-2 text-[11px] font-medium"
          title="Import CSV"
          aria-label="Import"
        >
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden min-[420px]:inline">Import</span>
        </button>
        <button
          onClick={onExport}
          className="btn-secondary inline-flex shrink-0 items-center justify-center gap-1.5 px-2.5 py-2 text-[11px] font-medium"
          title="Export CSV"
          aria-label="Export"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden min-[420px]:inline">Export</span>
        </button>
        <PortalMenu
          align="right"
          trigger={
            <button className="btn-secondary inline-flex shrink-0 items-center justify-center gap-1.5 px-2.5 py-2 text-[11px] font-medium" aria-label={t('manage') || 'Manage'}>
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden min-[420px]:inline">{t('manage') || 'Manage'}</span>
            </button>
          }
          items={manageItems.slice(0, 5)}
        />
        <button
          onClick={onAdd}
          className="btn-primary inline-flex shrink-0 items-center justify-center gap-1.5 px-2.5 py-2 text-[11px] font-medium"
          aria-label={t('add_product') || 'Add product'}
        >
          <PackagePlus className="h-3.5 w-3.5" />
          <span className="hidden min-[420px]:inline">{t('product') || 'Product'}</span>
        </button>
      </div>

      <div className="hidden sm:flex items-center gap-1.5 flex-nowrap">
        <PortalMenu
          align="right"
          trigger={
            <button className="btn-secondary inline-flex items-center gap-1.5 text-sm" aria-haspopup="true">
              <Settings2 className="h-4 w-4" />
              {t('manage') || 'Manage'}
            </button>
          }
          items={[
            { label: 'Categories', onClick: onManageCats },
            { label: `${t('brand') || 'Brand'}`, onClick: onManageBrands },
            { label: 'Units', onClick: onManageUnits },
            { label: `${t('custom_fields') || 'Custom Fields'}`, onClick: onManageFields },
          ]}
        />
        <button
          onClick={onImport}
          className="btn-secondary inline-flex items-center gap-1.5 text-sm"
          title="Import CSV"
        >
          <Upload className="h-4 w-4" />
          Import
        </button>
        <button
          onClick={onExport}
          className="btn-secondary inline-flex items-center gap-1.5 text-sm"
          title="Export CSV"
        >
          <Download className="h-4 w-4" />
          Export
        </button>
        <button
          onClick={onAdd}
          className="btn-primary inline-flex items-center gap-1.5 text-sm"
        >
          <PackagePlus className="h-4 w-4" />
          {t('add_product')}
        </button>
      </div>
    </>
  )
}
