// Asks the browser's password manager to save a password the Worker has just
// accepted (sign-in, own change, reset); the browser alone decides whether a
// prompt appears. The clipboard is written only by a Copy button and by
// persistChangedPassword's opt-in fallback on the Users page.
import { withLoaderTimeout } from './loaders.ts'

export interface PasswordPersistenceOptions {
  username: string
  password: string
  displayName?: string
  copyFallback?: boolean
  /** Admin reset of another person's account: never save it as this device's login. */
  allowCredentialStore?: boolean
}

export interface PasswordPersistenceResult {
  credentialStoreRequested: boolean
  credentialStoreSucceeded: boolean
  copiedToClipboard: boolean
}

type PasswordCredentialConstructor = new (data: {
  id: string
  password: string
  name?: string
}) => Credential

// store() normally answers at once; one that never settles (a broken extension
// or polyfill) must not hold the screen of a password that is already changed.
const CREDENTIAL_STORE_WAIT_MS = 1500

function getPasswordCredentialConstructor(): PasswordCredentialConstructor | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as typeof window & { PasswordCredential?: PasswordCredentialConstructor }).PasswordCredential
  return typeof candidate === 'function' ? candidate : null
}

async function tryStoreCredential(username: string, password: string, displayName?: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.credentials?.store) return false
  const PasswordCredentialCtor = getPasswordCredentialConstructor()
  if (!PasswordCredentialCtor) return false

  try {
    const credential = new PasswordCredentialCtor({
      id: username,
      password,
      ...(displayName ? { name: displayName } : {}),
    })
    await withLoaderTimeout(() => navigator.credentials.store(credential), 'Password save', CREDENTIAL_STORE_WAIT_MS)
    return true
  } catch (_) {
    // Password-manager support is browser/OS dependent. Failing this request
    // must never turn a successful password change into an application error.
    return false
  }
}

export interface PasswordSaveRequest {
  username: string
  password: string
  displayName?: string
}

// Asks the browser to save or update the person's OWN credential; the username
// must be the canonical account username, never what was typed to sign in.
// Never touches the clipboard: a copy happens only from a Copy button.
export async function requestPasswordSave(request: PasswordSaveRequest): Promise<boolean> {
  const username = String(request.username || '').trim()
  if (!username || !request.password) return false
  return tryStoreCredential(username, request.password, request.displayName)
}

// `stored` is requestPasswordSave's answer after the person's own change.
export function passwordNoticeKey({ stored }: { stored: boolean }): { key: string; fallback: string } {
  return stored
    ? { key: 'password_saved_to_manager', fallback: 'Password updated. Your browser was asked to save it.' }
    : { key: 'password_updated_save_it', fallback: 'Password updated. Save it in your password manager if the browser did not offer to.' }
}

type SignInAnswer = {
  success?: boolean
  sharedDevice?: boolean
  user?: { username?: string; name?: string; must_change_password?: unknown }
} | null | undefined

// After the Worker accepted the password (with or without the authenticator
// step). Not on a device other accounts use (the Worker's sharedDevice): the
// next person at that till would be offered this one's password. Not a
// must-change password either: the forced change saves the new one instead.
export async function requestPasswordSaveAfterSignIn(answer: SignInAnswer, password: string): Promise<boolean> {
  if (!answer?.success || answer.sharedDevice) return false
  if (Number(answer.user?.must_change_password || 0) === 1) return false
  return requestPasswordSave({ username: String(answer.user?.username || ''), password, displayName: answer.user?.name })
}

export type SecondFactorPassword = { otpChallenge: string; password: string }

// The password step's password belongs to the authenticator challenge that
// step opened; a step Google opened (another account, perhaps) never gets it.
export function passwordForSecondFactor(held: SecondFactorPassword, otpChallenge: string): string {
  return held.otpChallenge && held.otpChallenge === otpChallenge ? held.password : ''
}

export async function copyPasswordToClipboard(password: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(password)
    return true
  } catch (_) {
    return false
  }
}

export async function persistChangedPassword(options: PasswordPersistenceOptions): Promise<PasswordPersistenceResult> {
  const username = String(options.username || '').trim()
  const password = String(options.password || '')
  const allowCredentialStore = options.allowCredentialStore !== false
  const copyFallback = options.copyFallback !== false

  let credentialStoreRequested = false
  let credentialStoreSucceeded = false

  if (allowCredentialStore && username && password) {
    credentialStoreRequested = true
    credentialStoreSucceeded = await tryStoreCredential(username, password, options.displayName)
  }

  // Auto-copy is a fallback only. If the browser accepted the credential-store
  // request, leave the clipboard untouched; otherwise preserve the password in
  // the user's clipboard before the UI clears the fields.
  const copiedToClipboard = !credentialStoreSucceeded && copyFallback && password
    ? await copyPasswordToClipboard(password)
    : false

  return { credentialStoreRequested, credentialStoreSucceeded, copiedToClipboard }
}

export function passwordPersistenceNotice(
  result: PasswordPersistenceResult,
  options: { adminReset?: boolean } = {},
): string {
  if (options.adminReset) {
    if (result.copiedToClipboard) return 'Password updated. The new password was copied to your clipboard so you can give it to this user.'
    return 'Password updated. Copy or record the new password before closing this dialog.'
  }
  if (result.credentialStoreSucceeded) {
    return 'Password updated. Your browser/password manager was asked to save the new password.'
  }
  if (result.copiedToClipboard) {
    return 'Password updated. This browser could not confirm password-manager storage, so the new password was copied to your clipboard as a backup. Save it in your password manager now.'
  }
  return 'Password updated, but this browser could not save or copy it automatically. The new password has been left in the password fields—save it before closing this screen.'
}
