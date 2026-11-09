// What a shopper reads when the order API says no (KHQR S7). The Worker answers with a `code` and an English sentence; the page shows the
// sentence for the code in the shopper's language, never the Worker's own English.
//
// ORDER_ERROR_KEYS is the one list of every code the client handles and the pack key each one shows. tests/orderErrorCopy.test.ts parses
// every code the Worker can send (onlineOrderStore.ts, portalOrders.ts, requestBodyGuard.ts) and fails if one has no entry here, and if any
// entry has no English and Khmer text in both language packs. A code that is not in the list shows the generic sentence, never a raw code.

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

export const ORDER_ERROR_KEYS = {
  // The client's own: the request never got an answer, or the answer was not readable.
  network: 'order_err_network',
  timeout: 'order_err_timeout',
  bad_response: 'order_err_generic',
  unknown: 'order_err_generic',

  // The Worker's guards in front of every order route.
  feature_off: 'order_err_off',
  rate_limited: 'order_err_rate',
  invalid_json: 'order_err_reload',
  invalid_request: 'order_err_reload',
  request_body_unreadable: 'order_err_reload',
  credential_origin_refused: 'order_err_reload',
  credential_json_required: 'order_err_reload',
  request_body_too_large: 'order_err_too_large',
  payway_not_configured: 'order_err_pay_unavailable',
  payment_unavailable: 'order_err_pay_unavailable',
  payment_busy: 'order_err_pay_busy',
  payment_limit: 'order_err_pay_limit',
  payment_amount_too_small: 'order_err_pay_small',
  portal_privacy_unavailable: 'order_err_shop_not_ready',
  shop_not_ready: 'order_err_shop_not_ready',

  // What the buyer typed.
  name_required: 'order_err_name_required',
  name_invalid: 'order_err_text_invalid',
  name_too_long: 'order_err_text_long',
  phone_invalid: 'order_err_phone',
  fulfilment_invalid: 'order_err_fulfilment',
  address_required: 'order_err_address_required',
  address_invalid: 'order_err_text_invalid',
  address_too_long: 'order_err_text_long',
  note_invalid: 'order_err_text_invalid',
  note_too_long: 'order_err_text_long',
  comment_invalid: 'order_err_text_invalid',
  comment_too_long: 'order_err_text_long',
  contact_telegram_invalid: 'order_err_text_invalid',
  contact_telegram_too_long: 'order_err_text_long',
  contact_instagram_invalid: 'order_err_text_invalid',
  contact_instagram_too_long: 'order_err_text_long',
  contact_facebook_invalid: 'order_err_text_invalid',
  contact_facebook_too_long: 'order_err_text_long',
  contact_tiktok_invalid: 'order_err_text_invalid',
  contact_tiktok_too_long: 'order_err_text_long',
  contact_whatsapp_invalid: 'order_err_text_invalid',
  contact_whatsapp_too_long: 'order_err_text_long',
  contact_other_invalid: 'order_err_text_invalid',
  contact_other_too_long: 'order_err_text_long',
  attachments_invalid: 'order_err_attachments',

  // The list.
  lines_required: 'order_err_lines_required',
  too_many_lines: 'order_err_too_many_lines',
  invalid_line: 'order_err_invalid_line',
  duplicate_product: 'order_err_duplicate_product',
  product_unavailable: 'order_err_product_unavailable',
  out_of_stock: 'order_err_out_of_stock',
  pricing_failed: 'order_err_pricing',

  // The order itself.
  order_not_found: 'order_err_not_found',
  duplicate_request: 'order_err_duplicate',
  busy: 'order_err_busy',
  too_many_open_orders: 'order_err_too_many_open',
  already_paid: 'order_err_already_paid',
  order_not_editable: 'order_err_not_editable',
  order_changed: 'order_err_changed',
  order_not_cancellable: 'order_err_not_cancellable',
  order_not_retryable: 'order_err_not_retryable',
  qr_still_valid: 'order_err_qr_valid',
  no_topup_due: 'order_err_no_topup',
  topup_paid: 'order_err_topup_paid',
  order_not_open: 'order_err_not_open',

  // Requests after payment.
  request_invalid: 'order_err_request_invalid',
  phone_mismatch: 'order_err_phone_mismatch',
  request_not_ready: 'order_err_req_not_ready',
  request_window_closed: 'order_err_req_window',
  request_closed: 'order_err_req_closed',
  request_pending: 'order_err_req_pending',
  request_limit: 'order_err_req_limit',
  request_kind_not_allowed: 'order_err_req_kind',
  request_kind_invalid: 'order_err_req_kind_invalid',
  request_not_found: 'order_err_req_not_found',
  request_not_pending: 'order_err_req_not_pending',
} as const

export type OrderErrorKey = (typeof ORDER_ERROR_KEYS)[keyof typeof ORDER_ERROR_KEYS] | 'order_err_generic'

/** The pack key a code shows (the generic one for a code this page has never heard of). */
export function orderErrorKey(code: string): OrderErrorKey {
  return Object.prototype.hasOwnProperty.call(ORDER_ERROR_KEYS, code) ? ORDER_ERROR_KEYS[code as keyof typeof ORDER_ERROR_KEYS] : 'order_err_generic'
}

/** The sentence for an API failure code, in the shopper's language (copy is the storefront's own translator). */
export function orderErrorMessage(copy: CopyFn, code: string): string {
  switch (orderErrorKey(code)) {
    case 'order_err_network': return copy('order_err_network', 'We could not reach the shop. Check your internet and try again.', 'មិនអាចភ្ជាប់ទៅហាងបានទេ។ សូមពិនិត្យអ៊ីនធឺណិត រួចព្យាយាមម្តងទៀត។')
    case 'order_err_timeout': return copy('order_err_timeout', 'The shop took too long to answer. Please try again.', 'ហាងឆ្លើយតបយូរពេក។ សូមព្យាយាមម្តងទៀត។')
    case 'order_err_off': return copy('order_err_off', 'Online ordering is paused right now. Please contact the shop to buy.', 'ការបញ្ជាទិញតាមអនឡាញកំពុងផ្អាកបណ្តោះអាសន្ន។ សូមទាក់ទងហាងដើម្បីទិញ។')
    case 'order_err_rate': return copy('order_err_rate', 'Too many tries. Please wait a minute and try again.', 'ព្យាយាមច្រើនពេក។ សូមរង់ចាំមួយនាទី រួចព្យាយាមម្តងទៀត។')
    case 'order_err_reload': return copy('order_err_reload', 'We could not read your request. Please reload the page and try again.', 'មិនអាចអានសំណើរបស់អ្នកបានទេ។ សូមផ្ទុកទំព័រឡើងវិញ រួចព្យាយាមម្តងទៀត។')
    case 'order_err_too_large': return copy('order_err_too_large', 'That is too much to send at once. Please shorten your text.', 'ទិន្នន័យច្រើនពេកក្នុងការផ្ញើម្តង។ សូមកាត់បន្ថយអក្សរ។')
    case 'order_err_pay_unavailable': return copy('order_err_pay_unavailable', 'Online payment is not available right now. Nothing was charged. Please contact the shop.', 'ការទូទាត់តាមអនឡាញមិនអាចប្រើបានឥឡូវនេះទេ។ មិនទាន់មានការកាត់ប្រាក់ទេ។ សូមទាក់ទងហាង។')
    case 'order_err_pay_busy': return copy('order_err_pay_busy', 'The payment service is busy. Nothing was charged. Please try again in a minute.', 'សេវាទូទាត់កំពុងមមាញឹក។ មិនទាន់មានការកាត់ប្រាក់ទេ។ សូមព្យាយាមម្តងទៀតក្នុងមួយនាទី។')
    case 'order_err_pay_limit': return copy('order_err_pay_limit', 'This amount is above what ABA allows for one payment. Please contact the shop to pay another way.', 'ចំនួនទឹកប្រាក់នេះលើសពីអ្វីដែល ABA អនុញ្ញាតសម្រាប់ការទូទាត់មួយដង។ សូមទាក់ទងហាង ដើម្បីបង់តាមវិធីផ្សេង។')
    case 'order_err_pay_small': return copy('order_err_pay_small', 'This amount is below the smallest payment ABA accepts. Please add an item or contact the shop.', 'ចំនួនទឹកប្រាក់នេះតិចជាងការទូទាត់តិចបំផុតដែល ABA ទទួល។ សូមបន្ថែមទំនិញ ឬទាក់ទងហាង។')
    case 'order_err_shop_not_ready': return copy('order_err_shop_not_ready', 'The shop is not taking online orders right now. Please try again later.', 'ពេលនេះហាងមិនទទួលការបញ្ជាទិញតាមអនឡាញទេ។ សូមព្យាយាមម្តងទៀតនៅពេលក្រោយ។')
    case 'order_err_name_required': return copy('order_err_name_required', 'Please enter your name.', 'សូមបញ្ចូលឈ្មោះរបស់អ្នក។')
    case 'order_err_text_invalid': return copy('order_err_text_invalid', 'Please check what you typed and try again.', 'សូមពិនិត្យអ្វីដែលអ្នកបានវាយ រួចព្យាយាមម្តងទៀត។')
    case 'order_err_text_long': return copy('order_err_text_long', 'That text is too long. Please make it shorter.', 'អក្សរនោះវែងពេក។ សូមធ្វើឱ្យខ្លីជាងនេះ។')
    case 'order_err_phone': return copy('order_err_phone', 'Please enter a phone number we can call, for example 012 345 678.', 'សូមបញ្ចូលលេខទូរស័ព្ទដែលយើងអាចហៅបាន ឧទាហរណ៍ 012 345 678។')
    case 'order_err_fulfilment': return copy('order_err_fulfilment', 'Choose pickup or delivery.', 'សូមជ្រើសរើសមកយកផ្ទាល់ ឬដឹកជញ្ជូន។')
    case 'order_err_address_required': return copy('order_err_address_required', 'Please enter your delivery address. Our staff will contact you about the delivery price and time.', 'សូមបញ្ចូលអាសយដ្ឋានដឹកជញ្ជូនរបស់អ្នក។ បុគ្គលិករបស់យើងនឹងទាក់ទងអ្នកអំពីតម្លៃ និងពេលវេលាដឹកជញ្ជូន។')
    case 'order_err_attachments': return copy('order_err_attachments', 'We could not attach your picture. Our staff will contact you for photos.', 'យើងមិនអាចភ្ជាប់រូបភាពរបស់អ្នកបានទេ។ បុគ្គលិករបស់យើងនឹងទាក់ទងអ្នកសុំរូបថត។')
    case 'order_err_lines_required': return copy('order_err_lines_required', 'Your list is empty. Add at least one item.', 'បញ្ជីរបស់អ្នកទទេ។ សូមបន្ថែមទំនិញយ៉ាងហោចណាស់មួយ។')
    case 'order_err_too_many_lines': return copy('order_err_too_many_lines', 'There are too many different items in one order. Please split it into two orders.', 'មានទំនិញខុសៗគ្នាច្រើនពេកក្នុងការបញ្ជាទិញមួយ។ សូមបំបែកជាពីរការបញ្ជាទិញ។')
    case 'order_err_invalid_line': return copy('order_err_invalid_line', 'Each item needs a quantity between 1 and 99.', 'ទំនិញនីមួយៗត្រូវមានចំនួនពី 1 ដល់ 99។')
    case 'order_err_duplicate_product': return copy('order_err_duplicate_product', 'An item appears twice. Please combine it into one line.', 'មានទំនិញមួយលេចឡើងពីរដង។ សូមបញ្ចូលវាជាមួយបន្ទាត់តែមួយ។')
    case 'order_err_product_unavailable': return copy('order_err_product_unavailable', 'An item in your list is no longer available. Please remove it and try again.', 'ទំនិញមួយក្នុងបញ្ជីរបស់អ្នកលែងមានទៀតហើយ។ សូមដកវាចេញ រួចព្យាយាមម្តងទៀត។')
    case 'order_err_out_of_stock': return copy('order_err_out_of_stock', 'Some items are not in stock in the quantity you asked for. Please lower the quantity or remove them.', 'ទំនិញខ្លះមិនមានស្តុកគ្រប់តាមចំនួនដែលអ្នកស្នើទេ។ សូមកាត់បន្ថយចំនួន ឬដកវាចេញ។')
    case 'order_err_pricing': return copy('order_err_pricing', 'We could not work out the price of this order. Please contact the shop.', 'យើងមិនអាចគណនាតម្លៃនៃការបញ្ជាទិញនេះបានទេ។ សូមទាក់ទងហាង។')
    case 'order_err_not_found': return copy('order_err_not_found', 'We could not find this order. Check the link you were given.', 'រកមិនឃើញការបញ្ជាទិញនេះទេ។ សូមពិនិត្យតំណដែលអ្នកទទួលបាន។')
    case 'order_err_duplicate': return copy('order_err_duplicate', 'This order was already placed. Open it from My orders or from the link you were given, or start a new list.', 'ការបញ្ជាទិញនេះត្រូវបានដាក់រួចហើយ។ សូមបើកវាពី «ការបញ្ជាទិញរបស់ខ្ញុំ» ឬពីតំណដែលអ្នកទទួលបាន ឬចាប់ផ្តើមបញ្ជីថ្មី។')
    case 'order_err_busy': return copy('order_err_busy', 'We are busy right now. Please try again in a few minutes.', 'ពេលនេះយើងមមាញឹក។ សូមព្យាយាមម្តងទៀតក្នុងរយៈពេលពីរបីនាទី។')
    case 'order_err_too_many_open': return copy('order_err_too_many_open', 'You already have orders waiting for payment. Please pay or cancel them first.', 'អ្នកមានការបញ្ជាទិញកំពុងរង់ចាំការទូទាត់រួចហើយ។ សូមបង់ប្រាក់ ឬបោះបង់វាជាមុនសិន។')
    case 'order_err_already_paid': return copy('order_err_already_paid', 'This order was just paid, so it can no longer be changed here. Ask the shop if you need a change.', 'ការបញ្ជាទិញនេះទើបតែបានបង់ប្រាក់ ដូច្នេះមិនអាចកែនៅទីនេះទៀតទេ។ សូមសួរហាង បើអ្នកត្រូវការកែប្រែ។')
    case 'order_err_not_editable': return copy('order_err_not_editable', 'This order can no longer be changed here. Please contact the shop.', 'ការបញ្ជាទិញនេះមិនអាចកែនៅទីនេះទៀតទេ។ សូមទាក់ទងហាង។')
    case 'order_err_changed': return copy('order_err_changed', 'This order changed while you were editing it. Please reload and try again.', 'ការបញ្ជាទិញនេះបានផ្លាស់ប្តូរ ខណៈអ្នកកំពុងកែ។ សូមផ្ទុកឡើងវិញ រួចព្យាយាមម្តងទៀត។')
    case 'order_err_not_cancellable': return copy('order_err_not_cancellable', 'This order can no longer be cancelled here. Please contact the shop.', 'ការបញ្ជាទិញនេះមិនអាចបោះបង់នៅទីនេះទៀតទេ។ សូមទាក់ទងហាង។')
    case 'order_err_not_retryable': return copy('order_err_not_retryable', 'This order does not need a new QR.', 'ការបញ្ជាទិញនេះមិនត្រូវការ QR ថ្មីទេ។')
    case 'order_err_qr_valid': return copy('order_err_qr_valid', 'Your QR is still valid. Please scan it to pay.', 'QR របស់អ្នកនៅតែប្រើបាន។ សូមស្កេនវាដើម្បីបង់ប្រាក់។')
    case 'order_err_no_topup': return copy('order_err_no_topup', 'There is no extra payment waiting for this request.', 'គ្មានការបង់ប្រាក់បន្ថែមកំពុងរង់ចាំសម្រាប់សំណើនេះទេ។')
    case 'order_err_topup_paid': return copy('order_err_topup_paid', 'This extra payment was already received. Thank you.', 'ការបង់ប្រាក់បន្ថែមនេះត្រូវបានទទួលរួចហើយ។ សូមអរគុណ។')
    case 'order_err_not_open': return copy('order_err_not_open', 'This order is cancelled.', 'ការបញ្ជាទិញនេះត្រូវបានបោះបង់។')
    case 'order_err_request_invalid': return copy('order_err_request_invalid', 'Choose which request this payment is for.', 'សូមជ្រើសរើសសំណើដែលការបង់ប្រាក់នេះសម្រាប់។')
    case 'order_err_phone_mismatch': return copy('order_err_phone_mismatch', 'That phone number does not match this order. Enter the number you gave when you ordered.', 'លេខទូរស័ព្ទនោះមិនត្រូវនឹងការបញ្ជាទិញនេះទេ។ សូមបញ្ចូលលេខដែលអ្នកបានផ្តល់ពេលបញ្ជាទិញ។')
    case 'order_err_req_not_ready': return copy('order_err_req_not_ready', 'You can send a request once your payment is confirmed.', 'អ្នកអាចផ្ញើសំណើបាន នៅពេលការទូទាត់របស់អ្នកត្រូវបានបញ្ជាក់។')
    case 'order_err_req_window': return copy('order_err_req_window', 'The time for changes has ended. Please contact the shop.', 'រយៈពេលសម្រាប់ការកែប្រែបានបញ្ចប់។ សូមទាក់ទងហាង។')
    case 'order_err_req_closed': return copy('order_err_req_closed', 'This order is closed. Please contact the shop if you need help.', 'ការបញ្ជាទិញនេះបានបិទ។ សូមទាក់ទងហាង បើអ្នកត្រូវការជំនួយ។')
    case 'order_err_req_pending': return copy('order_err_req_pending', 'You already have a request waiting for the shop. Please wait for an answer, or withdraw it first.', 'អ្នកមានសំណើកំពុងរង់ចាំហាងរួចហើយ។ សូមរង់ចាំចម្លើយ ឬដកសំណើនោះវិញជាមុនសិន។')
    case 'order_err_req_limit': return copy('order_err_req_limit', 'This order has reached the number of requests allowed. Please contact the shop.', 'ការបញ្ជាទិញនេះបានដល់ចំនួនសំណើដែលអនុញ្ញាតហើយ។ សូមទាក់ទងហាង។')
    case 'order_err_req_kind': return copy('order_err_req_kind', 'That kind of request is not available for this order yet.', 'សំណើប្រភេទនេះមិនទាន់អាចប្រើបានសម្រាប់ការបញ្ជាទិញនេះទេ។')
    case 'order_err_req_kind_invalid': return copy('order_err_req_kind_invalid', 'Choose what you would like to change.', 'សូមជ្រើសរើសអ្វីដែលអ្នកចង់កែប្រែ។')
    case 'order_err_req_not_found': return copy('order_err_req_not_found', 'We could not find that request.', 'រកមិនឃើញសំណើនោះទេ។')
    case 'order_err_req_not_pending': return copy('order_err_req_not_pending', 'The shop has already answered this request, so it cannot be withdrawn.', 'ហាងបានឆ្លើយសំណើនេះរួចហើយ ដូច្នេះមិនអាចដកវិញបានទេ។')
    default: return copy('order_err_generic', 'Something went wrong. Please try again.', 'មានបញ្ហាមួយ។ សូមព្យាយាមម្តងទៀត។')
  }
}
