type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

// Owner, 30 Sep 2026: points are coming soon, so the row never takes a number.
export default function PortalPointsRow({ copy, className }: { copy: CopyFn; className?: string }) {
  return (
    <div data-portal-points-row="true" className={className}>
      {copy('membershipPoints', 'Points', 'ពិន្ទុ')}: <span data-portal-points-value="true">{copy('membershipPointsComingSoon', 'Coming soon', 'នឹងមកដល់ឆាប់ៗនេះ')}</span>
    </div>
  )
}
