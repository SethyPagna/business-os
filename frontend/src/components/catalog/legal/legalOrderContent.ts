import { LEGAL_PAGE_SECTIONS } from './legalContent.ts'
import type { LegalPageKey, LegalSection, LegalStorageRow } from './legalContent.ts'

// Policy text that only exists while online ordering is on (the shop's `online_orders` switch). Kept out of legalContent.ts on purpose: that module is in the
// storefront's first-paint closure for every shopper, and a shop with ordering off (or a shopper who never opens a policy) must not download this. LegalPages
// loads it with a dynamic import() when the policy reader opens with ordering on, and registers it (registerLegalTexts). The keys stay in the portal_legal_*
// namespace and are mirrored into en.json + km.json like every other policy string; tests/portalLegalContent.test.ts locks that mirror.
export const ORDER_LEGAL_EN: Readonly<Record<string, string>> = {
  portal_legal_privacy_orders_h: 'Orders and online payment',
  portal_legal_privacy_orders_b: 'You can order without an account. For an order we keep your name and phone number, how you want to receive it (pickup or delivery) and, for delivery, your address. Any social contacts or note you add are optional and are kept with the order, together with what you ordered, its total and whether it was paid. You pay in your own banking app by scanning the KHQR code, so we never see or keep your bank details, card numbers or passwords. Staff use your phone number only to reach you about your order.',
  portal_legal_privacy_sharing_orders: 'To take your payment, ABA PayWay receives the amount, a payment reference and the order number. We never send it your name, phone number or address. Our staff are told about your order in a private staff chat on Telegram, which shows your name, your phone number and the comments you send with a request. It never shows your address, social contacts or note.',
  portal_legal_privacy_retention_orders: 'An order stays in our records with its payment status, because we need it to look after your purchase, refunds and returns. To ask us to correct or delete the details on an order, contact us using the business details above.',
  portal_legal_terms_catalogue_online_b: 'This site shows what {name} has in stock so you can browse, plan your visit or order online. The catalogue itself is an invitation to get in touch, not a binding offer.',
  portal_legal_terms_online_h: 'Ordering and paying online',
  portal_legal_terms_online_b: 'You can order here without an account. Pick your items, give your name and phone number, choose pickup or delivery and pay by scanning the KHQR code in your banking app. Nothing is held for you before you pay. Each QR code works for the short time shown on the screen; if it runs out, nothing is charged and you can ask for a new one. The QR covers the goods only. For delivery, our staff contact you about the delivery price, the time and how to pay for it. We will never ask for your bank details, card numbers or passwords, so anyone who does, even if they say they are us, is trying to scam you.',
  portal_legal_terms_orders_h: 'Changing, cancelling and returning an order',
  portal_legal_terms_orders_b: 'Until you pay, you can change or cancel your order on its order page, and nothing is charged for a cancelled order. After you pay, ask us on the same page to change or cancel it or to return items. Our staff review each request and answer there. Returns follow the Returns section above. Anyone who has your order link can see your order, so keep the link private.',
  portal_legal_store_orders_p: 'The orders you placed on this device (the link, order number, time and total), so My orders can list them. It never holds your name, phone number or address.',
}

export const ORDER_LEGAL_KM: Readonly<Record<string, string>> = {
  portal_legal_privacy_orders_h: 'ការបញ្ជាទិញ និងការទូទាត់តាមអនឡាញ',
  portal_legal_privacy_orders_b: 'អ្នកអាចបញ្ជាទិញបានដោយមិនចាំបាច់មានគណនី។ សម្រាប់ការបញ្ជាទិញ យើងរក្សាទុកឈ្មោះ និងលេខទូរស័ព្ទរបស់អ្នក វិធីដែលអ្នកចង់ទទួល (មកយកនៅហាង ឬដឹកជញ្ជូន) ហើយសម្រាប់ការដឹកជញ្ជូន យើងរក្សាទុកអាសយដ្ឋានរបស់អ្នក។ ទំនាក់ទំនងបណ្តាញសង្គម ឬកំណត់ចំណាំដែលអ្នកបន្ថែមគឺជាជម្រើស ហើយត្រូវបានរក្សាទុកជាមួយការបញ្ជាទិញ រួមជាមួយទំនិញដែលអ្នកបានបញ្ជាទិញ តម្លៃសរុប និងស្ថានភាពទូទាត់។ អ្នកបង់ប្រាក់ក្នុងកម្មវិធីធនាគាររបស់អ្នកផ្ទាល់ ដោយស្កេនកូដ KHQR ដូច្នេះយើងមិនឃើញ ឬរក្សាទុកព័ត៌មានគណនីធនាគារ លេខកាត ឬពាក្យសម្ងាត់របស់អ្នកឡើយ។ បុគ្គលិកប្រើលេខទូរស័ព្ទរបស់អ្នកដើម្បីទាក់ទងអ្នកអំពីការបញ្ជាទិញប៉ុណ្ណោះ។',
  portal_legal_privacy_sharing_orders: 'ដើម្បីទទួលការទូទាត់របស់អ្នក ABA PayWay ទទួលបានចំនួនទឹកប្រាក់ លេខយោងការទូទាត់ និងលេខបញ្ជាទិញ។ យើងមិនផ្ញើឈ្មោះ លេខទូរស័ព្ទ ឬអាសយដ្ឋានរបស់អ្នកទៅវាឡើយ។ បុគ្គលិករបស់យើងត្រូវបានជូនដំណឹងអំពីការបញ្ជាទិញរបស់អ្នកក្នុងក្រុមសន្ទនាឯកជនរបស់បុគ្គលិកលើ Telegram ដែលបង្ហាញឈ្មោះរបស់អ្នក លេខទូរស័ព្ទរបស់អ្នក និងមតិដែលអ្នកផ្ញើជាមួយសំណើ។ វាមិនដែលបង្ហាញអាសយដ្ឋាន ទំនាក់ទំនងបណ្តាញសង្គម ឬកំណត់ចំណាំរបស់អ្នកឡើយ។',
  portal_legal_privacy_retention_orders: 'ការបញ្ជាទិញនៅក្នុងកំណត់ត្រារបស់យើងជាមួយស្ថានភាពទូទាត់របស់វា ព្រោះយើងត្រូវការវាដើម្បីមើលការទិញ ការសងប្រាក់ និងការប្រគល់មកវិញរបស់អ្នក។ ដើម្បីស្នើកែ ឬលុបព័ត៌មានលើការបញ្ជាទិញ សូមទាក់ទងយើងតាមព័ត៌មានអាជីវកម្មខាងលើ។',
  portal_legal_terms_catalogue_online_b: 'គេហទំព័រនេះបង្ហាញអ្វីដែល {name} មានស្តុក ដើម្បីឱ្យអ្នករុករក រៀបចំការមកហាង ឬបញ្ជាទិញតាមអនឡាញ។ កាតាឡុកខ្លួនឯងជាការអញ្ជើញឱ្យទាក់ទងមកយើង មិនមែនជាការផ្តល់ជូនដែលចងកាតព្វកិច្ចទេ។',
  portal_legal_terms_online_h: 'ការបញ្ជាទិញ និងការទូទាត់តាមអនឡាញ',
  portal_legal_terms_online_b: 'អ្នកអាចបញ្ជាទិញនៅទីនេះដោយមិនចាំបាច់មានគណនី។ ជ្រើសទំនិញ ផ្តល់ឈ្មោះ និងលេខទូរស័ព្ទរបស់អ្នក ជ្រើសមកយកនៅហាង ឬដឹកជញ្ជូន ហើយបង់ប្រាក់ដោយស្កេនកូដ KHQR ក្នុងកម្មវិធីធនាគាររបស់អ្នក។ គ្មានអ្វីត្រូវបានទុកឱ្យអ្នកមុនអ្នកបង់ប្រាក់ទេ។ កូដ QR នីមួយៗមានសុពលភាពក្នុងរយៈពេលខ្លីដែលបង្ហាញលើអេក្រង់ បើវាផុតកំណត់ គ្មានអ្វីត្រូវបានកាត់ប្រាក់ទេ ហើយអ្នកអាចសុំកូដថ្មី។ QR គិតតែថ្លៃទំនិញប៉ុណ្ណោះ។ សម្រាប់ការដឹកជញ្ជូន បុគ្គលិករបស់យើងនឹងទាក់ទងអ្នកអំពីតម្លៃ ពេលវេលា និងរបៀបបង់ថ្លៃដឹក។ យើងនឹងមិនសុំព័ត៌មានគណនីធនាគារ លេខកាត ឬពាក្យសម្ងាត់របស់អ្នកឡើយ ដូច្នេះអ្នកណាដែលសុំ ទោះបីអះអាងថាជាយើងក៏ដោយ គឺកំពុងព្យាយាមបោកប្រាស់អ្នក។',
  portal_legal_terms_orders_h: 'ការកែប្រែ ការបោះបង់ និងការប្រគល់ការបញ្ជាទិញមកវិញ',
  portal_legal_terms_orders_b: 'មុនអ្នកបង់ប្រាក់ អ្នកអាចកែប្រែ ឬបោះបង់ការបញ្ជាទិញនៅលើទំព័រការបញ្ជាទិញរបស់វា ហើយគ្មានអ្វីត្រូវបានកាត់ប្រាក់សម្រាប់ការបញ្ជាទិញដែលបានបោះបង់ទេ។ ក្រោយអ្នកបង់ប្រាក់ សូមស្នើមកយើងនៅលើទំព័រដដែលដើម្បីកែប្រែ បោះបង់ ឬប្រគល់ទំនិញមកវិញ។ បុគ្គលិករបស់យើងពិនិត្យសំណើនីមួយៗ ហើយឆ្លើយតបនៅទីនោះ។ ការប្រគល់មកវិញធ្វើតាមផ្នែក «ការប្រគល់មកវិញ» ខាងលើ។ អ្នកណាដែលមានតំណការបញ្ជាទិញរបស់អ្នក អាចមើលឃើញការបញ្ជាទិញនោះ ដូច្នេះសូមរក្សាតំណឱ្យនៅឯកជន។',
  portal_legal_store_orders_p: 'ការបញ្ជាទិញដែលអ្នកបានធ្វើលើឧបករណ៍នេះ (តំណ លេខបញ្ជាទិញ ពេលវេលា និងតម្លៃសរុប) ដើម្បីឱ្យ «ការបញ្ជាទិញរបស់ខ្ញុំ» បង្ហាញវា។ វាមិនដែលមានឈ្មោះ លេខទូរស័ព្ទ ឬអាសយដ្ឋានរបស់អ្នកឡើយ។',
}

// With online ordering on (the shop's `online_orders` switch, published as onlineOrdersEnabled) the same pages say what is then true: orders carry personal
// details, payment goes through ABA PayWay, and the catalogue is no longer "no payment". Each section keeps its place; only the added or replaced ones differ.
const sectionWith = (section: LegalSection, ...more: string[]): LegalSection => ({ heading: section.heading, bodies: [...section.bodies, ...more] })
export const LEGAL_PAGE_SECTIONS_ONLINE: Record<LegalPageKey, readonly LegalSection[]> = {
  privacy: LEGAL_PAGE_SECTIONS.privacy.flatMap((section): LegalSection[] => {
    if (section.heading === 'portal_legal_privacy_collect_h') return [section, { heading: 'portal_legal_privacy_orders_h', bodies: ['portal_legal_privacy_orders_b'] }]
    if (section.heading === 'portal_legal_privacy_retention_h') return [sectionWith(section, 'portal_legal_privacy_retention_orders')]
    if (section.heading === 'portal_legal_privacy_sharing_h') return [sectionWith(section, 'portal_legal_privacy_sharing_orders')]
    return [section]
  }),
  terms: LEGAL_PAGE_SECTIONS.terms.flatMap((section): LegalSection[] => {
    if (section.heading === 'portal_legal_terms_catalogue_h') return [{ heading: section.heading, bodies: ['portal_legal_terms_catalogue_online_b'] }]
    if (section.heading === 'portal_legal_terms_nopayment_h') {
      return [
        { heading: 'portal_legal_terms_online_h', bodies: ['portal_legal_terms_online_b'] },
        { heading: 'portal_legal_terms_orders_h', bodies: ['portal_legal_terms_orders_b'] },
      ]
    }
    return [section]
  }),
  cookies: LEGAL_PAGE_SECTIONS.cookies,
}

// orders/orderHistory.ts -- written when an order is placed on this device (the link, number, time and total only); listed only while ordering is on.
export const LEGAL_STORAGE_ROW_ORDERS: LegalStorageRow = { id: 'orders', name: 'business-os-portal-orders-v1', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_orders_p', lifetimeKey: 'portal_legal_store_until_cleared_l' }
