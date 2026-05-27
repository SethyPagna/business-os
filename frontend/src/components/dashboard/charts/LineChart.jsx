// ── LineChart ─────────────────────────────────────────────────────────────────
// Pure SVG multi-line chart with hover tooltip — no external charting deps.
// Props:
//   data   {Object[]}  Each object must have a `period` key (x-axis label)
//   lines  {Array}     [{key, label, color}] — one entry per line to draw

import { useEffect, useRef, useState } from 'react'
import { fmtShort } from '../../../utils/formatters'
import NoData from './NoData'

const CHART_COLORS = ['#2563eb','#16a34a','#ea580c','#7c3aed','#dc2626','#0891b2','#0f766e']

function chartLabelsNeedYear(labels) {
  const years = new Set()
  labels.forEach((label) => {
    const match = String(label || '').match(/^(\d{4})(?:-\d{2})?(?:-\d{2})?$/)
    if (match) years.add(match[1])
  })
  return years.size > 1
}

function formatAxisLabel(value, includeYear = false) {
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

export default function LineChart({ data, lines }) {
  // ⚑ Hook must come before any early return (Rules of Hooks)
  const chartRef = useRef(null)
  const [chartWidth, setChartWidth] = useState(760)
  const [tooltip, setTooltip] = useState(null)
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
  const periodLabels = data.map((d) => String(d.period || ''))
  const includeYear = chartLabelsNeedYear(periodLabels)

  const allVals = safeLines.flatMap(l => data.map(d => Number(d[l.key])).filter(Number.isFinite))
  const rawMin = Math.min(...allVals, 0)
  const rawMax = Math.max(...allVals, 0)
  const span = Math.max(rawMax - rawMin, 0.01)
  const rawStep = span / 4
  const mag     = Math.pow(10, Math.floor(Math.log10(rawStep || 1)))
  const step    = Math.ceil(rawStep / mag) * mag || 1
  const yMin = Math.min(0, Math.floor(rawMin / step) * step)
  const yMax = Math.max(step, Math.ceil(rawMax / step) * step)
  const yTicks  = []
  for (let tick = yMin; tick <= yMax + step / 2; tick += step) yTicks.push(Number(tick.toFixed(8)))
  const ySpan = Math.max(yMax - yMin, step)

  function xPx(i) { return PAD_L + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW) }
  function yPx(v) { return PAD_T + ((yMax - v) / ySpan) * plotH }

  const maxLabels = Math.floor(plotW / (includeYear ? 88 : 70))
  const stepLbl   = Math.max(1, Math.ceil(data.length / maxLabels))
  const visibleYTicks = isCompact
    ? yTicks.filter((_, index) => index === 0 || index === yTicks.length - 1 || index % 2 === 0)
    : yTicks

  const handleMouseMove = (e) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const vbW = svg.viewBox.baseVal.width || W
    const scale = vbW / rect.width
    const mouseX = (e.clientX - rect.left) * scale
    let minDist = Infinity, closest = null, closestIdx = -1
    data.forEach((d, i) => {
      const dist = Math.abs(xPx(i) - mouseX)
      if (dist < minDist) { minDist = dist; closest = d; closestIdx = i }
    })
    if (closest && minDist < Math.max(8, plotW / data.length)) {
      const tooltipX = xPx(closestIdx) / scale
      const tooltipY = Math.min(...safeLines.map(l => yPx(Number(closest[l.key]) || 0))) / scale
      setTooltip({ x: tooltipX, y: Math.max(tooltipY - 8, 4), data: closest, idx: closestIdx })
    } else {
      setTooltip(null)
    }
  }

  return (
    <div ref={chartRef} className="relative">
      {tooltip && (
        <div className="absolute z-20 pointer-events-none whitespace-nowrap rounded-xl bg-gray-900 px-3 py-2 text-sm text-white shadow-xl"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -110%)' }}>
          <div className="mb-1 font-bold">{String(tooltip.data.period || '')}</div>
          {safeLines.map((l, i) => (
            <div key={l.key} className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: l.color || CHART_COLORS[i] }} />
              <span className="font-medium">{l.label || l.key}: {fmtShort(Number(tooltip.data[l.key]) || 0)}</span>
            </div>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
        {visibleYTicks.map(v => {
          const y = yPx(v)
          if (y < PAD_T) return null
          return (
            <g key={v}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1.15" strokeDasharray={v === 0 ? undefined : '4 5'} />
              <text x={PAD_L - 9} y={y + axisFontSize * 0.34} textAnchor="end" fontSize={axisFontSize} fontWeight="700" fill="#64748b">{fmtShort(v)}</text>
            </g>
          )
        })}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="#cbd5e1" strokeWidth="1.35" />

        {safeLines.map((l, li) => {
          const col = l.color || CHART_COLORS[li]
          const pts = data.map((d, i) => `${xPx(i)},${yPx(Number(d[l.key]) || 0)}`).join(' ')
          const baseY = yPx(0)
          const areaPoints = `${xPx(0)},${baseY} ${pts} ${xPx(data.length-1)},${baseY}`
          return (
            <g key={l.key}>
              {safeLines.length === 1 ? (
                <>
                  <defs>
                    <linearGradient id={`line-area-${l.key}`} x1="0" y1={PAD_T} x2="0" y2={PAD_T + plotH} gradientUnits="userSpaceOnUse">
                      <stop offset="0" stopColor={col} stopOpacity="0.18" />
                      <stop offset="0.72" stopColor={col} stopOpacity="0.05" />
                      <stop offset="1" stopColor={col} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <polygon points={areaPoints} fill={`url(#line-area-${l.key})`} />
                </>
              ) : null}
              <polyline points={pts} fill="none" stroke={col} strokeWidth={isCompact ? 2.8 : 3} strokeLinejoin="round" strokeLinecap="round" />
              {data.length <= 31 && data.map((d, i) => {
                const v = Number(d[l.key]) || 0
                const isHovered = tooltip?.idx === i
                const showPoint = isHovered || v !== 0 || i === 0 || (i === data.length - 1 && v !== 0)
                if (!showPoint) return null
                return (
                  <g key={i}>
                    <circle cx={xPx(i)} cy={yPx(v)} r={isHovered ? outerPointRadius + 1.3 : outerPointRadius} fill="white" stroke={`${col}20`} strokeWidth={isCompact ? 4 : 4.2} />
                    <circle cx={xPx(i)} cy={yPx(v)} r={isHovered ? innerPointRadius + 1.2 : innerPointRadius}
                      fill={isHovered ? col : 'white'} stroke={col} strokeWidth={isCompact ? 2 : 2.1}
                      className="transition-all" />
                  </g>
                )
              })}
            </g>
          )
        })}

        {tooltip && (
          <line x1={xPx(tooltip.idx)} x2={xPx(tooltip.idx)} y1={PAD_T} y2={PAD_T + plotH}
            stroke="#94a3b8" strokeWidth="1.25" strokeDasharray="3 3" />
        )}

        {data.map((d, i) => {
          if (i % stepLbl !== 0) return null
          const raw = String(d.period || '')
          const lbl = formatAxisLabel(raw, includeYear)
          return (
            <text key={i} x={xPx(i)} y={PAD_T + plotH + 24} textAnchor="middle" fontSize={xFontSize} fontWeight="700" fill="#475569">
              {lbl}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
