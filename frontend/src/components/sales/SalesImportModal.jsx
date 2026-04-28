import { useMemo, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp } from '../../AppContext'

function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const headers = splitCsvLine(lines[0]).map((value) => String(value || '').trim().replace(/^"|"$/g, '').toLowerCase())
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line)
    const row = {}
    headers.forEach((header, index) => {
      row[header] = String(values[index] || '').trim().replace(/^"|"$/g, '')
    })
    return row
  }).filter((row) => Object.values(row).some(Boolean))
}

function splitCsvLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]
    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"'
      index += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
      continue
    }
    current += char
  }
  result.push(current)
  return result
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeBranchMap(branches = []) {
  const map = new Map()
  branches.forEach((branch) => {
    const nameKey = normalizeKey(branch?.name)
    if (nameKey) map.set(nameKey, branch)
    const idKey = normalizeKey(branch?.id)
    if (idKey) map.set(idKey, branch)
  })
  return map
}

function findProduct(row, productMaps) {
  const sku = normalizeKey(row.sku)
  if (sku && productMaps.bySku.has(sku)) return productMaps.bySku.get(sku)
  const barcode = normalizeKey(row.barcode)
  if (barcode && productMaps.byBarcode.has(barcode)) return productMaps.byBarcode.get(barcode)
  const name = normalizeKey(row.name)
  if (name && productMaps.byName.has(name)) return productMaps.byName.get(name)
  return null
}

function toNumber(value, fallback = 0) {
  const numeric = parseFloat(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export default function SalesImportModal({ onClose, onDone }) {
  const { user, notify } = useApp()
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const previewRows = useMemo(() => parseCsv(csvText), [csvText])

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
    const rows = parseCsv(csvText)
    if (!rows.length) {
      notify('Choose a CSV file with at least one sale row.', 'error')
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
        const sku = normalizeKey(product?.sku)
        const barcode = normalizeKey(product?.barcode)
        const name = normalizeKey(product?.name)
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
        if (!product) throw new Error(`Row ${index + 2}: product not found for "${row.name || row.sku || row.barcode || 'unknown'}"`)

        const quantity = toNumber(row.quantity, 0)
        if (quantity <= 0) throw new Error(`Row ${index + 2}: quantity must be greater than 0`)

        const receiptNumber = String(row.receipt_number || '').trim() || `IMP-SALE-${Date.now()}-${index + 1}`
        const branchValue = String(row.branch || '').trim()
        const rowBranch = branchValue ? branchMap.get(normalizeKey(branchValue)) : defaultBranch
        if (branchValue && !rowBranch) throw new Error(`Row ${index + 2}: branch "${branchValue}" not found`)
        if (!rowBranch && activeBranches.length > 1) {
          throw new Error(`Row ${index + 2}: branch is required when multiple branches are active`)
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

        const appliedPriceUsd = toNumber(row.unit_price_usd, 0)
        const appliedPriceKhr = toNumber(row.unit_price_khr, 0)
        sale.items.push({
          id: product.id,
          product_id: product.id,
          name: product.name,
          product_name: product.name,
          quantity,
          applied_price_usd: appliedPriceUsd,
          applied_price_khr: appliedPriceKhr,
          cost_price_usd: toNumber(product.cost_price_usd ?? product.purchase_price_usd, 0),
          cost_price_khr: toNumber(product.cost_price_khr ?? product.purchase_price_khr, 0),
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
          errors.push(`${sale.receipt_number}: ${error?.message || 'Import failed'}`)
        }
      }

      const nextResult = {
        imported,
        duplicates,
        errors,
      }
      setResult(nextResult)
      if (imported > 0 || duplicates > 0) {
        notify(`Sales import finished: ${imported} imported${duplicates ? `, ${duplicates} duplicates skipped` : ''}.`, imported > 0 ? 'success' : 'warning')
        onDone?.()
      } else {
        notify('No sales were imported.', 'warning')
      }
    } catch (error) {
      const nextResult = { imported: 0, duplicates: 0, errors: [error?.message || 'Import failed'] }
      setResult(nextResult)
      notify(error?.message || 'Import failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Import Sales" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Import sales from CSV rows grouped by `receipt_number`. Each row should describe one sold product line.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={handleDownloadTemplate}>
            Download template
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={handlePickFile}>
            Choose CSV
          </button>
        </div>
        {fileName ? (
          <div className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
            {fileName}
          </div>
        ) : null}
        <textarea
          className="input min-h-[180px] font-mono text-xs"
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder="Paste CSV here if you do not want to pick a file."
        />
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          {previewRows.length} row{previewRows.length === 1 ? '' : 's'} ready
        </div>
        {result ? (
          <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
            <div className="font-medium text-gray-800 dark:text-gray-200">
              Imported {result.imported} sale{result.imported === 1 ? '' : 's'}
              {result.duplicates ? `, skipped ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'}` : ''}
            </div>
            {result.errors?.length ? (
              <div className="mt-2 space-y-1 text-xs text-red-600 dark:text-red-400">
                {result.errors.map((message, index) => <div key={`${message}-${index}`}>{message}</div>)}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Close</button>
          <button type="button" className="btn-primary flex-1" disabled={loading || !String(csvText || '').trim()} onClick={handleImport}>
            {loading ? 'Importing...' : 'Import sales'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
