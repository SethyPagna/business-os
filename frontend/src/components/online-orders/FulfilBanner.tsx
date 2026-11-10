import { AlertTriangle, PackageCheck, Plus, X } from 'lucide-react'
import { extraLines, fulfilMoney, lineStatus, type CartCount, type FulfilHandoff } from './fulfilOrder.ts'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'

// The strip at the top of the till's cart while it is ringing up an online order (KHQR S6a). It always shows what the order asked for next to what the sale holds (before -> after, line by
// line) and, in words, what the difference means for the customer's money, so the cashier can change lines and still know what will happen when they press Complete.

type Tx = (key: string, fallback: string) => string
type Props = {
  tt: Tx
  handoff: FulfilHandoff
  cart: readonly CartCount[]
  saleTotalUsd: number
  /** Product id -> name, for the lines (the order carries ids; the till knows the names). */
  names: ReadonlyMap<number, string>
  fmtUSD: (value: number) => string
  /** The online payment method is not one of the till's configured methods: the Worker would refuse the sale, so say so before Complete. */
  methodMissing?: string | null
  onAddLine: (productId: number) => void
  onDetach: () => void
}

export default function FulfilBanner({ tt, handoff, cart, saleTotalUsd, names, fmtUSD, methodMissing, onAddLine, onDetach }: Props) {
  const lines = lineStatus(handoff.lines, cart)
  const extras = extraLines(handoff.lines, cart)
  const money = fulfilMoney(handoff.paid_usd, saleTotalUsd)
  const nameOf = (id: number): string => names.get(id) || `#${id}`
  const sentence = money.kind === 'owe_more'
    ? tt('oo_till_owe_more', 'The sale is {amount} more than the customer paid online. Take {amount} at the till with another payment below.').split('{amount}').join(fmtUSD(money.balanceUsd))
    : money.kind === 'refund_back'
      ? tt('oo_till_refund_back', 'The customer paid {amount} more online than this sale comes to. After Complete, send {amount} back through ABA from Orders.').split('{amount}').join(fmtUSD(money.backUsd))
      : tt('oo_till_same', 'The online payment covers this sale exactly. Nothing more to take.')
  return (
    <section data-online-order-till={handoff.online_order_id} aria-label={tt('oo_till_title', 'Online order')} className="space-y-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-400/30 dark:bg-emerald-400/10">
      <div className="flex items-start gap-2">
        <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-bold leading-6 text-emerald-900 dark:text-emerald-100">
            {tt('oo_till_title', 'Online order')} <span translate="no">{handoff.order_no}</span>
          </div>
          <div className="text-xs leading-6 text-emerald-900/80 dark:text-emerald-100/80">
            <span {...getKhmerTextProps(handoff.customer_name, '[overflow-wrap:anywhere]')}>{handoff.customer_name}</span>
            {handoff.customer_phone ? <> · <span translate="no">{handoff.customer_phone}</span></> : null}
          </div>
        </div>
        <button type="button" onClick={onDetach} aria-label={tt('oo_till_detach', 'Sell without this order')} title={tt('oo_till_detach', 'Sell without this order')}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-emerald-900 hover:bg-emerald-100 dark:text-emerald-100 dark:hover:bg-emerald-400/20">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <ul className="space-y-1" aria-label={tt('oo_till_lines', 'Ordered, and in this sale')}>
        {lines.map((line) => (
          <li key={line.product_id} data-order-line={line.product_id} className="flex items-center justify-between gap-2 leading-6">
            <span {...getKhmerTextProps(nameOf(line.product_id), 'min-w-0 [overflow-wrap:anywhere]')}>{nameOf(line.product_id)}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className={line.inSale === line.ordered ? 'text-emerald-800 dark:text-emerald-200' : 'font-semibold text-amber-800 dark:text-amber-200'} translate="no">{line.ordered} → {line.inSale}</span>
              {line.missing > 0 ? (
                <button type="button" onClick={() => onAddLine(line.product_id)} aria-label={tt('oo_till_add_line', 'Add to the sale')} title={tt('oo_till_add_line', 'Add to the sale')}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-700 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-300 dark:text-emerald-200 dark:hover:bg-emerald-400/20">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          </li>
        ))}
        {extras.map((entry) => (
          <li key={`extra-${entry.productId}`} className="flex items-center justify-between gap-2 leading-6 text-amber-800 dark:text-amber-200">
            <span {...getKhmerTextProps(nameOf(entry.productId), 'min-w-0 [overflow-wrap:anywhere]')}>{nameOf(entry.productId)}</span>
            <span className="shrink-0 font-semibold" translate="no">0 → {entry.quantity}</span>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-[1fr_auto] gap-x-3 leading-6">
        <dt className="text-emerald-900/80 dark:text-emerald-100/80">{tt('oo_till_paid_online', 'Paid online')}</dt><dd className="text-right font-semibold" translate="no">{fmtUSD(handoff.paid_usd)}</dd>
        <dt className="text-emerald-900/80 dark:text-emerald-100/80">{tt('oo_till_sale_total', 'This sale')}</dt><dd className="text-right font-semibold" translate="no">{fmtUSD(saleTotalUsd)}</dd>
      </dl>
      <p data-fulfil-money={money.kind} className={`leading-6 ${money.kind === 'same' ? 'text-emerald-900 dark:text-emerald-100' : 'font-semibold text-amber-900 dark:text-amber-100'}`}>{sentence}</p>
      {methodMissing ? (
        <p role="alert" className="flex items-start gap-1.5 font-semibold leading-6 text-red-700 dark:text-red-300">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{tt('oo_till_method_missing', 'The payment method "{method}" is not set up, so this sale cannot be saved. Add it under Settings, Payment methods.').split('{method}').join(methodMissing)}</span>
        </p>
      ) : null}
    </section>
  )
}
