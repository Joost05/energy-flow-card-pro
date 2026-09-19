import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, normalizeConfig } from '../src/config/CardConfig';
import { generateId } from '../src/models/Node';
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
