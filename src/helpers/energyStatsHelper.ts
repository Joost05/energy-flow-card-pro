import type { ResolvedConfig, ResolvedPricingConfig } from '../config/CardConfig';
import type { Hass } from '../types/hass';
import { fetchGridFinancialsRange } from './pricingHelper';

export type EnergyStatsPeriod = 'today' | 'week' | 'month';

export interface EnergyStats {
  period: EnergyStatsPeriod;
  start: number;
  end: number;
  consumptionKWh: number | null;
  importKWh: number | null;
  exportKWh: number | null;
  solarKWh: number | null;
  batteryChargedKWh: number | null;
  batteryDischargedKWh: number | null;
  importCost: number | null;
  exportRevenue: number | null;
  netCost: number | null;
  selfConsumptionPct: number | null;
  selfSufficiencyPct: number | null;
}

interface RawHistoryState {
  entity_id?: string;
  state: string;
  last_changed?: string;
  last_updated?: string;
}

function energyToKWh(value: number, unit: unknown): number {
  const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  if (u === 'wh') return value / 1000;
  if (u === 'mwh') return value * 1000;
  return value;
}

function rangeFor(period: EnergyStatsPeriod, now = Date.now()): { start: number; end: number } {
  const d = new Date(now);
  if (period === 'today') {
    d.setHours(0, 0, 0, 0);
    return { start: d.getTime(), end: now };
  }
  if (period === 'week') {
    d.setHours(0, 0, 0, 0);
    const weekday = (d.getDay() + 6) % 7; // maandag = 0
    d.setDate(d.getDate() - weekday);
    return { start: d.getTime(), end: now };
  }
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return { start: d.getTime(), end: now };
}

function finiteState(hass: Hass, entityId: string | undefined): number | null {
  if (!entityId) return null;
  const state = hass.states[entityId];
  if (!state || state.state === 'unknown' || state.state === 'unavailable') return null;
  const n = Number(String(state.state).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return energyToKWh(n, state.attributes?.unit_of_measurement);
}

function rawHistoryMap(response: RawHistoryState[][] | undefined, ids: readonly string[]): Map<string, RawHistoryState[]> {
  const byId = new Map<string, RawHistoryState[]>();
  for (let i = 0; i < (response ?? []).length; i++) {
    const arr = response?.[i] ?? [];
    const id = arr.find((x) => x.entity_id)?.entity_id ?? ids[i];
    if (id) byId.set(id, arr);
  }
  return byId;
}

function deltaForEntity(
  hass: Hass,
  entityId: string | undefined,
  states: readonly RawHistoryState[],
  start: number,
  end: number,
): number | null {
  if (!entityId) return null;
  const current = hass.states[entityId];
  if (!current) return null;
  const unit = current.attributes?.unit_of_measurement;
  const points: Array<{ t: number; v: number }> = [];
  for (const s of states) {
    const n = Number(String(s.state).replace(',', '.'));
    const stamp = s.last_changed ?? s.last_updated;
    if (!Number.isFinite(n) || !stamp) continue;
    points.push({ t: Date.parse(stamp), v: energyToKWh(n, unit) });
  }
  const live = finiteState(hass, entityId);
  if (live !== null) points.push({ t: end, v: live });
  points.sort((a, b) => a.t - b.t);
  if (points.length === 0) return null;

  let baseline = points[0]!.v;
  for (const p of points) {
    if (p.t <= start) baseline = p.v;
    else break;
  }
  let total = 0;
  let previous = baseline;
  for (const p of points) {
    if (p.t <= start || p.t > end) continue;
    let delta = p.v - previous;
    if (delta < 0) delta = p.v; // total_increasing reset / daily reset
    if (delta > 0) total += delta;
    previous = p.v;
  }
  return total;
}

function chooseEnergyEntity(node: { config: Record<string, unknown> }, period: EnergyStatsPeriod, totalKey: string, todayKey?: string): string | undefined {
  const total = typeof node.config[totalKey] === 'string' ? String(node.config[totalKey]) : undefined;
  const today = todayKey && typeof node.config[todayKey] === 'string' ? String(node.config[todayKey]) : undefined;
  return period === 'today' ? (today ?? total) : total;
}

function sumKnown(values: Array<number | null>): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  let total = 0;
  for (const value of values) total += value ?? 0;
  return total;
}

export async function fetchEnergyStats(
  hass: Hass,
  cfg: ResolvedConfig,
  period: EnergyStatsPeriod,
  pricing: ResolvedPricingConfig,
  now = Date.now(),
): Promise<EnergyStats | null> {
  if (!hass.callApi) return null;
  const { start, end } = rangeFor(period, now);
  const grid = cfg.nodes.find((n) => n.type === 'grid');
  if (!grid) return null;

  const importEntity = grid.config.energy_import_entity;
  const exportEntity = grid.config.energy_export_entity;
  const solarNodes = cfg.nodes.filter((n) => n.type === 'solar' || n.type === 'producer');
  const batteryNodes = cfg.nodes.filter((n) => n.type === 'battery');

  const solarEntities = solarNodes.map((n) => chooseEnergyEntity(n as any, period, 'energy_total_entity', 'energy_today_entity'));
  const chargedEntities = batteryNodes.map((n) => chooseEnergyEntity(n as any, period, 'energy_charged_entity'));
  const dischargedEntities = batteryNodes.map((n) => chooseEnergyEntity(n as any, period, 'energy_discharged_entity'));

  const ids = [...new Set([
    importEntity,
    exportEntity,
    ...solarEntities,
    ...chargedEntities,
    ...dischargedEntities,
  ].filter((x): x is string => !!x))];

  const path = ids.length
    ? `history/period/${new Date(start).toISOString()}?filter_entity_id=${encodeURIComponent(ids.join(','))}` +
      `&end_time=${encodeURIComponent(new Date(end).toISOString())}&minimal_response&no_attributes&significant_changes_only`
    : '';

  let byId = new Map<string, RawHistoryState[]>();
  if (path) {
    try {
      const response = await hass.callApi<RawHistoryState[][]>('GET', path);
      byId = rawHistoryMap(response, ids);
    } catch {
      return null;
    }
  }

  const delta = (id: string | undefined): number | null => id ? deltaForEntity(hass, id, byId.get(id) ?? [], start, end) : null;
  const importKWh = delta(importEntity);
  const exportKWh = delta(exportEntity);
  const solarValues = solarEntities.map(delta);
  const chargedValues = chargedEntities.map(delta);
  const dischargedValues = dischargedEntities.map(delta);

  const solarKWh = solarNodes.length === 0 ? 0 : sumKnown(solarValues);
  const batteryChargedKWh = batteryNodes.length === 0 ? 0 : sumKnown(chargedValues);
  const batteryDischargedKWh = batteryNodes.length === 0 ? 0 : sumKnown(dischargedValues);

  let consumptionKWh: number | null = null;
  if (importKWh !== null && exportKWh !== null && solarKWh !== null && batteryChargedKWh !== null && batteryDischargedKWh !== null) {
    consumptionKWh = Math.max(0, importKWh + solarKWh + batteryDischargedKWh - exportKWh - batteryChargedKWh);
  }

  const financials = pricing.mode === 'none'
    ? null
    : await fetchGridFinancialsRange(hass, importEntity, exportEntity, pricing, start, end);

  const selfConsumptionPct = solarKWh !== null && solarKWh > 0 && exportKWh !== null
    ? Math.max(0, Math.min(100, ((solarKWh - Math.min(solarKWh, exportKWh)) / solarKWh) * 100))
    : null;
  const selfSufficiencyPct = consumptionKWh !== null && consumptionKWh > 0 && importKWh !== null
    ? Math.max(0, Math.min(100, (1 - importKWh / consumptionKWh) * 100))
    : null;

  return {
    period,
    start,
    end,
    consumptionKWh,
    importKWh,
    exportKWh,
    solarKWh,
    batteryChargedKWh,
    batteryDischargedKWh,
    importCost: financials?.importCost ?? null,
    exportRevenue: financials?.exportRevenue ?? null,
    netCost: financials ? financials.importCost - financials.exportRevenue : null,
    selfConsumptionPct,
    selfSufficiencyPct,
  };
}

export function demoEnergyStats(period: EnergyStatsPeriod, now = Date.now()): EnergyStats {
  const factor = period === 'today' ? 1 : period === 'week' ? 4.6 : 18.2;
  const importKWh = 12.1 * factor;
  const exportKWh = 4.6 * factor;
  const solarKWh = 15.8 * factor;
  const batteryChargedKWh = 3.4 * factor;
  const batteryDischargedKWh = 2.8 * factor;
  const consumptionKWh = importKWh + solarKWh + batteryDischargedKWh - exportKWh - batteryChargedKWh;
  const { start, end } = rangeFor(period, now);
  const importCost = importKWh * 0.31;
  const exportRevenue = exportKWh * 0.09;
  return {
    period, start, end, consumptionKWh, importKWh, exportKWh, solarKWh, batteryChargedKWh, batteryDischargedKWh,
    importCost, exportRevenue, netCost: importCost - exportRevenue,
    selfConsumptionPct: ((solarKWh - Math.min(solarKWh, exportKWh)) / solarKWh) * 100,
    selfSufficiencyPct: (1 - importKWh / consumptionKWh) * 100,
  };
}
