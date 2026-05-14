export interface NormalizedReceiptTemplate {
  font_family: string
  font_size: number
  width: number
  line_char: string
  align_header: string
  show_logo: boolean
  show_business_name: boolean
  show_address: boolean
  show_phone: boolean
  show_email: boolean
  show_tax_id: boolean
  show_receipt_number: boolean
  show_date: boolean
  show_cashier: boolean
  show_payment_method: boolean
  show_exchange_rate: boolean
  show_customer_name: boolean
  show_customer_phone: boolean
  show_customer_address: boolean
  show_item_sku: boolean
  show_item_qty: boolean
  show_item_unit_price: boolean
  show_item_khr: boolean
  show_subtotal: boolean
  show_discount: boolean
  show_tax: boolean
  show_delivery: boolean
  show_total_khr: boolean
  show_amount_paid: boolean
  show_change: boolean
  custom_header: string
  custom_footer: string
  header_separator: string
  footer_separator: string
  item_separator: boolean
  receipt_language: string
  delivery_show_contact: boolean
  delivery_show_driver_name: boolean
  delivery_show_driver_phone: boolean
  delivery_show_address: boolean
  delivery_show_fee: boolean
  delivery_fee_position: string
  discount_position: string
  show_emojis: boolean
  field_order: string[]
}

export interface ReceiptPrintSettings {
  paperSize: string
  marginTop: string
  marginRight: string
  marginBottom: string
  marginLeft: string
  scale: string
  customWidth: string
  customHeight: string
}

export interface AppliedReceiptConfig {
  template: NormalizedReceiptTemplate
  printSettings: ReceiptPrintSettings
  serializedTemplate: string
  serializedPrintSettings: string
  settings: Record<string, unknown>
}
