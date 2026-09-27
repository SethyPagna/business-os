// S-auth4b owner requirement (27 Sep 2026): the forced password change screen
// (ForcedPasswordChange.tsx) must offer a way out to someone who does not know
// the current password -- the reset-method chooser. The chooser lives on the
// sign-in screen (Login.tsx), so the change screen signs out and leaves the
// account name here; the sign-in screen opens the chooser with it, once.
//
// Memory only: the sign-out cleanup cannot drop it, and nothing about the
// account is written to the browser. A sign-out that never finishes (offline)
// leaves it behind, so it goes stale after ten minutes instead of opening the
// chooser at some unrelated later sign-in.
const HANDOFF_TTL_MS = 10 * 60 * 1000

let pending: { identifier: string; at: number } | null = null

export function requestPasswordRecoveryAfterSignOut(identifier: string): void {
  pending = { identifier: String(identifier || ''), at: Date.now() }
}

export function takePasswordRecoveryAfterSignOut(): { identifier: string } | null {
  const taken = pending
  pending = null
  if (!taken || Date.now() - taken.at > HANDOFF_TTL_MS) return null
  return { identifier: taken.identifier }
}
