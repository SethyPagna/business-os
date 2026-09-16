import { roundMoney2 } from './moneyPrecision.ts'

/** Presentation only. Never feed the two-decimal text back into saved money. */
export function receiptRoundingDisplay(adjustment: number, fmtUSD: (amount: number) => string): { labelKey: string; amount: string } | null {
  if (!Number.isFinite(adjustment)) throw new Error('Invalid rounding adjustment')
  if (adjustment === 0) return null
  if (Math.abs(adjustment) < .005) return {
    labelKey: adjustment < 0 ? 'money_rounding_down' : 'money_rounding_up',
    amount: `< ${fmtUSD(.01)}`,
  }
  return { labelKey: 'money_rounding_adjustment', amount: `${adjustment < 0 ? '-' : '+'}${fmtUSD(Math.abs(roundMoney2(adjustment)))}` }
}
