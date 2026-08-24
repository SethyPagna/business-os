import Globe from 'lucide-react/dist/esm/icons/globe.js'
import Moon from 'lucide-react/dist/esm/icons/moon.js'
import Sun from 'lucide-react/dist/esm/icons/sun.js'
import type { MouseEventHandler, ReactNode } from 'react'
import { useApp as useAppFromContext } from '../../app/AppContextCore.tsx'

type ToggleButtonProps = {
  active?: boolean
  children: ReactNode
  label: string
  onClick?: MouseEventHandler<HTMLButtonElement>
}

type AppPreferenceContext = {
  language?: string
  theme?: string
  toggleLanguage?: MouseEventHandler<HTMLButtonElement>
  toggleTheme?: MouseEventHandler<HTMLButtonElement>
  t?: (key: string) => string
}

type QuickPreferenceTogglesProps = {
  className?: string
}

function ToggleButton({ active = false, children, label, onClick }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        'relative flex h-10 w-10 items-center justify-center rounded-full transition-colors',
        'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        'dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white',
        active ? 'text-blue-700 dark:text-blue-300' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export default function QuickPreferenceToggles({ className = '' }: QuickPreferenceTogglesProps) {
  const useApp = useAppFromContext as () => AppPreferenceContext
  const { language, theme, toggleLanguage, toggleTheme, t } = useApp()
  const tr = (key: string, fallback: string) => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }
  const darkMode = theme === 'dark'
  const khmerActive = language === 'km'
  const nextLanguageLabel = khmerActive
    ? tr('switch_to_english', 'Switch to English')
    : tr('switch_to_khmer', 'Switch to Khmer')

  return (
    <div className={['flex items-center gap-2', className].filter(Boolean).join(' ')}>
      <ToggleButton
        active={darkMode}
        label={darkMode
          ? tr('switch_to_light_mode', 'Switch to light mode')
          : tr('switch_to_dark_mode', 'Switch to dark mode')}
        onClick={toggleTheme}
      >
        {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </ToggleButton>
      <ToggleButton
        active={khmerActive}
        label={nextLanguageLabel}
        onClick={toggleLanguage}
      >
        <Globe className="h-4 w-4" />
        {/* Previously a generic "Languages" glyph that looked identical
            regardless of which language was active -- swapped for Globe
            (matching the icon already used for language elsewhere, e.g.
            ReceiptSettings.tsx) plus this small code badge so the current
            language is legible at a glance, not just inferable from the
            active/inactive border color. */}
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none absolute -bottom-1 -right-1 rounded-full border px-1 text-[9px] font-bold leading-[13px]',
            'border-white bg-blue-600 text-white dark:border-slate-900',
          ].join(' ')}
        >
          {khmerActive ? 'KM' : 'EN'}
        </span>
      </ToggleButton>
    </div>
  )
}
