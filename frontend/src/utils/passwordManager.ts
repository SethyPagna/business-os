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
 * The clipboard is written only from a Copy button (copyPasswordToClipboard).
 */

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
  user?: { username?: string; name?: string }
} | null | undefined

// After the Worker accepted the password (with or without the authenticator
// step). Not on a device other accounts use (the Worker's sharedDevice): the
// next person at that till would be offered this one's password.
export async function requestPasswordSaveAfterSignIn(answer: SignInAnswer, password: string): Promise<boolean> {
  if (!answer?.success || answer.sharedDevice) return false
  return requestPasswordSave({ username: String(answer.user?.username || ''), password, displayName: answer.user?.name })
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
