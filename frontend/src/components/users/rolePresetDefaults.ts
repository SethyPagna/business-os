import type { PermissionValue } from '../../utils/permissions.ts'

// Confirmed gap (progress.md "Permissions redesign"): no built-in
// employee/manager/admin role presets are seeded anywhere in this app.
// These are starting points, not fixed roles -- Users.tsx offers them as
// one-click fills for a NEW role's permission set (see the preset buttons
// next to the role-name field), and the admin can still edit every key
// via PermissionEditor before saving, same as if they'd built it by hand.
// Picking a preset never creates or locks in a role named "Employee" --
// it just prefills roleForm.permissions; the role's actual name is
// whatever the admin typed.
//
// Only uses permission keys that already exist in permissionDefinitions.ts
// and, for a 'review' value, only on a key in REVIEW_TIER_KEYS (products,
// inventory, branches, returns, fees, contacts) -- picking Review Required
// for a key that isn't actually wired end to end would silently do
// nothing, the exact looks-wired-but-isn't gap this file's sibling already
// warns about. 'library' is deliberately absent from every preset's
// permissions below (merge session): the library view/manage split made
// browsing free for any authenticated user regardless of this key, and
// removed the Review Required tier entirely, so a leftover
// `library: 'review'` here would silently resolve to None (a real
// regression this session fixed -- see utils/permissions.ts's
// REVIEW_TIER_KEYS comment) rather than grant anything. Employee gets no
// library management (None, same as omitting the key); Manager still gets
// `library: true` (Full) below.
export type RolePresetKey = 'employee' | 'manager' | 'admin'

export interface RolePreset {
  key: RolePresetKey
  labelKey: string
  label: string
  descriptionKey: string
  description: string
  permissions: Record<string, PermissionValue>
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    key: 'employee',
    labelKey: 'role_preset_employee',
    label: 'Employee',
    descriptionKey: 'role_preset_employee_desc',
    description: 'Day-to-day front-line access: POS, viewing the dashboard and customer portal. Product, inventory, returns, and contacts changes go to the Review/Approval queue instead of applying directly. Library browsing is available to everyone by default, but uploading/renaming/deleting is not included. No access to Users, Backup, Audit Log, Settings, or Fees.',
    permissions: {
      dashboard: true,
      customer_portal: true,
      pos: true,
      products: 'review',
      inventory: 'review',
      returns: 'review',
      contacts: 'review',
    },
  },
  {
    key: 'manager',
    labelKey: 'role_preset_manager',
    label: 'Manager',
    descriptionKey: 'role_preset_manager_desc',
    description: "Full day-to-day operational access -- Dashboard, Customer Portal, POS, Products, Inventory, Branches, Sales, Returns, Fees, Contacts, Library, Audit Log, and the Review/Approval queue -- but not Users and roles, Backup restore/reset, or Security settings, which stay Admin-only.",
    permissions: {
      dashboard: true,
      dashboard_export: true,
      customer_portal: true,
      pos: true,
      products: true,
      inventory: true,
      branches: true,
      sales: true,
      returns: true,
      fees: true,
      contacts: true,
      library: true,
      audit_log: true,
      review: true,
      backup: true,
      settings: true,
    },
  },
  {
    key: 'admin',
    labelKey: 'role_preset_admin',
    label: 'Administrator',
    descriptionKey: 'role_preset_admin_desc',
    description: 'Full access to every page and action, with nothing gated -- same as the existing "Administrator (full access)" override.',
    permissions: { all: true },
  },
]
