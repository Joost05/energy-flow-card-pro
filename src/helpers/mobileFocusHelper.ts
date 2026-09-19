import type { Connection } from '../models/Connection';
import type { EnergyNode } from '../models/Node';

export interface MobileFocusGraph {
  nodes: EnergyNode[];
  connections: Connection[];
  focusId: string;
  homeId: string;
  parentId?: string;
}

function childConnections(id: string, nodesById: ReadonlyMap<string, EnergyNode>, connections: readonly Connection[]): Connection[] {
  return connections.filter((c) => {
    if (c.from !== id) return false;
    const child = nodesById.get(c.to);
    return !!child && child.role === 'consumer' && child.id !== id;
  });
}

/** All consumer descendants below a node, in breadth-first order. */
export function descendantConsumerIds(id: string, nodes: readonly EnergyNode[], connections: readonly Connection[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const conn of childConnections(current, byId, connections)) {
      if (seen.has(conn.to)) continue;
      seen.add(conn.to);
      out.push(conn.to);
      queue.push(conn.to);
    }
  }
  return out;
}

export function countFocusableDescendants(id: string, nodes: readonly EnergyNode[], connections: readonly Connection[]): number {
  return descendantConsumerIds(id, nodes, connections).length;
}

export function hasFocusableChildren(id: string, nodes: readonly EnergyNode[], connections: readonly Connection[]): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return childConnections(id, byId, connections).length > 0;
}

/**
 * Compact mobile graph: Home shows only its direct neighbours. Focusing a consumer/backup
 * shows that node as the centre plus its complete descendant subtree. This keeps the main
 * mobile overview readable while still exposing the whole branch after one tap.
 */
export function buildMobileFocusGraph(
  nodes: readonly EnergyNode[],
  connections: readonly Connection[],
  requestedFocusId?: string,
): MobileFocusGraph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const home = nodes.find((n) => n.role === 'home') ?? nodes[0];
  if (!home) return { nodes: [], connections: [], focusId: '', homeId: '' };

  const requested = requestedFocusId ? byId.get(requestedFocusId) : undefined;
  const focus = requested && (requested.id === home.id || hasFocusableChildren(requested.id, nodes, connections)) ? requested : home;

  let visibleConnections: Connection[];
  let parentId: string | undefined;
  if (focus.id === home.id) {
    visibleConnections = connections.filter((c) => c.from === home.id || c.to === home.id);
  } else {
    const descendants = new Set(descendantConsumerIds(focus.id, nodes, connections));
    visibleConnections = connections.filter((c) =>
      (c.from === focus.id && descendants.has(c.to)) ||
      (descendants.has(c.from) && descendants.has(c.to)),
    );
    parentId = connections.find((c) => c.to === focus.id)?.from;
  }

  const ids = new Set<string>([focus.id]);
  for (const c of visibleConnections) {
    ids.add(c.from);
    ids.add(c.to);
  }
  return {
    nodes: nodes.filter((n) => ids.has(n.id)),
    connections: visibleConnections,
    focusId: focus.id,
    homeId: home.id,
    parentId,
  };
}
