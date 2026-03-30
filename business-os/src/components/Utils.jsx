import { useState, useEffect } from 'react'
import { useApp } from '../AppContext'

export function AuditLog() {
  const { t } = useApp()
  const [logs, setLogs] = useState([])
  useEffect(() => { window.api.getAuditLogs().then(setLogs) }, [])
  const clr = { CREATE:'badge-green', UPDATE:'badge-blue', DELETE:'badge-red', SALE:'badge-green', STOCK_ADD:'badge-blue', STOCK_REMOVE:'badge-yellow', BULK_IMPORT:'badge-blue' }
  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-5">📋 {t('audit_log')}</h1>
      <div className="card flex-1 overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
              <tr>
                {['created_at', 'user', 'action', 'table', 'record'].map(k => <th key={k} className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-semibold capitalize">{t(k)}</th>)}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? <tr><td colSpan={5} className="text-center py-10 text-gray-400">{t('no_data')}</td></tr>
              : logs.map(l => (
                <tr key={l.id} className="table-row">
                  <td className="px-4 py-2 text-gray-500 text-xs">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 font-medium text-gray-700 dark:text-gray-300">{l.user_name || '—'}</td>
                  <td className="px-4 py-2"><span className={clr[l.action] || 'badge-blue'}>{l.action}</span></td>
                  <td className="px-4 py-2 text-gray-500 text-xs font-mono">{l.table_name || '—'}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{l.record_id ? `#${l.record_id}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">{logs.length} {t('entries')}</div>
      </div>
    </div>
  )
}

export function Backup() {
  const { t, notify } = useApp()
  const [loading, setLoading] = useState('')
  const handleExport = async () => { setLoading('export'); const r = await window.api.exportBackup(); setLoading(''); if (r.success) notify(t('export_backup') + ' ✓') }
  const handleImport = async () => { if (!confirm(`⚠️ ${t('backup_warning')}`)) return; setLoading('import'); await window.api.importBackup(); setLoading('') }
  return (
    <div className="flex-1 p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">💾 {t('backup')}</h1>
      <div className="max-w-2xl space-y-4">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">📤 {t('export_backup')}</h2>
          <p className="text-sm text-gray-500 mb-4">Exports database, product images, and a JSON snapshot to a folder.</p>
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 mb-4 text-xs font-mono text-gray-500">
            backup_2024-01-01/ ├── database.db ├── uploads/ └── data_snapshot.json
          </div>
          <button className="btn-primary" onClick={handleExport} disabled={loading === 'export'}>{loading === 'export' ? t('loading') : `📤 ${t('export_backup')}`}</button>
        </div>
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">📥 {t('import_backup')}</h2>
          <p className="text-sm text-gray-500 mb-1">{t('backup_warning')}</p>
          <p className="text-sm text-gray-400 mb-4">Select the backup folder to restore.</p>
          <button className="btn-danger" onClick={handleImport} disabled={loading === 'import'}>{loading === 'import' ? t('loading') : `📥 ${t('import_backup')}`}</button>
        </div>
      </div>
    </div>
  )
}

export function Settings() {
  const { t, settings, saveSettings } = useApp()
  const [form, setForm] = useState({})
  useEffect(() => { setForm({ ...settings }) }, [settings])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const field = (key, label, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input className="input" type={type} placeholder={placeholder} value={form[key] || ''} onChange={e => set(key, e.target.value)} />
    </div>
  )

  return (
    <div className="flex-1 p-6 overflow-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">⚙️ {t('settings')}</h1>
      <div className="max-w-2xl space-y-5">

        {/* Business */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">🏢 {t('business_info')}</h2>
          <div className="grid grid-cols-2 gap-4">
            {field('business_name', t('business_name'), 'text', 'My Business')}
            {field('business_phone', t('phone'), 'text', '+1 234 567')}
            {field('business_address', t('address'), 'text', '123 Main St')}
            {field('business_email', t('email'), 'email', 'info@biz.com')}
            {field('tax_id', t('tax_id'), 'text', 'TAX-000')}
          </div>
        </div>

        {/* Currency */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">💱 {t('currency_settings')}</h2>
          <div className="grid grid-cols-2 gap-4">
            {field('currency_usd_symbol', t('currency_usd_symbol'), 'text', '$')}
            {field('currency_khr_symbol', t('currency_khr_symbol'), 'text', '៛')}
            {field('exchange_rate', t('exchange_rate'), 'number', '4100')}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('display_currency')}</label>
              <select className="input" value={form.display_currency || 'USD'} onChange={e => set('display_currency', e.target.value)}>
                <option value="USD">{t('usd_only')}</option>
                <option value="KHR">{t('khr_only')}</option>
                <option value="BOTH">{t('both_currencies')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tax & Receipt */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">🧾 {t('receipt_settings')}</h2>
          <div className="grid grid-cols-2 gap-4">
            {field('tax_rate', t('tax_rate'), 'number', '0')}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('footer_message')}</label>
              <textarea className="input resize-none" rows={2} value={form.receipt_footer || ''} onChange={e => set('receipt_footer', e.target.value)} placeholder="Thank you!" />
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">🎨 {t('appearance')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('theme')}</label>
              <div className="flex gap-2">
                {[['light','☀️'], ['dark','🌙']].map(([th, ic]) => (
                  <button key={th} onClick={() => set('theme', th)} className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${form.theme === th ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>{ic} {t(th)}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('language')}</label>
              <div className="flex gap-2">
                {[['en','🇺🇸 English'], ['km','🇰🇭 ខ្មែរ']].map(([code, label]) => (
                  <button key={code} onClick={() => set('language', code)} className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${form.language === code ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>{label}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Design & Typography */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">🖌️ Design & Typography</h2>
          <p className="text-xs text-gray-400 mb-4">Customize fonts, sizes, colors and layout style across the whole system</p>
          <div className="grid grid-cols-2 gap-5">

            {/* Font Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Font Size <span className="text-gray-400 font-normal">({form.ui_font_size || 14}px)</span>
              </label>
              <input type="range" min="12" max="20" step="1"
                value={form.ui_font_size || 14}
                onChange={e => set('ui_font_size', e.target.value)}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>Small (12)</span><span>Large (20)</span>
              </div>
            </div>

            {/* Font Weight */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Font Weight</label>
              <div className="flex gap-1.5">
                {[['normal','Normal'],['500','Medium'],['700','Bold']].map(([w,l]) => (
                  <button key={w} onClick={() => set('ui_font_weight', w)}
                    className={`flex-1 py-2 text-xs rounded-lg border-2 transition-colors font-${w === '700' ? 'bold' : w === '500' ? 'medium' : 'normal'} ${(form.ui_font_weight||'normal') === w ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Family */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Font Family</label>
              <select className="input text-sm" value={form.ui_font_family || 'system'} onChange={e => set('ui_font_family', e.target.value)}>
                <option value="system">System Default (Sans-serif)</option>
                <option value="khmer">Noto Sans Khmer (Cambodian)</option>
                <option value="serif">Serif (Georgia)</option>
                <option value="mono">Monospace (Courier)</option>
              </select>
            </div>

            {/* Border Radius */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Button & Card Style</label>
              <div className="flex gap-1.5">
                {[['sharp','Sharp'],['rounded','Rounded'],['pill','Pill']].map(([r,l]) => (
                  <button key={r} onClick={() => set('ui_border_radius', r)}
                    className={`flex-1 py-2 text-xs border-2 transition-colors ${r === 'sharp' ? 'rounded-sm' : r === 'pill' ? 'rounded-full' : 'rounded-lg'} ${(form.ui_border_radius||'rounded') === r ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Accent Color */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Accent / Brand Color</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {[
                  ['#2563eb','Blue'],['#7c3aed','Purple'],['#db2777','Pink'],
                  ['#dc2626','Red'],['#ea580c','Orange'],['#16a34a','Green'],
                  ['#0891b2','Cyan'],['#0f766e','Teal'],['#854d0e','Brown'],
                ].map(([color, name]) => (
                  <button key={color} onClick={() => set('ui_accent_color', color)}
                    title={name}
                    style={{ background: color }}
                    className={`w-8 h-8 rounded-full border-4 transition-transform ${(form.ui_accent_color||'#2563eb') === color ? 'border-white scale-110 shadow-lg' : 'border-transparent hover:scale-105'}`}
                  />
                ))}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Custom:</label>
                  <input type="color" value={form.ui_accent_color || '#2563eb'}
                    onChange={e => set('ui_accent_color', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-gray-300 cursor-pointer p-0.5"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl text-white text-sm font-medium" style={{ background: form.ui_accent_color || '#2563eb' }}>
                <span>Preview — this is your accent color</span>
                <span className="ml-auto opacity-80">{form.ui_accent_color || '#2563eb'}</span>
              </div>
            </div>

            {/* Compact Mode */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Density / Spacing</label>
              <div className="flex gap-2">
                {[['comfortable','😌 Comfortable'],['compact','⚡ Compact'],['spacious','🌿 Spacious']].map(([d,l]) => (
                  <button key={d} onClick={() => set('ui_density', d)}
                    className={`flex-1 py-2 text-xs rounded-lg border-2 transition-colors ${(form.ui_density||'comfortable') === d ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* Live preview note */}
          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-xs text-amber-700 dark:text-amber-400">
            💡 Changes apply immediately after saving. Font family and size affect the entire interface.
          </div>
        </div>

        <button className="btn-primary px-8 py-3 text-base" onClick={() => saveSettings(form)}>💾 {t('save')}</button>
      </div>
    </div>
  )
}
