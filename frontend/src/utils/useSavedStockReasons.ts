import { useEffect, useState } from 'react'
import { getInventoryReasons } from '../api/methods.ts'

// The saved-reason catalog (settings.inventory_saved_reasons, GET
// /api/inventory/reasons) as StockReasonField wants it: one type's chips,
// already shaped { id, label }.
//
// Every stock-write surface that offers the chips used to inline the same
// fetch + Array.isArray guard + type filter + map (FastStockInModal, and
// one more per surface as the reasons came back). This is that normalization
// once. The read goes through api/methods -> inventory:reasons:get, whose
// route() layer already caches the channel, so a second surface mounting
// does not mean a second network read.
//
// A failed read yields an empty list on purpose: the free-text box stays,
// so a missing catalog never blocks a stock write.
export type SavedStockReason = { id: string; label: string }

type CatalogEntry = { id?: unknown; type?: unknown; label?: unknown }

export function savedStockReasonOptions(result: unknown, type: string): SavedStockReason[] {
  const items = Array.isArray((result as { items?: unknown })?.items)
    ? (result as { items: CatalogEntry[] }).items
    : []
  return items.flatMap((item) => item?.type === type && typeof item.label === 'string' && item.label.trim()
    ? [{ id: String(item.id ?? item.label), label: item.label }]
    : [])
}

export function useSavedStockReasons(type = 'adjust'): SavedStockReason[] {
  const [reasons, setReasons] = useState<SavedStockReason[]>([])
  useEffect(() => {
    let cancelled = false
    getInventoryReasons()
      .then((result) => { if (!cancelled) setReasons(savedStockReasonOptions(result, type)) })
      .catch(() => { if (!cancelled) setReasons([]) })
    return () => { cancelled = true }
  }, [type])
  return reasons
}
