import type { AppliedReceiptConfig, NormalizedReceiptTemplate, ReceiptPrintSettings } from '../types/receiptContracts'
import { DEFAULT_RECEIPT_TEXT_CONTRAST, normalizeReceiptTextContrast } from './receiptTextContrast.ts'

export const RECEIPT_PRINT_SETTINGS_STORAGE_KEY = 'bos_print_settings'

export const DEFAULT_RECEIPT_TEMPLATE: NormalizedReceiptTemplate = {
  font_family: 'monospace',
  font_size: 12,
  width: 80,
  line_char: '-',
  align_header: 'center',
  show_logo: false,
  show_business_name: true,
  show_address: true,
  show_phone: true,
  show_email: false,
  show_tax_id: true,
  show_receipt_number: true,
  show_date: true,
  show_cashier: true,
  show_payment_method: true,
  show_exchange_rate: true,
  show_customer_name: true,
  show_customer_phone: true,
  show_customer_address: true,
  show_customer_membership: true,
  show_item_sku: false,
  show_item_qty: true,
  show_item_unit_price: true,
  show_item_khr: true,
  show_item_discount: true,
  show_discount_khr: true,
  show_membership_discount_khr: true,
  show_delivery_khr: true,
  show_subtotal: true,
  show_discount: true,
  show_membership_discount: true,
  show_membership_points: true,
  show_tax: true,
  show_delivery: true,
  show_total_khr: true,
  show_amount_paid: true,
  show_change: true,
  custom_header: '',
  custom_footer: '',
  header_separator: '=',
  footer_separator: '-',
  item_separator: true,
  receipt_language: 'en',
  delivery_show_contact: true,
  delivery_show_driver_name: true,
  delivery_show_driver_phone: true,
  delivery_show_address: true,
  delivery_show_fee: true,
  delivery_fee_position: 'totals',
  discount_position: 'before_tax',
  show_emojis: false,
  text_contrast: DEFAULT_RECEIPT_TEXT_CONTRAST,
  field_order: [
    'header', 'order_info', 'customer', 'delivery', 'items', 'subtotal',
    'discount', 'tax', 'delivery_fee', 'total', 'payment', 'change', 'footer',
  ],
  show_qr_codes: false,
  qr_show_portal: true,
  qr_portal_url: '',
  qr_portal_label: '',
  qr_show_social: false,
  qr_social_links: [],
  sales_receipt_enabled: false,
  sales_receipt_aba_account_name: '',
  sales_receipt_aba_account_number: '',
  sales_receipt_aba_qr_image: '',
  sales_receipt_note: 'none',
}

export const DEFAULT_RECEIPT_PRINT_SETTINGS: ReceiptPrintSettings = {
  paperSize: '80mm',
  marginTop: '4',
  marginRight: '4',
  marginBottom: '4',
  marginLeft: '4',
  scale: '100',
  customWidth: '80',
  customHeight: '297',
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function normalizeQrSocialLinks(value: unknown): NormalizedReceiptTemplate['qr_social_links'] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry, index) => ({
      id: String(entry.id || `qr-social-${index}`),
      label: String(entry.label || '').trim(),
      url: String(entry.url || '').trim(),
    }))
    .filter((entry) => entry.url !== '')
    .slice(0, 8)
}

export function normalizeReceiptTemplate(value: unknown): NormalizedReceiptTemplate {
  const merged = {
    ...DEFAULT_RECEIPT_TEMPLATE,
    ...parseObject(value),
  }
  merged.qr_social_links = normalizeQrSocialLinks(merged.qr_social_links)
  // Any value other than the literal 'maximum' collapses to 'normal' -- a
  // corrupted/pre-feature record must never render as anything but today's
  // default receipt colours.
  merged.text_contrast = normalizeReceiptTextContrast(merged.text_contrast)
  return merged
}

export function serializeReceiptTemplateValue(value: unknown): string {
  return JSON.stringify(normalizeReceiptTemplate(value))
}

export function normalizeReceiptPrintSettings(value: unknown): ReceiptPrintSettings {
  const parsed = parseObject(value)
  return {
    paperSize: String(parsed.paperSize || DEFAULT_RECEIPT_PRINT_SETTINGS.paperSize),
    marginTop: String(parsed.marginTop || DEFAULT_RECEIPT_PRINT_SETTINGS.marginTop),
    marginRight: String(parsed.marginRight || DEFAULT_RECEIPT_PRINT_SETTINGS.marginRight),
    marginBottom: String(parsed.marginBottom || DEFAULT_RECEIPT_PRINT_SETTINGS.marginBottom),
    marginLeft: String(parsed.marginLeft || DEFAULT_RECEIPT_PRINT_SETTINGS.marginLeft),
    scale: String(parsed.scale || DEFAULT_RECEIPT_PRINT_SETTINGS.scale),
    customWidth: String(parsed.customWidth || DEFAULT_RECEIPT_PRINT_SETTINGS.customWidth),
    customHeight: String(parsed.customHeight || DEFAULT_RECEIPT_PRINT_SETTINGS.customHeight),
  }
}

export function serializeReceiptPrintSettings(value: unknown): string {
  return JSON.stringify(normalizeReceiptPrintSettings(value))
}

export function readReceiptPrintSettingsFromSettings(settings: Record<string, unknown> = {}): ReceiptPrintSettings {
  return normalizeReceiptPrintSettings(settings.receipt_print_settings)
}

export function buildAppliedReceiptConfig({
  settings = {},
  template = undefined,
  printSettings = undefined,
}: {
  settings?: Record<string, unknown>
  template?: unknown
  printSettings?: unknown
} = {}): AppliedReceiptConfig {
  const normalizedTemplate = normalizeReceiptTemplate(
    template === undefined ? settings.receipt_template : template,
  )
  const normalizedPrintSettings = normalizeReceiptPrintSettings(
    printSettings === undefined ? settings.receipt_print_settings : printSettings,
  )
  const serializedTemplate = JSON.stringify(normalizedTemplate)
  const serializedPrintSettings = JSON.stringify(normalizedPrintSettings)
  return {
    template: normalizedTemplate,
    printSettings: normalizedPrintSettings,
    serializedTemplate,
    serializedPrintSettings,
    settings: {
      ...settings,
      receipt_template: serializedTemplate,
      receipt_print_settings: serializedPrintSettings,
    },
  }
}
