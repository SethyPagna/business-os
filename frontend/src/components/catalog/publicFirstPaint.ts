import { withLoaderTimeout } from '../../utils/loaders.ts'

type PlainRecord = Record<string, unknown>
type PaintValueKind = 'text' | 'switch' | 'number' | 'textMap'
type PaintEmbedDocument = { getElementById: (id: string) => { textContent: string | null } | null }

export const PAINT_EMBED_ELEMENT_ID = 'business-os-portal-paint'
export const PAINT_EMBED_MAX_BYTES = 6 * 1024
export const RETIRED_PORTAL_CACHE_KEY = 'business-os-catalog-portal-cache'
export const PUBLIC_PORTAL_BOOTSTRAP_TIMEOUT_MS = 15_000
export const PUBLIC_PORTAL_CONFIG_TIMEOUT_MS = 8_000

// The Worker's paint allow-list (PUBLIC-PAINT-FINAL D2): never prices, money, points, submissions,
// the AI prompt or stock settings; product cards wait for the bootstrap, which carries the full config.
const PAINT_CONFIG_SCHEMA: Readonly<Record<string, PaintValueKind>> = {
  businessName: 'text',
  title: 'text',
  businessTagline: 'text',
  intro: 'text',
  businessLogo: 'text',
  showLogo: 'switch',
  logoSize: 'number',
  logoFit: 'text',
  logoZoom: 'number',
  logoPositionX: 'number',
  logoPositionY: 'number',
  businessCover: 'text',
  showCover: 'switch',
  heroGradientStart: 'text',
  heroGradientMid: 'text',
  heroGradientEnd: 'text',
  aboutTitle: 'text',
  aboutContent: 'text',
  aboutImage: 'text',
  aboutImageAlt: 'text',
  showAbout: 'switch',
  showCatalog: 'switch',
  showFaq: 'switch',
  aiEnabled: 'switch',
  aiTitle: 'text',
  links: 'textMap',
  linkLabels: 'textMap',
  showWebsite: 'switch',
  showFacebook: 'switch',
  showInstagram: 'switch',
  showTelegram: 'switch',
  contactLinks: 'textMap',
  contactLinkLabels: 'textMap',
  showContactMessenger: 'switch',
  showContactTelegram: 'switch',
  showContactWhatsapp: 'switch',
  showContactPhone: 'switch',
  showContactInstagram: 'switch',
  showPhone: 'switch',
  showEmail: 'switch',
  showAddress: 'switch',
  businessPhone: 'text',
  businessEmail: 'text',
  businessAddress: 'text',
  addressLink: 'text',
  showGoogleMap: 'switch',
  googleMapsEmbed: 'text',
  gridColumnsMobile: 'number',
  gridColumnsDesktop: 'number',
  translateWidgetEnabled: 'switch',
}

export const PAINT_CONFIG_KEYS: readonly string[] = Object.keys(PAINT_CONFIG_SCHEMA)

function isPlainRecord(value: unknown): value is PlainRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function matchesKind(value: unknown, kind: PaintValueKind): boolean {
  if (kind === 'text') return typeof value === 'string'
  if (kind === 'switch') return typeof value === 'boolean'
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value)
  return isPlainRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

export function parsePaintEmbed(raw: string): PlainRecord | null {
  if (!raw || new TextEncoder().encode(raw).length > PAINT_EMBED_MAX_BYTES) return null
  let embed: unknown
  try {
    embed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainRecord(embed) || embed.kind !== 'paint' || embed.v !== 1 || !isPlainRecord(embed.config)) return null
  const source = embed.config
  const config: PlainRecord = {}
  for (const [key, kind] of Object.entries(PAINT_CONFIG_SCHEMA)) {
    if (matchesKind(source[key], kind)) config[key] = source[key]
  }
  return config
}

export function readPaintEmbed(doc: PaintEmbedDocument | undefined = globalThis.document): PlainRecord | null {
  const node = doc?.getElementById(PAINT_EMBED_ELEMENT_ID)
  return node ? parsePaintEmbed(String(node.textContent || '').trim()) : null
}

function removeRetiredCacheFrom(storageName: 'localStorage' | 'sessionStorage'): void {
  try {
    globalThis.window?.[storageName]?.removeItem(RETIRED_PORTAL_CACHE_KEY)
  } catch {
    // Blocked site data (Safari private mode) throws on the storage getter itself.
  }
}

export function clearRetiredPortalCache(): void {
  removeRetiredCacheFrom('localStorage')
  removeRetiredCacheFrom('sessionStorage')
}

export type StorefrontLoadOptions = {
  fetchBootstrap: () => Promise<unknown>
  fetchConfig: (() => Promise<unknown>) | null
  onConfig: (config: unknown) => void
  onBootstrap: (payload: unknown) => void
  onBootstrapFailed: () => void
  onFailed: () => void
}

export function startStorefrontLoad(options: StorefrontLoadOptions): () => void {
  let active = true
  let bootstrapSettled = false
  let bootstrapFailed = false
  let configInHand = options.fetchConfig === null
  let configFailed = false

  const reportBootstrapFailure = () => {
    if (configInHand) options.onBootstrapFailed()
    else if (configFailed) options.onFailed()
  }

  withLoaderTimeout(options.fetchBootstrap, 'Portal bootstrap', PUBLIC_PORTAL_BOOTSTRAP_TIMEOUT_MS).then(
    (payload) => {
      bootstrapSettled = true
      if (active) options.onBootstrap(payload)
    },
    () => {
      bootstrapSettled = true
      bootstrapFailed = true
      if (active) reportBootstrapFailure()
    },
  )

  if (options.fetchConfig) {
    withLoaderTimeout(options.fetchConfig, 'Portal config', PUBLIC_PORTAL_CONFIG_TIMEOUT_MS).then(
      (config) => {
        if (!active || (bootstrapSettled && !bootstrapFailed)) return
        configInHand = true
        options.onConfig(config)
        if (bootstrapFailed) options.onBootstrapFailed()
      },
      () => {
        configFailed = true
        if (active && bootstrapFailed) options.onFailed()
      },
    )
  }

  return () => {
    active = false
  }
}
