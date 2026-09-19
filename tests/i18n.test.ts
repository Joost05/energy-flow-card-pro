import assert from 'node:assert/strict';
import test from 'node:test';
import { hassLanguage, t } from '../src/helpers/i18n';

test('uses Dutch when Home Assistant language is Dutch', () => {
  assert.equal(t('current_power', 'nl-NL'), 'Huidig vermogen');
});

test('uses English when Home Assistant language is English', () => {
  assert.equal(t('current_power', 'en-GB'), 'Current power');
  assert.equal(t('energy_consumed_total', 'en-US'), 'Consumed in total');
});

test('locale language has priority over legacy language', () => {
  assert.equal(hassLanguage({ language: 'nl', locale: { language: 'en-GB' } }), 'en-GB');
  assert.equal(hassLanguage({ language: 'nl' }), 'nl');
});


test('phase graph labels are translated', () => {
  assert.equal(t('show_phases', 'nl-NL'), 'Toon fasen');
  assert.equal(t('show_phases', 'en-GB'), 'Show phases');
  assert.equal(t('phase_l1_power', 'nl'), 'L1 vermogen');
  assert.equal(t('phase_l1_power', 'en'), 'L1 power');
});

test('calculated L1 labels are translated', () => {
  assert.equal(t('phase_l1_power_calculated', 'nl-NL'), 'L1 vermogen (berekend)');
  assert.equal(t('phase_l1_power_calculated', 'en-GB'), 'L1 power (calculated)');
});


test('energy statistics labels are translated', () => {
  assert.equal(t('energy_costs', 'nl-NL'), 'Energie & kosten');
  assert.equal(t('period_month', 'en-GB'), 'This month');
  assert.equal(t('stat_net_cost', 'nl-NL'), 'Netto kosten');
});
