import { Suspense, useEffect, useState } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { fmtDateTime24 } from '../../../utils/formatters.ts'
import { lazyRetry } from '../../../utils/lazyImport.ts'
import { LEGAL_PAGE_TITLE_KEY, legalText } from '../legal/legalContent.ts'
import { normalizePortalLanguage, readPublicStorefrontLanguage, storePortalLanguage, type PortalLanguage } from '../portalLanguageOptions.ts'
import { resolveStorefrontCopy } from '../portalLanguagePacks.ts'
import { forgetOrder, readSavedOrders, type SavedOrder } from './orderHistory.ts'
import { formatUsd } from './orderLogic.ts'
import { orderPathFor, type OrderRoute as OrderRouteTarget } from './orderPath.ts'
import { cardClass, iconButtonClass, type CopyFn } from './orderUi.tsx'

const OrderPage = lazyRetry(() => import('./OrderPage.tsx'), 'public-order-page')

// The storefront's order surface (KHQR S7): one order at /order/<token>, or "My orders" at /order. It is its own small page on purpose: an
// order link opens straight to the payment screen without first loading the whole catalogue, and it is the only storefront page that
// carries a private link, so it asks search engines to skip it and browsers not to pass the link on as a referrer.
// It loads only when the address asks for it (PublicCatalogRoot); the catalogue's first paint never carries any of this.

// The shop's name, as the storefront's own header spells it (PublicCatalogPage STOREFRONT_NAME).
const SHOP_NAME = 'Leang Cosmetics'

function useDocumentMarks(language: PortalLanguage, title: string) {
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const before = { lang: html.lang, htmlMark: html.getAttribute('data-public-portal'), bodyMark: body.getAttribute('data-public-portal'), title: document.title }
    // The storefront's own Khmer typesetting (line heights, no tracking) hangs off these two marks.
    html.setAttribute('data-public-portal', 'true')
    body.setAttribute('data-public-portal', 'true')
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    const referrer = document.createElement('meta')
    referrer.name = 'referrer'
    referrer.content = 'no-referrer'
    document.head.append(robots, referrer)
    return () => {
      robots.remove()
      referrer.remove()
      html.lang = before.lang
      if (before.htmlMark === null) html.removeAttribute('data-public-portal'); else html.setAttribute('data-public-portal', before.htmlMark)
      if (before.bodyMark === null) body.removeAttribute('data-public-portal'); else body.setAttribute('data-public-portal', before.bodyMark)
      document.title = before.title
    }
  }, [])
  useEffect(() => { document.documentElement.lang = language }, [language])
  useEffect(() => { document.title = `${title} | ${SHOP_NAME}` }, [title])
}

export default function OrderRoute({ route }: { route: OrderRouteTarget }) {
  const [language, setLanguage] = useState<PortalLanguage>(readPublicStorefrontLanguage)
  const copy: CopyFn = (key, fallback = '', fallbackKm = fallback) => resolveStorefrontCopy(language, (k) => k, key, fallback, fallbackKm)
  const title = route.kind === 'order' ? copy('order_page_title', 'Your order', 'ការបញ្ជាទិញរបស់អ្នក') : copy('order_my_orders', 'My orders', 'ការបញ្ជាទិញរបស់ខ្ញុំ')
  useDocumentMarks(language, title)

  const choose = (next: PortalLanguage) => {
    const normalized = normalizePortalLanguage(next)
    if (!normalized) return
    storePortalLanguage(normalized)
    setLanguage(normalized)
  }
  const languageButton = (value: PortalLanguage, label: string) => (
    <button
      type="button"
      onClick={() => choose(value)}
      aria-pressed={language === value}
      lang={value}
      className={`min-h-11 min-w-11 rounded-full px-3 text-sm font-semibold leading-6 transition ${language === value ? 'bg-slate-900 text-white dark:bg-white dark:text-neutral-950' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/10'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-slate-200 bg-white dark:border-white/10 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2 px-4 py-2">
          <a href="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold leading-6 text-slate-900 dark:text-white">
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span translate="no">{SHOP_NAME}</span>
          </a>
          <div role="group" aria-label={copy('publicTranslation', 'Language', 'ភាសា')} className="flex items-center gap-1">
            {languageButton('km', 'ខ្មែរ')}
            {languageButton('en', 'EN')}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-5">
        {route.kind === 'order'
          ? (
            <Suspense fallback={<p role="status" className="py-16 text-center text-sm text-slate-600 dark:text-neutral-300">{copy('order_loading', 'Loading your order…', 'កំពុងផ្ទុកការបញ្ជាទិញរបស់អ្នក…')}</p>}>
              <OrderPage copy={copy} token={route.token} />
            </Suspense>
          )
          : <MyOrders copy={copy} />}
      </main>
      <footer className="mx-auto max-w-xl px-4 pb-8 text-center text-xs leading-6 text-slate-500 dark:text-neutral-400">
        <a href="/" className="inline-flex min-h-11 items-center underline underline-offset-2">{copy('order_continue_shopping', 'Continue shopping', 'បន្តទិញទំនិញ')}</a>
        {' · '}
        <a href="/?legal=privacy" className="inline-flex min-h-11 items-center underline underline-offset-2">{legalText(language, LEGAL_PAGE_TITLE_KEY.privacy)}</a>
        {' · '}
        <a href="/?legal=terms" className="inline-flex min-h-11 items-center underline underline-offset-2">{legalText(language, LEGAL_PAGE_TITLE_KEY.terms)}</a>
      </footer>
    </div>
  )
}

/** The orders this browser placed or opened, newest first. Only the number, time and total are kept here; the page behind each link reads the rest. */
function MyOrders({ copy }: { copy: CopyFn }) {
  const [orders, setOrders] = useState<SavedOrder[]>(() => readSavedOrders())
  return (
    <section className="space-y-4" aria-labelledby="my-orders-title">
      <h1 id="my-orders-title" className="text-xl font-bold leading-8 text-slate-900 dark:text-white">{copy('order_my_orders', 'My orders', 'ការបញ្ជាទិញរបស់ខ្ញុំ')}</h1>
      {orders.length === 0 ? (
        <p className={`${cardClass} text-sm leading-relaxed text-slate-600 dark:text-neutral-300`}>{copy('order_none_here', 'You have no orders on this device yet. An order you place here will be listed in this page.', 'អ្នកមិនទាន់មានការបញ្ជាទិញនៅលើឧបករណ៍នេះនៅឡើយទេ។ ការបញ្ជាទិញដែលអ្នកធ្វើនៅទីនេះនឹងបង្ហាញនៅក្នុងទំព័រនេះ។')}</p>
      ) : (
        <ul className="space-y-2">
          {orders.map((saved) => (
            <li key={saved.token} className={`${cardClass} flex items-center justify-between gap-3 !p-3`}>
              <a href={orderPathFor(saved.token)} className="min-w-0 flex-1 rounded-xl py-1 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#0369a1] dark:focus-visible:outline-[#fcd34d]">
                <div className="text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100" translate="no">{saved.orderNo}</div>
                <div className="text-xs leading-6 text-slate-500 dark:text-neutral-400" translate="no">{fmtDateTime24(saved.savedAt)}{saved.totalUsd > 0 ? ` · ${formatUsd(saved.totalUsd)}` : ''}</div>
              </a>
              <button
                type="button"
                className={iconButtonClass}
                onClick={() => { forgetOrder(saved.token); setOrders(readSavedOrders()) }}
                aria-label={`${copy('order_forget', 'Remove from this list', 'ដកចេញពីបញ្ជីនេះ')}: ${saved.orderNo}`}
                title={copy('order_forget', 'Remove from this list', 'ដកចេញពីបញ្ជីនេះ')}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-6 text-slate-500 dark:text-neutral-400">{copy('order_forget_note', 'This list is kept on this device only. Removing an order here does not cancel it.', 'បញ្ជីនេះត្រូវបានរក្សាទុកនៅលើឧបករណ៍នេះតែប៉ុណ្ណោះ។ ការដកការបញ្ជាទិញចេញនៅទីនេះមិនបោះបង់វាទេ។')}</p>
    </section>
  )
}
