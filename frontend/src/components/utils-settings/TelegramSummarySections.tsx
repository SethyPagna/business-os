import type { ComponentType } from 'react'
import BadgeDollarSign from 'lucide-react/dist/esm/icons/badge-dollar-sign.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import Receipt from 'lucide-react/dist/esm/icons/receipt.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js'
import Users from 'lucide-react/dist/esm/icons/users.js'
import InfoHint from '../shared/InfoHint.tsx'

type SettingValue = string | number | null | undefined

type TelegramSummarySectionsProps = {
  form: Record<string, SettingValue>
  setValue: (key: string, value: string) => void
  disabled: boolean
  t: (key: string) => string
}

type SummarySwitch = { key: string; Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; label: string; detail: string }

/**
 * The overview's optional sections (cloudflare/src/lib/telegram.ts
 * TELEGRAM_SUMMARY_SWITCHES). The Worker turns a section on only for the
 * stored value 'true', so an unset switch shows as off here too.
 */
export default function TelegramSummarySections({ form, setValue, disabled, t }: TelegramSummarySectionsProps) {
  const switches: SummarySwitch[] = [
    { key: 'telegram_summary_sales_enabled', Icon: BadgeDollarSign, label: t('telegram_summary_sales'), detail: t('telegram_summary_sales_desc') },
    { key: 'telegram_summary_cashiers_enabled', Icon: Users, label: t('telegram_summary_cashiers'), detail: t('telegram_summary_cashiers_desc') },
    { key: 'telegram_summary_products_enabled', Icon: Package, label: t('telegram_summary_products'), detail: t('telegram_summary_products_desc') },
    { key: 'telegram_summary_returns_enabled', Icon: RotateCcw, label: t('telegram_summary_returns'), detail: t('telegram_summary_returns_desc') },
    { key: 'telegram_summary_expenses_enabled', Icon: Receipt, label: t('telegram_summary_expenses'), detail: t('telegram_summary_expenses_desc') },
    { key: 'telegram_summary_compare_enabled', Icon: TrendingUp, label: t('telegram_summary_compare'), detail: t('telegram_summary_compare_desc') },
  ]
  const title = t('telegram_summary_sections')
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 sm:col-span-2 dark:border-gray-700 dark:bg-gray-800/70">
      <div className="flex items-center gap-1 text-sm font-medium text-gray-800 dark:text-gray-100">
        {title}
        <InfoHint label={title} text={t('telegram_summary_sections_hint')} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={title}>
        {switches.map(({ key, Icon, label, detail }) => {
          const on = String(form[key] ?? '').trim() === 'true'
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              title={detail}
              disabled={disabled}
              onClick={() => setValue(key, on ? 'false' : 'true')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-300'
                : 'border-gray-200 bg-white text-gray-600 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-gray-100'}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
