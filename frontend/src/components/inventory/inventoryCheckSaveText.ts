// English text for an unconfirmed save, by the key the page picked: the same words as the pack, so a missing pack still reads right.
export const unknownSaveFallback = (key: string): string => key === 'inventory_check_saved_refresh'
  ? 'Saved. Retry to finish, or refresh the page.'
  : 'Save result unknown. Check the session before retrying.'
