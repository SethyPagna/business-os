/**
 * Phone verification is intentionally paused in this build.
 * These stubs keep imports safe if any legacy code path still calls them.
 */

function disabled() {
  throw new Error('Phone verification is currently disabled. Use email verification or OTP instead.')
}

export async function requestFirebasePhoneCode() {
  disabled()
}

export async function confirmFirebasePhoneCode() {
  disabled()
}

export async function cleanupFirebasePhoneVerification() {
  return null
}
