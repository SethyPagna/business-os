export type ReceiptTemplate = {
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
  delivery_fee_position: 'totals' | string
  discount_position: 'before_tax' | string
  show_emojis: boolean
  field_order: string[]
  show_qr_codes: boolean
  qr_show_portal: boolean
  qr_portal_url: string
  qr_portal_label: string
  qr_show_social: boolean
  qr_social_links: ReceiptQrSocialLink[]
  sales_receipt_enabled: boolean
  sales_receipt_aba_account_name: string
  sales_receipt_aba_account_number: string
  sales_receipt_aba_qr_image: string
  sales_receipt_note: 'none' | 'received_payment' | string
}

export type ReceiptQrSocialLink = {
  id: string
  label: string
  url: string
}

export type ReceiptFieldItem = {
  key: keyof ReceiptTemplate
  label: string
  section: string
  desc: string
}

type TranslateReceiptLabel = (key: string, fallback?: string) => string

export const DEFAULT_TEMPLATE: ReceiptTemplate = {
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
  show_item_khr: false,
  show_item_discount: true,
  show_discount_khr: false,
  show_membership_discount_khr: false,
  show_delivery_khr: false,
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

export function getFieldItems(t: TranslateReceiptLabel | null): ReceiptFieldItem[] {
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key) : fallback)
  const sections = {
    header: T('receipt_section_header', 'Header'),
    order: T('receipt_section_order', 'Order Info'),
    customer: T('receipt_section_customer', 'Customer'),
    delivery: T('receipt_delivery', 'Delivery'),
    items: T('receipt_section_items', 'Items'),
    style: T('receipt_section_style', 'Style'),
    totals: T('receipt_section_totals', 'Totals'),
  }

  return [
    { key: 'show_business_name', label: T('business_name', 'Business Name'), section: sections.header, desc: T('rfd_business_name', 'Company name at top of receipt') },
    { key: 'show_address', label: T('address', 'Address'), section: sections.header, desc: T('rfd_address', 'Business address') },
    { key: 'show_phone', label: T('phone', 'Phone'), section: sections.header, desc: T('rfd_phone', 'Business phone number') },
    { key: 'show_email', label: T('email', 'Email'), section: sections.header, desc: T('rfd_email', 'Business email address') },
    { key: 'show_tax_id', label: T('tax_id', 'Tax ID'), section: sections.header, desc: T('rfd_tax_id', 'Tax or business ID') },
    { key: 'show_receipt_number', label: T('receipt_number', 'Receipt Number'), section: sections.order, desc: T('rfd_receipt_number', 'Unique receipt ID') },
    { key: 'show_date', label: T('date', 'Date & Time'), section: sections.order, desc: T('rfd_date', 'Transaction date/time') },
    { key: 'show_cashier', label: T('cashier', 'Cashier'), section: sections.order, desc: T('rfd_cashier', 'Staff member name') },
    { key: 'show_payment_method', label: T('payment_method', 'Payment Method'), section: sections.order, desc: T('rfd_payment_method', 'Cash, Card, etc.') },
    { key: 'show_exchange_rate', label: T('exchange_rate', 'Exchange Rate'), section: sections.order, desc: T('rfd_exchange_rate', 'USD to KHR rate') },
    { key: 'show_customer_name', label: T('customer_name', 'Customer Name'), section: sections.customer, desc: T('rfd_customer_name', 'Customer name on receipt') },
    { key: 'show_customer_phone', label: T('customer_phone', 'Customer Phone'), section: sections.customer, desc: T('rfd_customer_phone', 'Customer phone') },
    { key: 'show_customer_address', label: T('customer_address', 'Customer Address'), section: sections.customer, desc: T('rfd_customer_address', 'Customer address') },
    { key: 'show_customer_membership', label: T('customer_membership_id', 'Membership ID'), section: sections.customer, desc: T('rfd_customer_membership', 'Customer membership number') },
    { key: 'delivery_show_contact', label: T('delivery_contact', 'Delivery Contact'), section: sections.delivery, desc: T('rfd_delivery_contact', 'Master switch for delivery contact fields') },
    { key: 'delivery_show_driver_name', label: T('show_delivery_driver_name', 'Show Driver Name'), section: sections.delivery, desc: T('rfd_delivery_driver_name', 'Driver/rider name on receipt') },
    { key: 'delivery_show_driver_phone', label: T('show_delivery_driver_phone', 'Show Driver Phone'), section: sections.delivery, desc: T('rfd_delivery_driver_phone', 'Driver/rider phone on receipt') },
    { key: 'delivery_show_address', label: T('show_delivery_address', 'Delivery Address'), section: sections.delivery, desc: T('rfd_delivery_address', 'Delivery destination') },
    { key: 'delivery_show_fee', label: T('show_delivery_fee', 'Delivery Fee'), section: sections.delivery, desc: T('rfd_delivery_fee', 'Show delivery fee on receipt') },
    { key: 'show_item_sku', label: T('item_sku', 'Item SKU'), section: sections.items, desc: T('rfd_item_sku', 'Product SKU/code per line') },
    { key: 'show_item_qty', label: T('item_qty', 'Quantity'), section: sections.items, desc: T('rfd_item_qty', 'Qty multiplier') },
    { key: 'show_item_unit_price', label: T('item_unit_price', 'Unit Price'), section: sections.items, desc: T('rfd_item_unit_price', 'Price per unit') },
    { key: 'show_item_khr', label: T('item_khr', 'Price in KHR'), section: sections.items, desc: T('rfd_item_khr', 'Secondary KHR price per item') },
    { key: 'show_item_discount', label: T('item_discount', 'Per-Item Discount'), section: sections.items, desc: T('rfd_item_discount', 'Show original price + savings when a product-level discount was applied') },
    { key: 'item_separator', label: T('item_separator', 'Item Separator'), section: sections.items, desc: T('rfd_item_separator', 'Line between items') },
    { key: 'show_subtotal', label: T('subtotal', 'Subtotal'), section: sections.totals, desc: T('rfd_subtotal', 'Sum before discounts/tax') },
    { key: 'show_discount', label: T('discount', 'Discount'), section: sections.totals, desc: T('rfd_discount', 'Applied discount amount') },
    { key: 'show_discount_khr', label: T('discount_khr', 'Discount in KHR'), section: sections.totals, desc: T('rfd_discount_khr', 'Secondary KHR amount under discount') },
    { key: 'show_membership_discount', label: T('membership_discount_field', 'Membership Discount'), section: sections.totals, desc: T('rfd_membership_discount', 'Discount earned from membership tier') },
    { key: 'show_membership_discount_khr', label: T('membership_discount_khr', 'Membership Discount in KHR'), section: sections.totals, desc: T('rfd_membership_discount_khr', 'Secondary KHR amount under membership discount') },
    { key: 'show_membership_points', label: T('membership_points_field', 'Membership Points Redeemed'), section: sections.totals, desc: T('rfd_membership_points', 'Points redeemed on this sale') },
    { key: 'show_tax', label: T('tax', 'Tax'), section: sections.totals, desc: T('rfd_tax', 'Tax amount line') },
    { key: 'show_delivery', label: T('delivery_fee_row', 'Delivery Fee Row'), section: sections.totals, desc: T('rfd_delivery_fee_row', 'Delivery fee in totals section') },
    { key: 'show_delivery_khr', label: T('delivery_khr', 'Delivery in KHR'), section: sections.totals, desc: T('rfd_delivery_khr', 'Secondary KHR amount under delivery fee') },
    { key: 'show_total_khr', label: T('total_khr', 'Total in KHR'), section: sections.totals, desc: T('rfd_total_khr', 'KHR equivalent of total') },
    { key: 'show_amount_paid', label: T('amount_paid', 'Amount Paid'), section: sections.totals, desc: T('rfd_amount_paid', 'Amount customer tendered') },
    { key: 'show_change', label: T('change', 'Change'), section: sections.totals, desc: T('rfd_change', 'Change given back') },
  ]
}

export const ALL_FIELD_ITEMS = getFieldItems(null)
