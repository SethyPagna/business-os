import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/shared/NotificationCenter.tsx', import.meta.url), 'utf8')

assert.match(source, /const badgeCount = open \? 0 : activeAlertCount/)
assert.doesNotMatch(source, /badgeSuppressed/)
assert.doesNotMatch(source, /NOTIFICATION_SEEN_KEY/)
assert.match(source, /const NOTIFICATION_SUMMARY_TIMEOUT_MS = 8000/)
assert.match(
  source,
  /import \{ getNotificationSummary as getNotificationSummaryRequest \} from '\.\.\/\.\.\/api\/notificationSummary\.ts'[\s\S]*withLoaderTimeout\(\s*\(\) => getNotificationSummaryRequest\(\) as Promise<Partial<NotificationSummary>>,\s*'Notifications',\s*NOTIFICATION_SUMMARY_TIMEOUT_MS,\s*\)/,
)
assert.match(source, /const visibleLoadRequestRef = useRef\(0\)[\s\S]*isTrackedRequestCurrent\(visibleLoadRequestRef, visibleRequestId\)/)
assert.doesNotMatch(source, /getNotificationApi|window\.api|api\.getNotificationSummary/)

console.log('PASS notification badge stays visible until the panel is opened')
