import { ConfigError, ResolvedConfig, normalizeConfig } from '../config/CardConfig';
import { demoReadings } from '../demo/DemoEngine';
import {
  NodeReading,
  computeFlows,
  applyBackupReadings,
  computeHomeReading,
  readNode,
} from '../helpers/flowHelper';
import { HistoryPoint, bucketize, fetchHistory, unitFactor } from '../helpers/historyHelper';
import { hassLanguage, t } from '../helpers/i18n';
import { parsePower } from '../helpers/stateHelper';
import { HOME_RADIUS, NODE_RADIUS, computeLayout } from '../layout/AutoLayout';
import type { Connection } from '../models/Connection';
import { EnergyNode, advancedFieldsFor, fieldLabelKey } from '../models/Node';
import { ConnectionElement, FlowContext, createConnectionElement } from '../renderer/ConnectionRenderer';
import { NodeElement, NodeView, createNodeElement, describeNode } from '../renderer/NodeRenderer';
import { HistoryState, Popup, PopupModel, PopupRow } from '../renderer/PopupRenderer';
import { html, svg } from '../renderer/dom';
import type { Hass } from '../types/hass';
import { styles } from './styles';

const HISTORY_HOURS = 24;
const HISTORY_TTL_MS = 60_000;
/** In demo-modus begint de tijd op 300 s, zodat er al "geschiedenis" bestaat voor de grafiek. */
const DEMO_OFFSET_S = 300;

interface Computed {
  readings: Map<string, NodeReading>;
  flows: Map<string, number | null>;
}

export class EnergyFlowCard extends HTMLElement {
  private config?: ResolvedConfig;
  private _hass?: Hass;
  private nodeEls = new Map<string, NodeElement>();
  private connEls: { conn: Connection; el: ConnectionElement }[] = [];
  private popup = new Popup(() => this.closePopup());
  private openNodeId?: string;
  private computed?: Computed;
  private history = new Map<string, { state: HistoryState; fetchedAt: number }>();
  private timer?: number;
  private demoStart = 0;
  private reducedMotion = false;
  private motionQuery?: MediaQueryList;
  private readonly onMotionChange = (ev: MediaQueryListEvent): void => {
    this.reducedMotion = ev.matches;
    this.update();
  };

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  // ----- Home Assistant-contract -----------------------------------------------------------

  /** Wordt door Home Assistant aangeroepen bij elke wijziging van de YAML. Gooit een ConfigError bij fouten. */
  setConfig(raw: unknown): void {
    this.config = normalizeConfig(raw); // gooit bij ongeldige config; HA toont dan een foutkaart
    this.closePopup();
    this.history.clear();
    this.buildStructure();
    this.syncTimer();
    this.update();
  }

  set hass(hass: Hass) {
    this._hass = hass;
    if (!this.config?.demo) this.update();
  }

  get hass(): Hass | undefined {
    return this._hass;
  }

  getCardSize(): number {
    return 5;
  }

  getGridOptions(): Record<string, number> {
    return { columns: 12, rows: 6, min_columns: 6, min_rows: 4 };
  }

  static getStubConfig(): Record<string, unknown> {
    return { demo: true };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement('energy-flow-card-editor');
  }

  connectedCallback(): void {
    this.motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (this.motionQuery) {
      this.reducedMotion = this.motionQuery.matches;
      this.motionQuery.addEventListener('change', this.onMotionChange);
    }
    this.syncTimer();
    if (this.config) this.update();
  }

  disconnectedCallback(): void {
    this.motionQuery?.removeEventListener('change', this.onMotionChange);
    this.stopTimer();
  }

  // ----- Opbouw -----------------------------------------------------------------------------

  private get language(): string | undefined {
    return hassLanguage(this._hass);
  }

  private buildStructure(): void {
    const cfg = this.config;
    const root = this.shadowRoot!;
    this.nodeEls.clear();
    this.connEls = [];

    const card = html('ha-card', { class: customElements.get('ha-card') ? '' : 'fallback' });
    if (cfg?.title) card.append(html('div', { class: 'title' }, cfg.title));

    const stage = html('div', { class: 'stage' });
    card.append(stage);

    if (!cfg || cfg.nodes.length <= 1) {
      stage.append(
        html('div', { class: 'empty' }, html('strong', {}, t('empty_title', this.language)), html('span', {}, t('empty_hint', this.language))),
      );
    } else {
      if (cfg.demo) stage.append(html('div', { class: 'badge' }, t('demo_badge', this.language)));
      stage.append(this.buildFlowSvg(cfg));
    }

    card.append(this.popup.el);
    root.replaceChildren(html('style', {}, styles), card);
  }

  private buildFlowSvg(cfg: ResolvedConfig): SVGSVGElement {
    const layout = computeLayout(cfg.nodes, cfg.layout, cfg.connections);
    const straight = layout.mode !== 'circle';
    const byId = new Map(cfg.nodes.map((n) => [n.id, n]));
    const homeNode = cfg.nodes.find((n) => n.role === 'home');
    const homeY = (homeNode && layout.positions.get(homeNode.id)?.y) ?? layout.height / 2;
    const radiusOf = (n: EnergyNode) => (n.role === 'home' ? HOME_RADIUS : NODE_RADIUS);

    const root = svg('svg', { class: `flow layout-${layout.mode}`, viewBox: `0 0 ${layout.width} ${layout.height}`, role: 'group' });
    const connLayer = svg('g', { class: 'connections' });
    const nodeLayer = svg('g', { class: 'nodes' });
    root.append(connLayer, nodeLayer);

    for (const conn of cfg.connections) {
      const from = byId.get(conn.from);
      const to = byId.get(conn.to);
      const a = from && layout.positions.get(from.id);
      const b = to && layout.positions.get(to.id);
      if (!from || !to || !a || !b) continue;

      const curved = !straight && from.role !== 'home' && to.role !== 'home';
      const el = createConnectionElement(
        conn,
        { center: a, radius: radiusOf(from) },
        { center: b, radius: radiusOf(to) },
        curved,
        conn.color,
        straight,
      );
      if (!el) continue;
      if (!conn.color) {
        // Standaardkleur: die van het apparaat aan de andere kant van Home (bij Home-verbindingen), anders de bron.
        const colorSource = to.role === 'home' ? from : from.role === 'home' ? to : from;
        el.el.classList.add(`type-${colorSource.type}`);
      }
      this.connEls.push({ conn, el });
      connLayer.append(el.el);
    }

    for (const node of cfg.nodes) {
      const pos = layout.positions.get(node.id);
      if (!pos) continue;
      const nodeEl = createNodeElement(node, pos, radiusOf(node), () => this.openPopup(node.id), labelPositionFor(node, pos.y, homeY, straight));
      this.nodeEls.set(node.id, nodeEl);
      nodeLayer.append(nodeEl.el);
    }
    return root;
  }

  // ----- Live bijwerken -----------------------------------------------------------------------

  private compute(): Computed {
    const cfg = this.config!;
    const readings = new Map<string, NodeReading>();
    let flows: Map<string, number | null>;

    if (cfg.demo) {
      const tSeconds = DEMO_OFFSET_S + (performance.now() - this.demoStart) / 1000;
      for (const [id, r] of demoReadings(cfg.nodes, tSeconds)) readings.set(id, r);
      applyBackupReadings(cfg.nodes, cfg.connections, readings, true);
      flows = computeFlows(cfg.nodes, cfg.connections, readings, undefined, { ignoreEntities: true });
    } else {
      for (const node of cfg.nodes) if (node.role !== 'home') readings.set(node.id, readNode(node, this._hass));
      applyBackupReadings(cfg.nodes, cfg.connections, readings, false);
      flows = computeFlows(cfg.nodes, cfg.connections, readings, this._hass);
    }

    const home = cfg.nodes.find((n) => n.role === 'home');
    if (home) {
      // Een expliciete woningsensor heeft voorrang. Zonder sensor blijft Woning automatisch berekend.
      const measuredHome = !cfg.demo && !!home.config.power_entity;
      readings.set(home.id, measuredHome ? readNode(home, this._hass) : computeHomeReading(home, cfg.nodes, cfg.connections, flows));
    }
    return { readings, flows };
  }

  private flowContext(): FlowContext {
    const cfg = this.config!;
    return {
      maxPower: cfg.maxPower,
      animationSpeed: cfg.animationSpeed,
      animate: cfg.animation && !this.reducedMotion,
    };
  }

  private update(): void {
    const cfg = this.config;
    if (!cfg || this.nodeEls.size === 0) return;
    if (cfg.demo && document.hidden) return;

    this.computed = this.compute();
    const ctx = { powerFormat: cfg.powerFormat, language: this.language };

    for (const node of cfg.nodes) {
      const reading = this.computed.readings.get(node.id);
      if (reading) this.nodeEls.get(node.id)?.update(describeNode(node, reading, ctx));
    }
    const flowCtx = this.flowContext();
    for (const { conn, el } of this.connEls) el.update(this.computed.flows.get(conn.id) ?? null, flowCtx);

    if (this.openNodeId && this.popup.isOpen) {
      const model = this.popupModel(this.openNodeId);
      if (model) this.popup.update(model);
    }
  }

  private syncTimer(): void {
    this.stopTimer();
    if (this.config?.demo && this.isConnected) {
      this.demoStart = performance.now();
      this.timer = window.setInterval(() => this.update(), 1000);
    }
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  // ----- Detailweergave -----------------------------------------------------------------------

  private openPopup(nodeId: string): void {
    const model = this.popupModel(nodeId);
    if (!model) return;
    this.openNodeId = nodeId;
    this.popup.open(model, this.nodeEls.get(nodeId)?.el);
    void this.ensureHistory(nodeId);
  }

  private closePopup(): void {
    if (this.popup.isOpen) this.popup.close();
    this.openNodeId = undefined;
  }

  private formatEntity(entityId: string): string {
    const entity = this._hass?.states[entityId];
    if (!entity) return '?';
    if (entity.state === 'unavailable') return '!';
    if (entity.state === 'unknown') return '?';
    const unit = typeof entity.attributes.unit_of_measurement === 'string' ? ` ${entity.attributes.unit_of_measurement}` : '';
    const n = parsePower(entity.state);
    return `${n !== null ? Math.round(n * 100) / 100 : entity.state}${unit}`;
  }

  private popupModel(nodeId: string): PopupModel | undefined {
    const cfg = this.config;
    const node = cfg?.nodes.find((n) => n.id === nodeId);
    const reading = this.computed?.readings.get(nodeId);
    if (!cfg || !node || !reading) return undefined;

    const view: NodeView = describeNode(node, reading, { powerFormat: cfg.powerFormat, language: this.language });
    const lang = this.language;
    const rows: PopupRow[] = [];

    if (reading.soc) rows.push({ label: t('soc', lang), value: view.socText ?? '?' });

    if (!cfg.demo) {
      for (const field of advancedFieldsFor(node.type)) {
        if (field === 'soc_entity') continue;
        if (field === 'production_entity' && !node.config.power_entity) continue;
        const id = node.config[field];
        if (typeof id === 'string' && id) rows.push({ label: t(fieldLabelKey(field, node.type), lang), value: this.formatEntity(id) });
      }
      for (const extra of node.config.entities ?? []) {
        const friendly = this._hass?.states[extra.entity]?.attributes.friendly_name;
        const label = extra.name ?? (typeof friendly === 'string' ? friendly : extra.entity);
        rows.push({ label, value: this.formatEntity(extra.entity) });
      }
    }

    const powerEntity = node.config.power_entity ?? node.config.production_entity;
    const computedHome = node.role === 'home' && !node.config.power_entity;

    return {
      nodeType: node.type,
      title: view.displayName,
      subtitle: view.subtitle,
      valueText: view.valueText,
      status: view.status,
      rows,
      history: cfg.demo || powerEntity || computedHome ? (this.history.get(nodeId)?.state ?? { kind: 'loading' }) : { kind: 'none' },
      note: node.role === 'home' ? t(computedHome ? 'home_computed' : 'home_measured', lang) : undefined,
      powerFormat: cfg.powerFormat,
      language: lang,
    };
  }

  private async ensureHistory(nodeId: string): Promise<void> {
    const cfg = this.config;
    const node = cfg?.nodes.find((n) => n.id === nodeId);
    if (!cfg || !node) return;

    const cached = this.history.get(nodeId);
    if (cached && Date.now() - cached.fetchedAt < HISTORY_TTL_MS) return;

    const store = (state: HistoryState): void => {
      this.history.set(nodeId, { state, fetchedAt: Date.now() });
      if (this.openNodeId === nodeId && this.popup.isOpen) {
        const model = this.popupModel(nodeId);
        if (model) this.popup.update(model);
      }
    };

    if (cfg.demo) {
      store(this.demoHistory(node));
      return;
    }

    const entityId = node.config.power_entity ?? node.config.production_entity;
    if (!entityId || !this._hass?.callApi) {
      store({ kind: 'none' });
      return;
    }
    try {
      const end = Date.now();
      const start = end - HISTORY_HOURS * 3_600_000;
      const factor = unitFactor(this._hass.states[entityId]?.attributes.unit_of_measurement);
      const raw = await fetchHistory(this._hass, entityId, HISTORY_HOURS, factor, node.invert, end);
      const points = bucketize(raw, start, end, 96);
      store(points.length >= 2 ? { kind: 'ready', points, start, end } : { kind: 'none' });
    } catch {
      store({ kind: 'none' });
    }
  }

  /** Demo: hergebruikt de demo-engine over de afgelopen 240 s en presenteert dat als "24 uur". */
  private demoHistory(node: EnergyNode): HistoryState {
    const cfg = this.config!;
    const now = Date.now();
    const span = 24 * 3_600_000;
    const nowT = DEMO_OFFSET_S + (performance.now() - this.demoStart) / 1000;
    const samples = 96;
    const points: HistoryPoint[] = [];
    const home = cfg.nodes.find((n) => n.role === 'home');
    for (let i = 0; i < samples; i++) {
      const tSeconds = nowT - 240 + (240 * i) / (samples - 1);
      const readings = demoReadings(cfg.nodes, tSeconds);
      applyBackupReadings(cfg.nodes, cfg.connections, readings, true);
      let watts: number | null | undefined;
      if (node.role === 'home' && home) {
        const flows = computeFlows(cfg.nodes, cfg.connections, readings, undefined, { ignoreEntities: true });
        watts = computeHomeReading(home, cfg.nodes, cfg.connections, flows).watts;
      } else {
        watts = readings.get(node.id)?.watts;
      }
      if (typeof watts === 'number') points.push({ t: now - span + (span * i) / (samples - 1), v: watts });
    }
    return points.length >= 2 ? { kind: 'ready', points, start: now - span, end: now } : { kind: 'none' };
  }
}

/** Namen boven Home komen boven de node; in de rechte layout staan Home en backup (lijnen boven en onder) ernaast. */
function labelPositionFor(node: EnergyNode, y: number, homeY: number, straight: boolean): 'below' | 'above' | 'side' {
  if (straight && (node.role === 'home' || node.type === 'backup')) return 'side';
  return y < homeY - 1 ? 'above' : 'below';
}

export { ConfigError };
