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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const { notify } = useApp()
  const { syncChannel } = useSync()

  const load = async () => {
    setLoading(true)
    try {
      const data = await window.api.getUnits()
      setUnits(Array.isArray(data) ? data : [])
      setSelectedIds(new Set())
      setErr('')
    } catch (error) {
      setErr(error?.message || 'Failed to load units')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (syncChannel?.channel === 'units') load()
  }, [syncChannel]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    if (!newName.trim() || saving) return
    setErr('')
    setSaving(true)
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
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (unit) => {
    if (saving) return
    setErr('')
    setSaving(true)
    try {
      const res = await window.api.updateUnit(unit.id, { name: unit.name, color: unit.color, expectedUpdatedAt: unit.updated_at || undefined })
      if (res?.success === false) {
        setErr(res.error || 'Failed')
        return
      }
      setEditing(null)
      load()
    } catch (error) {
      setErr(error.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (saving || deletingId) return
    if (!confirm(t('confirm_delete'))) return
    setDeletingId(id)
    try {
      const unit = units.find((item) => Number(item.id) === Number(id))
      await window.api.deleteUnit(id, { expectedUpdatedAt: unit?.updated_at || undefined })
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(Number(id))
        return next
      })
      load()
    } catch (error) {
      notify(error.message || 'Failed', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const toggleSelected = (id) => {
    const numericId = Number(id)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(numericId)) next.delete(numericId)
      else next.add(numericId)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const visibleIds = units.map((unit) => Number(unit.id))
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id))
      const next = new Set(current)
      for (const id of visibleIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const handleDeleteSelected = async () => {
    if (saving || deletingId || selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} selected unit${selectedIds.size === 1 ? '' : 's'}?`)) return
    const ids = Array.from(selectedIds)
    setDeletingId('selected')
    try {
      for (const id of ids) {
        const unit = units.find((item) => Number(item.id) === Number(id))
        if (!unit) continue
        await window.api.deleteUnit(id, { expectedUpdatedAt: unit?.updated_at || undefined })
      }
      notify(`Deleted ${ids.length} unit${ids.length === 1 ? '' : 's'}`, 'success')
      setSelectedIds(new Set())
      load()
    } catch (error) {
      notify(error?.message || 'Failed to delete selected units', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Modal title={t('manage_units') || 'Manage Units'} onClose={onClose}>
      <div className="space-y-4">
        {err ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20">{err}</div> : null}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="new-unit-name" className="mb-1 block text-xs text-gray-500">{t('name') || 'Name'}</label>
            <input
              id="new-unit-name"
              name="new_unit_name"
              className="input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t('unit_example_placeholder') || 'e.g. bottle, bag...'}
              onKeyDown={(event) => { if (event.key === 'Enter') handleAdd() }}
            />
          </div>
          <div>
            <label htmlFor="new-unit-color" className="mb-1 block text-xs text-gray-500">{t('color') || 'Color'}</label>
            <input
              id="new-unit-color"
              name="new_unit_color"
              type="color"
              value={newColor}
              onChange={(event) => setNewColor(event.target.value)}
              className="h-10 w-10 cursor-pointer rounded-lg border border-gray-300"
            />
          </div>
          <button className="btn-primary" onClick={handleAdd} disabled={saving}>{saving ? (t('saving') || 'Saving...') : (t('add') || 'Add')}</button>
        </div>

        <div className="max-h-80 space-y-2 overflow-auto">
          {loading ? <div className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700">{t('loading') || 'Loading...'}</div> : null}
          {!loading && units.length > 0 ? (
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
              <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={units.length > 0 && units.every((unit) => selectedIds.has(Number(unit.id)))}
                  onChange={toggleAllVisible}
                />
                <span>{selectedIds.size ? `${selectedIds.size} selected` : 'Select visible'}</span>
              </label>
              <button
                type="button"
                className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
                onClick={handleDeleteSelected}
                disabled={!selectedIds.size || saving || deletingId != null}
              >
                {deletingId === 'selected' ? (t('deleting') || 'Deleting...') : 'Delete selected'}
              </button>
            </div>
          ) : null}
          {units.map((unit) => (
            <div key={unit.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-2 dark:border-gray-700">
              {editing?.id === unit.id ? (
                <>
                  <input
                    id={`unit-color-${unit.id}`}
                    name={`unit_color_${unit.id}`}
                    type="color"
                    value={editing.color || DEFAULT_UNIT_COLOR}
                    onChange={(event) => setEditing((current) => ({ ...current, color: event.target.value }))}
                    className="h-8 w-8 cursor-pointer rounded border border-gray-300"
                  />
                  <input
                    id={`unit-name-${unit.id}`}
                    name={`unit_name_${unit.id}`}
                    className="input flex-1 py-1"
                    value={editing.name}
                    onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))}
                  />
                  <button className="btn-primary px-3 py-1 text-xs" onClick={() => handleUpdate(editing)} disabled={saving}>
                    {saving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
                  </button>
                  <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setEditing(null)} disabled={saving}>
                    {t('cancel') || 'Cancel'}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(Number(unit.id))}
                    onChange={() => toggleSelected(unit.id)}
                    disabled={saving || deletingId != null}
                    aria-label={`Select ${unit.name}`}
                  />
                  <div className="h-4 w-4 flex-shrink-0 rounded-full" style={{ background: unit.color || DEFAULT_UNIT_COLOR }} />
                  <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{unit.name}</span>
                  <button onClick={() => setEditing({ ...unit, color: unit.color || DEFAULT_UNIT_COLOR })} className="text-xs text-blue-500 hover:underline">
                    {t('edit') || 'Edit'}
                  </button>
                  <button onClick={() => handleDelete(unit.id)} className="text-xs text-red-500 hover:underline" disabled={!!deletingId}>
                    {deletingId === unit.id ? (t('deleting') || 'Deleting...') : (t('delete') || 'Delete')}
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
