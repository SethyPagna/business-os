import X from 'lucide-react/dist/esm/icons/x.js'
import MinimizeButton from '../shared/MinimizeButton.tsx'
import type { StockMode, StockSessionStep } from '../../utils/stockSessionDraft.ts'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

// The stock words, never `remove` (Khmer "delete").
export const STOCK_MODE_KEYS: Record<StockMode, { key: string; fallback: string }> = {
  add: { key: 'adjust_add', fallback: 'Add' },
  remove: { key: 'adjust_remove', fallback: 'Remove' },
  set: { key: 'adjust_set', fallback: 'Set' },
}

const MODE_ON: Record<StockMode, string> = {
  add: 'bg-emerald-600 text-white shadow-sm dark:bg-emerald-500',
  remove: 'bg-red-600 text-white shadow-sm dark:bg-red-500',
  set: 'bg-amber-500 text-white shadow-sm dark:bg-amber-500',
}

type HeaderProps = {
  mode: StockMode
  onModeChange: (next: StockMode) => void
  /** Items holds lines: the session's mode is fixed until it is completed or cleared. */
  modeLocked: boolean
  disabled?: boolean
  tr: Translate
  onMinimize?: () => void
  onClose: () => void
}

/** The mode IS the title (S6): one row of Add | Remove | Set, then minimize and close. */
export default function StockSessionHeader({ mode, onModeChange, modeLocked, disabled = false, tr, onMinimize, onClose }: HeaderProps) {
  const blockedTitle = tr('stock_session_switch_blocked', 'Complete or clear Items to switch')
  return (
    <div className="flex flex-shrink-0 items-center gap-1 px-3 pt-3 sm:px-4 sm:pt-4">
      <div role="radiogroup" aria-label={tr('stock_session', 'Session')} className="grid h-10 min-w-0 flex-1 grid-cols-3 gap-0.5 rounded-xl bg-gray-100 p-0.5 dark:bg-gray-900/60" data-stock-session-modes>
        {(['add', 'remove', 'set'] as const).map((option) => {
          const active = option === mode
          const blocked = modeLocked && !active
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled || blocked}
              title={blocked ? blockedTitle : undefined}
              onClick={() => { if (!active) onModeChange(option) }}
              className={`min-w-0 truncate rounded-[0.6rem] px-1 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${active ? MODE_ON[option] : 'text-gray-600 hover:bg-white disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800'}`}
            >
              {tr(STOCK_MODE_KEYS[option].key, STOCK_MODE_KEYS[option].fallback)}
            </button>
          )
        })}
      </div>
      {onMinimize ? <MinimizeButton disabled={disabled} tr={(key, en, km) => tr(key, en, km)} onMinimize={onMinimize} /> : null}
      <button
        type="button"
        onClick={onClose}
        disabled={disabled}
        aria-label={tr('close', 'Close')}
        title={tr('close', 'Close')}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-700"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}

const STEP_KEYS: Record<StockSessionStep, { key: string; fallback: string }> = {
  items: { key: 'items', fallback: 'Items' },
  payment: { key: 'payment', fallback: 'Payment' },
  review: { key: 'stock_session_review', fallback: 'Review' },
}

/** `1 Items › 2 Payment › 3 Review`: done steps go back, later steps are inert. */
export function StockSessionSteps({ steps, current, onStep, disabled = false, tr }: {
  steps: readonly StockSessionStep[]
  current: StockSessionStep
  onStep: (step: StockSessionStep) => void
  disabled?: boolean
  tr: Translate
}) {
  const at = steps.indexOf(current)
  return (
    <ol className="flex h-7 flex-shrink-0 items-center gap-1 px-3 text-xs sm:px-4" aria-label={tr('stock_session', 'Session')}>
      {steps.map((step, index) => {
        const done = index < at
        const active = index === at
        const label = `${index + 1} ${tr(STEP_KEYS[step].key, STEP_KEYS[step].fallback)}`
        return (
          <li key={step} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <span aria-hidden="true" className="text-gray-300 dark:text-gray-600">›</span> : null}
            {done ? (
              <button type="button" disabled={disabled} onClick={() => onStep(step)} className="truncate rounded px-1 text-gray-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-gray-300">
                {label}
              </button>
            ) : (
              <span aria-current={active ? 'step' : undefined} className={`truncate px-1 ${active ? 'font-bold text-blue-700 dark:text-blue-300' : 'text-gray-400 dark:text-gray-500'}`}>
                {label}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
