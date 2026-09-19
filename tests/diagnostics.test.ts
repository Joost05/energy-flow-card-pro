import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeConfig } from '../src/config/CardConfig';
import { computeDiagnostics } from '../src/helpers/diagnosticsHelper';
import { computeFlows, readNode, type NodeReading } from '../src/helpers/flowHelper';
import { EntityStatus } from '../src/types/EntityStatus';
import type { Hass } from '../src/types/hass';

const entity = (state: string, updated = new Date().toISOString()) => ({
  state,
  attributes: { unit_of_measurement: 'W' },
  last_updated: updated,
});

function setup(homePower = false) {
  const cfg = normalizeConfig({
    home_power_entity: homePower ? 'sensor.home' : undefined,
    nodes: [
      { name: 'Net', type: 'grid', power_entity: 'sensor.grid' },
      { name: 'PV', type: 'solar', power_entity: 'sensor.pv' },
      { name: 'PC', type: 'consumer', power_entity: 'sensor.pc' },
    ],
  });
  return cfg;
}

function compute(cfg: ReturnType<typeof setup>, hass: Hass) {
  const readings = new Map<string, NodeReading>();
  for (const n of cfg.nodes) if (n.role !== 'home') readings.set(n.id, readNode(n, hass));
  const flows = computeFlows(cfg.nodes, cfg.connections, readings, hass);
  const home = cfg.nodes.find((n) => n.role === 'home')!;
  if (home.config.power_entity) readings.set(home.id, readNode(home, hass));
  else readings.set(home.id, { status: EntityStatus.Valid, watts: 1000, charging: false });
  return { readings, flows };
}

describe('diagnostics', () => {
  it('detecteert een stale vermogenssensor', () => {
    const cfg = setup();
    const now = Date.now();
    const hass: Hass = { states: {
      'sensor.grid': entity('500', new Date(now - 31 * 60_000).toISOString()),
      'sensor.pv': entity('500'),
      'sensor.pc': entity('200'),
    } };
    const { readings, flows } = compute(cfg, hass);
    const report = computeDiagnostics(cfg.nodes, cfg.connections, readings, flows, hass, { staleMinutes: 15 }, now);
    assert.equal(report.byNode.get('net')?.[0]?.code, 'sensor_stale');
  });

  it('detecteert een ontbrekende entity', () => {
    const cfg = setup();
    const hass: Hass = { states: { 'sensor.pv': entity('500'), 'sensor.pc': entity('200') } };
    const { readings, flows } = compute(cfg, hass);
    const report = computeDiagnostics(cfg.nodes, cfg.connections, readings, flows, hass);
    assert.equal(report.byNode.get('net')?.[0]?.code, 'sensor_missing');
  });

  it('berekent overig/ongemeten woningverbruik', () => {
    const cfg = setup();
    const hass: Hass = { states: { 'sensor.grid': entity('500'), 'sensor.pv': entity('500'), 'sensor.pc': entity('200') } };
    const { readings, flows } = compute(cfg, hass);
    readings.set('home', { status: EntityStatus.Valid, watts: 1000, charging: false });
    const report = computeDiagnostics(cfg.nodes, cfg.connections, readings, flows, hass);
    assert.equal(report.unmeteredConsumptionWatts, 800);
  });

  it('waarschuwt bij een gemeten Home/source-balans die meer dan de tolerantie afwijkt', () => {
    const cfg = setup(true);
    const hass: Hass = { states: {
      'sensor.home': entity('900'),
      'sensor.grid': entity('500'),
      'sensor.pv': entity('500'),
      'sensor.pc': entity('200'),
    } };
    const { readings, flows } = compute(cfg, hass);
    const report = computeDiagnostics(cfg.nodes, cfg.connections, readings, flows, hass, { balanceToleranceWatts: 50 });
    assert.equal(report.balanceDifferenceWatts, -100);
    assert.equal(report.byNode.get('home')?.some((i) => i.code === 'balance_mismatch'), true);
  });
});
