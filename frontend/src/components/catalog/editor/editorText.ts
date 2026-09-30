export type EditorTextKey = `web_editor_${string}`
export type EditorText = (key: EditorTextKey, en: string, km: string) => string
type AdminTranslator = (key: string) => string

// Admin pack only: the storefront packs word the same keys for shoppers
// (km aboutTitle = អំពីយើង), not for the owner editing them.
export function createEditorText(t: AdminTranslator, adminLanguage: string): EditorText {
  return (key, en, km) => {
    const packed = t(key)
    if (packed && packed !== key) return packed
    return adminLanguage === 'km' ? km : en
  }
}
