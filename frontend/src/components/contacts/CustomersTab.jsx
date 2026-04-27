import { useState, useEffect, useCallback } from 'react'
import { Download, Plus, Upload } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import { downloadCSV } from '../../utils/csv'
import { fmtDate } from '../../utils/formatters'
import Modal from '../shared/Modal'
import { ThreeDotMenu, DetailModal, ImportModal, ContactTable, useContactSelection } from './shared'

export function parseContactOptions(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      if (!parsed.length) return []
      if (typeof parsed[0] === 'object' && parsed[0] !== null && !Array.isArray(parsed[0])) {
        return parsed.filter(Boolean)
      }
      return parsed.filter(Boolean).map((address, index) => ({
        label: index === 0 ? 'Default' : `Option ${index + 1}`,
        name: '',
        phone: '',
        email: '',
        address: String(address),
      }))
    }
  } catch (_) {}
  return [{ label: 'Default', name: '', phone: '', email: '', address: String(raw) }]
}

export function serializeContactOptions(options) {
  const clean = (Array.isArray(options) ? options : []).filter((option) => (
    String(option?.label || '').trim() ||
    String(option?.name || '').trim() ||
    String(option?.phone || '').trim() ||
    String(option?.email || '').trim() ||
    String(option?.address || '').trim()
  ))
  return clean.length ? JSON.stringify(clean) : null
}

const BLANK_OPTION = () => ({ label: '', name: '', phone: '', email: '', address: '' })

function generateMembershipNumber() {
  const stamp = Date.now().toString().slice(-8)
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `MEM-${stamp}-${rand}`
}

function tr(t, key, fallback) {
  const value = typeof t === 'function' ? t(key) : null
  return value && value !== key ? value : fallback
}

function OptionEditor({ option, index, total, onChange, onRemove }) {
  const setField = (key, value) => onChange({ ...option, [key]: value })

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2 dark:border-zinc-600 dark:bg-zinc-800/60">
      <div className="flex items-center gap-2">
        <span className="w-5 flex-shrink-0 text-xs font-bold text-gray-400">#{index + 1}</span>
        <input
          className="input flex-1 text-xs py-1"
          placeholder="Option label"
          value={option.label}
          onChange={(event) => setField('label', event.target.value)}
        />
        {total > 1 ? (
          <button type="button" onClick={onRemove} className="rounded px-1.5 py-1 text-xs text-red-500 hover:text-red-700">
            Remove
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-0.5 block text-xs text-gray-400">Name</label>
          <input className="input text-xs py-1" placeholder="Contact name" value={option.name} onChange={(event) => setField('name', event.target.value)} />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-gray-400">Phone</label>
          <input className="input text-xs py-1" placeholder="Phone number" value={option.phone} onChange={(event) => setField('phone', event.target.value)} />
        </div>
      </div>
      <div>
        <label className="mb-0.5 block text-xs text-gray-400">Email</label>
        <input className="input text-xs py-1" type="email" placeholder="Email address" value={option.email} onChange={(event) => setField('email', event.target.value)} />
      </div>
      <div>
        <label className="mb-0.5 block text-xs text-gray-400">Address</label>
        <input className="input text-xs py-1" placeholder="Delivery or billing address" value={option.address} onChange={(event) => setField('address', event.target.value)} />
      </div>
    </div>
  )
}

function buildOptionSummary(options) {
  if (!options.length) return '-'
  return options.map((option, index) => {
    const parts = [option.name, option.phone, option.email, option.address].filter(Boolean)
    return `#${index + 1} ${option.label ? `(${option.label}) ` : ''}${parts.join(' | ') || '-'}`
  }).join('\n')
}

function CustomerForm({ customer, onSave, onClose, t }) {
  const initial = customer
    ? { ...customer }
    : { name: '', membership_number: '', phone: '', email: '', company: '', notes: '' }
  const [form, setForm] = useState(initial)
  const [options, setOptions] = useState(() => {
    const parsed = parseContactOptions(initial.address)
    return parsed.length ? parsed : [BLANK_OPTION()]
  })

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const addOption = () => setOptions((current) => [...current, BLANK_OPTION()])
  const removeOption = (index) => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))
  const updateOption = (index, nextOption) => setOptions((current) => current.map((item, itemIndex) => (itemIndex === index ? nextOption : item)))

  return (
    <Modal title={customer ? `${tr(t, 'edit_customer', 'Edit Customer')}` : tr(t, 'add_customer', 'Add Customer')} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr(t, 'name', 'Name')} *</label>
          <input className="input" value={form.name} onChange={(event) => setField('name', event.target.value)} autoFocus />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Membership Number</label>
            <button type="button" className="text-xs text-blue-500 hover:text-blue-700" onClick={() => setField('membership_number', generateMembershipNumber())}>
              Generate
            </button>
          </div>
          <input className="input" value={form.membership_number || ''} onChange={(event) => setField('membership_number', event.target.value.toUpperCase())} placeholder="MEM-00000000-ABCD" />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr(t, 'phone', 'Phone')}</label>
            <input className="input" value={form.phone || ''} onChange={(event) => setField('phone', event.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr(t, 'email', 'Email')}</label>
            <input className="input" type="email" value={form.email || ''} onChange={(event) => setField('email', event.target.value)} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr(t, 'company', 'Company')}</label>
          <input className="input" value={form.company || ''} onChange={(event) => setField('company', event.target.value)} />
        </div>

        <div>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Contact Options
              <span className="ml-1.5 text-xs font-normal text-gray-400">Different names, phones, emails, or addresses per option</span>
            </label>
            <button type="button" onClick={addOption} className="rounded-lg px-2 py-1 text-xs font-medium text-blue-500 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/20">
              + Add Option
            </button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
            {options.map((option, index) => (
              <OptionEditor
                key={index}
                option={option}
                index={index}
                total={options.length}
                onChange={(nextOption) => updateOption(index, nextOption)}
                onRemove={() => removeOption(index)}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr(t, 'notes', 'Notes')}</label>
          <textarea className="input resize-none" rows={2} value={form.notes || ''} onChange={(event) => setField('notes', event.target.value)} />
        </div>

        <div className="flex flex-col gap-3 pt-1 sm:flex-row">
          <button className="btn-primary flex-1" onClick={() => onSave({ ...form, address: serializeContactOptions(options) })}>{tr(t, 'save', 'Save')}</button>
          <button className="btn-secondary" onClick={onClose}>{tr(t, 'cancel', 'Cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

function CustomersTab({ t, notify }) {
  const { user } = useApp()
  const { syncChannel } = useSync()
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const filtered = customers.filter((customer) => {
    const query = search.toLowerCase().trim()
    if (!query) return true
    return (
      String(customer.name || '').toLowerCase().includes(query) ||
      String(customer.membership_number || '').toLowerCase().includes(query) ||
      String(customer.phone || '').includes(query) ||
      String(customer.email || '').toLowerCase().includes(query)
    )
  })

  const { selectedIds, toggleOne, clearSelection, selectAllProp } = useContactSelection(filtered)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.api.getCustomers()
      setCustomers(Array.isArray(data) ? data : [])
    } catch (error) {
      setCustomers([])
      notify(error?.message || 'Failed to load customers', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (syncChannel?.channel === 'customers') load()
  }, [syncChannel, load])

  const handleSave = async (form) => {
    if (!String(form.name || '').trim()) {
      notify(tr(t, 'name_required', 'Name required'), 'error')
      return
    }

    try {
      const payload = { ...form, userId: user?.id, userName: user?.name }
      const result = selected
        ? await window.api.updateCustomer(selected.id, payload)
        : await window.api.createCustomer(payload)
      if (result?.success === false) {
        notify(result.error || 'Failed', 'error')
        return
      }
      notify(selected ? tr(t, 'customer_updated', 'Updated') : tr(t, 'customer_added', 'Added'))
      setModal(null)
      setSelected(null)
      load()
    } catch (error) {
      notify(error.message || 'Failed', 'error')
    }
  }

  const handleDelete = async (customer) => {
    if (!confirm(`Delete customer "${customer.name}"?`)) return
    try {
      await window.api.deleteCustomer(customer.id)
      notify(tr(t, 'customer_deleted', 'Deleted'))
      setModal(null)
      setSelected(null)
      load()
    } catch (error) {
      notify(error.message || 'Failed', 'error')
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return
    if (!confirm(`Delete ${selectedIds.size} customer(s)?`)) return
    for (const id of selectedIds) {
      try { await window.api.deleteCustomer(id) } catch (_) {}
    }
    clearSelection()
    load()
    notify(`${selectedIds.size} ${tr(t, 'deleted', 'deleted')}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex w-full min-w-0 flex-1 items-center gap-2">
          <input
            className="input w-full min-w-0 flex-1 sm:max-w-xs"
            placeholder={tr(t, 'search_customers_placeholder', `${tr(t, 'search', 'Search')} customers`)}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="whitespace-nowrap text-sm text-gray-400">{filtered.length}</span>
        </div>

        <div className="flex w-full flex-shrink-0 items-center gap-1.5 overflow-x-auto sm:w-auto sm:flex-nowrap">
          {selectedIds.size > 0 ? (
            <button className="btn-secondary whitespace-nowrap text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={handleBulkDelete}>
              Delete {selectedIds.size}
            </button>
          ) : null}
          <button className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap text-sm" onClick={() => setModal('import')} title={tr(t, 'import_contacts', 'Import')}>
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">{tr(t, 'import_contacts', 'Import')}</span>
          </button>
          <button
            className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap text-sm"
            onClick={() => {
              const rows = filtered.map((customer) => {
                const options = parseContactOptions(customer.address)
                return {
                  Name: customer.name || '',
                  Membership_Number: customer.membership_number || '',
                  Phone: customer.phone || '',
                  Email: customer.email || '',
                  Company: customer.company || '',
                  Options: options.map((option) => `[${option.label || 'Option'}] ${[option.name, option.phone, option.email, option.address].filter(Boolean).join(' | ')}`).join(' || '),
                  Notes: customer.notes || '',
                  Created: customer.created_at || '',
                }
              })
              downloadCSV(`customers-${new Date().toISOString().slice(0, 10)}.csv`, rows)
            }}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{tr(t, 'export', 'Export')}</span>
          </button>
          <button className="btn-primary inline-flex items-center gap-1.5 whitespace-nowrap text-sm" onClick={() => { setSelected(null); setModal('form') }} title={tr(t, 'add_customer', 'Add Customer')}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{tr(t, 'add_customer', 'Add Customer')}</span>
          </button>
        </div>
      </div>

      <ContactTable
        loading={loading}
        rows={filtered}
        emptyLabel={tr(t, 'no_customers', 'No customers')}
        columns={[tr(t, 'name', 'Name'), 'Membership', tr(t, 'loyalty_points', 'Points'), tr(t, 'phone', 'Phone'), tr(t, 'email', 'Email'), tr(t, 'company', 'Company'), 'Options']}
        selectAll={selectAllProp}
        selectedCount={selectedIds.size}
        totalCount={filtered.length}
        t={t}
        renderRow={(customer) => {
          const options = parseContactOptions(customer.address)
          return (
            <tr key={customer.id} className={`table-row cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedIds.has(customer.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
              <td className="w-10 px-3 py-2" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" className="h-4 w-4 cursor-pointer rounded" checked={selectedIds.has(customer.id)} onChange={() => toggleOne(customer.id)} />
              </td>
              <td className="px-4 py-2 font-medium text-gray-900 cursor-pointer dark:text-white" onClick={() => { setSelected(customer); setModal('detail') }}>{customer.name}</td>
              <td className="px-4 py-2 font-mono text-xs text-gray-500 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>{customer.membership_number || '--'}</td>
              <td className="px-4 py-2 font-semibold text-blue-600 cursor-pointer dark:text-blue-300" onClick={() => { setSelected(customer); setModal('detail') }}>
                {Number(customer.points_balance || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </td>
              <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>{customer.phone || '-'}</td>
              <td className="px-4 py-2 text-xs text-gray-500 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>{customer.email || '-'}</td>
              <td className="px-4 py-2 text-gray-500 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>{customer.company || '-'}</td>
              <td className="px-4 py-2 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>
                {options.length === 0 ? (
                  <span className="text-xs text-gray-400">-</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1">
                    {options.slice(0, 2).map((option, index) => (
                      <span key={index} className="badge-blue max-w-[90px] truncate text-xs">{option.label || `Opt ${index + 1}`}</span>
                    ))}
                    {options.length > 2 ? <span className="text-xs text-gray-400">+{options.length - 2}</span> : null}
                  </div>
                )}
              </td>
              <td className="px-2 py-2 text-right" onClick={(event) => event.stopPropagation()}>
                <ThreeDotMenu onDetails={() => { setSelected(customer); setModal('detail') }} onEdit={() => { setSelected(customer); setModal('form') }} onDelete={() => handleDelete(customer)} />
              </td>
            </tr>
          )
        }}
        renderCard={(customer) => {
          const options = parseContactOptions(customer.address)
          return (
            <div key={customer.id} className={`card flex items-center gap-3 p-3 ${selectedIds.has(customer.id) ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20' : ''}`}>
              <div className="flex-shrink-0" onClick={(event) => { event.stopPropagation(); toggleOne(customer.id) }}>
                <input type="checkbox" className="h-5 w-5 cursor-pointer rounded" checked={selectedIds.has(customer.id)} onChange={() => toggleOne(customer.id)} />
              </div>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-600 dark:bg-blue-900/40">{customer.name?.[0]?.toUpperCase()}</div>
              <div className="min-w-0 flex-1 cursor-pointer" onClick={() => { setSelected(customer); setModal('detail') }}>
                <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{customer.name}</div>
                {customer.membership_number ? <div className="font-mono text-[11px] text-blue-500">{customer.membership_number}</div> : null}
                <div className="text-xs font-semibold text-blue-600 dark:text-blue-300">{tr(t, 'loyalty_points', 'Points')}: {Number(customer.points_balance || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
                {customer.phone ? <div className="text-xs text-gray-500">{customer.phone}</div> : null}
                {customer.company ? <div className="truncate text-xs text-gray-400">{customer.company}</div> : null}
                {options.length ? <div className="mt-0.5 text-xs text-blue-500">{options.length} contact option{options.length !== 1 ? 's' : ''}</div> : null}
              </div>
              <div onClick={(event) => event.stopPropagation()}>
                <ThreeDotMenu onDetails={() => { setSelected(customer); setModal('detail') }} onEdit={() => { setSelected(customer); setModal('form') }} onDelete={() => handleDelete(customer)} />
              </div>
            </div>
          )
        }}
      />

      {modal === 'form' ? <CustomerForm customer={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} /> : null}
      {modal === 'import' ? <ImportModal type="customer" onClose={() => setModal(null)} onDone={load} /> : null}
      {modal === 'detail' && selected ? (
        <DetailModal
          item={selected}
          fields={[
            [tr(t, 'name', 'Name'), selected.name],
            ['Membership', selected.membership_number],
            [tr(t, 'loyalty_points', 'Points'), Number(selected.points_balance || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })],
            ['Points earned', Number(selected.points_earned || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })],
            ['Points redeemed', Number(selected.points_redeemed || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })],
            ['Reward points', Number(selected.points_rewarded || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })],
            ['Points deducted', Number(selected.points_deducted || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })],
            [tr(t, 'phone', 'Phone'), selected.phone],
            [tr(t, 'email', 'Email'), selected.email],
            [tr(t, 'company', 'Company'), selected.company],
            ['Contact Options', buildOptionSummary(parseContactOptions(selected.address))],
            [tr(t, 'notes', 'Notes'), selected.notes],
            [tr(t, 'col_added', 'Added'), fmtDate(selected.created_at)],
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

export { CustomerForm, CustomersTab }

