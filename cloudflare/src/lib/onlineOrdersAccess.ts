import { getActionTier, isAdminControlUser, type PermissionUser } from './permissions'

// Who may do what with online orders (KHQR, migration 0293). `online_orders` is its own grant, read strictly: no other key implies it
// (Sales Full does not open online orders). The three actions are overrides that can only remove what the grant gives:
//   view     see the order list, one order, its payments, requests and refund figures
//   decide   accept or reject a customer's change / cancel / return request
//   refund   record that a refund was paid back to the customer (the S5 routes)
// Deciding and refunding need view as well: a person who cannot see the order cannot act on it.
// Defaults (lib/roleDefaults.ts): Admin, Manager and Employee. Existing roles do not change by themselves; see the S2 report.
export type OnlineOrderAccess = { canView: boolean; canDecide: boolean; canRefund: boolean }

export function getOnlineOrderAccess(user: PermissionUser): OnlineOrderAccess {
  const admin = isAdminControlUser(user)
  const canView = admin || getActionTier(user, 'online_orders', 'view') === 'full'
  return {
    canView,
    canDecide: admin || (canView && getActionTier(user, 'online_orders', 'decide') === 'full'),
    canRefund: admin || (canView && getActionTier(user, 'online_orders', 'refund') === 'full'),
  }
}
