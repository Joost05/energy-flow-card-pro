import type { EnergyNode } from './Node';

/** Een verbinding zoals de gebruiker die in YAML schrijft. `from` en `to` zijn een node-naam of id. */
export interface ConnectionConfig {
  id?: string;
  from: string;
  to: string;
  bidirectional?: boolean;
  visible?: boolean;
  animated?: boolean;
  speed?: number;
  color?: string;
  width?: number;
  /** Eigen flow-sensor: positief = van `from` naar `to`. */
  entity?: string;
  invert?: boolean;
}

/** Een gevalideerde verbinding tussen twee node-id's: "hoe is het verbonden?" */
export interface Connection {
  id: string;
  from: string;
  to: string;
  bidirectional: boolean;
  visible: boolean;
  animated: boolean;
  speed: number;
  color?: string;
  width: number;
  entity?: string;
  invert: boolean;
}

export function createConnection(
  id: string,
  from: EnergyNode,
  to: EnergyNode,
  options: Partial<ConnectionConfig> = {},
): Connection {
  const eitherBidirectional = from.role === 'bidirectional' || to.role === 'bidirectional';
  return {
    id,
    from: from.id,
    to: to.id,
    bidirectional: options.bidirectional ?? eitherBidirectional,
    visible: options.visible !== false,
    animated: options.animated !== false,
    speed: options.speed && options.speed > 0 ? options.speed : 1,
    color: options.color,
    width: options.width && options.width > 0 ? options.width : 3,
    entity: options.entity,
    invert: options.invert === true,
  };
}

/**
 * Zonder `connections` wordt elke node met Home verbonden:
 * verbruikers vertrekken vanuit Home, alle andere nodes stromen naar Home toe.
 */
export function defaultConnections(nodes: EnergyNode[]): Connection[] {
  const home = nodes.find((n) => n.role === 'home');
  if (!home) return [];
  return nodes
    .filter((n) => n.id !== home.id)
    .map((n) => {
      if (n.role !== 'consumer') return createConnection(`${n.id}__${home.id}`, n, home);
      const parent = parentOf(n, nodes) ?? home;
      return createConnection(`${parent.id}__${n.id}`, parent, n);
    });
}

/**
 * Een gewoon apparaat kan achter een backup hangen (`connected_to`). Een backup zelf hangt altijd aan Home.
 * Geeft undefined als het apparaat aan Home hangt.
 */
export function parentOf(node: EnergyNode, nodes: readonly EnergyNode[]): EnergyNode | undefined {
  const ref = node.config.connected_to?.trim();
  if (!ref || node.role !== 'consumer' || node.type === 'backup') return undefined;
  const lower = ref.toLowerCase();
  const parent = nodes.find((n) => n.id === ref) ?? nodes.find((n) => n.name?.toLowerCase() === lower);
  return parent?.type === 'backup' ? parent : undefined;
}
