// Dashboard KPI summary card.
export default function MiniStat({ label, value, sub, color, trend, onClick }) {
  const trendUp = trend > 0
  const trendNone = trend === undefined || trend === null
  const Wrapper = onClick ? 'button' : 'div'

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`card p-4 flex flex-col gap-1 text-left ${onClick ? 'transition hover:ring-2 hover:ring-blue-200 dark:hover:ring-blue-800/60' : ''}`}
    >
      <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">{label}</div>
      <div className={`text-xl font-bold tracking-tight ${color || 'text-gray-900 dark:text-white'}`}>{value}</div>
      {sub ? <div className="truncate text-xs text-gray-400" title={sub}>{sub}</div> : null}
      {!trendNone ? (
        <div className={`text-xs font-semibold flex items-center gap-1 mt-0.5 ${trendUp ? 'text-green-600' : trend < 0 ? 'text-red-500' : 'text-gray-400'}`}>
          <span>{trendUp ? '↗' : trend < 0 ? '↘' : '→'}</span>
          <span>{Math.abs(trend).toFixed(1)}% vs prev period</span>
        </div>
      ) : null}
    </Wrapper>
  )
}
