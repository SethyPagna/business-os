import type { ReactNode } from 'react'

export type InvoiceLedgerSummaryItem = {
  key: string
  label: ReactNode
  value: ReactNode
}

type InvoiceLedgerSummaryProps = {
  ariaLabel: string
  items: InvoiceLedgerSummaryItem[]
  total: InvoiceLedgerSummaryItem
}

// Contacts ledgers pass display-ready values here. This component owns only
// the compact report hierarchy; currency and quantity calculations stay with
// the ledger that received them from the API.
export default function InvoiceLedgerSummary({ ariaLabel, items, total }: InvoiceLedgerSummaryProps) {
  return (
    <section
      aria-label={ariaLabel}
      data-invoice-ledger-summary
      className="rounded-xl border border-gray-200 bg-white/70 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/40"
    >
      <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_max-content] items-baseline gap-3 py-1 sm:block sm:py-0">
            <dt className="text-[11px] leading-4 text-gray-500 dark:text-gray-400">{item.label}</dt>
            <dd className="whitespace-nowrap text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white sm:mt-0.5">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-700">
        <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-baseline gap-3">
          <dt className="text-xs font-medium leading-5 text-gray-600 dark:text-gray-300">{total.label}</dt>
          <dd className="text-right text-base font-bold tabular-nums text-gray-950 dark:text-white">{total.value}</dd>
        </div>
      </dl>
    </section>
  )
}
