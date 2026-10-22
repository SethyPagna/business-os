type DocumentPolicyLike = {
  allowsFeature?: (feature: string) => boolean
}

export function isCameraBlockedByDocumentPolicy(): boolean {
  try {
    const documentWithPolicy = globalThis.document as Document & {
      permissionsPolicy?: DocumentPolicyLike
      featurePolicy?: DocumentPolicyLike
    }
    const policy = documentWithPolicy?.permissionsPolicy || documentWithPolicy?.featurePolicy
    if (!policy?.allowsFeature) return false
    return policy.allowsFeature('camera') === false
  } catch (_) {
    return false
  }
}

// Apps that open links in a browser view of their own: Facebook, Instagram,
// Telegram, TikTok, Line, WeChat, Snapchat. Such a view often refuses the camera
// without saying why (it can answer NotAllowedError without ever asking the
// person), so a refusal there is shown as "open this in your browser" instead
// of as a prompt to try again.
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|Telegram|TikTok|musical_ly|BytedanceWebview|Line\/|MicroMessenger|Snapchat/i

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER.test(userAgent)
}
