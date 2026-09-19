import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeConfig } from '../src/config/CardConfig';
import { applyBackupReadings, computeFlows, computeHomeReading, readNode } from '../src/helpers/flowHelper';
import type { NodeReading } from '../src/helpers/flowHelper';
import { describeNode } from '../src/renderer/NodeRenderer';
import { EntityStatus } from '../src/types/EntityStatus';
import type { Hass } from '../src/types/hass';

const state = (s: string, unit = 'W') => ({ state: s, attributes: { unit_of_measurement: unit } });

function setup(states: Hass['states'], extra: Record<string, unknown> = {}) {
  const cfg = normalizeConfig({
    nodes: [
      { name: 'Net', type: 'grid', power_entity: 'sensor.grid' },
      { name: 'PV', type: 'solar', power_entity: 'sensor.pv' },
      { name: 'Accu', type: 'battery', power_entity: 'sensor.bat', soc_entity: 'sensor.soc' },
      { name: 'Auto', type: 'ev_charger', power_entity: 'sensor.ev' },
    ],
    ...extra,
  });
  const hass: Hass = { states };
  const readings = new Map<string, NodeReading>();
  for (const n of cfg.nodes) if (n.role !== 'home') readings.set(n.id, readNode(n, hass));
  const flows = computeFlows(cfg.nodes, cfg.connections, readings, hass);
  const flow = (from: string, to: string) => flows.get(cfg.connections.find((c) => c.from === from && c.to === to)!.id);
  return { cfg, hass, readings, flows, flow };
}

const basis: Hass['states'] = {
  'sensor.grid': state('1200'),
  'sensor.pv': state('4250'),
  'sensor.bat': state('-520'),
  'sensor.soc': state('78', '%'),
  'sensor.ev': state('0'),
};

describe('richting van de energiestroom', () => {
  it('netafname beweegt van Net naar Home', () => {
    const { flow } = setup(basis);
    assert.equal(flow('net', 'home'), 1200);
  });
  it('teruglevering (negatief) beweegt van Home naar Net', () => {
    const { flow } = setup({ ...basis, 'sensor.grid': state('-800') });
    assert.equal(flow('net', 'home'), -800);
  });
  it('zonnepanelen leveren aan Home', () => {
    assert.equal(setup(basis).flow('pv', 'home'), 4250);
  });
  it('een verbruiker neemt van Home af', () => {
    const { flow } = setup({ ...basis, 'sensor.ev': state('3700') });
    assert.equal(flow('home', 'auto'), 3700);
  });
  it('batterij kan beide kanten op: negatief = laden', () => {
    assert.equal(setup(basis).flow('accu', 'home'), -520);
    assert.equal(setup({ ...basis, 'sensor.bat': state('900') }).flow('accu', 'home'), 900);
  });
  it('0 W is een geldige, stilstaande stroom (geen null)', () => {
    assert.equal(setup(basis).flow('home', 'auto'), 0);
  });
  it('een ongeldige sensor geeft een onbekende stroom (null)', () => {
    assert.equal(setup({ ...basis, 'sensor.pv': state('unavailable') }).flow('pv', 'home'), null);
  });
  it('een verbinding zonder bidirectioneel klemt negatieve waarden op 0', () => {
    const { flow } = setup({ ...basis, 'sensor.pv': state('-50') });
    assert.equal(flow('pv', 'home'), 0);
  });
  it('kW-sensoren worden omgerekend', () => {
    assert.equal(setup({ ...basis, 'sensor.pv': state('4.25', 'kW') }).flow('pv', 'home'), 4250);
  });
  it('invert draait het teken van de node om', () => {
    const cfg = normalizeConfig({ nodes: [{ name: 'Net', type: 'grid', power_entity: 'sensor.grid', invert: true }] });
    const hass: Hass = { states: { 'sensor.grid': state('300') } };
    const readings = new Map([['net', readNode(cfg.nodes[1]!, hass)]]);
    const flows = computeFlows(cfg.nodes, cfg.connections, readings, hass);
    assert.equal([...flows.values()][0], -300);
  });
});

describe('eigen flow-sensor op een verbinding', () => {
  it('gebruikt de sensor: positief = van from naar to', () => {
    const { flow } = setup(basis, {
      connections: [{ from: 'PV', to: 'Accu', entity: 'sensor.pv_naar_accu' }],
    });
    const cfg = setup(basis).cfg;
    void cfg;
    const s = setup({ ...basis, 'sensor.pv_naar_accu': state('-150') }, { connections: [{ from: 'PV', to: 'Accu', entity: 'sensor.pv_naar_accu', bidirectional: true }] });
    assert.equal(s.flow('pv', 'accu'), -150);
    assert.equal(flow('pv', 'accu'), null); // sensor bestaat niet in de eerste opzet
  });
});

describe('verbinding tussen twee nodes zonder Home', () => {
  it('schat de stroom als het kleinste van aanbod en vraag', () => {
    const { flow } = setup(basis, { connections: [{ from: 'PV', to: 'Accu' }] });
    assert.equal(flow('pv', 'accu'), 520); // PV levert 4250, batterij laadt 520
  });
});

describe('Home-waarde: wat er in de woning gebeurt', () => {
  const homeOf = (cfg: ReturnType<typeof setup>['cfg']) => cfg.nodes.find((n) => n.role === 'home')!;

  it('is net + zon + batterij; de losse apparaten zijn er een deel van en gaan er niet af', () => {
    const { cfg, flows } = setup({ ...basis, 'sensor.ev': state('1000') });
    const r = computeHomeReading(homeOf(cfg), cfg.nodes, cfg.connections, flows);
    // Net 1200 + PV 4250 + batterij (laadt: -520) = 4930, ook al laadt de auto 1000 W
    assert.equal(r.watts, 4930);
    assert.equal(r.status, EntityStatus.Valid);
  });
  it('telt teruglevering en batterij-ontladen mee', () => {
    const { cfg, flows } = setup({ ...basis, 'sensor.grid': state('-800'), 'sensor.bat': state('300') });
    // Teruglevering -800 + PV 4250 + ontladen 300 = 3750
    assert.equal(computeHomeReading(homeOf(cfg), cfg.nodes, cfg.connections, flows).watts, 3750);
  });
  it('is nooit negatief', () => {
    const { cfg, flows } = setup({ ...basis, 'sensor.grid': state('-5000'), 'sensor.pv': state('0') });
    assert.equal(computeHomeReading(homeOf(cfg), cfg.nodes, cfg.connections, flows).watts, 0);
  });
  it('blijft de bekende energiestromen tonen als één bron uitvalt', () => {
    const { cfg, flows } = setup({ ...basis, 'sensor.grid': state('unavailable') });
    const r = computeHomeReading(homeOf(cfg), cfg.nodes, cfg.connections, flows);
    assert.equal(r.status, EntityStatus.Valid);
    assert.equal(r.watts, 3730); // PV 4250 + batterij laden -520; onbekend net wordt niet als 0-sensor op de kaart gezet.
  });
  it('blijft een waarde tonen als een los apparaat geen sensor heeft', () => {
    const { cfg, flows } = setup({ ...basis, 'sensor.ev': state('unavailable') });
    const r = computeHomeReading(homeOf(cfg), cfg.nodes, cfg.connections, flows);
    assert.equal(r.status, EntityStatus.Valid);
    assert.equal(r.watts, 4930);
  });
  it('is zonder net, zon en batterij de som van de apparaten', () => {
    const cfg = normalizeConfig({
      nodes: [
        { name: 'PC', type: 'consumer', power_entity: 'sensor.pc' },
        { name: 'Bureau', type: 'consumer', power_entity: 'sensor.bureau' },
      ],
    });
    const hass: Hass = { states: { 'sensor.pc': state('72'), 'sensor.bureau': state('230') } };
    const readings = new Map<string, NodeReading>();
    for (const n of cfg.nodes) if (n.role !== 'home') readings.set(n.id, readNode(n, hass));
    const flows = computeFlows(cfg.nodes, cfg.connections, readings, hass);
    const home = cfg.nodes.find((n) => n.role === 'home')!;
    assert.equal(computeHomeReading(home, cfg.nodes, cfg.connections, flows).watts, 302);
  });
  it('negeert een power_entity op Home: Home wordt altijd berekend', () => {
    const cfg = normalizeConfig({ nodes: [{ type: 'home', power_entity: 'sensor.huis' }, { name: 'Net', type: 'grid', power_entity: 'sensor.grid' }] });
    const hass: Hass = { states: { 'sensor.huis': state('9999'), 'sensor.grid': state('400') } };
    const readings = new Map<string, NodeReading>([[cfg.nodes[1]!.id, readNode(cfg.nodes[1]!, hass)]]);
    const flows = computeFlows(cfg.nodes, cfg.connections, readings, hass);
    assert.equal(computeHomeReading(cfg.nodes[0]!, cfg.nodes, cfg.connections, flows).watts, 400);
  });
  it('kent een backup-node die van Home afneemt', () => {
    const cfg = normalizeConfig({ nodes: [{ name: 'Net', type: 'grid', power_entity: 'sensor.grid' }, { name: 'Backup', type: 'backup', power_entity: 'sensor.bk' }] });
    const conn = cfg.connections.find((c) => c.to === 'backup');
    assert.ok(conn && conn.from === 'home', 'backup wordt gevoed door Home');
  });
});

describe('batterij', () => {
  it('combineert aparte laad- en ontlaadsensoren', () => {
    const cfg = normalizeConfig({
      nodes: [{ name: 'Accu', type: 'battery', charge_power_entity: 'sensor.c', discharge_power_entity: 'sensor.d' }],
    });
    const hass: Hass = { states: { 'sensor.c': state('0'), 'sensor.d': state('640') } };
    const r = readNode(cfg.nodes[1]!, hass);
    assert.equal(r.watts, 640);
    assert.equal(r.charging, false);
    const laden = readNode(cfg.nodes[1]!, { states: { 'sensor.c': state('700'), 'sensor.d': state('0') } });
    assert.equal(laden.watts, -700);
    assert.equal(laden.charging, true);
  });
  it('geeft ? als een van beide sensoren ontbreekt', () => {
    const cfg = normalizeConfig({
      nodes: [{ name: 'Accu', type: 'battery', charge_power_entity: 'sensor.c', discharge_power_entity: 'sensor.d' }],
    });
    const r = readNode(cfg.nodes[1]!, { states: { 'sensor.c': state('0') } });
    assert.equal(r.watts, null);
    assert.equal(r.status, EntityStatus.Invalid);
  });
});

describe('describeNode (wat er op de kaart staat)', () => {
  const ctx = { powerFormat: 'w' as const, language: 'nl' };

  it('toont de batterij als 78% en 520 W met laadindicator', () => {
    const { cfg, readings } = setup(basis);
    const bat = cfg.nodes.find((n) => n.id === 'accu')!;
    const v = describeNode(bat, readings.get('accu')!, ctx);
    assert.equal(v.socText, '78%');
    assert.equal(v.valueText, '520 W');
    assert.equal(v.status, EntityStatus.Charging);
    assert.equal(v.subtitle, 'Laden');
    assert.equal(v.level, 0.78);
  });
  it('toont "0 W" voor een geldige nul', () => {
    const { cfg, readings } = setup(basis);
    const v = describeNode(cfg.nodes.find((n) => n.id === 'auto')!, readings.get('auto')!, ctx);
    assert.equal(v.valueText, '0 W');
    assert.equal(v.status, EntityStatus.Zero);
  });
  it('toont ? voor unknown en ! voor unavailable', () => {
    const unknown = setup({ ...basis, 'sensor.pv': state('unknown') });
    assert.equal(describeNode(unknown.cfg.nodes.find((n) => n.id === 'pv')!, unknown.readings.get('pv')!, ctx).valueText, '?');
    const gone = setup({ ...basis, 'sensor.pv': state('unavailable') });
    assert.equal(describeNode(gone.cfg.nodes.find((n) => n.id === 'pv')!, gone.readings.get('pv')!, ctx).valueText, '!');
    const junk = setup({ ...basis, 'sensor.pv': state('rommel') });
    assert.equal(describeNode(junk.cfg.nodes.find((n) => n.id === 'pv')!, junk.readings.get('pv')!, ctx).valueText, '?');
  });
  it('geeft aan of het net afneemt of teruglevert', () => {
    const a = setup(basis);
    assert.equal(describeNode(a.cfg.nodes.find((n) => n.id === 'net')!, a.readings.get('net')!, ctx).subtitle, 'Afname');
    const b = setup({ ...basis, 'sensor.grid': state('-10') });
    assert.equal(describeNode(b.cfg.nodes.find((n) => n.id === 'net')!, b.readings.get('net')!, ctx).subtitle, 'Teruglevering');
  });
});

describe('backup met apparaten erachter', () => {
  const build = (states: Hass['states'], backupSensor?: string) => {
    const cfg = normalizeConfig({
      nodes: [
        { name: 'Net', type: 'grid', power_entity: 'sensor.grid' },
        { name: 'Backup', type: 'backup', ...(backupSensor ? { power_entity: backupSensor } : {}) },
        { name: 'Server', type: 'consumer', power_entity: 'sensor.server', connected_to: 'Backup' },
        { name: 'Koelkast', type: 'consumer', power_entity: 'sensor.fridge', connected_to: 'Backup' },
        { name: 'PC', type: 'consumer', power_entity: 'sensor.pc' },
      ],
    });
    const hass: Hass = { states };
    const readings = new Map<string, NodeReading>();
    for (const n of cfg.nodes) if (n.role !== 'home') readings.set(n.id, readNode(n, hass));
    applyBackupReadings(cfg.nodes, cfg.connections, readings, false);
    const flows = computeFlows(cfg.nodes, cfg.connections, readings, hass);
    const flow = (from: string, to: string) => flows.get(cfg.connections.find((c) => c.from === from && c.to === to)!.id);
    return { cfg, readings, flows, flow };
  };
  const states = { 'sensor.grid': state('500'), 'sensor.server': state('120'), 'sensor.fridge': state('80'), 'sensor.pc': state('72') };

  it('is zonder eigen sensor de som van de apparaten erachter', () => {
    const { readings } = build(states);
    assert.equal(readings.get('backup')!.watts, 200);
    assert.equal(readings.get('backup')!.status, EntityStatus.Valid);
  });
  it('voedt de apparaten vanuit de backup en de backup vanuit Home', () => {
    const { flow } = build(states);
    assert.equal(flow('backup', 'server'), 120);
    assert.equal(flow('backup', 'koelkast'), 80);
    assert.equal(flow('home', 'backup'), 200);
    assert.equal(flow('home', 'pc'), 72);
  });
  it('gebruikt de eigen sensor van de backup als die er is', () => {
    const { readings, flow } = build({ ...states, 'sensor.bk': state('260') }, 'sensor.bk');
    assert.equal(readings.get('backup')!.watts, 260);
    assert.equal(flow('home', 'backup'), 260);
  });
  it('is onbekend (?) als een apparaat erachter uitvalt, zonder de rest te storen', () => {
    const { readings, flow } = build({ ...states, 'sensor.fridge': state('unavailable') });
    assert.equal(readings.get('backup')!.status, EntityStatus.Invalid);
    assert.equal(flow('home', 'pc'), 72);
  });
  it('telt de apparaten achter een backup niet dubbel mee in Home', () => {
    const { cfg, flows } = build(states);
    const home = cfg.nodes.find((n) => n.role === 'home')!;
    assert.equal(computeHomeReading(home, cfg.nodes, cfg.connections, flows).watts, 500);
  });
});


describe('hiërarchische verbruikers v0.14', () => {
  it('gebruikt parentvermogen voor de Home-tak en childvermogen voor de uitsplitsing', () => {
    const cfg = normalizeConfig({
      nodes: [
        { name: 'Bureau', type: 'consumer', power_entity: 'sensor.desk' },
        { name: 'Computer', type: 'consumer', power_entity: 'sensor.pc', connected_to: 'Bureau' },
        { name: 'TV', type: 'consumer', power_entity: 'sensor.tv', connected_to: 'Bureau' },
      ],
    });
    const hass: Hass = { states: { 'sensor.desk': state('500'), 'sensor.pc': state('220'), 'sensor.tv': state('90') } };
    const readings = new Map<string, NodeReading>();
    for (const n of cfg.nodes) if (n.role !== 'home') readings.set(n.id, readNode(n, hass));
    const flows = computeFlows(cfg.nodes, cfg.connections, readings, hass);
    const value = (from: string, to: string) => flows.get(cfg.connections.find((c) => c.from === from && c.to === to)!.id);
    assert.equal(value('home', 'bureau'), 500);
    assert.equal(value('bureau', 'computer'), 220);
    assert.equal(value('bureau', 'tv'), 90);
  });
});
