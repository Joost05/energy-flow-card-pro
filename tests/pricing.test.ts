import test from 'node:test';
import assert from 'node:assert/strict';
import { currentGridRate, readPrices } from '../src/helpers/pricingHelper';
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
