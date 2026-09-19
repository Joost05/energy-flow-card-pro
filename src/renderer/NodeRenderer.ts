import type { NodeReading } from '../helpers/flowHelper';
import { t } from '../helpers/i18n';
import { formatPercent, formatPower, PowerFormat } from '../helpers/stateHelper';
import type { EnergyNode } from '../models/Node';
import type { Point } from '../layout/AutoLayout';
import { EntityStatus, hasValue, statusSymbol } from '../types/EntityStatus';
import { TYPES_WITH_DEFAULT_ICON } from '../types/NodeType';
import { setAttr, setText, svg } from './dom';

/** Wat er op een node getoond wordt. Wordt bij elke update opnieuw afgeleid uit de live state. */
export interface NodeView {
  displayName: string;
  status: EntityStatus;
  /** "1250 W", "?" of "!" */
  valueText: string;
  /** Batterij: "78%", "?" of "!" (alleen als er een SOC-sensor is). */
  socText?: string;
  /** Kleine tekst onder de naam, bijvoorbeeld "Laden" of "Teruglevering". */
  subtitle?: string;
  /** Batterijniveau 0..1 voor het icoon. */
  level?: number;
  /** Alleen voor echte diagnoseproblemen; info-items krijgen geen badge. */
  diagnostic?: 'info' | 'warning' | 'error';
  /** Number of consumer descendants behind this node. */
  childCount?: number;
}

export interface DescribeContext {
  powerFormat: PowerFormat;
  language?: string;
}

const DEFAULT_NAMES: Record<string, string> = { home: 'home', grid: 'grid', solar: 'solar', battery: 'battery', backup: 'type_backup' };

export function displayNameOf(node: EnergyNode, language?: string): string {
  if (node.name) return node.name;
  return t(DEFAULT_NAMES[node.type] ?? node.type, language);
}

/** Vertaalt een reading naar tekst en status. Hier komen de statusregels samen. */
export function describeNode(node: EnergyNode, reading: NodeReading, ctx: DescribeContext): NodeView {
  const { language, powerFormat } = ctx;
  let status = reading.status;
  if (hasValue(status) && reading.charging) status = EntityStatus.Charging;

  const symbol = statusSymbol(status);
  const valueText = symbol ?? formatPower(reading.watts ?? 0, powerFormat);

  const view: NodeView = { displayName: displayNameOf(node, language), status, valueText };

  if (reading.soc) {
    const s = reading.soc;
    view.socText = s.value !== null ? formatPercent(s.value) : (statusSymbol(s.status) ?? '?');
    if (s.value !== null) view.level = Math.min(1, Math.max(0, s.value / 100));
  }

  if (hasValue(status) && reading.watts !== null && reading.watts !== 0) {
    if (node.type === 'battery') view.subtitle = t(reading.watts < 0 ? 'charging' : 'discharging', language);
    else if (node.type === 'grid') view.subtitle = t(reading.watts < 0 ? 'exporting' : 'importing', language);
    else if (node.type === 'ev_charger') view.subtitle = t('charging', language);
  }
  return view;
}

export interface NodeElement {
  el: SVGGElement;
  update(view: NodeView): void;
}

const BOLT = 'M2.5 -7 L-4 1.5 L-0.5 1.5 L-2.5 7 L4 -1.5 L0.5 -1.5 Z';

function glyph(type: string): SVGGElement {
  const g = svg('g', { class: 'glyph', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  switch (type) {
    case 'home':
      g.append(
        svg('path', { d: 'M3.5 11.5 L12 4 L20.5 11.5' }),
        svg('path', { d: 'M6 10 V20 H18 V10' }),
        svg('path', { d: 'M10 20 V14.5 H14 V20' }),
      );
      break;
    case 'grid':
      g.append(
        svg('path', { d: 'M12 3 L7 21 M12 3 L17 21' }),
        svg('path', { d: 'M4.5 7 H19.5' }),
        svg('path', { d: 'M9.6 11.5 H14.4 M8.4 16 H15.6' }),
        svg('path', { d: 'M9.6 11.5 L15.6 16 M14.4 11.5 L8.4 16' }),
      );
      break;
    case 'solar': {
      g.append(svg('circle', { cx: 12, cy: 12, r: 4.2 }));
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const [c, s] = [Math.cos(a), Math.sin(a)];
        g.append(
          svg('path', {
            d: `M${(12 + 7.2 * c).toFixed(2)} ${(12 + 7.2 * s).toFixed(2)} L${(12 + 9.6 * c).toFixed(2)} ${(12 + 9.6 * s).toFixed(2)}`,
          }),
        );
      }
      break;
    }
    case 'battery':
      g.append(
        svg('rect', { x: 6.5, y: 5, width: 11, height: 17, rx: 2.2 }),
        svg('rect', { x: 10, y: 2, width: 4, height: 3, rx: 0.8 }),
        svg('rect', { class: 'level', x: 8.5, y: 20, width: 7, height: 0, rx: 0.8, fill: 'currentColor', stroke: 'none' }),
      );
      break;
    case 'backup':
      // Generator/alternator: duidelijker als alternatieve voedingsbron dan het oude schild.
      g.append(
        svg('rect', { x: 4, y: 6, width: 16, height: 12, rx: 2.2 }),
        svg('circle', { cx: 10, cy: 12, r: 3.1 }),
        svg('path', { d: 'M13.3 12 H17 M17 9.6 V14.4 M6.5 18 V20 M17.5 18 V20' }),
      );
      break;
    default:
      break;
  }
  return g;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function createNodeElement(
  node: EnergyNode,
  center: Point,
  radius: number,
  onOpen: () => void,
  /**
   * Waar de naam staat: onder de node, erboven (nodes boven Home, zodat de lijn naar Home vrij blijft)
   * of ernaast (nodes waar aan twee kanten een lijn uitkomt).
   */
  labelPosition: 'below' | 'above' | 'side' = 'below',
): NodeElement {
  const labelAbove = labelPosition === 'above';
  const labelSide = labelPosition === 'side';
  const hasGlyph = TYPES_WITH_DEFAULT_ICON.has(node.type) && !node.icon;
  const hasIcon = hasGlyph || !!node.icon;
  const isBattery = node.type === 'battery';

  const g = svg('g', {
    class: `node type-${node.type}`,
    transform: `translate(${center.x.toFixed(1)} ${center.y.toFixed(1)})`,
    tabindex: 0,
    role: 'button',
    'data-node': node.id,
  });

  const title = svg('title');
  const halo = svg('circle', { class: 'halo', r: radius + 6 });
  const ring = svg('circle', { class: 'ring', r: radius });
  g.append(title, halo, ring);

  let levelRect: SVGRectElement | null = null;
  if (hasGlyph) {
    const iconG = glyph(node.type);
    const scale = isBattery ? 0.72 : node.type === 'home' ? 1.25 : 1.05;
    const y = isBattery ? -radius * 0.5 : -radius * 0.32;
    iconG.setAttribute('transform', `translate(0 ${y.toFixed(1)}) scale(${scale}) translate(-12 -12)`);
    iconG.setAttribute('stroke-width', String(1.7 / scale));
    g.append(iconG);
    levelRect = iconG.querySelector('.level');
  } else if (node.icon) {
    // ha-icon zorgt in Home Assistant voor alle mdi:-iconen.
    const size = 26;
    const fo = svg('foreignObject', { x: -size / 2, y: -radius * 0.32 - size / 2 - 2, width: size, height: size });
    const icon = document.createElement('ha-icon');
    icon.setAttribute('icon', node.icon);
    icon.style.cssText = `--mdc-icon-size:${size}px;display:flex;width:${size}px;height:${size}px;color:var(--c)`;
    fo.append(icon);
    g.append(fo);
  }

  // Tekstregels in de cirkel
  const nameIn = svg('text', { class: 'name-in', y: -3, 'text-anchor': 'middle' });
  const socText = svg('text', { class: 'soc', y: 4, 'text-anchor': 'middle' });
  const valueY = isBattery ? 24 : hasIcon ? radius * 0.5 + 4 : 17;
  const value = svg('text', { class: 'value', y: valueY, 'text-anchor': 'middle' });
  const label = labelSide
    ? svg('text', { class: 'label', x: radius + 10, y: -1, 'text-anchor': 'start' })
    : svg('text', { class: 'label', y: labelAbove ? -(radius + 12) : radius + 20, 'text-anchor': 'middle' });
  const sub = labelSide
    ? svg('text', { class: 'sub', x: radius + 10, y: 17, 'text-anchor': 'start' })
    : svg('text', { class: 'sub', y: labelAbove ? -(radius + 30) : radius + 38, 'text-anchor': 'middle' });
  const subNoIcon = svg('text', { class: 'sub', y: labelAbove ? -(radius + 12) : radius + 20, 'text-anchor': 'middle' });

  const badge = svg('g', { class: 'charging', transform: `translate(${radius * 0.72} ${-radius * 0.72})` });
  badge.append(svg('circle', { r: 11 }), svg('path', { d: BOLT, class: 'bolt' }));
  const diagnostic = svg('g', { class: 'diagnostic-badge', transform: `translate(${-radius * 0.72} ${-radius * 0.72})`, visibility: 'hidden' });
  diagnostic.append(svg('circle', { r: 9 }), svg('text', { x: 0, y: 4, 'text-anchor': 'middle' }, '!'));
  const childBadge = svg('g', { class: 'child-badge', transform: `translate(${radius * 0.72} ${radius * 0.72})`, visibility: 'hidden' });
  const childBadgeText = svg('text', { x: 0, y: 3.5, 'text-anchor': 'middle' });
  childBadge.append(svg('circle', { r: 9 }), childBadgeText);

  if (isBattery) g.append(socText);
  if (!hasIcon) g.append(nameIn);
  g.append(value, badge, diagnostic, childBadge);
  if (hasIcon) g.append(label, sub);
  else g.append(subNoIcon);

  g.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onOpen();
  });
  g.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onOpen();
    }
  });

  const update = (view: NodeView): void => {
    setAttr(g, 'data-status', view.status);
    setAttr(g, 'aria-label', [view.displayName, view.socText, view.valueText, view.subtitle].filter(Boolean).join(', '));
    setText(title, view.displayName);
    setText(value, view.valueText);
    setText(label, truncate(view.displayName, labelSide ? 11 : 18));
    setText(nameIn, truncate(view.displayName, 11));
    setText(socText, view.socText ?? '');
    setText(sub, view.subtitle ?? '');
    setText(subNoIcon, view.subtitle ?? '');
    if ((view.childCount ?? 0) > 0) {
      childBadge.setAttribute('visibility', 'visible');
      setText(childBadgeText, view.childCount! > 9 ? '9+' : String(view.childCount));
    } else {
      childBadge.setAttribute('visibility', 'hidden');
      setText(childBadgeText, '');
    }
    if (view.diagnostic === 'warning' || view.diagnostic === 'error') {
      diagnostic.setAttribute('visibility', 'visible');
      diagnostic.setAttribute('data-severity', view.diagnostic);
    } else {
      diagnostic.setAttribute('visibility', 'hidden');
      diagnostic.removeAttribute('data-severity');
    }
    if (levelRect) {
      const h = 13 * (view.level ?? 0);
      setAttr(levelRect, 'height', h.toFixed(2));
      setAttr(levelRect, 'y', (20 - h).toFixed(2));
    }
  };

  return { el: g, update };
}
