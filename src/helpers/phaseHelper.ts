import type { HistoryPoint } from './historyHelper';

/**
 * HomeWizard/P1 setups may expose total grid power plus L2 and L3, without a separate L1 entity.
 * In that case L1 is exactly the remainder of the measured total.
 */
export function deriveL1Power(total: number | null, l2: number | null, l3: number | null): number | null {
  if (total === null || l2 === null || l3 === null) return null;
  if (![total, l2, l3].every(Number.isFinite)) return null;
  return total - l2 - l3;
}

/** Derives an L1 history series from aligned total/L2/L3 history buckets. */
export function deriveL1History(
  total: readonly HistoryPoint[],
  l2: readonly HistoryPoint[],
  l3: readonly HistoryPoint[],
): HistoryPoint[] {
  const l2ByTime = new Map(l2.map((point) => [point.t, point.v]));
  const l3ByTime = new Map(l3.map((point) => [point.t, point.v]));
  const result: HistoryPoint[] = [];
  for (const point of total) {
    const p2 = l2ByTime.get(point.t);
    const p3 = l3ByTime.get(point.t);
    if (p2 === undefined || p3 === undefined) continue;
    const value = deriveL1Power(point.v, p2, p3);
    if (value !== null) result.push({ t: point.t, v: value });
  }
  return result;
}
