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
  show_customer_membership: boolean
  show_item_sku: boolean
  show_item_qty: boolean
  show_item_unit_price: boolean
  show_item_khr: boolean
  show_item_discount: boolean
  show_discount_khr: boolean
  show_membership_discount_khr: boolean
  show_delivery_khr: boolean
  show_subtotal: boolean
  show_discount: boolean
  show_membership_discount: boolean
  show_membership_points: boolean
  show_tax: boolean
  show_delivery: boolean
  show_total_khr: boolean
  // Bumped when a default changes that must also apply to ALREADY-SAVED templates.
  // normalizeReceiptTemplate() upgrades anything below the current revision.
  template_revision: number
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
  // 'normal' | 'maximum'. Maximum forces every receipt text node to pure
  // #000000 (no greys/coloured text/opacity) without touching font size or
  // weight -- see receiptTextContrast.ts for the single stylesheet switch
  // that implements it.
  text_contrast: string
  field_order: string[]
  show_qr_codes: boolean
  qr_show_portal: boolean
  qr_portal_url: string
  qr_portal_label: string
  qr_show_social: boolean
  qr_social_links: Array<{ id: string; label: string; url: string }>
  sales_receipt_enabled: boolean
  sales_receipt_aba_account_name: string
  sales_receipt_aba_account_number: string
  sales_receipt_aba_qr_image: string
  sales_receipt_note: string
}

export interface ReceiptPrintSettings {
  paperSize: string
  highContrastBold: boolean
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
