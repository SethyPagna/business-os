import { useState, type ReactNode } from 'react'

// A user's avatar image on the Users page, the user detail sheet and My
// Profile. A stored avatar that fails to load (deleted from the Library, a
// legacy file type the server no longer serves, offline) shows that spot's
// own no-avatar markup -- the initials -- never a broken-image icon. Same
// rule as the sidebar's AccountAvatarImage (Sidebar.tsx, f72d7eff) and
// ProductImage: onError remembers the URL as broken for 5 minutes, so every
// other avatar spot skips it too, and a new URL (a changed avatar) is tried
// afresh.
export const BROKEN_USER_AVATAR_RETRY_MS = 5 * 60 * 1000
export const brokenUserAvatarUrls = new Map<string, number>()

function isRecentlyBrokenUserAvatar(src: string): boolean {
  const lastFailedAt = Number(brokenUserAvatarUrls.get(src) || 0)
  return lastFailedAt > 0 && Date.now() - lastFailedAt < BROKEN_USER_AVATAR_RETRY_MS
}

export function UserAvatarImage({ src, alt, className, fallback }: { src?: string | null; alt?: string | null; className: string; fallback: ReactNode }) {
  const safeSrc = String(src || '').trim()
  const [failedSrc, setFailedSrc] = useState('')
  if (!safeSrc || failedSrc === safeSrc || isRecentlyBrokenUserAvatar(safeSrc)) return <>{fallback}</>
  return (
    <img
      src={safeSrc}
      alt={alt || ''}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => {
        brokenUserAvatarUrls.set(safeSrc, Date.now())
        setFailedSrc(safeSrc)
      }}
    />
  )
}
