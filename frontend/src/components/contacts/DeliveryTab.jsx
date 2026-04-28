// ?? DeliveryTab ???????????????????????????????????????????????????????????????
import { useState, useEffect, useCallback } from 'react'
import { Download, Plus, Upload } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import { downloadCSV } from '../../utils/csv'
import { fmtDate } from '../../utils/formatters'
import Modal from '../shared/Modal'
import { ThreeDotMenu, DetailModal, ImportModal, ContactTable, useContactSelection } from './shared'
import { withLoaderTimeout } from '../../utils/loaders.mjs'

// ?? Options helpers ????????????????????????????????????????????????????????????
// Options stored as JSON array in the 'address' TEXT column.
// Each option: { label, name, phone, area }
// Backward-compatible: old plain strings migrated to a single option.

export function parseDeliveryOptions(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return []
      if (typeof parsed[0] === 'object' && parsed[0] !== null) return parsed.filter(Boolean)
      return parsed.filter(Boolean).map((a, i) => ({
        label: i === 0 ? 'Default' : `Option ${i + 1}`, name: '', phone: '', area: String(a),
      }))
    }
  } catch {}
  return raw ? [{ label: 'Default', name: '', phone: '', area: raw }] : []
}

export function serializeDeliveryOptions(opts) {
  const clean = opts.filter(o =>
    (o.label||'').trim() || (o.name||'').trim() || (o.phone||'').trim() || (o.area||'').trim()
  )
  return clean.length ? JSON.stringify(clean) : null
}

const BLANK_OPTION = () => ({ label: '', name: '', phone: '', area: '' })

// ?? OptionEditor ???????????????????????????????????????????????????????????????
function OptionEditor({ option, index, total, onChange, onRemove }) {
  const set = (k, v) => onChange({ ...option, [k]: v })
  const fieldId = (field) => `delivery-option-${index}-${field}`
  return (
    <div className="border border-gray-200 dark:border-zinc-600 rounded-xl p-3 space-y-2 bg-gray-50 dark:bg-zinc-800/60">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-gray-400 w-5 flex-shrink-0">#{index + 1}</span>
        <label htmlFor={fieldId('label')} className="sr-only">Delivery option label</label>
        <input
          id={fieldId('label')}
          name={fieldId('label')}
          className="input text-xs py-1 flex-1"
          placeholder="Label (e.g. Morning Shift, Zone A)"
          value={option.label}
          onChange={e => set('label', e.target.value)}
        />
        {total > 1 && (
          <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs px-1.5 py-1 rounded flex-shrink-0">x</button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={fieldId('name')} className="block text-xs text-gray-400 mb-0.5">Name</label>
          <input id={fieldId('name')} name={fieldId('name')} className="input text-xs py-1" placeholder="Driver / rider name" value={option.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label htmlFor={fieldId('phone')} className="block text-xs text-gray-400 mb-0.5">Phone</label>
          <input id={fieldId('phone')} name={fieldId('phone')} className="input text-xs py-1" placeholder="Phone number" value={option.phone} onChange={e => set('phone', e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor={fieldId('area')} className="block text-xs text-gray-400 mb-0.5">Area / Zone</label>
        <input id={fieldId('area')} name={fieldId('area')} className="input text-xs py-1" placeholder="Coverage area or zone" value={option.area} onChange={e => set('area', e.target.value)} />
      </div>
    </div>
  )
}

// ?? DeliveryForm ???????????????????????????????????????????????????????????????
function DeliveryForm({ contact, onSave, onClose, t }) {
  const init = contact ? { ...contact } : { name: '', phone: '', area: '', notes: '' }
  const [form, setForm] = useState(init)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await Promise.resolve(onSave({ ...form }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={contact ? `Edit Delivery Contact` : `Add Delivery Contact`}
      onClose={onClose}
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="delivery-form-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('name')} <span className="text-xs font-normal text-gray-400">(driver / rider)</span>
          </label>
          <input id="delivery-form-name" name="delivery_name" className="input" value={form.name} onChange={e => set('name', e.target.value)} autoFocus placeholder="Driver name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="delivery-form-phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('phone')} <span className="text-xs font-normal text-gray-400">(optional)</span></label>
            <input id="delivery-form-phone" name="delivery_phone" className="input" value={form.phone||''} onChange={e => set('phone', e.target.value)} placeholder="+855..." />
          </div>
          <div>
            <label htmlFor="delivery-form-area" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('area_zone')||'Area / Zone'}</label>
            <input id="delivery-form-area" name="delivery_area" className="input" value={form.area||''} onChange={e => set('area', e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="delivery-form-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('notes')||'Notes'}</label>
          <textarea id="delivery-form-notes" name="delivery_notes" className="input resize-none" rows={2} value={form.notes||''} onChange={e => set('notes', e.target.value)} />
        </div>
        <p className="text-xs text-gray-400">Provide driver name or phone number.</p>

        <div className="flex gap-3 pt-1">
          <button type="button" className="btn-primary flex-1" onClick={handleSave} disabled={saving}>{saving ? (t('saving') || 'Saving...') : t('save')}</button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

// ?? OptionsDisplay (detail view) ???????????????????????????????????????????????
function OptionsDisplay({ raw }) {
  const opts = parseDeliveryOptions(raw)
  if (!opts.length) return <span className="text-gray-400">-</span>
  return (
    <div className="space-y-1.5">
      {opts.map((o, i) => (
        <div key={i} className="text-xs bg-gray-50 dark:bg-zinc-800 rounded-lg p-2 space-y-0.5">
          {o.label && <div className="font-semibold text-gray-700 dark:text-gray-200">{o.label}</div>}
          {o.name  && <div className="text-gray-600 dark:text-gray-300">Name: {o.name}</div>}
          {o.phone && <div className="text-gray-500">Phone: {o.phone}</div>}
          {o.area  && <div className="text-gray-500">Zone: {o.area}</div>}
        </div>
      ))}
    </div>
  )
}

function OptionsBadge({ raw }) {
  const count = parseDeliveryOptions(raw).length
  if (!count) return null
  return (
    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
      {count}
    </span>
  )
}

// ?? DeliveryTab ????????????????????????????????????????????????????????????????
function DeliveryTab({ t, notify }) {
  const { user } = useApp()
  const { syncChannel } = useSync()
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }
  const [contacts, setContacts] = useState([])
  const [search,   setSearch]   = useState('')
  const [modal,    setModal]    = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading,  setLoading]  = useState(true)

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase()
    return !q || c.name.toLowerCase().includes(q) || (c.phone||'').includes(q) || (c.area||'').toLowerCase().includes(q)
  })

  const { selectedIds, toggleOne, clearSelection, selectAllProp } = useContactSelection(filtered)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await withLoaderTimeout(() => window.api.getDeliveryContacts(), 'Delivery contacts')
      setContacts(Array.isArray(data) ? data : [])
    } catch (error) {
      setContacts([])
      notify(error?.message || 'Failed to load delivery contacts', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (syncChannel?.channel === 'deliveryContacts') load() }, [syncChannel]) // eslint-disable-line

  const handleSave = async (form) => {
    if (!String(form.name || '').trim() && !String(form.phone || '').trim()) {
      return notify('Driver name or phone is required', 'error')
    }
    try {
      const payload = { ...form, userId: user?.id, userName: user?.name }
      const res = selected
        ? await window.api.updateDeliveryContact(selected.id, payload)
        : await window.api.createDeliveryContact(payload)
      if (res?.success === false) { notify(res.error||'Failed', 'error'); return }
      notify(selected ? (t('delivery_contact_updated')||'Updated') : (t('delivery_contact_added')||'Added'))
      setModal(null); setSelected(null); load()
    } catch (e) { notify(e.message||'Failed', 'error') }
  }

  const handleDelete = async (c) => {
    if (!confirm(`Delete "${c.name}"?`)) return
    try { await window.api.deleteDeliveryContact(c.id); notify(t('delivery_contact_deleted')||'Deleted'); setModal(null); setSelected(null); load() }
    catch (e) { notify(e.message||'Failed', 'error') }
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return
    if (!confirm(`Delete ${selectedIds.size} delivery contact(s)?`)) return
    for (const id of selectedIds) { try { await window.api.deleteDeliveryContact(id) } catch {} }
    clearSelection(); load()
    notify(`${selectedIds.size} ${t('deleted')||'deleted'}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex gap-2 items-center flex-1 min-w-0">
          <label htmlFor="delivery-search" className="sr-only">{t('search_delivery_placeholder')||'Search delivery contacts'}</label>
          <input id="delivery-search" name="delivery_search" className="input flex-1 min-w-0 max-w-xs"
            placeholder={t('search_delivery_placeholder')||`Search...`}
            value={search} onChange={e => setSearch(e.target.value)} />
          <span className="text-sm text-gray-400 whitespace-nowrap">{filtered.length}</span>
        </div>
        <div className="flex gap-1.5 items-center overflow-x-auto flex-nowrap flex-shrink-0">
          {selectedIds.size > 0 && (
            <button className="btn-secondary text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 whitespace-nowrap" onClick={handleBulkDelete}>
              Delete {selectedIds.size}
            </button>
          )}
          <button className="btn-secondary inline-flex items-center gap-1.5 text-sm whitespace-nowrap" onClick={() => setModal('import')} title={tr('import_contacts', 'Import', 'នាំចូល')}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{tr('import_contacts', 'Import', 'នាំចូល')}</span>
          </button>
          <button className="btn-secondary inline-flex items-center gap-1.5 text-sm whitespace-nowrap" onClick={() => {
            const rows = filtered.map(c => ({ Name: c.name||'', Phone: c.phone||'', Area: c.area||'', Notes: c.notes||'', Created: c.created_at||'' }))
            downloadCSV(`delivery-contacts-${new Date().toISOString().slice(0,10)}.csv`, rows)
          }} title={tr('export', 'Export', 'នាំចេញ')}>
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">{tr('export', 'Export', 'នាំចេញ')}</span>
          </button>
          <button className="btn-primary inline-flex items-center gap-1.5 text-sm whitespace-nowrap" onClick={() => { setSelected(null); setModal('form') }} title={tr('add_delivery_contact', 'Add Delivery', 'បន្ថែមអ្នកដឹកជញ្ជូន')}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{tr('add_delivery_contact', 'Add Delivery', 'បន្ថែមអ្នកដឹកជញ្ជូន')}</span>
          </button>
        </div>
      </div>

      <ContactTable
        loading={loading}
        rows={filtered}
        emptyLabel={t('no_delivery_contacts')||'No delivery contacts'}
        columns={[t('name'), t('phone'), t('area_zone')||'Area / Zone']}
        selectAll={selectAllProp}
        selectedCount={selectedIds.size}
        totalCount={filtered.length}
        t={t}
        renderRow={c => (
          <tr key={c.id} className={`table-row cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedIds.has(c.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
            <td className="px-3 py-2 w-10" onClick={e => e.stopPropagation()}>
              <label htmlFor={`delivery-select-${c.id}`} className="sr-only">{`Select ${c.name}`}</label>
              <input id={`delivery-select-${c.id}`} name={`delivery_select_${c.id}`} type="checkbox" className="w-4 h-4 cursor-pointer rounded" checked={selectedIds.has(c.id)} onChange={() => toggleOne(c.id)} />
            </td>
            <td className="px-4 py-2 font-medium text-gray-900 dark:text-white cursor-pointer" onClick={() => { setSelected(c); setModal('detail') }}>{c.name}</td>
            <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => { setSelected(c); setModal('detail') }}>{c.phone||'-'}</td>
            <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => { setSelected(c); setModal('detail') }}>{c.area||'-'}</td>
            <td className="px-2 py-2 text-right" onClick={e => e.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(c); setModal('detail') }} onEdit={() => { setSelected(c); setModal('form') }} onDelete={() => handleDelete(c)} />
            </td>
          </tr>
        )}
        renderCard={c => (
          <div key={c.id} className={`card p-3 flex items-center gap-3 ${selectedIds.has(c.id) ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20' : ''}`}>
            <div className="flex-shrink-0" onClick={e => { e.stopPropagation(); toggleOne(c.id) }}>
              <label htmlFor={`delivery-card-select-${c.id}`} className="sr-only">{`Select ${c.name}`}</label>
              <input id={`delivery-card-select-${c.id}`} name={`delivery_card_select_${c.id}`} type="checkbox" className="w-5 h-5 cursor-pointer rounded" checked={selectedIds.has(c.id)} onChange={() => toggleOne(c.id)} />
            </div>
            <div className="w-9 h-9 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center text-green-600 font-bold text-sm flex-shrink-0">
              {c.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setSelected(c); setModal('detail') }}>
              <div className="font-semibold text-gray-900 dark:text-white text-sm truncate flex items-center gap-1">
                {c.name}
              </div>
              {c.phone && <div className="text-xs text-gray-500">{c.phone}</div>}
              {c.area  && <div className="text-xs text-gray-400 truncate">{c.area}</div>}
            </div>
            <div onClick={e => e.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(c); setModal('detail') }} onEdit={() => { setSelected(c); setModal('form') }} onDelete={() => handleDelete(c)} />
            </div>
          </div>
        )}
      />

      {modal === 'form'   && <DeliveryForm contact={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} />}
      {modal === 'import' && <ImportModal type="deliveryContact" onClose={() => setModal(null)} onDone={load} />}
      {modal === 'detail' && selected && (
        <DetailModal item={selected}
          fields={[
            [t('name'), selected.name],
            [t('phone'), selected.phone],
            [t('area_zone')||'Area / Zone', selected.area],
            [t('notes'), selected.notes],
            [t('col_added')||'Added', fmtDate(selected.created_at)],
          ]}
          onEdit={() => setModal('form')} onDelete={() => handleDelete(selected)} onClose={() => { setModal(null); setSelected(null) }} t={t} />
      )}
    </div>
  )
}

export { DeliveryForm, DeliveryTab }

