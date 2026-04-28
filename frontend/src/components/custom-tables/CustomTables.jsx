import { useState, useEffect } from 'react'
import { useApp, useSync } from '../../AppContext'

const COLUMN_TYPES = ['text', 'long_text', 'number', 'decimal', 'boolean', 'date', 'timestamp', 'dropdown']

export default function CustomTables() {
  const { t, notify } = useApp()
  const { syncChannel } = useSync()
  const [tables, setTables] = useState([])
  const [activeTable, setActiveTable] = useState(null)
  const [tableData, setTableData] = useState([])
  const [createModal, setCreateModal] = useState(false)
  const [rowModal, setRowModal] = useState(null)
  const [rowForm, setRowForm] = useState({})
  const [newTable, setNewTable] = useState({ display_name: '', schema: [] })

  const loadTables = () => window.api.getCustomTables().then(setTables)

  useEffect(() => { loadTables() }, [])

  // FIX: respond to sync push events from server/other devices (was missing entirely)
  useEffect(() => {
    if (!syncChannel) return
    if (syncChannel.channel === 'customTables') {
      loadTables()
      // Also refresh active table's rows if one is open
      if (activeTable) {
        window.api.getCustomTableData({ tableName: activeTable.name }).then(setTableData)
      }
    }
  }, [syncChannel]) // eslint-disable-line

  useEffect(() => {
    if (activeTable) {
      window.api.getCustomTableData({ tableName: activeTable.name }).then(setTableData)
    }
  }, [activeTable])

  const addColumn = () => {
    setNewTable(t => ({ ...t, schema: [...t.schema, { name: '', type: 'text', required: false }] }))
  }

  const updateColumn = (i, key, val) => {
    setNewTable(t => ({ ...t, schema: t.schema.map((c, ci) => ci === i ? { ...c, [key]: val } : c) }))
  }

  const removeColumn = (i) => {
    setNewTable(t => ({ ...t, schema: t.schema.filter((_, ci) => ci !== i) }))
  }

  const handleCreateTable = async () => {
    if (!newTable.display_name) return notify(t('table_name_required')||'Table name required', 'error')
    if (newTable.schema.length === 0) return notify(t('add_at_least_one_column')||'Add at least one column', 'error')
    if (newTable.schema.some(c => !c.name)) return notify(t('all_columns_need_name')||'All columns need a name', 'error')
    const result = await window.api.createCustomTable({ ...newTable, name: newTable.display_name })
    if (result.success) {
      notify(t('table_created')||'Table created')
      setCreateModal(false)
      setNewTable({ display_name: '', schema: [] })
      loadTables()
    }
  }

  const handleSaveRow = async () => {
    if (!activeTable) return
    if (rowModal === 'create') {
      await window.api.insertCustomRow({ tableName: activeTable.name, data: rowForm })
      notify('Row added')
    } else {
      await window.api.updateCustomRow({ tableName: activeTable.name, id: rowModal.id, data: rowForm })
      notify('Row updated')
    }
    setRowModal(null)
    setRowForm({})
    window.api.getCustomTableData({ tableName: activeTable.name }).then(setTableData)
  }

  const handleDeleteRow = async (id) => {
    if (!confirm(t('confirm_delete_row')||'Delete this row?')) return
    const row = tableData.find((entry) => Number(entry.id) === Number(id))
    await window.api.deleteCustomRow({ tableName: activeTable.name, id, payload: { expectedUpdatedAt: row?.updated_at || undefined } })
    window.api.getCustomTableData({ tableName: activeTable.name }).then(setTableData)
  }

  const openAddRow = () => {
    const initial = {}
    activeTable && JSON.parse(activeTable.schema).forEach(col => { initial[col.name] = '' })
    setRowForm(initial)
    setRowModal('create')
  }

  const openEditRow = (row) => {
    setRowForm({ ...row })
    setRowModal(row)
  }

  const schema = activeTable ? JSON.parse(activeTable.schema) : []

  return (
    <div className="flex-1 flex min-h-0">
      {/* Sidebar - tables list */}
      <div className="w-56 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <button className="btn-primary w-full text-sm py-2" onClick={() => setCreateModal(true)}>+ {t('new_table')||'New Table'}</button>
        </div>
            <div className="flex-1 overflow-auto p-2">
          {tables.length === 0 ? <p className="text-xs text-gray-400 text-center mt-4">{t('no_tables_yet')||'No tables yet'}</p>
          : tables.map(tb => (
            <button key={tb.id} onClick={() => setActiveTable(tb)} className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${activeTable?.id === tb.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              🧱 {tb.display_name}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-0">
        {!activeTable ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-5xl mb-3">🧱</div>
              <p className="text-lg font-medium">Select or create a table</p>
              <p className="text-sm">Custom tables let you store any business data</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <h2 className="font-bold text-gray-900 dark:text-white text-lg">🧱 {activeTable.display_name}</h2>
              <button className="btn-primary text-sm" onClick={openAddRow}>+ {t('add_row')||'Add Row'}</button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium">#</th>
                        {schema.map(col => <th key={col.name} className="text-left px-3 py-2 text-gray-500 font-medium">{col.name}</th>)}
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.length === 0 ? <tr><td colSpan={schema.length + 2} className="text-center py-8 text-gray-400">{t('no_data_add_row')||'No data yet. Add a row!'}</td></tr>
                        : tableData.map((row, i) => (
                        <tr key={row.id} className="table-row">
                          <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                          {schema.map(col => (
                            <td key={col.name} className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-xs truncate">
                              {col.type === 'boolean' ? (row[col.name] ? t('yes')||'✓' : t('no')||'—') : (row[col.name] || '—')}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                                      <button onClick={() => openEditRow(row)} className="text-xs text-blue-500 hover:underline">{t('edit')||'Edit'}</button>
                                      <button onClick={() => handleDeleteRow(row.id)} className="text-xs text-red-500 hover:underline">{t('delete')||'Del'}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Create Table Modal */}
      {createModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col fade-in">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Create Custom Table</h2>
              <button onClick={() => setCreateModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <div className="page-scroll p-5 space-y-4">
              <div>
                <label htmlFor="custom-table-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('table_name')||'Table Name'} *</label>
                <input id="custom-table-name" name="custom_table_name" className="input" placeholder={t('table_name_placeholder')||'e.g. Suppliers, Expenses, Contacts...'} value={newTable.display_name} onChange={e => setNewTable(t => ({ ...t, display_name: e.target.value }))} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Columns</label>
                  <button onClick={addColumn} className="text-xs text-blue-600 hover:underline">+ Add Column</button>
                </div>
                <div className="space-y-2">
                  {newTable.schema.map((col, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input id={`custom-table-column-name-${i}`} name={`custom_table_column_name_${i}`} className="input flex-1" placeholder="Column name" value={col.name} onChange={e => updateColumn(i, 'name', e.target.value)} />
                      <select id={`custom-table-column-type-${i}`} name={`custom_table_column_type_${i}`} className="input w-36" value={col.type} onChange={e => updateColumn(i, 'type', e.target.value)}>
                        {COLUMN_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                      <button onClick={() => removeColumn(i)} className="text-red-400 hover:text-red-600 text-xl">×</button>
                    </div>
                  ))}
                  {newTable.schema.length === 0 && <p className="text-xs text-gray-400 text-center py-3 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">{t('click_add_column')||'Click "Add Column" to define your table structure'}</p>}
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button className="btn-primary flex-1" onClick={handleCreateTable}>{t('create_table')||'Create Table'}</button>
              <button className="btn-secondary" onClick={() => setCreateModal(false)}>{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Row Modal */}
      {rowModal && activeTable && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 fade-in">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{rowModal === 'create' ? (t('add_row')||'Add Row') : (t('edit_row')||'Edit Row')}</h2>
            <div className="space-y-3">
              {schema.map(col => (
                <div key={col.name}>
                  <label htmlFor={`custom-table-row-${col.name}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 capitalize">{col.name}</label>
                  {col.type === 'boolean' ? (
                    <select id={`custom-table-row-${col.name}`} name={`custom_table_row_${col.name}`} className="input" value={rowForm[col.name] || '0'} onChange={e => setRowForm(f => ({ ...f, [col.name]: e.target.value }))}>
                      <option value="0">{t('no')||'No'}</option><option value="1">{t('yes')||'Yes'}</option>
                    </select>
                  ) : col.type === 'long_text' ? (
                    <textarea id={`custom-table-row-${col.name}`} name={`custom_table_row_${col.name}`} className="input resize-none" rows={3} value={rowForm[col.name] || ''} onChange={e => setRowForm(f => ({ ...f, [col.name]: e.target.value }))} />
                  ) : (
                    <input id={`custom-table-row-${col.name}`} name={`custom_table_row_${col.name}`} className="input" type={col.type === 'number' || col.type === 'decimal' ? 'number' : col.type === 'date' ? 'date' : 'text'} value={rowForm[col.name] || ''} onChange={e => setRowForm(f => ({ ...f, [col.name]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-primary flex-1" onClick={handleSaveRow}>{t('save')||'Save'}</button>
              <button className="btn-secondary" onClick={() => setRowModal(null)}>{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
