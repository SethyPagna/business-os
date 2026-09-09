import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const detail = read('src/components/sales/SaleDetailModal.tsx')
const workflow = read('src/components/sales/SaleStatusWorkflow.tsx')
const list = read('src/components/sales/SalesListSurface.tsx')
const sales = read('src/components/sales/Sales.tsx')

// U22: compact, readable identity keeps an explicit copy button. On phones,
// receipt/time/branch/cashier share the primary metadata row; wider screens
// retain the complete business date/time below.
const header = detail.slice(detail.indexOf('Compact record identity:'), detail.indexOf('modal-scroll'))
assert.ok(header.length > 300, 'sale detail header is identifiable')
const detailPrimaryStart = header.indexOf('data-sale-detail-primary-meta=""')
const detailPrimary = header.slice(detailPrimaryStart, header.indexOf('</div>', detailPrimaryStart))
const detailReceiptAt = detailPrimary.indexOf('<CopyableId')
const detailTimeAt = detailPrimary.indexOf('{fmtTime(sale.created_at)}')
const detailBranchAt = detailPrimary.indexOf('{sale.branch_name ?')
const detailCashierAt = detailPrimary.indexOf('{sale.cashier_name ?')
assert.ok(detailReceiptAt >= 0 && detailReceiptAt < detailTimeAt && detailTimeAt < detailBranchAt && detailBranchAt < detailCashierAt, 'detail phone metadata order is receipt, time, branch, cashier')
assert.equal((detailPrimary.match(/className="sm:hidden"/g) || []).length >= 3, true, 'time, branch and cashier additions are phone-only')
assert.match(header, /className="mt-1 hidden text-xs text-gray-400 sm:block">\{fmtTime\(sale\.created_at\)}/, 'desktop keeps the full timestamp beneath the receipt')
assert.match(header, /<StatusBadge status=\{currentStatus\} t=\{t\} \/>/, 'status remains visible beside the compact identity')
assert.match(header, /aria-label=\{t\('close'\) \|\| 'Close'\}/, 'the top close remains keyboard and screen-reader named')
assert.doesNotMatch(header, /onReturn\(sale\)|onPrint\(sale\)/, 'Return and Print stay out of the compact header')

// Phone contact metadata is one line: customer phone, then the delivery
// contact's name/phone with an accessible Delivery name and no visible Driver
// label. The labelled table rows remain desktop-only.
const mobileContactStart = detail.indexOf('data-sale-detail-mobile-contact=""')
const mobileContact = detail.slice(mobileContactStart, detail.indexOf('</div>', mobileContactStart))
assert.match(mobileContact, /customerIsAnonymous[\s\S]*?sale\.customer_phone[\s\S]*?aria-hidden="true">\|<\/span>[\s\S]*?translateOr\('delivery', 'Delivery'/)
assert.match(mobileContact, /\[deliveryDriverName, deliveryDriverPhone\]\.filter\(Boolean\)\.join\(' · '\)/)
assert.doesNotMatch(mobileContact, /translateOr\('driver'|translateOr\('driver_phone'/, 'the phone contact row shows the delivery values directly')
assert.match(detail, /className="hidden sm:block"><DetailRow label=\{t\('cashier'\)/, 'the labelled cashier row remains on wider screens')
assert.match(detail, /className="hidden sm:block"><DetailRow label=\{t\('branch'\)/, 'the labelled branch row remains on wider screens')
assert.match(detail, /className="hidden sm:block"><DetailRow label=\{translateOr\('driver'/, 'the labelled driver row remains on wider screens')
assert.match(detail, /<div className="hidden sm:block"><DetailRow label=\{t\('phone'\)/, 'the customer phone is not duplicated below the compact phone row')

// F72 override: the sale exposes one customer mutation entry. Membership is
// read-only in the detail card and is edited, with its own Contacts scope, in
// the unified Edit customer flow.
const customerCardStart = detail.indexOf("<SectionCard title={t('customer')")
const customerCard = detail.slice(customerCardStart, detail.indexOf('</SectionCard>', customerCardStart))
assert.match(customerCard, /t\('sale_customer_edit_entry'\) \|\| 'Edit customer'/)
assert.match(customerCard, /<DetailRow label=\{t\('membership'\)[\s\S]*?value=\{sale\.customer_membership_number\} mono/, 'the stored membership remains readable in the detail card')
assert.doesNotMatch(sales, /onAttachMembership=/, 'the standalone membership mutation is no longer mounted from Sales')
assert.match(sales, /onCustomerAction=\{canChangeSaleCustomer \? \(sale\) => \{ void openSaleCustomerEdit/, 'the one Edit customer entry remains gated by the sales customer grant')

// Three ordinary destination statuses share one row at 375px. Review keeps
// Back and Update together instead of parking the secondary action above it.
assert.match(workflow, /data-sale-status-destinations="" className="grid grid-cols-3 gap-2"/)
assert.doesNotMatch(workflow, /Choose destination status/)
assert.match(workflow, /\.filter\(\(status\) => !\['partial_return', 'returned', currentStatus\]\.includes\(status\)\)/)
const reviewActions = workflow.slice(workflow.indexOf('data-sale-status-review-actions=""'))
assert.match(reviewActions, /className="flex items-stretch gap-2"/)
assert.match(reviewActions, /step === 'review' \? \(t\('back'\) \|\| 'Back'\) : \(t\('cancel'\) \|\| 'Cancel'\)/)
assert.match(reviewActions, /step === 'review'[\s\S]*?t\('update'\) \|\| 'Update'/)
assert.match(reviewActions, /disabled=\{saving \|\| confirmDisabled \|\| selectedStatus === currentStatus\}/, 'existing status safety gates remain on Update')

// Records is the final body action immediately above the footer. The footer is
// a single mobile row, and mutation/return permission gates remain intact.
const recordsAt = detail.indexOf('data-sale-records-action=""')
const footerAt = detail.indexOf('data-sale-detail-footer-actions=""')
assert.ok(recordsAt > detail.indexOf('<SaleStatusWorkflow') && footerAt > recordsAt, 'Records follows status and immediately precedes the footer actions')
const betweenRecordsAndFooter = detail.slice(recordsAt, footerAt)
assert.doesNotMatch(betweenRecordsAndFooter, /<SectionCard|<SaleStatusWorkflow/, 'no body section follows Records')
const footer = detail.slice(footerAt, detail.indexOf('The review step.', footerAt))
assert.match(footer, /className="flex items-stretch gap-2/)
assert.match(footer, /\{onReturn \? \([\s\S]*?onReturn\(sale\)/, 'Return remains hidden when its permission-gated callback is absent')
assert.match(footer, /\{onPrint \? \([\s\S]*?onPrint\(sale\)/, 'Print remains hidden when its callback is absent')
assert.match(footer, /onClick=\{closeGuard\.requestClose\}[\s\S]*?\{t\('close'\) \|\| 'Close'\}/)

// U15: the collapsed card's primary metadata row reads receipt | time |
// branch | cashier. Long ids may still wrap, and the cashier is emphasized.
const primaryStart = list.indexOf('data-sales-card-primary-meta=""')
const primaryMeta = list.slice(primaryStart, list.indexOf('</div>', primaryStart))
const receiptAt = primaryMeta.indexOf('{sale.receipt_number}')
const timeAt = primaryMeta.indexOf('{fmtTime(sale.created_at)}')
const branchAt = primaryMeta.indexOf('{branchLabel ?')
const cashierAt = primaryMeta.indexOf('{sale.cashier_name ?')
assert.ok(receiptAt >= 0 && receiptAt < timeAt && timeAt < branchAt && branchAt < cashierAt, 'collapsed metadata order is receipt, time, branch, cashier')
assert.equal((primaryMeta.match(/<span aria-hidden="true">\|<\/span>/g) || []).length, 3, 'the four facts use visible pipe separators')
assert.match(primaryMeta, /whitespace-normal break-all/, 'the complete receipt id remains readable instead of ellipsized')
assert.match(primaryMeta, /font-bold text-gray-700 dark:text-gray-200[\s\S]*?aria-label=\{`\$\{t\('cashier'\)/, 'cashier is bold and explicitly identified to assistive technology')

const contactMetaStart = list.indexOf("{/* Y17: customer (name + phone) leads the meta line;")
const contactMeta = list.slice(contactMetaStart, list.indexOf('</div>', contactMetaStart))
assert.match(contactMeta, /sale\.customer_phone[\s\S]*?aria-hidden="true">\|<\/span>[\s\S]*?aria-label=\{`\$\{t\('delivery'\)/, 'phone and delivery share the compact contact row')
assert.doesNotMatch(contactMeta, /\{t\('driver'\)\}:/, 'the driver name is shown directly without a visible Driver prefix')

// F75 authority must survive this presentation-only edit.
assert.match(list, /import \{ useApp as useAppHook \} from '\.\.\/\.\.\/AppContext\.tsx'/)
assert.match(list, /const useApp = useAppHook as unknown as \(\) => \{ can:/)
assert.match(list, /selectionModeActive = selectionModeActive && can\('sales', 'bulk'\)/, 'phone/desktop selection stays hidden without bulk authority')

console.log('PASS mobile Sales detail and collapsed-card composition')
