// Dashboard KPI summary card.
export default function MiniStat({ label, value, sub, color, trend, onClick }) {
  const trendUp = trend > 0
  const trendNone = trend === undefined || trend === null
  const Wrapper = onClick ? 'button' : 'div'
  const subIsText = typeof sub === 'string'

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`card flex flex-col gap-0.5 px-3 py-2.5 text-left sm:px-3.5 sm:py-3 ${onClick ? 'transition hover:ring-2 hover:ring-blue-200 dark:hover:ring-blue-800/60' : ''}`}
    >
      <div className="text-[11px] font-medium leading-4 text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-lg font-bold leading-6 tracking-tight sm:text-[1.2rem] ${color || 'text-gray-900 dark:text-white'}`}>{value}</div>
      {sub ? (
        <div
          className={`${subIsText ? 'truncate text-gray-400' : 'min-w-0 text-gray-500 dark:text-gray-400'} text-[11px] leading-4`}
          title={subIsText ? sub : undefined}
        >
          {sub}
        </div>
      ) : null}
      {!trendNone ? (
        <div className={`mt-0.5 flex items-center gap-1 text-[11px] font-semibold leading-4 ${trendUp ? 'text-green-600' : trend < 0 ? 'text-red-500' : 'text-gray-400'}`}>
          <span>{trendUp ? '->' : trend < 0 ? '<-' : '--'}</span>
          <span>{Math.abs(trend).toFixed(1)}% vs prev period</span>
        </div>
      ) : null}
    </Wrapper>
  )
}
