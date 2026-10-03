import Modal from './Modal'
import { useApp, type AppContextCoreValue } from '../../app/AppContextCore.tsx'
import { ConflictIcon, CONFLICT_ICON_CLASS } from './ConflictIcon.ts'
import { fmtDateTime24 } from '../../utils/formatters.ts'

type ConflictEntity = 'settings' | 'sale' | 'return' | 'user' | 'role' | string
type ConflictRecord = Record<string, unknown>

interface ConflictSummaryRow {
  key: string
  label: string
  value: string
}

interface ConflictFieldRow {
  key: string
  label: string
  attempted: string
  current: string
}

interface WriteConflict {
  entity?: ConflictEntity
  entityLabel?: string
  attempted?: ConflictRecord
  current?: ConflictRecord
  expectedUpdatedAt?: unknown
  actualUpdatedAt?: unknown
}

interface WriteConflictModalProps {
  conflict?: WriteConflict | null
  onClose: () => void
  onReload: () => void
}

type Translate = (key: string, fallback: string) => string

const FIELD_KEYS: Record<string, string> = {
  id: 'record_id', name: 'name', username: 'username', email: 'email', phone: 'phone',
  location: 'location', manager: 'manager', notes: 'notes', description: 'description',
  is_default: 'default', is_active: 'active', status: 'status', sale_status: 'status',
  customer_name: 'customer', customer_id: 'customer', role_name: 'role', role_id: 'role',
  role: 'role', code: 'write_conflict_code', permissions: 'permissions', barcode: 'barcode',
  reason: 'reason', return_type: 'type', items: 'items', updated_at: 'updated', created_at: 'created',
  sale_number: 'sale', return_number: 'return', total_refund_usd: 'refund',
}

const ENTITY_KEYS: Record<string, string> = {
  settings: 'settings', sale: 'sale', return: 'return', user: 'user', role: 'role', product: 'product',
  branch: 'branch', fee: 'write_conflict_fee', customer: 'customer', supplier: 'supplier',
  delivery_contact: 'delivery_contact', category: 'category', ai_provider_config: 'write_conflict_ai_provider',
  unit: 'unit', 'file asset': 'write_conflict_file',
}

function asConflictRecord(value: unknown): ConflictRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ConflictRecord : {}
}

function fieldLabel(key: string, tr: Translate): string {
  const label = Object.hasOwn(FIELD_KEYS, key) ? tr(FIELD_KEYS[key], key) : key
  return key === 'total_refund_usd' ? label + ' (USD)' : label
}

function formatConflictTime(value: unknown, tr: Translate): string {
  if (!value) return tr('unknown', 'Unknown')
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return fmtDateTime24(date)
}

function formatValue(value: unknown, tr: Translate, key = ''): string {
  if (value == null || value === '') return tr('write_conflict_empty', 'Not set')
  if (typeof value === 'boolean' || (['is_active', 'is_default'].includes(key) && (value === 0 || value === 1))) {
    return value ? tr('yes', 'Yes') : tr('no', 'No')
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function summarizeCurrentValue(entity: string, current: unknown, tr: Translate): ConflictSummaryRow[] {
  const record = asConflictRecord(current)
  const fields: Record<string, string[]> = {
    sale: ['sale_number', 'status', 'customer_name', 'updated_at'],
    return: ['return_number', 'reason', 'return_type', 'updated_at'],
    user: ['name', 'username', 'email', 'updated_at'],
    role: ['name', 'code', 'updated_at'], product: ['name', 'barcode', 'updated_at'],
    branch: ['name', 'notes', 'location', 'manager', 'phone', 'is_default', 'updated_at'],
  }
  const summaryFields = Object.hasOwn(fields, entity) ? fields[entity] : null
  const keys = summaryFields || Object.keys(record)
    .filter(key => entity !== 'settings' || (record[key] != null && record[key] !== ''))
    .slice(0, entity === 'settings' ? 6 : 4)
  return keys.filter(key => !summaryFields || (record[key] != null && record[key] !== ''))
    .map(key => ({
      key,
      label: key === 'name' && ['role', 'product', 'branch'].includes(entity) ? tr(entity, entity)
        : fieldLabel(entity === 'branch' && key === 'notes' ? 'description' : key, tr),
      value: key.endsWith('_at') ? formatConflictTime(record[key], tr) : formatValue(record[key], tr, key),
    }))
}

function formatItemSummary(value: unknown, tr: Translate): string {
  if (!Array.isArray(value)) return ''
  return value.map(item => {
    const record = asConflictRecord(item)
    const productName = record.product_name || tr('item', 'Item')
    const quantity = record.quantity || ''
    const noRestock = record.return_to_stock === false ? ' (' + tr('write_conflict_no_restock', 'no restock') + ')' : ''
    return productName + ' x' + quantity + noRestock
  }).join(', ')
}

function getConflictFieldRows(conflict: WriteConflict, tr: Translate): ConflictFieldRow[] {
  const entity = String(conflict.entity || '').trim().toLowerCase()
  const attempted = asConflictRecord(conflict.attempted)
  const current = asConflictRecord(conflict.current)
  const row = (key: string, labelKey = key, attemptedValue = attempted[key], currentValue = current[key]): ConflictFieldRow => ({
    key,
    label: fieldLabel(labelKey, tr), attempted: formatValue(attemptedValue, tr, key), current: formatValue(currentValue, tr, key),
  })
  if (entity === 'settings') return Object.keys(attempted).map(key => row(key))
  if (entity === 'branch') return ['location', 'phone', 'manager', 'notes', 'is_default'].filter(key =>
    Object.prototype.hasOwnProperty.call(attempted, key)).map(key => row(key, key === 'notes' ? 'description' : key))
  if (entity === 'sale') {
    const rows: ConflictFieldRow[] = []
    if (Object.prototype.hasOwnProperty.call(attempted, 'sale_status')) rows.push(row('sale_status'))
    if (Object.prototype.hasOwnProperty.call(attempted, 'customer_name') || Object.prototype.hasOwnProperty.call(attempted, 'customer_id')) {
      rows.push(row('customer_name', 'customer_name', attempted.customer_name || attempted.customer_id, current.customer_name || current.customer_id))
    }
    if (Object.prototype.hasOwnProperty.call(attempted, 'notes')) rows.push(row('notes'))
    return rows
  }
  if (entity === 'return') {
    const rows = ['reason', 'return_type', 'notes', 'total_refund_usd'].map(key => row(key))
    const attemptedItems = formatItemSummary(attempted.items, tr)
    const currentItems = formatItemSummary(current.items, tr)
    if (attemptedItems || currentItems) rows.push(row('items', 'items', attemptedItems, currentItems))
    return rows
  }
  const present = (key: string): boolean => [attempted[key], current[key]].some(value => value != null && value !== '')
  if (entity === 'user') return ['name', 'username', 'email', 'phone', 'role_name', 'is_active']
    .filter(key => key === 'role_name' ? present('role_name') || present('role_id') : present(key))
    .map(key => key === 'role_name' ? row(key, key, attempted.role_name || attempted.role_id, current.role_name || current.role_id) : row(key))
  if (entity === 'role') return ['name', 'permissions'].filter(present).map(key => ({
    ...row(key), label: key === 'name' ? tr('role_name', 'Role name') : fieldLabel(key, tr),
  }))
  return []
}

export default function WriteConflictModal({ conflict, onClose, onReload }: WriteConflictModalProps) {
  const { t } = useApp() as Pick<AppContextCoreValue, 't'>
  const tr: Translate = (key, fallback) => { const value = t(key); return typeof value === 'string' && value !== key ? value : fallback }
  if (!conflict) return null

  const entity = String(conflict.entity || '').trim().toLowerCase()
  const entityLabel = Object.hasOwn(ENTITY_KEYS, entity) ? tr(ENTITY_KEYS[entity], conflict.entityLabel || entity) : conflict.entityLabel || tr('item', 'Item')
  const currentSummary = summarizeCurrentValue(entity, conflict.current, tr)
  const fieldRows = getConflictFieldRows(conflict, tr)

  return (
    <Modal title={<span className="inline-flex min-w-0 items-center gap-2"><ConflictIcon aria-hidden="true" className={`h-4 w-4 shrink-0 ${CONFLICT_ICON_CLASS}`} /><span className="min-w-0">{tr('write_conflict_title', '{entity} changed on another device').replace('{entity}', entityLabel)}</span></span>} onClose={onClose} size="lg" unsavedChanges="read-only">
      <div className="space-y-5 text-sm text-gray-700 dark:text-gray-300">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-900/20">
          <p className="font-semibold text-amber-800 dark:text-amber-300">
            {tr('write_conflict_older_version', 'Your screen was holding an older version of this {entityLower}.').replace('{entityLower}', entityLabel.toLowerCase())}
          </p>
          <p className="mt-1 text-amber-700 dark:text-amber-200">
            {tr('write_conflict_background_refresh', 'We already refreshed the latest data in the background so you can review what won before trying again.')}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {tr('write_conflict_expected_version', 'Your version expected')}
            </div>
            <div className="mt-1 font-medium text-gray-900 dark:text-white">
              {formatConflictTime(conflict.expectedUpdatedAt, tr)}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {tr('write_conflict_latest_version', 'Latest saved version')}
            </div>
            <div className="mt-1 font-medium text-gray-900 dark:text-white">
              {formatConflictTime(conflict.actualUpdatedAt, tr)}
            </div>
          </div>
        </div>

        {fieldRows.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
              {tr('write_conflict_comparison', 'Your edit vs current saved values')}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {fieldRows.map((row) => (
                <div key={row.key} className="grid gap-3 px-4 py-3 sm:grid-cols-[140px_1fr_1fr]">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {row.label}
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">{tr('write_conflict_your_edit', 'Your edit')}</div>
                    <div className="mt-1 break-words text-gray-900 dark:text-white">{row.attempted}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">{tr('write_conflict_current_saved', 'Current saved')}</div>
                    <div className="mt-1 break-words text-gray-900 dark:text-white">{row.current}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentSummary.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
              {tr('write_conflict_details', 'Current saved details')}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {currentSummary.map((row) => (
                <div key={row.key} className="flex items-start justify-between gap-4 px-4 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {row.label}
                  </span>
                  <span className="max-w-[60%] break-words text-right text-gray-900 dark:text-white">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            {tr('dismiss', 'Dismiss')}
          </button>
          <button type="button" onClick={onReload} className="btn-primary">
            {tr('write_conflict_reload_latest', 'Reload latest')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
