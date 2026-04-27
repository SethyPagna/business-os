// Products Shared Primitives
// Small reusable display components used across the Products module.

import { useEffect, useState } from 'react'
import { AlertTriangle, ImageOff } from 'lucide-react'

function ProductImg({ src, alt, className, onClick }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    if (!src) {
      setUrl(null)
      return
    }
    if (src.startsWith('data:') || src.startsWith('blob:')) {
      setUrl(src)
      return
    }
    if (src.startsWith('http')) {
      setUrl(src)
      return
    }
    if (src.startsWith('/uploads/')) {
      const base = (typeof window !== 'undefined' && window.api?.getSyncServerUrl?.())
        || localStorage.getItem('businessos_sync_server')
        || ''
      setUrl(base ? `${base.replace(/\/$/, '')}${src}` : src)
      return
    }
    if (window.api?.getImageDataUrl) {
      window.api.getImageDataUrl(src).then((data) => setUrl(data || null))
    } else {
      setUrl(null)
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
  const handleUsdChange = (val) => {
    const num = parseFloat(val) || 0
    onUsdChange(num)
    if (!valueKhr) onKhrChange(num * exchangeRate)
  }

  const handleKhrChange = (val) => {
    const num = parseFloat(val) || 0
    onKhrChange(num)
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{labelUsd} ({usdSymbol})</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{usdSymbol}</span>
          <input className="input pl-7" type="number" step="0.01" min="0" value={valueUsd || ''} onChange={(event) => handleUsdChange(event.target.value)} placeholder="0.00" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{labelKhr} ({khrSymbol})</label>
        <div className="relative">
          <input className="input pr-7" type="number" step="1" min="0" value={valueKhr || ''} onChange={(event) => handleKhrChange(event.target.value)} placeholder="0" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{khrSymbol}</span>
        </div>
      </div>
    </div>
  )
}

export { ProductImg, ProductImagePlaceholder, MarginCard, DualPriceInput }
