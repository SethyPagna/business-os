import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { fmtShort } from '../../../utils/formatters'
import NoData from './NoData'

type ChartDatum = Record<string, unknown>

interface LineDefinition {
  key: string
  label?: string
  color?: string
}

interface LineChartProps {
  data?: ChartDatum[]
  lines?: LineDefinition[]
}

interface LineTooltip {
  x: number
  y: number
  data: ChartDatum
  idx: number
}

const CHART_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626', '#0891b2', '#0f766e']

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

export default function LineChart({ data, lines }: LineChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const [chartWidth, setChartWidth] = useState(760)
  const [tooltip, setTooltip] = useState<LineTooltip | null>(null)

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

  const safeLines = Array.isArray(lines) ? lines.filter((line) => line?.key) : []
  if (!data?.length || !safeLines.length) return <NoData />
  const chartData = data

  const isCompact = chartWidth < 460
  const W = Math.max(300, chartWidth)
  const H = isCompact ? 178 : 196
  const PAD_L = isCompact ? 42 : 54
  const PAD_B = isCompact ? 28 : 32
  const PAD_T = 12
  const PAD_R = isCompact ? 12 : 16
  const axisFontSize = isCompact ? 11.5 : 12.5
  const xFontSize = isCompact ? 11.5 : 12.5
  const outerPointRadius = isCompact ? 5.2 : 5.8
  const innerPointRadius = isCompact ? 3.1 : 3.6
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const periodLabels = chartData.map((datum) => String(datum.period || ''))
  const includeYear = chartLabelsNeedYear(periodLabels)
  const allVals = safeLines.flatMap((line) => chartData.map((datum) => Number(datum[line.key])).filter(Number.isFinite))
  const rawMin = Math.min(...allVals, 0)
  const rawMax = Math.max(...allVals, 0)
  const span = Math.max(rawMax - rawMin, 0.01)
  const rawStep = span / 4
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)))
  const step = Math.ceil(rawStep / mag) * mag || 1
  const yMin = Math.min(0, Math.floor(rawMin / step) * step)
  const yMax = Math.max(step, Math.ceil(rawMax / step) * step)
  const yTicks: number[] = []
  for (let tick = yMin; tick <= yMax + step / 2; tick += step) yTicks.push(Number(tick.toFixed(8)))
  const ySpan = Math.max(yMax - yMin, step)

  function xPx(index: number): number {
    return PAD_L + (chartData.length === 1 ? plotW / 2 : (index / (chartData.length - 1)) * plotW)
  }

  function yPx(value: number): number {
    return PAD_T + ((yMax - value) / ySpan) * plotH
  }

  const maxLabels = Math.floor(plotW / (includeYear ? 88 : 70))
  const stepLbl = Math.max(1, Math.ceil(data.length / maxLabels))
  const visibleYTicks = isCompact
    ? yTicks.filter((_, index) => index === 0 || index === yTicks.length - 1 || index % 2 === 0)
    : yTicks

  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const svg = event.currentTarget
    const rect = svg.getBoundingClientRect()
    const vbW = svg.viewBox.baseVal.width || W
    const scale = vbW / rect.width
    const mouseX = (event.clientX - rect.left) * scale
    let minDist = Infinity
    let closest: ChartDatum | null = null
    let closestIdx = -1
    chartData.forEach((datum, index) => {
      const dist = Math.abs(xPx(index) - mouseX)
      if (dist < minDist) {
        minDist = dist
        closest = datum
        closestIdx = index
      }
    })
    if (closest && minDist < Math.max(8, plotW / chartData.length)) {
      const tooltipX = xPx(closestIdx) / scale
      const tooltipY = Math.min(...safeLines.map((line) => yPx(Number(closest?.[line.key]) || 0))) / scale
      setTooltip({ x: tooltipX, y: Math.max(tooltipY - 8, 4), data: closest, idx: closestIdx })
    } else {
      setTooltip(null)
    }
  }

  return (
    <div ref={chartRef} className="relative">
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 whitespace-nowrap rounded-xl bg-gray-900 px-3 py-2 text-sm text-white shadow-xl"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -110%)' }}
        >
          <div className="mb-1 font-bold">{String(tooltip.data.period || '')}</div>
          {safeLines.map((line, index) => (
            <div key={line.key} className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: line.color || CHART_COLORS[index] }} />
              <span className="font-medium">{line.label || line.key}: {fmtShort(Number(tooltip.data[line.key]) || 0)}</span>
            </div>
          ))}
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        style={{ height: H }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        {visibleYTicks.map((value) => {
          const y = yPx(value)
          if (y < PAD_T) return null
          return (
            <g key={value}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="currentColor" strokeWidth="1.15" strokeDasharray={value === 0 ? undefined : '4 5'} className="text-slate-200 dark:text-slate-700" style={{ color: '#e2e8f0' }} />
              <text x={PAD_L - 9} y={y + axisFontSize * 0.34} textAnchor="end" fontSize={axisFontSize} fontWeight="700" fill="currentColor" className="text-slate-500 dark:text-slate-400" style={{ color: '#64748b' }}>{fmtShort(value)}</text>
            </g>
          )
        })}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="currentColor" strokeWidth="1.35" className="text-slate-300 dark:text-slate-600" style={{ color: '#cbd5e1' }} />

        {safeLines.map((line, lineIndex) => {
          const color = line.color || CHART_COLORS[lineIndex]
          const pts = chartData.map((datum, index) => `${xPx(index)},${yPx(Number(datum[line.key]) || 0)}`).join(' ')
          const baseY = yPx(0)
          const areaPoints = `${xPx(0)},${baseY} ${pts} ${xPx(chartData.length - 1)},${baseY}`
          return (
            <g key={line.key}>
              {safeLines.length === 1 ? (
                <>
                  <defs>
                    <linearGradient id={`line-area-${line.key}`} x1="0" y1={PAD_T} x2="0" y2={PAD_T + plotH} gradientUnits="userSpaceOnUse">
                      <stop offset="0" stopColor={color} stopOpacity="0.18" />
                      <stop offset="0.72" stopColor={color} stopOpacity="0.05" />
                      <stop offset="1" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <polygon points={areaPoints} fill={`url(#line-area-${line.key})`} />
                </>
              ) : null}
              <polyline points={pts} fill="none" stroke={color} strokeWidth={isCompact ? 2.8 : 3} strokeLinejoin="round" strokeLinecap="round" />
              {chartData.length <= 31 && chartData.map((datum, index) => {
                const value = Number(datum[line.key]) || 0
                const isHovered = tooltip?.idx === index
                const showPoint = isHovered || value !== 0 || index === 0 || (index === chartData.length - 1 && value !== 0)
                if (!showPoint) return null
                return (
                  <g key={`${line.key}-${index}`}>
                    {/* Point halo/inner fill: was hardcoded `fill="white"`
                        with no dark-mode counterpart, so every point
                        rendered a literal bright-white circle on dark
                        cards -- var(--chart-point-fill) (styles/main.css)
                        follows the same background dark mode already
                        uses for this chart's containing card. */}
                    <circle cx={xPx(index)} cy={yPx(value)} r={isHovered ? outerPointRadius + 1.3 : outerPointRadius} fill="var(--chart-point-fill)" stroke={`${color}20`} strokeWidth={isCompact ? 4 : 4.2} />
                    <circle
                      cx={xPx(index)}
                      cy={yPx(value)}
                      r={isHovered ? innerPointRadius + 1.2 : innerPointRadius}
                      fill={isHovered ? color : 'var(--chart-point-fill)'}
                      stroke={color}
                      strokeWidth={isCompact ? 2 : 2.1}
                      className="transition-all"
                    />
                  </g>
                )
              })}
            </g>
          )
        })}

        {tooltip && (
          <line
            x1={xPx(tooltip.idx)}
            x2={xPx(tooltip.idx)}
            y1={PAD_T}
            y2={PAD_T + plotH}
            stroke="currentColor"
            strokeWidth="1.25"
            strokeDasharray="3 3"
            className="text-slate-400 dark:text-slate-500"
            style={{ color: '#94a3b8' }}
          />
        )}

        {chartData.map((datum, index) => {
          if (index % stepLbl !== 0) return null
          const raw = String(datum.period || '')
          const lbl = formatAxisLabel(raw, includeYear)
          return (
            <text key={`${raw}-${index}`} x={xPx(index)} y={PAD_T + plotH + 24} textAnchor="middle" fontSize={xFontSize} fontWeight="700" fill="currentColor" className="text-slate-600 dark:text-slate-300" style={{ color: '#475569' }}>
              {lbl}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
