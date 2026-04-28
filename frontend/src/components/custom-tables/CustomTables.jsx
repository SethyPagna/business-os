import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp, useSync } from '../../AppContext'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

const COLUMN_TYPES = ['text', 'long_text', 'number', 'decimal', 'boolean', 'date', 'timestamp', 'dropdown']

function normalizeRowValue(column, value) {
  if (column?.type === 'boolean') return value === '1' || value === 1 || value === true ? 1 : 0
  if (column?.type === 'number') {
    const parsed = Number.parseInt(String(value || '').trim(), 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (column?.type === 'decimal') {
    const parsed = Number.parseFloat(String(value || '').trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return value ?? ''
}

function buildRowPayload(schema = [], values = {}) {
  return schema.reduce((payload, column) => {
    const key = String(column?.name || '').trim()
    if (!key) return payload
    payload[key] = normalizeRowValue(column, values?.[key])
    return payload
  }, {})
}

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
  const [loadingTables, setLoadingTables] = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)
  const [tablesError, setTablesError] = useState('')
  const [rowsError, setRowsError] = useState('')
  const [savingTable, setSavingTable] = useState(false)
  const [savingRow, setSavingRow] = useState(false)
  const [deletingRowId, setDeletingRowId] = useState(null)
  const tablesRequestRef = useRef(0)
  const rowsRequestRef = useRef(0)

  const activeSchema = useMemo(() => {
    try {
      return activeTable ? JSON.parse(activeTable.schema || '[]') : []
    } catch (_) {
      return []
    }
  }, [activeTable])

  const loadTables = useCallback(async () => {
    const requestId = beginTrackedRequest(tablesRequestRef)
    setLoadingTables(true)
    setTablesError('')
    try {
      const nextTables = await withLoaderTimeout(() => window.api.getCustomTables(), 'Custom tables')
      if (!isTrackedRequestCurrent(tablesRequestRef, requestId)) return
      const normalized = Array.isArray(nextTables) ? nextTables : []
      setTables(normalized)
      setActiveTable((current) => {
        if (!current?.name) return current
        const refreshed = normalized.find((table) => table.name === current.name)
        if (!refreshed) {
          setTableData([])
          setRowsError('')
          return null
        }
        return refreshed
      })
    } catch (error) {
      if (!isTrackedRequestCurrent(tablesRequestRef, requestId)) return
      setTablesError(error?.message || 'Failed to load custom tables')
      notify(error?.message || 'Failed to load custom tables', 'error')
    } finally {
      if (isTrackedRequestCurrent(tablesRequestRef, requestId)) setLoadingTables(false)
    }
  }, [notify])

  const loadTableData = useCallback(async (tableName) => {
    if (!tableName) {
      setTableData([])
      setRowsError('')
      setLoadingRows(false)
      return
    }
    const requestId = beginTrackedRequest(rowsRequestRef)
    setLoadingRows(true)
    setRowsError('')
    try {
      const rows = await withLoaderTimeout(() => window.api.getCustomTableData({ tableName }), `Custom table ${tableName}`)
      if (!isTrackedRequestCurrent(rowsRequestRef, requestId)) return
      setTableData(Array.isArray(rows) ? rows : [])
    } catch (error) {
      if (!isTrackedRequestCurrent(rowsRequestRef, requestId)) return
      setRowsError(error?.message || 'Failed to load table rows')
      notify(error?.message || 'Failed to load table rows', 'error')
    } finally {
      if (isTrackedRequestCurrent(rowsRequestRef, requestId)) setLoadingRows(false)
    }
  }, [notify])

  useEffect(() => { loadTables() }, [loadTables])

  useEffect(() => {
    if (!syncChannel) return
    if (syncChannel.channel === 'customTables') {
      loadTables()
      if (activeTable?.name) loadTableData(activeTable.name)
    }
  }, [activeTable?.name, loadTableData, loadTables, syncChannel])

  useEffect(() => {
    if (activeTable?.name) loadTableData(activeTable.name)
  }, [activeTable?.name, loadTableData])

  useEffect(() => () => {
    invalidateTrackedRequest(tablesRequestRef)
    invalidateTrackedRequest(rowsRequestRef)
  }, [])

  const addColumn = () => {
    setNewTable((current) => ({
      ...current,
      schema: [...current.schema, { name: '', type: 'text', required: false }],
    }))
  }

  const updateColumn = (index, key, value) => {
    setNewTable((current) => ({
      ...current,
      schema: current.schema.map((column, columnIndex) => (
        columnIndex === index ? { ...column, [key]: value } : column
      )),
    }))
  }

  const removeColumn = (index) => {
    setNewTable((current) => ({
      ...current,
      schema: current.schema.filter((_, columnIndex) => columnIndex !== index),
    }))
  }

  const handleCreateTable = async () => {
    if (savingTable) return
    if (!newTable.display_name.trim()) {
      notify(t('table_name_required') || 'Table name required', 'error')
      return
    }
    if (newTable.schema.length === 0) {
      notify(t('add_at_least_one_column') || 'Add at least one column', 'error')
      return
    }
    if (newTable.schema.some((column) => !String(column?.name || '').trim())) {
      notify(t('all_columns_need_name') || 'All columns need a name', 'error')
      return
    }
    setSavingTable(true)
    try {
      const payload = {
        ...newTable,
        name: newTable.display_name,
        schema: newTable.schema.map((column) => ({
          ...column,
          name: String(column?.name || '').trim(),
          type: String(column?.type || 'text').trim(),
        })),
      }
      const result = await window.api.createCustomTable(payload)
      notify(t('table_created') || 'Table created')
      setCreateModal(false)
      setNewTable({ display_name: '', schema: [] })
      if (result?.name) setActiveTable(result)
      await loadTables()
    } catch (error) {
      notify(error?.message || 'Failed to create table', 'error')
    } finally {
      setSavingTable(false)
    }
  }

  const handleSaveRow = async () => {
    if (!activeTable?.name || savingRow) return
    const payload = buildRowPayload(activeSchema, rowForm)
    setSavingRow(true)
    try {
      if (rowModal === 'create') {
        await window.api.insertCustomRow({ tableName: activeTable.name, data: payload })
        notify(t('row_added') || 'Row added')
      } else {
        await window.api.updateCustomRow({
          tableName: activeTable.name,
          id: rowModal.id,
          data: payload,
          expectedUpdatedAt: rowModal?.updated_at || undefined,
        })
        notify(t('row_updated') || 'Row updated')
      }
      setRowModal(null)
      setRowForm({})
      await loadTableData(activeTable.name)
    } catch (error) {
      notify(error?.message || 'Failed to save row', 'error')
    } finally {
      setSavingRow(false)
    }
  }

  const handleDeleteRow = async (id) => {
    if (!activeTable?.name || deletingRowId) return
    if (!confirm(t('confirm_delete_row') || 'Delete this row?')) return
    setDeletingRowId(id)
    try {
      const row = tableData.find((entry) => Number(entry.id) === Number(id))
      await window.api.deleteCustomRow({
        tableName: activeTable.name,
        id,
        payload: { expectedUpdatedAt: row?.updated_at || undefined },
      })
      await loadTableData(activeTable.name)
    } catch (error) {
      notify(error?.message || 'Failed to delete row', 'error')
    } finally {
      setDeletingRowId(null)
    }
  }

  const openAddRow = () => {
    const initial = {}
    activeSchema.forEach((column) => { initial[column.name] = column.type === 'boolean' ? '0' : '' })
    setRowForm(initial)
    setRowModal('create')
  }

  const openEditRow = (row) => {
    setRowForm(buildRowPayload(activeSchema, row))
    setRowModal(row)
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-56 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-200 p-3 dark:border-gray-700">
          <button className="btn-primary w-full py-2 text-sm" onClick={() => setCreateModal(true)} disabled={savingTable}>
            + {t('new_table') || 'New Table'}
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {tablesError ? <p className="mt-4 text-center text-xs text-red-500">{tablesError}</p> : null}
          {loadingTables ? <p className="mt-4 text-center text-xs text-gray-400">{t('loading') || 'Loading...'}</p> : null}
          {!loadingTables && !tables.length ? <p className="mt-4 text-center text-xs text-gray-400">{t('no_tables_yet') || 'No tables yet'}</p> : null}
          {tables.map((table) => (
            <button
              key={table.id}
              onClick={() => setActiveTable(table)}
              className={`mb-0.5 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                activeTable?.id === table.id
                  ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {table.display_name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {!activeTable ? (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="mb-3 text-5xl">[]</div>
              <p className="text-lg font-medium">Select or create a table</p>
              <p className="text-sm">Custom tables let you store any business data</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{activeTable.display_name}</h2>
              <button className="btn-primary text-sm" onClick={openAddRow} disabled={savingRow || !!deletingRowId || loadingRows}>
                + {t('add_row') || 'Add Row'}
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="card overflow-hidden">
                {rowsError ? <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-900/20">{rowsError}</div> : null}
                <div className="overflow-x-auto">
                  <table className="w-full whitespace-nowrap text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">#</th>
                        {activeSchema.map((column) => <th key={column.name} className="px-3 py-2 text-left font-medium text-gray-500">{column.name}</th>)}
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {loadingRows ? (
                        <tr><td colSpan={activeSchema.length + 2} className="py-8 text-center text-gray-400">{t('loading') || 'Loading...'}</td></tr>
                      ) : tableData.length === 0 ? (
                        <tr><td colSpan={activeSchema.length + 2} className="py-8 text-center text-gray-400">{t('no_data_add_row') || 'No data yet. Add a row!'}</td></tr>
                      ) : tableData.map((row, index) => (
                        <tr key={row.id} className="table-row">
                          <td className="px-3 py-2 text-xs text-gray-400">{index + 1}</td>
                          {activeSchema.map((column) => (
                            <td key={column.name} className="max-w-xs truncate px-3 py-2 text-gray-700 dark:text-gray-300">
                              {column.type === 'boolean'
                                ? (Number(row[column.name] || 0) ? (t('yes') || 'Yes') : (t('no') || 'No'))
                                : (row[column.name] ?? '-')}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                              <button onClick={() => openEditRow(row)} className="text-xs text-blue-500 hover:underline" disabled={savingRow || !!deletingRowId}>
                                {t('edit') || 'Edit'}
                              </button>
                              <button onClick={() => handleDeleteRow(row.id)} className="text-xs text-red-500 hover:underline" disabled={!!deletingRowId}>
                                {deletingRowId === row.id ? (t('deleting') || 'Deleting...') : (t('delete') || 'Delete')}
                              </button>
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

      {createModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="fade-in flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 p-5 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Create Custom Table</h2>
              <button onClick={() => setCreateModal(false)} className="text-2xl text-gray-400 hover:text-gray-600" disabled={savingTable}>x</button>
            </div>
            <div className="page-scroll space-y-4 p-5">
              <div>
                <label htmlFor="custom-table-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('table_name') || 'Table Name'} *</label>
                <input
                  id="custom-table-name"
                  name="custom_table_name"
                  className="input"
                  placeholder={t('table_name_placeholder') || 'e.g. Suppliers, Expenses, Contacts...'}
                  value={newTable.display_name}
                  onChange={(event) => setNewTable((current) => ({ ...current, display_name: event.target.value }))}
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Columns</label>
                  <button onClick={addColumn} className="text-xs text-blue-600 hover:underline" disabled={savingTable}>+ Add Column</button>
                </div>
                <div className="space-y-2">
                  {newTable.schema.map((column, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        id={`custom-table-column-name-${index}`}
                        name={`custom_table_column_name_${index}`}
                        className="input flex-1"
                        placeholder="Column name"
                        value={column.name}
                        onChange={(event) => updateColumn(index, 'name', event.target.value)}
                      />
                      <select
                        id={`custom-table-column-type-${index}`}
                        name={`custom_table_column_type_${index}`}
                        className="input w-36"
                        value={column.type}
                        onChange={(event) => updateColumn(index, 'type', event.target.value)}
                      >
                        {COLUMN_TYPES.map((type) => <option key={type}>{type}</option>)}
                      </select>
                      <button onClick={() => removeColumn(index)} className="text-xl text-red-400 hover:text-red-600" disabled={savingTable}>x</button>
                    </div>
                  ))}
                  {newTable.schema.length === 0 ? <p className="rounded-lg border border-dashed border-gray-300 py-3 text-center text-xs text-gray-400 dark:border-gray-600">{t('click_add_column') || 'Click "Add Column" to define your table structure'}</p> : null}
                </div>
              </div>
            </div>
            <div className="flex gap-3 border-t border-gray-200 p-5 dark:border-gray-700">
              <button className="btn-primary flex-1" onClick={handleCreateTable} disabled={savingTable}>
                {savingTable ? (t('saving') || 'Saving...') : (t('create_table') || 'Create Table')}
              </button>
              <button className="btn-secondary" onClick={() => setCreateModal(false)} disabled={savingTable}>{t('cancel') || 'Cancel'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {rowModal && activeTable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="fade-in w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-bold text-gray-900 dark:text-white">{rowModal === 'create' ? (t('add_row') || 'Add Row') : (t('edit_row') || 'Edit Row')}</h2>
            <div className="space-y-3">
              {activeSchema.map((column) => (
                <div key={column.name}>
                  <label htmlFor={`custom-table-row-${column.name}`} className="mb-1 block text-sm font-medium capitalize text-gray-700 dark:text-gray-300">{column.name}</label>
                  {column.type === 'boolean' ? (
                    <select
                      id={`custom-table-row-${column.name}`}
                      name={`custom_table_row_${column.name}`}
                      className="input"
                      value={rowForm[column.name] || '0'}
                      onChange={(event) => setRowForm((current) => ({ ...current, [column.name]: event.target.value }))}
                    >
                      <option value="0">{t('no') || 'No'}</option>
                      <option value="1">{t('yes') || 'Yes'}</option>
                    </select>
                  ) : column.type === 'long_text' ? (
                    <textarea
                      id={`custom-table-row-${column.name}`}
                      name={`custom_table_row_${column.name}`}
                      className="input resize-none"
                      rows={3}
                      value={rowForm[column.name] || ''}
                      onChange={(event) => setRowForm((current) => ({ ...current, [column.name]: event.target.value }))}
                    />
                  ) : (
                    <input
                      id={`custom-table-row-${column.name}`}
                      name={`custom_table_row_${column.name}`}
                      className="input"
                      type={column.type === 'number' || column.type === 'decimal' ? 'number' : column.type === 'date' ? 'date' : 'text'}
                      value={rowForm[column.name] ?? ''}
                      onChange={(event) => setRowForm((current) => ({ ...current, [column.name]: event.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-5 flex gap-3">
              <button className="btn-primary flex-1" onClick={handleSaveRow} disabled={savingRow}>
                {savingRow ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
              </button>
              <button className="btn-secondary" onClick={() => setRowModal(null)} disabled={savingRow}>{t('cancel') || 'Cancel'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
