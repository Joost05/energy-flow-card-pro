import type { Hass } from '../types/hass';
import { parsePower } from './stateHelper';

export interface HistoryPoint {
  /** Tijdstip in ms sinds epoch. */
  t: number;
  /** Waarde in W. */
  v: number;
}

interface RawState {
  entity_id?: string;
  state: string;
  last_changed?: string;
  last_updated?: string;
}

const HOUR = 3_600_000;

/**
 * Haalt de geschiedenis van meerdere vermogenssensoren in één Home Assistant-request op.
 * Alle waarden worden direct omgerekend naar W, zodat de kaart daarna één gezamenlijke
 * tijdlijn kan opbouwen voor nodes, verbindingen en de berekende Woning-node.
 */
export async function fetchHistoryBatch(
  hass: Hass,
  entityIds: readonly string[],
  hours: number,
  now: number = Date.now(),
): Promise<Map<string, HistoryPoint[]>> {
  const uniqueIds = [...new Set(entityIds.filter(Boolean))];
  const result = new Map<string, HistoryPoint[]>(uniqueIds.map((id) => [id, []]));
  if (!hass.callApi || uniqueIds.length === 0) return result;

  const startMs = now - hours * HOUR;
  const start = new Date(startMs).toISOString();
  const filter = uniqueIds.join(',');
  const path =
    `history/period/${start}?filter_entity_id=${encodeURIComponent(filter)}` +
    `&end_time=${encodeURIComponent(new Date(now).toISOString())}` +
    `&minimal_response&no_attributes&significant_changes_only`;

  const response = await hass.callApi<RawState[][]>('GET', path);
  for (let index = 0; index < (response ?? []).length; index++) {
    const states = response?.[index] ?? [];
    // Bij minimal_response staat entity_id doorgaans alleen op het eerste item. Als HA dit
    // niet terugstuurt, valt de API-volgorde terug op de volgorde uit filter_entity_id.
    const entityId = states.find((s) => typeof s.entity_id === 'string')?.entity_id ?? uniqueIds[index];
    if (!entityId || !result.has(entityId)) continue;
    const factor = unitFactor(hass.states[entityId]?.attributes.unit_of_measurement);
    const points = result.get(entityId)!;
    for (const s of states) {
      const value = parsePower(s.state);
      const stamp = s.last_changed ?? s.last_updated;
      if (value === null || !stamp) continue;
      points.push({ t: Math.max(Date.parse(stamp), startMs), v: value * factor });
    }
  }
  return result;
}

/** Achterwaarts compatibele single-entity helper. */
export async function fetchHistory(
  hass: Hass,
  entityId: string,
  hours: number,
  unitFactorOverride: number,
  invert: boolean,
  now: number = Date.now(),
): Promise<HistoryPoint[]> {
  const batch = await fetchHistoryBatch(hass, [entityId], hours, now);
  // `fetchHistoryBatch` gebruikt de actuele HA-eenheid. De oude API accepteerde expliciet
  // een factor; pas alleen het verschil toe zodat bestaande tests/callers correct blijven.
  const actualFactor = unitFactor(hass.states[entityId]?.attributes.unit_of_measurement);
  const ratio = actualFactor === 0 ? 1 : unitFactorOverride / actualFactor;
  return (batch.get(entityId) ?? []).map((p) => ({ t: p.t, v: (invert ? -p.v : p.v) * ratio }));
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
