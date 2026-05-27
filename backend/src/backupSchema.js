'use strict'

const BACKUP_VERSION = 13

const BACKUP_TABLES = [
  'categories',
  'units',
  'branches',
  'roles',
  'users',
  'products',
  'product_images',
  'branch_stock',
  'product_batches',
  'branch_batch_stock',
  'customers',
  'suppliers',
  'delivery_contacts',
  'sales',
  'sale_items',
  'sale_item_batch_allocations',
  'returns',
  'return_items',
  'return_item_batch_allocations',
  'inventory_movements',
  'stock_transfers',
  'stock_row_moves',
  'settings',
  'custom_fields',
  'custom_tables',
  'customer_share_submissions',
  'audit_logs',
  'file_assets',
  'action_history',
  'import_jobs',
  'import_job_files',
  'import_job_batches',
  'import_job_errors',
  'rfid_tags',
  'rfid_scan_sessions',
  'rfid_events',
  'rfid_session_items',
]

const BACKUP_CLEAR_ORDER = [
  'return_item_batch_allocations',
  'return_items',
  'returns',
  'sale_item_batch_allocations',
  'sale_items',
  'sales',
  'stock_row_moves',
  'inventory_movements',
  'stock_transfers',
  'branch_batch_stock',
  'product_batches',
  'branch_stock',
  'product_images',
  'products',
  'delivery_contacts',
  'customers',
  'suppliers',
  'custom_fields',
  'customer_share_submissions',
  'custom_tables',
  'categories',
  'units',
  'branches',
  'users',
  'roles',
  'settings',
  'file_assets',
  'action_history',
  'rfid_events',
  'rfid_session_items',
  'rfid_tags',
  'rfid_scan_sessions',
  'import_job_errors',
  'import_job_batches',
  'import_job_files',
  'import_jobs',
  'audit_logs',
]

const NON_BACKUP_TABLES = [
  'verification_codes',
  'system_jobs',
]

function countRowsByTable(tables = {}) {
  const counts = {}
  for (const tableName of BACKUP_TABLES) {
    const rows = Array.isArray(tables?.[tableName]) ? tables[tableName] : []
    counts[tableName] = rows.length
  }
  return counts
}

function countCustomTableRows(customTableRows = {}) {
  let total = 0
  for (const rows of Object.values(customTableRows || {})) {
    total += Array.isArray(rows) ? rows.length : 0
  }
  return total
}

function buildBackupSummary({ tables = {}, uploads = [], customTableRows = {} } = {}) {
  const tableCounts = countRowsByTable(tables)
  return buildBackupSummaryFromCounts({ tableCounts, uploads, customTableRows })
}

function buildBackupSummaryFromCounts({ tableCounts = {}, uploads = [], customTableRows = {} } = {}) {
  const normalizedCounts = {}
  let tableRowCount = 0
  for (const tableName of BACKUP_TABLES) {
    const count = Math.max(0, Number(tableCounts?.[tableName] || 0) || 0)
    normalizedCounts[tableName] = count
    tableRowCount += count
  }
  const customTableCount = Object.keys(customTableRows || {}).length
  const customTableRowCount = countCustomTableRows(customTableRows)
  const uploadCount = Array.isArray(uploads) ? uploads.length : 0

  return {
    version: BACKUP_VERSION,
    tables: normalizedCounts,
    totals: {
      tableRowCount,
      customTableCount,
      customTableRowCount,
      uploadCount,
    },
  }
}

module.exports = {
  BACKUP_VERSION,
  BACKUP_TABLES,
  BACKUP_CLEAR_ORDER,
  NON_BACKUP_TABLES,
  buildBackupSummary,
  buildBackupSummaryFromCounts,
}
