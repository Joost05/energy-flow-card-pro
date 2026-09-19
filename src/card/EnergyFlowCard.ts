import { ConfigError, ResolvedConfig, normalizeConfig } from '../config/CardConfig';
import { demoReadings } from '../demo/DemoEngine';
import { computeDiagnostics, highestSeverity, type DiagnosticItem, type DiagnosticReport } from '../helpers/diagnosticsHelper';
import {
  NodeReading,
  computeFlows,
  applyBackupReadings,
  computeHomeReading,
  readNode,
} from '../helpers/flowHelper';
import { HistoryPoint, bucketize, fetchHistoryBatch } from '../helpers/historyHelper';
import { nearestHistoryPoint, replayRange } from '../helpers/replayHelper';
import { buildMobileFocusGraph, hasFocusableChildren } from '../helpers/mobileFocusHelper';
import { hassLanguage, t } from '../helpers/i18n';
import { deriveL1History, deriveL1Power } from '../helpers/phaseHelper';
import { currentGridRate, fetchTodayGridFinancials, formatCurrency, formatPrice, readPrices } from '../helpers/pricingHelper';
import { demoEnergyStats, fetchEnergyStats, type EnergyStats, type EnergyStatsPeriod } from '../helpers/energyStatsHelper';
import { applyGroupReadings, buildDisplayGraph } from '../helpers/groupHelper';
import { formatPower, parsePower } from '../helpers/stateHelper';
import { HOME_RADIUS, NODE_RADIUS, computeLayout } from '../layout/AutoLayout';
import type { Connection } from '../models/Connection';
import { EnergyNode, advancedFieldsFor, fieldLabelKey } from '../models/Node';
import { ConnectionElement, FlowContext, createConnectionElement } from '../renderer/ConnectionRenderer';
import { NodeElement, NodeView, createNodeElement, describeNode } from '../renderer/NodeRenderer';
import { HistoryState, Popup, PopupModel, PopupRow } from '../renderer/PopupRenderer';
import { html, svg } from '../renderer/dom';
import type { Hass } from '../types/hass';
import { EntityStatus } from '../types/EntityStatus';
import { styles } from './styles';

const HISTORY_HOURS = 24;
const HISTORY_TTL_MS = 5 * 60_000;
const HISTORY_BUCKETS = 96;
const HISTORY_PRELOAD_DELAY_MS = 0;
const HISTORY_SESSION_PREFIX = 'efc-history-v2:';
/** In demo-modus begint de tijd op 300 s, zodat er al "geschiedenis" bestaat voor de grafiek. */
const DEMO_OFFSET_S = 300;

interface Computed {
  readings: Map<string, NodeReading>;
  flows: Map<string, number | null>;
  diagnostics: DiagnosticReport;
}

export class EnergyFlowCard extends HTMLElement {
  private config?: ResolvedConfig;
  private _hass?: Hass;
  private nodeEls = new Map<string, NodeElement>();
  private displayNodes: EnergyNode[] = [];
  private displayConnections: Connection[] = [];
  private groupNodes = new Map<string, EnergyNode>();
  private connEls: { conn: Connection; el: ConnectionElement }[] = [];
  private popup = new Popup(() => this.closePopup());
  private openNodeId?: string;
  private computed?: Computed;
  private history = new Map<string, { state: HistoryState; fetchedAt: number }>();
  private phaseHistory = new Map<string, HistoryState>();
  private phaseGraphEnabled = new Set<string>();
  private historyBundleInFlight?: Promise<void>;
  private historyBundleFetchedAt = 0;
  private preloadTimer?: number;
  private todayGridBalance?: { value: number | null; fetchedAt: number };
  private todayGridBalanceInFlight?: Promise<void>;
  private energyStatsPeriod: EnergyStatsPeriod = 'today';
  private energyStats = new Map<EnergyStatsPeriod, { value: EnergyStats | null; fetchedAt: number }>();
  private energyStatsInFlight = new Map<EnergyStatsPeriod, Promise<void>>();
  private timer?: number;
  private updateFrame?: number;
  private replayActive = false;
  private replayTimestamp?: number;
  private replayControls?: HTMLElement;
  private demoStart = 0;
  private reducedMotion = false;
  private compactMobile = false;
  private mobileFocusId?: string;
  private resizeObserver?: ResizeObserver;
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
    this.phaseHistory.clear();
    this.phaseGraphEnabled.clear();
    this.historyBundleInFlight = undefined;
    this.historyBundleFetchedAt = 0;
    this.cancelHistoryPreload();
    this.todayGridBalance = undefined;
    this.todayGridBalanceInFlight = undefined;
    this.energyStatsPeriod = 'today';
    this.energyStats.clear();
    this.energyStatsInFlight.clear();
    this.replayActive = false;
    this.replayTimestamp = undefined;
    this.replayControls = undefined;
    this.mobileFocusId = undefined;
    this.buildStructure();
    this.syncTimer();
    this.update();
  }

  set hass(hass: Hass) {
    this._hass = hass;
    if (!this.config?.demo) {
      this.scheduleUpdate();
      this.scheduleHistoryPreload();
      void this.ensureTodayGridBalance();
      if (this.openNodeId === 'home') void this.ensureEnergyStats(this.energyStatsPeriod);
    }
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
    return document.createElement('energy-flow-card-pro-editor');
  }

  connectedCallback(): void {
    this.motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (this.motionQuery) {
      this.reducedMotion = this.motionQuery.matches;
      this.motionQuery.addEventListener('change', this.onMotionChange);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0;
        if (width <= 0) return;
        const compact = width < 700;
        if (compact === this.compactMobile) return;
        this.compactMobile = compact;
        if (!compact) this.mobileFocusId = undefined;
        this.closePopup();
        this.buildStructure();
        this.update();
      });
      this.resizeObserver.observe(this);
    } else {
      this.compactMobile = globalThis.innerWidth < 700;
    }
    this.syncTimer();
    if (this.config) {
      this.update();
      if (this.config.demo) this.loadDemoHistoryBundle();
      else this.scheduleHistoryPreload();
      void this.ensureTodayGridBalance();
    }
  }

  disconnectedCallback(): void {
    this.motionQuery?.removeEventListener('change', this.onMotionChange);
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.cancelHistoryPreload();
    if (this.updateFrame !== undefined) {
      window.cancelAnimationFrame(this.updateFrame);
      this.updateFrame = undefined;
    }
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
    const display = cfg ? buildDisplayGraph(cfg) : undefined;
    this.displayNodes = display?.nodes ?? [];
    this.displayConnections = display?.connections ?? [];
    this.groupNodes = display?.groupNodes ?? new Map();

    const card = html('ha-card', { class: customElements.get('ha-card') ? '' : 'fallback' });
    if (cfg) {
      const colorVars: Record<string, string | undefined> = {
        '--efc-solar': cfg.colors.solar,
        '--efc-grid': cfg.colors.grid,
        '--efc-battery': cfg.colors.battery,
        '--efc-home': cfg.colors.home,
        '--efc-consumer': cfg.colors.consumer,
        '--efc-ev': cfg.colors.ev,
        '--efc-backup': cfg.colors.backup,
        '--efc-generator': cfg.colors.generator,
        '--efc-producer': cfg.colors.producer,
      };
      for (const [name, value] of Object.entries(colorVars)) if (value) card.style.setProperty(name, value);
    }
    if (cfg?.title) card.append(html('div', { class: 'title' }, cfg.title));

    const stage = html('div', { class: 'stage' });
    card.append(stage);

    if (!cfg || cfg.nodes.length <= 1) {
      stage.append(
        html('div', { class: 'empty' }, html('strong', {}, t('empty_title', this.language)), html('span', {}, t('empty_hint', this.language))),
      );
    } else {
      if (cfg.demo) stage.append(html('div', { class: 'badge' }, t('demo_badge', this.language)));
      if (cfg.pricing.mode !== 'none') stage.append(this.buildPriceBadge(cfg));
      if (this.compactMobile) {
        const nav = this.buildMobileFocusNav(cfg);
        if (nav) stage.append(nav);
      }
      stage.append(this.buildFlowSvg(cfg));
      const replay = this.buildReplayControls();
      this.replayControls = replay;
      card.append(replay);
    }

    card.append(this.popup.el);
    root.replaceChildren(html('style', {}, styles), card);
  }

  private buildPriceBadge(cfg: ResolvedConfig): HTMLElement {
    const prices = readPrices(cfg.pricing, cfg.demo ? undefined : this._hass);
    const currency = cfg.pricing.currency;
    const importText = prices.importPrice === null ? '?' : formatCurrency(prices.importPrice, currency, this.language, 2);
    const exportText = prices.exportPrice === null ? '?' : formatCurrency(prices.exportPrice, currency, this.language, 2);
    const el = html('div', { class: 'price-panel', 'aria-label': t('energy_prices', this.language) },
      html('div', { class: 'price-item price-import' },
        html('span', { class: 'price-label' }, t('price_card_import', this.language)),
        html('span', { class: 'price-value', 'data-price-import': '' }, `${importText}/kWh`),
      ),
      html('div', { class: 'price-divider', 'aria-hidden': 'true' }),
      html('div', { class: 'price-item price-export' },
        html('span', { class: 'price-label' }, t('price_card_export', this.language)),
        html('span', { class: 'price-value', 'data-price-export': '' }, `${exportText}/kWh`),
      ),
    );
    return el;
  }

  private buildFlowSvg(cfg: ResolvedConfig): SVGSVGElement {
    const allNodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
    const allConnections = this.displayConnections.length ? this.displayConnections : cfg.connections;
    const focused = this.compactMobile ? buildMobileFocusGraph(allNodes, allConnections, this.mobileFocusId) : undefined;
    const nodes = focused?.nodes ?? allNodes;
    const connections = focused?.connections ?? allConnections;
    const focusId = focused?.focusId;
    const layoutNodes = focusId && focusId !== focused?.homeId
      ? nodes.map((n) => n.id === focusId ? { ...n, role: 'home' as const } : n)
      : nodes;
    const layout = computeLayout(layoutNodes, cfg.layout, connections);
    const straight = layout.mode !== 'circle';
    const byId = new Map(layoutNodes.map((n) => [n.id, n]));
    const homeNode = layoutNodes.find((n) => n.role === 'home');
    const homeY = (homeNode && layout.positions.get(homeNode.id)?.y) ?? layout.height / 2;
    const radiusOf = (n: EnergyNode) => (n.role === 'home' ? HOME_RADIUS : NODE_RADIUS);

    const root = svg('svg', { class: `flow layout-${layout.mode}`, viewBox: `0 0 ${layout.width} ${layout.height}`, role: 'group' });
    const connLayer = svg('g', { class: 'connections' });
    const nodeLayer = svg('g', { class: 'nodes' });
    root.append(connLayer, nodeLayer);

    for (const conn of connections) {
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

    for (const layoutNode of layoutNodes) {
      const originalNode = nodes.find((n) => n.id === layoutNode.id) ?? layoutNode;
      const pos = layout.positions.get(layoutNode.id);
      if (!pos) continue;
      const onOpen = () => {
        if (this.compactMobile && layoutNode.id !== focusId && hasFocusableChildren(layoutNode.id, allNodes, allConnections)) {
          this.mobileFocusId = layoutNode.id;
          this.closePopup();
          this.buildStructure();
          this.update();
          return;
        }
        this.openPopup(layoutNode.id);
      };
      const nodeEl = createNodeElement(layoutNode, pos, radiusOf(layoutNode), onOpen, labelPositionFor(layoutNode, pos.y, homeY, straight));
      this.nodeEls.set(originalNode.id, nodeEl);
      nodeLayer.append(nodeEl.el);
    }
    return root;
  }


  private buildMobileFocusNav(cfg: ResolvedConfig): HTMLElement | undefined {
    const allNodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
    const allConnections = this.displayConnections.length ? this.displayConnections : cfg.connections;
    const graph = buildMobileFocusGraph(allNodes, allConnections, this.mobileFocusId);
    if (!graph.focusId || graph.focusId === graph.homeId) return undefined;
    const focus = allNodes.find((n) => n.id === graph.focusId);
    const parent = graph.parentId ? allNodes.find((n) => n.id === graph.parentId) : undefined;
    const home = allNodes.find((n) => n.id === graph.homeId);
    const label = [home?.name ?? t('home', this.language), focus?.name ?? graph.focusId].join(' › ');
    const back = html('button', { class: 'mobile-focus-back', type: 'button', 'aria-label': t('mobile_focus_back', this.language) }, '‹');
    back.addEventListener('click', () => {
      this.mobileFocusId = parent && parent.id !== graph.homeId ? parent.id : undefined;
      this.closePopup();
      this.buildStructure();
      this.update();
    });
    return html('div', { class: 'mobile-focus-nav' }, back, html('span', { class: 'mobile-focus-path' }, label));
  }

  private buildReplayControls(): HTMLElement {
    const label = html('span', { class: 'replay-label' }, t('replay', this.language));
    const time = html('strong', { class: 'replay-time', 'data-replay-time': '', hidden: '' }, '');
    const slider = html('input', {
      class: 'replay-slider', type: 'range', min: '0', max: '1000', value: '1000', step: '1', disabled: '', 'data-replay-slider': '',
      'aria-label': t('replay_title', this.language),
    }) as HTMLInputElement;
    const live = html('button', { class: 'replay-live', type: 'button', 'data-replay-live': '', hidden: '' }, t('replay_live', this.language));
    const status = html('span', { class: 'replay-status', 'data-replay-status': '' }, '');
    const row = html('div', { class: 'replay-row' }, label, time, slider, live);
    const controls = html('div', { class: 'replay-controls' }, row, status);
    live.addEventListener('click', () => this.exitReplay());
    slider.addEventListener('input', () => this.onReplaySlider(Number(slider.value)));
    this.updateReplayControls(controls);
    return controls;
  }

  private exitReplay(): void {
    if (!this.replayActive) return;
    this.replayActive = false;
    this.replayTimestamp = undefined;
    this.updateReplayControls();
    this.update();
  }

  private readyReplaySeries(): HistoryPoint[][] {
    const cfg = this.config;
    if (!cfg) return [];
    const nodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
    return nodes.flatMap((node) => {
      const state = this.history.get(node.id)?.state;
      return state?.kind === 'ready' && state.points.length > 1 ? [state.points] : [];
    });
  }

  private replayWindow(): { start: number; end: number } | undefined {
    return replayRange(this.readyReplaySeries());
  }


  private onReplaySlider(value: number): void {
    const range = this.replayWindow();
    if (!range) return;
    this.replayActive = true;
    this.replayTimestamp = range.start + (range.end - range.start) * Math.max(0, Math.min(1000, value)) / 1000;
    this.updateReplayControls();
    this.update();
  }

  private updateReplayControls(root: HTMLElement | undefined = this.replayControls): void {
    if (!root) return;
    const live = root.querySelector('[data-replay-live]') as HTMLButtonElement | null;
    const slider = root.querySelector('[data-replay-slider]') as HTMLInputElement | null;
    const time = root.querySelector('[data-replay-time]') as HTMLElement | null;
    const status = root.querySelector('[data-replay-status]') as HTMLElement | null;
    const range = this.replayWindow();
    if (slider) {
      slider.disabled = !range;
      if (range && this.replayTimestamp !== undefined) {
        slider.value = String(Math.round(((this.replayTimestamp - range.start) / (range.end - range.start)) * 1000));
      } else if (!this.replayActive) slider.value = '1000';
    }
    if (time) {
      time.hidden = !this.replayActive || this.replayTimestamp === undefined;
      time.textContent = this.replayActive && this.replayTimestamp !== undefined
        ? new Date(this.replayTimestamp).toLocaleString(this.language || undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
        : '';
    }
    if (live) live.hidden = !this.replayActive;
    if (status) {
      status.hidden = !!range;
      status.textContent = range ? '' : t('replay_no_history', this.language);
    }
    root.classList.toggle('active', this.replayActive);
  }

  private computeReplay(): Computed | undefined {
    const cfg = this.config;
    const timestamp = this.replayTimestamp;
    if (!cfg || timestamp === undefined) return undefined;
    const nodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
    const connections = this.displayConnections.length ? this.displayConnections : cfg.connections;
    const readings = new Map<string, NodeReading>();
    for (const node of nodes) {
      const state = this.history.get(node.id)?.state;
      const point = state?.kind === 'ready' ? nearestHistoryPoint(state.points, timestamp) : undefined;
      const watts = point?.v ?? null;
      readings.set(node.id, {
        status: watts === null ? EntityStatus.Invalid : watts === 0 ? EntityStatus.Zero : EntityStatus.Valid,
        watts,
        charging: node.type === 'battery' ? (watts ?? 0) < 0 : node.type === 'ev_charger' ? (watts ?? 0) > 0 : false,
      });
    }
    const flows = computeFlows(nodes, connections, readings, undefined, { ignoreEntities: true });
    return { readings, flows, diagnostics: { byNode: new Map(), balanceDifferenceWatts: null, unmeteredConsumptionWatts: null } };
  }

  // ----- Live bijwerken -----------------------------------------------------------------------

  private compute(): Computed {
    const cfg = this.config!;
    const readings = new Map<string, NodeReading>();
    let flows: Map<string, number | null>;

    let sourceFlows: Map<string, number | null>;
    if (cfg.demo) {
      const tSeconds = DEMO_OFFSET_S + (performance.now() - this.demoStart) / 1000;
      for (const [id, r] of demoReadings(cfg.nodes, tSeconds)) readings.set(id, r);
      applyBackupReadings(cfg.nodes, cfg.connections, readings, true);
      sourceFlows = computeFlows(cfg.nodes, cfg.connections, readings, undefined, { ignoreEntities: true });
    } else {
      for (const node of cfg.nodes) if (node.role !== 'home') readings.set(node.id, readNode(node, this._hass));
      applyBackupReadings(cfg.nodes, cfg.connections, readings, false);
      sourceFlows = computeFlows(cfg.nodes, cfg.connections, readings, this._hass);
    }

    const home = cfg.nodes.find((n) => n.role === 'home');
    if (home) {
      const measuredHome = !cfg.demo && !!home.config.power_entity;
      readings.set(home.id, measuredHome ? readNode(home, this._hass) : computeHomeReading(home, cfg.nodes, cfg.connections, sourceFlows));
    }

    const diagnostics = computeDiagnostics(cfg.nodes, cfg.connections, readings, sourceFlows, cfg.demo ? undefined : this._hass);
    applyGroupReadings(cfg.groups, this.groupNodes, readings);
    const displayNodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
    const displayConnections = this.displayConnections.length ? this.displayConnections : cfg.connections;
    flows = computeFlows(displayNodes, displayConnections, readings, cfg.demo ? undefined : this._hass, { ignoreEntities: cfg.demo });
    return { readings, flows, diagnostics };
  }

  private updatePriceBadge(): void {
    const cfg = this.config;
    if (!cfg || cfg.pricing.mode === 'none') return;
    const prices = readPrices(cfg.pricing, cfg.demo ? undefined : this._hass);
    const importEl = this.shadowRoot?.querySelector('[data-price-import]');
    const exportEl = this.shadowRoot?.querySelector('[data-price-export]');
    const importText = prices.importPrice === null ? '?' : formatCurrency(prices.importPrice, cfg.pricing.currency, this.language, 2);
    const exportText = prices.exportPrice === null ? '?' : formatCurrency(prices.exportPrice, cfg.pricing.currency, this.language, 2);
    if (importEl) importEl.textContent = `${importText}/kWh`;
    if (exportEl) exportEl.textContent = `${exportText}/kWh`;
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

    this.computed = this.replayActive ? (this.computeReplay() ?? this.compute()) : this.compute();
    this.updatePriceBadge();
    const ctx = { powerFormat: cfg.powerFormat, language: this.language };

    for (const node of (this.displayNodes.length ? this.displayNodes : cfg.nodes)) {
      const reading = this.computed.readings.get(node.id);
      if (reading) {
        const view = describeNode(node, reading, ctx);
        const issues = node.groupMembers?.length
          ? node.groupMembers.flatMap((id) => this.computed?.diagnostics.byNode.get(id) ?? [])
          : this.computed.diagnostics.byNode.get(node.id);
        view.diagnostic = highestSeverity(issues);
        this.nodeEls.get(node.id)?.update(view);
      }
    }
    const flowCtx = this.flowContext();
    for (const { conn, el } of this.connEls) el.update(this.computed.flows.get(conn.id) ?? null, flowCtx);

    if (this.openNodeId && this.popup.isOpen) {
      const model = this.popupModel(this.openNodeId);
      if (model) this.popup.update(model);
    }
  }

  /** Coalesce rapid Home Assistant state updates into a single paint per animation frame. */
  private scheduleUpdate(): void {
    if (this.updateFrame !== undefined) return;
    this.updateFrame = window.requestAnimationFrame(() => {
      this.updateFrame = undefined;
      this.update();
    });
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
    const sourceNode = this.config?.nodes.find((n) => n.id === nodeId);
    if (sourceNode?.type === 'grid') void this.ensureTodayGridBalance();
    if (sourceNode?.role === 'home') void this.ensureEnergyStats(this.energyStatsPeriod);
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
    const node = (this.displayNodes.length ? this.displayNodes : cfg?.nodes ?? []).find((n) => n.id === nodeId);
    const reading = this.computed?.readings.get(nodeId);
    if (!cfg || !node || !reading) return undefined;

    const view: NodeView = describeNode(node, reading, { powerFormat: cfg.powerFormat, language: this.language });
    const lang = this.language;
    const rows: PopupRow[] = [];

    if (reading.soc) rows.push({ label: t('soc', lang), value: view.socText ?? '?' });

    if (node.groupMembers?.length && !this.replayActive) {
      for (const memberId of node.groupMembers) {
        const member = cfg.nodes.find((n) => n.id === memberId);
        const memberReading = this.computed?.readings.get(memberId);
        if (!member) continue;
        const value = memberReading?.watts === null || memberReading?.watts === undefined ? '?' : formatPower(memberReading.watts, cfg.powerFormat);
        rows.push({ label: member.name ?? member.id, value });
      }
    }

    if (!cfg.demo && !node.groupMembers?.length && !this.replayActive) {
      for (const field of advancedFieldsFor(node.type)) {
        if (field === 'soc_entity') continue;
        if (field === 'production_entity' && !node.config.power_entity) continue;
        const id = node.config[field];
        if (typeof id === 'string' && id) rows.push({ label: t(fieldLabelKey(field, node.type), lang), value: this.formatEntity(id) });
      }
      if (node.type === 'grid' && !node.config.phase_l1_power_entity) {
        const l1 = this.derivedLiveL1(node, reading.watts);
        if (l1 !== null) rows.push({ label: t('phase_l1_power_calculated', lang), value: `${l1 < 0 ? '−' : ''}${formatPower(l1, cfg.powerFormat)}` });
      }
      for (const extra of node.config.entities ?? []) {
        const friendly = this._hass?.states[extra.entity]?.attributes.friendly_name;
        const label = extra.name ?? (typeof friendly === 'string' ? friendly : extra.entity);
        rows.push({ label, value: this.formatEntity(extra.entity) });
      }
    }

    if (node.type === 'grid' && cfg.pricing.mode !== 'none' && !this.replayActive) {
      const prices = readPrices(cfg.pricing, cfg.demo ? undefined : this._hass);
      if (prices.importPrice !== null) rows.push({ label: t('current_import_price', lang), value: formatPrice(prices.importPrice, cfg.pricing.currency, lang) });
      if (prices.exportPrice !== null) rows.push({ label: t('current_export_price', lang), value: formatPrice(prices.exportPrice, cfg.pricing.currency, lang) });
      const rate = currentGridRate(reading.watts, prices);
      if (rate.value !== null && rate.kind !== 'none') {
        rows.push({
          label: t(rate.kind === 'cost' ? 'current_cost_rate' : 'current_revenue_rate', lang),
          value: `${formatCurrency(rate.value, cfg.pricing.currency, lang, 3)} ${t('per_hour', lang)}`,
        });
      }
      if (this.todayGridBalance?.value !== null && this.todayGridBalance?.value !== undefined) {
        rows.push({ label: t('revenue_today', lang), value: formatCurrency(this.todayGridBalance.value, cfg.pricing.currency, lang, 2) });
      }
    }

    const powerEntity = node.config.power_entity ?? node.config.production_entity;
    const computedHome = node.role === 'home' && !node.config.power_entity;
    const history = cfg.demo || powerEntity || computedHome || node.type === 'backup' || !!node.groupMembers?.length
      ? (this.history.get(nodeId)?.state ?? { kind: 'loading' as const })
      : { kind: 'none' as const };

    if (history.kind === 'ready' && history.points.length > 0) {
      const peak = history.points.reduce((best, point) => Math.abs(point.v) > Math.abs(best.v) ? point : best, history.points[0]!);
      const avg = history.points.reduce((sum, point) => sum + point.v, 0) / history.points.length;
      rows.unshift(
        { label: t('peak_power', lang), value: `${peak.v < 0 ? '−' : ''}${formatPower(peak.v, cfg.powerFormat)}` },
        { label: t('peak_time', lang), value: new Date(peak.t).toLocaleTimeString(lang || undefined, { hour: '2-digit', minute: '2-digit' }) },
        { label: t('average_power', lang), value: `${avg < 0 ? '−' : ''}${formatPower(avg, cfg.powerFormat)}` },
      );
    }

    const phases = node.type === 'grid' ? this.phasePopupModel(node, history) : undefined;

    return {
      nodeType: node.type,
      title: view.displayName,
      subtitle: this.replayActive && this.replayTimestamp !== undefined ? `${t('replay_title', lang)} · ${new Date(this.replayTimestamp).toLocaleTimeString(lang || undefined, { hour: '2-digit', minute: '2-digit' })}` : view.subtitle,
      valueText: view.valueText,
      status: view.status,
      rows,
      history,
      phases,
      energyStats: node.role === 'home' && !this.replayActive ? this.energyStatsPopupModel() : undefined,
      diagnostics: this.diagnosticRows(node),
      note: node.groupMembers?.length ? `${t('group_total_of', lang)} ${node.groupMembers.length}` : node.role === 'home' ? t(computedHome ? 'home_computed' : 'home_measured', lang) : undefined,
      powerFormat: cfg.powerFormat,
      language: lang,
    };
  }

  private formatKWh(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return '—';
    return `${new Intl.NumberFormat(this.language || undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} kWh`;
  }

  private formatPct(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return '—';
    return `${new Intl.NumberFormat(this.language || undefined, { maximumFractionDigits: 0 }).format(value)} %`;
  }

  private energyStatsPopupModel(): PopupModel['energyStats'] {
    const cfg = this.config!;
    const period = this.energyStatsPeriod;
    const cached = this.energyStats.get(period);
    const stats = cached?.value ?? null;
    const loading = this.energyStatsInFlight.has(period) || (!cached && !cfg.demo);
    const rows: PopupRow[] = [];
    if (stats) {
      rows.push(
        { label: t('stat_consumption', this.language), value: this.formatKWh(stats.consumptionKWh) },
        { label: t('stat_import', this.language), value: this.formatKWh(stats.importKWh) },
        { label: t('stat_export', this.language), value: this.formatKWh(stats.exportKWh) },
      );
      if (stats.solarKWh !== null && stats.solarKWh > 0) rows.push({ label: t('stat_solar', this.language), value: this.formatKWh(stats.solarKWh) });
      if (cfg.pricing.mode !== 'none') {
        if (stats.importCost !== null) rows.push({ label: t('stat_import_cost', this.language), value: formatCurrency(stats.importCost, cfg.pricing.currency, this.language, 2) });
        if (stats.exportRevenue !== null) rows.push({ label: t('stat_export_revenue', this.language), value: formatCurrency(stats.exportRevenue, cfg.pricing.currency, this.language, 2) });
        if (stats.netCost !== null) rows.push({ label: t('stat_net_cost', this.language), value: formatCurrency(stats.netCost, cfg.pricing.currency, this.language, 2) });
      }
      if (stats.selfConsumptionPct !== null) rows.push({ label: t('stat_self_consumption', this.language), value: this.formatPct(stats.selfConsumptionPct) });
      if (stats.selfSufficiencyPct !== null) rows.push({ label: t('stat_self_sufficiency', this.language), value: this.formatPct(stats.selfSufficiencyPct) });
    }
    if (!cached && !cfg.demo) queueMicrotask(() => void this.ensureEnergyStats(period));
    return {
      selected: period,
      loading,
      rows,
      onSelect: (next) => {
        this.energyStatsPeriod = next;
        void this.ensureEnergyStats(next);
        this.refreshOpenPopup('home');
      },
    };
  }

  private async ensureEnergyStats(period: EnergyStatsPeriod): Promise<void> {
    const cfg = this.config;
    if (!cfg) return;
    const cached = this.energyStats.get(period);
    if (cached && Date.now() - cached.fetchedAt < HISTORY_TTL_MS) return;
    const existing = this.energyStatsInFlight.get(period);
    if (existing) return existing;

    const task = (async () => {
      const value = cfg.demo ? demoEnergyStats(period) : this._hass ? await fetchEnergyStats(this._hass, cfg, period, cfg.pricing) : null;
      this.energyStats.set(period, { value, fetchedAt: Date.now() });
      this.refreshOpenPopup('home');
    })();
    this.energyStatsInFlight.set(period, task);
    try { await task; } finally {
      if (this.energyStatsInFlight.get(period) === task) this.energyStatsInFlight.delete(period);
    }
  }

  private diagnosticRows(node: EnergyNode): PopupModel['diagnostics'] | undefined {
    const report = this.computed?.diagnostics;
    if (!report) return undefined;
    const lang = this.language;
    const issues: DiagnosticItem[] = node.groupMembers?.length
      ? node.groupMembers.flatMap((id) => report.byNode.get(id) ?? [])
      : [...(report.byNode.get(node.id) ?? [])];
    const rows: PopupRow[] = issues.map((item) => ({
      label: t(item.labelKey, lang),
      value: item.minutes !== undefined
        ? `${Math.round(item.minutes)} ${t('minutes_short', lang)}`
        : item.watts !== undefined
          ? `${item.watts < 0 ? '−' : ''}${formatPower(item.watts, this.config!.powerFormat)}`
          : item.detail ?? t('diag_attention', lang),
    }));

    if (node.role === 'home' && report.unmeteredConsumptionWatts !== null) {
      const watts = report.unmeteredConsumptionWatts;
      rows.push({
        label: t(watts >= 0 ? 'diag_unmetered_consumption' : 'diag_consumers_over_home', lang),
        value: `${watts < 0 ? '−' : ''}${formatPower(watts, this.config!.powerFormat)}`,
      });
    }

    const severity = highestSeverity(issues);
    if (rows.length === 0) {
      return { severity: 'ok', rows: [], message: t('diag_no_issues', lang) };
    }
    return { severity: severity ?? 'info', rows };
  }

  private derivedL1Key(node: EnergyNode): string {
    return `__derived_l1__${node.id}`;
  }

  /** Live L1 fallback for meters (notably HomeWizard P1) that expose total + L2 + L3 only. */
  private derivedLiveL1(node: EnergyNode, totalWatts: number | null): number | null {
    if (node.type !== 'grid' || node.config.phase_l1_power_entity) return null;
    const l2Id = node.config.phase_l2_power_entity;
    const l3Id = node.config.phase_l3_power_entity;
    if (!l2Id || !l3Id || !this._hass) return null;
    const read = (id: string): number | null => {
      const entity = this._hass?.states[id];
      if (!entity || entity.state === 'unknown' || entity.state === 'unavailable') return null;
      const value = parsePower(entity.state, entity.attributes?.unit_of_measurement);
      if (value === null) return null;
      return node.invert ? -value : value;
    };
    return deriveL1Power(totalWatts, read(l2Id), read(l3Id));
  }

  private phasePopupModel(node: EnergyNode, totalHistory: HistoryState): PopupModel['phases'] | undefined {
    const cfg = this.config;
    if (!cfg || node.type !== 'grid') return undefined;

    const ids = [
      node.config.phase_l1_power_entity,
      node.config.phase_l2_power_entity,
      node.config.phase_l3_power_entity,
    ];
    const hasConfiguredPhases = ids.some(Boolean);
    if (!cfg.demo && !hasConfiguredPhases) return undefined;

    const labels = ['L1', 'L2', 'L3'] as const;
    const classes = ['phase-l1', 'phase-l2', 'phase-l3'] as const;
    const demoSeries = cfg.demo && totalHistory.kind === 'ready'
      ? this.demoPhaseHistory(totalHistory)
      : undefined;
    const series = labels.map((label, index) => {
      const key = ids[index] ?? (index === 0 && ids[1] && ids[2] ? this.derivedL1Key(node) : undefined);
      return {
        label,
        cssClass: classes[index]!,
        history: demoSeries?.[index] ?? (key ? (this.phaseHistory.get(key) ?? { kind: 'loading' as const }) : { kind: 'none' as const }),
      };
    });

    return {
      enabled: this.phaseGraphEnabled.has(node.id),
      series,
      onToggle: (enabled: boolean) => {
        if (enabled) this.phaseGraphEnabled.add(node.id);
        else this.phaseGraphEnabled.delete(node.id);
        if (enabled && !cfg.demo) void this.ensureHistoryBundle();
        this.refreshOpenPopup(node.id);
      },
    };
  }

  /** Demo-fasen zijn bewust niet exact gelijk verdeeld, zodat de 3-lijnsgrafiek zichtbaar te testen is. */
  private demoPhaseHistory(total: Extract<HistoryState, { kind: 'ready' }>): HistoryState[] {
    const factors = [0.38, 0.33, 0.29];
    return factors.map((factor, phase) => ({
      kind: 'ready' as const,
      start: total.start,
      end: total.end,
      points: total.points.map((point, index) => ({
        t: point.t,
        v: point.v * factor * (1 + 0.12 * Math.sin(index / 7 + phase * 1.9)),
      })),
    }));
  }

  private async ensureTodayGridBalance(): Promise<void> {
    const cfg = this.config;
    if (!cfg || cfg.pricing.mode === 'none') return;
    if (this.todayGridBalance && Date.now() - this.todayGridBalance.fetchedAt < HISTORY_TTL_MS) return;
    if (this.todayGridBalanceInFlight) return this.todayGridBalanceInFlight;

    const grid = cfg.nodes.find((n) => n.type === 'grid');
    if (!grid) return;
    const importEnergyEntity = grid.config.energy_import_entity;
    const exportEnergyEntity = grid.config.energy_export_entity;
    if (!cfg.demo && !importEnergyEntity && !exportEnergyEntity) return;

    const task = (async () => {
      const result = cfg.demo
        ? { balance: -2.18 }
        : this._hass
          ? await fetchTodayGridFinancials(this._hass, importEnergyEntity, exportEnergyEntity, cfg.pricing)
          : null;
      this.todayGridBalance = { value: result?.balance ?? null, fetchedAt: Date.now() };
      this.refreshOpenPopup(grid.id);
    })();
    this.todayGridBalanceInFlight = task;
    try { await task; } finally {
      if (this.todayGridBalanceInFlight === task) this.todayGridBalanceInFlight = undefined;
    }
  }

  private async ensureHistory(nodeId: string): Promise<void> {
    const cfg = this.config;
    const node = (this.displayNodes.length ? this.displayNodes : cfg?.nodes ?? []).find((n) => n.id === nodeId);
    if (!cfg || !node) return;

    const cached = this.history.get(nodeId);
    if (cached && Date.now() - cached.fetchedAt < HISTORY_TTL_MS) return;

    if (cfg.demo) {
      this.loadDemoHistoryBundle();
      return;
    }

    // Een sessie-cache kan een popup onmiddellijk vullen, ook na navigeren/refreshen.
    const restored = this.readHistorySession(node);
    if (restored) {
      this.history.set(node.id, restored);
      this.refreshOpenPopup(node.id);
      return;
    }

    await this.ensureHistoryBundle();
  }

  /**
   * Eén gezamenlijke history-call voor alle vermogenssensoren van de kaart. Daarna worden
   * alle nodes op dezelfde 96 tijdstippen opnieuw berekend met exact dezelfde flowlogica als live.
   * Daardoor krijgt ook een berekende Woning-node een echte 24-uursgrafiek.
   */
  private async ensureHistoryBundle(): Promise<void> {
    const cfg = this.config;
    if (!cfg || cfg.demo || !this._hass?.callApi) return;
    if (this.historyBundleFetchedAt && Date.now() - this.historyBundleFetchedAt < HISTORY_TTL_MS) return;
    if (this.historyBundleInFlight) return this.historyBundleInFlight;

    const task = this.loadHistoryBundle();
    this.historyBundleInFlight = task;
    try {
      await task;
    } finally {
      if (this.historyBundleInFlight === task) this.historyBundleInFlight = undefined;
    }
  }

  private historyEntityIds(): string[] {
    const cfg = this.config;
    if (!cfg) return [];
    const ids = new Set<string>();
    for (const node of cfg.nodes) {
      const c = node.config;
      for (const id of [
        c.power_entity,
        c.production_entity,
        c.charge_power_entity,
        c.discharge_power_entity,
        c.phase_l1_power_entity,
        c.phase_l2_power_entity,
        c.phase_l3_power_entity,
      ]) {
        if (typeof id === 'string' && id) ids.add(id);
      }
    }
    for (const conn of cfg.connections) if (conn.entity) ids.add(conn.entity);
    return [...ids];
  }

  private async loadHistoryBundle(): Promise<void> {
    const cfg = this.config;
    const hass = this._hass;
    if (!cfg || !hass?.callApi) return;

    const entityIds = this.historyEntityIds();
    if (entityIds.length === 0) {
      for (const node of (this.displayNodes.length ? this.displayNodes : cfg.nodes)) this.storeHistory(node, { kind: 'none' });
      this.historyBundleFetchedAt = Date.now();
      return;
    }

    try {
      const end = Date.now();
      const start = end - HISTORY_HOURS * 3_600_000;
      const raw = await fetchHistoryBatch(hass, entityIds, HISTORY_HOURS, end);
      const series = new Map<string, Map<number, number>>();
      const timeline = Array.from({ length: HISTORY_BUCKETS }, (_, i) => start + ((end - start) * i) / (HISTORY_BUCKETS - 1));

      for (const id of entityIds) {
        const points = bucketize(raw.get(id) ?? [], start, end, HISTORY_BUCKETS);
        series.set(id, new Map(points.map((p) => [p.t, p.v])));
      }

      // Bewaar de drie netfasen apart. De normale node-history blijft het totale netvermogen tonen;
      // de popup kan optioneel naar deze drie losse reeksen omschakelen.
      const grid = cfg.nodes.find((n) => n.type === 'grid');
      if (grid) {
        for (const id of [grid.config.phase_l1_power_entity, grid.config.phase_l2_power_entity, grid.config.phase_l3_power_entity]) {
          if (!id) continue;
          let points = bucketize(raw.get(id) ?? [], start, end, HISTORY_BUCKETS);
          if (grid.invert) points = points.map((point) => ({ ...point, v: -point.v }));
          this.phaseHistory.set(id, points.length >= 2 ? { kind: 'ready', points, start, end } : { kind: 'none' });
        }
      }

      const historyNodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
      const perNode = new Map<string, HistoryPoint[]>(historyNodes.map((n) => [n.id, []]));
      for (const time of timeline) {
        const states: Hass['states'] = {};
        for (const id of entityIds) {
          const value = series.get(id)?.get(time);
          if (value === undefined) continue;
          states[id] = { state: String(value), attributes: { unit_of_measurement: 'W' } };
        }
        const historicalHass: Hass = { states, language: hass.language, locale: hass.locale };
        const readings = new Map<string, NodeReading>();
        for (const node of cfg.nodes) if (node.role !== 'home') readings.set(node.id, readNode(node, historicalHass));
        applyBackupReadings(cfg.nodes, cfg.connections, readings, false);
        const flows = computeFlows(cfg.nodes, cfg.connections, readings, historicalHass);
        const home = cfg.nodes.find((n) => n.role === 'home');
        if (home) {
          const measured = !!home.config.power_entity;
          readings.set(home.id, measured ? readNode(home, historicalHass) : computeHomeReading(home, cfg.nodes, cfg.connections, flows));
        }
        applyGroupReadings(cfg.groups, this.groupNodes, readings);
        for (const node of historyNodes) {
          const watts = readings.get(node.id)?.watts;
          if (typeof watts === 'number') perNode.get(node.id)?.push({ t: time, v: watts });
        }
      }

      const fetchedAt = Date.now();
      for (const node of historyNodes) {
        const points = perNode.get(node.id) ?? [];
        this.storeHistory(node, points.length >= 2 ? { kind: 'ready', points, start, end } : { kind: 'none' }, fetchedAt);
      }

      // Sommige meters (o.a. HomeWizard P1) publiceren totaal + L2 + L3, maar geen losse L1.
      // Leid L1 dan historisch af als totaal − L2 − L3, zodat de driefasegrafiek toch compleet is.
      if (grid && !grid.config.phase_l1_power_entity && grid.config.phase_l2_power_entity && grid.config.phase_l3_power_entity) {
        const total = this.history.get(grid.id)?.state;
        const l2 = this.phaseHistory.get(grid.config.phase_l2_power_entity);
        const l3 = this.phaseHistory.get(grid.config.phase_l3_power_entity);
        if (total?.kind === 'ready' && l2?.kind === 'ready' && l3?.kind === 'ready') {
          const points = deriveL1History(total.points, l2.points, l3.points);
          this.phaseHistory.set(this.derivedL1Key(grid), points.length >= 2 ? { kind: 'ready', points, start, end } : { kind: 'none' });
        } else {
          this.phaseHistory.set(this.derivedL1Key(grid), { kind: 'none' });
        }
      }
      this.historyBundleFetchedAt = fetchedAt;
    } catch {
      const fetchedAt = Date.now();
      for (const node of cfg.nodes) if (!this.history.has(node.id)) this.storeHistory(node, { kind: 'none' }, fetchedAt);
      const grid = cfg.nodes.find((n) => n.type === 'grid');
      if (grid) for (const id of [grid.config.phase_l1_power_entity, grid.config.phase_l2_power_entity, grid.config.phase_l3_power_entity]) {
        if (id) this.phaseHistory.set(id, { kind: 'none' });
      }
      if (grid && !grid.config.phase_l1_power_entity && grid.config.phase_l2_power_entity && grid.config.phase_l3_power_entity) this.phaseHistory.set(this.derivedL1Key(grid), { kind: 'none' });
      this.historyBundleFetchedAt = fetchedAt;
      if (grid) this.refreshOpenPopup(grid.id);
    }
  }

  private storeHistory(node: EnergyNode, state: HistoryState, fetchedAt: number = Date.now()): void {
    this.history.set(node.id, { state, fetchedAt });
    this.writeHistorySession(node, state, fetchedAt);
    this.updateReplayControls();
    this.refreshOpenPopup(node.id);
  }

  private refreshOpenPopup(nodeId: string): void {
    if (this.openNodeId !== nodeId || !this.popup.isOpen) return;
    const model = this.popupModel(nodeId);
    if (model) this.popup.update(model);
  }

  /**
   * Start de gezamenlijke historie direct op de achtergrond zodra de kaart zichtbaar is.
   * Home Assistant zet `hass` zeer vaak opnieuw (bij iedere state-update). Daarom mag een
   * geplande preload hier niet telkens worden geannuleerd en opnieuw gestart: bij snel
   * wijzigende vermogenssensoren zou de history-call anders eindeloos uitgesteld worden.
   */
  private scheduleHistoryPreload(): void {
    const cfg = this.config;
    if (!cfg || cfg.demo || !this.isConnected || !this._hass?.callApi || document.hidden) return;
    if (this.preloadTimer !== undefined || this.historyBundleInFlight) return;
    if (this.historyBundleFetchedAt && Date.now() - this.historyBundleFetchedAt < HISTORY_TTL_MS) return;

    // Vul eerst alle nog geldige sessiecaches terug. Daardoor zijn popups na een dashboard-
    // navigatie of refresh direct bruikbaar, terwijl een eventuele netwerkrefresh parallel volgt.
    this.restoreHistorySessionCache();

    this.preloadTimer = window.setTimeout(() => {
      this.preloadTimer = undefined;
      void this.ensureHistoryBundle();
    }, HISTORY_PRELOAD_DELAY_MS);
  }

  /** Herstelt in één keer de bestaande 5-minuten-cache voor alle nodes. */
  private restoreHistorySessionCache(): void {
    const cfg = this.config;
    if (!cfg) return;
    const nodes = [...cfg.nodes, ...this.groupNodes.values()];
    for (const node of nodes) {
      const current = this.history.get(node.id);
      if (current && Date.now() - current.fetchedAt < HISTORY_TTL_MS) continue;
      const restored = this.readHistorySession(node);
      if (restored) this.history.set(node.id, restored);
    }
  }

  private cancelHistoryPreload(): void {
    if (this.preloadTimer !== undefined) {
      window.clearTimeout(this.preloadTimer);
      this.preloadTimer = undefined;
    }
  }

  private historySessionKey(node: EnergyNode): string | undefined {
    const entityId = node.config.power_entity ?? node.config.production_entity;
    if (entityId) return `${HISTORY_SESSION_PREFIX}${entityId}|${node.invert ? '1' : '0'}`;

    // Berekende nodes (zoals Woning of een ongemeten backup) zijn afhankelijk van de hele flow-config.
    // Een compacte configuratiesignatuur voorkomt dat een oude cache bij een andere setup wordt hergebruikt.
    const cfg = this.config;
    if (!cfg) return undefined;
    const signature = cfg.nodes
      .map((n) => [n.id, n.config.power_entity, n.config.production_entity, n.config.charge_power_entity, n.config.discharge_power_entity, n.invert])
      .concat(cfg.connections.map((c) => [c.id, c.from, c.to, c.entity, c.invert]))
      .concat(cfg.groups.map((g) => [g.id, g.display, g.name, g.icon, ...g.memberIds]))
      .map((x) => x.join(':'))
      .join('|');
    let hash = 2166136261;
    for (let i = 0; i < signature.length; i++) hash = Math.imul(hash ^ signature.charCodeAt(i), 16777619);
    return `${HISTORY_SESSION_PREFIX}computed:${node.id}:${(hash >>> 0).toString(36)}`;
  }

  private readHistorySession(node: EnergyNode): { state: HistoryState; fetchedAt: number } | undefined {
    const key = this.historySessionKey(node);
    if (!key) return undefined;
    try {
      const raw = window.sessionStorage?.getItem(key);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as { state?: HistoryState; fetchedAt?: number };
      if (!parsed.state || typeof parsed.fetchedAt !== 'number' || Date.now() - parsed.fetchedAt >= HISTORY_TTL_MS) {
        window.sessionStorage?.removeItem(key);
        return undefined;
      }
      return { state: parsed.state, fetchedAt: parsed.fetchedAt };
    } catch {
      return undefined;
    }
  }

  private writeHistorySession(node: EnergyNode, state: HistoryState, fetchedAt: number): void {
    if (state.kind !== 'ready') return;
    const key = this.historySessionKey(node);
    if (!key) return;
    try {
      window.sessionStorage?.setItem(key, JSON.stringify({ state, fetchedAt }));
    } catch {
      // Opslag kan uitgeschakeld of vol zijn; de geheugen-cache blijft dan gewoon werken.
    }
  }

  /**
   * Demo-history wordt in één batch opgebouwd met exact dezelfde tijdas voor alle zichtbare nodes.
   * Dit voorkomt dat de replay-range leeg raakt doordat afzonderlijk opgebouwde demo-series net
   * verschillende start-/eindtijden hebben. Dezelfde batch voedt ook de gewone popup-grafieken.
   */
  private loadDemoHistoryBundle(): void {
    const cfg = this.config;
    if (!cfg?.demo) return;

    const nodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
    const now = Date.now();
    const span = 24 * 3_600_000;
    const start = now - span;
    const nowT = DEMO_OFFSET_S + (performance.now() - this.demoStart) / 1000;
    const samples = 96;
    const perNode = new Map<string, HistoryPoint[]>(nodes.map((node) => [node.id, []]));
    const home = cfg.nodes.find((node) => node.role === 'home');

    for (let i = 0; i < samples; i++) {
      const tSeconds = nowT - 240 + (240 * i) / (samples - 1);
      const timestamp = start + (span * i) / (samples - 1);
      const readings = demoReadings(cfg.nodes, tSeconds);
      applyBackupReadings(cfg.nodes, cfg.connections, readings, true);

      const sourceFlows = computeFlows(cfg.nodes, cfg.connections, readings, undefined, { ignoreEntities: true });
      if (home) readings.set(home.id, computeHomeReading(home, cfg.nodes, cfg.connections, sourceFlows));
      applyGroupReadings(cfg.groups, this.groupNodes, readings);

      for (const node of nodes) {
        const watts = readings.get(node.id)?.watts;
        if (typeof watts === 'number') perNode.get(node.id)?.push({ t: timestamp, v: watts });
      }
    }

    const fetchedAt = Date.now();
    for (const node of nodes) {
      const points = perNode.get(node.id) ?? [];
      this.storeHistory(node, points.length >= 2 ? { kind: 'ready', points, start, end: now } : { kind: 'none' }, fetchedAt);
    }
    this.historyBundleFetchedAt = fetchedAt;
    this.updateReplayControls();
  }

}

/** Namen boven Home komen boven de node; in de rechte layout staan Home en backup (lijnen boven en onder) ernaast. */
function labelPositionFor(node: EnergyNode, y: number, homeY: number, straight: boolean): 'below' | 'above' | 'side' {
  if (straight && (node.role === 'home' || node.type === 'backup')) return 'side';
  return y < homeY - 1 ? 'above' : 'below';
}

export { ConfigError };
