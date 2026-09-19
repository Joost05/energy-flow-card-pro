import { createConnection, defaultConnections } from '../models/Connection';
import type { Connection, ConnectionConfig } from '../models/Connection';
import { createNode, generateId } from '../models/Node';
import type { EnergyNode, NodeConfig } from '../models/Node';
import type { Point } from '../layout/AutoLayout';
import type { PowerFormat } from '../helpers/stateHelper';
import { NODE_TYPES, normalizeType } from '../types/NodeType';
import type { NodeType } from '../types/NodeType';

/** De configuratie zoals de gebruiker die in YAML schrijft. */
export interface CardConfig {
  type: string;
  title?: string;
  demo?: boolean;
  animation?: boolean;
  power_format?: PowerFormat;
  max_power?: number;
  animation_speed?: number;
  /** Optionele echte vermogenssensor voor de Woning-node. Zonder deze sensor wordt Woning berekend. */
  home_power_entity?: string;
  nodes?: NodeConfig[];
  connections?: ConnectionConfig[];
  layout?: { mode?: 'flow' | 'circle' | 'straight' | 'auto' | 'eniris'; positions?: Record<string, Point> };
}

/** Layout blijft los van Node en Connection: "waar staat het?" Posities zijn percentages (0-100). */
export interface LayoutConfig {
  /** "flow": energiestroom-weergave (standaard). "circle" en "straight" blijven beschikbaar. */
  mode?: 'flow' | 'circle' | 'straight';
  positions?: Record<string, Point>;
}

/** De gevalideerde configuratie: Nodes, Connections en Layout. */
export interface ResolvedConfig {
  title?: string;
  demo: boolean;
  animation: boolean;
  powerFormat: PowerFormat;
  maxPower: number;
  animationSpeed: number;
  nodes: EnergyNode[];
  connections: Connection[];
  layout: LayoutConfig;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Nodes voor de demo-modus als de gebruiker zelf geen nodes opgeeft. */
const DEMO_NODES: NodeConfig[] = [
  { name: 'Net', type: 'grid' },
  { name: 'Zonnepanelen', type: 'solar' },
  { name: 'Batterij', type: 'battery' },
  { name: 'Laadpaal', type: 'ev_charger' },
  { name: 'Warmtepomp', type: 'heat_pump' },
  { name: 'Backup', type: 'backup' },
  { name: 'Server', type: 'consumer', connected_to: 'Backup' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown, fallback: number, key: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`"${key}" moet een getal groter dan 0 zijn.`);
  }
  return value;
}

/** Controleert de YAML-configuratie en maakt er Nodes, Connections en Layout van. Gooit een ConfigError bij fouten. */
export function normalizeConfig(raw: unknown): ResolvedConfig {
  if (!isRecord(raw)) throw new ConfigError('De configuratie is leeg of ongeldig.');
  const demo = raw.demo === true;
  const rawNodes = raw.nodes;
  if (rawNodes !== undefined && rawNodes !== null && !Array.isArray(rawNodes)) {
    throw new ConfigError('"nodes" moet een lijst zijn.');
  }
  const list: unknown[] = Array.isArray(rawNodes) ? rawNodes : [];
  const nodeInput = demo && list.length === 0 ? DEMO_NODES : list;

  const nodes = parseNodes(nodeInput);
  const homePower = typeof raw.home_power_entity === 'string' ? raw.home_power_entity.trim() : '';
  if (homePower) {
    const home = nodes.find((n) => n.role === 'home');
    if (home) home.config.power_entity = homePower;
  }
  checkConnectedTo(nodes);
  const connections = parseConnections(raw.connections, nodes);
  const layout = parseLayout(raw.layout);

  const powerFormat = (raw.power_format ?? 'w') as PowerFormat;
  if (powerFormat !== 'w' && powerFormat !== 'kw' && powerFormat !== 'auto') {
    throw new ConfigError('"power_format" moet "w", "kw" of "auto" zijn.');
  }

  return {
    title: typeof raw.title === 'string' ? raw.title : undefined,
    demo,
    animation: raw.animation !== false,
    powerFormat,
    maxPower: positiveNumber(raw.max_power, 5000, 'max_power'),
    animationSpeed: positiveNumber(raw.animation_speed, 1, 'animation_speed'),
    nodes,
    connections,
    layout,
  };
}

function parseNodes(raw: unknown[]): EnergyNode[] {
  const parsed: Array<{ config: NodeConfig; type: NodeType }> = [];
  raw.forEach((item, index) => {
    if (!isRecord(item)) throw new ConfigError(`Node ${index + 1} is geen geldig object.`);
    const type = normalizeType(item.type);
    if (!type) {
      const shown = typeof item.type === 'string' ? `"${item.type}"` : 'ontbreekt';
      throw new ConfigError(`Node ${index + 1}: het type ${shown} is onbekend. Kies uit: ${NODE_TYPES.join(', ')}.`);
    }
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (type !== 'home' && !name) throw new ConfigError(`Node ${index + 1} (${type}) heeft een "name" nodig.`);
    parsed.push({ config: item as unknown as NodeConfig, type });
  });

  // Iedere configuratie heeft precies één Home-node; die wordt automatisch aangemaakt.
  if (parsed.filter((p) => p.type === 'home').length > 1) throw new ConfigError('Er mag maar één Home-node zijn.');
  if (!parsed.some((p) => p.type === 'home')) parsed.unshift({ config: { type: 'home' }, type: 'home' });

  // De gebruiker hoeft geen id te kiezen; expliciete id's gaan voor en moeten uniek zijn.
  const taken = new Set<string>(['home']);
  const explicit = parsed.map((p) => {
    if (p.type === 'home') return 'home';
    const id = typeof p.config.id === 'string' ? p.config.id.trim() : '';
    if (!id) return undefined;
    if (taken.has(id)) throw new ConfigError(`De id "${id}" wordt meer dan één keer gebruikt.`);
    taken.add(id);
    return id;
  });

  return parsed.map((p, index) => {
    const id = explicit[index] ?? generateId(p.config.name ?? p.type, taken);
    taken.add(id);
    return createNode(p.config, p.type, id);
  });
}

/** `connected_to` mag alleen bij een gewoon apparaat en moet naar een backup verwijzen (Home is de standaard). */
function checkConnectedTo(nodes: EnergyNode[]): void {
  for (const node of nodes) {
    const ref = node.config.connected_to;
    if (ref === undefined) continue;
    const label = node.name ?? node.id;
    if (typeof ref !== 'string' || !ref.trim()) throw new ConfigError(`Node "${label}": "connected_to" moet een naam of id zijn.`);
    if (node.role !== 'consumer' || node.type === 'backup') {
      throw new ConfigError(`Node "${label}": "connected_to" kan alleen bij een apparaat dat energie gebruikt.`);
    }
    const target = findNode(nodes, ref);
    if (!target) throw new ConfigError(`Node "${label}": "connected_to" verwijst naar "${ref}", en die node bestaat niet.`);
    if (target.role !== 'home' && target.type !== 'backup') {
      throw new ConfigError(`Node "${label}": "connected_to" moet naar Home of een backup-node verwijzen, niet naar "${ref}".`);
    }
  }
}

/** Zoekt een node op id, op naam (hoofdletterongevoelig) of met het woord "home". */
function findNode(nodes: EnergyNode[], reference: string): EnergyNode | undefined {
  const ref = reference.trim();
  const lower = ref.toLowerCase();
  return (
    nodes.find((n) => n.id === ref) ??
    nodes.find((n) => n.name?.toLowerCase() === lower) ??
    (lower === 'home' ? nodes.find((n) => n.role === 'home') : undefined)
  );
}

function parseConnections(raw: unknown, nodes: EnergyNode[]): Connection[] {
  if (raw === undefined || raw === null) return defaultConnections(nodes);
  if (!Array.isArray(raw)) throw new ConfigError('"connections" moet een lijst zijn.');
  const taken = new Set<string>();
  return raw.map((item, index) => {
    if (!isRecord(item)) throw new ConfigError(`Verbinding ${index + 1} is geen geldig object.`);
    const fromRef = typeof item.from === 'string' ? item.from : '';
    const toRef = typeof item.to === 'string' ? item.to : '';
    if (!fromRef || !toRef) throw new ConfigError(`Verbinding ${index + 1} heeft een "from" en een "to" nodig.`);
    const from = findNode(nodes, fromRef);
    const to = findNode(nodes, toRef);
    if (!from) throw new ConfigError(`Verbinding ${index + 1}: node "${fromRef}" bestaat niet.`);
    if (!to) throw new ConfigError(`Verbinding ${index + 1}: node "${toRef}" bestaat niet.`);
    if (from.id === to.id) throw new ConfigError(`Verbinding ${index + 1} verbindt "${fromRef}" met zichzelf.`);
    const id = generateId(typeof item.id === 'string' && item.id ? item.id : `${from.id}__${to.id}`, taken);
    taken.add(id);
    return createConnection(id, from, to, item as unknown as ConnectionConfig);
  });
}

function parseLayout(raw: unknown): LayoutConfig {
  if (raw === undefined || raw === null) return { mode: 'flow' };
  if (!isRecord(raw)) throw new ConfigError('"layout" moet een object zijn.');
  if (raw.mode !== undefined && raw.mode !== 'flow' && raw.mode !== 'eniris' && raw.mode !== 'circle' && raw.mode !== 'straight' && raw.mode !== 'auto') {
    throw new ConfigError('"layout.mode" moet "flow", "circle" (rond) of "straight" (recht) zijn.');
  }
  // v0.7.0 schreef nog een oudere naam weg; behandel die stil als de standaard Flow-weergave zodat bestaande kaarten blijven werken.
  const mode: 'flow' | 'circle' | 'straight' = raw.mode === 'circle' ? 'circle' : raw.mode === 'straight' ? 'straight' : 'flow';
  const positions: Record<string, Point> = {};
  if (raw.positions !== undefined) {
    if (!isRecord(raw.positions)) throw new ConfigError('"layout.positions" moet een object zijn.');
    for (const [key, value] of Object.entries(raw.positions)) {
      if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
        throw new ConfigError(`Positie van "${key}" heeft een numerieke x en y nodig (0-100).`);
      }
      positions[key] = { x: Math.min(100, Math.max(0, value.x)), y: Math.min(100, Math.max(0, value.y)) };
    }
  }
  return { mode, positions };
}
