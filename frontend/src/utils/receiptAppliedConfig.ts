import type { AppliedReceiptConfig, NormalizedReceiptTemplate, ReceiptPrintSettings } from '../types/receiptContracts'

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
  show_item_sku: false,
  show_item_qty: true,
  show_item_unit_price: true,
  show_item_khr: true,
  show_subtotal: true,
  show_discount: true,
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
  field_order: [
    'header', 'order_info', 'customer', 'delivery', 'items', 'subtotal',
    'discount', 'tax', 'delivery_fee', 'total', 'payment', 'change', 'footer',
  ],
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

export function normalizeReceiptTemplate(value: unknown): NormalizedReceiptTemplate {
  return {
    ...DEFAULT_RECEIPT_TEMPLATE,
    ...parseObject(value),
  }
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
