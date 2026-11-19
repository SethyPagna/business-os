import type { Env } from '../index'
import { resolvePlanTier, type PlanTier } from './planTier'

// The sizes of the count tasks (lib/inventoryCheckTasks.ts, docs/contracts/inventory-check-tasks-20261119.md), chosen by the plan tier like every other limit: ONE place to change them, one value per tier, read through
// getInventoryCheckTaskLimits(env) and never written at a call site.
//
// They are the same on Free and Paid: a task is a unit of work given to a person, not a plan resource, so what Free saves here is read cost, which the cache and the plan's other limits carry.
//   maxProducts        the most products ONE task may hold, whether the admin names them or a filter resolves to them. It sits under the 500 items a session detail can read (getInventoryCheckSession refuses more),
//                      so a task can always be opened; over it the issue is refused 400 inventory_check_task_too_many with the total.
//   maxOpenTasks       the most OPEN tasks one branch may have. It is BOTH the cap on ISSUING only (a task issued while a branch has this many open is refused 409 inventory_check_task_limit with the open count). The Tasks list shows EVERY open task: a take-back
//                      reopens a task and is never refused by this cap, so a branch can hold more than maxOpenTasks open (the list is bounded by history, not by the cap).
//   tasksClosedShown   the most recently CLOSED tasks it adds after them.
//
// Why this is not in planTier.ts with the other limits: the file is inside the fingerprint of the sales-daily money kernel (scripts/sales-daily-kernel-pin.json: salesAnalytics imports getPlanLimits), and the pin
// refuses ANY change to PAID_LIMITS / FREE_LIMITS, or any new statement, without bumping SALES_DAILY_KERNEL_VERSION, which re-covers and re-computes every stored day. Three numbers that no sales figure reads are not a
// reason to do that. They move into PlanLimits the next time that version is bumped for another reason; the callers change only their import.
export type InventoryCheckTaskLimits = { maxProducts: number; maxOpenTasks: number; tasksClosedShown: number }

export const INVENTORY_CHECK_TASK_LIMITS_BY_TIER: Record<PlanTier, InventoryCheckTaskLimits> = {
  paid: { maxProducts: 300, maxOpenTasks: 30, tasksClosedShown: 5 },
  free: { maxProducts: 300, maxOpenTasks: 30, tasksClosedShown: 5 },
}

export function getInventoryCheckTaskLimits(env: Env): InventoryCheckTaskLimits {
  return INVENTORY_CHECK_TASK_LIMITS_BY_TIER[resolvePlanTier(env)]
}
