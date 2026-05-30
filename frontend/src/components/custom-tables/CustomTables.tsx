import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import { useApp, useSync } from '../../AppContext.tsx'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.ts'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'

const COLUMN_TYPES = ['text', 'long_text', 'number', 'decimal', 'boolean', 'date', 'timestamp', 'dropdown'] as const
const CUSTOM_TABLES_LOAD_TIMEOUT_MS = 8000
const CUSTOM_TABLE_ROWS_LOAD_TIMEOUT_MS = 10000
const CUSTOM_TABLE_MUTATION_TIMEOUT_MS = 12000

type ColumnType = typeof COLUMN_TYPES[number]
type CustomColumn = {
  name: string
  type: ColumnType | string
  required?: boolean
}
type CustomTable = {
  id?: number | string
  name: string
  display_name?: string
  schema?: string | CustomColumn[]
}
type CustomRow = Record<string, unknown> & {
  id?: number | string
  updated_at?: string
}
type RowModalState = 'create' | CustomRow | null
type NewTableDraft = {
  display_name: string
  schema: CustomColumn[]
}
type Translate = (key: string, fallback?: string) => string
type Notify = (message: string, type?: string) => void
type AppContextValue = {
  t?: Translate
  notify?: Notify
}
type SyncContextValue = {
  syncChannel?: {
    channel?: string
  } | null
}
type CustomTablesApi = {
  getCustomTables?: () => Promise<unknown>
  createCustomTable?: (payload: Record<string, unknown>) => Promise<unknown>
  getCustomTableData?: (payload: { tableName: string }) => Promise<unknown>
  insertCustomRow?: (payload: { tableName: string; data: Record<string, unknown> }) => Promise<unknown>
  updateCustomRow?: (payload: {
    tableName: string
    id: string | number | undefined
    data: Record<string, unknown>
    expectedUpdatedAt?: string
  }) => Promise<unknown>
  deleteCustomRow?: (payload: {
    tableName: string
    id: string | number
    payload: Record<string, unknown>
  }) => Promise<unknown>
}
type ActionHistoryBarHistory = ComponentProps<typeof ActionHistoryBar>['history']
type HistoryResultInput = Parameters<typeof extractHistoryResultId>[0]

function getCustomTablesApi(): CustomTablesApi {
  return (window as Window & { api?: CustomTablesApi }).api || {}
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function getHistoryResultId(result: unknown): number {
  return extractHistoryResultId(result as HistoryResultInput)
}

function formatCellValue(value: unknown): string | number {
  if (value == null || value === '') return '-'
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function toInputValue(value: unknown): string | number {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}

function normalizeRowValue(column: CustomColumn | undefined, value: unknown): unknown {
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

function normalizeCustomTable(value: unknown): CustomTable | null {
  if (!value || typeof value !== 'object') return null
  const table = value as Record<string, unknown>
  const name = String(table.name || '').trim()
  if (!name) return null
  return {
    id: typeof table.id === 'number' || typeof table.id === 'string' ? table.id : name,
    name,
    display_name: String(table.display_name || name),
    schema: Array.isArray(table.schema) || typeof table.schema === 'string' ? table.schema : '[]',
  }
}

function parseSchema(schema: unknown): CustomColumn[] {
  try {
    const parsed = typeof schema === 'string' ? JSON.parse(schema || '[]') : schema
    if (!Array.isArray(parsed)) return []
    return parsed.reduce<CustomColumn[]>((columns, column) => {
      if (!column || typeof column !== 'object') return columns
      const input = column as Record<string, unknown>
      const name = String(input.name || '').trim()
      if (!name) return columns
      columns.push({
        name,
        type: String(input.type || 'text').trim() || 'text',
        required: Boolean(input.required),
      })
      return columns
    }, [])
  } catch (_) {
    return []
  }
}

function normalizeRows(rows: unknown): CustomRow[] {
  return Array.isArray(rows)
    ? rows.filter((row): row is CustomRow => Boolean(row) && typeof row === 'object')
    : []
}

function buildRowPayload(schema: CustomColumn[] = [], values: Record<string, unknown> = {}): Record<string, unknown> {
  return schema.reduce<Record<string, unknown>>((payload, column) => {
    const key = String(column?.name || '').trim()
    if (!key) return payload
    payload[key] = normalizeRowValue(column, values?.[key])
    return payload
  }, {})
}

export default function CustomTables() {
  const useCustomTablesApp = useApp as unknown as () => AppContextValue
  const useCustomTablesSync = useSync as unknown as () => SyncContextValue
  const app = useCustomTablesApp()
  const { syncChannel } = useCustomTablesSync()
  const t: Translate = typeof app?.t === 'function' ? app.t : ((key) => key)
  const notify: Notify = typeof app?.notify === 'function' ? app.notify : (() => {})
  const [tables, setTables] = useState<CustomTable[]>([])
  const [activeTable, setActiveTable] = useState<CustomTable | null>(null)
  const [tableData, setTableData] = useState<CustomRow[]>([])
  const [createModal, setCreateModal] = useState(false)
  const [rowModal, setRowModal] = useState<RowModalState>(null)
  const [rowForm, setRowForm] = useState<Record<string, unknown>>({})
  const [newTable, setNewTable] = useState<NewTableDraft>({ display_name: '', schema: [] })
  const [loadingTables, setLoadingTables] = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)
  const [tablesError, setTablesError] = useState('')
  const [rowsError, setRowsError] = useState('')
  const [savingTable, setSavingTable] = useState(false)
  const [savingRow, setSavingRow] = useState(false)
  const [deletingRowId, setDeletingRowId] = useState<string | number | null>(null)
  const tablesRequestRef = useRef(0)
  const rowsRequestRef = useRef(0)
  const createTableInFlightRef = useRef(false)
  const saveRowInFlightRef = useRef(false)
  const deleteRowInFlightRef = useRef(false)
  const actionHistory = useActionHistory({ limit: 3, notify })
  const typedActionHistory = actionHistory as unknown as ActionHistoryBarHistory

  const activeSchema = useMemo(() => {
    return activeTable ? parseSchema(activeTable.schema) : []
  }, [activeTable])

  const loadTables = useCallback(async () => {
    const requestId = beginTrackedRequest(tablesRequestRef)
    setLoadingTables(true)
    setTablesError('')
    try {
      const nextTables = await withLoaderTimeout(
        () => getCustomTablesApi().getCustomTables?.(),
        'Custom tables',
        CUSTOM_TABLES_LOAD_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(tablesRequestRef, requestId)) return
      const normalized = Array.isArray(nextTables)
        ? nextTables.map(normalizeCustomTable).filter((table): table is CustomTable => Boolean(table))
        : []
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
      const message = getErrorMessage(error, 'Failed to load custom tables')
      setTablesError(message)
      notify(message, 'error')
    } finally {
      if (isTrackedRequestCurrent(tablesRequestRef, requestId)) setLoadingTables(false)
    }
  }, [notify])

  const loadTableData = useCallback(async (tableName: string) => {
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
      const rows = await withLoaderTimeout(
        () => getCustomTablesApi().getCustomTableData?.({ tableName }),
        `Custom table ${tableName}`,
        CUSTOM_TABLE_ROWS_LOAD_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(rowsRequestRef, requestId)) return
      setTableData(normalizeRows(rows))
    } catch (error) {
      if (!isTrackedRequestCurrent(rowsRequestRef, requestId)) return
      const message = getErrorMessage(error, 'Failed to load table rows')
      setRowsError(message)
      notify(message, 'error')
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

  const updateColumn = (index: number, key: keyof CustomColumn, value: unknown) => {
    setNewTable((current) => ({
      ...current,
      schema: current.schema.map((column, columnIndex) => (
        columnIndex === index ? { ...column, [key]: value } : column
      )),
    }))
  }

  const removeColumn = (index: number) => {
    setNewTable((current) => ({
      ...current,
      schema: current.schema.filter((_, columnIndex) => columnIndex !== index),
    }))
  }

  const handleCreateTable = async () => {
    if (!beginSingleAction(createTableInFlightRef, { blocked: savingTable })) return
    if (!newTable.display_name.trim()) {
      finishSingleAction(createTableInFlightRef)
      notify(t('table_name_required') || 'Table name required', 'error')
      return
    }
    if (newTable.schema.length === 0) {
      finishSingleAction(createTableInFlightRef)
      notify(t('add_at_least_one_column') || 'Add at least one column', 'error')
      return
    }
    if (newTable.schema.some((column) => !String(column?.name || '').trim())) {
      finishSingleAction(createTableInFlightRef)
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
      const result = await withLoaderTimeout(
        () => getCustomTablesApi().createCustomTable?.(payload),
        'Create custom table',
        CUSTOM_TABLE_MUTATION_TIMEOUT_MS,
      )
      notify(t('table_created') || 'Table created')
      setCreateModal(false)
      setNewTable({ display_name: '', schema: [] })
      const createdTable = normalizeCustomTable(result)
      if (createdTable) setActiveTable(createdTable)
      await loadTables()
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to create table'), 'error')
    } finally {
      finishSingleAction(createTableInFlightRef)
      setSavingTable(false)
    }
  }

  const handleSaveRow = async () => {
    if (!activeTable?.name || !beginSingleAction(saveRowInFlightRef, { blocked: savingRow })) return
    const payload = buildRowPayload(activeSchema, rowForm)
    const editingRow = rowModal && rowModal !== 'create' ? rowModal : null
    const previousSnapshot = editingRow ? cloneHistorySnapshot(editingRow) as CustomRow | null : null
    setSavingRow(true)
    try {
      let nextRow: unknown = null
      if (rowModal === 'create') {
        nextRow = await withLoaderTimeout(
          () => getCustomTablesApi().insertCustomRow?.({ tableName: activeTable.name, data: payload }),
          `Add row to ${activeTable.display_name || activeTable.name}`,
          CUSTOM_TABLE_MUTATION_TIMEOUT_MS,
        )
        notify(t('row_added') || 'Row added')
      } else {
        nextRow = await withLoaderTimeout(
          () => getCustomTablesApi().updateCustomRow?.({
            tableName: activeTable.name,
            id: editingRow?.id,
            data: payload,
            expectedUpdatedAt: editingRow?.updated_at || undefined,
          }),
          `Update row in ${activeTable.display_name || activeTable.name}`,
          CUSTOM_TABLE_MUTATION_TIMEOUT_MS,
        )
        notify(t('row_updated') || 'Row updated')
      }
      setRowModal(null)
      setRowForm({})
      await loadTableData(activeTable.name)
      if (rowModal === 'create') {
        let createdRowId = getHistoryResultId(nextRow)
        const createdSnapshot = cloneHistorySnapshot(nextRow || { ...payload, id: createdRowId }) as CustomRow
        if (createdRowId > 0) {
          actionHistory.pushAction({
            label: `Add row to ${activeTable.display_name || activeTable.name}`,
            undo: async () => {
              await withLoaderTimeout(
                () => getCustomTablesApi().deleteCustomRow?.({
                  tableName: activeTable.name,
                  id: createdRowId,
                  payload: {},
                }),
                `Undo add row in ${activeTable.display_name || activeTable.name}`,
                CUSTOM_TABLE_MUTATION_TIMEOUT_MS,
              )
              await loadTableData(activeTable.name)
            },
            redo: async () => {
              const redoResult = await withLoaderTimeout(
                () => getCustomTablesApi().insertCustomRow?.({ tableName: activeTable.name, data: buildRowPayload(activeSchema, createdSnapshot) }),
                `Redo add row in ${activeTable.display_name || activeTable.name}`,
                CUSTOM_TABLE_MUTATION_TIMEOUT_MS,
              )
              createdRowId = getHistoryResultId(redoResult)
              await loadTableData(activeTable.name)
            },
          })
        }
      } else if (previousSnapshot) {
        const nextSnapshot = cloneHistorySnapshot(nextRow || { ...previousSnapshot, ...payload, id: previousSnapshot.id }) as CustomRow
        actionHistory.pushAction({
          label: `Edit row in ${activeTable.display_name || activeTable.name}`,
          undo: async () => {
            await withLoaderTimeout(
              () => getCustomTablesApi().updateCustomRow?.({
                tableName: activeTable.name,
                id: previousSnapshot.id,
                data: buildRowPayload(activeSchema, previousSnapshot),
              }),
              `Undo row edit in ${activeTable.display_name || activeTable.name}`,
              CUSTOM_TABLE_MUTATION_TIMEOUT_MS,
            )
            await loadTableData(activeTable.name)
          },
          redo: async () => {
            await withLoaderTimeout(
              () => getCustomTablesApi().updateCustomRow?.({
                tableName: activeTable.name,
                id: nextSnapshot.id,
                data: buildRowPayload(activeSchema, nextSnapshot),
              }),
              `Redo row edit in ${activeTable.display_name || activeTable.name}`,
              CUSTOM_TABLE_MUTATION_TIMEOUT_MS,
            )
            await loadTableData(activeTable.name)
          },
        })
      }
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to save row'), 'error')
    } finally {
      finishSingleAction(saveRowInFlightRef)
      setSavingRow(false)
    }
  }

  const handleDeleteRow = async (id: string | number) => {
    if (!activeTable?.name || !beginSingleAction(deleteRowInFlightRef, { blocked: !!deletingRowId, value: id })) return
    if (!confirm(t('confirm_delete_row') || 'Delete this row?')) {
      finishSingleAction(deleteRowInFlightRef)
      return
    }
    setDeletingRowId(id)
    try {
      const row = cloneHistorySnapshot(tableData.find((entry) => Number(entry.id) === Number(id))) as CustomRow | null
      await withLoaderTimeout(
        () => getCustomTablesApi().deleteCustomRow?.({
          tableName: activeTable.name,
          id,
          payload: { expectedUpdatedAt: row?.updated_at || undefined },
        }),
        `Delete row from ${activeTable.display_name || activeTable.name}`,
        CUSTOM_TABLE_MUTATION_TIMEOUT_MS,
      )
      await loadTableData(activeTable.name)
      let restoredRowId = 0
      if (row) {
        actionHistory.pushAction({
          label: `Delete row from ${activeTable.display_name || activeTable.name}`,
          undo: async () => {
            const undoResult = await withLoaderTimeout(
              () => getCustomTablesApi().insertCustomRow?.({ tableName: activeTable.name, data: buildRowPayload(activeSchema, row) }),
              `Undo delete row from ${activeTable.display_name || activeTable.name}`,
              CUSTOM_TABLE_MUTATION_TIMEOUT_MS,
            )
            restoredRowId = getHistoryResultId(undoResult)
            await loadTableData(activeTable.name)
          },
          redo: async () => {
            const targetId = restoredRowId || Number(row.id || 0)
            if (!targetId) return
            await withLoaderTimeout(
              () => getCustomTablesApi().deleteCustomRow?.({ tableName: activeTable.name, id: targetId, payload: {} }),
              `Redo delete row from ${activeTable.display_name || activeTable.name}`,
              CUSTOM_TABLE_MUTATION_TIMEOUT_MS,
            )
            await loadTableData(activeTable.name)
          },
        })
      }
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to delete row'), 'error')
    } finally {
      finishSingleAction(deleteRowInFlightRef)
      setDeletingRowId(null)
    }
  }

  const openAddRow = () => {
    const initial: Record<string, unknown> = {}
    activeSchema.forEach((column) => { initial[column.name] = column.type === 'boolean' ? '0' : '' })
    setRowForm(initial)
    setRowModal('create')
  }

  const openEditRow = (row: CustomRow) => {
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
              <ActionHistoryBar history={typedActionHistory} className="mb-3" />
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
                                : formatCellValue(row[column.name])}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                              <button onClick={() => openEditRow(row)} className="text-xs text-blue-500 hover:underline" disabled={savingRow || !!deletingRowId}>
                                {t('edit') || 'Edit'}
                              </button>
                              <button onClick={() => { if (row.id != null) handleDeleteRow(row.id) }} className="text-xs text-red-500 hover:underline" disabled={!!deletingRowId || row.id == null}>
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
                      value={toInputValue(rowForm[column.name]) || '0'}
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
                      value={toInputValue(rowForm[column.name])}
                      onChange={(event) => setRowForm((current) => ({ ...current, [column.name]: event.target.value }))}
                    />
                  ) : (
                    <input
                      id={`custom-table-row-${column.name}`}
                      name={`custom_table_row_${column.name}`}
                      className="input"
                      type={column.type === 'number' || column.type === 'decimal' ? 'number' : column.type === 'date' ? 'date' : 'text'}
                      value={toInputValue(rowForm[column.name])}
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
