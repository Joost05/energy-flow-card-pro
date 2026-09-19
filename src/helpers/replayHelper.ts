import type { HistoryPoint } from './historyHelper';

/** Finds the closest available history point to a requested timestamp. */
export function nearestHistoryPoint(points: readonly HistoryPoint[], timestamp: number): HistoryPoint | undefined {
  if (points.length === 0) return undefined;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid]!.t < timestamp) lo = mid + 1;
    else hi = mid;
  }
  const right = points[lo]!;
  const left = lo > 0 ? points[lo - 1]! : undefined;
  if (!left) return right;
  return Math.abs(left.t - timestamp) <= Math.abs(right.t - timestamp) ? left : right;
}

export function replayRange(series: readonly (readonly HistoryPoint[])[]): { start: number; end: number } | undefined {
  const usable = series.filter((points) => points.length > 0);
  if (usable.length === 0) return undefined;
  const start = Math.max(...usable.map((points) => points[0]!.t));
  const end = Math.min(...usable.map((points) => points[points.length - 1]!.t));
  return end > start ? { start, end } : undefined;
}
