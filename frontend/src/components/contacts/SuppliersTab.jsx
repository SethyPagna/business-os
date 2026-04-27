import { useState, useEffect, useCallback } from 'react'
import { Download, Plus, Upload } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import { downloadCSV } from '../../utils/csv'
import { fmtDate } from '../../utils/formatters'
import Modal from '../shared/Modal'
import { ThreeDotMenu, DetailModal, ImportModal, ContactTable, useContactSelection } from './shared'

function SupplierForm({ supplier, onSave, onClose, t }) {
  const init = supplier
    ? { ...supplier }
    : { name: '', phone: '', email: '', company: '', contact_person: '', address: '', notes: '' }
  const [form, setForm] = useState(init)
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  return (
    <Modal title={supplier ? `✏️ ${t('edit_supplier') || 'Edit Supplier'}` : `➕ ${t('add_supplier') || 'Add Supplier'}`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('name')} *</label>
          <input className="input" value={form.name} onChange={(event) => set('name', event.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('phone')}</label>
            <input className="input" value={form.phone || ''} onChange={(event) => set('phone', event.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('email')}</label>
            <input className="input" type="email" value={form.email || ''} onChange={(event) => set('email', event.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('company')}</label>
            <input className="input" value={form.company || ''} onChange={(event) => set('company', event.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('contact_person') || 'Contact Person'}</label>
            <input className="input" value={form.contact_person || ''} onChange={(event) => set('contact_person', event.target.value)} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('address')}</label>
          <input className="input" value={form.address || ''} onChange={(event) => set('address', event.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('notes') || 'Notes'}</label>
          <textarea className="input resize-none" rows={2} value={form.notes || ''} onChange={(event) => set('notes', event.target.value)} />
        </div>
        <div className="flex gap-3 pt-1">
          <button className="btn-primary flex-1" onClick={() => onSave(form)}>{t('save')}</button>
          <button className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

function SuppliersTab({ t, notify }) {
  const { user } = useApp()
  const { syncChannel } = useSync()
  const [suppliers, setSuppliers] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const filtered = suppliers.filter((supplier) => {
    const query = search.toLowerCase().trim()
    if (!query) return true
    return (
      String(supplier.name || '').toLowerCase().includes(query)
      || String(supplier.phone || '').includes(query)
      || String(supplier.email || '').toLowerCase().includes(query)
      || String(supplier.company || '').toLowerCase().includes(query)
      || String(supplier.contact_person || '').toLowerCase().includes(query)
    )
  })

  const { selectedIds, toggleOne, clearSelection, selectAllProp } = useContactSelection(filtered)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.api.getSuppliers()
      setSuppliers(Array.isArray(data) ? data : [])
    } catch (error) {
      setSuppliers([])
      notify(error?.message || 'Failed to load suppliers', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (syncChannel?.channel === 'suppliers') load()
  }, [syncChannel, load])

  const handleSave = async (form) => {
    if (!String(form.name || '').trim()) return notify(t('name_required') || 'Name required', 'error')
    try {
      const payload = { ...form, userId: user?.id, userName: user?.name }
      const result = selected
        ? await window.api.updateSupplier(selected.id, payload)
        : await window.api.createSupplier(payload)
      if (result?.success === false) {
        notify(result.error || 'Failed', 'error')
        return
      }
      notify(selected ? (t('supplier_updated') || 'Updated') : (t('supplier_added') || 'Added'))
      setModal(null)
      setSelected(null)
      load()
    } catch (error) {
      notify(error?.message || 'Failed', 'error')
    }
  }

  const handleDelete = async (supplier) => {
    if (!confirm(`Delete supplier "${supplier.name}"?`)) return
    try {
      await window.api.deleteSupplier(supplier.id)
      notify(t('supplier_deleted') || 'Deleted')
      setModal(null)
      setSelected(null)
      load()
    } catch (error) {
      notify(error?.message || 'Failed', 'error')
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return
    if (!confirm(`Delete ${selectedIds.size} supplier(s)?`)) return
    for (const id of selectedIds) {
      try { await window.api.deleteSupplier(id) } catch (_) {}
    }
    clearSelection()
    load()
    notify(`${selectedIds.size} ${t('deleted') || 'deleted'}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex flex-1 min-w-0 items-center gap-2">
          <input
            className="input flex-1 min-w-0 max-w-xs"
            placeholder={t('search_suppliers_placeholder') || `${t('search') || 'Search'} suppliers`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="whitespace-nowrap text-sm text-gray-400">{filtered.length}</span>
        </div>
        <div className="flex flex-shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto">
          {selectedIds.size > 0 ? (
            <button className="btn-secondary whitespace-nowrap text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={handleBulkDelete}>
              Delete {selectedIds.size}
            </button>
          ) : null}
          <button className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap text-sm" onClick={() => setModal('import')} title={t('import_contacts') || 'Import'}>
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">{t('import_contacts') || 'Import'}</span>
          </button>
          <button
            className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap text-sm"
            onClick={() => {
              const rows = filtered.map((supplier) => ({
                Name: supplier.name || '',
                Phone: supplier.phone || '',
                Email: supplier.email || '',
                Company: supplier.company || '',
                ContactPerson: supplier.contact_person || '',
                Address: supplier.address || '',
                Notes: supplier.notes || '',
                Created: supplier.created_at || '',
              }))
              downloadCSV(`suppliers-${new Date().toISOString().slice(0, 10)}.csv`, rows)
            }}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button className="btn-primary inline-flex items-center gap-1.5 whitespace-nowrap text-sm" onClick={() => { setSelected(null); setModal('form') }} title={t('add_supplier') || 'Add Supplier'}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('add_supplier') || 'Add Supplier'}</span>
          </button>
        </div>
      </div>

      <ContactTable
        loading={loading}
        rows={filtered}
        emptyLabel={t('no_suppliers') || 'No suppliers'}
        columns={[t('name'), t('phone'), t('email'), t('company'), t('contact_person') || 'Contact']}
        selectAll={selectAllProp}
        selectedCount={selectedIds.size}
        totalCount={filtered.length}
        t={t}
        renderRow={(supplier) => (
          <tr key={supplier.id} className={`table-row cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedIds.has(supplier.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
            <td className="w-10 px-3 py-2" onClick={(event) => event.stopPropagation()}>
              <input type="checkbox" className="h-4 w-4 cursor-pointer rounded" checked={selectedIds.has(supplier.id)} onChange={() => toggleOne(supplier.id)} />
            </td>
            <td className="cursor-pointer px-4 py-2 font-medium text-gray-900 dark:text-white" onClick={() => { setSelected(supplier); setModal('detail') }}>{supplier.name}</td>
            <td className="cursor-pointer px-4 py-2 text-gray-500" onClick={() => { setSelected(supplier); setModal('detail') }}>{supplier.phone || '--'}</td>
            <td className="cursor-pointer px-4 py-2 text-xs text-gray-500" onClick={() => { setSelected(supplier); setModal('detail') }}>{supplier.email || '--'}</td>
            <td className="cursor-pointer px-4 py-2 text-gray-500" onClick={() => { setSelected(supplier); setModal('detail') }}>{supplier.company || '--'}</td>
            <td className="cursor-pointer px-4 py-2 text-gray-500" onClick={() => { setSelected(supplier); setModal('detail') }}>{supplier.contact_person || '--'}</td>
            <td className="px-2 py-2 text-right" onClick={(event) => event.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(supplier); setModal('detail') }} onEdit={() => { setSelected(supplier); setModal('form') }} onDelete={() => handleDelete(supplier)} />
            </td>
          </tr>
        )}
        renderCard={(supplier) => (
          <div key={supplier.id} className={`card flex items-center gap-3 p-3 ${selectedIds.has(supplier.id) ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20' : ''}`}>
            <div className="flex-shrink-0" onClick={(event) => { event.stopPropagation(); toggleOne(supplier.id) }}>
              <input type="checkbox" className="h-5 w-5 cursor-pointer rounded" checked={selectedIds.has(supplier.id)} onChange={() => toggleOne(supplier.id)} />
            </div>
            <div className="h-9 w-9 flex-shrink-0 rounded-full bg-orange-100 text-center text-sm font-bold leading-9 text-orange-600 dark:bg-orange-900/40">
              {supplier.name?.[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 cursor-pointer" onClick={() => { setSelected(supplier); setModal('detail') }}>
              <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{supplier.name}</div>
              {supplier.phone ? <div className="text-xs text-gray-500">{supplier.phone}</div> : null}
              {supplier.company ? <div className="truncate text-xs text-gray-400">{supplier.company}</div> : null}
            </div>
            <div onClick={(event) => event.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(supplier); setModal('detail') }} onEdit={() => { setSelected(supplier); setModal('form') }} onDelete={() => handleDelete(supplier)} />
            </div>
          </div>
        )}
      />

      {modal === 'form' ? <SupplierForm supplier={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} /> : null}
      {modal === 'import' ? <ImportModal type="supplier" onClose={() => setModal(null)} onDone={load} /> : null}
      {modal === 'detail' && selected ? (
        <DetailModal
          item={selected}
          fields={[
            [t('name'), selected.name],
            [t('phone'), selected.phone],
            [t('email'), selected.email],
            [t('company'), selected.company],
            [t('contact_person') || 'Contact', selected.contact_person],
            [t('address'), selected.address],
            [t('notes'), selected.notes],
            [t('col_added') || t('added_on') || 'Added', fmtDate(selected.created_at)],
          ]}
          onEdit={() => setModal('form')}
          onDelete={() => handleDelete(selected)}
          onClose={() => { setModal(null); setSelected(null) }}
          t={t}
        />
      ) : null}
    </div>
  )
}

export { SupplierForm, SuppliersTab }
