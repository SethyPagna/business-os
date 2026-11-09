import { useEffect, useRef, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import { formatAmount, formatCountdown, safeDeeplink, secondsUntilExpiry } from './orderLogic.ts'
import { iconButtonClass, primaryButtonClass, type CopyFn } from './orderUi.tsx'

// The payment screen's QR: the KHQR code drawn from the string ABA gave, its amount, a countdown to the moment it stops working, and the two
// ways to pay from a phone (open the ABA app, or save the picture and scan it from another bank's app).
//
// The code is drawn here from `qr_string` with the lazy `qrcode` chunk, so nothing about the payment ever goes to a third party and the
// storefront's first paint never carries the encoder. The white tile is fixed white in dark mode too: a scanner needs dark-on-light.
// The frame header follows the KHQR display guideline (a red band reading KHQR); the official logo file is the owner's to supply.

type Props = {
  copy: CopyFn
  qrString: string
  deeplink: string | null
  amount: number
  currency: string
  expiresAt: string | null
  /** Server clock minus this device's clock, so the countdown is the shop's. */
  skewMs: number
  orderNo: string
  /** Called once, when the countdown reaches zero. */
  onTimeUp?: () => void
}

type Drawn = { status: 'drawing' } | { status: 'ready'; url: string } | { status: 'failed' }

export default function KhqrCard({ copy, qrString, deeplink, amount, currency, expiresAt, skewMs, orderNo, onTimeUp }: Props) {
  const [drawn, setDrawn] = useState<Drawn>({ status: 'drawing' })
  const [now, setNow] = useState(() => Date.now())
  const timeUpSent = useRef(false)

  useEffect(() => {
    let cancelled = false
    setDrawn({ status: 'drawing' })
    void import('qrcode')
      .then(({ toDataURL }) => toDataURL(qrString, { width: 480, margin: 1, errorCorrectionLevel: 'M' }))
      .then((url) => { if (!cancelled) setDrawn({ status: 'ready', url }) })
      .catch(() => { if (!cancelled) setDrawn({ status: 'failed' }) })
    return () => { cancelled = true }
  }, [qrString])

  // A local clock only: counting down costs no request.
  useEffect(() => {
    if (!expiresAt) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  const secondsLeft = secondsUntilExpiry(expiresAt, now, skewMs)
  const timeUp = secondsLeft !== null && secondsLeft <= 0
  useEffect(() => {
    if (timeUp && !timeUpSent.current) {
      timeUpSent.current = true
      onTimeUp?.()
    }
  }, [timeUp, onTimeUp])
  useEffect(() => { timeUpSent.current = false }, [qrString, expiresAt])

  const link = safeDeeplink(deeplink)
  const amountText = formatAmount(amount, currency)
  // Touch devices only: the ABA link means nothing on a desktop browser.
  const touch = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

  return (
    <div className="mx-auto w-full max-w-[19rem] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-white/10">
      <div className="bg-[#e1232e] px-4 py-2 text-center text-sm font-bold tracking-wide text-white" translate="no">KHQR</div>
      <div className="px-4 pb-4 pt-4 text-center">
        {/* Fixed white and a fixed size, so the layout does not jump when the code arrives and a scanner always sees dark on light. */}
        <div className="mx-auto flex aspect-square w-full max-w-[15rem] items-center justify-center rounded-xl bg-white">
          {drawn.status === 'ready' ? (
            <img src={drawn.url} alt={copy('order_qr_alt', 'KHQR code to pay {amount}', 'កូដ KHQR សម្រាប់បង់ {amount}').replace('{amount}', amountText)} className="h-full w-full" width={240} height={240} />
          ) : drawn.status === 'failed' ? (
            <p className="px-3 text-xs leading-relaxed text-slate-700">{copy('order_qr_draw_failed', 'We could not draw the QR here. Open the ABA app, or reload this page.', 'យើងមិនអាចបង្ហាញ QR នៅទីនេះបានទេ។ សូមបើកកម្មវិធី ABA ឬផ្ទុកទំព័រនេះឡើងវិញ។')}</p>
          ) : (
            <p role="status" className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{copy('order_qr_preparing', 'Preparing your QR…', 'កំពុងរៀបចំ QR របស់អ្នក…')}</p>
          )}
        </div>
        <div className="mt-3 text-3xl font-bold leading-tight text-slate-900 dark:text-white" translate="no">{amountText}</div>
        <div className="mt-0.5 text-xs leading-6 text-slate-500 dark:text-neutral-400">
          {copy('order_number_label', 'Order', 'ការបញ្ជាទិញ')} <span translate="no" className="font-semibold text-slate-700 dark:text-neutral-200">{orderNo}</span>
        </div>
        {secondsLeft !== null ? (
          <div role="timer" aria-live="off" className={`mt-2 text-sm font-semibold leading-6 ${timeUp || secondsLeft <= 60 ? 'text-rose-700 dark:text-rose-300' : 'text-slate-700 dark:text-neutral-200'}`}>
            {copy('order_pay_within', 'Pay within {time}', 'សូមបង់ក្នុងរយៈពេល {time}').replace('{time}', formatCountdown(secondsLeft))}
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-center gap-2">
          {link && touch ? (
            <a href={link} className={`${primaryButtonClass} !w-auto flex-1`}>
              <Phone className="h-4 w-4" aria-hidden="true" />
              {copy('order_open_aba', 'Open ABA app', 'បើកកម្មវិធី ABA')}
            </a>
          ) : null}
          {drawn.status === 'ready' ? (
            <a
              href={drawn.url}
              download={`khqr-${orderNo}.png`}
              className={iconButtonClass}
              aria-label={copy('order_save_qr', 'Save QR image', 'រក្សាទុករូបភាព QR')}
              title={copy('order_save_qr', 'Save QR image', 'រក្សាទុករូបភាព QR')}
            >
              <Download className="h-5 w-5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}
