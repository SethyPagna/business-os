import { useEffect, useMemo, useState } from 'react'
import { getProductBatches, type ProductBatch } from '../../api/batchesTransport.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'

export type SaleDetailProductCandidate = Record<string, unknown> & {
  id?: number | string | null
  name?: string | null
  barcode?: string | null
  selling_price_usd?: number | string | null
  stock_quantity?: number | string | null
  branch_id?: number | string | null
  parent_id?: number | string | null
  __groupKey?: string
  __displayName?: string
  __variantLabel?: string
  __groupChoices?: SaleDetailProductCandidate[]
}

export type SaleDetailProductChoice = {
  productId: number
  name: string
  barcode: string
  unitPriceUsd: number
  stockQuantity: number
  batchId: number | null
  batchLabel: string
  batchReceivedAt: string
  batchExpiryDate: string
  batchQuantity: number | null
}

const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0

export default function SaleDetailProductPicker({ candidate, candidates, branchId, fmtUSD, t, onCancel, onChoose }: {
  candidate: SaleDetailProductCandidate
  candidates: SaleDetailProductCandidate[]
  branchId: number | string | null
  fmtUSD: (value: number) => string
  t: (key: string) => string
  onCancel: () => void
  onChoose: (choice: SaleDetailProductChoice) => void
}) {
  const options = useMemo(() => {
    if (candidate.__groupChoices?.length) return candidate.__groupChoices
    const groupKey = String(candidate.__groupKey || '')
    const parentKey = String(candidate.parent_id || '')
    const ownId = String(candidate.id || '')
    const siblings = candidates.filter((row) => {
      if (groupKey && String(row.__groupKey || '') === groupKey) return true
      if (parentKey && (String(row.parent_id || '') === parentKey || String(row.id || '') === parentKey)) return true
      return ownId && String(row.parent_id || '') === ownId
    })
    return siblings.length > 1 ? siblings : [candidate]
  }, [candidate, candidates])
  const [selectedId, setSelectedId] = useState(String(options[0]?.id ?? ''))
  const selected = options.find((option) => String(option.id) === selectedId) || options[0]
  const [batches, setBatches] = useState<ProductBatch[]>([])
  const [batchId, setBatchId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const productId = number(selected?.id)
    setBatchId(null)
    setBatches([])
    setFailed(false)
    if (!productId || branchId == null) return
    let cancelled = false
    setLoading(true)
    void getProductBatches(productId, branchId, true)
      .then((payload) => { if (!cancelled) setBatches(Array.isArray(payload?.batches) ? payload.batches : []) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selected?.id, branchId])

  const batch = batches.find((row) => row.id === batchId) || null
  const choose = () => {
    const productId = number(selected?.id)
    if (!productId || (batches.length > 0 && !batch)) return
    onChoose({
      productId,
      name: String(selected?.__displayName || selected?.name || `#${productId}`),
      barcode: String(selected?.barcode || ''),
      unitPriceUsd: number(selected?.selling_price_usd),
      stockQuantity: number(selected?.stock_quantity),
      batchId: batch?.id ?? null,
      batchLabel: batch ? batchDisplayLabel(batch, t('batch') || 'Batch') : '',
      batchReceivedAt: String(batch?.received_at || ''),
      batchExpiryDate: String(batch?.expiry_date || ''),
      batchQuantity: batch ? number(batch.quantity) : null,
    })
  }

  return (
    <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-900 dark:bg-blue-950/20">
      <div className="font-semibold text-gray-900 dark:text-white">{candidate.__displayName || candidate.name}</div>
      {options.length > 1 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-500">{t('options') || 'Options / variants'}</div>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {options.map((option) => <button key={String(option.id)} type="button" aria-pressed={String(option.id) === selectedId} onClick={() => setSelectedId(String(option.id))} className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm ${String(option.id) === selectedId ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'}`}><span className="block font-medium">{option.__variantLabel || option.name}</span><span className="block font-mono text-[11px] opacity-80">{option.barcode || (t('no_barcode') || 'No barcode')} · {fmtUSD(number(option.selling_price_usd))}</span></button>)}
          </div>
        </div>
      ) : candidate.barcode ? <div className="mt-1 font-mono text-xs text-gray-500">{candidate.barcode}</div> : null}
      <div className="mt-3">
        <div className="text-xs font-semibold text-gray-500">{t('batch') || 'Stock batch'}</div>
        {branchId == null ? <p className="mt-1 text-xs text-amber-700">{t('branch_required') || 'This sale has no branch, so an exact stock batch cannot be loaded.'}</p> : loading ? <p className="mt-1 text-xs text-gray-400">{t('loading') || 'Loading'}</p> : failed ? <p className="mt-1 text-xs text-red-600">{t('load_failed') || 'Could not load stock batches.'}</p> : batches.length ? (
          <div className="mt-1.5 space-y-2">{batches.map((row) => <button key={row.id} type="button" aria-pressed={row.id === batchId} onClick={() => setBatchId(row.id)} className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${row.id === batchId ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'}`}><span><span className="block font-mono font-medium">{batchDisplayLabel(row, t('batch') || 'Batch')}</span><span className="block text-[11px] opacity-80">{t('received_date') || 'Received'}: {row.received_at ? String(row.received_at).slice(0, 10) : '—'}{row.expiry_date ? ` · ${t('expiry_date') || 'Expiry'}: ${row.expiry_date}` : ''}</span></span><span className="shrink-0 tabular-nums">{row.quantity}</span></button>)}</div>
        ) : <p className="mt-1 text-xs text-gray-500">{t('no_batches') || 'No tracked stock batches. This item will use normal product stock.'}</p>}
      </div>
      <div className="mt-3 flex gap-2"><button type="button" className="btn-secondary flex-1 text-sm" onClick={onCancel}>{t('cancel') || 'Cancel'}</button><button type="button" className="btn-primary flex-1 text-sm" disabled={loading || failed || (batches.length > 0 && !batch)} onClick={choose}>{batches.length > 0 && !batch ? (t('select_batch_required') || 'Select a stock batch') : (t('continue') || 'Continue')}</button></div>
    </div>
  )
}
