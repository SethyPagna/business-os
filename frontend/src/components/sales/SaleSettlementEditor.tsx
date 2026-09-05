import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import type { SettlementRow } from './saleSettlement.ts'
import { paymentMethodIdentity, settlementRowsIssue, settlementTotals } from './saleSettlement.ts'

type Props = {
  rows: SettlementRow[]
  configuredMethods: string[]
  exchangeRate: number
  totalUsd: number
  saving: boolean
  error: string
  recordedIssue: 'malformed' | 'mismatch' | 'allocation' | null
  translate: (key: string, english: string, khmer?: string) => string
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
  onChange: (rows: SettlementRow[]) => void
}

export const MAX_SETTLEMENT_ROWS = 12

export default function SaleSettlementEditor({ rows, configuredMethods, exchangeRate, totalUsd, saving, error, recordedIssue, translate, fmtUSD, fmtKHR, onChange }: Props) {
  const totals = settlementTotals(rows, exchangeRate)
  const remaining = Math.max(0, totalUsd - totals.paidEquivalentUsd)
  const change = Math.max(0, totals.paidEquivalentUsd - totalUsd)
  const balance = remaining > 0 ? remaining : change
  const balanceText = balance > 0 && balance < 0.01 ? `${balance.toFixed(4)} USD` : fmtUSD(balance)
  const rowIssue = settlementRowsIssue(rows, configuredMethods)
  const rateText = exchangeRate.toLocaleString(undefined, { maximumFractionDigits: 4 })
  const rowsLimitMessage = translate('sale_settlement_rows_limit', 'This sale has {count} recorded payment rows. Settlement supports at most {max}; no recorded rows were removed. Repair the record before completing it.', 'ការលក់នេះមានបន្ទាត់ការទូទាត់ដែលបានកត់ត្រា {count}។ ការបញ្ចប់ការទូទាត់គាំទ្រអតិបរមា {max} បន្ទាត់ ហើយមិនបានដកបន្ទាត់ដែលបានកត់ត្រាណាមួយទេ។ សូមកែទិន្នន័យ មុនបញ្ចប់។')
    .replace('{count}', String(rows.length))
    .replace('{max}', String(MAX_SETTLEMENT_ROWS))
  const reviewError = rows.length > MAX_SETTLEMENT_ROWS
    ? rowsLimitMessage
    : recordedIssue === 'malformed'
    ? translate('sale_settlement_record_malformed', 'The recorded payment details are malformed. Review and repair this sale before settling it.', 'ព័ត៌មានការទូទាត់ដែលបានកត់ត្រាមិនត្រឹមត្រូវ។ សូមពិនិត្យ និងកែការលក់នេះ មុនបញ្ចប់ការទូទាត់។')
    : recordedIssue === 'mismatch'
      ? translate('sale_settlement_record_mismatch', 'The recorded payment total does not match its payment lines. Review and repair this sale before settling it.', 'ចំនួនការទូទាត់ដែលបានកត់ត្រា មិនត្រូវនឹងបន្ទាត់ការទូទាត់ទេ។ សូមពិនិត្យ និងកែការលក់នេះ មុនបញ្ចប់ការទូទាត់។')
      : recordedIssue === 'allocation'
        ? translate('sale_settlement_allocation_missing', 'This sale has a combined payment summary without its original tender allocation. Repair the payment details before settling it.', 'ការលក់នេះមានសង្ខេបការទូទាត់រួម ប៉ុន្តែគ្មានការបែងចែកការទូទាត់ដើម។ សូមកែព័ត៌មានការទូទាត់ មុនបញ្ចប់។')
      : configuredMethods.length === 0
        ? translate('sale_settlement_methods_missing', 'No active payment methods are configured. Configure one before settling this sale.', 'មិនមានវិធីទូទាត់សកម្មដែលបានកំណត់ទេ។ សូមកំណត់វិធីមួយ មុនបញ្ចប់ការទូទាត់ការលក់នេះ។')
        : rowIssue === 'method'
          ? translate('sale_settlement_method_unavailable', 'Choose an active configured payment method for every row.', 'សូមជ្រើសវិធីទូទាត់សកម្មដែលបានកំណត់ សម្រាប់គ្រប់បន្ទាត់។')
          : ''
  const patchRow = (id: string, patch: Partial<SettlementRow>) => onChange(rows.map((row) => row.id === id ? { ...row, ...patch } : row))
  const addMethod = (method: string) => {
    onChange([...rows, { id: `settlement-${Date.now()}-${rows.length}`, method, usd: '', khr: '' }])
  }

  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-800/70 dark:bg-emerald-950/20">
      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        {translate('record_payment', 'Record payment', 'កត់ត្រាការទូទាត់')}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        {translate('sale_settlement_rate_hint', 'Current rate: 1 USD = {rate} KHR. Recorded USD and KHR amounts stay in their original currency.', 'អត្រាបច្ចុប្បន្ន៖ 1 USD = {rate} រៀល។ ចំនួន USD និង KHR ដែលបានកត់ត្រា នៅតែរក្សារូបិយប័ណ្ណដើម។').replace('{rate}', rateText)}
      </p>

      <div className="mt-3 flex flex-wrap gap-2" aria-label={translate('payment_methods', 'Payment methods', 'វិធីទូទាត់')}>
        {configuredMethods.map((method) => {
          const selected = rows.some((row) => paymentMethodIdentity(row.method) === paymentMethodIdentity(method))
          return (
            <button
              key={method}
              type="button"
              className={`min-h-11 rounded-full border px-3 py-2 text-sm font-medium ${selected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-emerald-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'}`}
              aria-label={`${translate('add_payment_method', 'Add payment method', 'បន្ថែមវិធីទូទាត់')}: ${method}`}
              disabled={saving || rows.length >= MAX_SETTLEMENT_ROWS}
              onClick={() => addMethod(method)}
            >
              <span className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" aria-hidden="true" />{method}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 space-y-2">
        {rows.map((row, index) => (
          <div key={row.id} className="rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800/80">
            <div className="mb-2 flex min-h-11 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                {row.method || translate('payment_method', 'Payment method', 'វិធីទូទាត់')}
                {row.id.startsWith('recorded-') ? <span className="ml-2 text-xs font-normal text-gray-400">{translate('recorded', 'Recorded', 'បានកត់ត្រា')}</span> : null}
              </span>
              <button
                type="button"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-900/20"
                aria-label={`${translate('remove', 'Remove', 'ដក')} ${row.method}`}
                disabled={saving || rows.length === 1 || row.id.startsWith('recorded-')}
                onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block text-xs text-gray-500 dark:text-gray-400">
                USD
                <input
                  className="input mt-1 h-11 w-full text-sm"
                  type="number"
                  min="0"
                  step={row.id.startsWith('recorded-') ? 'any' : '0.01'}
                  inputMode="decimal"
                  aria-label={`${row.method} USD ${index + 1}`}
                  disabled={saving || row.id.startsWith('recorded-')}
                  value={row.usd}
                  onChange={(event) => patchRow(row.id, { usd: event.target.value })}
                />
              </label>
              <label className="block text-xs text-gray-500 dark:text-gray-400">
                KHR
                <input
                  className="input mt-1 h-11 w-full text-sm"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  aria-label={`${row.method} KHR ${index + 1}`}
                  disabled={saving || row.id.startsWith('recorded-')}
                  value={row.khr}
                  onChange={(event) => patchRow(row.id, { khr: event.target.value })}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <dl className="mt-3 grid gap-1 rounded-lg bg-white/80 p-3 text-xs dark:bg-gray-900/40">
        <div className="flex items-center justify-between gap-3"><dt>{translate('amount_paid', 'Amount paid', 'ចំនួនទូទាត់')}</dt><dd className="text-right font-semibold">{fmtUSD(totals.amountPaidUsd)} · {fmtKHR(totals.amountPaidKhr)}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt>{translate('total', 'Total', 'សរុប')}</dt><dd className="text-right font-semibold">{fmtUSD(totalUsd)}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt>{remaining > 0 ? translate('outstanding_balance', 'Outstanding', 'នៅជំពាក់') : translate('change', 'Change', 'ប្រាក់អាប់')}</dt><dd className={`text-right font-semibold ${remaining > 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-300'}`}>{balanceText}</dd></div>
      </dl>
      {error || reviewError ? <p className="mt-2 text-xs font-medium leading-relaxed text-red-600 dark:text-red-400" role="alert">{error || reviewError}</p> : null}
    </div>
  )
}
