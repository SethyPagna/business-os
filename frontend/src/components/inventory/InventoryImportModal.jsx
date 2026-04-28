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

function toNumber(value, fallback = 0) {
  const numeric = parseFloat(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function normalizeAction(value) {
  const raw = normalizeKey(value)
  if (['add', 'remove', 'set'].includes(raw)) return raw
  if (raw === 'adjustment') return 'add'
  return 'add'
}

export default function InventoryImportModal({ onClose, onDone }) {
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
    setFileName(String(picked.name || 'inventory.csv'))
    setResult(null)
  }

  const handleDownloadTemplate = () => {
    window.api.downloadImportTemplate('inventory')
  }

  const handleImport = async () => {
    const rows = parseCsv(csvText)
    if (!rows.length) {
      notify('Choose a CSV file with at least one inventory row.', 'error')
      return
    }

    setLoading(true)
    try {
      const [products, branches] = await Promise.all([
        window.api.getProducts(),
        window.api.getBranches(),
      ])

      const bySku = new Map()
      const byBarcode = new Map()
      const byName = new Map()
      ;(Array.isArray(products) ? products : []).forEach((product) => {
        const sku = normalizeKey(product?.sku)
        const barcode = normalizeKey(product?.barcode)
        const name = normalizeKey(product?.name)
        if (sku) bySku.set(sku, product)
        if (barcode) byBarcode.set(barcode, product)
        if (name) byName.set(name, product)
      })

      const activeBranches = (Array.isArray(branches) ? branches : []).filter((branch) => branch?.is_active)
      const defaultBranch = activeBranches.find((branch) => branch?.is_default) || activeBranches[0] || null
      const branchMap = new Map()
      activeBranches.forEach((branch) => {
        branchMap.set(normalizeKey(branch?.name), branch)
        branchMap.set(normalizeKey(branch?.id), branch)
      })

      let imported = 0
      const errors = []

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        const product = bySku.get(normalizeKey(row.sku))
          || byBarcode.get(normalizeKey(row.barcode))
          || byName.get(normalizeKey(row.name))
        if (!product) {
          errors.push(`Row ${index + 2}: product not found`)
          continue
        }

        const quantity = toNumber(row.quantity, 0)
        if (quantity <= 0) {
          errors.push(`Row ${index + 2}: quantity must be greater than 0`)
          continue
        }

        const branchValue = String(row.branch || '').trim()
        const branch = branchValue ? branchMap.get(normalizeKey(branchValue)) : defaultBranch
        if (branchValue && !branch) {
          errors.push(`Row ${index + 2}: branch "${branchValue}" not found`)
          continue
        }

        try {
          await window.api.adjustStock({
            productId: product.id,
            productName: product.name,
            type: normalizeAction(row.action || row.type || row.movement_type),
            quantity,
            unitCostUsd: toNumber(row.unit_cost_usd, 0),
            unitCostKhr: toNumber(row.unit_cost_khr, 0),
            reason: String(row.reason || '').trim() || 'Inventory import',
            branchId: branch?.id || null,
            userId: user?.id || null,
            userName: user?.name || '',
            created_at: String(row.date || row.created_at || row.movement_date || '').trim() || null,
          })
          imported += 1
        } catch (error) {
          errors.push(`Row ${index + 2}: ${error?.message || 'Import failed'}`)
        }
      }

      const nextResult = { imported, errors }
      setResult(nextResult)
      if (imported > 0) {
        notify(`Inventory import finished: ${imported} row${imported === 1 ? '' : 's'} applied.`, 'success')
        onDone?.()
      } else {
        notify('No inventory rows were imported.', 'warning')
      }
    } catch (error) {
      const nextResult = { imported: 0, errors: [error?.message || 'Import failed'] }
      setResult(nextResult)
      notify(error?.message || 'Import failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Import Inventory" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Import stock adjustments from CSV rows. Supported actions are `add`, `remove`, and `set`.
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
              Imported {result.imported} row{result.imported === 1 ? '' : 's'}
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
            {loading ? 'Importing...' : 'Import inventory'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
