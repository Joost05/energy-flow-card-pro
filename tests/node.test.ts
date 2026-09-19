import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advancedFieldsFor, fieldLabelKey } from '../src/models/Node';

describe('geavanceerde velden per apparaattype', () => {
  it('toont bij een gewone verbruiker spanning, stroom en verbruikte energie', () => {
    assert.deepEqual(advancedFieldsFor('consumer'), [
      'voltage_entity',
      'current_entity',
      'energy_today_entity',
      'energy_total_entity',
    ]);
    assert.equal(fieldLabelKey('energy_today_entity', 'consumer'), 'energy_consumed_today');
    assert.equal(fieldLabelKey('energy_total_entity', 'consumer'), 'energy_consumed_total');
  });

  it('gebruikt dezelfde verbruikslabels voor laadpaal, warmtepomp, boiler en airco', () => {
    for (const type of ['ev_charger', 'heat_pump', 'boiler', 'airco'] as const) {
      assert.ok(advancedFieldsFor(type).includes('voltage_entity'));
      assert.ok(advancedFieldsFor(type).includes('current_entity'));
      assert.equal(fieldLabelKey('energy_today_entity', type), 'energy_consumed_today');
      assert.equal(fieldLabelKey('energy_total_entity', type), 'energy_consumed_total');
    }
  });

  it('houdt productievelden bij zonnepanelen als productie gelabeld', () => {
    assert.ok(advancedFieldsFor('solar').includes('energy_today_entity'));
    assert.equal(fieldLabelKey('energy_today_entity', 'solar'), 'energy_today');
    assert.equal(fieldLabelKey('energy_total_entity', 'solar'), 'energy_total');
  });
});
