import type { HistoryPoint } from '../helpers/historyHelper';
import { t } from '../helpers/i18n';
import { formatPower, PowerFormat } from '../helpers/stateHelper';
import type { EntityStatus } from '../types/EntityStatus';
import { html, svg } from './dom';

export type HistoryState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'ready'; points: HistoryPoint[]; start: number; end: number };

export interface PopupRow {
  label: string;
  value: string;
}

/** Alles wat de detailweergave nodig heeft; wordt door de kaart uit live state samengesteld. */
export interface PopupModel {
  nodeType: string;
  title: string;
  subtitle?: string;
  valueText: string;
  status: EntityStatus;
  rows: PopupRow[];
  history: HistoryState;
  note?: string;
  powerFormat: PowerFormat;
  language?: string;
}

const W = 320;
const H = 128;
const PAD = { l: 6, r: 6, t: 20, b: 20 };

function signed(watts: number, format: PowerFormat): string {
  return `${watts < 0 ? '−' : ''}${formatPower(watts, format)}`;
}

function clock(ms: number, language?: string): string {
  return new Date(ms).toLocaleTimeString(language || undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Tekent de 24-uursgrafiek als kale SVG: geen externe grafiekbibliotheek nodig. */
export function buildGraph(
  points: readonly HistoryPoint[],
  start: number,
  end: number,
  format: PowerFormat,
  language?: string,
): SVGSVGElement {
  const root = svg('svg', { class: 'graph', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('last_24h', language) });

  const values = points.map((p) => p.v);
  const maxV = Math.max(0, ...values);
  const minV = Math.min(0, ...values);
  const hi = maxV === minV ? minV + 1 : maxV;
  const lo = minV;

  const x = (ms: number) => PAD.l + ((ms - start) / (end - start)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const y0 = y(0);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const area = `${line} L${x(last.t).toFixed(1)} ${y0.toFixed(1)} L${x(first.t).toFixed(1)} ${y0.toFixed(1)} Z`;

  root.append(
    svg('line', { class: 'zero', x1: PAD.l, x2: W - PAD.r, y1: y0.toFixed(1), y2: y0.toFixed(1) }),
    svg('path', { class: 'area', d: area }),
    svg('path', { class: 'trace', d: line, fill: 'none' }),
    svg('text', { class: 'axis', x: PAD.l, y: 12 }, `${t('maximum', language)} ${signed(maxV, format)}`),
    svg('text', { class: 'axis', x: PAD.l, y: H - 5 }, clock(start, language)),
    svg('text', { class: 'axis', x: W - PAD.r, y: H - 5, 'text-anchor': 'end' }, clock(end, language)),
  );
  if (minV < 0) {
    root.append(svg('text', { class: 'axis', x: W - PAD.r, y: 12, 'text-anchor': 'end' }, `${t('minimum', language)} ${signed(minV, format)}`));
  }
  return root;
}

export class Popup {
  readonly el: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly body: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private opener: { focus(): void } | null = null;
  private signature = '';

  constructor(private readonly onClose: () => void) {
    this.heading = html('h2', { class: 'popup-title' });
    this.closeButton = html('button', { class: 'popup-close', type: 'button' }, '×');
    this.body = html('div', { class: 'popup-body' });
    const head = html('div', { class: 'popup-head' }, this.heading, this.closeButton);
    this.panel = html('div', { class: 'popup-panel', role: 'dialog', 'aria-modal': 'true' }, head, this.body);
    this.el = html('div', { class: 'popup', hidden: '' }, this.panel);

    this.closeButton.addEventListener('click', () => this.onClose());
    this.el.addEventListener('click', (ev) => {
      if (ev.target === this.el) this.onClose();
    });
    this.el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        this.onClose();
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hasAttribute('hidden');
  }

  open(model: PopupModel, opener?: { focus(): void } | null): void {
    this.opener = opener ?? null;
    this.signature = '';
    this.el.removeAttribute('hidden');
    this.update(model);
    this.closeButton.focus();
  }

  close(): void {
    this.el.setAttribute('hidden', '');
    this.opener?.focus();
    this.opener = null;
  }

  update(model: PopupModel): void {
    const sig = JSON.stringify({ ...model, history: model.history.kind === 'ready' ? [model.history.points.length, model.history.end] : model.history.kind });
    if (sig === this.signature) return;
    this.signature = sig;

    const { language } = model;
    this.panel.className = `popup-panel type-${model.nodeType}`;
    this.panel.setAttribute('data-status', model.status);
    this.panel.setAttribute('aria-label', model.title);
    this.heading.textContent = model.title;
    this.closeButton.setAttribute('aria-label', t('close', language));

    const big = html(
      'div',
      { class: 'popup-big' },
      html('span', { class: 'popup-value' }, model.valueText),
      html('span', { class: 'popup-label' }, model.subtitle ?? t('current_power', language)),
    );

    let graph: Node;
    switch (model.history.kind) {
      case 'ready':
        graph = buildGraph(model.history.points, model.history.start, model.history.end, model.powerFormat, language);
        break;
      case 'loading':
        graph = html('div', { class: 'popup-empty' }, t('loading', language));
        break;
      default:
        graph = html('div', { class: 'popup-empty' }, t('no_history', language));
    }
    const graphBox = html('section', { class: 'popup-section' }, html('h3', {}, t('last_24h', language)), graph);

    const rows = html('dl', { class: 'popup-rows' });
    for (const row of model.rows) rows.append(html('dt', {}, row.label), html('dd', {}, row.value));

    this.body.replaceChildren(big, graphBox);
    if (model.rows.length > 0) this.body.append(rows);
    if (model.note) this.body.append(html('p', { class: 'popup-note' }, model.note));
  }
}
