import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { fmtShort, fmtCount } from '../../../utils/formatters'
import NoData from './NoData'

type ChartDatum = Record<string, unknown>

interface BarChartProps {
  data?: ChartDatum[]
  valueKey: string
  labelKey: string
  color?: string
  isCount?: boolean
}

interface BarTooltip {
  x: number
  y: number
  label: string
  val: number
}

function chartLabelsNeedYear(labels: string[]): boolean {
  const years = new Set<string>()
  labels.forEach((label) => {
    const match = String(label || '').match(/^(\d{4})(?:-\d{2})?(?:-\d{2})?$/)
    if (match) years.add(match[1])
  })
  return years.size > 1
}

function formatAxisLabel(value: unknown, includeYear = false): string {
  const raw = String(value || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return includeYear ? `${raw.slice(2, 4)}-${raw.slice(5)}` : raw.slice(5)
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const month = Number(raw.slice(5, 7))
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthLabel = names[month - 1] || raw.slice(5)
    return includeYear ? `${monthLabel} '${raw.slice(2, 4)}` : monthLabel
  }
  if (/^\d{4}$/.test(raw)) return raw
  return raw.length > 5 ? raw.slice(-5) : raw
}

export default function BarChart({ data, valueKey, labelKey, color = '#9c7a3c', isCount = false }: BarChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const [chartWidth, setChartWidth] = useState(760)
  const [tooltip, setTooltip] = useState<BarTooltip | null>(null)

  useEffect(() => {
    const node = chartRef.current
    if (!node) return undefined
    const updateWidth = () => {
      const nextWidth = Math.round(node.getBoundingClientRect().width || 0)
      if (nextWidth > 0) setChartWidth(nextWidth)
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  if (!data?.length) return <NoData />

  const isCompact = chartWidth < 460
  const W = Math.max(300, chartWidth)
  const H = isCompact ? 178 : 196
  const PAD_L = isCompact ? 42 : 54
  const PAD_B = isCompact ? 28 : 32
  const PAD_T = 12
  const PAD_R = isCompact ? 12 : 16
  const axisFontSize = isCompact ? 11.5 : 12.5
  const xFontSize = isCompact ? 11.5 : 12.5
  const valueFontSize = isCompact ? 11.5 : 12.5
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const axisLabels = data.map((d) => String(d[labelKey] || ''))
  const includeYear = chartLabelsNeedYear(axisLabels)
  const vals = data.map((d) => Number(d[valueKey]) || 0)
  const max = Math.max(...vals, 0.01)
  const rawStep = max / 4
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)))
  const step = Math.ceil(rawStep / mag) * mag || 1
  const yTicks = [1, 2, 3, 4].map((i) => i * step)
  const yMax = yTicks[3]
  const barW = Math.max(isCompact ? 7 : 5, Math.min(isCompact ? 28 : 34, plotW / data.length * 0.58))
  const gap = plotW / data.length

  function yPx(v: number): number {
    return PAD_T + plotH - (v / yMax) * plotH
  }

  const maxLabels = Math.floor(plotW / (includeYear ? 88 : 70))
  const stepLbl = Math.max(1, Math.ceil(data.length / maxLabels))
  const visibleYTicks = isCompact
    ? yTicks.filter((_, index) => index === 0 || index === yTicks.length - 1 || index % 2 === 0)
    : yTicks

  return (
    <div ref={chartRef} className="relative">
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 whitespace-nowrap rounded-xl bg-gray-900 px-3 py-2 text-sm text-white shadow-xl"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -110%)' }}
        >
          <div className="font-bold">{tooltip.label}</div>
          <div className="font-medium">{isCount ? tooltip.val : fmtShort(tooltip.val)}</div>
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        style={{ height: H }}
        onMouseLeave={() => setTooltip(null)}
      >
        {visibleYTicks.map((v) => {
          const y = yPx(v)
          if (y < PAD_T) return null
          return (
            <g key={v}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="currentColor" strokeWidth="1.15" strokeDasharray="4 5" className="text-slate-200 dark:text-slate-700" style={{ color: '#e2e8f0' }} />
              <text x={PAD_L - 9} y={y + axisFontSize * 0.34} textAnchor="end" fontSize={axisFontSize} fontWeight="700" fill="currentColor" className="text-slate-500 dark:text-slate-400" style={{ color: '#64748b' }}>
                {isCount ? fmtCount(v) : fmtShort(v)}
              </text>
            </g>
          )
        })}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="currentColor" strokeWidth="1.35" className="text-slate-300 dark:text-slate-600" style={{ color: '#cbd5e1' }} />

        {data.map((d, i) => {
          const val = Number(d[valueKey]) || 0
          const cx = PAD_L + i * gap + gap / 2
          const barH = Math.max(2, (val / yMax) * plotH)
          const x = cx - barW / 2
          const y = PAD_T + plotH - barH
          const showLbl = i % stepLbl === 0
          const raw = String(d[labelKey] || '')
          const lbl = formatAxisLabel(raw, includeYear)
          return (
            <g
              key={`${raw}-${i}`}
              onMouseEnter={(event: MouseEvent<SVGGElement>) => {
                const svgEl = event.currentTarget.closest('svg') as SVGSVGElement | null
                if (!svgEl) return
                const rect = svgEl.getBoundingClientRect()
                const vbW = svgEl.viewBox.baseVal.width || W
                const scale = rect.width / vbW
                setTooltip({ x: cx * scale, y: y * scale, label: raw, val })
              }}
            >
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                fill={color}
                rx="5"
                opacity="0.88"
                className="cursor-pointer transition-opacity hover:opacity-100"
              />
              {barH > 22 && (
                <text x={cx} y={y - 7} textAnchor="middle" fontSize={valueFontSize} fill={color} fontWeight="750">
                  {isCount ? fmtCount(val) : fmtShort(val)}
                </text>
              )}
              {showLbl && (
                <text x={cx} y={PAD_T + plotH + 24} textAnchor="middle" fontSize={xFontSize} fontWeight="700" fill="currentColor" className="text-slate-600 dark:text-slate-300" style={{ color: '#475569' }}>
                  {lbl}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
