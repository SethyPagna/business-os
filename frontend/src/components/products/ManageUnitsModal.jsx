import { useEffect, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp, useSync } from '../../AppContext'

const DEFAULT_UNIT_COLOR = '#6366f1'

export default function ManageUnitsModal({ onClose, t }) {
  const [units, setUnits] = useState([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_UNIT_COLOR)
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState('')
  const { notify } = useApp()
  const { syncChannel } = useSync()

  const load = () => window.api.getUnits().then((data) => setUnits(Array.isArray(data) ? data : []))

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (syncChannel?.channel === 'units') load()
  }, [syncChannel]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    if (!newName.trim()) return
    setErr('')
    try {
      const res = await window.api.createUnit({ name: newName.trim(), color: newColor })
      if (res?.success === false) {
        setErr(res.error || 'Failed')
        return
      }
      setNewName('')
      setNewColor(DEFAULT_UNIT_COLOR)
      load()
    } catch (error) {
      setErr(error.message || 'Failed')
    }
  }

  const handleUpdate = async (unit) => {
    setErr('')
    try {
      const res = await window.api.updateUnit(unit.id, { name: unit.name, color: unit.color })
      if (res?.success === false) {
        setErr(res.error || 'Failed')
        return
      }
      setEditing(null)
      load()
    } catch (error) {
      setErr(error.message || 'Failed')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm(t('confirm_delete'))) return
    try {
      await window.api.deleteUnit(id)
      load()
    } catch (error) {
      notify(error.message || 'Failed', 'error')
    }
  }

  return (
    <Modal title={`📏 ${t('manage_units') || 'Manage Units'}`} onClose={onClose}>
      <div className="space-y-4">
        {err ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20">{err}</div> : null}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-500">{t('name') || 'Name'}</label>
            <input
              className="input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t('unit_example_placeholder') || 'e.g. bottle, bag...'}
              onKeyDown={(event) => { if (event.key === 'Enter') handleAdd() }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">{t('color') || 'Color'}</label>
            <input
              type="color"
              value={newColor}
              onChange={(event) => setNewColor(event.target.value)}
              className="h-10 w-10 cursor-pointer rounded-lg border border-gray-300"
            />
          </div>
          <button className="btn-primary" onClick={handleAdd}>{t('add') || 'Add'}</button>
        </div>

        <div className="max-h-80 space-y-2 overflow-auto">
          {units.map((unit) => (
            <div key={unit.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-2 dark:border-gray-700">
              {editing?.id === unit.id ? (
                <>
                  <input
                    type="color"
                    value={editing.color || DEFAULT_UNIT_COLOR}
                    onChange={(event) => setEditing((current) => ({ ...current, color: event.target.value }))}
                    className="h-8 w-8 cursor-pointer rounded border border-gray-300"
                  />
                  <input
                    className="input flex-1 py-1"
                    value={editing.name}
                    onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))}
                  />
                  <button className="btn-primary px-3 py-1 text-xs" onClick={() => handleUpdate(editing)}>
                    {t('save') || 'Save'}
                  </button>
                  <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setEditing(null)}>
                    {t('cancel') || 'Cancel'}
                  </button>
                </>
              ) : (
                <>
                  <div className="h-4 w-4 flex-shrink-0 rounded-full" style={{ background: unit.color || DEFAULT_UNIT_COLOR }} />
                  <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{unit.name}</span>
                  <button onClick={() => setEditing({ ...unit, color: unit.color || DEFAULT_UNIT_COLOR })} className="text-xs text-blue-500 hover:underline">
                    {t('edit') || 'Edit'}
                  </button>
                  <button onClick={() => handleDelete(unit.id)} className="text-xs text-red-500 hover:underline">
                    {t('delete') || 'Delete'}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
