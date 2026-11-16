import Copy from 'lucide-react/dist/esm/icons/copy.js'

// The small "Duplicate" tag on a row whose product record has an unmerged twin: another record with the
// same name and the same real barcode in the same list (productTwinKey in utils/productGrouping.ts decides,
// from rows already loaded -- no read). One shared chip so Products and Inventory, desktop and phone,
// say it the same way. It sits in a line the row already has, so it adds no row height; leading-relaxed
// keeps the Khmer glyphs' room. The tooltip says what to do about it.
export default function UnmergedTwinTag({ label, hint }: { label: string; hint: string }) {
  return (
    <span
      data-unmerged-twin="true"
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-0 text-[10px] font-semibold leading-relaxed text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
      title={hint}
    >
      <Copy className="h-3 w-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  )
}
