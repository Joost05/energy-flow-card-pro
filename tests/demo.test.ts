import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeConfig } from '../src/config/CardConfig';
import { demoReadings } from '../src/demo/DemoEngine';
import { computeFlows, computeHomeReading } from '../src/helpers/flowHelper';
import { EntityStatus } from '../src/types/EntityStatus';

describe('demo-engine', () => {
  const cfg = normalizeConfig({ demo: true });

  it('geeft elke gewone node een geldige waarde, op elk moment', () => {
    for (let t = 0; t < 400; t += 7) {
      const readings = demoReadings(cfg.nodes, t);
      for (const n of cfg.nodes.filter((x) => x.role !== 'home')) {
        const r = readings.get(n.id);
        assert.ok(r, `${n.id} mist bij t=${t}`);
        assert.ok(r.status === EntityStatus.Valid || r.status === EntityStatus.Zero);
        assert.ok(Number.isFinite(r.watts));
      }
    }
  });
  it('is deterministisch', () => {
    assert.deepEqual([...demoReadings(cfg.nodes, 123)], [...demoReadings(cfg.nodes, 123)]);
  });
  it('houdt de energiebalans kloppend: Home is het totale verbruik, dus basis (380 ± 140 W) plus alle apparaten', () => {
    const home = cfg.nodes.find((n) => n.role === 'home')!;
    for (let t = 0; t < 400; t += 5) {
      const readings = demoReadings(cfg.nodes, t);
      const flows = computeFlows(cfg.nodes, cfg.connections, readings, undefined, { ignoreEntities: true });
      const h = computeHomeReading(home, cfg.nodes, cfg.connections, flows);
      let devices = 0;
      for (const n of cfg.nodes) {
        if (n.role !== 'consumer' || n.type === 'backup') continue;
        const ref = n.config.connected_to;
        const parent = ref ? cfg.nodes.find((x) => x.id === ref || x.name?.toLowerCase() === ref.toLowerCase()) : undefined;
        if (parent?.role === 'consumer' && parent.type !== 'backup') continue;
        devices += readings.get(n.id)?.watts ?? 0;
      }
      const base = h.watts! - devices;
      assert.ok(base >= 240 - 3 && base <= 520 + 3, `t=${t}: basisverbruik=${base}`);
    }
  });
  it("laat de zon 's nachts een geldige 0 W leveren", () => {
    const night = demoReadings(cfg.nodes, 120 * 0.9);
    assert.equal(night.get('zonnepanelen')!.status, EntityStatus.Zero);
  });
  it('laat de batterij zowel laden als ontladen', () => {
    const seen = new Set<boolean>();
    for (let t = 0; t < 150; t += 5) seen.add(demoReadings(cfg.nodes, t).get('batterij')!.charging);
    assert.equal(seen.size, 2);
  });
});
