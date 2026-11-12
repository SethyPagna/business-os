/**
 * The text the till's customer picker may send to the server, or null when it
 * must send nothing. The picker asks only while it is open (the person is in
 * the box), and only once two characters are typed; an empty box shows no rows
 * and one character matches nearly everyone. Counted in code points so a Khmer
 * name is not cut short.
 */
export function posCustomerSearchRequest(text: string, pickerOpen: boolean): string | null {
  if (!pickerOpen) return null
  const trimmed = String(text || '').trim()
  return [...trimmed].length >= 2 ? trimmed : null
}
