/**
 * Best-effort bridge to the browser/OS password manager after a successful
 * password change/reset.
 *
 * Browsers decide whether to show a native save/update prompt; web code cannot
 * force that UI. We therefore do two things:
 *  1) use standards-friendly form autocomplete semantics at the call sites;
 *  2) ask Credential Management API to store/update the credential when the
 *     browser exposes it.
 *
 * If the browser does not support credential storage, callers can request a
 * clipboard fallback so the newly-set password is not lost after fields clear.
 */

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
    await navigator.credentials.store(credential)
    return true
  } catch (_) {
    // Password-manager support is browser/OS dependent. Failing this request
    // must never turn a successful password change into an application error.
    return false
  }
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
