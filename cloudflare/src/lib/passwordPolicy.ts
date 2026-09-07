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

// ---------------------------------------------------------------------------
// Portal (customer) accounts -- N45
//
// Six characters is what the staff app converged on and it is not being
// loosened here, but a customer account is a different risk: signup is open
// to the internet, the identifier is a PHONE NUMBER (public, guessable, and
// the single most common thing a person uses as their own password), and
// the storefront's privacy policy now tells visitors in both languages that
// a password must be at least eight characters. That sentence is only true
// if this is.
//
// Three refusals, all cheap and all about the ways a real customer account
// is actually taken over -- not a character-class ritual that pushes people
// towards Passw0rd!:
//   - shorter than eight;
//   - the phone number, or the name, used as the password;
//   - a password from the short list every credential-stuffing run starts
//     with.
// Everything else is accepted. Length is the only rule that scales, and a
// passphrase must not be rejected for lacking a symbol.
export const PORTAL_MIN_PASSWORD_LENGTH = 8

// Deliberately short and deliberately not a downloaded corpus: this is the
// head of every stuffing list, and matching it costs one Set lookup.
const PORTAL_BANNED_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '12345678', '123456789',
  '1234567890', 'qwertyui', 'qwerty123', 'iloveyou', 'princess', 'sunshine',
  'football', 'baseball', 'welcome1', 'abc12345', '11111111', '00000000',
  'leangbeauty', 'leangcosmetics', 'cambodia', 'phnompenh',
])

export type PortalPasswordRefusal = { code: string; error: string }

// Digits only, so '0977 123 456', '+855977123456' and '0977123456' all
// compare equal -- a customer who types their own number with spaces has
// still used their phone number as their password.
function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D+/g, '')
}

export function checkPortalPassword(input: { password: unknown; phone?: unknown; name?: unknown }): PortalPasswordRefusal | null {
  const password = String(input.password ?? '')
  if (password.length < PORTAL_MIN_PASSWORD_LENGTH) {
    return {
      code: 'password_weak',
      error: `Password must be at least ${PORTAL_MIN_PASSWORD_LENGTH} characters`,
    }
  }
  const folded = password.trim().toLowerCase()
  if (PORTAL_BANNED_PASSWORDS.has(folded)) {
    return { code: 'password_common', error: 'That password is too common. Please choose a different one.' }
  }
  // Compared on the LAST EIGHT digits of each. A Cambodian subscriber number
  // is 8-9 digits and the same person's number is written four ways --
  // 070111444, 0 70 111 444, +85570111444, 85570111444 -- so a prefix-
  // sensitive comparison misses the exact case this is here for. Eight
  // trailing digits in common is not a coincidence worth allowing.
  const passwordDigits = digitsOnly(password)
  const phoneDigits = digitsOnly(input.phone)
  const PHONE_TAIL = 8
  if (phoneDigits.length >= PHONE_TAIL && passwordDigits.length >= PHONE_TAIL
    && phoneDigits.slice(-PHONE_TAIL) === passwordDigits.slice(-PHONE_TAIL)) {
    return { code: 'password_is_phone', error: 'Please do not use your phone number as your password.' }
  }
  const name = String(input.name ?? '').trim().toLowerCase()
  if (name && name.length >= 3 && folded === name) {
    return { code: 'password_is_name', error: 'Please do not use your name as your password.' }
  }
  return null
}
