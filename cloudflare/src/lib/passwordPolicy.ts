// Single source of truth for the app's minimum password length.
//
// Before this file existed, four different endpoints each enforced (or
// didn't enforce) their own rule:
//   - POST /api/auth/password-reset/complete (email link reset): 6 chars,
//     via a local `MIN_PASSWORD_LENGTH` const in routes/auth.ts
//   - POST /api/auth/password-reset/otp: 4 chars, hardcoded inline
//   - POST /api/users (create user) and the shared handlePasswordChange
//     used by /users/:id/change-password + /users/:id/reset-password:
//     no server-side length check at all -- only the frontend's own
//     (also-inconsistent, 4-char) check stood between a client and a
//     one-character password via a direct API call.
// Frontend mirrored the same split: Login.tsx used 6 chars for the email
// reset flow and 4 for the OTP reset flow; Users.tsx and
// UserProfileModal.tsx both used 4. Standardized everywhere on the
// stricter existing value (6) rather than the weaker one, since loosening
// the email-reset path would have been the wrong direction to converge.
export const MIN_PASSWORD_LENGTH = 6

export function passwordTooShort(password: unknown): boolean {
  return String(password ?? '').length < MIN_PASSWORD_LENGTH
}

export function passwordMinLengthError(): string {
  return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
}
