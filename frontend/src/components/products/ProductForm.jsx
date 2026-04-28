import { useEffect, useMemo, useState } from 'react'
import { ScanLine } from 'lucide-react'
import Modal from '../shared/Modal'
import { MarginCard, DualPriceInput, parseNumericInput, sanitizeNumericInput } from './primitives'
import BranchStockAdjuster from './BranchStockAdjuster'
import FilePickerModal from '../files/FilePickerModal'
import BarcodeScannerModal from './BarcodeScannerModal'

function normalizeGallery(product) {
  const source = Array.isArray(product?.image_gallery)
    ? product.image_gallery
    : (product?.image_path ? [product.image_path] : [])
  const seen = new Set()
  const list = []
  for (const entry of source) {
    const value = String(entry || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    list.push(value)
    if (list.length >= 5) break
  }
  return list
}

function pickImageFiles(maxCount = 1, options = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = options.accept || 'image/*'
    if (options.capture) input.capture = options.capture
    input.multiple = maxCount > 1
    input.onchange = () => {
      const files = Array.from(input.files || []).slice(0, maxCount)
      if (!files.length) {
        resolve([])
        return
      }
      resolve(files)
    }
    input.click()
  })
}

export default function ProductForm({
  product,
  categories,
  units,
  branches,
  brandOptions = [],
  onSave,
  onClose,
  t,
  usdSymbol,
  khrSymbol,
  exchangeRate,
  user,
}) {
  const defaultBranchId = branches.find((branch) => branch.is_default)?.id?.toString()
    || branches[0]?.id?.toString()
    || ''

  const initialForm = useMemo(() => {
    if (product) {
      return { ...product }
    }
    return {
      name: '',
      sku: '',
      barcode: '',
      category: '',
      brand: '',
      description: '',
      purchase_price_usd: 0,
      purchase_price_khr: 0,
      selling_price_usd: 0,
      selling_price_khr: 0,
      cost_price_usd: 0,
      cost_price_khr: 0,
      stock_quantity: 0,
      low_stock_threshold: 10,
      out_of_stock_threshold: 0,
      unit: units[0]?.name || 'pcs',
      supplier: '',
      image_path: '',
      image_gallery: [],
      branch_id: defaultBranchId,
    }
  }, [product, units, defaultBranchId])

  const [form, setForm] = useState(initialForm)
  const [imageList, setImageList] = useState(() => normalizeGallery(initialForm))
  const [activeTab, setActiveTab] = useState('basic')
  const [supplierList, setSupplierList] = useState([])
  const [supplierDrop, setSupplierDrop] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [scannerField, setScannerField] = useState('')
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')

  const tr = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  useEffect(() => {
    setForm(initialForm)
    setImageList(normalizeGallery(initialForm))
  }, [initialForm])

  useEffect(() => {
    window.api.getSuppliers?.().then((data) => {
      setSupplierList(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!product && !form.branch_id && defaultBranchId) {
      setForm((current) => ({ ...current, branch_id: defaultBranchId }))
    }
  }, [product, form.branch_id, defaultBranchId])

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function setNumericField(key, value, options) {
    setField(key, sanitizeNumericInput(value, options))
  }

  async function addImages() {
    await uploadPickedImages({})
  }

  async function addPhoto() {
    await uploadPickedImages({ capture: 'environment' })
  }

  async function uploadPickedImages(options = {}) {
    try {
      const remaining = Math.max(0, 5 - imageList.length)
      if (!remaining) return
      const files = await pickImageFiles(remaining, options)
      if (!files.length) return
      const uploadedPaths = []
      for (const file of files) {
        const asset = await window.api.uploadFileAsset({ file, userId: user?.id, userName: user?.name })
        if (asset?.public_path) uploadedPaths.push(asset.public_path)
      }
      setImageList((current) => {
        const next = [...current]
        uploadedPaths.forEach((url) => {
          if (!next.includes(url) && next.length < 5) next.push(url)
        })
        return next
      })
    } catch (error) {
      alert(error?.message || tr('image_upload_failed', 'Image upload failed', 'ការបង្ហោះរូបភាពបានបរាជ័យ'))
    }
  }

  function removeImage(index) {
    setImageList((current) => current.filter((_, idx) => idx !== index))
  }

  function setPrimaryImage(index) {
    setImageList((current) => {
      if (index < 0 || index >= current.length) return current
      const next = [...current]
      const [primary] = next.splice(index, 1)
      next.unshift(primary)
      return next
    })
  }

  function saveForm() {
    if (!String(form.name || '').trim()) {
      alert(tr('name_required_alert', 'Name is required', 'ត្រូវការឈ្មោះ'))
      return
    }
    if (!product && branches.length > 0 && !form.branch_id) {
      alert(tr('branch_required_alert', 'Please choose a branch for this product.', 'សូមជ្រើសរើសសាខាសម្រាប់ផលិតផលនេះ។'))
      return
    }
    const payload = {
      ...form,
      purchase_price_usd: parseNumericInput(form.purchase_price_usd),
      purchase_price_khr: parseNumericInput(form.purchase_price_khr),
      selling_price_usd: parseNumericInput(form.selling_price_usd),
      selling_price_khr: parseNumericInput(form.selling_price_khr),
      cost_price_usd: parseNumericInput(form.cost_price_usd ?? form.purchase_price_usd),
      cost_price_khr: parseNumericInput(form.cost_price_khr ?? form.purchase_price_khr),
      stock_quantity: parseNumericInput(form.stock_quantity),
      low_stock_threshold: parseNumericInput(form.low_stock_threshold, 10),
      out_of_stock_threshold: parseNumericInput(form.out_of_stock_threshold),
      image_gallery: imageList.slice(0, 5),
      image_path: imageList[0] || '',
    }
    onSave(payload)
  }

  function openScanner(field) {
    setScannerField(field)
  }

  function closeScanner() {
    setScannerField('')
  }

  function applyScannedValue(value) {
    const nextValue = String(value || '').trim()
    if (!nextValue || !scannerField) return
    setField(scannerField, nextValue)
    closeScanner()
  }

  const scanLabel = tr('scan_code', 'Scan', 'ស្កេន')
  const scanSkuLabel = tr('scan_sku', 'Scan SKU', 'ស្កេន SKU')
  const scanBarcodeLabel = tr('scan_barcode', 'Scan barcode', 'ស្កេនបាកូដ')

  const tabs = [
    { id: 'basic', label: tr('basic_info', 'Basic Info', 'ព័ត៌មានមូលដ្ឋាន') },
    { id: 'pricing', label: tr('pricing', 'Pricing', 'តម្លៃ') },
    { id: 'stock', label: tr('stock', 'Stock', 'ស្តុក') },
  ]

  const supplierMatches = form.supplier
    ? supplierList.filter((supplier) => String(supplier.name || '').toLowerCase().includes(String(form.supplier || '').toLowerCase()))
    : []

  return (
    <Modal title={product ? `${tr('edit_product', 'Edit Product', 'កែប្រែផលិតផល')}: ${product.name}` : tr('add_product', 'Add Product', 'បន្ថែមផលិតផល')} onClose={onClose} wide>
      <div className="mb-5 -mx-5 border-b border-gray-200 px-5 dark:border-gray-700">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'basic' ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{tr('upload_image', 'Upload Image', 'បង្ហោះរូបភាព')}</p>
              <p className="text-xs text-gray-400">{imageList.length}/5</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={addImages}>
                {tr('choose_file', 'Choose File', 'ជ្រើសរើសឯកសារ')}
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={addPhoto}>
                {tr('take_photo', 'Take Photo', 'ថតរូប')}
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={() => setFilePickerOpen(true)}>
                {tr('open_files', 'Open Files', 'បើកឯកសារ') || tr('files', 'Files', 'ឯកសារ')}
              </button>
            </div>
            {imageList.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {imageList.map((image, index) => (
                  <div key={`${image}-${index}`} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <img src={image} alt={`product-${index + 1}`} className="h-20 w-full object-cover sm:h-24" />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-1.5 py-1 text-[10px] text-white">
                      <button type="button" className="rounded px-1 py-0.5 hover:bg-white/20" onClick={() => setPrimaryImage(index)}>
                        {index === 0 ? tr('primary', 'Primary', 'រូបសំខាន់') : tr('set_primary', 'Set primary', 'កំណត់ជារូបសំខាន់')}
                      </button>
                      <button type="button" className="rounded px-1 py-0.5 hover:bg-white/20" onClick={() => removeImage(index)}>
                        {tr('remove', 'Remove', 'លុប')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label htmlFor="product-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('name')} *</label>
              <input id="product-name" name="product_name" className="input" value={form.name || ''} onChange={(event) => setField('name', event.target.value)} />
            </div>
            <div>
              <label htmlFor="product-sku" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sku')}</label>
              <div className="flex gap-2">
                <input
                  id="product-sku"
                  name="product_sku"
                  className="input flex-1"
                  value={form.sku || ''}
                  onChange={(event) => setField('sku', event.target.value)}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3" onClick={() => openScanner('sku')} aria-label={scanSkuLabel}>
                  <ScanLine className="h-4 w-4" />
                  <span className="hidden sm:inline">{scanLabel}</span>
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="product-barcode" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('barcode')}</label>
              <div className="flex gap-2">
                <input
                  id="product-barcode"
                  name="product_barcode"
                  className="input flex-1"
                  value={form.barcode || ''}
                  onChange={(event) => setField('barcode', event.target.value)}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3" onClick={() => openScanner('barcode')} aria-label={scanBarcodeLabel}>
                  <ScanLine className="h-4 w-4" />
                  <span className="hidden sm:inline">{scanLabel}</span>
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="product-category" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('category', 'Category', 'ប្រភេទ')}</label>
              <select id="product-category" name="product_category" className="input" value={form.category || ''} onChange={(event) => setField('category', event.target.value)}>
                <option value="">{tr('category', 'Category', 'ប្រភេទ')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.name}>{category.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="product-brand" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('brand', 'Brand', 'ម៉ាក')}</label>
              <input
                id="product-brand"
                name="product_brand"
                className="input"
                list="product-brand-options"
                value={form.brand || ''}
                onChange={(event) => setField('brand', event.target.value)}
                placeholder={tr('brand', 'Brand', 'ម៉ាក')}
              />
              <datalist id="product-brand-options">
                {(brandOptions || []).map((brand) => (
                  <option key={brand} value={brand} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="product-unit" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('unit')}</label>
              <select id="product-unit" name="product_unit" className="input" value={form.unit || 'pcs'} onChange={(event) => setField('unit', event.target.value)}>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.name}>{unit.name}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <label htmlFor="product-supplier" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('supplier', 'Supplier', 'អ្នកផ្គត់ផ្គង់')}</label>
              <input
                id="product-supplier"
                name="product_supplier"
                className="input"
                value={form.supplier || ''}
                onFocus={() => setSupplierDrop(true)}
                onChange={(event) => {
                  setField('supplier', event.target.value)
                  setSupplierDrop(true)
                }}
                placeholder={tr('type_or_select_supplier', 'Type or select supplier...', 'វាយឈ្មោះ ឬជ្រើសរើសអ្នកផ្គត់ផ្គង់...')}
              />
              {supplierDrop && supplierMatches.length ? (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-40 overflow-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-zinc-600 dark:bg-zinc-800">
                  {supplierMatches.map((supplier) => (
                    <button
                      key={supplier.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      onClick={() => {
                        setField('supplier', supplier.name)
                        setSupplierDrop(false)
                      }}
                    >
                      <span className="font-medium text-gray-800 dark:text-gray-200">{supplier.name}</span>
                      {supplier.company ? <span className="text-xs text-gray-400">{supplier.company}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="col-span-2">
              <label htmlFor="product-description" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('description')}</label>
              <textarea id="product-description" name="product_description" className="input resize-none" rows={2} value={form.description || ''} onChange={(event) => setField('description', event.target.value)} />
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'pricing' ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/10">
            <div className="mb-3">
              <p className="text-sm font-bold text-red-700 dark:text-red-400">{t('cost_in_purchase')}</p>
              <p className="text-xs text-red-500 dark:text-red-500">{t('what_you_pay_supplier')}</p>
            </div>
            <DualPriceInput
              labelUsd={t('cost_in_usd_label')}
              labelKhr={t('cost_in_khr_label')}
              valueUsd={form.purchase_price_usd}
              valueKhr={form.purchase_price_khr}
              onUsdChange={(value) => {
                setField('purchase_price_usd', value)
                setField('cost_price_usd', value)
                if (!String(form.purchase_price_khr ?? '').trim()) {
                  const converted = parseNumericInput(value) * exchangeRate
                  setField('purchase_price_khr', value === '' ? '' : String(converted))
                }
              }}
              onKhrChange={(value) => {
                setField('purchase_price_khr', value)
                setField('cost_price_khr', value)
              }}
              usdSymbol={usdSymbol}
              khrSymbol={khrSymbol}
              exchangeRate={exchangeRate}
              t={t}
            />
          </div>

          <div className="rounded-xl border border-green-100 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/10">
            <div className="mb-3">
              <p className="text-sm font-bold text-green-700 dark:text-green-400">{tr('selling_price_to_customer', 'Selling Price', 'តម្លៃលក់')}</p>
              <p className="text-xs text-green-600 dark:text-green-500">{tr('what_customers_pay_pos', 'What customers pay at point of sale', 'តម្លៃដែលអតិថិជនបង់នៅកន្លែងលក់')}</p>
            </div>
            <DualPriceInput
              labelUsd={tr('selling_price_usd_full', 'Selling Price (USD)', 'តម្លៃលក់ (USD)')}
              labelKhr={tr('selling_price_khr_full', 'Selling Price (KHR)', 'តម្លៃលក់ (KHR)')}
              valueUsd={form.selling_price_usd}
              valueKhr={form.selling_price_khr}
              onUsdChange={(value) => {
                setField('selling_price_usd', value)
                if (!String(form.selling_price_khr ?? '').trim()) {
                  const converted = parseNumericInput(value) * exchangeRate
                  setField('selling_price_khr', value === '' ? '' : String(converted))
                }
              }}
              onKhrChange={(value) => setField('selling_price_khr', value)}
              usdSymbol={usdSymbol}
              khrSymbol={khrSymbol}
              exchangeRate={exchangeRate}
              t={t}
            />
          </div>

          {Number(form.selling_price_usd || 0) > 0 && Number(form.purchase_price_usd || 0) > 0 ? (
            <MarginCard
              purchaseUsd={Number(form.purchase_price_usd || 0)}
              sellingUsd={Number(form.selling_price_usd || 0)}
              usdSymbol={usdSymbol}
            />
          ) : null}
        </div>
      ) : null}

      {activeTab === 'stock' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('stock')} ({t('quantity')})</label>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.stock_quantity ?? ''}
                onChange={(event) => setNumericField('stock_quantity', event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('low_stock_threshold')}</label>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.low_stock_threshold ?? ''}
                onChange={(event) => setNumericField('low_stock_threshold', event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('out_of_stock_threshold')}</label>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.out_of_stock_threshold ?? ''}
                onChange={(event) => setNumericField('out_of_stock_threshold', event.target.value)}
              />
            </div>
          </div>

          {!product && branches.length > 0 ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('assign_initial_branch', 'Assign Initial Stock to Branch *', 'កំណត់ស្តុកដំបូងទៅសាខា *')}</label>
              <select className="input" value={form.branch_id || ''} onChange={(event) => setField('branch_id', event.target.value)}>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}{branch.is_default ? ` (${tr('default_label', 'default', 'លំនាំដើម')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {product && branches.length > 0 ? (
            <BranchStockAdjuster
              product={product}
              branches={branches}
              user={user}
              onDone={onSave}
              t={t}
            />
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 flex gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
        <button type="button" className="btn-primary flex-1" onClick={saveForm}>
          {t('save')}
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
      <FilePickerModal
        open={filePickerOpen}
        mediaType="image"
        title={tr('choose_product_image', 'Choose product image', 'ជ្រើសរើសរូបភាពផលិតផល')}
        onClose={() => setFilePickerOpen(false)}
        onSelect={(publicPath) => setImageList((current) => current.includes(publicPath) || current.length >= 5 ? current : [...current, publicPath])}
      />
      <BarcodeScannerModal
        open={!!scannerField}
        title={scannerField === 'sku' ? scanSkuLabel : scanBarcodeLabel}
        onClose={closeScanner}
        onDetected={applyScannedValue}
        t={t}
      />
    </Modal>
  )
}
