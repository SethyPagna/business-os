import { useEffect, useMemo, useState } from 'react'
import { getProductBatches, type ProductBatch } from '../../api/batchesTransport.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import Modal from '../shared/Modal.tsx'

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
  quantity: number
  unitPriceUsd: number
  stockQuantity: number
  batchId: number | null
  batchLabel: string
  batchReceivedAt: string
  batchExpiryDate: string
  batchQuantity: number | null
}

const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0

export default function SaleDetailProductPicker({ candidate, candidates, branchId, fmtUSD, t, stockMoves, stagedLines, onCancel, onChoose }: {
  candidate: SaleDetailProductCandidate
  candidates: SaleDetailProductCandidate[]
  branchId: number | string | null
  fmtUSD: (value: number) => string
  t: (key: string) => string
  stockMoves: boolean
  stagedLines: ReadonlyArray<{ productId: number; batchId: number | null; quantity: number }>
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
  const [loadedSelectionKey, setLoadedSelectionKey] = useState('')
  const [quantityText, setQuantityText] = useState('1')
  const [priceText, setPriceText] = useState(String(number(selected?.selling_price_usd)))

  useEffect(() => {
    setSelectedId(String(options[0]?.id ?? ''))
    setQuantityText('1')
  }, [candidate.id, options])

  useEffect(() => {
    setPriceText(String(number(selected?.selling_price_usd)))
  }, [selected?.id, selected?.selling_price_usd])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onCancel])

  useEffect(() => {
    const productId = number(selected?.id)
    const selectionKey = productId && branchId != null ? `${productId}:${String(branchId)}` : ''
    setBatchId(null)
    setBatches([])
    setFailed(false)
    setLoadedSelectionKey('')
    if (!selectionKey || branchId == null) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    void getProductBatches(productId, branchId, true)
      .then((payload) => {
        if (cancelled) return
        setBatches(Array.isArray(payload?.batches) ? payload.batches : [])
        setLoadedSelectionKey(selectionKey)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selected?.id, branchId])

  const batch = batches.find((row) => row.id === batchId) || null
  const rawQuantity = Number(quantityText)
  const parsedQuantity = Math.max(1, Math.floor(rawQuantity || 1))
  const parsedPrice = Number(priceText)
  const quantityValid = Number.isInteger(rawQuantity) && rawQuantity >= 1
  const priceValid = priceText.trim() !== '' && Number.isFinite(parsedPrice) && parsedPrice >= 0
  const productId = number(selected?.id)
  const selectionKey = productId && branchId != null ? `${productId}:${String(branchId)}` : ''
  // This key closes the render-before-effect window on BOTH dimensions. Old
  // batches can still be present for one render after an option/branch switch,
  // but they can neither render as selectable nor enable Continue.
  const batchesReady = !!selectionKey && loadedSelectionKey === selectionKey && !loading && !failed
  const selectedBatchId = batch?.id ?? null
  const stagedQuantity = stagedLines
    .filter((row) => row.productId === productId && row.batchId === selectedBatchId)
    .reduce((sum, row) => sum + number(row.quantity), 0)
  const trackedAvailableQuantity = batches.reduce((sum, row) => sum + number(row.quantity), 0)
  const availableQuantity = batch
    ? number(batch.quantity)
    : batches.length > 0 ? trackedAvailableQuantity : number(selected?.stock_quantity)
  const availableAfterStaged = Math.max(0, availableQuantity - stagedQuantity)
  const availabilityKnown = batchesReady
    && (batches.length === 0 || batch != null || trackedAvailableQuantity <= 0)
  const stockError = stockMoves && availabilityKnown && availableAfterStaged <= 0 ? 'no-stock'
    : stockMoves && availabilityKnown && parsedQuantity > availableAfterStaged ? 'not-enough-stock'
      : null
  const choose = () => {
    if (!productId || !batchesReady || !quantityValid || !priceValid || stockError || (batches.length > 0 && !batch)) return
    onChoose({
      productId,
      name: String(selected?.__displayName || selected?.name || `#${productId}`),
      barcode: String(selected?.barcode || ''),
      quantity: parsedQuantity,
      unitPriceUsd: parsedPrice,
      stockQuantity: number(selected?.stock_quantity),
      batchId: batch?.id ?? null,
      batchLabel: batch ? batchDisplayLabel(batch, t('batch') || 'Batch') : '',
      batchReceivedAt: String(batch?.received_at || ''),
      batchExpiryDate: String(batch?.expiry_date || ''),
      batchQuantity: batch ? number(batch.quantity) : null,
    })
  }

  return (
    <Modal
      title={`${t('product') || 'Product'} — ${candidate.__displayName || candidate.name || ''}`}
      onClose={onCancel}
      size="lg"
      layer="nested"
      unsavedChanges="read-only"
    >
      <div className="space-y-4">
      {options.length > 1 ? (
        <div>
          <div className="text-xs font-semibold text-gray-500">{t('options') || 'Options / variants'}</div>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {options.map((option) => <button key={String(option.id)} type="button" aria-pressed={String(option.id) === selectedId} onClick={() => setSelectedId(String(option.id))} className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm ${String(option.id) === selectedId ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'}`}><span className="block font-medium">{option.__variantLabel || option.name}</span><span className="block font-mono text-[11px] opacity-80">{option.barcode || (t('no_barcode') || 'No barcode')} · {fmtUSD(number(option.selling_price_usd))}</span></button>)}
          </div>
        </div>
      ) : null}

      <dl className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 p-3 sm:grid-cols-2 dark:border-gray-700">
        <div>
          <dt className="text-xs font-semibold text-gray-500">{t('barcode') || 'Barcode'}</dt>
          <dd className="mt-1 break-all font-mono text-sm text-gray-900 dark:text-white">{selected?.barcode || (t('no_barcode') || 'No barcode')}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-gray-500">{t('received_date') || 'Received'}</dt>
          <dd className="mt-1 text-sm text-gray-900 dark:text-white">{batch?.received_at ? String(batch.received_at).slice(0, 10) : '—'}</dd>
        </div>
        <div>
          <label htmlFor="sale-detail-picker-quantity" className="text-xs font-semibold text-gray-500">{t('qty_short') || 'Qty'}</label>
          <input
            id="sale-detail-picker-quantity"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={quantityText}
            onChange={(event) => setQuantityText(event.target.value)}
            className="input mt-1 h-10 text-sm"
          />
        </div>
        <div>
          <label htmlFor="sale-detail-picker-price" className="text-xs font-semibold text-gray-500">{t('unit_price') || 'Unit price'}</label>
          <input
            id="sale-detail-picker-price"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            autoFocus
            value={priceText}
            onChange={(event) => setPriceText(event.target.value)}
            className="input mt-1 h-10 text-sm"
          />
        </div>
      </dl>

      <div>
        <div className="text-xs font-semibold text-gray-500">{t('batch') || 'Stock batch'}</div>
        {branchId == null ? <p className="mt-1 text-xs text-amber-700">{t('branch_required') || 'This sale has no branch, so an exact stock batch cannot be loaded.'}</p> : failed ? <p className="mt-1 text-xs text-red-600">{t('load_failed') || 'Could not load stock batches.'}</p> : !batchesReady ? <p className="mt-1 text-xs text-gray-400">{t('loading') || 'Loading'}</p> : batches.length ? (
          <div className="mt-1.5 space-y-2">{batches.map((row) => <button key={row.id} type="button" aria-pressed={row.id === batchId} onClick={() => setBatchId(row.id)} className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${row.id === batchId ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'}`}><span><span className="block font-mono font-medium">{batchDisplayLabel(row, t('batch') || 'Batch')}</span><span className="block text-[11px] opacity-80">{t('received_date') || 'Received'}: {row.received_at ? String(row.received_at).slice(0, 10) : '—'}{row.expiry_date ? ` · ${t('expiry_date') || 'Expiry'}: ${row.expiry_date}` : ''}</span></span><span className="shrink-0 tabular-nums">{row.quantity}</span></button>)}</div>
        ) : <p className="mt-1 text-xs text-gray-500">{t('no_batches') || 'No tracked stock batches. This item will use normal product stock.'}</p>}
      </div>
      {stockError ? <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">{`${t('error') || 'Error'}: ${stockError === 'no-stock' ? t('no_stock_in_branch') : t('not_enough_stock')}`}</p> : null}
      <div className="flex gap-2"><button type="button" className="btn-secondary flex-1 text-sm" onClick={onCancel}>{t('cancel') || 'Cancel'}</button><button type="button" className="btn-primary flex-1 text-sm" disabled={!batchesReady || loading || failed || !!stockError || !quantityValid || !priceValid || (batches.length > 0 && !batch)} onClick={choose}>{batches.length > 0 && !batch ? (t('select_batch_required') || 'Select a stock batch') : (t('continue') || 'Continue')}</button></div>
      </div>
    </Modal>
  )
}
