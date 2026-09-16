export type PersistentNoticeKind = 'app-update' | 'offline-outage' | 'offline-recovered'

type NoticeDetail = {
  version?: unknown
  reason?: unknown
  status?: unknown
  channel?: unknown
  message?: unknown
  error?: unknown
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

/**
 * Identifies one persistent notice event without volatile timestamps. Repeated
 * health polls for the same outage therefore stay dismissed; callers advance
 * epoch after a recovered -> offline transition so a later outage reappears.
 */
export function persistentNoticeFingerprint(
  kind: PersistentNoticeKind,
  detail: NoticeDetail | null | undefined,
  epoch = 0,
): string {
  const version = text(detail?.version)
  const stable = kind === 'app-update'
    ? (version ? [version] : [text(detail?.message), text(detail?.reason), text(detail?.status)])
    : [text(detail?.reason), text(detail?.status), text(detail?.channel), text(detail?.message), text(detail?.error)]
  return [kind, String(Math.max(0, Math.floor(Number(epoch) || 0))), ...stable].join('\u0001')
}

/** Failed writes/conflicts remain visible even when the surrounding outage
 * notice was dismissed. Dismissal only affects the exact active fingerprint. */
export function shouldRenderPersistentNotice(
  activeFingerprint: string,
  dismissedFingerprint: string,
  hasBlockingError = false,
): boolean {
  if (!activeFingerprint) return false
  return hasBlockingError || activeFingerprint !== dismissedFingerprint
}
