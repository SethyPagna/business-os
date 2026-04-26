import { useState } from 'react'
import { useApp } from '../../AppContext'
import { getFieldItems } from './constants'

function Toggle({ label, desc, value, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <div className="relative mt-0.5 flex-shrink-0">
        <input type="checkbox" className="sr-only" checked={value} onChange={(event) => onChange(event.target.checked)} />
        <div className={`h-5 w-9 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`} />
        <div className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4' : ''}`} />
      </div>
      <div>
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</div>
        {desc ? <div className="text-xs text-gray-400">{desc}</div> : null}
      </div>
    </label>
  )
}

export default function AllFieldsPanel({ tpl, setT }) {
  const { t } = useApp()
  const T = (key, fallback) => (typeof t === 'function' ? t(key) : fallback)
  const [search, setSearch] = useState('')
  const [expandedSections, setExpandedSections] = useState({})
  const allFieldItems = getFieldItems(t)

  const filtered = search.trim()
    ? allFieldItems.filter((field) => (
      field.label.toLowerCase().includes(search.toLowerCase())
      || field.desc.toLowerCase().includes(search.toLowerCase())
      || field.section.toLowerCase().includes(search.toLowerCase())
    ))
    : allFieldItems

  const bySection = filtered.reduce((accumulator, field) => {
    if (!accumulator[field.section]) accumulator[field.section] = []
    accumulator[field.section].push(field)
    return accumulator
  }, {})

  const toggleSection = (section) => setExpandedSections((current) => ({ ...current, [section]: !current[section] }))

  return (
    <div>
      <div className="mb-3 rounded-lg bg-green-50 p-3 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-400">
        {T('rs_auto_save_hint', 'Toggle any field on or off. Changes auto-save and apply to the live preview and printed receipts.')}
      </div>

      <div className="mb-4">
        <input
          className="input text-sm"
          placeholder={T('search_fields_placeholder', 'Search receipt fields')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="space-y-3">
        {Object.entries(bySection).map(([section, fields]) => {
          const isOpen = search.trim() ? true : expandedSections[section] !== false
          return (
            <div key={section} className="card overflow-hidden">
              <button
                className="flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                onClick={() => toggleSection(section)}
              >
                <span className="text-sm font-semibold text-gray-800 dark:text-white">{section}</span>
                <span className="text-xs text-gray-400">
                  {isOpen ? 'Hide' : 'Show'} {fields.length} {fields.length !== 1 ? T('fields_plural', 'fields') : T('fields_singular', 'field')}
                </span>
              </button>
              {isOpen ? (
                <div className="border-t border-gray-100 px-3 pb-2 dark:border-gray-700">
                  {fields.map((field) => (
                    <Toggle
                      key={field.key}
                      label={field.label}
                      desc={field.desc}
                      value={!!tpl[field.key]}
                      onChange={(value) => setT(field.key, value)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
