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

  /*
   * v0.8: de Flow-weergave is inhoudsgestuurd in plaats van een vaste canvasmaat.
   * - maximaal vijf verbruikerslots per rij;
   * - extra apparaten gaan automatisch naar een volgende rij;
   * - de kaart wordt na plaatsing strak om de nodes heen getrokken;
   * - boven en onder blijft hooguit een vaste, rustige buitenmarge over.
   */
  const COL = 126;
  const SIDE_NODE_X = 78;
  const TOP_Y = 76;
  const SOURCE_TO_HOME = 150;
  const HOME_TO_FIRST_ROW = 150;
  const ROW_GAP = 146;
  const BACKUP_CHILD_GAP = 142;
  const MAX_ROW_SLOTS = 5;
  const MIN_WIDTH = 520;
  const H_MARGIN = 72;
  const V_MARGIN = 26;
  const LABEL_BOTTOM = 44;
  const LABEL_TOP = 24;
  const SIDE_LABEL = 74;

  // v0.8.1: gewone verbruikers en backup-takken krijgen ieder hun eigen gebied.
  // Daardoor kan de lijn naar een backup nooit meer dwars door gewone verbruikers lopen.
  const directRows: EnergyNode[][] = [];
  for (let i = 0; i < direct.length; i += MAX_ROW_SLOTS) directRows.push(direct.slice(i, i + MAX_ROW_SLOTS));

  const directMax = Math.max(0, ...directRows.map((row) => row.length));
  const backupColumns = backups.length;
  const topSlots = Math.max(1, producers.length);
  const lowerSlots = Math.max(3, directMax + (backupColumns > 0 ? backupColumns + 1 : 0));
  const contentSlots = Math.max(3, topSlots, lowerSlots);
  let width = Math.max(MIN_WIDTH, contentSlots * COL + 2 * 138);
  const centerX = width / 2;
  const homeY = producers.length > 0 ? TOP_Y + SOURCE_TO_HOME : TOP_Y + 58;

  if (home) pts.set(home.id, { x: centerX, y: homeY });

  // Productie boven Home, horizontaal verdeeld.
  producers.forEach((n, i) => pts.set(n.id, { x: centerX + (i - (producers.length - 1) / 2) * COL, y: TOP_Y }));

  // Net links en opslag rechts, verticaal rond Home bij meerdere exemplaren.
  const sideY = (i: number, count: number) => homeY + (i - (count - 1) / 2) * 108;
  grids.forEach((n, i) => pts.set(n.id, { x: SIDE_NODE_X, y: sideY(i, grids.length) }));
  batteries.forEach((n, i) => pts.set(n.id, { x: width - SIDE_NODE_X, y: sideY(i, batteries.length) }));

  const firstRowY = homeY + HOME_TO_FIRST_ROW;

  // Gewone verbruikers: maximaal vijf per rij en daarna automatisch wrappen.
  // Als er backups zijn, schuift dit raster iets naar links zodat rechts een vrij backup-pad ontstaat.
  const consumerShift = backupColumns > 0 ? -0.55 * COL : 0;
  directRows.forEach((row, rowIndex) => {
    const rowY = firstRowY + rowIndex * ROW_GAP;
    row.forEach((node, i) => {
      const x = centerX + consumerShift + (i - (row.length - 1) / 2) * COL;
      pts.set(node.id, { x, y: rowY });
    });
  });

  // Backup-takken krijgen rechts een eigen kolom. De apparaten achter een backup worden
  // onder elkaar gestapeld. Zo blijft de hele tak leesbaar en kruist hij geen gewone nodes.
  const backupBaseX = centerX + Math.max(1.55 * COL, ((Math.max(1, directMax) - 1) / 2 + 1.25) * COL);
  backups.forEach((backup, backupIndex) => {
    const x = backupBaseX + backupIndex * 1.35 * COL;
    pts.set(backup.id, { x, y: firstRowY });
    const children = behind.get(backup.id) ?? [];
    children.forEach((child, childIndex) => {
      pts.set(child.id, { x, y: firstRowY + (childIndex + 1) * BACKUP_CHILD_GAP });
    });
  });

  // Trek de SVG strak om de werkelijke inhoud. Hiermee verdwijnt de grote lege onderkant.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [id, p] of pts) {
    const node = byId.get(id);
    const radius = node?.role === 'home' ? HOME_RADIUS : NODE_RADIUS;
    minX = Math.min(minX, p.x - radius);
    maxX = Math.max(maxX, p.x + radius + (node?.role === 'home' || node?.type === 'backup' ? SIDE_LABEL : 0));
    minY = Math.min(minY, p.y - radius - LABEL_TOP);
    maxY = Math.max(maxY, p.y + radius + LABEL_BOTTOM);
  }
  if (!Number.isFinite(minX)) return { width: MIN_WIDTH, height: 220, positions: new Map() };

  // Houd Home visueel in het midden van de horizontale ruimte, maar verspil verticaal geen hoogte.
  const horizontalHalf = Math.max(centerX - minX, maxX - centerX);
  minX = centerX - horizontalHalf;
  maxX = centerX + horizontalHalf;

  const fittedWidth = Math.max(MIN_WIDTH, maxX - minX + 2 * H_MARGIN);
  const fittedHeight = Math.max(260, maxY - minY + 2 * V_MARGIN);
  const dx = (fittedWidth - (maxX - minX)) / 2 - minX;
  const dy = V_MARGIN - minY;

  const positions = new Map<string, Point>();
  for (const [id, p] of pts) positions.set(id, { x: p.x + dx, y: p.y + dy });
  width = fittedWidth;
  return { width: Math.round(width), height: Math.round(fittedHeight), positions };
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
