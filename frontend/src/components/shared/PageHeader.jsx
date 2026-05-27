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
  actionsClassName = '',
  stackOnMobile = true,
}) {
  const toneClass = TONE_CLASS[tone] || TONE_CLASS.blue
  const titleText = typeof title === 'string' ? title : ''
  const subtitleText = typeof subtitle === 'string' ? subtitle.trim() : ''
  const layoutClass = stackOnMobile
    ? 'flex flex-col gap-3 md:flex-row md:items-start md:justify-between'
    : 'flex items-start justify-between gap-3'
  const wrapperClass = [layoutClass, className].filter(Boolean).join(' ')
  const iconToneClass = ['mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl', toneClass, iconClassName].filter(Boolean).join(' ')
  const resolvedActionsClass = ['flex min-w-0 flex-shrink-0 items-center gap-2', stackOnMobile ? '' : 'justify-end', actionsClassName].filter(Boolean).join(' ')

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
            <div className="flex min-w-0 items-center gap-2">
              <h1
                className="truncate text-xl font-bold text-gray-900 dark:text-white sm:text-2xl"
                title={subtitleText || titleText || undefined}
              >
                {title}
              </h1>
            </div>
          </div>
        </div>
      </div>
      {actions ? <div className={resolvedActionsClass}>{actions}</div> : null}
    </div>
  )
}
