import { Suspense, useState } from 'react'
import PackageOpen from 'lucide-react/dist/esm/icons/package-open.js'
import Receipt from 'lucide-react/dist/esm/icons/receipt.js'
import InfoHint from '../shared/InfoHint'
import { lazyRetry } from '../../utils/lazyImport.ts'

type TranslateFn = (key: string) => string | undefined

// The merged supplier-invoices area. The old system exposed two supplier
// ledgers that Business OS keeps as separate records, on purpose:
//
//   - Stock-In Invoices — reconstructed from the current batch data: what
//     physically arrived, grouped supplier → received day → product lines,
//     with per-lot cost, received branch, remaining qty and credit status.
//   - Supplier AP Invoices — the old system's account-payable documents
//     (migration 0088): invoice number, invoice/due dates, taxable/VAT split,
//     billed/paid/outstanding balances and status.
//
// They cannot be row-merged: `supplier_invoices` carries NO batch/line
// linkage (the migration comment is explicit -- "AP rows must not manufacture
// stock receipts"), and the two are different granularities (one AP row is a
// single money document; one stock-in "invoice" is a whole supplier-day of
// receipts). So the merge is presentation-level: ONE section that holds both,
// switchable by a mini-chip, each keeping its full column set -- whatever one
// ledger lacks, the other shows in full. Mounted inside the Suppliers tab, so
// the contacts_suppliers gate covers both front and back.

const StockInInvoicesSection = lazyRetry(() => import('./StockInInvoicesSection'), 'suppliers-stock-in-report')
const ApInvoicesSection = lazyRetry(() => import('./ApInvoicesSection'), 'suppliers-ap-invoices')

type InvoiceView = 'stock_in' | 'ap'

type SupplierInvoicesSectionProps = {
  t: TranslateFn
}

export default function SupplierInvoicesSection({ t }: SupplierInvoicesSectionProps) {
  const tr = (key: string, fallback: string): string => t(key) || fallback
  const [view, setView] = useState<InvoiceView>('stock_in')

  const chips: Array<{ key: InvoiceView; label: string; icon: typeof PackageOpen; activeColor: string }> = [
    { key: 'stock_in', label: tr('stock_in_invoices', 'Stock-In Invoices'), icon: PackageOpen, activeColor: 'text-blue-600' },
    { key: 'ap', label: tr('ap_invoices', 'Supplier AP Invoices'), icon: Receipt, activeColor: 'text-teal-600' },
  ]

  return (
    <div className="space-y-3">
      {/* Mini-section chip row selects WHICH ledger is shown -- it sits above
          the selected report's own filter row, the same shape ReviewLogsPage
          uses for its sections. Both ledgers stay complete; the chip just
          picks which one fills the area. */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <div className="inline-flex flex-nowrap rounded-xl bg-gray-100 p-0.5 dark:bg-gray-800">
          {chips.map((chip) => {
            const Icon = chip.icon
            const isActive = view === chip.key
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setView(chip.key)}
                aria-pressed={isActive}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${isActive ? `bg-white shadow dark:bg-gray-900 ${chip.activeColor}` : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
              >
                <Icon className="h-3.5 w-3.5" /> {chip.label}
              </button>
            )
          })}
        </div>
        <InfoHint
          label={tr('supplier_invoices', 'Supplier invoices')}
          text={tr('supplier_invoices_hint', 'Both supplier ledgers in one place. Stock-In lists what was received (product lines, batch, cost, remaining). AP lists the old billing documents (invoice number, due date, VAT, paid, outstanding). They are separate records with no shared invoice number, so each keeps its own full detail rather than being forced into one table.')}
        />
      </div>

      <Suspense fallback={<div className="py-6 text-center text-sm text-gray-400">{tr('loading', 'Loading...')}</div>}>
        {view === 'ap' ? <ApInvoicesSection t={t} /> : <StockInInvoicesSection t={t} />}
      </Suspense>
    </div>
  )
}
