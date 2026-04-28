import { useState } from 'react'
import { useApp } from '../../AppContext'
import Modal from '../shared/Modal'
import { parseNumericInput, sanitizeNumericInput } from './primitives'

export default function VariantFormModal({ parent, units, branches, user, onClose, onDone, t, usdSymbol }) {
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }
  const [form, setForm] = useState({
    name: `${parent.name} (${t('product_variant') || 'Variant'})`,
    sku: '',
    barcode: '',
    description: '',
    supplier: parent.supplier || '',
    purchase_price_usd: parent.purchase_price_usd || 0,
    purchase_price_khr: parent.purchase_price_khr || 0,
    selling_price_usd: parent.selling_price_usd || 0,
    selling_price_khr: parent.selling_price_khr || 0,
    stock_quantity: 0,
    branch_id: branches.find((branch) => branch.is_default)?.id || '',
    unit: parent.unit || 'pcs',
    category: parent.category || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const { notify } = useApp()

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const setNumeric = (key, value) => setField(key, sanitizeNumericInput(value))

  const handleSave = async () => {
    if (saving) return
    if (!form.name.trim()) {
      setErr(tr('variant_name_required', 'Variant name is required', 'ត្រូវការឈ្មោះវ៉ារីយ៉ង់'))
      return
    }

    setSaving(true)
    setErr('')
    try {
      const response = await window.api.createProductVariant({
        ...form,
        parent_id: parent.id,
        purchase_price_usd: parseNumericInput(form.purchase_price_usd),
        purchase_price_khr: parseNumericInput(form.purchase_price_khr),
        selling_price_usd: parseNumericInput(form.selling_price_usd),
        selling_price_khr: parseNumericInput(form.selling_price_khr),
        stock_quantity: parseNumericInput(form.stock_quantity),
        cost_price_usd: parseNumericInput(form.purchase_price_usd),
        cost_price_khr: parseNumericInput(form.purchase_price_khr),
        userId: user?.id,
        userName: user?.name,
      })

      if (response?.success === false) {
        setErr(response.error || tr('failed', 'Failed', 'បរាជ័យ'))
        return
      }

      notify(
        tr('variant_added_to_parent', 'Variant "{variant}" added to {product}', 'បានបន្ថែមវ៉ារីយ៉ង់ "{variant}" ទៅ {product}')
          .replace('{variant}', form.name)
          .replace('{product}', parent.name),
        'success',
      )
      onDone()
    } catch (error) {
      setErr(error?.message || tr('failed', 'Failed', 'បរាជ័យ'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`${t('add_variant_to') || 'Add Variant to:'} ${parent.name}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
          {tr('variant_helper_text', 'Variants of the same product group can have different prices, barcodes, and suppliers.', 'វ៉ារីយ៉ង់ក្នុងក្រុមផលិតផលដូចគ្នា អាចមានតម្លៃ បារកូដ និងអ្នកផ្គត់ផ្គង់ខុសគ្នា។')}
        </div>

        {err ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20">{err}</div> : null}

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label htmlFor="variant-form-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tr('variant_name', 'Variant Name', 'ឈ្មោះវ៉ារីយ៉ង់')} *
            </label>
            <input
              id="variant-form-name"
              name="variant_name"
              className="input"
              value={form.name}
              onChange={(event) => setField('name', event.target.value)}
              placeholder={tr('variant_name_placeholder', 'e.g. Product A - Blue, 500ml, Size L', 'ឧ. ផលិតផល A - ពណ៌ខៀវ 500ml ទំហំ L')}
            />
          </div>

          <div>
            <label htmlFor="variant-form-sku" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('sku') || 'SKU'}
            </label>
            <input id="variant-form-sku" name="variant_sku" className="input" value={form.sku} onChange={(event) => setField('sku', event.target.value)} />
          </div>

          <div>
            <label htmlFor="variant-form-barcode" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('barcode') || 'Barcode'}
            </label>
            <input id="variant-form-barcode" name="variant_barcode" className="input" value={form.barcode} onChange={(event) => setField('barcode', event.target.value)} />
          </div>

          <div>
            <label htmlFor="variant-form-supplier" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('supplier') || 'Supplier'}
            </label>
            <input id="variant-form-supplier" name="variant_supplier" className="input" value={form.supplier} onChange={(event) => setField('supplier', event.target.value)} />
          </div>

          <div>
            <label htmlFor="variant-form-unit" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('unit') || 'Unit'}
            </label>
            <select id="variant-form-unit" name="variant_unit" className="input" value={form.unit} onChange={(event) => setField('unit', event.target.value)}>
              {units.map((unit) => <option key={unit.id} value={unit.name}>{unit.name}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="variant-form-purchase-price" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('purchase_price_usd') || `Purchase Price (${usdSymbol})`}
            </label>
            <input
              id="variant-form-purchase-price"
              name="variant_purchase_price_usd"
              className="input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.purchase_price_usd ?? ''}
              onChange={(event) => setNumeric('purchase_price_usd', event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="variant-form-selling-price" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('selling_price_usd') || `Selling Price (${usdSymbol})`}
            </label>
            <input
              id="variant-form-selling-price"
              name="variant_selling_price_usd"
              className="input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.selling_price_usd ?? ''}
              onChange={(event) => setNumeric('selling_price_usd', event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="variant-form-stock" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tr('initial_stock', 'Initial Stock', 'ស្តុកដើម')}
            </label>
            <input
              id="variant-form-stock"
              name="variant_stock_quantity"
              className="input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.stock_quantity ?? ''}
              onChange={(event) => setNumeric('stock_quantity', event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="variant-form-branch" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tr('assign_to_branch', 'Assign to Branch', 'កំណត់ទៅសាខា')}
            </label>
            <select id="variant-form-branch" name="variant_branch_id" className="input" value={form.branch_id || ''} onChange={(event) => setField('branch_id', event.target.value)}>
              <option value="">{tr('default_branch_option', 'Default branch', 'សាខាលំនាំដើម')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                  {branch.is_default ? ` (${t('default_label') || 'Default'})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
          <button type="button" className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
            {saving ? (t('saving') || 'Saving...') : (t('add_variant') || 'Add Variant')}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>{t('cancel') || 'Cancel'}</button>
        </div>
      </div>
    </Modal>
  )
}
