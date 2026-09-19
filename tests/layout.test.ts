import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeConfig } from '../src/config/CardConfig';
import { NODE_RADIUS, computeLayout } from '../src/layout/AutoLayout';
import { computeGeometry, particleDuration } from '../src/renderer/ConnectionRenderer';
import { STRAIGHT_ROW_GAP } from '../src/layout/AutoLayout';

const many = (n: number) => ({
  layout: { mode: 'circle' as const },
  nodes: Array.from({ length: n }, (_, i) => ({ name: `Apparaat ${i + 1}`, type: 'consumer' })),
});

describe('automatische layout', () => {
  it('zet Home in het midden', () => {
    const cfg = normalizeConfig(many(4));
    const l = computeLayout(cfg.nodes, cfg.layout);
    assert.deepEqual(l.positions.get('home'), { x: l.width / 2, y: l.height / 2 });
  });
  it('plaatst het net links en de zon bovenin', () => {
    const cfg = normalizeConfig({
      layout: { mode: 'circle' },
      nodes: [
        { name: 'Zon', type: 'solar' },
        { name: 'Net', type: 'grid' },
        { name: 'Auto', type: 'ev_charger' },
        { name: 'Accu', type: 'battery' },
      ],
    });
    const l = computeLayout(cfg.nodes, cfg.layout);
    const p = (id: string) => l.positions.get(id)!;
    assert.ok(p('net').x < l.width / 2 - 50, 'net links');
    assert.ok(p('zon').y < l.height / 2 - 50, 'zon boven');
    assert.ok(p('auto').x > l.width / 2 + 50, 'verbruiker rechts');
    assert.ok(p('accu').y > l.height / 2 + 50, 'batterij onder');
  });
  it('groeit mee zonder harde limiet en houdt nodes uit elkaars buurt', () => {
    for (const n of [3, 8, 20, 60]) {
      const cfg = normalizeConfig(many(n));
      const l = computeLayout(cfg.nodes, cfg.layout);
      const pts = [...l.positions.entries()].filter(([id]) => id !== 'home').map(([, p]) => p);
      assert.equal(pts.length, n);
      let min = Infinity;
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
      assert.ok(min > NODE_RADIUS * 2, `n=${n}: nodes overlappen (afstand ${min.toFixed(0)})`);
      for (const p of pts) assert.ok(p.x >= 0 && p.x <= l.width && p.y >= 0 && p.y <= l.height);
    }
  });
  it('respecteert handmatige posities (in %) per naam of id', () => {
    const cfg = normalizeConfig({
      ...many(3),
      layout: { positions: { 'Apparaat 1': { x: 10, y: 20 }, apparaat_2: { x: 90, y: 80 } } },
    });
    const l = computeLayout(cfg.nodes, cfg.layout);
    assert.equal(l.positions.get('apparaat_1')!.x, l.width * 0.1);
    assert.equal(l.positions.get('apparaat_1')!.y, l.height * 0.2);
    assert.equal(l.positions.get('apparaat_2')!.x, l.width * 0.9);
    assert.ok(l.positions.has('apparaat_3'));
  });
});

describe('vaste plekken', () => {
  const layoutOf = (nodes: unknown[]) => {
    const cfg = normalizeConfig({ nodes, layout: { mode: 'circle' } });
    const l = computeLayout(cfg.nodes, cfg.layout);
    return { l, p: (id: string) => l.positions.get(id)! };
  };
  const all = [
    { name: 'Zon', type: 'solar' },
    { name: 'Net', type: 'grid' },
    { name: 'Accu', type: 'battery' },
    { name: 'Noodstroom', type: 'backup' },
  ];

  it('is altijd vierkant', () => {
    for (const n of [0, 1, 4, 9, 20]) {
      const cfg = normalizeConfig({ layout: { mode: 'circle' }, nodes: [...all, ...Array.from({ length: n }, (_, i) => ({ name: `Ding ${i}`, type: 'consumer' }))] });
      const l = computeLayout(cfg.nodes, cfg.layout);
      assert.equal(l.width, l.height);
    }
  });
  it('zet zon boven, net links, batterij onder en backup rechts, precies op de assen', () => {
    const { l, p } = layoutOf(all);
    const c = l.width / 2;
    assert.ok(Math.abs(p('zon').x - c) < 0.01 && p('zon').y < c - 100, 'zon boven');
    assert.ok(Math.abs(p('net').y - c) < 0.01 && p('net').x < c - 100, 'net links');
    assert.ok(Math.abs(p('accu').x - c) < 0.01 && p('accu').y > c + 100, 'accu onder');
    assert.ok(Math.abs(p('noodstroom').y - c) < 0.01 && p('noodstroom').x > c + 100, 'backup rechts');
  });
  it('plaatst de plek ook als er een ander apparaat eerder in de lijst staat', () => {
    const { l, p } = layoutOf([{ name: 'PC', type: 'consumer' }, ...all]);
    assert.ok(p('net').x < l.width / 2 - 100);
    assert.ok(p('zon').y < l.height / 2 - 100);
  });
  it('zet gewone apparaten op de diagonalen en laat de vaste plekken vrij', () => {
    const devices = ['A', 'B', 'C', 'D'].map((name) => ({ name, type: 'consumer' }));
    const { l, p } = layoutOf([...all, ...devices]);
    const c = l.width / 2;
    for (const id of ['a', 'b', 'c', 'd']) {
      assert.ok(Math.abs(Math.abs(p(id).x - c) - Math.abs(p(id).y - c)) < 0.01, `${id} staat op een diagonaal`);
    }
  });
  it('vult vier apparaten zonder bronnen als een X en houdt de kaart compact', () => {
    const { l, p } = layoutOf(['PC', 'Bureau', 'Printer', 'Airco'].map((name) => ({ name, type: 'consumer' })));
    const c = l.width / 2;
    assert.equal(new Set(['pc', 'bureau', 'printer', 'airco'].map((id) => `${Math.sign(p(id).x - c)}${Math.sign(p(id).y - c)}`)).size, 4);
    assert.ok(l.width < 450);
  });
  it('zet een tweede zonnepaneel naast het eerste', () => {
    const { l, p } = layoutOf([...all, { name: 'Zon 2', type: 'solar' }]);
    assert.ok(p('zon_2').y < l.height / 2, 'blijft in de bovenhelft');
    assert.ok(Math.hypot(p('zon_2').x - p('zon').x, p('zon_2').y - p('zon').y) > NODE_RADIUS * 2);
  });
  it('plaatst nooit twee nodes op dezelfde plek, ook niet met veel apparaten', () => {
    const cfg = normalizeConfig({
      layout: { mode: 'circle' },
      nodes: [...all, { name: 'Zon 2', type: 'solar' }, { name: 'Accu 2', type: 'battery' }, ...Array.from({ length: 30 }, (_, i) => ({ name: `X${i}`, type: 'consumer' }))],
    });
    const l = computeLayout(cfg.nodes, cfg.layout);
    const seen = new Set([...l.positions.values()].map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`));
    assert.equal(seen.size, l.positions.size);
  });
});

describe('Flow layout', () => {
  const cfg = normalizeConfig({
    nodes: [
      { name: 'Net', type: 'grid' },
      { name: 'PV', type: 'solar' },
      { name: 'Accu', type: 'battery' },
      { name: 'PC', type: 'consumer' },
      { name: 'Bureau', type: 'consumer' },
    ],
  });
  const l = computeLayout(cfg.nodes, cfg.layout, cfg.connections);
  const p = (id: string) => l.positions.get(id)!;

  it('is de standaardweergave', () => assert.equal(l.mode, 'flow'));
  it('zet PV boven, net links, accu rechts en verbruikers onder Home', () => {
    assert.ok(p('pv').y < p('home').y);
    assert.ok(p('net').x < p('home').x);
    assert.ok(p('accu').x > p('home').x);
    assert.ok(p('pc').y > p('home').y && p('bureau').y > p('home').y);
  });
});

describe('verbindingsgeometrie', () => {
  const a = { center: { x: 0, y: 0 }, radius: 40 };
  const b = { center: { x: 200, y: 0 }, radius: 40 };
  it('loopt van rand naar rand', () => {
    const g = computeGeometry(a, b, false);
    assert.ok(g.length > 100 && g.length < 120);
    assert.equal(g.angle, 0);
  });
  it('heeft een omgekeerd pad voor de tegenovergestelde richting', () => {
    const g = computeGeometry(a, b, false);
    assert.notEqual(g.forward, g.backward);
    assert.ok(g.forward.startsWith('M43') && g.backward.startsWith('M157'));
  });
  it('buigt bij verbindingen die niet via Home lopen', () => {
    assert.ok(computeGeometry(a, b, true).forward.includes('Q'));
  });
});

describe('deeltjessnelheid', () => {
  const ctx = { maxPower: 5000, animationSpeed: 1, animate: true };
  it('beweegt sneller bij meer vermogen', () => {
    assert.ok(particleDuration(4000, ctx, 1) < particleDuration(50, ctx, 1));
  });
  it('blijft binnen redelijke grenzen', () => {
    assert.ok(particleDuration(1e9, ctx, 1) >= 1.5);
    assert.ok(particleDuration(1, { ...ctx, animationSpeed: 0.01 }, 1) <= 14);
  });
  it('respecteert de snelheidsinstelling', () => {
    assert.ok(particleDuration(1000, { ...ctx, animationSpeed: 2 }, 1) < particleDuration(1000, ctx, 1));
  });
});

describe('rechte layout', () => {
  const straight = (nodes: unknown[]) => {
    const cfg = normalizeConfig({ nodes, layout: { mode: 'straight' } });
    const l = computeLayout(cfg.nodes, cfg.layout, cfg.connections);
    return { cfg, l, p: (id: string) => l.positions.get(id)! };
  };
  const system = [
    { name: 'Net', type: 'grid' },
    { name: 'Zon', type: 'solar' },
    { name: 'Accu', type: 'battery' },
    { name: 'Auto', type: 'ev_charger' },
    { name: 'Backup', type: 'backup' },
    { name: 'Server', type: 'consumer', connected_to: 'Backup' },
    { name: 'Koelkast', type: 'consumer', connected_to: 'Backup' },
  ];

  it('zet van boven naar beneden: net, batterij en zon, Home, apparaten, apparaten achter de backup', () => {
    const { p } = straight(system);
    assert.ok(p('net').y < p('accu').y && p('accu').y < p('home').y, 'net boven batterij boven Home');
    assert.equal(p('accu').y, p('zon').y, 'batterij en zon staan op één rij');
    assert.ok(p('auto').y > p('home').y && p('backup').y === p('auto').y, 'apparaten en backup onder Home');
    assert.ok(p('server').y > p('backup').y && p('koelkast').y === p('server').y, 'achter de backup weer een rij lager');
  });
  it('zet de batterij links en de zon rechts, met het net precies boven Home', () => {
    const { p } = straight(system);
    assert.ok(p('accu').x < p('home').x && p('zon').x > p('home').x);
    assert.equal(p('net').x, p('home').x);
  });
  it('houdt de lijn van het net naar Home vrij van andere nodes', () => {
    const { p } = straight(system);
    for (const id of ['accu', 'zon']) assert.ok(Math.abs(p(id).x - p('net').x) > NODE_RADIUS * 2);
  });
  it('centreert de apparaten onder Home en de apparaten achter een backup onder hun backup', () => {
    const { p } = straight(system);
    assert.ok(Math.abs((p('server').x + p('koelkast').x) / 2 - p('backup').x) < 0.01);
  });
  it('laat nodes nergens overlappen en blijft binnen de kaart', () => {
    for (const extra of [0, 3, 6]) {
      const list = [...system, ...Array.from({ length: extra }, (_, i) => ({ name: `X${i}`, type: 'consumer' }))];
      const { l } = straight(list);
      const pts = [...l.positions.values()];
      for (let i = 0; i < pts.length; i++) {
        assert.ok(pts[i]!.x >= 0 && pts[i]!.x <= l.width && pts[i]!.y >= 0 && pts[i]!.y <= l.height);
        for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y) > NODE_RADIUS * 2);
      }
    }
  });
  it('is niet extreem smal of breed', () => {
    for (const list of [[{ name: 'Net', type: 'grid' }], system, Array.from({ length: 7 }, (_, i) => ({ name: `X${i}`, type: 'consumer' }))]) {
      const { l } = straight(list);
      assert.ok(l.width / l.height >= 0.79 && l.width / l.height <= 1.71, `${l.width}x${l.height}`);
    }
  });
  it('kiest de weergave met layout.mode en gebruikt Flow als standaard', () => {
    const cfg = normalizeConfig({ nodes: system });
    assert.equal(computeLayout(cfg.nodes, cfg.layout, cfg.connections).mode, 'flow');
    assert.equal(straight(system).l.mode, 'straight');
  });
});

describe('ronde layout met een backup', () => {
  it('zet apparaten achter een backup op de buitenring, naast hun backup', () => {
    const cfg = normalizeConfig({
      layout: { mode: 'circle' },
      nodes: [
        { name: 'Backup', type: 'backup' },
        { name: 'Server', type: 'consumer', connected_to: 'Backup' },
        { name: 'PC', type: 'consumer' },
      ],
    });
    const l = computeLayout(cfg.nodes, cfg.layout, cfg.connections);
    const p = (id: string) => l.positions.get(id)!;
    const c = l.width / 2;
    const angle = (id: string) => (Math.atan2(p(id).x - c, -(p(id).y - c)) * 180) / Math.PI;
    assert.ok(Math.abs(angle('server') - angle('backup')) <= 25, 'server staat in de hoek van de backup');
    assert.ok(Math.hypot(p('server').x - c, p('server').y - c) > Math.hypot(p('backup').x - c, p('backup').y - c), 'en verder van Home dan de backup');
  });
});

describe('rechte verbindingen', () => {
  const home = { center: { x: 0, y: 0 }, radius: 54 };
  const under = (x: number) => ({ center: { x, y: STRAIGHT_ROW_GAP }, radius: 44 });
  it('loopt recht naar beneden als de nodes onder elkaar staan', () => {
    const g = computeGeometry(home, under(0), false, true);
    assert.ok(!g.forward.includes('Q') && !g.forward.includes('L' + '0.0 0.0'));
    assert.ok(g.length > 60 && g.length < 80);
  });
  it('maakt een bocht van recht naar opzij naar recht als de nodes naast elkaar staan', () => {
    const g = computeGeometry(home, under(118), false, true);
    assert.ok(g.forward.includes('Q'), 'afgeronde hoek');
    assert.ok(g.length > STRAIGHT_ROW_GAP - 54 - 44);
  });
  it('heeft een omgekeerd pad, ook als de verbinding van onder naar boven loopt', () => {
    const down = computeGeometry(home, under(118), false, true);
    const up = computeGeometry(under(118), home, false, true);
    assert.equal(up.forward.split(' ')[0], down.backward.split(' ')[0]);
  });
  it('blijft een gewone lijn als de nodes naast elkaar staan', () => {
    const g = computeGeometry(home, { center: { x: 200, y: 0 }, radius: 44 }, false, true);
    assert.ok(!g.forward.includes('Q'));
  });
});

describe('Flow layout v0.8 adaptief', () => {
  const flow = (count: number, extra: unknown[] = []) => {
    const cfg = normalizeConfig({
      nodes: [
        { name: 'Net', type: 'grid' },
        { name: 'PV', type: 'solar' },
        { name: 'Accu', type: 'battery' },
        ...Array.from({ length: count }, (_, i) => ({ name: `Verbruiker ${i + 1}`, type: 'consumer' })),
        ...extra,
      ],
    });
    return computeLayout(cfg.nodes, cfg.layout, cfg.connections);
  };

  it('houdt een kleine installatie compact zonder grote lege onderkant', () => {
    const l = flow(2);
    assert.ok(l.height < 560, `kaart is te hoog: ${l.height}`);
    const ys = [...l.positions.values()].map((p) => p.y);
    const bottom = Math.max(...ys);
    assert.ok(l.height - bottom < 150, `te veel ruimte onder nodes: ${l.height - bottom}`);
  });

  it('verdeelt tien verbruikers automatisch over meerdere rijen', () => {
    const l = flow(10);
    const ys = Array.from({ length: 10 }, (_, i) => l.positions.get(`verbruiker_${i + 1}`)!.y);
    assert.ok(new Set(ys.map((y) => Math.round(y))).size >= 2, 'alle verbruikers staan nog op één rij');
  });

  it('houdt maximaal vijf gewone verbruikers op één rij', () => {
    const l = flow(12);
    const counts = new Map<number, number>();
    for (let i = 1; i <= 12; i++) {
      const y = Math.round(l.positions.get(`verbruiker_${i}`)!.y);
      counts.set(y, (counts.get(y) ?? 0) + 1);
    }
    assert.ok(Math.max(...counts.values()) <= 5, `te veel nodes op één rij: ${Math.max(...counts.values())}`);
  });

  it('reserveert een aparte rij voor apparaten achter een backup zonder overlap', () => {
    const l = flow(4, [
      { name: 'Backup', type: 'backup' },
      { name: 'Server', type: 'consumer', connected_to: 'Backup' },
      { name: 'NAS', type: 'consumer', connected_to: 'Backup' },
    ]);
    const b = l.positions.get('backup')!;
    const s = l.positions.get('server')!;
    const n = l.positions.get('nas')!;
    assert.ok(s.y > b.y && n.y === s.y);
    assert.ok(Math.abs((s.x + n.x) / 2 - b.x) < 1);
  });
});
