import { useEffect, useState } from 'react'
import Save from 'lucide-react/dist/esm/icons/save.js'
import { saveAuditLogRetention } from '../../api/settingsTransport'

const MIN_DAYS = 21
const MAX_DAYS = 3650

type Translate = (key: string, fallback?: string) => string | undefined

type AuditRetentionSettingProps = {
  t: Translate
  notify: (message: string, type?: string) => void
  username: string
  value: string
  onSaved: () => void | Promise<unknown>
}

function describeError(error: unknown, T: (key: string, fallback: string) => string): string {
  const message = error instanceof Error ? error.message : String(error || 'unknown error')
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code !== 'string' || !code) return message
  const localized = T(code, message)
  return localized === code ? message : localized
}

export default function AuditRetentionSetting({ t, notify, username, value, onSaved }: AuditRetentionSettingProps) {
  const T = (key: string, fallback: string) => t(key, fallback) || fallback
  const [days, setDays] = useState(value)
  const [currentPassword, setCurrentPassword] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDays(value) }, [value])

  const trimmed = days.trim()
  const changed = trimmed !== value.trim()
  const valid = /^\d{1,4}$/.test(trimmed) && Number(trimmed) >= MIN_DAYS && Number(trimmed) <= MAX_DAYS

  const save = async () => {
    if (!changed || saving) return
    if (!valid) return notify(T('invalid_audit_retention_days', 'Keep audit logs for 21 to 3650 days. Nothing was changed.'), 'error')
    if (!currentPassword) return notify(T('current_password_required', 'Enter your current password to confirm. No data was changed.'), 'error')
    setSaving(true)
    try {
      await saveAuditLogRetention(Number(trimmed), { currentPassword })
      notify(T('settings_saved', 'Settings saved'), 'success')
      await onSaved()
    } catch (error) {
      notify(describeError(error, T), 'error')
    } finally {
      setCurrentPassword('')
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xs">
      <label htmlFor="settings-audit-log-retention-days" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {T('audit_log_retention_days', 'Keep audit logs for (days)')}
      </label>
      <input
        id="settings-audit-log-retention-days"
        name="audit_log_retention_days"
        className="input max-w-xs"
        type="number"
        min={MIN_DAYS}
        max={MAX_DAYS}
        step="1"
        value={days}
        onChange={(event) => setDays(event.target.value)}
      />
      {changed ? (
        <>
          <input type="text" name="username" autoComplete="username" value={username} readOnly className="sr-only" tabIndex={-1} aria-hidden="true" />
          <label htmlFor="settings-audit-log-retention-password" className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {T('current_password', 'Current password')}
          </label>
          <input
            id="settings-audit-log-retention-password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            disabled={saving}
            className="input mt-1 max-w-xs"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <button type="button" className="btn-primary mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm" onClick={save} disabled={saving || !valid || !currentPassword}>
            <Save className="h-4 w-4" />
            {saving ? T('saving', 'Saving...') : T('save', 'Save')}
          </button>
        </>
      ) : null}
      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
        {T('audit_log_retention_days_desc', 'Entries older than this are deleted automatically once a day. Default and minimum is 21 days. Changing it asks for your password. Never deleted: the records of sales, payments, returns, stock changes, permission changes, reverts, undo and redo, and expenses.')}
      </p>
    </div>
  )
}
