const TONE_CLASS = {
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
}

export default function PageHeader({
  icon: Icon,
  title,
  subtitle = '',
  actions = null,
  tone = 'blue',
  className = '',
  iconClassName = '',
}) {
  const toneClass = TONE_CLASS[tone] || TONE_CLASS.blue
  const wrapperClass = ['flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between', className].filter(Boolean).join(' ')
  const iconToneClass = ['mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl', toneClass, iconClassName].filter(Boolean).join(' ')

  return (
    <div className={wrapperClass}>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          {Icon ? (
            <div className={iconToneClass}>
              <Icon className="h-5 w-5" />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">{title}</h1>
            {subtitle ? <p className="mt-1 max-w-4xl text-sm text-gray-500 dark:text-gray-400">{subtitle}</p> : null}
          </div>
        </div>
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
