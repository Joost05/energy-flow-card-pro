import { EntityStatus, hasValue } from '../types/EntityStatus';
import type { Hass, HassEntity } from '../types/hass';

/** Een uitgelezen waarde uit Home Assistant. `value` is alleen gevuld als er een geldig getal is. */
export interface EntityReading {
  status: EntityStatus;
  value: number | null;
}

export type PowerFormat = 'w' | 'kw' | 'auto';

// Home Assistant gebruikt een punt als decimaalteken; alles anders is voor ons geen getal.
const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Zet een Home Assistant-state om in een getal, in W als `unit` "kW" of "MW" is.
 * Geeft null bij alles wat geen gewoon getal is ("unknown", "unavailable", "", "abc").
 */
export function parsePower(value: unknown, unit?: unknown): number | null {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (!NUMBER_PATTERN.test(text)) return null;
    n = Number(text);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  if (u === 'kw') n *= 1000;
  else if (u === 'mw') n *= 1_000_000;
  return n;
}

export function getEntityStatus(entity: HassEntity | undefined): EntityStatus {
  if (!entity) return EntityStatus.Invalid;
  if (entity.state === 'unavailable') return EntityStatus.Unavailable;
  if (entity.state === 'unknown') return EntityStatus.Unknown;
  const value = parsePower(entity.state, entity.attributes?.unit_of_measurement);
  if (value === null) return EntityStatus.Invalid;
  return value === 0 ? EntityStatus.Zero : EntityStatus.Valid;
}

/** Leest het vermogen van een entiteit in W. */
export function readPower(hass: Hass | undefined, entityId: string | undefined): EntityReading {
  if (!hass || !entityId) return { status: EntityStatus.Invalid, value: null };
  const entity = hass.states[entityId];
  const status = getEntityStatus(entity);
  if (!hasValue(status) || !entity) return { status, value: null };
  return { status, value: parsePower(entity.state, entity.attributes?.unit_of_measurement) };
}

/** Leest een gewoon getal (bijvoorbeeld een percentage), zonder eenheidsomrekening. */
export function readNumber(hass: Hass | undefined, entityId: string | undefined): EntityReading {
  if (!hass || !entityId) return { status: EntityStatus.Invalid, value: null };
  const entity = hass.states[entityId];
  if (!entity) return { status: EntityStatus.Invalid, value: null };
  if (entity.state === 'unavailable') return { status: EntityStatus.Unavailable, value: null };
  if (entity.state === 'unknown') return { status: EntityStatus.Unknown, value: null };
  const value = parsePower(entity.state);
  if (value === null) return { status: EntityStatus.Invalid, value: null };
  return { status: value === 0 ? EntityStatus.Zero : EntityStatus.Valid, value };
}

/** 4250 → "4250 W" (of "4.25 kW" bij `kw`, en bij `auto` vanaf 1000 W). Het teken wordt niet getoond. */
export function formatPower(watts: number, format: PowerFormat = 'w'): string {
  const abs = Math.abs(watts);
  if (format === 'kw' || (format === 'auto' && abs >= 1000)) return `${round(abs / 1000, 2)} kW`;
  return `${Math.round(abs)} W`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function round(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}
