import { useRef, useState } from 'react'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import { useApp } from '../../AppContext'

type ConnectionContext = {
  t: (key: string) => string
  recheckConnection?: () => Promise<boolean>
}

// The way through when the connection state is wrong: asks the server itself (a /health probe), and the shared
// canWriteToServer flag clears if it answers. Icon-first with a translated tooltip, per the button policy.
export function CheckConnectionButton({ className = '' }: { className?: string }) {
  const { t, recheckConnection } = useApp() as ConnectionContext
  const [checking, setChecking] = useState(false)
  const busy = useRef(false)
  if (typeof recheckConnection !== 'function') return null
  const label = t('check_connection')
  const check = async () => {
    if (busy.current) return
    busy.current = true
    setChecking(true)
    try { await recheckConnection() } finally {
      busy.current = false
      setChecking(false)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void check()}
      disabled={checking}
      aria-busy={checking}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/30 hover:bg-current/10 disabled:cursor-wait disabled:opacity-60 ${className}`}
    >
      <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />
    </button>
  )
}

export default function SavingBlockedNote({ id, text, className = '', textClassName = '' }: { id?: string; text: string; className?: string; textClassName?: string }) {
  if (!text) return null
  return (
    <div className={`flex items-start gap-2 text-amber-700 dark:text-amber-300 ${className}`}>
      <p id={id} role="status" className={`min-w-0 flex-1 text-xs leading-relaxed ${textClassName}`}>{text}</p>
      <CheckConnectionButton />
    </div>
  )
}
