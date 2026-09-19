import type { LayoutConfig } from '../config/CardConfig';
import { defaultConnections } from '../models/Connection';
import type { Connection } from '../models/Connection';
import type { EnergyNode } from '../models/Node';

export const NODE_RADIUS = 38;
export const HOME_RADIUS = 46;

export interface Point {
  x: number;
  y: number;
}

export type LayoutMode = 'flow' | 'circle' | 'straight';

export interface LayoutResult {
  width: number;
  height: number;
  positions: Map<string, Point>;
  mode: LayoutMode;
}

/** Afstand tussen twee rijen in de rechte layout; de rechte lijnen buigen halverwege deze afstand af. */
export const STRAIGHT_ROW_GAP = 176;

/**
 * Drie weergaven:
 * - "flow" (standaard): energiestromen centraal; productie boven, net links, opslag rechts, verbruikers onder.
 * - "circle": vaste plekken rond Home.
 * - "straight": klassieke boven-naar-beneden weergave.
 * De kaart is altijd los van Node en Connection: dit bepaalt alleen waar iets staat.
 */
export function computeLayout(
  nodes: readonly EnergyNode[],
  layout: LayoutConfig = {},
  connections?: readonly Connection[],
): LayoutResult {
  const mode: LayoutMode = layout.mode === 'circle' ? 'circle' : layout.mode === 'straight' ? 'straight' : 'flow';
  const links = connections ?? defaultConnections([...nodes]);
  const manual = layout.positions ?? {};
  const manualFor = (n: EnergyNode) => manual[n.id] ?? (n.name ? manual[n.name] : undefined);

  const others = nodes.filter((n) => n.role !== 'home');
  const auto = others.filter((n) => !manualFor(n));
  const base = mode === 'circle' ? circleLayout(nodes, auto, links) : mode === 'straight' ? straightLayout(nodes, auto, links) : flowLayout(nodes, auto, links);

  // Handmatige posities (in % van de kaart) gaan altijd voor.
  for (const n of others) {
    const p = manualFor(n);
    if (p) base.positions.set(n.id, { x: (p.x / 100) * base.width, y: (p.y / 100) * base.height });
  }
  return { ...base, mode };
}

/** Het apparaat hangt achter deze backup, als de verbindingen dat zeggen. */
function backupParentOf(node: EnergyNode, byId: ReadonlyMap<string, EnergyNode>, links: readonly Connection[]) {
  if (node.role !== 'consumer' || node.type === 'backup') return undefined;
  for (const c of links) {
    const otherId = c.from === node.id ? c.to : c.to === node.id ? c.from : null;
    const other = otherId ? byId.get(otherId) : undefined;
    if (other?.type === 'backup') return other;
  }
  return undefined;
}

// ----- Rond -----------------------------------------------------------------------------------

/** Straal van de eerste ring rond Home. */
const RING_1 = 172;
/** Ruimte tussen de buitenste node en de rand van de kaart (node-straal + naam en ondertitel). */
const MARGIN = 92;
/** Minimale afstand tussen twee ringen, en tussen buren op een buitenring. */
const RING_GAP = 105;
const SLOT_SPACING = 110;

type Group = 'grid' | 'producer' | 'storage' | 'backup' | 'device';

function groupOf(node: EnergyNode): Group {
  if (node.type === 'grid') return 'grid';
  if (node.type === 'battery') return 'storage';
  if (node.type === 'backup') return 'backup';
  if (node.role === 'source') return 'producer';
  return 'device';
}

/** Vaste plekken (hoek in graden, 0 = boven, met de klok mee): zon boven, net links, batterij onder, backup rechts. */
const ANCHOR: Readonly<Record<Exclude<Group, 'device'>, number>> = {
  producer: 0,
  backup: 90,
  storage: 180,
  grid: 270,
};
const FIXED_ORDER = ['grid', 'producer', 'storage', 'backup'] as const;

/** Eerste ring: 8 plekken. Vier vaste plekken op de kruispunten, vier diagonalen voor de overige apparaten. */
const RING_1_DIAGONALS = [1, 5, 3, 7]; // rechtsboven, linksonder, rechtsonder, linksboven: blijft in balans
const RING_1_CROSS = [2, 6, 4, 0];

function ringCount(ring: number): number {
  return ring === 1 ? 8 : 8 * 2 ** (ring - 2);
}

function ringRadius(ring: number): number {
  let radius = RING_1;
  for (let k = 2; k <= ring; k++) {
    radius = Math.max(radius + RING_GAP, (ringCount(k) * SLOT_SPACING) / (2 * Math.PI));
  }
  return radius;
}

/** Ring 1 begint op 0°; buitenringen zitten precies tussen de plekken van de ring erbinnen, zodat lijnen vrij blijven. */
function slotAngle(ring: number, index: number): number {
  const count = ringCount(ring);
  return ring === 1 ? index * 45 : 180 / count + (index * 360) / count;
}

/** Spreidt plekken over de ring (0, half, kwart, driekwart, …) zodat een halfvolle ring toch in balans is. */
function spread(index: number, count: number): number {
  const bits = Math.log2(count);
  let result = 0;
  for (let b = 0; b < bits; b++) if (index & (1 << b)) result |= 1 << (bits - 1 - b);
  return result;
}

function angularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

type Base = Omit<LayoutResult, 'mode'>;

function circleLayout(nodes: readonly EnergyNode[], auto: readonly EnergyNode[], links: readonly Connection[]): Base {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const taken = new Set<string>();
  const key = (ring: number, index: number) => `${ring}:${index}`;
  const placed = new Map<string, { ring: number; index: number }>();
  const take = (node: EnergyNode, ring: number, index: number) => {
    taken.add(key(ring, index));
    placed.set(node.id, { ring, index });
  };

  /** De vrije plek die het dichtst bij een hoek ligt, te beginnen bij `startRing`. */
  const nearestFree = (anchor: number, startRing: number) => {
    for (let ring = startRing; ; ring++) {
      let best = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < ringCount(ring); i++) {
        if (taken.has(key(ring, i))) continue;
        const d = angularDistance(slotAngle(ring, i), anchor);
        if (d < bestDistance) {
          best = i;
          bestDistance = d;
        }
      }
      if (best >= 0) return { ring, index: best };
    }
  };

  const members = new Map<Group, EnergyNode[]>();
  for (const n of auto) {
    const g = groupOf(n);
    members.set(g, [...(members.get(g) ?? []), n]);
  }

  // 1. Elke groep met een vaste plek krijgt zijn eigen plek.
  for (const g of FIXED_ORDER) {
    const first = members.get(g)?.[0];
    if (first) take(first, 1, ANCHOR[g] / 45);
  }

  // 2. Een tweede zonnepaneel, batterij of net komt zo dicht mogelijk bij de vaste plek.
  for (const g of FIXED_ORDER) {
    for (const extra of (members.get(g) ?? []).slice(1)) {
      const slot = nearestFree(ANCHOR[g], 1);
      take(extra, slot.ring, slot.index);
    }
  }

  // 3. Apparaten achter een backup staan op de buitenring, naast hun backup.
  const rest: EnergyNode[] = [];
  for (const device of members.get('device') ?? []) {
    const parent = backupParentOf(device, byId, links);
    const parentSlot = parent ? placed.get(parent.id) : undefined;
    if (parentSlot) {
      const slot = nearestFree(slotAngle(parentSlot.ring, parentSlot.index), 2);
      take(device, slot.ring, slot.index);
    } else {
      rest.push(device);
    }
  }

  // 4. Overige apparaten: diagonalen, dan vrije vaste plekken, dan steeds een ring verder naar buiten.
  const nextDeviceSlot = (): { ring: number; index: number } => {
    for (const i of [...RING_1_DIAGONALS, ...RING_1_CROSS]) if (!taken.has(key(1, i))) return { ring: 1, index: i };
    for (let ring = 2; ; ring++) {
      const count = ringCount(ring);
      for (let i = 0; i < count; i++) {
        const index = spread(i, count);
        if (!taken.has(key(ring, index))) return { ring, index };
      }
    }
  };
  for (const device of rest) {
    const slot = nextDeviceSlot();
    take(device, slot.ring, slot.index);
  }

  // Coördinaten rond Home, en de kaart net groot genoeg (en vierkant) om alles te tonen.
  const offsets = new Map<string, Point>();
  let reach = RING_1 * 0.75;
  for (const [id, slot] of placed) {
    const angle = (slotAngle(slot.ring, slot.index) * Math.PI) / 180;
    const radius = ringRadius(slot.ring);
    const p = { x: radius * Math.sin(angle), y: -radius * Math.cos(angle) };
    offsets.set(id, p);
    reach = Math.max(reach, Math.abs(p.x), Math.abs(p.y));
  }
  const size = Math.round(2 * (reach + MARGIN));
  const center = size / 2;

  const positions = new Map<string, Point>();
  for (const n of nodes) if (n.role === 'home') positions.set(n.id, { x: center, y: center });
  for (const [id, p] of offsets) positions.set(id, { x: center + p.x, y: center + p.y });
  return { width: size, height: size, positions };
}


// ----- Flow ------------------------------------------------------------------------------------

/**
 * Energiestroom-layout met Home als knooppunt:
 * - productie boven Home;
 * - net links;
 * - batterij/opslag rechts;
 * - verbruikers onder Home;
 * - backup op de onderste rij met de achterliggende apparaten een rij daaronder.
 *
 * De layout is bewust niet cirkelvormig: de lijnstructuur moet in één oogopslag laten zien
 * waar energie vandaan komt en waar die heen gaat.
 */
function flowLayout(nodes: readonly EnergyNode[], auto: readonly EnergyNode[], links: readonly Connection[]): Base {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pts = new Map<string, Point>();
  const home = nodes.find((n) => n.role === 'home');

  const producers = auto.filter((n) => n.role === 'source');
  const grids = auto.filter((n) => n.type === 'grid');
  const batteries = auto.filter((n) => n.type === 'battery');
  const backups = auto.filter((n) => n.type === 'backup');
  const consumers = auto.filter((n) => n.role === 'consumer' && n.type !== 'backup');

  const behind = new Map<string, EnergyNode[]>();
  const direct: EnergyNode[] = [];
  for (const device of consumers) {
    const parent = backupParentOf(device, byId, links);
    if (parent && backups.includes(parent)) behind.set(parent.id, [...(behind.get(parent.id) ?? []), device]);
    else direct.push(device);
  }

  const COL = 126;
  const SIDE = 138;
  const TOP = 90;
  const HOME_Y = 245;
  const DEVICE_Y = 405;
  const BACKUP_CHILD_Y = 555;
  const sideRows = Math.max(grids.length, batteries.length, 1);
  const lowerSlots = direct.length + backups.reduce((sum, b) => sum + Math.max(1, behind.get(b.id)?.length ?? 0), 0);
  const topSlots = Math.max(1, producers.length);
  const contentSlots = Math.max(topSlots, lowerSlots, 3);
  const width = Math.max(520, contentSlots * COL + SIDE * 2);
  const centerX = width / 2;
  const height = backups.some((b) => (behind.get(b.id)?.length ?? 0) > 0) ? 650 : 505;

  if (home) pts.set(home.id, { x: centerX, y: HOME_Y });

  // Productie boven Home, horizontaal verdeeld.
  producers.forEach((n, i) => pts.set(n.id, { x: centerX + (i - (producers.length - 1) / 2) * COL, y: TOP }));

  // Net links en opslag rechts. Bij meerdere nodes worden ze verticaal verdeeld rond Home.
  const sideY = (i: number, count: number) => HOME_Y + (i - (count - 1) / 2) * 112;
  grids.forEach((n, i) => pts.set(n.id, { x: 78, y: sideY(i, grids.length) }));
  batteries.forEach((n, i) => pts.set(n.id, { x: width - 78, y: sideY(i, batteries.length) }));

  // Onder Home: directe verbruikers en backups. Een backup reserveert evenveel kolommen als kinderen erachter.
  const items: EnergyNode[] = [...direct, ...backups];
  const widthOf = (n: EnergyNode) => (n.type === 'backup' ? Math.max(1, behind.get(n.id)?.length ?? 0) : 1);
  const total = Math.max(1, items.reduce((sum, n) => sum + widthOf(n), 0));
  let cursor = 0;
  for (const item of items) {
    const slots = widthOf(item);
    const x = centerX + (cursor + (slots - 1) / 2 - (total - 1) / 2) * COL;
    pts.set(item.id, { x, y: DEVICE_Y });
    (behind.get(item.id) ?? []).forEach((child, i) =>
      pts.set(child.id, { x: centerX + (cursor + i - (total - 1) / 2) * COL, y: BACKUP_CHILD_Y }),
    );
    cursor += slots;
  }

  // Nodes met handmatige positie zijn uit `auto` gefilterd; Home blijft altijd het centrale knooppunt.
  return { width: Math.round(width), height, positions: pts };
}

// ----- Recht ----------------------------------------------------------------------------------

const COL = 118; // afstand tussen twee nodes in een rij
const MARGIN_X = 62;
const MARGIN_Y = 92; // ruimte voor de naam boven de bovenste en onder de onderste rij
const SIDE_LABEL = 78; // ruimte voor een naam naast Home of een backup
const MIN_ASPECT = 0.8; // breedte / hoogte
const MAX_ASPECT = 1.7;

/**
 * Rechte layout, van boven naar beneden zoals bij een energiemanagementsysteem:
 *   net
 *   batterij (links) en zon (rechts), met ruimte in het midden voor de lijn naar Home
 *   Home
 *   apparaten en backup, met daaronder de apparaten die achter een backup hangen
 */
function straightLayout(nodes: readonly EnergyNode[], auto: readonly EnergyNode[], links: readonly Connection[]): Base {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pts = new Map<string, Point>();
  const home = nodes.find((n) => n.role === 'home');
  if (home) pts.set(home.id, { x: 0, y: 0 });

  const row = (list: readonly EnergyNode[], y: number) =>
    list.forEach((n, i) => pts.set(n.id, { x: (i - (list.length - 1) / 2) * COL, y }));

  // Boven Home: net, batterij en zon.
  const grids = auto.filter((n) => n.type === 'grid');
  const storages = auto.filter((n) => n.type === 'battery');
  const producers = auto.filter((n) => n.role === 'source');
  const near = [...storages, ...producers];
  if (grids.length > 0 && near.length > 0) {
    row(grids, -2 * STRAIGHT_ROW_GAP);
    // De lijn van het net loopt tussen de andere nodes door naar Home, dus het midden blijft vrij.
    // Batterijen staan links, zon rechts; is een kant leeg, dan verdelen we de andere kant over beide zijden.
    let left = storages;
    let right = producers;
    if (storages.length === 0) [right, left] = [producers.filter((_, i) => i % 2 === 0), producers.filter((_, i) => i % 2 === 1)];
    else if (producers.length === 0) [left, right] = [storages.filter((_, i) => i % 2 === 0), storages.filter((_, i) => i % 2 === 1)];
    left.forEach((n, i) => pts.set(n.id, { x: -(i + 1) * COL, y: -STRAIGHT_ROW_GAP }));
    right.forEach((n, i) => pts.set(n.id, { x: (i + 1) * COL, y: -STRAIGHT_ROW_GAP }));
  } else if (grids.length > 0) {
    row(grids, -STRAIGHT_ROW_GAP);
  } else {
    row(near, -STRAIGHT_ROW_GAP);
  }

  // Onder Home: gewone apparaten, dan de backups; onder elke backup de apparaten die erachter hangen.
  const devices = auto.filter((n) => n.role === 'consumer' && n.type !== 'backup');
  const backups = auto.filter((n) => n.type === 'backup');
  const behind = new Map<string, EnergyNode[]>();
  const direct: EnergyNode[] = [];
  for (const device of devices) {
    const parent = backupParentOf(device, byId, links);
    if (parent && backups.includes(parent)) behind.set(parent.id, [...(behind.get(parent.id) ?? []), device]);
    else direct.push(device);
  }
  const items = [...direct, ...backups];
  const widthOf = (n: EnergyNode) => Math.max(1, behind.get(n.id)?.length ?? 1);
  const total = items.reduce((sum, n) => sum + widthOf(n), 0);
  let cursor = 0;
  for (const item of items) {
    const w = widthOf(item);
    pts.set(item.id, { x: (cursor + (w - 1) / 2 - (total - 1) / 2) * COL, y: STRAIGHT_ROW_GAP });
    (behind.get(item.id) ?? []).forEach((child, i) =>
      pts.set(child.id, { x: (cursor + i - (total - 1) / 2) * COL, y: 2 * STRAIGHT_ROW_GAP }),
    );
    cursor += w;
  }

  // Kaart om alles heen, niet te smal en niet te breed.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [id, p] of pts) {
    const r = byId.get(id)?.role === 'home' ? HOME_RADIUS : NODE_RADIUS;
    minX = Math.min(minX, p.x - r);
    const node = byId.get(id);
    // Home en backup hebben hun naam rechts naast zich staan.
    maxX = Math.max(maxX, p.x + r + (node?.role === 'home' || node?.type === 'backup' ? SIDE_LABEL : 0));
    minY = Math.min(minY, p.y - r);
    maxY = Math.max(maxY, p.y + r);
  }
  if (!Number.isFinite(minX)) return { width: 100, height: 100, positions: new Map() };
  // Alles staat gecentreerd rond Home; houd de kaart ook zo, zodat de naam naast Home de rest niet uit het midden duwt.
  const half = Math.max(-minX, maxX);
  minX = -half;
  maxX = half;

  let width = maxX - minX + 2 * MARGIN_X;
  let height = maxY - minY + 2 * MARGIN_Y;
  let dx = MARGIN_X - minX;
  let dy = MARGIN_Y - minY;
  if (width / height < MIN_ASPECT) {
    const extra = height * MIN_ASPECT - width;
    width += extra;
    dx += extra / 2;
  } else if (width / height > MAX_ASPECT) {
    const extra = width / MAX_ASPECT - height;
    height += extra;
    dy += extra / 2;
  }

  const positions = new Map<string, Point>();
  for (const [id, p] of pts) positions.set(id, { x: p.x + dx, y: p.y + dy });
  return { width: Math.round(width), height: Math.round(height), positions };
}
