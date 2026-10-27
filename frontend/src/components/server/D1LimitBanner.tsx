import { useEffect, useState } from 'react'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import { D1_DAILY_LIMIT_EVENT, D1_DAILY_LIMIT_KEY, D1_DAILY_LIMIT_MESSAGE, isD1DailyLimitActive } from '../../api/http.ts'

const useApp = useAppHook as () => { t: (key: string) => string }

// The Free plan's daily D1 row cap (api/http.ts D1_DAILY_LIMIT_*): while it holds, every query fails until 07:00 in
// Cambodia, so saving is blocked and this one full-width bar says why. It is not the connection banner: the server
// answers, and nothing is retrying or refreshing.
export default function D1LimitBanner() {
  const { t } = useApp()
  const [active, setActive] = useState(isD1DailyLimitActive)
  useEffect(() => {
    const onChange = (event: Event) => setActive(!!(event as CustomEvent<{ active?: boolean }>).detail?.active)
    window.addEventListener(D1_DAILY_LIMIT_EVENT, onChange)
    setActive(isD1DailyLimitActive())
    return () => window.removeEventListener(D1_DAILY_LIMIT_EVENT, onChange)
  }, [])
  if (!active) return null
  const translated = t(D1_DAILY_LIMIT_KEY)
  return (
    <div role="alert" className="w-full shrink-0 border-b border-red-300 bg-red-50 px-3 py-2 text-center text-sm font-medium leading-6 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
      {translated && translated !== D1_DAILY_LIMIT_KEY ? translated : D1_DAILY_LIMIT_MESSAGE}
    </div>
  )
}
