// Server-side English/Khmer labels for every Telegram message (S4-8).
//
// WHY A WORKER-SIDE DICTIONARY AND NOT THE LANGUAGE PACKS
// -------------------------------------------------------
// frontend/src/lang/{en,km}.json are bundled into the PWA and never reach the
// Worker: they are ~4k keys of UI copy, they are read through AppContext's
// React runtime, and importing them here would (a) drag the whole pack into
// every Worker isolate for the ~60 lines Telegram actually sends and (b) cross
// the package boundary that keeps `cloudflare/` deployable on its own. So the
// two labels per line live HERE, in a small typed table:
//
//   * `keyof typeof LABELS` derives the key union, so a typo in a call site is
//     a `tsc --noEmit` error -- stronger than the packs, where a missing key
//     silently renders the raw key (see langKeyIntegrity.test.ts).
//   * The table carries ONLY lines Telegram sends. It is not a second copy of
//     the pack and must never grow into one.
//   * The Khmer spellings are COPIED from km.json, not invented, and
//     scripts/test-telegram-bilingual-pure.cjs re-checks every entry against
//     km.json on each run. That is the guard against a second, divergent
//     spelling of a retail term being born on the server side -- the same job
//     the frontend's pack-parity checks do for the app.
//
// MESSAGE SHAPE
// -------------
// One value, two labels: `Cashier / អ្នកគិតប្រាក់: Za`. The alternative --
// sending the whole message twice, once per language -- doubles every alert in
// a phone-width chat for no gain, because the VALUES (money, receipt numbers,
// product names, dates) are not translatable in the first place. Only the
// labels are, so only the labels are doubled. ` / ` is the bilingual-signage
// separator used on Cambodian shopfronts and appears nowhere else on the label
// side of a line (dates put their slashes in the value).
//
// HOW ROUTES GET IT FOR FREE
// --------------------------
// Two call sites build their lines inline as English strings
// (routes/sales.ts's status change, routes/fees.ts's fee), and those files
// belong to other lanes. So `localizeTelegramLine` works on the COMPOSED line:
// it splits at the first ': ', looks the English label up, and rewrites it.
// A label it does not know passes through untouched, so nothing can break by
// adding a line; the pure test pins that every label the routes actually emit
// IS known.
//
// FOR S4-7 (the shift report) AND ANY LATER MESSAGE
// -------------------------------------------------
// Nothing to adopt and nothing to wire. Send the shift report through
// `sendTelegramEvent` and write its lines as plain `English label: value` --
// every label already in LABELS comes out bilingual on its own. For a line
// this table has no word for (`Opening float`, `Cash counted`, `Variance`),
// add ONE entry here with the Khmer COPIED FROM km.json, and
// scripts/test-telegram-bilingual-pure.cjs will (a) check that Khmer against
// the pack and (b) fail if a new `Xxx: ` line ships without an entry. Prefer
// `labeled('key', value)` over a raw string when composing new code -- it is
// the same output, checked by tsc.

/** Separator between the two labels of one line. */
export const BILINGUAL_SEPARATOR = ' / '

type LabelEntry = {
  en: string
  km: string
  /**
   * Opt in to translating enumerated words INSIDE the value ('unpaid',
   * 'receipt(s)', 'all branches', a sale status...). Off by default because
   * most values are free text -- a product named "None" must not be rewritten.
   */
  localizeValue?: true
}

// Every label any Telegram message emits, and nothing else.
const LABELS = {
  // --- receipt summary (formatSaleTelegramLines) ---
  status: { en: 'Status', km: 'ស្ថានភាព', localizeValue: true },
  date: { en: 'Date', km: 'កាលបរិច្ឆេទ' },
  inv: { en: 'INV', km: 'លេខវិក្កយបត្រ' },
  receipt: { en: 'Receipt', km: 'វិក្កយបត្រ' },
  cashier: { en: 'Cashier', km: 'អ្នកគិតប្រាក់', localizeValue: true },
  customer: { en: 'Customer', km: 'អតិថិជន' },
  tel: { en: 'Tel', km: 'ទូរស័ព្ទ' },
  branch: { en: 'Branch', km: 'សាខា' },
  deliveryService: { en: 'Delivery service', km: 'សេវាដឹកជញ្ជូន', localizeValue: true },
  deliveryDriver: { en: 'Delivery driver', km: 'អ្នកដឹកជញ្ជូន' },
  total: { en: 'Total', km: 'សរុប', localizeValue: true },
  subtotal: { en: 'Subtotal', km: 'សរុបរង' },
  discount: { en: 'Discount', km: 'បញ្ចុះតម្លៃ' },
  tax: { en: 'Tax', km: 'ពន្ធ' },
  netTotal: { en: 'Net Total', km: 'សរុបចុងក្រោយ' },
  paid: { en: 'Paid', km: 'បានបង់', localizeValue: true },
  change: { en: 'Change', km: 'ប្រាក់អាប់' },
  lostFee: { en: 'Lost fee', km: 'ថ្លៃដែលបាត់បង់' },

  // --- stock change / transfer ---
  product: { en: 'Product', km: 'ផលិតផល' },
  // Deliberately NOT "Change": the receipt summary already uses that word for
  // money handed back (ប្រាក់អាប់). One English word, two Khmer words, and a
  // line-level localizer cannot tell them apart -- so the stock delta gets its
  // own label instead of an ambiguous shared one.
  stockChange: { en: 'Stock change', km: 'ការផ្លាស់ប្ដូរស្តុក' },
  quantity: { en: 'Quantity', km: 'បរិមាណ' },
  reason: { en: 'Reason', km: 'មូលហេតុ' },
  lot: { en: 'Lot', km: 'បាច់' },
  onHand: { en: 'On hand', km: 'នៅក្នុងស្តុក', localizeValue: true },
  // S4-6's slot. A route that knows who made a change adds ONE line --
  // `by ? \`By: ${by}\` : ''` -- and it ships bilingual with no change here.
  // routes/sales.ts's status change cannot fill it yet (it writes no
  // action_history, so a status move between two completed-ish statuses
  // records nobody); the label is ready for the lane adding that storage.
  by: { en: 'By', km: 'ដោយ' },
  from: { en: 'From', km: 'ពី' },
  to: { en: 'To', km: 'ទៅ' },
  totalMoved: { en: 'Total moved', km: 'បានផ្ទេរសរុប', localizeValue: true },
  note: { en: 'Note', km: 'កំណត់ចំណាំ' },

  // --- returns ---
  ret: { en: 'RET', km: 'លេខប្រគល់មកវិញ' },
  sret: { en: 'SRET', km: 'លេខប្រគល់ទៅអ្នកផ្គត់ផ្គង់' },
  supplier: { en: 'Supplier', km: 'អ្នកផ្គត់ផ្គង់' },
  type: { en: 'Type', km: 'ប្រភេទ', localizeValue: true },
  settlement: { en: 'Settlement', km: 'វិធីដោះស្រាយ', localizeValue: true },
  refund: { en: 'Refund', km: 'សងប្រាក់', localizeValue: true },
  supplierPays: { en: 'Supplier pays', km: 'អ្នកផ្គត់ផ្គង់សង' },
  loss: { en: 'Loss', km: 'ខាតបង់' },

  // --- fees ---
  amount: { en: 'Amount', km: 'ចំនួនទឹកប្រាក់' },
  feeLabel: { en: 'Label', km: 'ស្លាក' },

  // --- reports ---
  sales: { en: 'Sales', km: 'ការលក់', localizeValue: true },
  fees: { en: 'Fees', km: 'ចំណាយ', localizeValue: true },
  stockIn: { en: 'Stock in', km: 'ស្តុកចូល', localizeValue: true },
  stockOut: { en: 'Stock out', km: 'ស្តុកចេញ', localizeValue: true },
  products: { en: 'Products', km: 'ផលិតផល' },
  activeProducts: { en: 'Active products', km: 'ផលិតផលសកម្ម' },
  unitsOnHand: { en: 'Units on hand', km: 'ឯកតាក្នុងស្តុក' },
  lowStock: { en: 'Low stock', km: 'ស្តុកទាប', localizeValue: true },
  outOfStock: { en: 'Out of stock', km: 'អស់ស្តុក', localizeValue: true },
  cashiers: { en: 'Cashiers', km: 'អ្នកគិតប្រាក់' },
  latestReceipts: { en: 'Latest receipts', km: 'វិក្កយបត្រចុងក្រោយ' },
  yourChatId: { en: 'This chat id', km: 'លេខឆាតនេះ' },
} as const satisfies Record<string, LabelEntry>

export type TelegramLabelKey = keyof typeof LABELS
/** Exported for scripts/test-telegram-bilingual-pure.cjs (glossary check). */
export const TELEGRAM_LABELS: Record<string, LabelEntry> = LABELS

/** Message headings. Emoji stays in front of BOTH languages. */
const HEADINGS = {
  '🛍️ Sale recorded': 'បានកត់ត្រាការលក់',
  '🧾 Receipt status updated': 'ស្ថានភាពបង្កាន់ដៃបានផ្លាស់ប្ដូរ',
  '💸 Fee recorded': 'បានកត់ត្រាចំណាយ',
  '📥 Stock in': 'ស្តុកចូល',
  '📤 Stock out': 'ស្តុកចេញ',
  '🔁 Stock transferred': 'បានផ្ទេរស្តុក',
  '↩️ Return recorded': 'បានកត់ត្រាការប្រគល់មកវិញ',
  '📤 Supplier return recorded': 'បានកត់ត្រាការប្រគល់ទៅអ្នកផ្គត់ផ្គង់',
} as const
/** Exported for the pure test. */
export const TELEGRAM_HEADINGS: Record<string, string> = HEADINGS

// Enumerated words that appear INSIDE a value. Applied in one pass (longest
// first) only to labels flagged `localizeValue`, so free-text values -- product
// names, customer names, notes -- are never touched.
const VALUE_PHRASES: Record<string, string> = {
  'all branches': 'គ្រប់សាខា',
  'receipt(s)': 'វិក្កយបត្រ',
  'record(s)': 'កំណត់ត្រា',
  'movement(s)': 'ចលនាស្តុក',
  'product(s)': 'ផលិតផល',
  'item(s)': 'មុខទំនិញ',
  'unit(s)': 'ឯកតា',
  'shop paid': 'ហាងបានបង់',
  'No cashier': 'គ្មានអ្នកគិតប្រាក់',
  Unknown: 'មិនស្គាល់',
  unpaid: 'មិនទាន់បង់',
  none: 'គ្មាន',
  // sale statuses (lib/salesStatus.ts VALID_SALE_STATUSES, underscores already
  // replaced with spaces by the callers)
  'awaiting payment': 'រង់ចាំការទូទាត់',
  'awaiting delivery': 'រង់ចាំការដឹកជញ្ជូន',
  'partial return': 'ត្រឡប់ដោយផ្នែក',
  completed: 'បានបញ្ចប់',
  cancelled: 'បានបោះបង់',
  returned: 'បានប្រគល់មកវិញ',
  // return stock actions (lib/returnsStock.ts ReturnStockAction)
  restock: 'បញ្ចូលស្តុកវិញ',
  damaged: 'ខូចខាត',
  // return settlements
  refund: 'សងប្រាក់',
  replacement: 'ប្តូរទំនិញ',
  credit: 'ឥណទាន',
  writeoff: 'គ្មានសំណង',
}
/** Exported for the pure test. */
export const TELEGRAM_VALUE_PHRASES = VALUE_PHRASES

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Longest-first alternation so 'awaiting payment' wins over 'payment', and a
// single pass so an inserted Khmer replacement can never be re-matched.
const VALUE_PHRASE_RE = new RegExp(
  `(?<![A-Za-z])(${Object.keys(VALUE_PHRASES).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})(?![A-Za-z])`,
  'g',
)

const BY_ENGLISH = new Map<string, LabelEntry>(Object.values(LABELS).map((entry) => [entry.en, entry as LabelEntry]))

/** `'Cashier / អ្នកគិតប្រាក់'` -- the label pair on its own. */
export function label(key: TelegramLabelKey): string {
  const entry = LABELS[key]
  return `${entry.en}${BILINGUAL_SEPARATOR}${entry.km}`
}

/** `'Cashier / អ្នកគិតប្រាក់: Za'` -- a whole bilingual line. */
export function labeled(key: TelegramLabelKey, value: unknown): string {
  return `${label(key)}: ${String(value ?? '')}`
}

/** Ad-hoc pair for copy that is not a field label (help text, notices). */
export function bi(en: string, km: string): string {
  return `${en}${BILINGUAL_SEPARATOR}${km}`
}

/** Translate the enumerated words inside one value. */
export function localizeTelegramValue(value: string): string {
  return value.replace(VALUE_PHRASE_RE, (match) => `${match}${BILINGUAL_SEPARATOR}${VALUE_PHRASES[match]}`)
}

/**
 * Make one composed line bilingual. `'Cashier: Za'` -> `'Cashier /
 * អ្នកគិតប្រាក់: Za'`. Lines with no known label -- item bullets, which carry
 * only a product name and arithmetic -- are returned unchanged, except for the
 * `+ N more item(s)` continuation, whose only word IS a counter.
 */
export function localizeTelegramLine(line: string): string {
  const text = String(line ?? '')
  if (!text) return text
  if (text.startsWith('+ ')) return localizeTelegramValue(text)
  const split = text.indexOf(': ')
  if (split <= 0) return text
  const entry = BY_ENGLISH.get(text.slice(0, split))
  if (!entry) return text
  let value = text.slice(split + 2)
  // routes/fees.ts puts a bare ISO `fee_date` on its Date line while every
  // other message uses mm/dd/yyyy. Normalising the one unambiguous shape here
  // gives the whole feed ONE date convention without editing that route.
  if (entry.en === 'Date') value = value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2/$3/$1')
  if (entry.localizeValue) value = localizeTelegramValue(value)
  return `${entry.en}${BILINGUAL_SEPARATOR}${entry.km}: ${value}`
}

/** Make a message heading bilingual, keeping its emoji in front. */
export function localizeTelegramHeading(heading: string): string {
  const text = String(heading ?? '').trim()
  const km = HEADINGS[text as keyof typeof HEADINGS]
  return km ? `${text}${BILINGUAL_SEPARATOR}${km}` : text
}

// ---------------------------------------------------------------------------
// Command reference (S4-9)
// ---------------------------------------------------------------------------
// postTelegram sends no parse_mode, so this is PLAIN TEXT: no HTML, no
// Markdown. Structure comes from emoji anchors, a horizontal rule and a
// hanging indent -- all of which survive Telegram's phone-width wrapping,
// which `*bold*` would not (it would render as literal asterisks).

const RULE = '━━━━━━━━━━━━━━━━━━'

type CommandDoc = { command: string; icon: string; en: string; km: string; example: string; dated?: true }

/** The shipped command set, in the order the reference lists them. */
export const TELEGRAM_COMMANDS: readonly CommandDoc[] = [
  {
    command: '/report', icon: '📊',
    en: 'Sales, expenses, stock + total per cashier',
    km: 'ការលក់ ចំណាយ ស្តុក និងសរុបតាមអ្នកគិតប្រាក់',
    example: '/report 09/01/2026', dated: true,
  },
  {
    command: '/sales', icon: '🛍️',
    en: 'Receipts with items, prices, cashier',
    km: 'វិក្កយបត្រ ជាមួយមុខទំនិញ តម្លៃ អ្នកគិតប្រាក់',
    example: '/sales yesterday', dated: true,
  },
  {
    command: '/fees', icon: '💸',
    en: 'Expenses recorded on a day',
    km: 'ចំណាយដែលបានកត់ត្រាក្នុងមួយថ្ងៃ',
    example: '/fees 2026-09-01', dated: true,
  },
  {
    command: '/stock', icon: '📦',
    en: 'Products at or below their low-stock alert',
    km: 'ផលិតផលដែលស្តុកទាប ឬអស់ស្តុក',
    example: '/stock',
  },
  {
    command: '/inventory', icon: '🏷️',
    en: 'Active products, units on hand, health',
    km: 'ផលិតផលសកម្ម ឯកតាក្នុងស្តុក សុខភាពស្តុក',
    example: '/inventory',
  },
  {
    command: '/help', icon: '❓',
    en: 'This list',
    km: 'បញ្ជីនេះ',
    example: '/help',
  },
]

/**
 * The designed, bilingual command reference. Pure, so
 * scripts/test-telegram-bilingual-pure.cjs pins it without a bot token.
 */
export function telegramCommandReference(): string {
  const lines = [
    '🤖 Business OS — Reports',
    '     របាយការណ៍ Business OS',
    '',
    // Full sentences get a line each: a `/`-joined sentence pair is wider than
    // a phone-width Telegram bubble and wraps into a mush. Field LABELS are
    // short enough to share a line, and do.
    'Type one of these in this chat.',
    'សរសេរពាក្យបញ្ជាណាមួយក្នុងឆាតនេះ។',
  ]
  for (const doc of TELEGRAM_COMMANDS) {
    lines.push(
      RULE,
      `${doc.icon} ${doc.command}${doc.dated ? '  [date]' : ''}`,
      `     ${doc.en}`,
      `     ${doc.km}`,
      `     ▸ ${doc.example}`,
    )
  }
  lines.push(
    RULE,
    `🗓 ${bi('Date', 'កាលបរិច្ឆេទ')}: mm/dd/yyyy · yyyy-mm-dd`,
    `     today · yesterday · ${bi('blank = today', 'ទទេ = ថ្ងៃនេះ')}`,
    '🔒 Only this shop chat receives data.',
    '     មានតែឆាតហាងនេះទេ ដែលទទួលទិន្នន័យ។',
  )
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Command arguments
// ---------------------------------------------------------------------------

/**
 * The project's date convention is mm/dd/yyyy (24-hour clock) everywhere --
 * consistency-audit.md, and formatBusinessDateTime in lib/telegram.ts. So the
 * bot accepts mm/dd/yyyy, plus ISO yyyy-mm-dd (what D1 stores, and the only
 * unambiguous typed form), plus `today`/`yesterday`. dd-mm-yyyy is NOT
 * accepted: 05-09-2026 cannot be told apart from mm-dd-yyyy, and silently
 * guessing would misfile a day's revenue.
 */
export type ParsedReportDate = { ok: true; date: string } | { ok: false; message: string }

const shiftDays = (isoDate: string, days: number): string => {
  const base = Date.parse(`${isoDate}T00:00:00Z`)
  if (!Number.isFinite(base)) return isoDate
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10)
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

export function parseReportDate(argument: string | undefined, today: string): ParsedReportDate {
  const raw = String(argument ?? '').trim().toLowerCase()
  if (!raw || raw === 'today') return { ok: true, date: today }
  if (raw === 'yesterday') return { ok: true, date: shiftDays(today, -1) }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso && isRealDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))) return { ok: true, date: raw }

  const slashed = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashed) {
    const [month, day, year] = [Number(slashed[1]), Number(slashed[2]), Number(slashed[3])]
    if (isRealDate(year, month, day)) {
      return { ok: true, date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
    }
  }

  return {
    ok: false,
    message: [
      `⚠️ ${bi(`I could not read the date "${raw.slice(0, 30)}".`, `មិនអាចអានកាលបរិច្ឆេទ "${raw.slice(0, 30)}" បានទេ។`)}`,
      '',
      bi('Use one of these:', 'សូមប្រើទម្រង់ណាមួយ៖'),
      `  ▸ mm/dd/yyyy   — ${bi('e.g.', 'ឧ.')} 09/01/2026`,
      `  ▸ yyyy-mm-dd   — ${bi('e.g.', 'ឧ.')} 2026-09-01`,
      `  ▸ today ${BILINGUAL_SEPARATOR.trim()} yesterday`,
      `  ▸ ${bi('nothing at all = today', 'មិនដាក់អ្វីសោះ = ថ្ងៃនេះ')}`,
    ].join('\n'),
  }
}

/**
 * A chat that is not on the allow-list gets THIS and nothing else: no revenue,
 * no receipt, no product. It names the requesting chat's own id -- which
 * Telegram already tells that chat's members through any bot -- so the owner
 * can paste it into Settings, and nothing about the shop.
 */
export function telegramUnauthorizedReply(chatId: string): string {
  return [
    `🔒 ${bi('This chat is not approved for Business OS reports.', 'ឆាតនេះមិនត្រូវបានអនុញ្ញាតឱ្យទទួលរបាយការណ៍ Business OS ទេ។')}`,
    '',
    bi('The shop owner can approve it in Settings → Telegram.', 'ម្ចាស់ហាងអាចអនុញ្ញាតវានៅ Settings → Telegram។'),
    labeled('yourChatId', chatId),
  ].join('\n')
}
