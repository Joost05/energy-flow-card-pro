import type { ResolvedPricingConfig } from '../config/CardConfig';
import type { Hass } from '../types/hass';

export interface PriceReading {
  importPrice: number | null;
  exportPrice: number | null;
}

function parsePriceState(state: string, unit?: unknown): number | null {
  const value = Number(String(state).replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  if (u.includes('ct/kwh') || u.includes('cent/kwh') || u.includes('c/kwh')) return value / 100;
  return value;
}

function entityPrice(hass: Hass | undefined, entityId?: string): number | null {
  if (!hass || !entityId) return null;
  const state = hass.states[entityId];
  if (!state || state.state === 'unknown' || state.state === 'unavailable') return null;
  return parsePriceState(state.state, state.attributes?.unit_of_measurement);
}

export function readPrices(config: ResolvedPricingConfig, hass?: Hass): PriceReading {
  if (config.mode === 'fixed') {
    return { importPrice: config.importPrice ?? null, exportPrice: config.exportPrice ?? null };
  }
  if (config.mode === 'entities') {
    return {
      importPrice: entityPrice(hass, config.importPriceEntity),
      exportPrice: entityPrice(hass, config.exportPriceEntity),
    };
  }
  return { importPrice: null, exportPrice: null };
}

export function currentGridRate(watts: number | null, prices: PriceReading): { kind: 'cost' | 'revenue' | 'none'; value: number | null } {
  if (watts === null || watts === 0) return { kind: 'none', value: 0 };
  if (watts > 0) return { kind: 'cost', value: prices.importPrice === null ? null : (watts / 1000) * prices.importPrice };
  return { kind: 'revenue', value: prices.exportPrice === null ? null : (Math.abs(watts) / 1000) * prices.exportPrice };
}

export function formatCurrency(value: number, currency = 'EUR', language?: string, digits = 2): string {
  try {
    return new Intl.NumberFormat(language || undefined, {
      style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(digits)}`;
  }
}

export function formatPrice(value: number, currency = 'EUR', language?: string): string {
  return `${formatCurrency(value, currency, language, 2)}/kWh`;
}

function energyToKWh(value: number, unit: unknown): number {
  const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  if (u === 'wh') return value / 1000;
  if (u === 'mwh') return value * 1000;
  return value;
}

interface RawHistoryState {
  entity_id?: string;
  state: string;
  last_changed?: string;
  last_updated?: string;
}

export interface TodayGridFinancials {
  importCost: number;
  exportRevenue: number;
  /** Signed balance: export revenue minus import cost. Negative means net cost today. */
  balance: number;
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

function cumulativeEnergyPoints(
  states: readonly RawHistoryState[],
  currentState: { state: string; attributes?: Record<string, unknown> } | undefined,
  now: number,
): Array<{ t: number; v: number }> {
  if (!currentState) return [];
  const unit = currentState.attributes?.unit_of_measurement;
  const points: Array<{ t: number; v: number }> = [];
  for (const s of states) {
    const n = Number(String(s.state).replace(',', '.'));
    const stamp = s.last_changed ?? s.last_updated;
    if (!Number.isFinite(n) || !stamp) continue;
    points.push({ t: Date.parse(stamp), v: energyToKWh(n, unit) });
  }
  const current = Number(String(currentState.state).replace(',', '.'));
  if (Number.isFinite(current)) points.push({ t: now, v: energyToKWh(current, unit) });
  points.sort((a, b) => a.t - b.t);
  return points;
}

function historicPricePoints(
  states: readonly RawHistoryState[],
  currentState: { attributes?: Record<string, unknown> } | undefined,
): Array<{ t: number; v: number }> {
  const unit = currentState?.attributes?.unit_of_measurement;
  const points: Array<{ t: number; v: number }> = [];
  for (const s of states) {
    const value = parsePriceState(s.state, unit);
    const stamp = s.last_changed ?? s.last_updated;
    if (value === null || !stamp) continue;
    points.push({ t: Date.parse(stamp), v: value });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

function integrateCumulativeEnergy(
  energyPoints: readonly { t: number; v: number }[],
  fallbackPrice: number,
  pricePoints: readonly { t: number; v: number }[],
): number {
  if (energyPoints.length < 2) return 0;
  const priceAt = (time: number): number => {
    let value = fallbackPrice;
    for (const point of pricePoints) {
      if (point.t > time) break;
      value = point.v;
    }
    return value;
  };
  let total = 0;
  for (let i = 1; i < energyPoints.length; i++) {
    const previous = energyPoints[i - 1]!;
    const current = energyPoints[i]!;
    let delta = current.v - previous.v;
    if (delta < 0) delta = current.v; // total_increasing reset
    if (delta <= 0) continue;
    total += delta * priceAt(current.t);
  }
  return total;
}

/**
 * Calculate today's signed grid financial balance from cumulative import/export energy.
 * Positive = net feed-in revenue. Negative = net import cost.
 */
export async function fetchTodayGridFinancials(
  hass: Hass,
  importEnergyEntity: string | undefined,
  exportEnergyEntity: string | undefined,
  pricing: ResolvedPricingConfig,
  now = Date.now(),
): Promise<TodayGridFinancials | null> {
  if (!hass.callApi || pricing.mode === 'none') return null;
  const importState = importEnergyEntity ? hass.states[importEnergyEntity] : undefined;
  const exportState = exportEnergyEntity ? hass.states[exportEnergyEntity] : undefined;
  if (!importState && !exportState) return null;

  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);
  const start = startDate.getTime();
  const ids: string[] = [];
  if (importEnergyEntity) ids.push(importEnergyEntity);
  if (exportEnergyEntity && exportEnergyEntity !== importEnergyEntity) ids.push(exportEnergyEntity);
  if (pricing.mode === 'entities') {
    if (pricing.importPriceEntity && !ids.includes(pricing.importPriceEntity)) ids.push(pricing.importPriceEntity);
    if (pricing.exportPriceEntity && !ids.includes(pricing.exportPriceEntity)) ids.push(pricing.exportPriceEntity);
  }
  if (ids.length === 0) return null;

  const path = `history/period/${new Date(start).toISOString()}?filter_entity_id=${encodeURIComponent(ids.join(','))}` +
    `&end_time=${encodeURIComponent(new Date(now).toISOString())}&minimal_response&no_attributes&significant_changes_only`;

  try {
    const response = await hass.callApi<RawHistoryState[][]>('GET', path);
    const byId = rawHistoryMap(response, ids);
    const currentPrices = readPrices(pricing, hass);
    const importPrice = currentPrices.importPrice;
    const exportPrice = currentPrices.exportPrice;

    const importPricePoints = pricing.mode === 'entities' && pricing.importPriceEntity
      ? historicPricePoints(byId.get(pricing.importPriceEntity) ?? [], hass.states[pricing.importPriceEntity])
      : [];
    const exportPricePoints = pricing.mode === 'entities' && pricing.exportPriceEntity
      ? historicPricePoints(byId.get(pricing.exportPriceEntity) ?? [], hass.states[pricing.exportPriceEntity])
      : [];

    const importCost = importEnergyEntity && importState && importPrice !== null
      ? integrateCumulativeEnergy(cumulativeEnergyPoints(byId.get(importEnergyEntity) ?? [], importState, now), importPrice, importPricePoints)
      : 0;
    const exportRevenue = exportEnergyEntity && exportState && exportPrice !== null
      ? integrateCumulativeEnergy(cumulativeEnergyPoints(byId.get(exportEnergyEntity) ?? [], exportState, now), exportPrice, exportPricePoints)
      : 0;

    if ((importEnergyEntity && importPrice === null) || (exportEnergyEntity && exportPrice === null)) return null;
    return { importCost, exportRevenue, balance: exportRevenue - importCost };
  } catch {
    return null;
  }
}

/** Backwards-compatible helper: feed-in revenue only. */
export async function fetchTodayExportRevenue(
  hass: Hass,
  exportEnergyEntity: string,
  pricing: ResolvedPricingConfig,
  now = Date.now(),
): Promise<number | null> {
  const result = await fetchTodayGridFinancials(hass, undefined, exportEnergyEntity, pricing, now);
  return result?.exportRevenue ?? null;
}
