// The PayWay credentials every online-order entry point uses: lib/payway.ts's (which stays free of imports, so it can be loaded and tested alone) plus
// the plan's call timeout (planTier onlineOrderPaywayTimeoutMs). One function, so the portal routes, the callback and the cron sweep cannot disagree
// about how long a PayWay call may take.

import type { Env } from '../index'
import { paywayCredentials, type PaywayCredentials } from './payway'
import { getPlanLimits } from './planTier'

export function paywayCredentialsFor(env: Env): PaywayCredentials | null {
  const credentials = paywayCredentials(env)
  return credentials ? { ...credentials, timeoutMs: getPlanLimits(env).onlineOrderPaywayTimeoutMs } : null
}
