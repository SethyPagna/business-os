import { allocateDispositionBasis, quantityDecimal, subtractQuantity } from './stockDispositionBasis'

export type ValuationSegment = { segment_id: string; allocation_id: string; fate: 'sellable' | 'held' | 'disposed'; quantity: string; gross4: number; coverage4: number; loss4: number; recovery4: number; reason: string }

export function splitValuationSegment(segment: ValuationSegment, quantity: unknown, childId: string, fate: ValuationSegment['fate']) {
  const part = allocateDispositionBasis(segment.quantity,segment.gross4,segment.coverage4,quantity)
  const child = { ...segment,segment_id:childId,fate,quantity:part.quantity,gross4:part.gross4,coverage4:part.coverage4,loss4:fate === 'disposed' ? part.net4 : 0,recovery4:0 }
  const remainder = part.remainingQuantity === '0' ? null : { ...segment,quantity:part.remainingQuantity,gross4:part.remainingGross4,coverage4:part.remainingCoverage4 }
  return { child,remainder }
}

export function applyValuationCoverage(segment: ValuationSegment, amount4: number) {
  if (!Number.isSafeInteger(amount4) || amount4 <= 0 || amount4 > segment.gross4-segment.coverage4 || segment.fate === 'sellable') throw new RangeError('ineligible_coverage_target')
  return { ...segment,coverage4:segment.coverage4+amount4,recovery4:segment.recovery4+(segment.fate === 'disposed' ? amount4 : 0) }
}

export function valuationTotals(segments: ValuationSegment[], gross4: number) {
  const totals = { sellable_quantity:'0',held_quantity:'0',sellable_net4:0,held_net4:0,historical_loss4:0,recovery4:0,coverage4:0 }
  const sumQuantity = (values: string[]) => quantityDecimal(values.reduce((n,value)=>n+Number(value),0),true)
  totals.sellable_quantity=sumQuantity(segments.filter(s=>s.fate==='sellable').map(s=>s.quantity))
  totals.held_quantity=sumQuantity(segments.filter(s=>s.fate==='held').map(s=>s.quantity))
  for (const s of segments) {
    quantityDecimal(s.quantity)
    if ([s.gross4,s.coverage4,s.loss4,s.recovery4].some(n=>!Number.isSafeInteger(n)||n<0) || s.coverage4>s.gross4 || s.recovery4>s.loss4) throw new RangeError('valuation_state_invalid')
    if(s.fate==='sellable') totals.sellable_net4+=s.gross4-s.coverage4
    if(s.fate==='held') totals.held_net4+=s.gross4-s.coverage4
    totals.historical_loss4+=s.loss4;totals.recovery4+=s.recovery4;totals.coverage4+=s.coverage4
  }
  if (Object.values(totals).filter(n=>typeof n==='number').some(n=>!Number.isSafeInteger(n)) || totals.sellable_net4+totals.held_net4+totals.historical_loss4-totals.recovery4+totals.coverage4!==gross4) throw new RangeError('valuation_conservation_failed')
  return totals
}
