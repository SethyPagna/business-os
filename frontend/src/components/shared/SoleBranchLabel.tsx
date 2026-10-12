import Store from 'lucide-react/dist/esm/icons/store.js'

// The one branch there is, shown where its picker used to be. With a single
// active branch the picker has nothing to ask (utils/branchScope.ts
// branchChoiceSettled), but the person still needs to SEE where the stock or
// the sale belongs - the name is read from the branch row, never typed in. Same
// pattern as the receiving form's read-only branch label (ProductForm, stock
// session details): a store icon and the name, a group rather than a control.
export default function SoleBranchLabel({ name, label, className = '' }: { name: string; label: string; className?: string }) {
  const text = `${label}: ${name}`
  return (
    <div role="group" aria-label={text} title={text} data-sole-branch="" className={`flex min-w-0 cursor-default items-center gap-1.5 ${className}`}>
      <Store className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
      {/* A name scrolls, never ellipses (noEllipsisOnNames); detail-scroll-text also carries the Khmer line-height floor. */}
      <span className="detail-scroll-text min-w-0 leading-relaxed">{name}</span>
    </div>
  )
}
