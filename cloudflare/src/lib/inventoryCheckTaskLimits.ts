import type { Env } from '../index'
import { resolvePlanTier, type PlanTier } from './planTier'

// The sizes of the count tasks (lib/inventoryCheckTasks.ts, docs/contracts/inventory-check-tasks-20261119.md), chosen by the plan tier like every other limit: ONE place to change them, one value per tier, read through
// getInventoryCheckTaskLimits(env) and never written at a call site.
//
// FREE IS SMALLER THAN PAID (owner ruling, 20 Nov 2026, replacing "the same on both tiers"): every open task is read by the board and by the auto-close of every count writer, so its size is read cost on the Free plan's 3M reads a
// day. Free: 10 open tasks per branch of 100 products (a worst plausible day of both branches at the caps, 200 submissions and 200 board opens, is about 0.9M reads of count tasks, 1.5M in the pathological case where every
// task holds the same products; docs: DESIGN-task-reopen P2.9). Paid stays 30 of 300. A TAKE-BACK (the reopen of a task a count it relied on was taken back from) is never refused by these numbers: only an ISSUE is.
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
  free: { maxProducts: 100, maxOpenTasks: 10, tasksClosedShown: 5 },
}

export function getInventoryCheckTaskLimits(env: Env): InventoryCheckTaskLimits {
  return INVENTORY_CHECK_TASK_LIMITS_BY_TIER[resolvePlanTier(env)]
}
