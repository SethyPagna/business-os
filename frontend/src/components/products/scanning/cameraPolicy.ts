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
