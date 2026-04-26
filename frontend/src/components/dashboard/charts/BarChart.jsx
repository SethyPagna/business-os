// ── BarChart ──────────────────────────────────────────────────────────────────
// Pure SVG bar chart — no external charting dependencies.
// Props:
//   data      {Object[]}  Array of data objects
//   valueKey  {string}    Key in each object holding the numeric value
//   labelKey  {string}    Key in each object holding the x-axis label
//   color     {string}    Bar fill color (default: #2563eb)
//   isCount   {boolean}   If true, formats axis labels as counts not currency

import { useState } from 'react'
import { fmtShort, fmtCount } from '../../../utils/formatters'
import NoData from './NoData'

export default function BarChart({ data, valueKey, labelKey, color = '#2563eb', isCount = false }) {
  // ⚑ Hook must come before any early return (Rules of Hooks)
  const [tooltip, setTooltip] = useState(null)
  if (!data?.length) return <NoData />
  const W = 560, H = 180, PAD_L = 48, PAD_B = 28, PAD_T = 16, PAD_R = 8
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const vals  = data.map(d => Number(d[valueKey]) || 0)
  const max   = Math.max(...vals, 0.01)
  const rawStep = max / 4
  const mag   = Math.pow(10, Math.floor(Math.log10(rawStep || 1)))
  const step  = Math.ceil(rawStep / mag) * mag || 1
  const yTicks = [1,2,3,4].map(i => i * step)
  const yMax  = yTicks[3]

  const barW  = Math.max(4, Math.min(36, plotW / data.length * 0.6))
  const gap   = plotW / data.length

  function yPx(v) { return PAD_T + plotH - (v / yMax) * plotH }

  const maxLabels = Math.floor(plotW / 36)
  const step_lbl  = Math.max(1, Math.ceil(data.length / maxLabels))

  return (
    <div className="relative">
      {tooltip && (
        <div className="absolute z-20 pointer-events-none bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -110%)' }}>
          <div className="font-semibold">{tooltip.label}</div>
          <div>{isCount ? tooltip.val : fmtShort(tooltip.val)}</div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}
        onMouseLeave={() => setTooltip(null)}>
        {yTicks.map(v => {
          const y = yPx(v)
          if (y < PAD_T) return null
          return (
            <g key={v}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 3" />
              <text x={PAD_L - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#9ca3af">
                {isCount ? fmtCount(v) : fmtShort(v)}
              </text>
            </g>
          )
        })}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="#d1d5db" strokeWidth="1" />

        {data.map((d, i) => {
          const val  = Number(d[valueKey]) || 0
          const cx   = PAD_L + i * gap + gap / 2
          const barH = Math.max(2, (val / yMax) * plotH)
          const x    = cx - barW / 2
          const y    = PAD_T + plotH - barH
          const showLbl = i % step_lbl === 0
          const raw = String(d[labelKey] || '')
          const lbl = raw.length > 5 ? raw.slice(-5) : raw
          return (
            <g key={i}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.closest('svg').getBoundingClientRect()
                const svgEl = e.currentTarget.closest('svg')
                const vbW = svgEl.viewBox.baseVal.width || W
                const scale = rect.width / vbW
                setTooltip({ x: cx * scale, y: y * scale, label: raw, val })
              }}>
              <rect x={x} y={y} width={barW} height={barH} fill={color} rx="3" opacity="0.85"
                className="cursor-pointer hover:opacity-100 transition-opacity" />
              {barH > 22 && (
                <text x={cx} y={y - 3} textAnchor="middle" fontSize="10" fill={color} fontWeight="500">
                  {isCount ? fmtCount(val) : fmtShort(val)}
                </text>
              )}
              {showLbl && (
                <text x={cx} y={PAD_T + plotH + 16} textAnchor="middle" fontSize="11" fill="#6b7280">
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
