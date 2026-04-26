// ── ManageUnitsModal ─────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import Modal from '../shared/Modal'

export default
function ManageUnitsModal({ onClose, t }) {
  const [units, setUnits] = useState([])
  const [newUnit, setNewUnit] = useState('')
  const [err, setErr] = useState('')

  const load = () => window.api.getUnits().then(d => setUnits(Array.isArray(d) ? d : []))
  useEffect(() => { load() }, [])

  const handleAddUnit = async () => {
    if (!newUnit.trim()) return
    setErr('')
    try {
      const res = await window.api.createUnit({ name: newUnit.trim() })
      if (res?.success === false) { setErr(res.error || 'Failed'); return }
      setNewUnit(''); load()
    } catch(e) { setErr(e.message || 'Failed') }
  }

  return (
    <Modal title={`📏 ${t('manage_units')}`} onClose={onClose}>
      <div className="space-y-3">
        {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{err}</div>}
        <div className="flex gap-2">
          <input className="input flex-1" value={newUnit} onChange={e => setNewUnit(e.target.value)} placeholder="e.g. bottle, bag..." onKeyDown={e => { if (e.key === 'Enter') handleAddUnit() }} />
          <button className="btn-primary" onClick={handleAddUnit}>{t('add')}</button>
        </div>
        <div className="flex flex-wrap gap-2 max-h-60 overflow-auto">
          {units.map(u => (
            <div key={u.id} className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-full px-3 py-1 text-sm">
              <span className="text-gray-700 dark:text-gray-300">{u.name}</span>
              <button onClick={async () => { if (confirm(t('confirm_delete'))) { try { await window.api.deleteUnit(u.id); load() } catch(e) { setErr(e.message) } } }} className="text-red-400 hover:text-red-600 ml-1 text-base leading-none">×</button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

