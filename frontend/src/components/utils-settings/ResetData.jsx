import { useState } from 'react'
import { AlertTriangle, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react'
import { useApp } from '../../AppContext'
import { refreshAppData } from '../../utils/appRefresh'

function ConfirmReset({
  title,
  description,
  whatDeleted,
  whatKept,
  confirmWord,
  onConfirm,
  working,
  buttonLabel,
  color = 'red',
  icon: Icon = AlertTriangle,
  t,
}) {
  const T = (key, fallback) => (typeof t === 'function' ? t(key) : fallback)
  const [step, setStep] = useState(0)
  const [typed, setTyped] = useState('')
  const borderCls = color === 'red' ? 'border-red-200 dark:border-red-900/50' : 'border-red-500 dark:border-red-700 bg-red-50/30 dark:bg-red-950/20'
  const btnCls = color === 'red' ? 'bg-red-600 hover:bg-red-700' : 'bg-red-700 hover:bg-red-800 font-bold'

  return (
    <div className={`card border-2 p-5 sm:p-6 ${borderCls}`}>
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-xl bg-red-100 p-2 text-red-600 dark:bg-red-900/30 dark:text-red-300">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h2 className={`mb-1 text-base font-semibold ${color === 'red' ? 'text-red-700 dark:text-red-400' : 'text-red-800 dark:text-red-300'}`}>{title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
        </div>
      </div>

      {whatKept ? <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">{T('reset_kept', 'Kept')}: {whatKept}</p> : null}

      {step === 0 ? (
        <button onClick={() => setStep(1)} className={`rounded-lg px-4 py-2 text-sm text-white ${btnCls}`}>{buttonLabel}</button>
      ) : null}

      {step === 1 ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            <p className="mb-1 flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              {T('reset_will_delete', 'This will permanently delete:')}
            </p>
            <p className="text-xs">{whatDeleted}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className={`rounded-lg px-4 py-2 text-sm text-white ${btnCls}`}>{T('reset_yes_continue', 'Yes, continue')}</button>
            <button onClick={() => setStep(0)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">{T('cancel', 'Cancel')}</button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {T('reset_type_to_confirm', 'Type {word} to confirm').split('{word}')[0]}
            <code className="mx-1 rounded bg-red-100 px-1 py-0.5 font-mono font-bold text-red-700 dark:bg-red-900/30 dark:text-red-400">{confirmWord}</code>
            {T('reset_type_to_confirm', 'Type {word} to confirm').split('{word}')[1]}
          </p>
          <input autoFocus className="input font-mono text-sm" placeholder={confirmWord} value={typed} onChange={(event) => setTyped(event.target.value)} />
          <div className="flex gap-3">
            <button
              onClick={() => {
                onConfirm()
                setStep(0)
                setTyped('')
              }}
              disabled={typed !== confirmWord || working}
              className={`rounded-lg px-4 py-2 text-sm text-white ${btnCls} disabled:opacity-40`}
            >
              {working ? T('reset_working', 'Working...') : buttonLabel}
            </button>
            <button onClick={() => { setStep(0); setTyped('') }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">{T('cancel', 'Cancel')}</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ResetData() {
  const { t, notify, hasPermission } = useApp()
  const T = (key, fallback) => (typeof t === 'function' ? t(key) : fallback)
  const [mode, setMode] = useState('sales')
  const [working, setWorking] = useState(false)

  const MODES = [
    {
      id: 'sales',
      label: T('reset_sales_label', 'Sales Only Reset'),
      desc: T('reset_sales_desc', 'Deletes all sales and returns history and zeros all stock quantities. Products, customers, and suppliers are kept.'),
      deleted: T('reset_sales_deleted', 'All sales, all returns, all inventory movements, all stock quantities (zeroed)'),
      kept: T('reset_sales_kept', 'Products, customers, suppliers, settings, users, branches'),
      word: 'RESET SALES',
      icon: RotateCcw,
    },
    {
      id: 'all',
      label: T('reset_all_label', 'Full Data Reset'),
      desc: T('reset_all_desc', 'Deletes everything: sales, returns, products, customers, suppliers, stock movements. Settings, users, and branches are kept.'),
      deleted: T('reset_all_deleted', 'All sales, returns, products, stock, customers, suppliers, delivery contacts, inventory movements'),
      kept: T('reset_all_kept', 'Users, roles, branches, categories, units, settings'),
      word: 'DELETE ALL DATA',
      icon: Trash2,
    },
  ]

  const selected = MODES.find((entry) => entry.id === mode)

  const doReset = async () => {
    if (!hasPermission('backup')) return notify(T('access_denied', 'No permission'), 'error')
    setWorking(true)
    try {
      const result = await window.api.resetData(mode)
      if (result?.success) {
        notify(result.message || T('reset_complete', 'Reset complete'), 'success')
        setTimeout(() => refreshAppData(), 200)
      } else {
        notify(`${T('error', 'Error')}: ${result?.error || 'unknown'}`, 'error')
      }
    } catch (error) {
      notify(`${T('error', 'Error')}: ${error.message}`, 'error')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        {MODES.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              onClick={() => setMode(entry.id)}
              className={`flex-1 rounded-xl border-2 p-3 text-left text-sm transition-colors ${
                mode === entry.id
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                  : 'border-gray-200 hover:border-red-300 dark:border-gray-700'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-200">
                <Icon className="h-4 w-4" />
                {entry.label}
              </div>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{entry.desc}</div>
            </button>
          )
        })}
      </div>
      <ConfirmReset
        title={selected.label}
        description={selected.desc}
        whatDeleted={selected.deleted}
        whatKept={selected.kept}
        confirmWord={selected.word}
        onConfirm={doReset}
        working={working}
        buttonLabel={selected.label}
        icon={selected.icon}
        t={t}
      />
    </div>
  )
}

function FactoryReset() {
  const { t, notify, hasPermission } = useApp()
  const T = (key, fallback) => (t && t(key)) || fallback
  const [step, setStep] = useState(0)
  const [typed, setTyped] = useState('')
  const [working, setWorking] = useState(false)
  const CONFIRM_WORD = 'FACTORY RESET'

  async function doFactoryReset() {
    if (!hasPermission('backup')) return notify(T('access_denied', 'No permission'), 'error')
    setWorking(true)
    try {
      const result = await window.api.factoryReset()
      if (result?.success) {
        notify(T('factory_reset_complete', 'Factory reset complete. Restarting...'), 'success')
        setTimeout(() => refreshAppData(), 200)
      } else {
        notify(`${T('factory_reset_label', 'Factory Reset')} ${T('failed', 'failed')}: ${result?.error || 'unknown error'}`, 'error')
        setStep(0)
        setTyped('')
      }
    } catch (error) {
      notify(`${T('factory_reset_label', 'Factory Reset')} ${T('failed', 'failed')}: ${error.message}`, 'error')
      setStep(0)
      setTyped('')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="card border-2 border-red-500 bg-red-50/30 p-5 dark:border-red-700 dark:bg-red-950/20 sm:p-6">
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-xl bg-red-100 p-2 text-red-700 dark:bg-red-900/30 dark:text-red-300">
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div>
          <h2 className="mb-1 text-base font-semibold text-red-800 dark:text-red-300">{T('factory_reset_label', 'Factory Reset')}</h2>
          <p className="text-sm text-red-700 dark:text-red-400">{T('factory_reset_desc', 'Deletes everything: all data including returns, all uploaded images, all users except the primary admin, all roles, all settings. Returns the app to factory defaults.')}</p>
          <p className="mt-1 text-xs font-bold text-red-600 dark:text-red-400">{T('cannot_be_undone', 'This cannot be undone.')}</p>
        </div>
      </div>

      {step === 0 ? (
        <button onClick={() => setStep(1)} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800">
          {T('factory_reset_start', 'Begin Factory Reset')}
        </button>
      ) : null}

      {step === 1 ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-400 bg-red-100 p-4 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">
            <p className="mb-1 flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4" />
              {T('reset_will_delete', 'This will permanently delete:')}
            </p>
            <ul className="list-inside list-disc space-y-0.5 text-xs">
              <li>{T('factory_item1', 'All sales, products, stock, inventory movements')}</li>
              <li>{T('factory_item2', 'All customers and suppliers')}</li>
              <li>{T('factory_item3', 'All users (except the primary admin)')}</li>
              <li>{T('factory_item4', 'All custom roles and branches')}</li>
              <li>{T('factory_item5', 'All settings and audit logs')}</li>
              <li>{T('factory_item6', 'All uploaded images')}</li>
            </ul>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800">{T('yes_continue', 'Yes, I understand - continue')}</button>
            <button onClick={() => setStep(0)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">{T('cancel', 'Cancel')}</button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            {T('reset_type_to_confirm', 'Type {word} to confirm').split('{word}')[0]}
            <code className="mx-1 rounded bg-red-200 px-1 py-0.5 font-mono font-bold text-red-800 dark:bg-red-900/40 dark:text-red-300">{CONFIRM_WORD}</code>
            {T('reset_type_to_confirm', 'Type {word} to confirm').split('{word}')[1]}
          </p>
          <input autoFocus className="input border-red-400 font-mono text-sm focus:ring-red-500 dark:border-red-700" placeholder={CONFIRM_WORD} value={typed} onChange={(event) => setTyped(event.target.value)} />
          <div className="flex gap-3">
            <button onClick={doFactoryReset} disabled={typed !== CONFIRM_WORD || working} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-40">
              {working ? T('reset_working', 'Resetting...') : T('factory_reset_label', 'Factory Reset')}
            </button>
            <button onClick={() => { setStep(0); setTyped('') }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">{T('cancel', 'Cancel')}</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export { ResetData, FactoryReset }
