import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/shared/NotificationCenter.tsx', import.meta.url), 'utf8')

// Badge count now honors the `notifications_realert_minutes` setting
// (Settings.tsx's "Unresolved alert repeat interval") instead of the old
// unconditional "clear on open, full count otherwise" rule -- see
// `badgeVisibleCount` below. These two symbol names were a prior, abandoned
// implementation attempt of seen-state tracking and must not reappear.
assert.doesNotMatch(source, /badgeSuppressed/)
assert.doesNotMatch(source, /NOTIFICATION_SEEN_KEY/)
assert.match(source, /const badgeCount = open \? 0 : badgeVisibleCount/)
assert.match(source, /const NOTIFICATION_SUMMARY_TIMEOUT_MS = 8000/)

// Realert suppression: an alert counts toward the badge if never seen, or
// last seen more than `realertMinutes` ago -- this is the actual fix for
// `notifications_realert_minutes` previously having no effect (the setting
// was persisted and displayed in Settings.tsx but nothing ever read it back).
assert.match(source, /const SEEN_ALERT_TIMES_KEY = 'notif_seen_alert_times_v1'/)
assert.match(source, /const realertMinutes = Math\.max\(1, Number\(summary\.preferences\?\.realertMinutes\) \|\| 10\)/)
assert.match(
  source,
  /const badgeVisibleCount = useMemo\(\(\) => \{[\s\S]*?return allAlertItems\.filter\(\(item\) => \{\s*const seenAt = seenAlertTimes\[item\.id\]\s*return !seenAt \|\| \(now - seenAt\) >= realertMs\s*\}\)\.length\s*\}, \[allAlertItems, realertMinutes, seenAlertTimes, realertTick\]\)/,
)
// Opening the panel stamps every currently-listed alert as seen now, which
// is what makes "opening notifications clears the badge" (Settings.tsx
// copy) still true under the new suppression logic.
assert.match(source, /if \(!open \|\| !allAlertItems\.length\) return/)
// Security items keep their own one-way "quiet dot" tracking
// (seenSecurityIds/SEEN_SECURITY_IDS_KEY) and are deliberately excluded from
// the realert-suppressed numeric badge set.
assert.match(source, /filter\(\(section\) => section\.id !== 'security'\)/)
assert.match(
  source,
  /import \{ getNotificationSummary as getNotificationSummaryRequest \} from '\.\.\/\.\.\/api\/notificationSummary\.ts'[\s\S]*withLoaderTimeout\(\s*\(\) => getNotificationSummaryRequest\(\) as Promise<Partial<NotificationSummary>>,\s*'Notifications',\s*NOTIFICATION_SUMMARY_TIMEOUT_MS,\s*\)/,
)
assert.match(source, /const visibleLoadRequestRef = useRef\(0\)[\s\S]*isTrackedRequestCurrent\(visibleLoadRequestRef, visibleRequestId\)/)
assert.doesNotMatch(source, /getNotificationApi|window\.api|api\.getNotificationSummary/)

console.log('PASS notification badge stays visible until the panel is opened')
