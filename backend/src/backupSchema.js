'use strict'

const BACKUP_VERSION = 10

const BACKUP_TABLES = [
  'categories',
  'units',
  'branches',
  'roles',
  'users',
  'products',
  'product_images',
  'branch_stock',
  'customers',
  'suppliers',
  'delivery_contacts',
  'sales',
  'sale_items',
  'returns',
  'return_items',
  'inventory_movements',
  'stock_transfers',
  'settings',
  'custom_fields',
  'custom_tables',
  'customer_share_submissions',
  'audit_logs',
  'file_assets',
  'import_jobs',
  'import_job_files',
  'import_job_batches',
  'import_job_errors',
]

const BACKUP_CLEAR_ORDER = [
  'return_items',
  'returns',
  'sale_items',
  'sales',
  'inventory_movements',
  'stock_transfers',
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
  'import_job_errors',
  'import_job_batches',
  'import_job_files',
  'import_jobs',
  'audit_logs',
]

const NON_BACKUP_TABLES = [
  'verification_codes',
]

function countRowsByTable(tables = {}) {
  return BACKUP_TABLES.reduce((accumulator, tableName) => {
    const rows = Array.isArray(tables?.[tableName]) ? tables[tableName] : []
    accumulator[tableName] = rows.length
    return accumulator
  }, {})
}

function countCustomTableRows(customTableRows = {}) {
  return Object.values(customTableRows || {}).reduce((total, rows) => (
    total + (Array.isArray(rows) ? rows.length : 0)
  ), 0)
}

function buildBackupSummary({ tables = {}, uploads = [], customTableRows = {} } = {}) {
  const tableCounts = countRowsByTable(tables)
  const tableRowCount = Object.values(tableCounts).reduce((total, count) => total + count, 0)
  const customTableCount = Object.keys(customTableRows || {}).length
  const customTableRowCount = countCustomTableRows(customTableRows)
  const uploadCount = Array.isArray(uploads) ? uploads.length : 0

  return {
    version: BACKUP_VERSION,
    tables: tableCounts,
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
}
