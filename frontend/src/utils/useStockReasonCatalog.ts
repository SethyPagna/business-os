import { useCallback, useEffect, useRef, useState } from 'react'
import { getInventoryReasons, saveInventoryReasons } from '../api/methods.ts'
import type { ConfirmRequest } from '../components/shared/useConfirmDialog.tsx'

// The saved stock-reason catalog (settings.inventory_saved_reasons) behind
// StockReasonsManagerModal: load, add, rename with a linked-record preview, delete.

export type StockReasonType = 'adjust' | 'transfer' | 'move' | 'delete'
export const STOCK_REASON_TYPES: StockReasonType[] = ['adjust', 'transfer', 'move', 'delete']
export type StockReasonEntry = { id: string; type: StockReasonType; label: string }

const isStockReasonType = (value: unknown): value is StockReasonType => STOCK_REASON_TYPES.includes(value as StockReasonType)
const sameLabel = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

export function normalizeStockReasonCatalog(result: unknown): StockReasonEntry[] {
  const items = Array.isArray((result as { items?: unknown })?.items) ? (result as { items: unknown[] }).items : []
  return items.flatMap((raw) => {
    const item = raw as { id?: unknown; type?: unknown; label?: unknown }
    if (!isStockReasonType(item?.type) || typeof item.label !== 'string' || !item.label.trim()) return []
    return [{ id: String(item.id ?? `${item.type}:${item.label}`), type: item.type, label: item.label.trim() }]
  })
}

/** The catalog with one more reason of that type, or null when that type already has it. */
export function withStockReason(items: StockReasonEntry[], type: StockReasonType, label: string, now = Date.now()): StockReasonEntry[] | null {
  const clean = label.trim().replace(/\s+/g, ' ')
  if (!clean || items.some((item) => item.type === type && sameLabel(item.label, clean))) return null
  return [...items, { id: `${type}:${now}`, type, label: clean }]
}

export function withoutStockReason(items: StockReasonEntry[], id: string): StockReasonEntry[] {
  return items.filter((item) => item.id !== id)
}

export function stockReasonsOfType(items: StockReasonEntry[], type: StockReasonType): StockReasonEntry[] {
  return items.filter((item) => item.type === type)
}

type Translate = (key: string, fallback: string) => string

export function useStockReasonCatalog({ notify, tr, askToConfirm, onChanged }: {
  notify: (message: string, type?: string) => void
  tr: Translate
  askToConfirm: (request: ConfirmRequest) => Promise<boolean>
  onChanged?: () => void
}) {
  const [items, setItems] = useState<StockReasonEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(normalizeStockReasonCatalog(await getInventoryReasons()))
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('stock_reasons_load_failed', 'Failed to load saved reasons'), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify, tr])
  const loadRef = useRef(load)
  loadRef.current = load

  // Once per mount: a host that re-creates notify or tr must not re-read the catalog on every render.
  useEffect(() => { void loadRef.current() }, [])

  const save = useCallback(async (next: StockReasonEntry[]): Promise<boolean> => {
    setSaving(true)
    try {
      const result = await saveInventoryReasons(next) as { pending?: boolean; items?: unknown } | null
      // Review Required queues the write: nothing changed yet, so the list stays as it was.
      if (result?.pending) {
        notify(tr('reason_submitted_for_review', 'Submitted for review -- changes will appear once approved.'))
        return true
      }
      setItems(Array.isArray(result?.items) ? normalizeStockReasonCatalog(result) : next)
      onChanged?.()
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('save_failed', 'Save failed'), 'error')
      return false
    } finally {
      setSaving(false)
    }
  }, [notify, onChanged, tr])

  const add = useCallback(async (type: StockReasonType, label: string): Promise<boolean> => {
    const next = withStockReason(itemsRef.current, type, label)
    if (!next) {
      notify(tr('return_reason_exists_notice', 'That reason already exists.'), 'info')
      return false
    }
    return save(next)
  }, [notify, save, tr])

  const remove = useCallback(async (entry: StockReasonEntry) => save(withoutStockReason(itemsRef.current, entry.id)), [save])

  const rename = useCallback(async (entry: StockReasonEntry, to: string): Promise<boolean> => {
    setSaving(true)
    try {
      const [{ getInventoryReasonImpact }, { replaceInventoryReason }] = await Promise.all([
        import('../api/inventoryTransport.ts'),
        import('../api/inventoryWriteTransport.ts'),
      ])
      const impact = await getInventoryReasonImpact(entry.type, entry.label, to) as { linked_records?: number }
      const linked = Number(impact?.linked_records || 0)
      // Both answers save the rename: Confirm also rewrites the exact linked
      // movements, Cancel renames only the saved choice.
      const scope = linked > 0 && await askToConfirm({
        title: tr('rename_reason_prompt', 'Rename saved reason'),
        message: tr('inventory_reason_linked_notice', '{count} exact stock-movement record(s) use this reason.').replace('{count}', String(linked)),
        items: [
          { label: tr('before', 'Before'), value: entry.label },
          { label: tr('after', 'After'), value: to },
        ],
        note: tr('audit_logs_unchanged', 'Audit logs stay unchanged.'),
        confirmLabel: tr('reason_update_linked_too', 'Update linked records too'),
        cancelLabel: tr('reason_rename_saved_only', 'Rename saved reason only'),
      }) ? 'linked' : 'saved_only'
      const result = await replaceInventoryReason({ type: entry.type, from: entry.label, to, scope }) as { items?: unknown } | null
      setItems(Array.isArray(result?.items)
        ? normalizeStockReasonCatalog(result)
        : itemsRef.current.map((item) => (item.id === entry.id ? { ...item, label: to } : item)))
      notify(scope === 'linked'
        ? tr('reason_updated_linked', 'Reason and exact linked movements updated.')
        : tr('reason_updated_saved_only', 'Saved reason updated; existing movements were preserved.'), 'success')
      onChanged?.()
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('save_failed', 'Save failed'), 'error')
      return false
    } finally {
      setSaving(false)
    }
  }, [askToConfirm, notify, onChanged, tr])

  return { items, loading, saving, load, add, remove, rename }
}
