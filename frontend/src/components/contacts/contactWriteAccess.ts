// PERMISSION-UI-HIDING#128: the one place the Customers, Suppliers and Delivery tabs decide whether the current
// role may add or edit a contact. The Worker enforces the same two switches (POST needs contacts:add, PUT needs
// contacts:edit), so a control is withheld here instead of rendered and refused.

type CanFn = (permissionKey: string, actionKey: string) => boolean

export type ContactWriteAccess = { canAdd: boolean; canEdit: boolean }

export function contactWriteAccess(can: CanFn): ContactWriteAccess {
  return { canAdd: can('contacts', 'add'), canEdit: can('contacts', 'edit') }
}

/** The add/edit form may be mounted only for the matching action: a selected row is an edit, no row is an add. */
export function isContactFormAllowed(access: ContactWriteAccess, selected: unknown): boolean {
  return selected ? access.canEdit : access.canAdd
}
