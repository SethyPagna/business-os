#!/usr/bin/env node
// Where the database bytes are, without dbstat (D1 refuses it: run 36609223741). Run by the lead on DECRYPTED ops-export files,
// locally; nothing here is published.
//
//   node ops/scripts/metrics/storage-attribution.mjs <d1-table-rows.json> <d1-payload-bytes.json> [more payload exports...]
//
// d1-table-rows gives the exact row count of every base table (384k rows read: run it once, not on a schedule), d1-payload-bytes
// and d1-growth-candidates the measured UTF-8 bytes of the big JSON and text columns. The size is the `size_after` of the same
// export. A table's estimate is its MEASURED payload bytes plus its rows times the average width of everything else:
//   rest = size_after - payload bytes;   width = rest / total rows;   estimate = payload + rows * width
// so the estimate is exact for the payload tables and an apportionment by row count for the rest (ESTIMATED: index, FTS shadow
// table and free-page overhead are spread by rows, and a table of wide rows is under-counted). The total always equals size_after.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

// Export column -> the table that holds the bytes.
export const PAYLOAD_COLUMNS = {
  sale_mutation_receipt_bytes: 'sale_mutation_receipts', sale_receipts_bytes: 'sale_mutation_receipts',
  undo_snapshot_bytes: 'undo_snapshots', undo_snapshots_payload_bytes: 'undo_snapshots',
  audit_bytes: 'audit_logs', sale_bulk_bytes: 'sale_bulk_operations',
  action_history_bytes: 'action_history', action_history_payload_bytes: 'action_history',
  stock_receipts_bytes: 'stock_mutation_receipts', return_receipts_bytes: 'return_mutation_receipts',
  transfer_receipts_bytes: 'transfer_operation_receipts', sale_events_bytes: 'sale_record_events',
  ai_log_bytes: 'ai_response_logs', rfid_event_bytes: 'rfid_events', pending_actions_closed_bytes: 'pending_actions',
  bulk_delete_jobs_bytes: 'bulk_delete_jobs', import_source_bytes_main_db: 'import_job_source_rows',
  import_rows_bytes_main_db: 'import_job_rows', import_errors_bytes: 'import_job_errors',
}

// d1-table-rows returns json_object groups in rows_1 .. rows_n.
export function tableRowsFrom(exportFile) {
  const row = (exportFile.rows || [])[0] || {}
  const counts = {}
  for (const [key, value] of Object.entries(row)) {
    if (!/^rows_\d+$/.test(key)) continue
    for (const [table, n] of Object.entries(typeof value === 'string' ? JSON.parse(value) : value)) counts[table] = Number(n)
  }
  return counts
}

export function payloadFrom(exportFiles) {
  const bytes = {}
  for (const file of exportFiles) {
    const row = (file.rows || [])[0] || {}
    for (const [column, table] of Object.entries(PAYLOAD_COLUMNS)) {
      if (!(column in row)) continue
      bytes[table] = Math.max(bytes[table] || 0, Number(row[column]) || 0)
    }
  }
  return bytes
}

export function attributeStorage({ sizeBytes, tableRows, payloadBytes = {} }) {
  const totalRows = Object.values(tableRows).reduce((n, rows) => n + rows, 0)
  const payloadTotal = Object.values(payloadBytes).reduce((n, bytes) => n + bytes, 0)
  const rest = Math.max(0, sizeBytes - payloadTotal)
  const width = totalRows > 0 ? rest / totalRows : 0
  const rows = Object.keys({ ...tableRows, ...payloadBytes }).map((table) => {
    const n = tableRows[table] || 0
    const payload = payloadBytes[table] || 0
    return { table, rows: n, measuredPayloadBytes: payload, estimatedBytes: Math.round(payload + n * width), share: 0 }
  }).sort((a, b) => b.estimatedBytes - a.estimatedBytes)
  for (const row of rows) row.share = sizeBytes > 0 ? Math.round(row.estimatedBytes / sizeBytes * 1000) / 10 : 0
  return { sizeBytes, totalRows, payloadTotal, averageRestWidthBytes: Math.round(width * 10) / 10, rows }
}

function main(argv) {
  const [tableRowsFile, ...payloadFiles] = argv
  if (!tableRowsFile) { console.error('usage: storage-attribution.mjs <d1-table-rows.json> [payload export files...]'); return 2 }
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
  const tableExport = read(tableRowsFile)
  const result = attributeStorage({ sizeBytes: Number(tableExport.meta && tableExport.meta.size_after), tableRows: tableRowsFrom(tableExport), payloadBytes: payloadFrom(payloadFiles.map(read)) })
  console.log(`size_after ${(result.sizeBytes / 1e6).toFixed(1)} MB; ${result.totalRows} rows; measured payload ${(result.payloadTotal / 1e6).toFixed(1)} MB; the rest averages ${result.averageRestWidthBytes} bytes a row (ESTIMATED)`)
  for (const row of result.rows.slice(0, 25)) {
    console.log(`${row.table.padEnd(40)} ${String(row.rows).padStart(9)} rows ${(row.estimatedBytes / 1e6).toFixed(1).padStart(7)} MB ${String(row.share).padStart(5)}%${row.measuredPayloadBytes ? `  (payload ${(row.measuredPayloadBytes / 1e6).toFixed(1)} MB measured)` : ''}`)
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2))
