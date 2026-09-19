import type { ResolvedPricingConfig } from '../config/CardConfig';
import type { Hass } from '../types/hass';

export interface PriceReading {
  importPrice: number | null;
  exportPrice: number | null;
}

/** Supported supplier labels. Presets never call supplier APIs; they only guide entity selection. */
export const DYNAMIC_PROVIDERS = [
  'frank',
  'zonneplan',
  'tibber',
  'anwb',
  'nextenergy',
  'nordpool',
  'other',
] as const;
export type DynamicProvider = (typeof DYNAMIC_PROVIDERS)[number];

function parsePriceState(state: string, unit?: unknown): number | null {
  const value = Number(String(state).replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  // Normalize common cent/kWh units to currency/kWh.
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
  if (config.mode === 'entities' || config.mode === 'dynamic') {
    return {
      importPrice: entityPrice(hass, config.importPriceEntity),
      exportPrice: entityPrice(hass, config.exportPriceEntity),
    };
  }
  return { importPrice: null, exportPrice: null };
}

/** Cost/revenue rate in currency per hour from signed grid power. Positive grid = import, negative = export. */
export function currentGridRate(watts: number | null, prices: PriceReading): { kind: 'cost' | 'revenue' | 'none'; value: number | null } {
  if (watts === null || watts === 0) return { kind: 'none', value: 0 };
  if (watts > 0) {
    return { kind: 'cost', value: prices.importPrice === null ? null : (watts / 1000) * prices.importPrice };
  }
  return { kind: 'revenue', value: prices.exportPrice === null ? null : (Math.abs(watts) / 1000) * prices.exportPrice };
}

export function formatCurrency(value: number, currency = 'EUR', language?: string, digits = 2): string {
  try {
    return new Intl.NumberFormat(language || undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(digits)}`;
  }
}

export function formatPrice(value: number, currency = 'EUR', language?: string): string {
  return `${formatCurrency(value, currency, language, 4)}/kWh`;
}

/** Entity-name hints used by the dynamic-provider UI for sorting/suggestions only. */
export function providerKeywords(provider?: string): string[] {
  switch (provider) {
    case 'frank': return ['frank'];
    case 'zonneplan': return ['zonneplan'];
    case 'tibber': return ['tibber'];
    case 'anwb': return ['anwb'];
    case 'nextenergy': return ['nextenergy', 'next_energy'];
    case 'nordpool': return ['nordpool', 'nord_pool'];
    default: return [];
  }
}
