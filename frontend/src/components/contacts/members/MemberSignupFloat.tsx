import { useState } from 'react'
import Modal from '../../shared/Modal.tsx'
import { settingsSaveSucceeded } from '../../../utils/settingsSave.ts'
import { memberText, signupSettingPayload } from './memberModel.ts'
import { ActionShell } from './MemberActionDialogs.tsx'
import type { MemberT } from './memberUi.tsx'

// The owner's sign-up switch (customer_portal_signup_enabled). Admin-only, and it
// defaults OFF: with it off the website offers Telegram sign-in only. Flipping it
// goes through the shared review dialog with the value before and after, and the
// save sends only this one key (AppContext.saveSettings sends what differs).

interface Props {
  on: boolean
  t: MemberT
  saveSettings: (settings: Record<string, unknown>) => Promise<unknown>
  onClose: () => void
}

export default function MemberSignupFloat({ on, t, saveSettings, onClose }: Props) {
  const [asking, setAsking] = useState(false)
  const stateText = (value: boolean) => (value ? memberText(t, 'pm_signup_on', 'On') : memberText(t, 'pm_signup_off', 'Off'))
  const label = memberText(t, 'pm_signup_label', 'Phone + password sign-up (off: customers use Telegram)')
  return (
    <>
      <Modal title={memberText(t, 'pm_signup_title', 'Website sign-up')} onClose={onClose} size="sm" unsavedChanges="read-only">
        <div className="flex items-center justify-between gap-3" data-member-signup="">
          <span id="member-signup-label" className="min-w-0 flex-1 text-sm leading-relaxed text-gray-800 dark:text-gray-100">{label}</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="member-signup-label"
            data-member-signup-switch=""
            onClick={() => setAsking(true)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-zinc-600'}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{stateText(on)}</p>
      </Modal>
      {asking ? (
        <ActionShell
          t={t}
          title={memberText(t, 'pm_signup_title', 'Website sign-up')}
          message={label}
          confirmLabel={on ? memberText(t, 'pm_signup_turn_off', 'Turn off') : memberText(t, 'pm_signup_turn_on', 'Turn on')}
          canConfirm
          onClose={() => setAsking(false)}
          onDone={() => { setAsking(false); onClose() }}
          items={[
            { label: memberText(t, 'before', 'Before'), value: stateText(on) },
            { label: memberText(t, 'after', 'After'), value: stateText(!on) },
          ]}
          run={async () => {
            const result = await saveSettings(signupSettingPayload(!on))
            if (!settingsSaveSucceeded(result)) throw (result as { error?: unknown } | null)?.error ?? result
          }}
        />
      ) : null}
    </>
  )
}
