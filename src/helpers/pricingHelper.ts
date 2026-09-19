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

/** Estimate today's feed-in revenue from the configured cumulative export-energy sensor.
 * For price entities, historic price changes are used when available.
 */
export async function fetchTodayExportRevenue(
  hass: Hass,
  exportEnergyEntity: string,
  pricing: ResolvedPricingConfig,
  now = Date.now(),
): Promise<number | null> {
  if (!hass.callApi || pricing.mode === 'none') return null;
  const energyState = hass.states[exportEnergyEntity];
  if (!energyState || energyState.state === 'unknown' || energyState.state === 'unavailable') return null;

  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);
  const start = startDate.getTime();
  const ids = [exportEnergyEntity];
  if (pricing.mode === 'entities' && pricing.exportPriceEntity) ids.push(pricing.exportPriceEntity);
  const path = `history/period/${new Date(start).toISOString()}?filter_entity_id=${encodeURIComponent(ids.join(','))}` +
    `&end_time=${encodeURIComponent(new Date(now).toISOString())}&minimal_response&no_attributes&significant_changes_only`;

  try {
    const response = await hass.callApi<RawHistoryState[][]>('GET', path);
    const byId = new Map<string, RawHistoryState[]>();
    for (let i = 0; i < (response ?? []).length; i++) {
      const arr = response?.[i] ?? [];
      const id = arr.find((x) => x.entity_id)?.entity_id ?? ids[i];
      if (id) byId.set(id, arr);
    }

    const energyUnit = energyState.attributes?.unit_of_measurement;
    const energyPoints: Array<{ t: number; v: number }> = [];
    for (const s of byId.get(exportEnergyEntity) ?? []) {
      const n = Number(String(s.state).replace(',', '.'));
      const stamp = s.last_changed ?? s.last_updated;
      if (!Number.isFinite(n) || !stamp) continue;
      energyPoints.push({ t: Date.parse(stamp), v: energyToKWh(n, energyUnit) });
    }
    const currentEnergy = Number(String(energyState.state).replace(',', '.'));
    if (Number.isFinite(currentEnergy)) energyPoints.push({ t: now, v: energyToKWh(currentEnergy, energyUnit) });
    energyPoints.sort((a, b) => a.t - b.t);
    if (energyPoints.length < 2) return null;

    const fixedPrice = pricing.mode === 'fixed' ? pricing.exportPrice ?? null : null;
    const currentPrice = pricing.mode === 'entities' ? entityPrice(hass, pricing.exportPriceEntity) : fixedPrice;
    if (currentPrice === null) return null;

    const pricePoints: Array<{ t: number; v: number }> = [];
    if (pricing.mode === 'entities' && pricing.exportPriceEntity) {
      const unit = hass.states[pricing.exportPriceEntity]?.attributes?.unit_of_measurement;
      for (const s of byId.get(pricing.exportPriceEntity) ?? []) {
        const v = parsePriceState(s.state, unit);
        const stamp = s.last_changed ?? s.last_updated;
        if (v === null || !stamp) continue;
        pricePoints.push({ t: Date.parse(stamp), v });
      }
      pricePoints.sort((a, b) => a.t - b.t);
    }

    const priceAt = (t: number): number => {
      if (fixedPrice !== null) return fixedPrice;
      let found = currentPrice;
      for (const p of pricePoints) {
        if (p.t > t) break;
        found = p.v;
      }
      return found;
    };

    let revenue = 0;
    for (let i = 1; i < energyPoints.length; i++) {
      const prev = energyPoints[i - 1]!;
      const cur = energyPoints[i]!;
      let delta = cur.v - prev.v;
      if (delta < 0) delta = cur.v; // total_increasing reset
      if (delta <= 0) continue;
      revenue += delta * priceAt(cur.t);
    }
    return revenue;
  } catch {
    return null;
  }
}
