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

/** Bovenliggende node van een verbruiker, voor hiërarchische branches. Home wordt als root behandeld en niet teruggegeven. */
function consumerParentOf(node: EnergyNode, byId: ReadonlyMap<string, EnergyNode>, links: readonly Connection[]) {
  if (node.role !== 'consumer' || node.type === 'backup') return undefined;
  const incoming = links.find((c) => c.to === node.id);
  if (!incoming) return undefined;
  const parent = byId.get(incoming.from);
  if (!parent || parent.role === 'home') return undefined;
  return parent.type === 'backup' || parent.role === 'consumer' ? parent : undefined;
}

function consumerChildrenOf(node: EnergyNode, byId: ReadonlyMap<string, EnergyNode>, links: readonly Connection[]): EnergyNode[] {
  return links
    .filter((c) => c.from === node.id)
    .map((c) => byId.get(c.to))
    .filter((child): child is EnergyNode => !!child && child.role === 'consumer' && child.type !== 'backup');
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

  // 3. Zet eerst verbruikers die direct aan Home hangen.
  const devices = members.get('device') ?? [];
  const roots = devices.filter((device) => !consumerParentOf(device, byId, links));
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
  for (const device of roots) {
    const slot = nextDeviceSlot();
    take(device, slot.ring, slot.index);
  }

  // 4. Kinderen komen op een buitenste ring in de richting van hun parent. Meerdere niveaus worden iteratief geplaatst.
  const pending = devices.filter((device) => !placed.has(device.id));
  let guard = 0;
  while (pending.length && guard++ < devices.length + 2) {
    let progressed = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const device = pending[i]!;
      const parent = consumerParentOf(device, byId, links);
      const parentSlot = parent ? placed.get(parent.id) : undefined;
      if (!parentSlot) continue;
      const slot = nearestFree(slotAngle(parentSlot.ring, parentSlot.index), parentSlot.ring + 1);
      take(device, slot.ring, slot.index);
      pending.splice(i, 1);
      progressed = true;
    }
    if (!progressed) break;
  }
  for (const device of pending) {
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
  const autoIds = new Set(auto.map((n) => n.id));
  const pts = new Map<string, Point>();
  const home = nodes.find((n) => n.role === 'home');

  const producers = auto.filter((n) => n.role === 'source');
  const grids = auto.filter((n) => n.type === 'grid');
  const batteries = auto.filter((n) => n.type === 'battery');
  const consumerNodes = auto.filter((n) => n.role === 'consumer');

  const COL = 126;
  const SIDE_NODE_X = 78;
  const TOP_Y = 76;
  const SOURCE_TO_HOME = 150;
  const HOME_TO_FIRST_ROW = 150;
  const ROW_GAP = 146;
  const TREE_ROW_GAP = 116;
  const MAX_ROW_SLOTS = 5;
  const MIN_WIDTH = 520;
  const H_MARGIN = 72;
  const V_MARGIN = 26;
  const LABEL_BOTTOM = 44;
  const LABEL_TOP = 24;
  const SIDE_LABEL = 74;
  const REGION_GAP = 72;
  const SIBLING_GAP = 18;

  const children = new Map<string, EnergyNode[]>();
  for (const node of consumerNodes) {
    if (node.type === 'backup') continue;
    const parent = consumerParentOf(node, byId, links);
    if (parent && autoIds.has(parent.id)) children.set(parent.id, [...(children.get(parent.id) ?? []), node]);
  }

  const hasParentInAuto = (node: EnergyNode) => {
    const parent = consumerParentOf(node, byId, links);
    return !!parent && autoIds.has(parent.id);
  };
  const roots = consumerNodes.filter((n) => n.type === 'backup' || !hasParentInAuto(n));
  const plainRoots = roots.filter((n) => n.type !== 'backup' && (children.get(n.id)?.length ?? 0) === 0);
  const treeRoots = roots.filter((n) => n.type === 'backup' || (children.get(n.id)?.length ?? 0) > 0);

  const subtreeWidth = (node: EnergyNode, visiting = new Set<string>()): number => {
    if (visiting.has(node.id)) return COL;
    const next = new Set(visiting); next.add(node.id);
    const kids = children.get(node.id) ?? [];
    if (!kids.length) return COL;
    if (node.type === 'backup' && kids.length > 3) return 3 * COL;
    const widths = kids.map((kid) => subtreeWidth(kid, next));
    return Math.max(COL, widths.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * SIBLING_GAP);
  };

  const plainRows: EnergyNode[][] = [];
  for (let i = 0; i < plainRoots.length; i += MAX_ROW_SLOTS) plainRows.push(plainRoots.slice(i, i + MAX_ROW_SLOTS));
  const plainWidth = Math.max(0, ...plainRows.map((row) => Math.max(COL, row.length * COL)));
  const treeWidths = treeRoots.map((root) => subtreeWidth(root));
  const treesWidth = treeWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, treeWidths.length - 1) * REGION_GAP;
  const lowerWidth = plainWidth + (plainWidth && treesWidth ? REGION_GAP : 0) + treesWidth;
  const topWidth = Math.max(1, producers.length) * COL;
  let width = Math.max(MIN_WIDTH, lowerWidth + 2 * H_MARGIN, topWidth + 2 * H_MARGIN + 80);
  const centerX = width / 2;
  const homeY = producers.length > 0 ? TOP_Y + SOURCE_TO_HOME : TOP_Y + 58;
  if (home) pts.set(home.id, { x: centerX, y: homeY });

  producers.forEach((n, i) => pts.set(n.id, { x: centerX + (i - (producers.length - 1) / 2) * COL, y: TOP_Y }));
  const sideY = (i: number, count: number) => homeY + (i - (count - 1) / 2) * 108;
  grids.forEach((n, i) => pts.set(n.id, { x: SIDE_NODE_X, y: sideY(i, grids.length) }));
  batteries.forEach((n, i) => pts.set(n.id, { x: width - SIDE_NODE_X, y: sideY(i, batteries.length) }));

  const firstRowY = homeY + HOME_TO_FIRST_ROW;
  let cursor = (width - lowerWidth) / 2;

  if (plainWidth > 0) {
    const plainCenter = cursor + plainWidth / 2;
    plainRows.forEach((row, rowIndex) => {
      const y = firstRowY + rowIndex * ROW_GAP;
      row.forEach((node, i) => pts.set(node.id, { x: plainCenter + (i - (row.length - 1) / 2) * COL, y }));
    });
    cursor += plainWidth + (treesWidth ? REGION_GAP : 0);
  }

  const placeTree = (node: EnergyNode, left: number, treeWidth: number, depth: number, visiting = new Set<string>()) => {
    if (visiting.has(node.id)) return;
    const next = new Set(visiting); next.add(node.id);
    pts.set(node.id, { x: left + treeWidth / 2, y: firstRowY + depth * TREE_ROW_GAP });
    const kids = children.get(node.id) ?? [];
    if (!kids.length) return;
    if (node.type === 'backup' && kids.length > 3) {
      const cols = 3;
      kids.forEach((kid, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const countThisRow = Math.min(cols, kids.length - row * cols);
        const childWidth = subtreeWidth(kid, next);
        const center = left + treeWidth / 2 + (col - (countThisRow - 1) / 2) * COL;
        placeTree(kid, center - childWidth / 2, childWidth, depth + 1 + row, next);
      });
      return;
    }
    const widths = kids.map((kid) => subtreeWidth(kid, next));
    const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * SIBLING_GAP;
    let childLeft = left + (treeWidth - total) / 2;
    kids.forEach((kid, i) => {
      placeTree(kid, childLeft, widths[i]!, depth + 1, next);
      childLeft += widths[i]! + SIBLING_GAP;
    });
  };
  treeRoots.forEach((root, i) => {
    const w = treeWidths[i]!;
    placeTree(root, cursor, w, 0);
    cursor += w + REGION_GAP;
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [id, point] of pts) {
    const node = byId.get(id);
    const radius = node?.role === 'home' ? HOME_RADIUS : NODE_RADIUS;
    minX = Math.min(minX, point.x - radius);
    maxX = Math.max(maxX, point.x + radius + (node?.role === 'home' || node?.type === 'backup' ? SIDE_LABEL : 0));
    minY = Math.min(minY, point.y - radius - LABEL_TOP);
    maxY = Math.max(maxY, point.y + radius + LABEL_BOTTOM);
  }
  if (!Number.isFinite(minX)) return { width: MIN_WIDTH, height: 220, positions: new Map() };

  const horizontalHalf = Math.max(centerX - minX, maxX - centerX);
  minX = centerX - horizontalHalf;
  maxX = centerX + horizontalHalf;
  const fittedWidth = Math.max(MIN_WIDTH, maxX - minX + 2 * H_MARGIN);
  const fittedHeight = Math.max(260, maxY - minY + 2 * V_MARGIN);
  const dx = (fittedWidth - (maxX - minX)) / 2 - minX;
  const dy = V_MARGIN - minY;

  const positions = new Map<string, Point>();
  for (const [id, point] of pts) positions.set(id, { x: point.x + dx, y: point.y + dy });
  return { width: Math.round(fittedWidth), height: Math.round(fittedHeight), positions };
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

  // Onder Home: verbruikers vormen een boom. Een gemeten parent blijft één tak voor Home;
  // de kinderen staan eronder als uitsplitsing en worden dus niet dubbel op de hoofdflow aangesloten.
  const consumerNodes = auto.filter((n) => n.role === 'consumer');
  const autoIds = new Set(auto.map((n) => n.id));
  const children = new Map<string, EnergyNode[]>();
  for (const device of consumerNodes) {
    if (device.type === 'backup') continue;
    const parent = consumerParentOf(device, byId, links);
    if (parent && autoIds.has(parent.id)) children.set(parent.id, [...(children.get(parent.id) ?? []), device]);
  }
  const roots = consumerNodes.filter((node) => node.type === 'backup' || !consumerParentOf(node, byId, links) || !autoIds.has(consumerParentOf(node, byId, links)!.id));
  const widthOf = (node: EnergyNode, visiting = new Set<string>()): number => {
    if (visiting.has(node.id)) return 1;
    const next = new Set(visiting); next.add(node.id);
    const kids = children.get(node.id) ?? [];
    if (!kids.length) return 1;
    return Math.max(1, kids.reduce((sum, child) => sum + widthOf(child, next), 0));
  };
  const widths = roots.map((root) => widthOf(root));
  const total = widths.reduce((sum, value) => sum + value, 0);
  const place = (node: EnergyNode, start: number, width: number, depth: number, visiting = new Set<string>()) => {
    if (visiting.has(node.id)) return;
    const next = new Set(visiting); next.add(node.id);
    pts.set(node.id, { x: (start + (width - 1) / 2 - (total - 1) / 2) * COL, y: depth * STRAIGHT_ROW_GAP });
    let cursor = start;
    for (const child of children.get(node.id) ?? []) {
      const childWidth = widthOf(child, next);
      place(child, cursor, childWidth, depth + 1, next);
      cursor += childWidth;
    }
  };
  let lowerCursor = 0;
  roots.forEach((root, i) => {
    place(root, lowerCursor, widths[i]!, 1);
    lowerCursor += widths[i]!;
  });

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
