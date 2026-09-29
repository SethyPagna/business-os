import { passwordNoticeKey, requestPasswordSave } from '../../../utils/passwordManager.ts'
import { newPasswordProblem, newPasswordRefusalMessage, passwordProblemMessage } from '../../../utils/passwordRules.ts'
import { currentPasswordRateLimitMessage } from '../../users/currentPasswordErrors.ts'

type Translate = (key: string, fallback: string) => string
type ChangeAnswer = { success?: boolean; error?: string; code?: string } | null | undefined

export type OwnPasswordChangeInput = {
  username: string
  displayName?: string
  currentPassword: string
  newPassword: string
  confirmPassword: string
  tr: Translate
  change: (passwords: { currentPassword: string; newPassword: string }) => Promise<ChangeAnswer>
}

export type OwnPasswordChangeOutcome =
  | { changed: false; message: string }
  | { changed: true; message: string; tone: 'success' | 'warning' }

// A refused password change (a `{ success: false }` answer or a thrown
// ApiError) in the operator's language whenever the Worker sent a known code.
export function passwordChangeFailureMessage(value: unknown, tr: Translate): string {
  const refusal = newPasswordRefusalMessage(value, tr) || currentPasswordRateLimitMessage(value, tr)
  if (refusal) return refusal
  const answer = value && typeof value === 'object' ? value as { code?: unknown; error?: unknown; message?: unknown } : {}
  if (answer.code === 'incorrect_password') return tr('current_password_incorrect', 'The current password is not correct.')
  return String(answer.error || answer.message || '') || tr('forced_password_change_failed', 'Could not change the password. Try again.')
}

// The signed-in person's own password change. The browser is asked to save
// the new password under the canonical account username; nothing is copied.
export async function changeOwnPassword(input: OwnPasswordChangeInput): Promise<OwnPasswordChangeOutcome> {
  const { currentPassword, newPassword, tr } = input
  const problem = newPasswordProblem(newPassword)
  if (problem) return { changed: false, message: passwordProblemMessage(problem, tr) }
  if (newPassword !== input.confirmPassword) {
    return { changed: false, message: tr('new_password_confirm_mismatch', 'New password confirmation does not match') }
  }
  if (!currentPassword.trim()) {
    return { changed: false, message: tr('current_password_required_change', 'Current password is required to change password') }
  }
  try {
    const answer = await input.change({ currentPassword, newPassword })
    if (answer?.success === false) return { changed: false, message: passwordChangeFailureMessage(answer, tr) }
  } catch (error) {
    return { changed: false, message: passwordChangeFailureMessage(error, tr) }
  }
  const stored = await requestPasswordSave({ username: input.username, password: newPassword, displayName: input.displayName })
  const notice = passwordNoticeKey({ stored })
  return { changed: true, message: tr(notice.key, notice.fallback), tone: stored ? 'success' : 'warning' }
}
