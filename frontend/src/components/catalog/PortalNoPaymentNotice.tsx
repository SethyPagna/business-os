// The one payment line (spec section 4): the shop takes no online payment, so a visitor sends the list instead. It is shown once, on the List page.
// When online payment (KHQR) goes live this line is the only place that changes.

import { PRODUCT_INSET_CLASS } from './portalProductSurfaces.ts'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

export default function PortalNoPaymentNotice({ copy, className = '' }: { copy: CopyFn; className?: string }) {
  return (
    <p role="note" data-portal-no-payment="true" className={`rounded-xl px-3 py-2 text-sm leading-relaxed text-stone-600 dark:text-neutral-300 ${PRODUCT_INSET_CLASS} ${className}`.trim()}>
      {copy('noPaymentLine', 'You cannot pay on this website. Send us your list to order.', 'មិនមានការទូទាត់អនឡាញទេ។ ផ្ញើបញ្ជីមកយើងដើម្បីបញ្ជាទិញ។')}
    </p>
  )
}
