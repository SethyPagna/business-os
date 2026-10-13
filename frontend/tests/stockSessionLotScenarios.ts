// The lots a Stock Session line can start on, as the Worker sends them for one
// product at one branch (oldest received first, undated lots last), with the lot
// a freshly picked Remove or Set line must start on. Shared by
// stockSessionDefaultLot.test.ts and by a base-versus-fixed comparison, so the
// table printed for a review is the table the test asserts.
//
// The rule behind every row: Remove starts on the OLDEST lot (it mirrors FIFO),
// Set on the NEWEST, told apart by the received timestamp and never by where the
// lot sits in a list; a lot holding stock always beats an empty one, so a count
// never silently starts on a lot with nothing in it unless every lot is empty.

export type ScenarioLot = {
  id: number
  quantity: number
  received_at?: string | null
  lot_code?: string | null
  batch_number?: number | null
}

export type LotStart = number | 'none'

export type LotScenario = {
  name: string
  lots: ScenarioLot[]
  remove: LotStart
  set: LotStart
}

export const LOT_SCENARIOS: LotScenario[] = [
  {
    name: 'multi-day, every lot stocked',
    lots: [
      { id: 1, quantity: 5, received_at: '2026-10-01 01:00:00' },
      { id: 2, quantity: 5, received_at: '2026-10-05 01:00:00' },
      { id: 3, quantity: 5, received_at: '2026-10-09 01:00:00' },
    ],
    remove: 1,
    set: 3,
  },
  {
    name: 'multi-day, newest lot empty',
    lots: [
      { id: 1, quantity: 5, received_at: '2026-10-01 01:00:00' },
      { id: 2, quantity: 3, received_at: '2026-10-05 01:00:00' },
      { id: 3, quantity: 0, received_at: '2026-10-09 01:00:00' },
    ],
    remove: 1,
    set: 2,
  },
  {
    name: 'multi-day, every lot empty',
    lots: [
      { id: 1, quantity: 0, received_at: '2026-10-01 01:00:00' },
      { id: 2, quantity: 0, received_at: '2026-10-09 01:00:00' },
    ],
    remove: 'none',
    set: 2,
  },
  {
    name: 'same day, three lots stocked',
    lots: [
      { id: 1, quantity: 5, received_at: '2026-10-10 01:00:00', batch_number: 1 },
      { id: 2, quantity: 5, received_at: '2026-10-10 05:00:00', batch_number: 2 },
      { id: 3, quantity: 5, received_at: '2026-10-10 09:00:00', batch_number: 3 },
    ],
    remove: 1,
    set: 3,
  },
  {
    name: 'same day, newest lot empty',
    lots: [
      { id: 1, quantity: 5, received_at: '2026-10-10 01:00:00', batch_number: 1 },
      { id: 2, quantity: 5, received_at: '2026-10-10 05:00:00', batch_number: 2 },
      { id: 3, quantity: 0, received_at: '2026-10-10 09:00:00', batch_number: 3 },
    ],
    remove: 1,
    set: 2,
  },
  {
    name: 'same day, same instant (date-only), numbered',
    lots: [
      { id: 11, quantity: 4, received_at: '2026-10-10', batch_number: 1 },
      { id: 12, quantity: 4, received_at: '2026-10-10', batch_number: 2 },
      { id: 13, quantity: 4, received_at: '2026-10-10', batch_number: 3 },
    ],
    remove: 11,
    set: 13,
  },
  {
    name: 'undated only, first lot empty',
    lots: [
      { id: 7, quantity: 0, lot_code: 'RECON-1' },
      { id: 8, quantity: 4, lot_code: 'RECON-2' },
      { id: 9, quantity: 2, lot_code: 'RECON-3' },
    ],
    remove: 8,
    set: 9,
  },
  {
    name: 'undated only, newest lot empty',
    lots: [
      { id: 7, quantity: 4, lot_code: 'RECON-1' },
      { id: 8, quantity: 2, lot_code: 'RECON-2' },
      { id: 9, quantity: 0, lot_code: 'RECON-3' },
    ],
    remove: 7,
    set: 8,
  },
  {
    name: 'undated only, every lot empty',
    lots: [
      { id: 7, quantity: 0, lot_code: 'RECON-1' },
      { id: 8, quantity: 0, lot_code: 'RECON-2' },
      { id: 9, quantity: 0, lot_code: 'RECON-3' },
    ],
    remove: 'none',
    set: 9,
  },
  {
    name: 'undated only, numbered batches',
    lots: [
      { id: 21, quantity: 2, batch_number: 1 },
      { id: 22, quantity: 2, batch_number: 2 },
      { id: 23, quantity: 0, batch_number: 3 },
    ],
    remove: 21,
    set: 22,
  },
  {
    name: 'dated plus one undated, every lot stocked',
    lots: [
      { id: 1, quantity: 3, received_at: '2026-10-01 01:00:00' },
      { id: 2, quantity: 3, received_at: '2026-10-09 01:00:00' },
      { id: 5, quantity: 3, lot_code: 'RECON-9' },
    ],
    remove: 1,
    set: 2,
  },
  {
    name: 'dated plus undated, newest dated lot empty',
    lots: [
      { id: 1, quantity: 4, received_at: '2026-10-01 01:00:00' },
      { id: 2, quantity: 0, received_at: '2026-10-09 01:00:00' },
      { id: 5, quantity: 3, lot_code: 'RECON-9' },
    ],
    remove: 1,
    set: 1,
  },
  {
    name: 'dated plus undated, only the undated lot stocked',
    lots: [
      { id: 1, quantity: 0, received_at: '2026-10-01 01:00:00' },
      { id: 2, quantity: 0, received_at: '2026-10-09 01:00:00' },
      { id: 5, quantity: 3, lot_code: 'RECON-9' },
    ],
    remove: 5,
    set: 5,
  },
]

/** Every ordering of a short list, so a result cannot depend on the order lots arrive in. */
export function orderings<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, at) => orderings([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]))
}
