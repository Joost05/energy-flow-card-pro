import type { Hass } from '../types/hass';
import { parsePower } from './stateHelper';

export interface HistoryPoint {
  /** Tijdstip in ms sinds epoch. */
  t: number;
  /** Waarde in W. */
  v: number;
}

interface RawState {
  state: string;
  last_changed?: string;
  last_updated?: string;
}

const HOUR = 3_600_000;

/**
 * Haalt de geschiedenis van een sensor op via de Home Assistant REST-API
 * (hass.callApi). Waarden worden omgerekend naar W met `unitFactor`.
 */
export async function fetchHistory(
  hass: Hass,
  entityId: string,
  hours: number,
  unitFactor: number,
  invert: boolean,
  now: number = Date.now(),
): Promise<HistoryPoint[]> {
  if (!hass.callApi) return [];
  const start = new Date(now - hours * HOUR).toISOString();
  const path =
    `history/period/${start}?filter_entity_id=${encodeURIComponent(entityId)}` +
    `&end_time=${encodeURIComponent(new Date(now).toISOString())}` +
    `&minimal_response&no_attributes&significant_changes_only`;
  const response = await hass.callApi<RawState[][]>('GET', path);
  const states = response?.[0] ?? [];

  const points: HistoryPoint[] = [];
  for (const s of states) {
    const v = parsePower(s.state);
    const stamp = s.last_changed ?? s.last_updated;
    if (v === null || !stamp) continue;
    points.push({ t: Math.max(Date.parse(stamp), now - hours * HOUR), v: (invert ? -v : v) * unitFactor });
  }
  return points;
}

/**
 * Brengt een onregelmatige reeks terug tot een vast aantal punten door per interval de
 * laatste bekende waarde vast te houden (zoals een sensor werkt: waarde geldt tot de volgende).
 */
export function bucketize(points: readonly HistoryPoint[], start: number, end: number, buckets: number): HistoryPoint[] {
  if (points.length === 0 || buckets < 2 || end <= start) return [];
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const step = (end - start) / (buckets - 1);
  const out: HistoryPoint[] = [];
  let i = 0;
  let last: number | null = null;
  for (let b = 0; b < buckets; b++) {
    const t = start + b * step;
    while (i < sorted.length && sorted[i]!.t <= t) {
      last = sorted[i]!.v;
      i++;
    }
    if (last !== null) out.push({ t, v: last });
  }
  return out;
}

/** Eenheidsfactor naar W voor een entiteit, op basis van haar eenheid. */
export function unitFactor(unit: unknown): number {
  const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  if (u === 'kw') return 1000;
  if (u === 'mw') return 1_000_000;
  return 1;
}
