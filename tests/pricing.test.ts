import test from 'node:test';
import assert from 'node:assert/strict';
import { currentGridRate, fetchTodayExportRevenue, formatPrice, readPrices } from '../src/helpers/pricingHelper';
import type { Hass } from '../src/types/hass';

test('fixed prices are read independently', () => {
  const p = readPrices({ mode: 'fixed', currency: 'EUR', importPrice: 0.31, exportPrice: 0.09 });
  assert.deepEqual(p, { importPrice: 0.31, exportPrice: 0.09 });
});

test('entity price in cents per kWh is normalized', () => {
  const hass: Hass = { states: { 'sensor.price': { state: '25.5', attributes: { unit_of_measurement: 'ct/kWh' } } } };
  const p = readPrices({ mode: 'entities', currency: 'EUR', importPriceEntity: 'sensor.price' }, hass);
  assert.equal(p.importPrice, 0.255);
});

test('grid rate uses import for positive and export for negative power', () => {
  assert.deepEqual(currentGridRate(2000, { importPrice: 0.3, exportPrice: 0.1 }), { kind: 'cost', value: 0.6 });
  assert.deepEqual(currentGridRate(-2000, { importPrice: 0.3, exportPrice: 0.1 }), { kind: 'revenue', value: 0.2 });
});


test('price display uses two decimals', () => {
  assert.match(formatPrice(0.35, 'EUR', 'nl-NL'), /0,35/);
  assert.doesNotMatch(formatPrice(0.35, 'EUR', 'nl-NL'), /0,3500/);
});

test('today export revenue uses cumulative export delta and fixed export tariff', async () => {
  const hass: Hass = {
    states: { 'sensor.export_energy': { state: '12', attributes: { unit_of_measurement: 'kWh' } } },
    callApi: async () => [[
      { entity_id: 'sensor.export_energy', state: '10', last_changed: new Date(Date.now() - 3600000).toISOString() },
      { state: '12', last_changed: new Date().toISOString() },
    ]],
  };
  const revenue = await fetchTodayExportRevenue(hass, 'sensor.export_energy', { mode: 'fixed', currency: 'EUR', exportPrice: 0.1 });
  assert.equal(revenue, 0.2);
});
