import { useMemo, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp } from '../../AppContext'
import { normalizeCsvKey, parseCsvNumber, parseCsvRows } from '../../utils/csvImport'

function normalizeBranchMap(branches = []) {
  const map = new Map()
  branches.forEach((branch) => {
    const nameKey = normalizeCsvKey(branch?.name)
    if (nameKey) map.set(nameKey, branch)
    const idKey = normalizeCsvKey(branch?.id)
    if (idKey) map.set(idKey, branch)
  })
  return map
}

function findProduct(row, productMaps) {
  const sku = normalizeCsvKey(row.sku)
  if (sku && productMaps.bySku.has(sku)) return productMaps.bySku.get(sku)
  const barcode = normalizeCsvKey(row.barcode)
  if (barcode && productMaps.byBarcode.has(barcode)) return productMaps.byBarcode.get(barcode)
  const name = normalizeCsvKey(row.name)
  if (name && productMaps.byName.has(name)) return productMaps.byName.get(name)
  return null
}

export default function SalesImportModal({ onClose, onDone }) {
  const { user, notify, t } = useApp()
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  const previewRows = useMemo(() => parseCsvRows(csvText), [csvText])

  const handlePickFile = async () => {
    const picked = await window.api.openCSVDialog?.()
    if (!picked?.content) return
    setCsvText(String(picked.content || ''))
    setFileName(String(picked.name || 'sales.csv'))
    setResult(null)
  }

  const handleDownloadTemplate = () => {
    window.api.downloadImportTemplate('sales')
  }

  const handleImport = async () => {
    const rows = parseCsvRows(csvText)
    if (!rows.length) {
      notify(tr('sales_import_choose_rows', 'Choose a CSV file with at least one sale row.', 'សូមជ្រើសឯកសារ CSV ដែលមានយ៉ាងហោចណាស់មួយជួរលក់។'), 'error')
      return
    }

    setLoading(true)
    try {
      const [products, branches] = await Promise.all([
        window.api.getProducts(),
        window.api.getBranches(),
      ])

      const productMaps = {
        bySku: new Map(),
        byBarcode: new Map(),
        byName: new Map(),
      }
      ;(Array.isArray(products) ? products : []).forEach((product) => {
        const sku = normalizeCsvKey(product?.sku)
        const barcode = normalizeCsvKey(product?.barcode)
        const name = normalizeCsvKey(product?.name)
        if (sku) productMaps.bySku.set(sku, product)
        if (barcode) productMaps.byBarcode.set(barcode, product)
        if (name) productMaps.byName.set(name, product)
      })

      const activeBranches = (Array.isArray(branches) ? branches : []).filter((branch) => branch?.is_active)
      const defaultBranch = activeBranches.find((branch) => branch?.is_default) || activeBranches[0] || null
      const branchMap = normalizeBranchMap(activeBranches)
      const grouped = new Map()

      rows.forEach((row, index) => {
        const product = findProduct(row, productMaps)
        if (!product) {
          throw new Error(
            tr('sales_import_row_product_not_found', 'Row {row}: product not found for "{value}"', 'ជួរ {row}: រកមិនឃើញផលិតផលសម្រាប់ "{value}"')
              .replace('{row}', index + 2)
              .replace('{value}', row.name || row.sku || row.barcode || 'unknown'),
          )
        }

        const quantity = parseCsvNumber(row.quantity, 0)
        if (quantity <= 0) {
          throw new Error(tr('sales_import_row_quantity_invalid', 'Row {row}: quantity must be greater than 0', 'ជួរ {row}: បរិមាណត្រូវតែធំជាង 0').replace('{row}', index + 2))
        }

        const receiptNumber = String(row.receipt_number || '').trim() || `IMP-SALE-${Date.now()}-${index + 1}`
        const branchValue = String(row.branch || '').trim()
        const rowBranch = branchValue ? branchMap.get(normalizeCsvKey(branchValue)) : defaultBranch
        if (branchValue && !rowBranch) {
          throw new Error(
            tr('sales_import_row_branch_not_found', 'Row {row}: branch "{branch}" not found', 'ជួរ {row}: មិនឃើញសាខា "{branch}"')
              .replace('{row}', index + 2)
              .replace('{branch}', branchValue),
          )
        }
        if (!rowBranch && activeBranches.length > 1) {
          throw new Error(tr('sales_import_row_branch_required', 'Row {row}: branch is required when multiple branches are active', 'ជួរ {row}: ត្រូវការសាខា នៅពេលមានសាខាសកម្មច្រើន').replace('{row}', index + 2))
        }

        const sale = grouped.get(receiptNumber) || {
          receipt_number: receiptNumber,
          created_at: String(row.sale_date || row.date || '').trim() || null,
          sale_status: String(row.sale_status || '').trim() || 'completed',
          payment_method: String(row.payment_method || '').trim() || 'Cash',
          payment_currency: String(row.payment_currency || '').trim() || 'USD',
          customer_name: String(row.customer_name || '').trim() || '',
          customer_phone: String(row.customer_phone || '').trim() || '',
          customer_address: String(row.customer_address || '').trim() || '',
          cashier_name: String(row.cashier_name || '').trim() || user?.name || '',
          notes: String(row.notes || '').trim() || '',
          items: [],
          subtotal_usd: 0,
          subtotal_khr: 0,
          total_usd: 0,
          total_khr: 0,
        }

        const appliedPriceUsd = parseCsvNumber(row.unit_price_usd, 0)
        const appliedPriceKhr = parseCsvNumber(row.unit_price_khr, 0)
        sale.items.push({
          id: product.id,
          product_id: product.id,
          name: product.name,
          product_name: product.name,
          quantity,
          applied_price_usd: appliedPriceUsd,
          applied_price_khr: appliedPriceKhr,
          cost_price_usd: parseCsvNumber(product.cost_price_usd ?? product.purchase_price_usd, 0),
          cost_price_khr: parseCsvNumber(product.cost_price_khr ?? product.purchase_price_khr, 0),
          branch_id: rowBranch?.id || null,
          branch_name: rowBranch?.name || null,
        })
        sale.subtotal_usd += appliedPriceUsd * quantity
        sale.subtotal_khr += appliedPriceKhr * quantity
        sale.total_usd += appliedPriceUsd * quantity
        sale.total_khr += appliedPriceKhr * quantity
        grouped.set(receiptNumber, sale)
      })

      let imported = 0
      let duplicates = 0
      const errors = []

      for (const sale of grouped.values()) {
        try {
          const response = await window.api.createSale({
            ...sale,
            userId: user?.id || null,
            userName: user?.name || '',
          })
          if (response?.duplicate) duplicates += 1
          else imported += 1
        } catch (error) {
          errors.push(`${sale.receipt_number}: ${error?.message || tr('import_failed', 'Import failed', 'នាំចូលបរាជ័យ')}`)
        }
      }

      const nextResult = {
        imported,
        duplicates,
        errors,
      }
      setResult(nextResult)
      if (imported > 0 || duplicates > 0) {
        notify(
          tr('sales_import_finished', 'Sales import finished: {imported} imported, {duplicates} duplicates skipped.', 'ការនាំចូលការលក់បានបញ្ចប់៖ បាននាំចូល {imported} និងរំលងស្ទួន {duplicates}។')
            .replace('{imported}', imported)
            .replace('{duplicates}', duplicates),
          imported > 0 ? 'success' : 'warning',
        )
        onDone?.()
      } else {
        notify(tr('sales_import_none', 'No sales were imported.', 'មិនមានការលក់ណាមួយត្រូវបាននាំចូលទេ។'), 'warning')
      }
    } catch (error) {
      const nextResult = { imported: 0, duplicates: 0, errors: [error?.message || tr('import_failed', 'Import failed', 'នាំចូលបរាជ័យ')] }
      setResult(nextResult)
      notify(error?.message || tr('import_failed', 'Import failed', 'នាំចូលបរាជ័យ'), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={tr('sales_import_title', 'Import Sales', 'នាំចូលការលក់')} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {tr('sales_import_help', 'Import sales from CSV rows grouped by receipt number. Each row should describe one sold product line.', 'នាំចូលការលក់ពីជួរ CSV ដែលដាក់ជាក្រុមតាមលេខបង្កាន់ដៃ។ មួយជួរគួរតែតំណាងឱ្យមួយបន្ទាត់ផលិតផលដែលបានលក់។')}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={handleDownloadTemplate}>
            {t('download_template') || 'Download Template'}
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={handlePickFile}>
            {tr('choose_csv_file', 'Choose CSV', 'ជ្រើស CSV')}
          </button>
        </div>
        {fileName ? (
          <div className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
            {fileName}
          </div>
        ) : null}
        <label htmlFor="sales-import-csv" className="sr-only">
          {tr('sales_import_title', 'Import Sales', 'នាំចូលការលក់')}
        </label>
        <textarea
          id="sales-import-csv"
          name="sales_import_csv"
          className="input min-h-[180px] font-mono text-xs"
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder={tr('csv_paste_placeholder', 'Paste CSV here if you do not want to pick a file.', 'បិទភ្ជាប់ CSV នៅទីនេះ ប្រសិនបើអ្នកមិនចង់ជ្រើសឯកសារ។')}
        />
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          {tr('rows_ready_count', '{count} row(s) ready', '{count} ជួររួចរាល់').replace('{count}', previewRows.length)}
        </div>
        {result ? (
          <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
            <div className="font-medium text-gray-800 dark:text-gray-200">
              {tr('imported_sales_count', 'Imported {count} sale(s)', 'បាននាំចូលការលក់ {count}').replace('{count}', result.imported)}
              {result.duplicates ? `, ${tr('duplicates_skipped_count', 'skipped {count} duplicate(s)', 'បានរំលងស្ទួន {count}').replace('{count}', result.duplicates)}` : ''}
            </div>
            {result.errors?.length ? (
              <div className="mt-2 space-y-1 text-xs text-red-600 dark:text-red-400">
                {result.errors.map((message, index) => <div key={`${message}-${index}`}>{message}</div>)}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>{t('close') || 'Close'}</button>
          <button type="button" className="btn-primary flex-1" disabled={loading || !String(csvText || '').trim()} onClick={handleImport}>
            {loading ? tr('importing', 'Importing...', 'កំពុងនាំចូល...') : tr('import_sales_button', 'Import sales', 'នាំចូលការលក់')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
