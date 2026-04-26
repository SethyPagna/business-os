
import { useState } from 'react'
import { useApp } from '../../AppContext'
import { getFieldItems } from './constants'

function Toggle({ label, desc, value, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer py-1.5">
      <div className="relative flex-shrink-0 mt-0.5">
        <input type="checkbox" className="sr-only" checked={value} onChange={e => onChange(e.target.checked)} />
        <div className={`w-9 h-5 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`} />
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4' : ''}`} />
      </div>
      <div>
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</div>
        {desc && <div className="text-xs text-gray-400">{desc}</div>}
      </div>
    </label>
  )
}

export default
function AllFieldsPanel({ tpl, setT }) {
  const { t } = useApp()
  const T = (k, fb) => (typeof t === 'function' ? t(k) : fb)
  const [search, setSearch] = useState('')
  const [expandedSections, setExpandedSections] = useState({})
  const ALL_FIELD_ITEMS = getFieldItems(t)

  const filtered = search.trim()
    ? ALL_FIELD_ITEMS.filter(f =>
        f.label.toLowerCase().includes(search.toLowerCase()) ||
        f.desc.toLowerCase().includes(search.toLowerCase()) ||
        f.section.toLowerCase().includes(search.toLowerCase()))
    : ALL_FIELD_ITEMS

  const bySection = filtered.reduce((acc, f) => {
    if (!acc[f.section]) acc[f.section] = []
    acc[f.section].push(f)
    return acc
  }, {})

  const toggleSection = (s) => setExpandedSections(prev => ({ ...prev, [s]: !prev[s] }))

  return (
    <div>
      <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 mb-3 text-xs text-green-700 dark:text-green-400">
        ✅ {T('rs_auto_save_hint', 'Toggle any field on/off. All changes auto-save and apply instantly to the live preview and to receipts printed from POS & Sales.')}
      </div>

      {/* Quick emoji toggle — prominent at top */}
      <div className="card p-3 mb-3 flex items-center justify-between gap-3 border-2 border-dashed border-gray-200 dark:border-gray-600">
        <div>
          <div className="text-sm font-semibold text-gray-800 dark:text-white">😊 {T('show_emojis_on_receipt', 'Show Emojis on Receipt')}</div>
          <div className="text-xs text-gray-400 mt-0.5">{T('show_emojis_receipt_desc', 'Toggle emoji icons in receipt (📞 🚚 🏷️ etc.)')}</div>
        </div>
        <div className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${tpl.show_emojis !== false ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
          onClick={() => setT('show_emojis', tpl.show_emojis === false ? true : false)}>
          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${tpl.show_emojis !== false ? 'translate-x-7' : 'translate-x-1'}`} />
        </div>
      </div>

      <div className="mb-4">
        <input
          className="input text-sm"
          placeholder={T('search_fields_placeholder', '🔍 Search fields…')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="space-y-3">
        {Object.entries(bySection).map(([section, fields]) => {
          const isOpen = search.trim() ? true : expandedSections[section] !== false
          return (
            <div key={section} className="card overflow-hidden">
              <button
                className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                onClick={() => toggleSection(section)}
              >
                <span className="text-sm font-semibold text-gray-800 dark:text-white">{section}</span>
                <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'} {fields.length} {fields.length !== 1 ? T('fields_plural','fields') : T('fields_singular','field')}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-2 border-t border-gray-100 dark:border-gray-700">
                  {fields.map(f => (
                    <Toggle
                      key={f.key}
                      label={f.label}
                      desc={f.desc}
                      value={f.key === 'show_emojis' ? tpl.show_emojis !== false : !!tpl[f.key]}
                      onChange={v => setT(f.key, v)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Live receipt preview — uses the real Receipt component ────────────────────
