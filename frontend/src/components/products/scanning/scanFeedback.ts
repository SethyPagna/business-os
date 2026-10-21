// What an accepted scan tells the person: the guide flashes green and the phone
// buzzes once. Owner rule, 21 Oct 2026: no beep and no sound setting, so nothing
// here may make a sound.

export const SCAN_FLASH_CLASS = 'scanner-read-flash'
export const SCAN_VIBRATE_MS = 40
/** How long the sheet stays up after a read so the flash can be seen. */
export const SCAN_CLOSE_DELAY_MS = 150

/** Call once per accepted read. Browsers without vibration (iOS Safari, most desktops) just get the flash. */
export function signalScanSuccess(flashTarget: { classList?: { add: (name: string) => void } } | null | undefined): void {
  flashTarget?.classList?.add(SCAN_FLASH_CLASS)
  try {
    globalThis.navigator?.vibrate?.(SCAN_VIBRATE_MS)
  } catch (_) {
    // A browser that refuses vibration (no recent tap on the page) still got the flash.
  }
}
