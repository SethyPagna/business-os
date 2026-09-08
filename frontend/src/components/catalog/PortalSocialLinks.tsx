import type { ComponentType } from 'react'

type SocialLink = { key: string; label: string; value: string; icon: ComponentType<{ className?: string }>; accentClassName?: string }

export default function PortalSocialLinks({ links }: { links: SocialLink[] }) {
  return <div data-portal-social-links="true" className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto">
    {links.map(({ key, label, value, icon: Icon, accentClassName }) => <a key={key} href={value} target="_blank" rel="noreferrer" aria-label={label} title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-700 transition hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-neutral-200 dark:hover:bg-neutral-800 ${accentClassName || ''}`}>
      <Icon className="h-[18px] w-[18px]" />
    </a>)}
  </div>
}
