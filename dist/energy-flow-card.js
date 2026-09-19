(()=>{
const __mods={
"src/card/EnergyFlowCard":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigError = exports.EnergyFlowCard = void 0;
const CardConfig_1 = require("../config/CardConfig");
Object.defineProperty(exports, "ConfigError", { enumerable: true, get: function () { return CardConfig_1.ConfigError; } });
const DemoEngine_1 = require("../demo/DemoEngine");
const flowHelper_1 = require("../helpers/flowHelper");
const historyHelper_1 = require("../helpers/historyHelper");
const i18n_1 = require("../helpers/i18n");
const stateHelper_1 = require("../helpers/stateHelper");
const AutoLayout_1 = require("../layout/AutoLayout");
const Node_1 = require("../models/Node");
const ConnectionRenderer_1 = require("../renderer/ConnectionRenderer");
const NodeRenderer_1 = require("../renderer/NodeRenderer");
const PopupRenderer_1 = require("../renderer/PopupRenderer");
const dom_1 = require("../renderer/dom");
const styles_1 = require("./styles");
const HISTORY_HOURS = 24;
const HISTORY_TTL_MS = 60_000;
/** In demo-modus begint de tijd op 300 s, zodat er al "geschiedenis" bestaat voor de grafiek. */
const DEMO_OFFSET_S = 300;
class EnergyFlowCard extends HTMLElement {
    constructor() {
        super();
        this.nodeEls = new Map();
        this.connEls = [];
        this.popup = new PopupRenderer_1.Popup(() => this.closePopup());
        this.history = new Map();
        this.demoStart = 0;
        this.reducedMotion = false;
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
        this.buildStructure();
        this.syncTimer();
        this.update();
    }
    set hass(hass) {
        this._hass = hass;
        if (!this.config?.demo)
            this.update();
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
        this.syncTimer();
        if (this.config)
            this.update();
    }
    disconnectedCallback() {
        this.motionQuery?.removeEventListener('change', this.onMotionChange);
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
        const card = (0, dom_1.html)('ha-card', { class: customElements.get('ha-card') ? '' : 'fallback' });
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
            stage.append(this.buildFlowSvg(cfg));
        }
        card.append(this.popup.el);
        root.replaceChildren((0, dom_1.html)('style', {}, styles_1.styles), card);
    }
    buildFlowSvg(cfg) {
        const layout = (0, AutoLayout_1.computeLayout)(cfg.nodes, cfg.layout, cfg.connections);
        const straight = layout.mode !== 'circle';
        const byId = new Map(cfg.nodes.map((n) => [n.id, n]));
        const homeNode = cfg.nodes.find((n) => n.role === 'home');
        const homeY = (homeNode && layout.positions.get(homeNode.id)?.y) ?? layout.height / 2;
        const radiusOf = (n) => (n.role === 'home' ? AutoLayout_1.HOME_RADIUS : AutoLayout_1.NODE_RADIUS);
        const root = (0, dom_1.svg)('svg', { class: `flow layout-${layout.mode}`, viewBox: `0 0 ${layout.width} ${layout.height}`, role: 'group' });
        const connLayer = (0, dom_1.svg)('g', { class: 'connections' });
        const nodeLayer = (0, dom_1.svg)('g', { class: 'nodes' });
        root.append(connLayer, nodeLayer);
        for (const conn of cfg.connections) {
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
        for (const node of cfg.nodes) {
            const pos = layout.positions.get(node.id);
            if (!pos)
                continue;
            const nodeEl = (0, NodeRenderer_1.createNodeElement)(node, pos, radiusOf(node), () => this.openPopup(node.id), labelPositionFor(node, pos.y, homeY, straight));
            this.nodeEls.set(node.id, nodeEl);
            nodeLayer.append(nodeEl.el);
        }
        return root;
    }
    // ----- Live bijwerken -----------------------------------------------------------------------
    compute() {
        const cfg = this.config;
        const readings = new Map();
        let flows;
        if (cfg.demo) {
            const tSeconds = DEMO_OFFSET_S + (performance.now() - this.demoStart) / 1000;
            for (const [id, r] of (0, DemoEngine_1.demoReadings)(cfg.nodes, tSeconds))
                readings.set(id, r);
            (0, flowHelper_1.applyBackupReadings)(cfg.nodes, cfg.connections, readings, true);
            flows = (0, flowHelper_1.computeFlows)(cfg.nodes, cfg.connections, readings, undefined, { ignoreEntities: true });
        }
        else {
            for (const node of cfg.nodes)
                if (node.role !== 'home')
                    readings.set(node.id, (0, flowHelper_1.readNode)(node, this._hass));
            (0, flowHelper_1.applyBackupReadings)(cfg.nodes, cfg.connections, readings, false);
            flows = (0, flowHelper_1.computeFlows)(cfg.nodes, cfg.connections, readings, this._hass);
        }
        const home = cfg.nodes.find((n) => n.role === 'home');
        if (home) {
            // Een expliciete woningsensor heeft voorrang. Zonder sensor blijft Woning automatisch berekend.
            const measuredHome = !cfg.demo && !!home.config.power_entity;
            readings.set(home.id, measuredHome ? (0, flowHelper_1.readNode)(home, this._hass) : (0, flowHelper_1.computeHomeReading)(home, cfg.nodes, cfg.connections, flows));
        }
        return { readings, flows };
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
        this.computed = this.compute();
        const ctx = { powerFormat: cfg.powerFormat, language: this.language };
        for (const node of cfg.nodes) {
            const reading = this.computed.readings.get(node.id);
            if (reading)
                this.nodeEls.get(node.id)?.update((0, NodeRenderer_1.describeNode)(node, reading, ctx));
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
        const node = cfg?.nodes.find((n) => n.id === nodeId);
        const reading = this.computed?.readings.get(nodeId);
        if (!cfg || !node || !reading)
            return undefined;
        const view = (0, NodeRenderer_1.describeNode)(node, reading, { powerFormat: cfg.powerFormat, language: this.language });
        const lang = this.language;
        const rows = [];
        if (reading.soc)
            rows.push({ label: (0, i18n_1.t)('soc', lang), value: view.socText ?? '?' });
        if (!cfg.demo) {
            for (const field of (0, Node_1.advancedFieldsFor)(node.type)) {
                if (field === 'soc_entity')
                    continue;
                if (field === 'production_entity' && !node.config.power_entity)
                    continue;
                const id = node.config[field];
                if (typeof id === 'string' && id)
                    rows.push({ label: (0, i18n_1.t)((0, Node_1.fieldLabelKey)(field, node.type), lang), value: this.formatEntity(id) });
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
            note: node.role === 'home' ? (0, i18n_1.t)(computedHome ? 'home_computed' : 'home_measured', lang) : undefined,
            powerFormat: cfg.powerFormat,
            language: lang,
        };
    }
    async ensureHistory(nodeId) {
        const cfg = this.config;
        const node = cfg?.nodes.find((n) => n.id === nodeId);
        if (!cfg || !node)
            return;
        const cached = this.history.get(nodeId);
        if (cached && Date.now() - cached.fetchedAt < HISTORY_TTL_MS)
            return;
        const store = (state) => {
            this.history.set(nodeId, { state, fetchedAt: Date.now() });
            if (this.openNodeId === nodeId && this.popup.isOpen) {
                const model = this.popupModel(nodeId);
                if (model)
                    this.popup.update(model);
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
            const factor = (0, historyHelper_1.unitFactor)(this._hass.states[entityId]?.attributes.unit_of_measurement);
            const raw = await (0, historyHelper_1.fetchHistory)(this._hass, entityId, HISTORY_HOURS, factor, node.invert, end);
            const points = (0, historyHelper_1.bucketize)(raw, start, end, 96);
            store(points.length >= 2 ? { kind: 'ready', points, start, end } : { kind: 'none' });
        }
        catch {
            store({ kind: 'none' });
        }
    }
    /** Demo: hergebruikt de demo-engine over de afgelopen 240 s en presenteert dat als "24 uur". */
    demoHistory(node) {
        const cfg = this.config;
        const now = Date.now();
        const span = 24 * 3_600_000;
        const nowT = DEMO_OFFSET_S + (performance.now() - this.demoStart) / 1000;
        const samples = 96;
        const points = [];
        const home = cfg.nodes.find((n) => n.role === 'home');
        for (let i = 0; i < samples; i++) {
            const tSeconds = nowT - 240 + (240 * i) / (samples - 1);
            const readings = (0, DemoEngine_1.demoReadings)(cfg.nodes, tSeconds);
            (0, flowHelper_1.applyBackupReadings)(cfg.nodes, cfg.connections, readings, true);
            let watts;
            if (node.role === 'home' && home) {
                const flows = (0, flowHelper_1.computeFlows)(cfg.nodes, cfg.connections, readings, undefined, { ignoreEntities: true });
                watts = (0, flowHelper_1.computeHomeReading)(home, cfg.nodes, cfg.connections, flows).watts;
            }
            else {
                watts = readings.get(node.id)?.watts;
            }
            if (typeof watts === 'number')
                points.push({ t: now - span + (span * i) / (samples - 1), v: watts });
        }
        return points.length >= 2 ? { kind: 'ready', points, start: now - span, end: now } : { kind: 'none' };
    }
}
exports.EnergyFlowCard = EnergyFlowCard;
/** Namen boven Home komen boven de node; in de rechte layout staan Home en backup (lijnen boven en onder) ernaast. */
function labelPositionFor(node, y, homeY, straight) {
    if (straight && (node.role === 'home' || node.type === 'backup'))
        return 'side';
    return y < homeY - 1 ? 'above' : 'below';
}

},
"src/card/styles":(module,exports,require)=>{
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
.stage { position: relative; padding: 10px 12px 18px; min-height: 470px; }
.flow { display: block; width: 100%; max-width: 860px; height: auto; margin: 0 auto; }

.badge {
  position: absolute; top: 10px; left: 12px; z-index: 1;
  padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 500;
  color: var(--secondary-text-color, #727272);
  border: 1px solid var(--divider-color, #e0e0e0);
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
.popup-empty { padding: 22px 0; text-align: center; color: var(--secondary-text-color, #727272); font-size: 14px; }
.popup-rows { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; margin: 12px 0 0; font-size: 14px; }
.popup-rows dt { color: var(--secondary-text-color, #727272); }
.popup-rows dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.popup-note { margin: 12px 0 0; font-size: 13px; color: var(--secondary-text-color, #727272); }

@media (max-width: 600px) {
  .stage { min-height: 420px; padding-inline: 6px; }
  .popup { padding: 8px; }
  .popup-panel { width: calc(100vw - 16px); max-height: calc(100vh - 16px); border-radius: 12px; padding: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .halo { transition: none; }
}
`;

},
"src/config/CardConfig":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigError = void 0;
exports.normalizeConfig = normalizeConfig;
const Connection_1 = require("../models/Connection");
const Node_1 = require("../models/Node");
const NodeType_1 = require("../types/NodeType");
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
    const layout = parseLayout(raw.layout);
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
        connections,
        layout,
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
/** `connected_to` mag alleen bij een gewoon apparaat en moet naar een backup verwijzen (Home is de standaard). */
function checkConnectedTo(nodes) {
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
        if (target.role !== 'home' && target.type !== 'backup') {
            throw new ConfigError(`Node "${label}": "connected_to" moet naar Home of een backup-node verwijzen, niet naar "${ref}".`);
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

},
"src/demo/DemoEngine":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.demoReadings = demoReadings;
const flowHelper_1 = require("../helpers/flowHelper");
const EntityStatus_1 = require("../types/EntityStatus");
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
                consumption += watts;
                break;
            }
            default:
                break;
        }
        if (watts !== null)
            out.set(node.id, reading(node, watts));
    });
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

},
"src/editor/EnergyFlowCardEditor":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnergyFlowCardEditor = void 0;
const CardConfig_1 = require("../config/CardConfig");
const i18n_1 = require("../helpers/i18n");
const Node_1 = require("../models/Node");
const dom_1 = require("../renderer/dom");
const NodeType_1 = require("../types/NodeType");
const SELECTABLE_TYPES = NodeType_1.NODE_TYPES.filter((type) => type !== 'home');
const POWER_FIELDS = new Set(['power_entity', 'charge_power_entity', 'discharge_power_entity', 'production_entity']);
const editorStyles = `
:host { display: block; color: var(--primary-text-color); }
.wizard { display: flex; flex-direction: column; gap: 16px; }
.tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--divider-color, #e0e0e0); }
.tab {
  flex: 1; padding: 10px 6px; border: 0; background: none; cursor: pointer; font: inherit; color: var(--secondary-text-color);
  border-bottom: 3px solid transparent; margin-bottom: -1px;
}
.tab[aria-selected="true"] { color: var(--primary-text-color); border-bottom-color: var(--primary-color, #03a9f4); font-weight: 600; }
.tab .n { display: inline-block; width: 20px; height: 20px; line-height: 20px; border-radius: 50%; margin-right: 6px;
  font-size: 12px; background: var(--secondary-background-color, #eee); }
.tab[aria-selected="true"] .n { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
.hint { margin: 0; font-size: 14px; color: var(--secondary-text-color); line-height: 1.4; }
.error { padding: 10px 12px; border-radius: 8px; font-size: 14px; background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }
.device { border: 1px solid var(--divider-color, #e0e0e0); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
label.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--secondary-text-color); flex: 1; min-width: 130px; }
input[type="text"], select {
  font: inherit; font-size: 14px; padding: 9px 10px; border-radius: 8px; box-sizing: border-box; width: 100%;
  border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff); color: var(--primary-text-color);
}
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
 * Wizard in drie stappen: 1 Apparaten, 2 Verbindingen, 3 Voorbeeld.
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
        const labels = [(0, i18n_1.t)('ed_step_devices', this.uiLang), (0, i18n_1.t)('ed_step_connections', this.uiLang), (0, i18n_1.t)('ed_step_preview', this.uiLang)];
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
        nav.append(this.step > 1 ? back : (0, dom_1.html)('span'), this.step < 3 ? next : (0, dom_1.html)('span'));
        return nav;
    }
    goTo(step) {
        if (step < 1 || step > 3)
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
        }
        const icon = (0, dom_1.html)('input', { type: 'text', placeholder: 'mdi:…', autocomplete: 'off', spellcheck: 'false' });
        icon.value = node.icon ?? '';
        icon.addEventListener('input', () => {
            if (icon.value.trim())
                node.icon = icon.value.trim();
            else
                delete node.icon;
        });
        icon.addEventListener('change', () => this.setOrDelete(node, 'icon', icon.value.trim()));
        advanced.append(this.field((0, i18n_1.t)('ed_icon', lang), icon));
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
        // Achter een backup kunnen bepaalde verbruikers hangen: dan lopen die via de backup in plaats van direct via Home.
        const backups = this.nodes.filter((n) => (0, NodeType_1.normalizeType)(n.type) === 'backup' && n !== node);
        let parent;
        if (backups.length > 0 && (0, NodeType_1.roleOf)(type) === 'consumer' && type !== 'backup') {
            const parentSelect = (0, dom_1.html)('select');
            parentSelect.append((0, dom_1.html)('option', { value: 'home' }, (0, i18n_1.t)('home', lang)));
            for (const b of backups)
                parentSelect.append((0, dom_1.html)('option', { value: b.id ?? '' }, b.name || b.id || ''));
            parentSelect.value = backups.some((b) => b.id === node.connected_to) ? node.connected_to : 'home';
            parentSelect.addEventListener('change', () => this.setParent(node, parentSelect.value));
            parent = this.field((0, i18n_1.t)('ed_connected_to', lang), parentSelect);
        }
        return (0, dom_1.html)('div', { class: 'device' }, (0, dom_1.html)('div', { class: 'row' }, this.field((0, i18n_1.t)('ed_name', lang), name), this.field((0, i18n_1.t)('ed_type', lang), select)), ...(parent ? [(0, dom_1.html)('div', { class: 'row' }, parent)] : []), (0, dom_1.html)('div', { class: 'row' }, this.field((0, i18n_1.t)('ed_power_entity', lang), power), remove), this.section(`advanced:${node.id ?? ''}`, (0, i18n_1.t)('ed_advanced', lang), advanced));
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
    /** Hang een apparaat aan Home of aan een backup, ook in een handmatige lijst met verbindingen. */
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
                        const otherId = c.from === me.id ? c.to : c.to === me.id ? c.from : null;
                        const other = otherId ? resolved.nodes.find((n) => n.id === otherId) : undefined;
                        const isParentLink = other && (other.role === 'home' || other.type === 'backup');
                        if (!isParentLink)
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
        // Apparaten die achter deze backup hingen, hangen daarna weer aan Home.
        for (const other of this.nodes) {
            if (other !== node && other.connected_to && (other.connected_to === node.id || other.connected_to === node.name)) {
                delete other.connected_to;
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
        // Alleen gewone apparaten kunnen achter een backup hangen.
        if ((0, NodeType_1.roleOf)(type) !== 'consumer' || type === 'backup')
            delete node.connected_to;
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
    // ----- Stap 3: Voorbeeld --------------------------------------------------------------------
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
        return (0, dom_1.html)('div', { class: 'stack' }, (0, dom_1.html)('p', { class: 'hint' }, (0, i18n_1.t)('ed_preview_hint', lang)), this.field((0, i18n_1.t)('ed_layout', lang), layoutSelect), card, (0, dom_1.html)('label', { class: 'check' }, demo, (0, i18n_1.t)('ed_demo', lang)));
    }
    errorBox(message) {
        return (0, dom_1.html)('div', { class: 'error' }, `${(0, i18n_1.t)('ed_fix_first', this.uiLang)} ${message}`);
    }
}
exports.EnergyFlowCardEditor = EnergyFlowCardEditor;

},
"src/helpers/flowHelper":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flowToHome = flowToHome;
exports.isCharging = isCharging;
exports.readNode = readNode;
exports.computeFlows = computeFlows;
exports.computeHomeReading = computeHomeReading;
exports.applyBackupReadings = applyBackupReadings;
const EntityStatus_1 = require("../types/EntityStatus");
const stateHelper_1 = require("./stateHelper");
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
            // Home en een backup voeden allebei de gewone apparaten die eraan hangen.
            const feeds = (hub, device) => hub.role === 'home' || (hub.type === 'backup' && device.role === 'consumer' && device.type !== 'backup');
            if (feeds(to, from) && fromReading) {
                value = flowToHome(from, fromReading);
            }
            else if (feeds(from, to) && toReading) {
                const f = flowToHome(to, toReading);
                value = f === null ? null : negateSafe(f);
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

},
"src/helpers/historyHelper":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchHistory = fetchHistory;
exports.bucketize = bucketize;
exports.unitFactor = unitFactor;
const stateHelper_1 = require("./stateHelper");
const HOUR = 3_600_000;
/**
 * Haalt de geschiedenis van een sensor op via de Home Assistant REST-API
 * (hass.callApi). Waarden worden omgerekend naar W met `unitFactor`.
 */
async function fetchHistory(hass, entityId, hours, unitFactor, invert, now = Date.now()) {
    if (!hass.callApi)
        return [];
    const start = new Date(now - hours * HOUR).toISOString();
    const path = `history/period/${start}?filter_entity_id=${encodeURIComponent(entityId)}` +
        `&end_time=${encodeURIComponent(new Date(now).toISOString())}&minimal_response&no_attributes`;
    const response = await hass.callApi('GET', path);
    const states = response?.[0] ?? [];
    const points = [];
    for (const s of states) {
        const v = (0, stateHelper_1.parsePower)(s.state);
        const stamp = s.last_changed ?? s.last_updated;
        if (v === null || !stamp)
            continue;
        points.push({ t: Math.max(Date.parse(stamp), now - hours * HOUR), v: (invert ? -v : v) * unitFactor });
    }
    return points;
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

},
"src/helpers/i18n":(module,exports,require)=>{
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
    ed_step_preview: "Voorbeeld",
    ed_home_auto: "De woning wordt automatisch toegevoegd. Voeg de apparaten toe die energie leveren of gebruiken.",
    ed_add_device: "Apparaat toevoegen",
    ed_name: "Naam",
    ed_type: "Type",
    ed_power_entity: "Vermogenssensor",
    ed_advanced: "Geavanceerd",
    ed_remove: "Verwijderen",
    ed_icon: "Icoon (bijv. mdi:heat-pump)",
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
    ed_layout_flow: "Flow: energiestromen centraal",
    ed_layout_circle: "Rond: vaste plekken rond de woning",
    ed_layout_straight: "Recht: van boven naar beneden",
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
    ed_step_preview: "Preview",
    ed_home_auto: "Home is added automatically. Add the devices that supply or use energy.",
    ed_add_device: "Add device",
    ed_name: "Name",
    ed_type: "Type",
    ed_power_entity: "Power sensor",
    ed_advanced: "Advanced",
    ed_remove: "Remove",
    ed_icon: "Icon (e.g. mdi:heat-pump)",
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
    ed_layout_flow: "Flow: energy flows first",
    ed_layout_circle: "Round: fixed spots around the home",
    ed_layout_straight: "Straight: top to bottom",
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

},
"src/helpers/stateHelper":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePower = parsePower;
exports.getEntityStatus = getEntityStatus;
exports.readPower = readPower;
exports.readNumber = readNumber;
exports.formatPower = formatPower;
exports.formatPercent = formatPercent;
const EntityStatus_1 = require("../types/EntityStatus");
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

},
"src/index":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const EnergyFlowCard_1 = require("./card/EnergyFlowCard");
const EnergyFlowCardEditor_1 = require("./editor/EnergyFlowCardEditor");
if (!customElements.get('energy-flow-card'))
    customElements.define('energy-flow-card', EnergyFlowCard_1.EnergyFlowCard);
if (!customElements.get('energy-flow-card-editor'))
    customElements.define('energy-flow-card-editor', EnergyFlowCardEditor_1.EnergyFlowCardEditor);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'energy-flow-card')) {
    window.customCards.push({
        type: 'energy-flow-card',
        name: 'Energy Flow Card',
        description: 'Laat live zien waar je energie vandaan komt en waar die nu heen gaat.',
        preview: true,
    });
}
console.info('%c ENERGY-FLOW-CARD %c 0.7.2 ', 'color:#fff;background:#33b07a;font-weight:600', 'color:#33b07a');

},
"src/layout/AutoLayout":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRAIGHT_ROW_GAP = exports.HOME_RADIUS = exports.NODE_RADIUS = void 0;
exports.computeLayout = computeLayout;
const Connection_1 = require("../models/Connection");
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
/** Het apparaat hangt achter deze backup, als de verbindingen dat zeggen. */
function backupParentOf(node, byId, links) {
    if (node.role !== 'consumer' || node.type === 'backup')
        return undefined;
    for (const c of links) {
        const otherId = c.from === node.id ? c.to : c.to === node.id ? c.from : null;
        const other = otherId ? byId.get(otherId) : undefined;
        if (other?.type === 'backup')
            return other;
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
    // 3. Apparaten achter een backup staan op de buitenring, naast hun backup.
    const rest = [];
    for (const device of members.get('device') ?? []) {
        const parent = backupParentOf(device, byId, links);
        const parentSlot = parent ? placed.get(parent.id) : undefined;
        if (parentSlot) {
            const slot = nearestFree(slotAngle(parentSlot.ring, parentSlot.index), 2);
            take(device, slot.ring, slot.index);
        }
        else {
            rest.push(device);
        }
    }
    // 4. Overige apparaten: diagonalen, dan vrije vaste plekken, dan steeds een ring verder naar buiten.
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
    for (const device of rest) {
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
    const pts = new Map();
    const home = nodes.find((n) => n.role === 'home');
    const producers = auto.filter((n) => n.role === 'source');
    const grids = auto.filter((n) => n.type === 'grid');
    const batteries = auto.filter((n) => n.type === 'battery');
    const backups = auto.filter((n) => n.type === 'backup');
    const consumers = auto.filter((n) => n.role === 'consumer' && n.type !== 'backup');
    const behind = new Map();
    const direct = [];
    for (const device of consumers) {
        const parent = backupParentOf(device, byId, links);
        if (parent && backups.includes(parent))
            behind.set(parent.id, [...(behind.get(parent.id) ?? []), device]);
        else
            direct.push(device);
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
    if (home)
        pts.set(home.id, { x: centerX, y: HOME_Y });
    // Productie boven Home, horizontaal verdeeld.
    producers.forEach((n, i) => pts.set(n.id, { x: centerX + (i - (producers.length - 1) / 2) * COL, y: TOP }));
    // Net links en opslag rechts. Bij meerdere nodes worden ze verticaal verdeeld rond Home.
    const sideY = (i, count) => HOME_Y + (i - (count - 1) / 2) * 112;
    grids.forEach((n, i) => pts.set(n.id, { x: 78, y: sideY(i, grids.length) }));
    batteries.forEach((n, i) => pts.set(n.id, { x: width - 78, y: sideY(i, batteries.length) }));
    // Onder Home: directe verbruikers en backups. Een backup reserveert evenveel kolommen als kinderen erachter.
    const items = [...direct, ...backups];
    const widthOf = (n) => (n.type === 'backup' ? Math.max(1, behind.get(n.id)?.length ?? 0) : 1);
    const total = Math.max(1, items.reduce((sum, n) => sum + widthOf(n), 0));
    let cursor = 0;
    for (const item of items) {
        const slots = widthOf(item);
        const x = centerX + (cursor + (slots - 1) / 2 - (total - 1) / 2) * COL;
        pts.set(item.id, { x, y: DEVICE_Y });
        (behind.get(item.id) ?? []).forEach((child, i) => pts.set(child.id, { x: centerX + (cursor + i - (total - 1) / 2) * COL, y: BACKUP_CHILD_Y }));
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
    // Onder Home: gewone apparaten, dan de backups; onder elke backup de apparaten die erachter hangen.
    const devices = auto.filter((n) => n.role === 'consumer' && n.type !== 'backup');
    const backups = auto.filter((n) => n.type === 'backup');
    const behind = new Map();
    const direct = [];
    for (const device of devices) {
        const parent = backupParentOf(device, byId, links);
        if (parent && backups.includes(parent))
            behind.set(parent.id, [...(behind.get(parent.id) ?? []), device]);
        else
            direct.push(device);
    }
    const items = [...direct, ...backups];
    const widthOf = (n) => Math.max(1, behind.get(n.id)?.length ?? 1);
    const total = items.reduce((sum, n) => sum + widthOf(n), 0);
    let cursor = 0;
    for (const item of items) {
        const w = widthOf(item);
        pts.set(item.id, { x: (cursor + (w - 1) / 2 - (total - 1) / 2) * COL, y: exports.STRAIGHT_ROW_GAP });
        (behind.get(item.id) ?? []).forEach((child, i) => pts.set(child.id, { x: (cursor + i - (total - 1) / 2) * COL, y: 2 * exports.STRAIGHT_ROW_GAP }));
        cursor += w;
    }
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

},
"src/models/Connection":(module,exports,require)=>{
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
 * Een gewoon apparaat kan achter een backup hangen (`connected_to`). Een backup zelf hangt altijd aan Home.
 * Geeft undefined als het apparaat aan Home hangt.
 */
function parentOf(node, nodes) {
    const ref = node.config.connected_to?.trim();
    if (!ref || node.role !== 'consumer' || node.type === 'backup')
        return undefined;
    const lower = ref.toLowerCase();
    const parent = nodes.find((n) => n.id === ref) ?? nodes.find((n) => n.name?.toLowerCase() === lower);
    return parent?.type === 'backup' ? parent : undefined;
}

},
"src/models/Node":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNode = createNode;
exports.generateId = generateId;
exports.advancedFieldsFor = advancedFieldsFor;
exports.fieldLabelKey = fieldLabelKey;
const NodeType_1 = require("../types/NodeType");
function createNode(config, type, id) {
    return {
        id,
        name: config.name?.trim() || undefined,
        type,
        role: (0, NodeType_1.roleOf)(type),
        icon: config.icon?.trim() || undefined,
        invert: config.invert === true,
        config,
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
            return ['energy_import_entity', 'energy_export_entity'];
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

},
"src/renderer/ConnectionRenderer":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeGeometry = computeGeometry;
exports.particleDuration = particleDuration;
exports.createConnectionElement = createConnectionElement;
const AutoLayout_1 = require("../layout/AutoLayout");
const dom_1 = require("./dom");
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

},
"src/renderer/NodeRenderer":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.displayNameOf = displayNameOf;
exports.describeNode = describeNode;
exports.createNodeElement = createNodeElement;
const i18n_1 = require("../helpers/i18n");
const stateHelper_1 = require("../helpers/stateHelper");
const EntityStatus_1 = require("../types/EntityStatus");
const NodeType_1 = require("../types/NodeType");
const dom_1 = require("./dom");
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
            // Een schild met bliksemschicht: de woning-groep die ook bij een netstoring stroom houdt.
            g.append((0, dom_1.svg)('path', { d: 'M12 2.8 L19.5 5.8 V12 C19.5 16.6 16.4 19.9 12 21.4 C7.6 19.9 4.5 16.6 4.5 12 V5.8 Z' }), (0, dom_1.svg)('path', { d: 'M12.9 7.6 L9.4 12.6 H12.4 L11.2 16.6 L14.8 11.4 H11.8 Z' }));
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
    if (isBattery)
        g.append(socText);
    if (!hasIcon)
        g.append(nameIn);
    g.append(value, badge);
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
        if (levelRect) {
            const h = 13 * (view.level ?? 0);
            (0, dom_1.setAttr)(levelRect, 'height', h.toFixed(2));
            (0, dom_1.setAttr)(levelRect, 'y', (20 - h).toFixed(2));
        }
    };
    return { el: g, update };
}

},
"src/renderer/PopupRenderer":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Popup = void 0;
exports.buildGraph = buildGraph;
const i18n_1 = require("../helpers/i18n");
const stateHelper_1 = require("../helpers/stateHelper");
const dom_1 = require("./dom");
const W = 320;
const H = 128;
const PAD = { l: 6, r: 6, t: 20, b: 20 };
function signed(watts, format) {
    return `${watts < 0 ? '−' : ''}${(0, stateHelper_1.formatPower)(watts, format)}`;
}
function clock(ms, language) {
    return new Date(ms).toLocaleTimeString(language || undefined, { hour: '2-digit', minute: '2-digit' });
}
/** Tekent de 24-uursgrafiek als kale SVG: geen externe grafiekbibliotheek nodig. */
function buildGraph(points, start, end, format, language) {
    const root = (0, dom_1.svg)('svg', { class: 'graph', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': (0, i18n_1.t)('last_24h', language) });
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
    return root;
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
        const sig = JSON.stringify({ ...model, history: model.history.kind === 'ready' ? [model.history.points.length, model.history.end] : model.history.kind });
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
        const graphBox = (0, dom_1.html)('section', { class: 'popup-section' }, (0, dom_1.html)('h3', {}, (0, i18n_1.t)('last_24h', language)), graph);
        const rows = (0, dom_1.html)('dl', { class: 'popup-rows' });
        for (const row of model.rows)
            rows.append((0, dom_1.html)('dt', {}, row.label), (0, dom_1.html)('dd', {}, row.value));
        this.body.replaceChildren(big, graphBox);
        if (model.rows.length > 0)
            this.body.append(rows);
        if (model.note)
            this.body.append((0, dom_1.html)('p', { class: 'popup-note' }, model.note));
    }
}
exports.Popup = Popup;

},
"src/renderer/dom":(module,exports,require)=>{
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

},
"src/types/EntityStatus":(module,exports,require)=>{
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

},
"src/types/NodeType":(module,exports,require)=>{
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

},
"src/types/hass":(module,exports,require)=>{
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

},
};
const __cache={};
function __norm(parts){const out=[];for(const p of parts){if(!p||p===".")continue;if(p==="..")out.pop();else out.push(p);}return out.join("/");}
function __req(id,from=""){let key=id;if(id.startsWith(".")){const base=from.split("/").slice(0,-1);key=__norm(base.concat(id.split("/")));}key=key.replace(/\.js$/," ").trim();if(!__mods[key]) throw new Error("energy-flow-card v0.7.2: module not found "+key+" from "+from);if(__cache[key]) return __cache[key].exports;const module={exports:{}};__cache[key]=module;const local=(x)=>__req(x,key);__mods[key](module,module.exports,local);return module.exports;}
__req("src/index");
})();
