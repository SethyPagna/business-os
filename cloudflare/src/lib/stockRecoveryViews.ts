import type { Env } from '../index'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersions } from './cache'
import { getPlanLimits, resolvePlanTier } from './planTier'
import { currentRequestMetrics, type RequestMetrics } from './requestMetrics'
import type { StockMutationRecovery } from './stockMutationReceipt'

export function stockRecoveryViews(env: Env, metrics: RequestMetrics | undefined = currentRequestMetrics()): StockMutationRecovery {
  const limit = getPlanLimits(env).d1QueriesPerInvocation
  const refreshStatements = resolvePlanTier(env) === 'free' ? 6 : 4
  return {
    canRun: additionalStatements => Boolean(metrics?.invocation
      && metrics.invocation.attemptedStatements + additionalStatements + refreshStatements <= limit),
    async run() {
      await bumpVersions(env, ['products', 'stock'], { requirePersistence: true })
      await Promise.all([
        broadcast(env, 'products', { action: 'update' }),
        broadcast(env, 'inventory', { action: 'adjust' }),
      ])
    },
  }
}
