import { useEffect, useState } from 'react'

export default function ReceiptPreview({ tpl, settings }) {
  const [ReceiptComp, setReceiptComp] = useState(null)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let mounted = true
    import('../receipt/Receipt')
      .then((mod) => {
        if (mounted) setReceiptComp(() => mod.default)
      })
      .catch((error) => {
        console.error('[ReceiptPreview] import Receipt failed', error)
        if (mounted) setLoadError(error)
      })
    return () => { mounted = false }
  }, [])

  const exchangeRate = parseFloat(settings.exchange_rate || '4100')
  const fakeSale = {
    receipt_number: 'RCP-PREVIEW-0001',
    cashier_name: 'Demo Cashier',
    payment_method: 'Cash',
    created_at: new Date().toISOString(),
    customer_name: 'Sample Customer',
    customer_phone: '+855 12 345 678',
    customer_address: 'Phnom Penh, Cambodia',
    exchange_rate: exchangeRate,
    is_delivery: 1,
    delivery_contact_name: 'Delivery Contact',
    delivery_contact_phone: '+855 17 000 001',
    delivery_contact_address: '123 Preview Street',
    delivery_fee_usd: 2.0,
    delivery_fee_khr: 2.0 * exchangeRate,
    delivery_fee_paid_by: 'customer',
    subtotal_usd: 3.25,
    subtotal_khr: 3.25 * exchangeRate,
    discount_usd: 0.5,
    discount_khr: 0.5 * exchangeRate,
    tax_usd: 0,
    tax_khr: 0,
    total_usd: 4.75,
    total_khr: 4.75 * exchangeRate,
    amount_paid_usd: 5.0,
    amount_paid_khr: 0,
    change_usd: 0.25,
    change_khr: 0,
    items: [
      { product_name: 'Coca Cola 330ml', sku: 'SKU001', quantity: 2, applied_price_usd: 1.25, applied_price_khr: 1.25 * exchangeRate },
      { product_name: 'Water 500ml', sku: 'SKU002', quantity: 1, applied_price_usd: 0.75, applied_price_khr: 0.75 * exchangeRate },
    ],
  }

  const previewSettings = { ...settings, receipt_template: JSON.stringify(tpl) }
  const previewKey = `${tpl.receipt_language || 'en'}-preview`

  if (loadError) {
    return (
      <div style={{ fontSize: 12, color: '#c00' }}>
        <div style={{ padding: 8, fontWeight: 700 }}>Preview failed to load</div>
        <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{String(loadError?.stack || loadError?.message || loadError)}</pre>
      </div>
    )
  }

  return (
    <div style={{ fontSize: 12 }}>
      {!ReceiptComp ? (
        <div style={{ padding: '16px 8px', textAlign: 'center', color: '#9ca3af', fontSize: 11 }}>
          Loading preview...
        </div>
      ) : (
        <ReceiptComp key={previewKey} sale={fakeSale} settings={previewSettings} onClose={() => {}} _previewMode />
      )}
    </div>
  )
}
