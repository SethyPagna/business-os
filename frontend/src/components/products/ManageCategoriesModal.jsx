// ── ManageCategoriesModal ────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import Modal from '../shared/Modal'
import { useApp, useSync } from '../../AppContext'

export default
function ManageCategoriesModal({ onClose, t }) {
  const [cats, setCats] = useState([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3b82f6')
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState('')
  const { notify } = useApp()
  const { syncChannel } = useSync()

  const load = () => window.api.getCategories().then(d => setCats(Array.isArray(d) ? d : []))
  useEffect(() => { load() }, [])
  useEffect(() => { if (syncChannel?.channel === 'categories') load() }, [syncChannel]) // eslint-disable-line

  const handleAdd = async () => {
    if (!newName.trim()) return
    setErr('')
    try {
      const res = await window.api.createCategory({ name: newName.trim(), color: newColor })
      if (res?.success === false) { setErr(res.error || 'Failed'); return }
      setNewName(''); setNewColor('#3b82f6'); load()
    } catch(e) { setErr(e.message || 'Failed') }
  }
  const handleUpdate = async (cat) => {
    setErr('')
    try {
      const res = await window.api.updateCategory({ id: cat.id, name: cat.name, color: cat.color })
      if (res?.success === false) { setErr(res.error || 'Failed'); return }
      setEditing(null); load()
    } catch(e) { setErr(e.message || 'Failed') }
  }
  const handleDelete = async (id) => {
    if (!confirm(t('confirm_delete'))) return
    try {
      await window.api.deleteCategory(id); load()
    } catch(e) { notify(e.message || 'Failed', 'error') }
  }

  return (
    <Modal title={`🏷 ${t('manage_categories')}`} onClose={onClose}>
      <div className="space-y-4">
        {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{err}</div>}
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

