import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeConfig } from '../src/config/CardConfig';
import { applyGroupReadings, buildDisplayGraph } from '../src/helpers/groupHelper';
import { EntityStatus } from '../src/types/EntityStatus';

describe('groepweergave', () => {
  it('vervangt gegroepeerde leden door één virtuele node', () => {
    const cfg = normalizeConfig({
      nodes: [
        { id: 'wp1', name: 'WP 1', type: 'heat_pump' },
        { id: 'wp2', name: 'WP 2', type: 'heat_pump' },
        { id: 'pc', name: 'PC', type: 'consumer' },
      ],
      groups: [{ id: 'wp', name: 'Warmtepompen', members: ['wp1', 'wp2'] }],
    });
    const graph = buildDisplayGraph(cfg);
    assert.ok(graph.nodes.some((n) => n.id === 'group_wp'));
    assert.ok(!graph.nodes.some((n) => n.id === 'wp1'));
    assert.ok(!graph.nodes.some((n) => n.id === 'wp2'));
    assert.ok(graph.nodes.some((n) => n.id === 'pc'));
  });

  it('telt bekende vermogens van groepsleden bij elkaar op', () => {
    const cfg = normalizeConfig({
      nodes: [{ id: 'a', name: 'A', type: 'consumer' }, { id: 'b', name: 'B', type: 'consumer' }],
      groups: [{ id: 'g', name: 'Groep', members: ['a', 'b'] }],
    });
    const graph = buildDisplayGraph(cfg);
    const readings = new Map([
      ['a', { status: EntityStatus.Valid, watts: 500, charging: false }],
      ['b', { status: EntityStatus.Valid, watts: 700, charging: false }],
    ]);
    applyGroupReadings(cfg.groups, graph.groupNodes, readings);
    assert.equal(readings.get('group_g')?.watts, 1200);
  });
});
