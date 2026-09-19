import { STRAIGHT_ROW_GAP } from '../layout/AutoLayout';
import type { Point } from '../layout/AutoLayout';
import type { Connection } from '../models/Connection';
import { setAttr, svg } from './dom';

export interface Endpoint {
  center: Point;
  radius: number;
}

export interface FlowContext {
  /** Vermogen waarbij deeltjes op topsnelheid bewegen. */
  maxPower: number;
  /** Globale vermenigvuldiger op de snelheid. */
  animationSpeed: number;
  /** false bij "animation: false" of prefers-reduced-motion: er komt dan een pijltje in plaats van deeltjes. */
  animate: boolean;
}

export interface ConnectionElement {
  el: SVGGElement;
  /** flow: positief = from → to, 0 = stil, null = onbekend. */
  update(flow: number | null, ctx: FlowContext): void;
}

const GAP = 3;
const PARTICLES = 3;

export interface Geometry {
  forward: string;
  backward: string;
  length: number;
  mid: Point;
  /** Hoek (graden) van de lijn in het midden, in richting from → to. */
  angle: number;
}

const f1 = (n: number) => n.toFixed(1);

/** Punten verbinden met afgeronde hoeken. Geeft ook de lengte en het midden (met de hoek daar) terug. */
function roundedRoute(points: Point[], corner: number): { d: string; length: number; mid: Point; angle: number } {
  let d = `M${f1(points[0]!.x)} ${f1(points[0]!.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const r = Math.min(corner, l1 / 2, l2 / 2);
    const a = { x: p1.x + ((p0.x - p1.x) / l1) * r, y: p1.y + ((p0.y - p1.y) / l1) * r };
    const b = { x: p1.x + ((p2.x - p1.x) / l2) * r, y: p1.y + ((p2.y - p1.y) / l2) * r };
    d += ` L${f1(a.x)} ${f1(a.y)} Q${f1(p1.x)} ${f1(p1.y)} ${f1(b.x)} ${f1(b.y)}`;
  }
  const last = points[points.length - 1]!;
  d += ` L${f1(last.x)} ${f1(last.y)}`;

  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const length = lengths.reduce((a, b) => a + b, 0);
  let left = length / 2;
  let mid = points[0]!;
  let angle = 0;
  for (let i = 0; i < lengths.length; i++) {
    const seg = lengths[i]!;
    const a = points[i]!;
    const b = points[i + 1]!;
    angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (left <= seg || i === lengths.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, left / seg);
      mid = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      break;
    }
    left -= seg;
  }
  return { d, length, mid, angle };
}

/**
 * Rechte verbinding: recht naar beneden, dan opzij, dan weer recht naar beneden, met afgeronde hoeken.
 * Verbindingen die op dezelfde plek uitkomen (bijvoorbeeld de lijn van elke bron naar Home) lopen zo over
 * één gedeelde lijn. Staan de nodes naast elkaar, dan blijft het een gewone rechte lijn.
 */
function orthogonalGeometry(a: Endpoint, b: Endpoint, rowGap: number): Geometry | null {
  if (Math.abs(a.center.y - b.center.y) < 40) return null;
  const aIsUpper = a.center.y < b.center.y;
  const upper = aIsUpper ? a : b;
  const lower = aIsUpper ? b : a;
  const start = { x: upper.center.x, y: upper.center.y + upper.radius + GAP };
  const end = { x: lower.center.x, y: lower.center.y - lower.radius - GAP };

  let points: Point[];
  if (Math.abs(start.x - end.x) < 1) {
    points = [start, end];
  } else {
    const busY = Math.min(end.y - 24, upper.center.y + rowGap / 2);
    points = [start, { x: start.x, y: busY }, { x: end.x, y: busY }, end];
  }
  const fromTo = aIsUpper ? points : [...points].reverse();
  const toFrom = [...fromTo].reverse();
  const forward = roundedRoute(fromTo, 14);
  return {
    forward: forward.d,
    backward: roundedRoute(toFrom, 14).d,
    length: forward.length,
    mid: forward.mid,
    angle: forward.angle,
  };
}

/**
 * Lijn van rand naar rand van de nodes. Verbindingen die niet via Home lopen krijgen
 * een lichte bocht, zodat ze niet dwars door het midden gaan.
 */
export function computeGeometry(
  a: Endpoint,
  b: Endpoint,
  curved: boolean,
  orthogonal = false,
  rowGap: number = STRAIGHT_ROW_GAP,
): Geometry {
  if (orthogonal) {
    const route = orthogonalGeometry(a, b, rowGap);
    if (route) return route;
  }
  const dx = b.center.x - a.center.x;
  const dy = b.center.y - a.center.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  const p0 = { x: a.center.x + ux * (a.radius + GAP), y: a.center.y + uy * (a.radius + GAP) };
  const p1 = { x: b.center.x - ux * (b.radius + GAP), y: b.center.y - uy * (b.radius + GAP) };
  const length = Math.max(0, dist - a.radius - b.radius - 2 * GAP);

  const f = (n: number) => n.toFixed(1);
  if (!curved) {
    return {
      forward: `M${f(p0.x)} ${f(p0.y)} L${f(p1.x)} ${f(p1.y)}`,
      backward: `M${f(p1.x)} ${f(p1.y)} L${f(p0.x)} ${f(p0.y)}`,
      length,
      mid: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  }

  const bend = 0.18 * length;
  const c = { x: (p0.x + p1.x) / 2 - uy * bend, y: (p0.y + p1.y) / 2 + ux * bend };
  const mid = { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p1.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p1.y };
  return {
    forward: `M${f(p0.x)} ${f(p0.y)} Q${f(c.x)} ${f(c.y)} ${f(p1.x)} ${f(p1.y)}`,
    backward: `M${f(p1.x)} ${f(p1.y)} Q${f(c.x)} ${f(c.y)} ${f(p0.x)} ${f(p0.y)}`,
    length,
    mid,
    angle: (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI,
  };
}

/** Duur van één rondje in seconden: hoe meer vermogen, hoe sneller. Gekwantiseerd om herstarten te beperken. */
export function particleDuration(watts: number, ctx: FlowContext, connectionSpeed: number): number {
  const load = Math.min(1, Math.log1p(Math.abs(watts)) / Math.log1p(Math.max(1, ctx.maxPower)));
  const seconds = (7 - 5 * load) / (Math.max(0.05, ctx.animationSpeed) * Math.max(0.05, connectionSpeed));
  return Math.min(14, Math.max(1.5, Math.round(seconds * 2) / 2));
}

export function createConnectionElement(
  conn: Connection,
  from: Endpoint,
  to: Endpoint,
  curved: boolean,
  color: string | undefined,
  orthogonal = false,
): ConnectionElement | null {
  const geo = computeGeometry(from, to, curved, orthogonal);
  if (geo.length < 4) return null;

  const g = svg('g', { class: 'connection', 'data-connection': conn.id });
  if (!conn.visible) g.setAttribute('display', 'none');
  if (color) g.setAttribute('style', `--c:${color}`);

  const line = svg('path', { class: 'line', d: geo.forward, 'stroke-width': conn.width, fill: 'none' });
  const chevron = svg('path', {
    class: 'chevron',
    d: 'M-6 -5 L3 0 L-6 5',
    fill: 'none',
    'stroke-width': 2.2,
    transform: `translate(${geo.mid.x.toFixed(1)} ${geo.mid.y.toFixed(1)}) rotate(${geo.angle.toFixed(1)})`,
  });
  g.append(line, chevron);

  const dots: SVGCircleElement[] = [];
  const motions: SVGAnimateMotionElement[] = [];
  const radius = conn.width * 1.2 + 0.8;
  const count = geo.length < 110 ? 2 : PARTICLES;
  for (let i = 0; i < count; i++) {
    const motion = svg('animateMotion', { repeatCount: 'indefinite', path: geo.forward, dur: '4s', begin: '0s' });
    const dot = svg('circle', { class: 'particle', r: radius.toFixed(1), visibility: 'hidden' }, motion);
    dots.push(dot);
    motions.push(motion);
    g.append(dot);
  }

  let lastKey = '';

  const update = (flow: number | null, ctx: FlowContext): void => {
    const state = flow === null ? 'unknown' : flow === 0 ? 'idle' : 'flowing';
    setAttr(g, 'data-flow', state);
    if (state !== 'flowing') {
      if (lastKey !== state) {
        lastKey = state;
        dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      }
      return;
    }

    const forward = (flow as number) > 0;
    const dur = particleDuration(flow as number, ctx, conn.animated ? conn.speed : 1);
    const animate = ctx.animate && conn.animated;
    setAttr(g, 'data-animated', String(animate));
    const key = `${forward}|${dur}|${animate}`;
    if (key === lastKey) return;
    lastKey = key;

    // Richting van de pijl (voor als er niet geanimeerd wordt)
    chevron.setAttribute(
      'transform',
      `translate(${geo.mid.x.toFixed(1)} ${geo.mid.y.toFixed(1)}) rotate(${(geo.angle + (forward ? 0 : 180)).toFixed(1)})`,
    );

    motions.forEach((m, i) => {
      m.setAttribute('path', forward ? geo.forward : geo.backward);
      m.setAttribute('dur', `${dur}s`);
      m.setAttribute('begin', `${(-(dur * i) / count).toFixed(2)}s`);
    });
    dots.forEach((d) => d.setAttribute('visibility', animate ? 'visible' : 'hidden'));
  };

  return { el: g, update };
}
