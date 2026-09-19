import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { ConfigError, normalizeConfig } from '../src/config/CardConfig';
import { advancedFieldsFor, generateId } from '../src/models/Node';
import { normalizeType } from '../src/types/NodeType';

describe('generateId', () => {
  it('maakt een leesbare id uit een naam', () => {
    assert.equal(generateId('Warmtepomp', new Set()), 'warmtepomp');
    assert.equal(generateId('Laadpaal Garage', new Set()), 'laadpaal_garage');
    assert.equal(generateId('Café  Zon!', new Set()), 'cafe_zon');
  });
  it('houdt ids uniek', () => {
    const taken = new Set(['laadpaal', 'laadpaal_2']);
    assert.equal(generateId('Laadpaal', taken), 'laadpaal_3');
  });
  it('valt terug op "node" bij een naam zonder tekens', () => {
    assert.equal(generateId('!!!', new Set()), 'node');
  });
});

describe('normalizeType', () => {
  it('herkent types en aliassen', () => {
    assert.equal(normalizeType('solar'), 'solar');
    assert.equal(normalizeType('PV'), 'solar');
    assert.equal(normalizeType('Heat Pump'), 'heat_pump');
    assert.equal(normalizeType('warmtepomp'), 'heat_pump');
    assert.equal(normalizeType('onzin'), null);
    assert.equal(normalizeType(undefined), null);
  });
});

describe('normalizeConfig', () => {
  const basis = {
    type: 'custom:energy-flow-card',
    nodes: [
      { name: 'Zonnepanelen', type: 'solar', power_entity: 'sensor.pv_power' },
      { name: 'Batterij', type: 'battery', power_entity: 'sensor.battery_power' },
    ],
  };

  it('maakt automatisch precies één Home-node', () => {
    const cfg = normalizeConfig(basis);
    assert.equal(cfg.nodes.filter((n) => n.role === 'home').length, 1);
    assert.equal(cfg.nodes.length, 3);
    assert.equal(cfg.nodes[0]!.id, 'home');
  });
  it('genereert unieke ids zonder dat de gebruiker er een kiest', () => {
    const cfg = normalizeConfig({ nodes: [{ name: 'Laadpaal', type: 'ev' }, { name: 'Laadpaal', type: 'ev' }] });
    const ids = cfg.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('laadpaal') && ids.includes('laadpaal_2'));
  });
  it('verbindt zonder connections alles met Home, in de natuurlijke richting', () => {
    const cfg = normalizeConfig({
      nodes: [
        { name: 'PV', type: 'solar' },
        { name: 'Warmtepomp', type: 'heat_pump' },
      ],
    });
    const pv = cfg.connections.find((c) => c.from === 'pv');
    const wp = cfg.connections.find((c) => c.to === 'warmtepomp');
    assert.equal(pv?.to, 'home');
    assert.equal(wp?.from, 'home');
    assert.equal(pv?.bidirectional, false);
  });
  it('markeert net- en batterijverbindingen als bidirectioneel', () => {
    const cfg = normalizeConfig({ nodes: [{ name: 'Net', type: 'grid' }, { name: 'Accu', type: 'battery' }] });
    assert.ok(cfg.connections.every((c) => c.bidirectional));
  });
  it('accepteert eigen connections op naam of id', () => {
    const cfg = normalizeConfig({
      ...basis,
      connections: [{ from: 'zonnepanelen', to: 'Batterij', color: '#ff0' }],
    });
    assert.equal(cfg.connections.length, 1);
    assert.equal(cfg.connections[0]!.from, 'zonnepanelen');
    assert.equal(cfg.connections[0]!.to, 'batterij');
    assert.equal(cfg.connections[0]!.color, '#ff0');
  });
  it('laat een lege lijst connections ook echt leeg', () => {
    assert.equal(normalizeConfig({ ...basis, connections: [] }).connections.length, 0);
  });
  it('staat een kaart zonder nodes toe (lege staat)', () => {
    assert.equal(normalizeConfig({ type: 'x' }).nodes.length, 1);
  });
  it('gebruikt voorbeeldapparaten bij demo zonder nodes', () => {
    const cfg = normalizeConfig({ demo: true });
    assert.equal(cfg.demo, true);
    assert.ok(cfg.nodes.length > 3);
  });

  describe('foutafhandeling', () => {
    it('weigert een onbekend type met uitleg', () => {
      assert.throws(() => normalizeConfig({ nodes: [{ name: 'X', type: 'raket' }] }), /onbekend/);
    });
    it('vereist een naam voor gewone nodes', () => {
      assert.throws(() => normalizeConfig({ nodes: [{ type: 'solar' }] }), /"name"/);
    });
    it('weigert twee Home-nodes', () => {
      assert.throws(() => normalizeConfig({ nodes: [{ type: 'home' }, { type: 'home' }] }), /één Home/);
    });
    it('weigert dubbele eigen ids', () => {
      assert.throws(
        () => normalizeConfig({ nodes: [{ id: 'a', name: 'A', type: 'solar' }, { id: 'a', name: 'B', type: 'grid' }] }),
        /meer dan één keer/,
      );
    });
    it('weigert verbindingen naar onbekende nodes', () => {
      assert.throws(() => normalizeConfig({ ...basis, connections: [{ from: 'Zonnepanelen', to: 'Spook' }] }), /bestaat niet/);
    });
    it('weigert een verbinding met zichzelf', () => {
      assert.throws(() => normalizeConfig({ ...basis, connections: [{ from: 'Batterij', to: 'batterij' }] }), /zichzelf/);
    });
    it('weigert ongeldige opties', () => {
      assert.throws(() => normalizeConfig({ power_format: 'mw' }), ConfigError);
      assert.throws(() => normalizeConfig({ max_power: -5 }), ConfigError);
      assert.throws(() => normalizeConfig({ nodes: 'nee' }), ConfigError);
      assert.throws(() => normalizeConfig(null), ConfigError);
    });
    it('weigert een ongeldige handmatige positie', () => {
      assert.throws(() => normalizeConfig({ layout: { positions: { X: { x: 'links' } } } }), /positie/i);
    });
  });
});

describe('apparaten achter een backup (connected_to)', () => {
  const nodes = [
    { name: 'Net', type: 'grid', power_entity: 'sensor.grid' },
    { name: 'Backup', type: 'backup' },
    { name: 'Server', type: 'consumer', power_entity: 'sensor.server', connected_to: 'Backup' },
    { name: 'PC', type: 'consumer', power_entity: 'sensor.pc' },
  ];
  it('hangt het apparaat aan de backup en de rest aan Home', () => {
    const cfg = normalizeConfig({ nodes });
    const pair = (from: string, to: string) => cfg.connections.some((c) => c.from === from && c.to === to);
    assert.ok(pair('home', 'backup'), 'backup hangt aan Home');
    assert.ok(pair('backup', 'server'), 'server hangt achter de backup');
    assert.ok(pair('home', 'pc'), 'pc hangt aan Home');
    assert.ok(!pair('home', 'server'), 'server hangt niet ook aan Home');
  });
  it('werkt ook met het id in plaats van de naam', () => {
    const cfg = normalizeConfig({ nodes: nodes.map((n) => (n.connected_to ? { ...n, connected_to: 'backup' } : n)) });
    assert.ok(cfg.connections.some((c) => c.from === 'backup' && c.to === 'server'));
  });
  it('geeft een duidelijke fout bij een onbekende of verkeerde verwijzing', () => {
    assert.throws(() => normalizeConfig({ nodes: nodes.map((n) => (n.connected_to ? { ...n, connected_to: 'Nergens' } : n)) }), /bestaat niet/);
    assert.throws(() => normalizeConfig({ nodes: nodes.map((n) => (n.connected_to ? { ...n, connected_to: 'PC' } : n)) }), /Home of een backup/);
    assert.throws(() => normalizeConfig({ nodes: [{ name: 'Zon', type: 'solar', power_entity: 'sensor.z', connected_to: 'Backup' }, nodes[1]] }), /alleen bij een apparaat/);
  });
  it('een handmatige lijst met verbindingen gaat voor', () => {
    const cfg = normalizeConfig({ nodes, connections: [{ from: 'Home', to: 'Server' }] });
    assert.deepEqual(cfg.connections.map((c) => `${c.from}>${c.to}`), ['home>server']);
  });
});

describe('weergave (layout.mode)', () => {
  it('is standaard Flow en accepteert de andere layouts', () => {
    assert.equal(normalizeConfig({ demo: true }).layout.mode, 'flow');
    assert.equal(normalizeConfig({ demo: true, layout: { mode: 'straight' } }).layout.mode, 'straight');
    assert.equal(normalizeConfig({ demo: true, layout: { mode: 'circle' } }).layout.mode, 'circle');
    assert.equal(normalizeConfig({ demo: true, layout: { mode: 'auto' } }).layout.mode, 'flow');
    assert.equal(normalizeConfig({ demo: true, layout: { mode: 'eniris' } }).layout.mode, 'flow');
  });
  it('weigert onbekende waarden', () => {
    assert.throws(() => normalizeConfig({ demo: true, layout: { mode: 'driehoek' } }), /layout\.mode/);
  });
});

describe('optionele apparaatgroepen', () => {
  it('valideert een groep en bewaart de onderliggende nodes', () => {
    const cfg = normalizeConfig({
      nodes: [
        { id: 'wp_1', name: 'WP 1', type: 'heat_pump', power_entity: 'sensor.wp1' },
        { id: 'wp_2', name: 'WP 2', type: 'heat_pump', power_entity: 'sensor.wp2' },
      ],
      groups: [{ id: 'wp', name: 'Warmtepompen', members: ['wp_1', 'wp_2'], display: 'grouped' }],
    });
    assert.equal(cfg.groups.length, 1);
    assert.deepEqual(cfg.groups[0]!.memberIds, ['wp_1', 'wp_2']);
    assert.equal(cfg.groups[0]!.type, 'heat_pump');
    assert.equal(cfg.nodes.filter((n) => n.type === 'heat_pump').length, 2);
  });

  it('kan dezelfde groep ook individueel weergeven', () => {
    const cfg = normalizeConfig({
      nodes: [{ name: 'A', type: 'consumer' }, { name: 'B', type: 'consumer' }],
      groups: [{ name: 'Samen', members: ['a', 'b'], display: 'individual' }],
    });
    assert.equal(cfg.groups[0]!.display, 'individual');
  });
});

test('pricing defaults to none and demo gets example fixed tariffs', () => {
  assert.equal(normalizeConfig({}).pricing.mode, 'none');
  const demo = normalizeConfig({ demo: true });
  assert.equal(demo.pricing.mode, 'fixed');
  assert.equal(demo.pricing.importPrice, 0.31);
  assert.equal(demo.pricing.exportPrice, 0.09);
});

test('fixed pricing accepts independent import and export tariffs', () => {
  const cfg = normalizeConfig({ pricing: { mode: 'fixed', import_price: 0.32, export_price: 0.08 } });
  assert.equal(cfg.pricing.importPrice, 0.32);
  assert.equal(cfg.pricing.exportPrice, 0.08);
});

test('legacy dynamic pricing is migrated to Home Assistant price entities', () => {
  const cfg = normalizeConfig({ pricing: { mode: 'dynamic', provider: 'frank', import_price_entity: 'sensor.buy', export_price_entity: 'sensor.sell' } });
  assert.equal(cfg.pricing.mode, 'entities');
  assert.equal(cfg.pricing.importPriceEntity, 'sensor.buy');
  assert.equal(cfg.pricing.exportPriceEntity, 'sensor.sell');
});


describe('three-phase grid configuration', () => {
  it('offers optional L1/L2/L3 power, voltage and current sensors for the grid', () => {
    const fields = advancedFieldsFor('grid');
    for (const field of [
      'phase_l1_power_entity', 'phase_l2_power_entity', 'phase_l3_power_entity',
      'phase_l1_voltage_entity', 'phase_l2_voltage_entity', 'phase_l3_voltage_entity',
      'phase_l1_current_entity', 'phase_l2_current_entity', 'phase_l3_current_entity',
    ]) assert.ok(fields.includes(field as never), field);
  });

  it('preserves phase entities in the normalized grid node', () => {
    const cfg = normalizeConfig({
      nodes: [{
        name: 'Net', type: 'grid', power_entity: 'sensor.grid',
        phase_l1_power_entity: 'sensor.l1', phase_l2_power_entity: 'sensor.l2', phase_l3_power_entity: 'sensor.l3',
      }],
    });
    const grid = cfg.nodes.find((node) => node.type === 'grid')!;
    assert.equal(grid.config.phase_l1_power_entity, 'sensor.l1');
    assert.equal(grid.config.phase_l3_power_entity, 'sensor.l3');
  });
});
