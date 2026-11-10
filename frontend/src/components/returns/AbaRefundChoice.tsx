import type { AbaRefundOffer } from './helpers/abaRefund.ts'

// "Send the refund: Cash from the till / Through ABA", on the confirm step of a return of a sale that took online money (KHQR S6b). It states in words what each choice does to the till
// drawer, how much is sent, and the most the sale took online, and says so in red when the amount is over that.
type Props = {
  offer: AbaRefundOffer
  viaAba: boolean
  disabled?: boolean
  T: (key: string, fallback: string) => string
  fmtUSD: (value: number) => string
  onChange: (viaAba: boolean) => void
}

export default function AbaRefundChoice({ offer, viaAba, disabled, T, fmtUSD, onChange }: Props) {
  if (!offer.offered) return null
  const over = viaAba && offer.overCap
  return (
    <div data-section="aba-refund" className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-900/20">
      <div className="font-semibold text-blue-800 dark:text-blue-200">{T('return_aba_title', 'Send the refund')}</div>
      <div role="radiogroup" aria-label={T('return_aba_title', 'Send the refund')} className="flex flex-wrap gap-1.5 text-xs">
        {([[false, T('return_aba_cash', 'Cash from the till')], [true, T('return_aba_aba', 'Through ABA')]] as Array<[boolean, string]>).map(([value, label]) => (
          <button key={String(value)} type="button" role="radio" aria-checked={viaAba === value} disabled={disabled} onClick={() => onChange(value)}
            className={`min-h-9 rounded-lg border px-3 py-1 font-semibold ${viaAba === value ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'}`}>{label}</button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-blue-900 dark:text-blue-100">
        {viaAba
          ? T('return_aba_note_aba', '{amount} goes back through ABA. The till drawer is not touched; send the money from the ABA app after confirming.').split('{amount}').join(fmtUSD(offer.amountUsd))
          : T('return_aba_note_cash', '{amount} is paid out of the till drawer.').split('{amount}').join(fmtUSD(offer.amountUsd))}
      </p>
      <p data-aba-cap={over ? 'over' : 'ok'} className={`text-xs leading-relaxed ${over ? 'font-semibold text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-300'}`}>
        {over
          ? T('return_aba_over', 'This is more than the {cap} the customer paid online. Choose cash, or refund fewer items.').split('{cap}').join(fmtUSD(offer.capUsd))
          : T('return_aba_cap', 'Up to {cap} was paid online for this sale.').split('{cap}').join(fmtUSD(offer.capUsd))}
      </p>
    </div>
  )
}
