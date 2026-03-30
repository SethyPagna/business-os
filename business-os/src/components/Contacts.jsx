import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../AppContext'

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl ${wide ? 'w-full max-w-3xl' : 'w-full max-w-lg'} max-h-[90vh] flex flex-col fade-in`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">×</button>
        </div>
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  )
}

// ─── Customer Form Modal ──────────────────────────────────────────────────────
function CustomerForm({ customer, onSave, onClose, t }) {
  const init = customer ? { ...customer } : { name: '', phone: '', email: '', address: '', company: '', notes: '' }
  const [form, setForm] = useState(init)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal title={customer ? `✏️ ${t('edit_customer')}` : `➕ ${t('add_customer')}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Customer name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
            <input className="input" value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="012 345 678" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input className="input" type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} placeholder="customer@email.com" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company</label>
            <input className="input" value={form.company || ''} onChange={e => set('company', e.target.value)} placeholder="Company name" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address</label>
            <input className="input" value={form.address || ''} onChange={e => set('address', e.target.value)} placeholder="Street, City" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea className="input resize-none" rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Additional notes..." />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button className="btn-primary flex-1" onClick={() => onSave(form)}>{t('save')}</button>
          <button className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Supplier Form Modal ──────────────────────────────────────────────────────
function SupplierForm({ supplier, onSave, onClose, t }) {
  const init = supplier ? { ...supplier } : { name: '', phone: '', email: '', address: '', company: '', contact_person: '', notes: '' }
  const [form, setForm] = useState(init)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal title={supplier ? `✏️ ${t('edit_supplier')}` : `➕ ${t('add_supplier')}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Supplier name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
            <input className="input" value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="012 345 678" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input className="input" type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} placeholder="supplier@email.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company</label>
            <input className="input" value={form.company || ''} onChange={e => set('company', e.target.value)} placeholder="Company name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('contact_person')}</label>
            <input className="input" value={form.contact_person || ''} onChange={e => set('contact_person', e.target.value)} placeholder="Primary contact" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address</label>
            <input className="input" value={form.address || ''} onChange={e => set('address', e.target.value)} placeholder="Street, City" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea className="input resize-none" rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Additional notes..." />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button className="btn-primary flex-1" onClick={() => onSave(form)}>{t('save')}</button>
          <button className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Import Modal (shared for customers and suppliers) ────────────────────────
function ImportModal({ type, onClose, onDone }) {
  const [step, setStep] = useState(1)
  const [csvData, setCsvData] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const isCustomer = type === 'customer'

  const handleDownload = () => isCustomer ? window.api.downloadCustomerTemplate() : window.api.downloadSupplierTemplate()
  const handlePickCSV = async () => {
    const res = await window.api.openCSVDialog()
    if (res) { setCsvData(res); setStep(2) }
  }
  const handleImport = async () => {
    if (!csvData) return
    setLoading(true)
    const fn = isCustomer ? window.api.bulkImportCustomers : window.api.bulkImportSuppliers
    const res = await fn({ csvText: csvData.content })
    setResult(res); setStep(3); setLoading(false)
    if (res.imported > 0) onDone()
  }

  const columns = isCustomer
    ? 'name, phone, email, address, company, notes'
    : 'name, phone, email, address, company, contact_person, notes'

  return (
    <Modal title={`📥 Import ${isCustomer ? 'Customers' : 'Suppliers'}`} onClose={onClose}>
      <div className="flex gap-2 mb-6">
        {[1,2,3].map(s => <div key={s} className={`flex-1 h-1.5 rounded-full ${step >= s ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`} />)}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300">
            <p className="font-semibold mb-2">📋 How to import:</p>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>Download the CSV template below</li>
              <li>Fill in your {isCustomer ? 'customer' : 'supplier'} data (one per row)</li>
              <li>Upload the filled CSV here</li>
            </ol>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">CSV Columns:</p>
            <p className="text-xs text-gray-500 font-mono leading-relaxed">{columns}</p>
          </div>
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={handleDownload}>⬇ Download Template</button>
            <button className="btn-primary flex-1" onClick={handlePickCSV}>📂 Upload CSV</button>
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
          <div className="flex gap-3 pt-2">
            <button className="btn-secondary" onClick={() => { setCsvData(null); setStep(1) }}>← Back</button>
            <button className="btn-primary flex-1" onClick={handleImport} disabled={loading}>
              {loading ? 'Importing...' : `🚀 Import ${isCustomer ? 'Customers' : 'Suppliers'}`}
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="space-y-4">
          <div className={`rounded-xl p-4 ${result.imported > 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
            <p className="font-bold text-lg">{result.imported > 0 ? '🎉' : '⚠️'} Imported: {result.imported} records</p>
          </div>
          {result.errors?.length > 0 && (
            <div>
              <p className="text-sm font-medium text-red-600 mb-2">⚠ Errors ({result.errors.length}):</p>
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

// ─── Customers Tab ────────────────────────────────────────────────────────────
function CustomersTab({ t, notify }) {
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null) // null | 'form' | 'import'
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const data = await window.api.getCustomers()
    setCustomers(data); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const handleSave = async (form) => {
    if (!form.name.trim()) return notify(t('name_required'), 'error')
    if (selected) await window.api.updateCustomer(selected.id, form)
    else await window.api.createCustomer(form)
    notify(t(selected ? 'customer_updated' : 'customer_added'))
    setModal(null); setSelected(null); load()
  }

  const handleDelete = async (c) => {
    if (!confirm(`Delete customer "${c.name}"?`)) return
    await window.api.deleteCustomer(c.id)
    notify(t('customer_deleted')); load()
  }

  const filtered = customers.filter(c => {
    const q = search.toLowerCase()
    return !q || c.name.toLowerCase().includes(q) || (c.phone||'').includes(q) || (c.email||'').toLowerCase().includes(q) || (c.company||'').toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2 items-center">
          <input className="input max-w-xs" placeholder={`${t('search')} ${t('customers')}...`} value={search} onChange={e => setSearch(e.target.value)} />
          <span className="text-sm text-gray-400">{filtered.length} {t('customers')}</span>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-sm" onClick={() => setModal('import')}>📥 {t('import_csv')}</button>
          <button className="btn-primary text-sm" onClick={() => { setSelected(null); setModal('form') }}>+ {t('add_customer')}</button>
        </div>
      </div>

      <div className="card flex-1 overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('name')}</th>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('phone')}</th>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('email')}</th>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('company')}</th>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('address')}</th>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('notes')}</th>
                <th className="text-center px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? <tr><td colSpan={7} className="text-center py-10 text-gray-400">{t('loading')}</td></tr>
                : filtered.length === 0
                  ? <tr><td colSpan={7} className="text-center py-10 text-gray-400">{t('no_customers')}</td></tr>
                  : filtered.map(c => (
                    <tr key={c.id} className="table-row">
                      <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{c.name}</td>
                      <td className="px-4 py-2 text-gray-500">{c.phone || '—'}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">{c.email || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{c.company || '—'}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs max-w-40 truncate">{c.address || '—'}</td>
                      <td className="px-4 py-2 text-gray-400 text-xs max-w-32 truncate">{c.notes || '—'}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => { setSelected(c); setModal('form') }} className="text-blue-500 hover:text-blue-700 text-xs px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20">Edit</button>
                          <button onClick={() => handleDelete(c)} className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {modal === 'form' && <CustomerForm customer={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} />}
      {modal === 'import' && <ImportModal type="customer" onClose={() => setModal(null)} onDone={load} />}
    </div>
  )
}

// ─── Suppliers Tab ────────────────────────────────────────────────────────────
function SuppliersTab({ t, notify }) {
  const [suppliers, setSuppliers] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const data = await window.api.getSuppliers()
    setSuppliers(data); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const handleSave = async (form) => {
    if (!form.name.trim()) return notify('Name is required', 'error')
    if (selected) await window.api.updateSupplier(selected.id, form)
    else await window.api.createSupplier(form)
    notify(t(selected ? 'supplier_updated' : 'supplier_added'))
    setModal(null); setSelected(null); load()
  }

  const handleDelete = async (s) => {
    if (!confirm(`Delete supplier "${s.name}"?`)) return
    await window.api.deleteSupplier(s.id)
    notify(t('supplier_deleted')); load()
  }

  const filtered = suppliers.filter(s => {
    const q = search.toLowerCase()
    return !q || s.name.toLowerCase().includes(q) || (s.phone||'').includes(q) || (s.email||'').toLowerCase().includes(q) || (s.company||'').toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2 items-center">
          <input className="input max-w-xs" placeholder={`${t('search')} ${t('suppliers')}...`} value={search} onChange={e => setSearch(e.target.value)} />
          <span className="text-sm text-gray-400">{filtered.length} {t('suppliers')}</span>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-sm" onClick={() => setModal('import')}>📥 Import CSV</button>
          <button className="btn-primary text-sm" onClick={() => { setSelected(null); setModal('form') }}>+ {t('add_supplier', 'Add Supplier')}</button>
        </div>
      </div>

      <div className="card flex-1 overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('name')}</th>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('phone')}</th>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('email')}</th>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('company')}</th>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('contact_person')}</th>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('address')}</th>
                <th className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('notes')}</th>
                <th className="text-center px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? <tr><td colSpan={8} className="text-center py-10 text-gray-400">{t('loading')}</td></tr>
                : filtered.length === 0
                  ? <tr><td colSpan={8} className="text-center py-10 text-gray-400">{t('no_suppliers')}</td></tr>
                  : filtered.map(s => (
                    <tr key={s.id} className="table-row">
                      <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{s.name}</td>
                      <td className="px-4 py-2 text-gray-500">{s.phone || '—'}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">{s.email || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{s.company || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{s.contact_person || '—'}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs max-w-40 truncate">{s.address || '—'}</td>
                      <td className="px-4 py-2 text-gray-400 text-xs max-w-32 truncate">{s.notes || '—'}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => { setSelected(s); setModal('form') }} className="text-blue-500 hover:text-blue-700 text-xs px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20">Edit</button>
                          <button onClick={() => handleDelete(s)} className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {modal === 'form' && <SupplierForm supplier={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} />}
      {modal === 'import' && <ImportModal type="supplier" onClose={() => setModal(null)} onDone={load} />}
    </div>
  )
}

// ─── Main Contacts Page ───────────────────────────────────────────────────────
export default function Contacts() {
  const { t, notify } = useApp()
  const [tab, setTab] = useState('customers')

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">👥 {t('contacts')}</h1>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setTab('customers')}
          className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'customers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          🧑‍💼 {t('customers')}
        </button>
        <button
          onClick={() => setTab('suppliers')}
          className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'suppliers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          🏭 {t('suppliers')}
        </button>
      </div>

      {tab === 'customers' && <CustomersTab t={t} notify={notify} />}
      {tab === 'suppliers' && <SuppliersTab t={t} notify={notify} />}
    </div>
  )
}
