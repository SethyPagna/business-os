// Products Shared Primitives
// Small reusable display components used across the Products module.

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ImageOff } from 'lucide-react'

function sanitizeNumericInput(value, { allowDecimal = true, allowNegative = false } = {}) {
  let next = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '')
  if (!allowNegative) next = next.replace(/-/g, '')
  else if (next.includes('-')) next = `${next.startsWith('-') ? '-' : ''}${next.replace(/-/g, '')}`
  if (!allowDecimal) return next.replace(/\./g, '')
  const dotIndex = next.indexOf('.')
  if (dotIndex === -1) return next
  return `${next.slice(0, dotIndex + 1)}${next.slice(dotIndex + 1).replace(/\./g, '')}`
}

function parseNumericInput(value, fallback = 0) {
  if (value === '' || value === null || typeof value === 'undefined') return fallback
  const parsed = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function ProductImg({ src, alt, className, onClick }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const imageRequestRef = useRef(0)

  useEffect(() => {
    const requestId = imageRequestRef.current + 1
    imageRequestRef.current = requestId
    setFailed(false)
    if (!src) {
      setUrl(null)
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }
    if (src.startsWith('data:') || src.startsWith('blob:')) {
      setUrl(src)
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }
    if (src.startsWith('http')) {
      setUrl(src)
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }
    if (src.startsWith('/uploads/')) {
      const base = (typeof window !== 'undefined' && window.api?.getSyncServerUrl?.())
        || localStorage.getItem('businessos_sync_server')
        || ''
      setUrl(base ? `${base.replace(/\/$/, '')}${src}` : src)
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }
    if (window.api?.getImageDataUrl) {
      async function loadImageData() {
        try {
          const data = await window.api.getImageDataUrl(src)
          if (imageRequestRef.current !== requestId) return
          setUrl(data || null)
        } catch {
          if (imageRequestRef.current !== requestId) return
          setUrl(null)
        }
      }
      loadImageData()
    } else {
      setUrl(null)
    }

    return () => {
      imageRequestRef.current = requestId + 1
    }
  }, [src])

  if (!url || failed) return null
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onClick={onClick}
      onError={() => setFailed(true)}
      loading="lazy"
      decoding="async"
    />
  )
}

function ProductImagePlaceholder({ className = '', compact = false }) {
  return (
    <div className={`flex items-center justify-center rounded-xl bg-gray-100 text-gray-400 dark:bg-gray-700/80 dark:text-gray-500 ${className}`}>
      <ImageOff className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
    </div>
  )
}

function MarginCard({ purchaseUsd, sellingUsd, usdSymbol }) {
  const margin = sellingUsd - purchaseUsd
  const pct = sellingUsd > 0 ? (margin / sellingUsd * 100) : 0
  const isProfit = margin >= 0

  return (
    <div className={`rounded-xl border p-4 ${isProfit ? 'border-blue-100 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20' : 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20'}`}>
      <p className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Margin Analysis</p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-lg font-bold text-red-600">{usdSymbol}{purchaseUsd.toFixed(2)}</div>
          <div className="text-xs text-gray-500">Purchase</div>
        </div>
        <div>
          <div className={`text-lg font-bold ${isProfit ? 'text-blue-600' : 'text-yellow-600'}`}>{usdSymbol}{margin.toFixed(2)}</div>
          <div className="text-xs text-gray-500">Margin ({pct.toFixed(1)}%)</div>
        </div>
        <div>
          <div className="text-lg font-bold text-green-600">{usdSymbol}{sellingUsd.toFixed(2)}</div>
          <div className="text-xs text-gray-500">Selling</div>
        </div>
      </div>
      {!isProfit ? (
        <p className="mt-2 flex items-center justify-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          Selling price is below purchase price
        </p>
      ) : null}
    </div>
  )
}

function DualPriceInput({ labelUsd, labelKhr, valueUsd, valueKhr, onUsdChange, onKhrChange, usdSymbol, khrSymbol, exchangeRate, t }) {
  const handleUsdChange = (val) => onUsdChange(sanitizeNumericInput(val))
  const handleKhrChange = (val) => onKhrChange(sanitizeNumericInput(val))

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{labelUsd} ({usdSymbol})</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{usdSymbol}</span>
          <input
            className="input pl-7"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={valueUsd ?? ''}
            onChange={(event) => handleUsdChange(event.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{labelKhr} ({khrSymbol})</label>
        <div className="relative">
          <input
            className="input pr-7"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={valueKhr ?? ''}
            onChange={(event) => handleKhrChange(event.target.value)}
            placeholder="0"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{khrSymbol}</span>
        </div>
      </div>
    </div>
  )
}

export { ProductImg, ProductImagePlaceholder, MarginCard, DualPriceInput, sanitizeNumericInput, parseNumericInput }
