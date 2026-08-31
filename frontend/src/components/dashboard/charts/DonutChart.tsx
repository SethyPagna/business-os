import { useState } from 'react'
import { fmtShort } from '../../../utils/formatters'
import NoData from './NoData'

type DonutDatum = Record<string, unknown>

interface DonutChartProps {
  data?: DonutDatum[]
  valueKey: string
  // The donut carries its own compact legend to the right of the ring. Callers
  // that render their own richer legend beside the chart (e.g. the dashboard
  // Payment Method card, which lists name + % + count) pass showLegend={false}
  // so the two legends don't duplicate; the viewBox then tightens to just the
  // ring so it centres instead of leaving the legend column blank. Defaults to
  // true so the exported-report donut keeps its self-contained legend.
  showLegend?: boolean
}

interface DonutSlice {
  path: string
  color: string
  pct: number
  raw: DonutDatum
  val: number
}

const CHART_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626', '#0891b2', '#0f766e']

export default function DonutChart({ data, valueKey, showLegend = true }: DonutChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  if (!data?.length) return <NoData />

  const total = data.reduce((sum, datum) => sum + (Number(datum[valueKey]) || 0), 0)
  if (!total) return <NoData />

  // Without the legend the ring is all that's drawn, so crop the viewBox to it
  // (it spans x 16..124) and centre it rather than leaving the legend column.
  const W = showLegend ? 260 : 140
  const H = 140
  const cx = 70
  const cy = 70
  const r = 54
  const inner = 32
  let cum = 0
  const slices: DonutSlice[] = data.slice(0, 7).map((datum, index) => {
    const val = Number(datum[valueKey]) || 0
    const pct = val / total
    const color = CHART_COLORS[index % CHART_COLORS.length]
    if (pct >= 0.999999) {
      return {
        path: `M${cx},${cy - r} A${r},${r} 0 1,1 ${cx},${cy + r} A${r},${r} 0 1,1 ${cx},${cy - r} M${cx},${cy - inner} A${inner},${inner} 0 1,0 ${cx},${cy + inner} A${inner},${inner} 0 1,0 ${cx},${cy - inner} Z`,
        color,
        pct,
        raw: datum,
        val,
      }
    }
    const a0 = cum * 2 * Math.PI - Math.PI / 2
    cum += pct
    const a1 = cum * 2 * Math.PI - Math.PI / 2
    const x1 = cx + r * Math.cos(a0)
    const y1 = cy + r * Math.sin(a0)
    const x2 = cx + r * Math.cos(a1)
    const y2 = cy + r * Math.sin(a1)
    const ix1 = cx + inner * Math.cos(a0)
    const iy1 = cy + inner * Math.sin(a0)
    const ix2 = cx + inner * Math.cos(a1)
    const iy2 = cy + inner * Math.sin(a1)
    const large = pct > 0.5 ? 1 : 0
    return {
      path: `M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${ix2},${iy2} A${inner},${inner} 0 ${large},0 ${ix1},${iy1} Z`,
      color,
      pct,
      raw: datum,
      val,
    }
  })

  const hovered = hoveredIdx !== null ? slices[hoveredIdx] : null

  return (
    <div className="relative">
      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-1 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-center text-xs text-white shadow-xl">
          <div className="font-semibold">{String(hovered.raw.payment_method || hovered.raw.name || '')}</div>
          <div>{fmtShort(hovered.val)} - {(hovered.pct * 100).toFixed(1)}%</div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        {slices.map((slice, index) => (
          <path
            key={`${slice.color}-${index}`}
            d={slice.path}
            fill={slice.color}
            fillRule="evenodd"
            stroke="var(--chart-point-fill)"
            strokeWidth={hoveredIdx === index ? 2.5 : 1.5}
            opacity={hoveredIdx !== null && hoveredIdx !== index ? 0.65 : 1}
            className="cursor-pointer transition-all"
            onMouseEnter={() => setHoveredIdx(index)}
            onMouseLeave={() => setHoveredIdx(null)}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="13" fontWeight="600" fill="currentColor" className="text-slate-700 dark:text-slate-200" style={{ color: '#374151' }}>{slices.length}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="10" fill="currentColor" className="text-slate-400 dark:text-slate-400" style={{ color: '#9ca3af' }}>methods</text>

        {showLegend && slices.map((slice, index) => {
          const label = String(slice.raw.payment_method || slice.raw.name || `#${index + 1}`)
          const short = label.length > 10 ? `${label.slice(0, 10)}...` : label
          return (
            <g
              key={`${slice.color}-legend-${index}`}
              transform={`translate(148, ${12 + index * 18})`}
              className="cursor-pointer"
              opacity={hoveredIdx !== null && hoveredIdx !== index ? 0.5 : 1}
              onMouseEnter={() => setHoveredIdx(index)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <rect width="10" height="10" rx="2" fill={slice.color} />
              <text x="14" y="9" fontSize="11" fill="currentColor" className="text-slate-600 dark:text-slate-300" style={{ color: '#4b5563' }}>{short}</text>
              <text x="108" y="9" textAnchor="end" fontSize="11" fill="currentColor" className="text-slate-500 dark:text-slate-400" style={{ color: '#6b7280' }}>{(slice.pct * 100).toFixed(0)}%</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
