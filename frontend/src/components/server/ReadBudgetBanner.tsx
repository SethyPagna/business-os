import { useEffect, useState } from 'react'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import { D1_DAILY_LIMIT_EVENT, isD1DailyLimitActive } from '../../api/http.ts'
import {
  READ_BUDGET_BANNER_KEYS, READ_BUDGET_BANNER_MESSAGES, READ_BUDGET_EVENT, getReadBudgetPause, readBudgetSentence, type ReadBudgetPause,
} from '../../api/readBudgetShed.ts'

const useApp = useAppHook as () => { t: (key: string) => string }

// The Worker paused a class of requests to keep selling running (api/readBudgetShed.ts). Selling, payments, returns and sign-in
// still work, so this is a notice and not an error; the database-limit bar (D1LimitBanner) takes the place when both hold.
export default function ReadBudgetBanner() {
  const { t } = useApp()
  const [pause, setPause] = useState<ReadBudgetPause | null>(() => getReadBudgetPause())
  const [limited, setLimited] = useState(isD1DailyLimitActive)
  useEffect(() => {
    const onPause = () => setPause(getReadBudgetPause())
    const onLimit = (event: Event) => setLimited(!!(event as CustomEvent<{ active?: boolean }>).detail?.active)
    window.addEventListener(READ_BUDGET_EVENT, onPause)
    window.addEventListener(D1_DAILY_LIMIT_EVENT, onLimit)
    onPause()
    setLimited(isD1DailyLimitActive())
    return () => {
      window.removeEventListener(READ_BUDGET_EVENT, onPause)
      window.removeEventListener(D1_DAILY_LIMIT_EVENT, onLimit)
    }
  }, [])
  if (!pause || limited) return null
  const key = READ_BUDGET_BANNER_KEYS[pause.code]
  const translated = t(key)
  const sentence = readBudgetSentence(translated && translated !== key ? translated : READ_BUDGET_BANNER_MESSAGES[pause.code], pause.timeText)
  const tone = pause.code === 'read_budget_reserved'
    ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
    : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
  return (
    <div role="status" className={`w-full shrink-0 border-b px-3 py-2 text-center text-sm font-medium leading-6 ${tone}`}>
      {sentence}
    </div>
  )
}
