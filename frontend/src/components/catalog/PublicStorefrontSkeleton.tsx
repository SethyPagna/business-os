type PublicStorefrontSkeletonProps = {
  label: string
}

export default function PublicStorefrontSkeleton({ label }: PublicStorefrontSkeletonProps) {
  return (
    <section role="status" aria-busy="true" data-portal-skeleton="true" className="space-y-4 rounded-[36px] p-3 sm:p-5">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="overflow-hidden rounded-[32px] border border-slate-200/80 bg-white dark:border-neutral-700/80 dark:bg-neutral-900">
        <div className="portal-skeleton-block portal-skeleton-pulse h-20 sm:h-28" />
        <div className="px-5 pb-5 sm:px-8 sm:pb-8">
          <div className="-mt-7 flex items-end gap-3 sm:-mt-9 sm:gap-4">
            <div className="portal-skeleton-block h-20 w-20 shrink-0 rounded-full border-4 border-white dark:border-neutral-900" />
            <div className="min-w-0 flex-1 space-y-2 pb-1">
              <div className="portal-skeleton-block portal-skeleton-pulse h-4 w-20 rounded-full" />
              <div className="portal-skeleton-block portal-skeleton-pulse h-8 w-3/4 max-w-xs rounded-lg" />
              <div className="portal-skeleton-block portal-skeleton-pulse h-4 w-1/2 max-w-[12rem] rounded" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="portal-skeleton-block portal-skeleton-pulse h-3 w-full max-w-3xl rounded" />
            <div className="portal-skeleton-block portal-skeleton-pulse h-3 w-5/6 max-w-2xl rounded" />
          </div>
        </div>
      </div>
    </section>
  )
}
