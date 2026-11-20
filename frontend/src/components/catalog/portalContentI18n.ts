import { defaultConfigText } from './portalLanguagePacks.ts'

type PlainRecord = Record<string, unknown>
type TextRecord = Record<string, string>
type TextRecordByLanguage = Record<string, TextRecord>
type PublicCopyPlaceholder = [token: string, original: string]

const TRANSLATABLE_CONFIG_FIELDS = [
  'aboutTitle',
  'aboutContent',
  'aiTitle',
  'aiIntro',
  'aiDisclaimer',
  'faqTitle',
  'membershipInfoText',
  'promotionsTitle',
  'promotionsIntro',
  'submissionInstructions',
]

const PRODUCT_TRANSLATABLE_FIELDS = [
  'name',
  'description',
  'category',
  'brand',
]

const FAQ_VOCABULARY_BY_LANGUAGE: TextRecordByLanguage = {
  km: {
    'sensitive skin': 'ស្បែកងាយប្រតិកម្ម',
    'skin type': 'ប្រភេទស្បែក',
    products: 'ផលិតផល',
    product: 'ផលិតផល',
    membership: 'សមាជិក',
    points: 'ពិន្ទុ',
    stock: 'ស្តុក',
    alternatives: 'ជម្រើសជំនួស',
    alternative: 'ជម្រើសជំនួស',
    budget: 'ថវិកា',
    price: 'តម្លៃ',
    skincare: 'ថែរក្សាស្បែក',
    makeup: 'គ្រឿងសម្អាង',
    hair: 'សក់',
    body: 'រាងកាយ',
    fragrance: 'ក្លិនក្រអូប',
    perfume: 'ទឹកអប់',
    brand: 'ម៉ាក',
    store: 'ហាង',
    recommendations: 'ការណែនាំ',
    recommend: 'ណែនាំ',
  },
}

const DEFAULT_FAQ_TEXT_BY_LANGUAGE: TextRecordByLanguage = {
  km: {
    'How do I choose products for my skin type?': 'តើខ្ញុំគួរជ្រើសរើសផលិតផលសម្រាប់ប្រភេទស្បែករបស់ខ្ញុំដោយរបៀបណា?',
    'Tell us your skin type, concerns, and what kind of routine you want. We can recommend suitable skincare, cosmetics, hair, or body products from our available stock.': 'ប្រាប់យើងពីប្រភេទស្បែក បញ្ហាស្បែក និងរបៀបថែរក្សាដែលអ្នកចង់បាន។ យើងអាចណែនាំផលិតផលថែរក្សាស្បែក គ្រឿងសម្អាង សក់ ឬរាងកាយដែលសមស្របពីស្តុកបច្ចុប្បន្ន។',
    'Are the products shown here available in store?': 'តើផលិតផលដែលបង្ហាញនៅទីនេះមាននៅហាងដែរឬទេ?',
    'The products shown come from our current catalogue. Stock can change during busy periods, so contact the store for a final confirmation before visiting.': 'ផលិតផលដែលបង្ហាញមកពីកាតាឡុកបច្ចុប្បន្នរបស់យើង។ ស្តុកអាចផ្លាស់ប្តូរនៅពេលរវល់ ដូច្នេះសូមទាក់ទងហាងដើម្បីបញ្ជាក់ចុងក្រោយមុនមកហាង។',
    'If an item is unavailable, message the store through the contact links on this page so the team can suggest alternatives or confirm when stock changes.': 'ប្រសិនបើទំនិញមិនមាន សូមផ្ញើសារទៅហាងតាមតំណទំនាក់ទំនងនៅលើទំព័រនេះ ដើម្បីឱ្យក្រុមការងារណែនាំជម្រើសជំនួស ឬបញ្ជាក់ពេលស្តុកផ្លាស់ប្តូរ។',
    'The portal reads from our current Business OS catalog. Stock can still change during busy periods, so please contact the store if you need a final confirmation before visiting.': 'ទំព័រនេះអានពីកាតាឡុក Business OS បច្ចុប្បន្ន។ ស្តុកអាចផ្លាស់ប្តូរនៅពេលរវល់ ដូច្នេះសូមទាក់ទងហាង ប្រសិនបើអ្នកត្រូវការបញ្ជាក់ចុងក្រោយមុនទៅហាង។',
    'How do I check my membership points?': 'តើខ្ញុំអាចពិនិត្យពិន្ទុសមាជិកភាពរបស់ខ្ញុំដោយរបៀបណា?',
    'Open the Membership section, enter your membership number, and you can review purchase history, returns, and current points from your customer account.': 'បើកផ្នែកសមាជិកភាព បញ្ចូលលេខសមាជិករបស់អ្នក ហើយអ្នកអាចមើលប្រវត្តិទិញ ការត្រឡប់ និងពិន្ទុបច្ចុប្បន្នពីគណនីអតិថិជន។',
    'How does Share & Reward work?': 'តើ Share & Reward ដំណើរការយ៉ាងដូចម្តេច?',
    'Why does the assistant sometimes suggest several options instead of one product?': 'ហេតុអ្វីបានជាជំនួយការខ្លះណែនាំជម្រើសច្រើនជាងផលិតផលតែមួយ?',
    'Where can I see my membership?': 'តើខ្ញុំអាចមើលសមាជិកភាពរបស់ខ្ញុំនៅឯណា?',
    'Sign in and open your account. Your membership ID is shown there. Points are coming soon.': 'ចូលគណនី ហើយបើកគណនីរបស់អ្នក។ លេខសមាជិករបស់អ្នកបង្ហាញនៅទីនោះ។ ពិន្ទុនឹងមកដល់ឆាប់ៗនេះ។',
    'Share our store on social media, then upload your screenshot here. Our staff review every submission. Membership points are coming soon.': 'ចែករំលែកហាងរបស់យើងលើបណ្តាញសង្គម បន្ទាប់មកបង្ហោះរូបថតអេក្រង់នៅទីនេះ។ បុគ្គលិករបស់យើងពិនិត្យរាល់ការដាក់ស្នើ។ ពិន្ទុសមាជិកភាពនឹងមកដល់ឆាប់ៗនេះ។',
    'The assistant compares your question with the live store catalogue and shows a short list when several products fit your needs.': 'ជំនួយការប្រៀបធៀបសំណួររបស់អ្នកជាមួយកាតាឡុកហាងបច្ចុប្បន្ន ហើយបង្ហាញបញ្ជីខ្លី ពេលផលិតផលច្រើនសមនឹងតម្រូវការរបស់អ្នក។',
    'What should I do if an item is out of stock?': 'តើខ្ញុំគួរធ្វើដូចម្តេច ប្រសិនបើទំនិញអស់ស្តុក?',
    'If an item is unavailable, message the store through Facebook, Instagram, Telegram, or phone so the team can suggest alternatives or confirm when stock changes.': 'ប្រសិនបើទំនិញមិនមាន សូមផ្ញើសារទៅហាងតាម Facebook, Instagram, Telegram ឬទូរស័ព្ទ ដើម្បីឱ្យក្រុមការងារណែនាំជម្រើសជំនួស ឬបញ្ជាក់ពេលស្តុកផ្លាស់ប្តូរ។',
    // The starter set in faqStarterText.ts, word for word. The Website Editor seeds the same Khmer from pages.portalEditor.starterFaq in km.json.
    'How do I compare products for my skin type?': 'តើខ្ញុំប្រៀបធៀបផលិតផលសម្រាប់ប្រភេទស្បែករបស់ខ្ញុំដោយរបៀបណា?',
    'Use the catalogue description and manufacturer label to compare products. For allergies, reactions, skin conditions, medicines, or pregnancy, ask a qualified health professional.': 'ប្រើការពិពណ៌នាក្នុងកាតាឡុក និងស្លាកអ្នកផលិត ដើម្បីប្រៀបធៀបផលិតផល។ បើមានអាឡែហ្ស៊ី ប្រតិកម្ម បញ្ហាស្បែក ថ្នាំ ឬមានផ្ទៃពោះ សូមសួរអ្នកជំនាញសុខាភិបាល។',
    'How can I contact the store?': 'តើខ្ញុំអាចទាក់ទងហាងដោយរបៀបណា?',
    'Use the verified contact links on this page to ask about a product or request a current stock check.': 'ប្រើតំណទំនាក់ទំនងផ្លូវការនៅលើទំព័រនេះ ដើម្បីសួរអំពីផលិតផល ឬសុំឱ្យពិនិត្យស្តុកបច្ចុប្បន្ន។',
    'How should I choose a product for sensitive skin?': 'តើខ្ញុំគួរជ្រើសរើសផលិតផលសម្រាប់ស្បែកងាយប្រតិកម្មដោយរបៀបណា?',
    'Read the product label and ingredient list and ask a qualified health professional about allergies or reactions. The catalogue and AI assistant do not provide medical advice.': 'អានស្លាកផលិតផល និងបញ្ជីគ្រឿងផ្សំ ហើយសួរអ្នកជំនាញសុខាភិបាលអំពីអាឡែហ្ស៊ី ឬប្រតិកម្ម។ កាតាឡុក និងជំនួយការ AI មិនផ្តល់ដំបូន្មានវេជ្ជសាស្ត្រទេ។',
    'Can I ask about a product or brand line?': 'តើខ្ញុំអាចសួរអំពីផលិតផល ឬកម្រងម៉ាកបានទេ?',
    'Contact the store about the specific item and ask what packaging, batch, supplier, or sourcing information can be verified before buying.': 'ទាក់ទងហាងអំពីទំនិញនោះ ហើយសួរថាអាចផ្ទៀងផ្ទាត់ព័ត៌មានអំពីវេចខ្ចប់ ឡូត៍ អ្នកផ្គត់ផ្គង់ ឬប្រភពអ្វីខ្លះ មុនទិញ។',
    'What types of products are available?': 'តើមានផលិតផលប្រភេទអ្វីខ្លះ?',
    'Use the category and brand filters to see what is currently listed. Contact the store if a product or category is not shown.': 'ប្រើតម្រងប្រភេទ និងម៉ាក ដើម្បីមើលអ្វីដែលមានបង្ហាញបច្ចុប្បន្ន។ បើរកមិនឃើញផលិតផល ឬប្រភេទណាមួយ សូមទាក់ទងហាង។',
    'Can I ask about a routine?': 'តើខ្ញុំអាចសួរអំពីលំដាប់ថែរក្សាស្បែកបានទេ?',
    'You can contact the store with your budget and preferences. For skin conditions, allergies, reactions, medicines, or pregnancy, ask a qualified health professional.': 'អ្នកអាចទាក់ទងហាងជាមួយថវិកា និងចំណូលចិត្តរបស់អ្នក។ បើមានបញ្ហាស្បែក អាឡែហ្ស៊ី ប្រតិកម្ម ថ្នាំ ឬមានផ្ទៃពោះ សូមសួរអ្នកជំនាញសុខាភិបាល។',
    'Can I look for products within a specific budget?': 'តើខ្ញុំអាចរកផលិតផលតាមថវិកាជាក់លាក់បានទេ?',
    'Use the prices shown in the current catalogue and contact the store to confirm a final price before purchase.': 'មើលតម្លៃក្នុងកាតាឡុកបច្ចុប្បន្ន ហើយទាក់ទងហាងដើម្បីបញ្ជាក់តម្លៃចុងក្រោយមុនទិញ។',
    'Are gifts or bundles available?': 'តើមានអំណោយ ឬកញ្ចប់ផលិតផលដែរឬទេ?',
    'Check the current catalogue and promotions, then contact the store to confirm what is available.': 'មើលកាតាឡុក និងប្រូម៉ូសិនបច្ចុប្បន្ន ហើយទាក់ទងហាងដើម្បីបញ្ជាក់ថាមានអ្វីខ្លះ។',
    'Can I compare alternatives if a brand is unavailable?': 'បើម៉ាកណាមួយអស់ តើខ្ញុំអាចប្រៀបធៀបជម្រើសជំនួសបានទេ?',
    'Compare current products by category, description, price and stock status. The store can confirm current availability.': 'ប្រៀបធៀបផលិតផលបច្ចុប្បន្នតាមប្រភេទ ការពិពណ៌នា តម្លៃ និងស្ថានភាពស្តុក។ ហាងអាចបញ្ជាក់ថាមានឬអត់ពេលនេះ។',
    'How do I check whether a product suits my skin type?': 'តើខ្ញុំត្រូវពិនិត្យយ៉ាងណាថាផលិតផលសមនឹងប្រភេទស្បែករបស់ខ្ញុំ?',
    'Read the manufacturer label and ingredient list. The catalogue cannot determine medical suitability; ask a qualified health professional about allergies, reactions, or skin conditions.': 'អានស្លាកអ្នកផលិត និងបញ្ជីគ្រឿងផ្សំ។ កាតាឡុកមិនអាចកំណត់ភាពសមស្របខាងវេជ្ជសាស្ត្របានទេ សូមសួរអ្នកជំនាញសុខាភិបាលអំពីអាឡែហ្ស៊ី ប្រតិកម្ម ឬបញ្ហាស្បែក។',
    'Where can I see the product categories?': 'តើខ្ញុំអាចមើលប្រភេទផលិតផលនៅឯណា?',
    'Use the current category filters. They reflect the products listed in the catalogue.': 'ប្រើតម្រងប្រភេទបច្ចុប្បន្ន។ វាឆ្លុះបញ្ចាំងពីផលិតផលក្នុងកាតាឡុក។',
    'Do you offer delivery, or is it pickup only?': 'តើអ្នកមានសេវាដឹកជញ្ជូន ឬយកផ្ទាល់នៅហាងតែប៉ុណ្ណោះ?',
    'Contact the store with your location to confirm available delivery or collection options, timing, and fees before ordering.': 'ទាក់ទងហាងជាមួយទីតាំងរបស់អ្នក ដើម្បីបញ្ជាក់ជម្រើសដឹកជញ្ជូន ឬមកយក ពេលវេលា និងថ្លៃសេវា មុនបញ្ជាទិញ។',
    'What payment methods do you accept?': 'តើអ្នកទទួលវិធីទូទាត់អ្វីខ្លះ?',
    'Payment is not collected on this site. Contact the store to confirm the available payment method before ordering.': 'គេហទំព័រនេះមិនទទួលការទូទាត់ទេ។ សូមទាក់ទងហាងដើម្បីបញ្ជាក់វិធីទូទាត់ដែលមាន មុនបញ្ជាទិញ។',
    'What is your returns policy?': 'តើគោលការណ៍ប្រគល់ទំនិញមកវិញរបស់អ្នកយ៉ាងដូចម្តេច?',
    'Returns are accepted within 7 days for unopened items with the receipt.': 'ទទួលការប្រគល់មកវិញក្នុងរយៈពេល ៧ ថ្ងៃ សម្រាប់ទំនិញដែលមិនទាន់បើក ជាមួយវិក្កយបត្រ។',
    'What are your store hours?': 'តើម៉ោងបើកហាងរបស់អ្នកប៉ុន្មាន?',
    'Opening hours are listed in the branch details on this page. Contact the store to confirm the hours for today.': 'ម៉ោងបើកមានក្នុងព័ត៌មានសាខានៅលើទំព័រនេះ។ ទាក់ទងហាងដើម្បីបញ្ជាក់ម៉ោងសម្រាប់ថ្ងៃនេះ។',
    'How can I ask about a product\'s source or authenticity?': 'តើខ្ញុំអាចសួរអំពីប្រភព ឬភាពពិតប្រាកដនៃផលិតផលដោយរបៀបណា?',
    'Contact the store about the specific item and ask what sourcing, batch, packaging, or supplier information can be verified. This catalogue does not make a blanket authenticity guarantee.': 'ទាក់ទងហាងអំពីទំនិញនោះ ហើយសួរថាអាចផ្ទៀងផ្ទាត់ព័ត៌មានអំពីប្រភព ឡូត៍ វេចខ្ចប់ ឬអ្នកផ្គត់ផ្គង់អ្វីខ្លះ។ កាតាឡុកនេះមិនធានាភាពពិតប្រាកដជារួមទេ។',
    'Where can I see current promotions and discounts?': 'តើខ្ញុំអាចមើលប្រូម៉ូសិន និងការបញ្ចុះតម្លៃបច្ចុប្បន្ននៅឯណា?',
    'Check the Promotions section for offers currently published by the store, then confirm the final price and terms before purchase.': 'មើលផ្នែកប្រូម៉ូសិនសម្រាប់ការផ្តល់ជូនដែលហាងបានផ្សាយបច្ចុប្បន្ន ហើយបញ្ជាក់តម្លៃចុងក្រោយ និងលក្ខខណ្ឌមុនទិញ។',
    'What details help the AI recommend better products?': 'តើព័ត៌មានអ្វីជួយឱ្យ AI ណែនាំផលិតផលបានល្អជាង?',
    'Add your skin type, concerns, brand preferences, and what you want the product to do. The assistant uses that together with our current catalog to narrow better matches.': 'បន្ថែមប្រភេទស្បែក បញ្ហាស្បែក ម៉ាកដែលចូលចិត្ត និងអ្វីដែលអ្នកចង់ឱ្យផលិតផលធ្វើ។ ជំនួយការប្រើវាជាមួយកាតាឡុកបច្ចុប្បន្នរបស់យើង ដើម្បីរកផលិតផលដែលសមជាង។',
    'Which products can the AI recommend?': 'តើ AI អាចណែនាំផលិតផលអ្វីខ្លះ?',
    'The assistant receives a limited set of products from the current public catalogue. Stock can change, so confirm availability with the store.': 'ជំនួយការទទួលបានផលិតផលមួយចំនួនពីកាតាឡុកសាធារណៈបច្ចុប្បន្ន។ ស្តុកអាចប្រែប្រួល ដូច្នេះសូមបញ្ជាក់ជាមួយហាងថាមានឬអត់។',
    'Should I trust the AI as medical or skin-treatment advice?': 'តើខ្ញុំគួរជឿ AI ជាដំបូន្មានវេជ្ជសាស្ត្រ ឬព្យាបាលស្បែកឬទេ?',
    'No. AI answers are for general product comparison only. Ask a qualified health professional about sensitive skin, allergies, reactions, treatment, medicines, or pregnancy.': 'ទេ។ ចម្លើយរបស់ AI សម្រាប់ប្រៀបធៀបផលិតផលជាទូទៅប៉ុណ្ណោះ។ សូមសួរអ្នកជំនាញសុខាភិបាលអំពីស្បែកងាយប្រតិកម្ម អាឡែហ្ស៊ី ប្រតិកម្ម ការព្យាបាល ថ្នាំ ឬមានផ្ទៃពោះ។',
    'Can the assistant explain why a product was suggested?': 'តើជំនួយការអាចពន្យល់ហេតុអ្វីបានណែនាំផលិតផលនោះដែរឬទេ?',
    'Yes. Open a suggested product to see the catalogue-based reason and why it matched your question. The assistant does not give usage directions, cautions or ingredient lists, so read the product label. It does not browse for reviews or prove product claims.': 'បាន។ បើកផលិតផលដែលបានណែនាំ ដើម្បីមើលហេតុផលតាមកាតាឡុក និងហេតុអ្វីវាត្រូវនឹងសំណួររបស់អ្នក។ ជំនួយការមិនផ្តល់របៀបប្រើ ការប្រុងប្រយ័ត្ន ឬបញ្ជីគ្រឿងផ្សំទេ ដូច្នេះសូមអានស្លាកផលិតផល។ វាមិនស្វែងរកការវាយតម្លៃ ឬបញ្ជាក់ការអះអាងអំពីផលិតផលទេ។',
  },
}

const FAQ_VOCABULARY_EXTENSIONS_BY_LANGUAGE: TextRecordByLanguage = {
  km: {
    delivery: 'ការដឹកជញ្ជូន',
    payment: 'ការទូទាត់',
    'store hours': 'ម៉ោងបើកហាង',
    authentic: 'ទំនិញពិតប្រាកដ',
    promotions: 'ការផ្សព្វផ្សាយ',
    discounts: 'បញ្ចុះតម្លៃ',
    'available in store': 'មាននៅហាង',
    'membership points': 'ពិន្ទុសមាជិកភាព',
    'purchase history': 'ប្រវត្តិទិញ',
    'out of stock': 'អស់ស្តុក',
    'specific budget': 'ថវិកាជាក់លាក់',
    concerns: 'បញ្ហាស្បែក',
    routine: 'របៀបថែរក្សា',
    cosmetics: 'គ្រឿងសម្អាង',
    'hair care': 'ការថែសក់',
    'body care': 'ការថែទាំរាងកាយ',
    available: 'មាន',
    unavailable: 'មិនមាន',
    category: 'ប្រភេទ',
    categories: 'ប្រភេទ',
    branch: 'សាខា',
    item: 'ទំនិញ',
    items: 'ទំនិញ',
    assistant: 'ជំនួយការ',
    advice: 'ការណែនាំ',
    medical: 'វេជ្ជសាស្ត្រ',
    allergies: 'អាឡែហ្ស៊ី',
    oily: 'ស្បែកខ្លាញ់',
    dry: 'ស្បែកស្ងួត',
    combination: 'ស្បែកចម្រុះ',
    suitable: 'សមស្រប',
    contact: 'ទាក់ទង',
    phone: 'ទូរស័ព្ទ',
  },
}

Object.entries(FAQ_VOCABULARY_EXTENSIONS_BY_LANGUAGE).forEach(([language, vocabulary]) => {
  FAQ_VOCABULARY_BY_LANGUAGE[language] = {
    ...(FAQ_VOCABULARY_BY_LANGUAGE[language] || {}),
    ...vocabulary,
  }
})

const FAQ_FUTURE_EDIT_VOCABULARY_BY_LANGUAGE: TextRecordByLanguage = {
  km: { 'social media': 'បណ្ដាញសង្គម', screenshot: 'រូបថតអេក្រង់', gift: 'អំណោយ', bundles: 'កញ្ចប់', 'oily skin': 'ស្បែកខ្លាញ់', 'dry skin': 'ស្បែកស្ងួត', 'combination skin': 'ស្បែកចម្រុះ', morning: 'ពេលព្រឹក', night: 'ពេលយប់', 'for reference only': 'សម្រាប់យោងប៉ុណ្ណោះ', 'medical advice': 'ដំបូន្មានវេជ្ជសាស្ត្រ' },
}

Object.entries(FAQ_FUTURE_EDIT_VOCABULARY_BY_LANGUAGE).forEach(([language, vocabulary]) => {
  FAQ_VOCABULARY_BY_LANGUAGE[language] = {
    ...(FAQ_VOCABULARY_BY_LANGUAGE[language] || {}),
    ...vocabulary,
  }
})

const PUBLIC_COPY_PROTECTED_TERMS = [
  'Leang Beauty',
  'Leang Cosmetic',
  'Business OS',
  'Facebook',
  'Instagram',
  'Telegram',
]

function isPlainObject(value: unknown): value is PlainRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLanguageKey(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeText(value: unknown): string {
  return String(value || '').normalize('NFC').trim()
}

export function normalizePortalTranslations(value: unknown): PlainRecord {
  if (!value) return {}
  if (isPlainObject(value)) return value
  if (typeof value !== 'string') return {}
  const raw = value.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : {}
  } catch (_) {
    return {}
  }
}

export function stringifyPortalTranslations(value: unknown): string {
  const normalized = normalizePortalTranslations(value)
  if (!Object.keys(normalized).length) return '{}'
  return JSON.stringify(normalized, null, 2)
}

function getLanguageBlock(translations: unknown, language: unknown): PlainRecord {
  const normalized = normalizePortalTranslations(translations)
  const key = normalizeLanguageKey(language)
  if (!key) return {}
  if (isPlainObject(normalized[key])) return normalized[key]
  const lowerMatch = Object.entries(normalized).find(([entryKey]) => normalizeLanguageKey(entryKey) === key)
  if (lowerMatch && isPlainObject(lowerMatch[1])) return lowerMatch[1]
  const base = key.split('-')[0]
  if (base && isPlainObject(normalized[base])) return normalized[base]
  return {}
}

function pickTranslatedText(block: unknown, field: string, fallback: unknown): unknown {
  if (!isPlainObject(block)) return fallback
  const fieldsBlock = isPlainObject(block.fields) ? block.fields : {}
  const textBlock = isPlainObject(block.text) ? block.text : {}
  const candidates = [
    block[field],
    fieldsBlock[field],
    textBlock[field],
  ]
  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    if (text) return text
  }
  return fallback
}

function pickDefaultFirstPartyText(language: unknown, field: string, fallback: unknown): unknown {
  return normalizeLanguageKey(language) === 'en' ? fallback : defaultConfigText(language, field, fallback)
}

function getCollectionEntry(collection: unknown, id: unknown, index: number): PlainRecord {
  if (!collection) return {}
  if (Array.isArray(collection)) {
    const byIndex = collection[index]
    if (isPlainObject(byIndex)) return byIndex
    return {}
  }
  if (!isPlainObject(collection)) return {}
  const idKey = String(id || '').trim()
  if (idKey && isPlainObject(collection[idKey])) return collection[idKey]
  const indexKey = String(index)
  if (isPlainObject(collection[indexKey])) return collection[indexKey]
  const oneBasedIndexKey = String(index + 1)
  if (isPlainObject(collection[oneBasedIndexKey])) return collection[oneBasedIndexKey]
  return {}
}

function localizeCollectionItems(
  items: unknown,
  collection: unknown,
  fields: string[],
): unknown[] {
  if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : []
  return items.map((item, index) => {
    if (!isPlainObject(item)) return item
    const entry = getCollectionEntry(collection, item?.id, index)
    if (!Object.keys(entry).length) return item
    const next = { ...item }
    fields.forEach((field) => {
      next[field] = pickTranslatedText(entry, field, next[field])
    })
    return next
  })
}

function getLanguageMap(source: TextRecordByLanguage, language: unknown): TextRecord | null {
  const key = normalizeLanguageKey(language)
  if (!key || key === 'en') return null
  if (isPlainObject(source[key])) return source[key]
  const base = key.split('-')[0]
  if (base && isPlainObject(source[base])) return source[base]
  return null
}

function escapeRegExp(value: unknown): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function protectPublicCopyTerms(value: unknown): { text: string, placeholders: PublicCopyPlaceholder[] } {
  let text = String(value || '')
  const placeholders: PublicCopyPlaceholder[] = []
  PUBLIC_COPY_PROTECTED_TERMS.forEach((term) => {
    const pattern = new RegExp(escapeRegExp(term), 'g')
    text = text.replace(pattern, (match) => {
      const token = `__BUSINESS_OS_PUBLIC_TERM_${placeholders.length}__`
      placeholders.push([token, match])
      return token
    })
  })
  return { text, placeholders }
}

function restorePublicCopyTerms(value: unknown, placeholders: PublicCopyPlaceholder[]): string {
  return placeholders.reduce((text, [token, original]) => text.replaceAll(token, original), String(value || ''))
}

export function localizePortalFaqText(value: unknown, language: unknown): unknown {
  const raw = normalizeText(value)
  const key = normalizeLanguageKey(language)
  if (!raw || !key || key === 'en') return value

  const exactMap = getLanguageMap(DEFAULT_FAQ_TEXT_BY_LANGUAGE, language)
  const exact = exactMap?.[raw]
  if (normalizeText(exact)) return exact

  const vocabulary = getLanguageMap(FAQ_VOCABULARY_BY_LANGUAGE, language)
  if (!vocabulary) return value

  const protectedCopy = protectPublicCopyTerms(value)
  let localized = protectedCopy.text
  const entries = Object.entries(vocabulary)
    .filter(([term, translation]) => normalizeText(term) && normalizeText(translation))
    .sort((left, right) => right[0].length - left[0].length)

  entries.forEach(([term, translation]) => {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi')
    localized = localized.replace(pattern, translation)
  })

  return restorePublicCopyTerms(localized, protectedCopy.placeholders)
}

function localizeFaqItems(items: unknown, collection: unknown, language: unknown): unknown[] {
  if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : []
  const localized = localizeCollectionItems(items, collection, ['question', 'answer'])
  return localized.map((item, index) => {
    if (!isPlainObject(item)) return item
    const entry = getCollectionEntry(collection, item?.id, index)
    const next = { ...item }
    ;['question', 'answer'].forEach((field) => {
      const explicit = normalizeText(pickTranslatedText(entry, field, ''))
      if (!explicit) next[field] = localizePortalFaqText(next[field], language)
    })
    return next
  })
}

export function localizePortalConfig(config: unknown, language: unknown): PlainRecord {
  const source = isPlainObject(config) ? config : {}
  const translations = normalizePortalTranslations(source.translations)
  const langBlock = getLanguageBlock(translations, language)

  const next: PlainRecord = { ...source, translations }
  TRANSLATABLE_CONFIG_FIELDS.forEach((field) => {
    next[field] = pickDefaultFirstPartyText(language, field, pickTranslatedText(langBlock, field, next[field]))
  })

  if (isPlainObject(source.linkLabels) && isPlainObject(langBlock.linkLabels)) {
    const nextLinkLabels: PlainRecord = { ...source.linkLabels }
    Object.keys(nextLinkLabels).forEach((key) => {
      nextLinkLabels[key] = pickTranslatedText(langBlock.linkLabels, key, nextLinkLabels[key])
    })
    next.linkLabels = nextLinkLabels
  }

  next.aboutBlocks = localizeCollectionItems(source.aboutBlocks, langBlock.aboutBlocks, ['title', 'body'])
  next.promoItems = localizeCollectionItems(source.promoItems, langBlock.promoItems, ['eyebrow', 'title', 'subtitle', 'body', 'ctaLabel'])
  next.faqItems = localizeFaqItems(source.faqItems, langBlock.faqItems, language)

  return next
}

function getProductTranslationBlock(product: unknown, language: unknown, portalTranslations: unknown, index: number): PlainRecord {
  const source = isPlainObject(product) ? product : {}
  const productTranslations = normalizePortalTranslations(source.translations || source.i18n || source.localized)
  const productBlock = getLanguageBlock(productTranslations, language)
  if (Object.keys(productBlock).length) return productBlock

  const langBlock = getLanguageBlock(portalTranslations, language)
  const products = langBlock.products || langBlock.catalogProducts || langBlock.catalog
  return getCollectionEntry(products, source.id, index)
}

export function localizePortalProduct<TProduct>(product: TProduct, language: unknown, portalTranslations?: unknown, index = 0): TProduct | PlainRecord {
  if (!isPlainObject(product)) return product
  const block = getProductTranslationBlock(product, language, portalTranslations, index)
  if (!Object.keys(block).length) return product
  const next: PlainRecord = { ...product }
  PRODUCT_TRANSLATABLE_FIELDS.forEach((field) => {
    next[field] = pickTranslatedText(block, field, next[field])
  })
  return next
}

export function localizePortalProducts<TProduct>(products: TProduct[], language: unknown, portalTranslations?: unknown): TProduct[] {
  if (!Array.isArray(products) || !products.length) return Array.isArray(products) ? products : []
  return products.map((product, index) => localizePortalProduct(product, language, portalTranslations, index) as TProduct)
}
