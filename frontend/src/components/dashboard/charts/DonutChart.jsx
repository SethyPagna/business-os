// ── DonutChart ────────────────────────────────────────────────────────────────
// Pure SVG donut chart — no external charting dependencies.
// Renders up to 7 slices with a hover tooltip and a right-side legend.
// Props:
//   data      {Object[]}  Array of data objects
//   valueKey  {string}    Key in each object holding the numeric value

import { useState } from 'react'
import { fmtShort } from '../../../utils/formatters'
import NoData from './NoData'

const CHART_COLORS = ['#2563eb','#16a34a','#ea580c','#7c3aed','#dc2626','#0891b2','#0f766e']

export default function DonutChart({ data, valueKey }) {
  // ⚑ Hook must come before any early return (Rules of Hooks)
  const [hoveredIdx, setHoveredIdx] = useState(null)
  if (!data?.length) return <NoData />
  const total = data.reduce((s, d) => s + (Number(d[valueKey]) || 0), 0)
  if (!total) return <NoData />

  const W = 260, H = 140
  const cx = 70, cy = 70, r = 54, inner = 32
  let cum = 0
  const slices = data.slice(0, 7).map((d, i) => {
    const val = Number(d[valueKey]) || 0
    const pct = val / total
    const a0  = cum * 2 * Math.PI - Math.PI / 2
    cum += pct
    const a1  = cum * 2 * Math.PI - Math.PI / 2
    const x1  = cx + r * Math.cos(a0), y1 = cy + r * Math.sin(a0)
    const x2  = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1)
    const ix1 = cx + inner * Math.cos(a0), iy1 = cy + inner * Math.sin(a0)
    const ix2 = cx + inner * Math.cos(a1), iy2 = cy + inner * Math.sin(a1)
    const large = pct > 0.5 ? 1 : 0
    return {
      path: `M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${ix2},${iy2} A${inner},${inner} 0 ${large},0 ${ix1},${iy1} Z`,
      color: CHART_COLORS[i % CHART_COLORS.length],
      pct, raw: d, val,
    }
  })

  const hovered = hoveredIdx !== null ? slices[hoveredIdx] : null

  return (
    <div className="relative">
      {hovered && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 z-20 pointer-events-none bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap text-center">
          <div className="font-semibold">{hovered.raw.payment_method || hovered.raw.name || ''}</div>
          <div>{fmtShort(hovered.val)} · {(hovered.pct * 100).toFixed(1)}%</div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color}
            stroke={hoveredIdx === i ? '#fff' : 'white'}
            strokeWidth={hoveredIdx === i ? 2.5 : 1.5}
            opacity={hoveredIdx !== null && hoveredIdx !== i ? 0.65 : 1}
            className="cursor-pointer transition-all"
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          />
        ))}
        <text x={cx} y={cy - 6}  textAnchor="middle" fontSize="13" fontWeight="600" fill="#374151">{slices.length}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="10" fill="#9ca3af">methods</text>

        {slices.map((s, i) => {
          const label = s.raw.payment_method || s.raw.name || `#${i+1}`
          const short = label.length > 10 ? label.slice(0,10)+'…' : label
          return (
            <g key={i} transform={`translate(148, ${12 + i * 18})`}
              className="cursor-pointer" opacity={hoveredIdx !== null && hoveredIdx !== i ? 0.5 : 1}
              onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)}>
              <rect width="10" height="10" rx="2" fill={s.color} />
              <text x="14" y="9" fontSize="11" fill="#4b5563">{short}</text>
              <text x="108" y="9" textAnchor="end" fontSize="11" fill="#6b7280">{(s.pct*100).toFixed(0)}%</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
