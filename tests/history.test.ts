import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bucketize, fetchHistory, unitFactor } from '../src/helpers/historyHelper';
import type { Hass } from '../src/types/hass';

describe('history helper', () => {
  it('vraagt compacte significante geschiedenis op', async () => {
    let requested = '';
    const hass: Hass = {
      states: {},
      callApi: async (_method, path) => {
        requested = path;
        return [[{ state: '1', last_changed: '2026-09-19T12:00:00Z' }]] as never;
      },
    };
    await fetchHistory(hass, 'sensor.test_power', 24, 1000, false, Date.parse('2026-09-19T20:00:00Z'));
    assert.match(requested, /minimal_response/);
    assert.match(requested, /no_attributes/);
    assert.match(requested, /significant_changes_only/);
    assert.match(requested, /filter_entity_id=sensor.test_power/);
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
