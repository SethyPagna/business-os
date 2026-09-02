/**
 * api/localDb.ts - Offline-first IndexedDB store (Dexie).
 *
 * Exports a ready-to-use `dexieDb` instance and thin helper functions
 * that mirror the server API shapes, used as fallbacks inside route().
 *
 * The DB name and version must match sw.js so the service worker shares
 * the same store when syncing in the background.
 */

import Dexie from 'dexie'
import type { Table } from 'dexie'
import { parseCsvRows } from '../utils/csvImport.ts'
import { buildCSVTemplate as buildCSVTemplateFile } from '../utils/csvTemplate.ts'

type LocalRow = Record<string, unknown>
type SettingsMap = Record<string, string>
type LocalTable = Table<LocalRow, unknown>
type LocalDexie = Dexie & {
  settings: Table<LocalRow, string>
  settings_meta: Table<LocalRow, string>
}

// ─── Schema (must stay in sync with sw.js) ────────────────────────────────────
export const dexieDb = new Dexie('BusinessOS') as LocalDexie
dexieDb.version(1).stores({
  settings:            'key',
  sync_queue:          '++_seq, id, channel, status, created_at',
  users:               '++id, username',
  roles:               '++id, name',
  products:            '++id, name, category, sku, barcode',
  categories:          '++id, name',
  units:               '++id, name',
  branches:            '++id, name',
  branch_stock:        '++id, [product_id+branch_id]',
  customers:           '++id, name, phone',
  suppliers:           '++id, name',
  delivery_contacts:   '++id, name',
  sales:               '++id, receipt_number, created_at',
  sale_items:          '++id, sale_id, product_id',
  audit_logs:          '++id, created_at',
  inventory_movements: '++id, product_id, created_at',
  stock_transfers:     '++id, created_at',
  custom_tables:       '++id, name',
  custom_fields:       '++id, entity_type',
})
dexieDb.version(2).stores({
  settings:            'key',
  settings_meta:       'key',
  sync_queue:          '++_seq, id, channel, status, created_at',
  users:               '++id, username',
  roles:               '++id, name',
  products:            '++id, name, category, sku, barcode',
  categories:          '++id, name',
  units:               '++id, name',
  branches:            '++id, name',
  branch_stock:        '++id, [product_id+branch_id]',
  customers:           '++id, name, phone',
  suppliers:           '++id, name',
  delivery_contacts:   '++id, name',
  sales:               '++id, receipt_number, created_at',
  sale_items:          '++id, sale_id, product_id',
  returns:             '++id, created_at, customer_id, supplier_id',
  audit_logs:          '++id, created_at',
  inventory_movements: '++id, product_id, created_at',
  stock_transfers:     '++id, created_at',
  custom_tables:       '++id, name',
  custom_fields:       '++id, entity_type',
})
dexieDb.version(3).stores({
  settings:            'key',
  settings_meta:       'key',
  sync_queue:          '++_seq, id, channel, status, created_at',
  users:               '++id, username',
  roles:               '++id, name',
  products:            '++id, name, category, sku, barcode',
  categories:          '++id, name',
  units:               '++id, name',
  branches:            '++id, name',
  branch_stock:        '++id, [product_id+branch_id]',
  customers:           '++id, name, phone',
  suppliers:           '++id, name',
  delivery_contacts:   '++id, name',
  sales:               '++id, receipt_number, created_at',
  sale_items:          '++id, sale_id, product_id',
  returns:             '++id, created_at, customer_id, supplier_id',
  audit_logs:          '++id, created_at',
  inventory_movements: '++id, product_id, created_at',
  stock_transfers:     '++id, created_at',
  custom_tables:       '++id, name',
  custom_fields:       '++id, entity_type',
})
dexieDb.version(4).stores({
  settings:            'key',
  settings_meta:       'key',
  sync_queue:          '++_seq, channel, status, created_at, updated_at, retry_at, entity_table, entity_id',
  users:               '++id, username',
  roles:               '++id, name',
  products:            '++id, name, category, sku, barcode',
  categories:          '++id, name',
  units:               '++id, name',
  branches:            '++id, name',
  branch_stock:        '++id, [product_id+branch_id]',
  customers:           '++id, name, phone',
  suppliers:           '++id, name',
  delivery_contacts:   '++id, name',
  sales:               '++id, receipt_number, created_at',
  sale_items:          '++id, sale_id, product_id',
  returns:             '++id, created_at, customer_id, supplier_id',
  audit_logs:          '++id, created_at',
  inventory_movements: '++id, product_id, created_at',
  stock_transfers:     '++id, created_at',
  custom_tables:       '++id, name',
  custom_fields:       '++id, entity_type',
})
dexieDb.version(5).stores({
  settings:            'key',
  settings_meta:       'key',
  sync_queue:          '++_seq, channel, status, created_at, updated_at, retry_at, entity_table, entity_id',
  sync_outbox:         '++_seq, id, operation_id, status, created_at, updated_at, retry_at, entity_table, entity_id, payload_digest, schema_version',
  offline_vault:       'key, status, updated_at',
  offline_file_chunks: '++_seq, upload_id, chunk_index, status, created_at, updated_at, payload_digest',
  users:               '++id, username',
  roles:               '++id, name',
  products:            '++id, name, category, sku, barcode',
  categories:          '++id, name',
  units:               '++id, name',
  branches:            '++id, name',
  branch_stock:        '++id, [product_id+branch_id]',
  customers:           '++id, name, phone',
  suppliers:           '++id, name',
  delivery_contacts:   '++id, name',
  sales:               '++id, receipt_number, created_at',
  sale_items:          '++id, sale_id, product_id',
  returns:             '++id, created_at, customer_id, supplier_id',
  audit_logs:          '++id, created_at',
  inventory_movements: '++id, product_id, created_at',
  stock_transfers:     '++id, created_at',
  custom_tables:       '++id, name',
  custom_fields:       '++id, entity_type',
})

// Encrypted stores keep encrypted_payload plus payload_digest/schema_version fields
// on each record; those fields are data columns, while the indexes above cover
// queue inspection, retry ordering, and integrity review.

// ─── Settings helpers ─────────────────────────────────────────────────────────
export async function localGetSettings(): Promise<SettingsMap> {
  const rows = await dexieDb.settings.toArray()
  const obj: SettingsMap = {}
  rows.forEach((r: LocalRow) => { obj[String(r.key)] = String(r.value ?? '') })
  return obj
}

export async function localSaveSettings(updates: Record<string, unknown>): Promise<void> {
  await dexieDb.transaction('rw', dexieDb.settings, async () => {
    for (const [key, value] of Object.entries(updates)) {
      await dexieDb.settings.put({ key, value: String(value) })
    }
  })
}

export async function localGetSettingsMeta(): Promise<LocalRow | null> {
  return (await dexieDb.settings_meta.get('settings')) || null
}

export async function localSaveSettingsMeta(updatedAt: unknown): Promise<unknown | null> {
  if (!updatedAt) return null
  await dexieDb.settings_meta.put({
    key: 'settings',
    updatedAt: String(updatedAt),
    savedAt: new Date().toISOString(),
  })
  return updatedAt
}

export async function replaceTableContents(tableName: string, rows: unknown): Promise<LocalRow[]> {
  const table = dexieDb.table(tableName)
  const safeRows = Array.isArray(rows)
    ? rows
      .filter((row) => row && typeof row === 'object')
      .map((row) => ({ ...(row as LocalRow) }))
    : []

  const primaryKeyPath = table.schema?.primKey?.keyPath
  const canDiffReplace = typeof primaryKeyPath === 'string'
    && safeRows.every((row) => row[primaryKeyPath] !== undefined && row[primaryKeyPath] !== null)

  if (!canDiffReplace) {
    await dexieDb.transaction('rw', table, async () => {
      await table.clear()
      if (safeRows.length) {
        await table.bulkPut(safeRows)
      }
    })
    return safeRows
  }

  const incomingMap = new Map<unknown, LocalRow>()
  for (const row of safeRows) {
    incomingMap.set(row[primaryKeyPath], row)
  }

  const incomingRows = [...incomingMap.values()]
  const incomingKeys = new Set(incomingMap.keys())
  const existingKeys = await table.toCollection().primaryKeys()
  const deleteKeys = existingKeys.filter((key) => !incomingKeys.has(key))

  await dexieDb.transaction('rw', table, async () => {
    if (deleteKeys.length) {
      await table.bulkDelete(deleteKeys)
    }
    if (incomingRows.length) {
      await table.bulkPut(incomingRows)
    }
  })

  return safeRows
}

export async function resetLocalMirrorDb(): Promise<void> {
  const tables = (Array.isArray(dexieDb.tables) ? dexieDb.tables.filter(Boolean) : []) as LocalTable[]
  if (!tables.length) return
  try {
    if (!dexieDb.isOpen()) {
      await dexieDb.open()
    }
    await dexieDb.transaction('rw', tables.map((table) => table.name), async () => {
      for (const table of tables) {
        await table.clear().catch(() => {})
      }
    })
  } catch (_) {}
}

export async function resetLocalMirrorDbPreservingOfflineWork(): Promise<void> {
  const preservedNames = new Set(['sync_queue', 'sync_outbox', 'offline_vault', 'offline_file_chunks'])
  const tables = (Array.isArray(dexieDb.tables) ? dexieDb.tables.filter((table) => table && !preservedNames.has(table.name)) : []) as LocalTable[]
  if (!tables.length) return
  try {
    if (!dexieDb.isOpen()) await dexieDb.open()
    await dexieDb.transaction('rw', tables.map((table) => table.name), async () => {
      for (const table of tables) await table.clear().catch(() => {})
    })
  } catch (_) {}
}

export async function clearLocalMirrorTables(tableNames: unknown[] = []): Promise<void> {
  const names: string[] = []
  const seenNames = new Set<string>()
  for (const value of Array.isArray(tableNames) ? tableNames : []) {
    const name = String(value || '').trim()
    if (!name || seenNames.has(name)) continue
    seenNames.add(name)
    names.push(name)
  }
  if (!names.length) return

  const tables: LocalTable[] = []
  for (const name of names) {
    try {
      tables.push(dexieDb.table(name))
    } catch (_) {}
  }

  if (!tables.length) return

  await dexieDb.transaction('rw', names, async () => {
    for (const table of tables) {
      await table.clear().catch(() => {})
    }
  })
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────
export function parseCSV(text: string) {
  return parseCsvRows(text)
}

function splitCSVLine(line: string): string[] {
  const result: string[] = []; let cur = ''; let inQ = false
  for (const ch of line) {
    if (ch === '"')            { inQ = !inQ }
    else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else                       { cur += ch }
  }
  result.push(cur)
  return result
}

export function buildCSVTemplate(headers: string[], filename: string, exampleRow?: Record<string, unknown>): void {
  buildCSVTemplateFile(headers, filename, exampleRow)
}
