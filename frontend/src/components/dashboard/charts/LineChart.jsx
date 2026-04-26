// ── LineChart ─────────────────────────────────────────────────────────────────
// Pure SVG multi-line chart with hover tooltip — no external charting deps.
// Props:
//   data   {Object[]}  Each object must have a `period` key (x-axis label)
//   lines  {Array}     [{key, label, color}] — one entry per line to draw

import { useState } from 'react'
import { fmtShort } from '../../../utils/formatters'
import NoData from './NoData'

const CHART_COLORS = ['#2563eb','#16a34a','#ea580c','#7c3aed','#dc2626','#0891b2','#0f766e']

export default function LineChart({ data, lines }) {
  // ⚑ Hook must come before any early return (Rules of Hooks)
  const [tooltip, setTooltip] = useState(null)
  if (!data?.length) return <NoData />
  const W = 560, H = 180, PAD_L = 48, PAD_B = 28, PAD_T = 16, PAD_R = 8
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  const allVals = lines.flatMap(l => data.map(d => Number(d[l.key]) || 0))
  const max     = Math.max(...allVals, 0.01)
  const rawStep = max / 4
  const mag     = Math.pow(10, Math.floor(Math.log10(rawStep || 1)))
  const step    = Math.ceil(rawStep / mag) * mag || 1
  const yTicks  = [1,2,3,4].map(i => i * step)
  const yMax    = yTicks[3]

  function xPx(i) { return PAD_L + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW) }
  function yPx(v) { return PAD_T + plotH - (v / yMax) * plotH }

  const maxLabels = Math.floor(plotW / 40)
  const stepLbl   = Math.max(1, Math.ceil(data.length / maxLabels))

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
    if (closest && minDist < plotW / data.length) {
      const tooltipX = xPx(closestIdx) / scale
      const tooltipY = Math.min(...lines.map(l => yPx(Number(closest[l.key]) || 0))) / scale
      setTooltip({ x: tooltipX, y: Math.max(tooltipY - 8, 4), data: closest, idx: closestIdx })
    } else {
      setTooltip(null)
    }
  }

  return (
    <div className="relative">
      {tooltip && (
        <div className="absolute z-20 pointer-events-none bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -110%)' }}>
          <div className="font-semibold mb-0.5">{String(tooltip.data.period || '')}</div>
          {lines.map((l, i) => (
            <div key={l.key} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: l.color || CHART_COLORS[i] }} />
              <span>{l.label || l.key}: {fmtShort(Number(tooltip.data[l.key]) || 0)}</span>
            </div>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
        {yTicks.map(v => {
          const y = yPx(v)
          if (y < PAD_T) return null
          return (
            <g key={v}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 3" />
              <text x={PAD_L - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#9ca3af">{fmtShort(v)}</text>
            </g>
          )
        })}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="#d1d5db" strokeWidth="1" />

        {lines.map((l, li) => {
          const col = l.color || CHART_COLORS[li]
          const pts = data.map((d, i) => `${xPx(i)},${yPx(Number(d[l.key]) || 0)}`).join(' ')
          const baseY = PAD_T + plotH
          const areaPoints = `${xPx(0)},${baseY} ${pts} ${xPx(data.length-1)},${baseY}`
          return (
            <g key={l.key}>
              <polygon points={areaPoints} fill={col} opacity="0.08" />
              <polyline points={pts} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {data.length <= 31 && data.map((d, i) => {
                const v = Number(d[l.key]) || 0
                const isHovered = tooltip?.idx === i
                return (
                  <circle key={i} cx={xPx(i)} cy={yPx(v)} r={isHovered ? 5 : 3}
                    fill={isHovered ? col : 'white'} stroke={col} strokeWidth="1.5"
                    className="transition-all" />
                )
              })}
            </g>
          )
        })}

        {tooltip && (
          <line x1={xPx(tooltip.idx)} x2={xPx(tooltip.idx)} y1={PAD_T} y2={PAD_T + plotH}
            stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 2" />
        )}

        {data.map((d, i) => {
          if (i % stepLbl !== 0) return null
          const raw = String(d.period || '')
          const lbl = raw.length > 5 ? raw.slice(-5) : raw
          return (
            <text key={i} x={xPx(i)} y={PAD_T + plotH + 16} textAnchor="middle" fontSize="11" fill="#6b7280">
              {lbl}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
