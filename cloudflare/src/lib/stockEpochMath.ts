import { allocateDispositionBasis, exactMoney4, quantityDecimal, subtractQuantity } from './stockDispositionBasis';
import { sumValuationQuantity } from './stockValuationMath';
import { multiplyMoney4 } from './moneyPrecision';

export type EpochFragment = {
  source_id: string;
  event_id: string;
  segment_id: string;
  parent_segment_id: string | null;
  quantity: string;
  gross4: number;
  coverage4: number;
};

const money = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000_000) throw new RangeError('epoch_money_invalid');
  return value;
};

export function epochReceiptOpening(quantity: unknown, unitCost: unknown, payment: unknown) {
  const units = quantityDecimal(quantity);
  exactMoney4(unitCost);
  const gross4 = exactMoney4(multiplyMoney4(Number(unitCost), Number(units)));
  if (payment !== 'paid' && payment !== 'credit') throw new RangeError('epoch_receipt_financial_reconciliation_required');
  return { quantity: units, gross4, paid4: payment === 'paid' ? gross4 : 0, debt4: payment === 'credit' ? gross4 : 0 };
}

export function splitEpochBasis(fragment: EpochFragment, quantity: unknown, childId: string) {
  if (!childId || childId === fragment.segment_id || `${childId}-remaining` === fragment.segment_id) throw new RangeError('epoch_fragment_identity_invalid');
  const split = allocateDispositionBasis(fragment.quantity, fragment.gross4, fragment.coverage4, quantity);
  return {
    selected: { ...fragment, segment_id: childId, parent_segment_id: fragment.segment_id, quantity: split.quantity, gross4: split.gross4, coverage4: split.coverage4 },
    remaining: { ...fragment, segment_id: `${childId}-remaining`, parent_segment_id: fragment.segment_id, quantity: split.remainingQuantity, gross4: split.remainingGross4, coverage4: split.remainingCoverage4 },
  };
}

export function assertEpochPartition(before: readonly EpochFragment[], after: readonly EpochFragment[], accepted: ReadonlyMap<string, number> = new Map()) {
  const keys = new Set<string>();
  const parents = new Map<string, EpochFragment>();
  for (const fragment of before) {
    quantityDecimal(fragment.quantity);
    if (money(fragment.coverage4) > money(fragment.gross4)) throw new RangeError('epoch_coverage_invalid');
    const key = JSON.stringify([fragment.source_id, fragment.event_id, fragment.segment_id]);
    const parent = JSON.stringify([fragment.source_id, fragment.segment_id]);
    if (keys.has(key) || parents.has(parent)) throw new RangeError('epoch_before_member_duplicate');
    keys.add(key);
    parents.set(parent, fragment);
  }
  const childKeys = new Set<string>();
  for (const fragment of after) {
    const key = JSON.stringify([fragment.source_id, fragment.segment_id]);
    if (childKeys.has(key) || !fragment.parent_segment_id || !parents.has(JSON.stringify([fragment.source_id, fragment.parent_segment_id]))) throw new RangeError('epoch_after_member_invalid');
    childKeys.add(key);
    const quantity = quantityDecimal(fragment.quantity, true);
    if (money(fragment.coverage4) > money(fragment.gross4)) throw new RangeError('epoch_coverage_invalid');
    if (quantity === '0' && (fragment.gross4 !== 0 || fragment.coverage4 !== 0)) throw new RangeError('epoch_empty_fragment_basis');
  }
  for (const [key, parent] of parents) {
    const children = after.filter(child => child.source_id === parent.source_id && child.parent_segment_id === parent.segment_id);
    const coverage = money(accepted.get(key) ?? 0);
    if (!children.length || sumValuationQuantity(children.map(child => child.quantity)) !== quantityDecimal(parent.quantity)
      || children.reduce((sum, child) => money(sum + child.gross4), 0) !== money(parent.gross4)
      || children.reduce((sum, child) => money(sum + child.coverage4), 0) !== money(parent.coverage4 + coverage)) throw new RangeError('epoch_partition_not_conserved');
    let remainingQuantity = parent.quantity, remainingGross4 = parent.gross4, remainingCoverage4 = money(parent.coverage4 + coverage);
    for (const child of children) {
      if (quantityDecimal(child.quantity, true) === '0') continue;
      const share = allocateDispositionBasis(remainingQuantity, remainingGross4, remainingCoverage4, child.quantity);
      if (share.gross4 !== child.gross4 || share.coverage4 !== child.coverage4) throw new RangeError('epoch_partition_order_mismatch');
      remainingQuantity = share.remainingQuantity;
      remainingGross4 = share.remainingGross4;
      remainingCoverage4 = share.remainingCoverage4;
    }
  }
  for (const key of accepted.keys()) if (!parents.has(key)) throw new RangeError('epoch_acceptance_target_invalid');
}

export type EpochAgreementBalance = { source_id: string; agreement_id: string; amount4: number; remaining4: number; targets: { allocation_id: string; amount4: number; remaining4: number }[] };

export function acceptEpochAgreement(balance: EpochAgreementBalance, shares: readonly { source_id: string; agreement_id: string; allocation_id: string; amount4: number }[]) {
  if (!shares.length || new Set(balance.targets.map(target => target.allocation_id)).size !== balance.targets.length
    || balance.targets.reduce((sum, target) => money(sum + target.amount4), 0) !== money(balance.amount4)
    || balance.targets.reduce((sum, target) => money(sum + target.remaining4), 0) !== money(balance.remaining4)) throw new RangeError('epoch_agreement_corrupt');
  const amounts = new Map<string, number>();
  for (const share of shares) {
    if (share.source_id !== balance.source_id || share.agreement_id !== balance.agreement_id || money(share.amount4) === 0
      || !balance.targets.some(target => target.allocation_id === share.allocation_id)) throw new RangeError('epoch_acceptance_membership');
    amounts.set(share.allocation_id, money((amounts.get(share.allocation_id) ?? 0) + share.amount4));
  }
  const total = [...amounts.values()].reduce((sum, amount) => money(sum + amount), 0);
  if (total > balance.remaining4) throw new RangeError('epoch_agreement_exhausted');
  const targets = balance.targets.map(target => {
    const amount = amounts.get(target.allocation_id) ?? 0;
    if (target.remaining4 > target.amount4 || amount > target.remaining4) throw new RangeError('epoch_agreement_target_exhausted');
    return { ...target, remaining4: target.remaining4 - amount };
  });
  return { ...balance, remaining4: balance.remaining4 - total, targets, accepted4: total };
}

export function epochActiveQuantity(effective: unknown, returned: unknown, cancelled: boolean) {
  const quantity = quantityDecimal(effective, true);
  const returnedQuantity = quantityDecimal(returned, true);
  return cancelled || Number(returnedQuantity) >= Number(quantity) ? '0' : subtractQuantity(quantity, [returnedQuantity]);
}
