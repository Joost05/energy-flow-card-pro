(()=>{
const __mods=Object.create(null),__cache=Object.create(null);
__mods["src/card/EnergyFlowCard"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigError = exports.EnergyFlowCard = void 0;
const CardConfig_1 = __req("src/config/CardConfig");
Object.defineProperty(exports, "ConfigError", { enumerable: true, get: function () { return CardConfig_1.ConfigError; } });
const DemoEngine_1 = __req("src/demo/DemoEngine");
const diagnosticsHelper_1 = __req("src/helpers/diagnosticsHelper");
const flowHelper_1 = __req("src/helpers/flowHelper");
const historyHelper_1 = __req("src/helpers/historyHelper");
const replayHelper_1 = __req("src/helpers/replayHelper");
const mobileFocusHelper_1 = __req("src/helpers/mobileFocusHelper");
const i18n_1 = __req("src/helpers/i18n");
const phaseHelper_1 = __req("src/helpers/phaseHelper");
const pricingHelper_1 = __req("src/helpers/pricingHelper");
const energyStatsHelper_1 = __req("src/helpers/energyStatsHelper");
const groupHelper_1 = __req("src/helpers/groupHelper");
const stateHelper_1 = __req("src/helpers/stateHelper");
const AutoLayout_1 = __req("src/layout/AutoLayout");
const Node_1 = __req("src/models/Node");
const ConnectionRenderer_1 = __req("src/renderer/ConnectionRenderer");
const NodeRenderer_1 = __req("src/renderer/NodeRenderer");
const PopupRenderer_1 = __req("src/renderer/PopupRenderer");
const dom_1 = __req("src/renderer/dom");
const EntityStatus_1 = __req("src/types/EntityStatus");
const styles_1 = __req("src/card/styles");
const HISTORY_HOURS = 24;
const HISTORY_TTL_MS = 5 * 60_000;
const HISTORY_BUCKETS = 96;
const HISTORY_PRELOAD_DELAY_MS = 0;
const HISTORY_SESSION_PREFIX = 'efc-history-v2:';
/** In demo-modus begint de tijd op 300 s, zodat er al "geschiedenis" bestaat voor de grafiek. */
const DEMO_OFFSET_S = 300;
class EnergyFlowCard extends HTMLElement {
    constructor() {
        super();
        this.nodeEls = new Map();
        this.displayNodes = [];
        this.displayConnections = [];
        this.groupNodes = new Map();
        this.connEls = [];
        this.popup = new PopupRenderer_1.Popup(() => this.closePopup());
        this.history = new Map();
        this.phaseHistory = new Map();
        this.phaseGraphEnabled = new Set();
        this.historyBundleFetchedAt = 0;
        this.energyStatsPeriod = 'today';
        this.energyStats = new Map();
        this.energyStatsInFlight = new Map();
        this.replayActive = false;
        this.demoStart = 0;
        this.reducedMotion = false;
        this.compactMobile = false;
        this.onMotionChange = (ev) => {
            this.reducedMotion = ev.matches;
            this.update();
        };
        this.attachShadow({ mode: 'open' });
    }
    // ----- Home Assistant-contract -----------------------------------------------------------
    /** Wordt door Home Assistant aangeroepen bij elke wijziging van de YAML. Gooit een ConfigError bij fouten. */
    setConfig(raw) {
        this.config = (0, CardConfig_1.normalizeConfig)(raw); // gooit bij ongeldige config; HA toont dan een foutkaart
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
    set hass(hass) {
        this._hass = hass;
        if (!this.config?.demo) {
            this.scheduleUpdate();
            this.scheduleHistoryPreload();
            void this.ensureTodayGridBalance();
            if (this.openNodeId === 'home')
                void this.ensureEnergyStats(this.energyStatsPeriod);
        }
    }
    get hass() {
        return this._hass;
    }
    getCardSize() {
        return 5;
    }
    getGridOptions() {
        return { columns: 12, rows: 6, min_columns: 6, min_rows: 4 };
    }
    static getStubConfig() {
        return { demo: true };
    }
    static getConfigElement() {
        return document.createElement('energy-flow-card-editor');
    }
    connectedCallback() {
        this.motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (this.motionQuery) {
            this.reducedMotion = this.motionQuery.matches;
            this.motionQuery.addEventListener('change', this.onMotionChange);
        }
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver((entries) => {
                const width = entries[0]?.contentRect.width ?? 0;
                if (width <= 0)
                    return;
                const compact = width < 700;
                if (compact === this.compactMobile)
                    return;
                this.compactMobile = compact;
                if (!compact)
                    this.mobileFocusId = undefined;
                this.closePopup();
                this.buildStructure();
                this.update();
            });
            this.resizeObserver.observe(this);
        }
        else {
            this.compactMobile = globalThis.innerWidth < 700;
        }
        this.syncTimer();
        if (this.config) {
            this.update();
            if (this.config.demo)
                this.loadDemoHistoryBundle();
            else
                this.scheduleHistoryPreload();
            void this.ensureTodayGridBalance();
        }
    }
    disconnectedCallback() {
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
    get language() {
        return (0, i18n_1.hassLanguage)(this._hass);
    }
    buildStructure() {
        const cfg = this.config;
        const root = this.shadowRoot;
        this.nodeEls.clear();
        this.connEls = [];
        const display = cfg ? (0, groupHelper_1.buildDisplayGraph)(cfg) : undefined;
        this.displayNodes = display?.nodes ?? [];
        this.displayConnections = display?.connections ?? [];
        this.groupNodes = display?.groupNodes ?? new Map();
        const card = (0, dom_1.html)('ha-card', { class: customElements.get('ha-card') ? '' : 'fallback' });
        if (cfg) {
            const colorVars = {
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
            for (const [name, value] of Object.entries(colorVars))
                if (value)
                    card.style.setProperty(name, value);
        }
        if (cfg?.title)
            card.append((0, dom_1.html)('div', { class: 'title' }, cfg.title));
        const stage = (0, dom_1.html)('div', { class: 'stage' });
        card.append(stage);
        if (!cfg || cfg.nodes.length <= 1) {
            stage.append((0, dom_1.html)('div', { class: 'empty' }, (0, dom_1.html)('strong', {}, (0, i18n_1.t)('empty_title', this.language)), (0, dom_1.html)('span', {}, (0, i18n_1.t)('empty_hint', this.language))));
        }
        else {
            if (cfg.demo)
                stage.append((0, dom_1.html)('div', { class: 'badge' }, (0, i18n_1.t)('demo_badge', this.language)));
            if (cfg.pricing.mode !== 'none')
                stage.append(this.buildPriceBadge(cfg));
            if (this.compactMobile) {
                const nav = this.buildMobileFocusNav(cfg);
                if (nav)
                    stage.append(nav);
            }
            stage.append(this.buildFlowSvg(cfg));
            const replay = this.buildReplayControls();
            this.replayControls = replay;
            card.append(replay);
        }
        card.append(this.popup.el);
        root.replaceChildren((0, dom_1.html)('style', {}, styles_1.styles), card);
    }
    buildPriceBadge(cfg) {
        const prices = (0, pricingHelper_1.readPrices)(cfg.pricing, cfg.demo ? undefined : this._hass);
        const currency = cfg.pricing.currency;
        const importText = prices.importPrice === null ? '?' : (0, pricingHelper_1.formatCurrency)(prices.importPrice, currency, this.language, 2);
        const exportText = prices.exportPrice === null ? '?' : (0, pricingHelper_1.formatCurrency)(prices.exportPrice, currency, this.language, 2);
        const el = (0, dom_1.html)('div', { class: 'price-panel', 'aria-label': (0, i18n_1.t)('energy_prices', this.language) }, (0, dom_1.html)('div', { class: 'price-item price-import' }, (0, dom_1.html)('span', { class: 'price-label' }, (0, i18n_1.t)('price_card_import', this.language)), (0, dom_1.html)('span', { class: 'price-value', 'data-price-import': '' }, `${importText}/kWh`)), (0, dom_1.html)('div', { class: 'price-divider', 'aria-hidden': 'true' }), (0, dom_1.html)('div', { class: 'price-item price-export' }, (0, dom_1.html)('span', { class: 'price-label' }, (0, i18n_1.t)('price_card_export', this.language)), (0, dom_1.html)('span', { class: 'price-value', 'data-price-export': '' }, `${exportText}/kWh`)));
        return el;
    }
    buildFlowSvg(cfg) {
        const allNodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
        const allConnections = this.displayConnections.length ? this.displayConnections : cfg.connections;
        const focused = this.compactMobile ? (0, mobileFocusHelper_1.buildMobileFocusGraph)(allNodes, allConnections, this.mobileFocusId) : undefined;
        const nodes = focused?.nodes ?? allNodes;
        const connections = focused?.connections ?? allConnections;
        const focusId = focused?.focusId;
        const layoutNodes = focusId && focusId !== focused?.homeId
            ? nodes.map((n) => n.id === focusId ? { ...n, role: 'home' } : n)
            : nodes;
        const layout = (0, AutoLayout_1.computeLayout)(layoutNodes, cfg.layout, connections);
        const straight = layout.mode !== 'circle';
        const byId = new Map(layoutNodes.map((n) => [n.id, n]));
        const homeNode = layoutNodes.find((n) => n.role === 'home');
        const homeY = (homeNode && layout.positions.get(homeNode.id)?.y) ?? layout.height / 2;
        const radiusOf = (n) => (n.role === 'home' ? AutoLayout_1.HOME_RADIUS : AutoLayout_1.NODE_RADIUS);
        const root = (0, dom_1.svg)('svg', { class: `flow layout-${layout.mode}`, viewBox: `0 0 ${layout.width} ${layout.height}`, role: 'group' });
        const connLayer = (0, dom_1.svg)('g', { class: 'connections' });
        const nodeLayer = (0, dom_1.svg)('g', { class: 'nodes' });
        root.append(connLayer, nodeLayer);
        for (const conn of connections) {
            const from = byId.get(conn.from);
            const to = byId.get(conn.to);
            const a = from && layout.positions.get(from.id);
            const b = to && layout.positions.get(to.id);
            if (!from || !to || !a || !b)
                continue;
            const curved = !straight && from.role !== 'home' && to.role !== 'home';
            const el = (0, ConnectionRenderer_1.createConnectionElement)(conn, { center: a, radius: radiusOf(from) }, { center: b, radius: radiusOf(to) }, curved, conn.color, straight);
            if (!el)
                continue;
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
            if (!pos)
                continue;
            const onOpen = () => {
                if (this.compactMobile && layoutNode.id !== focusId && (0, mobileFocusHelper_1.hasFocusableChildren)(layoutNode.id, allNodes, allConnections)) {
                    this.mobileFocusId = layoutNode.id;
                    this.closePopup();
                    this.buildStructure();
                    this.update();
                    return;
                }
                this.openPopup(layoutNode.id);
            };
            const nodeEl = (0, NodeRenderer_1.createNodeElement)(layoutNode, pos, radiusOf(layoutNode), onOpen, labelPositionFor(layoutNode, pos.y, homeY, straight));
            this.nodeEls.set(originalNode.id, nodeEl);
            nodeLayer.append(nodeEl.el);
        }
        return root;
    }
    buildMobileFocusNav(cfg) {
        const allNodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
        const allConnections = this.displayConnections.length ? this.displayConnections : cfg.connections;
        const graph = (0, mobileFocusHelper_1.buildMobileFocusGraph)(allNodes, allConnections, this.mobileFocusId);
        if (!graph.focusId || graph.focusId === graph.homeId)
            return undefined;
        const focus = allNodes.find((n) => n.id === graph.focusId);
        const parent = graph.parentId ? allNodes.find((n) => n.id === graph.parentId) : undefined;
        const home = allNodes.find((n) => n.id === graph.homeId);
        const label = [home?.name ?? (0, i18n_1.t)('home', this.language), focus?.name ?? graph.focusId].join(' › ');
        const back = (0, dom_1.html)('button', { class: 'mobile-focus-back', type: 'button', 'aria-label': (0, i18n_1.t)('mobile_focus_back', this.language) }, '‹');
        back.addEventListener('click', () => {
            this.mobileFocusId = parent && parent.id !== graph.homeId ? parent.id : undefined;
            this.closePopup();
            this.buildStructure();
            this.update();
        });
        return (0, dom_1.html)('div', { class: 'mobile-focus-nav' }, back, (0, dom_1.html)('span', { class: 'mobile-focus-path' }, label));
    }
    buildReplayControls() {
        const label = (0, dom_1.html)('span', { class: 'replay-label' }, (0, i18n_1.t)('replay', this.language));
        const time = (0, dom_1.html)('strong', { class: 'replay-time', 'data-replay-time': '', hidden: '' }, '');
        const slider = (0, dom_1.html)('input', {
            class: 'replay-slider', type: 'range', min: '0', max: '1000', value: '1000', step: '1', disabled: '', 'data-replay-slider': '',
            'aria-label': (0, i18n_1.t)('replay_title', this.language),
        });
        const live = (0, dom_1.html)('button', { class: 'replay-live', type: 'button', 'data-replay-live': '', hidden: '' }, (0, i18n_1.t)('replay_live', this.language));
        const status = (0, dom_1.html)('span', { class: 'replay-status', 'data-replay-status': '' }, '');
        const row = (0, dom_1.html)('div', { class: 'replay-row' }, label, time, slider, live);
        const controls = (0, dom_1.html)('div', { class: 'replay-controls' }, row, status);
        live.addEventListener('click', () => this.exitReplay());
        slider.addEventListener('input', () => this.onReplaySlider(Number(slider.value)));
        this.updateReplayControls(controls);
        return controls;
    }
    exitReplay() {
        if (!this.replayActive)
            return;
        this.replayActive = false;
        this.replayTimestamp = undefined;
        this.updateReplayControls();
        this.update();
    }
    readyReplaySeries() {
        const cfg = this.config;
        if (!cfg)
            return [];
        const nodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
        return nodes.flatMap((node) => {
            const state = this.history.get(node.id)?.state;
            return state?.kind === 'ready' && state.points.length > 1 ? [state.points] : [];
        });
    }
    replayWindow() {
        return (0, replayHelper_1.replayRange)(this.readyReplaySeries());
    }
    onReplaySlider(value) {
        const range = this.replayWindow();
        if (!range)
            return;
        this.replayActive = true;
        this.replayTimestamp = range.start + (range.end - range.start) * Math.max(0, Math.min(1000, value)) / 1000;
        this.updateReplayControls();
        this.update();
    }
    updateReplayControls(root = this.replayControls) {
        if (!root)
            return;
        const live = root.querySelector('[data-replay-live]');
        const slider = root.querySelector('[data-replay-slider]');
        const time = root.querySelector('[data-replay-time]');
        const status = root.querySelector('[data-replay-status]');
        const range = this.replayWindow();
        if (slider) {
            slider.disabled = !range;
            if (range && this.replayTimestamp !== undefined) {
                slider.value = String(Math.round(((this.replayTimestamp - range.start) / (range.end - range.start)) * 1000));
            }
            else if (!this.replayActive)
                slider.value = '1000';
        }
        if (time) {
            time.hidden = !this.replayActive || this.replayTimestamp === undefined;
            time.textContent = this.replayActive && this.replayTimestamp !== undefined
                ? new Date(this.replayTimestamp).toLocaleString(this.language || undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
                : '';
        }
        if (live)
            live.hidden = !this.replayActive;
        if (status) {
            status.hidden = !!range;
            status.textContent = range ? '' : (0, i18n_1.t)('replay_no_history', this.language);
        }
        root.classList.toggle('active', this.replayActive);
    }
    computeReplay() {
        const cfg = this.config;
        const timestamp = this.replayTimestamp;
        if (!cfg || timestamp === undefined)
            return undefined;
        const nodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
        const connections = this.displayConnections.length ? this.displayConnections : cfg.connections;
        const readings = new Map();
        for (const node of nodes) {
            const state = this.history.get(node.id)?.state;
            const point = state?.kind === 'ready' ? (0, replayHelper_1.nearestHistoryPoint)(state.points, timestamp) : undefined;
            const watts = point?.v ?? null;
            readings.set(node.id, {
                status: watts === null ? EntityStatus_1.EntityStatus.Invalid : watts === 0 ? EntityStatus_1.EntityStatus.Zero : EntityStatus_1.EntityStatus.Valid,
                watts,
                charging: node.type === 'battery' ? (watts ?? 0) < 0 : node.type === 'ev_charger' ? (watts ?? 0) > 0 : false,
            });
        }
        const flows = (0, flowHelper_1.computeFlows)(nodes, connections, readings, undefined, { ignoreEntities: true });
        return { readings, flows, diagnostics: { byNode: new Map(), balanceDifferenceWatts: null, unmeteredConsumptionWatts: null } };
    }
    // ----- Live bijwerken -----------------------------------------------------------------------
    compute() {
        const cfg = this.config;
        const readings = new Map();
        let flows;
        let sourceFlows;
        if (cfg.demo) {
            const tSeconds = DEMO_OFFSET_S + (performance.now() - this.demoStart) / 1000;
            for (const [id, r] of (0, DemoEngine_1.demoReadings)(cfg.nodes, tSeconds))
                readings.set(id, r);
            (0, flowHelper_1.applyBackupReadings)(cfg.nodes, cfg.connections, readings, true);
            sourceFlows = (0, flowHelper_1.computeFlows)(cfg.nodes, cfg.connections, readings, undefined, { ignoreEntities: true });
        }
        else {
            for (const node of cfg.nodes)
                if (node.role !== 'home')
                    readings.set(node.id, (0, flowHelper_1.readNode)(node, this._hass));
            (0, flowHelper_1.applyBackupReadings)(cfg.nodes, cfg.connections, readings, false);
            sourceFlows = (0, flowHelper_1.computeFlows)(cfg.nodes, cfg.connections, readings, this._hass);
        }
        const home = cfg.nodes.find((n) => n.role === 'home');
        if (home) {
            const measuredHome = !cfg.demo && !!home.config.power_entity;
            readings.set(home.id, measuredHome ? (0, flowHelper_1.readNode)(home, this._hass) : (0, flowHelper_1.computeHomeReading)(home, cfg.nodes, cfg.connections, sourceFlows));
        }
        const diagnostics = (0, diagnosticsHelper_1.computeDiagnostics)(cfg.nodes, cfg.connections, readings, sourceFlows, cfg.demo ? undefined : this._hass);
        (0, groupHelper_1.applyGroupReadings)(cfg.groups, this.groupNodes, readings);
        const displayNodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
        const displayConnections = this.displayConnections.length ? this.displayConnections : cfg.connections;
        flows = (0, flowHelper_1.computeFlows)(displayNodes, displayConnections, readings, cfg.demo ? undefined : this._hass, { ignoreEntities: cfg.demo });
        return { readings, flows, diagnostics };
    }
    updatePriceBadge() {
        const cfg = this.config;
        if (!cfg || cfg.pricing.mode === 'none')
            return;
        const prices = (0, pricingHelper_1.readPrices)(cfg.pricing, cfg.demo ? undefined : this._hass);
        const importEl = this.shadowRoot?.querySelector('[data-price-import]');
        const exportEl = this.shadowRoot?.querySelector('[data-price-export]');
        const importText = prices.importPrice === null ? '?' : (0, pricingHelper_1.formatCurrency)(prices.importPrice, cfg.pricing.currency, this.language, 2);
        const exportText = prices.exportPrice === null ? '?' : (0, pricingHelper_1.formatCurrency)(prices.exportPrice, cfg.pricing.currency, this.language, 2);
        if (importEl)
            importEl.textContent = `${importText}/kWh`;
        if (exportEl)
            exportEl.textContent = `${exportText}/kWh`;
    }
    flowContext() {
        const cfg = this.config;
        return {
            maxPower: cfg.maxPower,
            animationSpeed: cfg.animationSpeed,
            animate: cfg.animation && !this.reducedMotion,
        };
    }
    update() {
        const cfg = this.config;
        if (!cfg || this.nodeEls.size === 0)
            return;
        if (cfg.demo && document.hidden)
            return;
        this.computed = this.replayActive ? (this.computeReplay() ?? this.compute()) : this.compute();
        this.updatePriceBadge();
        const ctx = { powerFormat: cfg.powerFormat, language: this.language };
        for (const node of (this.displayNodes.length ? this.displayNodes : cfg.nodes)) {
            const reading = this.computed.readings.get(node.id);
            if (reading) {
                const view = (0, NodeRenderer_1.describeNode)(node, reading, ctx);
                const issues = node.groupMembers?.length
                    ? node.groupMembers.flatMap((id) => this.computed?.diagnostics.byNode.get(id) ?? [])
                    : this.computed.diagnostics.byNode.get(node.id);
                view.diagnostic = (0, diagnosticsHelper_1.highestSeverity)(issues);
                this.nodeEls.get(node.id)?.update(view);
            }
        }
        const flowCtx = this.flowContext();
        for (const { conn, el } of this.connEls)
            el.update(this.computed.flows.get(conn.id) ?? null, flowCtx);
        if (this.openNodeId && this.popup.isOpen) {
            const model = this.popupModel(this.openNodeId);
            if (model)
                this.popup.update(model);
        }
    }
    /** Coalesce rapid Home Assistant state updates into a single paint per animation frame. */
    scheduleUpdate() {
        if (this.updateFrame !== undefined)
            return;
        this.updateFrame = window.requestAnimationFrame(() => {
            this.updateFrame = undefined;
            this.update();
        });
    }
    syncTimer() {
        this.stopTimer();
        if (this.config?.demo && this.isConnected) {
            this.demoStart = performance.now();
            this.timer = window.setInterval(() => this.update(), 1000);
        }
    }
    stopTimer() {
        if (this.timer !== undefined) {
            window.clearInterval(this.timer);
            this.timer = undefined;
        }
    }
    // ----- Detailweergave -----------------------------------------------------------------------
    openPopup(nodeId) {
        const model = this.popupModel(nodeId);
        if (!model)
            return;
        this.openNodeId = nodeId;
        this.popup.open(model, this.nodeEls.get(nodeId)?.el);
        void this.ensureHistory(nodeId);
        const sourceNode = this.config?.nodes.find((n) => n.id === nodeId);
        if (sourceNode?.type === 'grid')
            void this.ensureTodayGridBalance();
        if (sourceNode?.role === 'home')
            void this.ensureEnergyStats(this.energyStatsPeriod);
    }
    closePopup() {
        if (this.popup.isOpen)
            this.popup.close();
        this.openNodeId = undefined;
    }
    formatEntity(entityId) {
        const entity = this._hass?.states[entityId];
        if (!entity)
            return '?';
        if (entity.state === 'unavailable')
            return '!';
        if (entity.state === 'unknown')
            return '?';
        const unit = typeof entity.attributes.unit_of_measurement === 'string' ? ` ${entity.attributes.unit_of_measurement}` : '';
        const n = (0, stateHelper_1.parsePower)(entity.state);
        return `${n !== null ? Math.round(n * 100) / 100 : entity.state}${unit}`;
    }
    popupModel(nodeId) {
        const cfg = this.config;
        const node = (this.displayNodes.length ? this.displayNodes : cfg?.nodes ?? []).find((n) => n.id === nodeId);
        const reading = this.computed?.readings.get(nodeId);
        if (!cfg || !node || !reading)
            return undefined;
        const view = (0, NodeRenderer_1.describeNode)(node, reading, { powerFormat: cfg.powerFormat, language: this.language });
        const lang = this.language;
        const rows = [];
        if (reading.soc)
            rows.push({ label: (0, i18n_1.t)('soc', lang), value: view.socText ?? '?' });
        if (node.groupMembers?.length && !this.replayActive) {
            for (const memberId of node.groupMembers) {
                const member = cfg.nodes.find((n) => n.id === memberId);
                const memberReading = this.computed?.readings.get(memberId);
                if (!member)
                    continue;
                const value = memberReading?.watts === null || memberReading?.watts === undefined ? '?' : (0, stateHelper_1.formatPower)(memberReading.watts, cfg.powerFormat);
                rows.push({ label: member.name ?? member.id, value });
            }
        }
        if (!cfg.demo && !node.groupMembers?.length && !this.replayActive) {
            for (const field of (0, Node_1.advancedFieldsFor)(node.type)) {
                if (field === 'soc_entity')
                    continue;
                if (field === 'production_entity' && !node.config.power_entity)
                    continue;
                const id = node.config[field];
                if (typeof id === 'string' && id)
                    rows.push({ label: (0, i18n_1.t)((0, Node_1.fieldLabelKey)(field, node.type), lang), value: this.formatEntity(id) });
            }
            if (node.type === 'grid' && !node.config.phase_l1_power_entity) {
                const l1 = this.derivedLiveL1(node, reading.watts);
                if (l1 !== null)
                    rows.push({ label: (0, i18n_1.t)('phase_l1_power_calculated', lang), value: `${l1 < 0 ? '−' : ''}${(0, stateHelper_1.formatPower)(l1, cfg.powerFormat)}` });
            }
            for (const extra of node.config.entities ?? []) {
                const friendly = this._hass?.states[extra.entity]?.attributes.friendly_name;
                const label = extra.name ?? (typeof friendly === 'string' ? friendly : extra.entity);
                rows.push({ label, value: this.formatEntity(extra.entity) });
            }
        }
        if (node.type === 'grid' && cfg.pricing.mode !== 'none' && !this.replayActive) {
            const prices = (0, pricingHelper_1.readPrices)(cfg.pricing, cfg.demo ? undefined : this._hass);
            if (prices.importPrice !== null)
                rows.push({ label: (0, i18n_1.t)('current_import_price', lang), value: (0, pricingHelper_1.formatPrice)(prices.importPrice, cfg.pricing.currency, lang) });
            if (prices.exportPrice !== null)
                rows.push({ label: (0, i18n_1.t)('current_export_price', lang), value: (0, pricingHelper_1.formatPrice)(prices.exportPrice, cfg.pricing.currency, lang) });
            const rate = (0, pricingHelper_1.currentGridRate)(reading.watts, prices);
            if (rate.value !== null && rate.kind !== 'none') {
                rows.push({
                    label: (0, i18n_1.t)(rate.kind === 'cost' ? 'current_cost_rate' : 'current_revenue_rate', lang),
                    value: `${(0, pricingHelper_1.formatCurrency)(rate.value, cfg.pricing.currency, lang, 3)} ${(0, i18n_1.t)('per_hour', lang)}`,
                });
            }
            if (this.todayGridBalance?.value !== null && this.todayGridBalance?.value !== undefined) {
                rows.push({ label: (0, i18n_1.t)('revenue_today', lang), value: (0, pricingHelper_1.formatCurrency)(this.todayGridBalance.value, cfg.pricing.currency, lang, 2) });
            }
        }
        const powerEntity = node.config.power_entity ?? node.config.production_entity;
        const computedHome = node.role === 'home' && !node.config.power_entity;
        const history = cfg.demo || powerEntity || computedHome || node.type === 'backup' || !!node.groupMembers?.length
            ? (this.history.get(nodeId)?.state ?? { kind: 'loading' })
            : { kind: 'none' };
        if (history.kind === 'ready' && history.points.length > 0) {
            const peak = history.points.reduce((best, point) => Math.abs(point.v) > Math.abs(best.v) ? point : best, history.points[0]);
            const avg = history.points.reduce((sum, point) => sum + point.v, 0) / history.points.length;
            rows.unshift({ label: (0, i18n_1.t)('peak_power', lang), value: `${peak.v < 0 ? '−' : ''}${(0, stateHelper_1.formatPower)(peak.v, cfg.powerFormat)}` }, { label: (0, i18n_1.t)('peak_time', lang), value: new Date(peak.t).toLocaleTimeString(lang || undefined, { hour: '2-digit', minute: '2-digit' }) }, { label: (0, i18n_1.t)('average_power', lang), value: `${avg < 0 ? '−' : ''}${(0, stateHelper_1.formatPower)(avg, cfg.powerFormat)}` });
        }
        const phases = node.type === 'grid' ? this.phasePopupModel(node, history) : undefined;
        return {
            nodeType: node.type,
            title: view.displayName,
            subtitle: this.replayActive && this.replayTimestamp !== undefined ? `${(0, i18n_1.t)('replay_title', lang)} · ${new Date(this.replayTimestamp).toLocaleTimeString(lang || undefined, { hour: '2-digit', minute: '2-digit' })}` : view.subtitle,
            valueText: view.valueText,
            status: view.status,
            rows,
            history,
            phases,
            energyStats: node.role === 'home' && !this.replayActive ? this.energyStatsPopupModel() : undefined,
            diagnostics: this.diagnosticRows(node),
            note: node.groupMembers?.length ? `${(0, i18n_1.t)('group_total_of', lang)} ${node.groupMembers.length}` : node.role === 'home' ? (0, i18n_1.t)(computedHome ? 'home_computed' : 'home_measured', lang) : undefined,
            powerFormat: cfg.powerFormat,
            language: lang,
        };
    }
    formatKWh(value) {
        if (value === null || !Number.isFinite(value))
            return '—';
        return `${new Intl.NumberFormat(this.language || undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} kWh`;
    }
    formatPct(value) {
        if (value === null || !Number.isFinite(value))
            return '—';
        return `${new Intl.NumberFormat(this.language || undefined, { maximumFractionDigits: 0 }).format(value)} %`;
    }
    energyStatsPopupModel() {
        const cfg = this.config;
        const period = this.energyStatsPeriod;
        const cached = this.energyStats.get(period);
        const stats = cached?.value ?? null;
        const loading = this.energyStatsInFlight.has(period) || (!cached && !cfg.demo);
        const rows = [];
        if (stats) {
            rows.push({ label: (0, i18n_1.t)('stat_consumption', this.language), value: this.formatKWh(stats.consumptionKWh) }, { label: (0, i18n_1.t)('stat_import', this.language), value: this.formatKWh(stats.importKWh) }, { label: (0, i18n_1.t)('stat_export', this.language), value: this.formatKWh(stats.exportKWh) });
            if (stats.solarKWh !== null && stats.solarKWh > 0)
                rows.push({ label: (0, i18n_1.t)('stat_solar', this.language), value: this.formatKWh(stats.solarKWh) });
            if (cfg.pricing.mode !== 'none') {
                if (stats.importCost !== null)
                    rows.push({ label: (0, i18n_1.t)('stat_import_cost', this.language), value: (0, pricingHelper_1.formatCurrency)(stats.importCost, cfg.pricing.currency, this.language, 2) });
                if (stats.exportRevenue !== null)
                    rows.push({ label: (0, i18n_1.t)('stat_export_revenue', this.language), value: (0, pricingHelper_1.formatCurrency)(stats.exportRevenue, cfg.pricing.currency, this.language, 2) });
                if (stats.netCost !== null)
                    rows.push({ label: (0, i18n_1.t)('stat_net_cost', this.language), value: (0, pricingHelper_1.formatCurrency)(stats.netCost, cfg.pricing.currency, this.language, 2) });
            }
            if (stats.selfConsumptionPct !== null)
                rows.push({ label: (0, i18n_1.t)('stat_self_consumption', this.language), value: this.formatPct(stats.selfConsumptionPct) });
            if (stats.selfSufficiencyPct !== null)
                rows.push({ label: (0, i18n_1.t)('stat_self_sufficiency', this.language), value: this.formatPct(stats.selfSufficiencyPct) });
        }
        if (!cached && !cfg.demo)
            queueMicrotask(() => void this.ensureEnergyStats(period));
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
    async ensureEnergyStats(period) {
        const cfg = this.config;
        if (!cfg)
            return;
        const cached = this.energyStats.get(period);
        if (cached && Date.now() - cached.fetchedAt < HISTORY_TTL_MS)
            return;
        const existing = this.energyStatsInFlight.get(period);
        if (existing)
            return existing;
        const task = (async () => {
            const value = cfg.demo ? (0, energyStatsHelper_1.demoEnergyStats)(period) : this._hass ? await (0, energyStatsHelper_1.fetchEnergyStats)(this._hass, cfg, period, cfg.pricing) : null;
            this.energyStats.set(period, { value, fetchedAt: Date.now() });
            this.refreshOpenPopup('home');
        })();
        this.energyStatsInFlight.set(period, task);
        try {
            await task;
        }
        finally {
            if (this.energyStatsInFlight.get(period) === task)
                this.energyStatsInFlight.delete(period);
        }
    }
    diagnosticRows(node) {
        const report = this.computed?.diagnostics;
        if (!report)
            return undefined;
        const lang = this.language;
        const issues = node.groupMembers?.length
            ? node.groupMembers.flatMap((id) => report.byNode.get(id) ?? [])
            : [...(report.byNode.get(node.id) ?? [])];
        const rows = issues.map((item) => ({
            label: (0, i18n_1.t)(item.labelKey, lang),
            value: item.minutes !== undefined
                ? `${Math.round(item.minutes)} ${(0, i18n_1.t)('minutes_short', lang)}`
                : item.watts !== undefined
                    ? `${item.watts < 0 ? '−' : ''}${(0, stateHelper_1.formatPower)(item.watts, this.config.powerFormat)}`
                    : item.detail ?? (0, i18n_1.t)('diag_attention', lang),
        }));
        if (node.role === 'home' && report.unmeteredConsumptionWatts !== null) {
            const watts = report.unmeteredConsumptionWatts;
            rows.push({
                label: (0, i18n_1.t)(watts >= 0 ? 'diag_unmetered_consumption' : 'diag_consumers_over_home', lang),
                value: `${watts < 0 ? '−' : ''}${(0, stateHelper_1.formatPower)(watts, this.config.powerFormat)}`,
            });
        }
        const severity = (0, diagnosticsHelper_1.highestSeverity)(issues);
        if (rows.length === 0) {
            return { severity: 'ok', rows: [], message: (0, i18n_1.t)('diag_no_issues', lang) };
        }
        return { severity: severity ?? 'info', rows };
    }
    derivedL1Key(node) {
        return `__derived_l1__${node.id}`;
    }
    /** Live L1 fallback for meters (notably HomeWizard P1) that expose total + L2 + L3 only. */
    derivedLiveL1(node, totalWatts) {
        if (node.type !== 'grid' || node.config.phase_l1_power_entity)
            return null;
        const l2Id = node.config.phase_l2_power_entity;
        const l3Id = node.config.phase_l3_power_entity;
        if (!l2Id || !l3Id || !this._hass)
            return null;
        const read = (id) => {
            const entity = this._hass?.states[id];
            if (!entity || entity.state === 'unknown' || entity.state === 'unavailable')
                return null;
            const value = (0, stateHelper_1.parsePower)(entity.state, entity.attributes?.unit_of_measurement);
            if (value === null)
                return null;
            return node.invert ? -value : value;
        };
        return (0, phaseHelper_1.deriveL1Power)(totalWatts, read(l2Id), read(l3Id));
    }
    phasePopupModel(node, totalHistory) {
        const cfg = this.config;
        if (!cfg || node.type !== 'grid')
            return undefined;
        const ids = [
            node.config.phase_l1_power_entity,
            node.config.phase_l2_power_entity,
            node.config.phase_l3_power_entity,
        ];
        const hasConfiguredPhases = ids.some(Boolean);
        if (!cfg.demo && !hasConfiguredPhases)
            return undefined;
        const labels = ['L1', 'L2', 'L3'];
        const classes = ['phase-l1', 'phase-l2', 'phase-l3'];
        const demoSeries = cfg.demo && totalHistory.kind === 'ready'
            ? this.demoPhaseHistory(totalHistory)
            : undefined;
        const series = labels.map((label, index) => {
            const key = ids[index] ?? (index === 0 && ids[1] && ids[2] ? this.derivedL1Key(node) : undefined);
            return {
                label,
                cssClass: classes[index],
                history: demoSeries?.[index] ?? (key ? (this.phaseHistory.get(key) ?? { kind: 'loading' }) : { kind: 'none' }),
            };
        });
        return {
            enabled: this.phaseGraphEnabled.has(node.id),
            series,
            onToggle: (enabled) => {
                if (enabled)
                    this.phaseGraphEnabled.add(node.id);
                else
                    this.phaseGraphEnabled.delete(node.id);
                if (enabled && !cfg.demo)
                    void this.ensureHistoryBundle();
                this.refreshOpenPopup(node.id);
            },
        };
    }
    /** Demo-fasen zijn bewust niet exact gelijk verdeeld, zodat de 3-lijnsgrafiek zichtbaar te testen is. */
    demoPhaseHistory(total) {
        const factors = [0.38, 0.33, 0.29];
        return factors.map((factor, phase) => ({
            kind: 'ready',
            start: total.start,
            end: total.end,
            points: total.points.map((point, index) => ({
                t: point.t,
                v: point.v * factor * (1 + 0.12 * Math.sin(index / 7 + phase * 1.9)),
            })),
        }));
    }
    async ensureTodayGridBalance() {
        const cfg = this.config;
        if (!cfg || cfg.pricing.mode === 'none')
            return;
        if (this.todayGridBalance && Date.now() - this.todayGridBalance.fetchedAt < HISTORY_TTL_MS)
            return;
        if (this.todayGridBalanceInFlight)
            return this.todayGridBalanceInFlight;
        const grid = cfg.nodes.find((n) => n.type === 'grid');
        if (!grid)
            return;
        const importEnergyEntity = grid.config.energy_import_entity;
        const exportEnergyEntity = grid.config.energy_export_entity;
        if (!cfg.demo && !importEnergyEntity && !exportEnergyEntity)
            return;
        const task = (async () => {
            const result = cfg.demo
                ? { balance: -2.18 }
                : this._hass
                    ? await (0, pricingHelper_1.fetchTodayGridFinancials)(this._hass, importEnergyEntity, exportEnergyEntity, cfg.pricing)
                    : null;
            this.todayGridBalance = { value: result?.balance ?? null, fetchedAt: Date.now() };
            this.refreshOpenPopup(grid.id);
        })();
        this.todayGridBalanceInFlight = task;
        try {
            await task;
        }
        finally {
            if (this.todayGridBalanceInFlight === task)
                this.todayGridBalanceInFlight = undefined;
        }
    }
    async ensureHistory(nodeId) {
        const cfg = this.config;
        const node = (this.displayNodes.length ? this.displayNodes : cfg?.nodes ?? []).find((n) => n.id === nodeId);
        if (!cfg || !node)
            return;
        const cached = this.history.get(nodeId);
        if (cached && Date.now() - cached.fetchedAt < HISTORY_TTL_MS)
            return;
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
    async ensureHistoryBundle() {
        const cfg = this.config;
        if (!cfg || cfg.demo || !this._hass?.callApi)
            return;
        if (this.historyBundleFetchedAt && Date.now() - this.historyBundleFetchedAt < HISTORY_TTL_MS)
            return;
        if (this.historyBundleInFlight)
            return this.historyBundleInFlight;
        const task = this.loadHistoryBundle();
        this.historyBundleInFlight = task;
        try {
            await task;
        }
        finally {
            if (this.historyBundleInFlight === task)
                this.historyBundleInFlight = undefined;
        }
    }
    historyEntityIds() {
        const cfg = this.config;
        if (!cfg)
            return [];
        const ids = new Set();
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
                if (typeof id === 'string' && id)
                    ids.add(id);
            }
        }
        for (const conn of cfg.connections)
            if (conn.entity)
                ids.add(conn.entity);
        return [...ids];
    }
    async loadHistoryBundle() {
        const cfg = this.config;
        const hass = this._hass;
        if (!cfg || !hass?.callApi)
            return;
        const entityIds = this.historyEntityIds();
        if (entityIds.length === 0) {
            for (const node of (this.displayNodes.length ? this.displayNodes : cfg.nodes))
                this.storeHistory(node, { kind: 'none' });
            this.historyBundleFetchedAt = Date.now();
            return;
        }
        try {
            const end = Date.now();
            const start = end - HISTORY_HOURS * 3_600_000;
            const raw = await (0, historyHelper_1.fetchHistoryBatch)(hass, entityIds, HISTORY_HOURS, end);
            const series = new Map();
            const timeline = Array.from({ length: HISTORY_BUCKETS }, (_, i) => start + ((end - start) * i) / (HISTORY_BUCKETS - 1));
            for (const id of entityIds) {
                const points = (0, historyHelper_1.bucketize)(raw.get(id) ?? [], start, end, HISTORY_BUCKETS);
                series.set(id, new Map(points.map((p) => [p.t, p.v])));
            }
            // Bewaar de drie netfasen apart. De normale node-history blijft het totale netvermogen tonen;
            // de popup kan optioneel naar deze drie losse reeksen omschakelen.
            const grid = cfg.nodes.find((n) => n.type === 'grid');
            if (grid) {
                for (const id of [grid.config.phase_l1_power_entity, grid.config.phase_l2_power_entity, grid.config.phase_l3_power_entity]) {
                    if (!id)
                        continue;
                    let points = (0, historyHelper_1.bucketize)(raw.get(id) ?? [], start, end, HISTORY_BUCKETS);
                    if (grid.invert)
                        points = points.map((point) => ({ ...point, v: -point.v }));
                    this.phaseHistory.set(id, points.length >= 2 ? { kind: 'ready', points, start, end } : { kind: 'none' });
                }
            }
            const historyNodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
            const perNode = new Map(historyNodes.map((n) => [n.id, []]));
            for (const time of timeline) {
                const states = {};
                for (const id of entityIds) {
                    const value = series.get(id)?.get(time);
                    if (value === undefined)
                        continue;
                    states[id] = { state: String(value), attributes: { unit_of_measurement: 'W' } };
                }
                const historicalHass = { states, language: hass.language, locale: hass.locale };
                const readings = new Map();
                for (const node of cfg.nodes)
                    if (node.role !== 'home')
                        readings.set(node.id, (0, flowHelper_1.readNode)(node, historicalHass));
                (0, flowHelper_1.applyBackupReadings)(cfg.nodes, cfg.connections, readings, false);
                const flows = (0, flowHelper_1.computeFlows)(cfg.nodes, cfg.connections, readings, historicalHass);
                const home = cfg.nodes.find((n) => n.role === 'home');
                if (home) {
                    const measured = !!home.config.power_entity;
                    readings.set(home.id, measured ? (0, flowHelper_1.readNode)(home, historicalHass) : (0, flowHelper_1.computeHomeReading)(home, cfg.nodes, cfg.connections, flows));
                }
                (0, groupHelper_1.applyGroupReadings)(cfg.groups, this.groupNodes, readings);
                for (const node of historyNodes) {
                    const watts = readings.get(node.id)?.watts;
                    if (typeof watts === 'number')
                        perNode.get(node.id)?.push({ t: time, v: watts });
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
                    const points = (0, phaseHelper_1.deriveL1History)(total.points, l2.points, l3.points);
                    this.phaseHistory.set(this.derivedL1Key(grid), points.length >= 2 ? { kind: 'ready', points, start, end } : { kind: 'none' });
                }
                else {
                    this.phaseHistory.set(this.derivedL1Key(grid), { kind: 'none' });
                }
            }
            this.historyBundleFetchedAt = fetchedAt;
        }
        catch {
            const fetchedAt = Date.now();
            for (const node of cfg.nodes)
                if (!this.history.has(node.id))
                    this.storeHistory(node, { kind: 'none' }, fetchedAt);
            const grid = cfg.nodes.find((n) => n.type === 'grid');
            if (grid)
                for (const id of [grid.config.phase_l1_power_entity, grid.config.phase_l2_power_entity, grid.config.phase_l3_power_entity]) {
                    if (id)
                        this.phaseHistory.set(id, { kind: 'none' });
                }
            if (grid && !grid.config.phase_l1_power_entity && grid.config.phase_l2_power_entity && grid.config.phase_l3_power_entity)
                this.phaseHistory.set(this.derivedL1Key(grid), { kind: 'none' });
            this.historyBundleFetchedAt = fetchedAt;
            if (grid)
                this.refreshOpenPopup(grid.id);
        }
    }
    storeHistory(node, state, fetchedAt = Date.now()) {
        this.history.set(node.id, { state, fetchedAt });
        this.writeHistorySession(node, state, fetchedAt);
        this.updateReplayControls();
        this.refreshOpenPopup(node.id);
    }
    refreshOpenPopup(nodeId) {
        if (this.openNodeId !== nodeId || !this.popup.isOpen)
            return;
        const model = this.popupModel(nodeId);
        if (model)
            this.popup.update(model);
    }
    /**
     * Start de gezamenlijke historie direct op de achtergrond zodra de kaart zichtbaar is.
     * Home Assistant zet `hass` zeer vaak opnieuw (bij iedere state-update). Daarom mag een
     * geplande preload hier niet telkens worden geannuleerd en opnieuw gestart: bij snel
     * wijzigende vermogenssensoren zou de history-call anders eindeloos uitgesteld worden.
     */
    scheduleHistoryPreload() {
        const cfg = this.config;
        if (!cfg || cfg.demo || !this.isConnected || !this._hass?.callApi || document.hidden)
            return;
        if (this.preloadTimer !== undefined || this.historyBundleInFlight)
            return;
        if (this.historyBundleFetchedAt && Date.now() - this.historyBundleFetchedAt < HISTORY_TTL_MS)
            return;
        // Vul eerst alle nog geldige sessiecaches terug. Daardoor zijn popups na een dashboard-
        // navigatie of refresh direct bruikbaar, terwijl een eventuele netwerkrefresh parallel volgt.
        this.restoreHistorySessionCache();
        this.preloadTimer = window.setTimeout(() => {
            this.preloadTimer = undefined;
            void this.ensureHistoryBundle();
        }, HISTORY_PRELOAD_DELAY_MS);
    }
    /** Herstelt in één keer de bestaande 5-minuten-cache voor alle nodes. */
    restoreHistorySessionCache() {
        const cfg = this.config;
        if (!cfg)
            return;
        const nodes = [...cfg.nodes, ...this.groupNodes.values()];
        for (const node of nodes) {
            const current = this.history.get(node.id);
            if (current && Date.now() - current.fetchedAt < HISTORY_TTL_MS)
                continue;
            const restored = this.readHistorySession(node);
            if (restored)
                this.history.set(node.id, restored);
        }
    }
    cancelHistoryPreload() {
        if (this.preloadTimer !== undefined) {
            window.clearTimeout(this.preloadTimer);
            this.preloadTimer = undefined;
        }
    }
    historySessionKey(node) {
        const entityId = node.config.power_entity ?? node.config.production_entity;
        if (entityId)
            return `${HISTORY_SESSION_PREFIX}${entityId}|${node.invert ? '1' : '0'}`;
        // Berekende nodes (zoals Woning of een ongemeten backup) zijn afhankelijk van de hele flow-config.
        // Een compacte configuratiesignatuur voorkomt dat een oude cache bij een andere setup wordt hergebruikt.
        const cfg = this.config;
        if (!cfg)
            return undefined;
        const signature = cfg.nodes
            .map((n) => [n.id, n.config.power_entity, n.config.production_entity, n.config.charge_power_entity, n.config.discharge_power_entity, n.invert])
            .concat(cfg.connections.map((c) => [c.id, c.from, c.to, c.entity, c.invert]))
            .concat(cfg.groups.map((g) => [g.id, g.display, g.name, g.icon, ...g.memberIds]))
            .map((x) => x.join(':'))
            .join('|');
        let hash = 2166136261;
        for (let i = 0; i < signature.length; i++)
            hash = Math.imul(hash ^ signature.charCodeAt(i), 16777619);
        return `${HISTORY_SESSION_PREFIX}computed:${node.id}:${(hash >>> 0).toString(36)}`;
    }
    readHistorySession(node) {
        const key = this.historySessionKey(node);
        if (!key)
            return undefined;
        try {
            const raw = window.sessionStorage?.getItem(key);
            if (!raw)
                return undefined;
            const parsed = JSON.parse(raw);
            if (!parsed.state || typeof parsed.fetchedAt !== 'number' || Date.now() - parsed.fetchedAt >= HISTORY_TTL_MS) {
                window.sessionStorage?.removeItem(key);
                return undefined;
            }
            return { state: parsed.state, fetchedAt: parsed.fetchedAt };
        }
        catch {
            return undefined;
        }
    }
    writeHistorySession(node, state, fetchedAt) {
        if (state.kind !== 'ready')
            return;
        const key = this.historySessionKey(node);
        if (!key)
            return;
        try {
            window.sessionStorage?.setItem(key, JSON.stringify({ state, fetchedAt }));
        }
        catch {
            // Opslag kan uitgeschakeld of vol zijn; de geheugen-cache blijft dan gewoon werken.
        }
    }
    /**
     * Demo-history wordt in één batch opgebouwd met exact dezelfde tijdas voor alle zichtbare nodes.
     * Dit voorkomt dat de replay-range leeg raakt doordat afzonderlijk opgebouwde demo-series net
     * verschillende start-/eindtijden hebben. Dezelfde batch voedt ook de gewone popup-grafieken.
     */
    loadDemoHistoryBundle() {
        const cfg = this.config;
        if (!cfg?.demo)
            return;
        const nodes = this.displayNodes.length ? this.displayNodes : cfg.nodes;
        const now = Date.now();
        const span = 24 * 3_600_000;
        const start = now - span;
        const nowT = DEMO_OFFSET_S + (performance.now() - this.demoStart) / 1000;
        const samples = 96;
        const perNode = new Map(nodes.map((node) => [node.id, []]));
        const home = cfg.nodes.find((node) => node.role === 'home');
        for (let i = 0; i < samples; i++) {
            const tSeconds = nowT - 240 + (240 * i) / (samples - 1);
            const timestamp = start + (span * i) / (samples - 1);
            const readings = (0, DemoEngine_1.demoReadings)(cfg.nodes, tSeconds);
            (0, flowHelper_1.applyBackupReadings)(cfg.nodes, cfg.connections, readings, true);
            const sourceFlows = (0, flowHelper_1.computeFlows)(cfg.nodes, cfg.connections, readings, undefined, { ignoreEntities: true });
            if (home)
                readings.set(home.id, (0, flowHelper_1.computeHomeReading)(home, cfg.nodes, cfg.connections, sourceFlows));
            (0, groupHelper_1.applyGroupReadings)(cfg.groups, this.groupNodes, readings);
            for (const node of nodes) {
                const watts = readings.get(node.id)?.watts;
                if (typeof watts === 'number')
                    perNode.get(node.id)?.push({ t: timestamp, v: watts });
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
exports.EnergyFlowCard = EnergyFlowCard;
/** Namen boven Home komen boven de node; in de rechte layout staan Home en backup (lijnen boven en onder) ernaast. */
function labelPositionFor(node, y, homeY, straight) {
    if (straight && (node.role === 'home' || node.type === 'backup'))
        return 'side';
    return y < homeY - 1 ? 'above' : 'below';
}

};
__mods["src/card/styles"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.styles = void 0;
/**
 * Alle kleuren zijn CSS-variabelen met een standaardwaarde, zodat thema's ze kunnen
 * overschrijven: --efc-solar, --efc-grid, --efc-battery, --efc-home, --efc-ev,
 * --efc-generator, --efc-producer, --efc-consumer en --efc-node-bg.
 */
exports.styles = `
:host { display: block; }

ha-card {
  display: block;
  position: relative;
  overflow: hidden;
  color: var(--primary-text-color, #212121);
}
ha-card.fallback {
  background: var(--ha-card-background, var(--card-background-color, #fff));
  border-radius: var(--ha-card-border-radius, 12px);
  border: 1px solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
  font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
}

.title { padding: 16px 16px 0; font-size: 16px; font-weight: 500; }
.stage { position: relative; padding: 10px 12px 18px; min-height: 0; }
.flow { display: block; width: 100%; max-width: 860px; height: auto; margin: 0 auto; }

.badge {
  position: absolute; top: 10px; left: 12px; z-index: 1;
  padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 500;
  color: var(--secondary-text-color, #727272);
  border: 1px solid var(--divider-color, #e0e0e0);
}

.price-panel {
  position: absolute; top: 10px; right: 12px; z-index: 1;
  display: grid; grid-template-columns: auto 1px auto; align-items: stretch; gap: 9px;
  padding: 6px 10px; border-radius: 12px;
  color: var(--primary-text-color, #212121);
  border: 1px solid var(--divider-color, #e0e0e0);
  background: color-mix(in srgb, var(--card-background-color, #fff) 92%, transparent);
  -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
}
.price-item { display: flex; flex-direction: column; min-width: 68px; gap: 1px; line-height: 1.15; }
.price-label {
  color: var(--secondary-text-color, #727272); font-size: 9px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .035em;
}
.price-value { font-size: 11px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.price-divider { width: 1px; background: var(--divider-color, #e0e0e0); }

@media (max-width: 430px) {
  .price-panel { gap: 7px; padding: 5px 8px; }
  .price-item { min-width: 58px; }
  .price-label { font-size: 8px; }
  .price-value { font-size: 10px; }
}

.empty { padding: 32px 24px; text-align: center; }
.empty strong { display: block; font-size: 15px; margin-bottom: 6px; }
.empty span { color: var(--secondary-text-color, #727272); font-size: 14px; line-height: 1.4; }

/* Kleuren per type */
.type-solar { --c: var(--efc-solar, #f0a202); }
.type-grid { --c: var(--efc-grid, #5a78d1); }
.type-battery { --c: var(--efc-battery, #33b07a); }
.type-home { --c: var(--efc-home, var(--secondary-text-color, #727272)); }
.type-ev_charger { --c: var(--efc-ev, #9a6fd6); }
.type-backup { --c: var(--efc-backup, #c95a8a); }
.type-generator { --c: var(--efc-generator, #cf6a4e); }
.type-producer { --c: var(--efc-producer, #b5a220); }
.type-consumer, .type-heat_pump, .type-boiler, .type-airco { --c: var(--efc-consumer, #2fa4b8); }

/* Verbindingen */
.line { stroke: var(--c); stroke-linecap: round; opacity: 0.28; }
.connection[data-flow="flowing"] .line { opacity: 0.55; }
.connection[data-flow="unknown"] .line { stroke-dasharray: 2 7; opacity: 0.4; }
.particle { fill: var(--c); }
.chevron { stroke: var(--c); stroke-linecap: round; stroke-linejoin: round; display: none; }
.connection[data-flow="flowing"][data-animated="false"] .chevron { display: block; }

/* Nodes */
.node { cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
.ring {
  fill: var(--efc-node-bg, var(--card-background-color, #fff));
  stroke: var(--c); stroke-width: 2.4;
}
.halo { fill: none; stroke: var(--c); stroke-width: 1.5; opacity: 0; transition: opacity 0.3s; }
.node[data-status="valid"] .halo, .node[data-status="charging"] .halo { opacity: 0.28; }
.node:hover .halo { opacity: 0.5; }
.node:focus-visible .halo { opacity: 0.9; stroke-width: 2.5; }
.glyph { stroke: var(--c); color: var(--c); }

.value {
  fill: var(--primary-text-color, #212121);
  font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums;
}
.soc { fill: var(--primary-text-color, #212121); font-size: 13px; font-weight: 600; }
.name-in { fill: var(--primary-text-color, #212121); font-size: 12px; font-weight: 600; }
.label { fill: var(--primary-text-color, #212121); font-size: 13px; font-weight: 500; }
.label, .sub {
  paint-order: stroke; stroke-linejoin: round; stroke-width: 5px;
  stroke: var(--ha-card-background, var(--card-background-color, #fff));
}
.sub { fill: var(--secondary-text-color, #727272); font-size: 11px; }

/* Flow-weergave: lijnen zijn de hoofdzaak, nodes blijven rustig en compact. */
.layout-flow .line { opacity: 0.38; }
.layout-flow .connection[data-flow="flowing"] .line { opacity: 0.72; }
.layout-flow .halo { stroke-width: 1; }
.layout-flow .node[data-status="valid"] .halo,
.layout-flow .node[data-status="charging"] .halo { opacity: 0.12; }

.node[data-status="zero"] .value { fill: var(--secondary-text-color, #727272); font-weight: 500; }
.node[data-status="invalid"], .node[data-status="unknown"] { opacity: 0.72; }
.node[data-status="invalid"] .ring, .node[data-status="unknown"] .ring {
  stroke: var(--disabled-text-color, #9e9e9e); stroke-dasharray: 5 5;
}
.node[data-status="unavailable"] .ring { stroke: var(--error-color, #db4437); stroke-dasharray: 5 5; }
.node[data-status="unavailable"] .value { fill: var(--error-color, #db4437); font-size: 24px; }

.charging { display: none; }
.node[data-status="charging"] .charging { display: block; }
.charging circle { fill: var(--c); }
.bolt { fill: var(--card-background-color, #fff); }
.diagnostic-badge circle { fill: var(--warning-color, #f9a825); stroke: var(--card-background-color, #fff); stroke-width: 1.5; }
.diagnostic-badge[data-severity="error"] circle { fill: var(--error-color, #db4437); }
.diagnostic-badge text { fill: #fff; font-size: 12px; font-weight: 800; stroke: none; }

/* Detailweergave */
.popup {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center; padding: 16px;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--card-background-color, #fff) 58%, transparent);
  -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px);
}
.popup[hidden] { display: none; }
.popup-panel {
  width: min(calc(100vw - 32px), 500px); max-height: calc(100vh - 32px); overflow: auto;
  background: var(--card-background-color, #fff);
  border: 1px solid var(--divider-color, #e0e0e0); border-top: 4px solid var(--c);
  border-radius: 16px; padding: 16px 18px 18px; box-sizing: border-box;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
}
.popup-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.popup-title { margin: 0; font-size: 17px; font-weight: 600; }
.popup-close {
  border: 0; background: transparent; color: var(--secondary-text-color, #727272);
  font-size: 26px; line-height: 1; width: 36px; height: 36px; border-radius: 50%; cursor: pointer;
}
.popup-close:hover { background: var(--secondary-background-color, #f0f0f0); }
.popup-close:focus-visible { outline: 2px solid var(--c); }
.popup-big { display: flex; align-items: baseline; gap: 10px; margin: 6px 0 4px; flex-wrap: wrap; }
.popup-value { font-size: 32px; font-weight: 600; font-variant-numeric: tabular-nums; }
.popup-panel[data-status="unavailable"] .popup-value { color: var(--error-color, #db4437); }
.popup-label { color: var(--secondary-text-color, #727272); font-size: 14px; }
.popup-section h3 { margin: 12px 0 2px; font-size: 13px; font-weight: 500; color: var(--secondary-text-color, #727272); }
.graph { display: block; width: 100%; height: auto; }
.graph .trace { stroke: var(--c); stroke-width: 1.8; stroke-linejoin: round; }
.graph .area { fill: var(--c); opacity: 0.14; }
.graph .zero { stroke: var(--divider-color, #cfcfcf); stroke-dasharray: 3 3; }
.graph .axis { fill: var(--secondary-text-color, #727272); font-size: 10.5px; }
.interactive-graph { touch-action: none; cursor: crosshair; overscroll-behavior: contain; }
.inspect-hit { pointer-events: all; cursor: crosshair; outline: none; }
.inspect-marker { stroke: var(--primary-text-color, #fff); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.7; pointer-events: none; }
.inspect-dot { fill: var(--c); stroke: var(--card-background-color, #111); stroke-width: 1.5; pointer-events: none; }
.inspect-dot.phase-1 { fill: var(--efc-phase-l1, #42a5f5); }
.inspect-dot.phase-2 { fill: var(--efc-phase-l2, #ffb300); }
.inspect-dot.phase-3 { fill: var(--efc-phase-l3, #ab47bc); }
.inspect-tooltip { pointer-events: none; }
.inspect-tooltip rect { fill: color-mix(in srgb, var(--card-background-color, #111) 94%, var(--primary-text-color, #fff) 6%); stroke: var(--divider-color, #555); stroke-width: 0.8; }
.inspect-text { fill: var(--primary-text-color, #fff); font-size: 9px; font-weight: 600; font-variant-numeric: tabular-nums; }
.inspect-time { fill: var(--secondary-text-color, #aaa); font-weight: 500; }
.phase-trace { stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.phase-l1 { --phase-c: var(--efc-phase-l1, #42a5f5); }
.phase-l2 { --phase-c: var(--efc-phase-l2, #ffb300); }
.phase-l3 { --phase-c: var(--efc-phase-l3, #ab47bc); }
.phase-trace.phase-l1, .phase-trace.phase-l2, .phase-trace.phase-l3 { stroke: var(--phase-c); }
.phase-legend { display: flex; gap: 16px; align-items: center; justify-content: center; margin-top: 4px; font-size: 12px; color: var(--secondary-text-color, #727272); }
.phase-key { display: inline-flex; align-items: center; gap: 6px; }
.phase-key i { width: 16px; height: 3px; border-radius: 99px; background: var(--phase-c); display: inline-block; }
.phase-toggle { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; align-items: center; margin-top: 10px; cursor: pointer; }
.phase-toggle input { width: 18px; height: 18px; grid-row: 1 / span 2; }
.phase-toggle span { font-size: 14px; color: var(--primary-text-color); }
.phase-toggle small { font-size: 12px; color: var(--secondary-text-color, #727272); }
.popup-empty { padding: 22px 0; text-align: center; color: var(--secondary-text-color, #727272); font-size: 14px; }
.popup-rows { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; margin: 12px 0 0; font-size: 14px; }
.popup-rows dt { color: var(--secondary-text-color, #727272); }
.popup-rows dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.popup-note { margin: 12px 0 0; font-size: 13px; color: var(--secondary-text-color, #727272); }
.diagnostics { margin-top: 14px; padding: 11px 12px; border: 1px solid var(--divider-color, #e0e0e0); border-radius: 10px; background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 65%, transparent); }
.diagnostics-head { display: flex; align-items: center; gap: 7px; }
.diagnostics-head h3 { margin: 0; font-size: 13px; font-weight: 600; }
.diagnostics-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success-color, #43a047); flex: 0 0 auto; }
.diagnostics-warning .diagnostics-dot { background: var(--warning-color, #f9a825); }
.diagnostics-error .diagnostics-dot { background: var(--error-color, #db4437); }
.diagnostics-info .diagnostics-dot { background: var(--info-color, #039be5); }
.diagnostics-message { margin: 7px 0 0; font-size: 13px; color: var(--secondary-text-color, #727272); }
.diagnostics-rows { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; margin: 8px 0 0; font-size: 13px; }
.diagnostics-rows dt { color: var(--secondary-text-color, #727272); }
.diagnostics-rows dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }

.replay-controls {
  margin: 0 12px 10px; padding: 4px 8px;
  border: 1px solid var(--divider-color, #e0e0e0); border-radius: 9px;
  background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 42%, transparent);
}
.replay-controls.active { border-color: color-mix(in srgb, var(--primary-color, #03a9f4) 70%, var(--divider-color, #e0e0e0)); }
.replay-row { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 7px; min-height: 22px; }
.replay-controls.active .replay-row { grid-template-columns: auto minmax(70px, 1fr) auto; }
.replay-label { grid-column: 1; font-size: 11px; font-weight: 600; color: var(--secondary-text-color, #727272); white-space: nowrap; }
.replay-controls.active .replay-label { display: none; }
.replay-time { grid-column: 1; font-size: 10px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.replay-slider { grid-column: 2; width: 100%; min-width: 70px; height: 16px; margin: 0; accent-color: var(--primary-color, #03a9f4); }
.replay-controls.active .replay-slider { grid-column: 2; }
.replay-live { grid-column: 3; border: 0; border-radius: 999px; padding: 3px 8px; cursor: pointer; font: inherit; font-size: 10px; font-weight: 700; background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); white-space: nowrap; }
.replay-live[hidden], .replay-time[hidden], .replay-status[hidden] { display: none !important; }
.replay-status { display: block; margin-top: 1px; color: var(--secondary-text-color, #727272); font-size: 9px; line-height: 1.2; }

.mobile-focus-nav {
  display: flex; align-items: center; gap: 7px; margin: 38px 4px 4px;
  min-width: 0; color: var(--secondary-text-color, #727272);
}
.mobile-focus-back {
  width: 28px; height: 28px; flex: 0 0 28px; border-radius: 50%; border: 1px solid var(--divider-color, #e0e0e0);
  background: color-mix(in srgb, var(--card-background-color, #fff) 90%, transparent); color: var(--primary-text-color, #212121);
  font: inherit; font-size: 21px; line-height: 1; cursor: pointer;
}
.mobile-focus-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 600; }


.energy-stats {
  margin-top: 14px; padding: 12px; border-radius: 12px;
  border: 1px solid var(--divider-color, #ddd);
  background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 42%, transparent);
}
.energy-stats > h3 { margin: 0 0 10px; font-size: 13px; }
.energy-stats-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 10px; }
.energy-stats-tab {
  border: 1px solid var(--divider-color, #ddd); border-radius: 999px; padding: 6px 8px;
  background: transparent; color: var(--primary-text-color, #212121); font: inherit; font-size: 12px; cursor: pointer;
}
.energy-stats-tab.active { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); border-color: var(--primary-color, #03a9f4); }
.energy-stats-rows { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 7px 14px; margin: 0; font-size: 13px; }
.energy-stats-rows dt { color: var(--secondary-text-color, #727272); }
.energy-stats-rows dd { margin: 0; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.energy-stats-loading { color: var(--secondary-text-color, #727272); font-size: 12px; padding: 5px 0 2px; }

@media (max-width: 600px) {
  .stage { min-height: 0; padding-inline: 6px; }
  .popup { padding: 8px; }
  .popup-panel { width: calc(100vw - 16px); max-height: calc(100vh - 16px); border-radius: 12px; padding: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .halo { transition: none; }
}
`;

};
__mods["src/config/CardConfig"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigError = void 0;
exports.normalizeConfig = normalizeConfig;
const Connection_1 = __req("src/models/Connection");
const Node_1 = __req("src/models/Node");
const NodeType_1 = __req("src/types/NodeType");
class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}
exports.ConfigError = ConfigError;
/** Nodes voor de demo-modus als de gebruiker zelf geen nodes opgeeft. */
const DEMO_NODES = [
    { name: 'Net', type: 'grid' },
    { name: 'Zonnepanelen', type: 'solar' },
    { name: 'Batterij', type: 'battery' },
    { name: 'Laadpaal', type: 'ev_charger' },
    { name: 'Warmtepomp', type: 'heat_pump' },
    { name: 'Bureau', type: 'consumer' },
    { name: 'Computer', type: 'consumer', connected_to: 'Bureau' },
    { name: '3D-printer', type: 'consumer', connected_to: 'Bureau' },
    { name: 'Backup', type: 'backup' },
    { name: 'Server', type: 'consumer', connected_to: 'Backup' },
];
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function positiveNumber(value, fallback, key) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new ConfigError(`"${key}" moet een getal groter dan 0 zijn.`);
    }
    return value;
}
/** Controleert de YAML-configuratie en maakt er Nodes, Connections en Layout van. Gooit een ConfigError bij fouten. */
function normalizeConfig(raw) {
    if (!isRecord(raw))
        throw new ConfigError('De configuratie is leeg of ongeldig.');
    const demo = raw.demo === true;
    const rawNodes = raw.nodes;
    if (rawNodes !== undefined && rawNodes !== null && !Array.isArray(rawNodes)) {
        throw new ConfigError('"nodes" moet een lijst zijn.');
    }
    const list = Array.isArray(rawNodes) ? rawNodes : [];
    const nodeInput = demo && list.length === 0 ? DEMO_NODES : list;
    const nodes = parseNodes(nodeInput);
    const homePower = typeof raw.home_power_entity === 'string' ? raw.home_power_entity.trim() : '';
    if (homePower) {
        const home = nodes.find((n) => n.role === 'home');
        if (home)
            home.config.power_entity = homePower;
    }
    checkConnectedTo(nodes);
    const connections = parseConnections(raw.connections, nodes);
    const groups = parseGroups(raw.groups, nodes, connections);
    const layout = parseLayout(raw.layout);
    const pricing = parsePricing(raw.pricing ?? (demo ? { mode: 'fixed', import_price: 0.31, export_price: 0.09 } : undefined));
    const colors = parseColors(raw.colors);
    const powerFormat = (raw.power_format ?? 'w');
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
        groups,
        connections,
        layout,
        pricing,
        colors,
    };
}
function parseColors(raw) {
    if (raw === undefined || raw === null)
        return {};
    if (!isRecord(raw))
        throw new ConfigError('"colors" moet een object zijn.');
    const result = {};
    const keys = ['solar', 'grid', 'battery', 'home', 'consumer', 'ev', 'backup', 'generator', 'producer'];
    for (const key of keys) {
        const value = raw[key];
        if (value === undefined || value === null || value === '')
            continue;
        if (typeof value !== 'string' || !value.trim())
            throw new ConfigError(`"colors.${key}" moet een CSS-kleur zijn.`);
        result[key] = value.trim();
    }
    return result;
}
function optionalPrice(value, key) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new ConfigError(`"${key}" moet een getal van 0 of hoger zijn.`);
    }
    return value;
}
function parsePricing(raw) {
    if (raw === undefined || raw === null)
        return { mode: 'none', currency: 'EUR' };
    if (!isRecord(raw))
        throw new ConfigError('"pricing" moet een object zijn.');
    const rawMode = typeof raw.mode === 'string' ? raw.mode : 'none';
    const normalizedMode = rawMode === 'dynamic' ? 'entities' : rawMode;
    if (!['none', 'fixed', 'entities'].includes(normalizedMode)) {
        throw new ConfigError('"pricing.mode" moet "none", "fixed" of "entities" zijn.');
    }
    const currency = typeof raw.currency === 'string' && raw.currency.trim() ? raw.currency.trim().toUpperCase() : 'EUR';
    const importPriceEntity = typeof raw.import_price_entity === 'string' && raw.import_price_entity.trim() ? raw.import_price_entity.trim() : undefined;
    const exportPriceEntity = typeof raw.export_price_entity === 'string' && raw.export_price_entity.trim() ? raw.export_price_entity.trim() : undefined;
    return {
        mode: normalizedMode,
        currency,
        importPrice: optionalPrice(raw.import_price, 'pricing.import_price'),
        exportPrice: optionalPrice(raw.export_price, 'pricing.export_price'),
        importPriceEntity,
        exportPriceEntity,
    };
}
function parseNodes(raw) {
    const parsed = [];
    raw.forEach((item, index) => {
        if (!isRecord(item))
            throw new ConfigError(`Node ${index + 1} is geen geldig object.`);
        const type = (0, NodeType_1.normalizeType)(item.type);
        if (!type) {
            const shown = typeof item.type === 'string' ? `"${item.type}"` : 'ontbreekt';
            throw new ConfigError(`Node ${index + 1}: het type ${shown} is onbekend. Kies uit: ${NodeType_1.NODE_TYPES.join(', ')}.`);
        }
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (type !== 'home' && !name)
            throw new ConfigError(`Node ${index + 1} (${type}) heeft een "name" nodig.`);
        parsed.push({ config: item, type });
    });
    // Iedere configuratie heeft precies één Home-node; die wordt automatisch aangemaakt.
    if (parsed.filter((p) => p.type === 'home').length > 1)
        throw new ConfigError('Er mag maar één Home-node zijn.');
    if (!parsed.some((p) => p.type === 'home'))
        parsed.unshift({ config: { type: 'home' }, type: 'home' });
    // De gebruiker hoeft geen id te kiezen; expliciete id's gaan voor en moeten uniek zijn.
    const taken = new Set(['home']);
    const explicit = parsed.map((p) => {
        if (p.type === 'home')
            return 'home';
        const id = typeof p.config.id === 'string' ? p.config.id.trim() : '';
        if (!id)
            return undefined;
        if (taken.has(id))
            throw new ConfigError(`De id "${id}" wordt meer dan één keer gebruikt.`);
        taken.add(id);
        return id;
    });
    return parsed.map((p, index) => {
        const id = explicit[index] ?? (0, Node_1.generateId)(p.config.name ?? p.type, taken);
        taken.add(id);
        return (0, Node_1.createNode)(p.config, p.type, id);
    });
}
/** `connected_to` mag alleen bij een verbruiker en kan naar Home, een backup of een andere verbruiker verwijzen. */
function checkConnectedTo(nodes) {
    const parentOf = (node) => {
        const ref = node.config.connected_to;
        if (typeof ref !== 'string' || !ref.trim())
            return nodes.find((n) => n.role === 'home');
        return findNode(nodes, ref);
    };
    for (const node of nodes) {
        const ref = node.config.connected_to;
        if (ref === undefined)
            continue;
        const label = node.name ?? node.id;
        if (typeof ref !== 'string' || !ref.trim())
            throw new ConfigError(`Node "${label}": "connected_to" moet een naam of id zijn.`);
        if (node.role !== 'consumer' || node.type === 'backup') {
            throw new ConfigError(`Node "${label}": "connected_to" kan alleen bij een apparaat dat energie gebruikt.`);
        }
        const target = findNode(nodes, ref);
        if (!target)
            throw new ConfigError(`Node "${label}": "connected_to" verwijst naar "${ref}", en die node bestaat niet.`);
        if (target.id === node.id)
            throw new ConfigError(`Node "${label}": "connected_to" mag niet naar zichzelf verwijzen.`);
        if (target.role !== 'home' && target.type !== 'backup' && target.role !== 'consumer') {
            throw new ConfigError(`Node "${label}": "connected_to" moet naar Home, een backup of een verbruiker verwijzen, niet naar "${ref}".`);
        }
    }
    // Volg iedere parent-keten. Zo voorkomen we A → B → A (of langere lussen).
    for (const node of nodes) {
        if (node.role !== 'consumer' || node.type === 'backup')
            continue;
        const seen = new Set([node.id]);
        let current = node;
        while (current?.config.connected_to) {
            const parent = parentOf(current);
            if (!parent || parent.role === 'home' || parent.type === 'backup')
                break;
            if (seen.has(parent.id)) {
                throw new ConfigError(`Node "${node.name ?? node.id}": "connected_to" veroorzaakt een lus in de verbruiker-keten.`);
            }
            seen.add(parent.id);
            current = parent;
        }
    }
}
/** Zoekt een node op id, op naam (hoofdletterongevoelig) of met het woord "home". */
function findNode(nodes, reference) {
    const ref = reference.trim();
    const lower = ref.toLowerCase();
    return (nodes.find((n) => n.id === ref) ??
        nodes.find((n) => n.name?.toLowerCase() === lower) ??
        (lower === 'home' ? nodes.find((n) => n.role === 'home') : undefined));
}
function parseConnections(raw, nodes) {
    if (raw === undefined || raw === null)
        return (0, Connection_1.defaultConnections)(nodes);
    if (!Array.isArray(raw))
        throw new ConfigError('"connections" moet een lijst zijn.');
    const taken = new Set();
    return raw.map((item, index) => {
        if (!isRecord(item))
            throw new ConfigError(`Verbinding ${index + 1} is geen geldig object.`);
        const fromRef = typeof item.from === 'string' ? item.from : '';
        const toRef = typeof item.to === 'string' ? item.to : '';
        if (!fromRef || !toRef)
            throw new ConfigError(`Verbinding ${index + 1} heeft een "from" en een "to" nodig.`);
        const from = findNode(nodes, fromRef);
        const to = findNode(nodes, toRef);
        if (!from)
            throw new ConfigError(`Verbinding ${index + 1}: node "${fromRef}" bestaat niet.`);
        if (!to)
            throw new ConfigError(`Verbinding ${index + 1}: node "${toRef}" bestaat niet.`);
        if (from.id === to.id)
            throw new ConfigError(`Verbinding ${index + 1} verbindt "${fromRef}" met zichzelf.`);
        const id = (0, Node_1.generateId)(typeof item.id === 'string' && item.id ? item.id : `${from.id}__${to.id}`, taken);
        taken.add(id);
        return (0, Connection_1.createConnection)(id, from, to, item);
    });
}
function parseGroups(raw, nodes, connections) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw))
        throw new ConfigError('"groups" moet een lijst zijn.');
    const byRef = (ref) => {
        const lower = ref.trim().toLowerCase();
        return nodes.find((n) => n.id === ref.trim()) ?? nodes.find((n) => n.name?.toLowerCase() === lower);
    };
    const parentOfMember = (node) => {
        if (node.role !== 'consumer' || node.type === 'backup')
            return 'home';
        const incoming = connections.find((c) => c.to === node.id);
        if (incoming) {
            const parent = nodes.find((n) => n.id === incoming.from);
            if (parent && (parent.role === 'home' || parent.type === 'backup' || parent.role === 'consumer'))
                return parent.id;
        }
        return 'home';
    };
    const used = new Set();
    const groupIds = new Set();
    return raw.map((item, index) => {
        if (!isRecord(item))
            throw new ConfigError(`Groep ${index + 1} is geen geldig object.`);
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (!name)
            throw new ConfigError(`Groep ${index + 1} heeft een "name" nodig.`);
        const memberRefs = Array.isArray(item.members) ? item.members.filter((v) => typeof v === 'string' && !!v.trim()) : [];
        if (memberRefs.length < 2)
            throw new ConfigError(`Groep "${name}" heeft minimaal twee apparaten nodig.`);
        const members = memberRefs.map((ref) => {
            const found = byRef(ref);
            if (!found || found.role === 'home' || found.type === 'backup')
                throw new ConfigError(`Groep "${name}": apparaat "${ref}" bestaat niet of kan niet gegroepeerd worden.`);
            return found;
        });
        const role = members[0].role;
        if (members.some((m) => m.role !== role))
            throw new ConfigError(`Groep "${name}" mag geen verschillende energierollen mengen.`);
        const parentId = parentOfMember(members[0]);
        if (members.some((m) => parentOfMember(m) !== parentId))
            throw new ConfigError(`Groep "${name}" bevat apparaten met verschillende aansluitpunten.`);
        const display = item.display === 'individual' ? 'individual' : 'grouped';
        if (display === 'grouped') {
            for (const member of members) {
                const hasChildren = connections.some((c) => c.from === member.id && nodes.some((n) => n.id === c.to && n.role === 'consumer' && n.type !== 'backup'));
                if (hasChildren)
                    throw new ConfigError(`Groep "${name}": parent-apparaat "${member.name ?? member.id}" kan niet gegroepeerd worden zolang er verbruikers achter hangen.`);
            }
            for (const member of members) {
                if (used.has(member.id))
                    throw new ConfigError(`Apparaat "${member.name ?? member.id}" staat in meer dan één zichtbare groep.`);
                used.add(member.id);
            }
        }
        let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : (0, Node_1.generateId)(name, groupIds);
        if (groupIds.has(id))
            id = (0, Node_1.generateId)(id, groupIds);
        groupIds.add(id);
        const sameType = members.every((m) => m.type === members[0].type);
        const type = sameType ? members[0].type : role === 'consumer' ? 'consumer' : members[0].type;
        return {
            id,
            name,
            icon: typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim() : undefined,
            display,
            memberIds: members.map((m) => m.id),
            type,
            parentId,
        };
    });
}
function parseLayout(raw) {
    if (raw === undefined || raw === null)
        return { mode: 'flow' };
    if (!isRecord(raw))
        throw new ConfigError('"layout" moet een object zijn.');
    if (raw.mode !== undefined && raw.mode !== 'flow' && raw.mode !== 'eniris' && raw.mode !== 'circle' && raw.mode !== 'straight' && raw.mode !== 'auto') {
        throw new ConfigError('"layout.mode" moet "flow", "circle" (rond) of "straight" (recht) zijn.');
    }
    // v0.7.0 schreef nog een oudere naam weg; behandel die stil als de standaard Flow-weergave zodat bestaande kaarten blijven werken.
    const mode = raw.mode === 'circle' ? 'circle' : raw.mode === 'straight' ? 'straight' : 'flow';
    const positions = {};
    if (raw.positions !== undefined) {
        if (!isRecord(raw.positions))
            throw new ConfigError('"layout.positions" moet een object zijn.');
        for (const [key, value] of Object.entries(raw.positions)) {
            if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
                throw new ConfigError(`Positie van "${key}" heeft een numerieke x en y nodig (0-100).`);
            }
            positions[key] = { x: Math.min(100, Math.max(0, value.x)), y: Math.min(100, Math.max(0, value.y)) };
        }
    }
    return { mode, positions };
}

};
__mods["src/demo/DemoEngine"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.demoReadings = demoReadings;
const flowHelper_1 = __req("src/helpers/flowHelper");
const EntityStatus_1 = __req("src/types/EntityStatus");
const DAY_SECONDS = 120; // één "dag" duurt twee minuten, zodat je alles snel ziet gebeuren
const BATTERY_SECONDS = 150;
const wave = (t, period, phase = 0) => Math.sin((2 * Math.PI * t) / period + phase);
function reading(node, watts, soc) {
    const rounded = Math.round(watts);
    const r = {
        status: rounded === 0 ? EntityStatus_1.EntityStatus.Zero : EntityStatus_1.EntityStatus.Valid,
        watts: rounded === 0 ? 0 : rounded,
        charging: false,
    };
    r.charging = (0, flowHelper_1.isCharging)(node, r.watts);
    if (soc !== undefined)
        r.soc = { status: EntityStatus_1.EntityStatus.Valid, value: Math.round(soc) };
    return r;
}
/**
 * Verzint consistente meetwaarden voor een demo: de energiebalans klopt altijd,
 * zodat wat het net levert precies aansluit bij wat de rest produceert en verbruikt.
 * Home krijgt geen eigen waarde; die wordt uit de verbindingen berekend.
 */
function demoReadings(nodes, t) {
    const out = new Map();
    const phase = (t / DAY_SECONDS) % 1;
    const sun = phase < 0.65 ? Math.sin((Math.PI * phase) / 0.65) : 0;
    const flicker = 0.93 + 0.07 * wave(t, 7);
    const solars = nodes.filter((n) => n.type === 'solar');
    const batteries = nodes.filter((n) => n.type === 'battery');
    const grids = nodes.filter((n) => n.type === 'grid');
    let production = 0;
    let consumption = 380 + 140 * wave(t, 9); // wat de woning zelf verbruikt
    nodes.forEach((node, i) => {
        let watts = null;
        switch (node.type) {
            case 'solar': {
                watts = (5200 * sun * flicker) / solars.length;
                production += watts;
                break;
            }
            case 'producer': {
                watts = 700 * sun * flicker;
                production += watts;
                break;
            }
            case 'generator': {
                watts = 0; // een geldige nul: apparaat staat uit, sensor werkt gewoon
                break;
            }
            case 'ev_charger': {
                watts = wave(t, 37) > 0.1 ? 3700 * (0.97 + 0.03 * wave(t, 3)) : 0;
                consumption += watts;
                break;
            }
            case 'heat_pump': {
                watts = 350 + 600 * (0.5 + 0.5 * wave(t, 17));
                consumption += watts;
                break;
            }
            case 'boiler': {
                watts = Math.cos((2 * Math.PI * t) / 29) > 0.55 ? 2000 : 0;
                consumption += watts;
                break;
            }
            case 'airco': {
                watts = Math.max(0, 900 * wave(t, 41));
                consumption += watts;
                break;
            }
            case 'backup': {
                // Een backup telt niet apart mee: de apparaten erachter (of, zonder die, deze waarde) worden getoond;
                // de kaart rekent een backup met apparaten erachter om naar hun som.
                watts = 220 + 160 * (0.5 + 0.5 * wave(t, 23));
                break;
            }
            case 'consumer': {
                watts = 180 + 120 * (0.5 + 0.5 * wave(t, 11, i));
                break;
            }
            default:
                break;
        }
        if (watts !== null)
            out.set(node.id, reading(node, watts));
    });
    // Maak hiërarchische verbruikers logisch: een parent met kinderen meet minimaal de som van zijn directe kinderen
    // plus een kleine eigen restlast. Alleen top-level verbruiker-takken tellen mee in de woningbalans.
    const byRef = (ref) => {
        const lower = ref.toLowerCase();
        return nodes.find((n) => n.id === ref) ?? nodes.find((n) => n.name?.toLowerCase() === lower);
    };
    const consumers = nodes.filter((n) => n.type === 'consumer');
    for (let pass = 0; pass < consumers.length; pass++) {
        for (const parent of consumers) {
            const children = consumers.filter((child) => child.config.connected_to && byRef(child.config.connected_to)?.id === parent.id);
            if (!children.length)
                continue;
            const total = children.reduce((sum, child) => sum + Math.max(0, out.get(child.id)?.watts ?? 0), 0);
            out.set(parent.id, reading(parent, total + 45 + 25 * (0.5 + 0.5 * wave(t, 13, pass))));
        }
    }
    for (const node of consumers) {
        const ref = node.config.connected_to;
        const parent = ref ? byRef(ref) : undefined;
        if (parent?.role === 'consumer' && parent.type !== 'backup')
            continue;
        consumption += Math.max(0, out.get(node.id)?.watts ?? 0);
    }
    // Batterij: laadvermogen volgt de afgeleide van de laadtoestand, zodat de cijfers kloppen met elkaar.
    let charge = 0;
    const soc = 55 + 35 * wave(t, BATTERY_SECONDS);
    if (batteries.length > 0) {
        charge = 2800 * Math.cos((2 * Math.PI * t) / BATTERY_SECONDS);
        for (const b of batteries)
            out.set(b.id, reading(b, -charge / batteries.length, soc));
    }
    // Het net vult aan wat er ontbreekt (positief = afname, negatief = teruglevering).
    const gridTotal = consumption + charge - production;
    grids.forEach((g, i) => out.set(g.id, reading(g, i === 0 ? gridTotal : 0)));
    return out;
}

};
__mods["src/editor/EnergyFlowCardEditor"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnergyFlowCardEditor = void 0;
const CardConfig_1 = __req("src/config/CardConfig");
const i18n_1 = __req("src/helpers/i18n");
const Node_1 = __req("src/models/Node");
const dom_1 = __req("src/renderer/dom");
const NodeType_1 = __req("src/types/NodeType");
const SELECTABLE_TYPES = NodeType_1.NODE_TYPES.filter((type) => type !== 'home');
const POWER_FIELDS = new Set(['power_entity', 'charge_power_entity', 'discharge_power_entity', 'production_entity', 'phase_l1_power_entity', 'phase_l2_power_entity', 'phase_l3_power_entity']);
const ICON_PRESETS = [
    { value: '', key: 'icon_auto' },
    { value: 'mdi:solar-power', key: 'icon_solar' },
    { value: 'mdi:battery', key: 'icon_battery' },
    { value: 'mdi:heat-pump', key: 'icon_heat_pump' },
    { value: 'mdi:air-conditioner', key: 'icon_airco' },
    { value: 'mdi:ev-station', key: 'icon_ev' },
    { value: 'mdi:washing-machine', key: 'icon_washing_machine' },
    { value: 'mdi:dishwasher', key: 'icon_dishwasher' },
    { value: 'mdi:desktop-tower', key: 'icon_pc' },
    { value: 'mdi:server', key: 'icon_server' },
    { value: 'mdi:lightbulb', key: 'icon_light' },
    { value: 'mdi:pump', key: 'icon_pump' },
    { value: 'mdi:power-socket-eu', key: 'icon_socket' },
    { value: 'mdi:generator-portable', key: 'icon_backup' },
    { value: 'mdi:home-battery', key: 'icon_home_battery' },
    { value: 'mdi:water-boiler', key: 'icon_boiler' },
    { value: 'mdi:radiator', key: 'icon_radiator' },
    { value: 'mdi:fan', key: 'icon_fan' },
];
const CUSTOM_ICON = '__custom__';
const editorStyles = `
:host { display: block; color: var(--primary-text-color); }
.wizard { display: flex; flex-direction: column; gap: 16px; }
.tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--divider-color, #e0e0e0); }
.tab {
  flex: 1; min-width: 0; padding: 10px 6px; border: 0; background: none; cursor: pointer; font: inherit; color: var(--secondary-text-color);
  border-bottom: 3px solid transparent; margin-bottom: -1px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; line-height: 20px;
}
.tab[aria-selected="true"] { color: var(--primary-text-color); border-bottom-color: var(--primary-color, #03a9f4); font-weight: 600; }
.tab .n { display: inline-flex; flex: 0 0 20px; align-items: center; justify-content: center; width: 20px; height: 20px; line-height: 1; border-radius: 50%;
  font-size: 12px; background: var(--secondary-background-color, #eee); }
.tab[aria-selected="true"] .n { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
.hint { margin: 0; font-size: 14px; color: var(--secondary-text-color); line-height: 1.4; }
.error { padding: 10px 12px; border-radius: 8px; font-size: 14px; background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }
.device { border: 1px solid var(--divider-color, #e0e0e0); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
label.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--secondary-text-color); flex: 1; min-width: 130px; }
input[type="text"], input[type="number"], select {
  font: inherit; font-size: 14px; padding: 9px 10px; border-radius: 8px; box-sizing: border-box; width: 100%;
  border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff); color: var(--primary-text-color);
}
.color-grid { display: flex; flex-direction: column; gap: 8px; }
.color-field { display: grid; grid-template-columns: minmax(110px, 145px) 1fr; align-items: center; gap: 10px; padding: 9px 10px; border: 1px solid var(--divider-color, #ddd); border-radius: 8px; font-size: 12px; }
.color-palette { display: flex; align-items: center; justify-content: flex-start; gap: 5px; flex-wrap: wrap; min-width: 0; }
.color-dot { width: 20px; height: 20px; padding: 0; border-radius: 50%; cursor: pointer; border: 2px solid transparent; box-sizing: border-box; flex: 0 0 auto; box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-text-color) 22%, transparent); }
.color-dot:hover { transform: scale(1.08); }
.color-dot.selected { border-color: var(--primary-text-color); box-shadow: 0 0 0 2px var(--card-background-color, #fff), 0 0 0 3px var(--primary-text-color); }
.color-dot.default { position: relative; background: var(--default-color); }
.color-dot.default::after { content: ''; position: absolute; inset: 5px; border-radius: 50%; background: color-mix(in srgb, var(--card-background-color, #fff) 88%, transparent); }
.color-dot.legacy { outline: 1px dashed var(--secondary-text-color); outline-offset: 2px; }
.color-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
@media (max-width: 520px) { .color-field { grid-template-columns: 1fr; } }
ha-entity-picker { width: 100%; }
input:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 1px; }
button.btn {
  font: inherit; font-size: 14px; padding: 9px 14px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--divider-color, #ccc); background: transparent; color: var(--primary-text-color);
}
button.btn.primary { background: var(--primary-color, #03a9f4); border-color: transparent; color: var(--text-primary-color, #fff); }
button.btn.danger { color: var(--error-color, #db4437); }
details > summary { cursor: pointer; font-size: 13px; color: var(--secondary-text-color); padding: 2px 0; }
details[open] > summary { margin-bottom: 8px; }
.stack { display: flex; flex-direction: column; gap: 8px; }
.check { display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 6px 0; }
.check input { width: 18px; height: 18px; }
h3 { margin: 0; font-size: 14px; font-weight: 600; }
.nav { display: flex; justify-content: space-between; gap: 8px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.list li { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 14px; }
`;
/** JSON met gesorteerde sleutels: twee configuraties met dezelfde inhoud zijn dan altijd gelijk, ook bij een andere sleutelvolgorde. */
function stable(value) {
    return JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : v);
}
/**
 * Wizard in vier stappen: 1 Apparaten, 2 Verbindingen, 3 Prijzen, 4 Voorbeeld.
 * De wizard schrijft gewone kaart-YAML (inclusief gegenereerde ids en connections);
 * wie liever direct YAML schrijft, kan de wizard gewoon overslaan.
 */
class EnergyFlowCardEditor extends HTMLElement {
    constructor() {
        super();
        this.config = { type: 'custom:energy-flow-card', nodes: [] };
        this.step = 1;
        this.lastEmitted = '';
        /** Welke uitklapsecties ("Geavanceerd") openstaan; overleeft het opnieuw tekenen van de editor. */
        this.openSections = new Set();
        this.attachShadow({ mode: 'open' });
    }
    setConfig(config) {
        const incoming = stable(config);
        // Echo van onze eigen wijziging: niet opnieuw tekenen (focus en open keuzelijsten blijven behouden).
        if (incoming === this.lastEmitted || incoming === stable(this.config))
            return;
        this.config = structuredClone(config);
        if (!Array.isArray(this.config.nodes))
            this.config.nodes = [];
        this.ensureIds();
        this.render();
    }
    set hass(hass) {
        this._hass = hass;
        this.applyHassToPickers();
        if (this.preview)
            this.preview.hass = hass;
    }
    get uiLang() {
        return (0, i18n_1.hassLanguage)(this._hass);
    }
    // ----- Config bijwerken ---------------------------------------------------------------------
    get nodes() {
        if (!Array.isArray(this.config.nodes))
            this.config.nodes = [];
        return this.config.nodes;
    }
    get groups() {
        if (!Array.isArray(this.config.groups))
            this.config.groups = [];
        return this.config.groups;
    }
    ensureIds() {
        const taken = new Set(['home']);
        for (const n of this.nodes)
            if (typeof n.id === 'string' && n.id.trim())
                taken.add(n.id.trim());
        for (const n of this.nodes) {
            if ((0, NodeType_1.normalizeType)(n.type) === 'home' || (typeof n.id === 'string' && n.id.trim()))
                continue;
            n.id = (0, Node_1.generateId)(n.name || String(n.type), taken);
            taken.add(n.id);
        }
    }
    commit() {
        this.ensureIds();
        this.lastEmitted = stable(this.config);
        // Een kopie, geen verwijzing naar ons eigen (steeds aangepaste) object: Home Assistant herkent een wijziging
        // alleen aan een nieuw object. Anders komen na de eerste wijziging voorbeeld en opslaan niet meer mee.
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: structuredClone(this.config) }, bubbles: true, composed: true }));
    }
    resolve() {
        try {
            return (0, CardConfig_1.normalizeConfig)(this.config);
        }
        catch (err) {
            return err instanceof Error ? err.message : String(err);
        }
    }
    // ----- Opbouw -------------------------------------------------------------------------------
    render() {
        const wizard = (0, dom_1.html)('div', { class: 'wizard' }, this.renderTabs());
        if (this.step === 1)
            wizard.append(this.renderDevices());
        else if (this.step === 2)
            wizard.append(this.renderConnections());
        else if (this.step === 3)
            wizard.append(this.renderPricing());
        else
            wizard.append(this.renderPreview());
        wizard.append(this.renderNav());
        this.shadowRoot.replaceChildren((0, dom_1.html)('style', {}, editorStyles), wizard);
        this.applyHassToPickers();
    }
    /** Geeft alle Home Assistant entity-pickers het actuele hass-object zonder de editor opnieuw te tekenen. */
    applyHassToPickers() {
        if (!this._hass)
            return;
        this.shadowRoot?.querySelectorAll('ha-entity-picker').forEach((el) => {
            el.hass = this._hass;
        });
    }
    renderTabs() {
        const labels = [(0, i18n_1.t)('ed_step_devices', this.uiLang), (0, i18n_1.t)('ed_step_connections', this.uiLang), (0, i18n_1.t)('ed_step_pricing', this.uiLang), (0, i18n_1.t)('ed_step_preview', this.uiLang)];
        const tabs = (0, dom_1.html)('div', { class: 'tabs', role: 'tablist' });
        labels.forEach((label, i) => {
            const step = (i + 1);
            const tab = (0, dom_1.html)('button', { class: 'tab', role: 'tab', 'aria-selected': String(this.step === step), type: 'button' }, (0, dom_1.html)('span', { class: 'n' }, String(step)), label);
            tab.addEventListener('click', () => this.goTo(step));
            tabs.append(tab);
        });
        return tabs;
    }
    renderNav() {
        const nav = (0, dom_1.html)('div', { class: 'nav' });
        const back = (0, dom_1.html)('button', { class: 'btn', type: 'button' }, (0, i18n_1.t)('ed_back', this.uiLang));
        back.addEventListener('click', () => this.goTo((this.step - 1)));
        const next = (0, dom_1.html)('button', { class: 'btn primary', type: 'button' }, (0, i18n_1.t)('ed_next', this.uiLang));
        next.addEventListener('click', () => this.goTo((this.step + 1)));
        nav.append(this.step > 1 ? back : (0, dom_1.html)('span'), this.step < 4 ? next : (0, dom_1.html)('span'));
        return nav;
    }
    goTo(step) {
        if (step < 1 || step > 4)
            return;
        this.step = step;
        this.render();
    }
    entityInput(value, powerOnly, onChange) {
        // Gebruik de native Home Assistant entity-picker. Die blijft open tijdens zoeken/selecteren en
        // gedraagt zich hetzelfde als selectors in automatiseringen en andere HA-editors.
        const picker = document.createElement('ha-entity-picker');
        picker.value = value ?? '';
        picker.includeDomains = powerOnly ? ['sensor', 'number', 'input_number'] : ['sensor', 'number', 'input_number'];
        picker.allowCustomEntity = true;
        if (this._hass)
            picker.hass = this._hass;
        picker.addEventListener('value-changed', (ev) => {
            const detail = ev.detail;
            onChange((detail?.value ?? '').trim());
        });
        return picker;
    }
    /** Een uitklapsectie die open blijft als de editor opnieuw getekend wordt (bijvoorbeeld na een typewijziging). */
    section(key, summary, ...content) {
        const details = (0, dom_1.html)('details', {}, (0, dom_1.html)('summary', {}, summary), ...content);
        details.open = this.openSections.has(key);
        details.addEventListener('toggle', () => {
            if (details.open)
                this.openSections.add(key);
            else
                this.openSections.delete(key);
        });
        return details;
    }
    field(label, control) {
        return (0, dom_1.html)('label', { class: 'field' }, label, control);
    }
    setOrDelete(node, key, value) {
        if (value)
            node[key] = value;
        else
            delete node[key];
        this.commit();
    }
    // ----- Stap 1: Apparaten --------------------------------------------------------------------
    renderDevices() {
        const lang = this.uiLang;
        const wrap = (0, dom_1.html)('div', { class: 'stack' }, (0, dom_1.html)('p', { class: 'hint' }, (0, i18n_1.t)('ed_home_auto', lang)));
        const homePower = this.entityInput(this.config.home_power_entity, true, (v) => {
            if (v)
                this.config.home_power_entity = v;
            else
                delete this.config.home_power_entity;
            this.commit();
        });
        wrap.append(this.field((0, i18n_1.t)('ed_home_entity', lang), homePower));
        this.nodes.forEach((node) => {
            if ((0, NodeType_1.normalizeType)(node.type) === 'home')
                return;
            wrap.append(this.renderDevice(node));
        });
        const add = (0, dom_1.html)('button', { class: 'btn primary', type: 'button' }, `+ ${(0, i18n_1.t)('ed_add_device', lang)}`);
        add.addEventListener('click', () => this.addDevice());
        wrap.append(add);
        wrap.append(this.renderGroups());
        return wrap;
    }
    renderDevice(node) {
        const lang = this.uiLang;
        const type = (0, NodeType_1.normalizeType)(node.type) ?? 'consumer';
        const name = (0, dom_1.html)('input', { type: 'text', autocomplete: 'off' });
        name.value = node.name ?? '';
        name.addEventListener('input', () => {
            node.name = name.value;
        });
        // Config pas doorgeven als het veld klaar is. Zo kan Home Assistant de editor niet na de eerste letter vervangen.
        name.addEventListener('change', () => {
            node.name = name.value.trim();
            this.commit();
            if (type === 'backup')
                this.render();
        });
        const select = (0, dom_1.html)('select');
        for (const option of SELECTABLE_TYPES) {
            const el = (0, dom_1.html)('option', { value: option }, (0, i18n_1.t)(`type_${option}`, lang));
            if (option === type)
                el.selected = true;
            select.append(el);
        }
        select.addEventListener('change', () => this.changeType(node, select.value));
        const remove = (0, dom_1.html)('button', { class: 'btn danger', type: 'button', 'aria-label': (0, i18n_1.t)('ed_remove', lang) }, (0, i18n_1.t)('ed_remove', lang));
        remove.addEventListener('click', () => this.removeDevice(node));
        const power = this.entityInput(node.power_entity, true, (v) => this.setOrDelete(node, 'power_entity', v));
        const advanced = (0, dom_1.html)('div', { class: 'stack' });
        for (const key of (0, Node_1.advancedFieldsFor)(type)) {
            const input = this.entityInput(node[key], POWER_FIELDS.has(key), (v) => this.setOrDelete(node, key, v));
            advanced.append(this.field((0, i18n_1.t)((0, Node_1.fieldLabelKey)(key, type), lang), input));
            if (type === 'grid' && key === 'phase_l1_power_entity')
                advanced.append((0, dom_1.html)('p', { class: 'hint phase-hint' }, (0, i18n_1.t)('phase_l1_auto_hint', lang)));
        }
        advanced.append(this.iconPicker(node.icon, (value) => {
            if (value)
                node.icon = value;
            else
                delete node.icon;
            this.commit();
            this.render();
        }));
        const invert = (0, dom_1.html)('input', { type: 'checkbox' });
        invert.checked = node.invert === true;
        invert.addEventListener('change', () => {
            if (invert.checked)
                node.invert = true;
            else
                delete node.invert;
            this.commit();
        });
        advanced.append((0, dom_1.html)('label', { class: 'check' }, invert, (0, i18n_1.t)('ed_invert', lang)));
        // Verbruikers kunnen direct aan Home, achter een backup of achter een andere verbruiker hangen.
        // Kandidaten die een lus zouden maken worden niet aangeboden.
        const parentCandidates = this.nodes.filter((candidate) => {
            if (candidate === node)
                return false;
            const candidateType = (0, NodeType_1.normalizeType)(candidate.type);
            if (candidateType !== 'backup' && (0, NodeType_1.roleOf)(candidateType ?? 'consumer') !== 'consumer')
                return false;
            return !this.wouldCreateParentLoop(node, candidate);
        });
        let parent;
        if ((0, NodeType_1.roleOf)(type) === 'consumer' && type !== 'backup') {
            const parentSelect = (0, dom_1.html)('select');
            parentSelect.append((0, dom_1.html)('option', { value: 'home' }, (0, i18n_1.t)('home', lang)));
            for (const candidate of parentCandidates) {
                parentSelect.append((0, dom_1.html)('option', { value: candidate.id ?? '' }, candidate.name || candidate.id || ''));
            }
            const current = parentCandidates.find((candidate) => !!node.connected_to && (candidate.id === node.connected_to || candidate.name?.toLowerCase() === node.connected_to.toLowerCase()));
            parentSelect.value = current?.id ?? 'home';
            parentSelect.addEventListener('change', () => this.setParent(node, parentSelect.value));
            parent = this.field((0, i18n_1.t)('ed_connected_to', lang), parentSelect);
        }
        return (0, dom_1.html)('div', { class: 'device' }, (0, dom_1.html)('div', { class: 'row' }, this.field((0, i18n_1.t)('ed_name', lang), name), this.field((0, i18n_1.t)('ed_type', lang), select)), ...(parent ? [(0, dom_1.html)('div', { class: 'row' }, parent)] : []), (0, dom_1.html)('div', { class: 'row' }, this.field((0, i18n_1.t)('ed_power_entity', lang), power), remove), this.section(`advanced:${node.id ?? ''}`, (0, i18n_1.t)('ed_advanced', lang), advanced));
    }
    iconPicker(current, onChange) {
        const lang = this.uiLang;
        const wrap = (0, dom_1.html)('div', { class: 'stack' });
        const select = (0, dom_1.html)('select');
        const presetValues = new Set(ICON_PRESETS.map((p) => p.value));
        for (const preset of ICON_PRESETS) {
            const option = (0, dom_1.html)('option', { value: preset.value }, (0, i18n_1.t)(preset.key, lang));
            if ((current ?? '') === preset.value)
                option.selected = true;
            select.append(option);
        }
        const customOption = (0, dom_1.html)('option', { value: CUSTOM_ICON }, (0, i18n_1.t)('icon_custom', lang));
        if (current && !presetValues.has(current))
            customOption.selected = true;
        select.append(customOption);
        wrap.append(this.field((0, i18n_1.t)('ed_icon', lang), select));
        if (current && !presetValues.has(current)) {
            const custom = (0, dom_1.html)('input', { type: 'text', placeholder: 'mdi:…', autocomplete: 'off', spellcheck: 'false' });
            custom.value = current;
            custom.addEventListener('change', () => onChange(custom.value.trim()));
            wrap.append(this.field((0, i18n_1.t)('ed_custom_icon', lang), custom));
        }
        select.addEventListener('change', () => {
            if (select.value === CUSTOM_ICON) {
                // Eerst alleen opnieuw tekenen; de gebruiker krijgt daarna het vrije mdi:-veld.
                if (!current || presetValues.has(current))
                    onChange('mdi:');
                return;
            }
            onChange(select.value);
        });
        return wrap;
    }
    renderGroups() {
        const lang = this.uiLang;
        const box = (0, dom_1.html)('div', { class: 'stack' }, (0, dom_1.html)('h3', {}, (0, i18n_1.t)('ed_groups', lang)), (0, dom_1.html)('p', { class: 'hint' }, (0, i18n_1.t)('ed_groups_hint', lang)));
        this.groups.forEach((group, index) => box.append(this.renderGroup(group, index)));
        const add = (0, dom_1.html)('button', { class: 'btn', type: 'button' }, `+ ${(0, i18n_1.t)('ed_add_group', lang)}`);
        add.addEventListener('click', () => {
            const name = `${(0, i18n_1.t)('ed_group', lang)} ${this.groups.length + 1}`;
            this.groups.push({ id: (0, Node_1.generateId)(name, new Set(this.groups.map((g) => g.id ?? ''))), name, display: 'grouped', members: [] });
            this.commit();
            this.render();
        });
        box.append(add);
        return this.section('groups', (0, i18n_1.t)('ed_groups', lang), box);
    }
    renderGroup(group, index) {
        const lang = this.uiLang;
        const name = (0, dom_1.html)('input', { type: 'text', autocomplete: 'off' });
        name.value = group.name ?? '';
        name.addEventListener('input', () => { group.name = name.value; });
        name.addEventListener('change', () => { group.name = name.value.trim(); this.commit(); });
        const display = (0, dom_1.html)('select');
        display.append((0, dom_1.html)('option', { value: 'grouped' }, (0, i18n_1.t)('ed_grouped', lang)), (0, dom_1.html)('option', { value: 'individual' }, (0, i18n_1.t)('ed_individual', lang)));
        display.value = group.display === 'individual' ? 'individual' : 'grouped';
        display.addEventListener('change', () => { group.display = display.value; this.commit(); this.render(); });
        const remove = (0, dom_1.html)('button', { class: 'btn danger', type: 'button' }, (0, i18n_1.t)('ed_remove', lang));
        remove.addEventListener('click', () => { this.groups.splice(index, 1); if (!this.groups.length)
            delete this.config.groups; this.commit(); this.render(); });
        const members = (0, dom_1.html)('div', { class: 'stack' });
        const selected = new Set(group.members ?? []);
        const candidates = this.nodes.filter((n) => (0, NodeType_1.normalizeType)(n.type) !== 'home' && (0, NodeType_1.normalizeType)(n.type) !== 'backup');
        for (const node of candidates) {
            const id = node.id ?? '';
            const cb = (0, dom_1.html)('input', { type: 'checkbox' });
            cb.checked = selected.has(id) || (!!node.name && selected.has(node.name));
            cb.addEventListener('change', () => {
                const set = new Set((group.members ?? []).map(String));
                if (cb.checked)
                    set.add(id);
                else {
                    set.delete(id);
                    if (node.name)
                        set.delete(node.name);
                }
                group.members = [...set].filter(Boolean);
                this.commit();
            });
            members.append((0, dom_1.html)('label', { class: 'check' }, cb, node.name || id));
        }
        const icon = this.iconPicker(group.icon, (value) => { group.icon = value || undefined; this.commit(); this.render(); });
        return (0, dom_1.html)('div', { class: 'device' }, (0, dom_1.html)('div', { class: 'row' }, this.field((0, i18n_1.t)('ed_group_name', lang), name), this.field((0, i18n_1.t)('ed_group_display', lang), display)), this.field((0, i18n_1.t)('ed_group_members', lang), members), icon, remove);
    }
    addDevice() {
        const lang = this.uiLang;
        const taken = new Set(['home', ...this.nodes.map((n) => n.id ?? '')]);
        const name = (0, i18n_1.t)('type_consumer', lang);
        const node = { id: (0, Node_1.generateId)(name, taken), name, type: 'consumer' };
        this.nodes.push(node);
        // Bestaat er al een handmatige lijst met verbindingen, dan sluit een nieuw apparaat automatisch aan op Home.
        if (this.config.connections)
            this.config.connections.push(this.homeConnection(node.id, 'consumer'));
        this.commit();
        this.render();
        this.focusLastDevice();
    }
    /** Na "apparaat toevoegen": scrol naar het nieuwe apparaat en zet de cursor in het naamveld. */
    focusLastDevice() {
        const devices = this.shadowRoot?.querySelectorAll('.device');
        const last = devices?.[devices.length - 1];
        const name = last?.querySelector('input[type="text"]');
        if (!last || !name)
            return;
        name.focus();
        name.select();
        last.scrollIntoView({ block: 'nearest' });
    }
    /** Zou `node` onder `candidate` hangen een lus maken? */
    wouldCreateParentLoop(node, candidate) {
        const nodeId = node.id ?? '';
        const nodeName = node.name?.toLowerCase();
        const byRef = (ref) => {
            const lower = ref.toLowerCase();
            return this.nodes.find((n) => n.id === ref) ?? this.nodes.find((n) => n.name?.toLowerCase() === lower);
        };
        const seen = new Set();
        let current = candidate;
        while (current && !seen.has(current)) {
            if (current === node || (!!nodeId && current.id === nodeId) || (!!nodeName && current.name?.toLowerCase() === nodeName))
                return true;
            seen.add(current);
            current = current.connected_to ? byRef(current.connected_to) : undefined;
        }
        return false;
    }
    /** Hang een apparaat aan Home, een backup of een andere verbruiker, ook bij handmatige verbindingen. */
    setParent(node, parentId) {
        if (parentId === 'home')
            delete node.connected_to;
        else
            node.connected_to = parentId;
        if (this.config.connections) {
            const resolved = this.resolve();
            if (typeof resolved !== 'string') {
                const me = resolved.nodes.find((n) => n.config === node);
                const home = resolved.nodes.find((n) => n.role === 'home');
                const parent = parentId === 'home' ? home : resolved.nodes.find((n) => n.id === parentId);
                if (me && parent) {
                    const keep = [];
                    resolved.connections.forEach((c, i) => {
                        const raw = this.config.connections[i];
                        if (!raw)
                            return;
                        const from = resolved.nodes.find((n) => n.id === c.from);
                        const isIncomingParentLink = c.to === me.id && from && (from.role === 'home' || from.type === 'backup' || from.role === 'consumer');
                        if (!isIncomingParentLink)
                            keep.push(raw);
                    });
                    keep.push({ from: parent.id, to: me.id });
                    this.config.connections = keep;
                }
            }
        }
        this.commit();
        this.render();
    }
    removeDevice(node) {
        const index = this.nodes.indexOf(node);
        if (index < 0)
            return;
        const childIds = [];
        // Apparaten die achter deze node hingen, hangen daarna weer aan Home.
        for (const other of this.nodes) {
            if (other !== node && other.connected_to && (other.connected_to === node.id || other.connected_to === node.name)) {
                delete other.connected_to;
                if (other.id)
                    childIds.push(other.id);
            }
        }
        const resolved = this.resolve();
        if (typeof resolved !== 'string' && this.config.connections) {
            const id = resolved.nodes.find((n) => n.config === node)?.id;
            if (id) {
                const keep = [];
                resolved.connections.forEach((c, i) => {
                    if (c.from !== id && c.to !== id && this.config.connections[i])
                        keep.push(this.config.connections[i]);
                });
                for (const childId of childIds)
                    keep.push({ from: 'home', to: childId });
                this.config.connections = keep;
            }
        }
        this.nodes.splice(index, 1);
        this.commit();
        this.render();
    }
    changeType(node, type) {
        const previousRole = (0, NodeType_1.roleOf)((0, NodeType_1.normalizeType)(node.type) ?? 'consumer');
        node.type = type;
        // Alleen gewone verbruikers kunnen een parent kiezen.
        if ((0, NodeType_1.roleOf)(type) !== 'consumer' || type === 'backup')
            delete node.connected_to;
        // Als deze node geen verbruiker/backup meer is, mogen bestaande kinderen er niet achter blijven hangen.
        if ((0, NodeType_1.roleOf)(type) !== 'consumer') {
            const childIds = [];
            for (const other of this.nodes) {
                if (other !== node && other.connected_to && (other.connected_to === node.id || other.connected_to === node.name)) {
                    delete other.connected_to;
                    if (other.id)
                        childIds.push(other.id);
                }
            }
            if (this.config.connections && node.id && childIds.length) {
                this.config.connections = this.config.connections.filter((c) => !(c.from === node.id && childIds.includes(c.to)));
                for (const childId of childIds)
                    this.config.connections.push({ from: 'home', to: childId });
            }
        }
        // Verbruikers ontvangen van Home, bronnen sturen naar Home: draai bestaande Home-verbindingen indien nodig om.
        const resolved = this.resolve();
        if (previousRole !== (0, NodeType_1.roleOf)(type) && typeof resolved !== 'string' && this.config.connections) {
            const me = resolved.nodes.find((n) => n.config === node);
            const home = resolved.nodes.find((n) => n.role === 'home');
            if (me && home) {
                resolved.connections.forEach((c, i) => {
                    const raw = this.config.connections[i];
                    if (!raw || !((c.from === me.id && c.to === home.id) || (c.from === home.id && c.to === me.id)))
                        return;
                    Object.assign(raw, this.homeConnection(me.id, type));
                });
            }
        }
        this.commit();
        this.render();
        // Het opnieuw tekenen haalt de focus weg; zet die terug op het keuzemenu van dit apparaat.
        const devices = [...(this.shadowRoot?.querySelectorAll('.device') ?? [])];
        const index = this.nodes.filter((n) => (0, NodeType_1.normalizeType)(n.type) !== 'home').indexOf(node);
        devices[index]?.querySelector('select')?.focus();
    }
    /** Verbinding tussen een node en Home in de natuurlijke richting voor dat type. */
    homeConnection(nodeId, type) {
        return (0, NodeType_1.roleOf)(type) === 'consumer' ? { from: 'home', to: nodeId } : { from: nodeId, to: 'home' };
    }
    // ----- Stap 2: Verbindingen -----------------------------------------------------------------
    renderConnections() {
        const lang = this.uiLang;
        const resolved = this.resolve();
        if (typeof resolved === 'string')
            return this.errorBox(resolved);
        const devices = resolved.nodes.filter((n) => n.role !== 'home');
        if (devices.length === 0)
            return (0, dom_1.html)('p', { class: 'hint' }, (0, i18n_1.t)('ed_add_first', lang));
        const home = resolved.nodes.find((n) => n.role === 'home');
        const nameOf = (id) => resolved.nodes.find((n) => n.id === id)?.name ?? (id === home.id ? (0, i18n_1.t)('home', lang) : id);
        const linked = (a, b) => resolved.connections.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
        const wrap = (0, dom_1.html)('div', { class: 'stack' }, (0, dom_1.html)('h3', {}, (0, i18n_1.t)('ed_connected_home', lang)));
        for (const device of devices) {
            const box = (0, dom_1.html)('input', { type: 'checkbox' });
            box.checked = linked(device.id, home.id);
            box.addEventListener('change', () => this.toggleHomeLink(device.id, box.checked));
            wrap.append((0, dom_1.html)('label', { class: 'check' }, box, nameOf(device.id)));
        }
        wrap.append((0, dom_1.html)('h3', {}, (0, i18n_1.t)('ed_other_connections', lang)));
        const list = (0, dom_1.html)('ul', { class: 'list' });
        resolved.connections.forEach((c, index) => {
            if (c.from === home.id || c.to === home.id)
                return;
            const rm = (0, dom_1.html)('button', { class: 'btn danger', type: 'button' }, (0, i18n_1.t)('ed_remove', lang));
            rm.addEventListener('click', () => this.removeConnection(index));
            list.append((0, dom_1.html)('li', {}, `${nameOf(c.from)} → ${nameOf(c.to)}`, rm));
        });
        wrap.append(list.children.length ? list : (0, dom_1.html)('p', { class: 'hint' }, (0, i18n_1.t)('ed_none_yet', lang)));
        const options = (select) => {
            for (const d of devices)
                select.append((0, dom_1.html)('option', { value: d.id }, nameOf(d.id)));
            return select;
        };
        const from = options((0, dom_1.html)('select'));
        const to = options((0, dom_1.html)('select'));
        if (devices.length > 1)
            to.selectedIndex = 1;
        const add = (0, dom_1.html)('button', { class: 'btn', type: 'button' }, (0, i18n_1.t)('ed_add_connection', lang));
        add.addEventListener('click', () => this.addConnection(from.value, to.value));
        wrap.append((0, dom_1.html)('div', { class: 'row' }, this.field((0, i18n_1.t)('ed_from', lang), from), this.field((0, i18n_1.t)('ed_to', lang), to), add));
        return wrap;
    }
    /** Zet de handmatige lijst met verbindingen klaar (afgeleid van de standaardverbindingen als hij nog niet bestaat). */
    explicitConnections(resolved) {
        if (!this.config.connections)
            this.config.connections = resolved.connections.map((c) => ({ from: c.from, to: c.to }));
        return this.config.connections;
    }
    toggleHomeLink(nodeId, on) {
        const resolved = this.resolve();
        if (typeof resolved === 'string')
            return;
        const home = resolved.nodes.find((n) => n.role === 'home');
        const node = resolved.nodes.find((n) => n.id === nodeId);
        const list = this.explicitConnections(resolved);
        const isPair = (c) => (c.from === nodeId && c.to === home.id) || (c.from === home.id && c.to === nodeId);
        if (on) {
            if (!resolved.connections.some(isPair))
                list.push(this.homeConnection(nodeId, node.type));
        }
        else {
            for (let i = resolved.connections.length - 1; i >= 0; i--)
                if (isPair(resolved.connections[i]))
                    list.splice(i, 1);
        }
        this.commit();
        this.render();
    }
    addConnection(from, to) {
        const resolved = this.resolve();
        if (typeof resolved === 'string' || from === to)
            return;
        if (resolved.connections.some((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from)))
            return;
        this.explicitConnections(resolved).push({ from, to });
        this.commit();
        this.render();
    }
    removeConnection(index) {
        const resolved = this.resolve();
        if (typeof resolved === 'string')
            return;
        this.explicitConnections(resolved).splice(index, 1);
        this.commit();
        this.render();
    }
    pricingConfig() {
        if (!this.config.pricing) {
            this.config.pricing = this.config.demo
                ? { mode: 'fixed', currency: 'EUR', import_price: 0.31, export_price: 0.09 }
                : { mode: 'none', currency: 'EUR' };
        }
        return this.config.pricing;
    }
    renderPricing() {
        const lang = this.uiLang;
        const pricing = this.pricingConfig();
        const wrap = (0, dom_1.html)('div', { class: 'device' }, (0, dom_1.html)('h3', {}, (0, i18n_1.t)('ed_pricing', lang)), (0, dom_1.html)('p', { class: 'hint' }, (0, i18n_1.t)('ed_pricing_hint', lang)));
        const mode = (0, dom_1.html)('select');
        for (const [value, key] of [
            ['none', 'pricing_none'], ['fixed', 'pricing_fixed'], ['entities', 'pricing_entities'],
        ]) {
            const option = (0, dom_1.html)('option', { value }, (0, i18n_1.t)(key, lang));
            if ((pricing.mode ?? 'none') === value)
                option.selected = true;
            mode.append(option);
        }
        mode.addEventListener('change', () => {
            pricing.mode = mode.value;
            this.commit();
            this.render();
        });
        wrap.append(this.field((0, i18n_1.t)('pricing_mode', lang), mode));
        if ((pricing.mode ?? 'none') === 'none')
            return wrap;
        const currency = (0, dom_1.html)('select');
        for (const value of ['EUR', 'GBP', 'USD']) {
            const option = (0, dom_1.html)('option', { value }, value);
            if ((pricing.currency ?? 'EUR') === value)
                option.selected = true;
            currency.append(option);
        }
        currency.addEventListener('change', () => { pricing.currency = currency.value; this.commit(); });
        wrap.append(this.field((0, i18n_1.t)('pricing_currency', lang), currency));
        if (pricing.mode === 'fixed') {
            const fixedField = (key, label) => {
                const input = (0, dom_1.html)('input', { type: 'number', min: '0', step: '0.0001', inputmode: 'decimal' });
                const current = pricing[key];
                if (typeof current === 'number')
                    input.value = String(current);
                input.addEventListener('change', () => {
                    const parsed = Number(input.value.replace(',', '.'));
                    if (input.value.trim() && Number.isFinite(parsed) && parsed >= 0)
                        pricing[key] = parsed;
                    else
                        delete pricing[key];
                    this.commit();
                });
                return this.field(`${label} / kWh`, input);
            };
            wrap.append((0, dom_1.html)('div', { class: 'row' }, fixedField('import_price', (0, i18n_1.t)('pricing_import', lang)), fixedField('export_price', (0, i18n_1.t)('pricing_export', lang))));
            return wrap;
        }
        const importEntity = this.entityInput(pricing.import_price_entity, false, (v) => {
            if (v)
                pricing.import_price_entity = v;
            else
                delete pricing.import_price_entity;
            this.commit();
        });
        const exportEntity = this.entityInput(pricing.export_price_entity, false, (v) => {
            if (v)
                pricing.export_price_entity = v;
            else
                delete pricing.export_price_entity;
            this.commit();
        });
        wrap.append(this.field((0, i18n_1.t)('pricing_import_entity', lang), importEntity), this.field((0, i18n_1.t)('pricing_export_entity', lang), exportEntity));
        return wrap;
    }
    // ----- Stap 4: Voorbeeld --------------------------------------------------------------------
    renderColors() {
        const lang = this.uiLang;
        const defaults = {
            solar: '#f0a202', grid: '#5a78d1', battery: '#33b07a', home: '#727272', consumer: '#2fa4b8',
            ev: '#9a6fd6', backup: '#c95a8a', generator: '#cf6a4e', producer: '#b5a220',
        };
        const labels = [
            ['solar', 'color_solar'], ['grid', 'color_grid'], ['battery', 'color_battery'], ['home', 'color_home'],
            ['consumer', 'color_consumer'], ['ev', 'color_ev'], ['backup', 'color_backup'], ['generator', 'color_generator'], ['producer', 'color_producer'],
        ];
        const isNl = lang === 'nl';
        // Beperkte, vaste palette: genoeg keuze zonder vrije kleurkiezer of onoverzichtelijke selectvelden.
        const presets = [
            ['#ef5350', isNl ? 'Rood' : 'Red'],
            ['#ec407a', isNl ? 'Roze' : 'Pink'],
            ['#ab47bc', isNl ? 'Paars' : 'Purple'],
            ['#7e57c2', isNl ? 'Violet' : 'Violet'],
            ['#5c6bc0', isNl ? 'Indigo' : 'Indigo'],
            ['#42a5f5', isNl ? 'Blauw' : 'Blue'],
            ['#29b6f6', isNl ? 'Lichtblauw' : 'Light blue'],
            ['#26c6da', isNl ? 'Cyaan' : 'Cyan'],
            ['#26a69a', isNl ? 'Turkoois' : 'Teal'],
            ['#66bb6a', isNl ? 'Groen' : 'Green'],
            ['#9ccc65', isNl ? 'Lichtgroen' : 'Light green'],
            ['#ffca28', isNl ? 'Geel' : 'Yellow'],
            ['#ffa726', isNl ? 'Oranje' : 'Orange'],
            ['#9e9e9e', isNl ? 'Grijs' : 'Grey'],
        ];
        const grid = (0, dom_1.html)('div', { class: 'color-grid' });
        const setColor = (key, value) => {
            if (!value || value.toLowerCase() === defaults[key].toLowerCase()) {
                if (this.config.colors) {
                    delete this.config.colors[key];
                    if (Object.keys(this.config.colors).length === 0)
                        delete this.config.colors;
                }
            }
            else {
                if (!this.config.colors)
                    this.config.colors = {};
                this.config.colors[key] = value;
            }
            this.commit();
            this.render();
        };
        for (const [key, labelKey] of labels) {
            const current = this.config.colors?.[key];
            const currentValue = current?.toLowerCase();
            const palette = (0, dom_1.html)('div', { class: 'color-palette', role: 'radiogroup', 'aria-label': (0, i18n_1.t)(labelKey, lang) });
            const defaultButton = (0, dom_1.html)('button', {
                class: `color-dot default${!current || currentValue === defaults[key].toLowerCase() ? ' selected' : ''}`,
                type: 'button', role: 'radio',
                'aria-checked': !current || currentValue === defaults[key].toLowerCase() ? 'true' : 'false',
                'aria-label': `${(0, i18n_1.t)(labelKey, lang)} – ${isNl ? 'Standaard' : 'Default'}`,
                title: isNl ? 'Standaardkleur' : 'Default color',
                style: `--default-color:${defaults[key]}`,
            });
            defaultButton.addEventListener('click', () => setColor(key));
            palette.append(defaultButton);
            for (const [value, name] of presets) {
                const selected = currentValue === value.toLowerCase();
                const dot = (0, dom_1.html)('button', {
                    class: `color-dot${selected ? ' selected' : ''}`,
                    type: 'button', role: 'radio', 'aria-checked': selected ? 'true' : 'false',
                    'aria-label': `${(0, i18n_1.t)(labelKey, lang)} – ${name}`, title: name, style: `background:${value}`,
                });
                dot.addEventListener('click', () => setColor(key, value));
                palette.append(dot);
            }
            // Een kleur uit 0.15.0/0.15.1 blijft bruikbaar, maar er kunnen geen nieuwe vrije kleuren worden gekozen.
            if (current && currentValue !== defaults[key].toLowerCase() && !presets.some(([value]) => value.toLowerCase() === currentValue)) {
                const legacy = (0, dom_1.html)('button', {
                    class: 'color-dot legacy selected', type: 'button', role: 'radio', 'aria-checked': 'true',
                    'aria-label': `${(0, i18n_1.t)(labelKey, lang)} – ${isNl ? 'Bestaande aangepaste kleur' : 'Existing custom color'}`,
                    title: isNl ? 'Bestaande aangepaste kleur' : 'Existing custom color', style: `background:${current}`,
                });
                palette.append(legacy);
            }
            grid.append((0, dom_1.html)('div', { class: 'color-field' }, (0, dom_1.html)('span', {}, (0, i18n_1.t)(labelKey, lang)), palette));
        }
        const reset = (0, dom_1.html)('button', { class: 'btn', type: 'button' }, (0, i18n_1.t)('colors_reset', lang));
        reset.addEventListener('click', () => { delete this.config.colors; this.commit(); this.render(); });
        return (0, dom_1.html)('details', {}, (0, dom_1.html)('summary', {}, (0, i18n_1.t)('ed_colors', lang)), (0, dom_1.html)('p', { class: 'hint' }, (0, i18n_1.t)('ed_colors_hint', lang)), grid, (0, dom_1.html)('div', { class: 'color-actions' }, reset));
    }
    renderPreview() {
        const lang = this.uiLang;
        const resolved = this.resolve();
        if (typeof resolved === 'string')
            return this.errorBox(resolved);
        if (resolved.nodes.length <= 1 && !resolved.demo)
            return (0, dom_1.html)('p', { class: 'hint' }, (0, i18n_1.t)('ed_add_first', lang));
        const demo = (0, dom_1.html)('input', { type: 'checkbox' });
        demo.checked = this.config.demo === true;
        demo.addEventListener('change', () => {
            if (demo.checked)
                this.config.demo = true;
            else
                delete this.config.demo;
            this.commit();
            this.render();
        });
        const layoutSelect = (0, dom_1.html)('select');
        for (const [value, key] of [
            ['flow', 'ed_layout_flow'],
            ['circle', 'ed_layout_circle'],
            ['straight', 'ed_layout_straight'],
        ]) {
            const option = (0, dom_1.html)('option', { value }, (0, i18n_1.t)(key, lang));
            const current = this.config.layout?.mode === 'circle' ? 'circle' : this.config.layout?.mode === 'straight' ? 'straight' : 'flow';
            if (current === value)
                option.selected = true;
            layoutSelect.append(option);
        }
        layoutSelect.addEventListener('change', () => {
            const layout = { ...(this.config.layout ?? {}) };
            if (layoutSelect.value === 'circle')
                layout.mode = 'circle';
            else if (layoutSelect.value === 'straight')
                layout.mode = 'straight';
            else
                layout.mode = 'flow';
            if (Object.keys(layout).length > 0)
                this.config.layout = layout;
            else
                delete this.config.layout;
            this.commit();
            this.render();
        });
        const card = document.createElement('energy-flow-card');
        try {
            card.setConfig(this.config);
        }
        catch (err) {
            return this.errorBox(err instanceof Error ? err.message : String(err));
        }
        if (this._hass)
            card.hass = this._hass;
        this.preview = card;
        return (0, dom_1.html)('div', { class: 'stack' }, (0, dom_1.html)('p', { class: 'hint' }, (0, i18n_1.t)('ed_preview_hint', lang)), this.field((0, i18n_1.t)('ed_layout', lang), layoutSelect), this.renderColors(), card, (0, dom_1.html)('label', { class: 'check' }, demo, (0, i18n_1.t)('ed_demo', lang)));
    }
    errorBox(message) {
        return (0, dom_1.html)('div', { class: 'error' }, `${(0, i18n_1.t)('ed_fix_first', this.uiLang)} ${message}`);
    }
}
exports.EnergyFlowCardEditor = EnergyFlowCardEditor;

};
__mods["src/helpers/diagnosticsHelper"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDiagnostics = computeDiagnostics;
exports.highestSeverity = highestSeverity;
const DEFAULT_STALE_MINUTES = 15;
const DEFAULT_BALANCE_TOLERANCE_WATTS = 100;
function add(map, id, item) {
    map.set(id, [...(map.get(id) ?? []), item]);
}
function primaryPowerEntities(node) {
    if (node.groupMembers?.length)
        return [];
    if (node.type === 'battery' && node.config.charge_power_entity && node.config.discharge_power_entity) {
        return [node.config.charge_power_entity, node.config.discharge_power_entity];
    }
    const id = node.config.power_entity ?? node.config.production_entity;
    return id ? [id] : [];
}
function entityAgeMinutes(hass, entityId, now) {
    const entity = hass.states[entityId];
    if (!entity)
        return null;
    const stamp = entity.last_updated ?? entity.last_changed;
    if (!stamp)
        return null;
    const ms = Date.parse(stamp);
    if (!Number.isFinite(ms))
        return null;
    return Math.max(0, (now - ms) / 60_000);
}
function sourceBalanceAtHome(homeId, nodes, connections, flows) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let value = 0;
    let known = 0;
    let total = 0;
    for (const conn of connections) {
        if (conn.from !== homeId && conn.to !== homeId)
            continue;
        const otherId = conn.from === homeId ? conn.to : conn.from;
        const other = byId.get(otherId);
        if (!other || other.role === 'consumer')
            continue;
        total++;
        const flow = flows.get(conn.id);
        if (flow === null || flow === undefined)
            continue;
        known++;
        value += conn.to === homeId ? flow : -flow;
    }
    return { value, known, total };
}
/**
 * Lightweight live diagnostics. It deliberately avoids guessing electrical faults: it only reports
 * sensor health, a measurable Home/source mismatch and how much Home load is not represented by
 * explicitly configured consumer nodes.
 */
function computeDiagnostics(nodes, connections, readings, sourceFlows, hass, options = {}, now = Date.now()) {
    const byNode = new Map();
    const staleMinutes = options.staleMinutes ?? DEFAULT_STALE_MINUTES;
    const balanceTolerance = options.balanceToleranceWatts ?? DEFAULT_BALANCE_TOLERANCE_WATTS;
    if (hass) {
        for (const node of nodes) {
            const primary = primaryPowerEntities(node);
            if (node.role !== 'home' && node.type !== 'backup' && !node.groupMembers?.length && primary.length === 0) {
                add(byNode, node.id, { code: 'sensor_not_configured', severity: 'warning', labelKey: 'diag_sensor_not_configured' });
            }
            for (const entityId of primary) {
                const entity = hass.states[entityId];
                if (!entity) {
                    add(byNode, node.id, { code: 'sensor_missing', severity: 'error', labelKey: 'diag_sensor_missing', detail: entityId });
                    continue;
                }
                if (entity.state === 'unavailable') {
                    add(byNode, node.id, { code: 'sensor_unavailable', severity: 'error', labelKey: 'diag_sensor_unavailable', detail: entityId });
                    continue;
                }
                if (entity.state === 'unknown') {
                    add(byNode, node.id, { code: 'sensor_unknown', severity: 'warning', labelKey: 'diag_sensor_unknown', detail: entityId });
                    continue;
                }
                const age = entityAgeMinutes(hass, entityId, now);
                if (age !== null && age > staleMinutes) {
                    add(byNode, node.id, { code: 'sensor_stale', severity: 'warning', labelKey: 'diag_sensor_stale', detail: entityId, minutes: age });
                }
            }
        }
    }
    const home = nodes.find((node) => node.role === 'home');
    let balanceDifferenceWatts = null;
    let unmeteredConsumptionWatts = null;
    if (home) {
        const homeReading = readings.get(home.id);
        const measuredHome = !!home.config.power_entity;
        if (homeReading?.watts !== null && homeReading?.watts !== undefined) {
            // Only call this a true balance diagnostic when Home is independently measured.
            if (measuredHome) {
                const source = sourceBalanceAtHome(home.id, nodes, connections, sourceFlows);
                if (source.total > 0 && source.known === source.total) {
                    balanceDifferenceWatts = homeReading.watts - Math.max(0, source.value);
                    if (Math.abs(balanceDifferenceWatts) > balanceTolerance) {
                        add(byNode, home.id, {
                            code: 'balance_mismatch',
                            severity: 'warning',
                            labelKey: 'diag_balance_difference',
                            watts: balanceDifferenceWatts,
                        });
                    }
                }
            }
            // Sum only consumer branches connected directly to Home. Children behind another measured consumer
            // are a breakdown of that parent and must not be counted twice. Backup is an aggregate and excluded.
            const directConsumerIds = new Set(connections
                .filter((c) => c.from === home.id)
                .map((c) => c.to));
            let consumerTotal = 0;
            let knownConsumers = 0;
            for (const node of nodes) {
                if (node.role !== 'consumer' || node.type === 'backup' || !directConsumerIds.has(node.id))
                    continue;
                const reading = readings.get(node.id);
                if (!reading || reading.watts === null)
                    continue;
                knownConsumers++;
                consumerTotal += Math.max(0, reading.watts);
            }
            if (knownConsumers > 0) {
                unmeteredConsumptionWatts = homeReading.watts - consumerTotal;
                if (unmeteredConsumptionWatts < -balanceTolerance) {
                    add(byNode, home.id, {
                        code: 'consumers_exceed_home',
                        severity: 'warning',
                        labelKey: 'diag_consumers_exceed_home',
                        watts: -unmeteredConsumptionWatts,
                    });
                }
            }
        }
    }
    return { byNode, balanceDifferenceWatts, unmeteredConsumptionWatts };
}
function highestSeverity(items) {
    if (!items?.length)
        return undefined;
    if (items.some((item) => item.severity === 'error'))
        return 'error';
    if (items.some((item) => item.severity === 'warning'))
        return 'warning';
    return 'info';
}

};
__mods["src/helpers/energyStatsHelper"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchEnergyStats = fetchEnergyStats;
exports.demoEnergyStats = demoEnergyStats;
const pricingHelper_1 = __req("src/helpers/pricingHelper");
function energyToKWh(value, unit) {
    const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
    if (u === 'wh')
        return value / 1000;
    if (u === 'mwh')
        return value * 1000;
    return value;
}
function rangeFor(period, now = Date.now()) {
    const d = new Date(now);
    if (period === 'today') {
        d.setHours(0, 0, 0, 0);
        return { start: d.getTime(), end: now };
    }
    if (period === 'week') {
        d.setHours(0, 0, 0, 0);
        const weekday = (d.getDay() + 6) % 7; // maandag = 0
        d.setDate(d.getDate() - weekday);
        return { start: d.getTime(), end: now };
    }
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return { start: d.getTime(), end: now };
}
function finiteState(hass, entityId) {
    if (!entityId)
        return null;
    const state = hass.states[entityId];
    if (!state || state.state === 'unknown' || state.state === 'unavailable')
        return null;
    const n = Number(String(state.state).replace(',', '.'));
    if (!Number.isFinite(n))
        return null;
    return energyToKWh(n, state.attributes?.unit_of_measurement);
}
function rawHistoryMap(response, ids) {
    const byId = new Map();
    for (let i = 0; i < (response ?? []).length; i++) {
        const arr = response?.[i] ?? [];
        const id = arr.find((x) => x.entity_id)?.entity_id ?? ids[i];
        if (id)
            byId.set(id, arr);
    }
    return byId;
}
function deltaForEntity(hass, entityId, states, start, end) {
    if (!entityId)
        return null;
    const current = hass.states[entityId];
    if (!current)
        return null;
    const unit = current.attributes?.unit_of_measurement;
    const points = [];
    for (const s of states) {
        const n = Number(String(s.state).replace(',', '.'));
        const stamp = s.last_changed ?? s.last_updated;
        if (!Number.isFinite(n) || !stamp)
            continue;
        points.push({ t: Date.parse(stamp), v: energyToKWh(n, unit) });
    }
    const live = finiteState(hass, entityId);
    if (live !== null)
        points.push({ t: end, v: live });
    points.sort((a, b) => a.t - b.t);
    if (points.length === 0)
        return null;
    let baseline = points[0].v;
    for (const p of points) {
        if (p.t <= start)
            baseline = p.v;
        else
            break;
    }
    let total = 0;
    let previous = baseline;
    for (const p of points) {
        if (p.t <= start || p.t > end)
            continue;
        let delta = p.v - previous;
        if (delta < 0)
            delta = p.v; // total_increasing reset / daily reset
        if (delta > 0)
            total += delta;
        previous = p.v;
    }
    return total;
}
function chooseEnergyEntity(node, period, totalKey, todayKey) {
    const total = typeof node.config[totalKey] === 'string' ? String(node.config[totalKey]) : undefined;
    const today = todayKey && typeof node.config[todayKey] === 'string' ? String(node.config[todayKey]) : undefined;
    return period === 'today' ? (today ?? total) : total;
}
function sumKnown(values) {
    if (values.length === 0 || values.some((v) => v === null))
        return null;
    let total = 0;
    for (const value of values)
        total += value ?? 0;
    return total;
}
async function fetchEnergyStats(hass, cfg, period, pricing, now = Date.now()) {
    if (!hass.callApi)
        return null;
    const { start, end } = rangeFor(period, now);
    const grid = cfg.nodes.find((n) => n.type === 'grid');
    if (!grid)
        return null;
    const importEntity = grid.config.energy_import_entity;
    const exportEntity = grid.config.energy_export_entity;
    const solarNodes = cfg.nodes.filter((n) => n.type === 'solar' || n.type === 'producer');
    const batteryNodes = cfg.nodes.filter((n) => n.type === 'battery');
    const solarEntities = solarNodes.map((n) => chooseEnergyEntity(n, period, 'energy_total_entity', 'energy_today_entity'));
    const chargedEntities = batteryNodes.map((n) => chooseEnergyEntity(n, period, 'energy_charged_entity'));
    const dischargedEntities = batteryNodes.map((n) => chooseEnergyEntity(n, period, 'energy_discharged_entity'));
    const ids = [...new Set([
            importEntity,
            exportEntity,
            ...solarEntities,
            ...chargedEntities,
            ...dischargedEntities,
        ].filter((x) => !!x))];
    const path = ids.length
        ? `history/period/${new Date(start).toISOString()}?filter_entity_id=${encodeURIComponent(ids.join(','))}` +
            `&end_time=${encodeURIComponent(new Date(end).toISOString())}&minimal_response&no_attributes&significant_changes_only`
        : '';
    let byId = new Map();
    if (path) {
        try {
            const response = await hass.callApi('GET', path);
            byId = rawHistoryMap(response, ids);
        }
        catch {
            return null;
        }
    }
    const delta = (id) => id ? deltaForEntity(hass, id, byId.get(id) ?? [], start, end) : null;
    const importKWh = delta(importEntity);
    const exportKWh = delta(exportEntity);
    const solarValues = solarEntities.map(delta);
    const chargedValues = chargedEntities.map(delta);
    const dischargedValues = dischargedEntities.map(delta);
    const solarKWh = solarNodes.length === 0 ? 0 : sumKnown(solarValues);
    const batteryChargedKWh = batteryNodes.length === 0 ? 0 : sumKnown(chargedValues);
    const batteryDischargedKWh = batteryNodes.length === 0 ? 0 : sumKnown(dischargedValues);
    let consumptionKWh = null;
    if (importKWh !== null && exportKWh !== null && solarKWh !== null && batteryChargedKWh !== null && batteryDischargedKWh !== null) {
        consumptionKWh = Math.max(0, importKWh + solarKWh + batteryDischargedKWh - exportKWh - batteryChargedKWh);
    }
    const financials = pricing.mode === 'none'
        ? null
        : await (0, pricingHelper_1.fetchGridFinancialsRange)(hass, importEntity, exportEntity, pricing, start, end);
    const selfConsumptionPct = solarKWh !== null && solarKWh > 0 && exportKWh !== null
        ? Math.max(0, Math.min(100, ((solarKWh - Math.min(solarKWh, exportKWh)) / solarKWh) * 100))
        : null;
    const selfSufficiencyPct = consumptionKWh !== null && consumptionKWh > 0 && importKWh !== null
        ? Math.max(0, Math.min(100, (1 - importKWh / consumptionKWh) * 100))
        : null;
    return {
        period,
        start,
        end,
        consumptionKWh,
        importKWh,
        exportKWh,
        solarKWh,
        batteryChargedKWh,
        batteryDischargedKWh,
        importCost: financials?.importCost ?? null,
        exportRevenue: financials?.exportRevenue ?? null,
        netCost: financials ? financials.importCost - financials.exportRevenue : null,
        selfConsumptionPct,
        selfSufficiencyPct,
    };
}
function demoEnergyStats(period, now = Date.now()) {
    const factor = period === 'today' ? 1 : period === 'week' ? 4.6 : 18.2;
    const importKWh = 12.1 * factor;
    const exportKWh = 4.6 * factor;
    const solarKWh = 15.8 * factor;
    const batteryChargedKWh = 3.4 * factor;
    const batteryDischargedKWh = 2.8 * factor;
    const consumptionKWh = importKWh + solarKWh + batteryDischargedKWh - exportKWh - batteryChargedKWh;
    const { start, end } = rangeFor(period, now);
    const importCost = importKWh * 0.31;
    const exportRevenue = exportKWh * 0.09;
    return {
        period, start, end, consumptionKWh, importKWh, exportKWh, solarKWh, batteryChargedKWh, batteryDischargedKWh,
        importCost, exportRevenue, netCost: importCost - exportRevenue,
        selfConsumptionPct: ((solarKWh - Math.min(solarKWh, exportKWh)) / solarKWh) * 100,
        selfSufficiencyPct: (1 - importKWh / consumptionKWh) * 100,
    };
}

};
__mods["src/helpers/flowHelper"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flowToHome = flowToHome;
exports.isCharging = isCharging;
exports.readNode = readNode;
exports.computeFlows = computeFlows;
exports.computeHomeReading = computeHomeReading;
exports.applyBackupReadings = applyBackupReadings;
const EntityStatus_1 = __req("src/types/EntityStatus");
const stateHelper_1 = __req("src/helpers/stateHelper");
/** Energie die deze node richting Home stuurt (negatief = neemt energie van Home af). */
function flowToHome(node, reading) {
    if (reading.watts === null)
        return null;
    return node.role === 'consumer' ? -reading.watts : reading.watts;
}
function negateSafe(n) {
    return n === 0 ? 0 : -n;
}
const SEVERITY = [EntityStatus_1.EntityStatus.Unavailable, EntityStatus_1.EntityStatus.Unknown, EntityStatus_1.EntityStatus.Invalid];
function worstStatus(a, b) {
    for (const s of SEVERITY)
        if (a === s || b === s)
            return s;
    return EntityStatus_1.EntityStatus.Invalid;
}
function isCharging(node, watts) {
    if (watts === null)
        return false;
    if (node.type === 'battery')
        return watts < 0;
    if (node.type === 'ev_charger')
        return watts > 0;
    return false;
}
/** Leest het vermogen van één node live uit Home Assistant. */
function readNode(node, hass) {
    const cfg = node.config;
    let base;
    if (node.type === 'battery' && cfg.charge_power_entity && cfg.discharge_power_entity) {
        const charge = (0, stateHelper_1.readPower)(hass, cfg.charge_power_entity);
        const discharge = (0, stateHelper_1.readPower)(hass, cfg.discharge_power_entity);
        if (charge.value !== null && discharge.value !== null) {
            const net = discharge.value - charge.value;
            base = { status: net === 0 ? EntityStatus_1.EntityStatus.Zero : EntityStatus_1.EntityStatus.Valid, value: net };
        }
        else {
            const status = worstStatus(charge.status, discharge.status);
            base = { status: (0, EntityStatus_1.hasValue)(status) ? EntityStatus_1.EntityStatus.Invalid : status, value: null };
        }
    }
    else {
        base = (0, stateHelper_1.readPower)(hass, cfg.power_entity ?? cfg.production_entity);
    }
    let watts = base.value;
    if (watts !== null && node.invert)
        watts = negateSafe(watts);
    const reading = {
        status: base.status,
        watts,
        charging: isCharging(node, watts),
    };
    if (cfg.soc_entity)
        reading.soc = (0, stateHelper_1.readNumber)(hass, cfg.soc_entity);
    return reading;
}
function supply(node, reading) {
    const f = flowToHome(node, reading);
    return f === null ? null : Math.max(0, f);
}
function demand(node, reading) {
    const f = flowToHome(node, reading);
    return f === null ? null : Math.max(0, -f);
}
/**
 * Bepaalt per verbinding hoeveel energie er stroomt: positief = van `from` naar `to`,
 * 0 = stil, null = onbekend (ongeldige sensor).
 */
function computeFlows(nodes, connections, readings, hass, options = {}) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const result = new Map();
    for (const conn of connections) {
        const from = byId.get(conn.from);
        const to = byId.get(conn.to);
        if (!from || !to)
            continue;
        let value;
        if (conn.entity && !options.ignoreEntities) {
            value = (0, stateHelper_1.readPower)(hass, conn.entity).value;
        }
        else {
            const fromReading = readings.get(from.id);
            const toReading = readings.get(to.id);
            // Home en hiërarchische verbruikers hebben een duidelijke parent → child richting.
            // Voor parent → child gebruiken we altijd het childvermogen als takvermogen; het parentvermogen blijft
            // het gemeten totaal op de inkomende tak en wordt daardoor niet dubbel bij Home opgeteld.
            const isConsumerHub = (node) => node.type === 'backup' || node.role === 'consumer';
            const isChild = (node) => node.role === 'consumer' && node.type !== 'backup';
            if (to.role === 'home' && fromReading) {
                value = flowToHome(from, fromReading);
            }
            else if (from.role === 'home' && toReading) {
                const f = flowToHome(to, toReading);
                value = f === null ? null : negateSafe(f);
            }
            else if (isConsumerHub(from) && isChild(to) && toReading) {
                const f = flowToHome(to, toReading);
                value = f === null ? null : negateSafe(f);
            }
            else if (isConsumerHub(to) && isChild(from) && fromReading) {
                value = flowToHome(from, fromReading);
            }
            else if (fromReading && toReading) {
                // Tussen twee nodes zonder Home: schat de stroom als het kleinste van aanbod en vraag.
                const fwdSupply = supply(from, fromReading);
                const fwdDemand = demand(to, toReading);
                const backSupply = supply(to, toReading);
                const backDemand = demand(from, fromReading);
                if ([fwdSupply, fwdDemand, backSupply, backDemand].includes(null))
                    value = null;
                else
                    value = Math.min(fwdSupply, fwdDemand) - Math.min(backSupply, backDemand);
            }
            else {
                value = null;
            }
        }
        if (value !== null) {
            if (conn.invert)
                value = negateSafe(value);
            if (!conn.bidirectional && value < 0)
                value = 0;
        }
        result.set(conn.id, value);
    }
    return result;
}
/**
 * Wat er in de woning gebeurt, berekend uit wat er binnenkomt: net (afname min teruglevering) + zon
 * + batterij (ontladen min laden) + generator. De losse apparaten (verbruikers, backup) zijn een deel van
 * dat verbruik en worden er dus niet vanaf getrokken. Home heeft daarom geen eigen sensor.
 *
 * Zonder net, zon of batterij is er niets om uit te rekenen; dan is Home de som van wat de apparaten gebruiken.
 * Is een stroom van een bron onbekend (ongeldige sensor), dan is de uitkomst onbetrouwbaar ("?").
 */
function computeHomeReading(home, nodes, connections, flows) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const unknown = { status: EntityStatus_1.EntityStatus.Invalid, watts: null, charging: false };
    let supply = 0;
    let demand = 0;
    let hasSource = false;
    let knownSources = 0;
    let hasConsumer = false;
    let knownConsumers = 0;
    for (const conn of connections) {
        if (conn.to !== home.id && conn.from !== home.id)
            continue;
        const other = byId.get(conn.to === home.id ? conn.from : conn.to);
        if (!other)
            continue;
        const f = flows.get(conn.id);
        if (other.role === 'consumer') {
            hasConsumer = true;
            if (f !== null && f !== undefined) {
                knownConsumers++;
                demand += conn.from === home.id ? f : -f;
            }
        }
        else {
            hasSource = true;
            if (f !== null && f !== undefined) {
                knownSources++;
                supply += conn.to === home.id ? f : -f;
            }
        }
    }
    if (!hasSource && !hasConsumer)
        return unknown;
    // Een ontbrekende losse sensor maakt niet meer de complete woning ongeldig. Als er minstens één
    // bruikbare bronstroom is tonen we de bekende energiebalans; zonder bronnen vallen we terug op de
    // bekende verbruikers. Wie een exacte woningwaarde wil kan met een eigen woningsensor instellen.
    if (hasSource && knownSources === 0) {
        if (knownConsumers === 0)
            return unknown;
        const watts = Math.max(0, demand);
        return { status: watts === 0 ? EntityStatus_1.EntityStatus.Zero : EntityStatus_1.EntityStatus.Valid, watts, charging: false };
    }
    if (!hasSource && knownConsumers === 0)
        return unknown;
    const watts = Math.max(0, hasSource ? supply : demand);
    return { status: watts === 0 ? EntityStatus_1.EntityStatus.Zero : EntityStatus_1.EntityStatus.Valid, watts, charging: false };
}
/**
 * Een backup die de gebruiker niet zelf meet, gebruikt precies wat de apparaten erachter gebruiken.
 * Heeft de backup een eigen sensor (`power_entity`), dan geldt die: de omvormer meet de backup-uitgang dan zelf.
 * In demo-modus blijft de verzonnen waarde staan zolang er geen apparaten achter hangen.
 */
function applyBackupReadings(nodes, connections, readings, demo) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const backup of nodes) {
        if (backup.type !== 'backup')
            continue;
        if (!demo && backup.config.power_entity)
            continue;
        const devices = [];
        for (const conn of connections) {
            const otherId = conn.from === backup.id ? conn.to : conn.to === backup.id ? conn.from : null;
            const other = otherId ? byId.get(otherId) : undefined;
            if (other && other.role === 'consumer' && other.type !== 'backup')
                devices.push(other);
        }
        if (devices.length === 0) {
            if (!demo)
                readings.set(backup.id, { status: EntityStatus_1.EntityStatus.Invalid, watts: null, charging: false });
            continue;
        }
        let total = 0;
        let known = true;
        for (const device of devices) {
            const r = readings.get(device.id);
            const d = r ? demand(device, r) : null;
            if (d === null)
                known = false;
            else
                total += d;
        }
        readings.set(backup.id, known
            ? { status: total === 0 ? EntityStatus_1.EntityStatus.Zero : EntityStatus_1.EntityStatus.Valid, watts: total, charging: false }
            : { status: EntityStatus_1.EntityStatus.Invalid, watts: null, charging: false });
    }
}

};
__mods["src/helpers/groupHelper"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupedGroups = groupedGroups;
exports.createGroupNode = createGroupNode;
exports.buildDisplayGraph = buildDisplayGraph;
exports.applyGroupReadings = applyGroupReadings;
const Connection_1 = __req("src/models/Connection");
const Node_1 = __req("src/models/Node");
const EntityStatus_1 = __req("src/types/EntityStatus");
function groupedGroups(cfg) {
    return cfg.groups.filter((g) => g.display === 'grouped');
}
function createGroupNode(group) {
    const id = `group_${group.id}`;
    return (0, Node_1.createNode)({
        id,
        name: group.name,
        type: group.type,
        icon: group.icon,
        group_members: group.memberIds,
    }, group.type, id);
}
/**
 * Maakt alleen voor de presentatie een compacte graaf. Onderliggende nodes blijven in de
 * echte configuratie bestaan, zodat live berekeningen en history dezelfde data blijven gebruiken.
 */
function buildDisplayGraph(cfg) {
    const active = groupedGroups(cfg);
    if (active.length === 0)
        return { nodes: cfg.nodes, connections: cfg.connections, groupNodes: new Map() };
    const hidden = new Set(active.flatMap((g) => g.memberIds));
    const nodes = cfg.nodes.filter((n) => !hidden.has(n.id));
    const connections = cfg.connections.filter((c) => !hidden.has(c.from) && !hidden.has(c.to));
    const groupNodes = new Map();
    const byId = new Map(cfg.nodes.map((n) => [n.id, n]));
    for (const group of active) {
        const groupNode = createGroupNode(group);
        groupNodes.set(groupNode.id, groupNode);
        nodes.push(groupNode);
        const parent = byId.get(group.parentId) ?? nodes.find((n) => n.role === 'home');
        if (!parent)
            continue;
        const from = groupNode.role === 'consumer' ? parent : groupNode;
        const to = groupNode.role === 'consumer' ? groupNode : parent;
        connections.push((0, Connection_1.createConnection)(`${from.id}__${to.id}`, from, to));
    }
    return { nodes, connections, groupNodes };
}
/** Sommeer groepsleden. Bekende waarden worden opgeteld; pas als niets bruikbaar is wordt de groep '?'. */
function applyGroupReadings(groups, groupNodes, readings) {
    for (const group of groups) {
        if (group.display !== 'grouped')
            continue;
        const groupNode = groupNodes.get(`group_${group.id}`);
        if (!groupNode)
            continue;
        let total = 0;
        let known = 0;
        for (const id of group.memberIds) {
            const r = readings.get(id);
            if (r?.watts !== null && r?.watts !== undefined) {
                total += r.watts;
                known++;
            }
        }
        readings.set(groupNode.id, known > 0
            ? { status: total === 0 ? EntityStatus_1.EntityStatus.Zero : EntityStatus_1.EntityStatus.Valid, watts: total, charging: false }
            : { status: EntityStatus_1.EntityStatus.Invalid, watts: null, charging: false });
    }
}

};
__mods["src/helpers/historyHelper"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchHistoryBatch = fetchHistoryBatch;
exports.fetchHistory = fetchHistory;
exports.bucketize = bucketize;
exports.unitFactor = unitFactor;
const stateHelper_1 = __req("src/helpers/stateHelper");
const HOUR = 3_600_000;
/**
 * Haalt de geschiedenis van meerdere vermogenssensoren in één Home Assistant-request op.
 * Alle waarden worden direct omgerekend naar W, zodat de kaart daarna één gezamenlijke
 * tijdlijn kan opbouwen voor nodes, verbindingen en de berekende Woning-node.
 */
async function fetchHistoryBatch(hass, entityIds, hours, now = Date.now()) {
    const uniqueIds = [...new Set(entityIds.filter(Boolean))];
    const result = new Map(uniqueIds.map((id) => [id, []]));
    if (!hass.callApi || uniqueIds.length === 0)
        return result;
    const startMs = now - hours * HOUR;
    const start = new Date(startMs).toISOString();
    const filter = uniqueIds.join(',');
    const path = `history/period/${start}?filter_entity_id=${encodeURIComponent(filter)}` +
        `&end_time=${encodeURIComponent(new Date(now).toISOString())}` +
        `&minimal_response&no_attributes&significant_changes_only`;
    const response = await hass.callApi('GET', path);
    for (let index = 0; index < (response ?? []).length; index++) {
        const states = response?.[index] ?? [];
        // Bij minimal_response staat entity_id doorgaans alleen op het eerste item. Als HA dit
        // niet terugstuurt, valt de API-volgorde terug op de volgorde uit filter_entity_id.
        const entityId = states.find((s) => typeof s.entity_id === 'string')?.entity_id ?? uniqueIds[index];
        if (!entityId || !result.has(entityId))
            continue;
        const factor = unitFactor(hass.states[entityId]?.attributes.unit_of_measurement);
        const points = result.get(entityId);
        for (const s of states) {
            const value = (0, stateHelper_1.parsePower)(s.state);
            const stamp = s.last_changed ?? s.last_updated;
            if (value === null || !stamp)
                continue;
            points.push({ t: Math.max(Date.parse(stamp), startMs), v: value * factor });
        }
    }
    return result;
}
/** Achterwaarts compatibele single-entity helper. */
async function fetchHistory(hass, entityId, hours, unitFactorOverride, invert, now = Date.now()) {
    const batch = await fetchHistoryBatch(hass, [entityId], hours, now);
    // `fetchHistoryBatch` gebruikt de actuele HA-eenheid. De oude API accepteerde expliciet
    // een factor; pas alleen het verschil toe zodat bestaande tests/callers correct blijven.
    const actualFactor = unitFactor(hass.states[entityId]?.attributes.unit_of_measurement);
    const ratio = actualFactor === 0 ? 1 : unitFactorOverride / actualFactor;
    return (batch.get(entityId) ?? []).map((p) => ({ t: p.t, v: (invert ? -p.v : p.v) * ratio }));
}
/**
 * Brengt een onregelmatige reeks terug tot een vast aantal punten door per interval de
 * laatste bekende waarde vast te houden (zoals een sensor werkt: waarde geldt tot de volgende).
 */
function bucketize(points, start, end, buckets) {
    if (points.length === 0 || buckets < 2 || end <= start)
        return [];
    const sorted = [...points].sort((a, b) => a.t - b.t);
    const step = (end - start) / (buckets - 1);
    const out = [];
    let i = 0;
    let last = null;
    for (let b = 0; b < buckets; b++) {
        const t = start + b * step;
        while (i < sorted.length && sorted[i].t <= t) {
            last = sorted[i].v;
            i++;
        }
        if (last !== null)
            out.push({ t, v: last });
    }
    return out;
}
/** Eenheidsfactor naar W voor een entiteit, op basis van haar eenheid. */
function unitFactor(unit) {
    const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
    if (u === 'kw')
        return 1000;
    if (u === 'mw')
        return 1_000_000;
    return 1;
}

};
__mods["src/helpers/i18n"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.t = t;
exports.hassLanguage = hassLanguage;
/** Alle teksten van de kaart, in het Nederlands en het Engels. */
const nl = {
    home: "Woning",
    grid: "Net",
    solar: "Zonnepanelen",
    battery: "Batterij",
    charging: "Laden",
    discharging: "Ontladen",
    importing: "Afname",
    exporting: "Teruglevering",
    current_power: "Huidig vermogen",
    last_24h: "Afgelopen 24 uur",
    no_history: "Geen geschiedenis beschikbaar",
    loading: "Laden…",
    close: "Sluiten",
    unavailable: "Niet beschikbaar",
    unknown: "Onbekend",
    invalid: "Ongeldige waarde",
    home_computed: "Berekend uit de energiestromen",
    home_measured: "Gemeten met de ingestelde woningsensor",
    minimum: "Min",
    maximum: "Max",
    peak_power: "Piekvermogen",
    peak_time: "Piek om",
    average_power: "Gemiddeld vermogen",
    soc: "Laadtoestand",
    voltage: "Spanning",
    current: "Stroom",
    temperature: "Temperatuur",
    inverter_temperature: "Temperatuur omvormer",
    production: "Productie",
    energy_today: "Vandaag geproduceerd",
    energy_total: "Totaal geproduceerd",
    energy_consumed_today: "Vandaag verbruikt",
    energy_consumed_total: "Totaal verbruikt",
    energy_import: "Afgenomen",
    energy_export: "Teruggeleverd",
    energy_charged: "Geladen",
    energy_discharged: "Ontladen",
    charge_power: "Laadvermogen",
    discharge_power: "Ontlaadvermogen",
    phase_l1_power: "L1 vermogen",
    phase_l1_power_calculated: "L1 vermogen (berekend)",
    phase_l1_auto_hint: "Laat L1 leeg als je meter alleen totaal, L2 en L3 levert; L1 wordt dan automatisch berekend.",
    phase_l2_power: "L2 vermogen",
    phase_l3_power: "L3 vermogen",
    phase_l1_voltage: "L1 spanning",
    phase_l2_voltage: "L2 spanning",
    phase_l3_voltage: "L3 spanning",
    phase_l1_current: "L1 stroom",
    phase_l2_current: "L2 stroom",
    phase_l3_current: "L3 stroom",
    show_phases: "Toon fasen",
    phase_graph_hint: "Toon L1, L2 en L3 in de grafiek",
    inspect_graph: "Bekijk vermogen op een tijdstip",
    total_power: "Totaal",
    demo_badge: "Demo",
    empty_title: "Nog geen apparaten",
    empty_hint: "Voeg nodes toe in de configuratie, of zet demo: true aan om de kaart te proberen.",
    type_solar: "Zonnepanelen",
    type_grid: "Net",
    type_battery: "Batterij",
    type_consumer: "Verbruiker",
    type_ev_charger: "Laadpaal",
    type_heat_pump: "Warmtepomp",
    type_boiler: "Boiler",
    type_airco: "Airco",
    type_generator: "Generator",
    type_producer: "Andere producent",
    type_backup: "Backup",
    ed_step_devices: "Apparaten",
    ed_step_connections: "Verbindingen",
    ed_step_pricing: "Prijzen",
    ed_step_preview: "Voorbeeld",
    ed_home_auto: "De woning wordt automatisch toegevoegd. Voeg de apparaten toe die energie leveren of gebruiken.",
    ed_add_device: "Apparaat toevoegen",
    ed_name: "Naam",
    ed_type: "Type",
    ed_power_entity: "Vermogenssensor",
    ed_advanced: "Geavanceerd",
    ed_remove: "Verwijderen",
    ed_icon: "Icoon",
    ed_custom_icon: "Aangepast MDI-icoon",
    ed_groups: "Groepen",
    ed_groups_hint: "Groepen zijn optioneel. Gegroepeerd toont één node met het totale vermogen; individueel laat de apparaten los zien.",
    ed_add_group: "Groep toevoegen",
    ed_group: "Groep",
    ed_group_name: "Groepsnaam",
    ed_group_display: "Weergave",
    ed_group_members: "Apparaten",
    ed_grouped: "Gegroepeerd (totaal)",
    ed_individual: "Los tonen",
    group_total_of: "Totaal van apparaten:",
    icon_auto: "Automatisch",
    icon_solar: "Zonnepanelen",
    icon_battery: "Batterij",
    icon_heat_pump: "Warmtepomp",
    icon_airco: "Airco",
    icon_ev: "Laadpaal",
    icon_washing_machine: "Wasmachine",
    icon_dishwasher: "Vaatwasser",
    icon_pc: "Computer",
    icon_server: "Server",
    icon_light: "Verlichting",
    icon_pump: "Pomp",
    icon_socket: "Stopcontact",
    icon_backup: "Generator / backup",
    icon_home_battery: "Thuisaccu",
    icon_boiler: "Boiler",
    icon_radiator: "Radiator",
    icon_fan: "Ventilator",
    icon_custom: "Aangepast…",
    ed_invert: "Teken omdraaien",
    ed_home_entity: "Eigen sensor voor de woning (optioneel)",
    ed_connected_home: "Verbonden met de woning",
    ed_other_connections: "Andere verbindingen",
    ed_from: "Van",
    ed_to: "Naar",
    ed_add_connection: "Verbinding toevoegen",
    ed_none_yet: "Nog geen andere verbindingen.",
    ed_demo: "Demo-modus: toon voorbeeldwaarden in plaats van echte sensoren",
    ed_preview_hint: "Zo ziet de kaart eruit. Klik op Opslaan om hem toe te voegen aan je dashboard.",
    ed_next: "Volgende",
    ed_back: "Terug",
    ed_fix_first: "Los eerst dit op in stap 1:",
    ed_add_first: "Voeg eerst een apparaat toe.",
    ed_connected_to: "Aangesloten op",
    ed_layout: "Weergave",
    ed_layout_flow: "Flow: automatisch en compact",
    ed_layout_circle: "Rond: vaste plekken rond de woning",
    ed_layout_straight: "Recht: van boven naar beneden",
    ed_colors: "Kleuren",
    ed_colors_hint: "Kies per energietype uit een vaste set goed leesbare kleuren. Laat Standaard staan als je niets wilt wijzigen.",
    colors_reset: "Standaardkleuren herstellen",
    color_solar: "Zonnepanelen",
    color_grid: "Net",
    color_battery: "Batterij",
    color_home: "Woning",
    color_consumer: "Verbruikers",
    color_ev: "Laadpaal",
    color_backup: "Backup",
    color_generator: "Generator",
    color_producer: "Producent",
    ed_pricing: "Energieprijzen",
    ed_pricing_hint: "Optioneel: gebruik vaste tarieven of prijsentiteiten uit Home Assistant-integraties.",
    pricing_none: "Geen prijsberekening",
    pricing_fixed: "Vaste tarieven",
    pricing_entities: "Home Assistant-prijssensoren",
    pricing_mode: "Prijsmodel",
    pricing_import: "Importprijs",
    pricing_export: "Exportprijs",
    pricing_import_entity: "Import-prijssensor",
    pricing_export_entity: "Export-prijssensor",
    pricing_currency: "Valuta",
    energy_prices: "Energieprijzen",
    price_card_import: "Inkoop",
    price_card_export: "Teruglevering",
    current_import_price: "Huidige importprijs",
    current_export_price: "Huidige exportprijs",
    current_cost_rate: "Kosten op dit moment",
    current_revenue_rate: "Opbrengst op dit moment",
    revenue_today: "Opbrengst vandaag",
    per_hour: "per uur",
    energy_costs: "Energie & kosten",
    period_today: "Vandaag",
    period_week: "Deze week",
    period_month: "Deze maand",
    stat_consumption: "Verbruik",
    stat_import: "Import",
    stat_export: "Teruglevering",
    stat_solar: "Zonneproductie",
    stat_import_cost: "Importkosten",
    stat_export_revenue: "Opbrengst teruglevering",
    stat_net_cost: "Netto kosten",
    stat_self_consumption: "Zelfverbruik",
    stat_self_sufficiency: "Zelfvoorziening",
    energy_stats_unavailable: "Niet genoeg energiedata voor deze periode",
    diagnostics: "Diagnose",
    diag_no_issues: "Geen problemen gedetecteerd",
    diag_attention: "Aandacht nodig",
    diag_sensor_not_configured: "Geen vermogenssensor ingesteld",
    diag_sensor_missing: "Vermogenssensor ontbreekt",
    diag_sensor_unavailable: "Vermogenssensor niet beschikbaar",
    diag_sensor_unknown: "Vermogenssensor onbekend",
    diag_sensor_stale: "Sensor niet recent bijgewerkt",
    diag_balance_difference: "Afwijking energiebalans",
    diag_consumers_exceed_home: "Gemeten apparaten hoger dan Woning",
    diag_unmetered_consumption: "Overig / ongemeten verbruik",
    diag_consumers_over_home: "Verschil t.o.v. Woning",
    minutes_short: "min",
    replay: "Historie",
    replay_live: "Live",
    replay_title: "Historische replay",
    replay_loading: "Geschiedenis laden…",
    replay_hint: "Sleep door de afgelopen 24 uur om de energiestromen van dat moment terug te kijken.",
    replay_no_history: "Niet genoeg geschiedenis voor replay",
    mobile_focus_back: "Terug naar vorige laag",
};
const en = {
    home: "Home",
    grid: "Grid",
    solar: "Solar",
    battery: "Battery",
    charging: "Charging",
    discharging: "Discharging",
    importing: "Importing",
    exporting: "Exporting",
    current_power: "Current power",
    last_24h: "Last 24 hours",
    no_history: "No history available",
    loading: "Loading…",
    close: "Close",
    unavailable: "Unavailable",
    unknown: "Unknown",
    invalid: "Invalid value",
    home_computed: "Calculated from the energy flows",
    home_measured: "Measured with the configured home sensor",
    minimum: "Min",
    maximum: "Max",
    peak_power: "Peak power",
    peak_time: "Peak at",
    average_power: "Average power",
    soc: "State of charge",
    voltage: "Voltage",
    current: "Current",
    temperature: "Temperature",
    inverter_temperature: "Inverter temperature",
    production: "Production",
    energy_today: "Produced today",
    energy_total: "Produced in total",
    energy_consumed_today: "Consumed today",
    energy_consumed_total: "Consumed in total",
    energy_import: "Imported",
    energy_export: "Exported",
    energy_charged: "Charged",
    energy_discharged: "Discharged",
    charge_power: "Charge power",
    discharge_power: "Discharge power",
    phase_l1_power: "L1 power",
    phase_l1_power_calculated: "L1 power (calculated)",
    phase_l1_auto_hint: "Leave L1 empty if your meter only provides total, L2 and L3; L1 will then be calculated automatically.",
    phase_l2_power: "L2 power",
    phase_l3_power: "L3 power",
    phase_l1_voltage: "L1 voltage",
    phase_l2_voltage: "L2 voltage",
    phase_l3_voltage: "L3 voltage",
    phase_l1_current: "L1 current",
    phase_l2_current: "L2 current",
    phase_l3_current: "L3 current",
    show_phases: "Show phases",
    phase_graph_hint: "Show L1, L2 and L3 in the graph",
    inspect_graph: "Inspect power at a point in time",
    total_power: "Total",
    demo_badge: "Demo",
    empty_title: "No devices yet",
    empty_hint: "Add nodes to the configuration, or set demo: true to try the card.",
    type_solar: "Solar panels",
    type_grid: "Grid",
    type_battery: "Battery",
    type_consumer: "Consumer",
    type_ev_charger: "EV charger",
    type_heat_pump: "Heat pump",
    type_boiler: "Boiler",
    type_airco: "Air conditioning",
    type_generator: "Generator",
    type_producer: "Other producer",
    type_backup: "Backup",
    ed_step_devices: "Devices",
    ed_step_connections: "Connections",
    ed_step_pricing: "Prices",
    ed_step_preview: "Preview",
    ed_home_auto: "Home is added automatically. Add the devices that supply or use energy.",
    ed_add_device: "Add device",
    ed_name: "Name",
    ed_type: "Type",
    ed_power_entity: "Power sensor",
    ed_advanced: "Advanced",
    ed_remove: "Remove",
    ed_icon: "Icon",
    ed_custom_icon: "Custom MDI icon",
    ed_groups: "Groups",
    ed_groups_hint: "Groups are optional. Grouped shows one node with the total power; individual keeps devices separate.",
    ed_add_group: "Add group",
    ed_group: "Group",
    ed_group_name: "Group name",
    ed_group_display: "Display",
    ed_group_members: "Devices",
    ed_grouped: "Grouped (total)",
    ed_individual: "Show individually",
    group_total_of: "Total of devices:",
    icon_auto: "Automatic",
    icon_solar: "Solar panels",
    icon_battery: "Battery",
    icon_heat_pump: "Heat pump",
    icon_airco: "Air conditioning",
    icon_ev: "EV charger",
    icon_washing_machine: "Washing machine",
    icon_dishwasher: "Dishwasher",
    icon_pc: "Computer",
    icon_server: "Server",
    icon_light: "Lighting",
    icon_pump: "Pump",
    icon_socket: "Power socket",
    icon_backup: "Generator / backup",
    icon_home_battery: "Home battery",
    icon_boiler: "Boiler",
    icon_radiator: "Radiator",
    icon_fan: "Fan",
    icon_custom: "Custom…",
    ed_invert: "Invert sign",
    ed_home_entity: "Own sensor for the home (optional)",
    ed_connected_home: "Connected to home",
    ed_other_connections: "Other connections",
    ed_from: "From",
    ed_to: "To",
    ed_add_connection: "Add connection",
    ed_none_yet: "No other connections yet.",
    ed_demo: "Demo mode: show sample values instead of real sensors",
    ed_preview_hint: "This is how the card looks. Click Save to add it to your dashboard.",
    ed_next: "Next",
    ed_back: "Back",
    ed_fix_first: "Fix this in step 1 first:",
    ed_add_first: "Add a device first.",
    ed_connected_to: "Connected to",
    ed_layout: "Layout",
    ed_layout_flow: "Flow: automatic and compact",
    ed_layout_circle: "Round: fixed spots around the home",
    ed_layout_straight: "Straight: top to bottom",
    ed_colors: "Colors",
    ed_colors_hint: "Choose from a fixed set of readable colors for each energy type. Keep Default if you do not need an override.",
    colors_reset: "Restore default colors",
    color_solar: "Solar",
    color_grid: "Grid",
    color_battery: "Battery",
    color_home: "Home",
    color_consumer: "Consumers",
    color_ev: "EV charger",
    color_backup: "Backup",
    color_generator: "Generator",
    color_producer: "Producer",
    ed_pricing: "Energy prices",
    ed_pricing_hint: "Optional: use fixed rates or price entities provided by Home Assistant integrations.",
    pricing_none: "No price calculation",
    pricing_fixed: "Fixed rates",
    pricing_entities: "Home Assistant price entities",
    pricing_mode: "Price model",
    pricing_import: "Import price",
    pricing_export: "Export price",
    pricing_import_entity: "Import price entity",
    pricing_export_entity: "Export price entity",
    pricing_currency: "Currency",
    energy_prices: "Energy prices",
    price_card_import: "Import",
    price_card_export: "Export",
    current_import_price: "Current import price",
    current_export_price: "Current export price",
    current_cost_rate: "Current cost rate",
    current_revenue_rate: "Current revenue rate",
    revenue_today: "Revenue today",
    per_hour: "per hour",
    energy_costs: "Energy & costs",
    period_today: "Today",
    period_week: "This week",
    period_month: "This month",
    stat_consumption: "Consumption",
    stat_import: "Import",
    stat_export: "Export",
    stat_solar: "Solar production",
    stat_import_cost: "Import cost",
    stat_export_revenue: "Feed-in revenue",
    stat_net_cost: "Net cost",
    stat_self_consumption: "Self-consumption",
    stat_self_sufficiency: "Self-sufficiency",
    energy_stats_unavailable: "Not enough energy data for this period",
    diagnostics: "Diagnostics",
    diag_no_issues: "No problems detected",
    diag_attention: "Needs attention",
    diag_sensor_not_configured: "No power sensor configured",
    diag_sensor_missing: "Power sensor is missing",
    diag_sensor_unavailable: "Power sensor unavailable",
    diag_sensor_unknown: "Power sensor unknown",
    diag_sensor_stale: "Sensor has not updated recently",
    diag_balance_difference: "Energy balance difference",
    diag_consumers_exceed_home: "Metered devices exceed Home",
    diag_unmetered_consumption: "Other / unmetered consumption",
    diag_consumers_over_home: "Difference versus Home",
    minutes_short: "min",
    replay: "Replay",
    replay_live: "Live",
    replay_title: "Historical replay",
    replay_loading: "Loading history…",
    replay_hint: "Scrub through the last 24 hours to replay the energy flows at that moment.",
    replay_no_history: "Not enough history for replay",
    mobile_focus_back: "Back to previous level",
};
/**
 * Geeft de tekst voor `key` in de taal van Home Assistant (`hass.language`).
 * Nederlands als de taal met "nl" begint, anders Engels; onbekende sleutels vallen terug op het Engels en dan op de sleutel zelf.
 */
function t(key, language) {
    const dictionary = language?.toLowerCase().startsWith('nl') ? nl : en;
    return dictionary[key] ?? en[key] ?? key;
}
/** Leest de actieve frontendtaal van Home Assistant. `locale.language` krijgt voorrang, met `language` als fallback. */
function hassLanguage(hass) {
    return hass?.locale?.language ?? hass?.language;
}

};
__mods["src/helpers/mobileFocusHelper"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasFocusableChildren = hasFocusableChildren;
exports.buildMobileFocusGraph = buildMobileFocusGraph;
function childConnections(id, nodesById, connections) {
    return connections.filter((c) => {
        if (c.from !== id)
            return false;
        const child = nodesById.get(c.to);
        return !!child && child.role === 'consumer' && child.id !== id;
    });
}
function hasFocusableChildren(id, nodes, connections) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return childConnections(id, byId, connections).length > 0;
}
/**
 * Compact mobile graph: Home shows only its direct neighbours. Focusing a consumer/backup
 * shows that node as the centre plus only its direct children. This keeps labels readable
 * without changing the underlying full graph used for readings/history/replay.
 */
function buildMobileFocusGraph(nodes, connections, requestedFocusId) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const home = nodes.find((n) => n.role === 'home') ?? nodes[0];
    if (!home)
        return { nodes: [], connections: [], focusId: '', homeId: '' };
    const requested = requestedFocusId ? byId.get(requestedFocusId) : undefined;
    const focus = requested && (requested.id === home.id || hasFocusableChildren(requested.id, nodes, connections)) ? requested : home;
    let visibleConnections;
    let parentId;
    if (focus.id === home.id) {
        visibleConnections = connections.filter((c) => c.from === home.id || c.to === home.id);
    }
    else {
        visibleConnections = childConnections(focus.id, byId, connections);
        parentId = connections.find((c) => c.to === focus.id)?.from;
    }
    const ids = new Set([focus.id]);
    for (const c of visibleConnections) {
        ids.add(c.from);
        ids.add(c.to);
    }
    return {
        nodes: nodes.filter((n) => ids.has(n.id)),
        connections: visibleConnections,
        focusId: focus.id,
        homeId: home.id,
        parentId,
    };
}

};
__mods["src/helpers/phaseHelper"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveL1Power = deriveL1Power;
exports.deriveL1History = deriveL1History;
/**
 * HomeWizard/P1 setups may expose total grid power plus L2 and L3, without a separate L1 entity.
 * In that case L1 is exactly the remainder of the measured total.
 */
function deriveL1Power(total, l2, l3) {
    if (total === null || l2 === null || l3 === null)
        return null;
    if (![total, l2, l3].every(Number.isFinite))
        return null;
    return total - l2 - l3;
}
/** Derives an L1 history series from aligned total/L2/L3 history buckets. */
function deriveL1History(total, l2, l3) {
    const l2ByTime = new Map(l2.map((point) => [point.t, point.v]));
    const l3ByTime = new Map(l3.map((point) => [point.t, point.v]));
    const result = [];
    for (const point of total) {
        const p2 = l2ByTime.get(point.t);
        const p3 = l3ByTime.get(point.t);
        if (p2 === undefined || p3 === undefined)
            continue;
        const value = deriveL1Power(point.v, p2, p3);
        if (value !== null)
            result.push({ t: point.t, v: value });
    }
    return result;
}

};
__mods["src/helpers/pricingHelper"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPrices = readPrices;
exports.currentGridRate = currentGridRate;
exports.formatCurrency = formatCurrency;
exports.formatPrice = formatPrice;
exports.fetchGridFinancialsRange = fetchGridFinancialsRange;
exports.fetchTodayGridFinancials = fetchTodayGridFinancials;
exports.fetchTodayExportRevenue = fetchTodayExportRevenue;
function parsePriceState(state, unit) {
    const value = Number(String(state).replace(',', '.'));
    if (!Number.isFinite(value))
        return null;
    const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
    if (u.includes('ct/kwh') || u.includes('cent/kwh') || u.includes('c/kwh'))
        return value / 100;
    return value;
}
function entityPrice(hass, entityId) {
    if (!hass || !entityId)
        return null;
    const state = hass.states[entityId];
    if (!state || state.state === 'unknown' || state.state === 'unavailable')
        return null;
    return parsePriceState(state.state, state.attributes?.unit_of_measurement);
}
function readPrices(config, hass) {
    if (config.mode === 'fixed') {
        return { importPrice: config.importPrice ?? null, exportPrice: config.exportPrice ?? null };
    }
    if (config.mode === 'entities') {
        return {
            importPrice: entityPrice(hass, config.importPriceEntity),
            exportPrice: entityPrice(hass, config.exportPriceEntity),
        };
    }
    return { importPrice: null, exportPrice: null };
}
function currentGridRate(watts, prices) {
    if (watts === null || watts === 0)
        return { kind: 'none', value: 0 };
    if (watts > 0)
        return { kind: 'cost', value: prices.importPrice === null ? null : (watts / 1000) * prices.importPrice };
    return { kind: 'revenue', value: prices.exportPrice === null ? null : (Math.abs(watts) / 1000) * prices.exportPrice };
}
function formatCurrency(value, currency = 'EUR', language, digits = 2) {
    try {
        return new Intl.NumberFormat(language || undefined, {
            style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
        }).format(value);
    }
    catch {
        return `${currency} ${value.toFixed(digits)}`;
    }
}
function formatPrice(value, currency = 'EUR', language) {
    return `${formatCurrency(value, currency, language, 2)}/kWh`;
}
function energyToKWh(value, unit) {
    const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
    if (u === 'wh')
        return value / 1000;
    if (u === 'mwh')
        return value * 1000;
    return value;
}
function rawHistoryMap(response, ids) {
    const byId = new Map();
    for (let i = 0; i < (response ?? []).length; i++) {
        const arr = response?.[i] ?? [];
        const id = arr.find((x) => x.entity_id)?.entity_id ?? ids[i];
        if (id)
            byId.set(id, arr);
    }
    return byId;
}
function cumulativeEnergyPoints(states, currentState, now) {
    if (!currentState)
        return [];
    const unit = currentState.attributes?.unit_of_measurement;
    const points = [];
    for (const s of states) {
        const n = Number(String(s.state).replace(',', '.'));
        const stamp = s.last_changed ?? s.last_updated;
        if (!Number.isFinite(n) || !stamp)
            continue;
        points.push({ t: Date.parse(stamp), v: energyToKWh(n, unit) });
    }
    const current = Number(String(currentState.state).replace(',', '.'));
    if (Number.isFinite(current))
        points.push({ t: now, v: energyToKWh(current, unit) });
    points.sort((a, b) => a.t - b.t);
    return points;
}
function historicPricePoints(states, currentState) {
    const unit = currentState?.attributes?.unit_of_measurement;
    const points = [];
    for (const s of states) {
        const value = parsePriceState(s.state, unit);
        const stamp = s.last_changed ?? s.last_updated;
        if (value === null || !stamp)
            continue;
        points.push({ t: Date.parse(stamp), v: value });
    }
    points.sort((a, b) => a.t - b.t);
    return points;
}
function integrateCumulativeEnergy(energyPoints, fallbackPrice, pricePoints) {
    if (energyPoints.length < 2)
        return 0;
    const priceAt = (time) => {
        let value = fallbackPrice;
        for (const point of pricePoints) {
            if (point.t > time)
                break;
            value = point.v;
        }
        return value;
    };
    let total = 0;
    for (let i = 1; i < energyPoints.length; i++) {
        const previous = energyPoints[i - 1];
        const current = energyPoints[i];
        let delta = current.v - previous.v;
        if (delta < 0)
            delta = current.v; // total_increasing reset
        if (delta <= 0)
            continue;
        total += delta * priceAt(current.t);
    }
    return total;
}
/**
 * Calculate today's signed grid financial balance from cumulative import/export energy.
 * Positive = net feed-in revenue. Negative = net import cost.
 */
async function fetchGridFinancialsRange(hass, importEnergyEntity, exportEnergyEntity, pricing, start, end = Date.now()) {
    if (!hass.callApi || pricing.mode === 'none')
        return null;
    const importState = importEnergyEntity ? hass.states[importEnergyEntity] : undefined;
    const exportState = exportEnergyEntity ? hass.states[exportEnergyEntity] : undefined;
    if (!importState && !exportState)
        return null;
    const now = end;
    const ids = [];
    if (importEnergyEntity)
        ids.push(importEnergyEntity);
    if (exportEnergyEntity && exportEnergyEntity !== importEnergyEntity)
        ids.push(exportEnergyEntity);
    if (pricing.mode === 'entities') {
        if (pricing.importPriceEntity && !ids.includes(pricing.importPriceEntity))
            ids.push(pricing.importPriceEntity);
        if (pricing.exportPriceEntity && !ids.includes(pricing.exportPriceEntity))
            ids.push(pricing.exportPriceEntity);
    }
    if (ids.length === 0)
        return null;
    const path = `history/period/${new Date(start).toISOString()}?filter_entity_id=${encodeURIComponent(ids.join(','))}` +
        `&end_time=${encodeURIComponent(new Date(end).toISOString())}&minimal_response&no_attributes&significant_changes_only`;
    try {
        const response = await hass.callApi('GET', path);
        const byId = rawHistoryMap(response, ids);
        const currentPrices = readPrices(pricing, hass);
        const importPrice = currentPrices.importPrice;
        const exportPrice = currentPrices.exportPrice;
        const importPricePoints = pricing.mode === 'entities' && pricing.importPriceEntity
            ? historicPricePoints(byId.get(pricing.importPriceEntity) ?? [], hass.states[pricing.importPriceEntity])
            : [];
        const exportPricePoints = pricing.mode === 'entities' && pricing.exportPriceEntity
            ? historicPricePoints(byId.get(pricing.exportPriceEntity) ?? [], hass.states[pricing.exportPriceEntity])
            : [];
        const importCost = importEnergyEntity && importState && importPrice !== null
            ? integrateCumulativeEnergy(cumulativeEnergyPoints(byId.get(importEnergyEntity) ?? [], importState, now), importPrice, importPricePoints)
            : 0;
        const exportRevenue = exportEnergyEntity && exportState && exportPrice !== null
            ? integrateCumulativeEnergy(cumulativeEnergyPoints(byId.get(exportEnergyEntity) ?? [], exportState, now), exportPrice, exportPricePoints)
            : 0;
        if ((importEnergyEntity && importPrice === null) || (exportEnergyEntity && exportPrice === null))
            return null;
        return { importCost, exportRevenue, balance: exportRevenue - importCost };
    }
    catch {
        return null;
    }
}
/** Calculate today's signed grid financial balance. */
async function fetchTodayGridFinancials(hass, importEnergyEntity, exportEnergyEntity, pricing, now = Date.now()) {
    const startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    return fetchGridFinancialsRange(hass, importEnergyEntity, exportEnergyEntity, pricing, startDate.getTime(), now);
}
/** Backwards-compatible helper: feed-in revenue only. */
async function fetchTodayExportRevenue(hass, exportEnergyEntity, pricing, now = Date.now()) {
    const result = await fetchTodayGridFinancials(hass, undefined, exportEnergyEntity, pricing, now);
    return result?.exportRevenue ?? null;
}

};
__mods["src/helpers/replayHelper"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nearestHistoryPoint = nearestHistoryPoint;
exports.replayRange = replayRange;
/** Finds the closest available history point to a requested timestamp. */
function nearestHistoryPoint(points, timestamp) {
    if (points.length === 0)
        return undefined;
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (points[mid].t < timestamp)
            lo = mid + 1;
        else
            hi = mid;
    }
    const right = points[lo];
    const left = lo > 0 ? points[lo - 1] : undefined;
    if (!left)
        return right;
    return Math.abs(left.t - timestamp) <= Math.abs(right.t - timestamp) ? left : right;
}
function replayRange(series) {
    const usable = series.filter((points) => points.length > 0);
    if (usable.length === 0)
        return undefined;
    const start = Math.max(...usable.map((points) => points[0].t));
    const end = Math.min(...usable.map((points) => points[points.length - 1].t));
    return end > start ? { start, end } : undefined;
}

};
__mods["src/helpers/stateHelper"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePower = parsePower;
exports.getEntityStatus = getEntityStatus;
exports.readPower = readPower;
exports.readNumber = readNumber;
exports.formatPower = formatPower;
exports.formatPercent = formatPercent;
const EntityStatus_1 = __req("src/types/EntityStatus");
// Home Assistant gebruikt een punt als decimaalteken; alles anders is voor ons geen getal.
const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/**
 * Zet een Home Assistant-state om in een getal, in W als `unit` "kW" of "MW" is.
 * Geeft null bij alles wat geen gewoon getal is ("unknown", "unavailable", "", "abc").
 */
function parsePower(value, unit) {
    let n;
    if (typeof value === 'number') {
        n = value;
    }
    else if (typeof value === 'string') {
        const text = value.trim();
        if (!NUMBER_PATTERN.test(text))
            return null;
        n = Number(text);
    }
    else {
        return null;
    }
    if (!Number.isFinite(n))
        return null;
    const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
    if (u === 'kw')
        n *= 1000;
    else if (u === 'mw')
        n *= 1_000_000;
    return n;
}
function getEntityStatus(entity) {
    if (!entity)
        return EntityStatus_1.EntityStatus.Invalid;
    if (entity.state === 'unavailable')
        return EntityStatus_1.EntityStatus.Unavailable;
    if (entity.state === 'unknown')
        return EntityStatus_1.EntityStatus.Unknown;
    const value = parsePower(entity.state, entity.attributes?.unit_of_measurement);
    if (value === null)
        return EntityStatus_1.EntityStatus.Invalid;
    return value === 0 ? EntityStatus_1.EntityStatus.Zero : EntityStatus_1.EntityStatus.Valid;
}
/** Leest het vermogen van een entiteit in W. */
function readPower(hass, entityId) {
    if (!hass || !entityId)
        return { status: EntityStatus_1.EntityStatus.Invalid, value: null };
    const entity = hass.states[entityId];
    const status = getEntityStatus(entity);
    if (!(0, EntityStatus_1.hasValue)(status) || !entity)
        return { status, value: null };
    return { status, value: parsePower(entity.state, entity.attributes?.unit_of_measurement) };
}
/** Leest een gewoon getal (bijvoorbeeld een percentage), zonder eenheidsomrekening. */
function readNumber(hass, entityId) {
    if (!hass || !entityId)
        return { status: EntityStatus_1.EntityStatus.Invalid, value: null };
    const entity = hass.states[entityId];
    if (!entity)
        return { status: EntityStatus_1.EntityStatus.Invalid, value: null };
    if (entity.state === 'unavailable')
        return { status: EntityStatus_1.EntityStatus.Unavailable, value: null };
    if (entity.state === 'unknown')
        return { status: EntityStatus_1.EntityStatus.Unknown, value: null };
    const value = parsePower(entity.state);
    if (value === null)
        return { status: EntityStatus_1.EntityStatus.Invalid, value: null };
    return { status: value === 0 ? EntityStatus_1.EntityStatus.Zero : EntityStatus_1.EntityStatus.Valid, value };
}
/** 4250 → "4250 W" (of "4.25 kW" bij `kw`, en bij `auto` vanaf 1000 W). Het teken wordt niet getoond. */
function formatPower(watts, format = 'w') {
    const abs = Math.abs(watts);
    if (format === 'kw' || (format === 'auto' && abs >= 1000))
        return `${round(abs / 1000, 2)} kW`;
    return `${Math.round(abs)} W`;
}
function formatPercent(value) {
    return `${Math.round(value)}%`;
}
function round(value, decimals) {
    const factor = 10 ** decimals;
    return String(Math.round(value * factor) / factor);
}

};
__mods["src/index"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const EnergyFlowCard_1 = __req("src/card/EnergyFlowCard");
const EnergyFlowCardEditor_1 = __req("src/editor/EnergyFlowCardEditor");
if (!customElements.get('energy-flow-card'))
    customElements.define('energy-flow-card', EnergyFlowCard_1.EnergyFlowCard);
if (!customElements.get('energy-flow-card-editor'))
    customElements.define('energy-flow-card-editor', EnergyFlowCardEditor_1.EnergyFlowCardEditor);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'energy-flow-card')) {
    window.customCards.push({
        type: 'energy-flow-card',
        name: 'Energy Flow Card Pro',
        description: 'Geavanceerde realtime energieflow, historie, groepen en prijsinformatie voor Home Assistant.',
        preview: true,
    });
}
console.info('%c ENERGY-FLOW-CARD-PRO %c 0.16.0 ', 'color:#fff;background:#33b07a;font-weight:600', 'color:#33b07a');

};
__mods["src/layout/AutoLayout"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRAIGHT_ROW_GAP = exports.HOME_RADIUS = exports.NODE_RADIUS = void 0;
exports.computeLayout = computeLayout;
const Connection_1 = __req("src/models/Connection");
exports.NODE_RADIUS = 38;
exports.HOME_RADIUS = 46;
/** Afstand tussen twee rijen in de rechte layout; de rechte lijnen buigen halverwege deze afstand af. */
exports.STRAIGHT_ROW_GAP = 176;
/**
 * Drie weergaven:
 * - "flow" (standaard): energiestromen centraal; productie boven, net links, opslag rechts, verbruikers onder.
 * - "circle": vaste plekken rond Home.
 * - "straight": klassieke boven-naar-beneden weergave.
 * De kaart is altijd los van Node en Connection: dit bepaalt alleen waar iets staat.
 */
function computeLayout(nodes, layout = {}, connections) {
    const mode = layout.mode === 'circle' ? 'circle' : layout.mode === 'straight' ? 'straight' : 'flow';
    const links = connections ?? (0, Connection_1.defaultConnections)([...nodes]);
    const manual = layout.positions ?? {};
    const manualFor = (n) => manual[n.id] ?? (n.name ? manual[n.name] : undefined);
    const others = nodes.filter((n) => n.role !== 'home');
    const auto = others.filter((n) => !manualFor(n));
    const base = mode === 'circle' ? circleLayout(nodes, auto, links) : mode === 'straight' ? straightLayout(nodes, auto, links) : flowLayout(nodes, auto, links);
    // Handmatige posities (in % van de kaart) gaan altijd voor.
    for (const n of others) {
        const p = manualFor(n);
        if (p)
            base.positions.set(n.id, { x: (p.x / 100) * base.width, y: (p.y / 100) * base.height });
    }
    return { ...base, mode };
}
/** Bovenliggende node van een verbruiker, voor hiërarchische branches. Home wordt als root behandeld en niet teruggegeven. */
function consumerParentOf(node, byId, links) {
    if (node.role !== 'consumer' || node.type === 'backup')
        return undefined;
    const incoming = links.find((c) => c.to === node.id);
    if (!incoming)
        return undefined;
    const parent = byId.get(incoming.from);
    if (!parent || parent.role === 'home')
        return undefined;
    return parent.type === 'backup' || parent.role === 'consumer' ? parent : undefined;
}
function consumerChildrenOf(node, byId, links) {
    return links
        .filter((c) => c.from === node.id)
        .map((c) => byId.get(c.to))
        .filter((child) => !!child && child.role === 'consumer' && child.type !== 'backup');
}
// ----- Rond -----------------------------------------------------------------------------------
/** Straal van de eerste ring rond Home. */
const RING_1 = 172;
/** Ruimte tussen de buitenste node en de rand van de kaart (node-straal + naam en ondertitel). */
const MARGIN = 92;
/** Minimale afstand tussen twee ringen, en tussen buren op een buitenring. */
const RING_GAP = 105;
const SLOT_SPACING = 110;
function groupOf(node) {
    if (node.type === 'grid')
        return 'grid';
    if (node.type === 'battery')
        return 'storage';
    if (node.type === 'backup')
        return 'backup';
    if (node.role === 'source')
        return 'producer';
    return 'device';
}
/** Vaste plekken (hoek in graden, 0 = boven, met de klok mee): zon boven, net links, batterij onder, backup rechts. */
const ANCHOR = {
    producer: 0,
    backup: 90,
    storage: 180,
    grid: 270,
};
const FIXED_ORDER = ['grid', 'producer', 'storage', 'backup'];
/** Eerste ring: 8 plekken. Vier vaste plekken op de kruispunten, vier diagonalen voor de overige apparaten. */
const RING_1_DIAGONALS = [1, 5, 3, 7]; // rechtsboven, linksonder, rechtsonder, linksboven: blijft in balans
const RING_1_CROSS = [2, 6, 4, 0];
function ringCount(ring) {
    return ring === 1 ? 8 : 8 * 2 ** (ring - 2);
}
function ringRadius(ring) {
    let radius = RING_1;
    for (let k = 2; k <= ring; k++) {
        radius = Math.max(radius + RING_GAP, (ringCount(k) * SLOT_SPACING) / (2 * Math.PI));
    }
    return radius;
}
/** Ring 1 begint op 0°; buitenringen zitten precies tussen de plekken van de ring erbinnen, zodat lijnen vrij blijven. */
function slotAngle(ring, index) {
    const count = ringCount(ring);
    return ring === 1 ? index * 45 : 180 / count + (index * 360) / count;
}
/** Spreidt plekken over de ring (0, half, kwart, driekwart, …) zodat een halfvolle ring toch in balans is. */
function spread(index, count) {
    const bits = Math.log2(count);
    let result = 0;
    for (let b = 0; b < bits; b++)
        if (index & (1 << b))
            result |= 1 << (bits - 1 - b);
    return result;
}
function angularDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}
function circleLayout(nodes, auto, links) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const taken = new Set();
    const key = (ring, index) => `${ring}:${index}`;
    const placed = new Map();
    const take = (node, ring, index) => {
        taken.add(key(ring, index));
        placed.set(node.id, { ring, index });
    };
    /** De vrije plek die het dichtst bij een hoek ligt, te beginnen bij `startRing`. */
    const nearestFree = (anchor, startRing) => {
        for (let ring = startRing;; ring++) {
            let best = -1;
            let bestDistance = Infinity;
            for (let i = 0; i < ringCount(ring); i++) {
                if (taken.has(key(ring, i)))
                    continue;
                const d = angularDistance(slotAngle(ring, i), anchor);
                if (d < bestDistance) {
                    best = i;
                    bestDistance = d;
                }
            }
            if (best >= 0)
                return { ring, index: best };
        }
    };
    const members = new Map();
    for (const n of auto) {
        const g = groupOf(n);
        members.set(g, [...(members.get(g) ?? []), n]);
    }
    // 1. Elke groep met een vaste plek krijgt zijn eigen plek.
    for (const g of FIXED_ORDER) {
        const first = members.get(g)?.[0];
        if (first)
            take(first, 1, ANCHOR[g] / 45);
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
    const nextDeviceSlot = () => {
        for (const i of [...RING_1_DIAGONALS, ...RING_1_CROSS])
            if (!taken.has(key(1, i)))
                return { ring: 1, index: i };
        for (let ring = 2;; ring++) {
            const count = ringCount(ring);
            for (let i = 0; i < count; i++) {
                const index = spread(i, count);
                if (!taken.has(key(ring, index)))
                    return { ring, index };
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
            const device = pending[i];
            const parent = consumerParentOf(device, byId, links);
            const parentSlot = parent ? placed.get(parent.id) : undefined;
            if (!parentSlot)
                continue;
            const slot = nearestFree(slotAngle(parentSlot.ring, parentSlot.index), parentSlot.ring + 1);
            take(device, slot.ring, slot.index);
            pending.splice(i, 1);
            progressed = true;
        }
        if (!progressed)
            break;
    }
    for (const device of pending) {
        const slot = nextDeviceSlot();
        take(device, slot.ring, slot.index);
    }
    // Coördinaten rond Home, en de kaart net groot genoeg (en vierkant) om alles te tonen.
    const offsets = new Map();
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
    const positions = new Map();
    for (const n of nodes)
        if (n.role === 'home')
            positions.set(n.id, { x: center, y: center });
    for (const [id, p] of offsets)
        positions.set(id, { x: center + p.x, y: center + p.y });
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
function flowLayout(nodes, auto, links) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const autoIds = new Set(auto.map((n) => n.id));
    const pts = new Map();
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
    const children = new Map();
    for (const node of consumerNodes) {
        if (node.type === 'backup')
            continue;
        const parent = consumerParentOf(node, byId, links);
        if (parent && autoIds.has(parent.id))
            children.set(parent.id, [...(children.get(parent.id) ?? []), node]);
    }
    const hasParentInAuto = (node) => {
        const parent = consumerParentOf(node, byId, links);
        return !!parent && autoIds.has(parent.id);
    };
    const roots = consumerNodes.filter((n) => n.type === 'backup' || !hasParentInAuto(n));
    const plainRoots = roots.filter((n) => n.type !== 'backup' && (children.get(n.id)?.length ?? 0) === 0);
    const treeRoots = roots.filter((n) => n.type === 'backup' || (children.get(n.id)?.length ?? 0) > 0);
    const subtreeWidth = (node, visiting = new Set()) => {
        if (visiting.has(node.id))
            return COL;
        const next = new Set(visiting);
        next.add(node.id);
        const kids = children.get(node.id) ?? [];
        if (!kids.length)
            return COL;
        if (node.type === 'backup' && kids.length > 3)
            return 3 * COL;
        const widths = kids.map((kid) => subtreeWidth(kid, next));
        return Math.max(COL, widths.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * SIBLING_GAP);
    };
    const plainRows = [];
    for (let i = 0; i < plainRoots.length; i += MAX_ROW_SLOTS)
        plainRows.push(plainRoots.slice(i, i + MAX_ROW_SLOTS));
    const plainWidth = Math.max(0, ...plainRows.map((row) => Math.max(COL, row.length * COL)));
    const treeWidths = treeRoots.map((root) => subtreeWidth(root));
    const treesWidth = treeWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, treeWidths.length - 1) * REGION_GAP;
    const lowerWidth = plainWidth + (plainWidth && treesWidth ? REGION_GAP : 0) + treesWidth;
    const topWidth = Math.max(1, producers.length) * COL;
    let width = Math.max(MIN_WIDTH, lowerWidth + 2 * H_MARGIN, topWidth + 2 * H_MARGIN + 80);
    const centerX = width / 2;
    const homeY = producers.length > 0 ? TOP_Y + SOURCE_TO_HOME : TOP_Y + 58;
    if (home)
        pts.set(home.id, { x: centerX, y: homeY });
    producers.forEach((n, i) => pts.set(n.id, { x: centerX + (i - (producers.length - 1) / 2) * COL, y: TOP_Y }));
    const sideY = (i, count) => homeY + (i - (count - 1) / 2) * 108;
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
    const placeTree = (node, left, treeWidth, depth, visiting = new Set()) => {
        if (visiting.has(node.id))
            return;
        const next = new Set(visiting);
        next.add(node.id);
        pts.set(node.id, { x: left + treeWidth / 2, y: firstRowY + depth * TREE_ROW_GAP });
        const kids = children.get(node.id) ?? [];
        if (!kids.length)
            return;
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
            placeTree(kid, childLeft, widths[i], depth + 1, next);
            childLeft += widths[i] + SIBLING_GAP;
        });
    };
    treeRoots.forEach((root, i) => {
        const w = treeWidths[i];
        placeTree(root, cursor, w, 0);
        cursor += w + REGION_GAP;
    });
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [id, point] of pts) {
        const node = byId.get(id);
        const radius = node?.role === 'home' ? exports.HOME_RADIUS : exports.NODE_RADIUS;
        minX = Math.min(minX, point.x - radius);
        maxX = Math.max(maxX, point.x + radius + (node?.role === 'home' || node?.type === 'backup' ? SIDE_LABEL : 0));
        minY = Math.min(minY, point.y - radius - LABEL_TOP);
        maxY = Math.max(maxY, point.y + radius + LABEL_BOTTOM);
    }
    if (!Number.isFinite(minX))
        return { width: MIN_WIDTH, height: 220, positions: new Map() };
    const horizontalHalf = Math.max(centerX - minX, maxX - centerX);
    minX = centerX - horizontalHalf;
    maxX = centerX + horizontalHalf;
    const fittedWidth = Math.max(MIN_WIDTH, maxX - minX + 2 * H_MARGIN);
    const fittedHeight = Math.max(260, maxY - minY + 2 * V_MARGIN);
    const dx = (fittedWidth - (maxX - minX)) / 2 - minX;
    const dy = V_MARGIN - minY;
    const positions = new Map();
    for (const [id, point] of pts)
        positions.set(id, { x: point.x + dx, y: point.y + dy });
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
function straightLayout(nodes, auto, links) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const pts = new Map();
    const home = nodes.find((n) => n.role === 'home');
    if (home)
        pts.set(home.id, { x: 0, y: 0 });
    const row = (list, y) => list.forEach((n, i) => pts.set(n.id, { x: (i - (list.length - 1) / 2) * COL, y }));
    // Boven Home: net, batterij en zon.
    const grids = auto.filter((n) => n.type === 'grid');
    const storages = auto.filter((n) => n.type === 'battery');
    const producers = auto.filter((n) => n.role === 'source');
    const near = [...storages, ...producers];
    if (grids.length > 0 && near.length > 0) {
        row(grids, -2 * exports.STRAIGHT_ROW_GAP);
        // De lijn van het net loopt tussen de andere nodes door naar Home, dus het midden blijft vrij.
        // Batterijen staan links, zon rechts; is een kant leeg, dan verdelen we de andere kant over beide zijden.
        let left = storages;
        let right = producers;
        if (storages.length === 0)
            [right, left] = [producers.filter((_, i) => i % 2 === 0), producers.filter((_, i) => i % 2 === 1)];
        else if (producers.length === 0)
            [left, right] = [storages.filter((_, i) => i % 2 === 0), storages.filter((_, i) => i % 2 === 1)];
        left.forEach((n, i) => pts.set(n.id, { x: -(i + 1) * COL, y: -exports.STRAIGHT_ROW_GAP }));
        right.forEach((n, i) => pts.set(n.id, { x: (i + 1) * COL, y: -exports.STRAIGHT_ROW_GAP }));
    }
    else if (grids.length > 0) {
        row(grids, -exports.STRAIGHT_ROW_GAP);
    }
    else {
        row(near, -exports.STRAIGHT_ROW_GAP);
    }
    // Onder Home: verbruikers vormen een boom. Een gemeten parent blijft één tak voor Home;
    // de kinderen staan eronder als uitsplitsing en worden dus niet dubbel op de hoofdflow aangesloten.
    const consumerNodes = auto.filter((n) => n.role === 'consumer');
    const autoIds = new Set(auto.map((n) => n.id));
    const children = new Map();
    for (const device of consumerNodes) {
        if (device.type === 'backup')
            continue;
        const parent = consumerParentOf(device, byId, links);
        if (parent && autoIds.has(parent.id))
            children.set(parent.id, [...(children.get(parent.id) ?? []), device]);
    }
    const roots = consumerNodes.filter((node) => node.type === 'backup' || !consumerParentOf(node, byId, links) || !autoIds.has(consumerParentOf(node, byId, links).id));
    const widthOf = (node, visiting = new Set()) => {
        if (visiting.has(node.id))
            return 1;
        const next = new Set(visiting);
        next.add(node.id);
        const kids = children.get(node.id) ?? [];
        if (!kids.length)
            return 1;
        return Math.max(1, kids.reduce((sum, child) => sum + widthOf(child, next), 0));
    };
    const widths = roots.map((root) => widthOf(root));
    const total = widths.reduce((sum, value) => sum + value, 0);
    const place = (node, start, width, depth, visiting = new Set()) => {
        if (visiting.has(node.id))
            return;
        const next = new Set(visiting);
        next.add(node.id);
        pts.set(node.id, { x: (start + (width - 1) / 2 - (total - 1) / 2) * COL, y: depth * exports.STRAIGHT_ROW_GAP });
        let cursor = start;
        for (const child of children.get(node.id) ?? []) {
            const childWidth = widthOf(child, next);
            place(child, cursor, childWidth, depth + 1, next);
            cursor += childWidth;
        }
    };
    let lowerCursor = 0;
    roots.forEach((root, i) => {
        place(root, lowerCursor, widths[i], 1);
        lowerCursor += widths[i];
    });
    // Kaart om alles heen, niet te smal en niet te breed.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [id, p] of pts) {
        const r = byId.get(id)?.role === 'home' ? exports.HOME_RADIUS : exports.NODE_RADIUS;
        minX = Math.min(minX, p.x - r);
        const node = byId.get(id);
        // Home en backup hebben hun naam rechts naast zich staan.
        maxX = Math.max(maxX, p.x + r + (node?.role === 'home' || node?.type === 'backup' ? SIDE_LABEL : 0));
        minY = Math.min(minY, p.y - r);
        maxY = Math.max(maxY, p.y + r);
    }
    if (!Number.isFinite(minX))
        return { width: 100, height: 100, positions: new Map() };
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
    }
    else if (width / height > MAX_ASPECT) {
        const extra = width / MAX_ASPECT - height;
        height += extra;
        dy += extra / 2;
    }
    const positions = new Map();
    for (const [id, p] of pts)
        positions.set(id, { x: p.x + dx, y: p.y + dy });
    return { width: Math.round(width), height: Math.round(height), positions };
}

};
__mods["src/models/Connection"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConnection = createConnection;
exports.defaultConnections = defaultConnections;
exports.parentOf = parentOf;
function createConnection(id, from, to, options = {}) {
    const eitherBidirectional = from.role === 'bidirectional' || to.role === 'bidirectional';
    return {
        id,
        from: from.id,
        to: to.id,
        bidirectional: options.bidirectional ?? eitherBidirectional,
        visible: options.visible !== false,
        animated: options.animated !== false,
        speed: options.speed && options.speed > 0 ? options.speed : 1,
        color: options.color,
        width: options.width && options.width > 0 ? options.width : 3,
        entity: options.entity,
        invert: options.invert === true,
    };
}
/**
 * Zonder `connections` wordt elke node met Home verbonden:
 * verbruikers vertrekken vanuit Home, alle andere nodes stromen naar Home toe.
 */
function defaultConnections(nodes) {
    const home = nodes.find((n) => n.role === 'home');
    if (!home)
        return [];
    return nodes
        .filter((n) => n.id !== home.id)
        .map((n) => {
        if (n.role !== 'consumer')
            return createConnection(`${n.id}__${home.id}`, n, home);
        const parent = parentOf(n, nodes) ?? home;
        return createConnection(`${parent.id}__${n.id}`, parent, n);
    });
}
/**
 * Een gewoon apparaat kan achter een backup of een andere verbruiker hangen (`connected_to`).
 * Geeft undefined als het apparaat direct aan Home hangt.
 */
function parentOf(node, nodes) {
    const ref = node.config.connected_to?.trim();
    if (!ref || node.role !== 'consumer' || node.type === 'backup')
        return undefined;
    const lower = ref.toLowerCase();
    const parent = nodes.find((n) => n.id === ref) ?? nodes.find((n) => n.name?.toLowerCase() === lower);
    return parent && (parent.type === 'backup' || parent.role === 'consumer') ? parent : undefined;
}

};
__mods["src/models/Node"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNode = createNode;
exports.generateId = generateId;
exports.advancedFieldsFor = advancedFieldsFor;
exports.fieldLabelKey = fieldLabelKey;
const NodeType_1 = __req("src/types/NodeType");
function createNode(config, type, id) {
    return {
        id,
        name: config.name?.trim() || undefined,
        type,
        role: (0, NodeType_1.roleOf)(type),
        icon: config.icon?.trim() || undefined,
        invert: config.invert === true,
        config,
        groupMembers: Array.isArray(config.group_members) ? [...config.group_members] : undefined,
    };
}
/** Maakt uit een naam een uniek id ("Laadpaal" → "laadpaal", daarna "laadpaal_2"). */
function generateId(name, taken) {
    const base = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'node';
    if (!taken.has(base))
        return base;
    let counter = 2;
    while (taken.has(`${base}_${counter}`))
        counter++;
    return `${base}_${counter}`;
}
/** Welke geavanceerde opties bij welk node-type horen. */
function advancedFieldsFor(type) {
    switch (type) {
        case 'battery':
            return [
                'soc_entity',
                'charge_power_entity',
                'discharge_power_entity',
                'voltage_entity',
                'current_entity',
                'temperature_entity',
                'energy_charged_entity',
                'energy_discharged_entity',
            ];
        case 'solar':
        case 'producer':
            return ['production_entity', 'energy_today_entity', 'energy_total_entity', 'inverter_temperature_entity'];
        case 'grid':
            return [
                'energy_import_entity',
                'energy_export_entity',
                'phase_l1_power_entity',
                'phase_l2_power_entity',
                'phase_l3_power_entity',
                'phase_l1_voltage_entity',
                'phase_l2_voltage_entity',
                'phase_l3_voltage_entity',
                'phase_l1_current_entity',
                'phase_l2_current_entity',
                'phase_l3_current_entity',
            ];
        case 'consumer':
        case 'ev_charger':
        case 'heat_pump':
        case 'boiler':
        case 'airco':
            return ['voltage_entity', 'current_entity', 'energy_today_entity', 'energy_total_entity'];
        case 'backup':
            return ['voltage_entity', 'current_entity', 'energy_today_entity', 'energy_total_entity'];
        case 'home':
            return [];
        default:
            return ['energy_today_entity', 'energy_total_entity'];
    }
}
/** De vertaalsleutel voor het label van een geavanceerd veld, rekening houdend met het apparaattype. */
function fieldLabelKey(field, type) {
    const consumptionType = type === 'consumer' ||
        type === 'ev_charger' ||
        type === 'heat_pump' ||
        type === 'boiler' ||
        type === 'airco' ||
        type === 'backup';
    if (consumptionType && field === 'energy_today_entity')
        return 'energy_consumed_today';
    if (consumptionType && field === 'energy_total_entity')
        return 'energy_consumed_total';
    return field.replace(/_entity$/, '');
}

};
__mods["src/renderer/ConnectionRenderer"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeGeometry = computeGeometry;
exports.particleDuration = particleDuration;
exports.createConnectionElement = createConnectionElement;
const AutoLayout_1 = __req("src/layout/AutoLayout");
const dom_1 = __req("src/renderer/dom");
const GAP = 3;
const PARTICLES = 3;
const f1 = (n) => n.toFixed(1);
/** Punten verbinden met afgeronde hoeken. Geeft ook de lengte en het midden (met de hoek daar) terug. */
function roundedRoute(points, corner) {
    let d = `M${f1(points[0].x)} ${f1(points[0].y)}`;
    for (let i = 1; i < points.length - 1; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const r = Math.min(corner, l1 / 2, l2 / 2);
        const a = { x: p1.x + ((p0.x - p1.x) / l1) * r, y: p1.y + ((p0.y - p1.y) / l1) * r };
        const b = { x: p1.x + ((p2.x - p1.x) / l2) * r, y: p1.y + ((p2.y - p1.y) / l2) * r };
        d += ` L${f1(a.x)} ${f1(a.y)} Q${f1(p1.x)} ${f1(p1.y)} ${f1(b.x)} ${f1(b.y)}`;
    }
    const last = points[points.length - 1];
    d += ` L${f1(last.x)} ${f1(last.y)}`;
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    const length = lengths.reduce((a, b) => a + b, 0);
    let left = length / 2;
    let mid = points[0];
    let angle = 0;
    for (let i = 0; i < lengths.length; i++) {
        const seg = lengths[i];
        const a = points[i];
        const b = points[i + 1];
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
function orthogonalGeometry(a, b, rowGap) {
    if (Math.abs(a.center.y - b.center.y) < 40)
        return null;
    const aIsUpper = a.center.y < b.center.y;
    const upper = aIsUpper ? a : b;
    const lower = aIsUpper ? b : a;
    const start = { x: upper.center.x, y: upper.center.y + upper.radius + GAP };
    const end = { x: lower.center.x, y: lower.center.y - lower.radius - GAP };
    let points;
    if (Math.abs(start.x - end.x) < 1) {
        points = [start, end];
    }
    else {
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
function computeGeometry(a, b, curved, orthogonal = false, rowGap = AutoLayout_1.STRAIGHT_ROW_GAP) {
    if (orthogonal) {
        const route = orthogonalGeometry(a, b, rowGap);
        if (route)
            return route;
    }
    const dx = b.center.x - a.center.x;
    const dy = b.center.y - a.center.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const p0 = { x: a.center.x + ux * (a.radius + GAP), y: a.center.y + uy * (a.radius + GAP) };
    const p1 = { x: b.center.x - ux * (b.radius + GAP), y: b.center.y - uy * (b.radius + GAP) };
    const length = Math.max(0, dist - a.radius - b.radius - 2 * GAP);
    const f = (n) => n.toFixed(1);
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
function particleDuration(watts, ctx, connectionSpeed) {
    const load = Math.min(1, Math.log1p(Math.abs(watts)) / Math.log1p(Math.max(1, ctx.maxPower)));
    const seconds = (7 - 5 * load) / (Math.max(0.05, ctx.animationSpeed) * Math.max(0.05, connectionSpeed));
    return Math.min(14, Math.max(1.5, Math.round(seconds * 2) / 2));
}
function createConnectionElement(conn, from, to, curved, color, orthogonal = false) {
    const geo = computeGeometry(from, to, curved, orthogonal);
    if (geo.length < 4)
        return null;
    const g = (0, dom_1.svg)('g', { class: 'connection', 'data-connection': conn.id });
    if (!conn.visible)
        g.setAttribute('display', 'none');
    if (color)
        g.setAttribute('style', `--c:${color}`);
    const line = (0, dom_1.svg)('path', { class: 'line', d: geo.forward, 'stroke-width': conn.width, fill: 'none' });
    const chevron = (0, dom_1.svg)('path', {
        class: 'chevron',
        d: 'M-6 -5 L3 0 L-6 5',
        fill: 'none',
        'stroke-width': 2.2,
        transform: `translate(${geo.mid.x.toFixed(1)} ${geo.mid.y.toFixed(1)}) rotate(${geo.angle.toFixed(1)})`,
    });
    g.append(line, chevron);
    const dots = [];
    const motions = [];
    const radius = conn.width * 1.2 + 0.8;
    const count = geo.length < 110 ? 2 : PARTICLES;
    for (let i = 0; i < count; i++) {
        const motion = (0, dom_1.svg)('animateMotion', { repeatCount: 'indefinite', path: geo.forward, dur: '4s', begin: '0s' });
        const dot = (0, dom_1.svg)('circle', { class: 'particle', r: radius.toFixed(1), visibility: 'hidden' }, motion);
        dots.push(dot);
        motions.push(motion);
        g.append(dot);
    }
    let lastKey = '';
    const update = (flow, ctx) => {
        const state = flow === null ? 'unknown' : flow === 0 ? 'idle' : 'flowing';
        (0, dom_1.setAttr)(g, 'data-flow', state);
        if (state !== 'flowing') {
            if (lastKey !== state) {
                lastKey = state;
                dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
            }
            return;
        }
        const forward = flow > 0;
        const dur = particleDuration(flow, ctx, conn.animated ? conn.speed : 1);
        const animate = ctx.animate && conn.animated;
        (0, dom_1.setAttr)(g, 'data-animated', String(animate));
        const key = `${forward}|${dur}|${animate}`;
        if (key === lastKey)
            return;
        lastKey = key;
        // Richting van de pijl (voor als er niet geanimeerd wordt)
        chevron.setAttribute('transform', `translate(${geo.mid.x.toFixed(1)} ${geo.mid.y.toFixed(1)}) rotate(${(geo.angle + (forward ? 0 : 180)).toFixed(1)})`);
        motions.forEach((m, i) => {
            m.setAttribute('path', forward ? geo.forward : geo.backward);
            m.setAttribute('dur', `${dur}s`);
            m.setAttribute('begin', `${(-(dur * i) / count).toFixed(2)}s`);
        });
        dots.forEach((d) => d.setAttribute('visibility', animate ? 'visible' : 'hidden'));
    };
    return { el: g, update };
}

};
__mods["src/renderer/NodeRenderer"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.displayNameOf = displayNameOf;
exports.describeNode = describeNode;
exports.createNodeElement = createNodeElement;
const i18n_1 = __req("src/helpers/i18n");
const stateHelper_1 = __req("src/helpers/stateHelper");
const EntityStatus_1 = __req("src/types/EntityStatus");
const NodeType_1 = __req("src/types/NodeType");
const dom_1 = __req("src/renderer/dom");
const DEFAULT_NAMES = { home: 'home', grid: 'grid', solar: 'solar', battery: 'battery', backup: 'type_backup' };
function displayNameOf(node, language) {
    if (node.name)
        return node.name;
    return (0, i18n_1.t)(DEFAULT_NAMES[node.type] ?? node.type, language);
}
/** Vertaalt een reading naar tekst en status. Hier komen de statusregels samen. */
function describeNode(node, reading, ctx) {
    const { language, powerFormat } = ctx;
    let status = reading.status;
    if ((0, EntityStatus_1.hasValue)(status) && reading.charging)
        status = EntityStatus_1.EntityStatus.Charging;
    const symbol = (0, EntityStatus_1.statusSymbol)(status);
    const valueText = symbol ?? (0, stateHelper_1.formatPower)(reading.watts ?? 0, powerFormat);
    const view = { displayName: displayNameOf(node, language), status, valueText };
    if (reading.soc) {
        const s = reading.soc;
        view.socText = s.value !== null ? (0, stateHelper_1.formatPercent)(s.value) : ((0, EntityStatus_1.statusSymbol)(s.status) ?? '?');
        if (s.value !== null)
            view.level = Math.min(1, Math.max(0, s.value / 100));
    }
    if ((0, EntityStatus_1.hasValue)(status) && reading.watts !== null && reading.watts !== 0) {
        if (node.type === 'battery')
            view.subtitle = (0, i18n_1.t)(reading.watts < 0 ? 'charging' : 'discharging', language);
        else if (node.type === 'grid')
            view.subtitle = (0, i18n_1.t)(reading.watts < 0 ? 'exporting' : 'importing', language);
        else if (node.type === 'ev_charger')
            view.subtitle = (0, i18n_1.t)('charging', language);
    }
    return view;
}
const BOLT = 'M2.5 -7 L-4 1.5 L-0.5 1.5 L-2.5 7 L4 -1.5 L0.5 -1.5 Z';
function glyph(type) {
    const g = (0, dom_1.svg)('g', { class: 'glyph', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    switch (type) {
        case 'home':
            g.append((0, dom_1.svg)('path', { d: 'M3.5 11.5 L12 4 L20.5 11.5' }), (0, dom_1.svg)('path', { d: 'M6 10 V20 H18 V10' }), (0, dom_1.svg)('path', { d: 'M10 20 V14.5 H14 V20' }));
            break;
        case 'grid':
            g.append((0, dom_1.svg)('path', { d: 'M12 3 L7 21 M12 3 L17 21' }), (0, dom_1.svg)('path', { d: 'M4.5 7 H19.5' }), (0, dom_1.svg)('path', { d: 'M9.6 11.5 H14.4 M8.4 16 H15.6' }), (0, dom_1.svg)('path', { d: 'M9.6 11.5 L15.6 16 M14.4 11.5 L8.4 16' }));
            break;
        case 'solar': {
            g.append((0, dom_1.svg)('circle', { cx: 12, cy: 12, r: 4.2 }));
            for (let i = 0; i < 8; i++) {
                const a = (i * Math.PI) / 4;
                const [c, s] = [Math.cos(a), Math.sin(a)];
                g.append((0, dom_1.svg)('path', {
                    d: `M${(12 + 7.2 * c).toFixed(2)} ${(12 + 7.2 * s).toFixed(2)} L${(12 + 9.6 * c).toFixed(2)} ${(12 + 9.6 * s).toFixed(2)}`,
                }));
            }
            break;
        }
        case 'battery':
            g.append((0, dom_1.svg)('rect', { x: 6.5, y: 5, width: 11, height: 17, rx: 2.2 }), (0, dom_1.svg)('rect', { x: 10, y: 2, width: 4, height: 3, rx: 0.8 }), (0, dom_1.svg)('rect', { class: 'level', x: 8.5, y: 20, width: 7, height: 0, rx: 0.8, fill: 'currentColor', stroke: 'none' }));
            break;
        case 'backup':
            // Generator/alternator: duidelijker als alternatieve voedingsbron dan het oude schild.
            g.append((0, dom_1.svg)('rect', { x: 4, y: 6, width: 16, height: 12, rx: 2.2 }), (0, dom_1.svg)('circle', { cx: 10, cy: 12, r: 3.1 }), (0, dom_1.svg)('path', { d: 'M13.3 12 H17 M17 9.6 V14.4 M6.5 18 V20 M17.5 18 V20' }));
            break;
        default:
            break;
    }
    return g;
}
function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
function createNodeElement(node, center, radius, onOpen, 
/**
 * Waar de naam staat: onder de node, erboven (nodes boven Home, zodat de lijn naar Home vrij blijft)
 * of ernaast (nodes waar aan twee kanten een lijn uitkomt).
 */
labelPosition = 'below') {
    const labelAbove = labelPosition === 'above';
    const labelSide = labelPosition === 'side';
    const hasGlyph = NodeType_1.TYPES_WITH_DEFAULT_ICON.has(node.type) && !node.icon;
    const hasIcon = hasGlyph || !!node.icon;
    const isBattery = node.type === 'battery';
    const g = (0, dom_1.svg)('g', {
        class: `node type-${node.type}`,
        transform: `translate(${center.x.toFixed(1)} ${center.y.toFixed(1)})`,
        tabindex: 0,
        role: 'button',
        'data-node': node.id,
    });
    const title = (0, dom_1.svg)('title');
    const halo = (0, dom_1.svg)('circle', { class: 'halo', r: radius + 6 });
    const ring = (0, dom_1.svg)('circle', { class: 'ring', r: radius });
    g.append(title, halo, ring);
    let levelRect = null;
    if (hasGlyph) {
        const iconG = glyph(node.type);
        const scale = isBattery ? 0.72 : node.type === 'home' ? 1.25 : 1.05;
        const y = isBattery ? -radius * 0.5 : -radius * 0.32;
        iconG.setAttribute('transform', `translate(0 ${y.toFixed(1)}) scale(${scale}) translate(-12 -12)`);
        iconG.setAttribute('stroke-width', String(1.7 / scale));
        g.append(iconG);
        levelRect = iconG.querySelector('.level');
    }
    else if (node.icon) {
        // ha-icon zorgt in Home Assistant voor alle mdi:-iconen.
        const size = 26;
        const fo = (0, dom_1.svg)('foreignObject', { x: -size / 2, y: -radius * 0.32 - size / 2 - 2, width: size, height: size });
        const icon = document.createElement('ha-icon');
        icon.setAttribute('icon', node.icon);
        icon.style.cssText = `--mdc-icon-size:${size}px;display:flex;width:${size}px;height:${size}px;color:var(--c)`;
        fo.append(icon);
        g.append(fo);
    }
    // Tekstregels in de cirkel
    const nameIn = (0, dom_1.svg)('text', { class: 'name-in', y: -3, 'text-anchor': 'middle' });
    const socText = (0, dom_1.svg)('text', { class: 'soc', y: 4, 'text-anchor': 'middle' });
    const valueY = isBattery ? 24 : hasIcon ? radius * 0.5 + 4 : 17;
    const value = (0, dom_1.svg)('text', { class: 'value', y: valueY, 'text-anchor': 'middle' });
    const label = labelSide
        ? (0, dom_1.svg)('text', { class: 'label', x: radius + 10, y: -1, 'text-anchor': 'start' })
        : (0, dom_1.svg)('text', { class: 'label', y: labelAbove ? -(radius + 12) : radius + 20, 'text-anchor': 'middle' });
    const sub = labelSide
        ? (0, dom_1.svg)('text', { class: 'sub', x: radius + 10, y: 17, 'text-anchor': 'start' })
        : (0, dom_1.svg)('text', { class: 'sub', y: labelAbove ? -(radius + 30) : radius + 38, 'text-anchor': 'middle' });
    const subNoIcon = (0, dom_1.svg)('text', { class: 'sub', y: labelAbove ? -(radius + 12) : radius + 20, 'text-anchor': 'middle' });
    const badge = (0, dom_1.svg)('g', { class: 'charging', transform: `translate(${radius * 0.72} ${-radius * 0.72})` });
    badge.append((0, dom_1.svg)('circle', { r: 11 }), (0, dom_1.svg)('path', { d: BOLT, class: 'bolt' }));
    const diagnostic = (0, dom_1.svg)('g', { class: 'diagnostic-badge', transform: `translate(${-radius * 0.72} ${-radius * 0.72})`, visibility: 'hidden' });
    diagnostic.append((0, dom_1.svg)('circle', { r: 9 }), (0, dom_1.svg)('text', { x: 0, y: 4, 'text-anchor': 'middle' }, '!'));
    if (isBattery)
        g.append(socText);
    if (!hasIcon)
        g.append(nameIn);
    g.append(value, badge, diagnostic);
    if (hasIcon)
        g.append(label, sub);
    else
        g.append(subNoIcon);
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
    const update = (view) => {
        (0, dom_1.setAttr)(g, 'data-status', view.status);
        (0, dom_1.setAttr)(g, 'aria-label', [view.displayName, view.socText, view.valueText, view.subtitle].filter(Boolean).join(', '));
        (0, dom_1.setText)(title, view.displayName);
        (0, dom_1.setText)(value, view.valueText);
        (0, dom_1.setText)(label, truncate(view.displayName, labelSide ? 11 : 18));
        (0, dom_1.setText)(nameIn, truncate(view.displayName, 11));
        (0, dom_1.setText)(socText, view.socText ?? '');
        (0, dom_1.setText)(sub, view.subtitle ?? '');
        (0, dom_1.setText)(subNoIcon, view.subtitle ?? '');
        if (view.diagnostic === 'warning' || view.diagnostic === 'error') {
            diagnostic.setAttribute('visibility', 'visible');
            diagnostic.setAttribute('data-severity', view.diagnostic);
        }
        else {
            diagnostic.setAttribute('visibility', 'hidden');
            diagnostic.removeAttribute('data-severity');
        }
        if (levelRect) {
            const h = 13 * (view.level ?? 0);
            (0, dom_1.setAttr)(levelRect, 'height', h.toFixed(2));
            (0, dom_1.setAttr)(levelRect, 'y', (20 - h).toFixed(2));
        }
    };
    return { el: g, update };
}

};
__mods["src/renderer/PopupRenderer"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Popup = void 0;
exports.buildGraph = buildGraph;
exports.buildPhaseGraph = buildPhaseGraph;
const i18n_1 = __req("src/helpers/i18n");
const stateHelper_1 = __req("src/helpers/stateHelper");
const dom_1 = __req("src/renderer/dom");
const W = 320;
const H = 128;
const PAD = { l: 6, r: 6, t: 20, b: 20 };
function signed(watts, format) {
    return `${watts < 0 ? '−' : ''}${(0, stateHelper_1.formatPower)(watts, format)}`;
}
function clock(ms, language) {
    return new Date(ms).toLocaleTimeString(language || undefined, { hour: '2-digit', minute: '2-digit' });
}
function nearestPoint(points, time) {
    if (points.length === 0)
        return undefined;
    let best = points[0];
    let distance = Math.abs(best.t - time);
    for (let i = 1; i < points.length; i++) {
        const candidate = points[i];
        const next = Math.abs(candidate.t - time);
        if (next < distance) {
            best = candidate;
            distance = next;
        }
    }
    return best;
}
/**
 * Maakt de SVG-grafiek inspecteerbaar. Met de muis volgt de marker de cursor; op touch/click
 * blijft het gekozen tijdstip staan. Zo werkt dezelfde interactie op desktop, tablet en mobiel.
 */
function attachInspector(root, start, end, series, format, language) {
    if (series.length === 0 || series.every((item) => item.points.length === 0))
        return;
    const marker = (0, dom_1.svg)('line', {
        class: 'inspect-marker',
        x1: PAD.l,
        x2: PAD.l,
        y1: PAD.t,
        y2: H - PAD.b,
        visibility: 'hidden',
    });
    const dots = series.map(() => (0, dom_1.svg)('circle', { class: 'inspect-dot', r: 3.2, visibility: 'hidden' }));
    const tooltip = (0, dom_1.svg)('g', { class: 'inspect-tooltip', visibility: 'hidden' });
    const tooltipRect = (0, dom_1.svg)('rect', { rx: 5, ry: 5 });
    const tooltipTexts = Array.from({ length: series.length + 2 }, () => (0, dom_1.svg)('text', { class: 'inspect-text' }));
    tooltip.append(tooltipRect, ...tooltipTexts);
    const hit = (0, dom_1.svg)('rect', {
        class: 'inspect-hit',
        x: PAD.l,
        y: PAD.t,
        width: W - PAD.l - PAD.r,
        height: H - PAD.t - PAD.b,
        fill: 'transparent',
        tabindex: 0,
        role: 'button',
        'aria-label': (0, i18n_1.t)('inspect_graph', language),
    });
    root.append(marker, ...dots, tooltip, hit);
    let locked = false;
    let draggingPointer;
    let lastX = PAD.l;
    const xFor = (ms) => PAD.l + ((ms - start) / Math.max(1, end - start)) * (W - PAD.l - PAD.r);
    const updateAt = (svgX) => {
        lastX = Math.max(PAD.l, Math.min(W - PAD.r, svgX));
        const time = start + ((lastX - PAD.l) / (W - PAD.l - PAD.r)) * (end - start);
        const chosen = series.map((item) => nearestPoint(item.points, time));
        const available = chosen.filter((point) => !!point);
        if (available.length === 0)
            return;
        const anchor = available[0];
        const markerX = xFor(anchor.t);
        marker.setAttribute('x1', markerX.toFixed(1));
        marker.setAttribute('x2', markerX.toFixed(1));
        marker.setAttribute('visibility', 'visible');
        const allValues = series.flatMap((item) => item.points.map((p) => p.v));
        const maxV = Math.max(0, ...allValues);
        const minV = Math.min(0, ...allValues);
        const hi = maxV === minV ? minV + 1 : maxV;
        const lo = minV;
        const yFor = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
        chosen.forEach((point, index) => {
            const dot = dots[index];
            if (!point) {
                dot.setAttribute('visibility', 'hidden');
                return;
            }
            dot.setAttribute('cx', xFor(point.t).toFixed(1));
            dot.setAttribute('cy', yFor(point.v).toFixed(1));
            dot.setAttribute('visibility', 'visible');
            if (series.length > 1)
                dot.setAttribute('class', `inspect-dot phase-${index + 1}`);
        });
        const lines = [clock(anchor.t, language)];
        if (series.length === 1) {
            lines.push(signed(anchor.v, format));
        }
        else {
            let total = 0;
            let totalCount = 0;
            chosen.forEach((point, index) => {
                if (!point)
                    return;
                lines.push(`${series[index]?.label ?? `L${index + 1}`}  ${signed(point.v, format)}`);
                total += point.v;
                totalCount++;
            });
            if (totalCount > 0)
                lines.push(`${(0, i18n_1.t)('total_power', language)}  ${signed(total, format)}`);
        }
        const lineHeight = 13;
        const boxW = series.length > 1 ? 118 : 92;
        const boxH = 10 + lines.length * lineHeight;
        const boxX = markerX > W * 0.62 ? markerX - boxW - 7 : markerX + 7;
        const boxY = Math.max(3, PAD.t - 15);
        tooltipRect.setAttribute('x', boxX.toFixed(1));
        tooltipRect.setAttribute('y', boxY.toFixed(1));
        tooltipRect.setAttribute('width', String(boxW));
        tooltipRect.setAttribute('height', String(boxH));
        tooltipTexts.forEach((text, index) => {
            const line = lines[index];
            if (line === undefined) {
                text.setAttribute('visibility', 'hidden');
                return;
            }
            text.textContent = line;
            text.setAttribute('x', (boxX + 7).toFixed(1));
            text.setAttribute('y', (boxY + 13 + index * lineHeight).toFixed(1));
            text.setAttribute('visibility', 'visible');
            text.setAttribute('class', index === 0 ? 'inspect-text inspect-time' : 'inspect-text');
        });
        tooltip.setAttribute('visibility', 'visible');
        hit.setAttribute('aria-label', `${clock(anchor.t, language)}: ${lines.slice(1).join(', ')}`);
    };
    const svgXFromPointer = (ev) => {
        const rect = root.getBoundingClientRect();
        return ((ev.clientX - rect.left) / Math.max(1, rect.width)) * W;
    };
    const hide = () => {
        marker.setAttribute('visibility', 'hidden');
        dots.forEach((dot) => dot.setAttribute('visibility', 'hidden'));
        tooltip.setAttribute('visibility', 'hidden');
    };
    hit.addEventListener('pointermove', (ev) => {
        if (ev.pointerType !== 'mouse') {
            if (draggingPointer !== ev.pointerId)
                return;
            ev.preventDefault();
        }
        updateAt(svgXFromPointer(ev));
    });
    hit.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        locked = true;
        draggingPointer = ev.pointerId;
        try {
            hit.setPointerCapture(ev.pointerId);
        }
        catch { /* older webviews */ }
        updateAt(svgXFromPointer(ev));
    });
    const finishPointer = (ev) => {
        if (draggingPointer !== ev.pointerId)
            return;
        try {
            if (hit.hasPointerCapture(ev.pointerId))
                hit.releasePointerCapture(ev.pointerId);
        }
        catch { /* ignore */ }
        draggingPointer = undefined;
    };
    hit.addEventListener('pointerup', finishPointer);
    hit.addEventListener('pointercancel', finishPointer);
    hit.addEventListener('pointerleave', (ev) => {
        if (ev.pointerType !== 'mouse' || locked)
            return;
        hide();
    });
    hit.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            locked = false;
            hide();
            return;
        }
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')
            return;
        ev.preventDefault();
        locked = true;
        updateAt(lastX + (ev.key === 'ArrowRight' ? 8 : -8));
    });
}
/** Tekent de 24-uursgrafiek als kale SVG: geen externe grafiekbibliotheek nodig. */
function buildGraph(points, start, end, format, language) {
    const root = (0, dom_1.svg)('svg', { class: 'graph interactive-graph', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': (0, i18n_1.t)('last_24h', language) });
    const values = points.map((p) => p.v);
    const maxV = Math.max(0, ...values);
    const minV = Math.min(0, ...values);
    const hi = maxV === minV ? minV + 1 : maxV;
    const lo = minV;
    const x = (ms) => PAD.l + ((ms - start) / (end - start)) * (W - PAD.l - PAD.r);
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const y0 = y(0);
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    const first = points[0];
    const last = points[points.length - 1];
    const area = `${line} L${x(last.t).toFixed(1)} ${y0.toFixed(1)} L${x(first.t).toFixed(1)} ${y0.toFixed(1)} Z`;
    root.append((0, dom_1.svg)('line', { class: 'zero', x1: PAD.l, x2: W - PAD.r, y1: y0.toFixed(1), y2: y0.toFixed(1) }), (0, dom_1.svg)('path', { class: 'area', d: area }), (0, dom_1.svg)('path', { class: 'trace', d: line, fill: 'none' }), (0, dom_1.svg)('text', { class: 'axis', x: PAD.l, y: 12 }, `${(0, i18n_1.t)('maximum', language)} ${signed(maxV, format)}`), (0, dom_1.svg)('text', { class: 'axis', x: PAD.l, y: H - 5 }, clock(start, language)), (0, dom_1.svg)('text', { class: 'axis', x: W - PAD.r, y: H - 5, 'text-anchor': 'end' }, clock(end, language)));
    if (minV < 0) {
        root.append((0, dom_1.svg)('text', { class: 'axis', x: W - PAD.r, y: 12, 'text-anchor': 'end' }, `${(0, i18n_1.t)('minimum', language)} ${signed(minV, format)}`));
    }
    attachInspector(root, start, end, [{ points }], format, language);
    return root;
}
/** Driefaseweergave: dezelfde tijdas en schaal voor L1/L2/L3, zodat de lijnen direct vergelijkbaar zijn. */
function buildPhaseGraph(series, format, language) {
    const ready = series.filter((s) => s.history.kind === 'ready');
    if (ready.length === 0) {
        const loading = series.some((s) => s.history.kind === 'loading');
        return (0, dom_1.html)('div', { class: 'popup-empty' }, (0, i18n_1.t)(loading ? 'loading' : 'no_history', language));
    }
    const start = Math.min(...ready.map((s) => s.history.start));
    const end = Math.max(...ready.map((s) => s.history.end));
    const values = ready.flatMap((s) => s.history.points.map((p) => p.v));
    const maxV = Math.max(0, ...values);
    const minV = Math.min(0, ...values);
    const hi = maxV === minV ? minV + 1 : maxV;
    const lo = minV;
    const x = (ms) => PAD.l + ((ms - start) / (end - start)) * (W - PAD.l - PAD.r);
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const y0 = y(0);
    const root = (0, dom_1.svg)('svg', { class: 'graph phase-graph interactive-graph', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${(0, i18n_1.t)('last_24h', language)} L1 L2 L3` });
    root.append((0, dom_1.svg)('line', { class: 'zero', x1: PAD.l, x2: W - PAD.r, y1: y0.toFixed(1), y2: y0.toFixed(1) }), (0, dom_1.svg)('text', { class: 'axis', x: PAD.l, y: 12 }, `${(0, i18n_1.t)('maximum', language)} ${signed(maxV, format)}`), (0, dom_1.svg)('text', { class: 'axis', x: PAD.l, y: H - 5 }, clock(start, language)), (0, dom_1.svg)('text', { class: 'axis', x: W - PAD.r, y: H - 5, 'text-anchor': 'end' }, clock(end, language)));
    if (minV < 0)
        root.append((0, dom_1.svg)('text', { class: 'axis', x: W - PAD.r, y: 12, 'text-anchor': 'end' }, `${(0, i18n_1.t)('minimum', language)} ${signed(minV, format)}`));
    for (const item of ready) {
        const line = item.history.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
        root.append((0, dom_1.svg)('path', { class: `phase-trace ${item.cssClass}`, d: line, fill: 'none' }));
    }
    attachInspector(root, start, end, ready.map((item) => ({ label: item.label, points: item.history.points })), format, language);
    const legend = (0, dom_1.html)('div', { class: 'phase-legend' });
    for (const item of series) {
        legend.append((0, dom_1.html)('span', { class: `phase-key ${item.cssClass}` }, (0, dom_1.html)('i', {}), item.label));
    }
    return (0, dom_1.html)('div', { class: 'phase-graph-wrap' }, root, legend);
}
class Popup {
    constructor(onClose) {
        this.onClose = onClose;
        this.opener = null;
        this.signature = '';
        this.heading = (0, dom_1.html)('h2', { class: 'popup-title' });
        this.closeButton = (0, dom_1.html)('button', { class: 'popup-close', type: 'button' }, '×');
        this.body = (0, dom_1.html)('div', { class: 'popup-body' });
        const head = (0, dom_1.html)('div', { class: 'popup-head' }, this.heading, this.closeButton);
        this.panel = (0, dom_1.html)('div', { class: 'popup-panel', role: 'dialog', 'aria-modal': 'true' }, head, this.body);
        this.el = (0, dom_1.html)('div', { class: 'popup', hidden: '' }, this.panel);
        this.closeButton.addEventListener('click', () => this.onClose());
        this.el.addEventListener('click', (ev) => {
            if (ev.target === this.el)
                this.onClose();
        });
        this.el.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.stopPropagation();
                this.onClose();
            }
        });
    }
    get isOpen() {
        return !this.el.hasAttribute('hidden');
    }
    open(model, opener) {
        this.opener = opener ?? null;
        this.signature = '';
        this.el.removeAttribute('hidden');
        this.update(model);
        this.closeButton.focus();
    }
    close() {
        this.el.setAttribute('hidden', '');
        this.opener?.focus();
        this.opener = null;
    }
    update(model) {
        const phaseSig = model.phases ? {
            enabled: model.phases.enabled,
            series: model.phases.series.map((s) => [s.label, s.history.kind === 'ready' ? [s.history.points.length, s.history.end] : s.history.kind]),
        } : undefined;
        const sig = JSON.stringify({ ...model, phases: phaseSig, history: model.history.kind === 'ready' ? [model.history.points.length, model.history.end] : model.history.kind });
        if (sig === this.signature)
            return;
        this.signature = sig;
        const { language } = model;
        this.panel.className = `popup-panel type-${model.nodeType}`;
        this.panel.setAttribute('data-status', model.status);
        this.panel.setAttribute('aria-label', model.title);
        this.heading.textContent = model.title;
        this.closeButton.setAttribute('aria-label', (0, i18n_1.t)('close', language));
        const big = (0, dom_1.html)('div', { class: 'popup-big' }, (0, dom_1.html)('span', { class: 'popup-value' }, model.valueText), (0, dom_1.html)('span', { class: 'popup-label' }, model.subtitle ?? (0, i18n_1.t)('current_power', language)));
        let graph;
        if (model.phases?.enabled) {
            graph = buildPhaseGraph(model.phases.series, model.powerFormat, language);
        }
        else {
            switch (model.history.kind) {
                case 'ready':
                    graph = buildGraph(model.history.points, model.history.start, model.history.end, model.powerFormat, language);
                    break;
                case 'loading':
                    graph = (0, dom_1.html)('div', { class: 'popup-empty' }, (0, i18n_1.t)('loading', language));
                    break;
                default:
                    graph = (0, dom_1.html)('div', { class: 'popup-empty' }, (0, i18n_1.t)('no_history', language));
            }
        }
        const graphBox = (0, dom_1.html)('section', { class: 'popup-section' }, (0, dom_1.html)('h3', {}, (0, i18n_1.t)('last_24h', language)), graph);
        if (model.phases) {
            const checkbox = (0, dom_1.html)('input', { type: 'checkbox' });
            checkbox.checked = model.phases.enabled;
            checkbox.addEventListener('change', () => model.phases?.onToggle(checkbox.checked));
            graphBox.append((0, dom_1.html)('label', { class: 'phase-toggle' }, checkbox, (0, dom_1.html)('span', {}, (0, i18n_1.t)('show_phases', language)), (0, dom_1.html)('small', {}, (0, i18n_1.t)('phase_graph_hint', language))));
        }
        const rows = (0, dom_1.html)('dl', { class: 'popup-rows' });
        for (const row of model.rows)
            rows.append((0, dom_1.html)('dt', {}, row.label), (0, dom_1.html)('dd', {}, row.value));
        this.body.replaceChildren(big, graphBox);
        if (model.rows.length > 0)
            this.body.append(rows);
        if (model.energyStats) {
            const stats = (0, dom_1.html)('section', { class: 'energy-stats' }, (0, dom_1.html)('h3', {}, (0, i18n_1.t)('energy_costs', language)));
            const tabs = (0, dom_1.html)('div', { class: 'energy-stats-tabs', role: 'tablist' });
            const periods = [
                ['today', (0, i18n_1.t)('period_today', language)],
                ['week', (0, i18n_1.t)('period_week', language)],
                ['month', (0, i18n_1.t)('period_month', language)],
            ];
            for (const [period, label] of periods) {
                const button = (0, dom_1.html)('button', { type: 'button', class: `energy-stats-tab${model.energyStats.selected === period ? ' active' : ''}` }, label);
                button.addEventListener('click', () => model.energyStats?.onSelect(period));
                tabs.append(button);
            }
            stats.append(tabs);
            if (model.energyStats.loading) {
                stats.append((0, dom_1.html)('div', { class: 'energy-stats-loading' }, (0, i18n_1.t)('loading', language)));
            }
            else if (model.energyStats.rows.length === 0) {
                stats.append((0, dom_1.html)('div', { class: 'energy-stats-loading' }, (0, i18n_1.t)('energy_stats_unavailable', language)));
            }
            else {
                const statRows = (0, dom_1.html)('dl', { class: 'energy-stats-rows' });
                for (const row of model.energyStats.rows)
                    statRows.append((0, dom_1.html)('dt', {}, row.label), (0, dom_1.html)('dd', {}, row.value));
                stats.append(statRows);
            }
            this.body.append(stats);
        }
        if (model.diagnostics) {
            const box = (0, dom_1.html)('section', { class: `diagnostics diagnostics-${model.diagnostics.severity}` }, (0, dom_1.html)('div', { class: 'diagnostics-head' }, (0, dom_1.html)('span', { class: 'diagnostics-dot', 'aria-hidden': 'true' }), (0, dom_1.html)('h3', {}, (0, i18n_1.t)('diagnostics', language))));
            if (model.diagnostics.message)
                box.append((0, dom_1.html)('p', { class: 'diagnostics-message' }, model.diagnostics.message));
            if (model.diagnostics.rows.length > 0) {
                const diagnosticRows = (0, dom_1.html)('dl', { class: 'diagnostics-rows' });
                for (const row of model.diagnostics.rows)
                    diagnosticRows.append((0, dom_1.html)('dt', {}, row.label), (0, dom_1.html)('dd', {}, row.value));
                box.append(diagnosticRows);
            }
            this.body.append(box);
        }
        if (model.note)
            this.body.append((0, dom_1.html)('p', { class: 'popup-note' }, model.note));
    }
}
exports.Popup = Popup;

};
__mods["src/renderer/dom"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.svg = svg;
exports.html = html;
exports.setText = setText;
exports.setAttr = setAttr;
const SVG_NS = 'http://www.w3.org/2000/svg';
function apply(el, attrs) {
    for (const [key, value] of Object.entries(attrs)) {
        if (value !== undefined)
            el.setAttribute(key, String(value));
    }
}
function svg(tag, attrs = {}, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    apply(el, attrs);
    for (const child of children)
        el.append(child);
    return el;
}
function html(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    apply(el, attrs);
    for (const child of children)
        el.append(child);
    return el;
}
/** Zet tekst alleen als die echt veranderd is; voorkomt onnodig DOM-werk bij elke hass-update. */
function setText(el, text) {
    if (el.textContent !== text)
        el.textContent = text;
}
function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value)
        el.setAttribute(name, value);
}

};
__mods["src/types/EntityStatus"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntityStatus = void 0;
exports.statusSymbol = statusSymbol;
exports.hasValue = hasValue;
/** Wat we weten over de waarde van één Home Assistant-entiteit. */
var EntityStatus;
(function (EntityStatus) {
    /** Een geldig getal ongelijk aan nul, bijvoorbeeld 1250 W. */
    EntityStatus["Valid"] = "valid";
    /** Een geldig getal dat precies 0 is. */
    EntityStatus["Zero"] = "zero";
    /** Tekst die geen getal is, of een entiteit die niet bestaat. */
    EntityStatus["Invalid"] = "invalid";
    /** Home Assistant meldt "unknown". */
    EntityStatus["Unknown"] = "unknown";
    /** Home Assistant meldt "unavailable". */
    EntityStatus["Unavailable"] = "unavailable";
    /** Een node die op dit moment laadt (laadindicator). */
    EntityStatus["Charging"] = "charging";
})(EntityStatus || (exports.EntityStatus = EntityStatus = {}));
/** Het teken dat in plaats van een waarde wordt getoond: "?" of "!"; null als er een waarde is. */
function statusSymbol(status) {
    switch (status) {
        case EntityStatus.Invalid:
        case EntityStatus.Unknown:
            return '?';
        case EntityStatus.Unavailable:
            return '!';
        default:
            return null;
    }
}
/** Is er een bruikbare getalwaarde (ook 0 W)? */
function hasValue(status) {
    return status === EntityStatus.Valid || status === EntityStatus.Zero || status === EntityStatus.Charging;
}

};
__mods["src/types/NodeType"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TYPES_WITH_DEFAULT_ICON = exports.NODE_TYPES = void 0;
exports.normalizeType = normalizeType;
exports.roleOf = roleOf;
exports.NODE_TYPES = [
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
];
const ALIASES = {
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
function normalizeType(value) {
    if (typeof value !== 'string')
        return null;
    const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return exports.NODE_TYPES.includes(key) ? key : (ALIASES[key] ?? null);
}
function roleOf(type) {
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
exports.TYPES_WITH_DEFAULT_ICON = new Set(['home', 'grid', 'solar', 'battery', 'backup']);

};
__mods["src/types/hass"]=(module,exports,__req)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

};
function __req(id){if(__cache[id])return __cache[id].exports;const f=__mods[id];if(!f)throw new Error('Module not found: '+id);const m={exports:{}};__cache[id]=m;f(m,m.exports,__req);return m.exports;}
__req('src/index');
})();
