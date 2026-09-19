export const NODE_TYPES = [
  'home',
  'grid',
  'solar',
  'battery',
  'consumer',
  'producer',
  'generator',
  'ev_charger',
  'heat_pump',
  'boiler',
  'airco',
  'backup',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/**
 * Hoe een node zich gedraagt in de energiestroom:
 * - home: het centrale referentiepunt;
 * - source: levert energie (zon, generator, andere producent);
 * - bidirectional: kan beide kanten op (net: afname/teruglevering, batterij: ontladen/laden);
 * - consumer: verbruikt energie.
 */
export type NodeRole = 'home' | 'source' | 'bidirectional' | 'consumer';

const ALIASES: Record<string, NodeType> = {
  pv: 'solar',
  zon: 'solar',
  zonnepanelen: 'solar',
  net: 'grid',
  batterij: 'battery',
  verbruiker: 'consumer',
  producent: 'producer',
  ev: 'ev_charger',
  charger: 'ev_charger',
  laadpaal: 'ev_charger',
  heatpump: 'heat_pump',
  warmtepomp: 'heat_pump',
  ac: 'airco',
  aircon: 'airco',
  ups: 'backup',
  noodstroom: 'backup',
  back_up: 'backup',
};

/** Leest een type uit de configuratie; accepteert ook een paar bekende aliassen ("pv", "warmtepomp"…). */
export function normalizeType(value: unknown): NodeType | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (NODE_TYPES as readonly string[]).includes(key) ? (key as NodeType) : (ALIASES[key] ?? null);
}

export function roleOf(type: NodeType): NodeRole {
  switch (type) {
    case 'home':
      return 'home';
    case 'solar':
    case 'producer':
    case 'generator':
      return 'source';
    case 'grid':
    case 'battery':
      return 'bidirectional';
    default:
      return 'consumer';
  }
}

/** Home, Grid, PV en Battery krijgen standaard een icoon; bij andere apparaten is het optioneel. */
export const TYPES_WITH_DEFAULT_ICON: ReadonlySet<NodeType> = new Set<NodeType>(['home', 'grid', 'solar', 'battery', 'backup']);
