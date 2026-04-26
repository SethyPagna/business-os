/**
 * api/localDb.js — Offline-first IndexedDB store (Dexie).
 *
 * Exports a ready-to-use `dexieDb` instance and thin helper functions
 * that mirror the server API shapes, used as fallbacks inside route().
 *
 * The DB name and version must match sw.js so the service worker shares
 * the same store when syncing in the background.
 */

import Dexie from 'dexie'

// ─── Schema (must stay in sync with sw.js) ────────────────────────────────────
export const dexieDb = new Dexie('BusinessOS')
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

// ─── Settings helpers ─────────────────────────────────────────────────────────
export async function localGetSettings() {
  const rows = await dexieDb.settings.toArray()
  const obj  = {}
  rows.forEach(r => { obj[r.key] = r.value })
  return obj
}

export async function localSaveSettings(updates) {
  await dexieDb.transaction('rw', dexieDb.settings, async () => {
    for (const [key, value] of Object.entries(updates)) {
      await dexieDb.settings.put({ key, value: String(value) })
    }
  })
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────
export function parseCSV(text) {
  if (!text) return []
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase())
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line)
    const obj  = {}
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim().replace(/^"|"$/g, '') })
    return obj
  })
}

function splitCSVLine(line) {
  const result = []; let cur = ''; let inQ = false
  for (const ch of line) {
    if (ch === '"')            { inQ = !inQ }
    else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else                       { cur += ch }
  }
  result.push(cur)
  return result
}

export function buildCSVTemplate(headers, filename) {
  const blob = new Blob([headers.join(',') + '\n'], { type: 'text/csv' })
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
