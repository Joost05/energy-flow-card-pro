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
