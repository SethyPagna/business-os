import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../AppContext'

// ── Tiny chart components (pure SVG, no deps) ─────────────────────────────────

function BarChart({ data, valueKey, labelKey, color = '#2563eb', height = 120, fmtVal, showLine }) {
  if (!data?.length) return <div className="flex items-center justify-center h-24 text-gray-400 text-xs">No data</div>
  const vals = data.map(d => d[valueKey] || 0)
  const max = Math.max(...vals, 0.01)
  const w = 100 / data.length
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      {data.map((d, i) => {
        const val = d[valueKey] || 0
        const barH = (val / max) * (height - 18)
        const x = i * w + w * 0.1
        const barW = w * 0.8
        const y = height - 18 - barH
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill={color} rx="1" opacity="0.85" />
            {data.length <= 12 && (
              <text x={x + barW / 2} y={height - 4} textAnchor="middle" fontSize="4" fill="#9ca3af">
                {d[labelKey]?.slice(-5) || ''}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function LineChart({ data, lines, height = 140, fmtVal }) {
  if (!data?.length) return <div className="flex items-center justify-center h-24 text-gray-400 text-xs">No data</div>
  const allVals = lines.flatMap(l => data.map(d => d[l.key] || 0))
  const max = Math.max(...allVals, 0.01)
  const pts = (key) => data.map((d, i) => {
    const x = data.length === 1 ? 50 : (i / (data.length - 1)) * 96 + 2
    const y = height - 16 - ((d[key] || 0) / max) * (height - 20)
    return `${x},${y}`
  }).join(' ')

  const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#ea580c', '#7c3aed']

  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1="0" x2="100" y1={height - 16 - f * (height - 20)} y2={height - 16 - f * (height - 20)}
          stroke="#e5e7eb" strokeWidth="0.3" />
      ))}
      {lines.map((l, li) => (
        <g key={l.key}>
          <polyline points={pts(l.key)} fill="none" stroke={l.color || COLORS[li]} strokeWidth="1.2" strokeLinejoin="round" />
          {/* Area fill */}
          <polygon
            points={`2,${height - 16} ${pts(l.key)} 98,${height - 16}`}
            fill={l.color || COLORS[li]} opacity="0.08"
          />
          {/* Dots for small datasets */}
          {data.length <= 14 && data.map((d, i) => {
            const x = data.length === 1 ? 50 : (i / (data.length - 1)) * 96 + 2
            const y = height - 16 - ((d[l.key] || 0) / max) * (height - 20)
            return <circle key={i} cx={x} cy={y} r="1" fill={l.color || COLORS[li]} />
          })}
        </g>
      ))}
      {/* X labels */}
      {data.length <= 14 && data.map((d, i) => {
        const x = data.length === 1 ? 50 : (i / (data.length - 1)) * 96 + 2
        return (
          <text key={i} x={x} y={height - 4} textAnchor="middle" fontSize="3.5" fill="#9ca3af">
            {String(d.period || '').slice(-5)}
          </text>
        )
      })}
    </svg>
  )
}

function DonutChart({ data, valueKey, labelKey, height = 120 }) {
  if (!data?.length) return <div className="flex items-center justify-center h-24 text-gray-400 text-xs">No data</div>
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0)
  if (total === 0) return <div className="flex items-center justify-center h-24 text-gray-400 text-xs">No data</div>
  const COLORS = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626', '#0891b2', '#0f766e']
  let cumulative = 0
  const cx = 50, cy = 50, r = 38, inner = 22
  const slices = data.slice(0, 7).map((d, i) => {
    const val = d[valueKey] || 0
    const pct = val / total
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2
    cumulative += pct
    const endAngle = cumulative * 2 * Math.PI - Math.PI / 2
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle)
    const xi1 = cx + inner * Math.cos(startAngle), yi1 = cy + inner * Math.sin(startAngle)
    const xi2 = cx + inner * Math.cos(endAngle),   yi2 = cy + inner * Math.sin(endAngle)
    const large = pct > 0.5 ? 1 : 0
    return { path: `M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${xi2},${yi2} A${inner},${inner} 0 ${large},0 ${xi1},${yi1} Z`, color: COLORS[i], label: d[labelKey], pct }
  })
  return (
    <svg viewBox="0 0 100 100" className="w-full" style={{ height }}>
      {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} opacity="0.9" stroke="white" strokeWidth="0.5" />)}
      <text x="50" y="48" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#374151">{data.length}</text>
      <text x="50" y="57" textAnchor="middle" fontSize="4" fill="#9ca3af">types</text>
    </svg>
  )
}

function MiniStat({ label, value, sub, color, trend }) {
  const trendColor = trend > 0 ? 'text-green-500' : trend < 0 ? 'text-red-500' : 'text-gray-400'
  const trendIcon = trend > 0 ? '↑' : trend < 0 ? '↓' : '→'
  return (
    <div className="card p-4 flex flex-col gap-1">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-xl font-bold ${color || 'text-gray-900 dark:text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
      {trend !== undefined && (
        <div className={`text-xs font-medium ${trendColor}`}>
          {trendIcon} {Math.abs(trend).toFixed(1)}% vs prev period
        </div>
      )}
    </div>
  )
}

// ── Date range helpers ────────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().split('T')[0] }
function offsetDate(days) { return new Date(Date.now() + days * 86400000).toISOString().split('T')[0] }

const RANGE_PRESETS = [
  { id: 'today',   label: 'Today',      getRange: () => ({ start: todayStr(), end: todayStr(), gran: 'day' }) },
  { id: '7d',      label: '7 Days',     getRange: () => ({ start: offsetDate(-6), end: todayStr(), gran: 'day' }) },
  { id: '30d',     label: '30 Days',    getRange: () => ({ start: offsetDate(-29), end: todayStr(), gran: 'day' }) },
  { id: '90d',     label: '90 Days',    getRange: () => ({ start: offsetDate(-89), end: todayStr(), gran: 'week' }) },
  { id: 'month',   label: 'This Month', getRange: () => {
    const n = new Date(); return { start: `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`, end: todayStr(), gran: 'day' }
  }},
  { id: 'year',    label: 'This Year',  getRange: () => ({ start: `${new Date().getFullYear()}-01-01`, end: todayStr(), gran: 'month' }) },
  { id: 'custom',  label: 'Custom',     getRange: null },
]

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { t, fmtUSD, fmtKHR } = useApp()

  const [summary, setSummary]   = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [aLoading, setALoading] = useState(true)

  const [rangeId, setRangeId] = useState('30d')
  const [customStart, setCustomStart] = useState(offsetDate(-29))
  const [customEnd, setCustomEnd]     = useState(todayStr())
  const [granularity, setGranularity] = useState('day')
  const [activeChart, setActiveChart] = useState('revenue') // revenue | profit | volume | hourly
  const [topMode, setTopMode] = useState('revenue') // revenue | qty

  // Load summary (all-time kpis)
  useEffect(() => {
    window.api.getDashboard().then(d => { setSummary(d); setLoading(false) })
  }, [])

  // Load analytics when range changes
  const loadAnalytics = useCallback(() => {
    setALoading(true)
    let start, end, gran
    const preset = RANGE_PRESETS.find(r => r.id === rangeId)
    if (preset?.getRange) {
      const r = preset.getRange(); start = r.start; end = r.end; gran = r.gran
    } else {
      start = customStart; end = customEnd; gran = granularity
    }
    window.api.getAnalytics({ startDate: start, endDate: end, granularity: gran })
      .then(d => { setAnalytics(d); setALoading(false) })
  }, [rangeId, customStart, customEnd, granularity])

  useEffect(() => { loadAnalytics() }, [loadAnalytics])

  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-400">{t('loading')}</div>

  const profit = (summary?.cost_out || 0) - (summary?.cost_in || 0)
  const profitKhr = (summary?.cost_out_khr || 0) - (summary?.cost_in_khr || 0)

  // Trend calculation vs previous period
  const calcTrend = (current, previous) => {
    if (!previous || previous === 0) return undefined
    return ((current - previous) / previous) * 100
  }

  const aRevenue = analytics?.totals?.revenue_usd || 0
  const aPrevRevenue = analytics?.prevTotals?.revenue_usd || 0
  const aTxCount = analytics?.totals?.tx_count || 0
  const aPrevTxCount = analytics?.prevTotals?.tx_count || 0
  const aProfit = analytics?.totals?.profit_usd || 0
  const aCost   = analytics?.totals?.cost_usd || 0
  const aAvgOrder = analytics?.totals?.avg_order_usd || 0

  const chartData = analytics?.periodData || []
  const topList = topMode === 'qty' ? (analytics?.topProductsQty || []) : (analytics?.topProducts || [])

  const rangeLabel = (() => {
    const p = RANGE_PRESETS.find(r => r.id === rangeId)
    if (p && p.getRange) { const r = p.getRange(); return `${r.start} → ${r.end}` }
    return `${customStart} → ${customEnd}`
  })()

  return (
    <div className="flex-1 p-5 overflow-auto space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📊 {t('dashboard')}</h1>
        <button onClick={() => { window.api.getDashboard().then(d => setSummary(d)); loadAnalytics() }}
          className="btn-secondary text-sm">↺ {t('loading').replace ? '↺' : '↺'} Refresh</button>
      </div>

      {/* ── All-time KPI strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MiniStat label={`💵 ${t('today_sales')}`} value={fmtUSD(summary?.today_total||0)}
          sub={`${summary?.today_count||0} ${t('transactions')}`} color="text-green-600" />
        <MiniStat label={`📈 ${t('total_revenue')}`} value={fmtUSD(summary?.all_total||0)}
          sub={fmtKHR(summary?.all_total_khr||0)} color="text-blue-600" />
        <MiniStat label={`🛒 ${t('cost_in')}`} value={fmtUSD(summary?.cost_in||0)}
          sub={fmtKHR(summary?.cost_in_khr||0)} color="text-red-600" />
        <MiniStat label={`✅ ${t('profit')}`} value={fmtUSD(profit)}
          sub={fmtKHR(profitKhr)} color={profit >= 0 ? 'text-green-600' : 'text-red-600'} />
        <MiniStat label={`📦 ${t('products_total')}`} value={summary?.product_count||0}
          sub={`${summary?.low_stock?.length||0} ${t('low_stock')}`} />
      </div>

      {/* ── Time Range Selector ── */}
      <div className="card p-4">
        <div className="flex items-center flex-wrap gap-3">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">📅 Range:</span>
          <div className="flex gap-1.5 flex-wrap">
            {RANGE_PRESETS.map(p => (
              <button key={p.id} onClick={() => setRangeId(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${rangeId===p.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {rangeId === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" className="input text-xs py-1.5 w-36" value={customStart} onChange={e => setCustomStart(e.target.value)} />
              <span className="text-gray-400 text-xs">→</span>
              <input type="date" className="input text-xs py-1.5 w-36" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
              <select className="input text-xs py-1.5 w-28" value={granularity} onChange={e => setGranularity(e.target.value)}>
                <option value="day">{t('today')}</option>
                <option value="week">{t('this_week')}</option>
                <option value="month">{t('this_month')}</option>
              </select>
            </div>
          )}
          <span className="text-xs text-gray-400 ml-auto">{rangeLabel}</span>
        </div>
      </div>

      {/* ── Period KPI Cards ── */}
      {aLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="card p-4 h-24 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MiniStat label={`💰 ${t('cost_out')}`} value={fmtUSD(aRevenue)}
            sub={analytics?.totals?.revenue_khr ? fmtKHR(analytics.totals.revenue_khr) : null}
            color="text-blue-600" trend={calcTrend(aRevenue, aPrevRevenue)} />
          <MiniStat label={`🛒 ${t('cogs')}`} value={fmtUSD(aCost)}
            color="text-red-600" />
          <MiniStat label={`✅ ${t('profit')}`} value={fmtUSD(aProfit)}
            color={aProfit >= 0 ? 'text-green-600' : 'text-red-600'}
            sub={aRevenue > 0 ? `${((aProfit/aRevenue)*100).toFixed(1)}% ${t('margin')}` : null} />
          <MiniStat label={`🧾 ${t('transactions')}`} value={aTxCount}
            sub={`avg ${fmtUSD(aAvgOrder)} / ${t('sale')}`}
            trend={calcTrend(aTxCount, aPrevTxCount)} />
        </div>
      )}

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Main trend chart — 2/3 width */}
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm">📈 {t('analytics')}</h2>
            <div className="flex gap-1">
              {[['revenue', t('revenue')],['profit', `${t('profit')} vs ${t('cogs')}`],['volume', t('transactions')]].map(([id,lbl]) => (
                <button key={id} onClick={() => setActiveChart(id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${activeChart===id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {aLoading ? <div className="h-36 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          : chartData.length === 0 ? <div className="h-36 flex items-center justify-center text-gray-400 text-sm">No sales in this period</div>
          : activeChart === 'revenue' ? (
            <>
              <LineChart data={chartData} lines={[{ key: 'revenue_usd', color: '#2563eb', label: 'Revenue' }]} height={150} />
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-1.5"><div className="w-3 h-1 rounded bg-blue-600"/><span className="text-xs text-gray-500">Revenue (USD)</span></div>
              </div>
            </>
          ) : activeChart === 'profit' ? (
            <>
              <LineChart data={chartData} lines={[
                { key: 'revenue_usd', color: '#2563eb' },
                { key: 'cost_usd', color: '#dc2626' },
                { key: 'profit_usd', color: '#16a34a' },
              ]} height={150} />
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                <div className="flex items-center gap-1.5"><div className="w-3 h-1 rounded bg-blue-600"/><span className="text-xs text-gray-500">Revenue</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-1 rounded bg-red-600"/><span className="text-xs text-gray-500">Cost</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-1 rounded bg-green-600"/><span className="text-xs text-gray-500">Profit</span></div>
              </div>
            </>
          ) : (
            <>
              <BarChart data={chartData} valueKey="count" labelKey="period" color="#7c3aed" height={150} />
              <div className="flex items-center gap-1.5 mt-2"><div className="w-3 h-3 rounded bg-purple-600"/><span className="text-xs text-gray-500">Transactions</span></div>
            </>
          )}
        </div>

        {/* Payment methods donut — 1/3 */}
        <div className="card p-4">
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">💳 {t('payment_method')}</h2>
          {aLoading ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (
            <>
              <DonutChart data={analytics?.byPayment||[]} valueKey="revenue_usd" labelKey="payment_method" height={100} />
              <div className="mt-2 space-y-1 max-h-32 overflow-auto">
                {(analytics?.byPayment||[]).map((p, i) => {
                  const COLORS = ['#2563eb','#16a34a','#ea580c','#7c3aed','#dc2626','#0891b2']
                  const total = (analytics?.byPayment||[]).reduce((s,x) => s+(x.revenue_usd||0), 0)
                  const pct = total > 0 ? ((p.revenue_usd||0)/total*100).toFixed(1) : 0
                  return (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: COLORS[i%COLORS.length]}} />
                        <span className="text-gray-600 dark:text-gray-400 truncate max-w-20">{p.payment_method}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium text-gray-900 dark:text-white">{pct}%</span>
                        <span className="text-gray-400 ml-1">({p.count})</span>
                      </div>
                    </div>
                  )
                })}
                {!(analytics?.byPayment?.length) && <p className="text-xs text-gray-400 text-center py-2">No data</p>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Branch + Top Products + Hourly Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Branch comparison */}
        <div className="card p-4">
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">🏪 {t('branch_performance')}</h2>
          {aLoading ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (
            <div className="space-y-2">
              {(analytics?.byBranch||[]).length === 0
                ? <p className="text-xs text-gray-400 text-center py-4">No data</p>
                : (() => {
                  const maxRev = Math.max(...(analytics?.byBranch||[]).map(b => b.revenue_usd||0), 0.01)
                  return (analytics?.byBranch||[]).map((b, i) => {
                    const pct = ((b.revenue_usd||0) / maxRev * 100).toFixed(0)
                    const COLORS = ['#2563eb','#16a34a','#ea580c','#7c3aed','#0891b2']
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-gray-600 dark:text-gray-400 truncate max-w-28">{b.branch_name}</span>
                          <span className="font-medium text-gray-900 dark:text-white">{fmtUSD(b.revenue_usd||0)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                        </div>
                        <div className="text-right text-xs text-gray-400 mt-0.5">{b.count} sales</div>
                      </div>
                    )
                  })
                })()
              }
            </div>
          )}
        </div>

        {/* Top Products */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm">🏆 {t('top_products')}</h2>
            <div className="flex gap-1">
              {[['revenue', `$ ${t('revenue')}`],['qty', t('quantity')]].map(([m,lbl]) => (
                <button key={m} onClick={() => setTopMode(m)}
                  className={`px-2 py-0.5 text-xs rounded font-medium ${topMode===m ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          {aLoading ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (
            <div className="space-y-1.5 max-h-52 overflow-auto">
              {topList.length === 0
                ? <p className="text-xs text-gray-400 text-center py-4">No sales in period</p>
                : topList.map((p, i) => {
                  const maxVal = topMode === 'qty' ? topList[0]?.qty_sold||1 : topList[0]?.revenue_usd||1
                  const val = topMode === 'qty' ? p.qty_sold : p.revenue_usd
                  const pct = (val / maxVal * 100).toFixed(0)
                  return (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-400 w-4 text-right">{i+1}.</span>
                          <span className="text-gray-700 dark:text-gray-300 truncate max-w-32">{p.product_name}</span>
                        </div>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {topMode === 'qty' ? `${p.qty_sold} ${t('qty_sold')}` : fmtUSD(p.revenue_usd)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden ml-5">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })
              }
            </div>
          )}
        </div>

        {/* Hourly heatmap */}
        <div className="card p-4">
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">🕐 {t('best_hour')}</h2>
          {aLoading ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (
            (() => {
              const hourly = analytics?.hourlyDist || []
              const maxCount = Math.max(...hourly.map(h => h.count||0), 1)
              // Fill all 24 hours
              const allHours = Array.from({length:24}, (_, i) => {
                const h = hourly.find(x => parseInt(x.hour) === i)
                return { hour: i, count: h?.count||0, revenue_usd: h?.revenue_usd||0 }
              })
              return (
                <>
                  <div className="grid grid-cols-12 gap-0.5">
                    {allHours.map(h => {
                      const intensity = h.count / maxCount
                      const opacity = intensity === 0 ? 0.07 : 0.15 + intensity * 0.85
                      return (
                        <div key={h.hour} title={`${h.hour}:00 — ${h.count} sales, ${fmtUSD(h.revenue_usd)}`}
                          className="rounded-sm cursor-default"
                          style={{ height: 28, background: `rgba(37,99,235,${opacity})` }}
                        />
                      )
                    })}
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1 px-0.5">
                    <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {hourly.sort((a,b)=>b.count-a.count).slice(0,3).map((h,i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-gray-500 dark:text-gray-400">
                          🏅 {i===0?'Best ':i===1?'2nd ':''}{parseInt(h.hour)<12?`${parseInt(h.hour)||12}am`:`${parseInt(h.hour)-12||12}pm`}
                        </span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{h.count} sales · {fmtUSD(h.revenue_usd)}</span>
                      </div>
                    ))}
                    {!hourly.length && <p className="text-xs text-gray-400 text-center">No data</p>}
                  </div>
                </>
              )
            })()
          )}
        </div>
      </div>

      {/* ── Low Stock + Recent Sales ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-white">⚠️ {t('low_stock_items')}</h2>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-56 overflow-auto">
            {!summary?.low_stock?.length
              ? <p className="p-4 text-sm text-gray-400 text-center">{t('in_stock')} ✓</p>
              : summary.low_stock.map(p => (
                <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{p.name}</p>
                    {p.category && <p className="text-xs text-gray-400">{p.category}</p>}
                  </div>
                  <span className="badge-yellow">{p.stock_quantity} {p.unit}</span>
                </div>
              ))}
          </div>
        </div>

        <div className="card">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-white">🕐 {t('recent_activity')}</h2>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-56 overflow-auto">
            {!summary?.recent_sales?.length
              ? <p className="p-4 text-sm text-gray-400 text-center">{t('no_data')}</p>
              : summary.recent_sales.map(s => (
                <div key={s.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{s.receipt_number}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(s.created_at).toLocaleString()} {s.branch_name ? `· ${s.branch_name}` : ''} {s.customer_name ? `· ${s.customer_name}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-green-600">{fmtUSD(s.total_usd||s.total||0)}</span>
                    {s.total_khr > 0 && <div className="text-xs text-gray-400">{fmtKHR(s.total_khr)}</div>}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

    </div>
  )
}
