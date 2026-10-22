// What a failed camera start means for the person holding the phone. Each kind
// gets one short line and one action in the sheet (see useBarcodeCamera's
// FAILURE_VIEW); only a real block is shown in red.

export type CameraFailure =
  | 'document-blocked' // the view itself (an in-app browser) forbids the camera
  | 'blocked' // the person (or the system) said no, and the browser remembers it
  | 'dismissed' // the prompt was closed without an answer
  | 'no-camera' // the device has no camera
  | 'busy' // another app holds the camera
  | 'failed' // anything else

interface FailureContext {
  /** The browser now holds a "no" for this site: it was saved before, or the person tapped Block on this very request. */
  permissionDenied: boolean
  inAppBrowser: boolean
}

/** `errorText` is the DOMException's name and message, which is all browsers agree on. */
export function classifyCameraFailure(errorText: string, { permissionDenied, inAppBrowser }: FailureContext): CameraFailure {
  if (/camera is blocked by this browser view|permissions policy|camera is not allowed in this document/i.test(errorText)) return 'document-blocked'
  if (/NotFoundError|DevicesNotFoundError/i.test(errorText)) return 'no-camera'
  if (/NotReadableError|TrackStartError|AbortError/i.test(errorText)) return 'busy'
  if (/denied|permission|notallowed/i.test(errorText)) {
    // Chrome's "Permission denied by system" means the phone's own camera switch for the browser is off: also a block.
    if (permissionDenied || /denied by system/i.test(errorText)) return 'blocked'
    // An in-app view answers "not allowed" whatever the person chose; trying again there cannot help.
    return inAppBrowser ? 'document-blocked' : 'dismissed'
  }
  return 'failed'
}
