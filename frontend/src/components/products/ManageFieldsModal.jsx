// ── ManageFieldsModal ────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import Modal from '../shared/Modal'

export default
function ManageFieldsModal({ onClose, t, onChanged }) {
  const [fields, setFields] = useState([])
  const [form, setForm] = useState({ name: '', field_type: 'text', options: '' })
  const [editing, setEditing] = useState(null)
  const [fieldErr, setFieldErr] = useState('')

  const FIELD_TYPES = ['text', 'number', 'decimal', 'boolean', 'date', 'dropdown', 'long_text']
  const load = () => window.api.getCustomFields().then(d => setFields(Array.isArray(d) ? d : []))
  useEffect(() => { load() }, [])

  const handleSave = async () => {
    if (!form.name.trim()) return
    const optionsArr = form.options ? form.options.split(',').map(o => o.trim()).filter(Boolean) : []
    const data = {
      entity_type:  'product',
      field_name:   form.name.trim(),
      field_type:   form.field_type,
      field_options: optionsArr.length ? JSON.stringify(optionsArr) : null,
    }
    try {
      let res
      if (editing) res = await window.api.updateCustomField(editing.id, data)
      else res = await window.api.createCustomField(data)
      if (res?.success === false) { setFieldErr(res.error || 'Failed'); return }
      setForm({ name: '', field_type: 'text', options: '' }); setEditing(null); setFieldErr('')
      load(); onChanged?.()
    } catch(e) { setFieldErr(e.message || 'Failed') }
  }

  return (
    <Modal title={`🧩 ${t('manage_fields')}`} onClose={onClose}>
      <div className="space-y-4">
        {fieldErr && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{fieldErr}</div>}
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
              <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{f.field_name}</span>
              <span className="badge-blue text-xs">{f.field_type}</span>
              <button onClick={() => { setEditing(f); setForm({ name: f.field_name, field_type: f.field_type, options: (JSON.parse(f.field_options || '[]')).join(', ') }) }} className="text-blue-500 text-xs hover:underline">{t('edit')}</button>
              <button onClick={async () => { if (confirm(t('confirm_delete'))) { await window.api.deleteCustomField(f.id); load(); onChanged?.() } }} className="text-red-500 text-xs hover:underline">{t('delete')}</button>
            </div>
          ))}
          {fields.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No custom fields yet. Add fields to track extra product data.</p>}
        </div>
      </div>
    </Modal>
  )
}

