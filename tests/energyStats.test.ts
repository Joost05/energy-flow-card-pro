import test from 'node:test';
import assert from 'node:assert/strict';
import { demoEnergyStats, fetchEnergyStats } from '../src/helpers/energyStatsHelper';
import { normalizeConfig } from '../src/config/CardConfig';
import type { Hass } from '../src/types/hass';

test('demo energy stats expose positive usage and signed net cost', () => {
  const stats = demoEnergyStats('today', new Date('2026-09-19T12:00:00+02:00').getTime());
  assert.ok(stats.consumptionKWh > 0);
  assert.ok((stats.netCost ?? 0) > 0);
  assert.ok((stats.selfConsumptionPct ?? 0) > 0);
});

test('period stats combine grid, solar and battery energy counters', async () => {
  const now = new Date('2026-09-19T12:00:00+02:00').getTime();
  const cfg = normalizeConfig({
    type: 'custom:energy-flow-card-pro',
    pricing: { mode: 'none' },
    nodes: [
      { name: 'Net', type: 'grid', energy_import_entity: 'sensor.imp', energy_export_entity: 'sensor.exp' },
      { name: 'PV', type: 'solar', energy_total_entity: 'sensor.pv' },
      { name: 'Accu', type: 'battery', energy_charged_entity: 'sensor.chg', energy_discharged_entity: 'sensor.dis' },
    ],
  });
  const states = {
    'sensor.imp': { state: '110', attributes: { unit_of_measurement: 'kWh' } },
    'sensor.exp': { state: '52', attributes: { unit_of_measurement: 'kWh' } },
    'sensor.pv': { state: '230', attributes: { unit_of_measurement: 'kWh' } },
    'sensor.chg': { state: '34', attributes: { unit_of_measurement: 'kWh' } },
    'sensor.dis': { state: '29', attributes: { unit_of_measurement: 'kWh' } },
  };
  const start = new Date('2026-09-19T00:00:00+02:00').getTime();
  const baselines: Record<string, number> = { 'sensor.imp': 100, 'sensor.exp': 50, 'sensor.pv': 210, 'sensor.chg': 30, 'sensor.dis': 25 };
  const ids = ['sensor.imp', 'sensor.exp', 'sensor.pv', 'sensor.chg', 'sensor.dis'];
  const hass: Hass = {
    states,
    callApi: async () => ids.map((id) => [
      { entity_id: id, state: String(baselines[id]), last_changed: new Date(start).toISOString() },
      { state: states[id as keyof typeof states].state, last_changed: new Date(now).toISOString() },
    ]),
  };
  const stats = await fetchEnergyStats(hass, cfg, 'today', cfg.pricing, now);
  assert.ok(stats);
  assert.equal(stats.importKWh, 10);
  assert.equal(stats.exportKWh, 2);
  assert.equal(stats.solarKWh, 20);
  assert.equal(stats.batteryChargedKWh, 4);
  assert.equal(stats.batteryDischargedKWh, 4);
  assert.equal(stats.consumptionKWh, 28);
});
