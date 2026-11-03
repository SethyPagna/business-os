import { Suspense, useState } from 'react'
import PackageOpen from 'lucide-react/dist/esm/icons/package-open.js'
import Receipt from 'lucide-react/dist/esm/icons/receipt.js'
import InfoHint from '../shared/InfoHint'
import ChipRail, { RailChip } from '../shared/kit/ChipRail.tsx'
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

  const chips: Array<{ key: InvoiceView; label: string; icon: typeof PackageOpen }> = [
    { key: 'stock_in', label: tr('stock_in_invoices', 'Stock-In Invoices'), icon: PackageOpen },
    { key: 'ap', label: tr('ap_invoices', 'Supplier AP Invoices'), icon: Receipt },
  ]

  return (
    <div className="space-y-3">
      {/* Mini-section chip row selects WHICH ledger is shown -- it sits above
          the selected report's own filter row, the same shape ReviewLogsPage
          uses for its sections. Both ledgers stay complete; the chip just
          picks which one fills the area. */}
      <div className="flex items-center gap-2">
        <ChipRail label={tr('sections', 'Sections')} className="min-w-0">
          {chips.map((chip) => {
            const Icon = chip.icon
            return (
              <RailChip key={chip.key} selected={view === chip.key} onClick={() => setView(chip.key)} icon={<Icon className="h-3.5 w-3.5" />}>
                {chip.label}
              </RailChip>
            )
          })}
        </ChipRail>
        <InfoHint
          label={tr('supplier_invoices', 'Supplier invoices')}
          text={tr('supplier_invoices_hint', 'Both supplier ledgers in one place. Stock-In lists what was received (product lines, received date, cost, remaining). AP lists the old billing documents (invoice number, due date, VAT, paid, outstanding). They are separate records with no shared invoice number, so each keeps its own full detail rather than being forced into one table.')}
        />
      </div>

      <Suspense fallback={<div className="py-6 text-center text-sm text-gray-400">{tr('loading', 'Loading...')}</div>}>
        {view === 'ap' ? <ApInvoicesSection t={t} /> : <StockInInvoicesSection t={t} />}
      </Suspense>
    </div>
  )
}
