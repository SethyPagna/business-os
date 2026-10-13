import ConfirmDialog from '../shared/ConfirmDialog.tsx'

type Translate = (key: string, fallback: string) => string

type SessionDurationPasswordDialogProps = {
  tr: Translate
  t: (key: string) => string
  durationLabel: string
  password: string
  error: string
  working: boolean
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export default function SessionDurationPasswordDialog({
  tr,
  t,
  durationLabel,
  password,
  error,
  working,
  onPasswordChange,
  onSubmit,
  onCancel,
}: SessionDurationPasswordDialogProps) {
  const canSubmit = !!password.trim() && !working
  const passwordLabel = tr('your_current_password', 'Your current password')
  return (
    <ConfirmDialog
      title={tr('session_duration_password_title', 'Stay signed in for longer?')}
      message={tr('session_duration_password_required', 'Enter your current password to stay signed in for longer.')}
      items={[{ label: tr('session_duration', 'Default login duration'), value: durationLabel }]}
      confirmLabel={tr('save', 'Save')}
      cancelLabel={tr('cancel', 'Cancel')}
      confirmDisabled={!password.trim()}
      working={working}
      workingLabel={tr('saving', 'Saving...')}
      layer="nested"
      onConfirm={onSubmit}
      onClose={onCancel}
      t={t}
    >
      <div className="space-y-1">
        <input
          id="session-duration-current-password"
          name="session_duration_current_password"
          type="password"
          autoComplete="current-password"
          autoFocus
          className="input h-9 w-full text-sm"
          placeholder={passwordLabel}
          aria-label={passwordLabel}
          aria-invalid={error ? true : undefined}
          value={password}
          disabled={working}
          onChange={(event) => onPasswordChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !canSubmit) return
            event.preventDefault()
            onSubmit()
          }}
        />
        {error ? <p role="alert" className="text-xs leading-relaxed text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
    </ConfirmDialog>
  )
}
