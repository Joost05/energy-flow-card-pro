import type { Connection } from '../models/Connection';
import type { EnergyNode } from '../models/Node';
import type { Hass } from '../types/hass';
import { EntityStatus } from '../types/EntityStatus';
import type { NodeReading } from './flowHelper';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface DiagnosticItem {
  code: string;
  severity: DiagnosticSeverity;
  /** i18n key for the short diagnostic label. */
  labelKey: string;
  /** Optional entity or other detail used by the popup. */
  detail?: string;
  /** Optional numeric value in watts. */
  watts?: number;
  /** Optional age in minutes for stale entities. */
  minutes?: number;
}

export interface DiagnosticReport {
  byNode: Map<string, DiagnosticItem[]>;
  /** Difference between measured Home power and the source-side energy balance. */
  balanceDifferenceWatts: number | null;
  /** Home power that is not represented by explicitly configured consumer nodes. */
  unmeteredConsumptionWatts: number | null;
}

export interface DiagnosticOptions {
  staleMinutes?: number;
  balanceToleranceWatts?: number;
}

const DEFAULT_STALE_MINUTES = 15;
const DEFAULT_BALANCE_TOLERANCE_WATTS = 100;

function add(map: Map<string, DiagnosticItem[]>, id: string, item: DiagnosticItem): void {
  map.set(id, [...(map.get(id) ?? []), item]);
}

function primaryPowerEntities(node: EnergyNode): string[] {
  if (node.groupMembers?.length) return [];
  if (node.type === 'battery' && node.config.charge_power_entity && node.config.discharge_power_entity) {
    return [node.config.charge_power_entity, node.config.discharge_power_entity];
  }
  const id = node.config.power_entity ?? node.config.production_entity;
  return id ? [id] : [];
}

function entityAgeMinutes(hass: Hass, entityId: string, now: number): number | null {
  const entity = hass.states[entityId];
  if (!entity) return null;
  const stamp = entity.last_updated ?? entity.last_changed;
  if (!stamp) return null;
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, (now - ms) / 60_000);
}

function sourceBalanceAtHome(
  homeId: string,
  nodes: readonly EnergyNode[],
  connections: readonly Connection[],
  flows: ReadonlyMap<string, number | null>,
): { value: number; known: number; total: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let value = 0;
  let known = 0;
  let total = 0;
  for (const conn of connections) {
    if (conn.from !== homeId && conn.to !== homeId) continue;
    const otherId = conn.from === homeId ? conn.to : conn.from;
    const other = byId.get(otherId);
    if (!other || other.role === 'consumer') continue;
    total++;
    const flow = flows.get(conn.id);
    if (flow === null || flow === undefined) continue;
    known++;
    value += conn.to === homeId ? flow : -flow;
  }
  return { value, known, total };
}

/**
 * Lightweight live diagnostics. It deliberately avoids guessing electrical faults: it only reports
 * sensor health, a measurable Home/source mismatch and how much Home load is not represented by
 * explicitly configured consumer nodes.
 */
export function computeDiagnostics(
  nodes: readonly EnergyNode[],
  connections: readonly Connection[],
  readings: ReadonlyMap<string, NodeReading>,
  sourceFlows: ReadonlyMap<string, number | null>,
  hass: Hass | undefined,
  options: DiagnosticOptions = {},
  now = Date.now(),
): DiagnosticReport {
  const byNode = new Map<string, DiagnosticItem[]>();
  const staleMinutes = options.staleMinutes ?? DEFAULT_STALE_MINUTES;
  const balanceTolerance = options.balanceToleranceWatts ?? DEFAULT_BALANCE_TOLERANCE_WATTS;

  if (hass) {
    for (const node of nodes) {
      const primary = primaryPowerEntities(node);
      if (node.role !== 'home' && node.type !== 'backup' && !node.groupMembers?.length && primary.length === 0) {
        add(byNode, node.id, { code: 'sensor_not_configured', severity: 'warning', labelKey: 'diag_sensor_not_configured' });
      }
      for (const entityId of primary) {
        const entity = hass.states[entityId];
        if (!entity) {
          add(byNode, node.id, { code: 'sensor_missing', severity: 'error', labelKey: 'diag_sensor_missing', detail: entityId });
          continue;
        }
        if (entity.state === 'unavailable') {
          add(byNode, node.id, { code: 'sensor_unavailable', severity: 'error', labelKey: 'diag_sensor_unavailable', detail: entityId });
          continue;
        }
        if (entity.state === 'unknown') {
          add(byNode, node.id, { code: 'sensor_unknown', severity: 'warning', labelKey: 'diag_sensor_unknown', detail: entityId });
          continue;
        }
        const age = entityAgeMinutes(hass, entityId, now);
        if (age !== null && age > staleMinutes) {
          add(byNode, node.id, { code: 'sensor_stale', severity: 'warning', labelKey: 'diag_sensor_stale', detail: entityId, minutes: age });
        }
      }
    }
  }

  const home = nodes.find((node) => node.role === 'home');
  let balanceDifferenceWatts: number | null = null;
  let unmeteredConsumptionWatts: number | null = null;

  if (home) {
    const homeReading = readings.get(home.id);
    const measuredHome = !!home.config.power_entity;
    if (homeReading?.watts !== null && homeReading?.watts !== undefined) {
      // Only call this a true balance diagnostic when Home is independently measured.
      if (measuredHome) {
        const source = sourceBalanceAtHome(home.id, nodes, connections, sourceFlows);
        if (source.total > 0 && source.known === source.total) {
          balanceDifferenceWatts = homeReading.watts - Math.max(0, source.value);
          if (Math.abs(balanceDifferenceWatts) > balanceTolerance) {
            add(byNode, home.id, {
              code: 'balance_mismatch',
              severity: 'warning',
              labelKey: 'diag_balance_difference',
              watts: balanceDifferenceWatts,
            });
          }
        }
      }

      // Sum explicitly metered leaf consumers. Backup is excluded because it is an aggregate of its children.
      let consumerTotal = 0;
      let knownConsumers = 0;
      for (const node of nodes) {
        if (node.role !== 'consumer' || node.type === 'backup') continue;
        const reading = readings.get(node.id);
        if (!reading || reading.watts === null) continue;
        knownConsumers++;
        consumerTotal += Math.max(0, reading.watts);
      }
      if (knownConsumers > 0) {
        unmeteredConsumptionWatts = homeReading.watts - consumerTotal;
        if (unmeteredConsumptionWatts < -balanceTolerance) {
          add(byNode, home.id, {
            code: 'consumers_exceed_home',
            severity: 'warning',
            labelKey: 'diag_consumers_exceed_home',
            watts: -unmeteredConsumptionWatts,
          });
        }
      }
    }
  }

  return { byNode, balanceDifferenceWatts, unmeteredConsumptionWatts };
}

export function highestSeverity(items: readonly DiagnosticItem[] | undefined): DiagnosticSeverity | undefined {
  if (!items?.length) return undefined;
  if (items.some((item) => item.severity === 'error')) return 'error';
  if (items.some((item) => item.severity === 'warning')) return 'warning';
  return 'info';
}
