import { Languages, Moon, Sun } from 'lucide-react'
import { useApp } from '../../AppContext'

function ToggleButton({ active = false, children, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        'flex h-10 w-10 items-center justify-center rounded-xl border transition-colors',
        'border-gray-200 bg-white/85 text-gray-600 hover:border-blue-300 hover:bg-white hover:text-gray-900',
        'dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-blue-500/60 dark:hover:bg-slate-800 dark:hover:text-white',
        active ? 'border-blue-300 text-blue-700 dark:border-blue-500/60 dark:text-blue-300' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export default function QuickPreferenceToggles({ className = '' }) {
  const { language, theme, toggleLanguage, toggleTheme } = useApp()
  const darkMode = theme === 'dark'
  const khmerActive = language === 'km'

  return (
    <div className={['flex items-center gap-2', className].filter(Boolean).join(' ')}>
      <ToggleButton
        active={darkMode}
        label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        onClick={toggleTheme}
      >
        {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </ToggleButton>
      <ToggleButton
        active={khmerActive}
        label={khmerActive ? 'Switch to English' : 'Switch to Khmer'}
        onClick={toggleLanguage}
      >
        <Languages className="h-4 w-4" />
      </ToggleButton>
    </div>
  )
}
