import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const detail = read('src/components/sales/SaleDetailModal.tsx')
const workflow = read('src/components/sales/SaleStatusWorkflow.tsx')
const list = read('src/components/sales/SalesListSurface.tsx')
const sales = read('src/components/sales/Sales.tsx')

// U14: compact, readable identity keeps an explicit copy button. The status
// shares its leading row and the complete business date/time stays below.
const header = detail.slice(detail.indexOf('Compact record identity:'), detail.indexOf('modal-scroll'))
assert.ok(header.length > 300, 'sale detail header is identifiable')
assert.match(header, /<CopyableId[\s\S]*?copy_receipt_number[\s\S]*?<StatusBadge[\s\S]*?fmtTime\(sale\.created_at\)/)
assert.match(header, /aria-label=\{t\('close'\) \|\| 'Close'\}/, 'the top close remains keyboard and screen-reader named')
assert.doesNotMatch(header, /onReturn\(sale\)|onPrint\(sale\)/, 'Return and Print stay out of the compact header')

// U13: permission-gated membership editing occupies the Membership row itself;
// read-only viewers receive the stored value without a dead input.
const membershipStart = detail.indexOf('{onAttachMembership ? (')
const membership = detail.slice(membershipStart, detail.indexOf('</SectionCard>', membershipStart))
assert.match(membership, /data-sale-membership-row=""/)
assert.match(membership, /<label htmlFor="sale-membership-attach" className="sr-only">[\s\S]*?<input[\s\S]*?id="sale-membership-attach"/, 'the merged field remains associated with its accessible label')
assert.match(membership, /onClick=\{handleMembershipAttach\}/)
assert.match(membership, /:\s*\(\s*<DetailRow label=\{t\('membership'\)[\s\S]*?value=\{sale\.customer_membership_number\} mono/, 'without write permission only the stored membership is shown')
assert.match(sales, /onAttachMembership=\{canChangeSaleCustomer \? handleAttachMembership : undefined\}/, 'the existing Sales permission gate remains the callback authority')

// Three ordinary destination statuses share one row at 375px. Review keeps
// Back and Update together instead of parking the secondary action above it.
assert.match(workflow, /data-sale-status-destinations="" className="mt-2 grid grid-cols-3 gap-2"/)
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

console.log('PASS mobile Sales detail and collapsed-card composition')
