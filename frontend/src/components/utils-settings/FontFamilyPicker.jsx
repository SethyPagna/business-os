// ── FontFamilyPicker ─────────────────────────────────────────────────────────
// Collapsible font selector — each option is rendered in its own typeface.
import { useState } from 'react'

const FONTS = [
  { id: 'system',  label: 'System Default', css: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { id: 'inter',   label: 'Inter',           css: "'Inter', system-ui, sans-serif" },
  { id: 'roboto',  label: 'Roboto',          css: "'Roboto', sans-serif" },
  { id: 'poppins', label: 'Poppins',         css: "'Poppins', sans-serif" },
  { id: 'open_sans', label: 'Open Sans',     css: "'Open Sans', sans-serif" },
  { id: 'outfit',  label: 'Outfit',          css: "'Outfit', sans-serif" },
  { id: 'mono',    label: 'Monospace',       css: "'Courier New', Courier, monospace" },
  { id: 'serif',   label: 'Serif',           css: "Georgia, 'Times New Roman', serif" },
  { id: 'khmer',   label: 'Khmer (Noto)',    css: "'Noto Sans Khmer', 'Khmer OS', sans-serif" },
  { id: 'hanuman', label: 'Hanuman',         css: "'Hanuman', 'Noto Sans Khmer', serif" },
  { id: 'battambang', label: 'Battambang',   css: "'Battambang', 'Noto Sans Khmer', sans-serif" },
]

export default
function FontFamilyPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const active = FONTS.find(f => f.id === value) || FONTS[0]
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 border-gray-200 dark:border-gray-600 text-left hover:border-blue-400 transition-colors"
      >
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Font Family</div>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200" style={{ fontFamily: active.css }}>
            {active.label}
          </div>
        </div>
        <span className="text-gray-400 text-xs ml-2">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 p-3 bg-gray-50 dark:bg-zinc-800 rounded-xl border border-gray-200 dark:border-zinc-700">
          {FONTS.map(f => (
            <button
              key={f.id}
              onClick={() => { onChange(f.id); setOpen(false) }}
              style={{ fontFamily: f.css }}
              className={`px-3 py-2 rounded-lg text-left text-sm font-medium transition-colors border-2
                ${value === f.id
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'border-transparent bg-white dark:bg-zinc-700 text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:hover:border-zinc-500'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

