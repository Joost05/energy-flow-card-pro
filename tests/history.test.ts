import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bucketize, fetchHistory, fetchHistoryBatch, unitFactor } from '../src/helpers/historyHelper';
import type { Hass } from '../src/types/hass';

describe('history helper', () => {
  it('vraagt compacte significante geschiedenis op', async () => {
    let requested = '';
    const hass: Hass = {
      states: {},
      callApi: async (_method, path) => {
        requested = path;
        return [[{ entity_id: 'sensor.test_power', state: '1', last_changed: '2026-09-19T12:00:00Z' }]] as never;
      },
    };
    await fetchHistory(hass, 'sensor.test_power', 24, 1000, false, Date.parse('2026-09-19T20:00:00Z'));
    assert.match(requested, /minimal_response/);
    assert.match(requested, /no_attributes/);
    assert.match(requested, /significant_changes_only/);
    assert.match(requested, /filter_entity_id=sensor.test_power/);
  });

  it('haalt meerdere sensoren in één request op en rekent eenheden naar W', async () => {
    let requested = '';
    const hass: Hass = {
      states: {
        'sensor.grid': { state: '0', attributes: { unit_of_measurement: 'W' } },
        'sensor.pv': { state: '0', attributes: { unit_of_measurement: 'kW' } },
      },
      callApi: async (_method, path) => {
        requested = path;
        return [
          [{ entity_id: 'sensor.grid', state: '500', last_changed: '2026-09-19T12:00:00Z' }],
          [{ entity_id: 'sensor.pv', state: '1.5', last_changed: '2026-09-19T12:00:00Z' }],
        ] as never;
      },
    };
    const out = await fetchHistoryBatch(hass, ['sensor.grid', 'sensor.pv'], 24, Date.parse('2026-09-19T20:00:00Z'));
    assert.match(requested, /sensor.grid%2Csensor.pv/);
    assert.equal(out.get('sensor.grid')?.[0]?.v, 500);
    assert.equal(out.get('sensor.pv')?.[0]?.v, 1500);
  });

  it('bucketizeert naar maximaal het gevraagde aantal punten', () => {
    const points = Array.from({ length: 500 }, (_, i) => ({ t: i * 1000, v: i }));
    const out = bucketize(points, 0, 499_000, 96);
    assert.equal(out.length, 96);
    assert.equal(out.at(-1)?.v, 499);
  });

  it('rekent kW naar W om', () => {
    assert.equal(unitFactor('kW'), 1000);
  });
});
