import { useState } from 'react'
import { ChevronDown, ChevronUp, GripVertical, Minus, Plus, Trash2 } from 'lucide-react'

function getSectionOrderItems(t) {
  const T = t || ((key, fallback) => fallback || key)
  return [
    { key: 'header', label: T('receipt_section_header', 'Business Header'), desc: T('fo_desc_header', 'Logo, name, address, and phone') },
    { key: 'order_info', label: T('receipt_section_order', 'Order Information'), desc: T('fo_desc_order_info', 'Receipt number, date, cashier, and payment') },
    { key: 'customer', label: T('receipt_section_customer', 'Customer Info'), desc: T('fo_desc_customer', 'Customer name, phone, and address') },
    { key: 'delivery', label: T('receipt_delivery', 'Delivery Details'), desc: T('fo_desc_delivery', 'Delivery contact, address, and notes') },
    { key: 'items', label: T('receipt_section_items', 'Items List'), desc: T('fo_desc_items', 'Purchased products and quantities') },
    { key: 'subtotal', label: T('subtotal', 'Subtotal'), desc: T('fo_desc_subtotal', 'Sum before adjustments') },
    { key: 'discount', label: T('discount', 'Discount'), desc: T('fo_desc_discount', 'Applied discount lines') },
    { key: 'tax', label: T('tax', 'Tax'), desc: T('fo_desc_tax', 'Tax amount') },
    { key: 'delivery_fee', label: T('delivery_fees', 'Delivery Fee'), desc: T('fo_desc_delivery_fee', 'Delivery cost line') },
    { key: 'total', label: T('total', 'Total'), desc: T('fo_desc_total', 'Grand total') },
    { key: 'payment', label: T('amount_paid', 'Amount Paid'), desc: T('fo_desc_payment', 'Tendered amount and change') },
    { key: 'change', label: T('change', 'Change'), desc: T('fo_desc_change', 'Change returned to customer') },
    { key: 'footer', label: T('receipt_section_footer', 'Footer Message'), desc: T('fo_desc_footer', 'Closing text and separators') },
  ]
}

function buildList(order, items, t) {
  const base = Array.isArray(order) && order.length ? order : items.map((item) => item.key)
  const output = []
  let dividerIndex = 0

  base.forEach((key) => {
    if (key === '---divider---' || String(key).startsWith('divider_')) {
      output.push({
        key: `divider_${dividerIndex += 1}`,
        label: t('receipt_divider_label', 'Divider line'),
        desc: t('fo_desc_divider', 'Visual separator line on the receipt'),
        isDivider: true,
      })
      return
    }
    const found = items.find((item) => item.key === key)
    if (found) output.push(found)
  })

  items.forEach((item) => {
    if (!output.find((entry) => entry.key === item.key)) output.push(item)
  })
  return output
}

function toKeys(list) {
  return list.map((item) => (item.isDivider ? '---divider---' : item.key))
}

export default function FieldOrderManager({ order, onChange, t: tProp }) {
  const t = tProp || ((key, fallback) => fallback || key)
  const [dragIdx, setDragIdx] = useState(null)
  const [search, setSearch] = useState('')

  const items = getSectionOrderItems(t)
  const enriched = buildList(order, items, t)
  const filtered = search.trim()
    ? enriched.filter((item) => {
        const haystack = `${item.label} ${item.desc}`.toLowerCase()
        return haystack.includes(search.toLowerCase())
      })
    : enriched

  const moveItem = (fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= enriched.length) return
    const next = [...enriched]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    onChange(toKeys(next))
  }

  const addDivider = (afterIndex) => {
    const next = [...enriched]
    next.splice(afterIndex + 1, 0, {
      key: `divider_${Date.now()}`,
      label: t('receipt_divider_label', 'Divider line'),
      desc: t('fo_desc_divider', 'Visual separator line on the receipt'),
      isDivider: true,
    })
    onChange(toKeys(next))
  }

  const removeDivider = (index) => {
    const target = enriched[index]
    if (!target?.isDivider) return
    onChange(toKeys(enriched.filter((_, itemIndex) => itemIndex !== index)))
  }

  const handleDragStart = (event, index) => {
    setDragIdx(index)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (event, index) => {
    event.preventDefault()
    if (dragIdx == null || dragIdx === index) return
    const next = [...enriched]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(index, 0, moved)
    setDragIdx(index)
    onChange(toKeys(next))
  }

  return (
    <div>
      <div className="mb-4 rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
        {t('receipt_order_drag_hint', 'Drag rows to reorder receipt sections. Add divider lines anywhere to separate groups on the printed receipt.')}
      </div>

      <div className="mb-3 flex gap-2">
        <input
          className="input flex-1 text-sm"
          placeholder={t('receipt_search_sections_placeholder', 'Search sections')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" onClick={() => addDivider(enriched.length - 1)} className="btn-secondary inline-flex items-center gap-1 text-xs whitespace-nowrap">
          <Plus className="h-3.5 w-3.5" />
          {t('receipt_add_divider', 'Add divider')}
        </button>
      </div>

      <div className="space-y-1">
        {filtered.map((item, visibleIndex) => {
          const realIndex = enriched.findIndex((entry) => entry.key === item.key)
          if (item.isDivider) {
            return (
              <div
                key={item.key}
                draggable
                onDragStart={(event) => handleDragStart(event, realIndex)}
                onDragOver={(event) => handleDragOver(event, realIndex)}
                onDragEnd={() => setDragIdx(null)}
                className={`flex items-center gap-2 rounded-xl border border-dashed px-3 py-2 ${dragIdx === realIndex ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50'}`}
              >
                <GripVertical className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <div className="flex-1 border-t border-dashed border-gray-300 pt-1 text-center text-xs text-gray-400 dark:border-gray-600">
                  {item.label}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className="rounded-lg p-1 text-gray-400 hover:bg-white hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200" onClick={() => moveItem(realIndex, realIndex - 1)} disabled={realIndex === 0}>
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button type="button" className="rounded-lg p-1 text-gray-400 hover:bg-white hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200" onClick={() => moveItem(realIndex, realIndex + 1)} disabled={realIndex === enriched.length - 1}>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button type="button" className="rounded-lg p-1 text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" onClick={() => removeDivider(realIndex)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          }

          return (
            <div
              key={item.key}
              draggable
              onDragStart={(event) => handleDragStart(event, realIndex)}
              onDragOver={(event) => handleDragOver(event, realIndex)}
              onDragEnd={() => setDragIdx(null)}
              className={`group flex items-center gap-3 rounded-xl border p-3 transition-all ${dragIdx === realIndex ? 'border-blue-400 bg-blue-50 shadow-sm dark:bg-blue-900/20' : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-blue-900/10'}`}
            >
              <GripVertical className="h-4 w-4 flex-shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.label}</div>
                <div className="text-xs text-gray-400">{item.desc}</div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className="rounded-lg p-1 text-gray-300 transition hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20" title={t('insert_divider_below', 'Insert divider below')} onClick={() => addDivider(realIndex)}>
                  <Minus className="h-4 w-4" />
                </button>
                <button type="button" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200" title={t('moveUp', 'Up')} onClick={() => moveItem(realIndex, realIndex - 1)} disabled={realIndex === 0}>
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button type="button" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200" title={t('moveDown', 'Down')} onClick={() => moveItem(realIndex, realIndex + 1)} disabled={realIndex === enriched.length - 1}>
                  <ChevronDown className="h-4 w-4" />
                </button>
                <span className="w-6 text-center text-xs font-mono text-gray-300 dark:text-gray-600">{visibleIndex + 1}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
