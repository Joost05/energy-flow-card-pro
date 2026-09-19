import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPower, getEntityStatus, parsePower, readPower } from '../src/helpers/stateHelper';
import { EntityStatus, statusSymbol } from '../src/types/EntityStatus';

describe('parsePower', () => {
  // De vier voorbeelden uit de projectbeschrijving
  it('leest een gewoon getal', () => assert.equal(parsePower('1250'), 1250));
  it('leest 0 als geldige nul', () => assert.equal(parsePower('0'), 0));
  it('geeft null bij "unknown"', () => assert.equal(parsePower('unknown'), null));
  it('geeft null bij "unavailable"', () => assert.equal(parsePower('unavailable'), null));

  it('leest decimalen en negatieve waarden', () => {
    assert.equal(parsePower('-520.5'), -520.5);
    assert.equal(parsePower('4.25e3'), 4250);
  });
  it('behandelt lege of witte tekst niet als 0', () => {
    assert.equal(parsePower(''), null);
    assert.equal(parsePower('   '), null);
  });
  it('wijst tekst en half-getallen af', () => {
    assert.equal(parsePower('abc'), null);
    assert.equal(parsePower('12 W'), null);
    assert.equal(parsePower('0x10'), null);
    assert.equal(parsePower('NaN'), null);
    assert.equal(parsePower('Infinity'), null);
  });
  it('wijst niet-tekst af', () => {
    assert.equal(parsePower(undefined), null);
    assert.equal(parsePower(null), null);
    assert.equal(parsePower({}), null);
    assert.equal(parsePower(Number.NaN), null);
  });
  it('rekent kW en MW om naar W', () => {
    assert.equal(parsePower('1.5', 'kW'), 1500);
    assert.equal(parsePower('2', 'MW'), 2_000_000);
    assert.equal(parsePower('750', 'W'), 750);
  });
});

describe('getEntityStatus', () => {
  it('kent alle vijf de basisstatussen', () => {
    assert.equal(getEntityStatus({ state: '1250', attributes: {} }), EntityStatus.Valid);
    assert.equal(getEntityStatus({ state: '0', attributes: {} }), EntityStatus.Zero);
    assert.equal(getEntityStatus({ state: 'kapot', attributes: {} }), EntityStatus.Invalid);
    assert.equal(getEntityStatus({ state: 'unknown', attributes: {} }), EntityStatus.Unknown);
    assert.equal(getEntityStatus({ state: 'unavailable', attributes: {} }), EntityStatus.Unavailable);
  });
  it('telt een ontbrekende entiteit als ongeldig', () => {
    assert.equal(getEntityStatus(undefined), EntityStatus.Invalid);
  });
  it('kiest het juiste symbool', () => {
    assert.equal(statusSymbol(EntityStatus.Invalid), '?');
    assert.equal(statusSymbol(EntityStatus.Unknown), '?');
    assert.equal(statusSymbol(EntityStatus.Unavailable), '!');
    assert.equal(statusSymbol(EntityStatus.Zero), null);
    assert.equal(statusSymbol(EntityStatus.Valid), null);
  });
});

describe('readPower', () => {
  const hass = {
    states: {
      'sensor.pv': { state: '2.4', attributes: { unit_of_measurement: 'kW' } },
      'sensor.uit': { state: 'unavailable', attributes: {} },
    },
  };
  it('rekent de eenheid van de sensor om', () => {
    assert.deepEqual(readPower(hass, 'sensor.pv'), { status: EntityStatus.Valid, value: 2400 });
  });
  it('geeft een status zonder waarde bij onbereikbare sensor', () => {
    assert.deepEqual(readPower(hass, 'sensor.uit'), { status: EntityStatus.Unavailable, value: null });
  });
  it('gaat goed om met ontbrekende hass of entiteit', () => {
    assert.equal(readPower(undefined, 'sensor.pv').value, null);
    assert.equal(readPower(hass, 'sensor.bestaat_niet').status, EntityStatus.Invalid);
    assert.equal(readPower(hass, undefined).status, EntityStatus.Invalid);
  });
});

describe('formatPower', () => {
  it('toont standaard watt', () => {
    assert.equal(formatPower(4250), '4250 W');
    assert.equal(formatPower(-520), '520 W');
    assert.equal(formatPower(0), '0 W');
  });
  it('ondersteunt kW en auto', () => {
    assert.equal(formatPower(4250, 'kw'), '4.25 kW');
    assert.equal(formatPower(999, 'auto'), '999 W');
    assert.equal(formatPower(1500, 'auto'), '1.5 kW');
  });
});
