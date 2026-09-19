import type { ResolvedConfig, ResolvedDeviceGroup } from '../config/CardConfig';
import { createConnection } from '../models/Connection';
import type { Connection } from '../models/Connection';
import { createNode } from '../models/Node';
import type { EnergyNode } from '../models/Node';
import { EntityStatus } from '../types/EntityStatus';
import type { NodeReading } from './flowHelper';

export interface DisplayGraph {
  nodes: EnergyNode[];
  connections: Connection[];
  groupNodes: Map<string, EnergyNode>;
}

export function groupedGroups(cfg: ResolvedConfig): ResolvedDeviceGroup[] {
  return cfg.groups.filter((g) => g.display === 'grouped');
}

export function createGroupNode(group: ResolvedDeviceGroup): EnergyNode {
  const id = `group_${group.id}`;
  return createNode(
    {
      id,
      name: group.name,
      type: group.type,
      icon: group.icon,
      group_members: group.memberIds,
    },
    group.type,
    id,
  );
}

/**
 * Maakt alleen voor de presentatie een compacte graaf. Onderliggende nodes blijven in de
 * echte configuratie bestaan, zodat live berekeningen en history dezelfde data blijven gebruiken.
 */
export function buildDisplayGraph(cfg: ResolvedConfig): DisplayGraph {
  const active = groupedGroups(cfg);
  if (active.length === 0) return { nodes: cfg.nodes, connections: cfg.connections, groupNodes: new Map() };

  const hidden = new Set(active.flatMap((g) => g.memberIds));
  const nodes = cfg.nodes.filter((n) => !hidden.has(n.id));
  const connections = cfg.connections.filter((c) => !hidden.has(c.from) && !hidden.has(c.to));
  const groupNodes = new Map<string, EnergyNode>();
  const byId = new Map(cfg.nodes.map((n) => [n.id, n]));

  for (const group of active) {
    const groupNode = createGroupNode(group);
    groupNodes.set(groupNode.id, groupNode);
    nodes.push(groupNode);
    const parent = byId.get(group.parentId) ?? nodes.find((n) => n.role === 'home');
    if (!parent) continue;
    const from = groupNode.role === 'consumer' ? parent : groupNode;
    const to = groupNode.role === 'consumer' ? groupNode : parent;
    connections.push(createConnection(`${from.id}__${to.id}`, from, to));
  }

  return { nodes, connections, groupNodes };
}

/** Sommeer groepsleden. Bekende waarden worden opgeteld; pas als niets bruikbaar is wordt de groep '?'. */
export function applyGroupReadings(
  groups: readonly ResolvedDeviceGroup[],
  groupNodes: ReadonlyMap<string, EnergyNode>,
  readings: Map<string, NodeReading>,
): void {
  for (const group of groups) {
    if (group.display !== 'grouped') continue;
    const groupNode = groupNodes.get(`group_${group.id}`);
    if (!groupNode) continue;
    let total = 0;
    let known = 0;
    for (const id of group.memberIds) {
      const r = readings.get(id);
      if (r?.watts !== null && r?.watts !== undefined) {
        total += r.watts;
        known++;
      }
    }
    readings.set(
      groupNode.id,
      known > 0
        ? { status: total === 0 ? EntityStatus.Zero : EntityStatus.Valid, watts: total, charging: false }
        : { status: EntityStatus.Invalid, watts: null, charging: false },
    );
  }
}
