import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../AppContext'

function multiMatch(text, terms) {
  return terms.every(term => text.toLowerCase().includes(term.toLowerCase()))
}

function MarginCard({ purchaseUsd, sellingUsd, usdSymbol }) {
  const margin = sellingUsd - purchaseUsd
  const pct = sellingUsd > 0 ? (margin / sellingUsd * 100) : 0
  const isProfit = margin >= 0
  return (
    <div className={`rounded-xl p-4 ${isProfit ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'}`}>
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">📊 Margin Analysis</p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-lg font-bold text-red-600">{usdSymbol}{purchaseUsd.toFixed(2)}</div>
          <div className="text-xs text-gray-500">Purchase</div>
        </div>
        <div>
          <div className={`text-lg font-bold ${isProfit ? 'text-blue-600' : 'text-yellow-600'}`}>{usdSymbol}{margin.toFixed(2)}</div>
          <div className="text-xs text-gray-500">Margin ({pct.toFixed(1)}%)</div>
        </div>
        <div>
          <div className="text-lg font-bold text-green-600">{usdSymbol}{sellingUsd.toFixed(2)}</div>
          <div className="text-xs text-gray-500">Selling</div>
        </div>
      </div>
      {!isProfit && <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2 text-center">⚠️ Selling price is below purchase price</p>}
    </div>
  )
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl ${wide ? 'w-full max-w-4xl' : 'w-full max-w-2xl'} max-h-[92vh] flex flex-col fade-in`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">×</button>
        </div>
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  )
}

function DualPriceInput({ labelUsd, labelKhr, valueUsd, valueKhr, onUsdChange, onKhrChange, usdSymbol, khrSymbol, exchangeRate, t }) {
  const handleUsdChange = (val) => {
    const num = parseFloat(val) || 0
    onUsdChange(num)
    // Only auto-fill KHR if it hasn't been manually set
    if (!valueKhr) onKhrChange(num * exchangeRate)
  }
  const handleKhrChange = (val) => {
    const num = parseFloat(val) || 0
    onKhrChange(num)
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{labelUsd} ({usdSymbol})</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{usdSymbol}</span>
          <input className="input pl-7" type="number" step="0.01" min="0" value={valueUsd || ''} onChange={e => handleUsdChange(e.target.value)} placeholder="0.00" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{labelKhr} ({khrSymbol})</label>
        <div className="relative">
          <input className="input pr-7" type="number" step="1" min="0" value={valueKhr || ''} onChange={e => handleKhrChange(e.target.value)} placeholder="0" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{khrSymbol}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Manage Categories Modal ──────────────────────────────────────────────────
function ManageCategoriesModal({ onClose, t }) {
  const [cats, setCats] = useState([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3b82f6')
  const [editing, setEditing] = useState(null)

  const load = () => window.api.getCategories().then(setCats)
  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!newName.trim()) return
    await window.api.createCategory({ name: newName.trim(), color: newColor })
    setNewName(''); setNewColor('#3b82f6'); load()
  }
  const handleUpdate = async (cat) => {
    await window.api.updateCategory({ id: cat.id, name: cat.name, color: cat.color })
    setEditing(null); load()
  }
  const handleDelete = async (id) => {
    if (!confirm(t('confirm_delete'))) return
    await window.api.deleteCategory(id); load()
  }

  return (
    <Modal title={`🏷 ${t('manage_categories')}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1"><label className="text-xs text-gray-500 mb-1 block">{t('name')}</label><input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('category')} /></div>
          <div><label className="text-xs text-gray-500 mb-1 block">{t('color')}</label><input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer" /></div>
          <button className="btn-primary" onClick={handleAdd}>{t('add')}</button>
        </div>
        <div className="space-y-2 max-h-80 overflow-auto">
          {cats.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 dark:border-gray-700">
              {editing?.id === c.id ? (
                <>
                  <input type="color" value={editing.color} onChange={e => setEditing(ed => ({...ed, color: e.target.value}))} className="w-8 h-8 rounded cursor-pointer border border-gray-300" />
                  <input className="input flex-1 py-1" value={editing.name} onChange={e => setEditing(ed => ({...ed, name: e.target.value}))} />
                  <button className="btn-primary text-xs py-1 px-3" onClick={() => handleUpdate(editing)}>{t('save')}</button>
                  <button className="btn-secondary text-xs py-1 px-2" onClick={() => setEditing(null)}>{t('cancel')}</button>
                </>
              ) : (
                <>
                  <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: c.color }} />
                  <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{c.name}</span>
                  <button onClick={() => setEditing({...c})} className="text-blue-500 text-xs hover:underline">{t('edit')}</button>
                  <button onClick={() => handleDelete(c.id)} className="text-red-500 text-xs hover:underline">{t('delete')}</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ─── Manage Units Modal ───────────────────────────────────────────────────────
function ManageUnitsModal({ onClose, t }) {
  const [units, setUnits] = useState([])
  const [newUnit, setNewUnit] = useState('')

  const load = () => window.api.getUnits().then(setUnits)
  useEffect(() => { load() }, [])

  return (
    <Modal title={`📏 ${t('manage_units')}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className="input flex-1" value={newUnit} onChange={e => setNewUnit(e.target.value)} placeholder="e.g. bottle, bag..." onKeyDown={async e => { if (e.key === 'Enter' && newUnit.trim()) { await window.api.createUnit(newUnit.trim()); setNewUnit(''); load() } }} />
          <button className="btn-primary" onClick={async () => { if (newUnit.trim()) { await window.api.createUnit(newUnit.trim()); setNewUnit(''); load() } }}>{t('add')}</button>
        </div>
        <div className="flex flex-wrap gap-2 max-h-60 overflow-auto">
          {units.map(u => (
            <div key={u.id} className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-full px-3 py-1 text-sm">
              <span className="text-gray-700 dark:text-gray-300">{u.name}</span>
              <button onClick={async () => { if (confirm(t('confirm_delete'))) { await window.api.deleteUnit(u.id); load() } }} className="text-red-400 hover:text-red-600 ml-1 text-base leading-none">×</button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ─── Manage Custom Fields Modal ───────────────────────────────────────────────
function ManageFieldsModal({ onClose, t, onChanged }) {
  const [fields, setFields] = useState([])
  const [form, setForm] = useState({ name: '', field_type: 'text', options: '' })
  const [editing, setEditing] = useState(null)

  const FIELD_TYPES = ['text', 'number', 'decimal', 'boolean', 'date', 'dropdown', 'long_text']
  const load = () => window.api.getCustomFields().then(setFields)
  useEffect(() => { load() }, [])

  const handleSave = async () => {
    if (!form.name.trim()) return
    const data = { ...form, options: form.options ? form.options.split(',').map(o => o.trim()).filter(Boolean) : [] }
    if (editing) await window.api.updateCustomField(editing.id, data)
    else await window.api.createCustomField(data)
    setForm({ name: '', field_type: 'text', options: '' }); setEditing(null)
    load(); onChanged?.()
  }

  return (
    <Modal title={`🧩 ${t('manage_fields')}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-500 mb-1 block">{t('field_name')}</label><input className="input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Brand, Weight..." /></div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{t('field_type')}</label>
              <select className="input" value={form.field_type} onChange={e => setForm(f => ({...f, field_type: e.target.value}))}>
                {FIELD_TYPES.map(ft => <option key={ft} value={ft}>{ft}</option>)}
              </select>
            </div>
          </div>
          {form.field_type === 'dropdown' && (
            <div><label className="text-xs text-gray-500 mb-1 block">{t('options')} (comma separated)</label><input className="input" value={form.options} onChange={e => setForm(f => ({...f, options: e.target.value}))} placeholder="Option A, Option B, Option C" /></div>
          )}
          <div className="flex gap-2">
            <button className="btn-primary" onClick={handleSave}>{editing ? t('save') : t('add_field')}</button>
            {editing && <button className="btn-secondary" onClick={() => { setEditing(null); setForm({ name: '', field_type: 'text', options: '' }) }}>{t('cancel')}</button>}
          </div>
        </div>
        <div className="space-y-2 max-h-64 overflow-auto">
          {fields.map(f => (
            <div key={f.id} className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 dark:border-gray-700">
              <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{f.name}</span>
              <span className="badge-blue text-xs">{f.field_type}</span>
              <button onClick={() => { setEditing(f); setForm({ name: f.name, field_type: f.field_type, options: (JSON.parse(f.options || '[]')).join(', ') }) }} className="text-blue-500 text-xs hover:underline">{t('edit')}</button>
              <button onClick={async () => { if (confirm(t('confirm_delete'))) { await window.api.deleteCustomField(f.id); load(); onChanged?.() } }} className="text-red-500 text-xs hover:underline">{t('delete')}</button>
            </div>
          ))}
          {fields.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No custom fields yet. Add fields to track extra product data.</p>}
        </div>
      </div>
    </Modal>
  )
}

// ─── Bulk Import Modal ────────────────────────────────────────────────────────
function BulkImportModal({ onClose, onDone, t, exchangeRate }) {
  const [step, setStep] = useState(1)
  const [csvData, setCsvData] = useState(null)
  const [imageDir, setImageDir] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const { user } = useApp()

  const handleDownloadTemplate = () => window.api.downloadImportTemplate()

  const handlePickCSV = async () => {
    const res = await window.api.openCSVDialog()
    if (res) { setCsvData(res); setStep(2) }
  }

  const handlePickFolder = async () => {
    const folder = await window.api.openFolderDialog()
    if (folder) setImageDir(folder)
  }

  const handleImport = async () => {
    if (!csvData) return
    setLoading(true)
    const res = await window.api.bulkImportProducts({
      csvText: csvData.content,
      imageDir,
      userId: user.id,
      userName: user.name,
      exchangeRate
    })
    setResult(res)
    setStep(3)
    setLoading(false)
    if (res.imported > 0) onDone()
  }

  return (
    <Modal title={`📥 ${t('bulk_import')}`} onClose={onClose}>
      {/* Step indicators */}
      <div className="flex gap-2 mb-6">
        {[1,2,3].map(s => (
          <div key={s} className={`flex-1 h-1.5 rounded-full ${step >= s ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300">
            <p className="font-semibold mb-2">📋 How to bulk import:</p>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>Download the CSV template</li>
              <li>Fill in your product data (one product per row)</li>
              <li>Optionally put product images in a folder</li>
              <li>Upload the CSV file here</li>
            </ol>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">CSV Columns:</p>
            <p className="text-xs text-gray-500 font-mono leading-relaxed">name, sku, barcode, category, description,<br/>selling_price_usd, selling_price_khr,<br/>purchase_price_usd, purchase_price_khr,<br/>stock_quantity, low_stock_threshold, unit,<br/>supplier, <strong>branch</strong>, image_filename</p>
          </div>
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={handleDownloadTemplate}>⬇ {t('download_template')}</button>
            <button className="btn-primary flex-1" onClick={handlePickCSV}>📂 {t('upload_csv')}</button>
          </div>
        </div>
      )}

      {step === 2 && csvData && (
        <div className="space-y-4">
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-sm font-medium text-green-700 dark:text-green-400">CSV loaded: {csvData.filePath.split(/[/\\]/).pop()}</p>
              <p className="text-xs text-green-600 dark:text-green-500">{csvData.content.split('\n').length - 1} data rows detected</p>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('select_image_folder')}:</p>
            <div className="flex gap-2">
              <div className="flex-1 input text-sm text-gray-500 truncate flex items-center">{imageDir || t('no_image')}</div>
              <button className="btn-secondary text-sm" onClick={handlePickFolder}>📁 Browse</button>
            </div>
            {imageDir && <p className="text-xs text-gray-400 mt-1">Images in this folder will be matched by filename in the CSV</p>}
          </div>
          <div className="flex gap-3 pt-2">
            <button className="btn-secondary" onClick={() => { setCsvData(null); setStep(1) }}>← Back</button>
            <button className="btn-primary flex-1" onClick={handleImport} disabled={loading}>
              {loading ? t('loading') : `🚀 Import Products`}
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="space-y-4">
          <div className={`rounded-xl p-4 ${result.imported > 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
            <p className="font-bold text-lg">{result.imported > 0 ? '🎉' : '⚠️'} {t('imported')}: {result.imported} products</p>
          </div>
          {result.errors?.length > 0 && (
            <div>
              <p className="text-sm font-medium text-red-600 mb-2">⚠ {t('import_errors')} ({result.errors.length}):</p>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 max-h-40 overflow-auto text-xs text-red-600 space-y-1">
                {result.errors.map((e, i) => <div key={i}>• {e}</div>)}
              </div>
            </div>
          )}
          <button className="btn-primary w-full" onClick={onClose}>Done</button>
        </div>
      )}
    </Modal>
  )
}

// ─── Product Form ──────────────────────────────────────────────────────────────
function ProductForm({ product, categories, units, customFields, branches, onSave, onClose, t, usdSymbol, khrSymbol, exchangeRate }) {
  const init = product ? { ...product, custom_fields: typeof product.custom_fields === 'string' ? JSON.parse(product.custom_fields || '{}') : (product.custom_fields || {}) }
    : { name: '', sku: '', barcode: '', category: '', description: '', purchase_price_usd: 0, purchase_price_khr: 0, selling_price_usd: 0, selling_price_khr: 0, cost_price_usd: 0, cost_price_khr: 0, stock_quantity: 0, low_stock_threshold: 10, out_of_stock_threshold: 0, unit: units[0]?.name || 'pcs', supplier: '', image_path: '', custom_fields: {} }
  const [form, setForm] = useState(init)
  const [imagePreview, setImagePreview] = useState(product?.image_path ? `file://${product.image_path}` : null)
  const [activeTab, setActiveTab] = useState('basic')

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const setCustom = (key, val) => setForm(f => ({ ...f, custom_fields: { ...f.custom_fields, [key]: val } }))

  const handlePickImage = async () => {
    const p = await window.api.openImageDialog()
    if (p) { setImagePreview(`file://${p}`); set('_tempImagePath', p) }
  }

  const TABS = [
    { id: 'basic', label: '📦 Basic Info' },
    { id: 'pricing', label: '💰 Pricing' },
    { id: 'stock', label: '📊 Stock' },
    ...(customFields.length > 0 ? [{ id: 'custom', label: '🧩 Custom' }] : [])
  ]

  return (
    <Modal title={product ? `✏️ ${t('edit_product')}: ${product.name}` : `➕ ${t('add_product')}`} onClose={onClose} wide>
      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 dark:border-gray-700 -mx-5 px-5">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tab.label}</button>
        ))}
      </div>

      {activeTab === 'basic' && (
        <div className="space-y-4">
          {/* Image */}
          <div className="flex gap-4 items-center">
            <div onClick={handlePickImage} className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 cursor-pointer overflow-hidden flex items-center justify-center flex-shrink-0 bg-gray-50 dark:bg-gray-700">
              {imagePreview ? <img src={imagePreview} className="w-full h-full object-cover" alt="preview" /> : <span className="text-4xl">📷</span>}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('upload_image')}</p>
              <button className="btn-secondary text-sm" onClick={handlePickImage}>Choose File</button>
              {imagePreview && <button className="btn-secondary text-sm ml-2" onClick={() => { setImagePreview(null); set('image_path', ''); set('_tempImagePath', null) }}>{t('remove_image')}</button>}
              <p className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('name')} *</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('sku')}</label><input className="input" value={form.sku || ''} onChange={e => set('sku', e.target.value)} /></div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('barcode')}</label><input className="input" value={form.barcode || ''} onChange={e => set('barcode', e.target.value)} /></div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('category')}</label>
              <select className="input" value={form.category || ''} onChange={e => set('category', e.target.value)}>
                <option value="">— {t('category')} —</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('unit')}</label>
              <select className="input" value={form.unit || 'pcs'} onChange={e => set('unit', e.target.value)}>
                {units.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('supplier')}</label><input className="input" value={form.supplier || ''} onChange={e => set('supplier', e.target.value)} /></div>
            <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('description')}</label><textarea className="input resize-none" rows={2} value={form.description || ''} onChange={e => set('description', e.target.value)} /></div>
          </div>
        </div>
      )}

      {activeTab === 'pricing' && (
        <div className="space-y-5">
          {/* Purchase / Cost In Price */}
          <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 border border-red-100 dark:border-red-800">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🛒</span>
              <div>
                <p className="text-sm font-bold text-red-700 dark:text-red-400">Cost In (Purchase)</p>
                <p className="text-xs text-red-500 dark:text-red-500">What you pay the supplier when buying stock</p>
              </div>
            </div>
            <DualPriceInput
              labelUsd="Purchase Price (USD)" labelKhr="Purchase Price (KHR)"
              valueUsd={form.purchase_price_usd} valueKhr={form.purchase_price_khr}
              onUsdChange={v => { set('purchase_price_usd', v); set('cost_price_usd', v); if (!form.purchase_price_khr) set('purchase_price_khr', v * exchangeRate) }}
              onKhrChange={v => { set('purchase_price_khr', v); set('cost_price_khr', v) }}
              usdSymbol={usdSymbol} khrSymbol={khrSymbol} exchangeRate={exchangeRate} t={t}
            />
          </div>

          {/* Selling Price */}
          <div className="bg-green-50 dark:bg-green-900/10 rounded-xl p-4 border border-green-100 dark:border-green-800">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">💵</span>
              <div>
                <p className="text-sm font-bold text-green-700 dark:text-green-400">Selling Price (Price to Customer)</p>
                <p className="text-xs text-green-600 dark:text-green-500">What customers pay at point of sale</p>
              </div>
            </div>
            <DualPriceInput
              labelUsd="Selling Price (USD)" labelKhr="Selling Price (KHR)"
              valueUsd={form.selling_price_usd} valueKhr={form.selling_price_khr}
              onUsdChange={v => { set('selling_price_usd', v); if (!form.selling_price_khr) set('selling_price_khr', v * exchangeRate) }}
              onKhrChange={v => set('selling_price_khr', v)}
              usdSymbol={usdSymbol} khrSymbol={khrSymbol} exchangeRate={exchangeRate} t={t}
            />
          </div>

          {/* Margin Calculator */}
          {form.selling_price_usd > 0 && form.purchase_price_usd > 0 && (
            <MarginCard
              purchaseUsd={form.purchase_price_usd}
              sellingUsd={form.selling_price_usd}
              usdSymbol={usdSymbol}
            />
          )}
        </div>
      )}

      {activeTab === 'stock' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('stock')} ({t('quantity')})</label><input className="input" type="number" value={form.stock_quantity || 0} onChange={e => set('stock_quantity', parseFloat(e.target.value) || 0)} /></div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">⚠️ {t('low_stock_threshold')}</label>
              <input className="input" type="number" value={form.low_stock_threshold || 10} onChange={e => set('low_stock_threshold', parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">🔴 {t('out_of_stock_threshold')}</label>
              <input className="input" type="number" value={form.out_of_stock_threshold || 0} onChange={e => set('out_of_stock_threshold', parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          {/* Branch assignment — only shown when creating a new product */}
          {!product && branches && branches.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">🏪 Assign Initial Stock to Branch</label>
              <select className="input" value={form.branch_id||''} onChange={e => set('branch_id', e.target.value)}>
                <option value="">— Not assigned to a specific branch —</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}{b.is_default?' (default)':''}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">If selected, the opening stock quantity will be recorded under this branch.</p>
            </div>
          )}
          {/* Branch stock view when editing */}
          {product && branches && branches.length > 0 && (product.branch_stock||[]).length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">📦 Stock by Branch</label>
              <div className="space-y-1.5">
                {(product.branch_stock||[]).map(bs => (
                  <div key={bs.branch_id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
                    <span className="text-gray-700 dark:text-gray-300">🏪 {bs.branch_name}</span>
                    <span className={`font-bold ${bs.quantity > 0 ? 'text-green-600' : 'text-gray-400'}`}>{bs.quantity} {product.unit}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">Use Inventory → Adjust Stock to change per-branch quantities.</p>
            </div>
          )}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 text-sm text-gray-600 dark:text-gray-400">
            <p>🔴 Shows <strong>Out of Stock</strong> when stock ≤ {form.out_of_stock_threshold}</p>
            <p>⚠️ Shows <strong>Low Stock</strong> when stock ≤ {form.low_stock_threshold}</p>
            <p>✅ Shows <strong>In Stock</strong> when stock &gt; {form.low_stock_threshold}</p>
          </div>
        </div>
      )}

      {activeTab === 'custom' && (
        <div className="space-y-3">
          {customFields.length === 0 ? <p className="text-gray-400 text-sm">No custom fields defined. Go to Products → Manage Fields.</p>
          : customFields.map(cf => {
            const opts = JSON.parse(cf.options || '[]')
            const val = form.custom_fields?.[cf.name] || ''
            return (
              <div key={cf.id}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{cf.name}</label>
                {cf.field_type === 'boolean' ? (
                  <select className="input" value={val} onChange={e => setCustom(cf.name, e.target.value)}><option value="">—</option><option value="yes">{t('yes')}</option><option value="no">{t('no')}</option></select>
                ) : cf.field_type === 'dropdown' ? (
                  <select className="input" value={val} onChange={e => setCustom(cf.name, e.target.value)}><option value="">—</option>{opts.map(o => <option key={o}>{o}</option>)}</select>
                ) : cf.field_type === 'long_text' ? (
                  <textarea className="input resize-none" rows={3} value={val} onChange={e => setCustom(cf.name, e.target.value)} />
                ) : (
                  <input className="input" type={cf.field_type === 'number' || cf.field_type === 'decimal' ? 'number' : cf.field_type === 'date' ? 'date' : 'text'} value={val} onChange={e => setCustom(cf.name, e.target.value)} />
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button className="btn-primary flex-1" onClick={() => onSave(form)}>{t('save')}</button>
        <button className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
      </div>
    </Modal>
  )
}

// ─── Main Products Page ───────────────────────────────────────────────────────
export default function Products() {
  const { t, user, notify, formatPrice, fmtUSD, fmtKHR, usdSymbol, khrSymbol, exchangeRate } = useApp()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [units, setUnits] = useState([]  )
  const [customFields, setCustomFields] = useState([])
  const [branches, setBranches] = useState([])
  const [branchFilter, setBranchFilter] = useState('all')  // 'all' or branch id string
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [modal, setModal] = useState(null) // null | 'create' | 'edit' | 'cats' | 'units' | 'fields' | 'bulk'
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [prods, cats, unitList, fields, brs] = await Promise.all([window.api.getProducts(), window.api.getCategories(), window.api.getUnits(), window.api.getCustomFields(), window.api.getBranches()])
    setProducts(prods); setCategories(cats); setUnits(unitList); setCustomFields(fields)
    setBranches(brs.filter(b => b.is_active))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (form) => {
    if (!form.name) return notify(t('name') + ' required', 'error')
    const data = { ...form, userId: user.id, userName: user.name }
    let productId = selected?.id
    if (!selected) {
      const res = await window.api.createProduct(data)
      if (!res.success) return notify(t('error'), 'error')
      productId = res.id
    } else {
      await window.api.updateProduct(selected.id, data, user.id, user.name)
    }
    if (form._tempImagePath && productId) {
      const fn = form._tempImagePath.split(/[/\\]/).pop()
      await window.api.uploadProductImage({ productId, filePath: form._tempImagePath, fileName: fn })
    }
    notify(selected ? 'Product updated' : 'Product created')
    setModal(null); setSelected(null); load()
  }

  const handleDelete = async (p) => {
    if (!confirm(`${t('confirm_delete')} "${p.name}"?`)) return
    await window.api.deleteProduct(p.id, user.id, user.name)
    notify('Product deleted'); load()
  }

  const catMap = Object.fromEntries(categories.map(c => [c.name, c]))
  const searchTerms = search.trim().split(/\s+/).filter(Boolean)
  const filtered = products.filter(p => {
    const haystack = `${p.name} ${p.sku||''} ${p.barcode||''} ${p.category||''} ${p.supplier||''} ${p.description||''}`
    const matchSearch = searchTerms.length === 0 || multiMatch(haystack, searchTerms)
    const matchCat = catFilter === 'all' || p.category === catFilter
    const matchBranch = branchFilter === 'all' || (p.branch_stock||[]).some(bs => String(bs.branch_id) === branchFilter)
    return matchSearch && matchCat && matchBranch
  })

  // Helper: get qty for a specific branch
  const getBranchQty = (p, branchId) => {
    const bs = (p.branch_stock||[]).find(s => String(s.branch_id) === String(branchId))
    return bs?.quantity ?? 0
  }

  const getStockBadge = (p) => {
    const qty = branchFilter !== 'all' ? getBranchQty(p, branchFilter) : p.stock_quantity
    if (qty <= (p.out_of_stock_threshold || 0)) return <span className="badge-red">{t('out_of_stock')}</span>
    if (qty <= (p.low_stock_threshold || 10))  return <span className="badge-yellow">{t('low_stock')}</span>
    return <span className="badge-green">{t('in_stock')}</span>
  }

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📦 {t('products')}</h1>
        <div className="flex gap-2">
          <button onClick={() => setModal('fields')} className="btn-secondary text-sm">🧩 {t('manage_fields')}</button>
          <button onClick={() => setModal('units')} className="btn-secondary text-sm">📏 {t('units')}</button>
          <button onClick={() => setModal('cats')} className="btn-secondary text-sm">🏷 {t('categories')}</button>
          <button onClick={() => setModal('bulk')} className="btn-secondary text-sm">📥 {t('bulk_import')}</button>
          <button onClick={() => { setSelected(null); setModal('form') }} className="btn-primary text-sm">+ {t('add_product')}</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-2 flex-wrap items-center">
        <input className="input max-w-xs" placeholder={t('search') + '...'} value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setCatFilter('all')} className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${catFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{t('all')}</button>
          {categories.map(c => (
            <button key={c.id} onClick={() => setCatFilter(catFilter === c.name ? 'all' : c.name)} className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${catFilter === c.name ? 'text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`} style={catFilter === c.name ? { background: c.color } : {}}>{c.name}</button>
          ))}
        </div>
      </div>
      {/* Branch filter */}
      {branches.length > 1 && (
        <div className="flex gap-1 flex-wrap mb-3 items-center">
          <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">🏪 Branch:</span>
          <button onClick={() => setBranchFilter('all')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${branchFilter==='all' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>All</button>
          {branches.map(b => (
            <button key={b.id} onClick={() => setBranchFilter(branchFilter===String(b.id)?'all':String(b.id))} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${branchFilter===String(b.id) ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{b.name}</button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="card flex-1 overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold w-12">Img</th>
                <th className="text-left px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('product_name')}</th>
                <th className="text-left px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('sku')}</th>
                <th className="text-left px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('category')}</th>
                <th className="text-right px-3 py-3 text-red-600 dark:text-red-400 font-semibold">🛒 Cost In (Purchase)</th>
                <th className="text-right px-3 py-3 text-green-600 dark:text-green-400 font-semibold">💵 Selling Price</th>
                <th className="text-right px-3 py-3 text-blue-600 dark:text-blue-400 font-semibold">📊 Margin</th>
                <th className="text-right px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('stock')}</th>
                <th className="text-center px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('status')}</th>
                <th className="text-center px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={10} className="text-center py-10 text-gray-400">{t('loading')}</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={10} className="text-center py-10 text-gray-400">{t('no_data')}</td></tr>
              : filtered.map(p => {
                const purchaseUsd = p.purchase_price_usd || p.cost_price_usd || 0
                const purchaseKhr = p.purchase_price_khr || p.cost_price_khr || 0
                const marginUsd = p.selling_price_usd - purchaseUsd
                const marginPct = purchaseUsd > 0 ? (marginUsd / p.selling_price_usd * 100) : 0
                return (
                <tr key={p.id} className="table-row">
                  <td className="px-3 py-2">
                    {p.image_path ? <img src={`file://${p.image_path}`} alt={p.name} className="w-10 h-10 rounded-lg object-cover cursor-pointer" onClick={() => window.api.openPath(p.image_path)} />
                    : <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400 text-xl">📦</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 dark:text-white">{p.name}</div>
                    {p.supplier && <div className="text-xs text-gray-400 truncate max-w-32">{p.supplier}</div>}
                  </td>
                  <td className="px-3 py-2 text-gray-400 font-mono text-xs">{p.sku || '—'}</td>
                  <td className="px-3 py-2">
                    {p.category ? (
                      <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{ background: catMap[p.category]?.color || '#6b7280' }}>{p.category}</span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="font-medium text-red-700 dark:text-red-400">{fmtUSD(purchaseUsd)}</div>
                    {purchaseKhr > 0 && <div className="text-xs text-gray-400">{fmtKHR(purchaseKhr)}</div>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="font-semibold text-green-700 dark:text-green-400">{fmtUSD(p.selling_price_usd)}</div>
                    {p.selling_price_khr > 0 && <div className="text-xs text-gray-400">{fmtKHR(p.selling_price_khr)}</div>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {purchaseUsd > 0 && p.selling_price_usd > 0 ? (
                      <div>
                        <div className={`font-medium text-xs ${marginUsd >= 0 ? 'text-blue-600' : 'text-yellow-600'}`}>{fmtUSD(marginUsd)}</div>
                        <div className="text-xs text-gray-400">{marginPct.toFixed(1)}%</div>
                      </div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="font-bold text-gray-900 dark:text-white">
                      {branchFilter !== 'all' ? getBranchQty(p, branchFilter) : p.stock_quantity}
                      <span className="text-xs font-normal text-gray-400 ml-1">{p.unit}</span>
                    </div>
                    {/* Branch breakdown shown when viewing all or searching */}
                    {branches.length > 1 && (
                      <div className="mt-0.5 flex flex-wrap gap-x-2 justify-end">
                        {(p.branch_stock||[]).filter(bs=>bs.quantity>0).map(bs => (
                          <span key={bs.branch_id} className="text-xs text-gray-400 whitespace-nowrap">
                            <span className={branchFilter===String(bs.branch_id) ? 'font-bold text-blue-600' : ''}>{bs.branch_name}</span>: {bs.quantity}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">{getStockBadge(p)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => { setSelected(p); setModal('form') }} className="text-blue-500 hover:text-blue-700 text-xs px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20">{t('edit')}</button>
                      <button onClick={() => handleDelete(p)} className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20">{t('delete')}</button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">{filtered.length} {t('products')}</div>
      </div>

      {modal === 'form' && <ProductForm product={selected} categories={categories} units={units} customFields={customFields} branches={branches} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} usdSymbol={usdSymbol} khrSymbol={khrSymbol} exchangeRate={exchangeRate} />}
      {modal === 'cats' && <ManageCategoriesModal onClose={() => { setModal(null); load() }} t={t} />}
      {modal === 'units' && <ManageUnitsModal onClose={() => { setModal(null); load() }} t={t} />}
      {modal === 'fields' && <ManageFieldsModal onClose={() => { setModal(null); load() }} t={t} onChanged={load} />}
      {modal === 'bulk' && <BulkImportModal onClose={() => setModal(null)} onDone={load} t={t} exchangeRate={exchangeRate} />}
    </div>
  )
}
